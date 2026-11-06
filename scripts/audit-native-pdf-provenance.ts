import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import ts from 'typescript';
import { parsePdfTextNativeFirst } from '../server/src/components/genai/document-parsing/pdf-text-first';
import { parsePdfFileWithReceipt } from '../server/src/components/genai/document-parsing/pdf-file-receipt';
import { locatePdfChunk, projectPdfChunkLocation, validatePdfPageMapIdentity } from '../server/src/components/genai/document-parsing/pdf-provenance';
import type { ParsedFileWithReceipt } from '../server/src/types/source-provenance';

const root = path.resolve(__dirname, '..');
const fixtureFile = 'audit-results/quality-lab-2026-10-16-phase-two/upload-index/corpus-fixture.json';
const rawDirectory = 'audit-results/quality-lab-2026-10-16-phase-two/pdf-parser-audit';
const parserDirectory = 'server/src/components/genai/document-parsing';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
interface Chunk { index: number; text: string; characterCount: number }
interface Source { chapter: number; pages: number; publicPdf: string; pdfSha256: string; name: string; chunks: Chunk[]; manifest: { sourceTextHash: string } }
function declaration(source: string, name: string): string {
  const file = ts.createSourceFile('trusted-parser.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node.getText(file).replace(/^export\s+/, '');
    if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations) if (ts.isIdentifier(item.name) && item.name.text === name) return `const ${item.getText(file)};`;
  }
  throw new Error(`Missing trusted declaration: ${name}`);
}
async function command(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(binary, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 },
    (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  assert(args.length === 2 && args[0] === '--output', 'Use --output with a NEW repository audit-results directory.');
  const output = path.resolve(root, args[1]);
  assert(output.startsWith(path.join(root, 'audit-results') + path.sep), 'Output must stay under audit-results.');
  const files = [fixtureFile, 'scripts/audit-native-pdf-provenance.ts', `${parserDirectory}/index.ts`, `${parserDirectory}/pdf-text-first.ts`,
    `${parserDirectory}/pdf-file-receipt.ts`, `${parserDirectory}/pdf-provenance.ts`, 'server/src/types/source-provenance.ts',
    'server/src/components/genai/chunking/index.ts', 'server/src/services/source-readiness.service.ts', 'package-lock.json'];
  const raw = new Map(await Promise.all(files.map(async file => [file, await readFile(path.join(root, file))] as const)));
  const fixture = JSON.parse(raw.get(fixtureFile)!.toString('utf8')) as { sources: Source[] };
  assert.equal(fixture.sources.length, 10); assert.equal(fixture.sources.reduce((n, source) => n + source.chunks.length, 0), 671);
  const inputs = files.map(file => ({ file, sha256: sha(raw.get(file)!), bytes: raw.get(file)!.length }));
  const binaries = await Promise.all(['pdftotext', 'pdfinfo'].map(async name => {
    const file = await command('/usr/bin/which', [name]); const bytes = await readFile(file); return { name, file, sha256: sha(bytes) };
  }));
  const load = createRequire(__filename); let toolkitCalls = 0; let networkCalls = 0; let nativeCalls = 0;
  const originalFetch = globalThis.fetch; const originalConnect = net.Socket.prototype.connect;
  globalThis.fetch = (async () => { networkCalls++; throw new Error('Offline PDF audit forbids network requests'); }) as typeof fetch;
  net.Socket.prototype.connect = function () { networkCalls++; throw new Error('Offline PDF audit forbids socket connections'); } as typeof originalConnect;
  try {
    class Toolkit { async parse(): Promise<never> { toolkitCalls++; throw new Error('Native ten-file acceptance forbids toolkit fallback'); } }
    const { ChunkingModule } = load('ubc-genai-toolkit-chunking') as { ChunkingModule: unknown };
    const parserPackage = JSON.parse(await readFile(path.join(root, 'node_modules/ubc-genai-toolkit-document-parsing/package.json'), 'utf8')) as { version: string };
    const quiet = () => undefined;
    const tracedExec = ((...values: Parameters<typeof execFile>) => { nativeCalls++; return Reflect.apply(execFile, undefined, values); }) as typeof execFile;
    const parserSource = raw.get(`${parserDirectory}/index.ts`)!.toString('utf8');
    const chunkingSource = raw.get('server/src/components/genai/chunking/index.ts')!.toString('utf8');
    const readinessSource = raw.get('server/src/services/source-readiness.service.ts')!.toString('utf8');
    const code = [
      ...['parser', 'PDF_TOOLKIT_TIMEOUT_MS', 'PDFTOTEXT_TIMEOUT_MS', 'PDFTOTEXT_MAX_BUFFER_BYTES', 'parseWithToolkit', 'withTimeout', 'parsePdfWithPdftotext', 'parseFile', 'parseFileWithReceipt'].map(name => declaration(parserSource, name)),
      ...['chunker', 'chunkText'].map(name => declaration(chunkingSource, name)), declaration(readinessSource, 'hashSourceChunks'),
      '({parseFile,parseFileWithReceipt,chunkText,hashSourceChunks});',
    ].join('\n');
    const facade = vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText,
      { DocumentParsingModule: Toolkit, ChunkingModule, logger: { warn: quiet, debug: quiet, info: quiet, error: quiet }, parserPackage, execFile: tracedExec,
        parsePdfTextNativeFirst, parsePdfFileWithReceipt, path, Buffer, createHash, setTimeout, clearTimeout }, { timeout: 1000 }) as {
        parseFile(file: string): Promise<string>; parseFileWithReceipt(file: string): Promise<ParsedFileWithReceipt>;
        chunkText(text: string, name: string): Promise<Array<{ text: string }>>; hashSourceChunks(chunks: Chunk[]): string;
      };
    await mkdir(output, { recursive: false });
    const rows: Array<Record<string, unknown>> = [];
    for (const source of fixture.sources) {
      const pdf = await readFile(source.publicPdf); assert.equal(sha(pdf), source.pdfSha256);
      const retainedPath = path.join(root, rawDirectory, `chapter-${String(source.chapter).padStart(2, '0')}.native.txt`);
      const retained = await readFile(retainedPath);
      const before = nativeCalls; const plainStart = performance.now(); const plain = await facade.parseFile(source.publicPdf); const plainMs = performance.now() - plainStart;
      assert.equal(nativeCalls - before, 1);
      const enrichedStart = performance.now(); const parsed = await facade.parseFileWithReceipt(source.publicPdf); const receiptMs = performance.now() - enrichedStart;
      assert.equal(nativeCalls - before, 2, 'Enriched parsing repeated native extraction');
      assert.equal(parsed.text, plain); assert(Buffer.from(parsed.text).equals(retained)); assert(parsed.receipt);
      const receipt = parsed.receipt;
      assert.equal(receipt.pdfSha256, source.pdfSha256); assert.equal(receipt.pdfBytes, pdf.length);
      assert.equal(receipt.rawTextSha256, sha(retained)); assert.equal(receipt.rawTextUtf16Length, parsed.text.length);
      assert.equal(receipt.successfulEngine, 'poppler-pdftotext'); assert.equal(receipt.attempts.length, 1);
      assert(receipt.pageCount.status === 'verified'); assert.equal(receipt.pageCount.count, source.pages);
      assert(receipt.pageMap.status === 'verified'); assert(validatePdfPageMapIdentity(receipt.pageMap, receipt.rawTextSha256, parsed.text.length));
      const chunkStart = performance.now(); const chunked = await facade.chunkText(parsed.text, source.name); const chunkMs = performance.now() - chunkStart;
      const chunks = chunked.map((chunk, index) => ({ index, text: chunk.text, characterCount: chunk.text.length }));
      assert.deepEqual(JSON.parse(JSON.stringify(chunks)), source.chunks); assert.equal(facade.hashSourceChunks(chunks), source.manifest.sourceTextHash);
      const locateStart = performance.now();
      const locations = chunks.map(chunk => {
        const locator = locatePdfChunk(parsed.text, chunk.text, receipt.pageMap); assert(locator.status === 'verified', `Chunk ${chunk.index}: ${locator.status === 'unavailable' ? locator.reason : 'unknown'}`);
        const projection = projectPdfChunkLocation({ provenanceId: 'file-only-not-persisted', pdfSha256: receipt.pdfSha256, rawTextSha256: receipt.rawTextSha256,
          pageMapSha256: receipt.pageMap.status === 'verified' ? receipt.pageMap.sha256 : undefined, locator }, 0, chunk.text.length, chunk.text);
        assert.equal(projection.status, 'verified');
        return { chunkIndex: chunk.index, locator, fullRangeProjection: projection };
      });
      const locateMs = performance.now() - locateStart;
      rows.push({ chapter: source.chapter, name: source.name, pdf: { file: source.publicPdf, sha256: source.pdfSha256, bytes: pdf.length },
        retainedNative: { file: retainedPath, sha256: sha(retained) }, plainMs, receiptMs, measuredReceiptDeltaMs: receiptMs - plainMs, chunkMs, locateMs,
        rawBytesUnchanged: true, chunkTextsUnchanged: true, sourceTextHashUnchanged: true, chunks: chunks.length, receipt, locations });
      await writeFile(path.join(output, `chapter-${String(source.chapter).padStart(2, '0')}.json`), JSON.stringify(rows.at(-1), null, 2) + '\n', { flag: 'wx' });
    }
    assert.equal(toolkitCalls, 0); assert.equal(networkCalls, 0);
    for (const input of inputs) assert.equal(sha(await readFile(path.join(root, input.file))), input.sha256, `Audit input changed: ${input.file}`);
    const totals = { files: rows.length, pages: fixture.sources.reduce((n, source) => n + source.pages, 0), chunks: fixture.sources.reduce((n, source) => n + source.chunks.length, 0),
      plainMs: rows.reduce((n, row) => n + Number(row.plainMs), 0), receiptMs: rows.reduce((n, row) => n + Number(row.receiptMs), 0),
      locateMs: rows.reduce((n, row) => n + Number(row.locateMs), 0), nativeCalls, toolkitCalls, networkCalls, databaseCalls: 0, providerCalls: 0 };
    const result = { version: 1, status: 'completed', inputs, binaries, totals,
      exactRawTextAndChunksPreserved: true, allUniqueChunksLocated: true, files: rows.map(({ locations: _locations, ...row }) => row),
      limitations: ['The two API calls per file are the explicit old/new audit arms; enriched production parsing uses one native extraction, not two.',
        'Measured serial timings include OS cache/order effects and are not a general performance benchmark.',
        'Physical page location does not recover chart/table meaning or establish pedagogical coverage.',
        'No material, sidecar, run, model output, saved question or database record was created.'] };
    await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, ...totals }));
  } finally { globalThis.fetch = originalFetch; net.Socket.prototype.connect = originalConnect; }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
