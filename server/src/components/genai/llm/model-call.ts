import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { LLMConfig, LLMModule, LLMOptions, LLMResponse } from 'ubc-genai-toolkit-llm';
import { normalizeProviderUsage, type ModelUsage, type ProviderUsageFormat } from './provider-usage';

export interface ModelUsageContext {
  stage?: string;
  item?: number;
  candidateAttempt?: number;
  jsonAttempt?: number;
}
export type ModelCallRequestOptions = Record<string, string | number | boolean>;
interface ModelCallBase {
  callId: string;
  provider: string;
  requestedModel: string;
  actualModel: string | null;
  responseId: string | null;
  startedAt: string;
  retryVisibility: 'unknown' | 'disabled';
  requestOptions: ModelCallRequestOptions;
  usageContext: ModelUsageContext;
}
export type ModelCallEvent = (ModelCallBase & { type: 'started' }) | (ModelCallBase & {
  type: 'finished';
  finishedAt: string;
  durationMs: number;
  outcome: 'succeeded' | 'failed' | 'cancelled';
  usage: ModelUsage;
});
export type ModelCallObserver = (event: ModelCallEvent) => void | Promise<void>;

interface ObservationScope { observer?: ModelCallObserver; localObserver?: ModelCallObserver; usageContext: ModelUsageContext }
const scopes = new AsyncLocalStorage<ObservationScope>();
interface Capture { provider: string; usage: ModelUsage; nativeUsage: boolean; actualModel: string | null; responseId: string | null }
const captures = new AsyncLocalStorage<Capture>();

/** A nested owner replaces the outer recorder; local attempt listeners coexist. */
export function withModelCallObserver<T>(observer: ModelCallObserver, work: () => T): T {
  return scopes.run({ observer, usageContext: scopes.getStore()?.usageContext || {} }, work);
}

export function withModelCallContext<T>(context: ModelUsageContext, localObserver: ModelCallObserver | undefined, work: () => T): T {
  const parent = scopes.getStore();
  return scopes.run({ ...parent, usageContext: { ...parent?.usageContext, ...context }, localObserver: localObserver ?? parent?.localObserver }, work);
}

const safeString = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value.slice(0, 180) : null;
function safeContext(value: ModelUsageContext): ModelUsageContext {
  return { ...(typeof value.stage === 'string' ? { stage: value.stage.slice(0, 100) } : {}),
    ...Object.fromEntries(['item', 'candidateAttempt', 'jsonAttempt'].flatMap(key => {
      const count = value[key as keyof ModelUsageContext];
      return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? [[key, count]] : [];
    })) };
}
function safeOptions(options: LLMOptions): ModelCallRequestOptions {
  const result: ModelCallRequestOptions = {};
  for (const key of ['temperature', 'maxTokens', 'max_completion_tokens', 'max_output_tokens', 'reasoning_effort', 'stream', 'responseFormat']) {
    const value: unknown = options[key];
    if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    if (typeof value === 'string' && value.length <= 80) result[key] = value;
  }
  return result;
}
async function notify(scope: ObservationScope | undefined, event: ModelCallEvent): Promise<void> {
  const observers = [...new Set([scope?.observer, scope?.localObserver].filter((observer): observer is ModelCallObserver => !!observer))];
  for (const observer of observers) {
    try { await observer(structuredClone(event)); } catch { /* Telemetry cannot fail or repeat model work. */ }
  }
}

/** Called before parsing, invoking callbacks, or propagating a provider failure. */
export function captureModelCallResponse(value: { usage?: unknown; format?: ProviderUsageFormat; model?: unknown; responseId?: unknown }): void {
  const capture = captures.getStore();
  if (!capture) return;
  if (value.usage != null && !(capture.nativeUsage && (value.format ?? 'toolkit') === 'toolkit')) {
    const next = normalizeProviderUsage(capture.provider, value.usage, value.format);
    for (const field of ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens', 'cacheWriteTokens'] as const) {
      if (next[field] !== null) capture.usage[field] = next[field];
    }
    if (next.totalOrigin !== 'unknown') capture.usage.totalOrigin = next.totalOrigin;
    if (next.countSource !== 'unavailable') capture.usage.countSource = next.countSource;
  }
  capture.nativeUsage ||= value.format !== undefined && value.format !== 'toolkit';
  capture.actualModel = safeString(value.model) ?? capture.actualModel;
  capture.responseId = safeString(value.responseId) ?? capture.responseId;
}

export async function observeModelCall<T extends LLMResponse>(config: Pick<LLMConfig, 'provider' | 'defaultModel'>,
  options: LLMOptions, work: () => Promise<T>): Promise<T> {
  const scope = scopes.getStore();
  const start = Date.now();
  const base: ModelCallBase = { callId: randomUUID(), provider: config.provider,
    requestedModel: safeString(options.model) ?? config.defaultModel, actualModel: null, responseId: null,
    startedAt: new Date(start).toISOString(), retryVisibility: 'unknown', requestOptions: safeOptions(options),
    usageContext: safeContext(scope?.usageContext || {}) };
  const capture: Capture = { provider: config.provider, usage: normalizeProviderUsage(config.provider, null),
    nativeUsage: false, actualModel: null, responseId: null };
  await notify(scope, { ...base, type: 'started' });
  let outcome: 'succeeded' | 'failed' | 'cancelled' = 'failed';
  try {
    const result = await captures.run(capture, work);
    // Toolkit's stream model is often only the requested model; native adapters
    // capture actual response identity separately and must not be overwritten.
    if (!capture.nativeUsage) captureModelResult(capture, result);
    outcome = 'succeeded';
    return result;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (['AbortError', 'APIUserAbortError'].includes(name)) outcome = 'cancelled';
    throw error;
  } finally {
    const finish = Date.now();
    await notify(scope, { ...base, type: 'finished', actualModel: capture.actualModel, responseId: capture.responseId,
      finishedAt: new Date(finish).toISOString(), durationMs: Math.max(0, finish - start), outcome, usage: capture.usage });
  }
}
function captureModelResult(capture: Capture, result: LLMResponse): void {
  capture.usage = normalizeProviderUsage(capture.provider, result.usage);
  capture.actualModel = safeString(result.model) ?? capture.actualModel;
  capture.responseId = safeString(result.metadata?.id) ?? capture.responseId;
}

/** Instrument the public completion facade used by direct RAG and generation. */
export function observeLLMModule(module: LLMModule, config: LLMConfig): LLMModule {
  for (const name of ['sendMessage', 'sendConversation', 'streamConversation', 'sendStructuredConversation'] as const) {
    const original = module[name];
    if (typeof original !== 'function') continue;
    const optionIndex = name === 'streamConversation' || name === 'sendStructuredConversation' ? 2 : 1;
    // Preserve the toolkit facade's overloads; each wrapper calls exactly one
    // original facade method, not another wrapped method.
    const wrapped = (...args: unknown[]) => {
      const options = { ...config.defaultOptions, ...(args[optionIndex] as LLMOptions | undefined),
        ...(name === 'streamConversation' ? { stream: true } : {}) };
      return observeModelCall(config, options, () => (original as (...values: unknown[]) => Promise<LLMResponse>).apply(module, args));
    };
    Object.defineProperty(module, name, { value: wrapped, writable: true, configurable: true });
  }
  return module;
}
