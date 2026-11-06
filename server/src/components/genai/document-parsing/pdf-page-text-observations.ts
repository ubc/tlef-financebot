import { createHash } from 'node:crypto';
import type { PdfPageTextObservation, PdfPageTextObservations, PdfPageTextObservationSummary, PdfPageTextState, PdfParseReceipt } from '../../../types/source-provenance';
import { buildPdfPageMap, validatePdfPageMapIdentity } from './pdf-provenance';

export const PDF_PAGE_TEXT_OBSERVATIONS_VERSION = 'native-page-text-observations-v1' as const;
export const PDF_PAGE_TEXT_SPARSE_THRESHOLD = 120 as const;
/** This additive feature has a stricter cap than the historical page locator. */
export const PDF_PAGE_TEXT_OBSERVATION_LIMITS = Object.freeze({ pages: 20_000, rawTextBytes: 50 * 1024 * 1024 });
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key));
const stateForCount = (count: number): PdfPageTextState => count === 0 ? 'blank' : count < PDF_PAGE_TEXT_SPARSE_THRESHOLD ? 'sparse' : 'present';

function boundReceipt(receipt: PdfParseReceipt | undefined): receipt is PdfParseReceipt & { pageMap: Extract<PdfParseReceipt['pageMap'], { status: 'verified' }> } {
  return !!receipt && receipt.version === 'pdf-parse-receipt-v1' && receipt.successfulEngine === 'poppler-pdftotext' && receipt.actualFormat === 'text'
    && isHash(receipt.pdfSha256) && integer(receipt.pdfBytes) && receipt.pdfBytes > 0 && receipt.pdfBytes <= PDF_PAGE_TEXT_OBSERVATION_LIMITS.rawTextBytes
    && isHash(receipt.rawTextSha256) && integer(receipt.rawTextBytes) && receipt.rawTextBytes > 0 && receipt.rawTextBytes <= PDF_PAGE_TEXT_OBSERVATION_LIMITS.rawTextBytes
    && integer(receipt.rawTextUtf16Length) && receipt.rawTextUtf16Length > 0 && receipt.rawTextUtf16Length <= PDF_PAGE_TEXT_OBSERVATION_LIMITS.rawTextBytes
    && receipt.pageCount?.status === 'verified' && integer(receipt.pageCount.count) && receipt.pageCount.count > 0 && receipt.pageCount.count <= PDF_PAGE_TEXT_OBSERVATION_LIMITS.pages
    && receipt.pageMap?.status === 'verified' && Array.isArray(receipt.pageMap.pages) && receipt.pageMap.pages.length === receipt.pageCount.count
    && validatePdfPageMapIdentity(receipt.pageMap, receipt.rawTextSha256, receipt.rawTextUtf16Length);
}

function observationHash(record: Omit<PdfPageTextObservations, 'sha256'>): string {
  return hash(JSON.stringify({ version: record.version, pdfSha256: record.pdfSha256, rawTextSha256: record.rawTextSha256,
    pageMapSha256: record.pageMapSha256, sparseThreshold: record.sparseThreshold,
    pages: record.pages.map(page => ({ physicalPage: page.physicalPage, rawStart: page.rawStart, rawEnd: page.rawEnd,
      nonWhitespaceCharacters: page.nonWhitespaceCharacters, nativeTextSha256: page.nativeTextSha256, state: page.state })) }));
}

/** Build only from exact native bytes and independently bound physical pages.
 * Blank pages remain records. Sparse text is a volume signal, never a claim
 * that a page is a chart, unteachable, unreadable, complete or interpreted. */
export function buildPdfPageTextObservations(text: string, receipt: PdfParseReceipt): PdfPageTextObservations | undefined {
  if (typeof text !== 'string' || !boundReceipt(receipt) || text.length !== receipt.rawTextUtf16Length
    || Buffer.byteLength(text, 'utf8') !== receipt.rawTextBytes || hash(text) !== receipt.rawTextSha256) return undefined;
  const rebuilt = buildPdfPageMap(text, receipt.pageCount.status === 'verified' ? receipt.pageCount.count : undefined, receipt.successfulEngine);
  if (rebuilt.status !== 'verified' || rebuilt.sha256 !== receipt.pageMap.sha256) return undefined;
  const pages: PdfPageTextObservation[] = receipt.pageMap.pages.map(page => {
    const nativeText = text.slice(page.rawStart, page.rawEnd);
    const nonWhitespaceCharacters = nativeText.replace(/\s/gu, '').length;
    return { physicalPage: page.physicalPage, rawStart: page.rawStart, rawEnd: page.rawEnd,
      nonWhitespaceCharacters, nativeTextSha256: hash(nativeText), state: stateForCount(nonWhitespaceCharacters) };
  });
  const body: Omit<PdfPageTextObservations, 'sha256'> = { version: PDF_PAGE_TEXT_OBSERVATIONS_VERSION,
    pdfSha256: receipt.pdfSha256, rawTextSha256: receipt.rawTextSha256, pageMapSha256: receipt.pageMap.sha256,
    sparseThreshold: PDF_PAGE_TEXT_SPARSE_THRESHOLD, pages };
  return { ...body, sha256: observationHash(body) };
}

