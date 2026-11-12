import { HARDNESS_MOVE_MENU } from './question-generation/generator-prompt';
import { groundingMaterialIds, resolveSecondaryLos, extractMaterialMentions } from './question-generation/grounding';
import { runQuestionGeneration } from './question-generation/pipeline';
export type { RetrievedChunk, GeneratorOutput } from './question-generation/candidate';
export { sanitizeGenerated, verifyGeneratedNumerics } from './question-generation/candidate';
export {
  DIFFICULTY_RUBRIC, HARDNESS_FRAMING, HARDNESS_MOVES, HARDNESS_MOVE_DECLARATION, HARDNESS_MOVE_MENU,
  HARDNESS_MOVE_ASSIGNMENT, GENERATOR_PROMPT,
} from './question-generation/generator-prompt';
export { MAX_SECONDARY_LOS } from './question-generation/grounding';
export { REVIEW_VERDICT_POLICY } from './question-generation/checker-prompt';
import { withModelUsage } from './model-usage.service';
import { ObjectId } from 'mongodb';
import { defineJob, enqueueJob } from '../components/jobs';
import {
  losCol,
  generationBlueprintsCol,
  questionsCol,
  contentRunsCol,
  examBuildRunsCol,
} from '../components/mongodb/collections';
import { getPlatformSettings } from './admin.service';
import { unreleasedThemeIds } from './theme-release';
import {
  persistedModels,
  resolvedFromPersisted,
  stepModelsFrom,
  type ResolvedStepModels,
} from './step-models';
import {
  createQuestionGenerationRun,
  failContentRun,
  getContentRun,
} from './content-runs.service';
import type {
  Difficulty,
  QuestionType,
  QuestionKind,
} from '../types/domain';

// -----------------------------------------------------------------------------
// Generation service (PRD §9.1, IN-Q10): request validation and the queued
// `generation.run` job. The job runs question-generation/pipeline.ts's
// runQuestionGeneration: RETRIEVE grounding chunks once, then for each slot
// GENERATE a question and make ONE checker call — two model calls per question.
// Since 2026-11-12 a question that fails a deterministic check or is rejected
// gets at most ONE repair call (plus its recheck); see pipeline.ts and spec
// 2026-11-12-generation-correctness. Every result — including a checker `reject` —
// is inserted via createQuestion as a **Draft** carrying its agentDecision; the
// pipeline NEVER publishes (PRD §9.1). The instructor sees every generated
// question in the review queue and decides.
//
// Job registration follows the Task 6 boot-crash lesson: NO module-level
// defineJob(). generation.routes.ts imports this service, app.ts mounts that
// router, so a module-level defineJob() would run (via the hoisted CommonJS
// require graph) before startJobs() and crash boot. registerGenerationJobs() is
// called explicitly from server.ts after startJobs().
// -----------------------------------------------------------------------------

export const GENERATION_JOB = 'generation.run';

/** Pre-seeding target per LO (PRD §9.1): highlight LOs below 3 client-side. */
const GENERATION_TARGET = 5;

export const PRESET_PROMPTS: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: 'Calculation question',
    text: 'Create a calculation question that requires students to select and apply the correct finance formula, showing enough information for one unambiguous answer.',
  },
  {
    label: 'Concept check',
    text: 'Create a concise concept check that distinguishes genuine understanding from memorizing a definition.',
  },
  {
    label: 'Common-misconception probe',
    text: 'Create a question whose most plausible distractor exposes a common student misconception, and explain that misconception clearly.',
  },
  {
    label: 'Applied scenario',
    text: 'Create an applied business scenario in which the student must use this learning objective to make or justify a finance decision.',
  },
];

export interface GenerationInput {
  /** Internal deterministic identity for a retry-safe plan cell. */
  runId?: ObjectId;
  courseId: ObjectId;
  loId: ObjectId;
  /** Multi-LO generation: up to MAX_SECONDARY_LOS further objectives every
   * question must genuinely integrate. Their ready assigned materials become
   * the SUPPORTING grounding pool (replacing R7's automatic earlier-objective
   * sweep, at every difficulty), and the created questions are tagged to the
   * primary and every secondary LO (IN-Q13). */
  secondaryLoIds?: ObjectId[];
  count: number;
  type?: QuestionType;
  difficulty?: Difficulty;
  /** Instructor-chosen hardness move (HARDNESS_MOVE_MENU id). Only legal with
   * difficulty 'hard'; absent means the server rotates the menu. */
  hardnessMove?: string;
  /** True when the instructor constrained the materials (blueprint pin or
   * prompt @mention) — the signal R7's widening respects. Distinct from
   * pinnedMaterialIds, which the async job also uses to carry a run's FROZEN
   * resolved set and therefore says nothing about instructor intent. */
  groundingPinned?: boolean;
  /** The kind every question in this run must be (batch planner cells). A
   * candidate of the other kind is recorded as a check finding. */
  kind?: QuestionKind;
  prompt?: string;
  byPuid: string;
  models?: ResolvedStepModels;
  /** Platform flag generationRepair, read when the job runs. Absent means on. */
  repair?: boolean;
  blueprintId?: ObjectId;
  retryOfRunId?: ObjectId;
  pinnedMaterialIds?: ObjectId[];
}

