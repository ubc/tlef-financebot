import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  flagPreviewQuestion,
  getNextPreviewQuestion,
  getPreviewHome,
  getPreviewRedirectMaterialSource,
  getPreviewSessionStart,
  getPreviewSessionSummary,
  listPreviewReviewBook,
  removePreviewReviewBookEntry,
  skipPreviewLo,
  submitPreviewAttempt,
  togglePreviewBookmark,
} from '../services/preview.service';

export const previewRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const previewSessionId = z.string().uuid();
const courseParams = z.object({ courseId: objectIdParam });
const questionParams = z.object({ courseId: objectIdParam, questionId: objectIdParam });
const loParams = z.object({ courseId: objectIdParam, loId: objectIdParam });
const entryParams = z.object({ courseId: objectIdParam, entryId: objectIdParam });
const materialParams = z.object({
  courseId: objectIdParam,
  loId: objectIdParam,
  materialId: objectIdParam,
});
const sessionQuery = z.object({ previewSessionId });
const nextBody = z.object({
  previewSessionId,
  loId: objectIdParam,
  sessionServedIds: z.array(objectIdParam).optional().default([]),
});
const attemptBody = z.object({
  previewSessionId,
  questionVersionId: objectIdParam,
  loId: objectIdParam,
  mode: z.enum(['topic-practice', 'review-book', 'exam-prep']),
  selectedKey: z.string().min(1),
  sessionServedIds: z.array(objectIdParam).optional().default([]),
  isRetry: z.boolean().optional(),
  paramValues: z.record(z.string(), z.number()).optional(),
});
const flagBody = z.object({
  previewSessionId,
  reason: z.string().trim().max(500).optional(),
});
const bookmarkBody = z.object({ previewSessionId });
const reviewBookQuery = z.object({
  previewSessionId,
  sort: z.enum(['theme', 'date']).optional().default('theme'),
});
const summaryQuery = z.object({
  previewSessionId,
  since: z.string().datetime().optional(),
});
const skipBody = z.object({
  previewSessionId,
  attempted: z.boolean().optional().default(false),
});

function context(req: Request, id: string) {
  return {
    instructorPuid: req.user!.puid,
    previewSessionId: id,
  };
}

previewRouter.get(
  '/courses/:courseId/preview/home',
  validate({ params: courseParams, query: sessionQuery }),
  ensureCourseInstructor(),
  async (req, res) => {
    const query = req.query as z.infer<typeof sessionQuery>;
    res.json(await getPreviewHome(
      new ObjectId(String(req.params.courseId)),
      context(req, query.previewSessionId),
    ));
  },
);

previewRouter.post(
  '/courses/:courseId/preview/practice/next',
  validate({ params: courseParams, body: nextBody }),
  ensureCourseInstructor(),
  async (req, res) => {
    const body = req.body as z.infer<typeof nextBody>;
    res.json(await getNextPreviewQuestion({
      ...context(req, body.previewSessionId),
      courseId: new ObjectId(String(req.params.courseId)),
      loId: new ObjectId(body.loId),
      sessionServedIds: body.sessionServedIds.map((id) => new ObjectId(id)),
      watermarkUid: 'anonymous-preview',
    }));
  },
);

previewRouter.post(
  '/courses/:courseId/preview/attempts',
  validate({ params: courseParams, body: attemptBody }),
  ensureCourseInstructor(),
  async (req, res) => {
    const body = req.body as z.infer<typeof attemptBody>;
    res.json(await submitPreviewAttempt({
      ...context(req, body.previewSessionId),
      courseId: new ObjectId(String(req.params.courseId)),
      questionVersionId: new ObjectId(body.questionVersionId),
      loId: new ObjectId(body.loId),
      mode: body.mode,
      selectedKey: body.selectedKey,
      sessionServedIds: body.sessionServedIds.map((id) => new ObjectId(id)),
      ...(body.isRetry !== undefined ? { isRetry: body.isRetry } : {}),
      ...(body.paramValues !== undefined ? { paramValues: body.paramValues } : {}),
    }));
  },
);

