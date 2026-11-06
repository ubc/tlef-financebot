import { createHash } from 'node:crypto';
import { ObjectId, type WithId } from 'mongodb';
import parserPackage from 'ubc-genai-toolkit-document-parsing/package.json';
import chunkerPackage from 'ubc-genai-toolkit-chunking/package.json';
import { materialChunksCol, materialsCol, materialUploadBatchesCol } from '../components/mongodb/collections';
import { getContentRun } from './content-runs.service';
import { authoringCollection } from './authoring-commit.service';
import type { Material, MaterialChunk } from '../types/domain';
import type { MaterialSourceReadiness, SourceSelectionReport } from '../types/material-upload';

export const MATERIAL_PARSER_VERSION = `toolkit-${parserPackage.version}:text-poppler-first-v2`;
export const MATERIAL_CHUNKER_VERSION = `toolkit-${chunkerPackage.version}:recursive-character-1000-overlap150-v1`;

/** Ordered, length-delimited chunks bind source snapshots without ambiguous concatenation. */
export function hashSourceChunks(chunks: Array<Pick<MaterialChunk, 'index' | 'text'>>): string {
  const hash = createHash('sha256');
  for (const chunk of chunks) hash.update(`${chunk.index}:${Buffer.byteLength(chunk.text, 'utf8')}:`).update(chunk.text);
  return hash.digest('hex');
}

function unavailable(materialId: ObjectId, name: string, state: MaterialSourceReadiness['state'], reason: string): MaterialSourceReadiness {
  return { materialId: materialId.toHexString(), name, ready: false, state, reason, classification: 'unknown' };
}

/** A valid indexed manifest remains authoritative while advisory classification is pending. */
export async function getMaterialSourceReadiness(
  courseId: ObjectId,
  materialId: ObjectId,
  existing?: WithId<Material>,
): Promise<MaterialSourceReadiness> {
  const material = existing ?? await authoringCollection(materialsCol()).findOne({ _id: materialId, courseId });
  if (!material || !material.courseId.equals(courseId)) return unavailable(materialId, 'Unavailable source', 'missing', 'material-not-found');
  if (material.deletedAt) return unavailable(materialId, material.name, 'trashed', 'material-trashed');
  if (material.status === 'processing') return unavailable(materialId, material.name, 'processing', 'material-processing');
  if (material.status === 'failed') return unavailable(materialId, material.name, 'failed', material.error ?? 'material-failed');
  const chunks = await authoringCollection(materialChunksCol()).find({ courseId, materialId }).sort({ index: 1 }).toArray();
  if (!chunks.length || chunks.some((chunk, index) => chunk.index !== index || !chunk.text.trim() || chunk.characterCount !== chunk.text.length)) {
    return unavailable(materialId, material.name, 'manifest-invalid', 'source-chunks-incomplete');
  }
  const hash = hashSourceChunks(chunks);
  const run = material.activeRunId ? await getContentRun(material.activeRunId) : null;
  const manifest = material.sourceManifest;
  if (manifest) {
    if (manifest.version !== 1 || manifest.chunkCount !== chunks.length || manifest.indexedCount !== chunks.length ||
      manifest.sourceTextHash !== hash || manifest.characterCount !== chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) ||
      (manifest.ingestRunId && (!material.activeRunId || !manifest.ingestRunId.equals(material.activeRunId)))) {
      return unavailable(materialId, material.name, 'manifest-invalid', 'source-manifest-stale');
    }
  } else if (!run || run.kind !== 'material-ingest' || run.status !== 'completed' ||
    run.result?.chunkCount !== chunks.length || run.result.indexedCount !== chunks.length ||
    !run.courseId.equals(courseId) || !run.input.materialId.equals(materialId)) {
    // Historical ready flags alone cannot prove complete indexing.
    return unavailable(materialId, material.name, 'manifest-invalid', 'source-manifest-unavailable');
  }
  return {
    materialId: materialId.toHexString(), name: material.name, ready: true, state: 'indexed',
    classification: run?.kind === 'material-ingest' ? run.status === 'running' && run.stage === 'classifying' ? 'pending' :
      run.result?.classification === 'warning' || run.status === 'failed' ? 'warning' : run.status === 'completed' ? 'completed' : 'unknown' : 'unknown',
    snapshot: {
      materialId: materialId.toHexString(), revision: material.revision ?? 0, name: material.name, sourceTextHash: hash, chunkCount: chunks.length,
      characterCount: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
      ...(material.activeRunId ? { ingestRunId: material.activeRunId.toHexString() } : {}),
      parserVersion: manifest?.parserVersion ?? 'legacy-parser', chunkerVersion: manifest?.chunkerVersion ?? 'legacy-chunker',
    },
  };
}

