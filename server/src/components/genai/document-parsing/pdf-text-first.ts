import type { PdfParseAttempt } from '../../../types/source-provenance';

export const PDF_TEXT_NATIVE_TIMEOUT_MS = 60_000;
export const PDF_TEXT_TOOLKIT_TIMEOUT_MS = 15_000;
export const PDF_TEXT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

export interface PdfTextParsingDependencies {
  parseNative(filePath: string): Promise<string>;
  parseToolkit(filePath: string): Promise<string>;
  logger: { warn(message: string, metadata?: Record<string, unknown>): void };
  /** Observation cannot change routing or turn a late adapter resolution into
   * a selected success. Metadata sinks must never reject valid source text. */
  onAttempt?(attempt: PdfParseAttempt): void;
}

function reason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 800);
}

export class PdfTextExtractionError extends Error {
  readonly code = 'pdf-text-extraction-failed';
  readonly nativeReason: string;
  readonly toolkitReason: string;

  constructor(nativeError: unknown, toolkitError: unknown) {
    const nativeReason = reason(nativeError); const toolkitReason = reason(toolkitError);
    super(`PDF text extraction failed. Native parser: ${nativeReason}. Toolkit parser: ${toolkitReason}.`, { cause: toolkitError });
    this.name = 'PdfTextExtractionError';
    this.nativeReason = nativeReason;
    this.toolkitReason = toolkitReason;
  }
}

export async function boundedText(filePath: string, parse: (filePath: string) => Promise<string>, label: string, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = await Promise.race([
      // Defer invocation so a synchronous dependency failure follows the same
      // cleanup and fallback path as an asynchronous rejection.
      Promise.resolve().then(() => parse(filePath)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} PDF text parser timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    if (typeof text !== 'string' || !text.trim()) throw new Error(`${label} PDF text parser found no extractable text`);
    if (Buffer.byteLength(text, 'utf8') > PDF_TEXT_MAX_OUTPUT_BYTES) throw new Error(`${label} PDF text parser output exceeds ${PDF_TEXT_MAX_OUTPUT_BYTES} bytes`);
    // Validate emptiness without trimming or otherwise changing source bytes.
    return text;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** PDF text requests only. Routing other formats stays with the public facade.
 * The native adapter must also bound its subprocess lifetime/output (execFile's
 * existing timeout/maxBuffer); a Promise timeout cannot cancel arbitrary toolkit
 * work. Neither stage performs OCR or creates a successful empty placeholder. */
export async function parsePdfTextNativeFirst(filePath: string, dependencies: PdfTextParsingDependencies): Promise<string> {
  const observe = (engine: PdfParseAttempt['engine'], outcome: PdfParseAttempt['outcome'], started: number, error?: unknown) => {
    try { dependencies.onAttempt?.({ engine, outcome, elapsedMs: Math.max(0, Date.now() - started), ...(error === undefined ? {} : { reason: reason(error) }) }); } catch { /* Advisory receipt observation cannot change source parsing. */ }
  };
  let nativeError: unknown;
  const nativeStart = Date.now();
  try {
    const text = await boundedText(filePath, path => dependencies.parseNative(path), 'Native', PDF_TEXT_NATIVE_TIMEOUT_MS);
    observe('poppler-pdftotext', 'succeeded', nativeStart);
    return text;
  } catch (error) { nativeError = error; observe('poppler-pdftotext', 'failed', nativeStart, error); }
  try {
    dependencies.logger.warn('Native PDF text parser failed; falling back to toolkit', { filePath, reason: reason(nativeError) });
  } catch { /* Logging must not prevent the bounded parser fallback. */ }
  const toolkitStart = Date.now();
  try {
    const text = await boundedText(filePath, path => dependencies.parseToolkit(path), 'Toolkit', PDF_TEXT_TOOLKIT_TIMEOUT_MS);
    observe('toolkit', 'succeeded', toolkitStart);
    return text;
  } catch (toolkitError) { observe('toolkit', 'failed', toolkitStart, toolkitError); throw new PdfTextExtractionError(nativeError, toolkitError); }
}
