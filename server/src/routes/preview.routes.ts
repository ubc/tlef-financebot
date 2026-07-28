import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  getNextPreviewQuestion,
  getPreviewHome,
  submitPreviewAttempt,
} from '../services/preview.service';

export const previewRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseParams = z.object({ courseId: objectIdParam });
const nextBody = z.object({
  loId: objectIdParam,
  sessionServedIds: z.array(objectIdParam).optional().default([]),
});
const attemptBody = z.object({
  questionVersionId: objectIdParam,
  loId: objectIdParam,
  selectedKey: z.string().min(1),
  sessionServedIds: z.array(objectIdParam).optional().default([]),
  isRetry: z.boolean().optional(),
  paramValues: z.record(z.string(), z.number()).optional(),
});

previewRouter.get(
  '/courses/:courseId/preview/home',
  validate({ params: courseParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await getPreviewHome(new ObjectId(String(req.params.courseId))));
  },
);

previewRouter.post(
  '/courses/:courseId/preview/practice/next',
  validate({ params: courseParams }),
  ensureCourseInstructor(),
  validate({ body: nextBody }),
  async (req, res) => {
    const body = req.body as z.infer<typeof nextBody>;
    res.json(await getNextPreviewQuestion({
      courseId: new ObjectId(String(req.params.courseId)),
      loId: new ObjectId(body.loId),
      sessionServedIds: body.sessionServedIds.map((id) => new ObjectId(id)),
      watermarkUid: req.user!.uid,
    }));
  },
);

previewRouter.post(
  '/courses/:courseId/preview/attempts',
  validate({ params: courseParams }),
  ensureCourseInstructor(),
  validate({ body: attemptBody }),
  async (req, res) => {
    const body = req.body as z.infer<typeof attemptBody>;
    res.json(await submitPreviewAttempt({
      instructorPuid: req.user!.puid,
      courseId: new ObjectId(String(req.params.courseId)),
      questionVersionId: new ObjectId(body.questionVersionId),
      loId: new ObjectId(body.loId),
      selectedKey: body.selectedKey,
      sessionServedIds: body.sessionServedIds.map((id) => new ObjectId(id)),
      ...(body.isRetry !== undefined ? { isRetry: body.isRetry } : {}),
      ...(body.paramValues !== undefined ? { paramValues: body.paramValues } : {}),
    }));
  },
);

const PREVIEW_ERROR_STATUS: Record<string, number> = {
  'course-not-found': 404,
  'lo-not-available': 404,
  'no-question-available': 404,
  'question-not-servable': 404,
  'invalid-selected-key': 400,
};

previewRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof Error && Object.hasOwn(PREVIEW_ERROR_STATUS, error.message)) {
    res.status(PREVIEW_ERROR_STATUS[error.message]).json({ error: error.message });
    return;
  }
  next(error);
});
