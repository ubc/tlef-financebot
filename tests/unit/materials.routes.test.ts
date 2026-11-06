jest.mock('../../server/src/services/structure-generation.service', () => ({ ...jest.requireActual('../../server/src/services/structure-generation.service'), enqueueStructureGeneration: jest.fn(),
  enqueueStructureOutlineRepair: jest.fn(), enqueueStructureOutlineCoverageRepair: jest.fn(), getStructureOutlineRepairView: jest.fn() }));
jest.mock('../../server/src/services/material-upload-batches.service', () => ({ ...jest.requireActual('../../server/src/services/material-upload-batches.service'), prepareMaterialUploadBatch: jest.fn(), readMaterialUploadBatch: jest.fn(), claimMaterialUploadBatch: jest.fn(), acceptMaterialUploadBatch: jest.fn(), rejectMaterialUploadBatch: jest.fn() }));
jest.mock('../../server/src/services/source-readiness.service', () => ({ resolveSourceSelection: jest.fn() }));
import { enqueueStructureGeneration, enqueueStructureOutlineRepair, enqueueStructureOutlineCoverageRepair, getStructureOutlineRepairView } from '../../server/src/services/structure-generation.service';
import { prepareMaterialUploadBatch, readMaterialUploadBatch, claimMaterialUploadBatch, acceptMaterialUploadBatch, rejectMaterialUploadBatch } from '../../server/src/services/material-upload-batches.service';
import { resolveSourceSelection } from '../../server/src/services/source-readiness.service';
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
import path from 'node:path';
import { createHash } from 'node:crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';
jest.mock('../../server/src/services/material-source-provenance.service', () => ({
  ...jest.requireActual('../../server/src/services/material-source-provenance.service'),
  readMaterialSourceProvenance: jest.fn(),
}));
import { readMaterialSourceProvenance } from '../../server/src/services/material-source-provenance.service';

jest.mock('../../server/src/services/materials.service', () => ({
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
  applyGeneratedHierarchy: jest.fn(),
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
  applyGeneratedHierarchy,
  resolveClassification,
  suggestHierarchy,
} from '../../server/src/services/classification.service';

const courseId = new ObjectId();
const otherCourseId = new ObjectId();
const materialId = new ObjectId();
const batchId = new ObjectId();

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
const ta = userFixture([{ courseId, role: 'ta' }]);
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
  jest.mocked(readMaterialSourceProvenance).mockReset();
  jest.mocked(createMaterials).mockReset();
  jest.mocked(createUrlMaterial).mockReset();
  jest.mocked(listMaterials).mockReset();
  jest.mocked(retryMaterial).mockReset();
  jest.mocked(assignMaterial).mockReset();
  jest.mocked(updateMaterialKind).mockReset();
  jest.mocked(getMaterialCourseId).mockReset();
  jest.mocked(applyGeneratedHierarchy).mockReset();
  jest.mocked(resolveClassification).mockReset();
  jest.mocked(suggestHierarchy).mockReset();
  jest.mocked(prepareMaterialUploadBatch).mockReset();
  jest.mocked(readMaterialUploadBatch).mockReset();
  jest.mocked(claimMaterialUploadBatch).mockReset();
  jest.mocked(acceptMaterialUploadBatch).mockReset();
  jest.mocked(rejectMaterialUploadBatch).mockReset();
  jest.mocked(rejectMaterialUploadBatch).mockResolvedValue(undefined);
  jest.mocked(resolveSourceSelection).mockReset();
});

