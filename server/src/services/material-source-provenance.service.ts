import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { BSON, ObjectId, type ClientSession, type WithId } from 'mongodb';
import { materialSourceProvenanceCol, materialsCol } from '../components/mongodb/collections';
import { locatePdfChunk, projectPdfChunkLocation, validatePdfPageMapIdentity } from '../components/genai/document-parsing/pdf-provenance';
import { buildPdfPageTextObservations, projectPdfPageTextObservations } from '../components/genai/document-parsing/pdf-page-text-observations';
import type { Material, MaterialChunk } from '../types/domain';
import type { MaterialChunkBindings, MaterialChunkProvenance, MaterialSourceProvenance, PdfParseReceipt, PdfPageTextObservationSummary } from '../types/source-provenance';
import { hashSourceChunks } from './source-readiness.service';

const UPLOAD_ROOT = path.resolve(__dirname, '../../../uploads');
export const MATERIAL_PROVENANCE_ROOT = path.join(UPLOAD_ROOT, 'source-provenance');
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const MAX_SIDECAR_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_BINDINGS = 20_000;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{24}$/;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const verifiedBindings = new WeakSet<MaterialChunkBindings>();
type BoundChunk = Pick<MaterialChunk, 'index' | 'text' | 'sourceProvenance'>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, part]) => part !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, part]) => `${JSON.stringify(key)}:${canonical(part)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Full validation happens once per immutable binding object, never once per chunk. */
function validChunkBindings(bindings: MaterialChunkBindings, chunkCount: number): boolean {
  if (!bindings || !Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_CHUNK_BINDINGS
    || bindings.version !== 'full-chunk-provenance-v1' || !Array.isArray(bindings.entries) || bindings.entries.length !== chunkCount) return false;
  if (verifiedBindings.has(bindings)) return true;
  if (!HASH.test(bindings.sha256) || bindings.entries.some((entry, index) => !Array.isArray(entry) || entry.length !== 3
    || entry[0] !== index || !HASH.test(entry[1]) || !HASH.test(entry[2]))
    || bindings.sha256 !== sha256(canonical({ version: bindings.version, entries: bindings.entries }))) return false;
  for (const entry of bindings.entries) Object.freeze(entry);
  Object.freeze(bindings.entries); Object.freeze(bindings); verifiedBindings.add(bindings);
  return true;
}

/** Only prepareMaterialSourceProvenance binds these hashes to freshly parsed raw text. */
export function createMaterialChunkBindings(chunks: BoundChunk[]): MaterialChunkBindings {
  if (!chunks.length || chunks.length > MAX_CHUNK_BINDINGS || chunks.some((chunk, index) => chunk.index !== index
    || !chunk.sourceProvenance?.locator || chunk.sourceProvenance.locator.chunkTextSha256 !== sha256(chunk.text))) throw new Error('material-provenance-chunk-bindings-invalid');
  const entries: MaterialChunkBindings['entries'] = chunks.map(chunk => [chunk.index, sha256(chunk.text), sha256(canonical(chunk.sourceProvenance))]);
  const bindings: MaterialChunkBindings = { version: 'full-chunk-provenance-v1', entries,
    sha256: sha256(canonical({ version: 'full-chunk-provenance-v1', entries })) };
  if (!validChunkBindings(bindings, chunks.length)) throw new Error('material-provenance-chunk-bindings-invalid');
  return bindings;
}

function validSidecarBindings(record: MaterialSourceProvenance): boolean {
  return validChunkBindings(record.chunkBindings, record.chunkCount) && BSON.calculateObjectSize(record) <= MAX_SIDECAR_BYTES;
}

export interface MaterialWorkspaceProvenance {
  status: 'verified' | 'partial' | 'unavailable';
  provenanceId?: string;
  successfulEngine?: string;
  engineVersion?: string | null;
  pdfSha256?: string;
  rawTextSha256?: string;
  pageCount?: number;
  reason?: string;
  pageTextObservations?: PdfPageTextObservationSummary;
}

function artifactPath(courseId: ObjectId, materialId: ObjectId, provenanceId: ObjectId): string {
  return path.join(MATERIAL_PROVENANCE_ROOT, courseId.toHexString(), materialId.toHexString(), `${provenanceId.toHexString()}.txt`);
}

/** No stored path can broaden file access beyond these deterministic owned IDs. */
async function inspectOwnedPath(file: string, courseId: ObjectId, materialId: ObjectId, provenanceId: ObjectId): Promise<boolean> {
  if (file !== artifactPath(courseId, materialId, provenanceId)) throw new Error('material-provenance-unsafe-path');
  const directories = [UPLOAD_ROOT, MATERIAL_PROVENANCE_ROOT, path.dirname(path.dirname(file)), path.dirname(file)];
  for (const directory of directories) {
    try {
      const stat = await fs.lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('material-provenance-unsafe-path');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('material-provenance-unsafe-path');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureOwnedDirectories(file: string): Promise<void> {
  for (const directory of [UPLOAD_ROOT, MATERIAL_PROVENANCE_ROOT, path.dirname(path.dirname(file)), path.dirname(file)]) {
    try { await fs.mkdir(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('material-provenance-unsafe-path');
  }
}

function validReceipt(receipt: PdfParseReceipt): boolean {
  if (!receipt || receipt.version !== 'pdf-parse-receipt-v1' || !HASH.test(receipt.pdfSha256) || !HASH.test(receipt.rawTextSha256)
    || !Number.isSafeInteger(receipt.pdfBytes) || receipt.pdfBytes <= 0 || receipt.pdfBytes > MAX_SOURCE_BYTES
    || !Number.isSafeInteger(receipt.rawTextBytes) || receipt.rawTextBytes <= 0 || receipt.rawTextBytes > MAX_SOURCE_BYTES
    || !Number.isSafeInteger(receipt.rawTextUtf16Length) || receipt.rawTextUtf16Length <= 0 || receipt.rawTextUtf16Length > MAX_SOURCE_BYTES
    || !['poppler-pdftotext', 'toolkit'].includes(receipt.successfulEngine)
    || !['text-poppler-first-v2', 'markdown-toolkit-first-v1'].includes(receipt.routingPolicy)
    || !['text', 'markdown'].includes(receipt.actualFormat) || typeof receipt.requestedFormat !== 'string'
    || !(receipt.engineVersion === null || typeof receipt.engineVersion === 'string' && receipt.engineVersion.length <= 1000)
    || !Array.isArray(receipt.attempts) || receipt.attempts.length < 1 || receipt.attempts.length > 4
    || receipt.attempts.some(attempt => !attempt || !['poppler-pdftotext', 'toolkit'].includes(attempt.engine)
      || !['succeeded', 'failed'].includes(attempt.outcome) || !Number.isFinite(attempt.elapsedMs) || attempt.elapsedMs < 0
      || attempt.reason !== undefined && (typeof attempt.reason !== 'string' || attempt.reason.length > 2000))) return false;
  if (receipt.attempts.at(-1)?.outcome !== 'succeeded' || receipt.attempts.at(-1)?.engine !== receipt.successfulEngine
    || !receipt.pageCount || receipt.pageCount.engine !== 'pdfinfo'
    || !(receipt.pageCount.engineVersion === null || typeof receipt.pageCount.engineVersion === 'string' && receipt.pageCount.engineVersion.length <= 1000)) return false;
  if (receipt.pageCount.status === 'verified') {
    if (!Number.isSafeInteger(receipt.pageCount.count) || receipt.pageCount.count < 1) return false;
  } else if (receipt.pageCount.status !== 'unavailable' || typeof receipt.pageCount.reason !== 'string' || !receipt.pageCount.reason) return false;
  if (!receipt.pageMap || receipt.pageMap.version !== 'native-formfeed-pages-v1' || receipt.pageMap.offsetUnit !== 'utf16-code-units') return false;
  if (receipt.pageMap.status === 'verified') {
    if (!validatePdfPageMapIdentity(receipt.pageMap, receipt.rawTextSha256, receipt.rawTextUtf16Length)) return false;
  } else if (receipt.pageMap.status !== 'unavailable' || typeof receipt.pageMap.reason !== 'string' || !receipt.pageMap.reason || receipt.pageMap.reason.length > 2000) return false;
  if (receipt.pageMap.status === 'verified' && (receipt.successfulEngine !== 'poppler-pdftotext' || receipt.actualFormat !== 'text'
    || receipt.pageCount.status !== 'verified' || receipt.pageMap.pages.length !== receipt.pageCount.count)) return false;
  return Buffer.byteLength(JSON.stringify(receipt), 'utf8') <= MAX_RECEIPT_BYTES;
}

async function hashOpenPdf(handle: FileHandle): Promise<{ sha256: string; bytes: number }> {
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SOURCE_BYTES) throw new Error('material-provenance-pdf-unavailable');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const part of handle.createReadStream({ start: 0, autoClose: false })) {
    bytes += part.length;
    if (bytes > MAX_SOURCE_BYTES) throw new Error('material-provenance-pdf-unavailable');
    hash.update(part);
  }
  if (bytes !== stat.size) throw new Error('material-provenance-pdf-changed');
  return { sha256: hash.digest('hex'), bytes };
}

/** Run outside a Mongo transaction. Same-descriptor serving protects against path replacement. */
export async function openVerifiedMaterialPdfSource(storagePath: string, receipt: PdfParseReceipt): Promise<FileHandle> {
  const handle = await fs.open(storagePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await hashOpenPdf(handle);
    if (actual.sha256 !== receipt.pdfSha256 || actual.bytes !== receipt.pdfBytes) throw new Error('material-provenance-pdf-changed');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

export async function assertMaterialProvenanceSourceCurrent(storagePath: string, receipt: PdfParseReceipt): Promise<void> {
  const handle = await openVerifiedMaterialPdfSource(storagePath, receipt); await handle.close();
}

/** Prepare private files before embeddings/publication; this function performs no database writes. */
export async function prepareMaterialSourceProvenance(material: WithId<Material>, text: string, receipt: PdfParseReceipt,
  chunks: Array<{ text: string }>, ingestRunId?: ObjectId): Promise<{ record: WithId<MaterialSourceProvenance>; chunks: MaterialChunkProvenance[] }> {
  if (material.format !== 'pdf' || !material.storagePath || !validReceipt(receipt)
    || !chunks.length || chunks.length > MAX_CHUNK_BINDINGS
    || sha256(text) !== receipt.rawTextSha256 || Buffer.byteLength(text, 'utf8') !== receipt.rawTextBytes || text.length !== receipt.rawTextUtf16Length) throw new Error('material-provenance-receipt-invalid');
  await assertMaterialProvenanceSourceCurrent(material.storagePath, receipt);
  const provenanceId = new ObjectId(); const rawTextStoragePath = artifactPath(material.courseId, material._id, provenanceId);
  const mapped = chunks.map(chunk => ({ provenanceId: provenanceId.toHexString(), pdfSha256: receipt.pdfSha256,
    rawTextSha256: receipt.rawTextSha256, ...(receipt.pageMap.status === 'verified' ? { pageMapSha256: receipt.pageMap.sha256 } : {}), locator: locatePdfChunk(text, chunk.text, receipt.pageMap) }));
  const boundChunks = chunks.map((chunk, index) => ({ index, text: chunk.text, sourceProvenance: mapped[index] }));
  const record: WithId<MaterialSourceProvenance> = { _id: provenanceId, courseId: material.courseId, materialId: material._id,
    ...(ingestRunId ? { ingestRunId } : {}), sourceTextHash: hashSourceChunks(chunks.map((chunk, index) => ({ index, text: chunk.text }))),
    chunkCount: chunks.length, chunkBindings: createMaterialChunkBindings(boundChunks), receipt, rawTextStoragePath, createdAt: new Date() };
  const pageTextObservations = buildPdfPageTextObservations(text, receipt);
  // Advisory observations must not turn an otherwise valid text ingest into a
  // BSON-size failure. Absence is explicitly unavailable in the read model.
  if (pageTextObservations && BSON.calculateObjectSize({ ...record, pageTextObservations }) <= MAX_SIDECAR_BYTES) record.pageTextObservations = pageTextObservations;
  if (!validSidecarBindings(record) || !boundChunks.every(chunk => validateMaterialChunkProvenance(chunk, record))) throw new Error('material-provenance-chunk-bindings-invalid');
  await ensureOwnedDirectories(rawTextStoragePath);
  const handle = await fs.open(rawTextStoragePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
  catch (error) { await handle.close(); await fs.rm(rawTextStoragePath, { force: true }); throw error; }
  await handle.close();
  await inspectOwnedPath(rawTextStoragePath, record.courseId, record.materialId, record._id);
  return { record, chunks: mapped };
}

/** Current DB receipt only. No filesystem/model work may occur inside authoring transactions. */
export async function readMaterialSourceProvenance(courseId: ObjectId, materialId: ObjectId, provenanceId: ObjectId,
  session?: ClientSession): Promise<WithId<MaterialSourceProvenance> | null> {
  const options = session ? { session } : {};
  const material = await materialsCol().findOne({ _id: materialId, courseId, status: 'ready', deletedAt: { $exists: false }, 'sourceManifest.provenanceId': provenanceId }, options);
  const manifest = material?.sourceManifest;
  if (!manifest || material.format !== 'pdf' || manifest.version !== 1 || !(manifest.provenanceId instanceof ObjectId) || !manifest.provenanceId.equals(provenanceId)
    || !HASH.test(manifest.sourceTextHash) || !Number.isSafeInteger(manifest.chunkCount) || manifest.chunkCount < 1 || manifest.indexedCount !== manifest.chunkCount
    || manifest.ingestRunId && (!(manifest.ingestRunId instanceof ObjectId) || !material.activeRunId?.equals(manifest.ingestRunId))) return null;
  const record = await materialSourceProvenanceCol().findOne({ _id: provenanceId, courseId, materialId }, options);
  if (!record || record.sourceTextHash !== manifest.sourceTextHash || record.chunkCount !== manifest.chunkCount
    || record.ingestRunId?.toHexString() !== manifest.ingestRunId?.toHexString()
    || record.rawTextStoragePath !== artifactPath(courseId, materialId, provenanceId) || !validReceipt(record.receipt) || !validSidecarBindings(record)) return null;
  return record;
}

export function validateMaterialChunkProvenance(chunk: BoundChunk, record: WithId<MaterialSourceProvenance>): boolean {
  const provenance = chunk.sourceProvenance; const receipt = record.receipt;
  if (!validChunkBindings(record.chunkBindings, record.chunkCount) || !Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index >= record.chunkCount
    || !provenance || !provenance.locator || record.chunkBindings.entries[chunk.index][1] !== sha256(chunk.text)
    || record.chunkBindings.entries[chunk.index][2] !== sha256(canonical(provenance))
    || provenance.provenanceId !== record._id.toHexString() || provenance.pdfSha256 !== receipt.pdfSha256
    || provenance.rawTextSha256 !== receipt.rawTextSha256 || provenance.pageMapSha256 !== (receipt.pageMap.status === 'verified' ? receipt.pageMap.sha256 : undefined)
    || provenance.locator.chunkTextSha256 !== sha256(chunk.text)) return false;
  if (provenance.locator.status === 'unavailable') return provenance.locator.version === 'pdf-chunk-locator-v1'
    && provenance.locator.offsetUnit === 'utf16-code-units' && typeof provenance.locator.reason === 'string' && !!provenance.locator.reason;
  if (receipt.pageMap.status !== 'verified' || provenance.locator.rawEnd > receipt.rawTextUtf16Length
    || projectPdfChunkLocation(provenance, 0, chunk.text.length, chunk.text).status !== 'verified') return false;
  const locator = provenance.locator;
  const expectedSpans = receipt.pageMap.pages.flatMap(page => {
    const start = Math.max(page.rawStart, locator.rawStart);
    const end = Math.min(page.rawEnd, locator.rawEnd);
    const chunkStart = start - locator.rawStart;
    const chunkEnd = end - locator.rawStart;
    return start < end && chunk.text.slice(chunkStart, chunkEnd).trim()
      ? [{ physicalPage: page.physicalPage, rawStart: start, rawEnd: end, chunkStart, chunkEnd }] : [];
  });
  return JSON.stringify(expectedSpans) === JSON.stringify(provenance.locator.pageSpans);
}

export function materialWorkspaceProvenance(record: WithId<MaterialSourceProvenance> | null, chunks: BoundChunk[]): MaterialWorkspaceProvenance {
  if (!record) return { status: 'unavailable', reason: 'PDF parse provenance was not recorded or is no longer current. Physical pages are unavailable.' };
  const receipt = record.receipt;
  const valid = chunks.length === record.chunkCount && new Set(chunks.map(chunk => chunk.index)).size === chunks.length
    && chunks.every(chunk => validateMaterialChunkProvenance(chunk, record));
  return { status: !valid ? 'unavailable' : receipt.pageMap.status === 'verified' && chunks.every(chunk => chunk.sourceProvenance?.locator.status === 'verified') ? 'verified' : 'partial',
    provenanceId: record._id.toHexString(), successfulEngine: receipt.successfulEngine, engineVersion: receipt.engineVersion,
    pdfSha256: receipt.pdfSha256, rawTextSha256: receipt.rawTextSha256,
    pageTextObservations: projectPdfPageTextObservations(valid ? record.pageTextObservations : undefined, receipt),
    ...(receipt.pageCount.status === 'verified' ? { pageCount: receipt.pageCount.count } : {}),
    ...(!valid ? { reason: 'Stored chunk locations do not match the current parse receipt.' }
      : receipt.pageMap.status === 'unavailable' ? { reason: receipt.pageMap.reason }
        : chunks.some(chunk => chunk.sourceProvenance?.locator.status !== 'verified') ? { reason: 'Some chunks do not have a unique exact physical-page location.' } : {}) };
}

/** A failed/unknown commit is checked before removing its own unpublished artifact. */
export async function discardUnpublishedMaterialSourceProvenance(record: WithId<MaterialSourceProvenance>): Promise<void> {
  const published = await materialsCol().findOne({ _id: record.materialId, courseId: record.courseId, 'sourceManifest.provenanceId': record._id });
  if (published) return;
  if (await inspectOwnedPath(record.rawTextStoragePath, record.courseId, record.materialId, record._id)) await fs.rm(record.rawTextStoragePath, { force: true });
  await materialSourceProvenanceCol().deleteOne({ _id: record._id, courseId: record.courseId, materialId: record.materialId });
}

/** Validate all recorded and orphaned owned files before course deletion mutates any resource. */
export async function listCourseMaterialProvenanceArtifacts(courseId: ObjectId): Promise<string[]> {
  const records = await materialSourceProvenanceCol().find({ courseId }).toArray();
  const files = new Set<string>();
  for (const record of records) {
    if (await inspectOwnedPath(record.rawTextStoragePath, courseId, record.materialId, record._id)) files.add(record.rawTextStoragePath);
  }
  const courseDirectory = path.join(MATERIAL_PROVENANCE_ROOT, courseId.toHexString());
  for (const directory of [UPLOAD_ROOT, MATERIAL_PROVENANCE_ROOT, courseDirectory]) {
    try { const stat = await fs.lstat(directory); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('material-provenance-unsafe-path'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [...files]; throw error; }
  }
  for (const material of await fs.readdir(courseDirectory, { withFileTypes: true })) {
    if (!material.isDirectory() || material.isSymbolicLink() || !ID.test(material.name)) throw new Error('material-provenance-unsafe-path');
    for (const artifact of await fs.readdir(path.join(courseDirectory, material.name), { withFileTypes: true })) {
      if (!artifact.isFile() || artifact.isSymbolicLink() || !/^[a-f0-9]{24}\.txt$/.test(artifact.name)) throw new Error('material-provenance-unsafe-path');
      const file = artifactPath(courseId, new ObjectId(material.name), new ObjectId(artifact.name.slice(0, -4)));
      if (await inspectOwnedPath(file, courseId, new ObjectId(material.name), new ObjectId(artifact.name.slice(0, -4)))) files.add(file);
    }
  }
  return [...files];
}
