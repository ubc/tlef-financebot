// lmsCanvasRouter via supertest, mirroring courses.routes.test.ts's makeApp.
// The package and components/lms are mocked: no Canvas, no Mongo.
import express, { Router, type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

const tokenStore = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
let requireAuthConnected = true;

jest.mock('@ubc/ubc-genai-toolkit-lms-integration', () => {
  class LmsError extends Error {}
  class CanvasApiError extends LmsError {
    constructor(message: string, public readonly statusCode: number) { super(message); }
  }
  class CanvasGradeExportError extends LmsError {
    constructor(message: string, public readonly reason: string) { super(message); }
  }
  return {
    LmsError,
    canvas: {
      CanvasApiError,
      CanvasGradeExportError,
      createAuthRouter: () => {
        const r = Router();
        r.get('/login', (_req, res) => res.status(302).set('Location', 'https://canvas.test/oauth').end());
        return r;
      },
      requireAuth: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (!requireAuthConnected) {
          res.status(401).json({ success: false, connected: false, connectUrl: '/api/lms/canvas/auth/login' });
          return;
        }
        req.canvasApi = {} as never;
        next();
      },
    },
  };
});
jest.mock('../../server/src/components/lms', () => ({
  getCanvasConfig: () => ({ tokenStore, basePath: '/api/lms/canvas/auth' }),
  isCanvasConfigured: () => true,
}));
jest.mock('../../server/src/services/lms-canvas.service', () => ({
  listTeacherCourses: jest.fn(),
  getLink: jest.fn(),
  linkCourse: jest.fn(),
  unlinkCourse: jest.fn(),
  requireLink: jest.fn(),
  listImportableFiles: jest.fn(),
  importFiles: jest.fn(),
  syncRoster: jest.fn(),
  getCanvasRoster: jest.fn(),
}));

import { createLmsCanvasRouter } from '../../server/src/routes/lms-canvas.routes';
import { listTeacherCourses, getLink, linkCourse, unlinkCourse, listImportableFiles, importFiles, syncRoster, getCanvasRoster } from '../../server/src/services/lms-canvas.service';

const courseId = new ObjectId();

function userFixture(courseRoles: User['courseRoles'], isAdmin = false): User {
  return {
    puid: 'PUID-INSTR-0001',
    uid: 'instr1',
    displayName: 'Instructor One',
    email: 'instr1@example.ubc.ca',
    affiliations: ['faculty'],
    isAdmin,
    courseRoles,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}
const instructor = userFixture([{ courseId, role: 'instructor' }]);
const student = userFixture([{ courseId, role: 'student' }]);
const otherInstructor = userFixture([{ courseId: new ObjectId(), role: 'instructor' }]);
const admin = userFixture([], true);
const base = `/api/lms/canvas/courses/${courseId.toHexString()}`;

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', createLmsCanvasRouter());
  return app;
}

beforeEach(() => {
  tokenStore.get.mockReset();
  requireAuthConnected = true;
  jest.mocked(listTeacherCourses).mockReset();
  jest.mocked(getLink).mockReset();
  jest.mocked(linkCourse).mockReset();
  jest.mocked(unlinkCourse).mockReset();
  jest.mocked(listImportableFiles).mockReset();
  jest.mocked(importFiles).mockReset();
  jest.mocked(syncRoster).mockReset();
  jest.mocked(getCanvasRoster).mockReset();
});

describe('GET /api/lms/canvas/status', () => {
  it('401s a signed-out caller', async () => {
    const res = await request(makeApp(undefined)).get('/api/lms/canvas/status');
    expect(res.status).toBe(401);
  });

  it('reports connected: false when no token is stored — 200, not 401', async () => {
    tokenStore.get.mockResolvedValue(null);
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
    expect(tokenStore.get).toHaveBeenCalledWith('PUID-INSTR-0001');
  });

  it('reports connected: true when a token is stored', async () => {
    tokenStore.get.mockResolvedValue({ accessToken: 'x', refreshToken: 'y', expiresAt: 1, canvasUserId: '5' });
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/status');
    expect(res.body).toEqual({ connected: true });
  });
});

