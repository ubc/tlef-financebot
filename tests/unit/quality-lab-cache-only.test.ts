import { createCacheOnlyCompletion } from '../../scripts/quality-lab/cache-only-completion';

describe('guaranteed zero-provider warm-cache completion', () => {
  it('retains exact uncached synthesis input then throws without provider callbacks or fallback', async () => {
    const cache = createCacheOnlyCompletion({ model: 'gpt-6-luna', reasoningEffort: 'medium', extractionOutputCap: 10000, synthesisOutputCap: 10000 });
    const before = jest.fn(); const observe = jest.fn(); const text = jest.fn();
    await expect(cache.complete('Exact original learning-point ledger', { model: 'gpt-6-luna', reasoningEffort: 'medium', maxTokens: 10000,
      usageContext: { stage: 'outline-synthesis' }, beforeRequest: before, onAttempt: observe, onText: text })).rejects.toThrow('warm-cache-miss-no-provider-dispatch:outline-synthesis');
    expect(cache.attempts).toHaveLength(1); expect(cache.attempts[0]!.providerDispatched).toBe(false);
    expect(cache.attempts[0]!.prompt).toBe('Exact original learning-point ledger'); expect(before).not.toHaveBeenCalled(); expect(observe).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled();
  });
  it('refuses to relabel an effective model/effort/cap change as cache reuse', async () => {
    const cache = createCacheOnlyCompletion({ model: 'gpt-6-luna', reasoningEffort: 'medium', extractionOutputCap: 10000, synthesisOutputCap: 10000 });
    await expect(cache.complete('source', { model: 'gpt-6.1-sol', reasoningEffort: 'medium', maxTokens: 10000, usageContext: { stage: 'source-extraction' } })).rejects.toThrow('options-drift');
    expect(cache.attempts).toHaveLength(0);
  });
  it('records a new final original-evidence review as an honest6000-token cache miss', async () => {
    const cache = createCacheOnlyCompletion({ model: 'gpt-6-luna', reasoningEffort: 'medium', extractionOutputCap: 12000, synthesisOutputCap: 24000, sourceReviewOutputCap: 6000 });
    await expect(cache.complete('Exact finalLO plus full original sections', { model: 'gpt-6-luna', reasoningEffort: 'medium', maxTokens: 6000, usageContext: { stage: 'outline-source-review' } })).rejects.toThrow('warm-cache-miss-no-provider-dispatch:outline-source-review');
    expect(cache.attempts[0]).toMatchObject({ stage: 'outline-source-review', maxTokens: 6000, providerDispatched: false });
  });
});
