import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated, ensureCapability } from '../components/auth';
import { NO_COURSE_ACCESS_BODY } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  browseBank,
  reviewQueue,
  getQuestionCourseId,
  getDistinctQuestionCourseIds,
  getQuestionDetail,
  type BankItem,
} from '../services/bank.service';
import {
  addQuestionInternalNote,
  editQuestion,
  transitionQuestion,
  bulkDeleteUnserved,
  bulkTransition,
} from '../services/questions.service';
import {
  resolveParamValues,
  substituteParams,
  findUnusedParamSlots,
  drawSeed,
  drawQuestionSample,
  stableSeedsForId,
  type QuestionSampleDraw,
} from '../services/params.service';
import {
  optionValueNamesForVerification,
  verifyQuestionNumerics,
} from '../services/numeric-verification.service';
import type { Question, PublicationState, QuestionType, Difficulty, QuestionLabel, OptionRole, ParamSlot, DerivedValue, NumericVerification } from '../types/domain';

// Question bank endpoints (IN-Q02, IN-Q05, IN-Q08) — the instructor-facing
// browse/filter, review-queue, editing, and publication-transition surface,
// exactly as specified in docs/api-contract.md ("Question bank" section).
// Every route is instructor-only; routes with no `:courseId` in their path
// look the question up first and stash `res.locals.courseId` before
// `ensureCourseInstructor()` runs, mirroring routes/courses.routes.ts's
// Theme/LO pattern.
export const questionsRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });
const questionIdParams = z.object({ questionId: objectIdParam });

// `satisfies readonly <Union>[]` checks these local lists against domain.ts's
// unions at compile time, but only in one direction: it catches an entry here
// that ISN'T a valid union member (typo, stale value after a domain rename).
// It does NOT catch an omission — a new member added to the domain union
// (e.g. a 7th PublicationState) that never gets added here would compile
// fine and just silently 400 at runtime. `assertExhaustive<...>()` below each
// list closes that gap: its type parameter is constrained to `never`, so
// passing the set of union members missing from the list (via `Exclude`)
// fails to satisfy that constraint — and fails the build — unless the list
// covers every member.
/** Type-only assertion: fails to compile unless `T` is `never`. Call with an
 * explicit `Exclude<Union, ListMembers>` type argument and no runtime args. */
function assertExhaustive<T extends never>(_marker?: T): void {
  // No runtime behavior — the type parameter's `extends never` constraint is
  // the entire check, enforced at each call site below.
}

const PUBLICATION_STATES = [
  'draft',
  'pending-review',
  'reviewed',
  'approved',
  'paused',
  'archived',
] as const satisfies readonly PublicationState[];
assertExhaustive<Exclude<PublicationState, (typeof PUBLICATION_STATES)[number]>>();

const QUESTION_TYPES = ['mcq', 'true-false'] as const satisfies readonly QuestionType[];
assertExhaustive<Exclude<QuestionType, (typeof QUESTION_TYPES)[number]>>();

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const satisfies readonly Difficulty[];
assertExhaustive<Exclude<Difficulty, (typeof DIFFICULTIES)[number]>>();

const QUESTION_LABELS = [
  'source-changed',
  'student-flagged',
  'convertible-to-parameterized',
  'auto-converted',
  'manually-edited',
] as const satisfies readonly QuestionLabel[];
assertExhaustive<Exclude<QuestionLabel, (typeof QUESTION_LABELS)[number]>>();

const OPTION_ROLES = [
  'correct',
  'common-misconception',
  'partially-correct',
  'clearly-wrong',
] as const satisfies readonly OptionRole[];
assertExhaustive<Exclude<OptionRole, (typeof OPTION_ROLES)[number]>>();