describe('intended-file receipts and authoritative source-readiness HTTP boundaries', () => {
  const manifest = Array.from({ length: 10 }, (_, index) => ({ clientFileId: String(index), name: `chapter-${index + 1}.pdf`, size: 10 }));
  it('guards preparation before writes and records every requested filename', async () => {
    const body = { requestId: '08daf40c-2668-4b71-98ba-19318233c411', files: manifest };
    for (const user of [undefined, ta, student]) {
      expect((await request(makeApp(user)).post(`/api/courses/${courseId}/material-upload-batches`).send(body)).status).toBe(user ? 403 : 401);
    }
    expect(prepareMaterialUploadBatch).not.toHaveBeenCalled();
    jest.mocked(prepareMaterialUploadBatch).mockResolvedValue({ _id: batchId } as never);
    jest.mocked(readMaterialUploadBatch).mockResolvedValue({ _id: batchId, items: manifest } as never);
    const response = await request(makeApp(instructor)).post(`/api/courses/${courseId}/material-upload-batches`).send(body);
    expect(response.status).toBe(201);
    expect(response.body.items).toHaveLength(10);
    expect(prepareMaterialUploadBatch).toHaveBeenCalledWith(courseId, instructor.puid, body.requestId, manifest);
  });

  it('checks actor/course ownership before receiving multipart bytes and recovers accepted response replays', async () => {
    jest.mocked(claimMaterialUploadBatch).mockRejectedValueOnce(Object.assign(new Error('material-upload-batch-not-found'), { status: 404 }));
    let response = await request(makeApp(instructor)).post(`/api/courses/${courseId}/material-upload-batches/${batchId}/files`).attach('files', Buffer.from('bytes'), 'chapter.pdf');
    expect(response.status).toBe(404);
    expect(acceptMaterialUploadBatch).not.toHaveBeenCalled();
    jest.mocked(claimMaterialUploadBatch).mockResolvedValueOnce({ batch: { _id: batchId, admission: 'accepted' } } as never);
    jest.mocked(readMaterialUploadBatch).mockResolvedValue({ _id: batchId, admission: 'accepted', items: manifest } as never);
    response = await request(makeApp(instructor)).post(`/api/courses/${courseId}/material-upload-batches/${batchId}/files`).attach('files', Buffer.from('bytes'), 'chapter.pdf');
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(10);
    expect(acceptMaterialUploadBatch).not.toHaveBeenCalled();
  });

  it('links Multer count admission failure to the prepared intended receipt', async () => {
    jest.mocked(claimMaterialUploadBatch).mockResolvedValue({ owner: 'upload-owner', batch: { _id: batchId } } as never);
    let pending = request(makeApp(instructor)).post(`/api/courses/${courseId}/material-upload-batches/${batchId}/files`);
    for (let index = 0; index < 21; index++) pending = pending.attach('files', Buffer.from('bytes'), `chapter-${index}.pdf`);
    const response = await pending;
    expect(response.status).toBe(400);
    expect(rejectMaterialUploadBatch).toHaveBeenCalledWith(courseId, batchId, 'upload-owner', 'Too many files');
    expect(acceptMaterialUploadBatch).not.toHaveBeenCalled();
  });

  it('cleans only whole-batch unsupported uploads before persistence and returns admission failure', async () => {
    jest.mocked(claimMaterialUploadBatch).mockResolvedValue({ owner: 'owner', batch: { _id: batchId } } as never);
    let serverPath = '';
    jest.mocked(acceptMaterialUploadBatch).mockImplementation(async (_course, _batch, _actor, _owner, files) => { serverPath = files[0]!.path; filesToCleanUp.push(serverPath); throw new Error('unsupported-format:exe'); });
    const response = await request(makeApp(instructor)).post(`/api/courses/${courseId}/material-upload-batches/${batchId}/files`).attach('files', Buffer.from('bytes'), 'bad.exe');
    expect(response.status).toBe(400);
    expect(rejectMaterialUploadBatch).toHaveBeenCalledWith(courseId, batchId, 'owner', 'unsupported-format:exe');
    expect(fs.existsSync(serverPath)).toBe(false);
  });

  it('retains named not-ready reports and passes intentional subsets through the server resolver', async () => {
    const report = { requested: [{ name: 'chapter-7.pdf', ready: false, reason: 'material-processing' }], included: [], excluded: [], ready: false };
    jest.mocked(resolveSourceSelection).mockResolvedValue(report as never);
    const body = { sourceBatchId: batchId.toHexString(), materialIds: [materialId.toHexString()] };
    const response = await request(makeApp(instructor)).post(`/api/courses/${courseId}/source-readiness`).send(body);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(report);
    expect(resolveSourceSelection).toHaveBeenCalledWith(courseId, body);
    expect((await request(makeApp(ta)).post(`/api/courses/${courseId}/source-readiness`).send(body)).status).toBe(403);
  });

  it('returns structure readiness errors with the full named receipt rather than only a generic error', async () => {
    const report = { requested: [{ name: 'chapter-7.pdf', ready: false }], included: [], excluded: [], ready: false };
    jest.mocked(enqueueStructureGeneration).mockRejectedValueOnce(Object.assign(new Error('source-not-ready'), { status: 409, report }));
    const response = await request(makeApp(instructor)).post(`/api/courses/${courseId}/structure-generation`).send({ materialIds: [materialId.toHexString()] });
    expect(response.status).toBe(409);
    expect(response.body.report).toEqual(report);
  });
});

