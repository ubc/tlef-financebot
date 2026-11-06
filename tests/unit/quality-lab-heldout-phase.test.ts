import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { aggregateHeldoutResults, assertHeldoutCli, emptyHeldoutLedger, HELDOUT_PHASE_LIMITS, HELDOUT_PHASE_SCOPE, planHeldoutComparison,
  readHeldoutPhase, validateHeldoutDeclaration, type HeldoutPhaseDeclaration, type HeldoutShardReceipt } from '../../scripts/quality-lab/heldout-phase';
import { runHeldoutComparison } from '../../scripts/quality-lab/run-heldout-comparison';
import { runModelComparison } from '../../scripts/quality-lab/run-model-comparison';
import { caseControls, fixtureHash, hashControl, sha256, type FrozenFixture, type LabCase } from '../../scripts/quality-lab/protocol';
import type { ConservativeLedger } from '../../scripts/quality-lab/ledger';
import { reserveLedger } from '../../scripts/quality-lab/ledger';

jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Offline held-out support must not import provider clients.'); });
jest.mock('../../server/src/components/mongodb/collections', () => { throw new Error('Offline held-out support must not import database components.'); });
jest.mock('../../server/src/config/env', () => { throw new Error('Offline held-out support must not import runtime configuration.'); });
jest.mock('node:child_process', () => ({ spawn: jest.fn(() => { throw new Error('Offline preflight must not spawn a live child.'); }) }));