// `includeArchived` is deliberately NOT part of this schema — the contract
// (docs/api-contract.md line 47) lists only state/loId/themeId/type/
// difficulty/label as the browse query surface, and the endpoint must match
// it exactly. Nothing is lost: `state=archived` still reaches archived
// questions per browseBank's rule. `includeArchived` stays in browseBank's
// service signature (the brief mandates it; Task 15 may call it directly).
const browseQuery = z.object({
  state: z.enum(PUBLICATION_STATES).optional(),
  loId: objectIdParam.optional(),
  themeId: objectIdParam.optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  label: z.enum(QUESTION_LABELS).optional(),
});

// Element shape only — the count-vs-type rule (4 for mcq, 2 for true-false,
// exactly one `correct`) is enforced by questions.service's
// assertOptionInvariants, which throws `invalid-options:<reason>` mapped to
// 400 below. Duplicating the count rule here would let zod and the service
// disagree on a type it can't see (the question's existing, unpatchable type).
const optionBody = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  role: z.enum(OPTION_ROLES),
  explanation: z.string(),
});

const basePatchQuestionBody = z.object({
  stem: z.string().min(1).optional(),
  options: z.array(optionBody).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  loIds: z.array(objectIdParam).optional(),
  themeIds: z.array(objectIdParam).optional(),
});

// Task 5 (IN-Q09): a ParamSlot's shape as a request body — matches
// domain.ts's ParamSlot exactly (name required; min/max/step/values all
// optional, resolveParamValues in params.service.ts tolerates whichever
// subset is present).
const paramSlotBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  values: z.array(z.number()).optional(),
});

// A derived value's name becomes a `{{name}}` placeholder and a formula
// variable, so it must be a plain identifier — anything else could not be
// referenced from a formula even if it were stored.
const derivedValueBody = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  formula: z.string().min(1),
  errorModel: z.string().optional(),
});

// Regeneration replacement must save its generated templates and proof in the
// SAME version as the new stem/options. A two-request edit-then-params flow
// briefly exposes an approved placeholder template without its gate metadata.
const patchQuestionBody = basePatchQuestionBody.extend({
  paramSlots: z.array(paramSlotBody).optional(),
  derivedValues: z.array(derivedValueBody).optional(),
  numericKind: z.enum(['numeric', 'conceptual']).optional(),
});

const patchQuestionParamsBody = z.object({
  paramSlots: z.array(paramSlotBody).optional(),
  derivedValues: z.array(derivedValueBody).optional(),
  numericKind: z.enum(['numeric', 'conceptual']).optional(),
  generateScript: z.string().optional(),
});

// `stem` is optional here (unlike patchQuestionParamsBody, which never
// carries stem) — the preview endpoint needs it only to render substituted
// preview text; when omitted it falls back to the question's currently-saved
// stem (see the route below).
const previewQuestionParamsBody = z.object({
  paramSlots: z.array(paramSlotBody).optional(),
  // Derived values are previewed too: without them the draws would show only
  // the raw slot values and none of the computed answers, which is the part an
  // instructor most needs to eyeball.
  derivedValues: z.array(derivedValueBody).optional(),
  generateScript: z.string().optional(),
  stem: z.string().optional(),
});

function verifyOptionFormulas(
  options: Array<{ text: string }>,
  slots: ParamSlot[],
  derivedValues: DerivedValue[],
  numericKind: 'numeric' | 'conceptual' | undefined,
): { verification?: NumericVerification; verificationError?: string } {
  if (numericKind === 'conceptual') return {};
  if (derivedValues.length === 0) {
    return numericKind === 'numeric'
      ? { verificationError: 'A numerical question needs computed values for every option.' }
      : {};
  }

  const optionValues = optionValueNamesForVerification(
    options.map((option) => option.text),
    derivedValues.map((derived) => derived.name),
  );
  if (!optionValues.ok) return { verificationError: optionValues.error };

  const result = verifyQuestionNumerics({
    slots,
    derivedValues,
    optionValueNames: optionValues.names,
  });
  if (result.ok) return { verification: result.verification };
  return {
    verificationError: result.failingSeed !== undefined
      ? `${result.error} (seed ${result.failingSeed})`
      : result.error,
  };
}

