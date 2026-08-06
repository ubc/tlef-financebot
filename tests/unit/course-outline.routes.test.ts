import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { Capability, User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/capabilities.service', () => {
  const actual = jest.requireActual('../../server/src/services/capabilities.service') as object;
  return {
    ...actual,
    hasCapability: jest.fn(async (user: User, courseId: ObjectId, capability: Capability) => {
      const role = user.courseRoles.find((entry) => entry.courseId.equals(courseId))?.role;
      if (user.isAdmin || role === 'instructor') return true;
      if (role !== 'ta') return false;
      return capability !== 'question.approve' && capability !== 'flag.resolve';
    }),
  };
});
jest.mock('../../server/src/services/courses.service', () => ({
  getCourseOutline: jest.fn(),
}));

import { coursesRouter } from '../../server/src/routes/courses.routes';
import { getCourseOutline } from '../../server/src/services/courses.service';

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();

function user(role: 'ta' | 'instructor' | 'student'): User {
  return {
    puid: `PUID-${role}`, uid: role, displayName: role, email: `${role}@ubc.ca`,
    affiliations: ['staff'], isAdmin: false, courseRoles: [{ courseId, role }],
    createdAt: new Date(), lastLoginAt: new Date(),
  };
}

function makeApp(as?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(as);
    (req as { user?: unknown }).user = as;
    next();
  });
  app.use('/api', coursesRouter);
  return app;
}

describe('GET /api/courses/:courseId/outline', () => {
  beforeEach(() => {
    (getCourseOutline as jest.Mock).mockResolvedValue({
      course: { name: 'Corporate Finance', courseCode: 'COMM 298', section: '101', term: '2026W1' },
      themes: [{ _id: themeId, name: 'Time Value of Money', order: 0, los: [{ _id: loId, name: 'Discounting', order: 0 }] }],
    });
  });

  it('serves a TA (question.review), who is 403d by the instructor-only course endpoint', async () => {
    const res = await request(makeApp(user('ta'))).get(`/api/courses/${courseId.toString()}/outline`);
    expect(res.status).toBe(200);
    expect(res.body.themes[0].los[0].name).toBe('Discounting');
  });

  it('serves an instructor', async () => {
    const res = await request(makeApp(user('instructor'))).get(`/api/courses/${courseId.toString()}/outline`);
    expect(res.status).toBe(200);
  });

  it('403s a student', async () => {
    const res = await request(makeApp(user('student'))).get(`/api/courses/${courseId.toString()}/outline`);
    expect(res.status).toBe(403);
  });

  it('401s an anonymous caller', async () => {
    const res = await request(makeApp()).get(`/api/courses/${courseId.toString()}/outline`);
    expect(res.status).toBe(401);
  });

  it('returns safe course identity without leaking private course settings', async () => {
    const res = await request(makeApp(user('ta'))).get(`/api/courses/${courseId.toString()}/outline`);
    expect(Object.keys(res.body).sort()).toEqual(['course', 'themes']);
    expect(res.body.course).toEqual({
      name: 'Corporate Finance', courseCode: 'COMM 298', section: '101', term: '2026W1',
    });
    for (const key of ['registrationCode', 'termStart', 'termEnd', 'autoPause', 'feedbackStrategy', 'published']) {
      expect(res.body[key]).toBeUndefined();
      expect(res.body.course[key]).toBeUndefined();
    }
  });
});
