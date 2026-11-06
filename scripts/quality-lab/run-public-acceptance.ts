/** Root-only opt-in acceptance. Preflight is file-only; live mode retains its
 * owned fixtures and uses real HTTP routes, Agenda and all production gates. */
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
import type { GenerationEvaluationExport } from '../../server/src/types/generation-evaluation';
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
  assertPublicTarget, classifySavedSupply, publicHash, validatePublicReference, verifyPublicDeclaration,
  type PublicAcceptanceDeclaration, type PublicReference } from './public-acceptance-controls';
import { initializePublicLedger, installPublicObservation, publicSafeError, reservePublicNativeAttempt,
  reconcilePublicCaptures, summarizePublicCaptures } from './public-acceptance-observation';

const ROOT = path.resolve(__dirname, '../..'); const load = createRequire(__filename);
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const runtime = <T>(relative: string): T => load(path.join(ROOT, relative)) as T;
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }); const files: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (entry.isFile() && file.endsWith('.ts')) files.push(file);
  }
  return files;
}
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

async function prepare(output: string): Promise<void> {
  const referencePath = argument('--reference'); const corpusPath = argument('--corpus'); const modelsPath = argument('--models'); const database = argument('--database');
  const priorLedgersPath = argument('--prior-ledgers');
  assert(referencePath && corpusPath && modelsPath && database && priorLedgersPath, 'Preflight requires --reference, --corpus, --models, --database and --prior-ledgers.');
  assert.match(database, /^financebot_quality_smoke_retest_[a-z0-9_]+$/);
  const referenceBytes = await fs.readFile(referencePath); const reference = JSON.parse(referenceBytes.toString()) as PublicReference; validatePublicReference(reference);
  const corpusBytes = await fs.readFile(corpusPath); const corpus = JSON.parse(corpusBytes.toString()) as { chapters: Array<{ chapter: number; file: string; sha256: string }> };
  const expectedModels = JSON.parse(await fs.readFile(modelsPath, 'utf8')) as PublicAcceptanceDeclaration['expectedModels'];
  const priorLedgers = JSON.parse(await fs.readFile(priorLedgersPath, 'utf8')) as PublicAcceptanceDeclaration['priorLedgers'];
  assert.equal(expectedModels.embedding, 'fast-bge-small-en-v1.5');
  for (const step of ['generator', 'validator', 'reviewer'] as const) assert(expectedModels[step]?.model?.trim());
  const files = [...await sourceFiles(path.join(ROOT, 'server/src')), ...await sourceFiles(path.join(ROOT, 'scripts/quality-lab')),
    path.join(ROOT, 'package.json'), path.join(ROOT, 'package-lock.json')].sort();
  const code = await Promise.all(files.map(async file => ({ file, sha256: publicHash(await fs.readFile(file)) })));
  const pdfs = [3, 4].map(chapter => { const item = corpus.chapters.find(row => row.chapter === chapter); assert(item); return { chapter: chapter as 3 | 4, path: path.resolve(item.file), sha256: item.sha256 }; });
  const declaration: PublicAcceptanceDeclaration = { version: 1, scope: PUBLIC_ACCEPTANCE_SCOPE, database, expectedModels,
    historicalReference: { path: path.resolve(referencePath), sha256: publicHash(referenceBytes) }, corpus: { path: path.resolve(corpusPath), sha256: publicHash(corpusBytes) },
    code, pdfs, priorLedgers, limits: PUBLIC_ACCEPTANCE_LIMITS, publicCases: PUBLIC_CASES, regenerationCases: REGENERATION_CASES,
    comparison: 'Current public acceptance versus a budget-confounded historical reference; not causal old/new A/B.', preparedAt: new Date().toISOString() };
  await verifyPublicDeclaration(declaration);
  await fs.mkdir(output, { recursive: false }); await writeJson(path.join(output, 'declaration.json'), declaration, true);
  await writeJson(path.join(output, 'preflight.json'), { version: 1, preparedAt: new Date().toISOString(), declarationSha256: publicHash(await fs.readFile(path.join(output, 'declaration.json'))),
    runtimeImports: 0, databaseCalls: 0, providerCalls: 0, ledgerCreated: false, requestedPublicQuestions: 6, regenerationIntents: 3,
    nativeMaximumSends: { public: PUBLIC_CASES.map(item => ({ id: item.id, sends: 2 + item.count * 8 })), publicTotal: 54, regenerationTotal: 24, combined: 78, staleVersionNegative: 0 },
    attemptReservationMaximum: 78,
    reservationUpperBound: '78 prepared attempts × (24,000 conservative UTF-8 input units + 24,000 output reservation) = 3,744,000. Native-denied reservations remain charged and can reduce actual sends. This is not billed usage or a completion guarantee.',
    renderedInputEstimates: null, renderedInputLimit: 'Production renders retrieval/planning/repair prompts only at runtime. Every exact rendered attempt is checked against 24,000 before sending; no guessed prompt is presented as a rendered estimate.',
    limitations: ['This preflight performs no database/provider action and does not establish that the runtime will admit any question.',
      'Historical source chunks/manifests are intentionally cloned exactly, while actual local vectors are rebuilt for each new ID. This does not re-test upload or parsing.',
      'The archived historical code freeze is transitively incomplete and its shared budget interrupted later slots; this is not causal old/new A/B.',
      'Future live authentication is a labelled synthetic request User inside an ephemeral Express app; production guards stay active. It is not SAML acceptance.',
      'No instructor approval, publishing, real student attempts, Canvas mutation, ledger reset or fixture deletion is included.'] }, true);
  console.log(JSON.stringify({ preflight: true, output: path.resolve(output), providerCalls: 0, databaseCalls: 0, nativeMaxSends: 78 }));
}

