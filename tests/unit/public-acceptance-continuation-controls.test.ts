import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PUBLIC_ACCEPTANCE_LIMITS, PUBLIC_ACCEPTANCE_SCOPE, PUBLIC_CASES, publicHash } from '../../scripts/quality-lab/public-acceptance-controls';
import { PUBLIC_CONTINUATION_CASES, PUBLIC_CONTINUATION_PARENT_HASHES, PUBLIC_HISTORICAL_CODE_MANIFEST_SHA256, assertContinuationPrefix, validatePublicContinuationParent,
  validatePublicContinuationAuthority, claimPublicContinuation, initializePublicContinuationLedger, assertPublicContinuationLedger,
  reservePublicContinuationAttempt, type PublicContinuationDeclaration } from '../../scripts/quality-lab/public-acceptance-continuation-controls';
import type { PublicNativeLedger, PublicNativeAdmission } from '../../scripts/quality-lab/public-acceptance-observation';
import { main, parsePublicContinuationArguments } from '../../scripts/quality-lab/run-public-acceptance-continuation';

jest.mock('../../server/src/config/env', () => { throw new Error('Offline continuation must not import runtime config.'); });
jest.mock('../../server/src/components/mongodb', () => { throw new Error('Offline continuation must not import Mongo.'); });
jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Offline continuation must not import providers.'); });

const digest = 'a'.repeat(64);
function prefix(): PublicNativeLedger {
  return { version: 1, scope: PUBLIC_ACCEPTANCE_SCOPE, accounting: 'conservative-native-attempt-reservations-v1', declarationSha256: 'b'.repeat(64),
    limits: PUBLIC_ACCEPTANCE_LIMITS, attemptReservations: 37, conservativeUnits: 717877,
    reservations: Array.from({ length: 37 }, (_, i) => ({ id: `old-${i}`, caseId: 'already-completed', inputSha256: 'c'.repeat(64),
      inputEstimate: 10000, outputReservation: i === 36 ? 23877 : 9000, at: '2026-10-17T00:00:00Z' })) };
}
function parent() {
  const observations: Parameters<typeof validatePublicContinuationParent>[0]['observations'] = [...PUBLIC_CASES.map(item => ({ id: item.id, status: 'terminal', requested: item.count, supply: { requested: item.count } })),
    ...['regeneration-edit-existing', 'regeneration-create-variant'].map(id => ({ id, status: 'terminal', requested: 1, adopted: 1 }))];
  return { result: { status: 'stopped', declarationSha256: digest, database: 'financebot_quality_smoke_retest_unit', actor: 'QUALITY-PUBLIC-ACCEPTANCE-unit',
    ownedCourseIds: ['old', 'partial'], currentCase: PUBLIC_CONTINUATION_CASES[0], phaseUsage: { attemptReservations: 37 }, observations,
    http: [] as Array<{ caseId: string; label: string }>, nativeReceipts: Array.from({ length: 37 }, (_, i) => ({ _id: `native-${i}`, outcome: 'succeeded' })),
    transcriptIds: Array.from({ length: 37 }, (_, i) => `transcript-${i}`) },
  terminal: { status: 'stopped', exitCode: 1, runningProcessRemains: false, files: [], completedRegeneration: observations.slice(3) },
  failure: { processExitCode: 1, activeOwnedContentRuns: 0, failedSetupCourseId: 'partial', noAdditionalIndependentTaskProviderCalls: true,
    verifiedPartialFixture: { materials: 1, questions: 0, regenerationCandidates: 0 }, preservedBudget: { attemptReservations: 37, conservativeUnits: 717877 } } };
}
function authority(origin: string): PublicContinuationDeclaration['continuation'] {
  const pin = (key: keyof typeof PUBLIC_CONTINUATION_PARENT_HASHES, name: string) => ({ file: path.join(origin, name), sha256: PUBLIC_CONTINUATION_PARENT_HASHES[key] });
  return { version: 1, origin, parentDeclaration: pin('parentDeclaration', 'declaration.json'), results: pin('results', 'results.json'), ledger: pin('ledger', 'ledger.json'),
    terminal: pin('terminal', 'terminal-receipt.json'), failureAudit: pin('failureAudit', 'local-fixture-failure-audit.json'), evidence: [], originalActor: 'owned', originalCourseIds: [],
    abandonedFixtureId: 'partial', completedCaseIds: [], historicalCodeManifest: { file: path.join(origin, 'code-snapshot/manifest-final.json'), sha256: PUBLIC_HISTORICAL_CODE_MANIFEST_SHA256 }, codeChanges: [], missing: PUBLIC_CONTINUATION_CASES, prefix: { attempts: 37, units: 717877, remainingAttempts: 41, remainingUnits: 3026123 },
    claimFile: path.join(origin, 'missing-only-continuation.claim.json'), transport: { provider: 'openai', endpoint: 'https://api.openai.com/v1', requestTimeoutMs: 180000 } };
}
const admission: PublicNativeAdmission = { prompt: 'Original evidence β', provider: 'openai', model: 'test', options: { max_completion_tokens: 8000 }, outputCap: 8000, jsonAttempt: null };

