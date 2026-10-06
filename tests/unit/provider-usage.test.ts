import { normalizeProviderUsage } from '../../server/src/components/genai/llm/provider-usage';

describe('provider usage semantics', () => {
  it('retains OpenAI totals and subsets without counting reasoning or cache twice', () => {
    expect(normalizeProviderUsage('openai', { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130,
      prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 12 } }, 'openai-chat'))
      .toEqual({ inputTokens: 100, outputTokens: 30, totalTokens: 130, cachedInputTokens: 60, cacheWriteTokens: 20,
        reasoningTokens: 12, totalOrigin: 'provider', countSource: 'provider-reported' });
  });
  it('normalizes Responses fields without borrowing fields from another format', () => {
    const usage = normalizeProviderUsage('openai', { input_tokens: 20, completion_tokens: 9,
      output_tokens: 4, input_tokens_details: { cached_tokens: 5 } }, 'openai-responses');
    expect(usage).toMatchObject({ inputTokens: 20, outputTokens: 4, totalTokens: 24, cachedInputTokens: 5,
      totalOrigin: 'derived-from-reported', reasoningTokens: null });
    expect(normalizeProviderUsage('openai', { input_tokens: 20, output_tokens: 4 }, 'openai-chat').totalTokens).toBeNull();
  });
  it('preserves genuine zero and rejects invalid or missing counters', () => {
    expect(normalizeProviderUsage('openai', { prompt_tokens: 0, completion_tokens: 0 }, 'openai-chat'))
      .toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0, totalOrigin: 'derived-from-reported' });
    expect(normalizeProviderUsage('openai', { prompt_tokens: '20', completion_tokens: -1, total_tokens: Infinity }, 'openai-chat'))
      .toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: null, countSource: 'unavailable' });
    expect(normalizeProviderUsage('openai', { prompt_tokens: 0.5, completion_tokens: Number.MAX_SAFE_INTEGER + 1 }, 'openai-chat').totalTokens).toBeNull();
  });
  it('keeps a reported total when the breakdown is missing', () => {
    expect(normalizeProviderUsage('openai', { total_tokens: 10 }, 'openai-chat'))
      .toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: 10, totalOrigin: 'provider' });
  });
  it('includes disjoint Anthropic cache read and creation counts in input exactly once', () => {
    expect(normalizeProviderUsage('anthropic', { input_tokens: 100, output_tokens: 30,
      cache_read_input_tokens: 60, cache_creation_input_tokens: 20 }, 'anthropic'))
      .toMatchObject({ inputTokens: 180, outputTokens: 30, totalTokens: 210, cachedInputTokens: 60,
        cacheWriteTokens: 20, totalOrigin: 'derived-from-reported', reasoningTokens: null });
    expect(normalizeProviderUsage('anthropic', { input_tokens: 100, output_tokens: 30 }, 'anthropic'))
      .toMatchObject({ inputTokens: null, outputTokens: 30, totalTokens: null });
  });
  it('does not trust the cache-incomplete Anthropic toolkit total', () => {
    expect(normalizeProviderUsage('anthropic', { promptTokens: 100, completionTokens: 30, totalTokens: 130 }))
      .toMatchObject({ inputTokens: null, outputTokens: 30, totalTokens: null, totalOrigin: 'unknown' });
  });
  it('derives Ollama totals from reported eval counts', () => {
    expect(normalizeProviderUsage('ollama', { prompt_eval_count: 12, eval_count: 4 }, 'ollama'))
      .toMatchObject({ inputTokens: 12, outputTokens: 4, totalTokens: 16, totalOrigin: 'derived-from-reported' });
    expect(normalizeProviderUsage('ollama', { promptTokens: 12, completionTokens: 4, totalTokens: 16 }).totalOrigin)
      .toBe('derived-from-reported');
  });
  it('accepts compatible toolkit counters and detects unsafe derived totals', () => {
    expect(normalizeProviderUsage('ubc-llm-sandbox', { promptTokens: 12, completionTokens: 4, totalTokens: 16 }))
      .toMatchObject({ totalTokens: 16, totalOrigin: 'provider' });
    expect(normalizeProviderUsage('openai', { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 }, 'openai-chat').totalTokens).toBeNull();
  });
});
