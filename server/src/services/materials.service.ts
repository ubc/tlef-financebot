import { createHash, randomUUID } from 'node:crypto';
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
// per-collection-name instead — and, because Agenda runs jobs at concurrency 5
// by default, the cache holds the in-flight ensure *promise* (not just the
// completed name): three `material.ingest` jobs landing at once for a brand
// new course must all await the SAME ensureCollection() call rather than each
// missing the cache and racing `qdrant.createCollection` (which 409s on the
// second and third caller — see `ensureMaterialsCollection` below, IN-S04
// finding I1).
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
// here. Caches the in-flight PROMISE (not just the completed name, IN-S04
// finding I1): concurrent callers for the same brand-new collection all await
// this one ensure rather than each racing `ensureCollection`'s non-atomic
// check-then-create.
const collectionReady = new Map<string, Promise<void>>();

/** True for a Qdrant "collection already exists" conflict (409, or a message
 * saying as much) — the ONE createCollection race `ensureMaterialsCollection`
 * cannot fully close by promise-caching alone (a second process, or a caller
 * that missed the cache for any other reason). Tolerating it here — rather
 * than in the qdrant component, which stays a thin client — is belt-and-braces
 * on top of the in-flight-promise dedup above. */
function isCollectionAlreadyExistsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as { status?: unknown }).status;
  if (status === 409) return true;
  return /already exists/i.test(err.message);
}

async function ensureMaterialsCollection(name: string): Promise<void> {
  let pending = collectionReady.get(name);
  if (!pending) {
    pending = (async () => {
      const size = await getEmbeddingDimension();
      try {
        await ensureCollection(name, size);
      } catch (err) {
        if (!isCollectionAlreadyExistsError(err)) throw err;
      }
    })();
    collectionReady.set(name, pending);
    // A genuine failure (not "already exists") must not poison the cache
    // forever — drop the entry so the next ingest retries ensureCollection
    // instead of replaying a stale rejection.
    pending.catch(() => collectionReady.delete(name));
  }
  return pending;
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

// I3: URL-ingest hardening constants (named + collected here per the review).
// - URL_FETCH_TIMEOUT_MS: aborts a hanging fetch well before Agenda's default
//   ~10-minute lockLifetime would otherwise let the SAME job be picked up and
//   run a second time concurrently with itself.
// - URL_MAX_RESPONSE_BYTES: caps how much of the response body we buffer, so a
//   huge (or infinite) response can't OOM the process — which would kill every
//   other concurrently-ingesting material's job too (an IN-S04 violation by a
//   different door than the one IN-S04 names).
// - URL_ALLOWED_CONTENT_TYPES: HTML only. A PDF/binary response .text()'d into
//   mojibake and marked `ready` is silent RAG corruption — worse than `failed`.
// - URL_MAX_REDIRECTS: bounds the manual-redirect loop below.
const URL_FETCH_TIMEOUT_MS = 30_000;
const URL_MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MiB
const URL_ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];
const URL_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * SSRF guard (I3): reject anything but http/https, and reject loopback /
 * private / link-local / this-network hosts — including the IPv4
 * link-local range that cloud metadata endpoints (e.g. 169.254.169.254) live
 * in. Deliberately coarse (string/CIDR checks, no DNS resolution of hostnames
 * to catch DNS-rebinding) — good enough to block the documented, common
 * attack shapes without turning URL ingest into a network security project.
 */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 127 || a === 10 || a === 0) return true; // loopback / private / "this" network
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }

  // IPv6 loopback, unique-local, and link-local literals.
  if (host === '::1' || host === '::') return true;
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;

  return false;
}

/** Validate scheme + host; throws `blocked-url:*` for anything unsafe. Used
 * both on the initial URL and, again, on every redirect target — a public URL
 * can otherwise redirect into internal infra and skip the check entirely. */
function assertSafeUrl(rawUrl: string, base?: URL): URL {
  const url = base ? new URL(rawUrl, base) : new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`blocked-url:scheme:${url.protocol}`);
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error(`blocked-url:host:${url.hostname}`);
  }
  return url;
}