describe('missing-only public continuation authority', () => {
  it('admits the stopped five-completed-case prefix without changing it', () => {
    const p = parent(); const ledger = prefix(); const before = JSON.stringify({ ...p, ledger });
    expect(() => validatePublicContinuationParent(p.result, ledger, p.terminal, p.failure)).not.toThrow();
    expect(JSON.stringify({ ...p, ledger })).toBe(before);
  });
  it.each(['running', 'completed'])('refuses a %s parent and a still-running original process', status => {
    const p = parent(); p.result.status = status;
    expect(() => validatePublicContinuationParent(p.result, prefix(), p.terminal, p.failure)).toThrow();
    p.result.status = 'stopped'; p.terminal.runningProcessRemains = true;
    expect(() => validatePublicContinuationParent(p.result, prefix(), p.terminal, p.failure)).toThrow();
  });
  it('refuses rerun authority when either missing request was already observed, or the failed fixture gained a question', () => {
    for (const id of PUBLIC_CONTINUATION_CASES) { const p = parent(); p.result.http.push({ caseId: id, label: 'executed' });
      expect(() => validatePublicContinuationParent(p.result, prefix(), p.terminal, p.failure)).toThrow(); }
    const p = parent(); p.failure.verifiedPartialFixture.questions = 1;
    expect(() => validatePublicContinuationParent(p.result, prefix(), p.terminal, p.failure)).toThrow();
  });
  it('refuses missing completed observations, altered supply denominator, uncertain native receipts and duplicated transcripts', () => {
    const variations = [() => { const p = parent(); p.result.observations.pop(); return p; },
      () => { const p = parent(); p.result.observations[0].requested = 9; p.result.observations[0].supply = { requested: 9 }; return p; },
      () => { const p = parent(); p.result.nativeReceipts[0].outcome = 'pending'; return p; },
      () => { const p = parent(); p.result.transcriptIds[0] = p.result.transcriptIds[1]; return p; }];
    for (const change of variations) { const p = change(); expect(() => validatePublicContinuationParent(p.result, prefix(), p.terminal, p.failure)).toThrow(); }
  });
  it('pins the exact original hashes, cumulative ceiling and missing cases, refusing widened or moved authority', () => {
    const c = authority(path.resolve('/tmp/continuation-unit')); expect(() => validatePublicContinuationAuthority(c)).not.toThrow();
    for (const change of [(v: typeof c) => { v.results.sha256 = digest; }, (v: typeof c) => { v.results.file = '/tmp/elsewhere.json'; },
      (v: typeof c) => { v.prefix.remainingAttempts = 42 as 41; }, (v: typeof c) => { v.transport.requestTimeoutMs = 0 as 180000; },
      (v: typeof c) => { v.transport.endpoint = 'https://user:secret@example.invalid/v1'; },
      (v: typeof c) => { v.missing = ['stale-source', PUBLIC_CONTINUATION_CASES[0]] as unknown as typeof PUBLIC_CONTINUATION_CASES; }]) {
      const changed = structuredClone(c); change(changed); expect(() => validatePublicContinuationAuthority(changed)).toThrow(); }
  });
  it('refuses corrupt, duplicated or reset original accounting', () => {
    for (const change of [(v: PublicNativeLedger) => { v.attemptReservations = 0; }, (v: PublicNativeLedger) => { v.conservativeUnits--; },
      (v: PublicNativeLedger) => { v.reservations[0].id = v.reservations[1].id; }, (v: PublicNativeLedger) => { v.reservations[0].inputEstimate = -1; }]) {
      const v = prefix(); change(v); expect(() => assertContinuationPrefix(v)).toThrow(); }
  });
  it('accepts only complete strict CLI forms; no resume, case selection, duplicate flags or extra generation is accepted', () => {
    expect(parsePublicContinuationArguments(['--live', 'once', '--output', '/tmp/out', '--declaration', '/tmp/d', '--declaration-sha256', digest])['--live']).toBe('once');
    expect(parsePublicContinuationArguments(['--origin', '/tmp/old', '--parent-declaration', '/tmp/d', '--provider', 'openai', '--endpoint', 'https://api.openai.com/v1', '--output', '/tmp/out'])['--origin']).toBe('/tmp/old');
    for (const args of [['--live', 'resume', '--output', '/tmp/out'], ['--output', '/tmp/out', '--case', 'thin-topic-bank-memory'],
      ['--output', '/tmp/out', '--output', '/tmp/other'], ['--live', 'once', '--output', '/tmp/out', '--declaration', '/tmp/d', '--declaration-sha256', 'wrong'],
      ['--live', 'once', '--output', '/tmp/out', '--declaration', '/tmp/d', '--declaration-sha256', digest, '--provider', 'openai']]) expect(() => parsePublicContinuationArguments(args)).toThrow();
  });
});

