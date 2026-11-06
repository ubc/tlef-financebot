import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../..');
const BASELINE_SHA256 = 'f4417d81688ea5840c4755362dd8ce06211a87fd463e4ba05f6423af12101f9c';
const FIXTURE_SHA256 = 'b059a131aafdac081c181d2d298b99d0bb9b20fd9b272f58fdfb93b4d3a075eb';
const EXPECTED_NATIVE_BINARY_SHA256 = '04cd1509704c489cae360da50af4b16b6535a63f525de0923f39ea020ac0cfa5';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const PARSER_FILE = 'server/src/components/genai/document-parsing/index.ts';
const HELPER_FILE = 'server/src/components/genai/document-parsing/pdf-text-first.ts';
const READINESS_FILE = 'server/src/services/source-readiness.service.ts';
const CHUNKING_FILE = 'server/src/components/genai/chunking/index.ts';
const prohibitedRuntimeFile = (file: string) => file.startsWith(path.join(ROOT, 'server') + path.sep) || /(?:mongodb|qdrant|dotenv|ubc-genai-toolkit-llm|ubc-genai-toolkit-embeddings|openai)\//.test(file);

interface StoredChunk { index: number; text: string; characterCount: number }
interface Source {
  chapter: number; pages: number; publicPdf: string; pdfSha256: string; materialId: string; name: string; parsedCharacterCount: number;
  chunks: StoredChunk[]; manifest: { sourceTextHash: string; chunkCount: number; indexedCount: number; characterCount: number; parserVersion: string; chunkerVersion: string };
}
interface Fixture { version: number; fixtureKind: string; courseId: string; sourceBatchId: string; sources: Source[] }
interface Baseline {
  status: string; fixtureSha256: string; binary: { path: string; sha256: string; version: string };
  controls: Array<{ file: string; sha256: string }>; totals: { nativeParseMs: number };
  sources: Array<{ chapter: number; pdfSha256: string; nativeTextSha256: string; sourceTextHash: string; chunkCount: number }>;
}
interface Logger { debug(...values: unknown[]): void; info(...values: unknown[]): void; warn(...values: unknown[]): void; error(...values: unknown[]): void }
interface ToolkitParser { parse(input: { filePath: string }, format: 'text' | 'markdown'): Promise<{ content: string }> }
type ToolkitConstructor = new (config: { logger: Logger }) => ToolkitParser;
interface RecoveredFacade {
  parseFile(filePath: string, format?: 'text' | 'markdown'): Promise<string>;
  chunkText(text: string, sourceId: string): Promise<Array<{ text: string; metadata: { chunkNumber: number; characterLength: number; sourceDocumentMetadata: { sourceId: string } } }>>;
  hashSourceChunks(chunks: Array<{ index: number; text: string }>): string;
  MATERIAL_PARSER_VERSION: string;
}
export interface PdfPolicySources { parser: string; helper: string; readiness: string; chunking: string }

function declarations(source: string): Map<string, string> {
  const file = ts.createSourceFile('trusted-pdf-policy.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); const found = new Map<string, string>();
  const add = (name: string, value: string) => { assert(!found.has(name), `pdf-policy-duplicate-declaration:${name}`); found.set(name, value); };
  for (const statement of file.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) add(statement.name.text, statement.getText(file).replace(/^export\s+/, ''));
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) add(declaration.name.text, `const ${declaration.getText(file)};`);
    }
  }
  return found;
}

/** Reads the actual full facade/helper declarations without importing the
 * configured facade, environment, logger, database or provider modules. */
