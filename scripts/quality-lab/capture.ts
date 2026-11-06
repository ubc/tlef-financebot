import type { CompleteJsonOptions, ModelCallEvent, ModelSendAdmission } from '../../server/src/components/genai/llm';
import { assertRequestShape, hashControl, safeError, type CapturedAttempt, type CapturedCompletion, type CaptureSink, type JsonCompletion, type LabRequest } from './protocol';

/** Captures every visible streaming reply before JSON parsing/format correction.
 * Metadata observers alone cannot recover invalid raw JSON after helper failure. */
export async function captureJson<T>(request: LabRequest, complete: JsonCompletion, sink: CaptureSink = () => undefined,
  additional: Pick<CompleteJsonOptions, 'beforeRequest' | 'usageContext' | 'systemPrompt' | 'onText' | 'onAttempt' | 'onUsage'> = {}): Promise<CapturedCompletion<T>> {
  const started = Date.now();
  const result: CapturedCompletion<T> = { version: 1, stage: request.stage, request: structuredClone(request), startedAt: new Date(started).toISOString(), elapsedMs: 0,
    attempts: [], status: 'failed', parsed: null, error: null, modelIdentityVerified: false, hiddenReasoning: 'not-captured',
    transport: 'toolkit-streamConversation-visible-content; JSON option is not strict native schema' };
  let current: CapturedAttempt | undefined;
  let evidenceFailure: unknown;
  const persist = async () => { try { await sink(structuredClone(result)); } catch (error) { evidenceFailure ??= error; } };
  const observe = async (event: ModelCallEvent) => {
    if (!current) { evidenceFailure ??= new Error('quality-lab-event-without-input'); return; }
    current.events.push(structuredClone(event));
    current.dispatch = event.type === 'started' ? 'started' : 'finished';
    await persist();
    await additional.onAttempt?.(event);
  };
  const beforeRequest = async (admission?: ModelSendAdmission) => {
    if (evidenceFailure) throw new Error('quality-lab-evidence-write-failed');
    if (!admission) throw new Error('quality-lab-admission-missing');
    assertRequestShape(request, admission);
    const input = { prompt: admission.prompt, systemPrompt: admission.systemPrompt ?? null,
      messages: [{ role: 'user' as const, content: admission.prompt }], options: { ...admission.options }, provider: admission.provider,
      model: admission.model, outputCap: admission.outputCap };
    current = { number: admission.jsonAttempt, input, inputSha256: hashControl(input), rawVisibleText: '', events: [], dispatch: 'prepared' };
    result.attempts.push(current);
    await persist();
    if (evidenceFailure) throw new Error('quality-lab-evidence-write-failed');
    return additional.beforeRequest?.(admission);
  };
  try {
    result.parsed = await complete<T>(request.prompt, {
      model: request.model, reasoningEffort: request.effort, maxTokens: request.maxOutputTokens,
      systemPrompt: additional.systemPrompt, beforeRequest, usageContext: { stage: request.stage, ...additional.usageContext }, onAttempt: observe, onUsage: additional.onUsage,
      onText: text => {
        if (!current) { evidenceFailure ??= new Error('quality-lab-text-without-input'); return; }
        current.rawVisibleText = text;
        additional.onText?.(text);
      },
    });
    if (evidenceFailure) throw new Error('quality-lab-evidence-write-failed');
    const finished = result.attempts.flatMap(attempt => attempt.events).filter((event): event is Extract<ModelCallEvent, { type: 'finished' }> => event.type === 'finished');
    if (finished.length !== result.attempts.length || !finished.length) throw new Error('quality-lab-incomplete-observation');
    for (const event of finished) {
      if (event.requestedModel !== request.model || event.requestOptions.reasoning_effort !== request.effort) throw new Error('quality-lab-observed-option-mismatch');
      if (!event.actualModel || !request.allowedActualModels.includes(event.actualModel)) throw new Error(`quality-lab-unverified-actual-model:${event.actualModel ?? 'unknown'}`);
    }
    result.modelIdentityVerified = true;
    result.status = 'succeeded';
  } catch (error) { result.error = safeError(error); }
  result.elapsedMs = Date.now() - started;
  await persist();
  if (evidenceFailure) throw new Error('quality-lab-evidence-write-failed');
  return result;
}
