import { estimateModelCost, modelTokenCost } from '../../server/src/services/model-cost';
import type { ModelCallReceipt } from '../../server/src/types/model-usage';

afterEach(() => { delete process.env.LLM_COST_RATES_JSON; });

it('prices the actual model and accounts for cache reads, writes and failed calls', () => {
  const receipt: ModelCallReceipt = {
    _id: 'call', trackingSessionId: 'session', stage: 'generation', provider: 'openai',
    requestedModel: 'gpt-6.2-astra', actualModel: 'gpt-6-luna', responseId: null,
    requestOptions: {}, startedAt: new Date(), outcome: 'failed', retryVisibility: 'unknown',
    usage: { inputTokens: 100_000, outputTokens: 20_000, totalTokens: 120_000, cachedInputTokens: 30_000,
      cacheWriteTokens: 10_000, reasoningTokens: 200, countSource: 'provider-reported', totalOrigin: 'provider' },
  };
  const result = estimateModelCost([receipt, { ...receipt, _id: 'other', actualModel: 'unpriced-model' }]);
  expect(result.estimatedUsd).toBeCloseTo(0.01755, 8);
  expect(result.unpricedCalls).toBe(1);
  expect(result.models).toMatchObject([
    { model: 'gpt-6-luna', tokens: 120_000, unpricedCalls: 0 },
    { model: 'unpriced-model', tokens: 120_000, estimatedUsd: null, unpricedCalls: 1 },
  ]);
});

it('compares models independently and supports explicit provider overrides', () => {
  expect(modelTokenCost('openai', 'gpt-6.2-astra', 100_000, 100_000)).toBeCloseTo(4.8);
  expect(modelTokenCost('openai', 'gpt-6-luna', 100_000, 100_000)).toBeCloseTo(0.06);
  expect(modelTokenCost('other-provider', 'gpt-6-luna', 100_000, 100_000)).toBeNull();
  expect(modelTokenCost('openai', 'gpt-6-luna', 300_000, 100_000)).toBeNull();
  process.env.LLM_COST_RATES_JSON = '{"other-provider/gpt-6-luna":{"input":1,"output":2}}';
  expect(modelTokenCost('other-provider', 'gpt-6-luna', 100_000, 200_000)).toBeCloseTo(0.5);
  expect(modelTokenCost('other-provider', 'gpt-6-luna', 100_000, 200_000, 500)).toBeNull();
});
