/** File-only by default. Root must review the declaration before --execute-local once.
 * Real native PDF ingest/Mongo/material HTTP; deterministic embedding/vector substitutes,
 * explicitly skipped classification, and forbidden model/job/remote boundaries. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire, Module } from 'node:module';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import type { Express, Request } from 'express';
import type * as ExpressModule from 'express';
import type * as MongoDriver from 'mongodb';
import type * as SupertestModule from 'supertest';
import type { Course, User, Material } from '../server/src/types/domain';
import type { MaterialChunkProvenance } from '../server/src/types/source-provenance';
import type * as EnvModule from '../server/src/config/env';
import type * as MongoModule from '../server/src/components/mongodb';
import type * as CollectionsModule from '../server/src/components/mongodb/collections';
import type * as AuthoringModule from '../server/src/services/authoring-commit.service';
import type * as MaterialsModule from '../server/src/services/materials.service';
import type * as RunsModule from '../server/src/services/content-runs.service';
import type * as ProvenanceModule from '../server/src/services/material-source-provenance.service';
import type * as ReadinessModule from '../server/src/services/source-readiness.service';
import type * as EvidenceModule from '../server/src/services/generation-evidence.service';
import type * as RoutesModule from '../server/src/routes/materials.routes';
import type * as ErrorModule from '../server/src/middleware/error-handler';

const ROOT = path.resolve(__dirname, '..');
const load = createRequire(__filename);
const CORPUS_FILE = 'audit-results/quality-lab-2026-10-16-phase-two/upload-index/corpus-fixture.json';
const CORPUS_SHA = 'b059a131aafdac081c181d2d298b99d0bb9b20fd9b272f58fdfb93b4d3a075eb';
const NATIVE_FILE = 'audit-results/native-pdf-provenance-2026-10-17/results.json';
const NATIVE_SHA = 'd6aaf23ce856fa7f90f2dd5113d4d8acee01b6fa35689a33a6e8076b502d6f7c';
const PREFIX = /^financebot_quality_smoke_pdf_provenance_[a-z0-9_]+$/;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const runtime = <T>(file: string): T => load(path.join(ROOT, file)) as T;
export interface PdfIngestArguments { database: string; output: string; executeLocal: boolean }
export interface PdfIngestAttempt { boundary: string; at: string }
interface ChunkFixture { index: number; text: string; characterCount: number }
export interface PdfIngestSource {
  chapter: number; pages: number; name: string; publicPdf: string; pdfSha256: string; size: number;
  chunks: ChunkFixture[]; manifest: { sourceTextHash: string; chunkCount: number };
}
interface NativeReceipt {
  status: string; totals: { files: number; pages: number; chunks: number };
  binaries: Array<{ name: string; file: string; sha256: string }>;
  files: Array<{ chapter: number; retainedNative: { file: string; sha256: string }; receipt: { pdfSha256: string; rawTextSha256: string } }>;
}
interface InputPin { file: string; sha256: string; bytes: number }
export interface PdfIngestOwnership {
  _id: 'exclusive-pdf-provenance-ingest-owner'; actor: string; database: string; createdAt: Date; noCleanup: true;
}

export function parsePdfIngestArguments(argv: string[]): PdfIngestArguments {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    assert(['--database', '--output', '--execute-local'].includes(key) && !(key in values) && value && !value.startsWith('--'), 'Unknown, duplicate or missing PDF-ingest argument.');
    values[key] = value;
  }
  assert(PREFIX.test(values['--database'] ?? ''), 'Use a fresh explicitly owned PDF provenance database.');
  assert(values['--output'], '--output is required.');
  const output = path.resolve(ROOT, values['--output']);
  assert(output.startsWith(path.join(ROOT, 'audit-results') + path.sep), 'Output must be a NEW audit-results directory.');
  assert(values['--execute-local'] === undefined || values['--execute-local'] === 'once', 'Only --execute-local once can start local services.');
  return { database: values['--database'], output, executeLocal: values['--execute-local'] === 'once' };
}
export function assertPdfIngestTarget(uri: string, configured: string, declared: string): void {
  const url = new URL(uri);
  assert(url.protocol === 'mongodb:' && url.hostname === '127.0.0.1' && url.port === '27029' && !url.username && !url.password
    && url.pathname === '/' && url.searchParams.getAll('directConnection').length === 1 && url.searchParams.get('directConnection') === 'true', 'Only credential-free direct loopback MongoDB 127.0.0.1:27029 is allowed.');
  assert(PREFIX.test(declared) && configured === declared, 'Configured Mongo database must match the declared owned target.');
}
export function pdfIngestSocketAllowed(host: string, port: number, httpPort?: number): boolean {
  return host === '127.0.0.1' && (port === 27029 || httpPort !== undefined && port === httpPort);
}
export async function claimPdfIngestDatabase(collection: { insertOne(record: PdfIngestOwnership): Promise<unknown> }, ownership: Omit<PdfIngestOwnership, '_id' | 'noCleanup'>): Promise<void> {
  await collection.insertOne({ ...ownership, _id: 'exclusive-pdf-provenance-ingest-owner', noCleanup: true });
}
export function validatePdfIngestCorpus(sources: PdfIngestSource[]): void {
  assert(Array.isArray(sources) && sources.length === 10, 'Exactly ten retained sources are required.');
  assert.equal(new Set(sources.map(source => source.chapter)).size, 10);
  assert.equal(sources.reduce((sum, source) => sum + source.pages, 0), 599);
  assert.equal(sources.reduce((sum, source) => sum + source.chunks.length, 0), 671);
  for (const source of sources) {
    assert(Number.isSafeInteger(source.pages) && source.pages > 0 && /^[a-f0-9]{64}$/.test(source.pdfSha256));
    assert(Number.isSafeInteger(source.size) && source.size > 0 && source.size <= 50 * 1024 * 1024);
    assert(source.publicPdf && source.name && source.manifest.chunkCount === source.chunks.length && /^[a-f0-9]{64}$/.test(source.manifest.sourceTextHash));
    assert(source.chunks.every((chunk, index) => chunk.index === index && typeof chunk.text === 'string' && !!chunk.text.trim() && chunk.characterCount === chunk.text.length));
  }
}
export function deterministicPdfIngestVectors(texts: string[]): number[][] {
  return texts.map(text => { const digest = createHash('sha256').update(text).digest(); return Array.from({ length: 4 }, (_, index) => digest.readUInt32BE(index * 4) / 0x100000000); });
}
function deny(attempts: PdfIngestAttempt[], boundary: string): never {
  attempts.push({ boundary, at: new Date().toISOString() }); throw new Error(`pdf-provenance-boundary-forbidden:${boundary}`);
}
function installFence(attempts: PdfIngestAttempt[]): { http(port: number): void; restore(): void } {
  let httpPort: number | undefined;
  const connect = net.Socket.prototype.connect, fetch = globalThis.fetch;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first as { host?: string; port?: string | number; path?: string } : { port: first, host: args[1] };
    const host = String(options.host ?? 'localhost'), port = Number(options.port);
    if ('path' in options && options.path || !pdfIngestSocketAllowed(host, port, httpPort)) return deny(attempts, `socket:${host}:${port}`);
    return Reflect.apply(connect, this, args) as net.Socket;
  } as typeof connect;
  globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || Number(url.port) === 27029 || !pdfIngestSocketAllowed(url.hostname, Number(url.port), httpPort)) return deny(attempts, `fetch:${url.hostname}:${url.port}`);
    return fetch(resource, options);
  };
  return { http: port => { assert(Number.isSafeInteger(port) && port > 0); httpPort = port; }, restore: () => { net.Socket.prototype.connect = connect; globalThis.fetch = fetch; } };
}
interface SubstitutionReceipt { boundary: string; items: number; identity?: string }
function installSubstitutions(attempts: PdfIngestAttempt[], substitutions: SubstitutionReceipt[]): () => void {
  const previous = new Map<string, NodeModule | undefined>();
  const denied = (boundary: string) => (..._args: unknown[]) => deny(attempts, boundary);
  const deniedObject = (boundary: string) => new Proxy({}, { get: (_value, key) => denied(`${boundary}.${String(key)}`) });
  const vectorCollections = new Set<string>();
  const fixtures: Array<[string, Record<string, unknown>]> = [
    ['server/src/components/genai/llm/index.ts', { completeJson: denied('llm.completeJson'), llm: deniedObject('llm'), withModelCallObserver: denied('llm.withModelCallObserver') }],
    ['server/src/components/genai/embeddings/index.ts', {
      embed: async (texts: string[]) => { assert(Array.isArray(texts) && texts.every(text => typeof text === 'string')); substitutions.push({ boundary: 'embedding.embed:deterministic-sha256-four-values', items: texts.length, identity: hash(JSON.stringify(texts)) }); return deterministicPdfIngestVectors(texts); },
      getEmbeddingDimension: async () => { substitutions.push({ boundary: 'embedding.dimension:synthetic-four', items: 1 }); return 4; },
      embedOne: denied('embedding.embedOne'), getEmbeddings: denied('embedding.getEmbeddings'),
    }],
    ['server/src/components/qdrant/index.ts', {
      ensureCollection: async (name: string, size: number) => { assert.equal(size, 4); vectorCollections.add(name); substitutions.push({ boundary: 'qdrant.ensureCollection:substitute', items: 1, identity: name }); },
      upsertPoints: async (name: string, points: Array<{ id: string; vector: number[] }>) => { assert(vectorCollections.has(name)); assert(points.every(point => point.id && point.vector.length === 4 && point.vector.every(Number.isFinite))); substitutions.push({ boundary: 'qdrant.upsertPoints:substitute', items: points.length, identity: hash(JSON.stringify(points)) }); },
      deletePointsByFilter: async (name: string) => { substitutions.push({ boundary: 'qdrant.deletePointsByFilter:substitute', items: 1, identity: name }); },
      qdrant: deniedObject('qdrant'), search: denied('qdrant.search'), collectionVectorSize: denied('qdrant.collectionVectorSize'), deleteCollectionIfExists: denied('qdrant.deleteCollectionIfExists'),
    }],
    ['server/src/components/jobs/index.ts', Object.fromEntries(['startJobs', 'defineJob', 'enqueueJob', 'scheduleRecurring', 'hasPendingJob', 'cancelJobsByDataIds', 'stopJobs'].map(name => [name, denied(`jobs.${name}`)]))],
    ['server/src/services/classification.service.ts', {
      classifyMaterial: async (id: MongoDriver.ObjectId) => { substitutions.push({ boundary: 'classification.classifyMaterial:explicitly-skipped', items: 1, identity: id.toHexString() }); },
      applyGeneratedHierarchy: denied('classification.applyGeneratedHierarchy'), resolveClassification: denied('classification.resolveClassification'), suggestHierarchy: denied('classification.suggestHierarchy'),
    }],
  ];
  for (const [relative, exports] of fixtures) {
    const file = load.resolve(path.join(ROOT, relative)); assert(!load.cache[file], 'Install every boundary before production runtime imports.');
    previous.set(file, load.cache[file]); const module = new Module(file); module.filename = file; module.loaded = true; module.exports = exports; load.cache[file] = module;
  }
  return () => { for (const [file, value] of previous) { if (value) load.cache[file] = value; else delete load.cache[file]; } };
}
async function pin(file: string): Promise<InputPin> {
  const bytes = await fs.readFile(file); return { file, sha256: hash(bytes), bytes: bytes.length };
}
async function codePins(): Promise<InputPin[]> {
  const files = ['scripts/verify-pdf-provenance-ingest.ts', 'package-lock.json'];
  const visit = async (directory: string): Promise<void> => {
    for (const item of await fs.readdir(path.join(ROOT, directory), { withFileTypes: true })) {
      const file = `${directory}/${item.name}`;
      if (item.isDirectory()) await visit(file);
      else if (item.isFile() && item.name.endsWith('.ts')) files.push(file);
      else if (item.isSymbolicLink()) throw new Error('Refuse symlinks in pinned server code.');
    }
  };
  await visit('server/src'); files.sort(); return Promise.all(files.map(file => pin(path.join(ROOT, file))));
}
async function inputs(): Promise<{ sources: PdfIngestSource[]; native: NativeReceipt; pins: InputPin[] }> {
  const corpus = await pin(path.join(ROOT, CORPUS_FILE)), nativePin = await pin(path.join(ROOT, NATIVE_FILE));
  assert.equal(corpus.sha256, CORPUS_SHA, 'Retained corpus receipt changed.'); assert.equal(nativePin.sha256, NATIVE_SHA, 'Retained native acceptance changed.');
  const sources = (JSON.parse(await fs.readFile(corpus.file, 'utf8')) as { sources: PdfIngestSource[] }).sources;
  const native = JSON.parse(await fs.readFile(nativePin.file, 'utf8')) as NativeReceipt;
  validatePdfIngestCorpus(sources); assert.equal(native.status, 'completed'); assert.deepEqual(native.totals && { files: native.totals.files, pages: native.totals.pages, chunks: native.totals.chunks }, { files: 10, pages: 599, chunks: 671 });
  const pins = [corpus, nativePin];
  for (const source of sources) {
    const pdf = await pin(source.publicPdf); assert.equal(pdf.sha256, source.pdfSha256); assert.equal(pdf.bytes, source.size); pins.push(pdf);
    const retained = native.files.find(file => file.chapter === source.chapter); assert(retained && retained.receipt.pdfSha256 === source.pdfSha256);
    const raw = await pin(retained.retainedNative.file); assert.equal(raw.sha256, retained.receipt.rawTextSha256); assert.equal(raw.sha256, retained.retainedNative.sha256); pins.push(raw);
  }
  for (const binary of native.binaries) { assert(['pdftotext', 'pdfinfo'].includes(binary.name)); const item = await pin(binary.file); assert.equal(item.sha256, binary.sha256); pins.push(item); }
  return { sources, native, pins };
}
async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`; await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await fs.rename(temporary, file);
}
const safeError = (error: unknown) => ({ name: error instanceof Error ? error.name : 'Error', message: (error instanceof Error ? error.message : String(error)).replace(/(mongodb:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[redacted]@').slice(0, 2000) });

export async function verifyPdfProvenanceIngest(args: PdfIngestArguments): Promise<void> {
  assert(PREFIX.test(args.database) && typeof args.executeLocal === 'boolean' && path.isAbsolute(args.output)
    && path.normalize(args.output) === args.output && args.output.startsWith(path.join(ROOT, 'audit-results') + path.sep), 'Invalid direct harness arguments.');
  const attempts: PdfIngestAttempt[] = [], substitutions: SubstitutionReceipt[] = [];
  // These builtin/type-only imports have not loaded any production runtime.
  const fence = installFence(attempts); let restoreSubstitutions = () => {};
  let mongo: typeof MongoModule | undefined; let ownsMongo = false; let server: ReturnType<Express['listen']> | undefined;
  try {
    let directory = path.dirname(args.output);
    while (directory !== ROOT) {
      const stat = await fs.lstat(directory); assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Refuse a symlink/non-directory output parent.');
      directory = path.dirname(directory);
    }
    await fs.mkdir(args.output, { recursive: false });
    const input = await inputs(); const code = await codePins();
    const scope = 'Real retained-PDF/native-parser/chunker/Mongo/material HTTP provenance integration. Synthetic identity and deterministic embeddings/vector storage; classification skipped. No paid model, real vector/embedding service, SAML or upload/Agenda admission acceptance.';
    await fs.writeFile(path.join(args.output, 'declaration.json'), JSON.stringify({ version: 1, scope, database: args.database,
      maximumModelCalls: 0, maximumRemoteCalls: 0, code, inputs: input.pins, expected: { files: 10, physicalPages: 599, chunks: 671 },
      substitutions: ['Embeddings: deterministic four-value SHA256 vectors, counted.', 'Qdrant: successful deterministic validation substitute, counted; no real vector collection.', 'Classification: explicitly skipped per material, counted.', 'All model and job integration calls: counted and forbidden.'],
      retention: 'Fresh exclusive owned DB/upload copies/private sidecars are retained. No old database, original corpus PDF, ledger or experiment is modified or cleaned.' }, null, 2) + '\n', { flag: 'wx' });
    if (!args.executeLocal) { assert.equal(attempts.length, 0); console.log(JSON.stringify({ status: 'file-only-preflight', output: args.output, databaseCalls: 0, modelCalls: 0 })); return; }
    const actor = `PDF-PROVENANCE-INGEST-${randomUUID()}`; const startedAt = new Date();
    const observations: Array<Record<string, unknown>> = [], http: Array<Record<string, unknown>> = [], files: Array<Record<string, unknown>> = [];
    const ownedUploads: string[] = []; let status = 'preparing'; let topology: unknown; let error: unknown;
    let counts: (() => Promise<Record<string, number>>) | undefined;
    const save = async () => {
      let databaseCounts: Record<string, number> | null = null; let countError: unknown;
      try { databaseCounts = counts ? await counts() : null; } catch (failure) { countError = safeError(failure); }
      await writeJson(path.join(args.output, 'results.json'), { version: 1, scope, status, actor, database: args.database, startedAt,
        elapsedMs: Date.now() - startedAt.getTime(), topology, observations, http, files, ownedUploads, boundaryAttempts: attempts,
        substitutions, databaseCounts, countError: countError ?? null, error: error ? safeError(error) : null,
        limitations: ['Native byte/page/chunk identity is not semantic, chart/table interpretation, teacher acceptance or question quality.', 'Synthetic sessions bypass SAML. Successful embedding/vector/classification receipts here are explicitly substituted.', 'Durable ingest runs are invoked synchronously; multipart admission, Agenda execution and a running application server are not tested.', 'Mongo fences do not make filesystem changes atomic; immutable upload copies are independently rehashed on pinned access.', 'All owned fixtures remain for inspection; the final negative test leaves one material in Trash.'] });
    };
    try {
      restoreSubstitutions = installSubstitutions(attempts, substitutions);
      assert.deepEqual(await codePins(), code, 'Code changed before runtime admission.');
      const { env } = runtime<typeof EnvModule>('server/src/config/env.ts'); assertPdfIngestTarget(env.mongodbUri, env.mongodbDbName, args.database);
      mongo = runtime<typeof MongoModule>('server/src/components/mongodb/index.ts');
      let cached: MongoDriver.Db | undefined;
      try { cached = mongo.getDb(); } catch (failure) { assert(failure instanceof Error && failure.message === 'MongoDB is not connected. Call connectMongo() during startup first.'); }
      assert.equal(cached, undefined, 'Refuse cached Mongo; use a fresh process.');
      const db = await mongo.connectMongo(); ownsMongo = true; assert.equal(db.databaseName, args.database);
      assert.equal((await db.listCollections({}, { nameOnly: true }).toArray()).length, 0, 'Refuse every nonempty database.');
      await claimPdfIngestDatabase(db.collection<PdfIngestOwnership>('qualityPdfProvenanceOwnership'), { database: args.database, actor, createdAt: startedAt });
      const collections = runtime<typeof CollectionsModule>('server/src/components/mongodb/collections.ts');
      for (const index of collections.INDEX_SPECS.filter(value => ['materialChunks', 'materialSourceProvenance', 'contentRuns'].includes(value.collection))) await db.collection(index.collection).createIndex(index.keys, index.options);
      const authoring = runtime<typeof AuthoringModule>('server/src/services/authoring-commit.service.ts'); topology = await authoring.initializeAuthoringCommitSupport();
      assert(authoring.authoringCommitAvailable(), 'This run requires the local replica set to verify coordinated publication.');
      const materials = runtime<typeof MaterialsModule>('server/src/services/materials.service.ts');
      const runs = runtime<typeof RunsModule>('server/src/services/content-runs.service.ts');
      const provenance = runtime<typeof ProvenanceModule>('server/src/services/material-source-provenance.service.ts');
      const readiness = runtime<typeof ReadinessModule>('server/src/services/source-readiness.service.ts');
      const evidence = runtime<typeof EvidenceModule>('server/src/services/generation-evidence.service.ts');
      const { ObjectId: Id } = load('mongodb') as typeof MongoDriver;
      const courseId = new Id(), otherCourseId = new Id(), themeId = new Id(), loId = new Id();
      const course: Course = { name: 'Retained ten-PDF provenance integration fixture', courseCode: 'PDF-PROVENANCE', term: '2026W1', ownerPuid: actor, registrationCode: randomUUID(), published: false, lifecycle: 'draft', feedbackStrategy: 'adaptive',
        autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: startedAt };
      await collections.coursesCol().insertMany([{ _id: courseId, ...course }, { _id: otherCourseId, ...course, name: 'Owned cross-course isolation fixture' }]);
      await collections.themesCol().insertOne({ _id: themeId, courseId, name: 'Retained chapters', order: 1 });
      await collections.losCol().insertOne({ _id: loId, courseId, themeId, name: 'Synthetic evidence retrieval scope only; not a semantic coverage claim.', order: 1, kind: 'conceptual' });
      const user: User = { puid: actor, uid: actor, displayName: 'Synthetic PDF integration instructor', email: 'pdf-provenance@example.invalid', affiliations: [], isAdmin: false,
        courseRoles: [{ courseId, role: 'instructor' }, { courseId: otherCourseId, role: 'instructor' }], createdAt: startedAt, lastLoginAt: startedAt };
      const express = load('express') as typeof ExpressModule.default, request = load('supertest') as typeof SupertestModule.default;
      const app = express(); app.use(express.json()); app.use((req, _res, next) => {
        const auth = req.get('x-pdf-provenance-auth'); req.isAuthenticated = (() => auth !== 'signed-out') as Request['isAuthenticated'];
        req.user = auth === 'foreign' ? { ...user, puid: `${actor}-foreign`, courseRoles: [] }
          : auth === 'student' || auth === 'ta' ? { ...user, courseRoles: [{ courseId, role: auth }] } : user; next();
      });
      app.use('/api', runtime<typeof RoutesModule>('server/src/routes/materials.routes.ts').materialsRouter); app.use(runtime<typeof ErrorModule>('server/src/middleware/error-handler.ts').errorHandler);
      server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve, reject) => { server!.once('listening', resolve); server!.once('error', reject); });
      const address = server.address(); assert(address && typeof address !== 'string'); fence.http(address.port); const client = request(server);
      counts = async () => Object.fromEntries(await Promise.all(['courses', 'materials', 'materialChunks', 'materialSourceProvenance', 'contentRuns', 'modelCallReceipts', 'modelUsageSessions', 'agendaJobs'].map(async name => [name, await db.collection(name).countDocuments({})])));
      const send = async (label: string, url: string, expected: number, auth = 'owner', method: 'get' | 'delete' = 'get') => {
        const entry: Record<string, unknown> = { label, method: method.toUpperCase(), url, auth, expectedStatus: expected, status: null, responseState: 'pending' }; http.push(entry); await save();
        try {
          const response = await client[method](url).set('x-pdf-provenance-auth', auth).buffer(true).timeout({ response: 10000, deadline: 30000 });
          Object.assign(entry, { status: response.status, responseState: 'received', response: Buffer.isBuffer(response.body) ? { bytes: response.body.length, sha256: hash(response.body) } : response.body });
          await save(); assert.equal(response.status, expected, `${label}: ${response.status}`); assert.equal(attempts.length, 0); return response;
        } catch (failure) { Object.assign(entry, { responseState: entry.status === null ? 'unknown-after-error' : 'received', error: safeError(failure) }); await save(); throw failure; }
      };
      const uploadRoot = path.join(ROOT, 'uploads'); await fs.mkdir(uploadRoot, { recursive: true });
      assert((await fs.lstat(uploadRoot)).isDirectory() && !(await fs.lstat(uploadRoot)).isSymbolicLink());
      const retained: Array<{ materialId: MongoDriver.ObjectId; provenanceId: MongoDriver.ObjectId; path: string; source: PdfIngestSource }> = [];
      let shiftFixture: { materialId: MongoDriver.ObjectId; index: number; text: string; sourceProvenance: MaterialChunkProvenance; delta: number } | undefined;
      let verifiedWorkspaceLocators = 0;
      status = 'running'; await save();
      for (const source of input.sources) {
        const materialId = new Id(), storagePath = path.join(uploadRoot, `${randomUUID()}.pdf`); ownedUploads.push(storagePath);
        await fs.copyFile(source.publicPdf, storagePath, constants.COPYFILE_EXCL); assert.equal((await pin(storagePath)).sha256, source.pdfSha256);
        const material: Material = { courseId, name: source.name, format: 'pdf', status: 'processing', storagePath, assignments: [{ themeId, loId }], uploadedAt: new Date() };
        await collections.materialsCol().insertOne({ _id: materialId, ...material });
        const run = await runs.createMaterialIngestRun({ courseId, requestedBy: actor, materialId, sourceName: source.name, sourceFormat: 'pdf', trigger: 'upload' });
        await collections.materialsCol().updateOne({ _id: materialId }, { $set: { activeRunId: run._id } });
        const ingestStarted = Date.now(); await materials.ingestMaterial(materialId.toHexString(), run._id.toHexString());
        const current = await collections.materialsCol().findOne({ _id: materialId, courseId }); assert(current?.status === 'ready', `Ingest failed for chapter ${source.chapter}: ${current?.error}`);
        assert(current.sourceManifest?.provenanceId); assert.equal(current.sourceManifest.sourceTextHash, source.manifest.sourceTextHash); assert.equal(current.sourceManifest.chunkCount, source.chunks.length);
        assert.equal(current.sourceManifest.parserVersion, readiness.MATERIAL_PARSER_VERSION); assert.equal(current.sourceManifest.chunkerVersion, readiness.MATERIAL_CHUNKER_VERSION);
        const chunks = await collections.materialChunksCol().find({ courseId, materialId }).sort({ index: 1 }).toArray();
        assert.deepEqual(chunks.map(({ index, text, characterCount }) => ({ index, text, characterCount })), source.chunks);
        assert(chunks.every(chunk => !Object.hasOwn(chunk.metadata ?? {}, 'sourceProvenance')));
        const sidecar = await provenance.readMaterialSourceProvenance(courseId, materialId, current.sourceManifest.provenanceId); assert(sidecar);
        const native = input.native.files.find(file => file.chapter === source.chapter)!;
        assert.equal(sidecar.receipt.pdfSha256, source.pdfSha256); assert.equal(sidecar.receipt.successfulEngine, 'poppler-pdftotext');
        assert(sidecar.receipt.pageCount.status === 'verified'); assert.equal(sidecar.receipt.pageCount.count, source.pages);
        const raw = await fs.readFile(sidecar.rawTextStoragePath); assert.equal(hash(raw), native.receipt.rawTextSha256);
        assert.equal(hash(raw), sidecar.receipt.rawTextSha256); assert.equal(raw.length, sidecar.receipt.rawTextBytes);
        assert(chunks.every(chunk => provenance.validateMaterialChunkProvenance(chunk, sidecar) && chunk.sourceProvenance?.locator.status === 'verified'));
        if (!shiftFixture && sidecar.receipt.pageMap.status === 'verified') {
          for (const chunk of chunks) {
            const binding = chunk.sourceProvenance, locator = binding?.locator;
            if (!binding || !locator || locator.status !== 'verified' || locator.pageSpans.length !== 1) continue;
            const page = sidecar.receipt.pageMap.pages[locator.pageSpans[0].physicalPage - 1];
            const delta = locator.rawEnd < page.rawEnd ? 1 : locator.rawStart > page.rawStart ? -1 : 0;
            if (delta) { shiftFixture = { materialId, index: chunk.index, text: chunk.text, sourceProvenance: binding, delta }; break; }
          }
        }
        const detail = await send(`chapter-${source.chapter}-workspace`, `/api/courses/${courseId}/materials/${materialId}/workspace`, 200);
        assert.equal(detail.body.sourceProvenance.status, 'verified'); assert.equal(detail.body.chunks.length, chunks.length);
        assert((detail.body.chunks as Array<{ index: number; text: string; sourceProvenance?: MaterialChunkProvenance }>).every(chunk => provenance.validateMaterialChunkProvenance(chunk, sidecar)
          && chunk.sourceProvenance?.locator.status === 'verified'));
        verifiedWorkspaceLocators += detail.body.chunks.length;
        const dto = JSON.stringify(detail.body); assert(!dto.includes('rawTextStoragePath') && !dto.includes('storagePath') && !dto.includes(sidecar.rawTextStoragePath));
        const original = await send(`chapter-${source.chapter}-pinned-source`, `/api/courses/${courseId}/materials/${materialId}/source?provenanceId=${sidecar._id}`, 200);
        assert(Buffer.isBuffer(original.body)); assert.equal(hash(original.body), source.pdfSha256);
        const ready = await readiness.getMaterialSourceReadiness(courseId, materialId); assert(ready.ready);
        assert.equal((await runs.getContentRun(run._id))?.status, 'completed');
        retained.push({ materialId, provenanceId: sidecar._id, path: storagePath, source });
        const row = { chapter: source.chapter, materialId: materialId.toHexString(), runId: run._id.toHexString(), provenanceId: sidecar._id.toHexString(), storagePath,
          rawTextStoragePath: sidecar.rawTextStoragePath, elapsedMs: Date.now() - ingestStarted, pages: source.pages, chunks: chunks.length,
          sourceTextHash: current.sourceManifest.sourceTextHash, sourceManifest: current.sourceManifest, receipt: sidecar.receipt, exactRetainedChunks: true, exactRawText: true };
        files.push(row); await writeJson(path.join(args.output, `chapter-${source.chapter}.json`), { ...row, chunks }); await save();
      }
      assert.equal(verifiedWorkspaceLocators, 671);
      observations.push({ label: 'native-ingest-and-private-publication', status: 'passed', files: 10, pages: 599, chunks: 671, verifiedWorkspaceLocators });
      const allowedMaterials = retained.map(item => ({ materialId: item.materialId.toHexString(), role: 'primary' as const, loId: loId.toHexString() }));
      const seeds = retained.map(item => ({ materialId: item.materialId.toHexString(), chunkIndex: 0, text: item.source.chunks[0].text }));
      const evidenceInput = { courseId, loIds: [loId], allowedMaterials, seeds, policyVersion: 'grounded-memory-v2' as const };
      const legacy = await evidence.buildGenerationEvidence(evidenceInput), located = await evidence.buildGenerationEvidence({ ...evidenceInput, sourceProvenance: 'pdf-pages-v1' });
      assert.equal(legacy.schemaVersion, 'source-passages-v1'); assert.equal(legacy.parsingProvenance, 'unrecorded'); assert(legacy.passages.every(passage => !passage.sourceLocation));
      assert.equal(located.schemaVersion, 'source-passages-v2'); assert.equal(located.parsingProvenance, 'verified'); assert(located.passages.every(passage => passage.sourceLocation?.status === 'verified'));
      await evidence.assertGenerationEvidenceCurrent(legacy); await evidence.assertGenerationEvidenceCurrent(located);
      await writeJson(path.join(args.output, 'evidence-packets.json'), { legacy, located });
      const first = retained[0], second = retained[1]; const firstChunk = await collections.materialChunksCol().findOne({ courseId, materialId: first.materialId, index: 0 }); assert(firstChunk?.sourceProvenance);
      await collections.materialChunksCol().updateOne({ _id: firstChunk._id }, { $set: { 'sourceProvenance.locator.pageSpans.0.physicalPage': 99999 } });
      await assert.rejects(evidence.assertGenerationEvidenceCurrent(located), /generation-evidence-source-changed/); await evidence.assertGenerationEvidenceCurrent(legacy);
      const legacyAfter = await evidence.buildGenerationEvidence(evidenceInput); assert.equal(legacyAfter.id, legacy.id);
      await collections.materialChunksCol().updateOne({ _id: firstChunk._id }, { $set: { sourceProvenance: firstChunk.sourceProvenance } }); await evidence.assertGenerationEvidenceCurrent(located);
      observations.push({ label: 'legacy-identity-and-new-currentness-tamper-guard', status: 'passed', legacyId: legacy.id, locatedId: located.id, materialId: first.materialId.toHexString() });
      // Independent construction must reject a mechanically consistent, same-page
      // shifted locator as well as rejecting changes to an already frozen packet.
      assert(shiftFixture, 'Retained corpus must provide a real single-page locator with room for a consistent offset shift.');
      const shifted = structuredClone(shiftFixture.sourceProvenance);
      assert(shifted.locator.status === 'verified'); shifted.locator.rawStart += shiftFixture.delta; shifted.locator.rawEnd += shiftFixture.delta;
      for (const span of shifted.locator.pageSpans) { span.rawStart += shiftFixture.delta; span.rawEnd += shiftFixture.delta; }
      await collections.materialChunksCol().updateOne({ courseId, materialId: shiftFixture.materialId, index: shiftFixture.index }, { $set: { sourceProvenance: shifted } });
      try {
        const detail = await send('same-page-shift-workspace', `/api/courses/${courseId}/materials/${shiftFixture.materialId}/workspace`, 200);
        assert.equal(detail.body.sourceProvenance.status, 'unavailable');
        const row = (detail.body.chunks as Array<{ index: number; sourceProvenance?: unknown }>).find(chunk => chunk.index === shiftFixture!.index); assert(row && !row.sourceProvenance);
        const rebuilt = await evidence.buildGenerationEvidence({ ...evidenceInput, seeds: [{ materialId: shiftFixture.materialId.toHexString(), chunkIndex: shiftFixture.index, text: shiftFixture.text }], sourceProvenance: 'pdf-pages-v1' });
        const affected = rebuilt.passages.filter(passage => passage.materialId === shiftFixture!.materialId.toHexString() && passage.chunkIndex === shiftFixture!.index);
        assert(affected.length > 0 && affected.every(passage => passage.sourceLocation?.status === 'unavailable'));
        assert.equal(rebuilt.parsingProvenance, 'partial');
        await writeJson(path.join(args.output, 'negative-same-page-shift.json'), { label: 'Fresh construction after same-page locator shift', materialId: shiftFixture.materialId.toHexString(), chunkIndex: shiftFixture.index,
          original: shiftFixture.sourceProvenance, shifted, workspaceStatus: detail.body.sourceProvenance, affectedPassages: affected });
      } finally {
        await collections.materialChunksCol().updateOne({ courseId, materialId: shiftFixture.materialId, index: shiftFixture.index }, { $set: { sourceProvenance: shiftFixture.sourceProvenance } });
      }
      await evidence.assertGenerationEvidenceCurrent(located);
      observations.push({ label: 'fresh-evidence-and-workspace-refuse-consistent-same-page-locator-shift', status: 'passed', materialId: shiftFixture.materialId.toHexString(), chunkIndex: shiftFixture.index, offsetShift: shiftFixture.delta });
      const base = `/api/courses/${courseId}/materials/${first.materialId}`;
      for (const [auth, expected] of [['signed-out', 401], ['foreign', 403], ['student', 403], ['ta', 200]] as const) await send(`workspace-auth-${auth}`, `${base}/workspace`, expected, auth);
      await send('cross-course-material-binding', `/api/courses/${otherCourseId}/materials/${first.materialId}/workspace`, 404);
      await send('cross-course-pinned-source-binding', `/api/courses/${otherCourseId}/materials/${first.materialId}/source?provenanceId=${first.provenanceId}`, 404);
      await send('foreign-provenance-binding', `${base}/source?provenanceId=${second.provenanceId}`, 404);
      const ownedBytes = await fs.readFile(first.path); await fs.writeFile(first.path, 'Owned fixture PDF deliberately changed after ingest.');
      try { await send('changed-owned-PDF-denied', `${base}/source?provenanceId=${first.provenanceId}`, 404); }
      finally { await fs.writeFile(first.path, ownedBytes); }
      assert.equal((await pin(first.path)).sha256, first.source.pdfSha256);
      await send('restored-owned-PDF-pin', `${base}/source?provenanceId=${first.provenanceId}`, 200);
      observations.push({ label: 'http-authorization-binding-and-physical-byte-pin', status: 'passed', changedOriginalCorpusFiles: 0 });
      const sidecar = await provenance.readMaterialSourceProvenance(courseId, first.materialId, first.provenanceId); assert(sidecar); const rawBefore = await pin(sidecar.rawTextStoragePath);
      await send('trash-owned-material', base, 200, 'owner', 'delete');
      assert.equal((await pin(sidecar.rawTextStoragePath)).sha256, rawBefore.sha256); assert(await collections.materialSourceProvenanceCol().findOne({ _id: first.provenanceId }));
      await assert.rejects(evidence.assertGenerationEvidenceCurrent(located), /generation-evidence-material-unavailable/);
      await send('trashed-pin-unavailable', `${base}/source?provenanceId=${first.provenanceId}`, 404);
      observations.push({ label: 'trash-retains-private-artifact-and-blocks-grounding', status: 'passed', materialId: first.materialId.toHexString(), artifactRetained: true });
      assert.equal(substitutions.filter(item => item.boundary === 'embedding.embed:deterministic-sha256-four-values').length, 10);
      assert.equal(substitutions.filter(item => item.boundary === 'embedding.embed:deterministic-sha256-four-values').reduce((sum, item) => sum + item.items, 0), 671);
      assert.equal(substitutions.filter(item => item.boundary === 'classification.classifyMaterial:explicitly-skipped').length, 10);
      const finalCounts = await counts(); for (const name of ['modelCallReceipts', 'modelUsageSessions', 'agendaJobs']) assert.equal(finalCounts[name], 0);
      assert.equal(finalCounts.materialChunks, 671); assert.equal(finalCounts.materialSourceProvenance, 10); assert.equal(finalCounts.contentRuns, 10);
      assert.equal(await collections.coursesCol().countDocuments({ ownerPuid: { $ne: actor } }), 0);
      assert.equal(attempts.length, 0); assert.deepEqual(await codePins(), code, 'Code changed during this run.');
      for (const original of input.pins) assert.deepEqual(await pin(original.file), original, `Retained input changed: ${original.file}`);
      status = 'completed'; await save(); console.log(JSON.stringify({ status, output: args.output, files: 10, pages: 599, chunks: 671, http: http.length, modelCalls: 0, deniedBoundaryAttempts: 0 }));
    } catch (failure) { error = failure; status = 'stopped'; await save(); throw failure; }
  } finally {
    try { if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
    finally { try { if (mongo && ownsMongo) await mongo.closeMongo(); } finally { restoreSubstitutions(); fence.restore(); } }
  }
}
export async function main(): Promise<void> { await verifyPdfProvenanceIngest(parsePdfIngestArguments(process.argv.slice(2))); }
if (require.main === module) void main().catch(error => { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; });
