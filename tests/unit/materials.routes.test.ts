// Integration test — the materialsRouter via supertest, mirroring
// tests/unit/questions.routes.test.ts's makeApp pattern (req.user set to a
// domain-User fixture carrying courseRoles). materials.service is fully
// mocked — the service's own behaviour (format validation, ensureCollection
// dedup, point-id determinism, URL hardening, etc.) is covered by
// materials.service.test.ts; this file is only about the ROUTE layer: guard
// ordering, status mapping, and the two branches (multipart vs `{ url }`)
// POST .../materials must choose between.
//
// multer's real disk storage IS exercised here (not mocked) — that's what
// lets the I4 cleanup-on-failure test assert against a real file on disk
// rather than trusting a mock to reflect what the route actually does.
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/materials.service', () => ({
  // The route reads its multer limits from the service (Phase 6 shared them
  // with the Canvas import); the mock must supply them or multer runs unbounded.
  MAX_FILES_PER_UPLOAD: 20,
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
  createMaterials: jest.fn(),
  createUrlMaterial: jest.fn(),
  listMaterials: jest.fn(),
  listTrashedMaterials: jest.fn(),
  getMaterialWorkspaceDetail: jest.fn(),
  trashMaterial: jest.fn(),
  restoreMaterial: jest.fn(),
  retryMaterial: jest.fn(),
  assignMaterial: jest.fn(),
  updateMaterialKind: jest.fn(),
  getMaterialCourseId: jest.fn(),
}));
jest.mock('../../server/src/services/classification.service', () => ({
  applySuggestedHierarchy: jest.fn(),
  resolveClassification: jest.fn(),
  suggestHierarchy: jest.fn(),
}));

import { materialsRouter } from '../../server/src/routes/materials.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import {
  createMaterials,
  createUrlMaterial,
  listMaterials,
  listTrashedMaterials,
  getMaterialWorkspaceDetail,
  trashMaterial,
  restoreMaterial,
  retryMaterial,
  assignMaterial,
  updateMaterialKind,
  getMaterialCourseId,
} from '../../server/src/services/materials.service';
import {
  applySuggestedHierarchy,
  resolveClassification,
  suggestHierarchy,
} from '../../server/src/services/classification.service';

const courseId = new ObjectId();
const otherCourseId = new ObjectId();
const materialId = new ObjectId();

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
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', materialsRouter);
  // Mounts the real central error handler too (not just materialsRouter's
  // own normalizer) so any error the router-scoped normalizer doesn't
  // recognize is visible as a real response rather than an uncaught
  // rejection, matching questions.routes.test.ts's convention.
  app.use(errorHandler);
  return app;
}

// Track every file supertest .attach()es through the real multer disk
// storage, so it can be removed even when the route under test correctly
// left it on disk (I4) — the test files this service leaves behind on
// success/failure are not part of what's under test.
const filesToCleanUp: string[] = [];
afterEach(async () => {
  await Promise.all(filesToCleanUp.splice(0).map((p) => fsPromises.rm(p, { force: true })));
});

beforeEach(() => {
  jest.mocked(createMaterials).mockReset();
  jest.mocked(createUrlMaterial).mockReset();
  jest.mocked(listMaterials).mockReset();
  jest.mocked(retryMaterial).mockReset();
  jest.mocked(assignMaterial).mockReset();
  jest.mocked(updateMaterialKind).mockReset();
  jest.mocked(getMaterialCourseId).mockReset();
  jest.mocked(applySuggestedHierarchy).mockReset();
  jest.mocked(resolveClassification).mockReset();
  jest.mocked(suggestHierarchy).mockReset();
});