const transitionBody = z.object({
  to: z.enum(PUBLICATION_STATES),
  expectedVersionId: objectIdParam.optional(),
});
const internalNoteBody = z.object({ text: z.string().trim().min(1).max(2000) });

const bulkTransitionBody = z.object({
  questionIds: z.array(objectIdParam).min(1),
  to: z.enum(PUBLICATION_STATES),
});
const bulkDeleteBody = z.object({ questionIds: z.array(objectIdParam).min(1) });

/**
 * Resolve `res.locals.courseId` from the question a child route targets,
 * before the course-instructor guard runs — see course-guards.ts's
 * `requestCourseId` and courses.routes.ts's `stashCourseIdFromTheme`.
 *
 * Known, deliberate convention (not a bug to "fix" here): because this 404
 * runs before `ensureCourseInstructor()`, an authenticated non-instructor can
 * distinguish an existing question id (403) from a nonexistent one (404) —
 * a 404-before-guard existence oracle. This mirrors `courses.routes.ts`'s
 * Theme/LO loaders (see `stashCourseIdFromTheme` there) and is already
 * shipped for themes/LOs on main. Whether this should hold app-wide is a
 * Phase-1 whole-branch review decision, not a per-task one — do not change
 * this ordering piecemeal.
 */
function stashCourseIdFromQuestion(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    getQuestionCourseId(new ObjectId(String(req.params.questionId)))
      .then((courseId) => {
        if (!courseId) {
          res.status(404).json({ error: 'question-not-found' });
          return;
        }
        res.locals.courseId = courseId.toString();
        next();
      })
      .catch(next);
  };
}

/**
 * bulk-transition's loader (decision, human-approved by Saurav): the body
 * has no single courseId — it's a set of question ids that could span
 * courses, and `ensureCourseInstructor()` only ever checks one course.
 * Naively stashing the first question's courseId would let an instructor of
 * course A transition course B's questions. Instead: load the questions,
 * collect the distinct courseIds of the ones found, and require exactly
 * one. 403 (not 400) for the mixed/none case so the endpoint isn't an
 * existence oracle — a caller can't distinguish "some ids don't exist" from
 * "ids exist but span courses" from the status code alone. That 403 also
 * returns the exact same generic body `ensureCourseInstructor()` returns
 * (NO_COURSE_ACCESS_BODY) rather than a distinguishing message — otherwise a
 * caller could tell "single id, no access" apart from "ids span courses" by
 * response body even though both are 403, which is the same oracle problem
 * one level up.
 */
function stashCourseIdFromBulk(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const ids = (req.body.questionIds as string[]).map((id) => new ObjectId(id));
    getDistinctQuestionCourseIds(ids)
      .then((courseIds) => {
        if (courseIds.length !== 1) {
          res.status(403).json(NO_COURSE_ACCESS_BODY);
          return;
        }
        res.locals.courseId = courseIds[0].toString();
        next();
      })
      .catch(next);
  };
}

/** Contract shape: `{ id, state, labels, loIds, themeIds, current }` — not the
 * service's `_id`, and deliberately not the rest of the Question head
 * (agentDecision/internalNotes are reserved for the single-question GET).
 * See docs/api-contract.md's Question bank section.
 *
 * Serialization rule (confirmed, deliberate): Question heads serialize as
 * `id`; QuestionVersions serialize raw with their own `_id` — this is why
 * PATCH returning a raw QuestionVersion below is correct and must not be
 * "fixed" to an `id` mapping later. */
export function toBankItem(item: BankItem): {
  id: string;
  state: BankItem['state'];
  labels: BankItem['labels'];
  loIds: BankItem['loIds'];
  themeIds: BankItem['themeIds'];
  current: BankItem['current'];
} {
  return {
    id: item._id.toString(),
    state: item.state,
    labels: item.labels,
    loIds: item.loIds,
    themeIds: item.themeIds,
    current: item.current,
  };
}

