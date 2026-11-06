import { createHash } from 'node:crypto';
import { buildPdfPageMap, locatePdfChunk, projectPdfChunkLocation, validatePdfPageMapIdentity } from '../../server/src/components/genai/document-parsing/pdf-provenance';
import type { MaterialChunkProvenance, PdfPageMap } from '../../server/src/types/source-provenance';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const native = 'poppler-pdftotext';
const text = '\fFirst 😀 row\r\n\f\fLast β row\f';
const pageMap = buildPdfPageMap(text, 4, native);
function provenance(chunkText = text): MaterialChunkProvenance {
  return { provenanceId: 'server-sidecar-id', pdfSha256: sha('original PDF'), rawTextSha256: sha(text),
    pageMapSha256: pageMap.status === 'verified' ? pageMap.sha256 : undefined, locator: locatePdfChunk(text, chunkText, pageMap) };
}

it('keeps leading/consecutive blank physical pages and drops only a terminal sentinel', () => {
  expect(pageMap).toMatchObject({ status: 'verified', offsetUnit: 'utf16-code-units', pages: [
    { physicalPage: 1, rawStart: 0, rawEnd: 0, hasNonWhitespaceText: false },
    { physicalPage: 2, rawStart: 1, rawEnd: 15, hasNonWhitespaceText: true },
    { physicalPage: 3, rawStart: 16, rawEnd: 16, hasNonWhitespaceText: false },
    { physicalPage: 4, rawStart: 17, rawEnd: 27, hasNonWhitespaceText: true },
  ] });
  expect(validatePdfPageMapIdentity(pageMap, sha(text), text.length)).toBe(true);
  expect(validatePdfPageMapIdentity(pageMap, sha(text.replace('Last', 'Next')), text.length)).toBe(false);
});

it.each([0, -1, 1.5, NaN, Infinity, 100001, null, undefined])('does not guess a physical count from %s', count => {
  expect(buildPdfPageMap(text, count, native)).toMatchObject({ status: 'unavailable' });
});

it('refuses toolkit/unknown engines, marker mismatches and malformed source text', () => {
  for (const engine of ['toolkit', 'unknown', '']) expect(buildPdfPageMap(text, 4, engine)).toMatchObject({ status: 'unavailable', reason: 'actual-parser-is-not-native-pdftotext' });
  expect(buildPdfPageMap(text, 3, native)).toMatchObject({ status: 'unavailable', reason: 'native-page-marker-count-mismatch' });
  expect(buildPdfPageMap(' \f ', 1, native)).toMatchObject({ status: 'unavailable', reason: 'native-text-empty' });
  expect(buildPdfPageMap('bad\ud800\f', 1, native)).toMatchObject({ status: 'unavailable', reason: 'native-text-invalid-unicode' });
  expect(buildPdfPageMap('First\f \n', 1, native)).toMatchObject({ status: 'unavailable', reason: 'native-page-marker-count-mismatch' });
  expect(buildPdfPageMap('Only native page', 1, native)).toMatchObject({ status: 'verified', pages: [{ rawStart: 0, rawEnd: 16 }] });
});

it('uses exact unique native ranges, UTF-16 offsets and non-whitespace physical page intersections', () => {
  const locator = locatePdfChunk(text, text, pageMap);
  expect(locator).toEqual({ version: 'pdf-chunk-locator-v1', offsetUnit: 'utf16-code-units', chunkTextSha256: sha(text), status: 'verified', rawStart: 0, rawEnd: text.length,
    pageSpans: [{ physicalPage: 2, rawStart: 1, rawEnd: 15, chunkStart: 1, chunkEnd: 15 }, { physicalPage: 4, rawStart: 17, rawEnd: 27, chunkStart: 17, chunkEnd: 27 }] });
  const emoji = locatePdfChunk(text, '😀', pageMap);
  expect(emoji).toMatchObject({ status: 'verified', rawStart: 7, rawEnd: 9 });
  expect(locatePdfChunk(text, 'first', pageMap)).toMatchObject({ status: 'unavailable', reason: 'chunk-not-an-exact-native-substring' });
  expect(locatePdfChunk(text, '\f\f', pageMap)).toMatchObject({ status: 'unavailable', reason: 'chunk-empty-or-whitespace' });
});

