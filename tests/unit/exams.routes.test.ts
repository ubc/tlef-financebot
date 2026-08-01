import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/exam-templates.service', () => ({
  listTemplates: jest.fn(),
  saveTemplate: jest.fn(),
}));

import { examsRouter } from '../../server/src/routes/exams.routes';
import {
  listTemplates,
  saveTemplate,
} from '../../server/src/services/exam-templates.service';

const courseId = new ObjectId();
const themeId = new ObjectId();

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
