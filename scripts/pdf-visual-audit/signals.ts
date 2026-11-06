import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const VISUAL_LIMITS = Object.freeze({ files: 10, pages: 599, pdfBytes: 50 * 1024 * 1024, nativeBytes: 4 * 1024 * 1024,
  jsonBytes: 4 * 1024 * 1024, outputBytes: 8 * 1024 * 1024, workerOutputBytes: 2 * 1024 * 1024,
  workerTimeoutMs: 120000, pageTimeoutMs: 8000, workerMemoryMiB: 384, concurrency: 2,
  operatorsPerPage: 200000, textItemsPerPage: 50000, textCharsPerPage: 1000000, imagePixels: 16000000,
  queuePages: 6, queuePerFile: 2 });
export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export interface Pin { file: string; sha256: string; bytes?: number }
export interface NativePage { physicalPage: number; rawStart: number; rawEnd: number; hasNonWhitespaceText: boolean }
export interface NativeReceipt {
  pdfSha256: string; pdfBytes: number; rawTextSha256: string; rawTextBytes: number; rawTextUtf16Length: number;
  pageCount: { status: string; count: number };
  pageMap: { version: string; offsetUnit: string; status: string; sha256: string; pages: NativePage[] };
}
export interface NativeSignals {
  utf16Characters: number; nonWhitespaceCharacters: number; lineCount: number; numericLabelTokens: number;
  numericExamples: string[]; blankNativeText: boolean; footerOnlyCandidate: boolean; sparseNativeText: boolean;
  excerpt: string; sha256: string;
}
export interface OperatorSignals {
  status: 'inspected'; totalOperators: number; rasterImagePaints: number; rasterPaintKinds: Record<string, number>;
  vectorPathConstructions: number; vectorPathSegments: number; vectorPaints: number;
  textPaints: number; imagePixelDecodeCap: number;
}
export interface PageLedgerRow {
  pageId: string; chapter: number; physicalPage: number;
  native: NativeSignals & { rawStart: number; rawEnd: number; densityCharsPer1000Pt2: number | null };
  inspectionStatus: 'inspected' | 'unknown';
  pdfjsText: { items: number; nonWhitespaceCharacters: number; numericLabelTokens: number } | null;
  operators: OperatorSignals | null;
  dimensions: { widthPt: number; heightPt: number } | null;
  interpretation: 'unknown'; review: 'unreviewed'; diagnosticReasons: string[]; priorityScore: number;
  error?: string;
}

/** Independent file-only check of the retained native map, including exact
 * delimiters. A page-number/footer is text presence, never interpreted content. */
export function validateNativeReceipt(pdf: Buffer, native: Buffer, receipt: NativeReceipt): string[] {
  assert(pdf.length <= VISUAL_LIMITS.pdfBytes && native.length <= VISUAL_LIMITS.nativeBytes, 'visual-input-byte-cap');
  assert.equal(sha256(pdf), receipt.pdfSha256, 'visual-pdf-hash-mismatch');
  assert.equal(pdf.length, receipt.pdfBytes, 'visual-pdf-byte-mismatch');
  assert.equal(sha256(native), receipt.rawTextSha256, 'visual-native-hash-mismatch');
  assert.equal(native.length, receipt.rawTextBytes, 'visual-native-byte-mismatch');
  const text = native.toString('utf8');
  assert(Buffer.from(text).equals(native), 'visual-native-invalid-utf8');
  assert.equal(text.length, receipt.rawTextUtf16Length, 'visual-native-offset-mismatch');
  const map = receipt.pageMap;
  assert.equal(receipt.pageCount.status, 'verified', 'visual-page-count-unverified');
  assert(Number.isSafeInteger(receipt.pageCount.count) && receipt.pageCount.count > 0 && receipt.pageCount.count <= VISUAL_LIMITS.pages, 'visual-page-count-cap');
  assert.equal(map.status, 'verified', 'visual-page-map-unverified');
  assert.equal(map.version, 'native-formfeed-pages-v1'); assert.equal(map.offsetUnit, 'utf16-code-units');
  const pages: NativePage[] = []; let start = 0;
  for (let offset = 0; offset < text.length; offset++) if (text[offset] === '\f') {
    pages.push({ physicalPage: pages.length + 1, rawStart: start, rawEnd: offset, hasNonWhitespaceText: !!text.slice(start, offset).trim() }); start = offset + 1;
  }
  if (start < text.length) pages.push({ physicalPage: pages.length + 1, rawStart: start, rawEnd: text.length, hasNonWhitespaceText: !!text.slice(start).trim() });
  assert.equal(pages.length, receipt.pageCount.count, 'visual-page-map-count-mismatch');
  assert.deepEqual(map.pages, pages, 'visual-page-map-ranges-mismatch');
  assert.equal(map.sha256, sha256(JSON.stringify({ version: map.version, offsetUnit: map.offsetUnit,
    rawTextSha256: receipt.rawTextSha256, rawTextUtf16Length: text.length, pages })), 'visual-page-map-hash-mismatch');
  return pages.map(page => text.slice(page.rawStart, page.rawEnd));
}

const numericTokens = (text: string): string[] => text.match(/[-+−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%?/g) ?? [];
export function nativePageSignals(text: string): NativeSignals {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const tokens = numericTokens(text);
  const nonWhitespaceCharacters = text.replace(/\s/g, '').length;
  return { utf16Characters: text.length, nonWhitespaceCharacters, lineCount: lines.length, numericLabelTokens: tokens.length,
    numericExamples: tokens.slice(0, 8).map(token => token.slice(0, 40)), blankNativeText: !text.trim(),
    footerOnlyCandidate: lines.length > 0 && lines.length <= 3 && lines.every(line => /^(?:Aswath\s+Damodaran(?:\s+\d{1,4})?|\d{1,4})$/i.test(line)),
    sparseNativeText: nonWhitespaceCharacters < 120, excerpt: text.slice(0, 160), sha256: sha256(text) };
}
const IMAGE_OPS = ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintSolidColorImageMask',
  'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintImageMaskXObjectGroup', 'paintInlineImageXObjectGroup'];
