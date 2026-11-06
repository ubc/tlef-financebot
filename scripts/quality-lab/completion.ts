import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CompleteJsonOptions } from '../../server/src/components/genai/llm';
import { captureJson } from './capture';
import { reserveLedger, type LedgerLimits } from './ledger';
import type { CapturedCompletion, JsonCompletion, LabEffort } from './protocol';

export interface CapturedCompletionContext {
  directory: string;
  ledgerPath: string;
  limits: LedgerLimits;
  scope: string;
  cellId: string;
  complete: JsonCompletion;
  /** Exact deployment response aliases must be declared prospectively. */
  actualModelAllowlist?: Record<string, string[]>;
  /** Optional immutable-code/source control guard, run before each send. */
  assertCurrent?: () => Promise<void>;
  maxSendsPerCompletion?: 1 | 2;
  maxOutputTokens?: number;
  maxInputTokens?: number;
  onSnapshot?: (value: CapturedCompletion, file: string) => void | Promise<void>;
}
/** Reusable internal completion hook for outline/generation/repair services.
 * Callers still use their production parsers and must supply exact model,
 * reasoningEffort and output cap; this utility never invents model defaults. */
export function createCapturedCompletion(context: CapturedCompletionContext): {
  complete: JsonCompletion; captures: Array<{ file: string; transcript: CapturedCompletion }>;
} {
  const captures: Array<{ file: string; transcript: CapturedCompletion }> = [];
  return { captures, complete: async <T>(prompt: string, options: CompleteJsonOptions = {}): Promise<T> => {
    const model = options.model; const effort = options.reasoningEffort; const cap = options.maxTokens;
    if (!model || !['gpt-6-luna', 'gpt-6.1-sol'].includes(model) || !effort || !['low', 'medium', 'high'].includes(effort) ||
      !Number.isSafeInteger(cap) || cap! < 1 || cap! > (context.maxOutputTokens ?? 10000)) throw new Error('quality-lab-explicit-supported-call-options-required');
    await context.assertCurrent?.();
    await mkdir(context.directory, { recursive: true });
    const file = path.join(context.directory, `${context.cellId}--${captures.length + 1}.json`);
    const entry = { file, transcript: null as unknown as CapturedCompletion }; captures.push(entry);
    const request = { stage: options.usageContext?.stage ?? 'unlabelled-production-json', prompt, model, effort: effort as LabEffort, maxOutputTokens: cap!,
      ...(context.maxInputTokens ? { maxInputTokens: context.maxInputTokens } : {}),
      allowedActualModels: context.actualModelAllowlist?.[model] ?? [model], maxSends: context.maxSendsPerCompletion ?? 2 };
    const result = await captureJson<T>(request, context.complete, async snapshot => {
      entry.transcript = snapshot;
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file);
      await context.onSnapshot?.(snapshot, file);
    }, { systemPrompt: options.systemPrompt, usageContext: options.usageContext, onText: options.onText, onAttempt: options.onAttempt, onUsage: options.onUsage,
      beforeRequest: async admission => {
        if (!admission) throw new Error('quality-lab-admission-missing');
        await context.assertCurrent?.();
        await reserveLedger(context.ledgerPath, context.limits, context.scope, context.cellId, request, admission.jsonAttempt, admission.prompt, admission.systemPrompt);
        return options.beforeRequest?.(admission);
      } });
    entry.transcript = result;
    if (result.status !== 'succeeded') throw new Error(result.error?.message ?? 'quality-lab-completion-failed');
    return result.parsed as T;
  } };
}