/** No source/filesystem work: validate the published builder receipt's shape,
 * canonical digest, complete ordered pages and binding to the current parse.
 * Without raw text this cannot independently re-extract page counts/hashes;
 * publication must use the builder and retain its immutable sidecar. */
export function validatePdfPageTextObservations(value: unknown, receipt: PdfParseReceipt): value is PdfPageTextObservations {
  if (!boundReceipt(receipt) || !object(value) || !keys(value, ['version', 'pdfSha256', 'rawTextSha256', 'pageMapSha256', 'sparseThreshold', 'pages', 'sha256'])
    || value.version !== PDF_PAGE_TEXT_OBSERVATIONS_VERSION || value.sparseThreshold !== PDF_PAGE_TEXT_SPARSE_THRESHOLD
    || value.pdfSha256 !== receipt.pdfSha256 || value.rawTextSha256 !== receipt.rawTextSha256 || value.pageMapSha256 !== receipt.pageMap.sha256
    || !isHash(value.sha256) || !Array.isArray(value.pages) || value.pages.length !== receipt.pageMap.pages.length) return false;
  for (const [index, page] of value.pages.entries()) {
    const expected = receipt.pageMap.pages[index];
    if (!object(page) || !keys(page, ['physicalPage', 'rawStart', 'rawEnd', 'nonWhitespaceCharacters', 'nativeTextSha256', 'state'])
      || page.physicalPage !== expected.physicalPage || page.rawStart !== expected.rawStart || page.rawEnd !== expected.rawEnd
      || !integer(page.nonWhitespaceCharacters) || page.nonWhitespaceCharacters < 0 || page.nonWhitespaceCharacters > expected.rawEnd - expected.rawStart
      || Boolean(page.nonWhitespaceCharacters) !== expected.hasNonWhitespaceText
      || page.state !== stateForCount(page.nonWhitespaceCharacters) || !isHash(page.nativeTextSha256)
      || expected.rawStart === expected.rawEnd && page.nativeTextSha256 !== hash('')) return false;
  }
  return observationHash(value as unknown as PdfPageTextObservations) === value.sha256;
}

/** Compact, lossless physical-page ranges. Mapped chunks/LOs never enter this
 * projection and therefore cannot clear a page's independent text observation. */
export function projectPdfPageTextObservations(value: unknown, receipt: PdfParseReceipt): PdfPageTextObservationSummary {
  const base = { version: PDF_PAGE_TEXT_OBSERVATIONS_VERSION, interpretation: 'unknown' as const, teachingCoverage: 'not-assessed' as const };
  if (value === undefined || value === null) return { ...base, status: 'unavailable', reason: 'Native page-text observations were not recorded for this source.' };
  if (!validatePdfPageTextObservations(value, receipt)) return { ...base, status: 'unavailable', reason: 'Native page-text observations do not match the current parse receipt.' };
  const counts = { total: value.pages.length, blank: 0, sparse: 0, present: 0 };
  const ranges: Array<{ startPage: number; endPage: number; state: PdfPageTextState }> = [];
  for (const page of value.pages) {
    counts[page.state]++;
    const previous = ranges.at(-1);
    if (previous?.state === page.state && previous.endPage + 1 === page.physicalPage) previous.endPage = page.physicalPage;
    else ranges.push({ startPage: page.physicalPage, endPage: page.physicalPage, state: page.state });
  }
  return { ...base, status: 'available', pdfSha256: value.pdfSha256, rawTextSha256: value.rawTextSha256, pageMapSha256: value.pageMapSha256,
    observationsSha256: value.sha256, sparseThreshold: value.sparseThreshold, counts, ranges };
}
