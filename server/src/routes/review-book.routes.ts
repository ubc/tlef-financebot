import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseStudent } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { getQuestionCourseId } from '../services/bank.service';
import { toggleBookmark, removeEntry, listReviewBook, type ReviewBookSort } from '../services/review-book.service';

// -----------------------------------------------------------------------------
// Review Book endpoints (Task 12, ST-R02..R05): browsing and bookmarking, per
// the core doc's Task 12 Interfaces. `/questions/:questionId/bookmark` has no
// `:courseId` in its path, so — mirroring questions.routes.ts's
// `stashCourseIdFromQuestion` and practice.routes.ts's
// `stashCourseIdFromQuestionVersion` — it's looked up and stashed to
// `res.locals.courseId` before `ensureCourseStudent()` runs.
// `DELETE /api/review-book/:entryId` is student-authenticated only (no course
// in path); ownership is enforced inside `removeEntry()` by scoping the
// delete to the caller's `puid`, so no course-role check is needed here.
// -----------------------------------------------------------------------------

export const reviewBookRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });
const questionIdParams = z.object({ questionId: objectIdParam });
const entryIdParams = z.object({ entryId: objectIdParam });
const reviewBookQuery = z.object({ sort: z.enum(['theme', 'date']).optional().default('theme') });

/** Resolves `res.locals.courseId` from `:questionId` before
 * `ensureCourseStudent()` runs — the bookmark routes have no `:courseId` in
 * their path. */
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

/** GET /api/courses/:courseId/review-book?sort=theme|date -> theme-grouped
 * entries (ST-R04/R05). */
reviewBookRouter.get(
  '/courses/:courseId/review-book',
  validate({ params: courseIdParams, query: reviewBookQuery }),
  ensureCourseStudent(),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const { sort } = req.query as z.infer<typeof reviewBookQuery>;
    const groups = await listReviewBook(req.user!.puid, courseId, sort as ReviewBookSort);
    res.json(groups);
  },
);

/** POST /api/questions/:questionId/bookmark -> { bookmarked: true } (ST-R02). */
reviewBookRouter.post(
  '/questions/:questionId/bookmark',
  validate({ params: questionIdParams }),
  stashCourseIdFromQuestion(),
  ensureCourseStudent(),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const courseId = new ObjectId(String(res.locals.courseId));
    const result = await toggleBookmark(req.user!.puid, courseId, questionId);
    res.json(result);
  },
);

/** DELETE /api/questions/:questionId/bookmark -> { bookmarked: false } (ST-R02). */
reviewBookRouter.delete(
  '/questions/:questionId/bookmark',
  validate({ params: questionIdParams }),
  stashCourseIdFromQuestion(),
  ensureCourseStudent(),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const courseId = new ObjectId(String(res.locals.courseId));
    const result = await toggleBookmark(req.user!.puid, courseId, questionId);
    res.json(result);
  },
);

/** DELETE /api/review-book/:entryId -> 204 (ST-R03). Never touches
 * attemptRecords; scoped to the caller via puid inside removeEntry(). */
reviewBookRouter.delete(
  '/review-book/:entryId',
  validate({ params: entryIdParams }),
  ensureApiAuthenticated(),
  async (req, res) => {
    const entryId = new ObjectId(String(req.params.entryId));
    await removeEntry(req.user!.puid, entryId);
    res.status(204).end();
  },
);

// --- Error normalization -----------------------------------------------------

const REVIEW_BOOK_ERROR_STATUS: Record<string, number> = {
  'no-attempt-context': 409,
};

reviewBookRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && Object.hasOwn(REVIEW_BOOK_ERROR_STATUS, err.message)) {
    res.status(REVIEW_BOOK_ERROR_STATUS[err.message]).json({ error: err.message });
    return;
  }
  next(err);
});
