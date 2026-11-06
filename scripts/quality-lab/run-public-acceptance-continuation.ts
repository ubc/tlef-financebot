/** Root-only missing-only continuation. No completed public case is rerun.
 * Real production HTTP guards, Agenda and durable authoring gates are retained. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import express, { type Request } from 'express';
import request from 'supertest';
import { ObjectId, type WithId } from 'mongodb';
import type { Course, Material, MaterialChunk, QuestionVersion, User } from '../../server/src/types/domain';
import type { ModelCallReceipt } from '../../server/src/types/model-usage';
import type * as EnvModule from '../../server/src/config/env';
import type * as MongoModule from '../../server/src/components/mongodb';
import type * as CollectionsModule from '../../server/src/components/mongodb/collections';
import type * as JobsModule from '../../server/src/components/jobs';
import type * as QdrantModule from '../../server/src/components/qdrant';
import type * as EmbeddingModule from '../../server/src/components/genai/embeddings';
import type * as LlmModule from '../../server/src/components/genai/llm';
import type * as CoursesModule from '../../server/src/services/courses.service';
import type * as QuestionsModule from '../../server/src/services/questions.service';
import type * as AdminModule from '../../server/src/services/admin.service';
import type * as StepModelsModule from '../../server/src/services/step-models';
import type * as AuthoringModule from '../../server/src/services/authoring-commit.service';
import type * as ReadinessModule from '../../server/src/services/source-readiness.service';
import type * as MemoryModule from '../../server/src/services/generation-memory.service';
import type * as NumericGateModule from '../../server/src/services/numeric-gate.service';
import type * as GenerationModule from '../../server/src/services/generation.service';
import type * as GenerationRoutes from '../../server/src/routes/generation.routes';
import type * as ContentRoutes from '../../server/src/routes/content-runs.routes';
import type * as QuestionRoutes from '../../server/src/routes/questions.routes';
import type * as ErrorModule from '../../server/src/middleware/error-handler';
import { PUBLIC_ACCEPTANCE_LIMITS, PUBLIC_ACCEPTANCE_SCOPE, PUBLIC_CASES, REGENERATION_CASES,
  assertPublicTarget, publicHash, type PublicReference } from './public-acceptance-controls';
import { installPublicObservation,
  reconcilePublicCaptures, summarizePublicCaptures } from './public-acceptance-observation';

import { preparePublicContinuation, verifyPublicContinuationDeclaration, initializePublicContinuationLedger, assertPublicContinuationLedger, claimPublicContinuation, reservePublicContinuationAttempt,
  continuationJson, type PublicContinuationDeclaration } from './public-acceptance-continuation-controls';
import { continuationError, installContinuationDiagnostics } from './public-acceptance-continuation-observation';

const ROOT = path.resolve(__dirname, '../..'); const load = createRequire(__filename);
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const runtime = <T>(relative: string): T => load(path.join(ROOT, relative)) as T;
async function writeJson(file: string, value: unknown, exclusive = false): Promise<void> {
  if (exclusive) { await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); return; }
  const temporary = `${file}.${randomUUID()}.tmp`; await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await fs.rename(temporary, file);
}

/** All runtime outbound sockets are limited to the owned services and the
 * configured provider endpoint. This is not a production auth bypass. */
function socketFence(allowed: Array<{ host: string; port: number }>, failures: string[]): () => void {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first as { port?: number | string; host?: string; path?: string } : { port: first, host: args[1] };
    const host = String(options.host ?? 'localhost'); const port = Number(options.port);
    if (!allowed.some(item => item.host === host && item.port === port) || ('path' in options && options.path)) {
      failures.push(`host=${host};port=${port}`); throw new Error('public-acceptance-network-forbidden');
    }
    return Reflect.apply(original, this, args) as net.Socket;
  } as typeof original;
  return () => { net.Socket.prototype.connect = original; };
}

