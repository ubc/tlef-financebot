import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/assessment-preview.service', () => Object.fromEntries(['listPreviewAssessments', 'startPreviewAssessment', 'previewAssessmentState', 'answerPreviewAssessment', 'submitPreviewAssessment', 'previewAssessmentResults', 'bindPreviewAssessmentWindow', 'heartbeatPreviewAssessmentWindow', 'closePreviewAssessmentWindow'].map(name => [name, jest.fn(async () => ({}))])));
import * as service from '../../server/src/services/assessment-preview.service';
import { assessmentPreviewRouter } from '../../server/src/routes/assessment-preview.routes';

const courseId = new ObjectId(), examId = new ObjectId(), attemptId = new ObjectId();
const previewSessionId = 'ea30139b-a098-4e25-b230-bee24e6c181d';
const root = `/api/courses/${courseId}/preview`, catalog = `${root}/assessments`, sitting = `${root}/assessment-attempts/${attemptId}`;
function app(role?: 'student' | 'ta' | 'instructor' | 'admin', ownCourse = courseId) {
  const server = express(); server.use(express.json());
  server.use((req, _res, next) => {
    req.isAuthenticated = (() => Boolean(role)) as typeof req.isAuthenticated;
    if (role) req.user = { puid: 'trusted-actor', isAdmin: role === 'admin', courseRoles: role === 'admin' ? [] : [{ courseId: ownCourse, role }] } as User;
    next();
  });
  server.use('/api', assessmentPreviewRouter);
  server.use(((error, _req, res, _next) => { res.status(error.status ?? 500).json({ error: error.message }); }) as express.ErrorRequestHandler);
  return server;
}
function allRequests(server: ReturnType<typeof app>) {
  return [
    request(server).get(`${catalog}?previewSessionId=${previewSessionId}`),
    request(server).post(`${catalog}/${examId}/start`).send({ previewSessionId }),
    request(server).get(`${sitting}?previewSessionId=${previewSessionId}`),
    request(server).put(`${sitting}/answer`).send({ previewSessionId, itemId: previewSessionId, selectedKey: 'B', answerRevision: 0 }),
    request(server).post(`${sitting}/submit`).send({ previewSessionId }),
    request(server).get(`${sitting}/results?previewSessionId=${previewSessionId}`),
  ];
}
test.each([undefined, 'student'] as const)('%s cannot call any assessment preview endpoint', async role => {
  for (const action of allRequests(app(role))) expect((await action).status).toBe(role ? 403 : 401);
  for (const method of Object.values(service).filter(value => typeof value === 'function')) expect(method).not.toHaveBeenCalled();
});
test('foreign-course teaching roles cannot enter a preview', async () => {
  for (const action of allRequests(app('instructor', new ObjectId()))) expect((await action).status).toBe(403);
  expect(service.startPreviewAssessment).not.toHaveBeenCalled();
});
test.each(['instructor', 'ta', 'admin'] as const)('%s can exercise all isolated assessment endpoints', async role => {
  for (const action of allRequests(app(role))) expect((await action).status).toBe(200);
  expect(service.startPreviewAssessment).toHaveBeenCalledWith(courseId, examId, { instructorPuid: 'trusted-actor', previewSessionId, access: 'unrestricted' }, undefined);
});
test('restricted mode and UUID reach the service, user-supplied actor/course fields do not', async () => {
  const response = await request(app('instructor')).post(`${catalog}/${examId}/start?access=restricted`).send({ previewSessionId, instructorPuid: 'forged', puid: 'student', courseId: new ObjectId().toHexString(), access: 'unrestricted' });
  expect(response.status).toBe(200);
  expect(service.startPreviewAssessment).toHaveBeenCalledWith(courseId, examId, { instructorPuid: 'trusted-actor', previewSessionId, access: 'restricted' }, undefined);
  const state = await request(app('ta')).get(`${sitting}?previewSessionId=${previewSessionId}&access=restricted&instructorPuid=forged`);
  expect(state.status).toBe(200);
  expect(service.previewAssessmentState).toHaveBeenCalledWith(courseId, attemptId, { instructorPuid: 'trusted-actor', previewSessionId, access: 'restricted' });
});
test.each(['fake', '', 'undefined'])('reads reject invalid Preview UUID %s', async session => {
  expect((await request(app('instructor')).get(`${catalog}?previewSessionId=${session}`)).status).toBe(400);
  expect(service.listPreviewAssessments).not.toHaveBeenCalled();
});
test('write schemas require UUID, integer CAS revision and valid item ID', async () => {
  for (const body of [{ previewSessionId: 'fake' }, {}, { previewSessionId, itemId: 'fake', selectedKey: 'B', answerRevision: 0 }, { previewSessionId, itemId: previewSessionId, selectedKey: 'B', answerRevision: -1 }, { previewSessionId, itemId: previewSessionId, selectedKey: 'B', answerRevision: 0.5 }]) {
    expect((await request(app('instructor')).put(`${sitting}/answer`).send(body)).status).toBe(400);
  }
  expect(service.answerPreviewAssessment).not.toHaveBeenCalled();
});
test('unsupported mode cannot silently fall back to unrestricted', async () => {
  expect((await request(app('instructor')).get(`${catalog}?previewSessionId=${previewSessionId}&access=unrestricted`)).status).toBe(400);
  expect((await request(app('instructor')).post(`${catalog}/${examId}/start?access=false`).send({ previewSessionId })).status).toBe(400);
  expect(service.startPreviewAssessment).not.toHaveBeenCalled();
});
test('service availability failure propagates through the independently mounted router', async () => {
  jest.mocked(service.startPreviewAssessment).mockRejectedValueOnce(Object.assign(new Error('Course is not available to students.'), { status: 404 }));
  const response = await request(app('instructor')).post(`${catalog}/${examId}/start?access=restricted`).send({ previewSessionId });
  expect(response.status).toBe(404); expect(response.body.error).toBe('Course is not available to students.');
});

