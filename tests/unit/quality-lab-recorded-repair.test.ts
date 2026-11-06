import type { CompleteJsonOptions } from '../../server/src/components/genai/llm';
import type { JsonCompletion, FrozenFixture } from '../../scripts/quality-lab/protocol';
import type { ConservativeLedger } from '../../scripts/quality-lab/ledger';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { caseControls, fixtureHash, hashControl, MODEL_ARMS, sha256 } from '../../scripts/quality-lab/protocol';
import { assertRecordedRepairRoom, createRecordedRepairStageGuard, RECORDED_REPAIR_LIMITS, RECORDED_REPAIR_STAGES, RECORDED_REPAIR_WORST_CASE, resolveRecordedRepairSources, selectRecordedRepairControl } from '../../scripts/quality-lab/run-recorded-repair';

/** Synthetic controls test the offline admission boundary. They are never
 * written to, or presented as observations from, the real retained experiment. */
function syntheticControls() {
  const text = 'The cost of equity equals the risk-free rate plus beta times the market risk premium.';
  const candidate = { stem: 'Compute the cost using {{BETA}}.', difficulty: 'medium', numericKind: 'numeric',
    paramSlots: [{ name: 'BETA', values: [1] }], derivedValues: [{ name: 'COST', formula: 'BETA*5+3' }],
    options: ['correct', 'common-misconception', 'partially-correct', 'clearly-wrong'].map((role, index) => ({ key: 'ABCD'[index], text: `Option ${index}`, role, explanation: 'Synthetic explanation.' })),
    taskDescriptor: { concepts: ['Cost of equity'], requiredInference: 'Apply the source formula.', solutionPath: ['Multiply and add.'], misconception: 'Omit beta.', targetDifficulty: 'medium', passageIds: ['E1'], intent: 'create-independent-task' } };
  const finding = { kind: 'answer-semantics', target: 'parameters', status: 'defect', observation: 'The parameter domain contains a collision.', correction: 'Exclude the collision value.', passageIds: ['E1'], memoryEntryIds: [] };
  const packet = { id: 'P1', schemaVersion: 'source-passages-v1' as const, policyVersion: 'grounded-memory-v2', courseId: 'course', loIds: ['lo'], sourceFingerprint: 'source', parsingProvenance: 'unrecorded' as const,
    materials: [], passages: [{ id: 'E1', materialId: 'material', materialName: 'Synthetic chapter', role: 'primary' as const, chunkIndex: 0, start: 0, end: text.length, text, selection: 'retrieved' as const }],
    coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: text.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' as const }, findings: [] };
  const item = { id: 'synthetic-case', split: 'tuning' as const, description: 'Synthetic admission test.', request: { loName: 'Cost of equity', type: 'mcq' as const, kind: 'calculation' as const, difficulty: 'medium' as const, instructions: 'Use the exact source.' },
    packet, memory: { entries: [], truncated: false, missingVersions: 0, consistency: 'best-effort' as const, snapshotDigest: 'memory' },
    requirements: { intent: 'create-independent-task' as const, requiredChanges: [], preserve: [] }, generatorPrompt: 'Synthetic fixed prompt', generatorPromptSha256: sha256('Synthetic fixed prompt'), controlsSha256: '', teacherAcceptance: null };
  item.controlsSha256 = hashControl(caseControls(item));
  const fixture: FrozenFixture = { version: 1, createdAt: '2026-10-16T00:00:00Z', origin: { observationsPath: 'synthetic-only', observationsSha256: 'synthetic', purpose: 'unit test' },
    sourceControls: [{ material: { _id: 'material', name: 'Synthetic chapter' }, pdfSha256: 'synthetic-only', chunks: [{ index: 0, text }] }], bankHeads: [], bankVersions: [], cases: [item], fixtureSha256: '', limitations: ['Synthetic only.'] };
  fixture.fixtureSha256 = fixtureHash(fixture);
  const assessment = { policy: 'grounded-memory-v2', item: 0, status: 'withheld', sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: ['Synthetic collision.'],
    citations: [{ kind: 'solution', claim: 'Synthetic premise.', passageId: 'E1', quote: text }], matchedEntryIds: [], evidencePacketId: packet.id, memoryDigest: item.memory.snapshotDigest,
    checkedAt: '2026-10-16T00:00:00Z', findings: [finding], candidate: { ...candidate, type: 'mcq', contentHash: 'synthetic-candidate', truncated: false } };
  const capture = (stage: string, parsed: unknown, model: string, effort: string) => ({ file: `synthetic-${stage}.json`, transcript: {
    stage, status: 'succeeded', modelIdentityVerified: true, parsed, request: { model, effort }, attempts: [{ rawVisibleText: JSON.stringify(parsed), dispatch: 'finished', input: { prompt: item.generatorPrompt } }] } });
  const cell = { schedule: { id: 'synthetic-cell', caseId: item.id, arm: MODEL_ARMS[1], repetition: 1, order: 0 }, inputControlsSha256: item.controlsSha256,
    generatorPromptSha256: item.generatorPromptSha256, status: 'reviewed', originalCandidate: candidate, normalizedCandidate: candidate, deterministic: { normalizedHash: hashControl(candidate), numerics: { failure: 'Synthetic option collision.' } },
    qualityBeforeRepair: assessment, repaired: null, captures: [capture('model-comparison-generator', candidate, 'gpt-6-luna', 'medium'), capture('quality-review', { findings: [finding] }, 'gpt-6.1-sol', 'medium')] };
  const matrix = { status: 'completed', fixtureSha256: fixture.fixtureSha256, scope: 'phase', ledger: 'synthetic-ledger.json', code: [], cells: [cell] };
  const select = () => { const matrixRaw = JSON.stringify(matrix); return selectRecordedRepairControl(matrixRaw, JSON.stringify(fixture), { cellId: 'synthetic-cell', fixtureSha256: fixture.fixtureSha256, matrixSha256: sha256(matrixRaw) }); };
  return { fixture, matrix, cell, candidate, assessment, select };
}

function ledger(sends = 60, tokens = 1_697_821): ConservativeLedger {
  return { version: 1, createdAt: '2026-10-16T00:00:00Z', scope: 'phase', accounting: 'conservative-reservations-v1', limits: { ...RECORDED_REPAIR_LIMITS },
    reservedSends: sends, conservativeTokens: tokens, reservations: Array.from({ length: sends }, (_, index) => ({ id: `receipt-${index}`, cellId: 'prior', stage: 'prior', jsonAttempt: 0,
      inputSha256: 'synthetic', inputEstimate: Math.floor(tokens / sends) + (index < tokens % sends ? 1 : 0), outputReservation: 0, reservedAt: '2026-10-16T00:00:00Z' })) };
}
const options = (index: number): CompleteJsonOptions => ({ model: 'gpt-6.1-sol', reasoningEffort: 'medium', maxTokens: RECORDED_REPAIR_STAGES[index]!.output, usageContext: { stage: RECORDED_REPAIR_STAGES[index]!.stage } });

describe('recorded real-failure repair controls', () => {
  it('retains and clones the exact original candidate and observed assessment', () => {
    const controls = syntheticControls(); const selected = controls.select();
    expect(selected.identity.candidateSha256).toBe(hashControl(controls.candidate));
    expect(selected.assessment).toEqual(controls.assessment); expect(selected.assessment).not.toBe(selected.cell.qualityBeforeRepair);
  });
  it('rejects modified matrix bytes against the prospectively pinned identity', () => {
    const controls = syntheticControls(); const original = JSON.stringify(controls.matrix);
    expect(() => selectRecordedRepairControl(`${original}\n`, JSON.stringify(controls.fixture), { cellId: 'synthetic-cell', fixtureSha256: controls.fixture.fixtureSha256, matrixSha256: sha256(original) })).toThrow('matrix-hash-mismatch');
  });
  it('requires a terminal cell, a deterministic failure, and an unspent original assessment', () => {
    const pending = syntheticControls(); pending.matrix.status = 'running'; expect(pending.select).toThrow('exact-terminal');
    const validNumeric = syntheticControls(); validNumeric.cell.deterministic.numerics.failure = ''; expect(validNumeric.select).toThrow('assessment-not-repairable');
    const spent = syntheticControls(); Object.assign(spent.assessment, { semanticRepair: { outcome: 'withheld' } }); expect(spent.select).toThrow('assessment-not-repairable');
  });
  it('rejects source-coordinate drift and packet/memory scope drift', () => {
    const changed = syntheticControls(); changed.fixture.cases[0]!.packet.passages[0]!.text = 'Invented source.';
    changed.fixture.cases[0]!.controlsSha256 = hashControl(caseControls(changed.fixture.cases[0]!)); changed.fixture.fixtureSha256 = fixtureHash(changed.fixture);
    changed.matrix.fixtureSha256 = changed.fixture.fixtureSha256; expect(changed.select).toThrow('source-coordinate');
    const scope = syntheticControls(); scope.assessment.memoryDigest = 'another memory'; expect(scope.select).toThrow('assessment-not-repairable');
  });
  it('requires successful full raw responses with exact requested generator and fixed-judge identities', () => {
    const missing = syntheticControls(); missing.cell.captures[0]!.transcript.attempts[0]!.rawVisibleText = ''; expect(missing.select).toThrow('capture-incomplete');
    const identity = syntheticControls(); identity.cell.captures[1]!.transcript.request.effort = 'high'; expect(identity.select).toThrow('original-provenance');
  });
  it('rejects findings absent from the recorded judge output and unknown original source citations', () => {
    const invented = syntheticControls(); invented.cell.captures[1]!.transcript.parsed = { findings: [] }; expect(invented.select).toThrow('assessment-not-observed');
    const quote = syntheticControls(); quote.assessment.citations[0]!.quote = 'Unrecorded source claim.'; expect(quote.select).toThrow('citation-mismatch');
  });
  it('uses retained PDF bytes only by their frozen hash when temporary uploads are gone', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'quality-lab-recorded-source-'));
    try {
      const { fixture } = syntheticControls(); fixture.sourceControls[0]!.material.storagePath = path.join(directory, 'cleaned-upload.pdf'); fixture.sourceControls[0]!.pdfSha256 = sha256('exact-original-bytes');
      const retained = path.join(directory, 'retained.pdf'); await writeFile(retained, 'exact-original-bytes');
      const files = await resolveRecordedRepairSources(fixture, directory);
      expect(files[0]).toMatchObject({ file: retained, sha256: sha256('exact-original-bytes'), resolution: 'hash-matched-retained-pdf' });
      await writeFile(retained, 'different bytes'); await expect(resolveRecordedRepairSources(fixture, directory)).rejects.toThrow('original-pdf-mismatch');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('recorded repair bounded admission', () => {
  it('requires all four worst-case sends to fit the unchanged shared ledger', () => {
    expect(RECORDED_REPAIR_WORST_CASE).toBe(122000);
    expect(() => assertRecordedRepairRoom(ledger(), 'phase')).not.toThrow();
    expect(() => assertRecordedRepairRoom(ledger(96, 2_000_000 - RECORDED_REPAIR_WORST_CASE), 'phase')).not.toThrow();
    expect(() => assertRecordedRepairRoom(ledger(97), 'phase')).toThrow('insufficient-four-send-room');
    expect(() => assertRecordedRepairRoom(ledger(60, 2_000_000 - RECORDED_REPAIR_WORST_CASE + 1), 'phase')).toThrow('insufficient-four-send-room');
  });
  it('rejects reset limits, another scope and inconsistent receipt sums', () => {
    const changed = ledger(); changed.limits.maxSends++; expect(() => assertRecordedRepairRoom(changed, 'phase')).toThrow('scope-mismatch');
    expect(() => assertRecordedRepairRoom(ledger(), 'another-phase')).toThrow('scope-mismatch');
    const broken = ledger(); broken.reservations[0]!.inputEstimate++; expect(() => assertRecordedRepairRoom(broken, 'phase')).toThrow('receipt-mismatch');
  });
  it('allows exactly the generator, validator, reviewer and source judge at their caps', async () => {
    const observed: string[] = []; const complete: JsonCompletion = async <T>(_prompt: string, request: CompleteJsonOptions = {}) => { observed.push(request.usageContext!.stage!); return {} as T; };
    const beforeFirst = jest.fn(async () => undefined); const guard = createRecordedRepairStageGuard(complete, beforeFirst);
    for (let index = 0; index < 4; index++) await guard.complete('Synthetic prompt', options(index));
    expect(observed).toEqual(RECORDED_REPAIR_STAGES.map(stage => stage.stage)); expect(beforeFirst).toHaveBeenCalledTimes(1); expect(guard.completeCalls).toBe(4);
    await expect(guard.complete('Extra attempt', options(0))).rejects.toThrow('stage-cap-or-drift');
    expect(observed).toHaveLength(4); expect(() => guard.assertNoFailure()).toThrow('stage-cap-or-drift');
  });
  it('latches a lost preflight allowance even when production catches its completion rejection', async () => {
    const provider = jest.fn(); const guard = createRecordedRepairStageGuard(provider, async () => { throw new Error('shared-budget-no-longer-fits'); });
    await guard.complete('Synthetic prompt', options(0)).catch(() => undefined);
    expect(provider).not.toHaveBeenCalled(); expect(guard.completeCalls).toBe(0); expect(() => guard.assertNoFailure()).toThrow('shared-budget-no-longer-fits');
    await expect(guard.complete('Retry', options(0))).rejects.toThrow('shared-budget-no-longer-fits'); expect(provider).not.toHaveBeenCalled();
  });
  it('rejects drift before dispatch and latches completion failures that repair may swallow', async () => {
    const provider = jest.fn(); const drift = createRecordedRepairStageGuard(provider, async () => undefined);
    await expect(drift.complete('Synthetic prompt', { ...options(0), maxTokens: 9000 })).rejects.toThrow('stage-cap-or-drift'); expect(provider).not.toHaveBeenCalled();
    const transport = createRecordedRepairStageGuard(async () => { throw new Error('capture-admission-failed'); }, async () => undefined);
    await transport.complete('Synthetic prompt', options(0)).catch(() => undefined);
    expect(transport.completeCalls).toBe(1); expect(() => transport.assertNoFailure()).toThrow('capture-admission-failed');
  });
});