describe('auth router mount', () => {
  it('401s a signed-out caller before the package router runs', async () => {
    const res = await request(makeApp(undefined)).get('/api/lms/canvas/auth/login');
    expect(res.status).toBe(401);
  });

  it('lets a signed-in caller reach the package login route', async () => {
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/auth/login');
    expect(res.status).toBe(302);
  });
});

describe('GET /api/lms/canvas/courses', () => {
  it('returns the teacher list', async () => {
    jest.mocked(listTeacherCourses).mockResolvedValue([{ id: '1', name: 'Demo', code: 'DEMO' }]);
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/courses');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: '1', name: 'Demo', code: 'DEMO' }]);
  });
  it('passes the package 401 through when not connected', async () => {
    requireAuthConnected = false;
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/courses');
    expect(res.status).toBe(401);
    expect(res.body.connected).toBe(false);
  });
});

describe('course link routes', () => {
  it.each([
    ['student', student],
    ['instructor of another course', otherInstructor],
  ])('403s a %s', async (_l, u) => {
    const res = await request(makeApp(u)).get(`${base}/link`);
    expect(res.status).toBe(403);
    expect(getLink).not.toHaveBeenCalled();
  });

  it('admin passes the course guard', async () => {
    jest.mocked(getLink).mockResolvedValue(null);
    const res = await request(makeApp(admin)).get(`${base}/link`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false });
  });

  it('GET link reports linked with linkedBy stripped', async () => {
    jest.mocked(getLink).mockResolvedValue({ courseId: '1', name: 'D', code: 'D', linkedAt: new Date('2026-08-27'), linkedBy: 'P' });
    const res = await request(makeApp(instructor)).get(`${base}/link`);
    expect(res.body).toEqual({ linked: true, canvas: { courseId: '1', name: 'D', code: 'D', linkedAt: '2026-08-27T00:00:00.000Z' } });
  });

  it('PUT link 403s not-teacher and 400s a missing id', async () => {
    jest.mocked(linkCourse).mockRejectedValue(new Error('not-teacher'));
    const denied = await request(makeApp(instructor)).put(`${base}/link`).send({ canvasCourseId: '999' });
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: 'not-teacher' });
    const bad = await request(makeApp(instructor)).put(`${base}/link`).send({});
    expect(bad.status).toBe(400);
  });

  it('PUT link stores and returns the link', async () => {
    const link = { courseId: '1', name: 'D', code: 'D', linkedAt: new Date(), linkedBy: 'PUID-INSTR-0001' };
    jest.mocked(linkCourse).mockResolvedValue(link);
    const res = await request(makeApp(instructor)).put(`${base}/link`).send({ canvasCourseId: '1' });
    expect(res.status).toBe(200);
    expect(linkCourse).toHaveBeenCalledWith(expect.anything(), courseId, '1', 'PUID-INSTR-0001');
    expect(res.body.canvas.courseId).toBe('1');
  });

  it('DELETE link 204s', async () => {
    jest.mocked(unlinkCourse).mockResolvedValue();
    const res = await request(makeApp(instructor)).delete(`${base}/link`);
    expect(res.status).toBe(204);
    expect(unlinkCourse).toHaveBeenCalledWith(courseId);
  });
});

