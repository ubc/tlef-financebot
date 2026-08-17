import { ObjectId } from 'mongodb';
import { completeJson } from '../components/genai/llm';
import { embedOne } from '../components/genai/embeddings';
import { search } from '../components/qdrant';
import { defineJob, enqueueJob } from '../components/jobs';
import {
  losCol,
  materialsCol,
  generationBlueprintsCol,
  questionsCol,
  questionVersionsCol,
  contentRunsCol,
} from '../components/mongodb/collections';
import { env } from '../config/env';
import { createQuestion } from './questions.service';
import { shuffleOptions } from './option-order.service';
import { drawSeed } from './params.service';
import {
  optionValueNamesForVerification,
  verifyQuestionNumerics,
} from './numeric-verification.service';
import { getPlatformSettings } from './admin.service';
import { courseCollection } from './materials.service';
import {
  STEP_TEMPERATURE_DEFAULTS,
  configuredGenerationModels,
  persistedModels,
  resolvedFromPersisted,
  stepModelsFrom,
  type ResolvedStepModels,
} from './step-models';
import {
  createQuestionGenerationRun,
  failContentRun,
  getContentRun,
  updateContentRun,
} from './content-runs.service';
import type {
  Difficulty,
  OptionRole,
  QuestionGenerationFailure,
  QuestionGenerationResult,
  QuestionGenerationRun,
  QuestionOption,
  QuestionType,
  ParamSlot,
  DerivedValue,
  NumericVerification,
  StepModelConfig,
} from '../types/domain';

// -----------------------------------------------------------------------------
// Generation service (PRD §9.1, IN-Q10): the three-agent question pipeline.
// For each requested question: RETRIEVE grounding chunks from the course's
// Qdrant collection -> GENERATOR drafts a question -> structure VALIDATOR checks
// each option's role -> REVIEWER judges it against the five IN-Q05 criteria.
// Each agent runs on its OWN configured model (env.llmModel{Generator,Validator,
// Reviewer}), so the three can be tuned independently (AD-07). Every result —
// including a reviewer `reject` — is inserted via createQuestion as a **Draft**
// carrying its agentDecision; the pipeline NEVER publishes (PRD §9.1). The
// instructor sees every generated question in the review queue and decides.
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

/** Chunks retrieved per question to ground the generator. */
const RETRIEVE_TOP_K = 6;

/** Generator attempts before a structurally-invalid question is skipped. */
const GENERATOR_MAX_ATTEMPTS = 2;

/** The generator runs warm so a batch (count > 1) yields DISTINCT questions —
 * completeJson defaults to temperature 0, which would make every question in
 * the batch identical. The validator and reviewer stay deterministic (the
 * completeJson default).
 *
 * Lives in `step-models` so the admin console can show it as the generator's
 * effective default instead of pre-filling a `0` that would override it. */
const GENERATOR_TEMPERATURE = STEP_TEMPERATURE_DEFAULTS.generator;

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

const OPTION_ROLES: ReadonlySet<OptionRole> = new Set<OptionRole>([
  'correct',
  'common-misconception',
  'partially-correct',
  'clearly-wrong',
]);
const DIFFICULTIES: ReadonlySet<Difficulty> = new Set<Difficulty>(['easy', 'medium', 'hard']);
const DECISIONS = new Set(['pass', 'flag', 'reject']);

export interface GenerationInput {
  courseId: ObjectId;
  loId: ObjectId;
  count: number;
  type?: QuestionType;
  difficulty?: Difficulty;
  prompt?: string;
  byPuid: string;
  models?: ResolvedStepModels;
  blueprintId?: ObjectId;
  retryOfRunId?: ObjectId;
  pinnedMaterialIds?: ObjectId[];
}

/** Agenda carries only the durable run identity; Mongo owns request details. */
export interface GenerationJobData {
  runId: string;
}

interface RetrievedChunk {
  materialId?: string;
  text: string;
}
interface RetrievedGrounding {
  chunks: RetrievedChunk[];
  allowedMaterialIds: string[];
}
interface GeneratorOutput {
  stem: string;
  options: QuestionOption[];
  difficulty?: string;
  // Parameterization (design spec 2026-08-05). A numerical question states no
  // numbers: it declares its inputs as `paramSlots` and every displayed value
  // — the correct answer and each distractor — as a `derivedValues` formula.
  numericKind?: 'numeric' | 'conceptual';
  paramSlots?: ParamSlot[];
  derivedValues?: DerivedValue[];
}
interface ValidatorOutput {
  roleAssessment: string;
}
interface ReviewerOutput {
  decision: string;
  reasoning: string;
}

export interface RegenerationVariant {
  stem: string;
  options: QuestionOption[];
  difficulty: Difficulty;
  numericKind?: 'numeric' | 'conceptual';
  paramSlots?: ParamSlot[];
  derivedValues?: DerivedValue[];
  verification?: NumericVerification;
  sourceRefs: Array<{ materialId: ObjectId; chunk?: string }>;
  agentDecision: {
    decision: 'pass' | 'flag' | 'reject';
    reasoning: string;
    roleAssessment: string;
  };
}