it('keeps repeated text, including overlapping repeated matches, unavailable', () => {
  const repeated = 'aaaa\f'; const map = buildPdfPageMap(repeated, 1, native);
  expect(locatePdfChunk(repeated, 'aaa', map)).toMatchObject({ status: 'unavailable', reason: 'chunk-native-substring-ambiguous' });
  const source = 'Repeated\fRepeated\f';
  expect(locatePdfChunk(source, 'Repeated', buildPdfPageMap(source, 2, native))).toMatchObject({ status: 'unavailable', reason: 'chunk-native-substring-ambiguous' });
});

it('rejects edited, incomplete, reordered or stale page maps before locating any quote', () => {
  if (pageMap.status !== 'verified') throw new Error('fixture map unavailable');
  for (const changed of [
    { ...pageMap, sha256: sha('foreign') },
    { ...pageMap, pages: pageMap.pages.slice(1) },
    { ...pageMap, pages: [...pageMap.pages].reverse() },
    { ...pageMap, pages: pageMap.pages.map((page, index) => index === 1 ? { ...page, rawEnd: page.rawEnd + 1 } : page) },
    { ...pageMap, pages: pageMap.pages.map((page, index) => index === 0 ? { ...page, hasNonWhitespaceText: true } : page) },
  ]) {
    expect(validatePdfPageMapIdentity(changed, sha(text), text.length)).toBe(false);
    expect(locatePdfChunk(text, 'Last', changed)).toMatchObject({ status: 'unavailable' });
  }
  expect(locatePdfChunk(text, 'Last', { ...pageMap, status: 'unavailable', reason: 'missing metadata' } as PdfPageMap)).toMatchObject({ status: 'unavailable' });
});

it('projects an exact chunk subrange while retaining full-chunk span offsets', () => {
  const location = projectPdfChunkLocation(provenance(), 7, 21, text);
  expect(location).toMatchObject({ status: 'verified', chunkStart: 7, chunkEnd: 21, rawStart: 7, rawEnd: 21,
    pageSpans: [{ physicalPage: 2, rawStart: 7, rawEnd: 15, chunkStart: 7, chunkEnd: 15 }, { physicalPage: 4, rawStart: 17, rawEnd: 21, chunkStart: 17, chunkEnd: 21 }] });
});

it.each([[-1, 2], [0, 1000], [2, 2], [5, 3], [1.5, 4], [8, 10]])('refuses invalid or surrogate-splitting projected bounds %s..%s', (start, end) => {
  expect(projectPdfChunkLocation(provenance(), start, end, text)).toMatchObject({ status: 'unavailable' });
});

it('validates the entire locator and full chunk hash even for an apparently valid small range', () => {
  const valid = provenance();
  if (valid.locator.status !== 'verified') throw new Error('fixture locator unavailable');
  const malformed = [
    { ...valid, pdfSha256: 'not a hash' },
    { ...valid, pageMapSha256: undefined },
    { ...valid, locator: { ...valid.locator, rawEnd: valid.locator.rawEnd + 1 } },
    { ...valid, locator: { ...valid.locator, pageSpans: valid.locator.pageSpans.slice(0, 1) } },
    { ...valid, locator: { ...valid.locator, pageSpans: valid.locator.pageSpans.map((span, index) => index === 1 ? { ...span, chunkStart: 1 } : span) } },
  ];
  for (const value of malformed) expect(projectPdfChunkLocation(value, 1, 6, text)).toMatchObject({ status: 'unavailable' });
  expect(projectPdfChunkLocation(valid, 1, 6, text.replace('Last', 'Next'))).toMatchObject({ status: 'unavailable', reason: 'chunk-provenance-identity-mismatch' });
  expect(projectPdfChunkLocation(undefined, 1, 6, text)).toMatchObject({ status: 'unavailable' });
});
