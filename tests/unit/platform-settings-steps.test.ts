jest.mock('../../server/src/config/env', () => ({ env: {
  llmDefaultModel: 'gpt-6-luna', llmModelGenerator: 'gpt-6-luna',
  llmModelValidator: 'gpt-6-luna', llmModelReviewer: 'gpt-6-luna',
  llmModelMasteryEvaluator: 'gpt-6-luna',
} }));
// Unit test — per-step model configuration: reading a legacy document, and
// refusing a combination the provider would reject with a 400.
//
// The validation here is not belt-and-braces over the UI. The console will not
// OFFER an illegal combination, but this endpoint takes JSON, and an incoherent
// save surfaces as a 400 inside a background generation job with nothing
// pointing back at the settings change that caused it.
const findPlatformSettings = jest.fn();
const replacePlatformSettings = jest.fn();
const findCourse = jest.fn();
const updateCourse = jest.fn();
const insertAudit = jest.fn();
jest.mock('../../server/src/components/mongodb/collections', () => ({
  auditCol: jest.fn(() => ({ insertOne: insertAudit })),
  coursesCol: jest.fn(() => ({ findOne: findCourse, updateOne: updateCourse })),
  capabilitySettingsCol: jest.fn(),
  platformInstructorGrantsCol: jest.fn(),
  platformSettingsCol: jest.fn(() => ({ findOne: findPlatformSettings, replaceOne: replacePlatformSettings })),
  usersCol: jest.fn(),
}));

import {
  getAdminCourseModels,
  getPlatformSettings,
  normalizePlatformSettings,
  updatePlatformSettings,
  utilityStepConfig,
  saveAdminCourseModels,
} from '../../server/src/services/admin.service';
import { ObjectId } from 'mongodb';
import { modelRequestOptions } from '../../server/src/components/genai/llm/model-capabilities';
import { env } from '../../server/src/config/env';
import type { PlatformSettings } from '../../server/src/types/domain';

const NANO = 'gpt-5.4-nano';   // reasoning-tunable: default effort none, so a temperature is legal
const LUNA = 'gpt-5.6-luna';   // reasoning-fixed:  default effort medium, so it is not

function validPatch(over: Partial<PlatformSettings['models']> = {}) {
  return {
    models: {
      generator: { model: NANO },
      reviewer: { model: NANO },
      masteryEvaluator: { model: NANO },
      utility: { model: NANO },
      ...over,
    },
    costControls: { maxGenerationsPerDay: 10 },
    featureFlags: { layer2Evaluator: true },
  };
}

beforeEach(() => {
  findPlatformSettings.mockReset();
  replacePlatformSettings.mockReset();
  findCourse.mockReset();
  updateCourse.mockReset();
  insertAudit.mockReset();
  findPlatformSettings.mockResolvedValue({ _id: 'platform', ...validPatch() });
});

