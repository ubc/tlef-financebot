import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { installFileOnlyFence } from './pdf-visual-audit/fence';
import { mapBounded, runBoundedChild } from './pdf-visual-audit/controller';
import { VISUAL_LIMITS, sha256, validateNativeReceipt, nativePageSignals, prioritizePage, assertAllPageAccounting, selectDiagnosticQueue } from './pdf-visual-audit/signals';
import type { NativeReceipt, Pin } from './pdf-visual-audit/signals';
import type { WorkerInput, WorkerOutput } from './pdf-visual-audit/worker';

const ROOT = path.resolve(__dirname, '..');
const MASTER = 'audit-results/native-pdf-provenance-2026-10-17/results.json';
const MASTER_SHA = 'd6aaf23ce856fa7f90f2dd5113d4d8acee01b6fa35689a33a6e8076b502d6f7c';
const R5 = 'audit-results/quality-lab-source-interpretation-2026-10-17-preflight-r5/controls.json';
const R5_SHA = 'b0c43059587eb7dd72790bf46607d59e3c9873981115a117a6ec8b08dfdad338';
const R5_ARCHIVE = 'audit-results/quality-lab-source-interpretation-2026-10-17-preflight-r5/code-at-preparation/manifest.json';
const R5_ARCHIVE_SHA = 'a1b9168aa3c160b26455106f01739557536d42452982de8fa6db65e0400bdd0b';
interface Source { chapter: number; name: string; pdf: Pin; retainedNative: Pin; chunks: number; receipt: NativeReceipt }
const CODE = ['scripts/audit-pdf-visual-obligations.ts', 'scripts/pdf-visual-audit/signals.ts', 'scripts/pdf-visual-audit/fence.ts',
  'scripts/pdf-visual-audit/controller.ts', 'scripts/pdf-visual-audit/worker.ts', 'tests/unit/pdf-visual-obligations.test.ts'];

async function boundedRead(file: string, cap: number): Promise<Buffer> {
  const info = await stat(file); assert(info.isFile() && info.size <= cap, `visual-file-input-cap:${file}`); return readFile(file);
}
async function pin(file: string): Promise<Pin> { const bytes = await boundedRead(file, 50 * 1024 * 1024); return { file, sha256: sha256(bytes), bytes: bytes.length }; }
async function verifyPins(pins: Pin[]): Promise<void> {
  for (const expected of pins) assert.equal((await pin(expected.file)).sha256, expected.sha256, `visual-pin-changed:${expected.file}`);
}
async function assetPins(directory: string): Promise<Pin[]> {
  const entries = await readdir(directory, { withFileTypes: true }); const output: Pin[] = [];
  assert(entries.length <= 200, 'visual-package-asset-file-cap');
  for (const entry of entries) { assert(entry.isFile(), 'visual-package-asset-must-be-regular'); output.push(await pin(path.join(directory, entry.name))); }
  return output;
}
function unknownWorker(source: Source, texts: string[], error: string): WorkerOutput {
  return { chapter: source.chapter, pdfjsPageCount: null, elapsedMs: 0, peakRssBytes: 0, networkAttempts: 0, error,
    rows: texts.map((text, index) => {
      const native = nativePageSignals(text); const range = source.receipt.pageMap.pages[index]; const priority = prioritizePage(native, null);
      return { pageId: `chapter-${String(source.chapter).padStart(2, '0')}:page-${index + 1}`, chapter: source.chapter, physicalPage: index + 1,
        native: { ...native, rawStart: range.rawStart, rawEnd: range.rawEnd, densityCharsPer1000Pt2: null }, inspectionStatus: 'unknown',
        pdfjsText: null, operators: null, dimensions: null, interpretation: 'unknown', review: 'unreviewed', diagnosticReasons: priority.reasons, priorityScore: priority.score, error };
    }) };
}

/** File-only execution. There is no provider, DB, application or classification
 * import and no claim that these operator signals understand a visual. */