describe('TA read-only material access', () => {
  it('lists and inspects materials in the assigned course', async () => {
    const material = { _id: materialId, courseId, name: 'Course notes', format: 'url', status: 'ready', assignments: [], uploadedAt: new Date(), sourceUrl: 'https://example.com/notes' };
    jest.mocked(listMaterials).mockResolvedValue([material] as never);
    jest.mocked(getMaterialWorkspaceDetail).mockResolvedValue({ material, chunks: [{ index: 0, text: 'A lesson', characterCount: 8 }] } as never);
    const list = await request(makeApp(ta)).get(`/api/courses/${courseId}/materials`);
    const detail = await request(makeApp(ta)).get(`/api/courses/${courseId}/materials/${materialId}/workspace`);
    const source = await request(makeApp(ta)).get(`/api/courses/${courseId}/materials/${materialId}/source`);
    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(detail.body.chunks[0].text).toBe('A lesson');
    expect(source.status).toBe(302);
    expect(source.headers.location).toBe('https://example.com/notes');
  });

  it('denies another course and keeps material mutations instructor-only', async () => {
    expect((await request(makeApp(ta)).get(`/api/courses/${otherCourseId}/materials`)).status).toBe(403);
    expect((await request(makeApp(student)).get(`/api/courses/${courseId}/materials`)).status).toBe(403);
    expect((await request(makeApp(ta)).post(`/api/courses/${courseId}/materials`).send({ url: 'https://example.com/notes' })).status).toBe(403);
    expect(createUrlMaterial).not.toHaveBeenCalled();
  });
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
      .send({ kind: 'assessment', expectedRevision: 0 });

    expect(res.status).toBe(200);
    expect(updateMaterialKind).toHaveBeenCalledWith(
      expect.any(ObjectId),
      expect.any(ObjectId),
      'assessment',
      0,
    );
  });

  it('rejects a non-instructor before updating metadata', async () => {
    const res = await request(makeApp(student))
      .patch(`/api/courses/${courseId.toHexString()}/materials/${materialId.toHexString()}`)
      .send({ kind: 'assessment', expectedRevision: 0 });

    expect(res.status).toBe(403);
    expect(updateMaterialKind).not.toHaveBeenCalled();
  });
});