const windowId = 'e7083c96-bd92-4a88-94cb-ff3e378af7d8';
test.each(['window', 'window/heartbeat', 'window/close'])('Preview %s requires teaching access, mode scope and UUID ownership', async suffix => {
  expect((await request(app('student')).post(`${sitting}/${suffix}`).send({ previewSessionId, windowId })).status).toBe(403);
  expect((await request(app('ta')).post(`${sitting}/${suffix}?access=restricted`).send({ previewSessionId, windowId: 'invalid' })).status).toBe(400);
  expect((await request(app('ta')).post(`${sitting}/${suffix}?access=restricted`).send({ previewSessionId, windowId, instructorPuid: 'forged' })).status).toBe(200);
  const method = suffix === 'window' ? service.bindPreviewAssessmentWindow : suffix.endsWith('heartbeat') ? service.heartbeatPreviewAssessmentWindow : service.closePreviewAssessmentWindow;
  expect(method).toHaveBeenCalledWith(courseId, attemptId, { instructorPuid: 'trusted-actor', previewSessionId, access: 'restricted' }, windowId);
});
test('Preview start, answers and submit pass validated window ID through isolated actor/session scope', async () => {
  expect((await request(app('instructor')).post(`${catalog}/${examId}/start`).send({ previewSessionId, windowId })).status).toBe(200);
  expect(service.startPreviewAssessment).toHaveBeenCalledWith(courseId, examId, expect.objectContaining({ instructorPuid: 'trusted-actor' }), windowId);
  expect((await request(app('instructor')).put(`${sitting}/answer`).send({ previewSessionId, windowId, itemId: previewSessionId, selectedKey: 'B', answerRevision: 1 })).status).toBe(200);
  expect(service.answerPreviewAssessment).toHaveBeenCalledWith(courseId, attemptId, expect.any(Object), previewSessionId, 'B', 1, windowId);
  expect((await request(app('instructor')).post(`${sitting}/submit`).send({ previewSessionId, windowId })).status).toBe(200);
  expect(service.submitPreviewAssessment).toHaveBeenCalledWith(courseId, attemptId, expect.any(Object), windowId);
});