async function main(): Promise<void> {
  const fence = installFileOnlyFence(); const started = performance.now();
  const args = process.argv.slice(2);
  assert(args.length === 2 && args[0] === '--output', 'Use --output with a NEW audit-results/pdf-visual-obligations-2026-10-17/run-* directory.');
  const output = path.resolve(ROOT, args[1]);
  assert(path.dirname(output) === path.join(ROOT, 'audit-results/pdf-visual-obligations-2026-10-17') && /^run-[a-z0-9-]+$/.test(path.basename(output)), 'visual-exclusive-output-scope');
  await mkdir(output, { recursive: false });
  let writtenBytes = 0;
  const save = async (relative: string, value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'; const bytes = Buffer.byteLength(text);
    assert(writtenBytes + bytes <= VISUAL_LIMITS.outputBytes, 'visual-total-output-cap');
    // Reserve before awaiting disk I/O: two workers may finish simultaneously.
    writtenBytes += bytes;
    const file = path.join(output, relative); await writeFile(file, text, { flag: 'wx' }); return { file, sha256: sha256(text), bytes };
  };
  const failures: Array<{ stage: string; chapter?: number; error: string }> = [];
  try {
    const masterBytes = await boundedRead(path.join(ROOT, MASTER), VISUAL_LIMITS.jsonBytes);
    assert.equal(sha256(masterBytes), MASTER_SHA, 'visual-fixed-corpus-receipt-changed');
    const master = JSON.parse(masterBytes.toString('utf8')) as { files: Source[] };
    const r5Bytes = await boundedRead(path.join(ROOT, R5), VISUAL_LIMITS.jsonBytes);
    assert.equal(sha256(r5Bytes), R5_SHA, 'visual-r5-control-receipt-changed');
    const r5 = JSON.parse(r5Bytes.toString('utf8')) as { code: Pin[] };
    assert.equal(r5.code.length, 259, 'visual-r5-pin-denominator');
    const archiveBytes = await boundedRead(path.join(ROOT, R5_ARCHIVE), VISUAL_LIMITS.jsonBytes);
    assert.equal(sha256(archiveBytes), R5_ARCHIVE_SHA, 'visual-r5-archive-manifest-changed');
    const archive = JSON.parse(archiveBytes.toString('utf8')) as { files: Array<{ original: string; copy: string; sha256: string }> };
    assert.equal(archive.files.length, r5.code.length);
    const historicalPins = archive.files.map(entry => {
      assert.equal(entry.sha256, r5.code.find(code => code.file === path.join(ROOT, entry.original))?.sha256, 'visual-r5-archive-link');
      const file = path.resolve(ROOT, entry.copy);
      assert(file.startsWith(path.dirname(path.join(ROOT, R5_ARCHIVE)) + path.sep), 'visual-r5-archive-path');
      return { file, sha256: entry.sha256 };
    });
    await verifyPins(historicalPins);
    const sources = master.files; assert.equal(sources.length, VISUAL_LIMITS.files);
    assert.deepEqual(sources.map(source => source.chapter), [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    assert.equal(sources.reduce((sum, source) => sum + source.receipt.pageCount.count, 0), VISUAL_LIMITS.pages);
    assert.equal(sources.reduce((sum, source) => sum + source.chunks, 0), 671);
    const inputs: Pin[] = [{ file: path.join(ROOT, MASTER), sha256: sha256(masterBytes), bytes: masterBytes.length },
      { file: path.join(ROOT, R5), sha256: sha256(r5Bytes), bytes: r5Bytes.length },
      { file: path.join(ROOT, R5_ARCHIVE), sha256: sha256(archiveBytes), bytes: archiveBytes.length }];
    const nativePages = new Map<number, string[]>();
    for (const source of sources) {
      const id = String(source.chapter).padStart(2, '0');
      assert.equal(source.pdf.file, path.join(ROOT, `audit-results/generation-quality-corpus/chapter-${id}.pdf`));
      assert.equal(source.retainedNative.file, path.join(ROOT, `audit-results/quality-lab-2026-10-16-phase-two/pdf-parser-audit/chapter-${id}.native.txt`));
      const [pdf, native] = await Promise.all([boundedRead(source.pdf.file, VISUAL_LIMITS.pdfBytes), boundedRead(source.retainedNative.file, VISUAL_LIMITS.nativeBytes)]);
      assert.equal(sha256(pdf), source.pdf.sha256); assert.equal(sha256(native), source.retainedNative.sha256);
      nativePages.set(source.chapter, validateNativeReceipt(pdf, native, source.receipt));
      inputs.push({ ...source.pdf, bytes: pdf.length }, { ...source.retainedNative, bytes: native.length });
    }
    const code = await Promise.all(CODE.map(file => pin(path.join(ROOT, file))));
    const packageRoot = path.join(ROOT, 'node_modules/pdfjs-dist');
    const packageJson = JSON.parse((await boundedRead(path.join(packageRoot, 'package.json'), 65536)).toString('utf8')) as { version: string };
    assert.equal(packageJson.version, '4.10.38', 'visual-pdfjs-version-changed');
    const dependencyPins = await Promise.all(['package.json', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs'].map(file => pin(path.join(packageRoot, file))));
    dependencyPins.push(...await assetPins(path.join(packageRoot, 'cmaps')), ...await assetPins(path.join(packageRoot, 'standard_fonts')));
    await mkdir(path.join(output, 'code'), { recursive: false });
    for (const entry of code) await save(`code/${path.basename(entry.file)}`, (await boundedRead(entry.file, VISUAL_LIMITS.jsonBytes)).toString('utf8'));
    await save('inputs-and-code.json', { version: 'pdf-visual-obligations-pins-v1', inputs, code, dependencyPins,
      preservedR5: { state: 'historical-unexecuted-declaration; later task-demand production edits require a fresh declaration', receipt: inputs[1], archiveManifest: inputs[2], archivedFiles: historicalPins, originalPins: r5.code },
      runtime: { node: process.version, pdfjs: packageJson.version, platform: process.platform, architecture: process.arch }, limits: VISUAL_LIMITS });
    await save('reproduce.txt', `# File-only; no models, network, DB or app startup. Existing originals are read only.\n# Choose a new lowercase run directory; existing outputs are never overwritten.\nnode --require tsx/cjs scripts/audit-pdf-visual-obligations.ts --output audit-results/pdf-visual-obligations-2026-10-17/run-reproduction-01\n`);
    const files = await mapBounded(sources, VISUAL_LIMITS.concurrency, async source => {
      const id = String(source.chapter).padStart(2, '0');
      const input: WorkerInput = { chapter: source.chapter, pdf: source.pdf, native: source.retainedNative, receipt: source.receipt };
      const workerInput = await save(`chapter-${id}.worker-input.json`, input); const workerStarted = performance.now();
      let result: WorkerOutput;
      try {
        const child = await runBoundedChild(process.execPath, [`--max-old-space-size=${VISUAL_LIMITS.workerMemoryMiB}`, '--require', 'tsx/cjs', path.join(ROOT, 'scripts/pdf-visual-audit/worker.ts'), workerInput.file]);
        result = JSON.parse(child.stdout) as WorkerOutput;
        assert.equal(result.chapter, source.chapter); assert.equal(result.networkAttempts, 0); assertAllPageAccounting(result.rows, [{ chapter: source.chapter, pageCount: source.receipt.pageCount.count }]);
        // Rebind every row to the retained native bytes rather than trust a child
        // result that happens to have the right page count.
        for (const row of result.rows) {
          const expected = nativePageSignals(nativePages.get(source.chapter)![row.physicalPage - 1]);
          for (const [key, value] of Object.entries(expected)) assert.deepEqual(row.native[key as keyof typeof row.native], value);
        }
        if (child.stderr) await save(`chapter-${id}.worker-stderr.txt`, child.stderr.slice(0, 4000));
        if (result.error || result.rows.some(row => row.error)) failures.push({ stage: 'pdfjs-inspection', chapter: source.chapter, error: result.error ?? 'one-or-more-page-errors' });
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1500) : 'visual-worker-error';
        failures.push({ stage: 'worker', chapter: source.chapter, error: message }); result = unknownWorker(source, nativePages.get(source.chapter)!, message);
      }
      const ledger = await save(`chapter-${id}.pages.json`, { version: 'pdf-page-signal-ledger-v1', scope: 'operator-and-text-signals-only', source: input, ...result });
      const rows = result.rows;
      return { chapter: source.chapter, name: source.name, pdf: source.pdf, native: source.retainedNative, pageCount: source.receipt.pageCount.count,
        pdfjsPageCount: result.pdfjsPageCount, elapsedMs: Math.round(performance.now() - workerStarted), workerElapsedMs: result.elapsedMs,
        peakRssBytes: result.peakRssBytes, operatorInspectedPages: rows.filter(row => row.inspectionStatus === 'inspected').length,
        inspectionUnknownPages: rows.filter(row => row.inspectionStatus === 'unknown').length,
        nativeEmptyPages: rows.filter(row => row.native.blankNativeText).length, nativeFooterHeuristicPages: rows.filter(row => row.native.footerOnlyCandidate).length,
        nativeSparsePages: rows.filter(row => row.native.sparseNativeText).length,
        pagesWithRasterPaints: rows.filter(row => row.operators && row.operators.rasterImagePaints > 0).length,
        pagesWithVectorPaths: rows.filter(row => row.operators && row.operators.vectorPathConstructions > 0).length,
        interpretationUnknownPages: rows.length, reviewUnreviewedPages: rows.length, networkAttempts: result.networkAttempts, ledger, rows };
    });
    const rows = files.flatMap(file => file.rows); assertAllPageAccounting(rows, files);
    assert.equal(rows.length, VISUAL_LIMITS.pages); assert.equal(fence.attempts(), 0);
    await verifyPins([...inputs, ...code, ...dependencyPins, ...historicalPins]);
    const queue = selectDiagnosticQueue(rows).map(row => ({ ...row, pdf: sources.find(source => source.chapter === row.chapter)!.pdf,
      ledger: files.find(file => file.chapter === row.chapter)!.ledger }));
    const queuePin = await save('priority-queue.json', { version: 'pdf-visual-diagnostic-queue-v1', scope: 'diagnostic-priority-only',
      selection: { maximumPages: 6, maximumPerFile: 2, sort: 'priorityScore descending, chapter ascending, physicalPage ascending',
        scoring: { unknownOperators: 8, emptyNative: 4, footerHeuristic: 5, otherwiseSparseNative: 2, rasterPaints: 4, manyVectorSegments: 4, otherwiseVectorPaints: 1, eightNumericTokens: 2 } },
      selectedPages: queue.length, unselectedPages: rows.length - queue.length, pages: queue });
    const failurePin = await save('failures.json', { failures });
    const results = { version: 'pdf-visual-obligations-v1', status: failures.length ? 'partial' : 'completed', scope: 'file-only PDF operator/native-text signal inventory; no visual interpretation',
      totals: { expectedFiles: 10, expectedPages: 599, accountedFiles: files.length, accountedPages: rows.length,
        operatorInspectedPages: rows.filter(row => row.inspectionStatus === 'inspected').length, inspectionUnknownPages: rows.filter(row => row.inspectionStatus === 'unknown').length,
        interpretationUnknownPages: rows.length, reviewUnreviewedPages: rows.length, diagnosticQueuePages: queue.length, diagnosticUnselectedPages: rows.length - queue.length,
        nativeEmptyPages: rows.filter(row => row.native.blankNativeText).length, nativeFooterHeuristicPages: rows.filter(row => row.native.footerOnlyCandidate).length,
        pagesWithRasterPaints: rows.filter(row => row.operators && row.operators.rasterImagePaints > 0).length,
        pagesWithVectorPaths: rows.filter(row => row.operators && row.operators.vectorPathConstructions > 0).length },
      files: files.map(({ rows: _rows, ...file }) => file), priorityQueue: queuePin, failures: failurePin,
      boundaries: { parentNetworkAttempts: fence.attempts(), workerNetworkAttempts: files.reduce((sum, file) => sum + file.networkAttempts, 0),
        modelCalls: 0, embeddingCalls: 0, databaseCalls: 0, applicationCalls: 0, classificationCalls: 0 },
      integrity: { originalPdfAndNativeBytesUnchanged: true, retainedReceiptVerified: true, independentPageCountsAgree: files.every(file => file.pdfjsPageCount === file.pageCount),
        r5ArchivedFilesUnchanged: historicalPins.length, r5State: 'historical-unexecuted; current production is changing for task-demand', actualAuditCodeAndAssetsUnchanged: true },
      measurement: { elapsedMs: Math.round(performance.now() - started), outputBytesBeforeResults: writtenBytes, maximumWorkerRssBytes: Math.max(...files.map(file => file.peakRssBytes)), limits: VISUAL_LIMITS },
      limitations: ['Signals do not identify whether a visual is a table, chart, decorative image or pedagogically necessary.',
        'Native text, including a footer, and PDF.js text are presence/density signals, not interpreted source coverage.',
        'Every page remains interpretation unknown and review unreviewed. The six-page queue is diagnostic triage, not a six-page coverage claim.',
        'Raster paints and vector paths can coexist or be absent; neither implies that a generation model saw or understood the content.',
        'Memory is bounded by a 384 MiB JS heap, a 768 MiB RSS polling guard, per-page/file deadlines and output limits; OS/native allocations are not a cgroup hard limit.',
        'No OCR, page rendering, model interpretation, authoring permission, classification, source retrieval or runtime record changed.'] };
    const resultPin = await save('results.json', results); process.stdout.write(JSON.stringify({ ...resultPin, status: results.status, totals: results.totals, elapsedMs: results.measurement.elapsedMs }) + '\n');
  } catch (error) {
    failures.push({ stage: 'parent', error: error instanceof Error ? error.message : 'visual-parent-failure' });
    await save('terminal-failure.json', { failures, networkAttempts: fence.attempts(), elapsedMs: Math.round(performance.now() - started) }); throw error;
  }
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'visual-audit-failed'}\n`); process.exitCode = 1; });
