import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { Readable } from 'node:stream';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { Course, Material, User } from '../../server/src/types/domain';
import type { IntendedUploadFile, SourceSelectionReport } from '../../server/src/types/material-upload';
import type { OutlineCorpusFixture } from './outline-controls';
import type * as EnvModule from '../../server/src/config/env';
import type * as MongoModule from '../../server/src/components/mongodb';
import type * as CollectionsModule from '../../server/src/components/mongodb/collections';
import type * as AuthoringModule from '../../server/src/services/authoring-commit.service';
import type * as QdrantModule from '../../server/src/components/qdrant';
import type * as MaterialsModule from '../../server/src/services/materials.service';
import type * as MaterialsRoutesModule from '../../server/src/routes/materials.routes';
import type * as ErrorModule from '../../server/src/middleware/error-handler';
import type * as ZodModule from 'zod';

export type MultipartMode = 'boundary-only' | 'real-index';
export const MULTIPART_FILE_LIMIT = 50 * 1024 * 1024;
const ROOT = path.resolve(__dirname, '../..');
const loadModule = createRequire(__filename);
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const CODE_FILES = ['scripts/quality-lab/run-multipart-admission.ts', 'server/src/routes/materials.routes.ts',
  'server/src/services/material-upload-batches.service.ts', 'server/src/services/materials.service.ts',
  'server/src/services/source-readiness.service.ts', 'server/src/services/content-runs.service.ts',
  'server/src/services/authoring-commit.service.ts', 'server/src/components/mongodb/collections.ts',
  'server/src/components/genai/document-parsing/index.ts', 'server/src/components/genai/chunking/index.ts',
  'server/src/components/genai/embeddings/index.ts', 'server/src/components/qdrant/index.ts',
  'server/src/types/material-upload.ts', 'server/src/types/domain.ts'];

/** These checks run before connecting or importing a worker/router. No URI,
 * credential or configurable production auth bypass is written to receipts. */
export function assertMultipartTarget(input: { mongodbUri: string; mongodbDbName: string; qdrantUrl: string; embeddingsProvider: string },
  database: string, mode: MultipartMode): { database: string; mongoHost: string; mongoPort: string; qdrantHost?: string; qdrantPort?: string } {
  const mongo = new URL(input.mongodbUri);
  const local = (host: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  if (!['mongodb:', 'mongodb+srv:'].includes(mongo.protocol) || mongo.protocol === 'mongodb+srv:' || !local(mongo.hostname) || mongo.port !== '27029' ||
      !/^financebot_quality_smoke_retest_[a-z0-9_]+$/.test(database) || database !== input.mongodbDbName) throw new Error('quality-lab-multipart-owned-mongo-required');
  const target = { database, mongoHost: mongo.hostname, mongoPort: mongo.port };
  if (mode === 'boundary-only') return target;
  const qdrant = new URL(input.qdrantUrl);
  if (!['http:', 'https:'].includes(qdrant.protocol) || !local(qdrant.hostname) || qdrant.port !== '6333' || input.embeddingsProvider !== 'fastembed') throw new Error('quality-lab-multipart-local-index-required');
  return { ...target, qdrantHost: qdrant.hostname, qdrantPort: qdrant.port };
}

export function validateMultipartSourceList(sources: Array<{ name: string; size: number; pdfSha256: string; chapter: number; pages: number }>): void {
  if (sources.length !== 10 || new Set(sources.map(source => source.chapter)).size !== 10 || new Set(sources.map(source => source.name)).size !== 10 ||
      new Set(sources.map(source => source.pdfSha256)).size !== 10 || sources.some(source => !source.name.toLowerCase().endsWith('.pdf') ||
        !Number.isSafeInteger(source.size) || source.size < 1 || source.size > MULTIPART_FILE_LIMIT || !/^[a-f0-9]{64}$/.test(source.pdfSha256) ||
        !Number.isSafeInteger(source.pages) || source.pages < 1)) throw new Error('quality-lab-multipart-ten-exact-pdfs-required');
}

export function assertIntendedReadiness(report: Pick<SourceSelectionReport, 'requested' | 'included' | 'ready'>,
  files: readonly Pick<IntendedUploadFile, 'name'>[], readyCount: number): void {
  assert.deepEqual(report.requested.map(item => item.name), files.map(item => item.name), 'Every intended source must remain in the all-source receipt.');
  assert.equal(report.included.length, readyCount);
  assert.equal(report.requested.filter(item => item.ready).length, readyCount);
  assert.equal(report.ready, readyCount === files.length && files.length > 0);
}

export function assertColdMultipartCounts(counts: { sourceExtractions: number; structureRuns: number }): void {
  if (counts.sourceExtractions !== 0 || counts.structureRuns !== 0) throw new Error('quality-lab-multipart-course-not-cold');
}

/** The ordinary negative response is not an assertion failure. A forbidden
 * component invocation is sticky even if production turns it into a warning. */
function installModuleValue(relative: string, exports: unknown): () => void {
  const filename = loadModule.resolve(path.join(ROOT, relative));
  const previous = loadModule.cache[filename];
  loadModule.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule;
  return () => { if (previous) loadModule.cache[filename] = previous; else delete loadModule.cache[filename]; };
}

/** Restrict every TCP connection, including first-use model downloads, to the
 * owned ephemeral HTTP server, disposable Mongo and optional local Qdrant. */
function installSocketFence(ports: Set<number>, failures: string[]): () => void {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first as { port?: number | string; host?: string; path?: string } : { port: first, host: args[1] };
    const host = String(options.host ?? 'localhost'); const port = Number(options.port);
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || !ports.has(port) || ('path' in options && options.path)) {
      failures.push('forbidden-network-connection'); throw new Error('quality-lab-multipart-network-forbidden');
    }
    return Reflect.apply(original, this, args) as net.Socket;
  } as typeof original;
  return () => { net.Socket.prototype.connect = original; };
}