describe('immutable cumulative continuation ledger and permanent single use', () => {
  let directory: string; let d: PublicContinuationDeclaration; let ledger: string; let original: Buffer;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'public-continuation-')); const c = authority(directory);
    await writeFile(c.ledger.file, JSON.stringify(prefix())); original = await readFile(c.ledger.file); c.ledger.sha256 = publicHash(original);
    d = { continuation: c } as PublicContinuationDeclaration; ledger = path.join(directory, 'child-ledger.json');
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it('copies all37 charges, adds an unknown-call reservation conservatively and never mutates the original', async () => {
    await initializePublicContinuationLedger(ledger, d, digest); await assertPublicContinuationLedger(ledger, d, digest);
    await reservePublicContinuationAttempt(ledger, d, digest, PUBLIC_CONTINUATION_CASES[0], admission);
    await assertPublicContinuationLedger(ledger, d, digest); const child = JSON.parse(await readFile(ledger, 'utf8')) as PublicNativeLedger;
    expect(child.attemptReservations).toBe(38); expect(child.conservativeUnits).toBe(717877 + Buffer.byteLength(admission.prompt) + 32 + 8000);
    expect(child.reservations.slice(0, 37)).toEqual(prefix().reservations); expect(await readFile(d.continuation.ledger.file)).toEqual(original);
    await expect(initializePublicContinuationLedger(ledger, d, digest)).rejects.toThrow();
  });
  it('keeps a permanent wx claim across terminal or failed invocation; different declarations cannot reuse authority', async () => {
    await claimPublicContinuation(d, digest, path.join(directory, 'output')); const bytes = await readFile(d.continuation.claimFile);
    await expect(claimPublicContinuation(d, digest, '/tmp/other')).rejects.toThrow();
    await expect(claimPublicContinuation(d, 'c'.repeat(64), '/tmp/other')).rejects.toThrow();
    expect(await readFile(d.continuation.claimFile)).toEqual(bytes);
  });
  it('rejects an incorrect prospective declaration digest before runtime imports, output writes or a permanent claim', async () => {
    const file = path.join(directory, 'forged-declaration.json'); await writeFile(file, '{"version":1}'); const previous = process.argv;
    try {
      process.argv = ['node', 'continuation', '--live', 'once', '--output', path.join(directory, 'never-created'), '--declaration', file, '--declaration-sha256', digest];
      await expect(main()).rejects.toThrow('Expected values to be strictly equal');
      await expect(readFile(d.continuation.claimFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(path.join(directory, 'never-created', 'execution-claim.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { process.argv = previous; }
  });
  it('refuses old or negative cases before reservation and caps the single remaining regeneration at eight calls', async () => {
    await initializePublicContinuationLedger(ledger, d, digest);
    for (const id of [PUBLIC_CASES[0].id, 'regeneration-edit-existing', 'regeneration-create-variant', PUBLIC_CONTINUATION_CASES[1]]) await expect(reservePublicContinuationAttempt(ledger, d, digest, id, admission)).rejects.toThrow();
    for (let i = 0; i < 8; i++) await reservePublicContinuationAttempt(ledger, d, digest, PUBLIC_CONTINUATION_CASES[0], admission);
    const before = await readFile(ledger); await expect(reservePublicContinuationAttempt(ledger, d, digest, PUBLIC_CONTINUATION_CASES[0], admission)).rejects.toThrow('eight');
    expect(await readFile(ledger)).toEqual(before); expect(JSON.parse(before.toString()).attemptReservations).toBe(45);
  });
  it('refuses prefix mutations, forged negative reservations, changed identity and changed parent bytes without resetting charges', async () => {
    await initializePublicContinuationLedger(ledger, d, digest); const pristine = await readFile(ledger, 'utf8');
    const changes = [(v: PublicNativeLedger) => { v.reservations[0].inputSha256 = digest; }, (v: PublicNativeLedger) => { v.scope = 'other' as typeof v.scope; },
      (v: PublicNativeLedger) => { v.reservations.push({ ...v.reservations[0], id: 'new', caseId: PUBLIC_CONTINUATION_CASES[1] }); v.attemptReservations++; v.conservativeUnits += 19000; },
      (v: PublicNativeLedger) => { v.declarationSha256 = 'b'.repeat(64); }];
    for (const change of changes) { const v = JSON.parse(pristine) as PublicNativeLedger; change(v); await writeFile(ledger, JSON.stringify(v));
      await expect(assertPublicContinuationLedger(ledger, d, digest)).rejects.toThrow(); }
    await writeFile(ledger, pristine); await writeFile(d.continuation.ledger.file, original.toString() + ' ');
    await expect(assertPublicContinuationLedger(ledger, d, digest)).rejects.toThrow();
  });
});
