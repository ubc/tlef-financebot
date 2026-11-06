jest.mock('../../server/src/components/mongodb/collections', () => ({ materialsCol: jest.fn(), materialSourceProvenanceCol: jest.fn() }));
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ObjectId, type WithId } from 'mongodb';
import { materialsCol, materialSourceProvenanceCol } from '../../server/src/components/mongodb/collections';
import { buildPdfPageMap, projectPdfChunkLocation } from '../../server/src/components/genai/document-parsing/pdf-provenance';
import {
  MATERIAL_PROVENANCE_ROOT, prepareMaterialSourceProvenance, readMaterialSourceProvenance,
  validateMaterialChunkProvenance, materialWorkspaceProvenance, discardUnpublishedMaterialSourceProvenance,
  listCourseMaterialProvenanceArtifacts, openVerifiedMaterialPdfSource, createMaterialChunkBindings,
} from '../../server/src/services/material-source-provenance.service';
import type { Material } from '../../server/src/types/domain';
import type { MaterialSourceProvenance, PdfParseReceipt } from '../../server/src/types/source-provenance';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const pdf = Buffer.from('%PDF-1.4\nSynthetic immutable test bytes; not a parser fixture.');
const text = 'First 😀 page.\fSecond page.\f';
const findMaterial = jest.fn(), findReceipt = jest.fn(), deleteReceipt = jest.fn(), findReceipts = jest.fn();
let material: WithId<Material>; let directory: string;
let stored: WithId<MaterialSourceProvenance> | null;

function receipt(engine: 'poppler-pdftotext' | 'toolkit' = 'poppler-pdftotext'): PdfParseReceipt {
  return { version: 'pdf-parse-receipt-v1', pdfSha256: hash(pdf), pdfBytes: pdf.length, routingPolicy: 'text-poppler-first-v2', requestedFormat: 'text', actualFormat: 'text',
    successfulEngine: engine, engineVersion: null, attempts: [{ engine, outcome: 'succeeded', elapsedMs: 1 }],
    rawTextSha256: hash(text), rawTextBytes: Buffer.byteLength(text), rawTextUtf16Length: text.length,
    pageCount: { engine: 'pdfinfo', engineVersion: null, status: 'verified', count: 2 }, pageMap: buildPdfPageMap(text, 2, engine) };
}
async function prepare(engine: 'poppler-pdftotext' | 'toolkit' = 'poppler-pdftotext') {
  const prepared = await prepareMaterialSourceProvenance(material, text, receipt(engine), [{ text: text.slice(0, -1) }]);
  stored = prepared.record;
  material = { ...material, status: 'ready', sourceManifest: { version: 1, provenanceId: stored._id, sourceTextHash: stored.sourceTextHash,
    chunkCount: 1, indexedCount: 1, characterCount: text.length - 1, parserVersion: 'existing-policy', chunkerVersion: 'existing-policy', indexedAt: new Date() } };
  return prepared;
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tlef-provenance-unit-'));
  await fs.writeFile(path.join(directory, 'original.pdf'), pdf);
  material = { _id: new ObjectId(), courseId: new ObjectId(), name: 'Synthetic.pdf', format: 'pdf', status: 'processing', storagePath: path.join(directory, 'original.pdf'), assignments: [], uploadedAt: new Date() };
  stored = null;
  findMaterial.mockReset(); findReceipt.mockReset(); deleteReceipt.mockReset(); findReceipts.mockReset();
  findMaterial.mockImplementation(async query => {
    if (!material._id.equals(query._id) || !material.courseId.equals(query.courseId)) return null;
    if (query.status && material.status !== query.status || query.deletedAt && material.deletedAt) return null;
    if (query['sourceManifest.provenanceId'] && !material.sourceManifest?.provenanceId?.equals(query['sourceManifest.provenanceId'])) return null;
    return material;
  });
  findReceipt.mockImplementation(async query => stored && stored._id.equals(query._id) && stored.courseId.equals(query.courseId) && stored.materialId.equals(query.materialId) ? stored : null);
  findReceipts.mockImplementation(() => ({ toArray: async () => stored ? [stored] : [] }));
  jest.mocked(materialsCol).mockReturnValue({ findOne: findMaterial } as never);
  jest.mocked(materialSourceProvenanceCol).mockReturnValue({ findOne: findReceipt, find: findReceipts, deleteOne: deleteReceipt } as never);
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
  await fs.rm(path.join(MATERIAL_PROVENANCE_ROOT, material.courseId.toHexString()), { recursive: true, force: true });
});

