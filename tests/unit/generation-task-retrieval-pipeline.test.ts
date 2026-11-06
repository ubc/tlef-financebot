jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(), questionVersionsCol: jest.fn(), questionPedagogicalFingerprintsCol: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { questionsCol, questionVersionsCol, questionPedagogicalFingerprintsCol } from '../../server/src/components/mongodb/collections';
import {
  contentFingerprint, loadGenerationMemory, refreshGenerationMemoryForCandidate, reloadGenerationMemory, selectGenerationMemory,
} from '../../server/src/services/generation-memory.service';
import type { GenerationMemoryContent, GenerationMemorySnapshot, GenerationMemoryInput } from '../../server/src/services/generation-memory.service';
import { assessGenerationQuality, generationQualityInstruction } from '../../server/src/services/generation-quality.service';
import { assertGenerationTaskRetrievalAssessment } from '../../server/src/services/generation-task-retrieval-admission';
import { assertGenerationExactBankCurrent } from '../../server/src/services/generation-exact-bank';
import { generationTaskQuery } from '../../server/src/services/generation-task-query';
import { AuthoringBudget, withAuthoringBudget } from '../../server/src/services/authoring-budget.service';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { AuthoringRequirements } from '../../server/src/types/generation-quality';
import type { PublicationState } from '../../server/src/types/domain';