const VECTOR_PAINTS = ['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'];
export function operatorSignals(fnArray: ArrayLike<number>, argsArray: unknown[][], ops: Record<string, number>): OperatorSignals {
  assert(fnArray.length <= VISUAL_LIMITS.operatorsPerPage && argsArray.length === fnArray.length, 'visual-operator-cap-or-shape');
  const names = new Map(Object.entries(ops).map(([name, value]) => [value, name]));
  const counts = new Map<string, number>(); let vectorPathSegments = 0;
  for (let index = 0; index < fnArray.length; index++) {
    const name = names.get(fnArray[index]) ?? `unknown:${fnArray[index]}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (name === 'constructPath') {
      const segments = argsArray[index]?.[0];
      if (Array.isArray(segments) || ArrayBuffer.isView(segments)) vectorPathSegments += (segments as ArrayLike<unknown>).length;
    }
  }
  const rasterPaintKinds = Object.fromEntries(IMAGE_OPS.filter(name => counts.has(name)).map(name => [name, counts.get(name)!]));
  return { status: 'inspected', totalOperators: fnArray.length, rasterImagePaints: Object.values(rasterPaintKinds).reduce((sum, count) => sum + count, 0),
    rasterPaintKinds, vectorPathConstructions: counts.get('constructPath') ?? 0, vectorPathSegments,
    vectorPaints: VECTOR_PAINTS.reduce((sum, name) => sum + (counts.get(name) ?? 0), 0),
    textPaints: ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'].reduce((sum, name) => sum + (counts.get(name) ?? 0), 0),
    imagePixelDecodeCap: VISUAL_LIMITS.imagePixels };
}
export function pdfjsTextSignals(items: Array<{ str?: unknown }>): NonNullable<PageLedgerRow['pdfjsText']> {
  assert(items.length <= VISUAL_LIMITS.textItemsPerPage, 'visual-text-item-cap');
  const text = items.flatMap(item => typeof item.str === 'string' ? [item.str] : []).join(' ');
  assert(text.length <= VISUAL_LIMITS.textCharsPerPage, 'visual-text-character-cap');
  return { items: items.length, nonWhitespaceCharacters: text.replace(/\s/g, '').length, numericLabelTokens: numericTokens(text).length };
}

/** Signals choose diagnostic inspection, never table/graph labels, answer keys,
 * interpreted coverage or authoring permission. A readable table can still rank. */
export function prioritizePage(native: NativeSignals, operators: OperatorSignals | null): { score: number; reasons: string[] } {
  const reasons: string[] = []; let score = 0;
  if (!operators) { reasons.push('operator-inspection-unavailable'); score += 8; }
  if (native.blankNativeText) { reasons.push('native-text-empty'); score += 4; }
  else if (native.footerOnlyCandidate) { reasons.push('native-text-matches-footer-only-heuristic'); score += 5; }
  else if (native.sparseNativeText) { reasons.push('native-text-sparse'); score += 2; }
  if (operators?.rasterImagePaints) { reasons.push('raster-image-paint-operators-observed'); score += 4; }
  if (operators && operators.vectorPathSegments >= 40) { reasons.push('many-vector-path-segments-observed'); score += 4; }
  else if (operators?.vectorPaints) { reasons.push('vector-paint-operators-observed'); score += 1; }
  if (native.numericLabelTokens >= 8) { reasons.push('native-numeric-label-tokens-observed'); score += 2; }
  reasons.push('interpretation-not-performed');
  return { score, reasons };
}

export function assertAllPageAccounting(rows: PageLedgerRow[], files: Array<{ chapter: number; pageCount: number }>): void {
  assert(new Set(files.map(file => file.chapter)).size === files.length, 'visual-duplicate-file');
  assert.equal(rows.length, files.reduce((sum, file) => sum + file.pageCount, 0), 'visual-page-accounting-count');
  assert.equal(new Set(rows.map(row => row.pageId)).size, rows.length, 'visual-duplicate-page');
  for (const file of files) for (let physicalPage = 1; physicalPage <= file.pageCount; physicalPage++) {
    const matching = rows.filter(row => row.chapter === file.chapter && row.physicalPage === physicalPage);
    assert.equal(matching.length, 1, 'visual-page-accounting-gap');
    assert.equal(matching[0].interpretation, 'unknown'); assert.equal(matching[0].review, 'unreviewed');
  }
}
export function selectDiagnosticQueue(rows: PageLedgerRow[], limit: number = VISUAL_LIMITS.queuePages, perFile: number = VISUAL_LIMITS.queuePerFile): PageLedgerRow[] {
  assert(Number.isSafeInteger(limit) && limit >= 0 && limit <= VISUAL_LIMITS.queuePages && Number.isSafeInteger(perFile) && perFile > 0 && perFile <= VISUAL_LIMITS.queuePerFile, 'visual-queue-cap');
  const selected: PageLedgerRow[] = []; const counts = new Map<number, number>();
  for (const row of [...rows].sort((a, b) => b.priorityScore - a.priorityScore || a.chapter - b.chapter || a.physicalPage - b.physicalPage)) {
    if (selected.length >= limit) break;
    if ((counts.get(row.chapter) ?? 0) >= perFile) continue;
    selected.push(row); counts.set(row.chapter, (counts.get(row.chapter) ?? 0) + 1);
  }
  return selected;
}
