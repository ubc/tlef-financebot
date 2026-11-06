import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import vm from 'node:vm';
import ts from 'typescript';

interface StoredChunk { index: number; text: string; characterCount: number }
interface Source {
  chapter: number; pages: number; publicPdf: string; pdfSha256: string; name: string; materialId: string;
  parsedCharacterCount: number; elapsedMs: number; chunks: StoredChunk[];
  manifest: { sourceTextHash: string; chunkCount: number; indexedCount: number; characterCount: number; parserVersion: string; chunkerVersion: string };
}
interface Fixture { version: number; fixtureKind: string; courseId: string; sourceBatchId: string; sources: Source[] }
interface ProductionFunctions {
  parsePdfWithPdftotext(filePath: string): Promise<string>;
  chunkText(text: string, sourceId: string): Promise<Array<{ text: string; metadata: { chunkNumber: number; characterLength: number; sourceDocumentMetadata: { sourceId: string } } }>>;
  hashSourceChunks(chunks: Array<{ index: number; text: string }>): string;
  PDF_TOOLKIT_TIMEOUT_MS: number;
}
interface LoggerEvent { level: string; message: string; metadata?: unknown }

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_FIXTURE = 'audit-results/quality-lab-2026-10-16-phase-two/upload-index/corpus-fixture.json';
const DEFAULT_OUTPUT = 'audit-results/quality-lab-2026-10-16-phase-two/pdf-parser-audit';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function declarations(source: string): Map<string, string> {
  const file = ts.createSourceFile('trusted-repository.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Map<string, string>();
  const add = (name: string, value: string) => { assert(!found.has(name), `Duplicate trusted declaration: ${name}`); found.set(name, value); };
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) add(statement.name.text, statement.getText(file).replace(/^export\s+/, ''));
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) add(declaration.name.text, `const ${declaration.getText(file)};`);
    }
  }
  return found;
}

function recoverProductionFunctions(parser: string, chunking: string, readiness: string, ChunkingModule: unknown) {
  const selected: Array<{ file: string; name: string; text: string }> = [];
  for (const [file, source, names] of [
    ['server/src/components/genai/document-parsing/index.ts', parser, ['PDF_TOOLKIT_TIMEOUT_MS', 'PDFTOTEXT_TIMEOUT_MS', 'PDFTOTEXT_MAX_BUFFER_BYTES', 'parsePdfWithPdftotext']],
    ['server/src/components/genai/chunking/index.ts', chunking, ['chunker', 'chunkText']],
    ['server/src/services/source-readiness.service.ts', readiness, ['hashSourceChunks']],
  ] as const) {
    const found = declarations(source);
    for (const name of names) { const text = found.get(name); assert(text, `Missing trusted declaration: ${name}`); selected.push({ file, name, text }); }
  }
  const body = `${selected.map(item => item.text).join('\n')}\n({parsePdfWithPdftotext,chunkText,hashSourceChunks,PDF_TOOLKIT_TIMEOUT_MS});`;
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, strict: true } }).outputText;
  const quiet = () => undefined;
  const functions = vm.runInNewContext(compiled, { execFile, ChunkingModule, createHash, Buffer,
    logger: { debug: quiet, info: quiet, warn: quiet, error: quiet } }, { timeout: 1000 }) as ProductionFunctions;
  return { functions, selected };
}

