import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/preview.service', () => ({
  getPreviewCourseIdentity: jest.fn(),
  getPreviewHome: jest.fn(),
  getNextPreviewQuestion: jest.fn(),
  submitPreviewAttempt: jest.fn(),
  flagPreviewQuestion: jest.fn(),
  listPreviewReviewBook: jest.fn(),
  togglePreviewBookmark: jest.fn(),
  removePreviewReviewBookEntry: jest.fn(),
  skipPreviewLo: jest.fn(),
  getPreviewSessionStart: jest.fn(),
  getPreviewSessionSummary: jest.fn(),
  getPreviewRedirectMaterialSource: jest.fn(),
}));

jest.mock('../../server/src/services/capabilities.service', () => ({
  hasCapability: jest.fn(),
}));

import { previewRouter } from '../../server/src/routes/preview.routes';
import { ensureCapability } from '../../server/src/components/auth/capability-guard';
import { errorHandler } from '../../server/src/middleware/error-handler';
import { hasCapability } from '../../server/src/services/capabilities.service';
import {
  flagPreviewQuestion,
  getPreviewCourseIdentity,
  getPreviewHome,
  getNextPreviewQuestion,
  submitPreviewAttempt,
} from '../../server/src/services/preview.service';

const courseId = new ObjectId();
const otherCourseId = new ObjectId();
const loId = new ObjectId();
const questionVersionId = new ObjectId();
const previewSessionId = '11111111-1111-4111-8111-111111111111';

function userFixture(roleCourseId: ObjectId, role: 'student' | 'instructor' | 'ta'): User {
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
  app.get('/review-access/:courseId', ensureCapability('question.review'), (_req, res) => res.json({ allowed: true }));
  app.use('/api', previewRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.mocked(hasCapability).mockReset().mockResolvedValue(false);
  jest.mocked(getPreviewCourseIdentity).mockReset();
  jest.mocked(getPreviewHome).mockReset();
  jest.mocked(getNextPreviewQuestion).mockReset();
  jest.mocked(submitPreviewAttempt).mockReset();
  jest.mocked(flagPreviewQuestion).mockReset();
});

