import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseStudent } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { selectNextQuestion, studentCourseHome } from '../services/serving.service';
import { submitAttempt, getCourseIdForQuestionVersion } from '../services/attempts.service';
import { resolveParamValues, substituteParams, drawSeed } from '../services/params.service';
import { recordSkip } from '../services/mastery.service';
import { storeDeferredSummary, getSessionSummaryForStart } from '../services/review-book.service';
import { getRedirectMaterialSource } from '../services/progression.service';
import { getCourse } from '../services/courses.service';
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
const courseIdLoIdMaterialIdParams = z.object({
  courseId: objectIdParam,
  loId: objectIdParam,
  materialId: objectIdParam,
});

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

const deferredSummaryBody = z.object({ since: z.coerce.date() });

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

/** Archived courses remain instructor-readable, but cannot serve or record
 * student practice. This runs after the course-role guard, so it never exposes
 * lifecycle state to a caller without course access. */
function ensureCoursePracticeAvailable(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const rawCourseId =
    (req.params as { courseId?: string }).courseId ??
    (res.locals.courseId as string | undefined);
  if (!rawCourseId) {
    next(new Error('course-not-found'));
    return;
  }
  getCourse(new ObjectId(rawCourseId))
    .then((course) => {
      if (course.lifecycle === 'archived') {
        res.status(403).json({ error: 'course-archived' });
        return;
      }
      next();
    })
    .catch(next);
}

// --- Serving --------------------------------------------------------------------

/** POST /api/courses/:courseId/practice/next { loId, sessionServedIds? } ->
 * sanitized question (no role/explanation/correctness) + watermark. */
practiceRouter.post(
  '/courses/:courseId/practice/next',
  validate({ params: courseIdParams }),
  ensureCourseStudent(),
  ensureCoursePracticeAvailable,
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

    // Fresh seed on every serve (ST-P03 draws the values here, once, then
    // they are pinned for the whole attempt; ST-R04's "fresh seed on
    // re-practice" falls out for free — see drawSeed()'s doc comment).
    // `undefined` for a conceptual (non-parameterized) question — `stem`/
    // `options` then pass through unsubstituted, and `paramValues`/`seed`
    // are omitted from the response entirely rather than sent as `undefined`.
    const seed = drawSeed();
    const paramValues = await resolveParamValues(result.version, seed);

    res.json({
      questionId: result.question._id.toString(),
      questionVersionId: result.version._id.toString(),
      type: result.version.type,
      stem: paramValues ? substituteParams(result.version.stem, paramValues) : result.version.stem,
      difficulty: result.version.difficulty,
      degraded: result.degraded,
      options: result.version.options.map((o) => ({
        key: o.key,
        text: paramValues ? substituteParams(o.text, paramValues) : o.text,
      })),
      watermark: req.user!.uid,
      ...(paramValues !== undefined ? { paramValues, seed } : {}),
    });
  },
);

/** A real target for Task 7's redirect material links. Only ready materials
 * assigned to this exact LO are exposed, and course enrollment is enforced
 * before the source is resolved. URL materials redirect to their source;
 * uploaded files are downloaded under their instructor-supplied name. */
practiceRouter.get(
  '/courses/:courseId/los/:loId/materials/:materialId/source',
  validate({ params: courseIdLoIdMaterialIdParams }),
  ensureCourseStudent(),
  ensureCoursePracticeAvailable,
  async (req, res, next) => {
    const source = await getRedirectMaterialSource(
      new ObjectId(String(req.params.courseId)),
      new ObjectId(String(req.params.loId)),
      new ObjectId(String(req.params.materialId)),
    );
    if (!source) {
      res.status(404).json({ error: 'material-not-found' });
      return;
    }
    if (source.kind === 'url') {
      res.redirect(source.url);
      return;
    }
    res.download(source.path, source.downloadName, (error) => {
      if (error) next(error);
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
  ensureCoursePracticeAvailable,
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
  ensureCoursePracticeAvailable,
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
  ensureCoursePracticeAvailable,
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const home = await studentCourseHome(req.user!.puid, courseId);
    res.json(home);
  },
);

/** GET /api/courses/:courseId/session-summary -> { deferred?, welcome }
 * (ST-P10/P11, Task 12's real session model: a session = attempts since a
 * client-provided `since` timestamp; `welcome: true` when the student has no
 * attempts in the course yet). */
practiceRouter.get(
  '/courses/:courseId/session-summary',
  validate({ params: courseIdParams }),
  ensureCourseStudent(),
  ensureCoursePracticeAvailable,
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const summary = await getSessionSummaryForStart(req.user!.puid, courseId);
    res.json(summary);
  },
);

/** PUT /api/courses/:courseId/deferred-summary { since } -> the computed
 * SessionEndSummary. Stores (overwrites) the student's deferred end-of-
 * session summary for this course (ST-P10), to be surfaced by
 * GET .../session-summary at the start of their next session. */
practiceRouter.put(
  '/courses/:courseId/deferred-summary',
  validate({ params: courseIdParams, body: deferredSummaryBody }),
  ensureCourseStudent(),
  ensureCoursePracticeAvailable,
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const { since } = req.body as z.infer<typeof deferredSummaryBody>;
    const summary = await storeDeferredSummary(req.user!.puid, courseId, since);
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