function recoverCurrentParser(source: string, DocumentParsingModule: unknown, events: LoggerEvent[]) {
  const names = ['parser', 'PDF_TOOLKIT_TIMEOUT_MS', 'PDFTOTEXT_TIMEOUT_MS', 'PDFTOTEXT_MAX_BUFFER_BYTES',
    'parseWithToolkit', 'withTimeout', 'parsePdfWithPdftotext', 'parseFile'];
  const found = declarations(source); const selected = names.map(name => { const text = found.get(name); assert(text, `Missing current parser declaration: ${name}`); return { name, text }; });
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, (message: string, metadata?: unknown) => events.push({ level, message, metadata })]));
  const compiled = ts.transpileModule(`${selected.map(item => item.text).join('\n')}\n({parseFile});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, strict: true } }).outputText;
  const functions = vm.runInNewContext(compiled, { DocumentParsingModule, execFile, path, logger, setTimeout, clearTimeout }, { timeout: 1000 }) as { parseFile(filePath: string, format: 'text'): Promise<string> };
  return { functions, declarations: selected.map(({ name, text }) => ({ name, sha256: sha256(text) })) };
}

function localCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => execFile(command, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 },
    (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
}

function firstMismatch(actual: StoredChunk[], expected: StoredChunk[]) {
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) {
    const a = actual[index]; const b = expected[index];
    if (!a || !b) return { chunk: index, kind: 'missing-chunk' };
    if (a.index !== b.index || a.characterCount !== b.characterCount) return { chunk: index, kind: 'index-or-character-count' };
    if (!Buffer.from(a.text, 'utf8').equals(Buffer.from(b.text, 'utf8'))) {
      const aBytes = Buffer.from(a.text, 'utf8'); const bBytes = Buffer.from(b.text, 'utf8');
      let byte = 0; while (byte < Math.min(aBytes.length, bBytes.length) && aBytes[byte] === bBytes[byte]) byte++;
      return { chunk: index, kind: 'text-bytes', byte, actualBytes: aBytes.length, expectedBytes: bBytes.length };
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2); const allowed = new Set(['--fixture', '--output']);
  assert(args.length % 2 === 0 && args.every((arg, index) => index % 2 !== 0 || allowed.has(arg)), 'Use only --fixture PATH and --output PATH.');
  assert(new Set(args.filter((_, index) => index % 2 === 0)).size === args.length / 2, 'Duplicate arguments are forbidden.');
  const option = (name: string, fallback: string) => path.resolve(ROOT, args[args.indexOf(name) + 1] && args.includes(name) ? args[args.indexOf(name) + 1]! : fallback);
  const fixturePath = option('--fixture', DEFAULT_FIXTURE); const output = option('--output', DEFAULT_OUTPUT);
  assert(output.startsWith(path.join(ROOT, DEFAULT_OUTPUT)) && !output.includes('..'), 'Output must be in the new PDF parser audit directory.');
  await mkdir(output, { recursive: false });
  const startedAt = new Date().toISOString();
  const fixtureRaw = await readFile(fixturePath); const fixture = JSON.parse(fixtureRaw.toString('utf8')) as Fixture;
  assert.equal(fixture.version, 1); assert.equal(fixture.fixtureKind, 'http-upload-real-index'); assert.equal(fixture.sources.length, 10);
  assert.equal(new Set(fixture.sources.map(source => source.materialId)).size, 10);
  assert.equal(fixture.sources.reduce((sum, source) => sum + source.chunks.length, 0), 671);
  const inputPaths = [fixturePath, ...fixture.sources.map(source => path.resolve(source.publicPdf))];
  const codePaths = ['server/src/components/genai/document-parsing/index.ts', 'server/src/components/genai/chunking/index.ts',
    'server/src/services/source-readiness.service.ts', 'server/src/services/materials.service.ts', 'scripts/quality-lab/audit-pdf-parser.ts',
    'node_modules/ubc-genai-toolkit-document-parsing/package.json', 'node_modules/ubc-genai-toolkit-document-parsing/dist/document-parsing-module.js',
    'node_modules/@opendocsg/pdf2md/package.json', 'node_modules/ubc-genai-toolkit-chunking/package.json',
    'node_modules/ubc-genai-toolkit-chunking/dist/chunking-module.js', 'node_modules/ubc-genai-toolkit-chunking/dist/providers/recursive-character-provider.js',
    'node_modules/langchain/package.json', 'node_modules/@langchain/textsplitters/package.json', 'package-lock.json'].map(file => path.join(ROOT, file));
  const controlledPaths = [...new Set([...inputPaths, ...codePaths])];
  const controls = await Promise.all(controlledPaths.map(async file => { const bytes = await readFile(file); return { file, bytes: bytes.length, sha256: sha256(bytes) }; }));
  for (const source of fixture.sources) assert.equal(controls.find(control => control.file === path.resolve(source.publicPdf))!.sha256, source.pdfSha256);
  const code = await Promise.all(codePaths.slice(0, 3).map(file => readFile(file, 'utf8')));
  const binary = (await localCommand('/usr/bin/which', ['pdftotext'])).stdout.trim(); assert(path.isAbsolute(binary));
  const binarySha256 = sha256(await readFile(binary)); const version = await localCommand(binary, ['-v']);

  // Only local package code and selected trusted declarations run. The production
  // facades (which initialize env/logger/parser/DB) are deliberately never imported.
  const forbidden: string[] = []; const originalConnect = net.Socket.prototype.connect; const originalFetch = globalThis.fetch;
  net.Socket.prototype.connect = function () { forbidden.push('net.Socket.connect'); throw new Error('pdf-audit-network-forbidden'); } as typeof originalConnect;
  globalThis.fetch = (async () => { forbidden.push('fetch'); throw new Error('pdf-audit-network-forbidden'); }) as typeof fetch;
  const load = createRequire(__filename); const beforeModules = new Set(Object.keys(load.cache));
  try {
    const { ChunkingModule } = load('ubc-genai-toolkit-chunking') as { ChunkingModule: unknown };
    const recovered = recoverProductionFunctions(code[0]!, code[1]!, code[2]!, ChunkingModule);
    for (const item of recovered.selected) await writeFile(path.join(output, `declaration-${item.name}.ts.txt`), item.text + '\n', { flag: 'wx' });
    const rows = [];
    for (const source of fixture.sources) {
      const start = performance.now(); const text = await recovered.functions.parsePdfWithPdftotext(source.publicPdf); const parseMs = performance.now() - start;
      const chunkStart = performance.now(); const rawChunks = await recovered.functions.chunkText(text, source.name); const chunkMs = performance.now() - chunkStart;
      assert(rawChunks.every((chunk, index) => chunk.metadata.chunkNumber === index + 1 && chunk.metadata.characterLength === chunk.text.length && chunk.metadata.sourceDocumentMetadata.sourceId === source.name));
      const chunks = rawChunks.map((chunk, index) => ({ index, text: chunk.text, characterCount: chunk.text.length }));
      const actualHash = recovered.functions.hashSourceChunks(chunks); const expectedHash = recovered.functions.hashSourceChunks(source.chunks);
      const mismatch = firstMismatch(chunks, source.chunks);
      const base = `chapter-${String(source.chapter).padStart(2, '0')}`;
      await writeFile(path.join(output, `${base}.native.txt`), text, { flag: 'wx' });
      await writeFile(path.join(output, `${base}.chunks.json`), JSON.stringify(chunks, null, 2) + '\n', { flag: 'wx' });
      const row = { chapter: source.chapter, materialId: source.materialId, name: source.name, pages: source.pages,
        pdf: source.publicPdf, pdfSha256: source.pdfSha256, parseMs, chunkMs, nativeUtf8Bytes: Buffer.byteLength(text, 'utf8'), nativeTextSha256: sha256(text),
        parsedCharacterCount: text.length, recordedParsedCharacterCount: source.parsedCharacterCount, parsedCharacterCountMatches: text.length === source.parsedCharacterCount,
        rawTextByteEqualityToPriorParse: null, priorRawParsedTextRetained: false,
        chunkCount: chunks.length, expectedChunkCount: source.chunks.length, firstMismatch: mismatch, chunkBytesEqual: mismatch === null,
        sourceTextHash: actualHash, recordedChunksHash: expectedHash, manifestHash: source.manifest.sourceTextHash,
        chunkAndManifestHashesMatch: actualHash === expectedHash && actualHash === source.manifest.sourceTextHash,
        chunkCharacterCount: chunks.reduce((sum, chunk) => sum + chunk.characterCount, 0), manifest: source.manifest,
        recordedWholeIngestionMs: source.elapsedMs, recordedWholeIngestionIncludes: 'Primary parse/fallback, chunking, local embedding, DB publication and Qdrant verification; not a parser-only baseline.',
        chunks: chunks.map(chunk => ({ index: chunk.index, utf8Bytes: Buffer.byteLength(chunk.text, 'utf8'), characterCount: chunk.characterCount, sha256: sha256(chunk.text) })) };
      rows.push(row);
      console.log(JSON.stringify({ chapter: source.chapter, parseMs: Number(parseMs.toFixed(2)), chunkMs: Number(chunkMs.toFixed(2)), chunks: chunks.length, exactChunks: row.chunkBytesEqual, manifestMatches: row.chunkAndManifestHashesMatch }));
    }
    const loggerEvents: LoggerEvent[] = [];
    const { DocumentParsingModule } = load('ubc-genai-toolkit-document-parsing') as { DocumentParsingModule: unknown };
    const currentParser = recoverCurrentParser(code[0]!, DocumentParsingModule, loggerEvents);
    const currentComparisons = [];
    for (const source of fixture.sources.filter(source => [2, 3].includes(source.chapter))) {
      const eventStart = loggerEvents.length; const start = performance.now();
      const text = await currentParser.functions.parseFile(source.publicPdf, 'text'); const currentPolicyParseMs = performance.now() - start;
      const nativeRow = rows.find(row => row.chapter === source.chapter)!;
      const nativeText = await readFile(path.join(output, `chapter-${String(source.chapter).padStart(2, '0')}.native.txt`));
      const currentRawChunks = await recovered.functions.chunkText(text, source.name);
      const currentChunks = currentRawChunks.map((chunk, index) => ({ index, text: chunk.text, characterCount: chunk.text.length }));
      const events = loggerEvents.slice(eventStart);
      const comparison = { chapter: source.chapter, currentPolicyParseMs, nativeOnlyParseMs: nativeRow.parseMs,
        sameRunDifferenceMs: currentPolicyParseMs - nativeRow.parseMs, rawParsedUtf8Bytes: Buffer.byteLength(text, 'utf8'), rawParsedTextSha256: sha256(text),
        exactRawTextEqualsNative: Buffer.from(text, 'utf8').equals(nativeText),
        exactChunksEqualStored: firstMismatch(currentChunks, source.chunks) === null,
        sourceTextHash: recovered.functions.hashSourceChunks(currentChunks),
        observedPrimaryTimeout: events.some(event => event.level === 'warn' && event.message === 'Primary PDF parser failed; falling back to pdftotext' &&
          typeof event.metadata === 'object' && event.metadata !== null && 'reason' in event.metadata && event.metadata.reason === `PDF toolkit parser timed out after ${recovered.functions.PDF_TOOLKIT_TIMEOUT_MS}ms`),
        loggerEvents: events };
      currentComparisons.push(comparison);
      await writeFile(path.join(output, `chapter-${String(source.chapter).padStart(2, '0')}.current-policy.txt`), text, { flag: 'wx' });
      await writeFile(path.join(output, `chapter-${String(source.chapter).padStart(2, '0')}.current-policy-chunks.json`), JSON.stringify(currentChunks, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify({ currentPolicyComparison: comparison }));
    }
    assert.equal(currentComparisons.length, 2);
    const loadedModules = Object.keys(load.cache).filter(file => !beforeModules.has(file));
    const productionModulesLoaded = loadedModules.filter(file => file.startsWith(path.join(ROOT, 'server')) || /(?:mongodb|qdrant|ubc-genai-toolkit-llm)\//.test(file));
    assert.deepEqual(productionModulesLoaded, []); assert.deepEqual(forbidden, []);
    for (const control of controls) assert.equal(sha256(await readFile(control.file)), control.sha256, `Changed controlled file: ${control.file}`);
    assert.equal(sha256(await readFile(binary)), binarySha256);
    const allEqual = rows.every(row => row.chunkBytesEqual && row.chunkAndManifestHashesMatch && row.parsedCharacterCountMatches && row.chunkCount === row.manifest.chunkCount && row.chunkCount === row.manifest.indexedCount && row.chunkCharacterCount === row.manifest.characterCount) &&
      currentComparisons.every(row => row.exactRawTextEqualsNative && row.exactChunksEqualStored);
    const totals = { files: rows.length, pages: rows.reduce((sum, row) => sum + row.pages, 0), chunks: rows.reduce((sum, row) => sum + row.chunkCount, 0),
      nativeParseMs: rows.reduce((sum, row) => sum + row.parseMs, 0), chunkMs: rows.reduce((sum, row) => sum + row.chunkMs, 0),
      minNativeParseMs: Math.min(...rows.map(row => row.parseMs)), maxNativeParseMs: Math.max(...rows.map(row => row.parseMs)),
      recordedWholeIngestionMs: rows.reduce((sum, row) => sum + row.recordedWholeIngestionMs, 0), allChunkBytesAndHashesEqual: allEqual };
    const receipt = { version: 1, status: allEqual ? 'completed-matching' : 'completed-mismatch', startedAt, completedAt: new Date().toISOString(),
      command: ['node', '--import', 'tsx', 'scripts/quality-lab/audit-pdf-parser.ts', ...args], fixture: fixturePath, fixtureSha256: sha256(fixtureRaw),
      courseId: fixture.courseId, sourceBatchId: fixture.sourceBatchId, benchmark: 'One serial local pdftotext -layout pass per exact PDF, then actual AST-recovered production chunker and source chunk hash.',
      binary: { path: binary, sha256: binarySha256, version: (version.stdout + version.stderr).trim() }, node: process.version,
      primaryToolkitTimeoutMs: recovered.functions.PDF_TOOLKIT_TIMEOUT_MS, primaryParserExecutedByAudit: true,
      actualPrimaryTimeoutCountInOriginalTenFileIngestion: null, actualPrimaryTimeoutCountInTwoFileAudit: currentComparisons.filter(row => row.observedPrimaryTimeout).length,
      savedTimeoutMsMeasuredForOriginalTenFileIngestion: null, currentPolicyComparisons: currentComparisons,
      conditionalAvoidableTimerWaitMsIfAllTenTimedOut: fixture.sources.length * recovered.functions.PDF_TOOLKIT_TIMEOUT_MS,
      limitations: ['Recorded manifests do not identify per-file primary/fallback success, and original parsed text bytes were not retained.',
        'Matching chunks and parsed character counts establish this ten-file chunk-boundary result, not prior raw-parse byte equality or a guarantee for other PDFs/formats.',
        'Native timing is one local filesystem-warm serial pass, not a controlled production latency experiment. Recorded ingestion elapsed time includes embeddings and persistence.',
        'Toolkit-first timeout uses Promise.race and does not cancel the underlying primary parser. Two new bounded current-policy attempts were measured; parser policy is unchanged.',
        'Two-file current-policy/native timing differences are serial observations, not randomized causal estimates for all PDFs.'],
      controls, declarations: recovered.selected.map(({ file, name, text }) => ({ file, name, sha256: sha256(text) })), currentParserDeclarations: currentParser.declarations,
      isolation: { providerCalls: 0, databaseCalls: 0, apiCalls: 0, forbiddenNetworkAttempts: forbidden, productionModulesLoaded,
        newlyLoadedModuleFiles: loadedModules, allControlledFilesUnchanged: true }, totals, sources: rows };
    await writeFile(path.join(output, 'results.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, status: receipt.status, totals }));
    if (!allEqual) process.exitCode = 1;
  } finally { net.Socket.prototype.connect = originalConnect; globalThis.fetch = originalFetch; }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