describe('file import routes', () => {
  it('GET files 400s not-linked', async () => {
    jest.mocked(listImportableFiles).mockRejectedValue(new Error('not-linked'));
    const res = await request(makeApp(instructor)).get(`${base}/files`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'not-linked' });
  });
  it('GET files returns the list', async () => {
    jest.mocked(listImportableFiles).mockResolvedValue([{ id: '10', name: 'a.pdf', size: 1, updatedAt: undefined, alreadyImported: false }]);
    const res = await request(makeApp(instructor)).get(`${base}/files`);
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe('10');
  });
  it('POST import 400s an empty or oversized batch', async () => {
    expect((await request(makeApp(instructor)).post(`${base}/files/import`).send({ fileIds: [] })).status).toBe(400);
    expect((await request(makeApp(instructor)).post(`${base}/files/import`).send({ fileIds: Array(21).fill('1') })).status).toBe(400);
    expect(importFiles).not.toHaveBeenCalled();
  });
  it('POST import 201s with created/skipped/failed and strips storagePath', async () => {
    jest.mocked(importFiles).mockResolvedValue({
      created: [{ _id: new ObjectId(), name: 'a.pdf', storagePath: '/secret' }] as never,
      skipped: ['2'], failed: [{ id: '3', reason: 'download-failed' }],
    });
    const res = await request(makeApp(instructor)).post(`${base}/files/import`).send({ fileIds: ['1', '2', '3'] });
    expect(res.status).toBe(201);
    expect(res.body.created[0].storagePath).toBeUndefined();
    expect(res.body.skipped).toEqual(['2']);
    expect(res.body.failed).toEqual([{ id: '3', reason: 'download-failed' }]);
    expect(importFiles).toHaveBeenCalledWith(expect.anything(), courseId, ['1', '2', '3'], 'PUID-INSTR-0001', expect.stringContaining('uploads'));
  });
  it('maps a package 403 to canvas-forbidden with no message', async () => {
    const { canvas: c } = jest.requireMock('@ubc/ubc-genai-toolkit-lms-integration');
    jest.mocked(listImportableFiles).mockRejectedValue(new c.CanvasApiError('secret detail', 403));
    const res = await request(makeApp(instructor)).get(`${base}/files`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'canvas-forbidden' });
  });
});

describe('roster sync routes', () => {
  it('POST sync 409s roster-coverage with a fixed body', async () => {
    const { canvas: c } = jest.requireMock('@ubc/ubc-genai-toolkit-lms-integration');
    jest.mocked(syncRoster).mockRejectedValue(new c.CanvasGradeExportError('all blank', 'roster-coverage'));
    const res = await request(makeApp(instructor)).post(`${base}/roster/sync`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'roster-coverage' });
  });
  it('POST sync returns report, coverage, syncedAt, stored — and no raw', async () => {
    const t = new Date('2026-08-27T10:00:00Z');
    jest.mocked(syncRoster).mockResolvedValue({
      report: { courseId: 'C1', matched: [], appOnly: [], rosterOnly: [{ lmsUserId: '3', name: 'U', key: '42999999' }], ambiguous: [], coverage: { total: 1, integrationId: 1, sisId: 0, email: 0, loginId: 0 } } as never,
      coverage: { total: 1, integrationId: 1, sisId: 0, email: 0, loginId: 0 },
      syncedAt: t,
      stored: 1,
    });
    const res = await request(makeApp(instructor)).post(`${base}/roster/sync`);
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(1);
    expect(res.body.syncedAt).toBe(t.toISOString());
    expect(res.body.report.rosterOnly[0].name).toBe('U');
    expect(JSON.stringify(res.body)).not.toContain('"raw"');
  });
  it('POST sync 400s not-linked', async () => {
    jest.mocked(syncRoster).mockRejectedValue(new Error('not-linked'));
    const res = await request(makeApp(instructor)).post(`${base}/roster/sync`);
    expect(res.status).toBe(400);
  });
  it('GET roster/canvas returns the stored entries', async () => {
    jest.mocked(getCanvasRoster).mockResolvedValue({ syncedAt: null, entries: [] });
    const res = await request(makeApp(instructor)).get(`${base}/roster/canvas`);
    expect(res.body).toEqual({ syncedAt: null, entries: [] });
  });
});