describe('Course Knowledge Workspace lifecycle routes', () => {
  it.each(['retry', 'assignments', 'kind', 'classification'])('omits private filesystem paths from the %s response', async mutation => {
    const privateMaterial = { _id: materialId, courseId, storagePath: '/private/original.pdf', rawTextStoragePath: '/private/raw-sidecar.txt' } as never;
    jest.mocked(getMaterialCourseId).mockResolvedValue(courseId);
    jest.mocked(retryMaterial).mockResolvedValue(privateMaterial); jest.mocked(assignMaterial).mockResolvedValue(privateMaterial);
    jest.mocked(updateMaterialKind).mockResolvedValue(privateMaterial); jest.mocked(resolveClassification).mockResolvedValue(privateMaterial);
    const app = makeApp(instructor);
    const pending = mutation === 'retry' ? request(app).post(`/api/materials/${materialId}/retry`)
      : mutation === 'assignments' ? request(app).put(`/api/materials/${materialId}/assignments`).send({ assignments: [], expectedRevision: 0 })
        : mutation === 'kind' ? request(app).patch(`/api/courses/${courseId}/materials/${materialId}`).send({ kind: 'reading', expectedRevision: 0 })
          : request(app).post(`/api/materials/${materialId}/classification`).send({ action: 'reject', expectedRevision: 0 });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('storagePath'); expect(response.body).not.toHaveProperty('rawTextStoragePath');
  });

  it('returns an authorized material detail with private storagePath removed', async () => {
    jest.mocked(getMaterialWorkspaceDetail).mockResolvedValue({
      material: { _id: materialId, courseId, storagePath: '/private/upload.pdf', rawTextStoragePath: '/private/raw.txt' } as never,
      chunks: [{ index: 0, text: 'Evidence', characterCount: 8 }],
    });
    const res = await request(makeApp(instructor)).get(
      `/api/courses/${courseId.toHexString()}/materials/${materialId.toHexString()}/workspace`,
    );
    expect(res.status).toBe(200);
    expect(res.body.material.storagePath).toBeUndefined();
    expect(res.body.material.rawTextStoragePath).toBeUndefined();
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

describe('provenance-pinned original PDF access (real file hashing; synthetic authorization and receipt lookup)', () => {
  const provenanceId = new ObjectId();
  const url = `/api/courses/${courseId}/materials/${materialId}/source?provenanceId=${provenanceId}`;
  const pdf = Buffer.from('%PDF-1.4\nSynthetic route bytes; physical parsing is tested separately.');
  async function sourceFixture() {
    const storagePath = path.resolve(process.cwd(), 'uploads', `provenance-route-${new ObjectId()}.pdf`);
    filesToCleanUp.push(storagePath); await fsPromises.writeFile(storagePath, pdf);
    jest.mocked(getMaterialWorkspaceDetail).mockResolvedValue({ material: { _id: materialId, courseId, format: 'pdf', name: 'Source.pdf', storagePath } as never, chunks: [] });
    jest.mocked(readMaterialSourceProvenance).mockResolvedValue({ receipt: { pdfSha256: createHash('sha256').update(pdf).digest('hex'), pdfBytes: pdf.length } } as never);
    return storagePath;
  }
  it('allows an authorized TA to stream exact verified bytes and never returns the private path', async () => {
    const storagePath = await sourceFixture();
    const response = await request(makeApp(ta)).get(url);
    expect(response.status).toBe(200); expect(response.body).toEqual(pdf);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(response.headers)).not.toContain(storagePath);
    expect(readMaterialSourceProvenance).toHaveBeenCalledWith(courseId, materialId, provenanceId);
  });
  it('refuses unavailable, stale or foreign provenance IDs without falling back to an unpinned original', async () => {
    await sourceFixture(); jest.mocked(readMaterialSourceProvenance).mockResolvedValueOnce(null);
    const response = await request(makeApp(instructor)).get(url);
    expect(response.status).toBe(404); expect(response.body.error).toBe('material-source-unavailable');
  });
  it('refuses changed PDF bytes for a page pin while preserving historical unpinned viewing', async () => {
    const storagePath = await sourceFixture(); await fsPromises.writeFile(storagePath, 'changed source bytes');
    expect((await request(makeApp(instructor)).get(url)).status).toBe(404);
    expect((await request(makeApp(instructor)).get(`/api/courses/${courseId}/materials/${materialId}/source`)).status).toBe(200);
  });
  it('authenticates and authorizes before provenance lookup, and rejects malformed pins', async () => {
    await sourceFixture();
    for (const [person, expected] of [[undefined, 401], [student, 403], [userFixture([{ courseId: otherCourseId, role: 'instructor' }]), 403]] as const) {
      expect((await request(makeApp(person)).get(url)).status).toBe(expected);
    }
    expect(readMaterialSourceProvenance).not.toHaveBeenCalled();
    expect((await request(makeApp(instructor)).get(`/api/courses/${courseId}/materials/${materialId}/source?provenanceId=bad-id`)).status).toBe(400);
    expect(readMaterialSourceProvenance).not.toHaveBeenCalled();
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
      .send({ assignments: [{ themeId }], expectedRevision: 0 });

    expect(res.status).toBe(200);
    expect(assignMaterial).toHaveBeenCalledWith(expect.any(ObjectId), [{ themeId: expect.any(ObjectId) }], 0);
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
      .send({ action: 'accept', expectedRevision: 0 });
    expect(res.status).toBe(401);
    expect(getMaterialCourseId).not.toHaveBeenCalled();
    expect(resolveClassification).not.toHaveBeenCalled();
  });

  it('403s a non-instructor of the material\'s course', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(otherCourseId);
    const res = await request(makeApp(instructor))
      .post(`/api/materials/${materialId.toHexString()}/classification`)
      .send({ action: 'accept', expectedRevision: 0 });
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
      .send({ action: 'accept', expectedRevision: 0 });

    expect(res.status).toBe(200);
    expect(resolveClassification).toHaveBeenCalledWith(expect.any(ObjectId), 'accept', 0);
  });

  it('400s "no-classification-suggestion" from the service via the normalizer', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(courseId);
    jest.mocked(resolveClassification).mockRejectedValue(new Error('no-classification-suggestion'));

    const res = await request(makeApp(instructor))
      .post(`/api/materials/${materialId.toHexString()}/classification`)
      .send({ action: 'accept', expectedRevision: 0 });

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
    expect(suggestHierarchy).toHaveBeenCalledWith(expect.any(ObjectId), instructor.puid);
  });
});

describe('POST /api/courses/:courseId/apply-suggested-hierarchy', () => {
  const body = {
    runId: new ObjectId().toHexString(),
    themes: [
      {
        name: 'Forces',
        los: [{ name: 'Friction', materialIds: [materialId.toHexString()], sourceThemeIndex: 0, sourceLoIndex: 0 }],
      },
    ],
  };

  it('403s a non-instructor before applying anything', async () => {
    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/apply-suggested-hierarchy`)
      .send(body);

    expect(res.status).toBe(403);
    expect(applyGeneratedHierarchy).not.toHaveBeenCalled();
  });

  it('creates the reviewed hierarchy and assignments for an instructor', async () => {
    jest.mocked(applyGeneratedHierarchy).mockResolvedValue({
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
    expect(applyGeneratedHierarchy).toHaveBeenCalledWith(expect.any(ObjectId), body);
  });

  it('400s malformed material ids before calling the service', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/apply-suggested-hierarchy`)
      .send({
        runId: body.runId,
        themes: [{ name: 'Forces', los: [{ name: 'Friction', materialIds: ['bad-id'], sourceThemeIndex: 0, sourceLoIndex: 0 }] }],
      });

    expect(res.status).toBe(400);
    expect(applyGeneratedHierarchy).not.toHaveBeenCalled();
  });
  it.each(['runId', 'source-identities'])('rejects omission of %s instead of falling back to manual Apply', async field => {
    const unguarded = field === 'runId' ? { themes: body.themes } : { runId: body.runId,
      themes: [{ name: 'Forces', los: [{ name: 'Friction', materialIds: [materialId.toHexString()] }] }] };
    const res = await request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/apply-suggested-hierarchy`).send(unguarded);
    expect(res.status).toBe(400);
    expect(applyGeneratedHierarchy).not.toHaveBeenCalled();
  });
});

describe('POST structure-generation', () => {
  const url = `/api/courses/${courseId.toHexString()}/structure-generation`;
  it('denies students and foreign instructors before starting analysis', async () => {
    jest.mocked(enqueueStructureGeneration).mockClear();
    expect((await request(makeApp(student)).post(url).send({})).status).toBe(403);
    expect((await request(makeApp(userFixture([{ courseId: otherCourseId, role: 'instructor' }]))).post(url).send({})).status).toBe(403);
    expect(enqueueStructureGeneration).not.toHaveBeenCalled();
  });
  it('validates optional counts and returns a durable run id', async () => {
    expect((await request(makeApp(instructor)).post(url).send({ topicCount: 0 })).status).toBe(400);
    const id = new ObjectId(); jest.mocked(enqueueStructureGeneration).mockResolvedValue({ _id: id } as never);
    expect((await request(makeApp(instructor)).post(url).send({ topicCount: 4, losPerTopic: 3 })).body).toEqual({ runId: id.toHexString() });
    expect(enqueueStructureGeneration).toHaveBeenLastCalledWith(courseId, instructor.puid, { topicCount: 4, losPerTopic: 3 });
  });
});

describe('bounded outline repair workspace endpoints', () => {
  const runId = new ObjectId(), childId = new ObjectId();
  const url = `/api/courses/${courseId.toHexString()}/structure-generation/${runId.toHexString()}/repair`;
  const coverage = { version: 'coverage-wording-outline-repair-v1', targets: [{ id: 'L3', evidenceIds: ['E4'] }] };
  beforeEach(() => {
    jest.mocked(enqueueStructureOutlineRepair).mockReset().mockResolvedValue({ _id: childId } as never);
    jest.mocked(enqueueStructureOutlineCoverageRepair).mockReset().mockResolvedValue({ _id: childId } as never);
    jest.mocked(getStructureOutlineRepairView).mockReset().mockResolvedValue({ version: 'outline-wording-repair-view-v1', parentRunId: runId.toHexString() } as never);
  });

  it.each([undefined, student, ta, userFixture([{ courseId: otherCourseId, role: 'instructor' }])])('denies unauthorized workspace reads and sends before service work', async user => {
    const expected = user ? 403 : 401;
    expect((await request(makeApp(user)).get(url)).status).toBe(expected);
    expect((await request(makeApp(user)).post(url).send(coverage)).status).toBe(expected);
    expect(getStructureOutlineRepairView).not.toHaveBeenCalled(); expect(enqueueStructureOutlineCoverageRepair).not.toHaveBeenCalled();
  });

  it('returns a no-store read projection and never queues work on GET', async () => {
    const response = await request(makeApp(instructor)).get(`${url}?page=2&pageSize=5`);
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(getStructureOutlineRepairView).toHaveBeenCalledWith(courseId, runId, { page: 2, pageSize: 5 });
    expect(enqueueStructureOutlineRepair).not.toHaveBeenCalled(); expect(enqueueStructureOutlineCoverageRepair).not.toHaveBeenCalled();
  });

  it('routes the two explicit exclusive modes to the existing bounded workers with the session actor', async () => {
    const first = await request(makeApp(instructor)).post(url).send(coverage);
    expect(first.status).toBe(202); expect(first.body).toEqual({ runId: childId.toHexString(), parentRunId: runId.toHexString() });
    expect(enqueueStructureOutlineCoverageRepair).toHaveBeenCalledWith(courseId, runId, instructor.puid, coverage.targets);
    const second = await request(makeApp({ ...instructor, isAdmin: true, courseRoles: [] })).post(url).send({ version: 'wording-only-outline-repair-v1', targetIds: ['L1', 'L2'] });
    expect(second.status).toBe(202); expect(enqueueStructureOutlineRepair).toHaveBeenCalledWith(courseId, runId, instructor.puid, ['L1', 'L2']);
  });

  it.each([
    { ...coverage, model: 'anything' }, { ...coverage, verdict: 'supported' }, { ...coverage, maxSends: 100 },
    { ...coverage, targetIds: ['L1'] }, { version: 'unknown', targets: coverage.targets },
    { ...coverage, targets: [] }, { ...coverage, targets: [{ id: 'L3', evidenceIds: [] }] },
    { ...coverage, targets: [{ id: 'L3', evidenceIds: ['E4'], preserveEvidenceIds: ['E3'] }] },
    { ...coverage, targets: [{ id: 'L3', evidenceIds: ['E4', 'E4'] }] },
    { ...coverage, targets: [{ id: 'L3', evidenceIds: ['E4'] }, { id: 'L4', evidenceIds: ['E4'] }] },
    { ...coverage, targets: [{ id: 'L3', evidenceIds: ['E4'] }, { id: 'L3', evidenceIds: ['E5'] }] },
    { version: 'wording-only-outline-repair-v1', targetIds: ['L1', 'L1'] },
    { version: 'wording-only-outline-repair-v1', targetIds: ['L1', 'L2', 'L3'] },
    { ...coverage, targets: [{ id: 'L3', evidenceIds: Array.from({ length: 9 }, (_, index) => `E${index + 1}`) }] },
  ])('strictly refuses caller-supplied authority or malformed selection: %j', async body => {
    expect((await request(makeApp(instructor)).post(url).send(body)).status).toBe(400);
    expect(enqueueStructureOutlineRepair).not.toHaveBeenCalled(); expect(enqueueStructureOutlineCoverageRepair).not.toHaveBeenCalled();
  });

  it.each(['page=0', 'pageSize=11', 'pageSize=bad', 'provider=anything'])('validates read pagination and rejects extra query authority: %s', async query => {
    expect((await request(makeApp(instructor)).get(`${url}?${query}`)).status).toBe(400); expect(getStructureOutlineRepairView).not.toHaveBeenCalled();
  });

  it.each([
    ['structure-repair-view-run-unavailable', 404], ['structure-repair-cycle-already-used', 409],
    ['structure-repair-parent-or-provider-changed', 409], ['structure-repair-budget-exhausted', 409],
    ['structure-repair-proposal-input-cap', 413], ['structure-repair-enqueue-failed', 503], ['authoring-coordinated-commit-unavailable', 503],
  ])('normalizes %s without changing the recorded failure', async (message, status) => {
    jest.mocked(enqueueStructureOutlineCoverageRepair).mockRejectedValueOnce(new Error(String(message)));
    const response = await request(makeApp(instructor)).post(url).send(coverage);
    expect(response.status).toBe(status); expect(response.body).toEqual({ error: message });
  });
});

describe('material authoring revision contract', () => {
  it('requires a revision for manual metadata, assignments and classification decisions', async () => {
    jest.mocked(getMaterialCourseId).mockResolvedValue(courseId);
    const metadata = await request(makeApp(instructor))
      .patch(`/api/courses/${courseId}/materials/${materialId}`).send({ kind: 'reading' });
    const assignments = await request(makeApp(instructor))
      .put(`/api/materials/${materialId}/assignments`).send({ assignments: [] });
    const classification = await request(makeApp(instructor))
      .post(`/api/materials/${materialId}/classification`).send({ action: 'accept' });
    expect([metadata.status, assignments.status, classification.status]).toEqual([400, 400, 400]);
    expect(updateMaterialKind).not.toHaveBeenCalled();
    expect(assignMaterial).not.toHaveBeenCalled();
    expect(resolveClassification).not.toHaveBeenCalled();
  });

  it('returns a 409 while preserving a useful conflict message', async () => {
    jest.mocked(updateMaterialKind).mockRejectedValue(Object.assign(new Error('Material changed. Keep your draft.'), { status: 409 }));
    const res = await request(makeApp(instructor))
      .patch(`/api/courses/${courseId}/materials/${materialId}`)
      .send({ kind: 'reading', expectedRevision: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Keep your draft');
  });
});