/** Agenda carries only the durable run identity; Mongo owns request details. */
export interface GenerationJobData {
  runId: string;
}

export type { RegenerationVariant } from './question-generation/pipeline';

/** Validate the target synchronously, persist one unique run, then enqueue it. */
export async function enqueueGenerationRun(input: GenerationInput): Promise<ObjectId> {
  if (input.runId) {
    const existing = await getContentRun(input.runId);
    if (existing) {
      if (!existing.courseId.equals(input.courseId) || existing.requestedBy !== input.byPuid) throw new Error('generation-submission-conflict');
      return existing._id;
    }
  }
  const lo = await losCol().findOne({ _id: input.loId });
  if (!lo) throw new Error('lo-not-found');
  if (!lo.courseId.equals(input.courseId)) throw new Error('lo-not-in-course');
  // Secondary objectives are validated here for the same reason as grounding
  // below: a missing LO or one with no ready material is actionable NOW, not
  // as a failed background run.
  const secondary = await resolveSecondaryLos(input.courseId, lo, input.secondaryLoIds);

  // Resolve and freeze grounding before creating the durable run. Previously a
  // request with no ready assigned material was accepted, then failed in the
  // background and left a noisy terminal run in the instructor UI. Enqueue is
  // the actionable boundary: reject here while the caller can still direct the
  // instructor to Course Materials.
  const resolvedMaterialIds = input.pinnedMaterialIds ?? (
    await groundingMaterialIds(input.courseId, lo, input.prompt)
  ).map((id) => new ObjectId(id));
  if (resolvedMaterialIds.length === 0) throw new Error('generation-no-assigned-materials');

  const platformSettings = await getPlatformSettings(input.courseId);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [daily] = await contentRunsCol().aggregate<{ total: number }>([
    { $match: { kind: 'question-generation', createdAt: { $gte: dayStart } } },
    { $group: { _id: null, total: { $sum: '$input.count' } } },
  ]).toArray();
  const examRuns = await examBuildRunsCol().find({ createdAt: { $gte: dayStart }, status: { $ne: 'planned' } }).toArray();
  const examCount = examRuns.reduce((total, run) => total + run.cells.length, 0);
  if ((daily?.total ?? 0) + examCount + input.count > platformSettings.costControls.maxGenerationsPerDay) {
    throw new Error('generation-daily-limit');
  }
  if (input.hardnessMove !== undefined) {
    if (input.difficulty !== 'hard') throw new Error('generation-hardness-move-requires-hard');
    if (!HARDNESS_MOVE_MENU.some((move) => move.id === input.hardnessMove)) {
      throw new Error('generation-unknown-hardness-move');
    }
  }
  const modelSnapshot = input.models ?? stepModelsFrom(platformSettings);
  let run: Awaited<ReturnType<typeof createQuestionGenerationRun>>;
  try {
    run = await createQuestionGenerationRun({
    ...(input.runId ? { runId: input.runId } : {}),
    courseId: input.courseId,
    requestedBy: input.byPuid,
    loId: input.loId,
    ...(secondary.length > 0 ? { secondaryLoIds: secondary.map((entry) => entry.lo._id) } : {}),
    count: input.count,
    type: input.type ?? 'mcq',
    ...(input.difficulty ? { difficulty: input.difficulty } : {}),
    ...(input.hardnessMove ? { hardnessMove: input.hardnessMove } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.blueprintId ? { blueprintId: input.blueprintId } : {}),
    ...(input.retryOfRunId ? { retryOfRunId: input.retryOfRunId } : {}),
    grounding: {
      allowedMaterialIds: resolvedMaterialIds,
      retrievedChunkCount: 0,
      // An explicit pin (blueprint materials) or a prompt @mention is the
      // instructor constraining grounding; plain LO assignment is not.
      pinned: input.groundingPinned ?? (input.pinnedMaterialIds !== undefined || extractMaterialMentions(input.prompt).length > 0),
    },
    models: persistedModels(modelSnapshot),
    modelSnapshot,
  });
  } catch (error) {
    if (input.runId && (error as { code?: number }).code === 11000) return input.runId;
    throw error;
  }
  try {
    await enqueueJob<GenerationJobData>(GENERATION_JOB, { runId: run._id.toHexString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failContentRun(run._id, {
      code: 'content-run-enqueue-failed',
      message,
      atStage: 'queued',
      retryable: true,
    }, run.result);
    throw new Error('content-run-enqueue-failed', { cause: error });
  }
  if (input.blueprintId) {
    try {
      await generationBlueprintsCol().updateOne(
        { _id: input.blueprintId, courseId: input.courseId },
        { $set: { lastRunId: run._id, updatedAt: new Date() } },
      );
    } catch (error) {
      console.warn('[generation] run queued but blueprint lastRunId update failed', error);
    }
  }
  return run._id;
}

/**
 * Per-LO pre-seeding progress (IN-Q10): how many Approved, Reviewed, and other
 * still-actionable questions each LO has, against the target of 5. Read-only.
 *
 * `unapproved` deliberately names the four non-terminal teaching-team states
 * instead of using `$ne: 'approved'`: archived questions must not suppress a
 * new generation request, and a future publication state should not silently
 * change this paid-generation guard's behaviour.
 */
export async function preseedingProgress(
  courseId: ObjectId,
): Promise<
  Array<{
    loId: ObjectId;
    loName: string;
    approved: number;
    reviewed: number;
    unapproved: number;
    /** Of `approved`, how many students cannot see yet because the question
     * is also tagged to a Topic that is not released (theme-release.ts). The
     * coverage page shows it so "3 approved" and "students see 2" do not
     * look like a bug. */
    heldBack: number;
    target: number;
  }>
> {
  const [los, unreleased] = await Promise.all([
    losCol()
      .find({ courseId, archivedAt: { $exists: false } })
      .sort({ order: 1 })
      .toArray(),
    unreleasedThemeIds(courseId),
  ]);
  const unreleasedIds = [...unreleased].map((id) => new ObjectId(id));

  const progress = [];
  for (const lo of los) {
    // Four small counts per LO, awaited in parallel. LO counts are tiny at
    // Phase-1 scale; if this ever matters, one $unwind aggregation collapses it.
    const [approved, reviewed, unapproved, heldBack] = await Promise.all([
      questionsCol().countDocuments({ courseId, loIds: lo._id, state: 'approved' }),
      questionsCol().countDocuments({ courseId, loIds: lo._id, state: 'reviewed' }),
      questionsCol().countDocuments({
        courseId,
        loIds: lo._id,
        state: { $in: ['draft', 'pending-review', 'reviewed', 'paused'] },
      }),
      unreleasedIds.length === 0
        ? Promise.resolve(0)
        : questionsCol().countDocuments({
            courseId, loIds: lo._id, state: 'approved', themeIds: { $in: unreleasedIds },
          }),
    ]);
    progress.push({
      loId: lo._id,
      loName: lo.name,
      approved,
      reviewed,
      unapproved,
      heldBack,
      target: GENERATION_TARGET,
    });
  }
  return progress;
}

/** Registers the `generation.run` job. Called from server.ts AFTER startJobs()
 * — never at module load (see the module header / Task 6 boot-crash lesson). */
export function registerGenerationJobs(): void {
  defineJob<GenerationJobData>(GENERATION_JOB, async ({ runId }) => {
    let id: ObjectId;
    try {
      id = new ObjectId(runId);
    } catch {
      return;
    }
    const run = await getContentRun(id);
    if (!run || run.kind !== 'question-generation' || run.status !== 'queued') return;
    await withModelUsage({ operationId: run.operationId, runId, courseId: run.courseId.toHexString(), actor: { puid: run.requestedBy }, stage: 'generation' }, async () => runQuestionGeneration(
      {
        courseId: run.courseId,
        loId: run.input.loId,
        ...(run.input.secondaryLoIds?.length ? { secondaryLoIds: run.input.secondaryLoIds } : {}),
        count: run.input.count,
        type: run.input.type,
        ...(run.input.difficulty ? { difficulty: run.input.difficulty } : {}),
        ...(run.input.hardnessMove ? { hardnessMove: run.input.hardnessMove } : {}),
        ...(run.input.kind ? { kind: run.input.kind } : {}),
        ...(run.input.prompt !== undefined ? { prompt: run.input.prompt } : {}),
        byPuid: run.requestedBy,
        models: run.input.modelSnapshot ?? resolvedFromPersisted(run.input.models, await getPlatformSettings()),
        repair: (await getPlatformSettings()).featureFlags.generationRepair,
        ...(run.input.blueprintId ? { blueprintId: run.input.blueprintId } : {}),
        ...(run.input.retryOfRunId ? { retryOfRunId: run.input.retryOfRunId } : {}),
        ...(run.grounding?.allowedMaterialIds
          ? { pinnedMaterialIds: run.grounding.allowedMaterialIds }
          : {}),
        // The frozen ids are not an instructor pin; only the recorded flag is.
        ...(run.grounding?.pinned ? { groundingPinned: true } : {}),
      },
      id,
    ));
  });
}