describe('POST /api/courses/:courseId/materials — instructor guard', () => {
  it('403s a non-instructor', async () => {
    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/materials`)
      .send({ url: 'https://example.com/notes' });

    expect(res.status).toBe(403);
    expect(createUrlMaterial).not.toHaveBeenCalled();
  });

  it('401s a signed-out caller', async () => {
    const res = await request(makeApp(undefined))
      .post(`/api/courses/${courseId.toHexString()}/materials`)
      .send({ url: 'https://example.com/notes' });

    expect(res.status).toBe(401);
    expect(createUrlMaterial).not.toHaveBeenCalled();
  });
});

describe('POST /api/courses/:courseId/materials — multipart vs { url } branch', () => {
  it('takes the multipart branch when files[] is attached, and never calls createUrlMaterial', async () => {
    jest.mocked(createMaterials).mockResolvedValue([
      { _id: materialId, courseId, name: 'notes.pdf', format: 'pdf', status: 'processing', assignments: [], uploadedAt: new Date() },
    ] as never);

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/materials`)
      .attach('files', Buffer.from('hello world'), 'notes.pdf');

    if (jest.mocked(createMaterials).mock.calls[0]) {
      filesToCleanUp.push(...(jest.mocked(createMaterials).mock.calls[0][1] as Array<{ path: string }>).map((f) => f.path));
    }

    expect(res.status).toBe(201);
    expect(createMaterials).toHaveBeenCalledTimes(1);
    expect(createUrlMaterial).not.toHaveBeenCalled();
    const [calledCourseId, files] = jest.mocked(createMaterials).mock.calls[0]!;
    expect((calledCourseId as ObjectId).toHexString()).toBe(courseId.toHexString());
    expect(files).toHaveLength(1);
  });

  it('takes the { url } branch when no files are attached, and never calls createMaterials', async () => {
    jest.mocked(createUrlMaterial).mockResolvedValue({
      _id: materialId,
      courseId,
      name: 'https://example.com/notes',
      format: 'url',
      status: 'processing',
      sourceUrl: 'https://example.com/notes',
      assignments: [],
      uploadedAt: new Date(),
    } as never);

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/materials`)
      .send({ url: 'https://example.com/notes' });

    expect(res.status).toBe(201);
    expect(createUrlMaterial).toHaveBeenCalledWith(
      expect.any(ObjectId),
      'https://example.com/notes',
      'PUID-INSTR-0001',
    );
    expect(createMaterials).not.toHaveBeenCalled();
  });

  it('400s an invalid { url } body without calling either service function', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/materials`)
      .send({ url: 'not-a-url' });

    expect(res.status).toBe(400);
    expect(createMaterials).not.toHaveBeenCalled();
    expect(createUrlMaterial).not.toHaveBeenCalled();
  });
});

describe('POST /api/courses/:courseId/materials — unsupported-format naming the format', () => {
  it('400s naming the rejected format', async () => {
    jest.mocked(createMaterials).mockRejectedValue(new Error('unsupported-format:exe'));

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/materials`)
      .attach('files', Buffer.from('MZ...'), 'malware.exe');

    if (jest.mocked(createMaterials).mock.calls[0]) {
      filesToCleanUp.push(...(jest.mocked(createMaterials).mock.calls[0][1] as Array<{ path: string }>).map((f) => f.path));
    }

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported-format:exe');
  });
});

describe('POST /api/courses/:courseId/materials — I4 cleanup scoping', () => {
  it('deletes the uploaded file on an unsupported-format rejection (nothing was persisted)', async () => {
    jest.mocked(createMaterials).mockRejectedValue(new Error('unsupported-format:exe'));

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/materials`)
      .attach('files', Buffer.from('MZ...'), 'malware.exe');

    expect(res.status).toBe(400);
    const [, files] = jest.mocked(createMaterials).mock.calls[0]!;
    const uploadedPath = (files as Array<{ path: string }>)[0]!.path;
    expect(fs.existsSync(uploadedPath)).toBe(false);
  });

  it('does NOT delete the uploaded file on any other failure — materials may already be persisted (I4)', async () => {
    jest.mocked(createMaterials).mockRejectedValue(new Error('mongo-connection-lost'));

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/materials`)
      .attach('files', Buffer.from('%PDF-1.4'), 'notes.pdf');

    expect(res.status).toBe(500);
    const [, files] = jest.mocked(createMaterials).mock.calls[0]!;
    const uploadedPath = (files as Array<{ path: string }>)[0]!.path;
    filesToCleanUp.push(uploadedPath);
    expect(fs.existsSync(uploadedPath)).toBe(true);
  });
});

describe('GET /api/courses/:courseId/materials', () => {
  it('403s a non-instructor', async () => {
    const res = await request(makeApp(student)).get(`/api/courses/${courseId.toHexString()}/materials`);
    expect(res.status).toBe(403);
    expect(listMaterials).not.toHaveBeenCalled();
  });

  it('200s an instructor and returns the service result', async () => {
    jest.mocked(listMaterials).mockResolvedValue([{ _id: materialId } as never]);

    const res = await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/materials`);

    expect(res.status).toBe(200);
    expect(listMaterials).toHaveBeenCalledWith(expect.any(ObjectId));
  });
});

