import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/exam-templates.service', () => ({
  activeTemplates: jest.fn(),
  listTemplates: jest.fn(),
  saveTemplate: jest.fn(),
}));
jest.mock('../../server/src/services/exam-attempts.service', () => ({
  answerQuestion: jest.fn(),
  examHistory: jest.fn(),
  examResults: jest.fn(),
  examState: jest.fn(),
  getExamAttemptCourseId: jest.fn(),
  startExam: jest.fn(),
  submitExam: jest.fn(),
}));

import { examsRouter } from '../../server/src/routes/exams.routes';
import {
  activeTemplates,
  listTemplates,
  saveTemplate,
} from '../../server/src/services/exam-templates.service';
import {
  answerQuestion,
  examHistory,
  examResults,
  examState,
  getExamAttemptCourseId,
  startExam,
  submitExam,
} from '../../server/src/services/exam-attempts.service';

const courseId = new ObjectId();
const themeId = new ObjectId();
const templateId = new ObjectId();
const attemptId = new ObjectId();

function userFixture(role: 'instructor' | 'student'): User {
  return {
    puid: `PUID-${role}`,
    uid: role,
    displayName: role,
    email: `${role}@example.ubc.ca`,
    affiliations: role === 'instructor' ? ['faculty'] : ['student'],
    isAdmin: false,
    courseRoles: [{ courseId, role }],
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', examsRouter);
  return app;
}

const validBody = {
  themes: [{
    themeId: themeId.toHexString(),
    mcqCount: 4,
    tfCount: 1,
    pointsPerQuestion: 2,
  }],
  timeLimitMinutes: 75,
  availabilityStart: '2026-09-01T00:00:00.000Z',
  availabilityEnd: '2026-09-30T23:59:59.000Z',
  loBreakdown: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(activeTemplates).mockResolvedValue([]);
  jest.mocked(listTemplates).mockResolvedValue([]);
  jest.mocked(saveTemplate).mockResolvedValue({
    template: {
      _id: new ObjectId(),
      courseId,
      kind: 'midterm',
      themes: [{ themeId, mcqCount: 4, tfCount: 1, pointsPerQuestion: 2 }],
      timeLimitMinutes: 75,
      availabilityStart: new Date(validBody.availabilityStart),
      availabilityEnd: new Date(validBody.availabilityEnd),
      loBreakdown: true,
      updatedAt: new Date(),
    },
    warnings: [{
      themeId,
      themeName: 'Time Value of Money',
      requested: 5,
      available: 3,
    }],
  });
  jest.mocked(getExamAttemptCourseId).mockResolvedValue(courseId);
  jest.mocked(startExam).mockResolvedValue({
    _id: attemptId,
    puid: 'PUID-student',
    courseId,
    templateId,
    templateKind: 'midterm',
    loBreakdown: true,
    questions: [],
    shortfalls: [],
    startedAt: new Date('2026-09-01T12:00:00.000Z'),
    maxScore: 0,
  });
  jest.mocked(examState).mockResolvedValue({
    attemptId,
    templateId,
    kind: 'midterm',
    questions: [],
    answers: [],
    shortfalls: [],
    startedAt: new Date('2026-09-01T12:00:00.000Z'),
    submitted: false,
  });
  jest.mocked(examResults).mockResolvedValue({
    attemptId,
    kind: 'midterm',
    submittedAt: new Date('2026-09-01T13:00:00.000Z'),
    score: 3,
    maxScore: 5,
    byTheme: [],
    byLo: [],
    questions: [],
  });
  jest.mocked(examHistory).mockResolvedValue([{
    attemptId,
    kind: 'midterm',
    date: new Date('2026-09-01T13:00:00.000Z'),
    score: 3,
    maxScore: 5,
  }]);
  jest.mocked(submitExam).mockResolvedValue({ score: 3, maxScore: 5 });
});