// All judgments below are scripted. Actual local memory/receipt/quality parsing
// and final admission run; no provider, database, source extraction or teacher
// semantic acceptance is exercised by this suite.
const courseId = new ObjectId('000000000000000000000001');
const loId = new ObjectId('000000000000000000000002');
const crossLoId = new ObjectId('000000000000000000000003');
const materialId = new ObjectId('000000000000000000000004');
const oid = (value: number) => new ObjectId(value.toString(16).padStart(24, '0'));
const source = 'CAPM uses beta to measure systematic market exposure. Diversification removes firm-specific risk, so only systematic risk earns a premium.';
function content(stem = 'Which CAPM coefficient measures systematic market exposure?'): GenerationMemoryContent {
  return { type: 'mcq', numericKind: 'conceptual', stem, options: [
    { key: 'A', role: 'correct', text: 'Beta', explanation: 'Beta measures systematic market exposure in CAPM.' },
    { key: 'B', role: 'common-misconception', text: 'Firm-specific volatility', explanation: 'Firm-specific risk can be removed by diversification.' },
  ] };
}
function filler(index: number): GenerationMemoryContent {
  return { type: 'mcq', numericKind: 'conceptual', stem: `Bond coupon schedule ${index}.`, options: [
    { key: 'A', role: 'correct', text: 'Coupon payment', explanation: 'Read the contractual coupon schedule.' },
    { key: 'B', role: 'common-misconception', text: 'Face amount', explanation: 'Principal matures later.' },
  ] };
}
function database() {
  const rows = Array.from({ length: 202 }, (_, index) => {
    const cross = index >= 121, local = cross ? index - 121 : index;
    const target = local === (cross ? 80 : 120);
    const questionId = oid(1000 + index), versionId = oid(10_000 + index);
    return { head: { _id: questionId, courseId, currentVersionId: versionId, state: 'approved' as PublicationState,
      loIds: [cross ? crossLoId : loId], updatedAt: 1000 - local },
    version: { _id: versionId, questionId, ...(target ? content('In CAPM, identify the sensitivity parameter representing exposure to market risk.') : filler(index)) }, target };
  });
  const heads = rows.map(row => row.head), versions = rows.map(row => row.version);
  type Filter = { courseId: ObjectId; state: { $in: PublicationState[] }; _id?: { $gt?: ObjectId; $ne?: ObjectId }; loIds?: { $in?: ObjectId[]; $nin?: ObjectId[] } };
  function cursor<T extends { _id: ObjectId }>(items: T[]) {
    let chosen = [...items];
    interface Reader { sort(order: { _id?: number; updatedAt?: number }): Reader; limit(limit: number): Reader; toArray(): Promise<T[]> }
    const reader: Reader = {
      sort: order => { chosen.sort((a, b) => order.updatedAt
        ? (Number((a as T & { updatedAt: number }).updatedAt) - Number((b as T & { updatedAt: number }).updatedAt)) * order.updatedAt
        : a._id.toHexString().localeCompare(b._id.toHexString()) * (order._id ?? 1)); return reader; },
      limit: count => { chosen = chosen.slice(0, count); return reader; }, toArray: async () => chosen,
    };
    return reader;
  }
  const findHeads = jest.fn((query: Filter) => cursor(heads.filter(head => head.courseId.equals(query.courseId)
    && query.state.$in.includes(head.state) && (!query._id?.$gt || head._id.toHexString() > query._id.$gt.toHexString())
    && (!query._id?.$ne || !head._id.equals(query._id.$ne))
    && (!query.loIds?.$in || head.loIds.some(id => query.loIds!.$in!.some(wanted => wanted.equals(id))))
    && (!query.loIds?.$nin || !head.loIds.some(id => query.loIds!.$nin!.some(wanted => wanted.equals(id)))))));
  const findVersions = jest.fn((query: { _id: { $in: ObjectId[] } }) => cursor(versions.filter(version => query._id.$in.some(id => version._id.equals(id)))));
  const findProfiles = jest.fn(() => cursor([]));
  jest.mocked(questionsCol).mockReturnValue({ find: findHeads } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ find: findVersions } as never);
  jest.mocked(questionPedagogicalFingerprintsCol).mockReturnValue({ find: findProfiles } as never);
  return { heads, versions, targets: rows.filter(row => row.target).map(row => `q:${row.head._id.toHexString()}:${row.version._id.toHexString()}`), findHeads, findVersions, findProfiles };
}
function packet(): GenerationEvidencePacket {
  return { id: 'synthetic-evidence', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2', courseId: courseId.toHexString(),
    loIds: [loId.toHexString()], sourceFingerprint: 'synthetic-source', parsingProvenance: 'unrecorded',
    materials: [{ materialId: materialId.toHexString(), name: 'Synthetic notes', role: 'primary', contentHash: 'synthetic', revision: 1, activeRunId: null, chunkCount: 1 }],
    passages: [{ id: 'E1', materialId: materialId.toHexString(), materialName: 'Synthetic notes', role: 'primary', chunkIndex: 0,
      start: 0, end: source.length, text: source, selection: 'retrieved' }], findings: [],
    coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: source.length, omittedPassages: 0, truncated: false,
      searchScope: 'retrieved-chunks-and-immediate-neighbors' } };
}
function requirements(selected = true): AuthoringRequirements {
  return { intent: 'create-independent-task', requiredChanges: [], preserve: [], exactBankProtocol: 'course-exact-bank-v1',
    ...(selected ? { taskRetrievalProtocol: 'course-task-retrieval-v1' as const } : {}) };
}
async function memory(candidate = content(), selected = true, limits?: GenerationMemoryInput['taskRetrievalLimits']) {
  return loadGenerationMemory({ courseId, loIds: [loId], includeCrossLo: true, query: generationTaskQuery(candidate),
    ...(selected ? { taskRetrievalProtocol: 'course-task-retrieval-v1', taskRetrievalLimits: limits } : {}) });
}
function response(comparisons: Array<{ entryId: string; sameInference: boolean; sameSolutionPath: boolean; contrast: string }> = [], novelty = 'independent') {
  return { sourceSupport: 'supported', notation: 'consistent', novelty, reasons: ['Scripted judgment; not measured semantic detection.'],
    citations: [{ kind: 'premise', claim: 'CAPM measures market exposure with beta.', spanIds: ['S1'] },
      { kind: 'solution', claim: 'The supplied definition distinguishes systematic exposure.', spanIds: ['S1'] }],
    taskComparisons: comparisons, changes: [], invariants: [], achievedDifficulty: 'easy', justifiedLength: 'justified' };
}
function comparisons(snapshot: GenerationMemorySnapshot, candidate = content(), same = false) {
  const selected = selectGenerationMemory(snapshot, { query: generationTaskQuery(candidate) });
  return selected.requiredComparisonIds!.map(id => ({ entryId: `M${selected.entries.findIndex(entry => entry.id === id) + 1}`,
    sameInference: same, sameSolutionPath: same,
    contrast: same ? 'Both ask the same CAPM sensitivity identification with the same definition lookup (scripted).' :
      'Shared CAPM terms do not establish the same task; the candidate requires a distinct mechanism rather than definition recall (scripted).' }));
}
const assess = (candidate: GenerationMemoryContent, snapshot: GenerationMemorySnapshot, selected = true) => assessGenerationQuality({
  candidate, memory: snapshot, packet: packet(), requirements: requirements(selected), policy: 'grounded-memory-v2', item: 0, step: { model: 'mock-only' },
});

beforeEach(() => { jest.clearAllMocks(); jest.mocked(completeJson).mockReset(); jest.mocked(embedOne).mockImplementation(async () => { throw new Error('No new query embedding is allowed.'); }); });
afterEach(() => { expect(embedOne).not.toHaveBeenCalled(); });