describe('PATCH /api/courses/:courseId/materials/:materialId', () => {
  it('persists an instructor material-kind correction in the path course', async () => {
    jest.mocked(updateMaterialKind).mockResolvedValue({
      _id: materialId,
      courseId,
      kind: 'assessment',
    } as never);

    const res = await request(makeApp(instructor))
      .patch(`/api/courses/${courseId.toHexString()}/materials/${materialId.toHexString()}`)
      .send({ kind: 'assessment' });

    expect(res.status).toBe(200);
    expect(updateMaterialKind).toHaveBeenCalledWith(
      expect.any(ObjectId),
      expect.any(ObjectId),
      'assessment',
    );
  });

  it('rejects a non-instructor before updating metadata', async () => {
    const res = await request(makeApp(student))
      .patch(`/api/courses/${courseId.toHexString()}/materials/${materialId.toHexString()}`)
      .send({ kind: 'assessment' });

    expect(res.status).toBe(403);
    expect(updateMaterialKind).not.toHaveBeenCalled();
  });
});

describe('Course Knowledge Workspace lifecycle routes', () => {
  it('returns an authorized material detail with private storagePath removed', async () => {
    jest.mocked(getMaterialWorkspaceDetail).mockResolvedValue({
      material: { _id: materialId, courseId, storagePath: '/private/upload.pdf' } as never,
      chunks: [{ index: 0, text: 'Evidence', characterCount: 8 }],
    });
    const res = await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/materials/${materialId.toHexString()}/workspace`,
    );
    expect(res.status).toBe(200);
    expect(res.body.material.storagePath).toBeUndefined();
    expect(res.body.chunks).toHaveLength(1);
  });

  it('moves a source to Trash and restores it through course-scoped guards', async () => {
    jest.mocked(trashMaterial).mockResolvedValue({ _id: materialId, courseId, deletedAt: new Date() } as never);
    const deleted = await request(makeApp(instructor)).delete(
      `/api/courses/${courseId.toHexString()}/materials/${materialId.toHexString()}`,
    );
    expect(deleted.status).toBe(200);
    expect(trashMaterial).toHaveBeenCalledWith(expect.any(ObjectId), expect.any(ObjectId), instructor.puid);

    jest.mocked(restoreMaterial).mockResolvedValue({ _id: materialId, courseId, status: 'processing' } as never);
    const restored = await request(makeApp(instructor)).post(
      `/api/courses/${courseId.toHexString()}/materials/${materialId.toHexString()}/restore`,
    );
    expect(restored.status).toBe(200);
    expect(restoreMaterial).toHaveBeenCalledWith(expect.any(ObjectId), expect.any(ObjectId), instructor.puid);
  });

  it('lists Trash only for an instructor', async () => {
    jest.mocked(listTrashedMaterials).mockResolvedValue([]);
    const denied = await request(makeApp(student)).get(`/api/courses/${courseId.toHexString()}/materials-trash`);
    expect(denied.status).toBe(403);
    const allowed = await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/materials-trash`);
    expect(allowed.status).toBe(200);
  });
});

