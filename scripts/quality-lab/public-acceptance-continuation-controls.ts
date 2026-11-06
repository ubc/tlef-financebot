/** File-only authority and cumulative accounting for one missing-only continuation. */
import assert from 'node:assert/strict';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PUBLIC_ACCEPTANCE_LIMITS, PUBLIC_ACCEPTANCE_SCOPE, PUBLIC_CASES, publicHash, publicObjectHash, verifyPublicDeclaration,
  type PublicAcceptanceDeclaration } from './public-acceptance-controls';
import { reservePublicNativeAttempt, type PublicNativeAdmission, type PublicNativeLedger } from './public-acceptance-observation';

export const PUBLIC_CONTINUATION_CASES = ['regeneration-create-independent-task', 'stale-original-version-negative'] as const;
/** The stopped receipt is authority, not a new run assembled from editable data. */
export const PUBLIC_CONTINUATION_PARENT_HASHES = Object.freeze({
  parentDeclaration: '8a8bc7263fc45a38c48754d538a6c9b5d7ac794db9a8eba2a15e5afd362f88a9',
  results: '56473c7065ed5b4e77ca1712a2ad4658afe6413d1751cba469deb78d5403a173',
  ledger: 'bba5e9405b5119de5a76399202dfed8166a48f921bddfb8e202fedba2f583260',
  terminal: '2968b0d7442dda3926d2354acb7f10350ed009dee27d0eeb51a3ee87b209c695',
  failureAudit: '342f74298717474d1ccfad4c4a4a956c7ff3743be183b4bb4130325c9c494c88',
});
export const PUBLIC_HISTORICAL_CODE_MANIFEST_SHA256 = '4d4a17ebd2b6bc2b08a123130c13cc4f3d58be77302fd7fb79bcbee5b69b77da';
const ROOT = path.resolve(__dirname, '../..');
export interface ContinuationPin { file: string; sha256: string }
export interface PublicContinuationDeclaration extends PublicAcceptanceDeclaration {
  continuation: { version: 1; origin: string; parentDeclaration: ContinuationPin; results: ContinuationPin; ledger: ContinuationPin;
    terminal: ContinuationPin; failureAudit: ContinuationPin; evidence: ContinuationPin[]; originalActor: string;
    originalCourseIds: string[]; abandonedFixtureId: string; completedCaseIds: string[];
    historicalCodeManifest: ContinuationPin; codeChanges: Array<{ file: string; historicalSha256: string; prospectiveSha256: string }>;
    missing: typeof PUBLIC_CONTINUATION_CASES; prefix: { attempts: 37; units: 717877; remainingAttempts: 41; remainingUnits: 3026123 };
    claimFile: string; transport: { provider: 'openai' | 'ubc-llm-sandbox'; endpoint: string; requestTimeoutMs: 180000 } };
}
export const continuationJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;
export const continuationPin = async (file: string): Promise<ContinuationPin> => ({ file: path.resolve(file), sha256: publicHash(await readFile(file)) });
const identical = (a: unknown, b: unknown) => assert.equal(publicObjectHash(a), publicObjectHash(b));
interface OriginalResult { status: string; declarationSha256: string; database: string; actor: string; ownedCourseIds: string[]; currentCase: string;
  phaseUsage: { attemptReservations: number }; observations: Array<{ id: string; status: string; requested: number; supply?: { requested: number }; adopted?: number }>;
  http: Array<{ label: string; caseId: string }>; nativeReceipts: Array<{ _id: string; outcome: string }>; transcriptIds: string[] }
interface OriginalTerminal { status: string; exitCode: number; runningProcessRemains: boolean; files: ContinuationPin[]; completedRegeneration: Array<{ id: string }> }
interface OriginalFailure { processExitCode: number; activeOwnedContentRuns: number; failedSetupCourseId: string; noAdditionalIndependentTaskProviderCalls: boolean;
  verifiedPartialFixture: { materials: number; questions: number; regenerationCandidates: number }; preservedBudget: { attemptReservations: number; conservativeUnits: number } }

