import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { errorHandler } from '../../server/src/middleware/error-handler';
jest.mock('../../server/src/services/student-learning.service', () => ({ getLearningSettings: jest.fn().mockResolvedValue({mode:'linear'}), saveLearningSettings:jest.fn(), learningLibrary:jest.fn().mockResolvedValue({questions:[]}), startLearningSession:jest.fn(), getLearningSession:jest.fn().mockResolvedValue({current:null}), changeLearningSession:jest.fn(), updateReviewMetadata:jest.fn(), learningMaterialSource:jest.fn().mockRejectedValue(Object.assign(new Error('Material is not available.'),{status:404})), learningError: (message: string,status: number) => { throw Object.assign(new Error(message),{status}); } }));
jest.mock('../../server/src/services/discussion.service', () => ({ isDiscussionStaff:jest.fn().mockReturnValue(false), listDiscussion:jest.fn().mockResolvedValue({posts:[]}), createDiscussion:jest.fn(), changeDiscussion:jest.fn(), discussionQuestions:jest.fn(), discussionQuestionPreview:jest.fn() }));
jest.mock('../../server/src/services/progression.service', () => ({getRedirectMaterialSource:jest.fn()}));
import { studentLearningRouter } from '../../server/src/routes/student-learning.routes';
import { learningLibrary, learningMaterialSource } from '../../server/src/services/student-learning.service';
import { listDiscussion } from '../../server/src/services/discussion.service';
const courseId = new ObjectId('660000000000000000000001');
const previewSessionId = '11111111-1111-4111-8111-111111111111';
function app(role?: 'student'|'instructor'|'ta', other = false) {
  const server = express(); server.use(express.json()); server.use((req,_res,next) => { req.isAuthenticated = (() => !!role) as typeof req.isAuthenticated; if (role) req.user = {puid:'session-owner',uid:'owner',displayName:'Owner',email:'owner@example.test',affiliations:[],isAdmin:false,createdAt:new Date(),lastLoginAt:new Date(),courseRoles:[{courseId:other ? new ObjectId() : courseId,role}]}; next(); }); server.use('/api',studentLearningRouter); server.use(errorHandler); return server;
}
const base = `/api/courses/${courseId}`;
test('learning APIs reject signed-out, foreign-course and live instructor callers', async () => {
  await request(app()).get(`${base}/learning/library`).expect(401);
  await request(app('student',true)).get(`${base}/learning/library`).expect(403);
  await request(app('instructor')).get(`${base}/learning/library`).expect(403);
  await request(app('student')).get(`${base}/learning/library`).expect(200);
});
test('Preview namespaces require teaching-team role and a valid session id; actor comes from authenticated session', async () => {
  await request(app('student')).get(`${base}/preview/learning/library?previewSessionId=${previewSessionId}`).expect(403);
  await request(app('instructor')).get(`${base}/preview/learning/library`).expect(400);
  await request(app('instructor')).get(`${base}/preview/learning/library?previewSessionId=${previewSessionId}&puid=victim`).expect(200);
  expect(learningLibrary).toHaveBeenLastCalledWith({puid:'session-owner',previewSessionId},courseId);
});
test('Discussion supports members, denies foreign-course users and isolates Preview identity', async () => {
  for (const role of ['student','instructor','ta'] as const) await request(app(role)).get(`${base}/discussion`).expect(200);
  await request(app('student',true)).get(`${base}/discussion`).expect(403);
  await request(app('instructor')).get(`${base}/preview/discussion?previewSessionId=${previewSessionId}`).expect(200);
  expect(listDiscussion).toHaveBeenLastCalledWith({puid:'session-owner',previewSessionId},expect.anything(),courseId,0);
});
test('settings require instructors and validated ids; materials require visible configured support', async () => {
  await request(app('student')).get(`${base}/learning-settings`).expect(403);
  await request(app('ta')).get(`${base}/learning-settings`).expect(403);
  await request(app('instructor')).get(`${base}/learning-settings`).expect(200);
  await request(app('instructor')).get('/api/courses/bad-id/learning-settings').expect(400);
  await request(app('student')).get(`${base}/learning/sessions/660000000000000000000010/material`).expect(404);
  expect(learningMaterialSource).toHaveBeenLastCalledWith({puid:'session-owner'},courseId,'660000000000000000000010');
});