export function recoverPdfPolicyFacade(sources: PdfPolicySources, dependencies: {
  DocumentParsingModule: ToolkitConstructor; ChunkingModule: unknown; execFile: typeof execFile; logger: Logger; parserPackageVersion: string;
}): { facade: RecoveredFacade; selected: Array<{ file: string; name: string; text: string }> } {
  const parserFile = ts.createSourceFile(PARSER_FILE, sources.parser, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const importsHelper = parserFile.statements.some(statement => ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === './pdf-text-first' && statement.importClause?.namedBindings && !statement.importClause.isTypeOnly && ts.isNamedImports(statement.importClause.namedBindings) &&
    statement.importClause.namedBindings.elements.some(item => item.name.text === 'parsePdfTextNativeFirst' && !item.propertyName && !item.isTypeOnly));
  const parseDeclaration = declarations(sources.parser).get('parseFile');
  assert(importsHelper && parseDeclaration?.includes('parsePdfTextNativeFirst('), 'pdf-text-first-policy-not-wired: public parseFile must import and call the PDF text-first helper');
  const selected: Array<{ file: string; name: string; text: string }> = [];
  for (const [file, source, names] of [
    [HELPER_FILE, sources.helper, ['PDF_TEXT_NATIVE_TIMEOUT_MS', 'PDF_TEXT_TOOLKIT_TIMEOUT_MS', 'PDF_TEXT_MAX_OUTPUT_BYTES', 'reason', 'PdfTextExtractionError', 'boundedText', 'parsePdfTextNativeFirst']],
    [PARSER_FILE, sources.parser, ['parser', 'PDF_TOOLKIT_TIMEOUT_MS', 'PDFTOTEXT_TIMEOUT_MS', 'PDFTOTEXT_MAX_BUFFER_BYTES', 'parseWithToolkit', 'withTimeout', 'parsePdfWithPdftotext', 'parseFile']],
    [CHUNKING_FILE, sources.chunking, ['chunker', 'chunkText']],
    [READINESS_FILE, sources.readiness, ['MATERIAL_PARSER_VERSION', 'hashSourceChunks']],
  ] as const) {
    const found = declarations(source);
    for (const name of names) { const text = found.get(name); assert(text, `pdf-policy-missing-declaration:${name}`); selected.push({ file, name, text }); }
  }
  const compiled = ts.transpileModule(`${selected.map(item => item.text).join('\n')}\n({parseFile,chunkText,hashSourceChunks,MATERIAL_PARSER_VERSION});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, strict: true } }).outputText;
  const facade = vm.runInNewContext(compiled, { ...dependencies, parserPackage: { version: dependencies.parserPackageVersion },
    path, Buffer, createHash, setTimeout, clearTimeout }, { timeout: 1000 }) as RecoveredFacade;
  assert.equal(facade.MATERIAL_PARSER_VERSION, `toolkit-${dependencies.parserPackageVersion}:text-poppler-first-v2`, 'pdf-policy-parser-version-bump-required');
  return { facade, selected };
}

/** Pure routing checks execute the actual facade against distinguishable local
 * adapters. A helper mentioned in a comment/dead branch cannot pass acceptance. */
export async function assertPdfPolicyRouting(sources: PdfPolicySources, parserPackageVersion: string): Promise<void> {
  let nativeCalls = 0; const toolkitCalls: Array<{ filePath: string; format: string }> = []; let failNative = false; let failToolkit = false;
  class Toolkit {
    async parse(input: { filePath: string }, format: 'text' | 'markdown') {
      toolkitCalls.push({ filePath: input.filePath, format }); if (failToolkit) throw new Error('synthetic toolkit unavailable'); return { content: `toolkit:${format}` };
    }
  }
  class Chunking { async chunkDocuments() { return { chunks: [] }; } }
  const native = ((command: string, args: string[], options: { encoding: string; timeout: number; maxBuffer: number }, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    nativeCalls++; assert.equal(command, 'pdftotext'); assert.deepEqual(Array.from(args), ['-layout', '/synthetic/original.pdf', '-']);
    assert.equal(options.encoding, 'utf8'); assert.equal(options.timeout, 60000); assert.equal(options.maxBuffer, 50 * 1024 * 1024);
    callback(failNative ? new Error('synthetic native unavailable') : null, '  native exact\r\n\f', '');
  }) as unknown as typeof execFile;
  const quiet = () => undefined;
  const { facade } = recoverPdfPolicyFacade(sources, { DocumentParsingModule: Toolkit, ChunkingModule: Chunking, execFile: native,
    logger: { debug: quiet, info: quiet, warn: quiet, error: quiet }, parserPackageVersion });
  assert.equal(await facade.parseFile('/synthetic/original.pdf'), '  native exact\r\n\f'); assert.equal(nativeCalls, 1); assert.equal(toolkitCalls.length, 0);
  assert.equal(await facade.parseFile('/synthetic/original.pdf', 'text'), '  native exact\r\n\f'); assert.equal(nativeCalls, 2); assert.equal(toolkitCalls.length, 0);
  assert.equal(await facade.parseFile('/synthetic/original.pdf', 'markdown'), 'toolkit:markdown'); assert.equal(nativeCalls, 2);
  assert.equal(toolkitCalls.at(-1)?.format, 'markdown');
  assert.equal(await facade.parseFile('/synthetic/original.docx', 'text'), 'toolkit:text'); assert.equal(nativeCalls, 2);
  assert.equal(toolkitCalls.at(-1)?.filePath, '/synthetic/original.docx');
  failNative = true; assert.equal(await facade.parseFile('/synthetic/original.pdf', 'text'), 'toolkit:text'); assert.equal(nativeCalls, 3); assert.equal(toolkitCalls.length, 3);
  failNative = false; failToolkit = true;
  assert.equal(await facade.parseFile('/synthetic/original.pdf', 'markdown'), '  native exact\r\n\f'); assert.equal(nativeCalls, 4); assert.equal(toolkitCalls.length, 4);
  await assert.rejects(facade.parseFile('/synthetic/original.docx', 'text'), /synthetic toolkit unavailable/); assert.equal(nativeCalls, 4);
}

export function assertSafePdfAuditLog(line: string): void {
  assert(!/\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|(?:authorization|api[-_ ]?key|access[-_ ]?token)\s*["']?\s*[:=]\s*["']?\S+|(?:mongodb(?:\+srv)?|https?):\/\/[^/\s@]+:[^/\s@]+@/i.test(line), 'pdf-policy-credential-like-log-blocked');
}

function localCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => execFile(command, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 },
    (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2); const allowed = new Set(['--fixture', '--baseline', '--output']);
  assert(args.length % 2 === 0 && args.every((arg, index) => index % 2 !== 0 || allowed.has(arg)), 'Supply only --fixture, --baseline and a NEW --output directory.');
  assert(new Set(args.filter((_, index) => index % 2 === 0)).size === args.length / 2, 'pdf-policy-duplicate-argument');
  const option = (name: string, fallback: string) => path.resolve(ROOT, args.includes(name) ? args[args.indexOf(name) + 1]! : fallback);
  const fixturePath = option('--fixture', 'audit-results/quality-lab-2026-10-16-phase-two/upload-index/corpus-fixture.json');
  const baselinePath = option('--baseline', 'audit-results/quality-lab-2026-10-16-phase-two/pdf-parser-audit/results.json');
  const output = option('--output', 'audit-results/quality-lab-2026-10-16-phase-two/pdf-text-first-policy-acceptance');
  const phaseDirectory = await realpath(path.join(ROOT, 'audit-results/quality-lab-2026-10-16-phase-two')); const relativeOutput = path.relative(phaseDirectory, output);
  assert(relativeOutput && !relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput), 'pdf-policy-output-must-be-new-phase-two-directory');
  assert.equal(await realpath(path.dirname(output)), phaseDirectory, 'pdf-policy-output-must-be-a-new-direct-child');
  const [fixtureRaw, baselineRaw] = await Promise.all([readFile(fixturePath), readFile(baselinePath)]);
  assert.equal(sha256(fixtureRaw), FIXTURE_SHA256, 'pdf-policy-exact-ten-fixture-required'); assert.equal(sha256(baselineRaw), BASELINE_SHA256, 'pdf-policy-frozen-baseline-changed');
  const fixture = JSON.parse(fixtureRaw.toString('utf8')) as Fixture; const baseline = JSON.parse(baselineRaw.toString('utf8')) as Baseline;
  assert.equal(fixture.version, 1); assert.equal(fixture.fixtureKind, 'http-upload-real-index'); assert.equal(fixture.sources.length, 10);
  assert.equal(new Set(fixture.sources.map(source => source.materialId)).size, 10); assert.equal(fixture.sources.reduce((sum, source) => sum + source.chunks.length, 0), 671);
  assert.equal(baseline.status, 'completed-matching'); assert.equal(baseline.fixtureSha256, FIXTURE_SHA256);
  const sourceFiles = [PARSER_FILE, HELPER_FILE, READINESS_FILE, CHUNKING_FILE];
  const [parser, helper, readiness, chunking] = await Promise.all(sourceFiles.map(file => readFile(path.join(ROOT, file), 'utf8')));
  const sources = { parser: parser!, helper: helper!, readiness: readiness!, chunking: chunking! };
  const parserPackageFile = path.join(ROOT, 'node_modules/ubc-genai-toolkit-document-parsing/package.json');
  const parserPackage = JSON.parse(await readFile(parserPackageFile, 'utf8')) as { version: string };
  // This is deliberately before actual toolkit/native imports or output writes.
  // The currently unwired policy must fail a zero-call file-only preflight.
  await assertPdfPolicyRouting(sources, parserPackage.version);
  assert.deepEqual(Object.keys(createRequire(__filename).cache).filter(prohibitedRuntimeFile), [], 'pdf-policy-preloaded-runtime-module-forbidden');

  const baselineDirectory = path.dirname(baselinePath);
  const rawNativeFiles = fixture.sources.map(source => path.join(baselineDirectory, `chapter-${String(source.chapter).padStart(2, '0')}.native.txt`));
  const controlledFiles = [...sourceFiles.map(file => path.join(ROOT, file)), path.resolve(__filename), fixturePath, baselinePath, ...rawNativeFiles,
    ...fixture.sources.map(source => source.publicPdf), ...baseline.controls.map(control => control.file), parserPackageFile, path.join(ROOT, 'package-lock.json'),
    ...['ubc-genai-toolkit-document-parsing/dist/document-parsing-module.js', 'ubc-genai-toolkit-chunking/package.json',
      'ubc-genai-toolkit-chunking/dist/chunking-module.js', 'ubc-genai-toolkit-chunking/dist/providers/recursive-character-provider.js',
      'langchain/package.json', '@langchain/textsplitters/package.json'].map(file => path.join(ROOT, 'node_modules', file))];
  const controls = await Promise.all([...new Set(controlledFiles)].map(async file => { const bytes = await readFile(file); return { file, bytes: bytes.length, sha256: sha256(bytes) }; }));
  for (const [index, source] of [sources.parser, sources.helper, sources.readiness, sources.chunking].entries()) {
    assert.equal(sha256(source), controls.find(control => control.file === path.join(ROOT, sourceFiles[index]!))!.sha256, 'pdf-policy-source-read-race');
  }
  for (const [index, source] of fixture.sources.entries()) {
    assert.equal(controls.find(control => control.file === source.publicPdf)!.sha256, source.pdfSha256);
    const old = baseline.sources.find(row => row.chapter === source.chapter); assert(old && old.pdfSha256 === source.pdfSha256 && old.chunkCount === source.chunks.length && old.sourceTextHash === source.manifest.sourceTextHash);
    assert.equal(sha256(await readFile(rawNativeFiles[index]!)), old.nativeTextSha256, 'pdf-policy-retained-native-output-drift');
  }
  for (const file of [CHUNKING_FILE, 'server/src/services/materials.service.ts', 'package-lock.json',
    ...baseline.controls.filter(control => control.file.startsWith(path.join(ROOT, 'node_modules') + path.sep)).map(control => path.relative(ROOT, control.file))]) {
    const old = baseline.controls.find(control => control.file === path.join(ROOT, file)); assert(old, `pdf-policy-baseline-control-missing:${file}`);
    assert.equal(sha256(await readFile(old.file)), old.sha256, `pdf-policy-unrelated-baseline-code-changed:${file}`);
  }
  const binary = await realpath((await localCommand('/usr/bin/which', ['pdftotext'])).stdout.trim()); assert(path.isAbsolute(binary));
  const binarySha256 = sha256(await readFile(binary)); assert.equal(binarySha256, EXPECTED_NATIVE_BINARY_SHA256); assert.equal(binarySha256, baseline.binary.sha256);
  const version = await localCommand(binary, ['-v']);
  await mkdir(output, { recursive: false }); const startedAt = new Date().toISOString();
  const forbidden: string[] = []; const originalConnect = net.Socket.prototype.connect; const originalFetch = globalThis.fetch;
  const originalConsole = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
  const logs: Array<{ level: string; message: string; metadataOmitted: boolean }> = []; let credentialLikeLogBlocked = false;
  const captureLog = (level: string, values: unknown[]) => {
    // Never serialize SDK configuration, arbitrary metadata, Error causes or
    // environment objects. Even a credential-like string is withheld entirely.
    try { for (const value of values) if (typeof value === 'string') assertSafePdfAuditLog(value); }
    catch { credentialLikeLogBlocked = true; return; }
    logs.push({ level, message: typeof values[0] === 'string' ? values[0].slice(0, 1000) : '[non-string log value omitted]', metadataOmitted: values.length > 1 || typeof values[0] !== 'string' });
  };
  for (const level of Object.keys(originalConsole) as Array<keyof typeof originalConsole>) console[level] = (...values: unknown[]) => captureLog(level, values);
  net.Socket.prototype.connect = function () { forbidden.push('net.Socket.connect'); throw new Error('pdf-policy-network-forbidden'); } as typeof originalConnect;
  globalThis.fetch = (async () => { forbidden.push('fetch'); throw new Error('pdf-policy-network-forbidden'); }) as typeof fetch;
  const load = createRequire(__filename); const beforeModules = new Set(Object.keys(load.cache));
  const moduleApi = load('node:module') as { _load(request: string, parent?: { filename?: string }, isMain?: boolean): unknown };
  const originalLoad = moduleApi._load;
  moduleApi._load = function (request, parent, isMain) {
    const resolved = request.startsWith('.') && parent?.filename ? path.resolve(path.dirname(parent.filename), request) : request;
    if (resolved.startsWith(path.join(ROOT, 'server') + path.sep) || /^(?:mongodb|dotenv|openai|ubc-genai-toolkit-llm|ubc-genai-toolkit-embeddings|@qdrant\/js-client-rest)(?:\/|$)/.test(request)) {
      forbidden.push('forbidden-runtime-module-import'); throw new Error('pdf-policy-runtime-module-forbidden');
    }
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
  };
  const nativeCalls: Array<{ file: string; command: string; executedBinary: string; args: string[]; timeout: number; maxBuffer: number }> = [];
  const nativeOutputs: Array<{ stdout: string; stderr: string; completed: boolean; failed: boolean }> = [];
  const toolkitCalls: Array<{ filePath: string; format: string }> = []; const rows: Array<Record<string, unknown> & { chapter: number; parserOnlyMs: number; chunkMs: number; chunks: number; exact: boolean }> = [];
  let error: string | null = null; let selected: Array<{ file: string; name: string; text: string }> = [];
  let runtimeCode: Array<{ file: string; bytes: number; sha256: string }> = [];
  try {
    const { DocumentParsingModule } = load('ubc-genai-toolkit-document-parsing') as { DocumentParsingModule: ToolkitConstructor };
    const { ChunkingModule } = load('ubc-genai-toolkit-chunking') as { ChunkingModule: unknown };
    class TracedToolkit extends DocumentParsingModule {
      override parse(input: { filePath: string }, format: 'text' | 'markdown'): Promise<{ content: string }> {
        toolkitCalls.push({ filePath: input.filePath, format }); throw new Error('pdf-policy-unexpected-toolkit-parse-blocked');
      }
    }
    const tracedExec = ((command: string, commandArgs: string[], options: { encoding: string; timeout: number; maxBuffer: number }, callback: unknown) => {
      assert.equal(command, 'pdftotext'); assert.equal(commandArgs.length, 3); assert.equal(commandArgs[0], '-layout'); assert.equal(commandArgs[2], '-');
      assert(fixture.sources.some(source => source.publicPdf === commandArgs[1]), 'pdf-policy-uncontrolled-native-input');
      assert.equal(options.encoding, 'utf8'); assert.equal(options.timeout, 60000); assert.equal(options.maxBuffer, 50 * 1024 * 1024);
      nativeCalls.push({ file: commandArgs[1]!, command, executedBinary: binary, args: Array.from(commandArgs), timeout: options.timeout, maxBuffer: options.maxBuffer });
      const nativeOutput = { stdout: '', stderr: '', completed: false, failed: false }; nativeOutputs.push(nativeOutput);
      const observeOutput = (caught: Error | null, stdout: string, stderr: string) => {
        Object.assign(nativeOutput, { stdout, stderr, completed: true, failed: Boolean(caught) });
        return Reflect.apply(callback as (...values: unknown[]) => unknown, undefined, [caught, stdout, stderr]);
      };
      // Resolve the requested executable once and pin the exact measured binary;
      // this prevents a later PATH mutation selecting different code.
      return Reflect.apply(execFile, undefined, [binary, commandArgs, options, observeOutput]);
    }) as unknown as typeof execFile;
    const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, (...values: unknown[]) => captureLog(level, values)])) as unknown as Logger;
    const recovered = recoverPdfPolicyFacade(sources, { DocumentParsingModule: TracedToolkit, ChunkingModule, execFile: tracedExec, logger, parserPackageVersion: parserPackage.version });
    selected = recovered.selected;
    runtimeCode = await Promise.all(Object.keys(load.cache).filter(file => !beforeModules.has(file)).map(async file => { const bytes = await readFile(file); return { file, bytes: bytes.length, sha256: sha256(bytes) }; }));
    for (const [index, source] of fixture.sources.entries()) {
      const beforeNative = nativeCalls.length; const beforeToolkit = toolkitCalls.length; const start = performance.now();
      const text = await recovered.facade.parseFile(source.publicPdf, 'text'); const parserOnlyMs = performance.now() - start;
      assert.equal(nativeCalls.length - beforeNative, 1, 'pdf-policy-one-native-parse-per-original-required');
      assert.equal(toolkitCalls.length - beforeToolkit, 0, 'pdf-policy-native-success-invoked-toolkit');
      assert(nativeOutputs[beforeNative]?.completed && !nativeOutputs[beforeNative]!.failed);
      assert(Buffer.from(text, 'utf8').equals(Buffer.from(nativeOutputs[beforeNative]!.stdout, 'utf8')), 'pdf-policy-facade-changed-native-bytes');
      const previousText = await readFile(rawNativeFiles[index]!); const rawBytesEqual = Buffer.from(text, 'utf8').equals(previousText);
      const chunkStart = performance.now(); const rawChunks = await recovered.facade.chunkText(text, source.name); const chunkMs = performance.now() - chunkStart;
      assert(rawChunks.every((chunk, position) => chunk.metadata.chunkNumber === position + 1 && chunk.metadata.characterLength === chunk.text.length && chunk.metadata.sourceDocumentMetadata.sourceId === source.name));
      const chunks = rawChunks.map((chunk, position) => ({ index: position, text: chunk.text, characterCount: chunk.text.length }));
      const exactChunks = chunks.length === source.chunks.length && chunks.every((chunk, position) => chunk.index === source.chunks[position]!.index && chunk.characterCount === source.chunks[position]!.characterCount && Buffer.from(chunk.text, 'utf8').equals(Buffer.from(source.chunks[position]!.text, 'utf8')));
      const sourceHash = recovered.facade.hashSourceChunks(chunks); const manifestMatches = sourceHash === source.manifest.sourceTextHash;
      const exact = rawBytesEqual && exactChunks && manifestMatches && text.length === source.parsedCharacterCount && chunks.length === source.manifest.chunkCount && chunks.length === source.manifest.indexedCount && chunks.reduce((sum, chunk) => sum + chunk.characterCount, 0) === source.manifest.characterCount;
      const base = `chapter-${String(source.chapter).padStart(2, '0')}`;
      await writeFile(path.join(output, `${base}.public-facade.txt`), text, { flag: 'wx' });
      await writeFile(path.join(output, `${base}.chunks.json`), JSON.stringify(chunks, null, 2) + '\n', { flag: 'wx' });
      rows.push({ chapter: source.chapter, materialId: source.materialId, pdfSha256: source.pdfSha256, parserOnlyMs, chunkMs, chunks: chunks.length, exact,
        rawBytesEqualToRetainedNative: rawBytesEqual, rawTextSha256: sha256(text), chunkBytesEqual: exactChunks, sourceTextHash: sourceHash, manifestMatches,
        parsedCharacters: text.length, oldStoredParserVersion: source.manifest.parserVersion, newParserPolicyVersion: recovered.facade.MATERIAL_PARSER_VERSION,
        nativeCalls: nativeCalls.length - beforeNative, toolkitCalls: toolkitCalls.length - beforeToolkit });
      assert(exact, `pdf-policy-output-difference:chapter-${source.chapter}`);
    }
    assert.equal(rows.length, 10); assert.equal(nativeCalls.length, 10); assert.equal(toolkitCalls.length, 0); assert.equal(credentialLikeLogBlocked, false); assert.deepEqual(forbidden, []);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Unknown PDF policy audit failure';
    try { assertSafePdfAuditLog(message); error = message; } catch { credentialLikeLogBlocked = true; error = 'pdf-policy-credential-like-error-blocked'; }
    process.exitCode = 1;
  } finally {
    moduleApi._load = originalLoad;
    net.Socket.prototype.connect = originalConnect; globalThis.fetch = originalFetch;
    for (const level of Object.keys(originalConsole) as Array<keyof typeof originalConsole>) console[level] = originalConsole[level];
  }
  const loadedModules = Object.keys(load.cache).filter(file => !beforeModules.has(file));
  const prohibitedModulesLoaded = loadedModules.filter(prohibitedRuntimeFile);
  if (prohibitedModulesLoaded.length || forbidden.length || credentialLikeLogBlocked) { error = 'pdf-policy-isolation-invariant-failed'; process.exitCode = 1; }
  let allControlledFilesUnchanged = true;
  for (const control of controls) if (sha256(await readFile(control.file)) !== control.sha256) allControlledFilesUnchanged = false;
  if (sha256(await readFile(binary)) !== binarySha256) allControlledFilesUnchanged = false;
  if (loadedModules.length !== runtimeCode.length || loadedModules.some(file => !runtimeCode.some(control => control.file === file))) allControlledFilesUnchanged = false;
  for (const control of runtimeCode) if (sha256(await readFile(control.file)) !== control.sha256) allControlledFilesUnchanged = false;
  if (!allControlledFilesUnchanged) { error = 'pdf-policy-controlled-file-changed'; process.exitCode = 1; }
  for (const [index, nativeOutput] of nativeOutputs.entries()) {
    await writeFile(path.join(output, `native-call-${index + 1}.stdout.txt`), nativeOutput.stdout, { flag: 'wx' });
    let stderr = nativeOutput.stderr;
    try { assertSafePdfAuditLog(stderr); } catch { credentialLikeLogBlocked = true; stderr = '[credential-like stderr withheld]'; error = 'pdf-policy-credential-like-stderr-blocked'; process.exitCode = 1; }
    await writeFile(path.join(output, `native-call-${index + 1}.stderr.txt`), stderr, { flag: 'wx' });
  }
  for (const file of sourceFiles) { const destination = path.join(output, 'code', file); await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, await readFile(path.join(ROOT, file)), { flag: 'wx' }); }
  await writeFile(path.join(output, 'declarations.json'), JSON.stringify(selected.map(item => ({ ...item, sha256: sha256(item.text) })), null, 2) + '\n', { flag: 'wx' });
  const receipt = { version: 1, status: error ? 'stopped' : 'completed-matching', startedAt, completedAt: new Date().toISOString(), error,
    command: ['node', '--import', 'tsx', 'scripts/quality-lab/audit-pdf-text-first-policy.ts', ...args],
    execution: 'Complete actual public parseFile/helper declarations recovered from trusted source and executed with the actual native subprocess and chunker. The actual toolkit constructor is supplied, but any toolkit parse attempt on these ten expected native successes is recorded and refused. Configured env/logger facades are not imported.',
    fixture: fixturePath, fixtureSha256: FIXTURE_SHA256, baseline: baselinePath, baselineSha256: BASELINE_SHA256,
    courseId: fixture.courseId, sourceBatchId: fixture.sourceBatchId, controls, runtimeCode, binary: { path: binary, sha256: binarySha256, version: (version.stdout + version.stderr).trim() },
    isolation: { providerCalls: 0, databaseCalls: 0, networkAttempts: forbidden, prohibitedModulesLoaded, loadedModuleFiles: loadedModules, credentialLikeLogBlocked,
      environmentModuleImported: prohibitedModulesLoaded.some(file => file.includes('/config/env')), unknownLogMetadataSerialized: false,
      fenceScope: 'JavaScript Node TCP/fetch and runtime module hooks; not an OS-level network sandbox for subprocesses.', allControlledFilesUnchanged },
    totals: { expectedFiles: 10, completedFiles: rows.length, expectedChunks: 671, observedChunks: rows.reduce((sum, row) => sum + row.chunks, 0),
      pages: fixture.sources.reduce((sum, source) => sum + source.pages, 0), parserOnlyMs: rows.reduce((sum, row) => sum + row.parserOnlyMs, 0),
      chunkMs: rows.reduce((sum, row) => sum + row.chunkMs, 0), nativeParses: nativeCalls.length, toolkitParses: toolkitCalls.length,
      baselineNativeParserOnlyMs: baseline.totals.nativeParseMs },
    nativeCalls: nativeCalls.map((call, index) => ({ ...call, completed: nativeOutputs[index]?.completed ?? false, failed: nativeOutputs[index]?.failed ?? null,
      stdoutSha256: nativeOutputs[index] ? sha256(nativeOutputs[index]!.stdout) : null, stderrSha256: nativeOutputs[index] ? sha256(nativeOutputs[index]!.stderr) : null })),
    toolkitCalls, sources: rows, logs,
    newIndexingPerformed: false, readinessChanged: false, saved: 0,
    limitations: ['Parser-only serial timings on warm local filesystem caches. No new ingestion, embedding, database indexing or readiness measurement occurred.',
      'No whole-ingestion latency improvement is inferred from the earlier multi-stage upload/index elapsed time.',
      'Exact equality is limited to these ten PDF text outputs and stored chunks. Broader extraction quality, diagrams, OCR and teacher coverage remain unmeasured.',
      'Markdown and non-PDF dispatch are checked with distinguishable injected adapters, rather than another real toolkit parse of every format.'] };
  await writeFile(path.join(output, 'results.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: receipt.status, output, totals: receipt.totals, providerCalls: 0, databaseCalls: 0 }));
}

if (require.main === module) void main().catch(error => { const message = error instanceof Error ? error.message : 'Unknown PDF policy preflight failure';
  try { assertSafePdfAuditLog(message); console.error(message); } catch { console.error('pdf-policy-credential-like-error-blocked'); } process.exitCode = 1; });