/**
 * The list-row student preview: the same drawn sample the detail page shows,
 * attached to every row so the queue and bank can render what a student sees
 * instead of a `{{PLACEHOLDER}}` template nobody can read.
 *
 * Two deliberate restrictions, both about cost:
 *
 * 1. `generateScript` versions are SKIPPED. Resolving one spawns a real
 *    worker_threads worker (param-worker/index.ts) — fine for one detail page,
 *    ruinous for a bank list that would spawn one per row on every load, and up
 *    to SERVE_DRAW_ATTEMPTS times that when the collision guard rerolls. Those
 *    rows fall back to the template, exactly as today. Slot/derived questions —
 *    which is everything the generator produces — are pure arithmetic on a
 *    version the query already loaded, so they cost no I/O at all.
 * 2. The seed is STABLE per question (`stableSeedsForId`), so a row shows the
 *    same numbers on every load. See that function for why.
 *
 * `undefined` means "no preview available" and the client keeps rendering the
 * template — the preview is an aid, never a gate.
 */
async function sampleForList(item: BankItem): Promise<QuestionSampleDraw | undefined> {
  if (item.current.generateScript) return undefined;
  try {
    return await drawQuestionSample(item.current, stableSeedsForId(item._id.toString()));
  } catch {
    return undefined;
  }
}

/** `toBankItem` plus the student preview. Separate from `toBankItem` because
 * that one is a documented pure field-pick used by non-list responses too. */
export async function toBankItemWithSample(item: BankItem): Promise<ReturnType<typeof toBankItem> & { sample?: QuestionSampleDraw }> {
  const sample = await sampleForList(item);
  return { ...toBankItem(item), ...(sample ? { sample } : {}) };
}

/** Same id-mapping for a bare (non-joined) Question head, e.g. the
 * transition response. */
export function toQuestionResponse(question: WithId<Question>): Record<string, unknown> {
  const { _id, ...rest } = question;
  return { id: _id.toString(), ...rest };
}

// --- Browse / review queue ----------------------------------------------------

/** GET /api/courses/:courseId/questions?state=&loId=&themeId=&type=&difficulty=&label= -> { total, questions }. Instructor-only. (IN-Q08) */
questionsRouter.get(
  '/courses/:courseId/questions',
  validate({ params: courseIdParams }),
  ensureCapability('question.review'),
  validate({ query: browseQuery }),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const q = req.query as z.infer<typeof browseQuery>;
    const { total, questions } = await browseBank(courseId, {
      ...(q.state !== undefined ? { state: q.state } : {}),
      ...(q.loId !== undefined ? { loId: new ObjectId(q.loId) } : {}),
      ...(q.themeId !== undefined ? { themeId: new ObjectId(q.themeId) } : {}),
      ...(q.type !== undefined ? { type: q.type } : {}),
      ...(q.difficulty !== undefined ? { difficulty: q.difficulty } : {}),
      ...(q.label !== undefined ? { label: q.label } : {}),
    });
    res.json({ total, questions: await Promise.all(questions.map(toBankItemWithSample)) });
  },
);

/** GET /api/courses/:courseId/review-queue -> prioritized list. Instructor-only. (IN-Q02) */
questionsRouter.get(
  '/courses/:courseId/review-queue',
  validate({ params: courseIdParams }),
  ensureCapability('question.review'),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const queue = await reviewQueue(courseId);
    res.json(await Promise.all(
      queue.map(async (item) => ({ ...(await toBankItemWithSample(item)), priority: item.priority })),
    ));
  },
);

// --- Single question -----------------------------------------------------------

