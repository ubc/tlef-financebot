import { Router, type RequestHandler } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseStudent, ensureCourseInstructor, ensureCourseStudentPreview, ensureCourseDiscussionMember } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { getLearningSettings, saveLearningSettings, learningLibrary, startLearningSession, getLearningSession, changeLearningSession, updateReviewMetadata, learningMaterialSource } from '../services/student-learning.service';
import { listDiscussion, createDiscussion, changeDiscussion, discussionQuestions, discussionQuestionPreview, isDiscussionStaff } from '../services/discussion.service';
import type { LearningActor } from '../types/student-learning';

export const studentLearningRouter = Router();
const oid = z.string().regex(/^[0-9a-f]{24}$/);
const courseParams = z.object({ courseId: oid });
const params = z.object({ courseId: oid, id: oid.optional() });
const previewQuery = z.object({ previewSessionId: z.string().uuid() });
const baseQuery = z.object({});
const note = z.object({ questionId: oid, visibility: z.enum(['always', 'after-submit']), text: z.string().trim().max(8000).optional(), materialId: oid.optional(), pageStart: z.number().int().min(1).max(10000).optional(), pageEnd: z.number().int().min(1).max(10000).optional() }).refine(n => !!n.text || !!n.materialId, 'Add text or a material.');
studentLearningRouter.get('/courses/:courseId/learning-settings', validate({ params: courseParams }), ensureCourseInstructor(), async (req, res) => { res.json(await getLearningSettings(new ObjectId(String(req.params.courseId)))); });
studentLearningRouter.put('/courses/:courseId/learning-settings', validate({ params: courseParams, body: z.object({ revision: z.number().int().min(0), mode: z.enum(['topic-practice', 'linear']), order: z.enum(['instructor', 'personalized']), questionOrder: z.array(oid).max(5000), notes: z.array(note).max(5000) }) }), ensureCourseInstructor(), async (req, res) => { res.json(await saveLearningSettings(new ObjectId(String(req.params.courseId)), req.body)); });
const startBody = z.object({ kind: z.enum(['lesson', 'test', 'cards', 'browse']), themeId: oid.optional(), questionIds: z.array(oid).min(1).max(1000).optional(), random: z.boolean().optional(), roundId: z.string().uuid().optional() });
const changeBody = z.object({ revision: z.number().int().min(0), action: z.enum(['draft', 'move', 'submit', 'reveal', 'rate']), key: z.string().max(32).optional(), cursor: z.number().int().min(0).optional(), rating: z.enum(['remembered', 'learning']).optional() });
const metaBody = z.object({ saved: z.boolean().optional(), confusing: z.boolean().optional(), tags: z.array(z.string().trim().min(1).max(40)).max(20).transform(t => [...new Set(t)]).optional() });
const postBody = z.object({ title: z.string().trim().min(1).max(180), text: z.string().trim().min(1).max(15000), category: z.enum(['general', 'concept', 'method', 'explanation', 'material', 'logistics', 'note']), audience: z.enum(['course', 'staff']), anonymous: z.boolean(), questionId: oid.optional(), themeId: oid.optional(), loId: oid.optional() });
const postChange = z.object({ revision: z.number().int().min(0), action: z.enum(['reply', 'close', 'reopen', 'delete', 'restore', 'pin', 'resolve', 'endorse', 'vote', 'follow']), text: z.string().trim().min(1).max(10000).optional(), kind: z.enum(['student', 'instructor', 'followup']).optional(), anonymous: z.boolean().optional(), replyId: oid.optional(), value: z.boolean().optional() });
for (const preview of [false, true]) {
  const prefix = `/courses/:courseId/${preview ? 'preview/' : ''}`;
  const query = preview ? previewQuery : baseQuery;
  const studentGuard = preview ? ensureCourseStudentPreview() : ensureCourseStudent();
  const discussionQuery = query.extend({ offset: z.coerce.number().int().min(0).max(100000).optional().default(0) });
  const discussionGuard = preview ? ensureCourseStudentPreview() : ensureCourseDiscussionMember();
  const actor: (req: Parameters<RequestHandler>[0]) => LearningActor = req => ({ puid: req.user!.puid, ...(preview ? { previewSessionId: String(req.query.previewSessionId) } : {}) });
  studentLearningRouter.get(`${prefix}learning/library`, validate({ params: courseParams, query }), studentGuard, async (req, res) => { res.json(await learningLibrary(actor(req), new ObjectId(String(req.params.courseId)))); });
  studentLearningRouter.post(`${prefix}learning/sessions`, validate({ params: courseParams, query, body: startBody }), studentGuard, async (req, res) => { res.json(await startLearningSession(actor(req), new ObjectId(String(req.params.courseId)), req.body)); });
  studentLearningRouter.get(`${prefix}learning/sessions/:id`, validate({ params, query }), studentGuard, async (req, res) => { res.json(await getLearningSession(actor(req), new ObjectId(String(req.params.courseId)), String(req.params.id))); });
  studentLearningRouter.put(`${prefix}learning/sessions/:id`, validate({ params, query, body: changeBody }), studentGuard, async (req, res) => { res.json(await changeLearningSession(actor(req), new ObjectId(String(req.params.courseId)), String(req.params.id), req.body)); });
  studentLearningRouter.put(`${prefix}learning/questions/:id/metadata`, validate({ params, query, body: metaBody }), studentGuard, async (req, res) => { res.json(await updateReviewMetadata(actor(req), new ObjectId(String(req.params.courseId)), String(req.params.id), req.body)); });
  studentLearningRouter.get(`${prefix}learning/sessions/:id/material`, validate({ params, query }), studentGuard, async (req, res) => {
    const source = await learningMaterialSource(actor(req), new ObjectId(String(req.params.courseId)), String(req.params.id));
    if (source.kind === 'url') res.redirect(source.url); else { res.type(source.downloadName); res.sendFile(source.path); }
  });
  studentLearningRouter.get(`${prefix}discussion/questions`, validate({ params: courseParams, query }), discussionGuard, async (req, res) => { res.json(await discussionQuestions(actor(req), new ObjectId(String(req.params.courseId)), isDiscussionStaff(req.user!, new ObjectId(String(req.params.courseId)), preview))); });
  studentLearningRouter.get(`${prefix}discussion/questions/:id`, validate({ params, query }), discussionGuard, async (req, res) => { res.json(await discussionQuestionPreview(actor(req), new ObjectId(String(req.params.courseId)), String(req.params.id), isDiscussionStaff(req.user!, new ObjectId(String(req.params.courseId)), preview))); });
  studentLearningRouter.get(`${prefix}discussion`, validate({ params: courseParams, query: discussionQuery }), discussionGuard, async (req, res) => { res.json(await listDiscussion(actor(req), req.user!, new ObjectId(String(req.params.courseId)), Number(req.query.offset))); });
  studentLearningRouter.post(`${prefix}discussion`, validate({ params: courseParams, query, body: postBody }), discussionGuard, async (req, res) => { res.json(await createDiscussion(actor(req), req.user!, new ObjectId(String(req.params.courseId)), req.body)); });
  studentLearningRouter.put(`${prefix}discussion/:id`, validate({ params, query, body: postChange }), discussionGuard, async (req, res) => { res.json(await changeDiscussion(actor(req), req.user!, new ObjectId(String(req.params.courseId)), String(req.params.id), req.body)); });
}
