import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseStudent } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { selectNextQuestion, studentCourseHome } from '../services/serving.service';
import { submitAttempt, getCourseIdForQuestionVersion, getSessionSummary } from '../services/attempts.service';
import { recordSkip } from '../services/mastery.service';
import type { PracticeMode } from '../types/domain';

// -----------------------------------------------------------------------------
// Practice/attempt endpoints (Task 11, ST-P04, ST-R01), exactly as specified
// in the core doc's Task 11 Interfaces. Every route is student-guarded via
// ensureCourseStudent() (Saurav's course-guards.ts) — no new auth logic here.
//
// Security-relevant: `/practice/next`'s response is built field-by-field
// (never `res.json(selectResult)` or similar) so it can never carry `role`,
// `explanation`, or correctness — only `{ key, text }` per option, plus
// `watermark: user.uid`. See tests/unit/practice.routes.test.ts's full-JSON-
// tree-walk test, which guards this even against a future field addition.
// -----------------------------------------------------------------------------

export const practiceRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });
const courseIdLoIdParams = z.object({ courseId: objectIdParam, loId: objectIdParam });

const PRACTICE_MODES = ['topic-practice', 'review-book', 'exam-prep'] as const satisfies readonly PracticeMode[];

const practiceNextBody = z.object({
  loId: objectIdParam,
  sessionServedIds: z.array(objectIdParam).optional().default([]),
});

const submitAttemptBody = z.object({
  questionVersionId: objectIdParam,
  loId: objectIdParam,
  mode: z.enum(PRACTICE_MODES),
  selectedKey: z.string().min(1),
  sessionServedIds: z.array(objectIdParam).optional().default([]),
  isRetry: z.boolean().optional(),
  paramValues: z.record(z.string(), z.number()).optional(),
});

const skipBody = z.object({ attempted: z.boolean().optional().default(false) });

/**
 * Resolves `res.locals.courseId` from the submitted `questionVersionId`
 * before `ensureCourseStudent()` runs — `POST /api/attempts` has no
 * `:courseId` in its path. Mirrors questions.routes.ts's
 * `stashCourseIdFromQuestion`. A questionVersionId that resolves to no
 * course 404s here, before the guard, matching that same file's documented
 * existence-oracle tradeoff for child-resource routes.
 */
function stashCourseIdFromQuestionVersion(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const { questionVersionId } = req.body as { questionVersionId: string };
    getCourseIdForQuestionVersion(new ObjectId(questionVersionId))
      .then((courseId) => {
        if (!courseId) {
          res.status(404).json({ error: 'question-not-servable' });
          return;
        }
        res.locals.courseId = courseId.toString();
        next();
      })
      .catch(next);
  };
}

// --- Serving --------------------------------------------------------------------

/** POST /api/courses/:courseId/practice/next { loId, sessionServedIds? } ->
 * sanitized question (no role/explanation/correctness) + watermark. */
practiceRouter.post(
  '/courses/:courseId/practice/next',
  validate({ params: courseIdParams }),
  ensureCourseStudent(),
  validate({ body: practiceNextBody }),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const body = req.body as z.infer<typeof practiceNextBody>;

    const result = await selectNextQuestion({
      puid: req.user!.puid,
      courseId,
      loId: new ObjectId(body.loId),
      sessionServedIds: body.sessionServedIds.map((id) => new ObjectId(id)),
    });

    if (!result) {
      res.status(404).json({ error: 'no-question-available' });
      return;
    }

    res.json({
      questionId: result.question._id.toString(),
      questionVersionId: result.version._id.toString(),
      type: result.version.type,
      stem: result.version.stem,
      difficulty: result.version.difficulty,
      degraded: result.degraded,
      options: result.version.options.map((o) => ({ key: o.key, text: o.text })),
      watermark: req.user!.uid,
    });
  },
);

// --- Attempts ---------------------------------------------------------------

/** POST /api/attempts { questionVersionId, loId, mode, selectedKey, ... } ->
 * AttemptResult. Course-scoped student guard resolved from the question. */
practiceRouter.post(
  '/attempts',
  validate({ body: submitAttemptBody }),
  stashCourseIdFromQuestionVersion(),
  ensureCourseStudent(),
  async (req, res) => {
    const body = req.body as z.infer<typeof submitAttemptBody>;
    const result = await submitAttempt({
      user: req.user!,
      questionVersionId: new ObjectId(body.questionVersionId),
      loId: new ObjectId(body.loId),
      mode: body.mode,
      selectedKey: body.selectedKey,
      sessionServedIds: body.sessionServedIds.map((id) => new ObjectId(id)),
      ...(body.isRetry !== undefined ? { isRetry: body.isRetry } : {}),
      ...(body.paramValues !== undefined ? { paramValues: body.paramValues } : {}),
    });
    res.json(result);
  },
);

// --- Skip ---------------------------------------------------------------------

/** POST /api/courses/:courseId/los/:loId/skip { attempted? } -> 204. (ST-P06) */
practiceRouter.post(
  '/courses/:courseId/los/:loId/skip',
  validate({ params: courseIdLoIdParams }),
  ensureCourseStudent(),
  validate({ body: skipBody }),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const loId = new ObjectId(String(req.params.loId));
    const { attempted } = req.body as z.infer<typeof skipBody>;
    await recordSkip(req.user!.puid, courseId, loId, attempted);
    res.status(204).end();
  },
);

// --- Home / session summary ------------------------------------------------------

/** GET /api/courses/:courseId/home -> studentCourseHome (ST-P01/P02). */
practiceRouter.get(
  '/courses/:courseId/home',
  validate({ params: courseIdParams }),
  ensureCourseStudent(),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const home = await studentCourseHome(req.user!.puid, courseId);
    res.json(home);
  },
);

/** GET /api/courses/:courseId/session-summary -> last session's attempts
 * grouped by LO. See getSessionSummary's docstring: a placeholder session
 * boundary pending Task 12's real session model. */
practiceRouter.get(
  '/courses/:courseId/session-summary',
  validate({ params: courseIdParams }),
  ensureCourseStudent(),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const summary = await getSessionSummary(req.user!.puid, courseId);
    res.json(summary);
  },
);

// --- Error normalization -----------------------------------------------------

const PRACTICE_ERROR_STATUS: Record<string, number> = {
  'question-not-servable': 404,
  'invalid-selected-key': 400,
};

practiceRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && Object.hasOwn(PRACTICE_ERROR_STATUS, err.message)) {
    res.status(PRACTICE_ERROR_STATUS[err.message]).json({ error: err.message });
    return;
  }
  next(err);
});