function syntheticCourse(ownerPuid: string, suffix: string): Course {
  return { name: `Quality multipart admission ${suffix}`, courseCode: 'QUALITY-MULTIPART', term: '2026W1', ownerPuid,
    registrationCode: randomUUID(), published: false, lifecycle: 'draft', feedbackStrategy: 'adaptive',
    autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: new Date() };
}

async function main(): Promise<void> {
  const fixturePath = argument('--fixture'); const output = argument('--output'); const database = argument('--database');
  const mode = argument('--mode') ?? 'boundary-only'; const live = argument('--live');
  if (!fixturePath || !output || !database || !['boundary-only', 'real-index'].includes(mode) || (live !== undefined && live !== 'once')) throw new Error('Supply --fixture, NEW --output, owned --database, optional --mode boundary-only|real-index and root-authorized --live once.');
  const fixtureBytes = await fs.readFile(fixturePath, 'utf8'); const fixture = JSON.parse(fixtureBytes) as OutlineCorpusFixture;
  const sources = await Promise.all(fixture.sources.map(async source => {
    const bytes = await fs.readFile(source.publicPdf);
    if (hash(bytes) !== source.pdfSha256 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('quality-lab-multipart-original-pdf-mismatch');
    return { chapter: source.chapter, pages: source.pages, publicPdf: path.resolve(source.publicPdf), name: source.name, size: bytes.length, pdfSha256: source.pdfSha256 };
  }));
  validateMultipartSourceList(sources);
  const actor = `QUALITY-RETEST-FIXTURE-${randomUUID()}`; const courseId = new ObjectId(); const partialCourseId = new ObjectId();
  const code = await Promise.all(CODE_FILES.map(async file => ({ file, sha256: hash(await fs.readFile(path.join(ROOT, file))) })));
  const controls = { version: 1, createdAt: new Date().toISOString(), mode, database, actor, courseId: courseId.toHexString(), partialCourseId: partialCourseId.toHexString(),
    fixture: path.resolve(fixturePath), fixtureSha256: hash(fixtureBytes), sources, code, totalPages: sources.reduce((sum, source) => sum + source.pages, 0),
    totalPdfBytes: sources.reduce((sum, source) => sum + source.size, 0), providerCallsAllowed: 0,
    auth: 'Synthetic request User only inside this ephemeral test Express app; real course guards remain active. No SAML, production auth configuration or persisted User mutation.',
    modes: { 'boundary-only': 'Actual HTTP multipart, Multer, Mongo batch/material/run receipts; worker, parsing, embedding, Qdrant, classification and model calls blocked.',
      'real-index': 'After boundary checks, manually execute actual ingestMaterial, parser, chunker, local fastembed and owned-course Qdrant. Advisory classification is explicitly blocked; no Agenda execution or LLM transport.' },
    limitations: ['This is an HTTP admission boundary acceptance test, not real SAML or Agenda automation.',
      'The partial-persistence case injects one labelled Material insert failure; Mongo writes before and after that failure are real.',
      'The oversize negative uses a labelled synthetic stream exceeding 50 MiB, not a claim that an original public PDF is oversized.',
      'Only real-index mode can produce indexed readiness. No chunks/manifests are copied or manually marked ready.'] };
  await fs.mkdir(output, { recursive: false }); await fs.writeFile(path.join(output, 'controls.json'), JSON.stringify(controls, null, 2) + '\n', { flag: 'wx' });
  if (!live) { console.log(JSON.stringify({ preflight: true, mode, databaseCalls: 0, providerCalls: 0, networkCalls: 0, output: path.resolve(output), files: sources.length, pages: controls.totalPages })); return; }

  const { env } = loadModule(path.join(ROOT, 'server/src/config/env.ts')) as typeof EnvModule;
  const target = assertMultipartTarget(env, database, mode as MultipartMode);
  const restore: Array<() => void> = []; const forbidden: string[] = []; const advisory: Array<{ materialId: string; reason: string }> = [];
  const allowedAdvisoryMaterials = new Set<string>();
  const queued: Array<{ name: string; runId: string }> = []; const uploadedPaths = new Set<string>(); const http: unknown[] = []; const observations: Record<string, unknown> = {};
  const blocked = (name: string) => (..._args: unknown[]): never => { forbidden.push(name); throw new Error(`quality-lab-multipart-forbidden:${name}`); };
  let partialInjection = false; let injectedFailures = 0; let connected = false; let server: ReturnType<express.Express['listen']> | undefined;
  let indexedQdrant: typeof QdrantModule.qdrant | undefined;
  let status = 'preparing'; let error: { message: string } | null = null; const started = Date.now();
  const save = async () => { await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ version: 1, status, mode, elapsedMs: Date.now() - started,
    controlsSha256: hash(JSON.stringify(controls)), target, actor, courseId: courseId.toHexString(), partialCourseId: partialCourseId.toHexString(),
    observations, http, queued, injectedFailures, advisoryClassification: advisory, forbiddenComponentOrNetworkAttempts: forbidden,
    providerCalls: 0, savedQuestions: 0, adoptedQuestions: 0, teacherAcceptance: null, error, limitations: controls.limitations }, null, 2) + '\n'); };
  const assertCurrent = async () => { for (const identity of code) assert.equal(hash(await fs.readFile(path.join(ROOT, identity.file))), identity.sha256, `Source changed: ${identity.file}`); };
  const jobs = { enqueueJob: async (name: string, data: { runId?: string }) => {
    if (name !== 'material.ingest' || !data.runId || !ObjectId.isValid(data.runId)) return blocked('unexpected-job')();
    queued.push({ name, runId: data.runId });
  }, defineJob: blocked('defineJob'), hasPendingJob: async () => false, startJobs: blocked('startJobs') };
  restore.push(installModuleValue('server/src/components/jobs/index.ts', jobs));
  restore.push(installModuleValue('server/src/components/genai/llm/index.ts', new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : blocked(`llm:${String(key)}`) })));
  restore.push(installModuleValue('server/src/services/classification.service.ts', {
    classifyMaterial: async (id: ObjectId) => {
      if (mode !== 'real-index' || !allowedAdvisoryMaterials.has(id.toHexString())) return blocked('unexpected-classification-target')();
      advisory.push({ materialId: id.toHexString(), reason: 'quality-lab-advisory-classification-explicitly-blocked' }); throw new Error('quality-lab-advisory-classification-explicitly-blocked');
    },
    applyGeneratedHierarchy: blocked('applyGeneratedHierarchy'), resolveClassification: blocked('resolveClassification'), suggestHierarchy: blocked('suggestHierarchy'),
  }));
  // Unrelated outline endpoints are unavailable in this test app. Their schema
  // is an import-only stub and is never exercised as admission evidence.
  const { z } = loadModule('zod') as typeof ZodModule;
  restore.push(installModuleValue('server/src/services/structure-generation.service.ts', { enqueueStructureGeneration: blocked('outline'), structureOptionsSchema: z.object({}).passthrough() }));
  if (mode === 'boundary-only') for (const [relative, exports] of [
    ['server/src/components/genai/document-parsing/index.ts', { parseFile: blocked('parseFile') }],
    ['server/src/components/genai/chunking/index.ts', { chunkText: blocked('chunkText') }],
    ['server/src/components/genai/embeddings/index.ts', { embed: blocked('embed'), embedOne: blocked('embedOne'), getEmbeddingDimension: blocked('getEmbeddingDimension') }],
    ['server/src/components/qdrant/index.ts', { deletePointsByFilter: blocked('qdrant-delete'), ensureCollection: blocked('qdrant-ensure'), upsertPoints: blocked('qdrant-upsert') }],
  ] as const) restore.push(installModuleValue(relative, exports));
  const ports = new Set([27029, ...(mode === 'real-index' ? [Number(target.qdrantPort)] : [])]);
  restore.push(installSocketFence(ports, forbidden));
  const mongo = loadModule(path.join(ROOT, 'server/src/components/mongodb/index.ts')) as typeof MongoModule;
  try {
    await assertCurrent(); await mongo.connectMongo(); connected = true;
    const collectionsPath = path.join(ROOT, 'server/src/components/mongodb/collections.ts');
    const collections = loadModule(collectionsPath) as typeof CollectionsModule;
    for (const index of collections.INDEX_SPECS.filter(index => ['materials', 'materialChunks', 'materialUploadBatches'].includes(index.collection))) await mongo.getDb().collection(index.collection).createIndex(index.keys, index.options);
    const originalMaterials = collections.materialsCol;
    restore.push(installModuleValue('server/src/components/mongodb/collections.ts', { ...collections, materialsCol: () => new Proxy(originalMaterials(), { get(collection, key) {
      if (key === 'insertOne') return async (doc: Material, ...args: unknown[]) => {
        if (partialInjection && doc.courseId.equals(partialCourseId) && doc.name === sources[2].name) {
          partialInjection = false; injectedFailures++; throw new Error('quality-lab-injected-third-material-insert-failure');
        }
        return Reflect.apply(collection.insertOne, collection, [doc, ...args]);
      };
      const value = Reflect.get(collection, key); return typeof value === 'function' ? value.bind(collection) : value;
    } }) }));
    await collections.coursesCol().insertMany([{ _id: courseId, ...syntheticCourse(actor, 'main') }, { _id: partialCourseId, ...syntheticCourse(actor, 'partial failure') }]);
    const authoring = loadModule(path.join(ROOT, 'server/src/services/authoring-commit.service.ts')) as typeof AuthoringModule;
    observations.authoringTopology = await authoring.initializeAuthoringCommitSupport();
    const coldCounts = async () => ({ sourceExtractions: await collections.sourceEvidenceExtractionsCol().countDocuments({ courseId }),
      structureRuns: await collections.contentRunsCol().countDocuments({ courseId, kind: 'structure-generation' }) });
    observations.coldBefore = await coldCounts(); assertColdMultipartCounts(observations.coldBefore as Parameters<typeof assertColdMultipartCounts>[0]);
    if (mode === 'real-index') {
      const real = loadModule(path.join(ROOT, 'server/src/components/qdrant/index.ts')) as typeof QdrantModule;
      indexedQdrant = real.qdrant;
      const collection = `course-${courseId.toHexString()}`;
      const scoped = (fn: (...args: never[]) => Promise<unknown>) => (name: string, ...args: unknown[]) => { assert.equal(name, collection); return Reflect.apply(fn, real, [name, ...args]); };
      const before = await real.qdrant.getCollections(); assert(!before.collections.some(row => row.name === collection), 'The owned Qdrant collection must also start cold.');
      restore.push(installModuleValue('server/src/components/qdrant/index.ts', { ...real, ensureCollection: scoped(real.ensureCollection as never),
        deletePointsByFilter: scoped(real.deletePointsByFilter as never), upsertPoints: scoped(real.upsertPoints as never),
        search: blocked('qdrant-search'), deleteCollectionIfExists: blocked('qdrant-delete-collection') }));
    }
    const { materialsRouter } = loadModule(path.join(ROOT, 'server/src/routes/materials.routes.ts')) as typeof MaterialsRoutesModule;
    const { errorHandler } = loadModule(path.join(ROOT, 'server/src/middleware/error-handler.ts')) as typeof ErrorModule;
    const app = express(); app.use(express.json());
    const user: User = { puid: actor, uid: actor, displayName: 'Owned multipart fixture', email: 'quality-fixture@example.invalid', affiliations: [], isAdmin: false,
      courseRoles: [{ courseId, role: 'instructor' }, { courseId: partialCourseId, role: 'instructor' }], createdAt: new Date(), lastLoginAt: new Date() };
    app.use((req, res, next) => {
      const role = req.get('x-quality-test-auth'); req.isAuthenticated = (() => role !== 'signed-out') as Request['isAuthenticated'];
      req.user = role === 'no-course' ? { ...user, courseRoles: [] } : role === 'other-actor' ? { ...user, puid: `${actor}-other` } : user;
      const json = res.json.bind(res); res.json = ((body: unknown) => {
        for (const file of (req.files as Express.Multer.File[] | undefined) ?? []) uploadedPaths.add(file.path);
        return json(body);
      }) as Response['json']; next();
    });
    app.use('/api', materialsRouter); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve, reject) => { server!.once('listening', resolve); server!.once('error', reject); });
    const address = server.address(); assert(address && typeof address !== 'string'); ports.add(address.port);
    const client = request(server);
    const requestMetadata = new WeakMap<request.Test, unknown>();
    const files: IntendedUploadFile[] = sources.map((source, index) => ({ clientFileId: `original-${index + 1}`, name: source.name, size: source.size }));
    const base = (id: ObjectId) => `/api/courses/${id.toHexString()}`;
    const record = async (label: string, pending: request.Test, expected: number) => {
      await assertCurrent();
      const metadata = requestMetadata.get(pending) as { parts?: Array<{ publicPdf?: string; pdfSha256?: string }> } | undefined;
      for (const part of metadata?.parts ?? []) if (part.publicPdf) assert.equal(hash(await fs.readFile(part.publicPdf)), part.pdfSha256, 'Original multipart bytes changed.');
      const response = await pending.timeout({ response: 120000, deadline: 180000 });
      http.push({ label, method: pending.method, path: new URL(pending.url).pathname, request: requestMetadata.get(pending) ?? null,
        status: response.status, response: response.body }); await save(); assert.equal(response.status, expected, label); return response.body;
    };
    const prepare = (id: ObjectId, requestId: string, intended = files) => {
      const body = { requestId, files: intended }; const pending = client.post(`${base(id)}/material-upload-batches`).send(body);
      requestMetadata.set(pending, body); return pending;
    };
    const upload = (id: ObjectId, batchId: string, selected = sources) => {
      let pending = client.post(`${base(id)}/material-upload-batches/${batchId}/files`);
      for (const source of selected) pending = pending.attach('files', source.publicPdf, { filename: source.name, contentType: 'application/pdf' });
      requestMetadata.set(pending, { encoding: 'real-multipart/form-data', field: 'files',
        parts: selected.map(({ name, size, pdfSha256, publicPdf }) => ({ name, size, pdfSha256, publicPdf })) });
      return pending;
    };
    const readiness = async (label: string, id: ObjectId, batchId: string, intended = files, readyCount = 0) => {
      const report = await record(label, client.post(`${base(id)}/source-readiness`).send({ sourceBatchId: batchId }), 200);
      assertIntendedReadiness(report, intended, readyCount); return report;
    };
    await record('signed-out guard', prepare(courseId, randomUUID()).set('x-quality-test-auth', 'signed-out'), 401);
    await record('foreign-course guard', prepare(courseId, randomUUID()).set('x-quality-test-auth', 'no-course'), 403);
    const requestId = randomUUID(); const prepared = await record('prepare ten originals', prepare(courseId, requestId), 201); const batchId = String(prepared._id);
    assert.equal(prepared.counts.requested, 10); assert.equal(prepared.counts.received, 0); assert.equal(prepared.admission, 'prepared');
    const repeated = await record('same request manifest replays', prepare(courseId, requestId), 201); assert.equal(repeated._id, batchId);
    await record('changed manifest conflicts', prepare(courseId, requestId, files.map((file, index) => index ? file : { ...file, name: 'changed.pdf' })), 409);
    await record('another actor cannot read receipt', client.get(`${base(courseId)}/material-upload-batches/${batchId}`).set('x-quality-test-auth', 'other-actor'), 404);
    await readiness('all ten intended before bytes', courseId, batchId);
    const missing = await record('nine of ten real PDFs rejected', upload(courseId, batchId, sources.slice(0, 9)), 400); observations.missingResponse = missing;
    const rejected = await record('missing-file durable receipt', client.get(`${base(courseId)}/material-upload-batches/${batchId}`), 200);
    assert.deepEqual(rejected.counts, { requested: 10, received: 0, ready: 0, rejected: 10 });
    assert.equal(await collections.materialsCol().countDocuments({ courseId }), 0); assert.equal(queued.length, 0);
    await readiness('missing-file all-source remains blocked', courseId, batchId);
    const accepted = await record('retry same batch with all ten real PDFs', upload(courseId, batchId), 201);
    assert.deepEqual(accepted.counts, { requested: 10, received: 10, ready: 0, rejected: 0 }); assert.equal(accepted.admission, 'accepted');
    const mainMaterials = await collections.materialsCol().find({ courseId }).sort({ uploadedAt: 1, _id: 1 }).toArray(); assert.equal(mainMaterials.length, 10);
    for (const source of sources) {
      const material = mainMaterials.find(row => row.name === source.name); assert(material?.storagePath && material.activeRunId);
      assert.equal(material.uploadFingerprint?.sha256, source.pdfSha256); assert.equal(hash(await fs.readFile(material.storagePath)), source.pdfSha256);
      allowedAdvisoryMaterials.add(material._id.toHexString());
    }
    assert.equal(queued.length, 10); await readiness('accepted admission is not indexed readiness', courseId, batchId);
    const replay = await record('accepted upload replays without another body', client.post(`${base(courseId)}/material-upload-batches/${batchId}/files`), 200);
    assert.deepEqual(replay.counts, accepted.counts); assert.equal(queued.length, 10); assert.equal(await collections.materialsCol().countDocuments({ courseId }), 10);
    observations.mainAdmission = { batchId, requestId, receipt: accepted, exactOriginalBytesVerified: 10, sourceIds: mainMaterials.map(row => row._id.toHexString()),
      runIds: mainMaterials.map(row => row.activeRunId!.toHexString()) };

    const oversized = files.map((file, index) => index ? file : { ...file, name: `OVERSIZE synthetic control - ${file.name}`, size: MULTIPART_FILE_LIMIT + 1 });
    const oversizeBatch = await record('prepare ten-name oversize control', prepare(courseId, randomUUID(), oversized), 201);
    const stream = Readable.from((function* () { let remaining = MULTIPART_FILE_LIMIT + 1; while (remaining) { const size = Math.min(65536, remaining); remaining -= size; yield Buffer.alloc(size); } })());
    // Superagent accepts generic readable streams; its declaration narrows the
    // supported stream shape to fs.ReadStream despite the runtime contract.
    const oversizeUpload = client.post(`${base(courseId)}/material-upload-batches/${oversizeBatch._id}/files`)
      .attach('files', stream as unknown as Parameters<request.Test['attach']>[1], { filename: oversized[0].name, contentType: 'application/pdf' });
    requestMetadata.set(oversizeUpload, { encoding: 'real-multipart/form-data', field: 'files', synthetic: true, byteValue: 0,
      parts: [{ name: oversized[0].name, size: MULTIPART_FILE_LIMIT + 1 }], purpose: 'Actual Multer file-size limit; no public PDF identity claim.' });
    await record('real Multer oversize multipart rejection', oversizeUpload, 413);
    const oversizeReceipt = await record('oversize complete durable receipt', client.get(`${base(courseId)}/material-upload-batches/${oversizeBatch._id}`), 200);
    assert.deepEqual(oversizeReceipt.counts, { requested: 10, received: 0, ready: 0, rejected: 10 });
    await readiness('oversize preserves all intended names', courseId, String(oversizeBatch._id), oversized);
    assert.equal(await collections.materialsCol().countDocuments({ courseId }), 10); observations.oversize = { synthetic: true, receipt: oversizeReceipt };

    const partial = await record('prepare independent partial-persistence course', prepare(partialCourseId, randomUUID()), 201);
    partialInjection = true; await record('third Material insert fails after two committed receipts', upload(partialCourseId, String(partial._id)), 500);
    assert.equal(injectedFailures, 1); const partialReceipt = await record('partial committed receipt reload', client.get(`${base(partialCourseId)}/material-upload-batches/${partial._id}`), 200);
    assert.deepEqual(partialReceipt.counts, { requested: 10, received: 2, ready: 0, rejected: 8 });
    const firstIds = partialReceipt.items.slice(0, 2).map((item: { materialId: string }) => item.materialId);
    await readiness('partial admission never drops remaining eight sources', partialCourseId, String(partial._id));
    const recovered = await record('retry partial batch reuses two and creates eight', upload(partialCourseId, String(partial._id)), 201);
    assert.deepEqual(recovered.counts, { requested: 10, received: 10, ready: 0, rejected: 0 });
    assert.deepEqual(recovered.items.slice(0, 2).map((item: { materialId: string }) => item.materialId), firstIds);
    assert.deepEqual(recovered.items.slice(0, 2).map((item: { disposition: string }) => item.disposition), ['reused', 'reused']);
    assert.equal(await collections.materialsCol().countDocuments({ courseId: partialCourseId }), 10);
    assert.equal(queued.length, 20); observations.partial = { injectedOperation: 'third Material insert before commit', before: partialReceipt, after: recovered };
    await readiness('partial recovery still waits for real indexing', partialCourseId, String(partial._id));

    observations.coldAfterAdmission = await coldCounts(); assertColdMultipartCounts(observations.coldAfterAdmission as Parameters<typeof assertColdMultipartCounts>[0]);
    assert.equal(await collections.materialChunksCol().countDocuments({ courseId }), 0);
    if (mode === 'real-index') {
      status = 'indexing'; await save();
    const { ingestMaterial } = loadModule(path.join(ROOT, 'server/src/services/materials.service.ts')) as typeof MaterialsModule;
      const indexed = [];
      for (const [index, source] of sources.entries()) {
        await assertCurrent(); const material = mainMaterials.find(row => row.name === source.name)!; const before = Date.now();
        await ingestMaterial(material._id.toHexString(), material.activeRunId!.toHexString());
        const current = await collections.materialsCol().findOne({ _id: material._id, courseId }); assert(current?.sourceManifest && current.status === 'ready');
        const run = await collections.contentRunsCol().findOne({ _id: material.activeRunId, courseId }); assert(run?.kind === 'material-ingest' && run.status === 'completed');
        assert.equal(run.result?.classification, 'warning');
        const chunks = await collections.materialChunksCol().find({ courseId, materialId: material._id }).sort({ index: 1 }).toArray();
        const vectorCount = await indexedQdrant!.count(`course-${courseId.toHexString()}`, { exact: true,
          filter: { must: [{ key: 'materialId', match: { value: material._id.toHexString() } }] } });
        assert.equal(vectorCount.count, chunks.length, 'Actual owned Qdrant points must match published original chunks.');
        const report = await readiness(`real index ${index + 1}/10 all-source receipt`, courseId, batchId, files, index + 1);
        indexed.push({ ...source, materialId: material._id.toHexString(), manifest: current.sourceManifest, parsedCharacterCount: run.result?.characterCount,
          qdrantIndexedCount: vectorCount.count,
          elapsedMs: Date.now() - before, readiness: report.requested.find((item: { materialId: string }) => item.materialId === material._id.toHexString()),
          chunks: chunks.map(({ index, text, characterCount }) => ({ index, text, characterCount })) });
        observations.indexedSources = indexed.map(({ chunks: _chunks, ...row }) => row); await save();
      }
      assert.equal(advisory.length, 10); observations.coldAfterIndex = await coldCounts(); assertColdMultipartCounts(observations.coldAfterIndex as Parameters<typeof assertColdMultipartCounts>[0]);
      const finalReceipt = await record('actual indexed ten-source batch receipt', client.get(`${base(courseId)}/material-upload-batches/${batchId}`), 200);
      assert.deepEqual(finalReceipt.counts, { requested: 10, received: 10, ready: 10, rejected: 0 });
      const actualFixture = { version: 1, courseId: courseId.toHexString(), actor, database, qdrantCollection: `course-${courseId.toHexString()}`,
        sourceBatchId: batchId, files: indexed.length, sources: indexed, createdAt: new Date().toISOString(), llmCalls: 0, sourceExtractionCalls: 0,
        copiedCacheRows: 0, embeddingProvider: env.embeddingsProvider, embeddingsModel: env.embeddingsModel, fixtureKind: 'http-upload-real-index',
        admission: { controls: path.resolve(output, 'controls.json'), results: path.resolve(output, 'results.json'), batchId, requestId, receipt: finalReceipt,
          auth: controls.auth, queue: 'Recorded enqueue only; actual ingestMaterial manually invoked after HTTP admission. No Agenda execution.' } };
      await fs.writeFile(path.join(output, 'corpus-fixture.json'), JSON.stringify(actualFixture, null, 2) + '\n', { flag: 'wx' });
      observations.fixture = path.resolve(output, 'corpus-fixture.json');
    }
    assert.equal(forbidden.length, 0, 'A blocked transport/component attempt cannot be hidden by a production warning.');
    await assertCurrent(); status = 'completed';
  } catch (caught) { status = 'stopped'; error = { message: caught instanceof Error ? caught.message : String(caught) }; process.exitCode = 1; }
  finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (connected) {
      // Retain canonical originals for inspection/full-outline use. Remove only
      // redundant files observed on this app's own multipart requests.
      const canonical = new Set((await mongo.getDb().collection('materials').find({ courseId: { $in: [courseId, partialCourseId] } }).toArray()).map(row => row.storagePath));
      for (const file of uploadedPaths) if (!canonical.has(file)) await fs.rm(file, { force: true });
      await mongo.closeMongo();
    }
    await save(); for (const undo of restore.reverse()) undo();
  }
  console.log(JSON.stringify({ status, mode, output: path.resolve(output), courseId: courseId.toHexString(), files: 10, providerCalls: 0, error }));
}

if (require.main === module) void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
