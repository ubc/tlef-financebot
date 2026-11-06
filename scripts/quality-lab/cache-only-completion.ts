import type { CompleteJsonOptions } from '../../server/src/components/genai/llm';
import { hashControl, sha256, type JsonCompletion } from './protocol';

export interface CacheMissAttempt { stage: string; prompt: string; promptSha256: string; model: string; reasoningEffort: string; maxTokens: number; requestSha256: string; providerDispatched: false }
/** A real cache miss is an experiment result, never permission for a model call.
 * This dependency has no provider reference and cannot dispatch one. */
export function createCacheOnlyCompletion(expected: { model: string; reasoningEffort: string; extractionOutputCap: number; synthesisOutputCap: number; sourceReviewOutputCap?: number }): {
  complete: JsonCompletion; attempts: CacheMissAttempt[];
} {
  const attempts: CacheMissAttempt[] = [];
  return { attempts, complete: async <T>(prompt: string, options: CompleteJsonOptions = {}): Promise<T> => {
    const stage = options.usageContext?.stage ?? 'unknown';
    const expectedCap = stage === 'source-extraction' ? expected.extractionOutputCap : stage === 'outline-source-review' ? expected.sourceReviewOutputCap ?? 6000 : expected.synthesisOutputCap;
    if (options.model !== expected.model || options.reasoningEffort !== expected.reasoningEffort || options.maxTokens !== expectedCap) throw new Error('quality-lab-warm-cache-effective-options-drift');
    const request = { stage, prompt, model: options.model, reasoningEffort: options.reasoningEffort, maxTokens: options.maxTokens };
    attempts.push({ ...request, promptSha256: sha256(prompt), requestSha256: hashControl(request), providerDispatched: false });
    throw new Error(`quality-lab-warm-cache-miss-no-provider-dispatch:${stage}`);
  } };
}
