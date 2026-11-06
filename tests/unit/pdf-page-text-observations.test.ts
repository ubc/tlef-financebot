import { createHash } from 'node:crypto';
import { buildPdfPageMap } from '../../server/src/components/genai/document-parsing/pdf-provenance';
import { buildPdfPageTextObservations, validatePdfPageTextObservations, projectPdfPageTextObservations,
  PDF_PAGE_TEXT_OBSERVATION_LIMITS } from '../../server/src/components/genai/document-parsing/pdf-page-text-observations';
import type { PdfPageTextObservations, PdfParseReceipt } from '../../server/src/types/source-provenance';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture(pages: string[] = ['', 'Author\n10', 'x'.repeat(119), 'x'.repeat(120), '  ']): { text: string; receipt: PdfParseReceipt; observations: PdfPageTextObservations } {
  const text = pages.join('\f') + '\f';
  const receipt: PdfParseReceipt = { version: 'pdf-parse-receipt-v1', pdfSha256: hash('original PDF bytes'), pdfBytes: 42,
    routingPolicy: 'text-poppler-first-v2', requestedFormat: 'text', actualFormat: 'text', successfulEngine: 'poppler-pdftotext', engineVersion: null, attempts: [],
    rawTextSha256: hash(text), rawTextBytes: Buffer.byteLength(text), rawTextUtf16Length: text.length,
    pageCount: { engine: 'pdfinfo', engineVersion: null, status: 'verified', count: pages.length }, pageMap: buildPdfPageMap(text, pages.length, 'poppler-pdftotext') };
  const observations = buildPdfPageTextObservations(text, receipt);
  if (!observations) throw new Error('Fixture needs a bound native map');
  return { text, receipt, observations };
}

