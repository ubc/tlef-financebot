import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/preview.service', () => ({
  getPreviewHome: jest.fn(),
  getNextPreviewQuestion: jest.fn(),
  submitPreviewAttempt: jest.fn(),
}));

import { previewRouter } from '../../server/src/routes/preview.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import {
  getPreviewHome,
  getNextPreviewQuestion,
  submitPreviewAttempt,
} from '../../server/src/services/preview.service';

const courseId = new ObjectId();
const otherCourseId = new ObjectId();
const loId = new ObjectId();
const questionVersionId = new ObjectId();

function userFixture(roleCourseId: ObjectId, role: 'student' | 'instructor'): User {
  return {
    puid: `PUID-${role.toUpperCase()}-0001`,
    uid: `${role}1`,
    displayName: `${role} One`,
    email: `${role}1@example.ubc.ca`,
    affiliations: [role],
    isAdmin: false,
    courseRoles: [{ courseId: roleCourseId, role }],
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
  app.use('/api', previewRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.mocked(getPreviewHome).mockReset();
  jest.mocked(getNextPreviewQuestion).mockReset();
  jest.mocked(submitPreviewAttempt).mockReset();
});

describe('Instructor student-preview routes', () => {
  it('returns 401 signed out and 403 to a student or another course instructor', async () => {
    const path = `/api/courses/${courseId.toHexString()}/preview/home`;

    expect((await request(makeApp()).get(path)).status).toBe(401);
    expect((await request(makeApp(userFixture(courseId, 'student'))).get(path)).status).toBe(403);
    expect((await request(makeApp(userFixture(otherCourseId, 'instructor'))).get(path)).status).toBe(403);
    expect(getPreviewHome).not.toHaveBeenCalled();
  });

  it('lets the course instructor load preview home without student enrollment', async () => {
    jest.mocked(getPreviewHome).mockResolvedValue([]);

    const response = await request(makeApp(userFixture(courseId, 'instructor')))
      .get(`/api/courses/${courseId.toHexString()}/preview/home`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(getPreviewHome).toHaveBeenCalledWith(courseId);
  });

  it('serves and submits only through the explicit preview service', async () => {
    const instructor = userFixture(courseId, 'instructor');
    jest.mocked(getNextPreviewQuestion).mockResolvedValue({
      questionId: new ObjectId().toHexString(),
      questionVersionId: questionVersionId.toHexString(),
      type: 'mcq',
      stem: 'Preview question',
      difficulty: 'medium',
      degraded: 'none',
      options: [{ key: 'A', text: 'Answer A' }],
      watermark: instructor.uid,
    });
    jest.mocked(submitPreviewAttempt).mockResolvedValue({
      correct: true,
      feedback: {
        strategy: 'b',
        revealed: [{
          key: 'A',
          text: 'Answer A',
          role: 'correct',
          explanation: 'Correct.',
          correct: true,
        }],
      },
      mastery: { loStatus: 'not-attempted' },
      reviewBook: { added: false },
    });
    const app = makeApp(instructor);

    const nextResponse = await request(app)
      .post(`/api/courses/${courseId.toHexString()}/preview/practice/next`)
      .send({ loId: loId.toHexString(), sessionServedIds: [] });
    const attemptResponse = await request(app)
      .post(`/api/courses/${courseId.toHexString()}/preview/attempts`)
      .send({
        questionVersionId: questionVersionId.toHexString(),
        loId: loId.toHexString(),
        selectedKey: 'A',
        sessionServedIds: [],
      });

    expect(nextResponse.status).toBe(200);
    expect(attemptResponse.status).toBe(200);
    expect(getNextPreviewQuestion).toHaveBeenCalledWith({
      courseId,
      loId,
      sessionServedIds: [],
      watermarkUid: instructor.uid,
    });
    expect(submitPreviewAttempt).toHaveBeenCalledWith({
      instructorPuid: instructor.puid,
      courseId,
      questionVersionId,
      loId,
      selectedKey: 'A',
      sessionServedIds: [],
    });
  });
});
