import { createHash, randomUUID } from 'node:crypto';
import type { ObjectId, WithId } from 'mongodb';
import { z } from 'zod';
import { materialUploadBatchesCol } from '../components/mongodb/collections';
import { createMaterials, detectUploadFormat, type UploadedFile } from './materials.service';
import { getMaterialSourceReadiness } from './source-readiness.service';
import type { IntendedUploadFile, MaterialUploadBatch } from '../types/material-upload';
import { authoringCollection, withCourseAuthoringWrite } from './authoring-commit.service';

export const prepareUploadBatchSchema = z.object({
  requestId: z.string().uuid(),
  // Metadata can describe a request larger than multipart admission limits so
  // rejected file sizes/counts still leave a complete, bounded intended list.
  files: z.array(z.object({ clientFileId: z.string().min(1).max(100), name: z.string().min(1).max(500), size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).min(1).max(100),
}).superRefine(({ files }, ctx) => {
  if (new Set(files.map((file) => file.clientFileId)).size !== files.length) ctx.addIssue({ code: 'custom', path: ['files'], message: 'File identifiers must be unique.' });
});

function batchError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** Preparation happens before multipart admission so all intended filenames survive
 * count/size/connection failures, including files Multer never receives. */
export async function prepareMaterialUploadBatch(courseId: ObjectId, requestedBy: string, requestId: string, files: IntendedUploadFile[]): Promise<WithId<MaterialUploadBatch>> {
  const manifestHash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const filter = { courseId, requestedBy, requestId };
  let batch = await materialUploadBatchesCol().findOne(filter);
  if (!batch) {
    const now = new Date();
    const doc: MaterialUploadBatch = { courseId, requestedBy, requestId, manifestHash, items: files.map((file) => ({ ...file, disposition: 'pending' })), revision: 0, admission: 'prepared', createdAt: now, updatedAt: now };
    try {
      const { insertedId } = await withCourseAuthoringWrite(courseId, () => authoringCollection(materialUploadBatchesCol()).insertOne(doc));
      batch = { _id: insertedId, ...doc };
    } catch (error) {
      if ((error as { code?: unknown }).code !== 11000) throw error;
      batch = await materialUploadBatchesCol().findOne(filter);
      if (!batch) throw error;
    }
  }
  if (batch.manifestHash !== manifestHash) throw batchError('material-upload-manifest-conflict', 409);
  return batch;
}

export async function getMaterialUploadBatch(courseId: ObjectId, batchId: ObjectId, requestedBy?: string): Promise<WithId<MaterialUploadBatch>> {
  const batch = await materialUploadBatchesCol().findOne({ _id: batchId, courseId, ...(requestedBy ? { requestedBy } : {}) });
  if (!batch) throw batchError('material-upload-batch-not-found', 404);
  return batch;
}

export async function readMaterialUploadBatch(courseId: ObjectId, batchId: ObjectId, requestedBy?: string) {
  const batch = await getMaterialUploadBatch(courseId, batchId, requestedBy);
  const items = await Promise.all(batch.items.map(async (item) => ({ ...item, ...(item.materialId ? { readiness: await getMaterialSourceReadiness(courseId, item.materialId) } : {}) })));
  const safe = { ...batch };
  delete safe.uploadOwner;
  delete safe.uploadLeaseUntil;
  return { ...safe, items, counts: { requested: items.length, received: items.filter((item) => item.materialId).length, ready: items.filter((item) => item.readiness?.ready).length, rejected: items.filter((item) => item.disposition === 'rejected').length } };
}

/** A bounded admission lease plus owner-fenced receipt updates closes duplicate
 * dispatch. An accepted receipt can be replayed without receiving bytes again. */
export async function claimMaterialUploadBatch(courseId: ObjectId, batchId: ObjectId, requestedBy: string): Promise<{ batch: WithId<MaterialUploadBatch>; owner?: string }> {
  const current = await getMaterialUploadBatch(courseId, batchId, requestedBy);
  if (current.admission === 'accepted') return { batch: current };
  const now = new Date();
  const owner = randomUUID();
  const batch = await materialUploadBatchesCol().findOneAndUpdate({ _id: batchId, courseId, requestedBy,
    $or: [{ admission: { $in: ['prepared', 'rejected'] } }, { admission: 'uploading', uploadLeaseUntil: { $lte: now } }],
  }, { $set: { admission: 'uploading', uploadOwner: owner, uploadLeaseUntil: new Date(now.getTime() + 15 * 60_000), updatedAt: now }, $inc: { revision: 1 }, $unset: { admissionError: '' } }, { returnDocument: 'after' });
  if (!batch) throw batchError('material-upload-in-progress', 409);
  return { batch, owner };
}

export async function rejectMaterialUploadBatch(courseId: ObjectId, batchId: ObjectId, owner: string, reason: string): Promise<void> {
  const current = await materialUploadBatchesCol().findOne({ _id: batchId, courseId, uploadOwner: owner, admission: 'uploading' });
  if (!current) return;
  await materialUploadBatchesCol().updateOne({ _id: batchId, courseId, uploadOwner: owner, admission: 'uploading', revision: current.revision }, {
    $set: { admission: 'rejected', admissionError: reason, updatedAt: new Date(), items: current.items.map((item) => item.materialId ? item : { ...item, disposition: 'rejected', error: reason }) },
    $inc: { revision: 1 }, $unset: { uploadOwner: '', uploadLeaseUntil: '' },
  });
}

export async function acceptMaterialUploadBatch(courseId: ObjectId, batchId: ObjectId, requestedBy: string, owner: string, files: Array<UploadedFile & { size: number }>): Promise<void> {
  const batch = await getMaterialUploadBatch(courseId, batchId, requestedBy);
  if (batch.admission !== 'uploading' || batch.uploadOwner !== owner) throw batchError('material-upload-owner-stale', 409);
  // Multipart filename parameters may arrive as Latin-1-decoded UTF-8 through
  // Busboy. The prevalidated manifest supplies the exact comparison target;
  // accept that one reversible decoding only, never guess an arbitrary filename.
  const normalizedFiles = files.map((file, index) => {
    const expected = batch.items[index]?.name;
    return expected && file.originalname !== expected && Buffer.from(file.originalname, 'latin1').toString('utf8') === expected ? { ...file, originalname: expected } : file;
  });
  if (normalizedFiles.length !== batch.items.length || normalizedFiles.some((file, index) => file.originalname !== batch.items[index]!.name || file.size !== batch.items[index]!.size)) throw batchError('material-upload-manifest-mismatch', 400);
  const invalid = normalizedFiles.find((file) => !detectUploadFormat(file.originalname));
  if (invalid) throw batchError(`unsupported-format:${invalid.originalname.split('.').pop()?.toLowerCase() ?? 'unknown'}`, 400);
  // Retry after a partial receipt write replays each fingerprint. It never
  // deletes canonical files or restarts an existing processing/failed source.
  await createMaterials(courseId, normalizedFiles, requestedBy, undefined, async (index, material, disposition) => {
    const updated = await materialUploadBatchesCol().updateOne({ _id: batchId, courseId, uploadOwner: owner, admission: 'uploading' }, {
      $set: { [`items.${index}.materialId`]: material._id, [`items.${index}.disposition`]: disposition, updatedAt: new Date() },
      $unset: { [`items.${index}.error`]: '' }, $inc: { revision: 1 },
    });
    if (!updated.matchedCount) throw batchError('material-upload-owner-stale', 409);
  });
  const accepted = await materialUploadBatchesCol().updateOne({ _id: batchId, courseId, uploadOwner: owner, admission: 'uploading' }, { $set: { admission: 'accepted', updatedAt: new Date() }, $unset: { uploadOwner: '', uploadLeaseUntil: '', admissionError: '' }, $inc: { revision: 1 } });
  if (!accepted.matchedCount) throw batchError('material-upload-owner-stale', 409);
}
