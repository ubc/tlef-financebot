import { ObjectId } from 'mongodb';
import { BUILTIN_REFERENCE } from '../components/formula';
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
  themesCol,
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

/** The hard-target grounding (R7): the LO keeps its FULL budget and earlier
 * objectives' material comes on top — 8 chunks total. Probe evidence
 * (experiment 22): the widened pool is the difference between 0/4 and 3/4
 * honest numeric-hard attempts on the LO family whose own material tops out
 * at medium. Originally 4+2 to hold the prompt size flat; raised to 6+2 on
 * 2026-08-21 because the ~500 extra tokens are three orders of magnitude
 * below anything Luna's context or pricing cares about, and losing two
 * primary chunks was the split's only real cost. Experiments 22-23 ran at
 * 4+2 — note the condition change before comparing against them. */
const HARD_PRIMARY_TOP_K = 6;
const HARD_SUPPORTING_TOP_K = 2;

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
  /** From an EARLIER learning objective's materials, retrieved only for hard
   * targets so a hardness move has a second concept to chain (R7). Rendered
   * with an explicit label so the model — and the reviewer judging grounding —
   * can tell support apart from the LO's own material. */
  supporting?: boolean;
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
/**
 * What the reviewer is told about the verifier's verdict: the failure when there
 * is one, the proof when one was earned, nothing for a conceptual question
 * (which has neither). One helper rather than a ternary chain at three call
 * sites, so the failure/success symmetry cannot drift apart again.
 */
function reviewerVerificationParams(
  numerics: ReturnType<typeof verifyGeneratedNumerics>,
): { verificationFailure?: string; verificationProven?: boolean } {
  if (numerics.failure) return { verificationFailure: numerics.failure };
  if (numerics.fields.verification) return { verificationProven: true };
  return {};
}

/**
 * Option B: after a reviewer REJECT, regenerate once with the critique quoted
 * back, then judge the replacement exactly as the original was judged.
 *
 * Returns the replacement with its own verdicts, or null when regeneration
 * failed structurally — in which case the caller keeps the original reject,
 * which is never worse than before. If the replacement is ALSO rejected, the
 * replacement is kept: it incorporated the critique, and persisting the later
 * attempt matches what an instructor reading the run expects to see.
 *
 * Fires only on `reject`, never `flag` — a flag is "usable, needs attention",
 * and regenerating it would spend money replacing a usable question. The
 * `retryOnReject` platform flag gates the whole mechanism (admin console →
 * Feature flags), because the cost is one extra generator+validator+reviewer
 * cycle per rejected question.
 */
