import type { ObjectId } from 'mongodb';

/** Physical PDF order, never a printed slide label or semantic support verdict. */
export interface PdfPageInterval {
  physicalPage: number;
  rawStart: number;
  rawEnd: number;
  hasNonWhitespaceText: boolean;
}
export type PdfPageMap = {
  version: 'native-formfeed-pages-v1';
  offsetUnit: 'utf16-code-units';
} & ({ status: 'verified'; sha256: string; pages: PdfPageInterval[] }
  | { status: 'unavailable'; reason: string });

export interface PdfParseAttempt {
  engine: 'poppler-pdftotext' | 'toolkit';
  outcome: 'succeeded' | 'failed';
  elapsedMs: number;
  reason?: string;
}
export interface PdfParseReceipt {
  version: 'pdf-parse-receipt-v1';
  pdfSha256: string;
  pdfBytes: number;
  routingPolicy: 'text-poppler-first-v2' | 'markdown-toolkit-first-v1';
  requestedFormat: string;
  actualFormat: 'text' | 'markdown';
  successfulEngine: PdfParseAttempt['engine'];
  engineVersion: string | null;
  attempts: PdfParseAttempt[];
  rawTextSha256: string;
  rawTextBytes: number;
  rawTextUtf16Length: number;
  pageCount: { engine: 'pdfinfo'; engineVersion: string | null } &
    ({ status: 'verified'; count: number } | { status: 'unavailable'; reason: string });
  pageMap: PdfPageMap;
}
export interface ParsedFileWithReceipt { text: string; receipt?: PdfParseReceipt }

export interface PdfPageSpan {
  physicalPage: number;
  rawStart: number;
  rawEnd: number;
  chunkStart: number;
  chunkEnd: number;
}
export type PdfChunkLocator = {
  version: 'pdf-chunk-locator-v1';
  chunkTextSha256: string;
  offsetUnit: 'utf16-code-units';
} & ({ status: 'verified'; rawStart: number; rawEnd: number; pageSpans: PdfPageSpan[] }
  | { status: 'unavailable'; reason: string });

/** Stored outside chunk.metadata to preserve legacy source-content hashes. */
export interface MaterialChunkProvenance {
  provenanceId: string;
  pdfSha256: string;
  rawTextSha256: string;
  pageMapSha256?: string;
  locator: PdfChunkLocator;
}
/** Immutable private ingestion bindings, ordered by the original full chunk index. */
export interface MaterialChunkBindings {
  version: 'full-chunk-provenance-v1';
  entries: Array<[index: number, chunkTextSha256: string, provenanceSha256: string]>;
  sha256: string;
}
export interface MaterialSourceProvenance {
  courseId: ObjectId;
  materialId: ObjectId;
  ingestRunId?: ObjectId;
  sourceTextHash: string;
  chunkCount: number;
  chunkBindings: MaterialChunkBindings;
  receipt: PdfParseReceipt;
  /** Native text volume only; never visual interpretation or teaching coverage. */
  pageTextObservations?: PdfPageTextObservations;
  /** Private artifact path, never part of a material/workspace/evidence DTO. */
  rawTextStoragePath: string;
  createdAt: Date;
}

/** A server-computed location for one exact chunk range; not model-supplied. */
export type SourceLocation = {
  version: 'pdf-source-location-v1';
  offsetUnit: 'utf16-code-units';
} & ({ status: 'verified'; provenanceId: string; pdfSha256: string;
  rawTextSha256: string; pageMapSha256: string; chunkTextSha256: string;
  chunkStart: number; chunkEnd: number; rawStart: number; rawEnd: number;
  pageSpans: PdfPageSpan[] }
  | { status: 'unavailable'; reason: string });

export type PdfPageTextState = 'blank' | 'sparse' | 'present';
export interface PdfPageTextObservation {
  physicalPage: number;
  rawStart: number;
  rawEnd: number;
  /** Non-whitespace UTF-16 code units, consistent with native offsets. */
  nonWhitespaceCharacters: number;
  nativeTextSha256: string;
  state: PdfPageTextState;
}
/** Immutable observations of exact native text; no OCR or visual classification. */
export interface PdfPageTextObservations {
  version: 'native-page-text-observations-v1';
  pdfSha256: string;
  rawTextSha256: string;
  pageMapSha256: string;
  sparseThreshold: 120;
  pages: PdfPageTextObservation[];
  sha256: string;
}
export type PdfPageTextObservationSummary = {
  version: 'native-page-text-observations-v1';
  interpretation: 'unknown';
  teachingCoverage: 'not-assessed';
} & ({ status: 'available'; pdfSha256: string; rawTextSha256: string; pageMapSha256: string;
  observationsSha256: string; sparseThreshold: 120;
  counts: { total: number; blank: number; sparse: number; present: number };
  ranges: Array<{ startPage: number; endPage: number; state: PdfPageTextState }> }
  | { status: 'unavailable'; reason: string });
