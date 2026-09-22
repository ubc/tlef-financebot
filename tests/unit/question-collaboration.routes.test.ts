import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/components/auth', () => jest.requireActual('../../server/src/components/auth/guards'));
jest.mock('../../server/src/services/question-collaboration.service', () => ({
  getQuestionDraft: jest.fn(), mergeQuestionDraft: jest.fn(), commitQuestionDraft: jest.fn(), rebaseQuestionDraft: jest.fn(), updateQuestionPresence: jest.fn(), leaveQuestionDraft: jest.fn(),
}));
import { questionCollaborationRouter } from '../../server/src/routes/question-collaboration.routes';
import { commitQuestionDraft, getQuestionDraft, leaveQuestionDraft, mergeQuestionDraft, rebaseQuestionDraft, updateQuestionPresence } from '../../server/src/services/question-collaboration.service';
import { errorHandler } from '../../server/src/middleware/error-handler';

const courseId = new ObjectId();
const questionId = new ObjectId();
const versionId = new ObjectId();
const puid = 'CURRENT-INSTRUCTOR';
const clientId = '11111111-1111-4111-8111-111111111111';
const path = `/api/courses/${courseId}/questions/${questionId}/draft`;
const snapshot = { state: 'AA==', revision: 0, baseVersionId: versionId.toHexString(), currentVersionId: versionId.toHexString(), questionType: 'mcq', optionKeys: ['A', 'B'], conflict: false, committing: false, updatedAt: new Date().toISOString(), collaborators: [] };

function app(signedIn = true) {
  const value = express();
  value.use(express.json());
  value.use((req, _res, next) => {
    req.isAuthenticated = (() => signedIn) as typeof req.isAuthenticated;
    if (signedIn) req.user = { puid } as User;
    next();
  });
  value.use('/api', questionCollaborationRouter);
  value.use(errorHandler);
  return value;
}

beforeEach(() => {
  for (const service of [getQuestionDraft, mergeQuestionDraft, commitQuestionDraft, rebaseQuestionDraft, updateQuestionPresence, leaveQuestionDraft]) jest.mocked(service).mockReset();
});

it('requires authentication for snapshots, updates, commits, rebases and presence', async () => {
  const client = request(app(false));
  expect((await client.get(path)).status).toBe(401);
  expect((await client.get(`${path}/events`)).status).toBe(401);
  expect((await client.post(`${path}/updates`).send({ update: 'AA==' })).status).toBe(401);
  expect((await client.post(`${path}/commit`).send({ expectedRevision: 0, requestId: clientId })).status).toBe(401);
  expect((await client.post(`${path}/rebase`).send({ expectedRevision: 0, expectedVersionId: versionId.toHexString() })).status).toBe(401);
  expect((await client.put(`${path}/presence`).send({ clientId, field: 'stem' })).status).toBe(401);
  expect((await client.delete(`${path}/presence/${clientId}`)).status).toBe(401);
  expect(getQuestionDraft).not.toHaveBeenCalled(); expect(commitQuestionDraft).not.toHaveBeenCalled();
});

it('takes actor identity from the session and forwards exact version/revision requirements', async () => {
  jest.mocked(getQuestionDraft).mockResolvedValue(snapshot as never);
  jest.mocked(mergeQuestionDraft).mockResolvedValue(snapshot as never);
  jest.mocked(commitQuestionDraft).mockResolvedValue({ versionId: versionId.toHexString() });
  jest.mocked(rebaseQuestionDraft).mockResolvedValue(snapshot as never);
  const client = request(app());
  expect((await client.get(path)).body).toEqual(snapshot);
  expect((await client.post(`${path}/updates`).send({ update: 'AA==', puid: 'SPOOF' })).status).toBe(200);
  expect(mergeQuestionDraft).toHaveBeenCalledWith(courseId, questionId, puid, 'AA==');
  expect((await client.post(`${path}/commit`).send({ expectedRevision: 3, requestId: clientId, puid: 'SPOOF' })).status).toBe(200);
  expect(commitQuestionDraft).toHaveBeenCalledWith(courseId, questionId, puid, 3, clientId);
  expect((await client.post(`${path}/rebase`).send({ expectedRevision: 3, expectedVersionId: versionId.toHexString() })).status).toBe(200);
  expect(rebaseQuestionDraft).toHaveBeenCalledWith(courseId, questionId, puid, 3, versionId);
  expect((await client.put(`${path}/presence`).send({ clientId, field: 'stem', puid: 'SPOOF', name: 'Spoofed' })).status).toBe(204);
  expect(updateQuestionPresence).toHaveBeenCalledWith(courseId, questionId, puid, clientId, 'stem');
  expect((await client.delete(`${path}/presence/${clientId}`)).status).toBe(204);
  expect(leaveQuestionDraft).toHaveBeenCalledWith(questionId, puid, clientId);
});