async function live(output: string): Promise<void> {
  assert.equal(argument('--live'), 'once'); const declarationPath = argument('--declaration'); const declarationSha = argument('--declaration-sha256');
  assert(declarationPath && declarationSha); const bytes = await fs.readFile(declarationPath); assert.equal(publicHash(bytes), declarationSha);
  const declaration = JSON.parse(bytes.toString()) as PublicAcceptanceDeclaration; await verifyPublicDeclaration(declaration);
  const { env } = runtime<typeof EnvModule>('server/src/config/env.ts'); assertPublicTarget(env, declaration.database);
  assert.equal(env.authoringMaxInputTokens, PUBLIC_ACCEPTANCE_LIMITS.maxInputTokens);
  assert.equal(env.authoringMaxOutputTokens, PUBLIC_ACCEPTANCE_LIMITS.maxOutputTokens);
  const providerUrl = env.llmEndpoint ? new URL(env.llmEndpoint) : env.llmProvider === 'openai' ? new URL('https://api.openai.com') : undefined;
  assert(providerUrl && ['http:', 'https:'].includes(providerUrl.protocol) && !providerUrl.username && !providerUrl.password, 'An explicit safe provider endpoint is required.');
  await fs.mkdir(output, { recursive: false }); await fs.mkdir(path.join(output, 'private-transcripts'), { mode: 0o700 });
  await writeJson(path.join(output, 'execution-claim.json'), { declarationSha256: declarationSha, startedAt: new Date().toISOString(), pid: process.pid }, true);
  const ledgerPath = path.join(output, 'ledger.json'); await initializePublicLedger(ledgerPath, declarationSha);
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
  let readNativeReceipts: (() => Promise<ModelCallReceipt[]>) | undefined;
  const save = async () => {
    let receipts: ModelCallReceipt[] | undefined; let receiptReadError: unknown;
    try { receipts = await readNativeReceipts?.(); } catch (error) { receiptReadError = publicSafeError(error); }
    await writeJson(path.join(output, 'results.json'), { version: 1, status, elapsedMs: Date.now() - started,
    declarationSha256: declarationSha, actor, database: declaration.database, ownedCourseIds: [...ownedCourses], currentCase, observations, http,
    phaseUsage: summarizePublicCaptures(observer?.captures ?? [], receipts), nativeReceipts: receipts ?? null, receiptReadError: receiptReadError ?? null,
    receiptBindings: receipts ? reconcilePublicCaptures(observer?.captures ?? [], receipts) : null,
    transcriptIds: observer?.captures.map(item => item.id) ?? [], networkFailures,
    error: terminalError ? publicSafeError(terminalError) : null, teacherAcceptance: null, comparison: declaration.comparison,
    observationLimits: 'Facade entries and phase reservations are not dispatches. Actual observed sends come only from native Mongo receipts. Missing/ambiguous per-call links remain unresolved; hidden SDK retries remain unknown.',
    isolation: 'Owned cloned courses and real local Agenda. No fixture cleanup, approvals, publishing, Canvas or student-data writes.' });
  };
  try {
    mongo = runtime<typeof MongoModule>('server/src/components/mongodb/index.ts');
    const db = await mongo.connectMongo(); connected = true;
    assert.equal(await db.collection('agendaJobs').countDocuments({ $or: [{ nextRunAt: { $type: 'date' } }, { lockedAt: { $type: 'date' } }] }), 0, 'Refuse unrelated scheduled/locked Agenda work.');
    assert.equal(await db.collection('contentRuns').countDocuments({ status: { $in: ['queued', 'running'] } }), 0, 'Refuse overlapping durable work in the owned DB.');
    assert.equal(await db.collection('courses').countDocuments({ ownerPuid: { $not: /^(?:QUALITY-RETEST-FIXTURE-|QUALITY-PUBLIC-ACCEPTANCE-)/ } }), 0, 'All existing courses must belong to disposable quality fixtures.');
    await db.collection<{ _id: string; actor: string; scope: string; database: string; createdAt: Date; noCleanup: boolean }>('qualityLabAcceptanceOwnership').insertOne({ _id: declarationSha, actor, scope: PUBLIC_ACCEPTANCE_SCOPE,
      database: declaration.database, createdAt: new Date(), noCleanup: true });
    const collections = runtime<typeof CollectionsModule>('server/src/components/mongodb/collections.ts');
    readNativeReceipts = () => collections.modelCallReceiptsCol().find({ 'actor.puid': actor, courseId: { $in: [...ownedCourses].map(id => new ObjectId(id)) } }).sort({ startedAt: 1, _id: 1 }).toArray();
    for (const spec of collections.INDEX_SPECS.filter(item => ['materials', 'materialChunks', 'authoringTaskPlans', 'questionPedagogicalFingerprints', 'regenerationCandidates'].includes(item.collection))) await db.collection(spec.collection).createIndex(spec.keys, spec.options);
    const authoring = runtime<typeof AuthoringModule>('server/src/services/authoring-commit.service.ts'); assert.equal((await authoring.initializeAuthoringCommitSupport()).available, true);
    const admin = runtime<typeof AdminModule>('server/src/services/admin.service.ts'); const steps = runtime<typeof StepModelsModule>('server/src/services/step-models.ts');
    const settings = await admin.getPlatformSettings(); assert.equal(settings.featureFlags.reviewerAgent, true);
    assert.deepEqual(steps.stepModelsFrom(settings), declaration.expectedModels, 'Configured models/options must match the prospective declaration.');
    await writeJson(path.join(output, 'runtime-settings.json'), { models: steps.stepModelsFrom(settings), featureFlags: settings.featureFlags, costControls: settings.costControls }, true);
    const assertCurrent = async (requireOwnedCourse = true) => {
      await verifyPublicDeclaration(declaration);
      assert.deepEqual(steps.stepModelsFrom(await admin.getPlatformSettings()), declaration.expectedModels);
      assert.equal((await admin.getPlatformSettings()).featureFlags.reviewerAgent, true);
      const ownership = await db.collection<{ _id: string; actor: string }>('qualityLabAcceptanceOwnership').findOne({ _id: declarationSha, actor }); assert(ownership);
      assert.equal(await db.collection('contentRuns').countDocuments({ courseId: { $nin: [...ownedCourses].map(id => new ObjectId(id)) }, status: { $in: ['queued', 'running'] } }), 0, 'Unrelated work appeared in the owned DB.');
      if (requireOwnedCourse && currentCase !== 'preparation') assert(ownedCourses.size > 0, 'Authoring requires an owned course.');
      assert.equal(networkFailures.length, 0);
    };
    const llm = runtime<typeof LlmModule>('server/src/components/genai/llm/index.ts');
    observer = installPublicObservation(llm, { configuration: { provider: env.llmProvider, defaultModel: env.llmDefaultModel }, caseId: () => currentCase, assertCurrent,
      reserve: (admission, caseId) => reservePublicNativeAttempt(ledgerPath, declarationSha, caseId, admission),
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
      await assertCurrent(false); const courseId = new ObjectId(); ownedCourses.add(courseId.toHexString()); const now = new Date();
      const course: Course = { name: `Public acceptance ${label}`, courseCode: `QPA-${courseId.toHexString().slice(-6)}`, term: '2026W1', ownerPuid: actor,
        registrationCode: randomUUID(), published: false, lifecycle: 'draft', feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
        redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: now };
      await collections.coursesCol().insertOne({ _id: courseId, ...course }); user.courseRoles.push({ courseId, role: 'instructor' });
      const theme = await courses.addTheme(courseId, { name: 'Frozen historical finance reference' });
      const thin = await courses.addLo(courseId, theme._id, { name: PUBLIC_CASES[0].loName, kind: 'conceptual' });
      const capm = await courses.addLo(courseId, theme._id, { name: PUBLIC_CASES[1].loName, kind: 'calculation' });
      const sourceReceipts: unknown[] = []; const collectionName = `course-${courseId.toHexString()}`;
      assert(!(await qdrant.qdrant.getCollections()).collections.some(item => item.name === collectionName));
      for (const source of reference.controls.sourceControls) {
        const chapter = source.material.name.startsWith('Chapter 3:') ? 3 : 4; const pdf = declaration.pdfs.find(item => item.chapter === chapter); assert(pdf);
        const materialId = new ObjectId(); const ingestRunId = new ObjectId(); const lo = chapter === 3 ? thin : capm;
        const chunks: MaterialChunk[] = source.chunks.map(chunk => ({ ...chunk, courseId, materialId, createdAt: now }));
        assert.equal(readiness.hashSourceChunks(chunks), source.material.sourceManifest.sourceTextHash);
        const vectors = await embeddings.embed(chunks.map(item => item.text)); assert.equal(vectors.length, chunks.length);
        const dimension = vectors[0]?.length; assert(dimension && vectors.every(vector => vector.length === dimension && vector.every(Number.isFinite)));
        await qdrant.ensureCollection(collectionName, dimension);
        await qdrant.upsertPoints(collectionName, vectors.map((vector, index) => ({ id: randomUUID(), vector,
          payload: { materialId: materialId.toHexString(), chunkIndex: index, chunk: chunks[index].text } })));
        assert.equal((await qdrant.qdrant.count(collectionName, { filter: { must: [{ key: 'materialId', match: { value: materialId.toHexString() } }] }, exact: true })).count, chunks.length);
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
      const response = await pending;
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
    for (const trial of PUBLIC_CASES) {
      currentCase = trial.id; const fixture = await clone(trial.id); const base = `/api/courses/${fixture.courseId.toHexString()}`;
      const input = { qualityPolicy: 'grounded-memory-v2', loId: (trial.sourceChapter === 3 ? fixture.thin : fixture.capm)._id.toHexString(), count: trial.count,
        type: 'mcq', difficulty: trial.difficulty, kind: trial.kind, prompt: trial.prompt };
      const observation: Record<string, unknown> = { id: trial.id, courseId: fixture.courseId, requested: trial.count, input, saved: null, status: 'running', startedAt: new Date().toISOString() };
      const caseStarted = Date.now(); observations.push(observation); await save(); const before: number = observer.captures.length;
      await send('signed-out-generation-denied', 'post', `${base}/generate`, input, 401, 'signed-out');
      await send('foreign-course-generation-denied', 'post', `${base}/generate`, input, 403, 'foreign'); assert.equal(observer.captures.length, before);
      const response = await send('public-generation-enqueue', 'post', `${base}/generate`, input, 202); const runId = (response.body as { runId: string }).runId; assert(ObjectId.isValid(runId));
      observation.runId = runId;
      // An observation delay is never a retry or a terminal worker decision.
      // Keep polling the same durable run until the actual worker is terminal.
      for (;;) {
        const run = await collections.contentRunsCol().findOne({ _id: new ObjectId(runId), courseId: fixture.courseId }); assert(run && run.kind === 'question-generation');
        if (['completed', 'partial', 'failed'].includes(run.status)) { observation.run = run; break; }
        observation.lastObserved = { at: new Date().toISOString(), status: run.status, stage: run.stage }; await save();
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      observer.assertHealthy(); await assertCurrent();
      const terminal = await send('terminal-public-run', 'get', `${base}/content-runs/${runId}`, undefined, 200);
      const exported = await send('terminal-evaluation-export', 'get', `${base}/content-runs/${runId}/evaluation-export`, undefined, 200);
      const usage = await send('terminal-model-usage', 'get', `${base}/content-runs/${runId}/usage`, undefined, 200);
      const run = await collections.contentRunsCol().findOne({ _id: new ObjectId(runId), courseId: fixture.courseId }); assert(run?.kind === 'question-generation');
      const savedIds = run.result?.createdQuestionIds ?? []; const heads = await collections.questionsCol().find({ courseId: fixture.courseId, _id: { $in: savedIds } }).toArray();
      assert(heads.every(head => head.state === 'draft'));
      const versions = await collections.questionVersionsCol().find({ _id: { $in: heads.map(head => head.currentVersionId) } }).toArray();
      const exportBody = exported.body as GenerationEvaluationExport;
      const supply = classifySavedSupply({ requested: trial.count, savedIds: savedIds.map(id => id.toHexString()), ownedDraftIds: heads.map(head => head._id.toHexString()), runId,
        exportedSavedVersionIds: exportBody.slots.flatMap(slot => slot.outcome === 'saved' && slot.questionVersionId ? [slot.questionVersionId] : []),
        versions: versions.map(version => { assert(version.provenance?.kind === 'generated'); return { id: version._id.toHexString(), questionId: version.questionId.toHexString(), runId: version.provenance.runId.toHexString(), item: version.provenance.item }; }) });
      const fingerprints = await collections.questionPedagogicalFingerprintsCol().find({ courseId: fixture.courseId, questionId: { $in: savedIds } }).toArray();
      for (const version of versions) {
        assert(version.taskDescriptor); assert(fingerprints.some(item => item.questionId.equals(version.questionId) && item.versionId.equals(version._id) && item.contentHash === memory.contentFingerprint(version).exact));
        await sample(version);
      }
      let agenda: Array<Record<string, unknown>>;
      for (;;) {
        agenda = await db.collection('agendaJobs').find({ name: 'generation.run', 'data.runId': runId }).toArray(); assert.equal(agenda.length, 1);
        if (agenda[0].lastFinishedAt || agenda[0].failedAt) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert(agenda[0].lastRunAt);
      Object.assign(observation, { status: 'terminal', supply, heads, versions, fingerprints, agenda, terminalHttp: terminal.body as unknown, export: exportBody, usage: usage.body as unknown,
        taskPlans: await collections.authoringTaskPlansCol().find({ courseId: fixture.courseId, runId: new ObjectId(runId) }).toArray(),
        endingMemory: await memory.loadGenerationMemory({ courseId: fixture.courseId, loIds: [fixture.thin._id, fixture.capm._id], includeCrossLo: true }), finishedAt: new Date().toISOString(), authoringRequestWallMs: Date.now() - caseStarted });
      assert.equal((await collections.questionsCol().findOne({ _id: fixture.seed.questionId }))?.currentVersionId.toHexString(), fixture.seed.version._id.toHexString()); await save();
    }
    for (const trial of REGENERATION_CASES) {
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
    assert(nativeReceipts.length <= 78, 'Observed native pipeline/regen maximum is bounded independently of phase reservations.');
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
    } finally { observer?.restore(); try { if (connected && mongo) await mongo.closeMongo(); } finally { restoreSocket(); await fs.rmdir(phaseLock); } }
  }
}

export async function main(): Promise<void> {
  const output = argument('--output'); assert(output, 'Supply a NEW --output directory.');
  if (argument('--live') !== undefined) await live(output); else { assert(!argument('--declaration'), 'Use --live once to execute a declaration.'); await prepare(output); }
}
if (require.main === module) void main().catch(error => { console.error(JSON.stringify(publicSafeError(error))); process.exitCode = 1; });