describe('current task retrieval through actual quality parsing and final admission, mocked judgments only', () => {
  it('compacts owned headers without losing any selected full Bank comparator or source JSON', async () => {
    database();
    const loaded = await memory();
    const previous = generationQualityInstruction(packet(), loaded, generationTaskQuery(content()), requirements());
    const compact = generationQualityInstruction(packet(), loaded, generationTaskQuery(content()),
      { ...requirements(), authoringPromptProtocol: 'compact-authoring-v1' });
    const payloads = (text: string) => text.split('\n').filter(line => line.startsWith('{'));
    expect(payloads(compact)).toEqual(payloads(previous));
    const bank = JSON.parse(payloads(compact).at(-1)!);
    expect(bank.requiredComparisonIds).toHaveLength(2);
    const required = bank.entries.filter((entry: { comparisonRole?: string }) => entry.comparisonRole);
    expect(required).toHaveLength(2);
    expect(required.every((entry: { options?: unknown[] }) => entry.options?.length === 2)).toBe(true);
    expect(Buffer.byteLength(compact)).toBeLessThan(Buffer.byteLength(previous));
    expect(completeJson).not.toHaveBeenCalled(); expect(embedOne).not.toHaveBeenCalled();
  });
  it('exposes two older paraphrases missed by the actual legacy window while the exact scan still reports zero', async () => {
    const db = database(), candidate = content();
    const historical = await memory(candidate, false), current = await memory(candidate);
    expect(historical.entries).toHaveLength(200); expect(historical.truncated).toBe(true);
    expect(historical.entries.some(entry => db.targets.includes(entry.id))).toBe(false);
    const selected = selectGenerationMemory(current, { query: generationTaskQuery(candidate) });
    expect(selected.requiredComparisonIds).toEqual(db.targets);
    expect(current.taskRetrieval).toMatchObject({ status: 'complete', headsScanned: 202, missingDescriptors: 202 });
    expect(db.targets.every(id => selected.entries.some(entry => entry.id === id))).toBe(true);
    expect(selected.text.length).toBeLessThanOrEqual(12_000);
    expect(selected.entries.length).toBeLessThanOrEqual(12);
    jest.mocked(completeJson).mockResolvedValueOnce(response(comparisons(current)));
    const checked = await assess(candidate, current);
    expect(checked.exactBank).toMatchObject({ status: 'complete', exactMatchCount: 0, headsScanned: 202 });
    expect(checked.taskRetrieval).toMatchObject({ status: 'complete', requiredComparisonIds: db.targets });
  });

  it('preserves old independent [] acceptance but requires one existing bounded response correction on the new branch', async () => {
    database(); const candidate = content(); const historical = await memory(candidate, false);
    jest.mocked(completeJson).mockResolvedValueOnce(response());
    expect((await assess(candidate, historical, false)).status).toBe('eligible');
    expect(completeJson).toHaveBeenCalledTimes(1);
    const legacyPrompt = jest.mocked(completeJson).mock.calls[0][0];
    expect(legacyPrompt).not.toContain('Required comparisons:');
    const current = await memory(candidate);
    jest.mocked(completeJson).mockReset().mockResolvedValueOnce(response()).mockResolvedValueOnce(response(comparisons(current)));
    const budget = new AuthoringBudget('scripted-quality-correction');
    const checked = await withAuthoringBudget(budget, () => assess(candidate, current));
    expect(checked.status).toBe('eligible'); expect(completeJson).toHaveBeenCalledTimes(2);
    expect(checked.responseIssues).toContainEqual(expect.objectContaining({ attempt: 0, code: 'required-task-comparison-missing' }));
    expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('Required comparisons: M1,M2');
    expect(jest.mocked(completeJson).mock.calls[1][0]).toContain('Required M rows exactly once');
    expect(budget.snapshot().logical.repairCycles).toBe(1);
    expect(() => assertGenerationTaskRetrievalAssessment({ candidate, memory: current, requirements: requirements(), assessment: checked })).not.toThrow();
  });

  it('withholds unresolved required omissions after two scripted responses and never attempts a third correction', async () => {
    database(); const candidate = content(), current = await memory(candidate);
    jest.mocked(completeJson).mockResolvedValue(response());
    const checked = await assess(candidate, current);
    expect(checked.status).toBe('withheld'); expect(completeJson).toHaveBeenCalledTimes(2);
    expect(checked.responseIssues).toContainEqual(expect.objectContaining({ attempt: 1, code: 'required-task-comparison-missing' }));
  });

  it('accepts a legitimate different-inference comparison without forcing matches from shared terms', async () => {
    database(); const candidate = content('Why does CAPM price systematic risk rather than diversifiable firm-specific volatility?');
    candidate.options[0] = { ...candidate.options[0], text: 'Diversification removes firm-specific risk', explanation: 'Only systematic risk remains priced after diversification.' };
    const current = await memory(candidate);
    jest.mocked(completeJson).mockResolvedValueOnce(response(comparisons(current, candidate)));
    const checked = await assess(candidate, current);
    expect(checked.status).toBe('eligible'); expect(checked.matchedEntryIds).toEqual([]);
    expect(checked.taskComparisons!.every(row => !row.sameInference && !row.sameSolutionPath)).toBe(true);
    await expect(assertGenerationExactBankCurrent({ courseId, candidate, requirements: requirements(), assessment: checked })).resolves.toBeUndefined();
    expect(() => assertGenerationTaskRetrievalAssessment({ candidate, memory: current, requirements: requirements(), assessment: checked })).not.toThrow();
    expect(completeJson).toHaveBeenCalledTimes(1);
  });

  it('withholds a paraphrased same-task judgment despite zero exact matches, with no automatic score-based rejection', async () => {
    database(); const candidate = content(), current = await memory(candidate);
    jest.mocked(completeJson).mockResolvedValueOnce(response(comparisons(current, candidate, true), 'variant'));
    const checked = await assess(candidate, current);
    expect(checked).toMatchObject({ status: 'withheld', novelty: 'variant', exactBank: { exactMatchCount: 0 } });
    expect(checked.matchedEntryIds).toEqual(current.taskRetrieval!.requiredComparisonIds);
    expect(completeJson).toHaveBeenCalledTimes(1);
    expect(() => assertGenerationTaskRetrievalAssessment({ candidate, memory: current, requirements: requirements(), assessment: checked })).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it.each(['cap', 'missing-current-version'] as const)('withholds %s task traversal before a quality model boundary', async fault => {
    const db = database(), candidate = content();
    if (fault === 'missing-current-version') db.versions.pop();
    const current = await memory(candidate, true, fault === 'cap' ? { maxHeads: 1 } : undefined);
    expect(current.taskRetrieval!.status).toBe('incomplete');
    const checked = await assess(candidate, current);
    expect(checked.status).toBe('withheld'); expect(checked.reasons.join(' ')).toContain('No quality model call was sent');
    expect(completeJson).not.toHaveBeenCalled();
  });

  it('uses source evidence independently: valid Bank contrasts cannot override unsupported teaching premises', async () => {
    database(); const candidate = content(), current = await memory(candidate);
    jest.mocked(completeJson).mockResolvedValueOnce({ ...response(comparisons(current)), sourceSupport: 'unsupported', reasons: ['Scripted unsupported source premise.'] });
    const checked = await assess(candidate, current);
    expect(checked).toMatchObject({ status: 'withheld', sourceSupport: 'unsupported' });
    expect(completeJson).toHaveBeenCalledTimes(1);
  });

  it('refuses stale candidate queries without a call, then reviews refreshed repair memory and binds the new result', async () => {
    database(); const original = content(), previous = await memory(original);
    const repaired = content('Explain why diversifiable risk does not earn a CAPM premium.');
    const stale = await assess(repaired, previous);
    expect(stale.status).toBe('withheld'); expect(completeJson).not.toHaveBeenCalled();
    const refreshed = await refreshGenerationMemoryForCandidate(previous, generationTaskQuery(repaired));
    jest.mocked(completeJson).mockResolvedValueOnce(response(comparisons(refreshed, repaired)));
    const checked = await assess(repaired, refreshed);
    expect(checked.status).toBe('eligible'); expect(checked.memoryDigest).toBe(refreshed.snapshotDigest);
    expect(checked.memoryDigest).not.toBe(previous.snapshotDigest);
    expect(() => assertGenerationTaskRetrievalAssessment({ candidate: repaired, memory: previous, requirements: requirements(), assessment: checked })).toThrow('generation-task-retrieval-assessment-invalid');
    expect(() => assertGenerationTaskRetrievalAssessment({ candidate: repaired, memory: refreshed, requirements: requirements(), assessment: checked })).not.toThrow();
  });

  it('invalidates post-review Bank changes on actual stored-query reload without calling a model again', async () => {
    const db = database(), candidate = content(), current = await memory(candidate);
    jest.mocked(completeJson).mockResolvedValueOnce(response(comparisons(current)));
    const checked = await assess(candidate, current);
    expect(checked.status).toBe('eligible');
    db.versions[0].stem = 'An intervening edit to an unrelated Bank question.';
    const fresh = await reloadGenerationMemory(current, { courseId, loIds: [loId], includeCrossLo: true });
    expect(fresh.snapshotDigest).not.toBe(current.snapshotDigest);
    expect(() => assertGenerationTaskRetrievalAssessment({ candidate, memory: fresh, requirements: requirements(), assessment: checked })).toThrow('generation-task-retrieval-assessment-invalid');
    expect(completeJson).toHaveBeenCalledTimes(1);
    expect(contentFingerprint(candidate).exact).toBe(checked.exactBank!.candidateHash);
  });
});
