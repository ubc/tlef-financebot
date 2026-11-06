jest.mock('../../server/src/components/mongodb/collections', () => ({ materialsCol: jest.fn(), materialChunksCol: jest.fn(), materialUploadBatchesCol: jest.fn() }));
jest.mock('../../server/src/services/content-runs.service', () => ({ getContentRun: jest.fn() }));

import { ObjectId, type WithId } from 'mongodb';
import { materialsCol, materialChunksCol, materialUploadBatchesCol } from '../../server/src/components/mongodb/collections';
import { getContentRun } from '../../server/src/services/content-runs.service';
import { assertSourceSelectionReady, getMaterialSourceReadiness, hashSourceChunks, resolveSourceSelection } from '../../server/src/services/source-readiness.service';
import type { Material, MaterialChunk } from '../../server/src/types/domain';
import type { MaterialUploadBatch } from '../../server/src/types/material-upload';

const courseId = new ObjectId();
const batchId = new ObjectId();
let materials: WithId<Material>[];
let chunks: MaterialChunk[];
let batch: WithId<MaterialUploadBatch>;
const findMaterial = jest.fn();
const findBatch = jest.fn();

function source(index: number): WithId<Material> {
  const id = new ObjectId();
  const runId = new ObjectId();
  const text = `Chapter ${index} explicitly defines beta and its supported formula.`;
  const itemChunks: MaterialChunk[] = [{ courseId, materialId: id, index: 0, text, characterCount: text.length, createdAt: new Date() }];
  chunks.push(...itemChunks);
  return { _id: id, courseId, name: `chapter-${index}.pdf`, format: 'pdf', status: 'ready', assignments: [], activeRunId: runId, uploadedAt: new Date(),
    sourceManifest: { version: 1, ingestRunId: runId, sourceTextHash: hashSourceChunks(itemChunks), chunkCount: 1, indexedCount: 1, characterCount: text.length, parserVersion: 'parser1', chunkerVersion: 'chunker1', indexedAt: new Date() } };
}

beforeEach(() => {
  chunks = [];
  materials = Array.from({ length: 10 }, (_, index) => source(index + 1));
  batch = { _id: batchId, courseId, requestedBy: 'instructor', requestId: 'request', manifestHash: 'hash', items: materials.map((material, index) => ({ clientFileId: String(index), name: material.name, size: 10, disposition: 'created', materialId: material._id })), admission: 'accepted', revision: 0, createdAt: new Date(), updatedAt: new Date() };
  findMaterial.mockImplementation(async (filter) => materials.find((material) => material._id.equals(filter._id) && material.courseId.equals(filter.courseId)) ?? null);
  findBatch.mockImplementation(async (filter) => batch._id.equals(filter._id) && batch.courseId.equals(filter.courseId) ? batch : null);
  jest.mocked(materialsCol).mockReturnValue({ findOne: findMaterial, find: (filter: { courseId: ObjectId; _id?: { $in: ObjectId[] } }) => ({ sort: () => ({ toArray: async () => materials.filter((material) => material.courseId.equals(filter.courseId) && !material.deletedAt && (!filter._id || filter._id.$in.some((id) => material._id.equals(id)))) }) }) } as never);
  jest.mocked(materialChunksCol).mockReturnValue({ find: (filter: { courseId: ObjectId; materialId: ObjectId }) => ({ sort: () => ({ toArray: async () => chunks.filter((chunk) => chunk.courseId.equals(filter.courseId) && chunk.materialId.equals(filter.materialId)).sort((a, b) => a.index - b.index) }) }) } as never);
  jest.mocked(materialUploadBatchesCol).mockReturnValue({ findOne: findBatch } as never);
  jest.mocked(getContentRun).mockReset();
  jest.mocked(getContentRun).mockImplementation(async (id) => ({ _id: id, courseId, kind: 'material-ingest', stage: 'classifying', status: 'running' }) as never);
});

it('accounts for all ten intended chapters and blocks when chapter seven is still indexing', async () => {
  materials[6]!.status = 'processing';
  const report = await resolveSourceSelection(courseId, { sourceBatchId: batchId.toHexString() });
  expect(report.requested).toHaveLength(10);
  expect(report.included).toHaveLength(9);
  expect(report.ready).toBe(false);
  expect(report.requested[6]).toMatchObject({ name: 'chapter-7.pdf', state: 'processing', reason: 'material-processing' });
  await expect(assertSourceSelectionReady(courseId, { sourceBatchId: batchId.toHexString() })).rejects.toMatchObject({ status: 409, message: 'source-not-ready', report: { ready: false } });
});

it('allows an explicitly selected nine-source subset and names the excluded failed chapter', async () => {
  materials[6]!.status = 'failed';
  const report = await assertSourceSelectionReady(courseId, { sourceBatchId: batchId.toHexString(), materialIds: materials.filter((_, index) => index !== 6).map((item) => item._id.toHexString()) });
  expect(report.included).toHaveLength(9);
  expect(report.requested).toHaveLength(10);
  expect(report.excluded).toEqual([{ name: 'chapter-7.pdf', materialId: materials[6]!._id.toHexString(), clientFileId: '6', reason: 'instructor-selected-subset' }]);
});

