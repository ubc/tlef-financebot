import type { ProviderType } from 'ubc-genai-toolkit-llm';

export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  totalOrigin: 'provider' | 'derived-from-reported' | 'unknown';
  countSource: 'provider-reported' | 'unavailable';
}

export type ProviderUsageFormat = 'toolkit' | 'openai-chat' | 'openai-responses' | 'anthropic' | 'ollama';
export const tokenCount = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? value as number : null;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const add = (...values: Array<number | null>): number | null => values.every(value => value !== null)
  ? tokenCount(values.reduce<number>((sum, value) => sum + value!, 0)) : null;

/** Normalize one known wire format, rather than mixing unrelated aliases. */
export function normalizeProviderUsage(provider: ProviderType | string, value: unknown, format: ProviderUsageFormat = 'toolkit'): ModelUsage {
  const usage = record(value);
  let inputTokens: number | null = null;
  let outputTokens: number | null;
  let totalTokens: number | null = null;
  let reasoningTokens: number | null = null;
  let cachedInputTokens: number | null = null;
  let cacheWriteTokens: number | null = null;
  if (format === 'openai-chat' || format === 'openai-responses') {
    const chat = format === 'openai-chat';
    inputTokens = tokenCount(usage[chat ? 'prompt_tokens' : 'input_tokens']);
    outputTokens = tokenCount(usage[chat ? 'completion_tokens' : 'output_tokens']);
    totalTokens = tokenCount(usage.total_tokens);
    const inputDetails = record(usage[chat ? 'prompt_tokens_details' : 'input_tokens_details']);
    const outputDetails = record(usage[chat ? 'completion_tokens_details' : 'output_tokens_details']);
    cachedInputTokens = tokenCount(inputDetails.cached_tokens);
    cacheWriteTokens = tokenCount(inputDetails.cache_write_tokens);
    reasoningTokens = tokenCount(outputDetails.reasoning_tokens);
  } else if (format === 'anthropic') {
    // Anthropic's uncached input and cache read/write counts are disjoint.
    // Null cache counters stay unknown; they are not assumed to mean zero.
    cachedInputTokens = tokenCount(usage.cache_read_input_tokens);
    cacheWriteTokens = tokenCount(usage.cache_creation_input_tokens);
    inputTokens = add(tokenCount(usage.input_tokens), cachedInputTokens, cacheWriteTokens);
    outputTokens = tokenCount(usage.output_tokens);
  } else if (format === 'ollama') {
    inputTokens = tokenCount(usage.prompt_eval_count);
    outputTokens = tokenCount(usage.eval_count);
  } else {
    outputTokens = tokenCount(usage.completionTokens);
    // Toolkit 0.3.0 removes Anthropic's cache fields and derives a total from
    // uncached input alone. That total cannot represent complete input usage.
    if (provider !== 'anthropic') {
      inputTokens = tokenCount(usage.promptTokens);
      if (provider !== 'ollama') totalTokens = tokenCount(usage.totalTokens);
    }
  }
  const totalOrigin: ModelUsage['totalOrigin'] = totalTokens !== null ? 'provider'
    : add(inputTokens, outputTokens) !== null ? 'derived-from-reported' : 'unknown';
  totalTokens ??= add(inputTokens, outputTokens);
  const counters = [inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens, cacheWriteTokens];
  return { inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens, cacheWriteTokens,
    totalOrigin, countSource: counters.some(value => value !== null) ? 'provider-reported' : 'unavailable' };
}