describe('materialId-scoped routes authenticate BEFORE the stash DB lookup', () => {
  it('401s a signed-out POST retry without calling getMaterialCourseId', async () => {
    const res = await request(makeApp(undefined)).post(`/api/materials/${materialId.toHexString()}/retry`);
    expect(res.status).toBe(401);
    expect(getMaterialCourseId).not.toHaveBeenCalled();
  });

  it('401s a signed-out PUT assignments without calling getMaterialCourseId', async () => {
    const res = await request(makeApp(undefined))
      .put(`/api/materials/${materialId.toHexString()}/assignments`)
      .send({ assignments: [] });
    expect(res.status).toBe(401);
    expect(getMaterialCourseId).not.toHaveBeenCalled();
  });

  it('404s retry when the material does not exist', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(null);

    const res = await request(makeApp(instructor)).post(`/api/materials/${materialId.toHexString()}/retry`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('material-not-found');
    expect(retryMaterial).not.toHaveBeenCalled();
  });

  it('403s a non-instructor of the material\'s course', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(otherCourseId);

    const res = await request(makeApp(instructor)).post(`/api/materials/${materialId.toHexString()}/retry`);

    expect(res.status).toBe(403);
    expect(retryMaterial).not.toHaveBeenCalled();
  });

  it('200s retry for the material\'s own instructor', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(courseId);
    jest.mocked(retryMaterial).mockResolvedValue({ _id: materialId, status: 'processing' } as never);

    const res = await request(makeApp(instructor)).post(`/api/materials/${materialId.toHexString()}/retry`);

    expect(res.status).toBe(200);
    expect(retryMaterial).toHaveBeenCalledWith(expect.any(ObjectId), 'PUID-INSTR-0001');
  });

  it('200s assignments for the material\'s own instructor and replaces assignments', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(courseId);
    jest.mocked(assignMaterial).mockResolvedValue({ _id: materialId, status: 'ready' } as never);
    const themeId = new ObjectId().toHexString();

    const res = await request(makeApp(instructor))
      .put(`/api/materials/${materialId.toHexString()}/assignments`)
      .send({ assignments: [{ themeId }] });

    expect(res.status).toBe(200);
    expect(assignMaterial).toHaveBeenCalledWith(expect.any(ObjectId), [{ themeId: expect.any(ObjectId) }]);
  });
});

describe('I5 — multer errors are normalized, not left to default to 500', () => {
  it('413s an over-limit file instead of 500ing "File too large"', async () => {
    const oversized = Buffer.alloc(50 * 1024 * 1024 + 1, 'a');

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/materials`)
      .attach('files', oversized, 'huge.pdf');

    expect(res.status).toBe(413);
    expect(createMaterials).not.toHaveBeenCalled();
  }, 20000);

  it('400s a MulterError that is not LIMIT_FILE_SIZE (unexpected field name)', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/materials`)
      .attach('not-files', Buffer.from('hello'), 'notes.pdf');

    expect(res.status).toBe(400);
    expect(createMaterials).not.toHaveBeenCalled();
  });
});