export function assertContinuationPrefix(ledger: PublicNativeLedger): void {
  assert.equal(ledger.version, 1); assert.equal(ledger.scope, PUBLIC_ACCEPTANCE_SCOPE); identical(ledger.limits, PUBLIC_ACCEPTANCE_LIMITS);
  assert.equal(ledger.accounting, 'conservative-native-attempt-reservations-v1');
  assert.equal(ledger.attemptReservations, ledger.reservations.length);
  assert.equal(new Set(ledger.reservations.map(row => row.id)).size, ledger.reservations.length);
  assert.equal(ledger.conservativeUnits, ledger.reservations.reduce((sum, row) => {
    assert(Number.isSafeInteger(row.inputEstimate) && row.inputEstimate >= 0 && Number.isSafeInteger(row.outputReservation) && row.outputReservation > 0);
    return sum + row.inputEstimate + row.outputReservation;
  }, 0));
  assert.equal(ledger.attemptReservations, 37); assert.equal(ledger.conservativeUnits, 717877);
}

export function validatePublicContinuationParent(result: OriginalResult, ledger: PublicNativeLedger, terminal: OriginalTerminal, failure: OriginalFailure): void {
  assert.equal(result.status, 'stopped'); assert.equal(terminal.status, 'stopped'); assert.equal(terminal.exitCode, 1); assert.equal(terminal.runningProcessRemains, false);
  assertContinuationPrefix(ledger); assert.equal(result.phaseUsage.attemptReservations, 37);
  assert.equal(result.currentCase, PUBLIC_CONTINUATION_CASES[0]);
  const expected = [...PUBLIC_CASES.map(row => row.id), 'regeneration-edit-existing', 'regeneration-create-variant'];
  assert.deepEqual(result.observations.map(row => row.id), expected); assert(result.observations.every(row => row.status === 'terminal'));
  for (const trial of PUBLIC_CASES) assert.equal(result.observations.find(row => row.id === trial.id)?.supply?.requested, trial.count);
  for (const id of expected.slice(3)) assert.equal(result.observations.find(row => row.id === id)?.adopted, 1);
  assert.deepEqual(terminal.completedRegeneration.map(row => row.id), expected.slice(3));
  assert(!result.http.some(row => row.caseId === PUBLIC_CONTINUATION_CASES[0] || row.caseId === PUBLIC_CONTINUATION_CASES[1]));
  assert.equal(result.nativeReceipts.length, 37); assert(result.nativeReceipts.every(row => row.outcome !== 'pending'));
  assert.equal(new Set(result.nativeReceipts.map(row => row._id)).size, 37); assert.equal(result.transcriptIds.length, 37); assert.equal(new Set(result.transcriptIds).size, 37);
  assert.equal(failure.processExitCode, 1); assert.equal(failure.activeOwnedContentRuns, 0); assert.equal(failure.noAdditionalIndependentTaskProviderCalls, true);
  assert.equal(failure.verifiedPartialFixture.materials, 1); assert.equal(failure.verifiedPartialFixture.questions, 0); assert.equal(failure.verifiedPartialFixture.regenerationCandidates, 0);
  assert.equal(failure.preservedBudget.attemptReservations, 37); assert.equal(failure.preservedBudget.conservativeUnits, 717877);
  assert(result.ownedCourseIds.includes(failure.failedSetupCourseId)); assert.match(result.actor, /^QUALITY-PUBLIC-ACCEPTANCE-/);
}