it('stores exact raw UTF-8 privately and exposes only bound safe summaries/chunk locations', async () => {
  const prepared = await prepare();
  expect(await fs.readFile(prepared.record.rawTextStoragePath, 'utf8')).toBe(text);
  expect((await fs.stat(prepared.record.rawTextStoragePath)).mode & 0o777).toBe(0o600);
  const loaded = await readMaterialSourceProvenance(material.courseId, material._id, prepared.record._id);
  expect(loaded).toEqual(prepared.record);
  const chunk = { index: 0, text: text.slice(0, -1), sourceProvenance: prepared.chunks[0] };
  expect(validateMaterialChunkProvenance(chunk, prepared.record)).toBe(true);
  expect(chunk.sourceProvenance.locator).toMatchObject({ status: 'verified', rawStart: 0, rawEnd: text.length - 1,
    pageSpans: [{ physicalPage: 1, rawStart: 0, rawEnd: 14, chunkStart: 0, chunkEnd: 14 }, { physicalPage: 2, rawStart: 15, rawEnd: 27, chunkStart: 15, chunkEnd: 27 }] });
  const summary = materialWorkspaceProvenance(loaded, [chunk]);
  expect(summary).toMatchObject({ status: 'verified', successfulEngine: 'poppler-pdftotext', pageCount: 2, provenanceId: prepared.record._id.toHexString() });
  expect(summary.pageTextObservations).toMatchObject({ status: 'available', counts: { total: 2, blank: 0, sparse: 2, present: 0 },
    interpretation: 'unknown', teachingCoverage: 'not-assessed', ranges: [{ startPage: 1, endPage: 2, state: 'sparse' }] });
  expect(JSON.stringify(summary)).not.toContain('StoragePath');
  expect(JSON.stringify(summary)).not.toContain(directory);
  expect(findReceipt).toHaveBeenCalledWith({ _id: prepared.record._id, courseId: material.courseId, materialId: material._id }, {});
});

it.each(['historical-absence', 'tampered-digest', 'wrong-chunk'] as const)('keeps page observations unavailable for %s without weakening original provenance', async mode => {
  const prepared = await prepare(); const chunk = { index: 0, text: text.slice(0, -1), sourceProvenance: prepared.chunks[0] };
  if (mode === 'historical-absence') delete prepared.record.pageTextObservations;
  if (mode === 'tampered-digest') prepared.record.pageTextObservations!.sha256 = hash('tampered');
  const summary = materialWorkspaceProvenance(prepared.record, [mode === 'wrong-chunk' ? { ...chunk, text: 'Changed current chunk.' } : chunk]);
  expect(summary.pageTextObservations).toMatchObject({ status: 'unavailable', interpretation: 'unknown', teachingCoverage: 'not-assessed' });
  expect(summary.pageTextObservations).not.toHaveProperty('counts');
  expect(summary.status).toBe(mode === 'wrong-chunk' ? 'unavailable' : 'verified');
});

