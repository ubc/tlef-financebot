import { createHash } from 'node:crypto';
import type { MaterialChunkProvenance, PdfPageMap, PdfChunkLocator, PdfPageSpan, SourceLocation } from '../../../types/source-provenance';

const PAGE_VERSION = 'native-formfeed-pages-v1' as const;
const OFFSET_UNIT = 'utf16-code-units' as const;
const MAX_PDF_PAGES = 100_000;
const MAX_TEXT_BYTES = 50 * 1024 * 1024;
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const invalidUnicode = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
const splitsPair = (text: string, offset: number) => offset > 0 && offset < text.length &&
  /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
const unavailableMap = (reason: string): PdfPageMap => ({ version: PAGE_VERSION, offsetUnit: OFFSET_UNIT, status: 'unavailable', reason });
const unavailableLocation = (reason: string): SourceLocation => ({ version: 'pdf-source-location-v1', offsetUnit: OFFSET_UNIT, status: 'unavailable', reason });
function mapHash(pages: Extract<PdfPageMap, { status: 'verified' }>['pages'], rawTextSha256: string, rawTextUtf16Length: number): string {
  return hash(JSON.stringify({ version: PAGE_VERSION, offsetUnit: OFFSET_UNIT, rawTextSha256, rawTextUtf16Length, pages }));
}

/** Pure receipt validation; it does not independently read a PDF or raw artifact.
 * The canonical map identity binds exact raw-text bytes and UTF-16 boundaries. */
export function validatePdfPageMapIdentity(pageMap: PdfPageMap, rawTextSha256: string, rawTextUtf16Length: number): boolean {
  if (!pageMap || pageMap.version !== PAGE_VERSION || pageMap.offsetUnit !== OFFSET_UNIT || pageMap.status !== 'verified' || !isHash(pageMap.sha256) ||
      !isHash(rawTextSha256) || !integer(rawTextUtf16Length) || rawTextUtf16Length < 1 || rawTextUtf16Length > MAX_TEXT_BYTES ||
      !Array.isArray(pageMap.pages) || !pageMap.pages.length || pageMap.pages.length > MAX_PDF_PAGES) return false;
  for (const [index, page] of pageMap.pages.entries()) {
    if (!page || page.physicalPage !== index + 1 || !integer(page.rawStart) || !integer(page.rawEnd) || typeof page.hasNonWhitespaceText !== 'boolean' ||
        page.rawStart < 0 || page.rawEnd < page.rawStart || page.rawEnd > rawTextUtf16Length ||
        page.rawStart !== (index === 0 ? 0 : pageMap.pages[index - 1].rawEnd + 1)) return false;
  }
  const last = pageMap.pages.at(-1)!;
  if (last.rawEnd !== rawTextUtf16Length && last.rawEnd !== rawTextUtf16Length - 1) return false;
  return pageMap.sha256 === mapHash(pageMap.pages, rawTextSha256, rawTextUtf16Length);
}

/** Native form feeds identify physical order only when an independent pdfinfo
 * count agrees. Leading/consecutive blank pages stay; only a terminal sentinel
 * is omitted. Toolkit text and guessed page counts can never verify this map. */
export function buildPdfPageMap(text: string, pageCount: number | null | undefined, actualEngine: string): PdfPageMap {
  if (actualEngine !== 'poppler-pdftotext') return unavailableMap('actual-parser-is-not-native-pdftotext');
  if (typeof text !== 'string' || !text.trim()) return unavailableMap('native-text-empty');
  if (invalidUnicode(text)) return unavailableMap('native-text-invalid-unicode');
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) return unavailableMap('native-text-byte-limit');
  if (!integer(pageCount) || pageCount < 1 || pageCount > MAX_PDF_PAGES) return unavailableMap('independent-page-count-unavailable-or-invalid');
  const pages: Extract<PdfPageMap, { status: 'verified' }>['pages'] = [];
  let start = 0;
  for (let offset = 0; offset < text.length; offset++) {
    if (text[offset] !== '\f') continue;
    pages.push({ physicalPage: pages.length + 1, rawStart: start, rawEnd: offset, hasNonWhitespaceText: Boolean(text.slice(start, offset).trim()) });
    if (pages.length > MAX_PDF_PAGES) return unavailableMap('native-page-marker-limit');
    start = offset + 1;
  }
  if (start < text.length) pages.push({ physicalPage: pages.length + 1, rawStart: start, rawEnd: text.length, hasNonWhitespaceText: Boolean(text.slice(start).trim()) });
  if (pages.length !== pageCount) return unavailableMap('native-page-marker-count-mismatch');
  return { version: PAGE_VERSION, offsetUnit: OFFSET_UNIT, status: 'verified', sha256: mapHash(pages, hash(text), text.length), pages };
}

/** Locate only a unique exact original substring. Chunk ordinal, cumulative
 * retained form feeds and toolkit line metadata are not physical page proof. */
