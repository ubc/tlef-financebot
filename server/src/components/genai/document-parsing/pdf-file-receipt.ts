import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ParsedFileWithReceipt, PdfParseAttempt, PdfParseReceipt } from '../../../types/source-provenance';
import { parsePdfTextNativeFirst, boundedText, PDF_TEXT_MAX_OUTPUT_BYTES, PDF_TEXT_NATIVE_TIMEOUT_MS, PDF_TEXT_TOOLKIT_TIMEOUT_MS } from './pdf-text-first';
import { buildPdfPageMap } from './pdf-provenance';

const METADATA_TIMEOUT_MS = 5_000;
const METADATA_MAX_BYTES = 64 * 1024;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
interface Dependencies {
  parseNative(filePath: string): Promise<string>;
  parseToolkit(filePath: string, format: 'text' | 'markdown'): Promise<string>;
  parseUnbound(filePath: string, format: 'text' | 'markdown'): Promise<string>;
  toolkitVersion: string | null;
  logger: { warn(message: string, metadata?: Record<string, unknown>): void };
}
function reason(error: unknown, snapshot?: string): string {
  const value = error instanceof Error ? error.message : String(error);
  return (snapshot ? value.replaceAll(snapshot, '[pdf snapshot]') : value).slice(0, 800);
}
async function boundedPdfBytes(filePath: string): Promise<Buffer> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > PDF_TEXT_MAX_OUTPUT_BYTES) throw new Error('PDF snapshot exceeds the 50 MiB source byte limit');
    chunks.push(value);
  }
  return Buffer.concat(chunks, bytes);
}
function metadataCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => execFile(command, args, { encoding: 'utf8', timeout: METADATA_TIMEOUT_MS, maxBuffer: METADATA_MAX_BYTES },
    (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
}
async function version(command: 'pdfinfo' | 'pdftotext'): Promise<string | null> {
  try {
    const output = await metadataCommand(command, ['-v']);
    const lines = `${output.stdout}\n${output.stderr}`.split(/\r?\n/).filter(line => new RegExp(`^${command} version [0-9][A-Za-z0-9.+_-]{0,79}$`).test(line.trim()));
    return lines.length === 1 ? lines[0].trim() : null;
  } catch { return null; }
}
async function pageCount(snapshot: string): Promise<PdfParseReceipt['pageCount']> {
  const metadata = metadataCommand('pdfinfo', [snapshot]).then(output => ({ output, error: null }), error => ({ output: null, error: error as unknown }));
  const [result, engineVersion] = await Promise.all([metadata, version('pdfinfo')]);
  try {
    if (!result.output) throw result.error;
    const output = result.output;
    const rows = output.stdout.split(/\r?\n/).filter(line => /^Pages\s*:/.test(line));
    const match = rows.length === 1 ? /^Pages:\s+([0-9]+)\s*$/.exec(rows[0]) : null;
    const count = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) throw new Error('Independent pdfinfo page count is missing, ambiguous or outside its bound');
    return { engine: 'pdfinfo', engineVersion, status: 'verified', count };
  } catch (error) { return { engine: 'pdfinfo', engineVersion, status: 'unavailable', reason: reason(error, snapshot) }; }
}
async function boundedMarkdown(filePath: string, dependencies: Dependencies): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(() => dependencies.parseToolkit(filePath, 'markdown')), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`PDF toolkit parser timed out after ${PDF_TEXT_TOOLKIT_TIMEOUT_MS}ms`)), PDF_TEXT_TOOLKIT_TIMEOUT_MS);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Receipt parsing reads an isolated immutable copy once. Metadata failure never
 * reruns parsing or rejects valid parsed text; unavailable binding stays explicit.
 * The legacy string facade retains its existing calls and routing separately. */
export async function parsePdfFileWithReceipt(filePath: string, format: 'text' | 'markdown', dependencies: Dependencies): Promise<ParsedFileWithReceipt> {
  let directory: string | undefined; let snapshot: string; let bytes: Buffer;
  try {
    bytes = await boundedPdfBytes(filePath);
    directory = await mkdtemp(path.join(os.tmpdir(), 'financebot-pdf-receipt-'));
    snapshot = path.join(directory, 'original.pdf');
    await writeFile(snapshot, bytes, { flag: 'wx', mode: 0o400 });
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    try { dependencies.logger.warn('PDF snapshot unavailable; parsing without a provenance receipt', { reason: reason(error) }); } catch { /* Logging cannot reject valid text. */ }
    return { text: await dependencies.parseUnbound(filePath, format) };
  }
  try {
    const attempts: PdfParseAttempt[] = [];
    let text: string; let successfulEngine: PdfParseAttempt['engine']; let actualFormat: PdfParseReceipt['actualFormat'];
    if (format === 'text') {
      text = await parsePdfTextNativeFirst(snapshot, { parseNative: dependencies.parseNative,
        parseToolkit: file => dependencies.parseToolkit(file, 'text'), logger: dependencies.logger,
        onAttempt: attempt => attempts.push({ ...attempt, ...(attempt.reason ? { reason: reason(attempt.reason, snapshot) } : {}) }) });
      successfulEngine = attempts.at(-1)!.engine;
      actualFormat = 'text';
    } else {
      const start = Date.now();
      try {
        text = await boundedMarkdown(snapshot, dependencies);
        successfulEngine = 'toolkit'; actualFormat = 'markdown';
        attempts.push({ engine: 'toolkit', outcome: 'succeeded', elapsedMs: Math.max(0, Date.now() - start) });
      } catch (error) {
        attempts.push({ engine: 'toolkit', outcome: 'failed', elapsedMs: Math.max(0, Date.now() - start), reason: reason(error, snapshot) });
        const nativeStart = Date.now();
        try {
          text = await boundedText(snapshot, dependencies.parseNative, 'Native', PDF_TEXT_NATIVE_TIMEOUT_MS);
          successfulEngine = 'poppler-pdftotext'; actualFormat = 'text';
          attempts.push({ engine: 'poppler-pdftotext', outcome: 'succeeded', elapsedMs: Math.max(0, Date.now() - nativeStart) });
        } catch (nativeError) { throw Object.assign(new Error(reason(nativeError, snapshot)), { cause: nativeError }); }
      }
    }
    // Only the selected native parser can provide a verified form-feed map.
    // Toolkit success still records its actual engine without probing pdfinfo.
    const [count, engineVersion] = successfulEngine === 'poppler-pdftotext' ? await Promise.all([pageCount(snapshot), version('pdftotext')]) :
      [{ engine: 'pdfinfo' as const, engineVersion: null, status: 'unavailable' as const, reason: 'successful-parser-is-toolkit' }, dependencies.toolkitVersion];
    const receipt: PdfParseReceipt = { version: 'pdf-parse-receipt-v1', pdfSha256: hash(bytes), pdfBytes: bytes.length,
      routingPolicy: format === 'text' ? 'text-poppler-first-v2' : 'markdown-toolkit-first-v1', requestedFormat: format, actualFormat,
      successfulEngine, engineVersion, attempts, rawTextSha256: hash(text), rawTextBytes: Buffer.byteLength(text, 'utf8'), rawTextUtf16Length: text.length,
      pageCount: count, pageMap: buildPdfPageMap(text, count.status === 'verified' ? count.count : null, successfulEngine) };
    return { text, receipt };
  } finally { await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
}