previewRouter.post(
  '/courses/:courseId/preview/questions/:questionId/flag',
  validate({ params: questionParams, body: flagBody }),
  ensureCourseInstructor(),
  async (req, res) => {
    const body = req.body as z.infer<typeof flagBody>;
    res.json(await flagPreviewQuestion(
      new ObjectId(String(req.params.courseId)),
      context(req, body.previewSessionId),
      new ObjectId(String(req.params.questionId)),
      body.reason,
    ));
  },
);

previewRouter.get(
  '/courses/:courseId/preview/review-book',
  validate({ params: courseParams, query: reviewBookQuery }),
  ensureCourseInstructor(),
  async (req, res) => {
    const query = req.query as z.infer<typeof reviewBookQuery>;
    res.json(await listPreviewReviewBook(
      new ObjectId(String(req.params.courseId)),
      context(req, query.previewSessionId),
      query.sort,
    ));
  },
);

previewRouter.post(
  '/courses/:courseId/preview/questions/:questionId/bookmark',
  validate({ params: questionParams, body: bookmarkBody }),
  ensureCourseInstructor(),
  async (req, res) => {
    const body = req.body as z.infer<typeof bookmarkBody>;
    res.json(await togglePreviewBookmark(
      new ObjectId(String(req.params.courseId)),
      context(req, body.previewSessionId),
      new ObjectId(String(req.params.questionId)),
      true,
    ));
  },
);

previewRouter.delete(
  '/courses/:courseId/preview/questions/:questionId/bookmark',
  validate({ params: questionParams, query: sessionQuery }),
  ensureCourseInstructor(),
  async (req, res) => {
    const query = req.query as z.infer<typeof sessionQuery>;
    res.json(await togglePreviewBookmark(
      new ObjectId(String(req.params.courseId)),
      context(req, query.previewSessionId),
      new ObjectId(String(req.params.questionId)),
      false,
    ));
  },
);

previewRouter.delete(
  '/courses/:courseId/preview/review-book/:entryId',
  validate({ params: entryParams, query: sessionQuery }),
  ensureCourseInstructor(),
  async (req, res) => {
    const query = req.query as z.infer<typeof sessionQuery>;
    await removePreviewReviewBookEntry(
      new ObjectId(String(req.params.courseId)),
      context(req, query.previewSessionId),
      new ObjectId(String(req.params.entryId)),
    );
    res.status(204).end();
  },
);

previewRouter.post(
  '/courses/:courseId/preview/los/:loId/skip',
  validate({ params: loParams, body: skipBody }),
  ensureCourseInstructor(),
  async (req, res) => {
    const body = req.body as z.infer<typeof skipBody>;
    await skipPreviewLo(
      new ObjectId(String(req.params.courseId)),
      context(req, body.previewSessionId),
      new ObjectId(String(req.params.loId)),
    );
    res.status(204).end();
  },
);

previewRouter.get(
  '/courses/:courseId/preview/session-summary',
  validate({ params: courseParams, query: summaryQuery }),
  ensureCourseInstructor(),
  async (req, res) => {
    const query = req.query as z.infer<typeof summaryQuery>;
    const courseId = new ObjectId(String(req.params.courseId));
    const previewContext = context(req, query.previewSessionId);
    res.json(query.since
      ? await getPreviewSessionSummary(courseId, previewContext, new Date(query.since))
      : await getPreviewSessionStart(courseId, previewContext));
  },
);

previewRouter.get(
  '/courses/:courseId/preview/los/:loId/materials/:materialId/source',
  validate({ params: materialParams }),
  ensureCourseInstructor(),
  async (req, res, next) => {
    const source = await getPreviewRedirectMaterialSource(
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

const PREVIEW_ERROR_STATUS: Record<string, number> = {
  'course-not-found': 404,
  'lo-not-available': 404,
  'no-question-available': 404,
  'question-not-servable': 404,
  'material-not-found': 404,
  'invalid-selected-key': 400,
  'no-attempt-context': 409,
};

previewRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof Error && Object.hasOwn(PREVIEW_ERROR_STATUS, error.message)) {
    res.status(PREVIEW_ERROR_STATUS[error.message]).json({ error: error.message });
    return;
  }
  next(error);
});