describe('Teaching-team student-preview routes', () => {
  it('lets a current TA load safe Preview identity even when question review is disabled', async () => {
    const identity = { name: 'Finance', courseCode: 'COMM 298', section: '101', term: '2026W1' };
    jest.mocked(getPreviewCourseIdentity).mockResolvedValue(identity);
    const ta = userFixture(courseId, 'ta');
    const app = makeApp(ta);

    expect((await request(app).get(`/review-access/${courseId.toHexString()}`)).status).toBe(403);
    expect(hasCapability).toHaveBeenCalledWith(ta, courseId, 'question.review');
    const response = await request(app).get(`/api/courses/${courseId.toHexString()}/preview/identity`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(identity);
    expect(getPreviewCourseIdentity).toHaveBeenCalledWith(courseId);
  });

  it('protects Preview identity from signed-out users, Students and foreign-course TAs', async () => {
    const path = `/api/courses/${courseId.toHexString()}/preview/identity`;
    expect((await request(makeApp()).get(path)).status).toBe(401);
    expect((await request(makeApp(userFixture(courseId, 'student'))).get(path)).status).toBe(403);
    expect((await request(makeApp(userFixture(otherCourseId, 'ta'))).get(path)).status).toBe(403);
    expect(getPreviewCourseIdentity).not.toHaveBeenCalled();
  });

  it('returns 401 signed out and 403 to students, foreign-course staff, and expired/revoked TAs', async () => {
    const path =
      `/api/courses/${courseId.toHexString()}/preview/home` +
      `?previewSessionId=${previewSessionId}`;

    expect((await request(makeApp()).get(path)).status).toBe(401);
    expect((await request(makeApp(userFixture(courseId, 'student'))).get(path)).status).toBe(403);
    expect((await request(makeApp(userFixture(otherCourseId, 'instructor'))).get(path)).status).toBe(403);
    expect((await request(makeApp(userFixture(otherCourseId, 'ta'))).get(path)).status).toBe(403);
    // The TA expiry job removes the course role; Passport reloads that current
    // record even when the user already has an authenticated session.
    const expiredTa = { ...userFixture(courseId, 'ta'), courseRoles: [] };
    expect((await request(makeApp(expiredTa)).get(path)).status).toBe(403);
    expect(getPreviewHome).not.toHaveBeenCalled();
  });

  it.each(['instructor', 'ta'] as const)('lets the course %s load preview home without student enrollment', async (role) => {
    jest.mocked(getPreviewHome).mockResolvedValue([]);
    const user = userFixture(courseId, role);

    const response = await request(makeApp(user))
      .get(
        `/api/courses/${courseId.toHexString()}/preview/home` +
        `?previewSessionId=${previewSessionId}`,
      );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(getPreviewHome).toHaveBeenCalledWith(courseId, {
      instructorPuid: user.puid,
      previewSessionId,
    });
    expect(user.courseRoles).toEqual([{ courseId, role }]);
  });

  it('lets an Admin load preview home without course roles', async () => {
    jest.mocked(getPreviewHome).mockResolvedValue([]);
    const admin = { ...userFixture(otherCourseId, 'instructor'), isAdmin: true, courseRoles: [] };
    const response = await request(makeApp(admin)).get(
      `/api/courses/${courseId.toHexString()}/preview/home?previewSessionId=${previewSessionId}`,
    );
    expect(response.status).toBe(200);
    expect(getPreviewHome).toHaveBeenCalledWith(courseId, { instructorPuid: admin.puid, previewSessionId });
  });

  it.each(['instructor', 'ta'] as const)('serves and submits for %s only through the explicit preview service', async (role) => {
    const instructor = userFixture(courseId, role);
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
      .send({ previewSessionId, loId: loId.toHexString(), sessionServedIds: [] });
    const attemptResponse = await request(app)
      .post(`/api/courses/${courseId.toHexString()}/preview/attempts`)
      .send({
        previewSessionId,
        questionVersionId: questionVersionId.toHexString(),
        loId: loId.toHexString(),
        mode: 'topic-practice',
        selectedKey: 'A',
        sessionServedIds: [],
      });

    expect(nextResponse.status).toBe(200);
    expect(attemptResponse.status).toBe(200);
    expect(getNextPreviewQuestion).toHaveBeenCalledWith({
      instructorPuid: instructor.puid,
      previewSessionId,
      courseId,
      loId,
      sessionServedIds: [],
      watermarkUid: 'anonymous-preview',
    });
    expect(submitPreviewAttempt).toHaveBeenCalledWith({
      instructorPuid: instructor.puid,
      previewSessionId,
      courseId,
      questionVersionId,
      loId,
      mode: 'topic-practice',
      selectedKey: 'A',
      sessionServedIds: [],
    });
  });

  it('passes the explicit TEST queue option through to the preview service', async () => {
    jest.mocked(flagPreviewQuestion).mockResolvedValue({ flagged: true, testQueued: true });

    const response = await request(makeApp(userFixture(courseId, 'instructor')))
      .post(`/api/courses/${courseId.toHexString()}/preview/questions/${new ObjectId().toHexString()}/flag`)
      .send({
        previewSessionId,
        reason: 'Test the instructor workflow.',
        sendToInstructorQueue: true,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ flagged: true, testQueued: true });
    expect(flagPreviewQuestion).toHaveBeenCalledWith(
      courseId,
      { instructorPuid: 'PUID-INSTRUCTOR-0001', previewSessionId },
      expect.any(ObjectId),
      'Test the instructor workflow.',
      true,
    );
  });

  it('keeps TA flags isolated even when the client requests a live TEST queue item', async () => {
    jest.mocked(flagPreviewQuestion).mockResolvedValue({ flagged: true, testQueued: false });
    const ta = userFixture(courseId, 'ta');
    // An Instructor role in another course cannot authorize the TEST side effect.
    ta.courseRoles.push({ courseId: otherCourseId, role: 'instructor' });

    const response = await request(makeApp(ta))
      .post(`/api/courses/${courseId.toHexString()}/preview/questions/${new ObjectId().toHexString()}/flag`)
      .send({ previewSessionId, reason: 'Preview feedback.', sendToInstructorQueue: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ flagged: true, testQueued: false });
    expect(flagPreviewQuestion).toHaveBeenCalledWith(
      courseId,
      { instructorPuid: ta.puid, previewSessionId },
      expect.any(ObjectId),
      'Preview feedback.',
      false,
    );
  });
});
