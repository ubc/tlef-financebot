import { env } from '../config/env';
import type { PlatformSettings, QuestionGenerationRun, StepModelConfig } from '../types/domain';

/**
 * Conversions between the two shapes a step's model takes: the in-memory config
 * (model + parameters) the pipeline calls with, and the model-id strings a
 * durable run record stores.
 *
 * These live in their own module, not in `generation.service`, because several
 * suites mock that service wholesale — a pure helper exported from it is
 * `undefined` under those mocks, and mirroring the implementation inside a mock
 * factory would mean the tests stop tracking the real behaviour.
 */

/** The three agents' models plus their per-step parameters, as used in memory. */
export interface ResolvedStepModels {
  embedding: string;
  generator: StepModelConfig;
  validator: StepModelConfig;
  reviewer: StepModelConfig;
}

export function configuredGenerationModels(): ResolvedStepModels {
  return {
    embedding: env.embeddingsModel,
    generator: { model: env.llmModelGenerator },
    validator: { model: env.llmModelValidator },
    reviewer: { model: env.llmModelReviewer },
  };
}

/** The admin-configured steps, in the in-memory shape the pipeline uses. */
export function stepModelsFrom(settings: PlatformSettings): ResolvedStepModels {
  return {
    embedding: env.embeddingsModel,
    generator: settings.models.generator,
    validator: settings.models.validator,
    reviewer: settings.models.reviewer,
  };
}

/** Flatten to the model ids the durable run record stores. */
export function persistedModels(resolved: ResolvedStepModels): QuestionGenerationRun['input']['models'] {
  return {
    embedding: resolved.embedding,
    generator: resolved.generator.model,
    validator: resolved.validator.model,
    reviewer: resolved.reviewer.model,
  };
}

/**
 * Rebuild the in-memory shape from a stored run or blueprint.
 *
 * ⚠️ Per-step temperature and reasoning effort are NOT recovered — runs record
 * model ids only — so replaying a run uses the recorded models with the models'
 * own defaults, not whatever parameters were configured when it first ran. That
 * is the same information a pre-change run carried, so replay is no worse than
 * before, but it is not a faithful re-execution either.
 */
export function resolvedFromPersisted(models: QuestionGenerationRun['input']['models']): ResolvedStepModels {
  return {
    embedding: models.embedding,
    generator: { model: models.generator },
    validator: { model: models.validator },
    reviewer: { model: models.reviewer },
  };
}
