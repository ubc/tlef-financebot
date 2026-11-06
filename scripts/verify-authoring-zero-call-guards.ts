/** Root-executed, synthetic HTTP/Mongo authoring guard verification.
 * Default mode writes a file-only plan. --live once requires an empty, explicitly
 * named owned database. This is not a generation, model-quality or SAML test.
 * Every model, embedding, vector and job boundary throws if called. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire, Module } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import type { Express, Request } from 'express';
import type { WithId } from 'mongodb';
import type * as MongoDriver from 'mongodb';
import type * as ExpressModule from 'express';
import type * as SupertestModule from 'supertest';
import type { Course, User, Material, MaterialChunk } from '../server/src/types/domain';
import type { RegenerationCandidateRecord, RegenerationContent } from '../server/src/types/regeneration';
import type { GenerationQualityAssessment } from '../server/src/types/generation-quality';
import type * as MongoModule from '../server/src/components/mongodb';
import type * as CollectionsModule from '../server/src/components/mongodb/collections';
import type * as QuestionsModule from '../server/src/services/questions.service';
import type * as EvidenceModule from '../server/src/services/generation-evidence.service';
import type * as MemoryModule from '../server/src/services/generation-memory.service';
import type * as ContextModule from '../server/src/services/authoring-context.service';
import type * as EnvModule from '../server/src/config/env';
import type * as AuthoringModule from '../server/src/services/authoring-commit.service';
import type * as QualityModule from '../server/src/services/generation-quality.service';
import type * as ReadinessModule from '../server/src/services/source-readiness.service';
import type * as AdminModule from '../server/src/services/admin.service';
import type * as GenerationRoutes from '../server/src/routes/generation.routes';
import type * as QuestionRoutes from '../server/src/routes/questions.routes';
import type * as ErrorModule from '../server/src/middleware/error-handler';

const ROOT = path.resolve(__dirname, '..');
const load = createRequire(__filename);
export interface ZeroCallArguments { database: string; output: string; live: boolean }
export interface BoundaryAttempt { boundary: string; at: string }
export interface ZeroCallOwnershipRecord {
  _id: 'exclusive-zero-call-database-owner'; actor: string; database: string; createdAt: Date; scope: string; noCleanup: true;
}
export interface ZeroCallOwnershipCollection { insertOne(record: ZeroCallOwnershipRecord): Promise<unknown> }
/** Mongo's unique _id admits one owner even if two fresh processes both saw an empty database. */
export async function claimZeroCallDatabase(collection: ZeroCallOwnershipCollection,
  ownership: Omit<ZeroCallOwnershipRecord, '_id' | 'noCleanup'>): Promise<void> {
  await collection.insertOne({ ...ownership, _id: 'exclusive-zero-call-database-owner', noCleanup: true });
}
export function parseZeroCallArguments(argv: string[]): ZeroCallArguments {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    assert(['--database', '--output', '--live'].includes(key) && !(key in values) && value && !value.startsWith('--'), 'Unknown, duplicate or missing zero-call argument.');
    values[key] = value;
  }
  assert(values['--database'] && values['--output'], '--database and --output are required.');
  assert(/^financebot_quality_smoke_retest_zero_call_guards_[a-z0-9_]+$/.test(values['--database']), 'An explicitly owned zero-call database name is required.');
  assert(values['--live'] === undefined || values['--live'] === 'once', 'Only --live once can execute local requests.');
  return { database: values['--database'], output: path.resolve(values['--output']), live: values['--live'] === 'once' };
}
export function assertZeroCallTarget(uri: string, configuredDatabase: string, declaredDatabase: string): void {
  const url = new URL(uri);
  assert(url.protocol === 'mongodb:' && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
    && url.port === '27029' && !url.username && !url.password, 'Only credential-free loopback MongoDB on port 27029 is allowed.');
  assert(configuredDatabase === declaredDatabase && /^financebot_quality_smoke_retest_zero_call_guards_[a-z0-9_]+$/.test(declaredDatabase), 'MongoDB must match the declared owned zero-call database.');
}
export function deniedBoundary(attempts: BoundaryAttempt[], boundary: string): (...args: unknown[]) => never {
  return (..._args: unknown[]) => {
    attempts.push({ boundary, at: new Date().toISOString() });
    throw new Error(`zero-call-boundary-forbidden:${boundary}`);
  };
}
export function zeroCallSocketAllowed(host: string, port: number, httpPort?: number): boolean {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) && (port === 27029 || httpPort !== undefined && port === httpPort);
}

