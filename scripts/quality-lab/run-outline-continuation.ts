/** Exact retained-proposal continuation. Preparation is file-only. Live mode is
 * a root-reviewed, local-owned execution with no hierarchy Apply or cleanup. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import type { ObjectId } from 'mongodb';
import type { StructureReviewCheckpointBody } from '../../server/src/types/structure-review';
import type { OutlineGroundingBatch } from '../../server/src/services/structure-outline-grounding';
import type { RetainedStructureReviewAuthority, RetainedStructureReviewProjection } from '../../server/src/services/structure-review-retained-import';
import type { StructureGenerationObserver } from '../../server/src/services/structure-generation.service';
import type { ModelCallReceipt } from '../../server/src/types/model-usage';
import type * as EnvModule from '../../server/src/config/env';
import type * as MongoModule from '../../server/src/components/mongodb';
import type * as MongoDriver from 'mongodb';
import type * as StructureModule from '../../server/src/services/structure-generation.service';
import type * as CheckpointModule from '../../server/src/services/structure-review-checkpoint.service';
import type * as GroundingModule from '../../server/src/services/structure-outline-grounding';
import type * as ProjectionModule from '../../server/src/services/structure-review-retained-import';
import type * as CollectionsModule from '../../server/src/components/mongodb/collections';
import type * as CommitModule from '../../server/src/services/authoring-commit.service';
import type * as LlmModule from '../../server/src/components/genai/llm';
import type * as RunsModule from '../../server/src/services/content-runs.service';
import type { ConservativeLedger } from './ledger';
import { assertLedgerIntegrity } from './phase-declaration';
import { installPublicObservation, publicSafeError, reconcilePublicCaptures, summarizePublicCaptures, type PublicNativeAdmission } from './public-acceptance-observation';

const ROOT = path.resolve(__dirname, '../..');
const load = createRequire(__filename);
export const CONTINUATION_SCOPE = 'exact-retained-outline-review-continuation-2026-10-17';
const MUTATION_SCOPE = 'Owned checkpoint/progress/attempt and linked child, ownership marker, scoped indexes, model usage receipts/sessions and course authoringRevision fences only; no Apply, questions, students, Canvas, parent update or cleanup.';
export const CONTINUATION_LIMITS = Object.freeze({ maxSends: 18, maxInputTokens: 48000, maxOutputTokens: 6000, maxConservativeTokens: 972000,
  cumulativeMaxSends: 100, cumulativeMaxConservativeTokens: 2000000 });
export const CONTINUATION_IDENTITY = Object.freeze({ database: 'financebot_quality_smoke_retest_20261016',
  actor: 'QUALITY-RETEST-FIXTURE-81eeb3b2-c89e-4dc3-be9f-4d097eddbecd', courseId: '6ad2ad04e474ab8460b47c07',
  parentRunId: '6ad2d15e19a66b1237767be5', sourceFingerprint: '32c828c5aa9a4778b8f6b0802026a2861968d09bc0362a7be833c14b310a97ed' });
const BASE = path.join(ROOT, 'audit-results/quality-lab-outline-continuation-2026-10-17');
const HISTORICAL = path.join(ROOT, 'audit-results/quality-lab-2026-10-16-outline-v2-acceptance');
const KNOWN = { body: '82aaab21c39e92a113ae5405e4cec4650a3c1a42bcd91d24f9a7657ce7aefd69',
  parent: 'b9248725544524cb4541a297df0d9230769d35507dc9c7c441e25fdf81300fa4',
  projection: '4cdeeb3981b311f43083806206567554f623db2febc54535db0a4332a7d3af1a' };
interface Pin { path: string; sha256: string }
interface CodePin { file: string; sha256: string }
interface ProjectionAudit {
  status: string; manifestHash: string; protocolHash: string;
  summary: { expectedObjectives: number; exactParentBindings: number; resolvedObjectives: number; pendingObjectives: number; positiveFindingsByteUnchanged: number };
  inputs: { body: { sha256: string }; parent: { sha256: string } };
  attempts: Record<string, number>; pendingObjectiveIds: string[];
  correction: { captureFile: string; parsedReplySha256: string; consumedSemanticAttempts: number };
  projection: RetainedStructureReviewProjection;
}
interface ParentArchive {
  runId: string; status: string; diagnosticRun: Record<string, unknown>;
  events: Array<{ stage: string; phase: string; output?: unknown }>;
  captures: Array<{ file: string; transcript: { stage: string; status: string; parsed: unknown;
    attempts: Array<{ input: { prompt: string }; events: Array<{ type: string; requestedModel: string; requestOptions: Record<string, unknown> }> }> } }>;
}
export interface ContinuationDeclaration {
  version: 1; scope: typeof CONTINUATION_SCOPE; createdAt: string; identity: typeof CONTINUATION_IDENTITY;
  limits: typeof CONTINUATION_LIMITS; model: { model: 'gpt-6-luna'; reasoningEffort: 'medium' };
  requestDeadlineMs: 180000;
  transport: 'streamConversation'; historicalOptions: Record<string, unknown>;
  providerIdentityHash: string; historicalEndpointVerification: 'unavailable-not-recorded-in-parent-receipts';
  body: Pin; parent: Pin; projection: Pin; preparation: Pin; sourceFixture: Pin;
  immutableInputs: Pin[]; code: CodePin[]; ledger: Pin; ledgerBefore: ConservativeLedger;
  pending: Array<{ item: number; ids: string[]; promptSha256: string; inputEstimate: number; streamEnvelopeEstimate: number }>;
  mutationScope: typeof MUTATION_SCOPE;
  teacherAcceptance: null; savedQuestions: 0; adoptedQuestions: 0;
}
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hashObject = (value: unknown) => sha(JSON.stringify(value));
const serial = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const runtime = <T>(relative: string): T => load(path.join(ROOT, relative)) as T;
export function recordedContinuationOptions(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['temperature', 'maxTokens', 'max_completion_tokens', 'max_output_tokens', 'reasoning_effort', 'stream', 'responseFormat']
    .filter(key => typeof options[key] === 'string' || typeof options[key] === 'number' || typeof options[key] === 'boolean')
    .map(key => [key, options[key]]));
}

export function parseContinuationArguments(args: string[]): Record<string, string> {
  const allowed = new Set(['--mode', '--output', '--declaration', '--declaration-sha256', '--confirm-root-owned-execution']);
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; const value = args[i + 1];
    assert(allowed.has(key) && !(key in result) && value && !value.startsWith('--'), `Unknown, duplicate or missing argument: ${key}`);
    result[key] = value;
  }
  assert(['prepare', 'live'].includes(result['--mode']) && result['--output'], 'Use --mode prepare|live and a NEW --output directory.');
  if (result['--mode'] === 'prepare') assert.equal(Object.keys(result).length, 2, 'Preparation accepts no runtime/live flags.');
  else assert(result['--declaration'] && /^[a-f0-9]{64}$/.test(result['--declaration-sha256']) && result['--confirm-root-owned-execution'] === 'once');
  return result;
}

/** Recover only trusted source declarations; imports, env, providers and model
 * text are not evaluated during file-only preparation. */
