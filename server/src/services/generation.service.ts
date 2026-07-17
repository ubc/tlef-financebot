import { ObjectId } from 'mongodb';
import { completeJson } from '../components/genai/llm';
import { embedOne } from '../components/genai/embeddings';
import { search } from '../components/qdrant';
import { defineJob } from '../components/jobs';
import { losCol, questionsCol } from '../components/mongodb/collections';
import { env } from '../config/env';
import { createQuestion } from './questions.service';
import { courseCollection } from './materials.service';
import type { Difficulty, OptionRole, QuestionOption, QuestionType } from '../types/domain';

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
 * completeJson default). */
const GENERATOR_TEMPERATURE = 0.7;

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
}

/** JSON-serializable payload for the `generation.run` Agenda job (ObjectIds as
 * hex strings). */
export interface GenerationJobData {
  courseId: string;
  loId: string;
  count: number;
  type?: QuestionType;
  difficulty?: Difficulty;
  prompt?: string;
  byPuid: string;
}

interface RetrievedChunk {
  materialId?: string;
  text: string;
}
interface GeneratorOutput {
  stem: string;
  options: QuestionOption[];
  difficulty?: string;
}
interface ValidatorOutput {
  roleAssessment: string;
}
interface ReviewerOutput {
  decision: string;
  reasoning: string;
}

/**
 * The three-agent pipeline. Returns the ids of the questions actually inserted
 * (a question skipped for repeatedly-invalid options is not counted). Always
 * inserts as Draft — never publishes.
 */