it('retains toolkit fallback text with explicit unavailable page locations instead of failing ingestion', async () => {
  const prepared = await prepare('toolkit');
  const loaded = await readMaterialSourceProvenance(material.courseId, material._id, prepared.record._id);
  expect(loaded).not.toBeNull();
  const chunk = { index: 0, text: text.slice(0, -1), sourceProvenance: prepared.chunks[0] };
  expect(validateMaterialChunkProvenance(chunk, prepared.record)).toBe(true);
  expect(materialWorkspaceProvenance(loaded, [chunk])).toMatchObject({ status: 'partial', successfulEngine: 'toolkit', reason: 'actual-parser-is-not-native-pdftotext' });
  expect(chunk.sourceProvenance.locator.status).toBe('unavailable');
});

it('refuses foreign IDs, stale manifest bindings and changed sidecar page identities without filesystem reads', async () => {
  const prepared = await prepare();
  expect(await readMaterialSourceProvenance(new ObjectId(), material._id, prepared.record._id)).toBeNull();
  expect(await readMaterialSourceProvenance(material.courseId, material._id, new ObjectId())).toBeNull();
  stored = { ...prepared.record, sourceTextHash: 'changed' };
  expect(await readMaterialSourceProvenance(material.courseId, material._id, prepared.record._id)).toBeNull();
  stored = structuredClone(prepared.record);
  // Restore Mongo IDs after JSON-independent cloning for the mocked collection's exact binding.
  stored._id = prepared.record._id; stored.courseId = prepared.record.courseId; stored.materialId = prepared.record.materialId;
  if (stored.receipt.pageMap.status === 'verified') stored.receipt.pageMap.pages[0].rawEnd -= 1;
  expect(await readMaterialSourceProvenance(material.courseId, material._id, prepared.record._id)).toBeNull();
  expect(materialWorkspaceProvenance(null, [])).toMatchObject({ status: 'unavailable' });
});

it('rejects a chunk bound to another sidecar, altered text or a fabricated physical-page span', async () => {
  const prepared = await prepare(); const source = prepared.chunks[0];
  expect(validateMaterialChunkProvenance({ index: 0, text: text.slice(0, -1), sourceProvenance: { ...source, provenanceId: new ObjectId().toHexString() } }, prepared.record)).toBe(false);
  expect(validateMaterialChunkProvenance({ index: 0, text: 'tampered text', sourceProvenance: source }, prepared.record)).toBe(false);
  const changed = structuredClone(source);
  if (changed.locator.status === 'verified') changed.locator.pageSpans[0].physicalPage = 2;
  expect(validateMaterialChunkProvenance({ index: 0, text: text.slice(0, -1), sourceProvenance: changed }, prepared.record)).toBe(false);
});

it('rejects the former same-page offset counterexample even though its mechanical projection remains valid', async () => {
  const exact = await prepareMaterialSourceProvenance(material, text, receipt(), [{ text: 'First' }]);
  const shifted = structuredClone(exact.chunks[0]);
  if (shifted.locator.status !== 'verified') throw new Error('Expected an exact locator.');
  shifted.locator.rawStart += 1; shifted.locator.rawEnd += 1;
  shifted.locator.pageSpans[0].rawStart += 1; shifted.locator.pageSpans[0].rawEnd += 1;
  // The old receipt/page-intersection checks could not detect this internally consistent shift.
  expect(projectPdfChunkLocation(shifted, 0, 5, 'First').status).toBe('verified');
  expect(shifted.locator.rawEnd).toBeLessThan(exact.record.receipt.rawTextUtf16Length);
  expect(shifted.locator.pageSpans).toEqual([{ physicalPage: 1, rawStart: 1, rawEnd: 6, chunkStart: 0, chunkEnd: 5 }]);
  expect(text.slice(shifted.locator.rawStart, shifted.locator.rawEnd)).not.toBe('First');
  expect(validateMaterialChunkProvenance({ index: 0, text: 'First', sourceProvenance: shifted }, exact.record)).toBe(false);
  expect(validateMaterialChunkProvenance({ index: 0, text: 'First', sourceProvenance: exact.chunks[0] }, exact.record)).toBe(true);
  await discardUnpublishedMaterialSourceProvenance(exact.record);
});