/** Fetch with `redirect: 'manual'`, re-validating every redirect target
 * against `assertSafeUrl` ourselves (I3) instead of letting `fetch` follow
 * redirects transparently into a blocked host. */
async function fetchUrlResponse(rawUrl: string): Promise<Response> {
  let target = assertSafeUrl(rawUrl);
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirectCount >= URL_MAX_REDIRECTS) {
      throw new Error(`too-many-redirects:${rawUrl}`);
    }
    const location = response.headers.get('location');
    if (!location) throw new Error(`redirect-missing-location:${response.status}`);
    target = assertSafeUrl(location, target);
  }
}

/** Read a fetch Response body up to `maxBytes`, aborting the stream and
 * throwing rather than buffering an unbounded (or huge) response (I3). */
async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`url-response-too-large:${maxBytes}`);
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf-8');
}

async function extractUrlText(url: string): Promise<string> {
  const response = await fetchUrlResponse(url);
  if (!response.ok) throw new Error(`fetch-failed:${response.status}`);

  // I3: content-type allowlist. A URL serving a PDF (or anything non-HTML)
  // must fail cleanly here rather than being .text()'d into mojibake and
  // silently marked `ready`.
  const contentType = response.headers.get('content-type') ?? '';
  const mimeType = contentType.split(';')[0]?.trim().toLowerCase();
  if (!mimeType || !URL_ALLOWED_CONTENT_TYPES.includes(mimeType)) {
    throw new Error(`unsupported-content-type:${mimeType || 'unknown'}`);
  }

  const body = await readBoundedText(response, URL_MAX_RESPONSE_BYTES);
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
 * Deterministic Qdrant point id for one chunk of one material (I2). UUIDv5
 * (RFC 4122, name-based/SHA-1) over `${materialId}:${chunkIndex}`, so
 * re-ingesting the same material — a retry, or the same upsert running twice —
 * produces the SAME point ids and Qdrant's upsert OVERWRITES rather than
 * appending duplicate vectors. Implemented locally with node:crypto rather
 * than pulling in the `uuid` package: `uuid` is only a transitive dependency
 * here (via langchain, through the chunking toolkit), not one this repo
 * declares directly, and RFC 4122 §4.3 is a handful of lines.
 */
const MATERIAL_POINT_NAMESPACE = 'b3f8b4a0-7f2f-4e8a-9c2f-4e1a2c9d6f2b';

function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1').update(Buffer.concat([namespaceBytes, nameBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant RFC 4122
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function materialPointId(materialId: string, chunkIndex: number): string {
  return uuidv5(`${materialId}:${chunkIndex}`, MATERIAL_POINT_NAMESPACE);
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
        id: materialPointId(id.toString(), i),
        vector: vectors[i],
        payload: { materialId: id.toString(), chunk: chunk.text },
      }));
      await upsertPoints(collectionName, points);
    }

    await materialsCol().updateOne({ _id: id }, { $set: { status: 'ready' }, $unset: { error: '' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await materialsCol().updateOne({ _id: id }, { $set: { status: 'failed', error: message } });
    } catch {
      // Guard the degenerate case: if even this write fails, swallow it
      // rather than reject out of the job handler (IN-S04's "must never
      // throw"). The material is left in whatever status it was already in;
      // a subsequent retry (or the next ingest attempt) will try again.
    }
  }
}

/**
 * Registers the `material.ingest` job handler. Requires `startJobs()` to have
 * already run (see components/jobs/AGENTS.md) — so this must NOT run at
 * module load time (C1). The compiled output is CommonJS
 * (`package.json`'s `"type": "commonjs"`), and `materials.routes.ts` — which
 * `app.ts` mounts — imports this service too; that import is a hoisted
 * synchronous `require()` that runs before `server.ts`'s `main()` even
 * starts, i.e. well before `startJobs()`. A module-level `defineJob()` call
 * here would therefore always throw `Jobs not started` and the server would
 * never boot. Instead `server.ts` imports this function statically and calls
 * it explicitly, immediately after `startJobs()`. Tests mock the jobs
 * component and never call this.
 */
export function registerMaterialJobs(): void {
  defineJob<{ materialId: string }>('material.ingest', ({ materialId }) => ingestMaterial(materialId));
}
