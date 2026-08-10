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
  upsertCourseOutline: jest.fn(),
  updateLo: jest.fn(),
  archiveLo: jest.fn(),
  getLoCourseId: jest.fn(),
  getCourseTree: jest.fn(),
  publishChecklist: jest.fn(),
  setPublished: jest.fn(),
  archiveCourse: jest.fn(),
  restoreCourse: jest.fn(),
  putRoster: jest.fn(),
  getRoster: jest.fn(),
}));
jest.mock('../../server/src/services/instructor-workflow.service', () => ({
  instructorWorkflowSummary: jest.fn(),
}));
jest.mock('../../server/src/services/course-deletion.service', () => ({
  permanentlyDeleteCourse: jest.fn(),
}));

import { coursesRouter } from '../../server/src/routes/courses.routes';
import {
  createCourse,
  setPublished,
  publishChecklist,
  archiveCourse,
  restoreCourse,
  upsertCourseOutline,
  getThemeCourseId,
  getLoCourseId,
} from '../../server/src/services/courses.service';
import { instructorWorkflowSummary } from '../../server/src/services/instructor-workflow.service';
import { permanentlyDeleteCourse } from '../../server/src/services/course-deletion.service';

const courseId = new ObjectId();
const otherCourseId = new ObjectId();

function userFixture(
  courseRoles: User['courseRoles'],
  extra: Pick<User, 'isAdmin'> & Partial<Pick<User, 'platformInstructor'>> = { isAdmin: false },
): User {
  return {
    puid: 'PUID-INSTR-0001',
    uid: 'instr1',
    displayName: 'Instructor One',
    email: 'instr1@example.ubc.ca',
    affiliations: ['faculty'],
    isAdmin: extra.isAdmin,
    ...(extra.platformInstructor !== undefined ? { platformInstructor: extra.platformInstructor } : {}),
    courseRoles,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

const instructor = userFixture([{ courseId, role: 'instructor' }]);
const student = userFixture([{ courseId, role: 'student' }]);
const ta = userFixture([{ courseId, role: 'ta' }]);
const otherCourseInstructor = userFixture([{ courseId: otherCourseId, role: 'instructor' }]);
const otherCourseStudent = userFixture([{ courseId: otherCourseId, role: 'student' }]);
const otherCourseTa = userFixture([{ courseId: otherCourseId, role: 'ta' }]);
const platformInstructor = userFixture([], { isAdmin: false, platformInstructor: true });
const admin = userFixture([], { isAdmin: true });

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

  it.each([
    ['platform Instructor', platformInstructor],
    ['Admin', admin],
  ])('201s creating a course for a %s', async (_label, creator) => {
    const created = {
      _id: courseId,
      name: 'Intro to Finance',
      courseCode: 'COMM 298',
      term: '2026W1',
      ownerPuid: creator.puid,
      registrationCode: 'ABCD2345',
      published: false,
      feedbackStrategy: 'adaptive',
      autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
      redirectFailureThreshold: 3,
      createdAt: new Date(),
    };
    jest.mocked(createCourse).mockResolvedValue(created as never);

    const res = await request(makeApp(creator))
      .post('/api/courses')
      .send({ name: 'Intro to Finance', courseCode: 'COMM 298', term: '2026W1' });

    expect(res.status).toBe(201);
    expect(createCourse).toHaveBeenCalledWith(creator.puid, {
      name: 'Intro to Finance',
      courseCode: 'COMM 298',
      term: '2026W1',
    });
  });

  it.each([
    ['student', student],
    ['course Instructor without the platform grant', instructor],
  ])('403s course creation for a %s', async (_label, creator) => {
    const res = await request(makeApp(creator))
      .post('/api/courses')
      .send({ name: 'Intro to Finance', courseCode: 'COMM 298', term: '2026W1' });

    expect(res.status).toBe(403);
    expect(createCourse).not.toHaveBeenCalled();
  });

  it('400s creating a course with an invalid body', async () => {
    const res = await request(makeApp(platformInstructor)).post('/api/courses').send({ name: '' });
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

  it('returns the checklist without changing publication state', async () => {
    jest.mocked(publishChecklist).mockResolvedValue([{ item: 'Term dates set', ok: false }]);
    const res = await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/publish-checklist`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ item: 'Term dates set', ok: false }]);
    expect(setPublished).not.toHaveBeenCalled();
  });

  it('returns the Instructor workflow summary only inside course scope', async () => {
    jest.mocked(instructorWorkflowSummary).mockResolvedValue({
      course: { id: courseId.toHexString(), name: 'Finance', courseCode: 'COMM 298', term: '2026W1', lifecycle: 'draft' },
      readiness: { completed: 1, total: 5, percent: 20, checklist: [] },
      counts: {
        topics: 1,
        learningObjectives: 2,
        approvedQuestions: 3,
        reviewQueue: 4,
        openFlags: 0,
        thinLos: 1,
        materials: 1,
        readyMaterials: 1,
        processingMaterials: 0,
        failedMaterials: 0,
        materialsNeedingReview: 0,
        totalQuestions: 7,
        activeGenerationRuns: 0,
        unassignedMaterials: 0,
        contentIssues: 0,
        lowEngagementStudents: 0,
      },
      setup: {
        steps: [],
        primaryAction: {
          id: 'preview-course',
          priority: 'normal',
          destination: 'student-preview',
          title: 'Preview',
          detail: 'Test the course.',
          presentation: 'preview',
        },
      },
      actions: [],
    });

    const allowed = await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/instructor-workflow`,
    );
    const denied = await request(makeApp(student)).get(
      `/api/courses/${courseId.toHexString()}/instructor-workflow`,
    );

    expect(allowed.status).toBe(200);
    expect(allowed.body.readiness.percent).toBe(20);
    expect(instructorWorkflowSummary).toHaveBeenCalledWith(expect.any(ObjectId), instructor.puid);
    expect(denied.status).toBe(403);
  });

  it('401s a signed-out outline upsert before calling the service', async () => {
    const response = await request(makeApp(undefined))
      .post(`/api/courses/${courseId.toHexString()}/outline`)
      .send({ themes: [{ name: 'Foundations', los: ['Explain cash flow'] }] });

    expect(response.status).toBe(401);
    expect(response.body.error).toBeDefined();
    expect(upsertCourseOutline).not.toHaveBeenCalled();
  });

  it.each([
    ['an Instructor assigned only to another course', otherCourseInstructor],
    ['a Student in the target course', student],
    ['a Student assigned only to another course', otherCourseStudent],
    ['a TA in the target course', ta],
    ['a TA assigned only to another course', otherCourseTa],
  ])('403s an outline upsert from %s', async (_label, caller) => {
    const response = await request(makeApp(caller))
      .post(`/api/courses/${courseId.toHexString()}/outline`)
      .send({ themes: [{ name: 'Foundations', los: ['Explain cash flow'] }] });

    expect(response.status).toBe(403);
    expect(response.body.error).toBeDefined();
    expect(upsertCourseOutline).not.toHaveBeenCalled();
  });

  it.each([
    ['the course Instructor', instructor],
    ['an Admin without a course role', admin],
  ])('batch-upserts a reviewed course outline for %s', async (_label, caller) => {
    jest.mocked(upsertCourseOutline).mockResolvedValue({
      themesCreated: 1,
      losCreated: 2,
      themes: [],
    });

    const response = await request(makeApp(caller))
      .post(`/api/courses/${courseId.toHexString()}/outline`)
      .send({ themes: [{ name: 'Foundations', los: ['Explain cash flow', 'Compare discount rates'] }] });

    expect(response.status).toBe(201);
    expect(upsertCourseOutline).toHaveBeenCalledWith(expect.any(ObjectId), {
      themes: [{ name: 'Foundations', los: ['Explain cash flow', 'Compare discount rates'] }],
    });
  });

  it('archives and restores a course through instructor-only endpoints', async () => {
    jest.mocked(archiveCourse).mockResolvedValue({
      _id: courseId,
      published: false,
      lifecycle: 'archived',
    } as never);
    jest.mocked(restoreCourse).mockResolvedValue({
      _id: courseId,
      published: false,
      lifecycle: 'draft',
    } as never);

    const archived = await request(makeApp(instructor)).post(
      `/api/courses/${courseId.toHexString()}/archive`,
    );
    const restored = await request(makeApp(instructor)).post(
      `/api/courses/${courseId.toHexString()}/restore`,
    );

    expect(archived.status).toBe(200);
    expect(archived.body.lifecycle).toBe('archived');
    expect(restored.status).toBe(200);
    expect(restored.body.lifecycle).toBe('draft');
  });

  it('permanently deletes a course only after a validated confirmation body', async () => {
    jest.mocked(permanentlyDeleteCourse).mockResolvedValue({
      deleted: true,
      courseId: courseId.toHexString(),
      deletedFiles: 1,
      missingFiles: 0,
      deletedVectorCollection: true,
      cancelledJobs: 0,
      deletedDocuments: { materials: 1 },
    });

    const allowed = await request(makeApp(instructor))
      .delete(`/api/courses/${courseId.toHexString()}`)
      .send({ confirmation: 'DELETE COMM 298 101' });
    const invalid = await request(makeApp(instructor))
      .delete(`/api/courses/${courseId.toHexString()}`)
      .send({ confirmation: '' });
    const denied = await request(makeApp(student))
      .delete(`/api/courses/${courseId.toHexString()}`)
      .send({ confirmation: 'DELETE COMM 298 101' });

    expect(allowed.status).toBe(200);
    expect(allowed.body.deleted).toBe(true);
    expect(permanentlyDeleteCourse).toHaveBeenCalledWith(
      expect.any(ObjectId),
      { puid: instructor.puid, isAdmin: false },
      'DELETE COMM 298 101',
    );
    expect(invalid.status).toBe(400);
    expect(denied.status).toBe(403);
  });

  it('maps active background work to a retryable conflict', async () => {
    jest.mocked(permanentlyDeleteCourse).mockRejectedValue(new Error('course-delete-active-work'));
    const res = await request(makeApp(instructor))
      .delete(`/api/courses/${courseId.toHexString()}`)
      .send({ confirmation: 'DELETE COMM 298 101' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'course-delete-active-work' });
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
