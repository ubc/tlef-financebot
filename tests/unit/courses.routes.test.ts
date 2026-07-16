// Integration test — the coursesRouter via supertest, mirroring
// tests/unit/notes.route.test.ts's makeApp pattern but with req.user set to a
// domain-User fixture carrying courseRoles (ensureCourseInstructor() reads
// req.user.courseRoles directly, unlike ensureApiAuthenticated() which only
// checks req.isAuthenticated()). courses.service is fully mocked.
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/courses.service', () => ({
  createCourse: jest.fn(),
  getCourse: jest.fn(),
  updateCourse: jest.fn(),
  regenerateRegistrationCode: jest.fn(),
  addTheme: jest.fn(),
  updateTheme: jest.fn(),
  archiveTheme: jest.fn(),
  getThemeCourseId: jest.fn(),
  addLo: jest.fn(),
  updateLo: jest.fn(),
  archiveLo: jest.fn(),
  getLoCourseId: jest.fn(),
  getCourseTree: jest.fn(),
  publishChecklist: jest.fn(),
  setPublished: jest.fn(),
  putRoster: jest.fn(),
  getRoster: jest.fn(),
}));

import { coursesRouter } from '../../server/src/routes/courses.routes';
import {
  createCourse,
  setPublished,
  publishChecklist,
  getThemeCourseId,
  getLoCourseId,
} from '../../server/src/services/courses.service';

const courseId = new ObjectId();

function userFixture(courseRoles: User['courseRoles']): User {
  return {
    puid: 'PUID-INSTR-0001',
    uid: 'instr1',
    displayName: 'Instructor One',
    email: 'instr1@example.ubc.ca',
    affiliations: ['faculty'],
    isAdmin: false,
    courseRoles,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

const instructor = userFixture([{ courseId, role: 'instructor' }]);
const student = userFixture([{ courseId, role: 'student' }]);

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Stand in for passport (the real guards call these).
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', coursesRouter);
  return app;
}

describe('courses routes (auth + course-instructor gating)', () => {
  it('401s a signed-out caller', async () => {
    const res = await request(makeApp(undefined)).get(`/api/courses/${courseId.toHexString()}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('403s a non-instructor PATCHing a course', async () => {
    const res = await request(makeApp(student))
      .patch(`/api/courses/${courseId.toHexString()}`)
      .send({ feedbackStrategy: 'strategy-a' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  it('201s creating a course for any signed-in user', async () => {
    const created = {
      _id: courseId,
      name: 'Intro to Finance',
      courseCode: 'COMM 298',
      term: '2026W1',
      ownerPuid: instructor.puid,
      registrationCode: 'ABCD2345',
      published: false,
      feedbackStrategy: 'adaptive',
      autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
      redirectFailureThreshold: 3,
      createdAt: new Date(),
    };
    jest.mocked(createCourse).mockResolvedValue(created as never);

    const res = await request(makeApp(instructor))
      .post('/api/courses')
      .send({ name: 'Intro to Finance', courseCode: 'COMM 298', term: '2026W1' });

    expect(res.status).toBe(201);
    expect(createCourse).toHaveBeenCalledWith(instructor.puid, {
      name: 'Intro to Finance',
      courseCode: 'COMM 298',
      term: '2026W1',
    });
  });

  it('400s creating a course with an invalid body', async () => {
    const res = await request(makeApp(instructor)).post('/api/courses').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(createCourse).not.toHaveBeenCalled();
  });

  it('publish returns { published, checklist }', async () => {
    jest.mocked(setPublished).mockResolvedValue({ _id: courseId, published: true } as never);
    jest.mocked(publishChecklist).mockResolvedValue([
      { item: 'Term dates set', ok: true },
      { item: 'At least one Theme', ok: true },
    ] as never);

    const res = await request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/publish`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      published: true,
      checklist: [
        { item: 'Term dates set', ok: true },
        { item: 'At least one Theme', ok: true },
      ],
    });
    expect(setPublished).toHaveBeenCalledWith(expect.any(ObjectId), true);
  });
});

describe('Theme/LO routes authenticate before the stash DB lookup', () => {
  const themeId = new ObjectId();
  const loId = new ObjectId();

  beforeEach(() => {
    jest.mocked(getThemeCourseId).mockReset();
    jest.mocked(getLoCourseId).mockReset();
  });

  it('401s a signed-out PATCH /themes/:themeId without calling getThemeCourseId', async () => {
    const res = await request(makeApp(undefined))
      .patch(`/api/themes/${themeId.toHexString()}`)
      .send({ name: 'New name' });
    expect(res.status).toBe(401);
    expect(getThemeCourseId).not.toHaveBeenCalled();
  });

  it('401s a signed-out POST /themes/:themeId/archive without calling getThemeCourseId', async () => {
    const res = await request(makeApp(undefined)).post(`/api/themes/${themeId.toHexString()}/archive`);
    expect(res.status).toBe(401);
    expect(getThemeCourseId).not.toHaveBeenCalled();
  });

  it('401s a signed-out POST /themes/:themeId/los without calling getThemeCourseId', async () => {
    const res = await request(makeApp(undefined))
      .post(`/api/themes/${themeId.toHexString()}/los`)
      .send({ name: 'New LO' });
    expect(res.status).toBe(401);
    expect(getThemeCourseId).not.toHaveBeenCalled();
  });

  it('401s a signed-out PATCH /los/:loId without calling getLoCourseId', async () => {
    const res = await request(makeApp(undefined)).patch(`/api/los/${loId.toHexString()}`).send({ name: 'x' });
    expect(res.status).toBe(401);
    expect(getLoCourseId).not.toHaveBeenCalled();
  });

  it('401s a signed-out POST /los/:loId/archive without calling getLoCourseId', async () => {
    const res = await request(makeApp(undefined)).post(`/api/los/${loId.toHexString()}/archive`);
    expect(res.status).toBe(401);
    expect(getLoCourseId).not.toHaveBeenCalled();
  });
});