async function live(output: string): Promise<void> {
  assert.equal(argument('--live'), 'once'); const declarationPath = argument('--declaration'); const declarationSha = argument('--declaration-sha256');
  assert(declarationPath && declarationSha); const bytes = await fs.readFile(declarationPath); assert.equal(publicHash(bytes), declarationSha);
  const declaration = JSON.parse(bytes.toString()) as PublicContinuationDeclaration; await verifyPublicContinuationDeclaration(declaration);
  const { env } = runtime<typeof EnvModule>('server/src/config/env.ts'); assertPublicTarget(env, declaration.database);
  assert.equal(env.authoringMaxInputTokens, PUBLIC_ACCEPTANCE_LIMITS.maxInputTokens);
  assert.equal(env.authoringMaxOutputTokens, PUBLIC_ACCEPTANCE_LIMITS.maxOutputTokens);
  const providerUrl = env.llmEndpoint ? new URL(env.llmEndpoint) : env.llmProvider === 'openai' ? new URL('https://api.openai.com') : undefined;
  assert(providerUrl && ['http:', 'https:'].includes(providerUrl.protocol) && !providerUrl.username && !providerUrl.password, 'An explicit safe provider endpoint is required.');
  assert.equal(env.llmProvider, declaration.continuation.transport.provider);
  assert.equal(new URL(env.llmEndpoint || 'https://api.openai.com/v1').href, declaration.continuation.transport.endpoint);
  assert.equal(env.llmRequestTimeoutMs, declaration.continuation.transport.requestTimeoutMs);
  await fs.mkdir(output, { recursive: false }); await fs.mkdir(path.join(output, 'private-transcripts'), { mode: 0o700 });
  await writeJson(path.join(output, 'execution-claim.json'), { declarationSha256: declarationSha, startedAt: new Date().toISOString(), pid: process.pid }, true);
  await claimPublicContinuation(declaration, declarationSha, output);
  const ledgerPath = path.join(output, 'ledger.json'); await initializePublicContinuationLedger(ledgerPath, declaration, declarationSha);
  // A shared phase lock prevents two copies against the same declared owned DB.
  // Never steal an abandoned lock: the uncertain run must be inspected first.
  const phaseLock = path.join(path.dirname(path.resolve(declarationPath)), 'live-phase.lock'); await fs.mkdir(phaseLock);
  const actor = `QUALITY-PUBLIC-ACCEPTANCE-${randomUUID()}`; const ownedCourses = new Set<string>(); const started = Date.now();
  const observations: Array<Record<string, unknown>> = []; const http: Array<Record<string, unknown>> = []; const networkFailures: string[] = [];
  const allowed = [{ host: '127.0.0.1', port: 27029 }, { host: 'localhost', port: 27029 }, { host: '::1', port: 27029 },
    { host: '127.0.0.1', port: 6333 }, { host: 'localhost', port: 6333 }, { host: '::1', port: 6333 },
    { host: providerUrl.hostname, port: Number(providerUrl.port || (providerUrl.protocol === 'https:' ? 443 : 80)) }];
  const restoreSocket = socketFence(allowed, networkFailures);
  let mongo: typeof MongoModule | undefined; let connected = false; let jobsStarted = false;
  let jobs: typeof JobsModule | undefined; let server: ReturnType<express.Express['listen']> | undefined;
  let observer: ReturnType<typeof installPublicObservation> | undefined; let currentCase = 'preparation'; let status = 'preparing'; let terminalError: unknown;
  const originalResult = await continuationJson<{ phaseUsage: unknown; observations: unknown[] }>(declaration.continuation.results.file);
  let readNativeReceipts: (() => Promise<ModelCallReceipt[]>) | undefined; let receiptReadFailure: unknown;
  const save = async () => {
    let receipts: ModelCallReceipt[] | undefined; let receiptReadError: unknown;
    try { receipts = await readNativeReceipts?.(); } catch (error) { receiptReadFailure ??= error; receiptReadError = continuationError(error); }
    await writeJson(path.join(output, 'results.json'), { version: 1, status, elapsedMs: Date.now() - started,
    declarationSha256: declarationSha, actor, database: declaration.database, ownedCourseIds: [...ownedCourses], currentCase, observations, http,
    phaseUsage: summarizePublicCaptures(observer?.captures ?? [], receipts), nativeReceipts: receipts ?? null, receiptReadError: receiptReadError ?? null,
    firstReceiptReadFailure: receiptReadFailure ? continuationError(receiptReadFailure) : null,
    receiptBindings: receipts ? reconcilePublicCaptures(observer?.captures ?? [], receipts) : null,
    transcriptIds: observer?.captures.map(item => item.id) ?? [], networkFailures,
    error: terminalError ? continuationError(terminalError) : null, teacherAcceptance: null, comparison: declaration.comparison,
    observationLimits: 'Facade entries and phase reservations are not dispatches. Actual observed sends come only from native Mongo receipts. Missing/ambiguous per-call links remain unresolved; hidden SDK retries remain unknown.',
    continuation: { parentResults: declaration.continuation.results, parentLedger: declaration.continuation.ledger, originalPhaseUsage: originalResult.phaseUsage, originalCompletedObservations: originalResult.observations, historicalCodeManifest: declaration.continuation.historicalCodeManifest, codeChanges: declaration.continuation.codeChanges, codeCohort: 'Original completed cases retain archived code; the missing cases use new prospective code. This is not one same-build or causal comparison cohort.', missingOnly: declaration.continuation.missing, cumulativeLedger: await continuationJson(ledgerPath), operations: diagnostics?.operations ?? [], localFetches: diagnostics?.fetches ?? [] },
    isolation: 'Owned cloned courses and real local Agenda. No fixture cleanup, approvals, publishing, Canvas or student-data writes.' });
  };
  const diagnostics = installContinuationDiagnostics({ caseId: () => currentCase, save });
  try {
    mongo = runtime<typeof MongoModule>('server/src/components/mongodb/index.ts');
    const db = await mongo.connectMongo(); connected = true;
    assert.equal(await db.collection('agendaJobs').countDocuments({ $or: [{ nextRunAt: { $type: 'date' } }, { lockedAt: { $type: 'date' } }] }), 0, 'Refuse unrelated scheduled/locked Agenda work.');
    assert.equal(await db.collection('contentRuns').countDocuments({ status: { $in: ['queued', 'running'] } }), 0, 'Refuse overlapping durable work in the owned DB.');
    assert.equal(await db.collection('courses').countDocuments({ ownerPuid: { $not: /^(?:QUALITY-RETEST-FIXTURE-|QUALITY-PUBLIC-ACCEPTANCE-)/ } }), 0, 'All existing courses must belong to disposable quality fixtures.');
    assert(await db.collection<{ _id: string; actor: string; database: string }>('qualityLabAcceptanceOwnership').findOne({ _id: declaration.continuation.parentDeclaration.sha256, actor: declaration.continuation.originalActor, database: declaration.database }), 'The original owned DB marker must still exist.');
    assert.equal(await db.collection('courses').countDocuments({ _id: { $in: declaration.continuation.originalCourseIds.map(id => new ObjectId(id)) }, ownerPuid: declaration.continuation.originalActor }), declaration.continuation.originalCourseIds.length, 'Original fixture ownership changed.');
    await db.collection<{ _id: string; actor: string; scope: string; database: string; createdAt: Date; noCleanup: boolean }>('qualityLabAcceptanceOwnership').insertOne({ _id: declarationSha, actor, scope: PUBLIC_ACCEPTANCE_SCOPE,
      database: declaration.database, createdAt: new Date(), noCleanup: true });
    assert.equal(await db.collection('questions').countDocuments({ courseId: new ObjectId(declaration.continuation.abandonedFixtureId) }), 0, 'Do not resume a changed partial fixture.');
    assert.equal(await db.collection('regenerationCandidates').countDocuments({ courseId: new ObjectId(declaration.continuation.abandonedFixtureId) }), 0);
    assert.equal(await db.collection('materials').countDocuments({ courseId: new ObjectId(declaration.continuation.abandonedFixtureId) }), 1);
    const collections = runtime<typeof CollectionsModule>('server/src/components/mongodb/collections.ts');
    readNativeReceipts = () => collections.modelCallReceiptsCol().find({ 'actor.puid': actor, courseId: { $in: [...ownedCourses].map(id => new ObjectId(id)) } }).sort({ startedAt: 1, _id: 1 }).toArray();
    for (const spec of collections.INDEX_SPECS.filter(item => ['materials', 'materialChunks', 'authoringTaskPlans', 'questionPedagogicalFingerprints', 'regenerationCandidates'].includes(item.collection))) await db.collection(spec.collection).createIndex(spec.keys, spec.options);
    const authoring = runtime<typeof AuthoringModule>('server/src/services/authoring-commit.service.ts'); assert.equal((await authoring.initializeAuthoringCommitSupport()).available, true);
    const admin = runtime<typeof AdminModule>('server/src/services/admin.service.ts'); const steps = runtime<typeof StepModelsModule>('server/src/services/step-models.ts');
    const settings = await admin.getPlatformSettings(); assert.equal(settings.featureFlags.reviewerAgent, true);
    assert.deepEqual(steps.stepModelsFrom(settings), declaration.expectedModels, 'Configured models/options must match the prospective declaration.');
    await writeJson(path.join(output, 'runtime-settings.json'), { models: steps.stepModelsFrom(settings), featureFlags: settings.featureFlags, costControls: settings.costControls }, true);
    const assertCurrent = async (requireOwnedCourse = true) => {
      await verifyPublicContinuationDeclaration(declaration);
      await assertPublicContinuationLedger(ledgerPath, declaration, declarationSha); diagnostics!.assertHealthy();
      assert(!receiptReadFailure, 'A failed native receipt read stops all further authoring.');
      const claim = await continuationJson<{ declarationSha256: string; output: string; pid: number }>(declaration.continuation.claimFile); assert.equal(claim.declarationSha256, declarationSha); assert.equal(claim.output, path.resolve(output)); assert.equal(claim.pid, process.pid);
      assert.deepEqual(steps.stepModelsFrom(await admin.getPlatformSettings()), declaration.expectedModels);
      assert.equal((await admin.getPlatformSettings()).featureFlags.reviewerAgent, true);
      const ownership = await db.collection<{ _id: string; actor: string }>('qualityLabAcceptanceOwnership').findOne({ _id: declarationSha, actor }); assert(ownership);
      assert.equal(await db.collection('contentRuns').countDocuments({ courseId: { $nin: [...ownedCourses].map(id => new ObjectId(id)) }, status: { $in: ['queued', 'running'] } }), 0, 'Unrelated work appeared in the owned DB.');
      if (requireOwnedCourse && currentCase !== 'preparation') assert(ownedCourses.size > 0, 'Authoring requires an owned course.');
      assert.equal(await collections.coursesCol().countDocuments({ _id: { $in: [...ownedCourses].map(id => new ObjectId(id)) }, ownerPuid: actor }), ownedCourses.size, 'New fixture ownership changed.');
      assert(!(observer?.captures.some(item => item.state === 'dispatch-unknown' || item.state === 'phase-refused')), 'A prior uncertain/refused call stops all further authoring.');
      assert.equal(networkFailures.length, 0);
    };
    const llm = runtime<typeof LlmModule>('server/src/components/genai/llm/index.ts');
    observer = installPublicObservation(llm, { configuration: { provider: env.llmProvider, defaultModel: env.llmDefaultModel }, caseId: () => currentCase, assertCurrent,
      reserve: (admission, caseId) => reservePublicContinuationAttempt(ledgerPath, declaration, declarationSha, caseId, admission),
      save: capture => writeJson(path.join(output, 'private-transcripts', `${capture.id}.json`), capture) });
    const courses = runtime<typeof CoursesModule>('server/src/services/courses.service.ts'); const questions = runtime<typeof QuestionsModule>('server/src/services/questions.service.ts');
    const readiness = runtime<typeof ReadinessModule>('server/src/services/source-readiness.service.ts'); const memory = runtime<typeof MemoryModule>('server/src/services/generation-memory.service.ts');
    const numeric = runtime<typeof NumericGateModule>('server/src/services/numeric-gate.service.ts');
    const qdrant = runtime<typeof QdrantModule>('server/src/components/qdrant/index.ts'); const embeddings = runtime<typeof EmbeddingModule>('server/src/components/genai/embeddings/index.ts');
    const reference = JSON.parse(await fs.readFile(declaration.historicalReference.path, 'utf8')) as PublicReference;
    const user: User = { puid: actor, uid: actor, email: 'quality-public@example.invalid', displayName: 'Owned public acceptance fixture', affiliations: [], isAdmin: false,
      courseRoles: [], createdAt: new Date(), lastLoginAt: new Date() };
    const clone = async (label: string) => {
      const cloneStarted = Date.now();
      // Bootstrap may precede the first owned course. Native authoring still
      // uses the default strict check after this course has been registered.
      await assertCurrent(false); const courseId = new ObjectId(); assert(!declaration.continuation.originalCourseIds.includes(courseId.toHexString())); ownedCourses.add(courseId.toHexString()); const now = new Date();
      const course: Course = { name: `Public acceptance ${label}`, courseCode: `QPA-${courseId.toHexString().slice(-6)}`, term: '2026W1', ownerPuid: actor,
        registrationCode: randomUUID(), published: false, lifecycle: 'draft', feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
        redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: now };
      await collections.coursesCol().insertOne({ _id: courseId, ...course }); user.courseRoles.push({ courseId, role: 'instructor' });
      const theme = await courses.addTheme(courseId, { name: 'Frozen historical finance reference' });
      const thin = await courses.addLo(courseId, theme._id, { name: PUBLIC_CASES[0].loName, kind: 'conceptual' });
      const capm = await courses.addLo(courseId, theme._id, { name: PUBLIC_CASES[1].loName, kind: 'calculation' });
      const sourceReceipts: unknown[] = []; const collectionName = `course-${courseId.toHexString()}`;
      assert(!(await diagnostics!.operation(`clone:${label}:qdrant.getCollections`, () => qdrant.qdrant.getCollections())).collections.some(item => item.name === collectionName));
      for (const source of reference.controls.sourceControls) {
        const chapter = source.material.name.startsWith('Chapter 3:') ? 3 : 4; const pdf = declaration.pdfs.find(item => item.chapter === chapter); assert(pdf);
        const materialId = new ObjectId(); const ingestRunId = new ObjectId(); const lo = chapter === 3 ? thin : capm;
        const chunks: MaterialChunk[] = source.chunks.map(chunk => ({ ...chunk, courseId, materialId, createdAt: now }));
        assert.equal(readiness.hashSourceChunks(chunks), source.material.sourceManifest.sourceTextHash);
        const vectors = await diagnostics!.operation(`clone:${label}:chapter-${chapter}:FastEmbed.embed`, () => embeddings.embed(chunks.map(item => item.text))); assert.equal(vectors.length, chunks.length);
        const dimension = vectors[0]?.length; assert(dimension && vectors.every(vector => vector.length === dimension && vector.every(Number.isFinite)));
        await diagnostics!.operation(`clone:${label}:chapter-${chapter}:qdrant.ensureCollection`, () => qdrant.ensureCollection(collectionName, dimension));
        await diagnostics!.operation(`clone:${label}:chapter-${chapter}:qdrant.upsertPoints`, () => qdrant.upsertPoints(collectionName, vectors.map((vector, index) => ({ id: randomUUID(), vector,
          payload: { materialId: materialId.toHexString(), chunkIndex: index, chunk: chunks[index].text } }))));
        assert.equal((await diagnostics!.operation(`clone:${label}:chapter-${chapter}:qdrant.count`, () => qdrant.qdrant.count(collectionName, { filter: { must: [{ key: 'materialId', match: { value: materialId.toHexString() } }] }, exact: true }))).count, chunks.length);
        const material: Material = { courseId, name: source.material.name, format: 'pdf', kind: 'reading', status: 'ready', revision: source.material.revision,
          assignments: [{ themeId: theme._id, loId: lo._id }], storagePath: pdf.path, excerpt: source.material.excerpt, uploadedAt: now, activeRunId: ingestRunId,
          sourceManifest: { ...source.material.sourceManifest, ingestRunId, indexedAt: now } };
        await collections.materialChunksCol().insertMany(chunks);
        await collections.contentRunsCol().insertOne({ _id: ingestRunId, courseId, requestedBy: actor, kind: 'material-ingest', status: 'completed', stage: 'indexing',
          input: { materialId, sourceName: material.name, sourceFormat: 'pdf', trigger: 'upload' }, completedUnits: chunks.length, totalUnits: chunks.length, revision: 1, events: [],
          warnings: [{ code: 'historical-chunk-clone-real-reindex', message: 'Exact archived parsed chunks/manifests; actual vectors rebuilt for new IDs. Not upload/parser acceptance.', atStage: 'indexing', at: now }],
          createdAt: now, updatedAt: now, startedAt: now, completedAt: now,
          result: { characterCount: source.material.sourceManifest.characterCount, chunkCount: chunks.length, indexedCount: chunks.length, vectorCount: chunks.length, classification: 'skipped' } });
        await collections.materialsCol().insertOne({ _id: materialId, ...material }); const ready = await readiness.getMaterialSourceReadiness(courseId, materialId); assert(ready.ready);
        sourceReceipts.push({ archivedMaterialId: source.material._id, materialId, pdfSha256: source.pdfSha256, originalManifest: source.material.sourceManifest, current: material, readiness: ready });
      }
      const oldSeed = reference.controls.startingBankVersions[0];
      const seed = await questions.createQuestion({ courseId, loIds: [thin._id], themeIds: [theme._id], type: oldSeed.type, stem: oldSeed.stem,
        options: oldSeed.options, difficulty: oldSeed.difficulty, numericKind: oldSeed.numericKind, createdBy: actor,
        agentDecision: { decision: 'pass', reasoning: 'Controlled historical Bank seed; not teacher approval or a model quality label.', roleAssessment: 'True is correct; False is a common misconception.' } });
      assert.equal(memory.contentFingerprint(seed.version).exact, memory.contentFingerprint(oldSeed).exact);
      assert.equal(await collections.questionsCol().countDocuments({ courseId }), 1);
      assert.equal(await collections.sourceEvidenceExtractionsCol().countDocuments({ courseId }), 0);
      const owned = await collections.coursesCol().findOne({ _id: courseId, ownerPuid: actor }); assert(owned);
      await writeJson(path.join(output, `fixture-${label}.json`), { label, courseId, actor, course, sources: sourceReceipts, seed,
        startingMemory: await memory.loadGenerationMemory({ courseId, loIds: [thin._id], includeCrossLo: true }), sourceExtractionCacheRows: 0,
        setupWallMs: Date.now() - cloneStarted, setupScope: 'Historical chunk clone, real local vector index and manual immutable Bank seed; excluded from authoring request wall time.' }, true);
      return { courseId, thin, capm, seed };
    };
    const generation = runtime<typeof GenerationModule>('server/src/services/generation.service.ts'); jobs = runtime<typeof JobsModule>('server/src/components/jobs/index.ts');
    await jobs.startJobs(); jobsStarted = true; generation.registerGenerationJobs();
    const { generationRouter } = runtime<typeof GenerationRoutes>('server/src/routes/generation.routes.ts');
    const { contentRunsRouter } = runtime<typeof ContentRoutes>('server/src/routes/content-runs.routes.ts');
    const { questionsRouter } = runtime<typeof QuestionRoutes>('server/src/routes/questions.routes.ts'); const { errorHandler } = runtime<typeof ErrorModule>('server/src/middleware/error-handler.ts');
    const app = express(); app.use(express.json()); app.use((req, _res, next) => {
      const auth = req.get('x-quality-test-auth'); req.isAuthenticated = (() => auth !== 'signed-out') as Request['isAuthenticated'];
      req.user = auth === 'foreign' ? { ...user, puid: `${actor}-foreign`, courseRoles: [] } : user; next();
    });
    app.use('/api', generationRouter, contentRunsRouter, questionsRouter); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve, reject) => { server!.once('listening', resolve); server!.once('error', reject); });
    const address = server.address(); assert(address && typeof address !== 'string'); allowed.push({ host: '127.0.0.1', port: address.port });
    const client = request(server);
    const send = async (label: string, method: 'get' | 'post' | 'patch', url: string, body?: unknown, expected?: number, auth?: string) => {
      const at = Date.now(); let pending = client[method](url); if (auth) pending = pending.set('x-quality-test-auth', auth);
      if (body !== undefined) { assert(body !== null && typeof body === 'object'); pending = pending.send(body); }
      const response = await diagnostics!.operation(`http:${label}:${method.toUpperCase()}:${url}`, () => pending);
      http.push({ caseId: currentCase, label, method: method.toUpperCase(), url, request: body ?? null, auth: auth ?? 'owned-instructor',
        status: response.status, response: response.body as unknown, elapsedMs: Date.now() - at }); await save();
      if (expected !== undefined) assert.equal(response.status, expected, `${label}: ${JSON.stringify(response.body)}`); return response;
    };
    const sample = async (version: WithId<QuestionVersion>) => {
      assert(numeric.isServable(version), 'A saved/adopted version must pass the current numeric serving gate.');
      const detail = await send('saved-version-detail', 'get', `/api/questions/${version.questionId.toHexString()}`, undefined, 200);
      assert.equal((detail.body as { current: { _id: string } }).current._id, version._id.toHexString());
      return send('fresh-saved-version-sample', 'get', `/api/questions/${version.questionId.toHexString()}/sample`, undefined, 200);
    };
    status = 'running'; await save();
    for (const trial of REGENERATION_CASES.filter(item => item.intent === 'create-independent-task')) {
      currentCase = `regeneration-${trial.intent}`; const fixture = await clone(currentCase); const questionId = fixture.seed.questionId.toHexString(); const originalVersionId = fixture.seed.version._id.toHexString();
      const base = `/api/courses/${fixture.courseId.toHexString()}/questions/${questionId}`;
      const body = { qualityPolicy: 'grounded-memory-v2', intent: trial.intent, prompt: trial.prompt, requestId: randomUUID(), expectedVersionId: originalVersionId };
      const caseStarted = Date.now(); const observation: Record<string, unknown> = { id: currentCase, courseId: fixture.courseId, requested: 1, input: body, status: 'running', adopted: 0, startedAt: new Date(caseStarted).toISOString() };
      observations.push(observation); await save();
      const response = await send('durable-regeneration', 'post', `${base}/regenerate`, body, 200);
      const candidateId = (response.body as { candidateId?: string }).candidateId; assert(candidateId && ObjectId.isValid(candidateId));
      const count: number = observer.captures.length;
      const reloaded = await send('candidate-http-reload', 'get', `${base}/regeneration-candidates/${candidateId}`, undefined, 200);
      assert.equal((reloaded.body as { candidateId: string }).candidateId, candidateId);
      assert.equal((reloaded.body as { originalVersionId: string }).originalVersionId, originalVersionId);
      const replay = await send('request-uuid-replay', 'post', `${base}/regenerate`, body, 200); assert.equal((replay.body as { candidateId: string }).candidateId, candidateId); assert.equal(observer.captures.length, count);
      assert.equal((await collections.questionsCol().findOne({ _id: fixture.seed.questionId }))?.currentVersionId.toHexString(), originalVersionId);
      const candidate = await collections.regenerationCandidatesCol().findOne({ _id: new ObjectId(candidateId), courseId: fixture.courseId }); assert(candidate);
      if (candidate.status === 'eligible') {
        const beforeVersions = await collections.questionVersionsCol().countDocuments({ questionId: fixture.seed.questionId });
        const adopted = await send('explicit-eligible-adoption', 'post', `${base}/regeneration-candidates/${candidateId}/adopt`, { expectedVersionId: originalVersionId }, 200);
        const replayAdoption = await send('idempotent-adoption-replay', 'post', `${base}/regeneration-candidates/${candidateId}/adopt`, { expectedVersionId: originalVersionId }, 200);
        const versionId = (adopted.body as { version: { _id: string } }).version._id; assert.equal((replayAdoption.body as { version: { _id: string } }).version._id, versionId);
        assert.equal(await collections.questionVersionsCol().countDocuments({ questionId: fixture.seed.questionId }), beforeVersions + 1);
        const version = await collections.questionVersionsCol().findOne({ _id: new ObjectId(versionId), questionId: fixture.seed.questionId }); assert(version); await sample(version);
        observation.adopted = 1; observation.adoptedVersion = version;
      } else {
        await send('withheld-adoption-denied', 'post', `${base}/regeneration-candidates/${candidateId}/adopt`, { expectedVersionId: originalVersionId }, 422);
        assert.equal(await collections.questionVersionsCol().countDocuments({ questionId: fixture.seed.questionId }), 1);
      }
      assert.equal(observer.captures.length, count, 'Reload, UUID replay and adoption must not send models.');
      Object.assign(observation, { status: 'terminal', candidateBeforeAdoption: candidate, reload: reloaded.body as unknown,
        candidateAfterAdoption: await collections.regenerationCandidatesCol().findOne({ _id: candidate._id }),
        versions: await collections.questionVersionsCol().find({ questionId: fixture.seed.questionId }).sort({ version: 1 }).toArray(),
        finishedAt: new Date().toISOString(), authoringRequestWallMs: Date.now() - caseStarted });
      const unchangedOriginal = await collections.questionVersionsCol().findOne({ _id: fixture.seed.version._id }); assert(unchangedOriginal);
      assert.equal(memory.contentFingerprint(unchangedOriginal).exact, memory.contentFingerprint(fixture.seed.version).exact); await save();
    }
    currentCase = 'stale-original-version-negative'; const stale = await clone(currentCase); const staleBody = { qualityPolicy: 'grounded-memory-v2', intent: 'edit-existing',
      prompt: REGENERATION_CASES[0].prompt, requestId: randomUUID(), expectedVersionId: stale.seed.version._id.toHexString() };
    const before = observer.captures.length;
    await send('manual-version-change-control', 'patch', `/api/questions/${stale.seed.questionId.toHexString()}`, { stem: 'Diversification can reduce company-specific risk.', expectedVersionId: stale.seed.version._id.toHexString() }, 200);
    await send('stale-original-version-denied', 'post', `/api/courses/${stale.courseId.toHexString()}/questions/${stale.seed.questionId.toHexString()}/regenerate`, staleBody, 409);
    assert.equal(observer.captures.length, before); assert.equal(await collections.regenerationCandidatesCol().countDocuments({ courseId: stale.courseId }), 0);
    observations.push({ id: currentCase, courseId: stale.courseId, status: 'passed', providerSends: 0, scope: 'Stale expected original version at regeneration admission; not a stale eligible-candidate adoption experiment.' });
    observer.assertHealthy(); await assertCurrent(); assert.equal(networkFailures.length, 0);
    const nativeReceipts = await readNativeReceipts();
    assert(nativeReceipts.length <= 8, 'Observed native pipeline/regen maximum is bounded independently of phase reservations.');
    assert(nativeReceipts.length >= observer.captures.filter(item => item.state === 'returned').length, 'Native metadata is missing for a successful raw completion.');
    const sessions = await collections.modelUsageSessionsCol().find({ 'actor.puid': actor, courseId: { $in: [...ownedCourses].map(id => new ObjectId(id)) } }).toArray();
    assert(sessions.every(session => session.closedCleanly && !session.recordingFailed && session.expectedCallIds.every(id => nativeReceipts.some(receipt => receipt._id === id))), 'Native tracking has unfinished or missing records.');
    status = 'completed'; await save();
  } catch (error) { terminalError = error; status = 'stopped'; await save(); throw error; }
  finally {
    // Never unlock active Agenda work merely because an observation failed.
    // Keep this same process/observer alive until its real owned work is terminal.
    try {
      if (connected && jobsStarted && mongo) for (;;) {
        const active = await mongo.getDb().collection('contentRuns').countDocuments({ courseId: { $in: [...ownedCourses].map(id => new ObjectId(id)) }, status: { $in: ['queued', 'running'] } });
        if (!active) break;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (jobs) await jobs.stopJobs();
      if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    } finally { observer?.restore(); diagnostics?.restore(); try { if (connected && mongo) await mongo.closeMongo(); } finally { restoreSocket(); await fs.rmdir(phaseLock); } }
  }
}