export function validatePublicContinuationAuthority(c: PublicContinuationDeclaration['continuation']): void {
  assert.equal(c.version, 1); identical(c.missing, PUBLIC_CONTINUATION_CASES);
  identical(c.prefix, { attempts: 37, units: 717877, remainingAttempts: 41, remainingUnits: 3026123 });
  assert.equal(c.transport.requestTimeoutMs, 180000); assert(['openai', 'ubc-llm-sandbox'].includes(c.transport.provider));
  const endpoint = new URL(c.transport.endpoint); assert(['http:', 'https:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash);
  assert.equal(c.claimFile, path.join(c.origin, 'missing-only-continuation.claim.json'));
  assert.equal(c.origin, path.resolve(c.origin));
  for (const [key, name] of [['results', 'results.json'], ['ledger', 'ledger.json'], ['terminal', 'terminal-receipt.json'], ['failureAudit', 'local-fixture-failure-audit.json']] as const) assert.equal(c[key].file, path.join(c.origin, name));
  for (const key of ['parentDeclaration', 'results', 'ledger', 'terminal', 'failureAudit'] as const) assert.equal(c[key].sha256, PUBLIC_CONTINUATION_PARENT_HASHES[key]);
  assert.equal(c.historicalCodeManifest.file, path.join(c.origin, 'code-snapshot/manifest-final.json'));
  assert.equal(c.historicalCodeManifest.sha256, PUBLIC_HISTORICAL_CODE_MANIFEST_SHA256);
}
/** Read and hash archived bytes only. Archived modules are never imported. */
export async function verifyPublicHistoricalCode(parent: PublicAcceptanceDeclaration, origin: string, pin: ContinuationPin): Promise<void> {
  assert.equal(pin.file, path.join(origin, 'code-snapshot/manifest-final.json')); assert.equal(pin.sha256, PUBLIC_HISTORICAL_CODE_MANIFEST_SHA256);
  assert.equal(publicHash(await readFile(pin.file)), pin.sha256);
  const manifest = await continuationJson<{ files: Array<{ file: string; expectedSha256: string; verified: boolean; snapshot: string; snapshotSha256: string }> }>(pin.file);
  assert.equal(manifest.files.length, parent.code.length); assert.equal(new Set(manifest.files.map(row => row.file)).size, manifest.files.length);
  const historical = parent.code.map(item => {
    const relative = path.relative(ROOT, item.file); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    const archived = manifest.files.find(row => row.file === relative); assert(archived && archived.verified);
    const file = path.join(origin, 'code-snapshot', relative); assert.equal(archived.snapshot, file);
    assert.equal(archived.expectedSha256, item.sha256); assert.equal(archived.snapshotSha256, item.sha256);
    return { file, sha256: item.sha256 };
  });
  // This ephemeral path projection preserves the unchanged declaration file.
  await verifyPublicDeclaration({ ...parent, code: historical });
}
function codeChanges(parent: PublicAcceptanceDeclaration, prospective: PublicAcceptanceDeclaration): PublicContinuationDeclaration['continuation']['codeChanges'] {
  return parent.code.flatMap(old => { const current = prospective.code.find(row => row.file === old.file); assert(current, `Historical code disappeared: ${old.file}`);
    return old.sha256 === current.sha256 ? [] : [{ file: old.file, historicalSha256: old.sha256, prospectiveSha256: current.sha256 }]; });
}
export async function verifyPublicContinuationDeclaration(d: PublicContinuationDeclaration): Promise<void> {
  validatePublicContinuationAuthority(d.continuation); await verifyPublicDeclaration(d); const c = d.continuation;
  for (const pin of [c.parentDeclaration, c.results, c.ledger, c.terminal, c.failureAudit, ...c.evidence]) assert.equal(publicHash(await readFile(pin.file)), pin.sha256, `Continuation authority changed: ${pin.file}`);
  const parent = await continuationJson<PublicAcceptanceDeclaration>(c.parentDeclaration.file); await verifyPublicHistoricalCode(parent, c.origin, c.historicalCodeManifest);
  identical(c.codeChanges, codeChanges(parent, d));
  const result = await continuationJson<OriginalResult>(c.results.file); const ledger = await continuationJson<PublicNativeLedger>(c.ledger.file);
  const terminal = await continuationJson<OriginalTerminal>(c.terminal.file); const failure = await continuationJson<OriginalFailure>(c.failureAudit.file);
  validatePublicContinuationParent(result, ledger, terminal, failure);
  const evidenceFiles = ['execution-claim.json', 'runtime-settings.json', ...result.observations.map(row => `fixture-${row.id}.json`), ...result.transcriptIds.map(id => `private-transcripts/${id}.json`)];
  assert.deepEqual(c.evidence.map(pin => pin.file), evidenceFiles.map(file => path.join(c.origin, file)), 'Keep every original fixture and native transcript pin.');
  assert.equal(result.declarationSha256, c.parentDeclaration.sha256); assert.equal(ledger.declarationSha256, c.parentDeclaration.sha256);
  assert.equal(d.database, result.database); assert.equal(c.originalActor, result.actor); identical(c.originalCourseIds, result.ownedCourseIds);
  assert.equal(c.abandonedFixtureId, failure.failedSetupCourseId); identical(c.completedCaseIds, result.observations.map(row => row.id));
  identical(d.expectedModels, parent.expectedModels); identical(d.pdfs, parent.pdfs); identical(d.historicalReference, parent.historicalReference); identical(d.corpus, parent.corpus);
  for (const pin of [c.results, c.ledger]) assert(terminal.files.some(file => file.file === pin.file && file.sha256 === pin.sha256));
}

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }); const found: string[] = [];
  for (const entry of entries) { const file = path.join(directory, entry.name); if (entry.isDirectory()) found.push(...await typescriptFiles(file)); else if (entry.isFile() && file.endsWith('.ts')) found.push(file); }
  return found;
}
export async function preparePublicContinuation(input: { origin: string; parentDeclaration: string; output: string; provider: 'openai' | 'ubc-llm-sandbox'; endpoint: string }): Promise<string> {
  const origin = path.resolve(input.origin); const parentPin = await continuationPin(input.parentDeclaration);
  const parent = await continuationJson<PublicAcceptanceDeclaration>(parentPin.file);
  const historicalCodeManifest = await continuationPin(path.join(origin, 'code-snapshot/manifest-final.json'));
  await verifyPublicHistoricalCode(parent, origin, historicalCodeManifest);
  const result = await continuationJson<OriginalResult>(path.join(origin, 'results.json'));
  const failure = await continuationJson<OriginalFailure>(path.join(origin, 'local-fixture-failure-audit.json'));
  const evidenceFiles = ['execution-claim.json', 'runtime-settings.json', ...result.observations.map(row => `fixture-${row.id}.json`), ...result.transcriptIds.map(id => `private-transcripts/${id}.json`)];
  const code = await Promise.all([...await typescriptFiles(path.join(ROOT, 'server/src')), ...await typescriptFiles(path.join(ROOT, 'scripts/quality-lab')),
    path.join(ROOT, 'package.json'), path.join(ROOT, 'package-lock.json')].sort().map(async file => ({ file, sha256: publicHash(await readFile(file)) })));
  const ledgerPin = await continuationPin(path.join(origin, 'ledger.json'));
  const d: PublicContinuationDeclaration = { ...parent, code, preparedAt: new Date().toISOString(), priorLedgers: [...parent.priorLedgers, { path: ledgerPin.file, sha256: ledgerPin.sha256, scope: (await continuationJson<PublicNativeLedger>(ledgerPin.file)).scope }],
    continuation: { version: 1, origin, parentDeclaration: parentPin, results: await continuationPin(path.join(origin, 'results.json')), ledger: ledgerPin,
      terminal: await continuationPin(path.join(origin, 'terminal-receipt.json')), failureAudit: await continuationPin(path.join(origin, 'local-fixture-failure-audit.json')),
      evidence: await Promise.all(evidenceFiles.map(file => continuationPin(path.join(origin, file)))), originalActor: result.actor, originalCourseIds: result.ownedCourseIds,
      historicalCodeManifest, codeChanges: codeChanges(parent, { ...parent, code }),
      abandonedFixtureId: failure.failedSetupCourseId, completedCaseIds: result.observations.map(row => row.id), missing: PUBLIC_CONTINUATION_CASES,
      prefix: { attempts: 37, units: 717877, remainingAttempts: 41, remainingUnits: 3026123 }, claimFile: path.join(origin, 'missing-only-continuation.claim.json'),
      transport: { provider: input.provider, endpoint: new URL(input.endpoint).href, requestTimeoutMs: 180000 } } };
  await verifyPublicContinuationDeclaration(d); await mkdir(input.output, { recursive: false });
  const file = path.join(input.output, 'declaration.json'); await writeFile(file, JSON.stringify(d, null, 2) + '\n', { flag: 'wx' }); return publicHash(await readFile(file));
}