it.each(['missing', 'digest', 'text hash', 'provenance hash', 'index', 'count', 'version'] as const)(
  'refuses %s sidecar bindings at the current loader and each chunk read', async kind => {
    const prepared = await prepare();
    const corrupted = { ...prepared.record, chunkBindings: structuredClone(prepared.record.chunkBindings) };
    if (kind === 'missing') delete (corrupted as Partial<MaterialSourceProvenance>).chunkBindings;
    if (kind === 'digest') corrupted.chunkBindings.sha256 = hash('wrong digest');
    if (kind === 'text hash') corrupted.chunkBindings.entries[0][1] = hash('wrong text');
    if (kind === 'provenance hash') corrupted.chunkBindings.entries[0][2] = hash('wrong provenance');
    if (kind === 'index') corrupted.chunkBindings.entries[0][0] = 1;
    if (kind === 'count') corrupted.chunkBindings.entries = [];
    if (kind === 'version') corrupted.chunkBindings.version = 'unknown' as never;
    // Also test well-formed aggregate hashes: tuple identity validation must be independent.
    if (['index', 'count', 'version'].includes(kind)) corrupted.chunkBindings.sha256 = hash(JSON.stringify({ entries: corrupted.chunkBindings.entries, version: corrupted.chunkBindings.version }));
    stored = corrupted;
    expect(await readMaterialSourceProvenance(material.courseId, material._id, prepared.record._id)).toBeNull();
    expect(validateMaterialChunkProvenance({ index: 0, text: text.slice(0, -1), sourceProvenance: prepared.chunks[0] }, corrupted)).toBe(false);
  });

it.each(['text hash', 'provenance hash'] as const)('rejects a mismatched %s tuple even with a recomputed aggregate digest', async kind => {
  const prepared = await prepare();
  const corrupted = { ...prepared.record, chunkBindings: structuredClone(prepared.record.chunkBindings) };
  corrupted.chunkBindings.entries[0][kind === 'text hash' ? 1 : 2] = hash('changed tuple');
  corrupted.chunkBindings.sha256 = hash(JSON.stringify({ entries: corrupted.chunkBindings.entries, version: corrupted.chunkBindings.version }));
  expect(validateMaterialChunkProvenance({ index: 0, text: text.slice(0, -1), sourceProvenance: prepared.chunks[0] }, corrupted)).toBe(false);
});

it('binds the full chunk index, is canonical across property order and freezes verified tuples', async () => {
  const prepared = await prepare();
  const source = prepared.chunks[0];
  const reordered = Object.fromEntries(Object.entries(source).reverse()) as typeof source;
  const canonicalBinding = createMaterialChunkBindings([{ index: 0, text: text.slice(0, -1), sourceProvenance: reordered }]);
  expect(canonicalBinding).toEqual(prepared.record.chunkBindings);
  expect(Object.isFrozen(canonicalBinding)).toBe(true); expect(Object.isFrozen(canonicalBinding.entries[0])).toBe(true);
  expect(validateMaterialChunkProvenance({ index: 1, text: text.slice(0, -1), sourceProvenance: source }, prepared.record)).toBe(false);
  expect(() => createMaterialChunkBindings([{ index: 1, text: text.slice(0, -1), sourceProvenance: source }])).toThrow('material-provenance-chunk-bindings-invalid');
  expect(() => createMaterialChunkBindings([])).toThrow('material-provenance-chunk-bindings-invalid');
});

it('bounds both sidecar BSON size and chunk binding count before accepting a record', async () => {
  const prepared = await prepare();
  stored = { ...prepared.record, oversized: 'x'.repeat(8 * 1024 * 1024) } as typeof prepared.record;
  expect(await readMaterialSourceProvenance(material.courseId, material._id, prepared.record._id)).toBeNull();
  expect(() => createMaterialChunkBindings(Array.from({ length: 20_001 }, (_, index) => ({ index, text: text.slice(0, -1), sourceProvenance: prepared.chunks[0] })))).toThrow('material-provenance-chunk-bindings-invalid');
});