export async function runGenerationPipeline(input: GenerationInput): Promise<ObjectId[]> {
  const { courseId, loId, count, prompt, byPuid } = input;
  const type: QuestionType = input.type ?? 'mcq';

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
  const chunks = await retrieveChunks(collection, lo.name, prompt);

  for (let i = 0; i < count; i += 1) {
    const generated = await generateValidQuestion(type, lo.name, input.difficulty, prompt, chunks);
    if (!generated) {
      console.warn(
        `[generation] skipped a question for LO ${loId.toHexString()} after ` +
          `${GENERATOR_MAX_ATTEMPTS} invalid-option attempts`,
      );
      continue;
    }

    // Validator and reviewer each run on their own model. Structure validation
    // first (per-role assessment), then the IN-Q05 review decision.
    const validation = await completeJson<ValidatorOutput>(
      VALIDATOR_PROMPT({ loName: lo.name, question: generated }),
      { model: env.llmModelValidator },
    );
    const review = await completeJson<ReviewerOutput>(
      REVIEWER_PROMPT({ loName: lo.name, question: generated }),
      { model: env.llmModelReviewer },
    );

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
        difficulty: normalizeDifficulty(input.difficulty ?? generated.difficulty),
        sourceRefs,
        createdBy: byPuid,
        ...(prompt !== undefined ? { generationPrompt: prompt } : {}),
        agentDecision: {
          decision: normalizeDecision(review.decision),
          reasoning: String(review.reasoning ?? ''),
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
 * Per-LO pre-seeding progress (IN-Q10): how many Approved / Reviewed questions
 * each LO has, against the target of 5. Read-only.
 */
export async function preseedingProgress(
  courseId: ObjectId,
): Promise<Array<{ loId: ObjectId; loName: string; approved: number; reviewed: number; target: number }>> {
  const los = await losCol()
    .find({ courseId, archivedAt: { $exists: false } })
    .sort({ order: 1 })
    .toArray();

  const progress = [];
  for (const lo of los) {
    // Two small counts per LO, awaited in parallel. LO counts are tiny at
    // Phase-1 scale; if this ever matters, one $unwind aggregation collapses it.
    const [approved, reviewed] = await Promise.all([
      questionsCol().countDocuments({ courseId, loIds: lo._id, state: 'approved' }),
      questionsCol().countDocuments({ courseId, loIds: lo._id, state: 'reviewed' }),
    ]);
    progress.push({ loId: lo._id, loName: lo.name, approved, reviewed, target: GENERATION_TARGET });
  }
  return progress;
}

/** Registers the `generation.run` job. Called from server.ts AFTER startJobs()
 * — never at module load (see the module header / Task 6 boot-crash lesson). */
export function registerGenerationJobs(): void {
  defineJob<GenerationJobData>(GENERATION_JOB, (data) =>
    runGenerationPipeline({
      courseId: new ObjectId(data.courseId),
      loId: new ObjectId(data.loId),
      count: data.count,
      ...(data.type ? { type: data.type } : {}),
      ...(data.difficulty ? { difficulty: data.difficulty } : {}),
      ...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
      byPuid: data.byPuid,
    }).then(() => undefined),
  );
}

// --- Internals ---------------------------------------------------------------

/** Retrieve grounding chunks. Best-effort: a missing collection (course with no
 * ingested materials yet — "thin-LO" generation) yields no chunks and the
 * question is generated ungrounded rather than failing the batch. */
async function retrieveChunks(collection: string, loName: string, prompt?: string): Promise<RetrievedChunk[]> {
  const query = prompt ? `${loName}\n${prompt}` : loName;
  const vector = await embedOne(query);
  let hits;
  try {
    hits = await search(collection, vector, RETRIEVE_TOP_K);
  } catch (err) {
    console.warn(
      `[generation] retrieval failed for ${collection} (generating ungrounded): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
  return hits
    .map((hit) => ({
      materialId: typeof hit.payload?.materialId === 'string' ? hit.payload.materialId : undefined,
      text: typeof hit.payload?.chunk === 'string' ? hit.payload.chunk : '',
    }))
    .filter((chunk) => chunk.text.length > 0);
}

/** Run the generator, retrying once if the produced options don't satisfy the
 * structural invariants. Returns null when it fails both attempts. */
async function generateValidQuestion(
  type: QuestionType,
  loName: string,
  difficulty: Difficulty | undefined,
  prompt: string | undefined,
  chunks: RetrievedChunk[],
): Promise<GeneratorOutput | null> {
  for (let attempt = 1; attempt <= GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const candidate = await completeJson<GeneratorOutput>(
      GENERATOR_PROMPT({ type, loName, difficulty, prompt, chunks }),
      { model: env.llmModelGenerator, temperature: GENERATOR_TEMPERATURE },
    );
    if (candidate && optionShapeValid(type, candidate.options)) return candidate;
    console.warn(
      `[generation] generator produced structurally-invalid options ` +
        `(attempt ${attempt}/${GENERATOR_MAX_ATTEMPTS})`,
    );
  }
  return null;
}

/** Structural pre-check before spending validator/reviewer calls. createQuestion
 * remains the authoritative invariant guard (defense in depth). */
function optionShapeValid(type: QuestionType, options: unknown): boolean {
  const expected = type === 'mcq' ? 4 : 2;
  if (!Array.isArray(options) || options.length !== expected) return false;
  const correct = options.filter((o) => o && (o as QuestionOption).role === 'correct');
  if (correct.length !== 1) return false;
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
  if (chunks.length === 0) return '(no course material retrieved — rely on the LO name only, stay conservative)';
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
  return [
    `You are an expert finance instructor writing ONE ${params.type === 'mcq' ? 'multiple-choice' : 'true/false'} practice question`,
    `for the learning objective: "${params.loName}".`,
    params.difficulty ? `Target difficulty: ${params.difficulty}.` : '',
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
    '',
    'Respond with ONLY this JSON shape:',
    '{ "stem": string, "difficulty": "easy"|"medium"|"hard",',
    '  "options": [ { "key": string, "text": string, "role": string, "explanation": string } ] }',
    params.type === 'mcq' ? 'Use option keys "A","B","C","D".' : 'Use option keys "T","F".',
  ]
    .filter(Boolean)
    .join('\n');
}

export function VALIDATOR_PROMPT(params: { loName: string; question: GeneratorOutput }): string {
  return [
    'You are a structure validator for finance practice questions. For the question below,',
    `written for the LO "${params.loName}", assess whether EACH option's assigned role`,
    'genuinely fits its text (is the "correct" option actually correct? is each',
    '"common-misconception" a realistic misconception? etc.).',
    '',
    'Question JSON:',
    JSON.stringify(params.question),
    '',
    'Respond with ONLY this JSON shape:',
    '{ "roleAssessment": string }  // one concise paragraph covering each option by key',
  ].join('\n');
}

export function REVIEWER_PROMPT(params: { loName: string; question: GeneratorOutput }): string {
  return [
    'You are a senior finance instructor reviewing a generated practice question for the',
    `LO "${params.loName}". Judge it against these five criteria (IN-Q05):`,
    '  1. Factual accuracy — every statement is correct.',
    '  2. Calculation correctness — any numbers/formulas check out.',
    '  3. LO & material alignment — it tests this LO and is grounded in the material.',
    '  4. Distractor quality — wrong options are plausible and pedagogically useful.',
    '  5. Clarity — the stem and options are unambiguous.',
    '',
    'Question JSON:',
    JSON.stringify(params.question),
    '',
    'Decide: "pass" (ready for instructor approval), "flag" (usable but needs attention),',
    'or "reject" (do not use). Respond with ONLY this JSON shape:',
    '{ "decision": "pass"|"flag"|"reject", "reasoning": string }',
  ].join('\n');
}