/** Unit-only synthetic text establishes control integrity, never model quality. */
function fixture(): FrozenFixture {
  const cases: LabCase[] = Array.from({ length: 6 }, (_, index) => {
    const materialId = `synthetic-source-${index}`, text = `Synthetic original source ${index}.`;
    const item: LabCase = { id: `heldout-unit-${index}`, split: 'held-out', description: 'Synthetic unit only.',
      request: { loName: 'Synthetic capability', type: 'mcq', kind: 'conceptual', difficulty: 'easy', instructions: 'Follow the synthetic unit source.' },
      packet: { id: `packet-${index}`, schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2', courseId: 'unit-course', loIds: ['unit-lo'], sourceFingerprint: 'unit', parsingProvenance: 'unrecorded',
        materials: [{ materialId, name: `Unit ${index}.pdf`, role: 'primary', revision: null, activeRunId: null, contentHash: sha256(text), chunkCount: 1, parserVersion: 'unit', chunkerVersion: 'unit' }],
        passages: [{ id: 'P1', materialId, materialName: `Unit ${index}.pdf`, role: 'primary', chunkIndex: 0, start: 0, end: text.length, text, selection: 'retrieved' }],
        coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: text.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [] },
      memory: { entries: [], truncated: false, missingVersions: 0, snapshotDigest: 'unit-memory', consistency: 'best-effort' },
      requirements: { intent: 'create-independent-task', requiredChanges: ['Follow the unit source.'], preserve: [] },
      generatorPrompt: `Synthetic frozen prompt ${index}.`, generatorPromptSha256: '', controlsSha256: '', teacherAcceptance: null };
    item.generatorPromptSha256 = sha256(item.generatorPrompt); item.controlsSha256 = hashControl(caseControls(item)); return item;
  });
  const result = { version: 1 as const, createdAt: '2026-10-16', origin: { observationsPath: '/unit/origin', observationsSha256: 'unit', purpose: 'Unit only.' },
    sourceControls: cases.map(item => ({ material: { _id: item.packet.materials[0]!.materialId, name: item.packet.materials[0]!.name }, pdfSha256: sha256(item.id), chunks: [{ index: 0, text: item.packet.passages[0]!.text }] })),
    cases, bankHeads: [], bankVersions: [], fixtureSha256: '', limitations: ['Synthetic controls only.'],
    heldoutBoundary: { cases: cases.map((item, index) => ({ id: item.id, safetyNegative: index === 5 })) } };
  result.fixtureSha256 = fixtureHash(result); return result;
}
describe('declared held-out phase and strict60-slot aggregation', () => {
  let directory: string; let originalArgv: string[]; let originalFetch: typeof fetch;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quality-heldout-unit-')); originalArgv = process.argv;
    originalFetch = global.fetch; global.fetch = jest.fn(() => { throw new Error('Offline test network access forbidden.'); });
  });
  afterEach(async () => { process.argv = originalArgv; global.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); });
  async function prepare() {
    const data = fixture(), plan = planHeldoutComparison(data); const fixturePath = path.join(directory, 'fixture.json');
    const fixtureRaw = JSON.stringify(data); await writeFile(fixturePath, fixtureRaw);
    const priorLedgers: HeldoutPhaseDeclaration['priorLedgers'] = [];
    for (const phase of ['phase-one', 'phase-two'] as const) {
      const receipt: ConservativeLedger = { version: 1, createdAt: 'unit-only', scope: `quality-lab-2026-10-16-${phase}`, accounting: 'conservative-reservations-v1',
        limits: { maxSends: 100, maxConservativeTokens: 2_000_000, maxInputTokens: 200000 }, reservedSends: 0, conservativeTokens: 0, reservations: [] };
      const file = path.join(directory, `${phase}.json`), raw = JSON.stringify(receipt); await writeFile(file, raw);
      priorLedgers.push({ phase, path: file, sha256: sha256(raw), scope: receipt.scope, immutable: true });
    }
    const declaration: HeldoutPhaseDeclaration = { version: 1, phase: 'heldout-question-comparison', createdAt: 'unit-only', scope: HELDOUT_PHASE_SCOPE,
      ledger: path.join(directory, 'new-ledger.json'), limits: { ...HELDOUT_PHASE_LIMITS }, generatorOutputCap: 8000, judgeOutputCap: 6000,
      fixedJudge: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }, repetitions: 2, shardCount: 6, shardSize: 10, repairCandidates: 0,
      fixture: { path: fixturePath, sha256: sha256(fixtureRaw), controlSha256: data.fixtureSha256 }, scheduleSha256: plan.scheduleSha256, priorLedgers,
      completionPolicy: 'pragmatic-hard-stop-not-a-completion-guarantee', purpose: 'Synthetic unit test only; no paid authorization.' };
    const file = path.join(directory, 'unit-declaration.json'), raw = JSON.stringify(declaration), digest = sha256(raw); await writeFile(file, raw);
    return { data, plan, declaration, file, digest, fixturePath };
  }
  function receipt(data: FrozenFixture, index: number, digest: string): HeldoutShardReceipt {
    const plan = planHeldoutComparison(data), shard = plan.shards[index]!;
    return { status: 'completed', fixtureSha256: data.fixtureSha256, scheduleSha256: shard.scheduleSha256, requestedSlots: 10,
      heldoutPhase: { declarationSha256: digest, globalScheduleSha256: plan.scheduleSha256, requestedPhaseSlots: 60, shardIndex: index },
      cells: shard.cells.map(schedule => { const item = data.cases.find(row => row.id === schedule.caseId)!; return { schedule, inputControlsSha256: item.controlsSha256,
        generatorPromptSha256: item.generatorPromptSha256, status: 'invalid-candidate', originalCandidate: null, normalizedCandidate: null, eligibleBeforeRepair: null,
        teacherAcceptance: null, saved: false, adopted: false }; }) };
  }
  it('preserves one60-cell schedule and exact nominal global positions across six bounded contiguous shards', () => {
    const data = fixture(), plan = planHeldoutComparison(data);
    expect(plan.requestedSlots).toBe(60); expect(plan.positiveSupplySlots).toBe(50); expect(plan.safetyNegativeSlots).toBe(10);
    expect(plan.shards.flatMap(shard => shard.cells)).toEqual(plan.schedule);
    expect(new Set(plan.schedule.map(cell => cell.id)).size).toBe(60);
    for (const shard of plan.shards) { expect(shard.cells).toHaveLength(10); expect(shard.maximumObservedSends).toBe(60); expect(shard.maximumConservativeTokensWithinPerSendCaps).toBeLessThan(2_000_000); }
    expect(plan.completionPolicy).toContain('not a guarantee');
    expect(plan.maximumConservativeTokensWithinPerSendCaps).toBeGreaterThan(HELDOUT_PHASE_LIMITS.maxConservativeTokens);
  });
  it('reads a root-supplied declaration without creating or resetting its ledger, then preserves append-only accounting', async () => {
    const control = await prepare(); const first = await readHeldoutPhase(control.file, control.digest, true);
    expect(first.ledgerExists).toBe(false); expect(first.ledger.reservedSends).toBe(0);
    await expect(readFile(control.declaration.ledger)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(control.declaration.ledger, JSON.stringify(emptyHeldoutLedger(control.declaration, control.digest)));
    await reserveLedger(control.declaration.ledger, HELDOUT_PHASE_LIMITS, HELDOUT_PHASE_SCOPE, 'unit-cell', { stage: 'unit', prompt: 'unit', model: 'gpt-6-luna', effort: 'medium', maxOutputTokens: 8000, allowedActualModels: ['gpt-6-luna'], maxSends: 2 }, 0, 'unit');
    expect((await readHeldoutPhase(control.file, control.digest)).ledger.reservedSends).toBe(1);
    const bytes = await readFile(control.declaration.ledger, 'utf8'); await readHeldoutPhase(control.file, control.digest);
    expect(await readFile(control.declaration.ledger, 'utf8')).toBe(bytes);
    await writeFile(control.declaration.priorLedgers[1]!.path, '{}');
    await expect(readHeldoutPhase(control.file, control.digest)).rejects.toThrow('prior-ledger-changed');
  });
  it('refuses altered model/options, phase scope, paths, fixture bytes and declaration identities', async () => {
    const control = await prepare();
    for (const altered of [{ ...control.declaration, repairCandidates: 1 }, { ...control.declaration, judgeOutputCap: 8000 },
      { ...control.declaration, scope: 'quality-lab-2026-10-16-phase-one' }, { ...control.declaration, limits: { ...HELDOUT_PHASE_LIMITS, maxSends: 361 } },
      { ...control.declaration, ledger: control.declaration.priorLedgers[0]!.path }]) expect(() => validateHeldoutDeclaration(altered as HeldoutPhaseDeclaration)).toThrow('declaration-invalid');
    await expect(readHeldoutPhase(control.file, 'a'.repeat(64), true)).rejects.toThrow('declaration-changed');
    await writeFile(control.fixturePath, (await readFile(control.fixturePath, 'utf8')) + '\n');
    await expect(readHeldoutPhase(control.file, control.digest, true)).rejects.toThrow('fixture-changed');
  });
  it('aggregates all60 slots, preserves failed candidates and keeps missing whole shards explicit', () => {
    const data = fixture(), plan = planHeldoutComparison(data), digest = 'a'.repeat(64);
    const partial = aggregateHeldoutResults(plan, data, digest, [receipt(data, 0, digest)]);
    expect(partial.status).toBe('partial'); expect(partial.requestedSlots).toBe(60); expect(partial.recordedShardSlots).toBe(10); expect(partial.unrecordedSlots).toBe(50);
    expect(partial.cells).toHaveLength(60); expect(partial.generatedCandidates).toBe(0); expect(partial.teacherAcceptance).toBeNull(); expect(partial.savedQuestions).toBe(0);
    expect(() => aggregateHeldoutResults(plan, data, digest, [], true)).toThrow('shards-missing');
    const all = aggregateHeldoutResults(plan, data, digest, Array.from({ length: 6 }, (_, index) => receipt(data, index, digest)), true);
    expect(all.status).toBe('completed'); expect(all.unrecordedSlots).toBe(0); expect(all.positiveSupply.requested).toBe(50); expect(all.safetyNegative.requested).toBe(10);
    const wrongCode = receipt(data, 0, digest); wrongCode.code = [{ file: 'unit.ts', sha256: 'wrong' }];
    expect(() => aggregateHeldoutResults(plan, data, digest, [wrongCode], false, [{ file: 'unit.ts', sha256: 'expected' }])).toThrow('shard-code-mismatch');
  });
  it('rejects foreign, missing, duplicate, reordered and fabricated-success cell receipts', () => {
    const data = fixture(), plan = planHeldoutComparison(data), digest = 'a'.repeat(64);
    for (const mutate of [
      (r: HeldoutShardReceipt) => { r.cells.pop(); },
      (r: HeldoutShardReceipt) => { r.cells[1] = structuredClone(r.cells[0]!); },
      (r: HeldoutShardReceipt) => { r.cells.reverse(); },
      (r: HeldoutShardReceipt) => { r.cells[0]!.schedule.caseId = 'foreign'; },
      (r: HeldoutShardReceipt) => { r.cells[0]!.generatorPromptSha256 = 'foreign'; },
      (r: HeldoutShardReceipt) => { r.cells[0]!.saved = true as false; },
      (r: HeldoutShardReceipt) => { r.cells[0]!.status = 'pending'; },
    ]) { const row = receipt(data, 0, digest); mutate(row); expect(() => aggregateHeldoutResults(plan, data, digest, [row])).toThrow('receipt-invalid'); }
    const row = receipt(data, 0, digest); expect(() => aggregateHeldoutResults(plan, data, digest, [row, row])).toThrow('receipt-invalid');
  });
  it('imports both runners and completes no-declaration driver preflight without runtime/provider/DB/network/spawn access', async () => {
    const control = await prepare(); const output = path.join(directory, 'preflight');
    process.argv = ['node', 'unit-driver', '--fixture', control.fixturePath, '--output', output];
    await runHeldoutComparison();
    const saved = JSON.parse(await readFile(path.join(output, 'preflight.json'), 'utf8')) as { providerCalls: number; databaseCalls: number; ledgerCreated: boolean; requestedSlots: number };
    expect(saved).toMatchObject({ providerCalls: 0, databaseCalls: 0, ledgerCreated: false, requestedSlots: 60 });
    expect(global.fetch).not.toHaveBeenCalled(); await expect(readFile(control.declaration.ledger)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('keeps the default pilot100/2m ceiling and requires exact declared shard controls before any live import', async () => {
    const control = await prepare();
    process.argv = ['node', 'unit-runner', '--fixture', control.fixturePath, '--output', path.join(directory, 'reject'), '--max-sends', '120'];
    await expect(runModelComparison()).rejects.toThrow('phase-cap-exceeded');
    process.argv = ['node', 'unit-runner', '--fixture', control.fixturePath, '--output', path.join(directory, 'shard'), '--heldout-phase', control.file, '--heldout-phase-sha256', control.digest, '--shard-index', '0'];
    await runModelComparison();
    const saved = JSON.parse(await readFile(path.join(directory, 'shard', 'preflight.json'), 'utf8')) as { schedule: unknown[]; heldoutPhase: { requestedPhaseSlots: number }; providerCalls: number };
    expect(saved.schedule).toHaveLength(10); expect(saved.heldoutPhase.requestedPhaseSlots).toBe(60); expect(saved.providerCalls).toBe(0);
    process.argv = [...process.argv, '--repair-candidates', '1'];
    await expect(runModelComparison()).rejects.toThrow('execution-controls-drift');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('rejects unknown, duplicated, missing-value and undeclared live switches instead of silently ignoring them', async () => {
    expect(() => assertHeldoutCli(['node', 'unit', '--model', 'unknown'], ['--fixture'])).toThrow('unknown-or-duplicate-option');
    expect(() => assertHeldoutCli(['node', 'unit', '--fixture', 'one', '--fixture', 'two'], ['--fixture'])).toThrow('unknown-or-duplicate-option');
    expect(() => assertHeldoutCli(['node', 'unit', '--fixture', '--output'], ['--fixture', '--output'])).toThrow('option-value-required');
    const control = await prepare();
    process.argv = ['node', 'unit-driver', '--fixture', control.fixturePath, '--output', path.join(directory, 'undeclared'), '--live', 'once'];
    await expect(runHeldoutComparison()).rejects.toThrow('live-declaration-required');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
