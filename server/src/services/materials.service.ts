import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ObjectId, type WithId } from 'mongodb';
import { chunkText } from '../components/genai/chunking';
import { embed, getEmbeddingDimension } from '../components/genai/embeddings';
import { parseFile } from '../components/genai/document-parsing';
import { ensureCollection, upsertPoints } from '../components/qdrant';
import { defineJob, enqueueJob } from '../components/jobs';
import { materialsCol } from '../components/mongodb/collections';
import type { Material } from '../types/domain';

// -----------------------------------------------------------------------------
// Materials service (IN-S04/S05): instructor course-material upload + async RAG
// ingestion. Each material is parsed -> chunked -> embedded -> upserted into a
// PER-COURSE Qdrant collection (courseCollection) by a background job, so one
// material's failure never blocks its siblings (IN-S04). The pipeline shape
// mirrors the (deletable) rag.service.ts example — see components/genai/AGENTS.md
// and components/qdrant/AGENTS.md — but must NOT copy its module-level
// `collectionReady` boolean cache: that is correct only for rag.service's one
// global collection. Here every course gets its own collection, so a single
// flag would let the first course's ingest "poison" the cache and silently
// skip ensureCollection() for every other course's first upsert. Cached
// per-collection-name instead (`ensuredCollections`, a Set<string>).
// -----------------------------------------------------------------------------

const UPLOAD_FORMATS = ['pdf', 'docx', 'pptx', 'txt', 'md'] as const;
export type UploadFormat = (typeof UPLOAD_FORMATS)[number];

/**
 * The subset of `Express.Multer.File` this service actually needs. Kept as a
 * local, minimal structural type rather than depending on the global
 * `Express.Multer.File` ambient merge — that merge only becomes available in a
 * TypeScript program once some file in it `import`s `multer` (the route layer
 * does), which a service-only unit test compiling this file in isolation
 * should not have to rely on. `Express.Multer.File` objects satisfy this
 * structurally, so routes can pass `req.files` straight through.
 */
export interface UploadedFile {
  originalname: string;
  path: string;
}

/**
 * Per-course Qdrant collection name. Exported so Task 7 (classification) and
 * Task 8 (generation) query the same course's ingested chunks.
 */
export function courseCollection(courseId: ObjectId): string {
  return `course-${courseId.toHexString()}`;
}

// Qdrant collection-readiness cache, keyed PER collection name — see the
// module header for why a single boolean (rag.service.ts's pattern) is wrong
// here.
const ensuredCollections = new Set<string>();

async function ensureMaterialsCollection(name: string): Promise<void> {
  if (ensuredCollections.has(name)) return;
  const size = await getEmbeddingDimension();
  await ensureCollection(name, size);
  ensuredCollections.add(name);
}

function fileExtension(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return ext || filename.toLowerCase();
}

function detectUploadFormat(filename: string): UploadFormat | undefined {
  const ext = fileExtension(filename);
  return (UPLOAD_FORMATS as readonly string[]).includes(ext) ? (ext as UploadFormat) : undefined;
}

/**
 * Insert one `processing` Material doc per file and enqueue its ingest job
 * independently (IN-S04). Format is validated for every file BEFORE any doc
 * is written — an unsupported file rejects the whole batch inline (400 at the
 * route layer, per docs/api-contract.md) rather than partially succeeding.
 * This is a validation-time guarantee only; IN-S04's independent *processing*
 * guarantee applies once materials are actually enqueued below.
 */
export async function createMaterials(
  courseId: ObjectId,
  files: UploadedFile[],
): Promise<WithId<Material>[]> {
  const prepared = files.map((file) => ({ file, format: detectUploadFormat(file.originalname) }));
  const invalid = prepared.find((p) => !p.format);
  if (invalid) {
    throw new Error(`unsupported-format:${fileExtension(invalid.file.originalname)}`);
  }

  const materials: WithId<Material>[] = [];
  for (const { file, format } of prepared) {
    const doc: Material = {
      courseId,
      name: file.originalname,
      format: format as UploadFormat,
      status: 'processing',
      storagePath: file.path,
      assignments: [],
      uploadedAt: new Date(),
    };
    const { insertedId } = await materialsCol().insertOne(doc);
    materials.push({ _id: insertedId, ...doc });
    await enqueueJob<{ materialId: string }>('material.ingest', { materialId: insertedId.toString() });
  }
  return materials;
}

/** Insert a `processing` URL Material and enqueue its ingest job (IN-S04). */
export async function createUrlMaterial(courseId: ObjectId, url: string): Promise<WithId<Material>> {
  const doc: Material = {
    courseId,
    name: url,
    format: 'url',
    status: 'processing',
    sourceUrl: url,
    assignments: [],
    uploadedAt: new Date(),
  };
  const { insertedId } = await materialsCol().insertOne(doc);
  await enqueueJob<{ materialId: string }>('material.ingest', { materialId: insertedId.toString() });
  return { _id: insertedId, ...doc };
}

