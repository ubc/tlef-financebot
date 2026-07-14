// Integration test — the ROLE-GATED classes router via supertest, with the
// service mocked. Verifies the ensureRole guards (401/403) and that service
// errors carrying a status (403/404/502) reach the client via the central
// error handler.
import express, { type Express } from 'express';
import request from 'supertest';

jest.mock('../../server/src/services/classes.service', () => ({
  getMyClasses: jest.fn(),
  getClassList: jest.fn(),
}));

import { classesRouter } from '../../server/src/routes/classes.routes';
import { getClassList, getMyClasses } from '../../server/src/services/classes.service';
import { errorHandler } from '../../server/src/middleware/error-handler';
import type { User } from '../../server/src/types/domain';

function domainUser(affiliations: string[]): User {
  return {
    puid: 'P1',
    uid: 'u1',
    displayName: 'Test User',
    email: 'test@ubc.ca',
    isAdmin: false,
    affiliations,
    courseRoles: [],
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

function makeApp(user?: User): Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', classesRouter);
  app.use(errorHandler);
  return app;
}

const faculty: User = domainUser(['faculty']);
const student: User = domainUser(['student']);
const staff: User = domainUser(['staff']);

const emptyClasses = { personFound: true, teaching: [], enrolled: [] };

beforeEach(() => {
  jest.mocked(getMyClasses).mockReset();
  jest.mocked(getClassList).mockReset();
});

describe('GET /api/classes', () => {
  it('401s when signed out, without touching the service', async () => {
    const res = await request(makeApp(undefined)).get('/api/classes');
    expect(res.status).toBe(401);
    expect(getMyClasses).not.toHaveBeenCalled();
  });

  it('403s for staff', async () => {
    const res = await request(makeApp(staff)).get('/api/classes');
    expect(res.status).toBe(403);
    expect(getMyClasses).not.toHaveBeenCalled();
  });

  it('answers faculty and students', async () => {
    jest.mocked(getMyClasses).mockResolvedValue(emptyClasses);

    for (const user of [faculty, student]) {
      const res = await request(makeApp(user)).get('/api/classes');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(emptyClasses);
    }
  });

  it('translates an Academic API failure into 502 via the error handler', async () => {
    jest
      .mocked(getMyClasses)
      .mockRejectedValue(Object.assign(new Error('The Academic API is unavailable.'), { status: 502 }));

    const res = await request(makeApp(faculty)).get('/api/classes');

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/academic api/i);
  });
});

describe('GET /api/classes/:sectionId/students', () => {
  it('403s for students (roster is instructor-only)', async () => {
    const res = await request(makeApp(student)).get('/api/classes/SEC-1/students');
    expect(res.status).toBe(403);
    expect(getClassList).not.toHaveBeenCalled();
  });

  it('passes the section id through for faculty', async () => {
    const roster = { sectionId: 'SEC-1', courseCode: 'CPSC 110 101', title: 'X', periodName: 'T1', students: [] };
    jest.mocked(getClassList).mockResolvedValue(roster);

    const res = await request(makeApp(faculty)).get('/api/classes/SEC-1/students');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(roster);
    expect(getClassList).toHaveBeenCalledWith(faculty, 'SEC-1');
  });

  it('surfaces the service ownership check as 403', async () => {
    jest
      .mocked(getClassList)
      .mockRejectedValue(Object.assign(new Error('not your section'), { status: 403 }));

    const res = await request(makeApp(faculty)).get('/api/classes/SEC-1/students');
    expect(res.status).toBe(403);
  });
});