export function locatePdfChunk(text: string, chunkText: string, pageMap: PdfPageMap): PdfChunkLocator {
  const base = { version: 'pdf-chunk-locator-v1' as const, offsetUnit: OFFSET_UNIT, chunkTextSha256: hash(chunkText) };
  const unavailable = (reason: string): PdfChunkLocator => ({ ...base, status: 'unavailable', reason });
  if (!pageMap || pageMap.status !== 'verified') return unavailable(`page-map-unavailable:${pageMap?.status === 'unavailable' ? pageMap.reason : 'missing'}`);
  if (!validatePdfPageMapIdentity(pageMap, hash(text), text.length)) return unavailable('page-map-identity-mismatch');
  const rebuilt = buildPdfPageMap(text, pageMap.pages.length, 'poppler-pdftotext');
  if (rebuilt.status !== 'verified' || rebuilt.sha256 !== pageMap.sha256) return unavailable('page-map-original-boundaries-mismatch');
  if (!chunkText.trim()) return unavailable('chunk-empty-or-whitespace');
  if (invalidUnicode(chunkText)) return unavailable('chunk-invalid-unicode');
  const start = text.indexOf(chunkText);
  if (start < 0) return unavailable('chunk-not-an-exact-native-substring');
  if (text.indexOf(chunkText, start + 1) >= 0) return unavailable('chunk-native-substring-ambiguous');
  const end = start + chunkText.length;
  if (splitsPair(text, start) || splitsPair(text, end)) return unavailable('chunk-splits-unicode-code-point');
  const pageSpans = pageMap.pages.flatMap(page => {
    const rawStart = Math.max(start, page.rawStart); const rawEnd = Math.min(end, page.rawEnd);
    if (rawEnd <= rawStart || !text.slice(rawStart, rawEnd).trim()) return [];
    return [{ physicalPage: page.physicalPage, rawStart, rawEnd, chunkStart: rawStart - start, chunkEnd: rawEnd - start }];
  });
  if (!pageSpans.length) return unavailable('chunk-has-no-nonwhitespace-page-span');
  return { ...base, status: 'verified', rawStart: start, rawEnd: end, pageSpans };
}

/** Validate the entire stored chunk binding before projecting any subrange.
 * Spans use offsets relative to the full original chunk, including after clip.
 * Callers additionally bind provenance IDs/hashes to the current stored sidecar. */
export function projectPdfChunkLocation(provenance: MaterialChunkProvenance | undefined, start: number, end: number, chunkText: string): SourceLocation {
  if (!provenance || !provenance.locator) return unavailableLocation('chunk-provenance-unavailable');
  const locator = provenance.locator;
  if (locator.status !== 'verified') return unavailableLocation(`chunk-locator-unavailable:${locator.reason}`);
  if (typeof provenance.provenanceId !== 'string' || !provenance.provenanceId.trim() || !isHash(provenance.pdfSha256) || !isHash(provenance.rawTextSha256) ||
      !isHash(provenance.pageMapSha256) || !isHash(locator.chunkTextSha256) || locator.version !== 'pdf-chunk-locator-v1' || locator.offsetUnit !== OFFSET_UNIT ||
      invalidUnicode(chunkText) || locator.chunkTextSha256 !== hash(chunkText)) return unavailableLocation('chunk-provenance-identity-mismatch');
  if (!integer(locator.rawStart) || !integer(locator.rawEnd) || locator.rawStart < 0 || locator.rawEnd > MAX_TEXT_BYTES || locator.rawEnd - locator.rawStart !== chunkText.length ||
      !Array.isArray(locator.pageSpans) || !locator.pageSpans.length || locator.pageSpans.length > MAX_PDF_PAGES) return unavailableLocation('chunk-locator-range-invalid');
  let previousPage = 0; let previousEnd = 0;
  for (const span of locator.pageSpans) {
    if (!span || !integer(span.physicalPage) || span.physicalPage <= previousPage || span.physicalPage > MAX_PDF_PAGES ||
        !integer(span.rawStart) || !integer(span.rawEnd) || !integer(span.chunkStart) || !integer(span.chunkEnd) || span.chunkStart < previousEnd ||
        span.chunkStart < 0 || span.chunkEnd <= span.chunkStart || span.chunkEnd > chunkText.length ||
        span.rawStart !== locator.rawStart + span.chunkStart || span.rawEnd !== locator.rawStart + span.chunkEnd ||
        !chunkText.slice(span.chunkStart, span.chunkEnd).trim() || chunkText.slice(span.chunkStart, span.chunkEnd).includes('\f') ||
        splitsPair(chunkText, span.chunkStart) || splitsPair(chunkText, span.chunkEnd) ||
        chunkText.slice(previousEnd, span.chunkStart).trim()) return unavailableLocation('chunk-locator-page-spans-invalid');
    previousPage = span.physicalPage; previousEnd = span.chunkEnd;
  }
  if (chunkText.slice(previousEnd).trim()) return unavailableLocation('chunk-locator-page-spans-incomplete');
  if (!integer(start) || !integer(end) || start < 0 || end <= start || end > chunkText.length) return unavailableLocation('chunk-range-out-of-bounds');
  if (splitsPair(chunkText, start) || splitsPair(chunkText, end)) return unavailableLocation('chunk-range-splits-unicode-code-point');
  const pageSpans: PdfPageSpan[] = locator.pageSpans.flatMap(span => {
    const chunkStart = Math.max(start, span.chunkStart); const chunkEnd = Math.min(end, span.chunkEnd);
    if (chunkEnd <= chunkStart || !chunkText.slice(chunkStart, chunkEnd).trim()) return [];
    return [{ physicalPage: span.physicalPage, rawStart: locator.rawStart + chunkStart, rawEnd: locator.rawStart + chunkEnd, chunkStart, chunkEnd }];
  });
  if (!pageSpans.length) return unavailableLocation('chunk-range-has-no-nonwhitespace-page-span');
  return { version: 'pdf-source-location-v1', offsetUnit: OFFSET_UNIT, status: 'verified', provenanceId: provenance.provenanceId,
    pdfSha256: provenance.pdfSha256, rawTextSha256: provenance.rawTextSha256, pageMapSha256: provenance.pageMapSha256,
    chunkTextSha256: locator.chunkTextSha256, chunkStart: start, chunkEnd: end, rawStart: locator.rawStart + start, rawEnd: locator.rawStart + end, pageSpans };
}
