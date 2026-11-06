import type { CompleteJsonOptions, ModelCallEvent, ModelSendAdmission } from '../../server/src/components/genai/llm';
import { captureJson } from '../../scripts/quality-lab/capture';
import type { JsonCompletion, LabRequest } from '../../scripts/quality-lab/protocol';
import { createCapturedCompletion } from '../../scripts/quality-lab/completion';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const request: LabRequest = { stage: 'generator', prompt: 'Original exact source.', model: 'gpt-6-luna', effort: 'high', maxOutputTokens: 8000, allowedActualModels: ['gpt-6-luna'], maxSends: 2 };
function admission(prompt: string, attempt: number, options: CompleteJsonOptions): ModelSendAdmission {
  return { prompt, provider: 'openai', model: options.model!, jsonAttempt: attempt, outputCap: options.maxTokens!,
    options: { model: options.model, reasoning_effort: options.reasoningEffort, max_completion_tokens: options.maxTokens, responseFormat: 'json' } };
}
async function call(options: CompleteJsonOptions, prompt: string, attempt: number, raw: string, actualModel: string | null = 'gpt-6-luna', outcome: 'succeeded' | 'failed' = 'succeeded') {
  const release = await options.beforeRequest?.(admission(prompt, attempt, options));
  const base = { callId: `call-${attempt}`, provider: 'openai', requestedModel: options.model!, actualModel: null, responseId: null, startedAt: '2026-10-16T00:00:00Z', retryVisibility: 'unknown' as const,
    requestOptions: { model: options.model!, reasoning_effort: options.reasoningEffort!, max_completion_tokens: options.maxTokens!, stream: true }, usageContext: { jsonAttempt: attempt } };
  await options.onAttempt?.({ ...base, type: 'started' }); options.onText?.(''); options.onText?.(raw);
  await options.onAttempt?.({ ...base, actualModel, type: 'finished', finishedAt: '2026-10-16T00:00:01Z', durationMs: 1000, outcome,
    usage: { inputTokens: 123, outputTokens: 456, totalTokens: 579, reasoningTokens: 300, cachedInputTokens: null, cacheWriteTokens: null, totalOrigin: 'provider', countSource: 'provider-reported' } } as ModelCallEvent);
  if (release) await release();
}
describe('quality lab visible response capture', () => {
  it('retains both exact correction input and invalid raw replies when final JSON parsing fails', async () => {
    const complete: JsonCompletion = async <T>(prompt: string, options: CompleteJsonOptions = {}) => {
      await call(options, prompt, 0, '{broken first');
      await call(options, `${prompt}\nActual corrective request`, 1, 'broken retry');
      throw new Error('llm-json-parse-failed');
      return null as T;
    };
    const result = await captureJson(request, complete);
    expect(result.status).toBe('failed'); expect(result.parsed).toBeNull(); expect(result.attempts).toHaveLength(2);
    expect(result.attempts.map(attempt => attempt.rawVisibleText)).toEqual(['{broken first', 'broken retry']);
    expect(result.attempts[1]!.input.prompt).toContain('Actual corrective request');
    expect(result.attempts[0]!.events[1]!.type).toBe('finished');
  });
  it('captures partial visible text and usage even when transport fails', async () => {
    const complete: JsonCompletion = async () => { throw new Error('unused'); };
    const failing: JsonCompletion = async <T>(prompt: string, options: CompleteJsonOptions = {}) => {
      await call(options, prompt, 0, '{"partial":', 'gpt-6-luna', 'failed'); throw new Error('stream aborted'); return null as T;
    };
    void complete;
    const result = await captureJson(request, failing); expect(result.status).toBe('failed'); expect(result.attempts[0]!.rawVisibleText).toBe('{"partial":');
  });
  it('rejects changed model options before dispatch and verifies native response identity', async () => {
    const wrongShape: JsonCompletion = async <T>(prompt: string, options: CompleteJsonOptions = {}) => {
      const input = admission(prompt, 0, options); input.options.reasoning_effort = 'low'; await options.beforeRequest?.(input); return {} as T;
    };
    expect((await captureJson(request, wrongShape)).error?.message).toContain('reasoning-option-mismatch');
    const fallback: JsonCompletion = async <T>(prompt: string, options: CompleteJsonOptions = {}) => { await call(options, prompt, 0, '{}', 'different-model'); return {} as T; };
    const result = await captureJson(request, fallback); expect(result.status).toBe('failed'); expect(result.modelIdentityVerified).toBe(false); expect(result.parsed).toEqual({});
  });
  it('keeps successful parsed output and native token events without hidden reasoning', async () => {
    const complete: JsonCompletion = async <T>(prompt: string, options: CompleteJsonOptions = {}) => { await call(options, prompt, 0, '{"ok":true}'); return { ok: true } as T; };
    const result = await captureJson<{ ok: boolean }>(request, complete); expect(result.status).toBe('succeeded'); expect(result.modelIdentityVerified).toBe(true);
    expect(result.parsed?.ok).toBe(true); expect(result.hiddenReasoning).toBe('not-captured');
  });
  it('prevents a second JSON send when prospectively capped at one while retaining the paid first reply', async () => {
    const complete: JsonCompletion = async <T>(prompt: string, options: CompleteJsonOptions = {}) => {
      await call(options, prompt, 0, 'not json'); await call(options, prompt, 1, '{}'); return {} as T;
    };
    const result = await captureJson({ ...request, maxSends: 1 }, complete); expect(result.attempts).toHaveLength(1); expect(result.error?.message).toContain('cell-send-cap');
  });
  it('persists complete production-hook transcripts and composes incoming observers', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'quality-lab-capture-'));
    try {
      const upstream = { before: jest.fn(async () => undefined), text: jest.fn(), attempt: jest.fn(), usage: jest.fn() };
      const complete: JsonCompletion = async <T>(prompt: string, options: CompleteJsonOptions = {}) => {
        await call(options, prompt, 0, '{"ok":true}'); options.onUsage?.({ promptTokens: 123, completionTokens: 456 }); return { ok: true } as T;
      };
      const recorder = createCapturedCompletion({ directory: path.join(directory, 'transcripts'), ledgerPath: path.join(directory, 'ledger.json'),
        scope: 'same-phase', limits: { maxSends: 100, maxConservativeTokens: 2_000_000, maxInputTokens: 200000 }, cellId: 'outline-case', complete,
        maxInputTokens: 200000, maxOutputTokens: 24000 });
      const parsed = await recorder.complete<{ ok: boolean }>('Exact long source', { model: 'gpt-6-luna', reasoningEffort: 'medium', maxTokens: 24000,
        beforeRequest: upstream.before, onText: upstream.text, onAttempt: upstream.attempt, onUsage: upstream.usage });
      expect(parsed.ok).toBe(true); expect(upstream.before).toHaveBeenCalledTimes(1); expect(upstream.text).toHaveBeenLastCalledWith('{"ok":true}');
      expect(upstream.attempt).toHaveBeenCalledTimes(2); expect(upstream.usage).toHaveBeenCalledTimes(1);
      const transcript = JSON.parse(await readFile(recorder.captures[0]!.file, 'utf8'));
      expect(transcript.attempts[0].rawVisibleText).toBe('{"ok":true}'); expect(transcript.status).toBe('succeeded');
      expect(JSON.parse(await readFile(path.join(directory, 'ledger.json'), 'utf8')).reservedSends).toBe(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('does not send if the evidence sink fails before provider admission', async () => {
    let started = 0;
    const complete: JsonCompletion = async <T>(prompt: string, options: CompleteJsonOptions = {}) => {
      await options.beforeRequest?.(admission(prompt, 0, options)); started++; return {} as T;
    };
    await expect(captureJson(request, complete, () => { throw new Error('disk full'); })).rejects.toThrow('evidence-write-failed');
    expect(started).toBe(0);
  });
});
