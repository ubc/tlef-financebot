import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { canonicalJson, caseControls, fixtureHash, hashControl, MODEL_ARMS, safeError, scheduleCells, sha256, validateFixture, type FrozenFixture, type LabCase, type LabRequest } from '../../scripts/quality-lab/protocol';
import { comparisonPreflight } from '../../scripts/quality-lab/preflight';
import { reserveLedger } from '../../scripts/quality-lab/ledger';
import { parseLabCandidate } from '../../scripts/quality-lab/candidate';

function fixture(): FrozenFixture {
  const text = 'Firm-specific risk can be reduced through diversification. Market risk remains.';
  const packet = { id: 'P1', schemaVersion: 'source-passages-v1' as const, policyVersion: 'grounded-memory-v2', courseId: 'course', loIds: ['lo'], sourceFingerprint: 'source', parsingProvenance: 'unrecorded' as const,
    materials: [], passages: [{ id: 'E1', materialId: 'material', materialName: 'Chapter', role: 'primary' as const, chunkIndex: 0, start: 0, end: text.length, text, selection: 'retrieved' as const }],
    coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: text.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' as const }, findings: [] };
  const cases: LabCase[] = Array.from({ length: 4 }, (_, index) => {
    const item: LabCase = { id: `case-${index}`, split: 'tuning', description: 'Controlled source case.', request: { loName: 'Risk', type: 'mcq', kind: 'conceptual', difficulty: 'easy', instructions: 'Source only.' },
      packet: structuredClone(packet), memory: { entries: [], truncated: false, missingVersions: 0, consistency: 'best-effort', snapshotDigest: 'memory' },
      requirements: { intent: 'create-independent-task', requiredChanges: [], preserve: [] }, generatorPrompt: `Exact source input ${index}`, generatorPromptSha256: sha256(`Exact source input ${index}`), controlsSha256: '', teacherAcceptance: null };
    item.controlsSha256 = hashControl(caseControls(item)); return item;
  });
  const frozen: FrozenFixture = { version: 1, createdAt: '2026-10-16T00:00:00Z', origin: { observationsPath: '/private/retained.json', observationsSha256: 'hash', purpose: 'tuning' },
    sourceControls: [{ material: { _id: 'material', name: 'Chapter' }, pdfSha256: 'pdf', chunks: [{ index: 0, text }] }], bankHeads: [], bankVersions: [], cases, fixtureSha256: '', limitations: [] };
  frozen.fixtureSha256 = fixtureHash(frozen); return frozen;
}
describe('quality lab frozen protocol', () => {
  it('hashes JSON controls without changing source whitespace or mathematical case', () => {
    expect(hashControl({ b: 1, a: 'R  r' })).toBe(hashControl({ a: 'R  r', b: 1 }));
    expect(hashControl('R  r')).not.toBe(hashControl('R r'));
    expect(() => canonicalJson({ value: undefined })).toThrow('non-json');
  });
  it('redacts provider key errors, bearer headers and credential-bearing URLs', () => {
    const sanitized = safeError(new Error('Incorrect API key provided: sk-synthetic-123; Bearer synthetic-header; api_key=synthetic-key https://someone:synthetic-password@example.test/v1'));
    for (const value of ['sk-synthetic-123', 'synthetic-header', 'synthetic-key', 'synthetic-password', 'someone']) expect(sanitized.message).not.toContain(value);
    expect(sanitized.message).toContain('redacted');
  });
  it('keeps exact requested models/efforts and rotates deterministic paired schedules', () => {
    const frozen = fixture(); const cells = scheduleCells(frozen, 2);
    expect(cells).toHaveLength(40); expect(new Set(cells.map(cell => cell.id)).size).toBe(40);
    expect(cells.slice(0, 5).map(cell => cell.arm.id)).toEqual(MODEL_ARMS.map(arm => arm.id));
    expect(cells[5]!.arm.id).toBe('luna-medium');
    expect(cells[20]!.arm.id).toBe('luna-medium');
    for (const item of frozen.cases) expect(cells.filter(cell => cell.caseId === item.id)).toHaveLength(10);
    expect(() => scheduleCells(frozen, 1, [{ ...MODEL_ARMS[0]!, model: 'gpt-6.1-sol' }])).toThrow('unrecognized-model');
  });
  it('detects fixture/prompt changes and rejects original-source coordinate drift', () => {
    const frozen = fixture(); frozen.cases[0]!.generatorPrompt += ' extra';
    expect(() => validateFixture(frozen)).toThrow('fixture-hash');
    frozen.fixtureSha256 = fixtureHash(frozen); expect(() => validateFixture(frozen)).toThrow('case-control');
    const changed = fixture(); changed.cases[0]!.packet.passages[0]!.start = 1;
    changed.cases[0]!.controlsSha256 = hashControl(caseControls(changed.cases[0]!)); changed.fixtureSha256 = fixtureHash(changed);
    expect(() => validateFixture(changed)).toThrow('source-coordinate');
  });
  it('does not allow already-inspected source data to overlap tuning and held-out splits', () => {
    const frozen = fixture(); frozen.cases[1]!.split = 'held-out'; frozen.fixtureSha256 = fixtureHash(frozen);
    expect(() => validateFixture(frozen)).toThrow('tuning-heldout-source-overlap');
  });
  it('retains all 20 requested slots and admits actual streaming-envelope byte bounds', () => {
    const plan = comparisonPreflight(fixture(), 1, { maxSends: 100, maxInputTokens: 24000, maxConservativeTokens: 2_000_000 });
    expect(plan.requestedOutputSlots).toBe(20); expect(plan.teacherAccepted).toBeNull(); expect(plan.fixedJudge.model).toBe('gpt-6.1-sol');
    const oversized = fixture(); oversized.cases[0]!.generatorPrompt = '\\'.repeat(15000);
    oversized.cases[0]!.generatorPromptSha256 = sha256(oversized.cases[0]!.generatorPrompt); oversized.fixtureSha256 = fixtureHash(oversized);
    expect(() => comparisonPreflight(oversized, 1, plan.limits)).toThrow('generator-input-cap');
  });
});

describe('quality lab durable conservative ledger', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'financebot-quality-lab-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  const request: LabRequest = { stage: 'generator', prompt: 'source', model: 'gpt-6-luna', effort: 'low', maxOutputTokens: 8000, allowedActualModels: ['gpt-6-luna'], maxSends: 2 };
  it('retains reservations across fresh callers and rejects allowance/scope resets', async () => {
    const file = path.join(directory, 'ledger.json'); const limits = { maxSends: 2, maxConservativeTokens: 50000, maxInputTokens: 24000 };
    const first = await reserveLedger(file, limits, 'phase-1', 'cell-a', request, 0, request.prompt);
    const second = await reserveLedger(file, limits, 'phase-1', 'cell-b', request, 0, request.prompt);
    expect(second.reservedSends).toBe(2); expect(second.conservativeTokens).toBe(first.conservativeTokens * 2);
    await expect(reserveLedger(file, limits, 'phase-1', 'cell-c', request, 0, request.prompt)).rejects.toThrow('send-cap');
    await expect(reserveLedger(file, { ...limits, maxSends: 20 }, 'phase-1', 'cell-c', request, 0, request.prompt)).rejects.toThrow('scope-mismatch');
    expect(JSON.parse(await readFile(file, 'utf8')).reservations).toHaveLength(2);
  });
  it('accounts for JSON-envelope escaping and fails closed on concurrent/abandoned locks', async () => {
    const file = path.join(directory, 'ledger.json'); const limits = { maxSends: 2, maxConservativeTokens: 50000, maxInputTokens: 24000 };
    await expect(reserveLedger(file, limits, 'phase-1', 'cell', request, 0, '\\'.repeat(15000))).rejects.toThrow('input-cap');
    const [left, right] = await Promise.allSettled([reserveLedger(file, limits, 'phase-1', 'cell-a', request, 0, 'a'), reserveLedger(file, limits, 'phase-1', 'cell-b', request, 0, 'b')]);
    expect([left, right].filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('quality lab generated candidate contract', () => {
  it('retains failure instead of silently inventing an answer role or task descriptor', () => {
    expect(() => parseLabCandidate({ stem: 'Risk?', options: [] }, 'mcq')).toThrow();
  });
});
