import {
  parsePdfIngestArguments, assertPdfIngestTarget, pdfIngestSocketAllowed, claimPdfIngestDatabase,
  validatePdfIngestCorpus, deterministicPdfIngestVectors,
} from '../../scripts/verify-pdf-provenance-ingest';
import type { PdfIngestOwnership, PdfIngestSource } from '../../scripts/verify-pdf-provenance-ingest';

const database = 'financebot_quality_smoke_pdf_provenance_unit_20261017';
const output = 'audit-results/pdf-provenance-ingest-unit-plan';
function syntheticBounds(): PdfIngestSource[] {
  // Admission-only synthetic strings, never the authoritative PDF corpus or semantic acceptance.
  return Array.from({ length: 10 }, (_, index) => {
    const chunks = Array.from({ length: index === 9 ? 68 : 67 }, (_, chunk) => ({ index: chunk, text: `Synthetic ${index}/${chunk}`, characterCount: `Synthetic ${index}/${chunk}`.length }));
    return { chapter: index + 2, pages: index === 9 ? 68 : 59, name: `Synthetic-${index}.pdf`, publicPdf: `/synthetic/${index}.pdf`, pdfSha256: 'a'.repeat(64), size: 100,
      chunks, manifest: { sourceTextHash: 'b'.repeat(64), chunkCount: chunks.length } };
  });
}

describe('PDF provenance ingest harness admission (pure; no filesystem writes, runtime, network or database)', () => {
  it('defaults to file-only preparation and requires the exact execute-local opt-in', () => {
    expect(parsePdfIngestArguments(['--database', database, '--output', output])).toMatchObject({ database, executeLocal: false });
    expect(parsePdfIngestArguments(['--database', database, '--output', output, '--execute-local', 'once'])).toMatchObject({ database, executeLocal: true });
  });
  it.each([
    ['--database', database], ['--database', 'financebot', '--output', output],
    ['--database', database, '--output', '/tmp/not-an-audit-directory'],
    ['--database', database, '--output', output, '--execute-local', 'true'],
    ['--database', database, '--output', output, '--database', database],
    ['--database', database, '--output', output, '--provider', 'openai'],
    ['--database', database, '--output', output, '--execute-local'],
  ])('refuses incomplete, duplicate or wider-scope arguments: %j', (...args) => {
    expect(() => parsePdfIngestArguments(args)).toThrow();
  });
  it('accepts only the explicitly declared direct loopback database on port 27029', () => {
    expect(() => assertPdfIngestTarget('mongodb://127.0.0.1:27029/?directConnection=true', database, database)).not.toThrow();
  });
  it.each([
    ['mongodb://example.invalid:27029/?directConnection=true', database],
    ['mongodb://localhost:27029/?directConnection=true', database],
    ['mongodb://127.0.0.1:27017/?directConnection=true', database],
    ['mongodb://127.0.0.1:27029/', database],
    ['mongodb://127.0.0.1:27029/?directConnection=false', database],
    ['mongodb://127.0.0.1:27029/?directConnection=true&directConnection=false', database],
    ['mongodb://127.0.0.1:27029/another_database?directConnection=true', database],
    ['mongodb://user:password@127.0.0.1:27029/?directConnection=true', database],
    ['mongodb://127.0.0.1:27029/?directConnection=true', 'financebot'],
  ])('refuses remote, credentialed, discovering or mismatched Mongo configuration: %s', (uri, configured) => {
    expect(() => assertPdfIngestTarget(uri, configured, database)).toThrow();
  });
  it('never allows the normal app, Qdrant, model or another Mongo socket', () => {
    expect(pdfIngestSocketAllowed('127.0.0.1', 27029)).toBe(true);
    expect(pdfIngestSocketAllowed('127.0.0.1', 49001, 49001)).toBe(true);
    for (const port of [6118, 6333, 443, 80, 27017, 49002]) expect(pdfIngestSocketAllowed('127.0.0.1', port, 49001)).toBe(false);
    expect(pdfIngestSocketAllowed('example.invalid', 49001, 49001)).toBe(false);
    expect(pdfIngestSocketAllowed('localhost', 27029, 49001)).toBe(false);
  });
  it('uses one atomic exclusive owner claim even after two processes observe an empty database', async () => {
    const records = new Map<string, PdfIngestOwnership>();
    const collection = { async insertOne(record: PdfIngestOwnership) {
      await Promise.resolve();
      if (records.has(record._id)) throw Object.assign(new Error('duplicate ownership'), { code: 11000 });
      records.set(record._id, record);
    } };
    const input = { database, createdAt: new Date('2026-10-17T00:00:00Z') };
    const attempts = await Promise.allSettled([
      claimPdfIngestDatabase(collection, { ...input, actor: 'first' }),
      claimPdfIngestDatabase(collection, { ...input, actor: 'second' }),
    ]);
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(item => item.status === 'rejected')).toHaveLength(1);
    expect([...records.values()]).toEqual([{ ...input, actor: 'first', _id: 'exclusive-pdf-provenance-ingest-owner', noCleanup: true }]);
    await expect(claimPdfIngestDatabase(collection, { ...input, actor: 'later' })).rejects.toMatchObject({ code: 11000 });
  });
  it('checks exact ten-file/599-page/671-chunk bounds and retained text consistency', () => {
    expect(() => validatePdfIngestCorpus(syntheticBounds())).not.toThrow();
    const missing = syntheticBounds(); missing.pop(); expect(() => validatePdfIngestCorpus(missing)).toThrow();
    const pages = syntheticBounds(); pages[0].pages -= 1; expect(() => validatePdfIngestCorpus(pages)).toThrow();
    const chunks = syntheticBounds(); chunks[0].chunks[0].characterCount -= 1; expect(() => validatePdfIngestCorpus(chunks)).toThrow();
    const duplicate = syntheticBounds(); duplicate[1].chapter = duplicate[0].chapter; expect(() => validatePdfIngestCorpus(duplicate)).toThrow();
  });
  it('labels deterministic finite vectors as substitutions rather than pretending they are semantic embeddings', () => {
    const result = deterministicPdfIngestVectors(['Exact source', 'Changed source', 'Exact source']);
    expect(result).toHaveLength(3); expect(result[0]).toEqual(result[2]); expect(result[0]).not.toEqual(result[1]);
    expect(result.every(vector => vector.length === 4 && vector.every(Number.isFinite))).toBe(true);
    expect(deterministicPdfIngestVectors([])).toEqual([]);
  });
});