it('isolates course model choices, inherits compatible parameters and clears with a revisioned save', async () => {
  const courseId = new ObjectId();
  findPlatformSettings.mockResolvedValue({
    _id: 'platform', ...validPatch({ generator: { model: NANO, modelSource: 'override', reasoningEffort: 'high' } }),
    customModels: [{ id: 'campus-reasoner', profile: 'reasoning-fixed' }],
  });
  const course = { _id: courseId };
  findCourse.mockImplementation(async (filter) => filter._id.equals(courseId) ? course : { _id: filter._id });
  updateCourse.mockResolvedValue({ matchedCount: 1 });
  const next = await saveAdminCourseModels(courseId, 0, { generator: 'campus-reasoner', utility: NANO }, 'ADMIN');
  expect(next).toMatchObject({ revision: 1, overrides: { generator: 'campus-reasoner', utility: NANO }, effectiveModels: {
    generator: { model: 'campus-reasoner', capabilityProfile: 'reasoning-fixed', reasoningEffort: 'high' },
  } });
  const mutation = updateCourse.mock.calls[0][1];
  Object.assign(course, mutation.$set);
  expect(updateCourse.mock.calls[0][0]).toEqual({ _id: courseId, 'llmModelSettings.revision': { $exists: false } });
  expect(modelRequestOptions({ ...(await getPlatformSettings(courseId)).models.generator, maxTokens: 10 })).toMatchObject({
    model: 'campus-reasoner', max_completion_tokens: 10, reasoning_effort: 'high',
  });
  await expect(utilityStepConfig(courseId)).resolves.toMatchObject({ model: NANO });
  await expect(utilityStepConfig(new ObjectId())).resolves.toMatchObject({ model: 'gpt-6-luna' });
  expect(insertAudit).toHaveBeenCalledWith(expect.objectContaining({ courseId, action: 'course-models.update' }));
  await expect(saveAdminCourseModels(courseId, 0, {}, 'ADMIN')).rejects.toThrow('course-models-conflict');
  await expect(saveAdminCourseModels(courseId, 1, { generator: 'unknown-model' }, 'ADMIN')).rejects.toThrow('invalid-model-selector');
  const cleared = await saveAdminCourseModels(courseId, 1, {}, 'ADMIN');
  expect(cleared).toMatchObject({ overrides: {}, effectiveModels: { generator: { model: NANO } }, revision: 2 });
  await expect(getAdminCourseModels(courseId)).resolves.toMatchObject({ revision: 1 });
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
    expect(normalized.models.generator).toEqual({ model: 'gpt-6-luna', modelSource: 'environment' });
    expect(normalized.models.reviewer).toEqual({ model: 'gpt-6-luna', modelSource: 'environment' });
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

  it('leaves a current-shape document untouched', () => {
    const current = { _id: 'platform', ...validPatch({ reviewer: { model: LUNA, modelSource: 'override', reasoningEffort: 'high' } }) } as PlatformSettings;
    expect(normalizePlatformSettings(current).models.reviewer).toEqual({ model: LUNA, modelSource: 'override', reasoningEffort: 'high' });
  });

  it('serves the utility step to classification/import callers', async () => {
    findPlatformSettings.mockResolvedValue({ _id: 'platform', ...validPatch({ utility: { model: LUNA, modelSource: 'override' } }) });
    await expect(utilityStepConfig()).resolves.toEqual({ model: LUNA, modelSource: 'override' });
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

describe('environment model sources', () => {
  it('updates legacy and environment IDs while preserving compatible parameters and other settings', () => {
    const stored = { _id: 'platform', ...validPatch({
      generator: { model: LUNA, reasoningEffort: 'xhigh' },
      reviewer: { model: LUNA, modelSource: 'environment', reasoningEffort: 'high' },
    }) } as PlatformSettings;
    const resolved = normalizePlatformSettings(stored);
    expect(resolved.models.generator).toEqual({ model: 'gpt-6-luna', modelSource: 'environment', reasoningEffort: 'xhigh' });
    expect(resolved.models.reviewer).toEqual({ model: 'gpt-6-luna', modelSource: 'environment', reasoningEffort: 'high' });
    expect(resolved.costControls).toEqual(stored.costControls);
    expect(stored.models.generator.model).toBe(LUNA);
    expect(replacePlatformSettings).not.toHaveBeenCalled();
  });

  it('does not pin a stale browser ID when saving environment mode', async () => {
    const resolved = await updatePlatformSettings(validPatch({ generator: {
      model: LUNA, modelSource: 'environment', reasoningEffort: 'xhigh',
    } }), 'ADMIN');
    expect(resolved.models.generator).toEqual({ model: 'gpt-6-luna', modelSource: 'environment', reasoningEffort: 'xhigh' });
    expect(normalizePlatformSettings(resolved).models.generator).toEqual(resolved.models.generator);
  });

  it('keeps explicit and older-client model selections as overrides after saving', async () => {
    const resolved = await updatePlatformSettings(validPatch({ reviewer: {
      model: LUNA, modelSource: 'override', reasoningEffort: 'high',
    } }), 'ADMIN');
    expect(normalizePlatformSettings(resolved).models.reviewer).toEqual({ model: LUNA, modelSource: 'override', reasoningEffort: 'high' });
    expect(resolved.models.generator).toEqual({ model: NANO, modelSource: 'override' });
  });
});

it('resolves a changed startup environment while keeping an explicit override', () => {
  const changedEnvironment = jest.replaceProperty(env, 'llmModelGenerator', 'local/env-model');
  const stored = { _id: 'platform', ...validPatch({
    generator: { model: LUNA, modelSource: 'environment', reasoningEffort: 'high' },
    reviewer: { model: LUNA, modelSource: 'override', reasoningEffort: 'high' },
  }) } as PlatformSettings;
  try {
    const resolved = normalizePlatformSettings(stored);
    expect(resolved.models.generator).toEqual({ model: 'local/env-model', modelSource: 'environment' });
    expect(resolved.models.reviewer).toEqual(stored.models.reviewer);
  } finally { changedEnvironment.restore(); }
});