it('names omitted course sources without a batch and reads chunks only for the selected subset', async () => {
  materials[6]!.status = 'failed';
  const chunkReads = jest.spyOn(materialChunksCol(), 'find');
  const materialIds = materials.filter((_, index) => index !== 6).map(material => material._id.toHexString());
  const report = await assertSourceSelectionReady(courseId, { materialIds });
  expect(report.ready).toBe(true);
  expect(report.included).toHaveLength(9);
  expect(report.requested).toHaveLength(9);
  expect(report.excluded).toEqual([{ name: 'chapter-7.pdf', materialId: materials[6]!._id.toHexString(), reason: 'instructor-selected-subset' }]);
  expect(chunkReads).toHaveBeenCalledTimes(9);
  expect(chunkReads).not.toHaveBeenCalledWith(expect.objectContaining({ materialId: materials[6]!._id }));
});

it('rejects unavailable subset IDs before reading selected or omitted chunks without a batch', async () => {
  const chunkReads = jest.spyOn(materialChunksCol(), 'find');
  await expect(resolveSourceSelection(courseId, { materialIds: [materials[0]!._id.toHexString(), new ObjectId().toHexString()] })).rejects.toMatchObject({ status: 409, message: 'source-selection-unavailable' });
  expect(chunkReads).not.toHaveBeenCalled();
});

it('retains every intended filename after multipart admission rejection and reload', async () => {
  batch.admission = 'rejected';
  batch.admissionError = 'File too large';
  batch.items = batch.items.map((item) => { const rejected = { ...item, disposition: 'rejected' as const, error: 'File too large' }; delete rejected.materialId; return rejected; });
  const first = await resolveSourceSelection(courseId, { sourceBatchId: batchId.toHexString() });
  const reloaded = await resolveSourceSelection(courseId, { sourceBatchId: batchId.toHexString() });
  expect(reloaded).toEqual(first);
  expect(first.requested.map((item) => item.name)).toEqual(materials.map((item) => item.name));
  expect(first.included).toEqual([]);
  expect(first.requested.every((item) => !item.ready && item.reason === 'File too large')).toBe(true);
});

it('accepts complete indexed manifests while classification is pending or its run was interrupted', async () => {
  expect(await getMaterialSourceReadiness(courseId, materials[0]!._id)).toMatchObject({ ready: true, classification: 'pending' });
  jest.mocked(getContentRun).mockResolvedValue({ kind: 'material-ingest', status: 'failed', stage: 'classifying' } as never);
  expect(await getMaterialSourceReadiness(courseId, materials[0]!._id)).toMatchObject({ ready: true, classification: 'warning' });
});

it.each(['deleted', 'hash', 'count', 'run', 'gap', 'damaged'])('rejects %s source evidence before it can be analyzed', async (change) => {
  const material = materials[0]!;
  if (change === 'deleted') material.deletedAt = new Date();
  if (change === 'hash') chunks[0]!.text += ' invented';
  if (change === 'count') material.sourceManifest!.indexedCount = 2;
  if (change === 'run') material.activeRunId = new ObjectId();
  if (change === 'gap') chunks[0]!.index = 1;
  if (change === 'damaged') chunks[0]!.text = '';
  expect((await getMaterialSourceReadiness(courseId, material._id)).ready).toBe(false);
});

it('uses completed indexed results for historical sources but never trusts a bare ready flag', async () => {
  const material = materials[0]!;
  delete material.sourceManifest;
  expect(await getMaterialSourceReadiness(courseId, material._id)).toMatchObject({ ready: false, reason: 'source-manifest-unavailable' });
  jest.mocked(getContentRun).mockResolvedValue({ courseId, kind: 'material-ingest', status: 'completed', input: { materialId: material._id }, result: { chunkCount: 1, indexedCount: 1 } } as never);
  expect(await getMaterialSourceReadiness(courseId, material._id)).toMatchObject({ ready: true, snapshot: { parserVersion: 'legacy-parser' } });
});

it('prevents foreign batch/source selection and forged subset IDs without revealing source names', async () => {
  const foreign = new ObjectId();
  await expect(resolveSourceSelection(foreign, { sourceBatchId: batchId.toHexString() })).rejects.toMatchObject({ status: 404 });
  expect(await getMaterialSourceReadiness(foreign, materials[0]!._id)).toMatchObject({ ready: false, name: 'Unavailable source' });
  await expect(resolveSourceSelection(courseId, { sourceBatchId: batchId.toHexString(), materialIds: [new ObjectId().toHexString()] })).rejects.toMatchObject({ status: 409, message: 'source-selection-unavailable' });
});

it('collapses reused canonical sources while preserving all named upload intents', async () => {
  batch.items[9]!.materialId = batch.items[0]!.materialId;
  const report = await assertSourceSelectionReady(courseId, { sourceBatchId: batchId.toHexString() });
  expect(report.requested).toHaveLength(10);
  expect(report.included).toHaveLength(9);
});

it('combines ten older course sources with an explicitly selected source from the newest batch', async () => {
  const additional = source(11);
  materials.push(additional);
  batch.items = [{ clientFileId: 'new', name: additional.name, size: 10, disposition: 'created', materialId: additional._id }];
  const report = await assertSourceSelectionReady(courseId, { sourceBatchId: batchId.toHexString(), materialIds: materials.map((material) => material._id.toHexString()) });
  expect(report.requested).toHaveLength(11);
  expect(report.included).toHaveLength(11);
  expect(report.excluded).toEqual([]);
  materials[0]!.status = 'processing';
  await expect(assertSourceSelectionReady(courseId, { sourceBatchId: batchId.toHexString(), materialIds: materials.map((material) => material._id.toHexString()) })).rejects.toMatchObject({ status: 409, report: { ready: false } });
});