export async function initializePublicContinuationLedger(file: string, d: PublicContinuationDeclaration, digest: string): Promise<void> {
  assert.match(digest, /^[a-f0-9]{64}$/); assert.equal(publicHash(await readFile(d.continuation.ledger.file)), d.continuation.ledger.sha256);
  const parent = await continuationJson<PublicNativeLedger>(d.continuation.ledger.file); assertContinuationPrefix(parent);
  await writeFile(file, JSON.stringify({ ...parent, declarationSha256: digest, continuationParent: d.continuation.ledger }, null, 2) + '\n', { flag: 'wx' });
}
export async function claimPublicContinuation(d: PublicContinuationDeclaration, digest: string, output: string): Promise<void> {
  assert.match(digest, /^[a-f0-9]{64}$/);
  await writeFile(d.continuation.claimFile, JSON.stringify({ declarationSha256: digest, output: path.resolve(output), pid: process.pid, parentLedger: d.continuation.ledger }, null, 2) + '\n', { flag: 'wx' });
}
export async function assertPublicContinuationLedger(file: string, d: PublicContinuationDeclaration, digest: string): Promise<void> {
  assert.match(digest, /^[a-f0-9]{64}$/); assert.equal(publicHash(await readFile(d.continuation.ledger.file)), d.continuation.ledger.sha256);
  const parent = await continuationJson<PublicNativeLedger>(d.continuation.ledger.file); assertContinuationPrefix(parent);
  const child = await continuationJson<PublicNativeLedger & { continuationParent: ContinuationPin }>(file);
  assert.equal(child.version, 1); assert.equal(child.scope, parent.scope); assert.equal(child.accounting, parent.accounting);
  assert.equal(child.declarationSha256, digest); identical(child.continuationParent, d.continuation.ledger); identical(child.limits, parent.limits);
  identical(child.reservations.slice(0, 37), parent.reservations); assert.equal(child.attemptReservations, child.reservations.length);
  assert.equal(new Set(child.reservations.map(row => row.id)).size, child.reservations.length);
  assert.equal(child.conservativeUnits, child.reservations.reduce((sum, row) => {
    assert(Number.isSafeInteger(row.inputEstimate) && row.inputEstimate >= 0 && row.inputEstimate <= child.limits.maxInputTokens);
    assert(Number.isSafeInteger(row.outputReservation) && row.outputReservation > 0 && row.outputReservation <= child.limits.maxOutputTokens);
    return sum + row.inputEstimate + row.outputReservation;
  }, 0));
  assert(child.reservations.slice(37).every(row => row.caseId === PUBLIC_CONTINUATION_CASES[0]), 'Only the missing independent task may reserve a new model attempt.');
  assert(child.attemptReservations >= 37 && child.attemptReservations <= 78 && child.conservativeUnits >= 717877 && child.conservativeUnits <= 3744000);
}
export async function reservePublicContinuationAttempt(file: string, d: PublicContinuationDeclaration, digest: string, caseId: string, admission: PublicNativeAdmission): Promise<string> {
  assert.equal(caseId, PUBLIC_CONTINUATION_CASES[0], 'Only the missing independent task may send models.');
  await assertPublicContinuationLedger(file, d, digest);
  const child = await continuationJson<PublicNativeLedger>(file);
  assert(child.attemptReservations - 37 < 8, 'One durable regeneration has at most eight native reservations.');
  return reservePublicNativeAttempt(file, digest, caseId, admission);
}
