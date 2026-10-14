import { Router, type Request } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseStudentPreview } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import type { AssessmentPreviewContext } from '../types/assessment-preview';
import * as preview from '../services/assessment-preview.service';

export const assessmentPreviewRouter = Router();
const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const previewSessionId = z.string().uuid();
const access = z.literal('restricted').optional();
const course = z.object({ courseId: objectId });
const exam = course.extend({ examId: objectId });
const attempt = course.extend({ attemptId: objectId });
const read = z.object({ previewSessionId, access });
const mode = z.object({ access });
const session = z.object({ previewSessionId, windowId: z.string().uuid().optional() });
const windowBody = session.extend({ windowId: z.string().uuid() });
const answer = session.extend({ itemId: z.string().uuid(), selectedKey: z.string().min(1).max(10), answerRevision: z.number().int().min(0) });
const id = (value: unknown) => new ObjectId(String(value));
function context(req: Request, sessionId: string): AssessmentPreviewContext {
  return { instructorPuid: req.user!.puid, previewSessionId: sessionId, access: req.query.access === 'restricted' ? 'restricted' : 'unrestricted' };
}

// Every endpoint independently guards the teaching actor. Services repeat the
// restricted publication gate, even when mounted without the general Preview router.
const catalog = '/courses/:courseId/preview/assessments';
const sitting = '/courses/:courseId/preview/assessment-attempts/:attemptId';
assessmentPreviewRouter.get(catalog, validate({ params: course }), ensureCourseStudentPreview(), validate({ query: read }), async (req, res) => {
  res.json(await preview.listPreviewAssessments(id(req.params.courseId), context(req, String(req.query.previewSessionId))));
});
assessmentPreviewRouter.post(`${catalog}/:examId/start`, validate({ params: exam }), ensureCourseStudentPreview(), validate({ query: mode, body: session }), async (req, res) => {
  res.json(await preview.startPreviewAssessment(id(req.params.courseId), id(req.params.examId), context(req, req.body.previewSessionId), req.body.windowId));
});
assessmentPreviewRouter.get(sitting, validate({ params: attempt }), ensureCourseStudentPreview(), validate({ query: read }), async (req, res) => {
  res.json(await preview.previewAssessmentState(id(req.params.courseId), id(req.params.attemptId), context(req, String(req.query.previewSessionId))));
});
assessmentPreviewRouter.put(`${sitting}/answer`, validate({ params: attempt }), ensureCourseStudentPreview(), validate({ query: mode, body: answer }), async (req, res) => {
  res.json(await preview.answerPreviewAssessment(id(req.params.courseId), id(req.params.attemptId), context(req, req.body.previewSessionId), req.body.itemId, req.body.selectedKey, req.body.answerRevision, req.body.windowId));
});
assessmentPreviewRouter.post(`${sitting}/submit`, validate({ params: attempt }), ensureCourseStudentPreview(), validate({ query: mode, body: session }), async (req, res) => {
  res.json(await preview.submitPreviewAssessment(id(req.params.courseId), id(req.params.attemptId), context(req, req.body.previewSessionId), req.body.windowId));
});
assessmentPreviewRouter.get(`${sitting}/results`, validate({ params: attempt }), ensureCourseStudentPreview(), validate({ query: read }), async (req, res) => {
  res.json(await preview.previewAssessmentResults(id(req.params.courseId), id(req.params.attemptId), context(req, String(req.query.previewSessionId))));
});

assessmentPreviewRouter.post(`${sitting}/window`, validate({ params: attempt }), ensureCourseStudentPreview(), validate({ query: mode, body: windowBody }), async (req, res) => { res.json(await preview.bindPreviewAssessmentWindow(id(req.params.courseId), id(req.params.attemptId), context(req, req.body.previewSessionId), req.body.windowId)); });
assessmentPreviewRouter.post(`${sitting}/window/heartbeat`, validate({ params: attempt }), ensureCourseStudentPreview(), validate({ query: mode, body: windowBody }), async (req, res) => { res.json(await preview.heartbeatPreviewAssessmentWindow(id(req.params.courseId), id(req.params.attemptId), context(req, req.body.previewSessionId), req.body.windowId)); });
assessmentPreviewRouter.post(`${sitting}/window/close`, validate({ params: attempt }), ensureCourseStudentPreview(), validate({ query: mode, body: windowBody }), async (req, res) => { res.json(await preview.closePreviewAssessmentWindow(id(req.params.courseId), id(req.params.attemptId), context(req, req.body.previewSessionId), req.body.windowId)); });