async function retryRejectedCandidate(args: {
  lo: { name: string };
  type: QuestionType;
  difficulty?: Difficulty;
  prompt?: string;
  chunks: RetrievedChunk[];
  models: ResolvedStepModels;
  reviewerStep: StepModelConfig;
  rejected: GeneratorOutput;
  critique: string;
}): Promise<{ generated: GeneratorOutput; numerics: ReturnType<typeof verifyGeneratedNumerics>; validation: ValidatorOutput; review: ReviewerOutput } | null> {
  // Same observability as the verifier retry's warn: the reject-retry is a paid
  // extra cycle, and an admin watching logs should see each one it spends.
  console.warn(`[generation] reviewer rejected — retrying with the critique: ${args.critique.slice(0, 120)}`);
  const retried = await generateValidQuestion(
    args.type,
    args.lo.name,
    args.difficulty,
    args.prompt,
    args.chunks,
    args.models.generator,
    REVIEWER_REJECT_FEEDBACK(args.critique, args.rejected),
  );
  if (!retried) return null;

  const numerics = verifyGeneratedNumerics(retried);
  const validation = await completeJson<ValidatorOutput>(
    VALIDATOR_PROMPT({ loName: args.lo.name, question: retried, chunks: args.chunks }),
    { ...args.models.validator },
  );
  const review = await completeJson<ReviewerOutput>(
    REVIEWER_PROMPT({
      loName: args.lo.name,
      question: retried,
      chunks: args.chunks,
      roleAssessment: String(validation.roleAssessment ?? ''),
      ...reviewerVerificationParams(numerics),
    }),
    { ...args.reviewerStep },
  );
  return { generated: retried, numerics, validation, review };
}

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
  const { chunks } = await retrieveChunks(
    collection, courseId, lo, prompt, undefined, input.difficulty === 'hard',
  );

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
            roleAssessment: String(validation.roleAssessment ?? ''),
            ...reviewerVerificationParams(numerics),
          }),
          { ...models.reviewer },
        )
      : { decision: 'flag', reasoning: 'Reviewer agent disabled at generation time.' };

    // Option B: one retry with the critique quoted back, on reject only.
    let outcome = { generated, numerics, validation, review };
    if (platformSettings.featureFlags.retryOnReject && normalizeDecision(review.decision) === 'reject') {
      const retried = await retryRejectedCandidate({
        lo, type, difficulty: input.difficulty, prompt, chunks, models,
        reviewerStep: models.reviewer, rejected: generated, critique: String(review.reasoning ?? ''),
      });
      if (retried) outcome = retried;
    }

    const sourceRefs = chunks
      .filter((chunk) => chunk.materialId)
      .map((chunk) => ({ materialId: new ObjectId(chunk.materialId), chunk: chunk.text }));

    try {
      const { questionId } = await createQuestion({
        courseId,
        loIds: [loId],
        themeIds: [lo.themeId],
        type,
        stem: outcome.generated.stem,
        options: outcome.generated.options,
        // Already shuffled in generateValidQuestion, upstream of the validator
        // and reviewer whose prose names the resulting letters.
        optionsAlreadyShuffled: true,
        difficulty: normalizeDifficulty(input.difficulty ?? outcome.generated.difficulty),
        sourceRefs,
        createdBy: byPuid,
        ...(prompt !== undefined ? { generationPrompt: prompt } : {}),
        ...outcome.numerics.fields,
        agentDecision: {
          decision: normalizeDecision(outcome.review.decision),
          reasoning: withVerificationNote(String(outcome.review.reasoning ?? ''), outcome.numerics.failure),
          roleAssessment: String(outcome.validation.roleAssessment ?? ''),
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
    undefined,
    current.difficulty === 'hard',
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
          roleAssessment: String(validation.roleAssessment ?? ''),
          ...reviewerVerificationParams(numerics),
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
    // Widen only when the instructor did NOT pin materials — a pin means
    // exactly these, and the supporting pool would smuggle others back in.
    const grounding = await retrieveChunks(
      courseCollection(courseId), courseId, lo, prompt, allowedMaterialIds,
      input.pinnedMaterialIds === undefined && input.difficulty === 'hard',
    );
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
                roleAssessment: String(candidate.validation?.roleAssessment ?? ''),
                ...reviewerVerificationParams(candidateNumerics),
              }),
              { ...models.reviewer },
            )
          : { decision: 'flag', reasoning: 'Reviewer agent disabled at generation time.' };

        // Option B: one retry with the critique quoted back, on reject only.
        // Persistence below recomputes numerics from candidate.generated, so
        // replacing the candidate here is the whole change.
        if (platformSettings.featureFlags.retryOnReject && normalizeDecision(candidate.review.decision) === 'reject') {
          await updateContentRun(runId, {
            status: 'running',
            stage,
            completedUnits: result.failures.length,
            result,
            message: `Reviewer rejected candidate ${candidate.item + 1} — retrying with the critique`,
          });
          const retried = await retryRejectedCandidate({
            lo, type, difficulty: input.difficulty, prompt, chunks, models,
            reviewerStep: models.reviewer, rejected: candidate.generated,
            critique: String(candidate.review.reasoning ?? ''),
          });
          if (retried) {
            candidate.generated = retried.generated;
            candidate.validation = retried.validation;
            candidate.review = retried.review;
          }
        }
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

/**
 * Materials assigned to EARLIER learning objectives — same theme with a lower
 * LO order, or any LO/theme-wide assignment in a lower-ordered theme (R7).
 *
 * Backward only, by course order: the instructor's HIGH questions chain into
 * concepts already taught (12 of the bank's 23 HIGH items sit in the
 * cumulative Class 9-10 quiz), never forward into material students have not
 * seen. Materials already in the primary pool are excluded — a material
 * assigned to both this LO and an earlier one is primary, not support.
 */
async function supportingMaterialIds(
  courseId: ObjectId,
  lo: { _id: ObjectId; themeId: ObjectId; order: number },
  primaryMaterialIds: string[],
): Promise<string[]> {
  const [themes, los, materials] = await Promise.all([
    themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    materialsCol().find({ courseId, status: 'ready', deletedAt: { $exists: false } }).toArray(),
  ]);
  const currentTheme = themes.find((theme) => theme._id.equals(lo.themeId));
  if (!currentTheme) return [];

  const earlierThemeIds = themes
    .filter((theme) => theme.order < currentTheme.order)
    .map((theme) => theme._id);
  const isEarlierTheme = (themeId: ObjectId) => earlierThemeIds.some((id) => id.equals(themeId));
  const earlierLoIds = los
    .filter((candidate) =>
      isEarlierTheme(candidate.themeId) ||
      (candidate.themeId.equals(lo.themeId) && candidate.order < lo.order))
    .map((candidate) => candidate._id);

  const primary = new Set(primaryMaterialIds);
  return materials
    .filter((material) =>
      !primary.has(material._id.toHexString()) &&
      material.assignments.some(
        (assignment) =>
          (assignment.loId !== undefined && earlierLoIds.some((id) => id.equals(assignment.loId as ObjectId))) ||
          (assignment.loId === undefined && isEarlierTheme(assignment.themeId)),
      ))
    .map((material) => material._id.toHexString());
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
 * generating from the LO name or general model knowledge.
 *
 * `widen` (R7, hard targets only): split the budget HARD_PRIMARY_TOP_K /
 * HARD_SUPPORTING_TOP_K between the LO's own materials and earlier
 * objectives' materials, so a hardness move has a second concept to chain.
 * The widen decision belongs to the CALLER, because `pinnedMaterialIds` here
 * does not mean "instructor pinned" — the tracked pipeline routes its
 * resolved ids through it on every run. Callers must not widen over an
 * actual instructor pin (a pin means exactly these). Widening quietly
 * reverts to the plain retrieval when the course has no earlier-objective
 * material (the first LO) or the supporting search yields nothing. A supporting-search failure likewise degrades to
 * primary-only rather than failing generation: support is an enrichment, and
 * the strictness contract above covers the PRIMARY grounding.
 */
async function retrieveChunks(
  collection: string,
  courseId: ObjectId,
  lo: { _id: ObjectId; themeId: ObjectId; name: string; order: number },
  prompt?: string,
  pinnedMaterialIds?: string[],
  widen?: boolean,
): Promise<RetrievedGrounding> {
  const allowedMaterialIds = pinnedMaterialIds ?? (await groundingMaterialIds(courseId, lo, prompt));
  if (allowedMaterialIds.length === 0) throw new Error('generation-no-assigned-materials');

  const supportingIds = widen ? await supportingMaterialIds(courseId, lo, allowedMaterialIds) : [];
  const primaryTopK = supportingIds.length > 0 ? HARD_PRIMARY_TOP_K : RETRIEVE_TOP_K;

  const query = prompt ? `${lo.name}\n${prompt}` : lo.name;
  const vector = await embedOne(query);
  let hits;
  try {
    hits = await search(collection, vector, primaryTopK, {
      must: [{ key: 'materialId', match: { any: allowedMaterialIds } }],
    });
  } catch (err) {
    console.warn(
      `[generation] assigned-material retrieval failed for ${collection}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    throw new Error('generation-retrieval-failed', { cause: err });
  }
  const toChunk = (hit: (typeof hits)[number]) => ({
    materialId: typeof hit.payload?.materialId === 'string' ? hit.payload.materialId : undefined,
    text: typeof hit.payload?.chunk === 'string' ? hit.payload.chunk : '',
  });
  const allowed = new Set(allowedMaterialIds);
  const chunks: RetrievedChunk[] = hits
    .map(toChunk)
    // Defense in depth: Qdrant should enforce the filter, but never trust a
    // malformed/stale hit enough to write a forbidden sourceRef.
    .filter((chunk) => chunk.materialId !== undefined && allowed.has(chunk.materialId) && chunk.text.length > 0);
  if (chunks.length === 0) throw new Error('generation-no-grounding');

  if (supportingIds.length > 0) {
    try {
      const supportingHits = await search(collection, vector, HARD_SUPPORTING_TOP_K, {
        must: [{ key: 'materialId', match: { any: supportingIds } }],
      });
      const supportingAllowed = new Set(supportingIds);
      chunks.push(
        ...supportingHits
          .map(toChunk)
          .filter((chunk) =>
            chunk.materialId !== undefined && supportingAllowed.has(chunk.materialId) && chunk.text.length > 0)
          .map((chunk) => ({ ...chunk, supporting: true })),
      );
    } catch (err) {
      console.warn(
        `[generation] supporting-material retrieval failed for ${collection}, ` +
          `continuing with primary grounding only: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
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
  /** Option B: the reviewer's critique of a rejected earlier question, carried
   * on EVERY attempt this call makes (the verifier's own retry feedback stacks
   * on top when a collision also occurs). */
  extraInstruction?: string,
): Promise<GeneratorOutput | null> {
  /** The last structurally-valid candidate, returned unproven if attempts run out. */
  let lastValid: GeneratorOutput | null = null;
  /** The verifier's own sentence about the previous attempt, quoted back on retry. */
  let lastFailure: string | undefined;

  for (let attempt = 1; attempt <= GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const withExtra = extraInstruction
      ? `${GENERATOR_PROMPT({ type, loName, difficulty, prompt, chunks })}\n\n${extraInstruction}`
      : GENERATOR_PROMPT({ type, loName, difficulty, prompt, chunks });
    const candidate = await completeJson<GeneratorOutput>(
      lastFailure ? `${withExtra}\n\n${RETRY_FEEDBACK(lastFailure)}` : withExtra,
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
    'If two option values came out identical, they are identical as expressions —',
    '"RF + (M - RF)" is just "M", whatever the draw — or at some draw the ranges',
    'permit, or they ROUND to the same displayed value: options render at two',
    'decimals, so 7.3591 and 7.3644 are the same option to a student. Separate',
    'option values by more than a cent, not by a rounding hair. Either change one',
    'distractor to a different mistake, or move the slot range so the coinciding',
    'draw cannot occur, and list the draws to check it rather than trusting the',
    'bounds. Do not resubmit the same formulas.',
  ].join('\n');
}

/**
 * Option B (Saurav, 2026-08-17): what the generator is told when the REVIEWER
 * rejects a question. The same mechanism as RETRY_FEEDBACK — quote the judge's
 * own words rather than paraphrasing — applied to the judgement faults only the
 * reviewer can see. Three prompt revisions failed to prevent these faults by
 * instruction; the verifier retry then proved that telling the model what it
 * got wrong is what works (0/4 -> 4/4 proofs). This extends that to difficulty
 * labels, weak distractors and lying errorModels.
 */
export function REVIEWER_REJECT_FEEDBACK(reasoning: string, rejected: GeneratorOutput): string {
  return [
    'YOUR PREVIOUS QUESTION WAS REJECTED BY THE REVIEWING INSTRUCTOR. The critique:',
    `  "${reasoning}"`,
    'The rejected question, for reference — do NOT resubmit it with cosmetic edits:',
    JSON.stringify(rejected),
    'Write a NEW question for the same learning objective that fixes every fault the',
    'critique names. If it says the difficulty label was inflated, either make the',
    'question genuinely harder — require choosing between approaches, or a step the',
    'stem does not hand over — or return the honest lower label. If it names a weak',
    'or implausible distractor, replace it with a mistake a real student makes, and',
    'make its errorModel describe exactly what its formula does.',
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
  return chunks
    .map((chunk, i) =>
      chunk.supporting
        ? `[${i + 1}] [Supporting material from an EARLIER learning objective, already taught `
          + `to these students. You may chain its concepts into the question, but the question `
          + `must still primarily test the current learning objective.]\n${chunk.text}`
        : `[${i + 1}] ${chunk.text}`)
    .join('\n\n');
}

/**
 * One rubric, two audiences. The generator sees its TARGET's line; the reviewer
 * sees all three, because it judges whether the label matches. Until 2026-08-17
 * the reviewer had only "a one-step substitution should not pass as medium or
 * hard" — it was grading against definitions it had never been shown.
 *
 * The definitions are the course instructor's own, condensed from the
 * operational rubric in FinanceBot_Difficulty_Ratings.docx (2026-08-21) — the
 * one they applied to all 108 released practice questions. It splits
 * calculation from conceptual demand because the boundaries genuinely differ:
 * a calculation gets harder by chaining concepts, a conceptual question by
 * tightening distractors. See docs/difficulty-ratings-analysis.md.
 */
export const DIFFICULTY_RUBRIC: Record<Difficulty, string> = {
  easy:
    'Easy (calculation): one formula, one concept; no rate or unit conversion beyond '
    + 'a single step — or the conversion IS the entire question (e.g. r = APR/m). '
    + 'Easy (conceptual): direct recall of a definition or fact, with plausible but '
    + 'clearly distinguishable distractors.',
  medium:
    'Medium (calculation): one genuine rate conversion (e.g. APR to effective rate '
    + 'where compounding frequency differs from cash-flow frequency) PLUS one formula '
    + 'application; or one standard formula (bond pricing, Gordon growth) applied to '
    + 'a scenario whose several inputs the student must organize; or rearranging one '
    + 'formula to solve for an unknown (payment, rate, growth rate); a direct formula '
    + 'substitution is too easy. '
    + 'Medium (conceptual): applying a concept to a new scenario, with distractors '
    + 'that require real understanding rather than recall.',
  hard:
    'Hard (calculation): chains MORE THAN TWO distinct concepts or formula types '
    + '(e.g. rate conversion + annuity PV + value-equals-benefit-minus-cost), or '
    + 'requires backward or strategic solving where the approach itself is not given '
    + '(e.g. re-deriving a hidden parameter such as a remaining term or an original '
    + 'payment before the asked-for quantity can be computed). '
    + 'Hard (conceptual): the student must hold two related-but-easily-confused rules '
    + 'in mind at once (annuity vs. annuity due, cum- vs. ex-dividend, coupon rate '
    + 'vs. interest-rate risk), against distractors each built from a single wrong '
    + 'step. Hardness is connections across concepts, never arithmetic size, and the '
    + 'question must remain solvable from the supplied material.',
};

/**
 * How a HARD question is manufactured, not just what one is. The rubric above
 * defines the standard; this is the construction menu behind it — in the
 * instructor's released bank, nearly every HIGH calculation question is a MID
 * question plus exactly ONE of these complications (docs/
 * difficulty-ratings-analysis.md §2). Included in GENERATOR_PROMPT only when
 * the target is `hard`, so easy/medium calls pay nothing for it — the
 * experiment-2 lesson that global prompt additions are not free.
 *
 * A single pre-joined string, exported by name, so an A/B harness can remove
 * the block from a built prompt by exact match.
 */
export const HARDNESS_MOVES: string = [
  'HOW TO MAKE IT HARD. In this course\'s own released question bank, a hard question',
  'is a medium question plus ONE deliberate complication that hides the approach.',
  'Pick the ONE move that best fits this learning objective and apply it. Do NOT',
  'enlarge the arithmetic — hardness is connections across concepts, and what the',
  'stem withholds, never bigger numbers:',
  '  1. Off-cycle timing: the event happens mid-stream, so a count or remaining term',
  '     must be re-derived rather than read off the stem (value a loan just after',
  '     payment 14 of 36; sell the asset one year after purchase).',
  '  2. Hidden parameter: a needed input (an original payment, a remaining maturity,',
  '     an implied rate) is not given and must be reconstructed from other stated',
  '     terms before the asked-for quantity can even be set up.',
  '  3. Value = benefit minus cost: the computed value is one LEG of a trade; the',
  '     answer is the difference, and identifying the two legs is the real work.',
  '  4. Regime change: a growth rate or rate environment switches partway (fast',
  '     growth for some years, then a steady state), chaining two formulas across',
  '     the boundary and discounting the far side back through the near side.',
  '  5. Deferred start: the stream begins some periods from now, so its standard',
  '     formula value lands at the wrong date and must be discounted again.',
  '  6. Reinvestment chain: interim cash flows are reinvested at a DIFFERENT rate;',
  '     the answer needs their future value plus the terminal piece, then a return.',
  '  7. Two-approach comparison: the same quantity valued two ways (a multiple vs. a',
  '     discounted value), with the question living in the reconciliation.',
  '  8. Payments due today rather than at period-end — combined with another move,',
  '     never alone.',
  'For a CONCEPTUAL hard question, sharpen instead of complicating: the correct',
  'answer must require holding two related-but-easily-confused rules in mind at',
  'once, and every distractor must be built from a SINGLE wrong step a student',
  'takes when the rules blur.',
].join('\n');

export function GENERATOR_PROMPT(params: {
  type: QuestionType;
  loName: string;
  difficulty?: Difficulty;
  prompt?: string;
  chunks: RetrievedChunk[];
}): string {
  const optionCount = params.type === 'mcq' ? 4 : 2;
  const difficultyGuidance = params.difficulty ? DIFFICULTY_RUBRIC[params.difficulty] : '';
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
    params.difficulty === 'hard' ? HARDNESS_MOVES : '',
    // The connector (R7): experiment 22 measured the widened pool licensing
    // numeric ambition while the offered chain went untaken 3/3 — the model
    // fell back to its single-concept template on 2 of 3. The material and the
    // menu have to be tied together explicitly.
    params.difficulty === 'hard' && params.chunks.some((chunk) => chunk.supporting)
      ? 'Some chunks below are marked as supporting material from EARLIER learning\n'
        + 'objectives. They are provided precisely so a hardness move can CHAIN one of\n'
        + 'their concepts into this question. A hard question that ignores them and stays\n'
        + 'inside the current objective\'s single concept is probably not hard. The\n'
        + 'question must still primarily TEST the current learning objective — the\n'
        + 'chained concept is a step on the way, never the thing being tested.'
      : '',
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
    // Example corrected 2026-08-17. The previous version modelled DEBT_VALUE as
    // PV(y, 16, COUPON) + PV(y, 16, FACE) — under the evaluator's single-sum PV
    // that discounts ONE coupon and drops the other fifteen. This prompt was
    // teaching wrong bond valuation as its own worked "good" example, and three
    // live questions were rejected reproducing it.
    '      good:',
    '        COUPON_PMT   = FACE_DEBT*COUPON_PCT/100',
    '        DEBT_VALUE   = COUPON_PMT*(1-(1+YTM_PCT/100)^-16)/(YTM_PCT/100) + PV(YTM_PCT/100, 16, FACE_DEBT)',
    '        EQUITY_VALUE = SHARES*PRICE',
    '        V            = DEBT_VALUE + EQUITY_VALUE',
    '        COST_EQUITY  = RF_PCT/100 + BETA*MRP_PCT/100',
    '        WACC         = (EQUITY_VALUE/V)*COST_EQUITY + (DEBT_VALUE/V)*(YTM_PCT/100)',
    '      bad:  all of that inlined as one 400-character expression with the',
    '            debt-value sub-expression repeated six times.',
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
    // The semantics block replaced a bare signature list on 2026-08-17, after a
    // live batch modelled bond value as PV(y, n, COUPON) + PV(y, n, FACE) —
    // Excel's reading of PV, which drops all but one coupon here. A name is not
    // a definition; the model fills undocumented signatures from its training.
    BUILTIN_REFERENCE,
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
   * The mirror image, added 2026-08-17 after the asymmetry showed up live: the
   * failure was passed but a SUCCESS was not, so on a proven question the
   * reviewer re-litigated collisions from vibes — a live reject opened with
   * "the PV1 and PV2 distractors… MAY coincide under particular parameter
   * combinations" against a question whose distinctness the verifier had just
   * demonstrated across 100 draws.
   */
  verificationProven?: boolean;
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
  /**
   * The structure validator's per-option role assessment, measured 2026-08-17
   * to catch what the reviewer misses: subtle role mislabels on questions that
   * are factually sound (planted-fault fixtures: validator 2/3, reviewer 0/3 —
   * the reviewer checks that a misconception option EXISTS, not that it fits,
   * and one run even endorsed the mislabeled option as "plausible"). Roles are
   * not cosmetic: decideStrategy keys the Strategy-A retry on the
   * common-misconception role, so a swap changes student behaviour.
   */
  roleAssessment?: string;
}): string {
  return [
    'You are a senior finance instructor reviewing a generated practice question for the',
    `LO "${params.loName}". Judge it against these criteria (IN-Q05):`,
    '  1. Factual accuracy — every statement is correct.',
    '  2. LO & material alignment — it tests this LO and is grounded in the material.',
    '  3. Distractor quality — wrong options are plausible and pedagogically useful.',
    '  4. Clarity — the stem and options are unambiguous.',
    // Until 2026-08-17 the reviewer had only the one-step heuristic — it was
    // grading labels against a rubric it had never been shown. Same rubric the
    // generator gets, all three levels, because grading needs the whole scale.
    '  5. Difficulty calibration — the actual reasoning demand matches the stated',
    '     difficulty, judged against the same rubric the generator was given:',
    `       ${DIFFICULTY_RUBRIC.easy}`,
    `       ${DIFFICULTY_RUBRIC.medium}`,
    `       ${DIFFICULTY_RUBRIC.hard}`,
    '     A one-step substitution should not pass as medium or hard.',
    '  6. Formula modelling — for a numerical question, does each formula in derivedValues',
    '     actually model what the stem asks? A present value of a two-period stream must',
    '     discount each cash flow by its OWN period. Judge the model, not the arithmetic.',
    '     Check too that each distractor\'s errorModel describes a mistake a student would',
    '     really make, and that its formula genuinely implements that mistake.',
    // Criteria 7-8 mirror gates that already decide whether a question can
    // serve, and that the reviewer could not see: it was judging pedagogy while
    // structural faults passed underneath it. Measured on a fixture missing a
    // common-misconception, the reviewer named the fault 0/4 times before and
    // 4/4 after, and still passed a clean control 4/4 — discrimination, not
    // severity inflation. See docs/reviewer-agent-tests.md.
    //
    // A slot-range degeneracy criterion lived here for one day (2026-08-16/17)
    // and was REMOVED, deliberately: the verifier now compares option values at
    // display precision across its sampled draws, and the serve-time reroll
    // guard (drawCollisionFreeParams) redraws any rare collision the sample
    // missed — so both halves of that job are done deterministically. Asking
    // the reviewer to hunt collisions too is how it produced hedged
    // "may coincide under particular combinations" rejects against proven
    // questions. Do not re-add it without new evidence.
    // Wording corrected 2026-08-17 after a live false reject: this said "never a
    // sentence with a value appended", and the reviewer read a "%" suffix as
    // appended text and rejected a question that had EARNED a proof. The rule it
    // mirrors (optionValueNamesForVerification) counts PLACEHOLDERS, not
    // characters, so a unit attached to one placeholder was always legal — and
    // "{{WACC_PCT}}%" is a shape the generator prompt itself teaches.
    '  7. Option contract — in a numerical question every option must contain EXACTLY ONE',
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
    '  8. Retry gate — a FOUR-OPTION multiple-choice question must carry at least one',
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
    'Judge modelling and pedagogy. Option COLLISIONS are not your job either: the',
    'verifier proves option distinctness at display precision, and the serving path',
    'redraws any rare colliding draw, so never reject over values that might coincide.',
    '',
    // Added 2026-08-17 after three live rejects whose reasoning assumed Excel's
    // PV. The formulas are evaluated by THIS grammar, and one reject even
    // hedged "depending on the evaluator's PV convention" — the reviewer asked
    // for this block by name. Criterion 6 is judged against these semantics.
    'The formulas in derivedValues are evaluated with THESE functions. Judge criterion 6',
    'against these exact semantics, never against what the same names mean in Excel:',
    BUILTIN_REFERENCE,
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
    // The success is passed as deliberately as the failure. Without it the
    // reviewer re-litigated collisions from vibes on questions the verifier had
    // already cleared — hedged "may coincide under particular combinations"
    // objections that no draw supports. With the collision criterion removed
    // outright (2026-08-17), this block closes the subject rather than raising
    // the bar for it.
    ...(params.verificationProven
      ? ['The deterministic verifier has PROVEN every option value pairwise distinct at',
         'display precision across its sampled draws, and the serving path redraws any',
         'rare colliding draw before a student sees it. Collisions are settled — judge',
         'this question on pedagogy alone.',
         '']
      : []),
    // The role-fit hand-off, measured 2026-08-17: on planted role-swap fixtures
    // the reviewer endorsed a mislabeled misconception as "plausible" while the
    // validator named the swap — its per-option format interrogates fit, this
    // prompt's criteria check existence. The FLAG-not-reject policy is Saurav's
    // call: roles are one edit in the question editor, so a label problem on a
    // sound question should reach the instructor as fixable, not be discarded —
    // and reject-only retries should not be spent on it.
    ...(params.roleAssessment
      ? ['The structure validator assessed each option\'s role fit:',
         `  "${params.roleAssessment}"`,
         'Weigh it. If it identifies a MISLABELED ROLE on an otherwise sound question,',
         'FLAG the question and name the exact swap so the instructor can relabel it —',
         'do not reject over role labels alone. An option marked "correct" that is not',
         'actually correct remains a reject: that is a wrong answer key, not a label.',
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