it('does not report a complete workspace when duplicate chunk indices replace a bound sibling', async () => {
  const prepared = await prepareMaterialSourceProvenance(material, text, receipt(), [{ text: 'First' }, { text: 'Second' }]);
  const first = { index: 0, text: 'First', sourceProvenance: prepared.chunks[0] };
  const second = { index: 1, text: 'Second', sourceProvenance: prepared.chunks[1] };
  expect(materialWorkspaceProvenance(prepared.record, [first, second]).status).toBe('verified');
  expect(materialWorkspaceProvenance(prepared.record, [first, first]).status).toBe('unavailable');
  await discardUnpublishedMaterialSourceProvenance(prepared.record);
});

it('refuses raw text or PDF identity drift before creating an artifact', async () => {
  await expect(prepareMaterialSourceProvenance(material, text + 'changed', receipt(), [{ text }])).rejects.toThrow('material-provenance-receipt-invalid');
  await fs.writeFile(material.storagePath!, 'different immutable PDF bytes');
  await expect(prepareMaterialSourceProvenance(material, text, receipt(), [{ text }])).rejects.toThrow('material-provenance-pdf-changed');
  expect(await listCourseMaterialProvenanceArtifacts(material.courseId)).toEqual([]);
});

it('deletes only its own unpublished artifact and retains a possibly published commit', async () => {
  const prepared = await prepare();
  await discardUnpublishedMaterialSourceProvenance(prepared.record);
  expect(await fs.readFile(prepared.record.rawTextStoragePath, 'utf8')).toBe(text);
  expect(deleteReceipt).not.toHaveBeenCalled();
  material.sourceManifest = undefined;
  await discardUnpublishedMaterialSourceProvenance(prepared.record);
  await expect(fs.stat(prepared.record.rawTextStoragePath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(deleteReceipt).toHaveBeenCalledWith({ _id: prepared.record._id, courseId: material.courseId, materialId: material._id });
});

it('prevalidates sidecar paths and discovers owned orphan files for permanent course cleanup', async () => {
  const prepared = await prepare();
  stored = null;
  expect(await listCourseMaterialProvenanceArtifacts(material.courseId)).toEqual([prepared.record.rawTextStoragePath]);
  stored = { ...prepared.record, rawTextStoragePath: path.join(directory, 'original.pdf') };
  await expect(listCourseMaterialProvenanceArtifacts(material.courseId)).rejects.toThrow('material-provenance-unsafe-path');
  expect(await fs.readFile(path.join(directory, 'original.pdf'))).toEqual(pdf);
});

it('refuses symlink artifacts and PDF symlinks rather than following them', async () => {
  const prepared = await prepare();
  await fs.rm(prepared.record.rawTextStoragePath);
  await fs.symlink(path.join(directory, 'original.pdf'), prepared.record.rawTextStoragePath);
  await expect(listCourseMaterialProvenanceArtifacts(material.courseId)).rejects.toThrow('material-provenance-unsafe-path');
  const alias = path.join(directory, 'alias.pdf'); await fs.symlink(material.storagePath!, alias);
  await expect(openVerifiedMaterialPdfSource(alias, receipt())).rejects.toThrow();
});

it('streams a verified original from the same descriptor even if the path is later replaced', async () => {
  const prepared = await prepare();
  const handle = await openVerifiedMaterialPdfSource(material.storagePath!, prepared.record.receipt);
  await fs.rename(material.storagePath!, path.join(directory, 'original-old.pdf'));
  await fs.writeFile(material.storagePath!, 'replacement PDF');
  const received: Buffer[] = [];
  for await (const part of handle.createReadStream({ start: 0, autoClose: true })) received.push(part);
  expect(Buffer.concat(received)).toEqual(pdf);
  await expect(openVerifiedMaterialPdfSource(material.storagePath!, prepared.record.receipt)).rejects.toThrow('material-provenance-pdf-changed');
});