/** GET /api/questions/:questionId -> full question + current version + agentDecision + notes + versions. Instructor-only. */
questionsRouter.get(
  '/questions/:questionId',
  validate({ params: questionIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromQuestion(),
  ensureCapability('question.review'),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const { question, current, versions } = await getQuestionDetail(questionId);
    res.json({ ...toQuestionResponse(question), current, versions });
  },
);

/** PATCH /api/questions/:questionId { stem?, options?, difficulty?, loIds?, themeIds? } -> new/unchanged QuestionVersion. Instructor-only. (IN-Q03) */
questionsRouter.patch(
  '/questions/:questionId',
  validate({ params: questionIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromQuestion(),
  ensureCapability('question.approve'),
  validate({ body: patchQuestionBody }),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const body = req.body as z.infer<typeof patchQuestionBody>;
    let verification: NumericVerification | undefined;
    let verificationError: string | undefined;
    if (
      body.paramSlots !== undefined
      || body.derivedValues !== undefined
      || body.numericKind !== undefined
    ) {
      const { current } = await getQuestionDetail(questionId);
      ({ verification, verificationError } = verifyOptionFormulas(
        body.options ?? current.options,
        (body.paramSlots ?? current.paramSlots ?? []) as ParamSlot[],
        (body.derivedValues ?? current.derivedValues ?? []) as DerivedValue[],
        body.numericKind ?? current.numericKind,
      ));
    }
    const version = await editQuestion(
      questionId,
      {
        ...(body.stem !== undefined ? { stem: body.stem } : {}),
        ...(body.options !== undefined ? { options: body.options } : {}),
        ...(body.difficulty !== undefined ? { difficulty: body.difficulty } : {}),
        ...(body.paramSlots !== undefined ? { paramSlots: body.paramSlots } : {}),
        ...(body.derivedValues !== undefined ? { derivedValues: body.derivedValues } : {}),
        ...(body.numericKind !== undefined ? { numericKind: body.numericKind } : {}),
        ...(body.loIds !== undefined ? { loIds: body.loIds.map((id) => new ObjectId(id)) } : {}),
        ...(body.themeIds !== undefined ? { themeIds: body.themeIds.map((id) => new ObjectId(id)) } : {}),
        ...(verification !== undefined ? { verification } : {}),
      },
      req.user!.puid,
    );
    res.json({ ...version, ...(verificationError !== undefined ? { verificationError } : {}) });
  },
);

/** POST /api/questions/:questionId/internal-notes { text } -> appended
 * teaching-team-only note. Notes are append-only and never student-visible. */
questionsRouter.post(
  '/questions/:questionId/internal-notes',
  validate({ params: questionIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromQuestion(),
  ensureCapability('question.review'),
  validate({ body: internalNoteBody }),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const { text } = req.body as z.infer<typeof internalNoteBody>;
    res.status(201).json(await addQuestionInternalNote(questionId, text, req.user!.puid));
  },
);

/**
 * PATCH /api/questions/:questionId/params { paramSlots?, generateScript? } ->
 * new/unchanged QuestionVersion. Instructor-only. Saves independently of
 * approval state (IN-Q09) — same guard shape as the generic PATCH above (no
 * question-state gate), just scoped to the two parameterization content keys.
 */
questionsRouter.patch(
  '/questions/:questionId/params',
  validate({ params: questionIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromQuestion(),
  ensureCapability('question.approve'),
  validate({ body: patchQuestionParamsBody }),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const body = req.body as z.infer<typeof patchQuestionParamsBody>;

    // R4: verify every formula-definition save, and never carry a proof forward. An edit that
    // fails verification must leave the question WITHOUT one, or the gate
    // would keep serving numbers the current formulas no longer produce.
    let verification: NumericVerification | undefined;
    let verificationError: string | undefined;
    if (
      body.paramSlots !== undefined
      || body.derivedValues !== undefined
      || body.numericKind !== undefined
    ) {
      const { current } = await getQuestionDetail(questionId);
      ({ verification, verificationError } = verifyOptionFormulas(
        current.options,
        (body.paramSlots ?? current.paramSlots ?? []) as ParamSlot[],
        (body.derivedValues ?? current.derivedValues ?? []) as DerivedValue[],
        body.numericKind ?? current.numericKind,
      ));
    }

    const version = await editQuestion(
      questionId,
      {
        ...(body.paramSlots !== undefined ? { paramSlots: body.paramSlots } : {}),
        ...(body.derivedValues !== undefined ? { derivedValues: body.derivedValues } : {}),
        ...(body.numericKind !== undefined ? { numericKind: body.numericKind } : {}),
        ...(body.generateScript !== undefined ? { generateScript: body.generateScript } : {}),
        // editQuestion clears the previous proof on every content edit; only a
        // freshly successful verification is allowed to replace it.
        ...(verification !== undefined ? { verification } : {}),
      },
      req.user!.puid,
    );
    res.json({ ...version, ...(verificationError !== undefined ? { verificationError } : {}) });
  },
);

/**
 * GET /api/questions/:questionId/sample -> `{ seed, stem, options: [{key, text}],
 * parameterized }`. Instructor-only, read-only, persists nothing.
 *
 * Renders ONE sample draw of the SAVED version so an instructor reviewing a
 * parameterized question sees what a student would actually see, rather than
 * the raw `{{PLACEHOLDER}}` template. Substitution (and therefore R3's
 * rounding) happens server-side so the example can never drift from the real
 * serve path.
 *
 * `parameterized: false` means the question has no slots or derived values, so
 * the sample is just the stored text — the caller can skip rendering an
 * example entirely.
 */
questionsRouter.get(
  '/questions/:questionId/sample',
  validate({ params: questionIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromQuestion(),
  ensureCapability('question.review'),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const { current } = await getQuestionDetail(questionId);

    // Collision-guarded, and drawn FRESH: the detail page is where varying
    // numbers are the point. List rows deliberately draw a STABLE sample
    // instead — see `sampleForList`. (The 5-draw diagnostic preview below is
    // left raw ON PURPOSE — its job is to show real draw behaviour, collisions
    // included, so an instructor can see what the verifier is complaining
    // about.)
    res.json(await drawQuestionSample(current));
  },
);

/**
 * POST /api/questions/:questionId/params/preview { paramSlots?, generateScript?, stem? }
 * -> `{ draws: [{ seed, values, stem? }] x5, warnings }`. Instructor-only.
 * Previews an EDIT-IN-PROGRESS candidate (the request body), never the
 * currently-saved version — so an instructor can preview draws before
 * saving. Never persists anything (no editQuestion() call); `stem` falls
 * back to the question's currently-saved stem when the body omits it, purely
 * so the response can show substituted preview text.
 */
questionsRouter.post(
  '/questions/:questionId/params/preview',
  validate({ params: questionIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromQuestion(),
  ensureCapability('question.approve'),
  validate({ body: previewQuestionParamsBody }),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const body = req.body as z.infer<typeof previewQuestionParamsBody>;

    let stem = body.stem;
    if (stem === undefined) {
      const { current } = await getQuestionDetail(questionId);
      stem = current.stem;
    }

    const candidate = {
      paramSlots: body.paramSlots as ParamSlot[] | undefined,
      derivedValues: body.derivedValues as DerivedValue[] | undefined,
      generateScript: body.generateScript,
    };

    // A formula error is EXPECTED here — preview is where an instructor
    // iterates on a half-written formula — so it becomes a warning rather than
    // a 500. resolveParamValues throws on a bad formula because reaching the
    // serving path with one is a bug; reaching preview with one is Tuesday.
    const draws = [];
    const formulaErrors = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const seed = drawSeed();
      let values: Record<string, number> | undefined;
      try {
        values = await resolveParamValues(candidate, seed);
      } catch (error) {
        formulaErrors.add((error as Error).message);
        values = undefined;
      }
      draws.push({
        seed,
        values: values ?? {},
        ...(values !== undefined ? { stem: substituteParams(stem, values) } : { stem }),
      });
    }

    const warnings = [
      ...(candidate.paramSlots ? findUnusedParamSlots(stem, candidate.paramSlots) : []),
      ...formulaErrors,
    ];

    res.json({ draws, warnings });
  },
);

/** POST /api/questions/:questionId/transition { to, expectedVersionId? } -> question.
 * Instructor-only. The optional version id prevents approving a version that
 * changed after the reviewer loaded it. (IN-Q04/Q07) */
questionsRouter.post(
  '/questions/:questionId/transition',
  validate({ params: questionIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromQuestion(),
  ensureCapability('question.approve'),
  validate({ body: transitionBody }),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const { to, expectedVersionId } = req.body as z.infer<typeof transitionBody>;
    const updated = expectedVersionId === undefined
      ? await transitionQuestion(questionId, to, req.user!.puid)
      : await transitionQuestion(questionId, to, req.user!.puid, new ObjectId(expectedVersionId));
    res.json(toQuestionResponse(updated));
  },
);

/**
 * POST /api/questions/bulk-delete { questionIds } -> { deleted, skipped }.
 * Hard-deletes never-served questions only (see bulkDeleteUnserved); guarded
 * exactly like bulk-transition, including the single-course resolution.
 */
questionsRouter.post(
  '/questions/bulk-delete',
  ensureApiAuthenticated(),
  validate({ body: bulkDeleteBody }),
  stashCourseIdFromBulk(),
  ensureCapability('question.approve'),
  async (req, res) => {
    const { questionIds } = req.body as z.infer<typeof bulkDeleteBody>;
    const result = await bulkDeleteUnserved(questionIds.map((id) => new ObjectId(id)), req.user!.puid);
    res.json({
      deleted: result.deleted,
      skipped: result.skipped.map((entry) => ({ questionId: entry.questionId.toHexString(), reason: entry.reason })),
    });
  },
);

/**
 * POST /api/questions/bulk-transition { questionIds, to } -> { updated }.
 * Instructor-only, scoped to the single course the batch resolves to (see
 * stashCourseIdFromBulk). Body validated BEFORE the DB lookup that needs it,
 * and auth runs before that lookup too, so an unauthenticated or malformed
 * request never triggers the distinct-courseIds query.
 */
questionsRouter.post(
  '/questions/bulk-transition',
  ensureApiAuthenticated(),
  validate({ body: bulkTransitionBody }),
  stashCourseIdFromBulk(),
  ensureCapability('question.approve'),
  async (req, res) => {
    const { questionIds, to } = req.body as z.infer<typeof bulkTransitionBody>;
    const updated = await bulkTransition(
      questionIds.map((id) => new ObjectId(id)),
      to,
      req.user!.puid,
    );
    res.json({ updated });
  },
);

// --- Error normalization -----------------------------------------------------

// Domain errors thrown by questions.service (plain `Error(message)`, per its
// contract) mapped to HTTP status here, matching courses.routes.ts's
// router-scoped normalizer pattern. Uses Object.hasOwn (not `in`, which walks
// the prototype chain — a Minor in Task 2's copy of this pattern). Anything
// unrecognized falls through to the central errorHandler (500) — including
// bulkTransition's propagated infrastructure errors, which must NOT be
// caught here as a domain error.
const QUESTION_ERROR_STATUS: Record<string, number> = {
  'question-not-found': 404,
  'version-not-found': 404,
  'question-conflict': 409,
};

questionsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error) {
    if (Object.hasOwn(QUESTION_ERROR_STATUS, err.message)) {
      res.status(QUESTION_ERROR_STATUS[err.message]).json({ error: err.message });
      return;
    }
    if (err.message.startsWith('invalid-transition:')) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err.message.startsWith('invalid-options:')) {
      res.status(400).json({ error: err.message });
      return;
    }
  }
  next(err);
});
