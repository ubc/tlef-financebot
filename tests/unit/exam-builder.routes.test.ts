import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/exam-builder.service', () => Object.fromEntries(['listBuilderExams','createBuilderExam','builderDetail','saveExamSettings','renameBuilderExam','deleteBuilderExam','addBankItems','addExamCandidate','arrangeExamItems','approveExamItem','publishBuilderExam','reviseBuilderExam','duplicateBuilderExam','releaseExamResults'].map(name => [name, jest.fn(async () => ({}))])));
jest.mock('../../server/src/services/exam-generation.service', () => Object.fromEntries(['planExamGeneration','confirmExamGeneration','cancelExamGeneration','retryExamGeneration'].map(name => [name, jest.fn(async () => ({}))])));
jest.mock('../../server/src/services/assessment-attempts.service', () => Object.fromEntries(['listAssessments','startAssessment','assessmentState','answerAssessment','submitAssessment','assessmentResults'].map(name => [name, jest.fn(async () => ({}))])));
import { examBuilderRouter } from '../../server/src/routes/exam-builder.routes';
import { publishBuilderExam, addBankItems, renameBuilderExam, deleteBuilderExam } from '../../server/src/services/exam-builder.service';
import { assessmentState } from '../../server/src/services/assessment-attempts.service';
const courseId = new ObjectId(), examId = new ObjectId(), attemptId = new ObjectId();
function app(role?: 'student' | 'ta' | 'instructor', ownCourse = courseId) {
  const server = express(); server.use(express.json());
  server.use((req, _res, next) => {
    req.isAuthenticated = (() => Boolean(role)) as typeof req.isAuthenticated;
    if (role) req.user = { puid: 'actor', isAdmin: false, courseRoles: [{ courseId: ownCourse, role }] } as User;
    next();
  }); server.use('/api', examBuilderRouter); return server;
}
const path = `/api/courses/${courseId}/exam-builder/${examId}`;
describe('Exam Builder course boundaries', () => {
  test.each([undefined, 'student', 'ta'] as const)('denies %s authoring and final decisions', async role => {
    for (const suffix of ['publish', 'approve', 'plans', 'release-results']) {
      const response = await request(app(role)).post(`${path}/${suffix}`).send({ revision: 0 });
      expect(response.status).toBe(role ? 403 : 401);
    }
    expect(publishBuilderExam).not.toHaveBeenCalled();
  });
  test('foreign-course Instructor cannot read or publish', async () => {
    expect((await request(app('instructor', new ObjectId())).get(path)).status).toBe(403);
    expect((await request(app('instructor', new ObjectId())).post(`${path}/publish`).send({ revision: 0 })).status).toBe(403);
  });
  test('bank selection accepts references, not forged content or approvals', async () => {
    const questionId = new ObjectId().toHexString(), versionId = new ObjectId().toHexString();
    const response = await request(app('instructor')).post(`${path}/bank-items`).send({ revision: 1, questions: [{ questionId, versionId, approval: { by: 'forged' }, stem: 'forged' }] });
    expect(response.status).toBe(200);
    expect(addBankItems).toHaveBeenCalledWith(courseId, examId, 1, [{ questionId, versionId }], 'actor');
  });
  test('student sitting always passes the authenticated identity to the service', async () => {
    const response = await request(app('student')).get(`/api/courses/${courseId}/assessment-attempts/${attemptId}?puid=someone-else`);
    expect(response.status).toBe(200);
    expect(assessmentState).toHaveBeenCalledWith(courseId, attemptId, 'actor');
  });
});

describe('private Exam Builder SSE', () => {
  test.each([undefined, 'student', 'ta'] as const)('denies %s access to live drafts', async role => {
    expect((await request(app(role)).get(`${path}/events`)).status).toBe(role ? 403 : 401);
  });
  test('replays persisted state and sends changes only for the selected exam', async () => {
    const { builderDetail } = await import('../../server/src/services/exam-builder.service');
    const { notifyExamChanged } = await import('../../server/src/services/exam-events.service');
    jest.mocked(builderDetail).mockResolvedValue({ exam: { revision: 4 }, candidates: [], runs: [{ status: 'running' }] } as never);
    const server = app('instructor').listen(0);
    const address = server.address() as { port: number };
    const controller = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}/events`, { signal: controller.signal });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"running"');
      jest.mocked(builderDetail).mockClear();
      notifyExamChanged(courseId, new ObjectId());
      expect(builderDetail).not.toHaveBeenCalled();
      jest.mocked(builderDetail).mockResolvedValue({ exam: { revision: 5 }, candidates: [{ item: { stem: 'Saved candidate' } }], runs: [{ status: 'completed' }] } as never);
      notifyExamChanged(courseId, examId);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('Saved candidate');
      await reader.cancel();
    } finally { controller.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});


describe('exam catalog mutations', () => {
  test.each([undefined, 'student', 'ta'] as const)('denies %s rename and delete', async role => {
    expect((await request(app(role)).put(`${path}/title`).send({ revision: 0, title: 'New title' })).status).toBe(role ? 403 : 401);
    expect((await request(app(role)).delete(path).send({ revision: 0 })).status).toBe(role ? 403 : 401);
    expect(renameBuilderExam).not.toHaveBeenCalled(); expect(deleteBuilderExam).not.toHaveBeenCalled();
  });
  test('cross-course instructor cannot mutate and title schema rejects empty input', async () => {
    expect((await request(app('instructor', new ObjectId())).put(`${path}/title`).send({ revision: 0, title: 'New title' })).status).toBe(403);
    expect((await request(app('instructor', new ObjectId())).delete(path).send({ revision: 0 })).status).toBe(403);
    expect((await request(app('instructor')).put(`${path}/title`).send({ revision: 0, title: '  ' })).status).toBe(400);
  });
  test('sends only title/revision to the service, ignores forged fields and validates delete revision', async () => {
    expect((await request(app('instructor')).put(`${path}/title`).send({ revision: 4, title: 'Revised', publicationId: 'forged' })).status).toBe(200);
    expect(renameBuilderExam).toHaveBeenCalledWith(courseId, examId, 4, 'Revised');
    expect((await request(app('instructor')).delete(path).send({ revision: 4 })).status).toBe(200);
    expect(deleteBuilderExam).toHaveBeenCalledWith(courseId, examId, 4);
    expect((await request(app('instructor')).delete(path).send({})).status).toBe(400);
  });
});