describe('POST /api/materials/:materialId/classification (IN-S06)', () => {
  it('401s a signed-out caller without calling getMaterialCourseId', async () => {
    const res = await request(makeApp(undefined))
      .post(`/api/materials/${materialId.toHexString()}/classification`)
      .send({ action: 'accept' });
    expect(res.status).toBe(401);
    expect(getMaterialCourseId).not.toHaveBeenCalled();
    expect(resolveClassification).not.toHaveBeenCalled();
  });

  it('403s a non-instructor of the material\'s course', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(otherCourseId);
    const res = await request(makeApp(instructor))
      .post(`/api/materials/${materialId.toHexString()}/classification`)
      .send({ action: 'accept' });
    expect(res.status).toBe(403);
    expect(resolveClassification).not.toHaveBeenCalled();
  });

  it('400s an invalid action', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(courseId);
    const res = await request(makeApp(instructor))
      .post(`/api/materials/${materialId.toHexString()}/classification`)
      .send({ action: 'maybe' });
    expect(res.status).toBe(400);
    expect(resolveClassification).not.toHaveBeenCalled();
  });

  it('200s accept for the material\'s own instructor', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(courseId);
    jest.mocked(resolveClassification).mockResolvedValue({ _id: materialId, status: 'ready' } as never);

    const res = await request(makeApp(instructor))
      .post(`/api/materials/${materialId.toHexString()}/classification`)
      .send({ action: 'accept' });

    expect(res.status).toBe(200);
    expect(resolveClassification).toHaveBeenCalledWith(expect.any(ObjectId), 'accept');
  });

  it('400s "no-classification-suggestion" from the service via the normalizer', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(courseId);
    jest.mocked(resolveClassification).mockRejectedValue(new Error('no-classification-suggestion'));

    const res = await request(makeApp(instructor))
      .post(`/api/materials/${materialId.toHexString()}/classification`)
      .send({ action: 'accept' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no-classification-suggestion');
  });
});

describe('GET /api/courses/:courseId/suggest-hierarchy (IN-S06)', () => {
  it('403s a non-instructor', async () => {
    const res = await request(makeApp(student)).get(`/api/courses/${courseId.toHexString()}/suggest-hierarchy`);
    expect(res.status).toBe(403);
    expect(suggestHierarchy).not.toHaveBeenCalled();
  });

  it('200s an instructor and returns the suggested hierarchy', async () => {
    jest.mocked(suggestHierarchy).mockResolvedValue({
      themes: [{ name: 'Bonds', los: ['Price a bond'] }],
      assignments: [
        {
          themeIndex: 0,
          loIndex: 0,
          materialIds: [materialId.toHexString()],
        },
      ],
    });

    const res = await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/suggest-hierarchy`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      themes: [{ name: 'Bonds', los: ['Price a bond'] }],
      assignments: [
        {
          themeIndex: 0,
          loIndex: 0,
          materialIds: [materialId.toHexString()],
        },
      ],
    });
    expect(suggestHierarchy).toHaveBeenCalledWith(expect.any(ObjectId));
  });
});

describe('POST /api/courses/:courseId/apply-suggested-hierarchy', () => {
  const body = {
    themes: [
      {
        name: 'Forces',
        los: [{ name: 'Friction', materialIds: [materialId.toHexString()] }],
      },
    ],
  };

  it('403s a non-instructor before applying anything', async () => {
    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/apply-suggested-hierarchy`)
      .send(body);

    expect(res.status).toBe(403);
    expect(applySuggestedHierarchy).not.toHaveBeenCalled();
  });

  it('creates the reviewed hierarchy and assignments for an instructor', async () => {
    jest.mocked(applySuggestedHierarchy).mockResolvedValue({
      themesCreated: 1,
      losCreated: 1,
      materialsAssigned: 1,
      assignmentsCreated: 1,
    });

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/apply-suggested-hierarchy`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      themesCreated: 1,
      losCreated: 1,
      materialsAssigned: 1,
      assignmentsCreated: 1,
    });
    expect(applySuggestedHierarchy).toHaveBeenCalledWith(expect.any(ObjectId), body);
  });

  it('400s malformed material ids before calling the service', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/apply-suggested-hierarchy`)
      .send({
        themes: [{ name: 'Forces', los: [{ name: 'Friction', materialIds: ['bad-id'] }] }],
      });

    expect(res.status).toBe(400);
    expect(applySuggestedHierarchy).not.toHaveBeenCalled();
  });
});