export function sourceSelectionError(report: SourceSelectionReport): Error & { status: number; report: SourceSelectionReport } {
  return Object.assign(new Error('source-not-ready'), { status: 409, report });
}

/** An omitted materialIds selects the entire intended batch, never only ready files.
 * Explicit IDs are a deliberate subset and leave named exclusions in the receipt. */
export async function resolveSourceSelection(
  courseId: ObjectId,
  input: { sourceBatchId?: string; materialIds?: string[] },
): Promise<SourceSelectionReport> {
  const report: SourceSelectionReport = { ...(input.sourceBatchId ? { sourceBatchId: input.sourceBatchId } : {}), requested: [], included: [], excluded: [], ready: true };
  const selected = input.materialIds ? new Set(input.materialIds) : undefined;
  if (selected && !selected.size) throw Object.assign(new Error('source-selection-empty'), { status: 400 });
  if (selected && [...selected].some((id) => !ObjectId.isValid(id))) throw Object.assign(new Error('source-selection-invalid'), { status: 400 });
  if (input.sourceBatchId) {
    if (!ObjectId.isValid(input.sourceBatchId)) throw Object.assign(new Error('source-batch-not-found'), { status: 404 });
    const batch = await authoringCollection(materialUploadBatchesCol()).findOne({ _id: new ObjectId(input.sourceBatchId), courseId });
    if (!batch) throw Object.assign(new Error('source-batch-not-found'), { status: 404 });
    const batchIds = new Set(batch.items.flatMap((item) => item.materialId ? [item.materialId.toHexString()] : []));
    for (const item of batch.items) {
      const state = item.materialId ? await getMaterialSourceReadiness(courseId, item.materialId) :
        { materialId: '', name: item.name, ready: false, state: item.disposition === 'rejected' ? 'failed' as const : 'processing' as const,
          reason: item.error ?? batch.admissionError ?? 'upload-not-received', classification: 'unknown' as const };
      report.requested.push({ ...state, name: item.name, clientFileId: item.clientFileId });
      if (selected && (!item.materialId || !selected.has(item.materialId.toHexString()))) {
        report.excluded.push({ name: item.name, ...(item.materialId ? { materialId: item.materialId.toHexString() } : {}), clientFileId: item.clientFileId, reason: 'instructor-selected-subset' });
      } else if (state.ready && state.snapshot) {
        if (!report.included.some((snapshot) => snapshot.materialId === state.materialId)) report.included.push(state.snapshot);
      } else report.ready = false;
    }
    // A new batch may extend an already prepared course. Explicitly selected
    // older course sources remain in the intended union; they are never inferred
    // from arbitrary foreign IDs or silently omitted when still processing.
    for (const id of selected ?? []) {
      if (batchIds.has(id)) continue;
      const state = await getMaterialSourceReadiness(courseId, new ObjectId(id));
      if (state.state === 'missing' || state.state === 'trashed') throw Object.assign(new Error('source-selection-unavailable'), { status: 409 });
      report.requested.push(state);
      if (state.ready && state.snapshot) report.included.push(state.snapshot);
      else report.ready = false;
    }
  } else {
    const materials = await authoringCollection(materialsCol()).find({ courseId, deletedAt: { $exists: false } }).sort({ uploadedAt: 1, _id: 1 }).toArray();
    const availableIds = new Set(materials.map(material => material._id.toHexString()));
    if (selected && [...selected].some(id => !availableIds.has(id))) throw Object.assign(new Error('source-selection-unavailable'), { status: 409 });
    for (const material of materials) {
      // An explicit course subset still names every omitted active source. Its
      // unselected failures do not block readiness or require original chunk reads.
      if (selected && !selected.has(material._id.toHexString())) {
        report.excluded.push({ materialId: material._id.toHexString(), name: material.name, reason: 'instructor-selected-subset' });
        continue;
      }
      const state = await getMaterialSourceReadiness(courseId, material._id, material);
      report.requested.push(state);
      if (state.ready && state.snapshot) report.included.push(state.snapshot);
      else report.ready = false;
    }
  }
  if (!report.requested.length || !report.included.length) report.ready = false;
  return report;
}

export async function assertSourceSelectionReady(courseId: ObjectId, input: { sourceBatchId?: string; materialIds?: string[] }): Promise<SourceSelectionReport> {
  const report = await resolveSourceSelection(courseId, input);
  if (!report.ready) throw sourceSelectionError(report);
  return report;
}
