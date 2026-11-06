jest.mock('../../server/src/components/mongodb/collections', () => ({ materialUploadBatchesCol: jest.fn() }));
jest.mock('../../server/src/services/materials.service', () => ({ createMaterials: jest.fn(), detectUploadFormat: jest.fn((name: string) => /\.(pdf|txt|md|docx|pptx)$/i.test(name) ? name.split('.').pop() : undefined) }));
jest.mock('../../server/src/services/source-readiness.service', () => ({ getMaterialSourceReadiness: jest.fn() }));
import { ObjectId, type WithId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { materialUploadBatchesCol } from '../../server/src/components/mongodb/collections';
import { createMaterials } from '../../server/src/services/materials.service';
import { getMaterialSourceReadiness } from '../../server/src/services/source-readiness.service';
import { acceptMaterialUploadBatch, claimMaterialUploadBatch, getMaterialUploadBatch, prepareMaterialUploadBatch, prepareUploadBatchSchema, readMaterialUploadBatch, rejectMaterialUploadBatch } from '../../server/src/services/material-upload-batches.service';
import type { MaterialUploadBatch } from '../../server/src/types/material-upload';

const courseId = new ObjectId();
const actor = 'instructor';
let rows: WithId<MaterialUploadBatch>[];
const intended = Array.from({ length: 10 }, (_, index) => ({ clientFileId: String(index), name: `chapter-${index + 1}.pdf`, size: 10 }));
function matches(row: WithId<MaterialUploadBatch>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return (value as Record<string, unknown>[]).some((part) => matches(row, part));
    const actual = row[key as keyof MaterialUploadBatch];
    if (value instanceof ObjectId) return actual instanceof ObjectId && actual.equals(value);
    if (value && typeof value === 'object' && '$in' in value) return (value.$in as unknown[]).includes(actual);
    if (value && typeof value === 'object' && '$lte' in value) return actual instanceof Date && actual <= (value.$lte as Date);
    return actual === value;
  });
}
function apply(row: WithId<MaterialUploadBatch>, update: { $set?: Record<string, unknown>; $inc?: Record<string, number>; $unset?: Record<string, unknown> }) {
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    const bits = path.split('.');
    if (bits[0] === 'items' && bits.length === 3) Object.assign(row.items[Number(bits[1])]!, { [bits[2]!]: value });
    else Object.assign(row, { [path]: value });
  }
  for (const [path, value] of Object.entries(update.$inc ?? {})) Object.assign(row, { [path]: Number(row[path as keyof MaterialUploadBatch] ?? 0) + value });
  for (const path of Object.keys(update.$unset ?? {})) {
    const bits = path.split('.');
    if (bits[0] === 'items' && bits.length === 3) delete (row.items[Number(bits[1])] as unknown as Record<string, unknown>)[bits[2]!];
    else delete (row as unknown as Record<string, unknown>)[path];
  }
}
beforeEach(() => {
  rows = [];
  jest.mocked(materialUploadBatchesCol).mockReturnValue({
    findOne: async (filter: Record<string, unknown>) => rows.find((row) => matches(row, filter)) ?? null,
    insertOne: async (doc: MaterialUploadBatch) => {
      if (rows.some((row) => row.courseId.equals(doc.courseId) && row.requestedBy === doc.requestedBy && row.requestId === doc.requestId)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      const row = { _id: new ObjectId(), ...doc }; rows.push(row); return { insertedId: row._id };
    },
    findOneAndUpdate: async (filter: Record<string, unknown>, update: Parameters<typeof apply>[1]) => { const row = rows.find((item) => matches(item, filter)); if (!row) return null; apply(row, update); return row; },
    updateOne: async (filter: Record<string, unknown>, update: Parameters<typeof apply>[1]) => { const row = rows.find((item) => matches(item, filter)); if (!row) return { matchedCount: 0 }; apply(row, update); return { matchedCount: 1 }; },
  } as never);
  jest.mocked(createMaterials).mockReset();
  jest.mocked(getMaterialSourceReadiness).mockResolvedValue({ materialId: 'id', name: 'source', ready: false, state: 'processing', classification: 'unknown' });
});

it('persists all intended files before admission and replays the same actor/course/request manifest', async () => {
  const requestId = randomUUID();
  const [first, duplicate] = await Promise.all([prepareMaterialUploadBatch(courseId, actor, requestId, intended), prepareMaterialUploadBatch(courseId, actor, requestId, intended)]);
  expect(first._id).toEqual(duplicate._id);
  expect(rows).toHaveLength(1);
  expect(first.items.map((item) => item.name)).toEqual(intended.map((item) => item.name));
  expect(first.items.every((item) => item.disposition === 'pending')).toBe(true);
  await expect(prepareMaterialUploadBatch(courseId, actor, requestId, [{ ...intended[0]!, name: 'changed.pdf' }])).rejects.toMatchObject({ status: 409, message: 'material-upload-manifest-conflict' });
  expect(createMaterials).not.toHaveBeenCalled();
});

it('keeps metadata for oversized/count-rejected requests within a bounded receipt', async () => {
  const files = Array.from({ length: 21 }, (_, index) => ({ clientFileId: String(index), name: `chapter-${index}.pdf`, size: 51 * 1024 * 1024 }));
  expect(prepareUploadBatchSchema.safeParse({ requestId: randomUUID(), files }).success).toBe(true);
  const batch = await prepareMaterialUploadBatch(courseId, actor, randomUUID(), files);
  const claim = await claimMaterialUploadBatch(courseId, batch._id, actor);
  await rejectMaterialUploadBatch(courseId, batch._id, claim.owner!, 'File too large');
  const report = await readMaterialUploadBatch(courseId, batch._id, actor);
  expect(report.items).toHaveLength(21);
  expect(report.counts).toEqual({ requested: 21, received: 0, ready: 0, rejected: 21 });
});

it('fences concurrent admissions and permits expired-owner recovery without stale receipt writes', async () => {
  const batch = await prepareMaterialUploadBatch(courseId, actor, randomUUID(), intended);
  const [one, two] = await Promise.allSettled([claimMaterialUploadBatch(courseId, batch._id, actor), claimMaterialUploadBatch(courseId, batch._id, actor)]);
  expect([one, two].filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const stored = rows[0]!;
  const owner = stored.uploadOwner!;
  stored.uploadLeaseUntil = new Date(0);
  const current = await claimMaterialUploadBatch(courseId, batch._id, actor);
  expect(current.owner).not.toBe(owner);
  await rejectMaterialUploadBatch(courseId, batch._id, owner, 'stale interruption');
  expect(stored.admission).toBe('uploading');
  await expect(acceptMaterialUploadBatch(courseId, batch._id, actor, owner, [])).rejects.toMatchObject({ status: 409, message: 'material-upload-owner-stale' });
});

it('rejects count/name/size mismatches and all unsupported formats before any source is created', async () => {
  const batch = await prepareMaterialUploadBatch(courseId, actor, randomUUID(), intended);
  const claim = await claimMaterialUploadBatch(courseId, batch._id, actor);
  const files = intended.map((file) => ({ originalname: file.name, size: file.size, path: '/tmp/server-upload' }));
  await expect(acceptMaterialUploadBatch(courseId, batch._id, actor, claim.owner!, files.slice(1))).rejects.toMatchObject({ status: 400 });
  await expect(acceptMaterialUploadBatch(courseId, batch._id, actor, claim.owner!, files.map((file, index) => index === 9 ? { ...file, size: 11 } : file))).rejects.toMatchObject({ status: 400 });
  expect(createMaterials).not.toHaveBeenCalled();
  const bad = await prepareMaterialUploadBatch(courseId, actor, randomUUID(), [{ clientFileId: 'bad', name: 'bad.exe', size: 1 }]);
  const badClaim = await claimMaterialUploadBatch(courseId, bad._id, actor);
  await expect(acceptMaterialUploadBatch(courseId, bad._id, actor, badClaim.owner!, [{ originalname: 'bad.exe', size: 1, path: '/tmp/bad.exe' }])).rejects.toThrow('unsupported-format:exe');
});

it('preserves a partial receipt on failure and derives readiness from the canonical material on reload', async () => {
  const batch = await prepareMaterialUploadBatch(courseId, actor, randomUUID(), intended);
  const claim = await claimMaterialUploadBatch(courseId, batch._id, actor);
  const id = new ObjectId();
  jest.mocked(createMaterials).mockImplementation(async (_course, _files, _actor, _canvas, onItem) => { await onItem!(0, { _id: id } as never, 'created'); throw new Error('database unavailable'); });
  await expect(acceptMaterialUploadBatch(courseId, batch._id, actor, claim.owner!, intended.map((file) => ({ originalname: file.name, size: file.size, path: '/tmp/server-upload' })))).rejects.toThrow('database unavailable');
  await rejectMaterialUploadBatch(courseId, batch._id, claim.owner!, 'database unavailable');
  const receipt = await readMaterialUploadBatch(courseId, batch._id, actor);
  expect(receipt.items[0]).toMatchObject({ materialId: id, disposition: 'created', readiness: { state: 'processing' } });
  expect(receipt.counts).toEqual({ requested: 10, received: 1, ready: 0, rejected: 9 });
  expect(receipt).not.toHaveProperty('uploadOwner');
  expect(receipt).not.toHaveProperty('uploadLeaseUntil');
});

it('returns an accepted receipt without dispatching another upload or creating another source', async () => {
  const batch = await prepareMaterialUploadBatch(courseId, actor, randomUUID(), [intended[0]!]);
  const claim = await claimMaterialUploadBatch(courseId, batch._id, actor);
  jest.mocked(createMaterials).mockImplementation(async (_course, _files, _actor, _canvas, onItem) => { await onItem!(0, { _id: new ObjectId() } as never, 'reused'); return []; });
  await acceptMaterialUploadBatch(courseId, batch._id, actor, claim.owner!, [{ originalname: intended[0]!.name, size: 10, path: '/tmp/server-upload' }]);
  const replay = await claimMaterialUploadBatch(courseId, batch._id, actor);
  expect(replay.owner).toBeUndefined();
  expect(replay.batch.admission).toBe('accepted');
  expect(createMaterials).toHaveBeenCalledTimes(1);
});

it('preserves Unicode upload names by matching the exact prepared manifest rather than guessing identity', async () => {
  const name = 'Lecture 中文.pdf';
  const batch = await prepareMaterialUploadBatch(courseId, actor, randomUUID(), [{ clientFileId: 'unicode', name, size: 1 }]);
  const claim = await claimMaterialUploadBatch(courseId, batch._id, actor);
  jest.mocked(createMaterials).mockImplementation(async (_course, files, _actor, _canvas, onItem) => { expect(files[0]!.originalname).toBe(name); await onItem!(0, { _id: new ObjectId() } as never, 'created'); return []; });
  await acceptMaterialUploadBatch(courseId, batch._id, actor, claim.owner!, [{ originalname: Buffer.from(name, 'utf8').toString('latin1'), size: 1, path: '/tmp/upload' }]);
  expect(batch.items[0]!.name).toBe(name);
});

it('requires exact actor and course ownership for reads and upload claims', async () => {
  const batch = await prepareMaterialUploadBatch(courseId, actor, randomUUID(), intended);
  await expect(getMaterialUploadBatch(new ObjectId(), batch._id, actor)).rejects.toMatchObject({ status: 404 });
  await expect(claimMaterialUploadBatch(courseId, batch._id, 'other')).rejects.toMatchObject({ status: 404 });
  await expect(readMaterialUploadBatch(courseId, batch._id, 'other')).rejects.toMatchObject({ status: 404 });
});