it('rejects invalid revisions, IDs and oversized updates before entering services', async () => {
  const client = request(app());
  expect((await client.post(`${path}/commit`).send({ expectedRevision: -1, requestId: clientId })).status).toBe(400);
  expect((await client.post(`${path}/commit`).send({ expectedRevision: 0, requestId: 'not-a-uuid' })).status).toBe(400);
  expect((await client.post(`${path}/rebase`).send({ expectedRevision: 0.5, expectedVersionId: versionId.toHexString() })).status).toBe(400);
  expect((await client.post(`${path}/updates`).send({ update: 'A'.repeat(90_001) })).status).toBe(400);
  expect((await client.put(`${path}/presence`).send({ clientId, field: 'x'.repeat(101) })).status).toBe(400);
  expect(mergeQuestionDraft).not.toHaveBeenCalled(); expect(commitQuestionDraft).not.toHaveBeenCalled(); expect(updateQuestionPresence).not.toHaveBeenCalled();
});

it('returns a clear conflict while retaining the shared draft', async () => {
  jest.mocked(commitQuestionDraft).mockRejectedValue(new Error('question-conflict'));
  const response = await request(app()).post(`${path}/commit`).send({ expectedRevision: 0, requestId: clientId });
  expect(response.status).toBe(409);
  expect(response.body.error).toContain('shared draft is retained');
});

function readEvents() {
  return request(app()).get(`${path}/events`).buffer(true).parse((res, done) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => { body += chunk; });
    res.on('end', () => done(null, body));
    res.on('error', done);
  }).timeout(3500);
}

it.each([401, 403, 404, 409])('ends an open SSE stream with unavailable on permanent access/state status %s', async status => {
  jest.mocked(getQuestionDraft).mockResolvedValueOnce(snapshot as never)
    .mockRejectedValueOnce(Object.assign(new Error('Course editing access is no longer available.'), { status }));
  const response = await readEvents();
  expect(response.headers['content-type']).toContain('text/event-stream');
  expect(response.body).toContain('event: snapshot');
  expect(response.body).toContain('event: unavailable');
  expect(response.body).toContain('Course editing access is no longer available.');
  expect(getQuestionDraft).toHaveBeenCalledTimes(2);
  expect(getQuestionDraft).toHaveBeenLastCalledWith(courseId, questionId, puid);
});

it.each([
  ['database failure', new Error('Mongo connection interrupted')],
  ['server error', Object.assign(new Error('Temporary storage failure'), { status: 500 })],
])('allows EventSource to reconnect after transient %s by ending without unavailable', async (_label, error) => {
  jest.mocked(getQuestionDraft).mockResolvedValueOnce(snapshot as never).mockRejectedValueOnce(error);
  const response = await readEvents();
  expect(response.headers['content-type']).toContain('text/event-stream');
  expect(response.body).toContain('event: snapshot');
  expect(response.body).not.toContain('event: unavailable');
  expect(response.body).not.toContain('Temporary storage failure');
  expect(response.body).not.toContain('Mongo connection interrupted');
  expect(getQuestionDraft).toHaveBeenCalledTimes(2);
});
