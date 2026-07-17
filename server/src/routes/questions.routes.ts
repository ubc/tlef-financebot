import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  browseBank,
  reviewQueue,
  getQuestionCourseId,
  getDistinctQuestionCourseIds,
  getQuestionDetail,
  type BankItem,
} from '../services/bank.service';
import { editQuestion, transitionQuestion, bulkTransition } from '../services/questions.service';
import type { Question } from '../types/domain';

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

const PUBLICATION_STATES = ['draft', 'pending-review', 'reviewed', 'approved', 'paused', 'archived'] as const;
const QUESTION_TYPES = ['mcq', 'true-false'] as const;
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const QUESTION_LABELS = [
  'source-changed',
  'student-flagged',
  'convertible-to-parameterized',
  'auto-converted',
  'manually-edited',
] as const;
const OPTION_ROLES = ['correct', 'common-misconception', 'partially-correct', 'clearly-wrong'] as const;

const browseQuery = z.object({
  state: z.enum(PUBLICATION_STATES).optional(),
  loId: objectIdParam.optional(),
  themeId: objectIdParam.optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  label: z.enum(QUESTION_LABELS).optional(),
  // Plain z.coerce.boolean() would treat the string "false" as truthy
  // (Boolean("false") === true) — an easy footgun for a query-string flag.
  includeArchived: z.enum(['true', 'false']).optional(),
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

const patchQuestionBody = z.object({
  stem: z.string().min(1).optional(),
  options: z.array(optionBody).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  loIds: z.array(objectIdParam).optional(),
  themeIds: z.array(objectIdParam).optional(),
});

const transitionBody = z.object({ to: z.enum(PUBLICATION_STATES) });

const bulkTransitionBody = z.object({
  questionIds: z.array(objectIdParam).min(1),
  to: z.enum(PUBLICATION_STATES),
});

/**
 * Resolve `res.locals.courseId` from the question a child route targets,
 * before the course-instructor guard runs — see course-guards.ts's
 * `requestCourseId` and courses.routes.ts's `stashCourseIdFromTheme`.
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
 * "ids exist but span courses" from the status code alone.
 */
function stashCourseIdFromBulk(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const ids = (req.body.questionIds as string[]).map((id) => new ObjectId(id));
    getDistinctQuestionCourseIds(ids)
      .then((courseIds) => {
        if (courseIds.length !== 1) {
          res.status(403).json({ error: 'questions-span-multiple-courses' });
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
 * See docs/api-contract.md's Question bank section. */
function toBankItem(item: BankItem): {
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

/** Same id-mapping for a bare (non-joined) Question head, e.g. the
 * transition response. */
function toQuestionResponse(question: WithId<Question>): Record<string, unknown> {
  const { _id, ...rest } = question;
  return { id: _id.toString(), ...rest };
}

// --- Browse / review queue ----------------------------------------------------

/** GET /api/courses/:courseId/questions?state=&loId=&themeId=&type=&difficulty=&label= -> { total, questions }. Instructor-only. (IN-Q08) */
questionsRouter.get(
  '/courses/:courseId/questions',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
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
      ...(q.includeArchived !== undefined ? { includeArchived: q.includeArchived === 'true' } : {}),
    });
    res.json({ total, questions: questions.map(toBankItem) });
  },
);

/** GET /api/courses/:courseId/review-queue -> prioritized list. Instructor-only. (IN-Q02) */
questionsRouter.get(
  '/courses/:courseId/review-queue',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const queue = await reviewQueue(courseId);
    res.json(queue.map((item) => ({ ...toBankItem(item), priority: item.priority })));
  },
);

// --- Single question -----------------------------------------------------------

/** GET /api/questions/:questionId -> full question + current version + agentDecision + notes + versions. Instructor-only. */
questionsRouter.get(
  '/questions/:questionId',
  validate({ params: questionIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromQuestion(),
  ensureCourseInstructor(),
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
  ensureCourseInstructor(),
  validate({ body: patchQuestionBody }),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const body = req.body as z.infer<typeof patchQuestionBody>;
    const version = await editQuestion(
      questionId,
      {
        ...(body.stem !== undefined ? { stem: body.stem } : {}),
        ...(body.options !== undefined ? { options: body.options } : {}),
        ...(body.difficulty !== undefined ? { difficulty: body.difficulty } : {}),
        ...(body.loIds !== undefined ? { loIds: body.loIds.map((id) => new ObjectId(id)) } : {}),
        ...(body.themeIds !== undefined ? { themeIds: body.themeIds.map((id) => new ObjectId(id)) } : {}),
      },
      req.user!.puid,
    );
    res.json(version);
  },
);

/** POST /api/questions/:questionId/transition { to } -> question. Instructor-only. (IN-Q04/Q07) */
questionsRouter.post(
  '/questions/:questionId/transition',
  validate({ params: questionIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromQuestion(),
  ensureCourseInstructor(),
  validate({ body: transitionBody }),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const { to } = req.body as z.infer<typeof transitionBody>;
    const updated = await transitionQuestion(questionId, to, req.user!.puid);
    res.json(toQuestionResponse(updated as WithId<Question>));
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
  ensureCourseInstructor(),
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