/** Validate the target synchronously, persist one unique run, then enqueue it. */
export async function enqueueGenerationRun(input: GenerationInput): Promise<ObjectId> {
  const lo = await losCol().findOne({ _id: input.loId });
  if (!lo) throw new Error('lo-not-found');
  if (!lo.courseId.equals(input.courseId)) throw new Error('lo-not-in-course');

  // Resolve and freeze grounding before creating the durable run. Previously a
  // request with no ready assigned material was accepted, then failed in the
  // background and left a noisy terminal run in the instructor UI. Enqueue is
  // the actionable boundary: reject here while the caller can still direct the
  // instructor to Course Materials.
  const resolvedMaterialIds = input.pinnedMaterialIds ?? (
    await groundingMaterialIds(input.courseId, lo, input.prompt)
  ).map((id) => new ObjectId(id));
  if (resolvedMaterialIds.length === 0) throw new Error('generation-no-assigned-materials');

  const platformSettings = await getPlatformSettings();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [daily] = await contentRunsCol().aggregate<{ total: number }>([
    { $match: { kind: 'question-generation', createdAt: { $gte: dayStart } } },
    { $group: { _id: null, total: { $sum: '$input.count' } } },
  ]).toArray();
  if ((daily?.total ?? 0) + input.count > platformSettings.costControls.maxGenerationsPerDay) {
    throw new Error('generation-daily-limit');
  }
  const run = await createQuestionGenerationRun({
    courseId: input.courseId,
    requestedBy: input.byPuid,
    loId: input.loId,
    count: input.count,
    type: input.type ?? 'mcq',
    ...(input.difficulty ? { difficulty: input.difficulty } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(input.blueprintId ? { blueprintId: input.blueprintId } : {}),
    ...(input.retryOfRunId ? { retryOfRunId: input.retryOfRunId } : {}),
    grounding: {
      allowedMaterialIds: resolvedMaterialIds,
      retrievedChunkCount: 0,
    },
    models: persistedModels(input.models ?? stepModelsFrom(platformSettings)),
  });
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
 * The three-agent pipeline. Returns the ids of the questions actually inserted
 * (a question skipped for repeatedly-invalid options is not counted). Always
 * inserts as Draft — never publishes.
 */
export async function runGenerationPipeline(input: GenerationInput): Promise<ObjectId[]> {
  const { courseId, loId, count, prompt, byPuid } = input;
  const type: QuestionType = input.type ?? 'mcq';
  const platformSettings = await getPlatformSettings();
  const models = input.models ?? stepModelsFrom(platformSettings);

  const lo = await losCol().findOne({ _id: loId });
  if (!lo) throw new Error('lo-not-found');
  // The route guards courseId (path) but loId comes from the body — refuse to
  // generate this course's Draft questions against another course's LO, which
  // would tag them with a foreign loId/themeId.
  if (!lo.courseId.equals(courseId)) throw new Error('lo-not-in-course');

  const collection = courseCollection(courseId);
  const created: ObjectId[] = [];

  // Retrieve once: every question in this batch targets the same LO/prompt, so
  // the grounding query is identical. Variety across the batch comes from the
  // warm generator (GENERATOR_TEMPERATURE), not from re-retrieving.
  const { chunks } = await retrieveChunks(collection, courseId, lo, prompt);

  for (let i = 0; i < count; i += 1) {
    const generated = await generateValidQuestion(type, lo.name, input.difficulty, prompt, chunks, models.generator);
    if (!generated) {
      console.warn(
        `[generation] skipped a question for LO ${loId.toHexString()} after ` +
          `${GENERATOR_MAX_ATTEMPTS} invalid-option attempts`,
      );
      continue;
    }

    // Verified BEFORE the review, not after, so the reviewer can be told what
    // the deterministic verifier already decided. Pure and cheap; the ordering
    // is the only thing that changed.
    const numerics = verifyGeneratedNumerics(generated);

    // Validator and reviewer each run on their own model. Structure validation
    // first (per-role assessment), then the IN-Q05 review decision.
    const validation = await completeJson<ValidatorOutput>(
      VALIDATOR_PROMPT({ loName: lo.name, question: generated, chunks }),
      { ...models.validator },
    );
    const review = platformSettings.featureFlags.reviewerAgent
      ? await completeJson<ReviewerOutput>(
          REVIEWER_PROMPT({
            loName: lo.name,
            question: generated,
            chunks,
            ...(numerics.failure ? { verificationFailure: numerics.failure } : {}),
          }),
          { ...models.reviewer },
        )
      : { decision: 'flag', reasoning: 'Reviewer agent disabled at generation time.' };

    const sourceRefs = chunks
      .filter((chunk) => chunk.materialId)
      .map((chunk) => ({ materialId: new ObjectId(chunk.materialId), chunk: chunk.text }));

    try {
      const { questionId } = await createQuestion({
        courseId,
        loIds: [loId],
        themeIds: [lo.themeId],
        type,
        stem: generated.stem,
        options: generated.options,
        // Already shuffled in generateValidQuestion, upstream of the validator
        // and reviewer whose prose names the resulting letters.
        optionsAlreadyShuffled: true,
        difficulty: normalizeDifficulty(input.difficulty ?? generated.difficulty),
        sourceRefs,
        createdBy: byPuid,
        ...(prompt !== undefined ? { generationPrompt: prompt } : {}),
        ...numerics.fields,
        agentDecision: {
          decision: normalizeDecision(review.decision),
          reasoning: withVerificationNote(String(review.reasoning ?? ''), numerics.failure),
          roleAssessment: String(validation.roleAssessment ?? ''),
        },
      });
      created.push(questionId);
    } catch (err) {
      // createQuestion re-asserts the option invariants — it is the
      // authoritative guard. optionShapeValid already pre-checked, so reaching
      // here means the two diverged on some edge; log + skip this one question
      // rather than fail the whole batch. Any OTHER error propagates.
      if (err instanceof Error && err.message.startsWith('invalid-options:')) {
        console.warn(`[generation] createQuestion rejected generated options: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  return created;
}

/**
 * Generate one alternative for an existing question without creating a
 * QuestionVersion or changing the current version pointer. The only persisted
 * mutation is append-only request provenance on the Question head. The caller
 * must explicitly use editQuestion() to replace content after reviewing the
 * returned side-by-side variant.
 */
export async function regenerateQuestion(
  questionId: ObjectId,
  prompt: string,
  _byPuid: string,
  expectedCourseId?: ObjectId,
): Promise<{ variant: RegenerationVariant }> {
  const question = await questionsCol().findOne({ _id: questionId });
  if (!question) throw new Error('question-not-found');
  if (expectedCourseId && !question.courseId.equals(expectedCourseId)) {
    throw new Error('question-not-found');
  }
  const current = await questionVersionsCol().findOne({ _id: question.currentVersionId });
  if (!current) throw new Error('version-not-found');
  const loId = question.loIds[0];
  if (!loId) throw new Error('question-has-no-lo');
  const lo = await losCol().findOne({ _id: loId });
  if (!lo || !lo.courseId.equals(question.courseId)) throw new Error('lo-not-in-course');
  const platformSettings = await getPlatformSettings();

  const grounding = await retrieveChunks(
    courseCollection(question.courseId),
    question.courseId,
    lo,
    prompt,
  );
  const generationInstruction = [
    prompt,
    'Create a distinct alternative to the existing question below. Preserve the learning objective but do not merely paraphrase.',
    `Existing question: ${JSON.stringify({ stem: current.stem, options: current.options })}`,
  ].join('\n\n');
  const generated = await generateValidQuestion(
    current.type,
    lo.name,
    current.difficulty,
    generationInstruction,
    grounding.chunks,
    platformSettings.models.generator,
  );
  if (!generated) throw new Error('generation-invalid-options');

  // Verified before the review so the reviewer sees the verifier's verdict.
  const numerics = verifyGeneratedNumerics(generated);
  const validation = await completeJson<ValidatorOutput>(
    VALIDATOR_PROMPT({ loName: lo.name, question: generated, chunks: grounding.chunks }),
    { ...platformSettings.models.validator },
  );
  const review = platformSettings.featureFlags.reviewerAgent
    ? await completeJson<ReviewerOutput>(
        REVIEWER_PROMPT({
          loName: lo.name,
          question: generated,
          chunks: grounding.chunks,
          ...(numerics.failure ? { verificationFailure: numerics.failure } : {}),
        }),
        { ...platformSettings.models.reviewer },
      )
    : { decision: 'flag', reasoning: 'Reviewer agent disabled at generation time.' };
  const variant: RegenerationVariant = {
    stem: generated.stem,
    options: generated.options,
    difficulty: normalizeDifficulty(generated.difficulty ?? current.difficulty),
    ...numerics.fields,
    // A conceptual replacement must actively clear formulas inherited from a
    // previously numerical version; omitted fields would otherwise survive
    // editQuestion's copy-on-write spread.
    paramSlots: numerics.fields.paramSlots ?? [],
    derivedValues: numerics.fields.derivedValues ?? [],
    sourceRefs: grounding.chunks
      .filter((chunk) => chunk.materialId)
      .map((chunk) => ({ materialId: new ObjectId(chunk.materialId), chunk: chunk.text })),
    agentDecision: {
      decision: normalizeDecision(review.decision),
      reasoning: withVerificationNote(String(review.reasoning ?? ''), numerics.failure),
      roleAssessment: String(validation.roleAssessment ?? ''),
    },
  };

  const now = new Date();
  const update = await questionsCol().updateOne(
    { _id: questionId, currentVersionId: question.currentVersionId },
    {
      $push: { regenerations: { prompt, at: now } },
      $set: { updatedAt: now },
    },
  );
  if (update.matchedCount !== 1) throw new Error('question-changed-during-regeneration');
  return { variant };
}

interface TrackedCandidate {
  item: number;
  generated: GeneratorOutput;
  validation?: ValidatorOutput;
  review?: ReviewerOutput;
}

function generationFailure(
  item: number,
  stage: QuestionGenerationFailure['stage'],
  error: unknown,
  fallbackCode: string,
): QuestionGenerationFailure {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = message.split(':')[0];
  return {
    item,
    stage,
    code: /^[a-z0-9-]+$/.test(prefix) ? prefix : fallbackCode,
    message,
  };
}

/** Production job path: durable stages plus per-item partial-success semantics. */
async function runTrackedGenerationPipeline(input: GenerationInput, runId: ObjectId): Promise<ObjectId[]> {
  const { courseId, loId, count, prompt, byPuid } = input;
  const type: QuestionType = input.type ?? 'mcq';
  const models = input.models ?? configuredGenerationModels();
  const platformSettings = await getPlatformSettings();
  const result: QuestionGenerationResult = { createdQuestionIds: [], failures: [] };
  let stage: QuestionGenerationRun['stage'] = 'retrieving';

  try {
    await updateContentRun(runId, { status: 'running', stage, message: 'Retrieving assigned course material' });
    const lo = await losCol().findOne({ _id: loId });
    if (!lo) throw new Error('lo-not-found');
    if (!lo.courseId.equals(courseId)) throw new Error('lo-not-in-course');

    const allowedMaterialIds = input.pinnedMaterialIds?.map((id) => id.toHexString())
      ?? (await groundingMaterialIds(courseId, lo, prompt));
    if (allowedMaterialIds.length === 0) throw new Error('generation-no-assigned-materials');
    await updateContentRun(runId, {
      status: 'running',
      stage,
      grounding: {
        allowedMaterialIds: allowedMaterialIds.map((id) => new ObjectId(id)),
        retrievedChunkCount: 0,
      },
      result,
      message: `Pinned ${allowedMaterialIds.length} assigned material${allowedMaterialIds.length === 1 ? '' : 's'}`,
    });
    const grounding = await retrieveChunks(courseCollection(courseId), courseId, lo, prompt, allowedMaterialIds);
    const chunks = grounding.chunks;
    stage = 'generating';
    await updateContentRun(runId, {
      status: 'running',
      stage,
      grounding: {
        allowedMaterialIds: grounding.allowedMaterialIds.map((id) => new ObjectId(id)),
        retrievedChunkCount: chunks.length,
      },
      result,
      message: `Retrieved ${chunks.length} grounded chunks`,
    });

    const generated: TrackedCandidate[] = [];
    for (let item = 0; item < count; item += 1) {
      try {
        const candidate = await generateValidQuestion(type, lo.name, input.difficulty, prompt, chunks, models.generator);
        if (!candidate) throw new Error('generation-invalid-options');
        generated.push({ item, generated: candidate });
        await updateContentRun(runId, {
          status: 'running',
          stage,
          completedUnits: result.failures.length,
          result,
          message: `Generated candidate ${item + 1} of ${count}`,
        });
      } catch (error) {
        result.failures.push(generationFailure(item, 'generating', error, 'generation-item-failed'));
        await updateContentRun(runId, {
          status: 'running',
          stage,
          completedUnits: result.failures.length,
          result,
          message: `Candidate ${item + 1} failed during generation`,
        });
      }
    }

    stage = 'validating';
    await updateContentRun(runId, {
      status: 'running',
      stage,
      completedUnits: result.failures.length,
      result,
      message: `Validating ${generated.length} candidates`,
    });
    const validated: TrackedCandidate[] = [];
    for (const candidate of generated) {
      try {
        candidate.validation = await completeJson<ValidatorOutput>(
          VALIDATOR_PROMPT({ loName: lo.name, question: candidate.generated, chunks }),
          { ...models.validator },
        );
        validated.push(candidate);
      } catch (error) {
        result.failures.push(generationFailure(candidate.item, 'validating', error, 'generation-validation-failed'));
      }
      await updateContentRun(runId, {
        status: 'running',
        stage,
        completedUnits: result.failures.length,
        result,
        message: `Validated candidate ${candidate.item + 1}`,
      });
    }

    stage = 'reviewing';
    await updateContentRun(runId, {
      status: 'running',
      stage,
      completedUnits: result.failures.length,
      result,
      message: `Reviewing ${validated.length} candidates`,
    });
    const reviewed: TrackedCandidate[] = [];
    for (const candidate of validated) {
      try {
        // Verified here as well as at persistence below. The two calls answer
        // different questions — this one decides what to TELL the reviewer, the
        // later one decides what to STORE — and the function is pure, so the
        // repeat costs nothing but keeps the reviewer from guessing.
        const candidateNumerics = verifyGeneratedNumerics(candidate.generated);
        candidate.review = platformSettings.featureFlags.reviewerAgent
          ? await completeJson<ReviewerOutput>(
              REVIEWER_PROMPT({
                loName: lo.name,
                question: candidate.generated,
                chunks,
                ...(candidateNumerics.failure ? { verificationFailure: candidateNumerics.failure } : {}),
              }),
              { ...models.reviewer },
            )
          : { decision: 'flag', reasoning: 'Reviewer agent disabled at generation time.' };
        reviewed.push(candidate);
      } catch (error) {
        result.failures.push(generationFailure(candidate.item, 'reviewing', error, 'generation-review-failed'));
      }
      await updateContentRun(runId, {
        status: 'running',
        stage,
        completedUnits: result.failures.length,
        result,
        message: `Reviewed candidate ${candidate.item + 1}`,
      });
    }

    stage = 'persisting';
    await updateContentRun(runId, {
      status: 'running',
      stage,
      completedUnits: result.failures.length,
      result,
      message: `Saving ${reviewed.length} Draft questions`,
    });
    const sourceRefs = chunks
      .filter((chunk) => chunk.materialId)
      .map((chunk) => ({ materialId: new ObjectId(chunk.materialId), chunk: chunk.text }));
    for (const candidate of reviewed) {
      // This is the REGENERATION path — the one the 2026-08-05 tester used when
      // they reported "I regenerated the numerical question and the numerical
      // answer was still incorrect". It needs the same verification as the
      // first-pass path above, or regenerating would launder an unverified
      // question into the bank.
      const numerics = verifyGeneratedNumerics(candidate.generated);
      try {
        const { questionId } = await createQuestion({
          courseId,
          loIds: [loId],
          themeIds: [lo.themeId],
          type,
          stem: candidate.generated.stem,
          options: candidate.generated.options,
          // Already shuffled in generateValidQuestion, upstream of the validator
          // and reviewer whose prose names the resulting letters.
          optionsAlreadyShuffled: true,
          difficulty: normalizeDifficulty(input.difficulty ?? candidate.generated.difficulty),
          sourceRefs,
          createdBy: byPuid,
          provenance: {
            kind: 'generated',
            runId,
            ...(input.blueprintId ? { blueprintId: input.blueprintId } : {}),
            item: candidate.item,
          },
          ...(prompt !== undefined ? { generationPrompt: prompt } : {}),
          ...numerics.fields,
          agentDecision: {
            decision: normalizeDecision(candidate.review?.decision),
            reasoning: withVerificationNote(String(candidate.review?.reasoning ?? ''), numerics.failure),
            roleAssessment: String(candidate.validation?.roleAssessment ?? ''),
          },
        });
        result.createdQuestionIds.push(questionId);
      } catch (error) {
        result.failures.push(generationFailure(candidate.item, 'persisting', error, 'generation-persist-failed'));
      }
      await updateContentRun(runId, {
        status: 'running',
        stage,
        completedUnits: result.createdQuestionIds.length + result.failures.length,
        result,
        message: `Processed candidate ${candidate.item + 1}`,
      });
    }

    if (result.createdQuestionIds.length === 0) {
      await failContentRun(
        runId,
        {
          code: 'generation-no-questions-created',
          message: 'No Draft questions could be created from this run.',
          atStage: stage,
          retryable: true,
        },
        result,
      );
      return [];
    }

    const status = result.createdQuestionIds.length === count ? 'completed' : 'partial';
    await updateContentRun(runId, {
      status,
      stage,
      completedUnits: count,
      result,
      message:
        status === 'completed'
          ? `Created ${result.createdQuestionIds.length} Draft questions`
          : `Created ${result.createdQuestionIds.length} of ${count} Draft questions`,
    });
    return result.createdQuestionIds;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'content-run-conflict') return result.createdQuestionIds;
    await failContentRun(
      runId,
      {
        code: /^[a-z0-9-]+$/.test(message) ? message : 'generation-run-failed',
        message,
        atStage: stage,
        retryable: true,
      },
      result,
    );
    return result.createdQuestionIds;
  }
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
    target: number;
  }>
> {
  const los = await losCol()
    .find({ courseId, archivedAt: { $exists: false } })
    .sort({ order: 1 })
    .toArray();

  const progress = [];
  for (const lo of los) {
    // Three small counts per LO, awaited in parallel. LO counts are tiny at
    // Phase-1 scale; if this ever matters, one $unwind aggregation collapses it.
    const [approved, reviewed, unapproved] = await Promise.all([
      questionsCol().countDocuments({ courseId, loIds: lo._id, state: 'approved' }),
      questionsCol().countDocuments({ courseId, loIds: lo._id, state: 'reviewed' }),
      questionsCol().countDocuments({
        courseId,
        loIds: lo._id,
        state: { $in: ['draft', 'pending-review', 'reviewed', 'paused'] },
      }),
    ]);
    progress.push({
      loId: lo._id,
      loName: lo.name,
      approved,
      reviewed,
      unapproved,
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
    await runTrackedGenerationPipeline(
      {
        courseId: run.courseId,
        loId: run.input.loId,
        count: run.input.count,
        type: run.input.type,
        ...(run.input.difficulty ? { difficulty: run.input.difficulty } : {}),
        ...(run.input.prompt !== undefined ? { prompt: run.input.prompt } : {}),
        byPuid: run.requestedBy,
        models: resolvedFromPersisted(run.input.models),
        ...(run.input.blueprintId ? { blueprintId: run.input.blueprintId } : {}),
        ...(run.input.retryOfRunId ? { retryOfRunId: run.input.retryOfRunId } : {}),
        ...(run.grounding?.allowedMaterialIds
          ? { pinnedMaterialIds: run.grounding.allowedMaterialIds }
          : {}),
      },
      id,
    );
  });
}

// --- Internals ---------------------------------------------------------------

/** Ready materials assigned directly to the LO, plus Theme-wide materials
 * whose assignment has no narrower loId. Other course materials are forbidden
 * grounding even when their vector score is higher. */
async function groundingMaterialIds(
  courseId: ObjectId,
  lo: { _id: ObjectId; themeId: ObjectId },
  prompt?: string,
): Promise<string[]> {
  const materials = await materialsCol()
    .find({ courseId, status: 'ready', deletedAt: { $exists: false } })
    .toArray();
  const assigned = materials.filter((material) =>
    material.assignments.some(
      (assignment) =>
        assignment.loId?.equals(lo._id) === true ||
        (assignment.loId === undefined && assignment.themeId.equals(lo.themeId)),
    ),
  );
  const mentions = extractMaterialMentions(prompt);
  if (mentions.length === 0) return assigned.map((material) => material._id.toHexString());

  const selected: string[] = [];
  for (const mention of mentions) {
    const matches = assigned.filter(
      (material) => normalizeMaterialName(material.name) === normalizeMaterialName(mention),
    );
    if (matches.length === 0) throw new Error('generation-material-mention-not-found');
    if (matches.length > 1) throw new Error('generation-material-mention-ambiguous');
    const id = matches[0]._id.toHexString();
    if (!selected.includes(id)) selected.push(id);
  }
  return selected;
}

function normalizeMaterialName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-CA');
}

/** Supports @lecture-3.pdf and quoted names such as @"Lecture 3.pdf". */
function extractMaterialMentions(prompt?: string): string[] {
  if (!prompt) return [];
  const mentions: string[] = [];
  const pattern = /@"([^"\r\n]+)"|@([^\s@"']+)/g;
  for (const match of prompt.matchAll(pattern)) {
    const name = (match[1] ?? match[2] ?? '').replace(/[),;:!?\]}]+$/u, '');
    if (name && !mentions.includes(name)) mentions.push(name);
  }
  return mentions;
}

/** Retrieve strictly assigned grounding chunks. Missing assignments, a Qdrant
 * failure, or zero usable hits is a visible service failure: never fall back to
 * generating from the LO name or general model knowledge. */
async function retrieveChunks(
  collection: string,
  courseId: ObjectId,
  lo: { _id: ObjectId; themeId: ObjectId; name: string },
  prompt?: string,
  pinnedMaterialIds?: string[],
): Promise<RetrievedGrounding> {
  const allowedMaterialIds = pinnedMaterialIds ?? (await groundingMaterialIds(courseId, lo, prompt));
  if (allowedMaterialIds.length === 0) throw new Error('generation-no-assigned-materials');

  const query = prompt ? `${lo.name}\n${prompt}` : lo.name;
  const vector = await embedOne(query);
  let hits;
  try {
    hits = await search(collection, vector, RETRIEVE_TOP_K, {
      must: [{ key: 'materialId', match: { any: allowedMaterialIds } }],
    });
  } catch (err) {
    console.warn(
      `[generation] assigned-material retrieval failed for ${collection}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    throw new Error('generation-retrieval-failed', { cause: err });
  }
  const allowed = new Set(allowedMaterialIds);
  const chunks = hits
    .map((hit) => ({
      materialId: typeof hit.payload?.materialId === 'string' ? hit.payload.materialId : undefined,
      text: typeof hit.payload?.chunk === 'string' ? hit.payload.chunk : '',
    }))
    // Defense in depth: Qdrant should enforce the filter, but never trust a
    // malformed/stale hit enough to write a forbidden sourceRef.
    .filter((chunk) => chunk.materialId !== undefined && allowed.has(chunk.materialId) && chunk.text.length > 0);
  if (chunks.length === 0) throw new Error('generation-no-grounding');
  return { chunks, allowedMaterialIds };
}

/** Run the generator, retrying once if the produced options don't satisfy the
 * structural invariants. Returns null when it fails both attempts. */
async function generateValidQuestion(
  type: QuestionType,
  loName: string,
  difficulty: Difficulty | undefined,
  prompt: string | undefined,
  chunks: RetrievedChunk[],
  step: StepModelConfig = { model: env.llmModelGenerator },
): Promise<GeneratorOutput | null> {
  /** The last structurally-valid candidate, returned unproven if attempts run out. */
  let lastValid: GeneratorOutput | null = null;
  /** The verifier's own sentence about the previous attempt, quoted back on retry. */
  let lastFailure: string | undefined;

  for (let attempt = 1; attempt <= GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const basePrompt = GENERATOR_PROMPT({ type, loName, difficulty, prompt, chunks });
    const candidate = await completeJson<GeneratorOutput>(
      lastFailure ? `${basePrompt}\n\n${RETRY_FEEDBACK(lastFailure)}` : basePrompt,
      // GENERATOR_TEMPERATURE is the default, not an override: an admin who sets
      // a temperature for this step means it, and one who sets a reasoning
      // effort has knowingly given the temperature up (it is only legal at
      // effort `none`), so passing it anyway would be dropped either way.
      { temperature: GENERATOR_TEMPERATURE, ...step },
    );
    if (
      candidate &&
      optionShapeValid(type, candidate.options) &&
      errorModelsNameMistakes(candidate)
    ) {
      const clean = sanitizeGenerated(candidate);
      // Shuffled HERE, not in createQuestion, for the same reason
      // sanitizeGenerated is here: this is the one point every generator output
      // passes through. It has to be upstream of the validator and the reviewer
      // specifically, because both of them cite options by LETTER
      // ("Option C (clearly-wrong)..."). Shuffling downstream of them —
      // observed on run 6a7e9b9f0dbc47057d634fdc — reassigns every key after
      // the prose is written, so an instructor reads a review that names the
      // wrong option. Callers pass optionsAlreadyShuffled so createQuestion
      // does not shuffle a second time and undo this alignment.
      const shaped = type === 'mcq' ? { ...clean, options: shuffleOptions(clean.options, drawSeed()) } : clean;

      // Verify INSIDE the loop, so a collision gets another attempt with the
      // reason attached. Previously verification ran only in the caller, after
      // generation had finished: a question whose distractors coincide was
      // never retried and the model was never told what was wrong. Measured
      // 2026-08-16, that single fault accounted for 5 of 6 unservable questions,
      // and three separate attempts to prevent it by prompt wording all failed
      // (docs/prompt-engineering-tests.md). Telling the model the specific
      // failure is the thing that had never been tried.
      const verification = verifyGeneratedNumerics(shaped);
      if (!verification.failure) return shaped;

      // Keep it anyway. A question that cannot earn a proof is still persisted
      // as a Draft today so the instructor can widen a range and rescue it;
      // discarding it here would be a behaviour change that removes that
      // option and silently lowers the count a run reports.
      lastValid = shaped;
      lastFailure = verification.failure;
      console.warn(
        `[generation] verification failed (attempt ${attempt}/${GENERATOR_MAX_ATTEMPTS}): ` +
          verification.failure,
      );
      continue;
    }
    // A shape failure carries no specific diagnosis worth quoting back, and the
    // previous verification note would be about a candidate this attempt has
    // already replaced.
    lastFailure = undefined;
    console.warn(
      `[generation] generator produced structurally-invalid options ` +
        `(attempt ${attempt}/${GENERATOR_MAX_ATTEMPTS})`,
    );
  }
  return lastValid;
}

/**
 * What the generator is told after the deterministic verifier rejects an
 * attempt. Quotes the verifier's own sentence rather than paraphrasing it: the
 * evaluator already names the two colliding values and the seed, and that
 * specificity is the entire point — the general rule is in GENERATOR_PROMPT
 * already and the model follows it while still colliding.
 */
export function RETRY_FEEDBACK(failure: string): string {
  return [
    'YOUR PREVIOUS ATTEMPT WAS REJECTED by the deterministic verifier that decides',
    'whether a question can be served at all:',
    `  "${failure}"`,
    'This is not a style note. A question that fails this check can never reach a',
    'student, however good it reads. Fix THAT fault specifically.',
    'If two option values came out identical, they are identical either as',
    'expressions — "RF + (M - RF)" is just "M", whatever the draw — or at some draw',
    'the ranges permit. So either change one distractor to a different mistake, or',
    'move the slot range so the coinciding draw cannot occur, and list the draws to',
    'check it rather than trusting the bounds. Do not resubmit the same formulas.',
  ].join('\n');
}

/**
 * Strips C0/C7 control characters from generated display text.
 *
 * The generator intermittently emits a stray control character mid-word —
 * `\text{DISC<U+0002>PCT}` in a stem on 2026-08-13, then a U+001D inside an
 * explanation on the next run. They survive `JSON.parse` (the model emits them
 * as `\uXXXX` escapes), are invisible in logs and in the DB shell, and kill the
 * KaTeX span they land in. Prompt guidance did NOT stop it recurring, so this
 * is deterministic rather than advisory, and sits at the one place every
 * generator output passes through.
 *
 * Tab and newline are deliberately kept: explanations legitimately use them.
 */
function stripControlChars(text: string): string {
  // A code-point filter rather than a regex: a character class covering C0
  // would have to contain literal control characters, which are invisible in
  // the source and do not survive most editors intact.
  return [...String(text)]
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      const isC0 = cp < 0x20 && cp !== 0x09 && cp !== 0x0a;
      return !isC0 && cp !== 0x7f;
    })
    .join('');
}

/** Applied only after optionShapeValid, which guarantees the string fields. */
function sanitizeGenerated(candidate: GeneratorOutput): GeneratorOutput {
  return {
    ...candidate,
    stem: stripControlChars(candidate.stem),
    options: candidate.options.map((option) => ({
      ...option,
      text: stripControlChars(option.text),
      explanation: stripControlChars(option.explanation),
    })),
  };
}

/** Structural pre-check before spending validator/reviewer calls. createQuestion
 * remains the authoritative invariant guard (defense in depth). */
function optionShapeValid(type: QuestionType, options: unknown): boolean {
  const expected = type === 'mcq' ? 4 : 2;
  if (!Array.isArray(options) || options.length !== expected) return false;
  const correct = options.filter((o) => o && (o as QuestionOption).role === 'correct');
  if (correct.length !== 1) return false;
  // An MCQ must carry at least one common-misconception. This is not a style
  // rule: decideStrategy (attempts.service.ts) applies Strategy A ONLY when the
  // student picks a common-misconception, so an MCQ without one silently opts
  // out of the retry gate and is Strategy B in every case. A real generation on
  // 2026-08-14 produced correct/clearly-wrong/clearly-wrong/partially-correct
  // and nothing noticed. True/False needs no check — assertOptionInvariants
  // coerces its single wrong option to common-misconception by design.
  if (type === 'mcq') {
    const misconceptions = options.filter(
      (o) => o && (o as QuestionOption).role === 'common-misconception',
    );
    if (misconceptions.length === 0) return false;
  }
  return options.every((o) => {
    const opt = o as QuestionOption;
    return (
      o &&
      typeof opt.key === 'string' &&
      typeof opt.text === 'string' &&
      typeof opt.explanation === 'string' &&
      OPTION_ROLES.has(opt.role)
    );
  });
}

/**
 * An `errorModel` must name the MISTAKE, not restate the option's role. A real
 * generation returned `errorModel: "common-misconception"` on every distractor,
 * which is the field's whole value thrown away — the reviewer and the
 * instructor both read it to judge whether a distractor is honest.
 *
 * Deliberately narrow: only an errorModel that is NOTHING BUT a role name is
 * rejected. `"common-misconception: inverting the multiple"` is noisy but does
 * name the mistake, so it passes. Checked here rather than in
 * verifyGeneratedNumerics because a failure there denies the proof and the
 * question can never serve — disproportionate for a metadata wording problem.
 * A retry is the proportionate response.
 */
function errorModelsNameMistakes(candidate: GeneratorOutput): boolean {
  return (candidate.derivedValues ?? []).every((derived) => {
    const model = String(derived.errorModel ?? '').trim().toLowerCase();
    if (model === '') return true; // absent is the CORRECT value's contract
    return !OPTION_ROLES.has(model as QuestionOption['role']);
  });
}

function normalizeDifficulty(value: unknown): Difficulty {
  return typeof value === 'string' && DIFFICULTIES.has(value as Difficulty) ? (value as Difficulty) : 'medium';
}

function normalizeDecision(value: unknown): 'pass' | 'flag' | 'reject' {
  // Default to 'flag' when the reviewer returns something unexpected: surface it
  // for a human rather than silently 'pass'.
  return typeof value === 'string' && DECISIONS.has(value) ? (value as 'pass' | 'flag' | 'reject') : 'flag';
}

// --- Prompts (exported so Phase 4 content QA can tune them independently) -----

function renderChunks(chunks: RetrievedChunk[]): string {
  return chunks.map((chunk, i) => `[${i + 1}] ${chunk.text}`).join('\n\n');
}

export function GENERATOR_PROMPT(params: {
  type: QuestionType;
  loName: string;
  difficulty?: Difficulty;
  prompt?: string;
  chunks: RetrievedChunk[];
}): string {
  const optionCount = params.type === 'mcq' ? 4 : 2;
  const difficultyGuidance = params.difficulty === 'easy'
    ? 'Easy means one direct recall or one-step application with no irrelevant information.'
    : params.difficulty === 'medium'
      ? 'Medium means the student must choose or connect concepts, interpret a scenario, or complete more than one reasoning step; a direct formula substitution is too easy.'
      : params.difficulty === 'hard'
        ? 'Hard means multi-step synthesis, comparison, or transfer to an unfamiliar scenario; it must remain solvable from the supplied material.'
        : '';
  return [
    `You are an expert finance instructor writing ONE ${params.type === 'mcq' ? 'multiple-choice' : 'true/false'} practice question`,
    `for the learning objective: "${params.loName}".`,
    params.difficulty ? `Target difficulty: ${params.difficulty}.` : '',
    difficultyGuidance,
    // Measured 2026-08-16: TWELVE OF TWELVE generated questions came back
    // labelled `medium` while the reviewer judged every one of them a one-step
    // substitution. The rule above already said that is too easy — the model was
    // not breaking it so much as echoing the target back as a label. So the fix
    // is not restating the standard, it is asking for a self-assessment.
    'The "difficulty" you RETURN must describe the question you actually wrote, not the',
    'target you were given. Grade your own question honestly: if the stem supplies the',
    'formula and the student performs one substitution, that is "easy" however large the',
    'arithmetic looks. If your question comes out easier than the target, prefer to make',
    'it genuinely harder — require choosing between two approaches, or a step the stem',
    'does not hand over — and only if you cannot, return the honest lower label. A',
    'mislabelled question is worse than an easy one: it is served to students as',
    'evidence of a mastery they have not shown.',
    params.prompt ? `Additional instruction from the instructor: ${params.prompt}` : '',
    '',
    'Ground the question ONLY in the course material below. Do not introduce facts not supported by it.',
    'Course material:',
    renderChunks(params.chunks),
    '',
    `Produce EXACTLY ${optionCount} options. EXACTLY ONE option has role "correct".`,
    'Every option has a per-option explanation. Assign each non-correct option one role from:',
    '  - "common-misconception": a plausible error a student commonly makes',
    '  - "partially-correct": right idea, incomplete or misapplied',
    '  - "clearly-wrong": obviously incorrect to a prepared student',
    params.type === 'mcq'
      ? 'AT LEAST ONE option MUST be "common-misconception". The practice loop offers '
        + 'its retry only when a student picks one, so a question without it silently '
        + 'loses that behaviour. A question is rejected and regenerated without one.'
      : '',
    '',
    'DISTRACTORS ARE WRONG METHODS, NOT WRONG ARITHMETIC. A distractor must be the',
    'number a student actually reaches by reasoning incorrectly — discounting the',
    'wrong number of periods, compounding forward instead of back, dropping a term,',
    'using the wrong rate. Do NOT take the correct formula and mutate an operator:',
    '  good:  PAYMENT*(1+r)^n        compounded forward instead of discounting',
    '  good:  PAYMENT/(1+r)^1        discounted one period regardless of the term',
    '  bad:   SALES*(MULTIPLE^2)     squaring a multiple is not a mistake anyone makes',
    '  bad:   SALES+MULTIPLE         swapping x for + is arithmetic noise',
    '  bad:   (MULTIPLE+1)*SALES     an arbitrary tweak, not a misconception',
    'If you cannot name the student who would make the mistake, it is not a',
    'distractor — find a real one from the course material.',
    '',
    'FORMATTING. The stem, every option, and every explanation are rendered as',
    'markdown with KaTeX math. Write formulas as LaTeX, not as flat ASCII:',
    '  - inline math between single dollars: $PV = \\frac{C}{(1+r)^n}$',
    '  - display math between double dollars for a full worked line:',
    '      $$PV = \\sum_{t=1}^{n} \\frac{C_t}{(1+r)^t}$$',
    'Two rules the renderer imposes, and both fail SILENTLY when broken — the',
    'math renders as literal source text rather than erroring:',
    '  1. Never use \\( \\) or \\[ \\]. The markdown pass runs first and strips',
    '     their backslashes, so KaTeX never sees a delimiter.',
    '  2. A math span must never contain a dollar followed by digits and then a',
    '     space: that reads as a currency amount, not as math. In practice, start',
    '     math with a symbol or a command — never a digit — and keep currency',
    '     symbols OUTSIDE the math:',
    '       good:  A payment of $500 grows to $P \\times 1.05$.',
    '       good:  $\\text{FV} = 500 \\times 1.05$',
    '       bad:   $500 \\times 1.05$      (opens with a digit)',
    '       bad:   $\\$500 \\times 1.05$   (escaped amount, then a space)',
    '     The same applies right after $$: write $$\\text{PV} = \\sum ...$$, never',
    '     $$500 \\times ...$$',
    '  3. Never write a slot or derived-value NAME inside \\text{}. Those names',
    '     contain underscores, and escaping an underscore inside math is where',
    '     stray characters creep in and break the whole span. Use a short symbol',
    '     and let the placeholder carry the number:',
    '       good:  $r = \\frac{R}{100}$ where the rate is {{RATE_PCT}}%',
    '       bad:   $r = \\frac{\\text{RATE_PCT}}{100}$',
    'Prose stays prose; only the formulas are LaTeX.',
    'Show the working in the EXPLANATION — that is what that field is for, so a',
    'display line there beats describing the arithmetic in words. Do NOT put the',
    'working in an option: an option states an ANSWER, never the formula that',
    'produces it. See THE OPTION CONTRACT below.',
    '',
    'NUMERICAL QUESTIONS — MANDATORY.',
    'If answering requires ANY computation, set "numericKind": "numeric".',
    'NEVER write a computed number anywhere — not in the stem, an option, or an explanation.',
    'State the inputs as variable slots and every displayed value as a formula; a',
    'deterministic evaluator computes them at serve time, and each student sees different',
    'numbers.',
    '  - "paramSlots": the inputs, e.g.',
    '      [ { "name": "PAYMENT", "min": 100, "max": 900, "step": 100 },',
    '        { "name": "RATE_PCT", "min": 4, "max": 12, "step": 2 } ]',
    '  - "derivedValues": the correct answer AND every distractor, e.g.',
    '      [ { "name": "PV", "formula": "PAYMENT/(1+RATE_PCT/100)^2" },',
    '        { "name": "PV_COMPOUNDED", "formula": "PAYMENT*(1+RATE_PCT/100)^2",',
    '          "errorModel": "compounded forward instead of discounting back" } ]',
    '    These formulas are EVALUATOR syntax and are NEVER LaTeX: they are parsed',
    '    and computed, not displayed. Keep writing PAYMENT/(1+RATE_PCT/100)^2 —',
    '    a \\frac{}{} here fails to parse and the question is rejected. LaTeX',
    '    belongs only in the stem, option and explanation TEXT.',
    '  - BUILD THE ANSWER IN STEPS. "derivedValues" are evaluated IN ORDER, and a',
    '    later formula may use any earlier one BY NAME. Prefer several short named',
    '    steps to one long expression:',
    '      good:',
    '        DEBT_VALUE   = PV(YTM_PCT/100, 16, FACE_DEBT*COUPON_PCT/100) + PV(YTM_PCT/100, 16, FACE_DEBT)',
    '        EQUITY_VALUE = SHARES*PRICE',
    '        V            = DEBT_VALUE + EQUITY_VALUE',
    '        COST_EQUITY  = RF_PCT/100 + BETA*MRP_PCT/100',
    '        WACC         = (EQUITY_VALUE/V)*COST_EQUITY + (DEBT_VALUE/V)*(YTM_PCT/100)',
    '      bad:  all of that inlined as one 400-character expression with the two',
    '            PV(...) calls repeated six times.',
    '    A step that no option displays is perfectly allowed and is exempt from',
    '    the option contract below — name it and reuse it.',
    '    This is not a style preference. Long nested expressions are exactly where',
    '    real generations drop a parenthesis; the parser then reports "trailing',
    '    input after formula" and the question is rejected outright. If a formula',
    '    runs past roughly 100 characters, or nests more than three deep, SPLIT IT.',
    '    If you cannot express a quantity inline, give it its OWN step. Never fill',
    '    the gap with a stand-in: (PV(1,1,1) - PV(1,1,1)) and a hardcoded 2.2e6',
    '    were both produced in real runs — the first is identically zero, so it',
    '    divided the answer by zero on every draw.',
    '    Every distractor MUST carry an "errorModel" naming the specific mistake it',
    '    represents, and its formula must genuinely implement that mistake.',
    '    Name the MISTAKE, never the role. "common-misconception" is a role, not an',
    '    errorModel — a real generation returned exactly that on every distractor',
    '    and the question was regenerated. Write "compounded forward instead of',
    '    discounting back" or "used the coupon rate in place of the yield".',
    '    The CORRECT value MUST NOT carry an "errorModel" — it represents no mistake.',
    '    Omit the field entirely rather than describing the right answer in it.',
    '  - THE OPTION CONTRACT — read this twice. It is checked FIRST, before any',
    '    formula is evaluated, so breaking it rejects the question before the',
    '    collision check below is even reached. Three consecutive live',
    '    generations died here.',
    '    An option text IS a value. Not a sentence containing a value — the whole',
    '    option is the quantity, plus at most a currency symbol, unit or percent',
    '    sign, and it carries EXACTLY ONE {{NAME}} from "derivedValues":',
    '      good:  "${{PV}}"',
    '      good:  "{{IRR_PCT}}%"',
    '      bad:   "${{PAYMENT}}"                  an INPUT slot is not an answer',
    '      bad:   "-{{CF0}} + {{CF1}}/(1+r)"      the formula, not the answer',
    '      bad:   "Accept the project"            no computed value at all',
    '      bad:   "Accept the project. {{NPV}}"   a sentence with a value stapled',
    '             on. This is the worst of the four: it passes the automatic',
    '             check and reaches a student as a decision followed by an',
    '             unrelated number. If you find yourself appending a value to a',
    '             sentence to satisfy this rule, the question is CONCEPTUAL —',
    '             go and set "numericKind": "conceptual" instead.',
    '    Input-slot placeholders may also appear in an option, but they do not',
    '    count toward this rule and can never stand in for the derived value.',
    '    Two options must never name the same derived value.',
    '    The STEM may use slot placeholders freely — this rule is about options.',
    '',
    'Formula syntax: + - * / ^ ( ), variable names, and these functions only:',
    '  PV(rate, periods, amount), FV(rate, periods, amount), PMT(rate, periods, principal),',
    '  NPV(rate, cf1, cf2, ...), IRR(cf0, cf1, ...), ln, exp, sqrt, abs, min, max,',
    '  round(value, decimals), N(x) for the standard normal CDF, and',
    '  SUM(index, from, to, body) for series such as duration or amortization.',
    'These functions are shorthand, not a limit: any closed-form finance formula can be',
    'written with arithmetic alone (CAPM is RF + BETA*MRP; Gordon growth is D1/(R-G)).',
    'Transcribe the formula the course material itself uses.',
    '',
    'That list is the WHOLE grammar. There are no comparisons (> < >= <= == !=),',
    'no conditionals, no ternary ?:, no booleans, and no if(). A formula like',
    '"max(1, min(2, (PI_X>0?1:0) + (PI_Y>0?1:0)))" does not parse and the question',
    'is rejected. If you are reaching for a comparison, you are encoding a DECISION',
    'as a number — that question is "conceptual", not "numeric".',
    '',
    'Two rules the automatic verifier enforces — a question breaking either is rejected:',
    '  1. Ranges must never let a formula break. A rate a formula divides by must not',
    '     include 0, and no range may drive a value beyond about 1e12.',
    '  2. Option values must differ for EVERY combination of values in range.',
    '',
    'THE PAIRWISE COLLISION CHECK — do this before you answer, it is the single most',
    'common reason a question is rejected. Take every PAIR of option formulas, set them',
    'equal, and solve. If any solution falls inside the declared ranges, the two options',
    'show the same number on that draw and the question is unanswerable. Examples of',
    'pairs that look fine and are not:',
    '  - "A" and "B" (two bare slot values) are equal wherever their ranges OVERLAP.',
    '  - "A - B" and "B" are equal when A = 2*B.',
    '  - "A - B" and "B - A" are equal when A = B (both 0).',
    '  - "A * (1+r)^n" and "A" are equal when n can draw 0.',
    // The identity-element family. Added 2026-08-16 after it caused FIVE OF SIX
    // verification failures in one measured batch, every time via BETA=1.0 — the
    // list above covers overlapping slots, doubling and a zero exponent, and the
    // model checked those faithfully while missing this one entirely.
    '  - A MULTIPLIER that can draw exactly 1. "RF + BETA*(M - RF)" and the "ignored',
    '    beta" distractor "RF + (M - RF)" are the same expression when BETA = 1, so a',
    '    beta range of 0.5..2.0 step 0.5 is unservable — 1.0 is one of its draws.',
    '  - An ADDEND or a rate that can draw exactly 0, which makes a "forgot this term"',
    '    distractor identical to the correct answer on that draw.',
    'This family is the one that gets missed: the two formulas look different because',
    'one has a factor the other lacks, and they are still identical at the draw where',
    'that factor is the identity. Whenever a distractor differs from the correct answer',
    'by REMOVING a multiplier, check whether that multiplier can draw 1; by removing an',
    'added term, whether it can draw 0. If it can, EXCLUDE that value from the range or',
    'change the mistake. Check the exclusion by listing the draws, because min/max alone',
    'hides it: BETA 1.1..2.0 step 0.3 gives 1.1, 1.4, 1.7, 2.0 and never draws 1.0, but',
    'BETA 0.6..2.0 step 0.4 gives 0.6, 1.0, ... and still does.',
    '',
    'THE FIX, and prefer this one: give the slots DISJOINT, WELL-SEPARATED ranges. If A',
    'is always far larger than B, then A never equals B, A-B never equals B, and A+B',
    'never equals either. For a firm with cash in and cash out, use something like',
    'CASH_IN 3000..5000 and CASH_OUT 200..1000 rather than two ranges that both span',
    '200..5000. Separated ranges are also more realistic than overlapping ones.',
    'If separation is impossible, change the mistake instead: use a wrong rate, a',
    'dropped term, or a wrong operand rather than a formula that can coincide.',
    '',
    'Two collision traps seen in real generations, both from distractors that are',
    'RATIOS or PERCENTAGES rather than amounts — the sizes cancel, so widening the',
    'ranges does not separate them:',
    '  - a distractor that differs only by a factor which some draw makes 1;',
    '  - two "wrong rate" distractors whose rates coincide where their ranges meet.',
    'For a ratio-valued answer, separate it by the STRUCTURE of the mistake (a',
    'dropped term, a wrong denominator), not by the input ranges.',
    '',
    'If answering requires NO computation, set "numericKind": "conceptual" and omit',
    'paramSlots and derivedValues entirely.',
    '',
    'ALSO conceptual, even though arithmetic is involved: a question whose OPTIONS',
    'are decisions or statements rather than values — "Accept the project" /',
    '"Reject the project", "The NPV rule and the IRR rule agree", and so on. Those',
    'options cannot satisfy the option contract, because there is no single',
    'computed value for them to display. Pick one shape and commit to it:',
    '  - want the decision tested? -> "conceptual", no slots, no derivedValues;',
    '  - want the arithmetic tested? -> "numeric", and every option is a VALUE.',
    'Do not try to have both in one question.',
    '',
    'Respond with ONLY this JSON shape:',
    '{ "stem": string, "difficulty": "easy"|"medium"|"hard",',
    '  "numericKind": "numeric"|"conceptual",',
    '  "paramSlots": [ { "name": string, "min": number, "max": number, "step": number } ],',
    '  "derivedValues": [ { "name": string, "formula": string, "errorModel": string } ],',
    '  "options": [ { "key": string, "text": string, "role": string, "explanation": string } ] }',
    params.type === 'mcq' ? 'Use option keys "A","B","C","D".' : 'Use option keys "T","F".',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Verifies a generated numerical question's formulas before the version is
 * written, so an unverifiable one lands in review already carrying its reason
 * instead of looking approvable.
 *
 * Returns the parameterization fields to spread into `createQuestion`, plus an
 * optional `failure` note to append to the reviewer's reasoning. A conceptual
 * question returns nothing to add — the numeric gate lets it serve regardless.
 *
 * `optionValueNames` is derived from which derived values the options actually
 * display: a helper value used only as an intermediate step in another formula
 * is legitimately allowed to collide with an option's value, and demanding
 * distinctness from it would reject sound questions.
 */
export function verifyGeneratedNumerics(generated: GeneratorOutput): {
  fields: {
    numericKind?: 'numeric' | 'conceptual';
    paramSlots?: ParamSlot[];
    derivedValues?: DerivedValue[];
    verification?: NumericVerification;
  };
  failure?: string;
} {
  if (generated.numericKind !== 'numeric') {
    return { fields: generated.numericKind ? { numericKind: generated.numericKind } : {} };
  }

  const paramSlots = generated.paramSlots ?? [];
  const derivedValues = generated.derivedValues ?? [];
  const base = { numericKind: 'numeric' as const, paramSlots, derivedValues };

  if (derivedValues.length === 0) {
    return {
      fields: base,
      failure: 'declared numeric but supplied no derivedValues, so no value could be computed',
    };
  }

  const optionValues = optionValueNamesForVerification(
    generated.options.map((option) => option.text),
    derivedValues.map((derived) => derived.name),
  );
  if (!optionValues.ok) {
    return { fields: base, failure: optionValues.error };
  }

  const result = verifyQuestionNumerics({
    slots: paramSlots,
    derivedValues,
    optionValueNames: optionValues.names,
  });
  if (!result.ok) {
    return {
      fields: base,
      failure: `${result.error}${result.failingSeed !== undefined ? ` (seed ${result.failingSeed})` : ''}`,
    };
  }
  return { fields: { ...base, verification: result.verification } };
}

/** Appends a verification failure to the reviewer's reasoning so the instructor
 * sees WHY the question will not serve, right where they read the review. */
function withVerificationNote(reasoning: string, failure?: string): string {
  return failure ? `${reasoning}\n\nNumeric verification FAILED: ${failure}` : reasoning;
}

export function VALIDATOR_PROMPT(params: {
  loName: string;
  question: GeneratorOutput;
  /** The same grounding the generator was given. See REVIEWER_PROMPT for why. */
  chunks?: RetrievedChunk[];
}): string {
  return [
    'You are a structure validator for finance practice questions. For the question below,',
    `written for the LO "${params.loName}", assess whether EACH option's assigned role`,
    'genuinely fits its text (is the "correct" option actually correct? is each',
    '"common-misconception" a realistic misconception? etc.).',
    '',
    ...(params.chunks?.length
      ? ['Judge against the COURSE MATERIAL below — it is what the question was written',
         'from and what the student has been taught:',
         renderChunks(params.chunks),
         '']
      : []),
    'Question JSON:',
    JSON.stringify(params.question),
    '',
    'Respond with ONLY this JSON shape:',
    '{ "roleAssessment": string }  // one concise paragraph covering each option by key',
  ].join('\n');
}

export function REVIEWER_PROMPT(params: {
  loName: string;
  question: GeneratorOutput;
  /**
   * The deterministic verifier's rejection, when it already has one. Measured
   * 2026-08-16: the reviewer was guessing at servability with this information
   * sitting unused one function away.
   */
  verificationFailure?: string;
  /**
   * The grounding the generator wrote from. Criterion 2 asks whether the
   * question is "grounded in the material" and the reviewer was never shown any
   * — it was answering that from general finance knowledge alone.
   *
   * Found 2026-08-16 when three questions were rejected for modelling
   * holding-period return "incorrectly": all three had earned verification
   * proofs, and the objection was the reviewer's own theory of dividend
   * reinvestment, not a mismatch with what the course teaches. A reviewer that
   * cannot see the material cannot tell a wrong question from a question that
   * follows a simpler treatment than the one it has in mind.
   */
  chunks?: RetrievedChunk[];
}): string {
  return [
    'You are a senior finance instructor reviewing a generated practice question for the',
    `LO "${params.loName}". Judge it against these criteria (IN-Q05):`,
    '  1. Factual accuracy — every statement is correct.',
    '  2. LO & material alignment — it tests this LO and is grounded in the material.',
    '  3. Distractor quality — wrong options are plausible and pedagogically useful.',
    '  4. Clarity — the stem and options are unambiguous.',
    '  5. Difficulty calibration — the actual reasoning demand matches the stated difficulty;',
    '     a one-step substitution should not pass as medium or hard.',
    '  6. Formula modelling — for a numerical question, does each formula in derivedValues',
    '     actually model what the stem asks? A present value of a two-period stream must',
    '     discount each cash flow by its OWN period. Judge the model, not the arithmetic.',
    '     Check too that each distractor\'s errorModel describes a mistake a student would',
    '     really make, and that its formula genuinely implements that mistake.',
    // Criteria 7-9 added 2026-08-16. Each mirrors a gate that already decides
    // whether a question can serve, and that the reviewer could not see: it was
    // judging pedagogy while three structural faults passed underneath it.
    // Measured on a fixture missing a common-misconception, the reviewer named
    // the fault 0/4 times before and 4/4 after, and still passed a clean
    // control 4/4 — so this is discrimination, not severity inflation.
    // See docs/reviewer-agent-tests.md.
    '  7. SLOT-RANGE DEGENERACY — the most common reason a question can never be served.',
    '     For a numerical question, check every distractor against the correct answer at',
    '     the extremes AND the round middle of each slot range. If any allowed draw makes',
    '     a distractor equal the correct answer, the question is unservable. The classic',
    '     case: a beta range that includes exactly 1.0, where a distractor that "ignores',
    '     beta" becomes identical to the correct CAPM answer. Two formulas can also be',
    '     identical as EXPRESSIONS for every draw — "RF + (M - RF)" is just "M" — which no',
    '     range choice can fix. Reject either, and name the value or the identity.',
    // Wording corrected 2026-08-17 after a live false reject: this said "never a
    // sentence with a value appended", and the reviewer read a "%" suffix as
    // appended text and rejected a question that had EARNED a proof. The rule it
    // mirrors (optionValueNamesForVerification) counts PLACEHOLDERS, not
    // characters, so a unit attached to one placeholder was always legal — and
    // "{{WACC_PCT}}%" is a shape the generator prompt itself teaches.
    '  8. Option contract — in a numerical question every option must contain EXACTLY ONE',
    '     {{placeholder}} from derivedValues. A unit or symbol attached to it is fine and',
    '     expected: "{{NPV}}", "{{WACC_PCT}}%", "${{PRICE}}" all satisfy this. What breaks',
    '     it is an option carrying TWO placeholders, none at all, a formula instead of a',
    '     value, or a sentence with a number stapled on ("Accept the project. 7.36").',
    '     A question whose options are decisions or statements should have been',
    '     conceptual, with no slots at all.',
    // The T/F exemption is explicit because omitting it cost 3/3 false rejects on
    // a legitimate two-option question, measured 2026-08-17. optionShapeValid
    // skips this check for true-false, and assertOptionInvariants COERCES the
    // wrong option to common-misconception — but inside createQuestion, which
    // runs after this review. So the reviewer sees a role set the platform is
    // about to fix and rejects the question for it.
    '  9. Retry gate — a FOUR-OPTION multiple-choice question must carry at least one',
    '     option with role "common-misconception". The practice loop offers its retry only',
    '     on that role, so an MCQ without one silently loses the behaviour for every',
    '     student. This does NOT apply to a two-option true/false question: the platform',
    '     relabels its single wrong option to "common-misconception" automatically after',
    '     this review, so whatever role it carries here is correct and is not a defect.',
    '',
    // The deleted criterion was "Calculation correctness — any numbers/formulas
    // check out." It passed every arithmetically-wrong question in 2026-08-05
    // user testing, because checking arithmetic by reading it uses the same
    // unreliable arithmetic that produced the error. Every number a student
    // sees is now computed by a deterministic evaluator, so re-adding this
    // criterion would buy nothing but false confidence.
    'DO NOT attempt to evaluate any arithmetic. Every number a student sees is computed by',
    'a deterministic evaluator from the formulas below, so arithmetic errors are',
    'structurally impossible and "checking" them here only produces false confidence.',
    'Judge modelling and pedagogy. Criterion 7 is NOT arithmetic: it asks whether two',
    'FORMULAS become the same expression at a draw the ranges allow.',
    '',
    ...(params.chunks?.length
      ? ['THE COURSE MATERIAL the question was written from, and the only treatment the',
         'student has been taught. Judge criteria 1, 2 and 6 against THIS, not against a',
         'more complete model you happen to know: a question that follows the course\'s',
         'simplification faithfully is correct here, even where a fuller treatment would',
         'add terms the material never introduces. Reject for contradicting the material,',
         'not for being simpler than the literature.',
         renderChunks(params.chunks),
         '']
      : []),
    // The verifier runs before this call and its verdict was being thrown away.
    // Without it the reviewer can only guess whether a question is servable, and
    // "flag" on a question that can never reach a student is the wrong verdict.
    ...(params.verificationFailure
      ? ['The deterministic verifier has ALREADY REJECTED this question:',
         `  "${params.verificationFailure}"`,
         'It cannot serve a student in this state, whatever its pedagogical merits.',
         'Say specifically what must change to fix it.',
         '']
      : []),
    'Question JSON:',
    JSON.stringify(params.question),
    '',
    'Decide: "pass" (ready for instructor approval), "flag" (usable but needs attention),',
    'or "reject" (do not use). Respond with ONLY this JSON shape:',
    '{ "decision": "pass"|"flag"|"reject", "reasoning": string }',
  ].join('\n');
}
