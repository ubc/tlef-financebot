// Per-step parameter recovery for queued runs. Found 2026-08-23: the job
// rebuilt its models from the run record (ids only), so every queued run --
// the primary path -- executed at the model's default effort while the admin
// console said high/xhigh, and the regression panel's first baseline was
// measured at effort `none`.
import { resolvedFromPersisted } from '../../server/src/services/step-models';
import type { PlatformSettings } from '../../server/src/types/domain';

const settings = {
  models: {
    generator: { model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' },
    validator: { model: 'gpt-5.6-luna' },
    reviewer: { model: 'gpt-5.6-luna', reasoningEffort: 'high', temperature: 0.2 },
    masteryEvaluator: { model: 'gpt-5.6-luna' },
    utility: { model: 'gpt-5.6-luna' },
  },
} as unknown as PlatformSettings;

const recorded = { embedding: 'fast-bge', generator: 'gpt-5.6-luna', validator: 'gpt-5.6-luna', reviewer: 'gpt-5.6-luna' };

describe('resolvedFromPersisted', () => {
  it('inherits the configured parameters for a step whose recorded model matches the settings', () => {
    const resolved = resolvedFromPersisted(recorded, settings);
    expect(resolved.generator).toEqual({ model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' });
    expect(resolved.reviewer).toEqual({ model: 'gpt-5.6-luna', reasoningEffort: 'high', temperature: 0.2 });
    expect(resolved.validator).toEqual({ model: 'gpt-5.6-luna' });
  });

  it('runs a step at its own defaults when the console has since moved to a different model', () => {
    const resolved = resolvedFromPersisted({ ...recorded, generator: 'gpt-5.4-nano' }, settings);
    expect(resolved.generator).toEqual({ model: 'gpt-5.4-nano' });
    expect(resolved.reviewer.reasoningEffort).toBe('high');
  });

  it('is ids-only without settings (blueprint/retry enqueue, which persists ids anyway)', () => {
    expect(resolvedFromPersisted(recorded)).toEqual({
      embedding: 'fast-bge',
      generator: { model: 'gpt-5.6-luna' },
      validator: { model: 'gpt-5.6-luna' },
      reviewer: { model: 'gpt-5.6-luna' },
    });
  });
});