function installNetworkFence(attempts: BoundaryAttempt[]): { setHttpPort(port: number): void; restore(): void } {
  let httpPort: number | undefined;
  const originalConnect = net.Socket.prototype.connect;
  const originalFetch = globalThis.fetch;
  const deny = (boundary: string) => deniedBoundary(attempts, boundary)();
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first as { port?: number | string; host?: string; path?: string } : { port: first, host: args[1] };
    const host = String(options.host ?? 'localhost'); const port = Number(options.port);
    if ('path' in options && options.path || !zeroCallSocketAllowed(host, port, httpPort)) return deny(`network.socket:${host}:${port}`);
    return Reflect.apply(originalConnect, this, args) as net.Socket;
  } as typeof originalConnect;
  globalThis.fetch = async (resource, options) => {
    const url = new URL(typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url);
    if (url.username || url.password || !zeroCallSocketAllowed(url.hostname, Number(url.port), httpPort)
      || !['http:', 'https:'].includes(url.protocol) || Number(url.port) === 27029) return deny(`network.fetch:${url.hostname}:${url.port}`);
    return originalFetch(resource, options);
  };
  return { setHttpPort: port => { assert(Number.isSafeInteger(port) && port > 0); httpPort = port; },
    restore: () => { net.Socket.prototype.connect = originalConnect; globalThis.fetch = originalFetch; } };
}
function installDeniedExternalModules(attempts: BoundaryAttempt[]): () => void {
  const previous = new Map<string, NodeModule | undefined>();
  const denyObject = (boundary: string) => new Proxy({}, { get: (_target, property) => deniedBoundary(attempts, `${boundary}.${String(property)}`) });
  const fixtures: Array<[string, Record<string, unknown>]> = [
    ['server/src/components/genai/llm/index.ts', { completeJson: deniedBoundary(attempts, 'llm.completeJson'), llm: denyObject('llm'), withModelCallObserver: deniedBoundary(attempts, 'llm.withModelCallObserver') }],
    ['server/src/components/genai/embeddings/index.ts', Object.fromEntries(['getEmbeddings', 'embed', 'embedOne', 'getEmbeddingDimension'].map(name => [name, deniedBoundary(attempts, `embeddings.${name}`)]))],
    ['server/src/components/qdrant/index.ts', { qdrant: denyObject('qdrant'), ...Object.fromEntries(['collectionVectorSize', 'ensureCollection', 'upsertPoints', 'search', 'deletePointsByFilter', 'deleteCollectionIfExists', 'pingQdrant'].map(name => [name, deniedBoundary(attempts, `qdrant.${name}`)])) }],
    ['server/src/components/jobs/index.ts', Object.fromEntries(['startJobs', 'defineJob', 'enqueueJob', 'scheduleRecurring', 'hasPendingJob', 'cancelJobsByDataIds', 'stopJobs'].map(name => [name, deniedBoundary(attempts, `jobs.${name}`)]))],
  ];
  for (const [relative, exports] of fixtures) {
    const filename = load.resolve(path.join(ROOT, relative));
    assert(!load.cache[filename], 'External boundaries must be installed before loading production modules.');
    previous.set(filename, load.cache[filename]);
    const stub = new Module(filename); stub.filename = filename; stub.loaded = true; stub.exports = exports;
    load.cache[filename] = stub;
  }
  return () => { for (const [filename, value] of previous) { if (value) load.cache[filename] = value; else delete load.cache[filename]; } };
}
const runtime = <T>(relative: string): T => load(path.join(ROOT, relative)) as T;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const safeError = (value: unknown) => ({ name: value instanceof Error ? value.name : 'Error',
  message: (value instanceof Error ? value.message : String(value)).replace(/(mongodb:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[redacted]@').slice(0, 1800) });
async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`; await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await fs.rename(temporary, file);
}
async function codePins(): Promise<Array<{ file: string; sha256: string }>> {
  const files = ['scripts/verify-authoring-zero-call-guards.ts'];
  const visit = async (directory: string): Promise<void> => {
    for (const item of await fs.readdir(path.join(ROOT, directory), { withFileTypes: true })) {
      const relative = `${directory}/${item.name}`;
      if (item.isDirectory()) await visit(relative);
      else if (item.isFile() && item.name.endsWith('.ts')) files.push(relative);
      else if (item.isSymbolicLink()) throw new Error('Refuse symbolic links in the pinned server source tree.');
    }
  };
  await visit('server/src'); files.sort();
  return Promise.all(files.map(async file => ({ file, sha256: hash(await fs.readFile(path.join(ROOT, file))) })));
}

export async function runZeroCallGuards(args: ZeroCallArguments): Promise<void> {
  await fs.mkdir(args.output, { recursive: false });
  const pins = await codePins();
  const scope = 'Synthetic fixture: real HTTP/Mongo/currentness/adoption guards; no generation, semantic acceptance, model comparison, upload/indexing acceptance or real SAML authentication.';
  const plan = { version: 1, scope, database: args.database, maximumModelSends: 0, maximumEmbeddingCalls: 0, maximumVectorCalls: 0, maximumJobCalls: 0, code: pins,
    boundaries: 'Only model/embedding/vector/job integration modules are replaced by counted throwing boundaries. Production routers, collections, source/memory checks and adoption remain real.',
    originalExperiments: 'No historical fixture database, model declaration, transcript or ledger is changed. This run creates and retains a separate owned database.' };
  await fs.writeFile(path.join(args.output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  if (!args.live) { console.log(JSON.stringify({ preflight: true, databaseCalls: 0, providerCalls: 0, output: args.output })); return; }
  const attempts: BoundaryAttempt[] = []; const observations: Array<Record<string, unknown>> = []; const http: Array<Record<string, unknown>> = [];
  // Must precede all Express/Mongo/production runtime imports, including env.
  const fence = installNetworkFence(attempts);
  let restoreModules = () => {};
  const actor = `QUALITY-ZERO-CALL-${randomUUID()}`; const ownedCourseIds: string[] = [];
  const startedAt = new Date(); let status = 'preparing'; let error: unknown; let topology: unknown;
  let mongo: typeof MongoModule | undefined; let appServer: ReturnType<Express['listen']> | undefined;
  let ownsMongoConnection = false;
  let readCounts: (() => Promise<Record<string, number>>) | undefined;
  const save = async () => {
    let databaseCounts: Record<string, number> | null = null; let databaseCountReadError: ReturnType<typeof safeError> | null = null;
    try { databaseCounts = readCounts ? await readCounts() : null; } catch (failure) { databaseCountReadError = safeError(failure); }
    await writeJson(path.join(args.output, 'results.json'), { version: 1, scope, status, actor, database: args.database,
    startedAt, elapsedMs: Date.now() - startedAt.getTime(), topology, code: pins, ownedCourseIds, http, observations,
    boundaryAttempts: attempts, databaseCounts, databaseCountReadError,
    reportedModelSends: 0, reportedEmbeddingCalls: 0, error: error ? safeError(error) : null,
    caveat: 'An eligible candidate is seeded synthetic state solely to reach adoption guards, not a model or teacher verdict. Production source packets and memory snapshots are computed against owned Mongo originals.' });
  };
  try {
    restoreModules = installDeniedExternalModules(attempts);
    assert.deepEqual(await codePins(), pins, 'Code or server source file list changed before runtime admission.');
    const { env } = runtime<typeof EnvModule>('server/src/config/env.ts');
    assertZeroCallTarget(env.mongodbUri, env.mongodbDbName, args.database);
    mongo = runtime<typeof MongoModule>('server/src/components/mongodb/index.ts');
    let cachedDatabase: MongoDriver.Db | undefined;
    try { cachedDatabase = mongo.getDb(); } catch (failure) {
      assert(failure instanceof Error && failure.message === 'MongoDB is not connected. Call connectMongo() during startup first.', 'Cannot prove MongoDB runtime is uninitialized.');
    }
    assert.equal(cachedDatabase, undefined, 'Refuse a previously connected MongoDB runtime; use a fresh process.');
    const db = await mongo.connectMongo();
    ownsMongoConnection = true;
    assert.equal(db.databaseName, args.database, 'Connected database must match the explicitly declared owned target.');
    assert.equal((await db.listCollections({}, { nameOnly: true }).toArray()).length, 0, 'Refuse every nonempty database; never resume or overwrite another fixture.');
    await claimZeroCallDatabase(db.collection<ZeroCallOwnershipRecord>('qualityLabZeroCallGuardOwnership'),
      { actor, database: args.database, createdAt: startedAt, scope });
    const collections = runtime<typeof CollectionsModule>('server/src/components/mongodb/collections.ts');
    for (const spec of collections.INDEX_SPECS.filter(item => item.collection === 'regenerationCandidates')) await db.collection(spec.collection).createIndex(spec.keys, spec.options);
    const authoring = runtime<typeof AuthoringModule>('server/src/services/authoring-commit.service.ts');
    topology = await authoring.initializeAuthoringCommitSupport();
    const questions = runtime<typeof QuestionsModule>('server/src/services/questions.service.ts');
    const evidence = runtime<typeof EvidenceModule>('server/src/services/generation-evidence.service.ts');
    const memory = runtime<typeof MemoryModule>('server/src/services/generation-memory.service.ts');
    const context = runtime<typeof ContextModule>('server/src/services/authoring-context.service.ts');
    const quality = runtime<typeof QualityModule>('server/src/services/generation-quality.service.ts');
    const readiness = runtime<typeof ReadinessModule>('server/src/services/source-readiness.service.ts');
    const admin = runtime<typeof AdminModule>('server/src/services/admin.service.ts');
    const { ObjectId: Id } = load('mongodb') as typeof MongoDriver;
    const express = load('express') as typeof ExpressModule.default; const request = load('supertest') as typeof SupertestModule.default;
    const user: User = { puid: actor, uid: actor, email: 'zero-call@example.invalid', displayName: 'Synthetic zero-call guard instructor', affiliations: [], isAdmin: false, courseRoles: [], createdAt: startedAt, lastLoginAt: startedAt };
    const app = express(); app.use(express.json()); app.use((req, _res, next) => {
      const auth = req.get('x-zero-call-auth'); req.isAuthenticated = (() => auth !== 'signed-out') as Request['isAuthenticated'];
      req.user = auth === 'foreign' ? { ...user, puid: `${actor}-foreign`, courseRoles: [] } : user; next();
    });
    app.use('/api', runtime<typeof GenerationRoutes>('server/src/routes/generation.routes.ts').generationRouter,
      runtime<typeof QuestionRoutes>('server/src/routes/questions.routes.ts').questionsRouter);
    app.use(runtime<typeof ErrorModule>('server/src/middleware/error-handler.ts').errorHandler);
    appServer = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve, reject) => { appServer!.once('listening', resolve); appServer!.once('error', reject); });
    const address = appServer!.address(); assert(address && typeof address !== 'string'); fence.setHttpPort(address.port);
    const client = request(appServer);
    readCounts = async () => Object.fromEntries(await Promise.all(['courses', 'questions', 'questionVersions', 'regenerationCandidates', 'modelCallReceipts', 'modelUsageSessions', 'contentRuns', 'agendaJobs'].map(async name => [name, await db.collection(name).countDocuments({})])));
    const send = async (label: string, method: 'get' | 'post' | 'patch', url: string, body: unknown, expected: number, auth?: string) => {
      let pending = client[method](url); if (auth) pending = pending.set('x-zero-call-auth', auth); if (body !== undefined) { assert(body !== null && typeof body === 'object'); pending = pending.send(body); }
      const operation: Record<string, unknown> = { label, method: method.toUpperCase(), url, auth: auth ?? 'owned-fixture-instructor', request: body ?? null,
        expectedStatus: expected, startedAt: new Date(), responseState: 'pending', status: null, response: null };
      http.push(operation); await save();
      try {
        const response = await pending.timeout({ response: 5000, deadline: 15000 });
        Object.assign(operation, { responseState: 'received', status: response.status, response: response.body as unknown, completedAt: new Date() });
        await save(); assert.equal(response.status, expected, `${label}: ${JSON.stringify(response.body)}`); assert.equal(attempts.length, 0, 'Any external boundary attempt invalidates the zero-call run.'); return response;
      } catch (failure) {
        if (operation.responseState === 'pending') operation.responseState = 'unknown-after-error';
        Object.assign(operation, { error: safeError(failure), failedAt: new Date() }); await save(); throw failure;
      }
    };
    const fixture = async (label: string, withCandidate = true) => {
      const courseId = new Id(), themeId = new Id(), loId = new Id(), materialId = new Id(), now = new Date();
      const course: Course = { name: `Zero-call ${label}`, courseCode: `QZC-${courseId.toHexString().slice(-6)}`, term: '2026W1', ownerPuid: actor, registrationCode: randomUUID(), published: false, lifecycle: 'draft', feedbackStrategy: 'adaptive',
        autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: now };
      await collections.coursesCol().insertOne({ _id: courseId, ...course }); ownedCourseIds.push(courseId.toHexString()); user.courseRoles.push({ courseId, role: 'instructor' });
      await collections.themesCol().insertOne({ _id: themeId, courseId, name: 'Synthetic source guard', order: 1 });
      await collections.losCol().insertOne({ _id: loId, courseId, themeId, name: 'Explain beta as systematic risk.', order: 1, kind: 'conceptual' });
      const text = 'Beta measures systematic risk. Total volatility also includes company-specific risk.';
      const chunk: MaterialChunk = { courseId, materialId, index: 0, text, characterCount: text.length, createdAt: now };
      const material: Material = { courseId, name: 'Synthetic guard source.txt', format: 'txt', kind: 'reading', status: 'ready', revision: 1, assignments: [{ themeId, loId }], uploadedAt: now,
        sourceManifest: { version: 1, sourceTextHash: readiness.hashSourceChunks([chunk]), chunkCount: 1, characterCount: text.length, indexedCount: 1, parserVersion: 'synthetic-guard-fixture-v1', chunkerVersion: 'synthetic-one-chunk-v1', indexedAt: now } };
      await collections.materialChunksCol().insertOne(chunk); await collections.materialsCol().insertOne({ _id: materialId, ...material });
      const original = await questions.createQuestion({ courseId, themeIds: [themeId], loIds: [loId], createdBy: actor, type: 'true-false', numericKind: 'conceptual', difficulty: 'easy', stem: 'Beta measures systematic risk.',
        options: [{ key: 'A', text: 'True', role: 'correct', explanation: 'Beta measures systematic risk.' }, { key: 'B', text: 'False', role: 'common-misconception', explanation: 'Total volatility includes company-specific risk, while beta measures systematic risk.' }] });
      const neighbor = await questions.createQuestion({ courseId, themeIds: [themeId], loIds: [loId], createdBy: actor, type: 'true-false', numericKind: 'conceptual', difficulty: 'easy', stem: 'Total volatility includes only systematic risk.',
        options: [{ key: 'A', text: 'True', role: 'common-misconception', explanation: 'Total volatility also includes company-specific risk.' }, { key: 'B', text: 'False', role: 'correct', explanation: 'Total volatility also includes company-specific risk.' }] });
      const prompt = 'Change the opening wording only.'; const requestId = randomUUID();
      const body = { qualityPolicy: 'grounded-memory-v2', intent: 'edit-existing', prompt, requestId, expectedVersionId: original.version._id.toHexString() };
      const requirements = context.normalizeAuthoringRequirements({ intent: 'edit-existing', prompt, original: quality.snapshotQualityCandidate(original.version), requestedDifficulty: 'easy' });
      const packet = await evidence.buildGenerationEvidence({ courseId, loIds: [loId], allowedMaterials: [{ materialId: materialId.toHexString(), role: 'primary', loId: loId.toHexString(), loName: 'Explain beta as systematic risk.' }],
        seeds: [{ materialId: materialId.toHexString(), chunkIndex: 0, text }], policyVersion: 'grounded-memory-v2' });
      const bankMemory = await memory.loadGenerationMemory({ courseId, loIds: [loId], excludeQuestionId: original.questionId, includeCrossLo: true });
      const contextId = context.authoringHash({ evidence: packet.id, memory: bankMemory.snapshotDigest, requirements });
      await context.assertAuthoringContextCurrent({ id: contextId, evidence: packet, memory: bankMemory, requirements }, { courseId, loIds: [loId], excludeQuestionId: original.questionId });
      const candidate: RegenerationContent = { stem: 'Does beta measure systematic risk?', options: original.version.options, difficulty: 'easy', numericKind: 'conceptual', sourceRefs: [{ materialId, chunk: text }],
        agentDecision: { decision: 'pass', reasoning: 'Synthetic guard eligibility only; not a model or teacher quality verdict.', roleAssessment: 'Synthetic two-option guard fixture.' } };
      const candidateId = new Id(); const settings = await admin.getPlatformSettings();
      const assessment: GenerationQualityAssessment = { policy: 'grounded-memory-v2', item: 0, status: 'eligible', sourceSupport: 'supported', notation: 'consistent', novelty: 'variant',
        reasons: ['Synthetic seeded eligibility only; no model or teacher evaluation occurred.'], citations: [], matchedEntryIds: [], evidencePacketId: packet.id, memoryDigest: bankMemory.snapshotDigest, checkedAt: now,
        coverage: { evidenceTruncated: false, memoryTruncated: false, shownEntries: bankMemory.entries.length, totalEntries: bankMemory.entries.length, missingVersions: 0, consistency: 'best-effort' } };
      const record: WithId<RegenerationCandidateRecord> = { _id: candidateId, courseId, questionId: original.questionId, requestedBy: actor, requestId,
        requestHash: context.authoringHash({ questionId: original.questionId.toHexString(), original: body.expectedVersionId, prompt, intent: requirements.intent, requiredChanges: requirements.requiredChanges, preserve: requirements.preserve }),
        policy: 'grounded-memory-v2', originalVersionId: original.version._id, original: original.version, originalState: 'draft', originalTags: { loIds: [loId], themeIds: [themeId] }, prompt, requirements,
        status: 'eligible', candidate, candidateHash: context.authoringHash(candidate), evidence: packet, memory: bankMemory, contextId,
        models: { generator: settings.models.generator, validator: settings.models.validator, reviewer: settings.models.reviewer }, quality: assessment, reasons: assessment.reasons,
        usageRunId: `synthetic-zero-call:${candidateId}`, createdAt: now, updatedAt: now };
      if (withCandidate) await collections.regenerationCandidatesCol().insertOne(record);
      const base = `/api/courses/${courseId}/questions/${original.questionId}`;
      return { label, courseId, loId, materialId, original, neighbor, body, record, base };
    };
    const current = async (item: Awaited<ReturnType<typeof fixture>>) => ({ head: await collections.questionsCol().findOne({ _id: item.original.questionId }),
      versions: await collections.questionVersionsCol().find({ questionId: item.original.questionId }).sort({ version: 1 }).toArray(), candidate: await collections.regenerationCandidatesCol().findOne({ _id: item.record._id }) });
    const guard = async (label: string, work: () => Promise<unknown>) => { const result = await work(); observations.push({ label, status: 'passed', maximumProviderSends: 0, result }); await save(); };
    status = 'running'; await save();
    await guard('stale-original-new-uuid', async () => {
      const item = await fixture('stale-original-admission', false);
      await send('manual-original-edit', 'patch', `/api/questions/${item.original.questionId}`, { stem: 'The lecture uses beta for systematic risk.', expectedVersionId: item.body.expectedVersionId }, 200);
      const before = await current(item);
      const response = await send('stale-original-admission', 'post', `${item.base}/regenerate`, item.body, 409);
      assert.equal(response.body.error, 'question-changed-during-regeneration'); assert.deepEqual(await current(item), before);
      assert.equal(await collections.regenerationCandidatesCol().countDocuments({ courseId: item.courseId }), 0);
      return { courseId: item.courseId, originalVersionId: item.body.expectedVersionId, rejectedBeforeCandidateInsert: true };
    });
    await guard('uuid-replay-conflict-and-stale-replay', async () => {
      const item = await fixture('uuid-replay');
      for (const auth of ['signed-out', 'foreign']) await send(`unauthorized-${auth}`, 'post', `${item.base}/regenerate`, item.body, auth === 'signed-out' ? 401 : 403, auth);
      const before = await current(item);
      const replay = await send('same-uuid-replay', 'post', `${item.base}/regenerate`, item.body, 200); assert.equal(replay.body.candidateId, item.record._id.toHexString());
      const conflict = await send('different-prompt-same-uuid', 'post', `${item.base}/regenerate`, { ...item.body, prompt: 'Change the requested learning task.' }, 409); assert.equal(conflict.body.error, 'regeneration-request-conflict');
      assert.deepEqual(await current(item), before);
      await send('edit-after-retained-candidate', 'patch', `/api/questions/${item.original.questionId}`, { stem: 'Beta is a systematic-risk measure.', expectedVersionId: item.body.expectedVersionId }, 200);
      const staleBefore = await current(item);
      const cached = await send('cached-stale-uuid-is-read-only', 'post', `${item.base}/regenerate`, item.body, 200); assert.equal(cached.body.candidateId, item.record._id.toHexString());
      const fresh = await send('new-uuid-stale-version', 'post', `${item.base}/regenerate`, { ...item.body, requestId: randomUUID() }, 409); assert.equal(fresh.body.error, 'question-changed-during-regeneration');
      const denied = await send('stale-candidate-adoption', 'post', `${item.base}/regeneration-candidates/${item.record._id}/adopt`, { expectedVersionId: item.body.expectedVersionId }, 409); assert.equal(denied.body.error, 'question-changed-during-regeneration');
      assert.deepEqual(await current(item), staleBefore); return { courseId: item.courseId, cachedCandidateId: item.record._id, staleAdoptionDenied: true };
    });
    await guard('stale-original-source-revision', async () => {
      const item = await fixture('source-revision'); await collections.materialsCol().updateOne({ _id: item.materialId }, { $inc: { revision: 1 } });
      assert.equal((await readiness.getMaterialSourceReadiness(item.courseId, item.materialId)).ready, true, 'Revision-only mutation must retain a valid manifest, isolating source fingerprint staleness.');
      const before = await current(item); const response = await send('stale-source-adoption', 'post', `${item.base}/regeneration-candidates/${item.record._id}/adopt`, { expectedVersionId: item.body.expectedVersionId }, 409);
      assert.equal(response.body.error, 'generation-evidence-source-changed'); assert.deepEqual(await current(item), before); return { courseId: item.courseId, isolatedSourceRevisionChange: true };
    });
    await guard('stale-bank-neighbor', async () => {
      const item = await fixture('bank-memory');
      await send('manual-neighbor-edit', 'patch', `/api/questions/${item.neighbor.questionId}`, { stem: 'Total risk includes company-specific and market-wide risk.', expectedVersionId: item.neighbor.version._id.toHexString() }, 200);
      const before = await current(item); const response = await send('stale-memory-adoption', 'post', `${item.base}/regeneration-candidates/${item.record._id}/adopt`, { expectedVersionId: item.body.expectedVersionId }, 409);
      assert.equal(response.body.error, 'authoring-memory-changed'); assert.deepEqual(await current(item), before); return { courseId: item.courseId, changedNeighborQuestionId: item.neighbor.questionId };
    });
    await guard('candidate-content-hash', async () => {
      const item = await fixture('candidate-hash'); await collections.regenerationCandidatesCol().updateOne({ _id: item.record._id }, { $set: { 'candidate.stem': 'Synthetic unassessed tampered content.' } });
      const before = await current(item); const response = await send('tampered-candidate-adoption', 'post', `${item.base}/regeneration-candidates/${item.record._id}/adopt`, { expectedVersionId: item.body.expectedVersionId }, 422);
      assert.equal(response.body.error, 'regeneration-candidate-not-eligible'); assert.deepEqual(await current(item), before); return { courseId: item.courseId, changedWithoutHash: true };
    });
    await guard('independent-original-comparison', async () => {
      const item = await fixture('missing-independent-comparison'); await collections.regenerationCandidatesCol().updateOne({ _id: item.record._id }, { $set: { 'requirements.intent': 'create-independent-task' } });
      const before = await current(item); const response = await send('missing-independent-comparison-adoption', 'post', `${item.base}/regeneration-candidates/${item.record._id}/adopt`, { expectedVersionId: item.body.expectedVersionId }, 422);
      assert.equal(response.body.error, 'regeneration-original-comparison-required'); assert.deepEqual(await current(item), before); return { courseId: item.courseId, missingComparatorDenied: true };
    });
    if (authoring.authoringCommitAvailable()) await guard('stale-objective-transaction-fence', async () => {
      const item = await fixture('objective-fence');
      await collections.losCol().updateOne({ _id: item.loId }, { $set: { name: 'Synthetic instructor changed the objective after candidate preparation.' } });
      const before = await current(item); const materialBefore = await collections.materialsCol().findOne({ _id: item.materialId });
      const response = await send('stale-objective-adoption', 'post', `${item.base}/regeneration-candidates/${item.record._id}/adopt`, { expectedVersionId: item.body.expectedVersionId }, 409);
      assert.equal(response.body.error, 'authoring-objective-changed'); assert.deepEqual(await current(item), before);
      assert.deepEqual(await collections.materialsCol().findOne({ _id: item.materialId }), materialBefore, 'An objective conflict must roll back earlier source fence writes.');
      return { courseId: item.courseId, objectiveId: item.loId, transactionFenceRolledBack: true };
    });
    else observations.push({ label: 'stale-objective-transaction-fence', status: 'not-executed', reason: 'Coordinated transactions unavailable.' });
    if (authoring.authoringCommitAvailable()) await guard('synthetic-positive-adoption-and-replay', async () => {
      const item = await fixture('positive-adoption'); const before = await current(item);
      const adopted = await send('synthetic-positive-adopt', 'post', `${item.base}/regeneration-candidates/${item.record._id}/adopt`, { expectedVersionId: item.body.expectedVersionId }, 200);
      const replay = await send('synthetic-adoption-replay', 'post', `${item.base}/regeneration-candidates/${item.record._id}/adopt`, { expectedVersionId: item.body.expectedVersionId }, 200);
      assert.equal(replay.body.version._id, adopted.body.version._id);
      const after = await current(item); assert.equal(after.versions.length, before.versions.length + 1); assert.equal(after.candidate?.status, 'adopted');
      assert.equal(after.head?.currentVersionId.toHexString(), adopted.body.version._id);
      return { courseId: item.courseId, adoptedVersionId: adopted.body.version._id, versionsAdded: 1, seededEligibilityNotQualityEvidence: true };
    });
    else observations.push({ label: 'synthetic-positive-adoption-and-replay', status: 'not-executed', reason: 'Coordinated transactions unavailable; negative currentness checks remain independently testable.' });
    assert.equal(attempts.length, 0); const counts = await readCounts();
    for (const name of ['modelCallReceipts', 'modelUsageSessions', 'contentRuns', 'agendaJobs']) assert.equal(counts[name], 0, `${name} must remain empty.`);
    assert.equal(await collections.coursesCol().countDocuments({ ownerPuid: { $ne: actor } }), 0);
    assert.deepEqual(await codePins(), pins, 'Code or server source file list changed during the local guard experiment.');
    status = 'completed'; await save(); console.log(JSON.stringify({ status, observations: observations.length, modelSends: 0, boundaryAttempts: attempts.length, output: args.output }));
  } catch (caught) { error = caught; status = 'stopped'; await save(); throw caught; }
  finally {
    try { if (appServer) await new Promise<void>((resolve, reject) => appServer!.close(caught => caught ? reject(caught) : resolve())); }
    finally { try { if (mongo && ownsMongoConnection) await mongo.closeMongo(); } finally { restoreModules(); fence.restore(); } }
  }
}
export async function main(): Promise<void> { await runZeroCallGuards(parseZeroCallArguments(process.argv.slice(2))); }
if (require.main === module) void main().catch(error => { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; });