export async function listMaterials(courseId: ObjectId): Promise<WithId<Material>[]> {
  return materialsCol().find({ courseId }).sort({ uploadedAt: -1 }).toArray();
}

/** Re-enqueue a failed material for ingestion. */
export async function retryMaterial(materialId: ObjectId): Promise<WithId<Material>> {
  const material = await materialsCol().findOneAndUpdate(
    { _id: materialId },
    { $set: { status: 'processing' }, $unset: { error: '' } },
    { returnDocument: 'after' },
  );
  if (!material) throw new Error('material-not-found');
  await enqueueJob<{ materialId: string }>('material.ingest', { materialId: materialId.toString() });
  return material;
}

/** IN-S05: replace a material's Theme/LO assignments. Never deletes the
 * material or its questions. */
export async function assignMaterial(
  materialId: ObjectId,
  assignments: Array<{ themeId: ObjectId; loId?: ObjectId }>,
): Promise<WithId<Material>> {
  const material = await materialsCol().findOneAndUpdate(
    { _id: materialId },
    { $set: { assignments } },
    { returnDocument: 'after' },
  );
  if (!material) throw new Error('material-not-found');
  return material;
}

/** The course a Material belongs to — used by routes to resolve
 * res.locals.courseId for ensureCourseInstructor() on materialId-scoped
 * endpoints (retry, assignments) that have no :courseId in their path. See
 * courses.service.ts's getThemeCourseId(). */
export async function getMaterialCourseId(materialId: ObjectId): Promise<ObjectId | null> {
  const material = await materialsCol().findOne({ _id: materialId }, { projection: { courseId: 1 } });
  return material?.courseId ?? null;
}

// --- Extraction: format -> plain text -----------------------------------------

async function extractUrlText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch-failed:${response.status}`);
  const body = await response.text();
  // document-parsing's parseFile() only accepts a file path and detects the
  // input format from its extension (no explicit input-type option exists —
  // see ParseInput in ubc-genai-toolkit-document-parsing), so the fetched HTML
  // must be written to a temp .html file first.
  const tempPath = path.join(os.tmpdir(), `${randomUUID()}.html`);
  await fs.writeFile(tempPath, body, 'utf-8');
  try {
    return await parseFile(tempPath, 'text');
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

async function extractText(material: WithId<Material>): Promise<string> {
  if (material.format === 'url') {
    if (!material.sourceUrl) throw new Error('missing-source-url');
    return extractUrlText(material.sourceUrl);
  }
  if (!material.storagePath) throw new Error('missing-storage-path');
  // .txt is NOT one of document-parsing's supported input extensions (.pdf
  // .docx .pptx .html/.htm .md) — read it directly rather than betting on
  // undocumented parser fallback behaviour.
  if (material.format === 'txt') return fs.readFile(material.storagePath, 'utf-8');
  // pdf / docx / pptx / md all go through the toolkit, which detects the
  // input type from the file's extension on disk.
  return parseFile(material.storagePath, 'text');
}

/**
 * The `material.ingest` job body: parse -> chunk -> embed -> upsert into the
 * material's per-course Qdrant collection, then mark it `ready`. Must never
 * throw — on any failure it marks the material `failed` with the error
 * message and returns normally, so one material's failure never blocks,
 * retry-storms, or crashes its siblings (IN-S04).
 */
export async function ingestMaterial(materialId: string): Promise<void> {
  // materialId always comes from our own insertedId.toString() calls (see
  // createMaterials/createUrlMaterial/retryMaterial), so this construction
  // itself cannot fail in practice.
  const id = new ObjectId(materialId);
  try {
    const material = await materialsCol().findOne({ _id: id });
    if (!material) return; // material vanished (e.g. deleted); nothing to do.

    const text = await extractText(material);
    const chunks = await chunkText(text, material.name);
    if (chunks.length > 0) {
      const vectors = await embed(chunks.map((chunk) => chunk.text));
      const collectionName = courseCollection(material.courseId);
      await ensureMaterialsCollection(collectionName);
      const points = chunks.map((chunk, i) => ({
        id: randomUUID(),
        vector: vectors[i],
        payload: { materialId: id.toString(), chunk: chunk.text },
      }));
      await upsertPoints(collectionName, points);
    }

    await materialsCol().updateOne({ _id: id }, { $set: { status: 'ready' }, $unset: { error: '' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await materialsCol().updateOne({ _id: id }, { $set: { status: 'failed', error: message } });
  }
}

// Registers the job handler. Requires startJobs() to have already run (see
// components/jobs/AGENTS.md) — server.ts imports this service AFTER
// startJobs() specifically so this call succeeds in production; tests mock
// the jobs component so this is a no-op there.
defineJob<{ materialId: string }>('material.ingest', ({ materialId }) => ingestMaterial(materialId));
