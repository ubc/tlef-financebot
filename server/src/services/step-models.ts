import { env } from '../config/env';
import type {
  PipelineStep,
  PlatformSettings,
  QuestionGenerationRun,
  StepModelConfig,
} from '../types/domain';

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

/**
 * The temperature a step uses when the admin has NOT set one.
 *
 * The generator runs warm so a batch (`count > 1`) yields DISTINCT questions;
 * every other step wants reproducible output and takes `completeJson`'s 0.
 *
 * ⚠️ This is why the console must not pre-fill a temperature. A step config
 * spreads OVER this default (`{ temperature: DEFAULT, ...step }` in
 * `generateValidQuestion`), so persisting an explicit `0` for the generator —
 * which is what a pre-filled "0" box would save the moment anyone touched it —
 * silently turns batch diversity off and makes all three questions near
 * identical. Absent means "use the step's own default", and that is the only
 * value that keeps this constant meaningful.
 */
export const STEP_TEMPERATURE_DEFAULTS: Readonly<Partial<Record<PipelineStep, number>>> = Object.freeze({
  generator: 0.7,
});

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
 * Runs record model ids only. Per-step parameters (reasoning effort,
 * temperature) are recovered from the CURRENT platform settings when the
 * recorded model id matches the configured one -- see the `settings` param.
 * A run whose model has since been changed in the console runs that model
 * at its own defaults, which is the same information it always carried.
 */
export function resolvedFromPersisted(
  models: QuestionGenerationRun['input']['models'],
  /**
   * The CURRENT platform settings. When a step's recorded model id matches the
   * configured one, that step inherits the admin's configured parameters
   * (reasoning effort, temperature). Found 2026-08-23: without this, every
   * queued run -- the primary path, not a replay -- executed at the model's
   * default effort while the admin console said `high`/`xhigh`, and the
   * regression panel's first baseline was measured at effort `none`.
   */
  settings?: PlatformSettings,
): ResolvedStepModels {
  const step = (recorded: string, configured?: StepModelConfig): StepModelConfig =>
    configured && configured.model === recorded ? { ...configured } : { model: recorded };
  return {
    embedding: models.embedding,
    generator: step(models.generator, settings?.models.generator),
    validator: step(models.validator, settings?.models.validator),
    reviewer: step(models.reviewer, settings?.models.reviewer),
  };
}