describe('native physical-page text observations (text-volume mechanics only)', () => {
  test('keeps every blank/sparse/present page with exact source ranges and native hashes', () => {
    const { text, receipt, observations } = fixture();
    expect(observations).toMatchObject({ version: 'native-page-text-observations-v1', sparseThreshold: 120,
      pdfSha256: receipt.pdfSha256, rawTextSha256: receipt.rawTextSha256, pages: [
        { physicalPage: 1, rawStart: 0, rawEnd: 0, nonWhitespaceCharacters: 0, state: 'blank', nativeTextSha256: hash('') },
        { physicalPage: 2, rawStart: 1, rawEnd: 10, nonWhitespaceCharacters: 8, state: 'sparse', nativeTextSha256: hash('Author\n10') },
        { physicalPage: 3, nonWhitespaceCharacters: 119, state: 'sparse' }, { physicalPage: 4, nonWhitespaceCharacters: 120, state: 'present' },
        { physicalPage: 5, nonWhitespaceCharacters: 0, state: 'blank', nativeTextSha256: hash('  ') },
      ] });
    expect(validatePdfPageTextObservations(observations, receipt)).toBe(true);
    expect(buildPdfPageTextObservations(text, receipt)).toEqual(observations);
  });
  test('fixed threshold excludes whitespace and preserves UTF-16/Unicode native identity', () => {
    const { receipt, observations } = fixture(['\t' + 'α '.repeat(119), '😀'.repeat(60), '\n\u00a0\t']);
    expect(observations.pages.map(page => [page.nonWhitespaceCharacters, page.state])).toEqual([[119, 'sparse'], [120, 'present'], [0, 'blank']]);
    expect(validatePdfPageTextObservations(observations, receipt)).toBe(true);
    expect(observations.pages[1].rawEnd - observations.pages[1].rawStart).toBe(120);
  });
  test('range projection is lossless across consecutive states and remains semantically unknown', () => {
    const { receipt, observations } = fixture(['', ' ', 'short', 'brief', 'a'.repeat(120), 'b'.repeat(200), '', 'tiny']);
    const projection = projectPdfPageTextObservations(observations, receipt);
    expect(projection).toEqual({ version: 'native-page-text-observations-v1', status: 'available', interpretation: 'unknown', teachingCoverage: 'not-assessed',
      pdfSha256: receipt.pdfSha256, rawTextSha256: receipt.rawTextSha256, pageMapSha256: observations.pageMapSha256,
      observationsSha256: observations.sha256, sparseThreshold: 120, counts: { total: 8, blank: 3, sparse: 3, present: 2 },
      ranges: [{ startPage: 1, endPage: 2, state: 'blank' }, { startPage: 3, endPage: 4, state: 'sparse' },
        { startPage: 5, endPage: 6, state: 'present' }, { startPage: 7, endPage: 7, state: 'blank' }, { startPage: 8, endPage: 8, state: 'sparse' }] });
  });
  test('footer-looking text, a title, vector labels and a readable table are only text-volume states', () => {
    const { receipt, observations } = fixture(['Someone Else 156', 'Dividend Policy', '1988 1989 1990 0% 10% 20%', 'Company\tValue\nA\t19.3%\nB\t13.3%']);
    expect(observations.pages.every(page => page.state === 'sparse')).toBe(true);
    const summary = projectPdfPageTextObservations(observations, receipt);
    expect(summary).toMatchObject({ interpretation: 'unknown', teachingCoverage: 'not-assessed', counts: { total: 4, sparse: 4 } });
    expect(JSON.stringify(summary)).not.toMatch(/chart|table|footer|covered|verified|non-instructional/);
  });
  test('an adjacent mapped formula or full-chunk page locator cannot clear a sparse physical page', () => {
    const { receipt, observations } = fixture(['Author 155', 'Author 156', 'Dividend Payout = Dividends / Net Income. '.repeat(5)]);
    const before = projectPdfPageTextObservations(observations, receipt);
    const unrelatedMappedOutline = { evidenceIds: ['E785'], chunkIndex: 30, physicalPages: [1, 2, 3], status: 'mapped' };
    expect(unrelatedMappedOutline.status).toBe('mapped');
    expect(projectPdfPageTextObservations(observations, receipt)).toEqual(before);
    expect(before).toMatchObject({ counts: { total: 3, sparse: 2, present: 1 }, interpretation: 'unknown', teachingCoverage: 'not-assessed' });
  });
  test.each(['source-bytes', 'byte-length', 'utf16-length', 'raw-hash', 'pdf-hash', 'page-map-hash', 'page-boundary', 'map-text-flag', 'count', 'unicode'] as const)(
    'builder refuses %s drift rather than publishing a substitute observation', kind => {
      const sample = fixture(); const receipt = structuredClone(sample.receipt); let text = sample.text;
      if (kind === 'source-bytes') text = text.replace('Author', 'Writer');
      if (kind === 'byte-length') receipt.rawTextBytes--;
      if (kind === 'utf16-length') receipt.rawTextUtf16Length--;
      if (kind === 'raw-hash') receipt.rawTextSha256 = hash('foreign raw');
      if (kind === 'pdf-hash') receipt.pdfSha256 = 'invalid';
      if (kind === 'page-map-hash' && receipt.pageMap.status === 'verified') receipt.pageMap.sha256 = hash('foreign map');
      if (kind === 'page-boundary' && receipt.pageMap.status === 'verified') receipt.pageMap.pages[1].rawStart++;
      if (kind === 'map-text-flag' && receipt.pageMap.status === 'verified') receipt.pageMap.pages[0].hasNonWhitespaceText = true;
      if (kind === 'count' && receipt.pageCount.status === 'verified') receipt.pageCount.count--;
      if (kind === 'unicode') { text = 'bad\ud800\f'; receipt.rawTextSha256 = hash(text); receipt.rawTextBytes = Buffer.byteLength(text); receipt.rawTextUtf16Length = text.length; receipt.pageMap = buildPdfPageMap(text, 1, 'poppler-pdftotext'); }
      expect(buildPdfPageTextObservations(text, receipt)).toBeUndefined();
    });
  test.each(['receipt-version', 'toolkit', 'markdown', 'unknown-count', 'unknown-map', 'malformed-map', 'page-cap', 'raw-byte-cap', 'pdf-byte-cap'] as const)(
    'unavailable/unbounded %s stays unavailable without source or parser work', kind => {
      const { text, receipt, observations } = fixture();
      if (kind === 'receipt-version') Object.assign(receipt, { version: 'unknown-future-receipt' });
      if (kind === 'toolkit') receipt.successfulEngine = 'toolkit';
      if (kind === 'markdown') receipt.actualFormat = 'markdown';
      if (kind === 'unknown-count') receipt.pageCount = { engine: 'pdfinfo', engineVersion: null, status: 'unavailable', reason: 'missing binary' };
      if (kind === 'unknown-map') receipt.pageMap = { version: 'native-formfeed-pages-v1', offsetUnit: 'utf16-code-units', status: 'unavailable', reason: 'no native map' };
      if (kind === 'malformed-map') Object.assign(receipt, { pageMap: { status: 'verified' } });
      if (kind === 'page-cap') Object.assign(receipt.pageCount, { count: PDF_PAGE_TEXT_OBSERVATION_LIMITS.pages + 1 });
      if (kind === 'raw-byte-cap') receipt.rawTextBytes = PDF_PAGE_TEXT_OBSERVATION_LIMITS.rawTextBytes + 1;
      if (kind === 'pdf-byte-cap') receipt.pdfBytes = PDF_PAGE_TEXT_OBSERVATION_LIMITS.rawTextBytes + 1;
      expect(buildPdfPageTextObservations(text, receipt)).toBeUndefined();
      expect(validatePdfPageTextObservations(observations, receipt)).toBe(false);
      expect(projectPdfPageTextObservations(observations, receipt)).toMatchObject({ status: 'unavailable', interpretation: 'unknown', teachingCoverage: 'not-assessed' });
    });
  test.each(['pdf', 'raw', 'map', 'version', 'threshold', 'digest', 'missing', 'duplicate', 'reorder', 'range', 'count', 'state', 'native-hash', 'extra-proof'] as const)(
    'validator refuses altered %s receipt/rows before projecting counts', kind => {
      const { receipt, observations } = fixture(); const altered = structuredClone(observations);
      if (kind === 'pdf') altered.pdfSha256 = hash('foreign PDF');
      if (kind === 'raw') altered.rawTextSha256 = hash('foreign raw');
      if (kind === 'map') altered.pageMapSha256 = hash('foreign map');
      if (kind === 'version') Object.assign(altered, { version: 'future-v2' });
      if (kind === 'threshold') Object.assign(altered, { sparseThreshold: 121 });
      if (kind === 'digest') altered.sha256 = hash('foreign observations');
      if (kind === 'missing') altered.pages.pop();
      if (kind === 'duplicate') altered.pages[1] = { ...altered.pages[0] };
      if (kind === 'reorder') altered.pages.reverse();
      if (kind === 'range') altered.pages[1].rawStart++;
      if (kind === 'count') altered.pages[1].nonWhitespaceCharacters++;
      if (kind === 'state') altered.pages[1].state = 'present';
      if (kind === 'native-hash') altered.pages[0].nativeTextSha256 = hash('not empty');
      if (kind === 'extra-proof') Object.assign(altered, { teachingCoverage: 'verified' });
      expect(validatePdfPageTextObservations(altered, receipt)).toBe(false);
      const summary = projectPdfPageTextObservations(altered, receipt);
      expect(summary).toMatchObject({ status: 'unavailable' }); expect(summary).not.toHaveProperty('counts'); expect(summary).not.toHaveProperty('ranges');
    });
  test.each([undefined, null, {}, [], { version: 'native-page-text-observations-v1' }])('historical or malformed %p does not fabricate zero gaps', value => {
    const { receipt } = fixture();
    expect(validatePdfPageTextObservations(value, receipt)).toBe(false);
    const summary = projectPdfPageTextObservations(value, receipt);
    expect(summary).toMatchObject({ status: 'unavailable', interpretation: 'unknown', teachingCoverage: 'not-assessed' });
    expect(summary).not.toHaveProperty('counts'); expect(summary).not.toHaveProperty('ranges');
  });
  test('accepts reordered BSON object keys without weakening ordered physical-page identity', () => {
    const { receipt, observations } = fixture();
    const reordered = Object.fromEntries(Object.entries(observations).reverse());
    reordered.pages = observations.pages.map(page => Object.fromEntries(Object.entries(page).reverse()));
    expect(validatePdfPageTextObservations(reordered, receipt)).toBe(true);
    expect(projectPdfPageTextObservations(reordered, receipt)).toEqual(projectPdfPageTextObservations(observations, receipt));
  });
});