export function recoverContinuationSelector(source: string): (batch: OutlineGroundingBatch, ids: string[]) => OutlineGroundingBatch {
  const ast = ts.createSourceFile('trusted-grounding.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const definitions = new Map(ast.statements.filter(ts.isFunctionDeclaration).filter(statement => statement.name)
    .map(statement => [statement.name!.text, statement.getText(ast).replace(/^export\s+/, '')]));
  for (const name of ['render', 'selectOutlineGroundingBatch']) assert(definitions.has(name), `Trusted declaration missing: ${name}`);
  const code = ts.transpileModule(`${definitions.get('render')}\n${definitions.get('selectOutlineGroundingBatch')}\nselectOutlineGroundingBatch;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return vm.runInNewContext(code, { structuredClone }, { timeout: 1000 }) as (batch: OutlineGroundingBatch, ids: string[]) => OutlineGroundingBatch;
}

export function continuationPendingPlan(body: StructureReviewCheckpointBody, findings: Array<{ id: string }>,
  select: ReturnType<typeof recoverContinuationSelector>): ContinuationDeclaration['pending'] {
  const resolved = new Set(findings.map(row => row.id));
  assert.equal(resolved.size, findings.length, 'Duplicate resolved identities.');
  const expected = body.batches.flatMap(batch => batch.objectives.map(row => row.id));
  assert.equal(new Set(expected).size, expected.length); assert(findings.every(row => expected.includes(row.id)));
  return body.batches.flatMap((batch, item) => {
    const ids = batch.objectives.map(row => row.id).filter(id => !resolved.has(id));
    if (!ids.length) return [];
    const selected = select(batch, ids);
    const inputEstimate = Buffer.byteLength(selected.prompt, 'utf8') + 32;
    const streamEnvelopeEstimate = Buffer.byteLength(JSON.stringify([{ role: 'user', content: selected.prompt }]), 'utf8') + 32;
    assert(inputEstimate <= CONTINUATION_LIMITS.maxInputTokens && streamEnvelopeEstimate <= CONTINUATION_LIMITS.maxInputTokens, 'Full-original review exceeds the prospective input cap.');
    return [{ item, ids, promptSha256: sha(selected.prompt), inputEstimate, streamEnvelopeEstimate }];
  });
}

/** A prefix is immutable including row order/bytes; all new reservations remain
 * charged even if native admission later denies the dispatch. */
export function assertContinuationLedger(before: ConservativeLedger, current: ConservativeLedger): void {
  assertLedgerIntegrity(before); assertLedgerIntegrity(current);
  assert.equal(before.reservedSends, 20); assert.equal(before.conservativeTokens, 1004330);
  assert.equal(before.scope, 'quality-lab-2026-10-16-outline-v2-acceptance');
  assert.deepEqual(before.limits, { maxSends: 100, maxConservativeTokens: 2000000, maxInputTokens: 200000 });
  assert.equal(hashObject({ ...current, reservedSends: before.reservedSends, conservativeTokens: before.conservativeTokens,
    reservations: current.reservations.slice(0, before.reservations.length) }), hashObject(before), 'Original phase prefix/metadata changed.');
  const added = current.reservations.slice(before.reservations.length);
  assert(added.length <= 18 && current.conservativeTokens - before.conservativeTokens <= 972000);
  assert(added.every(row => row.cellId === CONTINUATION_SCOPE && row.stage === 'outline-source-review' && [0, 1].includes(row.jsonAttempt) &&
    row.inputEstimate <= 48000 && row.outputReservation === 6000));
  assert.equal(new Set(current.reservations.map(row => row.id)).size, current.reservations.length);
}

export async function appendContinuationReservation(file: string, before: ConservativeLedger, admission: PublicNativeAdmission,
  jsonAttempt: number): Promise<string> {
  const lock = `${file}.lock`; await fs.mkdir(lock);
  try {
    const current = JSON.parse(await fs.readFile(file, 'utf8')) as ConservativeLedger;
    assertContinuationLedger(before, current);
    assert([0, 1].includes(jsonAttempt) && admission.model === 'gpt-6-luna' && admission.outputCap === 6000 && admission.options.reasoning_effort === 'medium' && admission.options.stream === true);
    const inputEstimate = Buffer.byteLength(admission.prompt + (admission.systemPrompt ?? ''), 'utf8') + 32;
    assert(inputEstimate <= 48000, 'Continuation native envelope input cap.');
    const id = randomUUID(); current.reservations.push({ id, cellId: CONTINUATION_SCOPE, stage: 'outline-source-review', jsonAttempt,
      inputSha256: hashObject(admission), inputEstimate, outputReservation: 6000, reservedAt: new Date().toISOString() });
    current.reservedSends++; current.conservativeTokens += inputEstimate + 6000; assertContinuationLedger(before, current);
    const temporary = `${file}.${randomUUID()}.tmp`; await fs.writeFile(temporary, JSON.stringify(current, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file);
    return id;
  } finally { await fs.rmdir(lock); }
}

export function assertContinuationTarget(value: { mongodbUri: string; mongodbDbName: string; llmProvider: string; llmEndpoint?: string }, providerIdentityHash: string): URL {
  const uri = new URL(value.mongodbUri);
  assert.equal(uri.protocol, 'mongodb:'); assert.equal(uri.hostname, '127.0.0.1'); assert.equal(uri.port, '27029');
  assert.equal(uri.username, ''); assert.equal(uri.password, ''); assert.equal(uri.searchParams.get('directConnection'), 'true');
  assert.equal(value.mongodbDbName, CONTINUATION_IDENTITY.database);
  assert.equal(hashObject({ provider: value.llmProvider, endpoint: value.llmEndpoint }), providerIdentityHash);
  const provider = value.llmEndpoint ? new URL(value.llmEndpoint) : value.llmProvider === 'openai' ? new URL('https://api.openai.com') : undefined;
  assert(provider && ['http:', 'https:'].includes(provider.protocol) && !provider.username && !provider.password, 'Explicit safe provider origin required.');
  return provider;
}

async function codeFiles(directory: string): Promise<string[]> {
  const all: string[] = [];
  for (const entry of await fs.readdir(path.join(ROOT, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) all.push(...await codeFiles(file));
    else if (entry.isFile() && file.endsWith('.ts')) all.push(file);
  }
  return all.sort();
}
async function pin(file: string): Promise<Pin> { return { path: path.resolve(file), sha256: sha(await fs.readFile(file)) }; }
async function verifyPin(value: Pin): Promise<void> { assert.equal(sha(await fs.readFile(value.path)), value.sha256, `Frozen input changed: ${value.path}`); }
async function writeJson(file: string, value: unknown, exclusive = false): Promise<void> {
  if (exclusive) { await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return; }
  const temporary = `${file}.${randomUUID()}.tmp`; await writeJson(temporary, value, true); await fs.rename(temporary, file);
}

export async function prepareContinuationDeclaration(): Promise<ContinuationDeclaration> {
  const [bodyPin, parentPin, projectionPin, preparation, sourceFixture, ledger] = await Promise.all([
    pin(path.join(BASE, 'checkpoint-body.json')), pin(path.join(HISTORICAL, 'live/results.json')), pin(path.join(BASE, 'projection-independent-audit.json')),
    pin(path.join(BASE, 'prepare-receipt.json')), pin(path.join(ROOT, 'audit-results/quality-lab-2026-10-16-phase-two/upload-index/corpus-fixture.json')),
    pin(path.join(HISTORICAL, 'ledger.json'))]);
  assert.equal(bodyPin.sha256, KNOWN.body); assert.equal(parentPin.sha256, KNOWN.parent); assert.equal(projectionPin.sha256, KNOWN.projection);
  const body = JSON.parse(await fs.readFile(bodyPin.path, 'utf8')) as StructureReviewCheckpointBody;
  const projection = JSON.parse(await fs.readFile(projectionPin.path, 'utf8')) as ProjectionAudit;
  const parent = JSON.parse(await fs.readFile(parentPin.path, 'utf8')) as ParentArchive;
  const ledgerBefore = JSON.parse(await fs.readFile(ledger.path, 'utf8')) as ConservativeLedger;
  assertContinuationLedger(ledgerBefore, ledgerBefore);
  assert.equal(body.rootRunId, CONTINUATION_IDENTITY.parentRunId); assert.equal(body.courseId, CONTINUATION_IDENTITY.courseId);
  assert.equal(body.corpus.fingerprint, CONTINUATION_IDENTITY.sourceFingerprint); assert.equal(parent.runId, body.rootRunId);
  assert.equal(body.baseBudget.admissionTokens, 1004330); assert.equal(body.baseBudget.observedSends, 20); assert.equal(body.baseBudget.pendingSends, 0);
  assert.deepEqual(body.model, { model: 'gpt-6-luna', reasoningEffort: 'medium' });
  assert.equal(projection.status, 'passed'); assert.equal(projection.inputs.body.sha256, bodyPin.sha256); assert.equal(projection.inputs.parent.sha256, parentPin.sha256);
  assert.equal(projection.protocolHash, body.protocolHash); assert.equal(projection.manifestHash, parentPin.sha256);
  assert.deepEqual([projection.summary.expectedObjectives, projection.summary.exactParentBindings, projection.summary.resolvedObjectives,
    projection.summary.pendingObjectives, projection.summary.positiveFindingsByteUnchanged], [142, 102, 103, 39, 82]);
  const select = recoverContinuationSelector(await fs.readFile(path.join(ROOT, 'server/src/services/structure-outline-grounding.ts'), 'utf8'));
  const pending = continuationPendingPlan(body, projection.projection.findings, select);
  assert.deepEqual(pending.flatMap(row => row.ids), projection.pendingObjectiveIds);
  assert.deepEqual(projection.pendingObjectiveIds, Array.from({ length: 39 }, (_, i) => `L${104 + i}`));
  assert(pending.length <= 18, 'First passes alone cannot fit.');
  const reviewEvents = parent.captures.filter(row => row.transcript.stage === 'outline-source-review').flatMap(row => row.transcript.attempts.flatMap(attempt => attempt.events.filter(event => event.type === 'started')));
  assert(reviewEvents.length > 0); const historicalOptions = reviewEvents[0].requestOptions;
  assert(reviewEvents.every(event => event.requestedModel === 'gpt-6-luna' && hashObject(event.requestOptions) === hashObject(historicalOptions)));
  assert.equal(historicalOptions.stream, true); assert.equal(historicalOptions.reasoning_effort, 'medium'); assert.equal(historicalOptions.responseFormat, 'json');
  const fixture = JSON.parse(await fs.readFile(sourceFixture.path, 'utf8')) as { courseId: string; actor: string; database: string; sources: Array<{ publicPdf: string; pdfSha256: string }> };
  assert.equal(fixture.courseId, body.courseId); assert.equal(fixture.actor, CONTINUATION_IDENTITY.actor); assert.equal(fixture.database, CONTINUATION_IDENTITY.database);
  assert.equal(fixture.sources.length, 10);
  const immutableInputs = [await pin(path.join(HISTORICAL, 'declaration.json')), await pin(path.join(HISTORICAL, 'live/ledger-before.json')).catch(() => pin(path.join(HISTORICAL, 'preflight/ledger-before.json')))];
  for (const source of fixture.sources) { const pdf = await pin(source.publicPdf); assert.equal(pdf.sha256, source.pdfSha256); immutableInputs.push(pdf); }
  for (const capture of parent.captures) {
    const current = await pin(path.resolve(ROOT, capture.file));
    assert.deepEqual(JSON.parse(await fs.readFile(current.path, 'utf8')), capture.transcript, 'Embedded and retained raw transcript differ.'); immutableInputs.push(current);
  }
  immutableInputs.push(await pin(path.join(HISTORICAL, 'negative-coverage-replay.json')));
  const files = [...await codeFiles('server/src'), ...await codeFiles('scripts/quality-lab'), 'scripts/prompt-ab/usage-summary.ts', 'package.json', 'package-lock.json'];
  const code = await Promise.all([...new Set(files)].sort().map(async file => ({ file, sha256: sha(await fs.readFile(path.join(ROOT, file))) })));
  return { version: 1, scope: CONTINUATION_SCOPE, createdAt: new Date().toISOString(), identity: CONTINUATION_IDENTITY, limits: CONTINUATION_LIMITS,
    model: { model: 'gpt-6-luna', reasoningEffort: 'medium' }, requestDeadlineMs: 180000, transport: 'streamConversation', historicalOptions,
    providerIdentityHash: body.providerIdentityHash, historicalEndpointVerification: 'unavailable-not-recorded-in-parent-receipts',
    body: bodyPin, parent: parentPin, projection: projectionPin, preparation, sourceFixture, immutableInputs, code, ledger, ledgerBefore, pending,
    mutationScope: MUTATION_SCOPE,
    teacherAcceptance: null, savedQuestions: 0, adoptedQuestions: 0 };
}

async function verifyDeclaration(declaration: ContinuationDeclaration): Promise<void> {
  assert.equal(declaration.version, 1); assert.equal(declaration.scope, CONTINUATION_SCOPE); assert.deepEqual(declaration.identity, CONTINUATION_IDENTITY);
  assert.deepEqual(declaration.limits, CONTINUATION_LIMITS); assert.equal(declaration.body.sha256, KNOWN.body);
  assert.equal(declaration.parent.sha256, KNOWN.parent); assert.equal(declaration.projection.sha256, KNOWN.projection);
  assert.deepEqual(declaration.model, { model: 'gpt-6-luna', reasoningEffort: 'medium' }); assert.equal(declaration.transport, 'streamConversation');
  assert.equal(declaration.requestDeadlineMs, 180000); assert.equal(declaration.mutationScope, MUTATION_SCOPE);
  for (const item of [declaration.body, declaration.parent, declaration.projection, declaration.preparation, declaration.sourceFixture, ...declaration.immutableInputs]) await verifyPin(item);
  const files = [...await codeFiles('server/src'), ...await codeFiles('scripts/quality-lab'), 'scripts/prompt-ab/usage-summary.ts', 'package.json', 'package-lock.json'];
  assert.deepEqual(declaration.code.map(item => item.file).sort(), [...new Set(files)].sort(), 'Critical transitive code manifest is incomplete.');
  for (const item of declaration.code) assert.equal(sha(await fs.readFile(path.join(ROOT, item.file))), item.sha256, `Code drift: ${item.file}`);
  assertContinuationLedger(declaration.ledgerBefore, JSON.parse(await fs.readFile(declaration.ledger.path, 'utf8')) as ConservativeLedger);
}

function socketFence(provider: URL, failures: string[]): () => void {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: Parameters<typeof original>) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first as { host?: string; port?: number; path?: string } : { host: String(args[1] ?? 'localhost'), port: Number(first) };
    const host = String(options.host ?? 'localhost'); const port = Number(options.port);
    const local = ['127.0.0.1', 'localhost', '::1'].includes(host) && port === 27029;
    const model = host === provider.hostname && port === Number(provider.port || (provider.protocol === 'https:' ? 443 : 80));
    if (options.path || !local && !model) { failures.push('blocked-unlisted-network-target'); throw new Error('Continuation permits only owned local Mongo and the pinned provider.'); }
    return Reflect.apply(original, this, args);
  } as typeof original;
  return () => { net.Socket.prototype.connect = original; };
}

async function executeContinuation(declaration: ContinuationDeclaration, digest: string, output: string): Promise<void> {
  await verifyDeclaration(declaration);
  assert.equal(sha(await fs.readFile(declaration.ledger.path)), declaration.ledger.sha256, 'Only the exact terminal parent prefix may start.');
  const { env } = runtime<typeof EnvModule>('server/src/config/env.ts');
  const provider = assertContinuationTarget(env, declaration.providerIdentityHash);
  assert.equal(env.llmRequestTimeoutMs, declaration.requestDeadlineMs, 'The bounded total native completion deadline must match the declaration.');
  const lock = `${declaration.ledger.path}.continuation-execution-lock`; await fs.mkdir(lock);
  // Never steal this lock after interruption: unresolved paid work needs review.
  await fs.mkdir(output, { recursive: false, mode: 0o700 }); await fs.mkdir(path.join(output, 'private-transcripts'), { mode: 0o700 });
  await writeJson(path.join(output, 'execution-claim.json'), { declarationSha256: digest, pid: process.pid, startedAt: new Date().toISOString() }, true);
  await writeJson(path.join(output, 'ledger-before.json'), declaration.ledgerBefore, true);
  const networkFailures: string[] = []; const restoreNetwork = socketFence(provider, networkFailures);
  const mongo = runtime<typeof MongoModule>('server/src/components/mongodb/index.ts');
  const started = Date.now(); let connected = false; let childId: ObjectId | undefined; let status = 'preparing'; let terminalError: unknown;
  let observation: ReturnType<typeof installPublicObservation> | undefined;
  const events: Parameters<StructureGenerationObserver['record']>[0][] = [];
  let currentInput: { prompt: string; jsonAttempt: number; callId: string } | undefined;
  let parentBefore: unknown; let receiptReadError: unknown; let nativeReceipts: ModelCallReceipt[] | undefined;
  const save = async () => {
    let child: unknown; let progress: unknown;
    if (connected) try {
      const db = mongo.getDb();
      nativeReceipts = childId ? await db.collection<ModelCallReceipt>('modelCallReceipts').find({ runId: childId.toHexString(), 'actor.puid': declaration.identity.actor }).toArray() : [];
      child = childId ? await db.collection('contentRuns').findOne({ _id: childId }) : null;
      progress = childId ? await db.collection('structureReviewProgress').findOne({ continuationRunId: childId }) : null;
    } catch (error) { receiptReadError = publicSafeError(error); }
    await writeJson(path.join(output, 'results.json'), { version: 1, scope: CONTINUATION_SCOPE, status, declarationSha256: digest,
      elapsedMs: Date.now() - started, childRunId: childId?.toHexString() ?? null, parentRunId: declaration.identity.parentRunId,
      parentBeforeSha256: parentBefore ? hashObject(parentBefore) : null, child: child ?? null, progress: progress ?? null,
      events, transcriptIds: observation?.captures.map(row => row.id) ?? [], nativeReceipts: nativeReceipts ?? null, receiptReadError: receiptReadError ?? null,
      receiptBindings: nativeReceipts ? reconcilePublicCaptures(observation?.captures ?? [], nativeReceipts) : null,
      phaseUsage: summarizePublicCaptures(observation?.captures ?? [], nativeReceipts), networkFailures,
      parentPrefix: { sends: 20, conservativeUnits: 1004330, immutable: true }, limits: CONTINUATION_LIMITS,
      error: terminalError ? publicSafeError(terminalError) : null, teacherAcceptance: null, savedQuestions: 0, adoptedQuestions: 0,
      limitations: ['Exact fixed proposal continuation, not a new extraction, causal A/B or teacher-quality result.',
        'Historical endpoint identity was not recorded; current provider identity is pinned prospectively.',
        'Reservations, facade entries and actual observed native receipts are separate. Unknown usage/dispatch stays unknown and charged.',
        'Eighteen sends allow ten measured first batches and at most eight further sends including portable JSON correction. Completion is not guaranteed.'] });
  };
  try {
    const db = await mongo.connectMongo(); connected = true;
    const { ObjectId: MongoId } = runtime<typeof MongoDriver>('node_modules/mongodb');
    const courseId = new MongoId(declaration.identity.courseId); const parentId = new MongoId(declaration.identity.parentRunId);
    const course = await db.collection('courses').findOne({ _id: courseId, ownerPuid: declaration.identity.actor, authoringDeletionStartedAt: { $exists: false }, archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } }); assert(course);
    assert.equal(await db.collection('courses').countDocuments({ ownerPuid: { $not: /^(?:QUALITY-RETEST-FIXTURE-|QUALITY-PUBLIC-ACCEPTANCE-)/ } }), 0);
    assert.equal(await db.collection('contentRuns').countDocuments({ status: { $in: ['queued', 'running'] } }), 0, 'Unrelated active work is forbidden.');
    assert.equal(await db.collection('agendaJobs').countDocuments({ $or: [{ nextRunAt: { $type: 'date' } }, { lockedAt: { $type: 'date' } }] }), 0, 'Do not start/recover unrelated Agenda work.');
    const parent = await db.collection('contentRuns').findOne({ _id: parentId, courseId, requestedBy: declaration.identity.actor, kind: 'structure-generation', status: 'failed' }); assert(parent);
    const archive = JSON.parse(await fs.readFile(declaration.parent.path, 'utf8')) as ParentArchive;
    assert.deepEqual(serial(parent), serial(archive.diagnosticRun), 'Live terminal parent differs from its immutable archive.'); parentBefore = serial(parent);
    await writeJson(path.join(output, 'parent-before.json'), parentBefore, true);
    const body = JSON.parse(await fs.readFile(declaration.body.path, 'utf8')) as StructureReviewCheckpointBody;
    const proof = JSON.parse(await fs.readFile(declaration.projection.path, 'utf8')) as ProjectionAudit;
    const service = runtime<typeof StructureModule>('server/src/services/structure-generation.service.ts');
    const checkpoints = runtime<typeof CheckpointModule>('server/src/services/structure-review-checkpoint.service.ts');
    const selector = runtime<typeof GroundingModule>('server/src/services/structure-outline-grounding.ts');
    const organization = archive.events.filter(event => event.stage === 'outline-organization' && event.phase === 'output'); assert.equal(organization.length, 1);
    const assertOriginals = async () => {
      const rebuilt = await service.reconstructRetainedStructureProposal(parentId, { proposal: organization[0].output,
        model: declaration.model, expectedSourceFingerprint: declaration.identity.sourceFingerprint, manifestHash: declaration.parent.sha256 });
      assert.deepEqual(rebuilt, body, 'Cache-only reconstruction/source/proposal changed.');
    };
    await assertOriginals();
    const correctionCapture = archive.captures.filter(row => row.file === proof.correction.captureFile); assert.equal(correctionCapture.length, 1);
    const correction = correctionCapture[0].transcript.parsed; assert.equal(hashObject(correction), proof.correction.parsedReplySha256);
    const parentFindings = body.importedAuthority!.originalFindings;
    const authority: RetainedStructureReviewAuthority = { parentRunId: body.rootRunId, parentCourseId: body.courseId, terminalStatus: 'failed',
      parentFindings, parentFindingHashes: body.importedAuthority!.parentFindingHashes, parentExpectedIds: body.batches.flatMap(batch => batch.objectives.map(row => row.id)),
      parentAttempts: Object.fromEntries(Object.entries(proof.attempts).filter(([id]) => id !== 'L96')),
      corrected: { raw: correction, rawSha256: proof.correction.parsedReplySha256,
        batch: selector.selectOutlineGroundingBatch(body.batches.find(batch => batch.objectives.some(row => row.id === 'L96'))!, ['L96']), consumedAttempts: 2 },
      expectedParentCount: 102, manifestHash: declaration.parent.sha256 };
    const projected = runtime<typeof ProjectionModule>('server/src/services/structure-review-retained-import.ts').projectRetainedStructureReviews(body, authority);
    assert.deepEqual(projected, proof.projection);
    await db.collection<{ _id: string; scope: string; courseId: ObjectId; parentId: ObjectId; actor: string }>('qualityLabOutlineContinuationOwnership')
      .insertOne({ _id: digest, scope: CONTINUATION_SCOPE, courseId, parentId, actor: declaration.identity.actor });
    const collections = runtime<typeof CollectionsModule>('server/src/components/mongodb/collections.ts');
    for (const spec of collections.INDEX_SPECS.filter(spec => spec.collection.startsWith('structureReview') || spec.options?.name === 'one_structure_review_continuation')) await db.collection(spec.collection).createIndex(spec.keys, spec.options);
    const topology = await runtime<typeof CommitModule>('server/src/services/authoring-commit.service.ts').initializeAuthoringCommitSupport(); assert.equal(topology.available, true, 'Require audited transaction support.');
    const checkpoint = await checkpoints.importRetainedStructureReviewCheckpoint(body, authority, assertOriginals);
    const child = await checkpoints.createStructureReviewContinuation(parentId, declaration.identity.actor, assertOriginals); childId = child._id;
    assert.equal(child.status, 'queued', 'An existing child is never restarted.');
    const assertCurrent = async () => {
      await verifyDeclaration(declaration); assert.equal(networkFailures.length, 0);
      assert.deepEqual(serial(await db.collection('contentRuns').findOne({ _id: parentId })), parentBefore, 'Historical parent mutated.');
      assert(await db.collection('courses').findOne({ _id: courseId, ownerPuid: declaration.identity.actor, authoringDeletionStartedAt: { $exists: false }, archivedAt: { $exists: false }, lifecycle: { $ne: 'archived' } }));
      assert.equal(await db.collection('contentRuns').countDocuments({ _id: { $ne: childId }, status: { $in: ['queued', 'running'] } }), 0);
      assert(await db.collection<{ _id: string }>('qualityLabOutlineContinuationOwnership').findOne({ _id: digest }));
    };
    const facade = runtime<typeof LlmModule>('server/src/components/genai/llm/index.ts');
    observation = installPublicObservation(facade, { configuration: { provider: env.llmProvider, defaultModel: env.llmDefaultModel }, caseId: () => CONTINUATION_SCOPE,
      assertCurrent, reserve: async admission => {
        assert(currentInput, 'Native JSON hook must precede facade entry.'); assert.equal(admission.options.stream, true);
        assert.deepEqual(recordedContinuationOptions(admission.options), declaration.historicalOptions, 'Actual options differ from the prospective historical transport.');
        const payload = JSON.parse(admission.prompt) as Array<{ role: string; content: string }>;
        assert.deepEqual(payload, [{ role: 'user', content: currentInput.prompt }]);
        return appendContinuationReservation(declaration.ledger.path, declaration.ledgerBefore, admission, currentInput.jsonAttempt);
      }, save: capture => writeJson(path.join(output, 'private-transcripts', `${capture.id}.json`), capture) });
    const observer: StructureGenerationObserver = { model: declaration.model, transport: 'stream', record: async event => {
      assert.equal(event.stage, 'outline-source-review', 'Extraction/organization are forbidden in exact continuation.');
      events.push(structuredClone(event));
      if (event.phase === 'input') currentInput = { prompt: event.prompt, jsonAttempt: event.jsonAttempt, callId: event.callId };
      await writeJson(path.join(output, 'events.json'), events);
    } };
    status = 'running'; await save(); await service.runStructureGeneration(child._id, observer);
    observation.assertHealthy(); await assertCurrent();
    const terminal = await db.collection('contentRuns').findOne({ _id: child._id }); assert(terminal && ['completed', 'failed'].includes(String(terminal.status)));
    const progress = await collections.structureReviewProgressCol().findOne({ checkpointId: checkpoint._id }); assert(progress);
    const attempts = await collections.structureReviewAttemptsCol().find({ checkpointId: checkpoint._id, runId: child._id }).toArray();
    await writeJson(path.join(output, 'attempts.json'), attempts, true);
    assert(proof.projection.findings.every(row => progress.findings.some(found => hashObject(found) === hashObject(row))), 'Retained findings changed.');
    assert(attempts.every(row => row.ids.every(id => proof.pendingObjectiveIds.includes(id))), 'A resolved objective was re-reviewed.');
    assertContinuationLedger(declaration.ledgerBefore, JSON.parse(await fs.readFile(declaration.ledger.path, 'utf8')) as ConservativeLedger);
    status = terminal.status === 'completed' ? 'completed' : 'stopped'; if (status !== 'completed') process.exitCode = 1;
  } catch (error) {
    terminalError = error; status = 'stopped'; process.exitCode = 1;
    if (connected && childId) {
      const runs = runtime<typeof RunsModule>('server/src/services/content-runs.service.ts');
      const child = await runs.getContentRun(childId);
      if (child && ['queued', 'running'].includes(child.status)) await runs.failContentRun(childId, { code: 'structure-review-controlled-execution-stopped',
        message: 'The controlled continuation stopped. Retained progress and all conservative reservations remain charged; no automatic retry or Apply occurred.',
        atStage: child.stage, retryable: false });
    }
  }
  finally {
    try { await save(); await fs.copyFile(declaration.ledger.path, path.join(output, 'ledger-after.json'), fs.constants.COPYFILE_EXCL); }
    finally { observation?.restore(); if (connected) await mongo.closeMongo(); restoreNetwork(); }
  }
  console.log(JSON.stringify({ status, output, childRunId: childId?.toHexString() ?? null, savedQuestions: 0, adoptedQuestions: 0 }));
}

async function main(): Promise<void> {
  const args = parseContinuationArguments(process.argv.slice(2)); const output = path.resolve(args['--output']);
  if (args['--mode'] === 'prepare') {
    const declaration = await prepareContinuationDeclaration(); await fs.mkdir(output, { recursive: false, mode: 0o700 });
    await writeJson(path.join(output, 'declaration.json'), declaration, true);
    console.log(JSON.stringify({ status: 'prepared-file-only', output, declarationSha256: sha(await fs.readFile(path.join(output, 'declaration.json'))),
      firstPassBatches: declaration.pending.length, pendingObjectives: declaration.pending.flatMap(row => row.ids).length, limits: CONTINUATION_LIMITS,
      providerCalls: 0, databaseReads: 0, databaseWrites: 0 })); return;
  }
  const bytes = await fs.readFile(args['--declaration']); assert.equal(sha(bytes), args['--declaration-sha256']);
  await executeContinuation(JSON.parse(bytes.toString()) as ContinuationDeclaration, args['--declaration-sha256'], output);
}
if (require.main === module) void main().catch(error => { console.error(publicSafeError(error)); process.exitCode = 1; });
