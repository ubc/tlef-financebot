// Unit test — per-step model configuration: reading a legacy document, and
// refusing a combination the provider would reject with a 400.
//
// The validation here is not belt-and-braces over the UI. The console will not
// OFFER an illegal combination, but this endpoint takes JSON, and an incoherent
// save surfaces as a 400 inside a background generation job with nothing
// pointing back at the settings change that caused it.
const findPlatformSettings = jest.fn();
const replacePlatformSettings = jest.fn();
jest.mock('../../server/src/components/mongodb/collections', () => ({
  auditCol: jest.fn(() => ({ insertOne: jest.fn() })),
  capabilitySettingsCol: jest.fn(),
  platformInstructorGrantsCol: jest.fn(),
  platformSettingsCol: jest.fn(() => ({ findOne: findPlatformSettings, replaceOne: replacePlatformSettings })),
  usersCol: jest.fn(),
}));

import {
  getPlatformSettings,
  normalizePlatformSettings,
  updatePlatformSettings,
  utilityStepConfig,
} from '../../server/src/services/admin.service';
import type { PlatformSettings } from '../../server/src/types/domain';

const NANO = 'gpt-5.4-nano';   // reasoning-tunable: default effort none, so a temperature is legal
const LUNA = 'gpt-5.6-luna';   // reasoning-fixed:  default effort medium, so it is not

function validPatch(over: Partial<PlatformSettings['models']> = {}) {
  return {
    models: {
      generator: { model: NANO },
      validator: { model: NANO },
      reviewer: { model: NANO },
      masteryEvaluator: { model: NANO },
      utility: { model: NANO },
      ...over,
    },
    costControls: { maxGenerationsPerDay: 10 },
    featureFlags: { reviewerAgent: true, layer2Evaluator: true, retryOnReject: true },
  };
}

beforeEach(() => {
  findPlatformSettings.mockReset();
  replacePlatformSettings.mockReset();
  findPlatformSettings.mockResolvedValue({ _id: 'platform', ...validPatch() });
});

describe('reading a document written by an older deploy', () => {
  it('normalizes a bare model-id string into a step config', () => {
    // The shape shipped before per-step parameters existed. Read-normalized
    // rather than migrated, so a rollback stays safe.
    const legacy = {
      _id: 'platform',
      models: { generator: NANO, validator: NANO, reviewer: LUNA, masteryEvaluator: NANO },
      costControls: { maxGenerationsPerDay: 10 },
      featureFlags: { reviewerAgent: true, layer2Evaluator: true, retryOnReject: true },
    } as unknown as PlatformSettings;
    const normalized = normalizePlatformSettings(legacy);
    expect(normalized.models.generator).toEqual({ model: NANO });
    expect(normalized.models.reviewer).toEqual({ model: LUNA });
  });

  it('invents the utility step, which no legacy document has', () => {
    // Classification, import and RAG ran on LLM_DEFAULT_MODEL with no admin
    // control at all, so that is what the new step must inherit.
    const legacy = {
      _id: 'platform',
      models: { generator: NANO, validator: NANO, reviewer: NANO, masteryEvaluator: NANO },
      costControls: { maxGenerationsPerDay: 10 },
      featureFlags: { reviewerAgent: true, layer2Evaluator: true, retryOnReject: true },
    } as unknown as PlatformSettings;
    expect(normalizePlatformSettings(legacy).models.utility.model).toBeTruthy();
  });

  it('defaults retryOnReject ON for a document written before the flag existed', () => {
    // Flags added after a doc was written default ON: the cost-saving direction
    // is an explicit opt-out, and a legacy doc must not silently disable the
    // reject-retry mechanism.
    const legacy = {
      _id: 'platform',
      models: { generator: NANO, validator: NANO, reviewer: NANO, masteryEvaluator: NANO },
      costControls: { maxGenerationsPerDay: 10 },
      featureFlags: { reviewerAgent: true, layer2Evaluator: false },
    } as unknown as PlatformSettings;
    const normalized = normalizePlatformSettings(legacy);
    expect(normalized.featureFlags.retryOnReject).toBe(true);
    // and the flags the doc DID carry are preserved, not overwritten
    expect(normalized.featureFlags.layer2Evaluator).toBe(false);
  });

  it('leaves a current-shape document untouched', () => {
    const current = { _id: 'platform', ...validPatch({ reviewer: { model: LUNA, reasoningEffort: 'high' } }) } as PlatformSettings;
    expect(normalizePlatformSettings(current).models.reviewer).toEqual({ model: LUNA, reasoningEffort: 'high' });
  });

  it('serves the utility step to classification/import callers', async () => {
    findPlatformSettings.mockResolvedValue({ _id: 'platform', ...validPatch({ utility: { model: LUNA } }) });
    await expect(utilityStepConfig()).resolves.toEqual({ model: LUNA });
  });
});

