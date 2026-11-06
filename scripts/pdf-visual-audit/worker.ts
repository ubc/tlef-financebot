import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { installFileOnlyFence } from './fence';
import { VISUAL_LIMITS, validateNativeReceipt, nativePageSignals, operatorSignals, pdfjsTextSignals, prioritizePage } from './signals';
import type { NativeReceipt, PageLedgerRow, Pin } from './signals';

export interface WorkerInput { chapter: number; pdf: Pin; native: Pin; receipt: NativeReceipt }
export interface WorkerOutput { chapter: number; pdfjsPageCount: number | null; rows: PageLedgerRow[]; elapsedMs: number; peakRssBytes: number; networkAttempts: number; diagnostics?: string[]; error?: string }
interface PdfPage {
  getTextContent(): Promise<{ items: Array<{ str?: unknown }> }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getViewport(options: { scale: number }): { width: number; height: number };
  cleanup(): void;
}
interface PdfDocument { numPages: number; getPage(page: number): Promise<PdfPage>; destroy(): Promise<void> }
interface Pdfjs { OPS: Record<string, number>; getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument>; destroy(): Promise<void> } }
const readBounded = async (file: string, cap: number) => { assert((await stat(file)).size <= cap, 'visual-worker-input-cap'); return readFile(file); };

function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('visual-page-timeout')), milliseconds); })])
    .finally(() => clearTimeout(timer));
}

async function main(): Promise<void> {
  const fence = installFileOnlyFence();
  const started = performance.now();
  assert(process.argv.length === 3, 'visual-worker-input-argument');
  const input = JSON.parse((await readBounded(process.argv[2], VISUAL_LIMITS.jsonBytes)).toString('utf8')) as WorkerInput;
  const [pdf, native] = await Promise.all([readBounded(input.pdf.file, VISUAL_LIMITS.pdfBytes), readBounded(input.native.file, VISUAL_LIMITS.nativeBytes)]);
  const pages = validateNativeReceipt(pdf, native, input.receipt);
  const rows: PageLedgerRow[] = pages.map((text, index) => {
    const signals = nativePageSignals(text); const priority = prioritizePage(signals, null); const range = input.receipt.pageMap.pages[index];
    return { pageId: `chapter-${String(input.chapter).padStart(2, '0')}:page-${index + 1}`, chapter: input.chapter, physicalPage: index + 1,
      native: { ...signals, rawStart: range.rawStart, rawEnd: range.rawEnd, densityCharsPer1000Pt2: null }, inspectionStatus: 'unknown',
      pdfjsText: null, operators: null, dimensions: null, interpretation: 'unknown', review: 'unreviewed', diagnosticReasons: priority.reasons, priorityScore: priority.score };
  });
  let peakRssBytes = process.memoryUsage().rss;
  const memoryTimer = setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); if (peakRssBytes > 768 * 1024 * 1024) process.exit(71); }, 100);
  // Native ESM import avoids TypeScript's CommonJS require transform. Font/cmap
  // assets are the installed, pinned local package; no URL loading is permitted.
  const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Pdfjs>;
  const packageRoot = path.resolve(__dirname, '../../node_modules/pdfjs-dist');
  const diagnostics: string[] = [];
  const captureLog = (...values: unknown[]) => { if (diagnostics.length < 20) diagnostics.push(values.map(value => typeof value === 'string' ? value : '[non-string log]').join(' ').slice(0, 300)); };
  console.log = captureLog; console.warn = captureLog; console.error = captureLog;
  const output: WorkerOutput = { chapter: input.chapter, pdfjsPageCount: null, rows, elapsedMs: 0, peakRssBytes: 0, networkAttempts: 0, diagnostics };
  let document: PdfDocument | undefined;
  try {
    const pdfjs = await nativeImport(pathToFileURL(path.join(packageRoot, 'legacy/build/pdf.mjs')).href);
    document = await deadline(pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0, maxImageSize: VISUAL_LIMITS.imagePixels,
      isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: true,
      cMapUrl: path.join(packageRoot, 'cmaps') + path.sep, cMapPacked: true,
      standardFontDataUrl: path.join(packageRoot, 'standard_fonts') + path.sep }).promise, VISUAL_LIMITS.pageTimeoutMs);
    output.pdfjsPageCount = document.numPages;
    assert.equal(document.numPages, pages.length, 'visual-independent-page-count-mismatch');
    for (const row of rows) {
      let page: PdfPage | undefined;
      try {
        page = await deadline(document.getPage(row.physicalPage), VISUAL_LIMITS.pageTimeoutMs);
        const [text, operators] = await deadline(Promise.all([page.getTextContent(), page.getOperatorList()]), VISUAL_LIMITS.pageTimeoutMs);
        row.pdfjsText = pdfjsTextSignals(text.items);
        row.operators = operatorSignals(operators.fnArray, operators.argsArray, pdfjs.OPS);
        const viewport = page.getViewport({ scale: 1 });
        assert(viewport.width > 0 && viewport.height > 0 && Number.isFinite(viewport.width * viewport.height), 'visual-invalid-page-dimensions');
        row.dimensions = { widthPt: viewport.width, heightPt: viewport.height };
        row.native.densityCharsPer1000Pt2 = row.native.nonWhitespaceCharacters * 1000 / (viewport.width * viewport.height);
        row.inspectionStatus = 'inspected';
        const priority = prioritizePage(row.native, row.operators); row.priorityScore = priority.score; row.diagnosticReasons = priority.reasons;
      } catch (error) {
        row.error = error instanceof Error ? error.message.slice(0, 300) : 'visual-page-error';
        row.pdfjsText = null; row.operators = null; row.dimensions = null;
        row.diagnosticReasons = prioritizePage(row.native, null).reasons; row.priorityScore = prioritizePage(row.native, null).score;
        if (row.error === 'visual-page-timeout') { output.error = row.error; break; }
      } finally { page?.cleanup(); peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); }
    }
  } catch (error) { output.error = error instanceof Error ? error.message.slice(0, 300) : 'visual-document-error'; }
  finally {
    if (document) await deadline(document.destroy(), 1000).catch(() => undefined);
    clearInterval(memoryTimer);
  }
  output.elapsedMs = Math.round(performance.now() - started); output.peakRssBytes = peakRssBytes; output.networkAttempts = fence.attempts();
  assert.equal(output.networkAttempts, 0, 'visual-network-attempts');
  const serialized = JSON.stringify(output); assert(Buffer.byteLength(serialized) <= VISUAL_LIMITS.workerOutputBytes, 'visual-worker-result-cap');
  process.stdout.write(serialized);
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'visual-worker-failure'}\n`); process.exitCode = 1; });