describe('exam template routes', () => {
  it('401s a signed-out caller and 403s a Student', async () => {
    const signedOut = await request(makeApp()).get(
      `/api/courses/${courseId.toHexString()}/exam-templates`,
    );
    const student = await request(makeApp(userFixture('student'))).get(
      `/api/courses/${courseId.toHexString()}/exam-templates`,
    );

    expect(signedOut.status).toBe(401);
    expect(student.status).toBe(403);
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it('lists course-scoped templates for an Instructor', async () => {
    const response = await request(makeApp(userFixture('instructor'))).get(
      `/api/courses/${courseId.toHexString()}/exam-templates`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(listTemplates).toHaveBeenCalledWith(expect.any(ObjectId));
    expect(jest.mocked(listTemplates).mock.calls[0][0].equals(courseId)).toBe(true);
  });

  it('validates and saves a kind from the route while returning supply warnings', async () => {
    const response = await request(makeApp(userFixture('instructor')))
      .put(`/api/courses/${courseId.toHexString()}/exam-templates/midterm`)
      .send(validBody);

    expect(response.status).toBe(200);
    expect(response.body.warnings).toEqual([{
      themeId: themeId.toHexString(),
      themeName: 'Time Value of Money',
      requested: 5,
      available: 3,
    }]);
    expect(saveTemplate).toHaveBeenCalledWith(
      expect.any(ObjectId),
      expect.objectContaining({
        kind: 'midterm',
        themes: [expect.objectContaining({ themeId: expect.any(ObjectId) })],
        timeLimitMinutes: 75,
        availabilityStart: expect.any(Date),
        availabilityEnd: expect.any(Date),
        loBreakdown: true,
      }),
    );
  });

  it.each([
    ['unknown kind', 'quiz', validBody],
    ['invalid object id', 'midterm', { ...validBody, themes: [{ ...validBody.themes[0], themeId: 'bad' }] }],
    ['zero total questions', 'midterm', { ...validBody, themes: [{ ...validBody.themes[0], mcqCount: 0, tfCount: 0 }] }],
    ['backwards window', 'midterm', { ...validBody, availabilityStart: validBody.availabilityEnd, availabilityEnd: validBody.availabilityStart }],
  ])('400s %s', async (_label, kind, body) => {
    const response = await request(makeApp(userFixture('instructor')))
      .put(`/api/courses/${courseId.toHexString()}/exam-templates/${kind}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(saveTemplate).not.toHaveBeenCalled();
  });
});

describe('student exam routes', () => {
  it('lists only active templates for an enrolled Student', async () => {
    const response = await request(makeApp(userFixture('student'))).get(
      `/api/courses/${courseId.toHexString()}/exams`,
    );

    expect(response.status).toBe(200);
    expect(activeTemplates).toHaveBeenCalledWith(expect.any(ObjectId));
    expect(jest.mocked(activeTemplates).mock.calls[0][0].equals(courseId)).toBe(true);
  });

  it('starts or resumes a single sitting for an active template', async () => {
    const response = await request(makeApp(userFixture('student'))).post(
      `/api/courses/${courseId.toHexString()}/exams/${templateId.toHexString()}/start`,
    );

    expect(response.status).toBe(201);
    expect(response.body._id).toBe(attemptId.toHexString());
    expect(startExam).toHaveBeenCalledWith(
      expect.objectContaining({ puid: 'PUID-student' }),
      expect.any(ObjectId),
      expect.any(ObjectId),
    );
  });

  it('loads the sanitized attempt state through child-resource authorization', async () => {
    const response = await request(makeApp(userFixture('student'))).get(
      `/api/exam-attempts/${attemptId.toHexString()}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      attemptId: attemptId.toHexString(),
      submitted: false,
    }));
    expect(examState).toHaveBeenCalledWith(expect.any(ObjectId), 'PUID-student');
  });

  it('persists an answer and submits the attempt', async () => {
    const answer = await request(makeApp(userFixture('student')))
      .put(`/api/exam-attempts/${attemptId.toHexString()}/answers/0`)
      .send({ selectedKey: 'b' });
    const submit = await request(makeApp(userFixture('student'))).post(
      `/api/exam-attempts/${attemptId.toHexString()}/submit`,
    );

    expect(answer.status).toBe(204);
    expect(answerQuestion).toHaveBeenCalledWith(expect.any(ObjectId), 'PUID-student', 0, 'b');
    expect(submit.status).toBe(200);
    expect(submit.body).toEqual({ score: 3, maxScore: 5 });
  });

  it('returns post-submit results and course history', async () => {
    const results = await request(makeApp(userFixture('student'))).get(
      `/api/exam-attempts/${attemptId.toHexString()}/results`,
    );
    const history = await request(makeApp(userFixture('student'))).get(
      `/api/courses/${courseId.toHexString()}/exam-history`,
    );

    expect(results.status).toBe(200);
    expect(results.body).toEqual(expect.objectContaining({ score: 3, maxScore: 5 }));
    expect(examResults).toHaveBeenCalledWith(expect.any(ObjectId), 'PUID-student');
    expect(history.status).toBe(200);
    expect(history.body[0]).toEqual(expect.objectContaining({
      attemptId: attemptId.toHexString(),
      kind: 'midterm',
    }));
    expect(examHistory).toHaveBeenCalledWith('PUID-student', expect.any(ObjectId));
  });

  it('rejects signed-out child requests before resolving the attempt course', async () => {
    const response = await request(makeApp()).get(
      `/api/exam-attempts/${attemptId.toHexString()}`,
    );

    expect(response.status).toBe(401);
    expect(getExamAttemptCourseId).not.toHaveBeenCalled();
  });

  it('403s Instructors and Students enrolled in another course', async () => {
    const instructor = await request(makeApp(userFixture('instructor'))).get(
      `/api/courses/${courseId.toHexString()}/exams`,
    );
    const otherCourse = new ObjectId();
    jest.mocked(getExamAttemptCourseId).mockResolvedValue(otherCourse);
    const wrongCourse = await request(makeApp(userFixture('student'))).get(
      `/api/exam-attempts/${attemptId.toHexString()}`,
    );

    expect(instructor.status).toBe(403);
    expect(wrongCourse.status).toBe(403);
    expect(examState).not.toHaveBeenCalled();
  });

  it('maps validation, missing attempts, and submitted attempts to stable statuses', async () => {
    const badIndex = await request(makeApp(userFixture('student')))
      .put(`/api/exam-attempts/${attemptId.toHexString()}/answers/-1`)
      .send({ selectedKey: 'a' });
    jest.mocked(getExamAttemptCourseId).mockResolvedValueOnce(null);
    const missing = await request(makeApp(userFixture('student'))).get(
      `/api/exam-attempts/${attemptId.toHexString()}`,
    );
    jest.mocked(answerQuestion).mockRejectedValueOnce(new Error('exam-already-submitted'));
    const submitted = await request(makeApp(userFixture('student')))
      .put(`/api/exam-attempts/${attemptId.toHexString()}/answers/0`)
      .send({ selectedKey: 'a' });

    expect(badIndex.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(submitted.status).toBe(409);
  });
});