describe('refusing a combination the provider would reject', () => {
  it('rejects a temperature on a model that reasons by default', async () => {
    // luna 400s on any explicit temperature while reasoning, and it reasons
    // unless told otherwise — so this save would break every reviewer call.
    await expect(updatePlatformSettings(validPatch({ reviewer: { model: LUNA, temperature: 0.7 } }), 'ADMIN'))
      .rejects.toThrow('step-rejects-temperature:reviewer');
  });

  it('ACCEPTS that same temperature once effort is explicitly none', async () => {
    // Verified live: the constraint belongs to the request, not the model.
    await expect(updatePlatformSettings(
      validPatch({ reviewer: { model: LUNA, temperature: 0.7, reasoningEffort: 'none' } }), 'ADMIN',
    )).resolves.toBeTruthy();
  });

  it('rejects a temperature once reasoning is switched on, even on nano', async () => {
    await expect(updatePlatformSettings(
      validPatch({ generator: { model: NANO, temperature: 0.7, reasoningEffort: 'low' } }), 'ADMIN',
    )).rejects.toThrow('step-rejects-temperature:generator');
  });

  it('rejects a temperature outside the profile range', async () => {
    await expect(updatePlatformSettings(validPatch({ generator: { model: NANO, temperature: 9 } }), 'ADMIN'))
      .rejects.toThrow('temperature-out-of-range:generator');
  });

  it('rejects a reasoning effort on a model with no reasoning channel', async () => {
    await expect(updatePlatformSettings(
      validPatch({ generator: { model: 'ministral-3:latest', reasoningEffort: 'high' } }), 'ADMIN',
    )).rejects.toThrow('step-rejects-reasoning-effort:generator');
  });

  it('rejects a blank model on the new utility step like any other', async () => {
    await expect(updatePlatformSettings(validPatch({ utility: { model: '  ' } }), 'ADMIN'))
      .rejects.toThrow('invalid-model-selector');
  });
});

describe('custom models', () => {
  it('lets a custom model borrow a profile, and validates the step against it', async () => {
    // The escape hatch: a model id the table has never seen becomes usable by
    // declaring which implemented behaviour it has.
    const patch = {
      ...validPatch({ generator: { model: 'internal-gateway/mystery-v2', temperature: 0.5 } }),
      customModels: [{ id: 'internal-gateway/mystery-v2', profile: 'classic' as const }],
    };
    await expect(updatePlatformSettings(patch, 'ADMIN')).resolves.toBeTruthy();
  });

  it('holds a custom model to its declared profile', async () => {
    const patch = {
      ...validPatch({ generator: { model: 'internal-gateway/mystery-v2', temperature: 0.5 } }),
      customModels: [{ id: 'internal-gateway/mystery-v2', profile: 'reasoning-fixed' as const }],
    };
    await expect(updatePlatformSettings(patch, 'ADMIN')).rejects.toThrow('step-rejects-temperature:generator');
  });

  it('refuses a profile the code does not implement', async () => {
    const patch = {
      ...validPatch(),
      customModels: [{ id: 'x', profile: 'invented-profile' as never }],
    };
    await expect(updatePlatformSettings(patch, 'ADMIN')).rejects.toThrow('unknown-capability-profile');
  });
});

it('falls back to env defaults when no document exists at all', async () => {
  findPlatformSettings.mockResolvedValue(null);
  const settings = await getPlatformSettings();
  expect(settings.models.utility.model).toBeTruthy();
  expect(settings.customModels).toEqual([]);
});
