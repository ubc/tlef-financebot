import { z } from 'zod';
import type { ModelCallReceipt, ModelCostEstimate } from '../types/model-usage';

interface TokenRates {
  input: number;
  output: number;
  cachedInput?: number;
  cacheWrite?: number;
}

// Standard short-context USD per million tokens. Current list rates are a
// reference for historical receipts, not the provider's invoice.
// https://developers.openai.com/api/docs/pricing
const openAiRates = new Map<string, TokenRates>([
  ['gpt-6-luna', { input: 0.10, output: 0.50, cachedInput: 0.01, cacheWrite: 0.125 }],
  ['gpt-6-sol', { input: 2, output: 10, cachedInput: 0.20, cacheWrite: 2.50 }],
  ['gpt-6.1-terra', { input: 1, output: 5, cachedInput: 0.05, cacheWrite: 1.25 }],
  ['gpt-6.1-sol', { input: 2, output: 10, cachedInput: 0.10, cacheWrite: 2.50 }],
  ['gpt-6-astra', { input: 10, output: 50, cachedInput: 1, cacheWrite: 12.50 }],
  ['gpt-6.2-sol', { input: 2, output: 10, cachedInput: 0.10, cacheWrite: 2.50 }],
  ['gpt-6.2-astra', { input: 8, output: 40, cachedInput: 0.40, cacheWrite: 10 }],
]);

const rate = z.number().finite().nonnegative().max(100_000);
const configuredRates = z.record(z.string(), z.object({
  input: rate, output: rate, cachedInput: rate.optional(), cacheWrite: rate.optional(),
}));

let cachedRates: { raw: string; rates: Record<string, TokenRates> } | undefined;

function configuredRate(provider: string, model: string): TokenRates | undefined {
  const raw = process.env.LLM_COST_RATES_JSON;
  if (!raw) return undefined;
  if (cachedRates?.raw !== raw) {
    let rates: Record<string, TokenRates> = {};
    try {
      const parsed = configuredRates.safeParse(JSON.parse(raw));
      if (parsed.success) rates = parsed.data;
    } catch { /* an invalid configuration supplies no rates */ }
    cachedRates = { raw, rates };
  }
  const key = `${provider}/${model}`;
  return Object.hasOwn(cachedRates.rates, key) ? cachedRates.rates[key] : undefined;
}

export function modelTokenCost(
  provider: string,
  model: string,
  input: number,
  output: number,
  cachedInput = 0,
  cacheWrite = 0,
): number | null {
  const configured = configuredRate(provider, model);
  const rates = configured ?? (provider === 'openai' ? openAiRates.get(model.replace(/-\d{4}-\d{2}-\d{2}$/, '')) : undefined);
  // An explicit per-model rate can describe a local/provider contract. For
  // public reference rates, skip long contexts whose tiers differ by model.
  if (!rates || (!configured && input > 272_000) || cachedInput + cacheWrite > input) return null;
  if ((cachedInput > 0 && rates.cachedInput === undefined) || (cacheWrite > 0 && rates.cacheWrite === undefined)) return null;
  return ((input - cachedInput - cacheWrite) * rates.input + output * rates.output
    + cachedInput * (rates.cachedInput ?? 0) + cacheWrite * (rates.cacheWrite ?? 0)) / 1_000_000;
}

export function estimateModelCost(calls: readonly ModelCallReceipt[]): ModelCostEstimate {
  const models = new Map<string, ModelCostEstimate['models'][number]>();
  let estimatedUsd: number | null = null;
  let unpricedCalls = 0;
  for (const call of calls) {
    const model = call.actualModel ?? call.requestedModel;
    const key = JSON.stringify([call.provider, model]);
    const row = models.get(key) ?? { provider: call.provider, model, tokens: null, estimatedUsd: null, unpricedCalls: 0 };
    if (call.usage.totalTokens !== null) row.tokens = (row.tokens ?? 0) + call.usage.totalTokens;
    const { inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens } = call.usage;
    const estimate = inputTokens === null || outputTokens === null ? null
      : modelTokenCost(call.provider, model, inputTokens, outputTokens, cachedInputTokens ?? 0, cacheWriteTokens ?? 0);
    if (estimate === null) {
      row.unpricedCalls++;
      unpricedCalls++;
    } else {
      row.estimatedUsd = (row.estimatedUsd ?? 0) + estimate;
      estimatedUsd = (estimatedUsd ?? 0) + estimate;
    }
    models.set(key, row);
  }
  return { estimatedUsd, unpricedCalls, models: [...models.values()].sort((a, b) => (b.estimatedUsd ?? 0) - (a.estimatedUsd ?? 0)) };
}
