import { generationStageOutputCap } from '../../server/src/services/generation-model-budget';

it.each([
  ['none', 3000, 1500, 2000], ['low', 5000, 3000, 3500],
  ['medium', 8000, 6000, 6000], ['high', 8000, 6000, 6000], ['xhigh', 10000, 8000, 8000],
] as const)('keeps %s reasoning and visible JSON within a bounded stage allowance', (reasoningEffort, generation, check, quality) => {
  const step = { model: 'gpt-6-luna', reasoningEffort };
  expect(generationStageOutputCap(step, 'generation')).toBe(generation);
  for (const stage of ['validation', 'review'] as const) expect(generationStageOutputCap(step, stage)).toBe(check);
  expect(generationStageOutputCap(step, 'quality')).toBe(quality);
  expect(Math.max(generation, check, quality)).toBeLessThanOrEqual(10000);
});

it('uses the mandatory reasoning model default while preserving historical none-compatible defaults', () => {
  expect(generationStageOutputCap({ model: 'gpt-6.1-sol' }, 'quality')).toBe(6000);
  expect(generationStageOutputCap({ model: 'gpt-6.1-sol' }, 'generation')).toBe(8000);
  expect(generationStageOutputCap({ model: 'gpt-6-luna' }, 'quality')).toBe(2000);
});