export function parsePublicContinuationArguments(argv: string[]): Record<string, string> {
  const allowed = new Set(['--output', '--origin', '--parent-declaration', '--provider', '--endpoint', '--live', '--declaration', '--declaration-sha256']);
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) { const key = argv[i], value = argv[i + 1]; assert(allowed.has(key) && !(key in args) && value && !value.startsWith('--'), `Unknown, duplicate or missing argument: ${key}`); args[key] = value; }
  assert(args['--output']);
  if (args['--live'] !== undefined) { assert.equal(args['--live'], 'once'); assert(args['--declaration'] && /^[a-f0-9]{64}$/.test(args['--declaration-sha256'])); assert(Object.keys(args).every(key => ['--live', '--output', '--declaration', '--declaration-sha256'].includes(key))); }
  else { assert(args['--origin'] && args['--parent-declaration'] && args['--endpoint']); assert(['openai', 'ubc-llm-sandbox'].includes(args['--provider'])); assert(!args['--declaration'] && !args['--declaration-sha256']); }
  return args;
}
export async function main(): Promise<void> {
  const args = parsePublicContinuationArguments(process.argv.slice(2));
  if (args['--live']) await live(args['--output']);
  else { const digest = await preparePublicContinuation({ origin: args['--origin'], parentDeclaration: args['--parent-declaration'], output: args['--output'], provider: args['--provider'] as 'openai' | 'ubc-llm-sandbox', endpoint: args['--endpoint'] }); console.log(JSON.stringify({ preflight: true, declarationSha256: digest, providerCalls: 0, databaseCalls: 0 })); }
}
if (require.main === module) void main().catch(error => { console.error(JSON.stringify(continuationError(error))); process.exitCode = 1; });
