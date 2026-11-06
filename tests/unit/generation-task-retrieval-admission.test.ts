jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(), questionVersionsCol: jest.fn(), questionPedagogicalFingerprintsCol: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { questionsCol, questionVersionsCol, questionPedagogicalFingerprintsCol } from '../../server/src/components/mongodb/collections';
import { assertGenerationTaskRetrievalAssessment } from '../../server/src/services/generation-task-retrieval-admission';
import { generationTaskQuery } from '../../server/src/services/generation-task-query';
import { snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { loadGenerationMemory, refreshGenerationMemoryForCandidate, selectGenerationMemory } from '../../server/src/services/generation-memory.service';
import type { GenerationMemoryContent, GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { PublicationState } from '../../server/src/types/domain';

// Real loader/selector/projection/admission code; synthetic in-memory records
// and eligible assessment shells, not Mongo isolation or model quality.
const courseId = new ObjectId('000000000000000000000001');
const loId = new ObjectId('000000000000000000000002');
const oid = (value: number) => new ObjectId(value.toString(16).padStart(24, '0'));
function candidate(stem = 'Which CAPM quantity measures systematic risk?'): GenerationMemoryContent {
  return { type: 'mcq', numericKind: 'conceptual', stem, options: [
    { key: 'A', text: 'Beta', role: 'correct', explanation: 'Beta measures systematic market risk in CAPM.' },
    { key: 'B', text: 'Total volatility', role: 'common-misconception', explanation: 'Total volatility also includes diversifiable risk.' },
  ] };
}
function row(index: number) {
  const questionId = oid(100 + index), versionId = oid(1000 + index);
  return { head: { _id: questionId, courseId, currentVersionId: versionId, state: 'approved' as PublicationState,
    loIds: [loId], updatedAt: index },
  version: { _id: versionId, questionId, ...candidate(`Explain CAPM systematic-risk mechanism ${index}.`) } };
}
type Head = ReturnType<typeof row>['head'];
type Query = { courseId: ObjectId; state: { $in: PublicationState[] }; _id?: { $gt?: ObjectId; $ne?: ObjectId } | ObjectId;
  currentVersionId?: ObjectId; loIds?: { $in?: ObjectId[]; $nin?: ObjectId[] } };
function cursor<T extends { _id: ObjectId }>(rows: T[]) {
  let chosen = [...rows];
  interface Reader { sort(order: { updatedAt?: number; _id?: number }): Reader; limit(limit: number): Reader; toArray(): Promise<T[]> }
  const reader: Reader = {
    sort: jest.fn(order => { chosen.sort((a, b) => order.updatedAt
      ? (Number((a as T & { updatedAt: number }).updatedAt) - Number((b as T & { updatedAt: number }).updatedAt)) * order.updatedAt
      : a._id.toHexString().localeCompare(b._id.toHexString()) * (order._id ?? 1)); return reader; }),
    limit: jest.fn(limit => { chosen = chosen.slice(0, limit); return reader; }),
    toArray: jest.fn(async () => chosen),
  };
  return reader;
}
function database() {
  const rows = [row(1), row(2), row(3)];
  const headMatches = (head: Head, query: Query) => {
    const range = query._id instanceof ObjectId ? undefined : query._id;
    return head.courseId.equals(query.courseId) && query.state.$in.includes(head.state)
      && (!(query._id instanceof ObjectId) || head._id.equals(query._id))
      && (!range?.$gt || head._id.toHexString() > range.$gt.toHexString()) && (!range?.$ne || !head._id.equals(range.$ne))
      && (!query.currentVersionId || head.currentVersionId.equals(query.currentVersionId))
      && (!query.loIds?.$in || head.loIds.some(id => query.loIds!.$in!.some(wanted => wanted.equals(id))))
      && (!query.loIds?.$nin || !head.loIds.some(id => query.loIds!.$nin!.some(wanted => wanted.equals(id))));
  };
  const findHeads = jest.fn((query: Query) => cursor(rows.map(item => item.head).filter(head => headMatches(head, query))));
  const findOne = jest.fn(async (query: Query) => rows.map(item => item.head).find(head => headMatches(head, query)) ?? null);
  const findVersions = jest.fn((query: { _id: { $in: ObjectId[] } }) => cursor(rows.map(item => item.version).filter(version => query._id.$in.some(id => version._id.equals(id)))));
  const findProfiles = jest.fn(() => cursor([]));
  jest.mocked(questionsCol).mockReturnValue({ find: findHeads, findOne } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ find: findVersions } as never);
  jest.mocked(questionPedagogicalFingerprintsCol).mockReturnValue({ find: findProfiles } as never);
  return { rows, findHeads, findVersions, findProfiles };
}
const requirements = (): AuthoringRequirements => ({ intent: 'create-independent-task', requiredChanges: [], preserve: [], taskRetrievalProtocol: 'course-task-retrieval-v1' });
async function fixture(pin = false) {
  const db = database(); const content = candidate(); const request = requirements();
  const original = db.rows[0];
  const memory = await loadGenerationMemory({ courseId, loIds: [loId], includeCrossLo: true, taskRetrievalProtocol: 'course-task-retrieval-v1',
    query: generationTaskQuery(content), ...(pin ? { excludeQuestionId: original.head._id,
      pinnedOriginal: { questionId: original.head._id, versionId: original.version._id } } : {}) });
  const selected = selectGenerationMemory(memory, { query: generationTaskQuery(content) });
  const assessment: GenerationQualityAssessment = { policy: 'grounded-memory-v2', intent: request.intent, item: 0, status: 'eligible',
    sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: ['Synthetic assessment tests admission bindings only.'],
    citations: [], matchedEntryIds: [], evidencePacketId: 'synthetic-source-not-reviewed', memoryDigest: memory.snapshotDigest, checkedAt: new Date(0),
    candidate: snapshotQualityCandidate(content), comparedEntryIds: selected.entries.map(entry => entry.id),
    taskComparisons: selected.requiredComparisonIds!.map(entryId => ({ entryId, sameInference: false, sameSolutionPath: false,
      contrast: 'The Bank recalls a definition; the candidate tests a different source-permitted inference (scripted fixture).' })),
    coverage: { evidenceTruncated: false, memoryTruncated: false, shownEntries: selected.entries.length, totalEntries: memory.entries.length,
      missingVersions: 0, consistency: 'best-effort' } };
  db.findHeads.mockClear(); db.findVersions.mockClear(); db.findProfiles.mockClear();
  return { db, candidate: content, memory, requirements: request, assessment };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const admit = (value: Fixture) => assertGenerationTaskRetrievalAssessment(value);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(completeJson).mockImplementation(async () => { throw new Error('No configured model may run.'); });
  jest.mocked(embedOne).mockImplementation(async () => { throw new Error('No embedding may run.'); });
});
afterEach(() => {
  expect(completeJson).not.toHaveBeenCalled(); expect(embedOne).not.toHaveBeenCalled();
});

describe('pure final course-task retrieval admission using actual lookup-built receipts', () => {
  it('accepts current full candidate/memory/selection/comparisons without any new collection read', async () => {
    const value = await fixture();
    expect(value.memory.taskRetrieval).toMatchObject({ status: 'complete', headsScanned: 3, versionsChecked: 3 });
    expect(value.memory.taskRetrieval!.requiredComparisonIds).toHaveLength(2);
    expect(() => admit(value)).not.toThrow();
    expect(value.db.findHeads).not.toHaveBeenCalled(); expect(value.db.findVersions).not.toHaveBeenCalled(); expect(value.db.findProfiles).not.toHaveBeenCalled();
  });

  it('accepts exact compared IDs as a unique set regardless of receipt display-list order', async () => {
    const value = await fixture(); value.assessment.comparedEntryIds!.reverse();
    expect(() => admit(value)).not.toThrow();
  });

  it('retains the pinned original plus one ordinary required comparator', async () => {
    const value = await fixture(true);
    expect(value.memory.taskRetrieval!.requiredComparisonIds).toHaveLength(2);
    expect(value.memory.taskRetrieval!.requiredComparisonIds[0]).toBe(value.memory.pinnedOriginal!.entryId);
    expect(() => admit(value)).not.toThrow();
    value.assessment.taskComparisons = value.assessment.taskComparisons!.filter(row => row.entryId !== value.memory.pinnedOriginal!.entryId);
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it.each([
    ['stem', (value: Fixture) => { value.candidate.stem += ' A changed constraint.'; }],
    ['option text', (value: Fixture) => { value.candidate.options[0].text = 'Market variance'; }],
    ['literal key', (value: Fixture) => { value.candidate.options[0].key = 'CHANGED'; }],
    ['option order', (value: Fixture) => { value.candidate.options.reverse(); }],
    ['explanation', (value: Fixture) => { value.candidate.options[1].explanation = 'An altered feedback relation.'; }],
    ['role', (value: Fixture) => { value.candidate.options[0].role = 'clearly-wrong'; }],
    ['kind', (value: Fixture) => { value.candidate.numericKind = 'numeric'; }],
    ['formula', (value: Fixture) => { value.candidate.derivedValues = [{ name: 'RETURN', formula: '2+BETA*5' }]; }],
    ['parameter', (value: Fixture) => { value.candidate.paramSlots = [{ name: 'BETA', min: 1, max: 2, step: 0.1 }]; }],
    ['stored candidate hash', (value: Fixture) => { value.assessment.candidate!.contentHash = 'f'.repeat(64); }],
    ['stored full candidate', (value: Fixture) => { value.assessment.candidate!.options[0].text = 'A forged answer'; }],
    ['truncated stored candidate', (value: Fixture) => { value.assessment.candidate!.truncated = true; }],
    ['missing candidate receipt', (value: Fixture) => { delete value.assessment.candidate; }],
  ] as const)('rejects altered %s rather than trusting an eligible flag', async (_label, change) => {
    const value = await fixture(); change(value);
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it('binds candidate content beyond the bounded retrieval query and refuses fresh truncation', async () => {
    const value = await fixture();
    value.candidate.stem = 'CAPM '.repeat(1700);
    value.memory = await loadGenerationMemory({ courseId, loIds: [loId], includeCrossLo: true,
      taskRetrievalProtocol: 'course-task-retrieval-v1', query: generationTaskQuery(value.candidate) });
    value.assessment.candidate = snapshotQualityCandidate(value.candidate);
    value.assessment.memoryDigest = value.memory.snapshotDigest;
    const selected = selectGenerationMemory(value.memory, { query: generationTaskQuery(value.candidate) });
    value.assessment.comparedEntryIds = selected.entries.map(entry => entry.id);
    value.assessment.taskComparisons = selected.requiredComparisonIds!.map(entryId => ({ entryId, sameInference: false, sameSolutionPath: false, contrast: 'Different inference in this scripted comparison.' }));
    expect(() => admit(value)).not.toThrow();
    const before = generationTaskQuery(value.candidate);
    value.candidate.stem += ' Material new condition beyond the locator.';
    expect(generationTaskQuery(value.candidate)).toBe(before);
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
    value.candidate.stem = 'x'.repeat(12_001);
    value.assessment.candidate = snapshotQualityCandidate(value.candidate);
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it.each([
    ['memory digest', (value: Fixture) => { value.assessment.memoryDigest = 'foreign-memory'; }],
    ['withheld eligibility', (value: Fixture) => { value.assessment.status = 'withheld'; }],
    ['legacy quality policy', (value: Fixture) => { value.assessment.policy = 'grounded-memory-v1'; }],
    ['wrong intent', (value: Fixture) => { value.assessment.intent = 'create-variant'; }],
    ['uncertain novelty', (value: Fixture) => { value.assessment.novelty = 'uncertain'; }],
    ['duplicate novelty', (value: Fixture) => { value.assessment.novelty = 'duplicate'; }],
    ['missing selected IDs', (value: Fixture) => { delete value.assessment.comparedEntryIds; }],
    ['omitted selected ID', (value: Fixture) => { value.assessment.comparedEntryIds!.pop(); }],
    ['foreign selected ID', (value: Fixture) => { value.assessment.comparedEntryIds![0] = 'q:foreign:version'; }],
    ['duplicate selected ID', (value: Fixture) => { value.assessment.comparedEntryIds![1] = value.assessment.comparedEntryIds![0]; }],
  ] as const)('rejects %s on a new assessment', async (_label, change) => {
    const value = await fixture(); change(value);
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it.each([
    ['missing required row', (value: Fixture) => { value.assessment.taskComparisons!.pop(); }],
    ['empty ordinary comparisons', (value: Fixture) => { value.assessment.taskComparisons = []; }],
    ['duplicated required row', (value: Fixture) => { value.assessment.taskComparisons!.push(value.assessment.taskComparisons![0]); }],
    ['foreign comparison', (value: Fixture) => { value.assessment.taskComparisons![0].entryId = 'E1'; }],
    ['contradictory same-task comparison', (value: Fixture) => { value.assessment.taskComparisons![0].sameInference = true; value.assessment.taskComparisons![0].sameSolutionPath = true; }],
    ['invalid comparison contrast', (value: Fixture) => { value.assessment.taskComparisons![0].contrast = ''; }],
  ] as const)('replays %s rather than trusting recorded novelty', async (_label, change) => {
    const value = await fixture(); change(value);
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it.each([
    ['missing retrieval receipt', (value: Fixture) => { delete value.memory.taskRetrieval; }],
    ['incomplete scan', (value: Fixture) => { value.memory.taskRetrieval!.status = 'incomplete'; }],
    ['missing original version', (value: Fixture) => { value.memory.taskRetrieval!.missingVersions = 1; }],
    ['wrong query hash', (value: Fixture) => { value.memory.taskRetrieval!.queryHash = 'f'.repeat(64); }],
    ['removed required IDs', (value: Fixture) => { value.memory.taskRetrieval!.requiredComparisonIds = []; }],
    ['wrong comparator role', (value: Fixture) => { value.memory.entries.find(entry => entry.comparisonRole === 'retrieved-task')!.comparisonRole = undefined; }],
    ['foreign retained identities', (value: Fixture) => { value.memory.taskRetrieval!.retainedIds = ['q:foreign:version']; }],
  ] as const)('normalizes %s readiness errors to the admission guard code', async (_label, change) => {
    const value = await fixture(); change(value);
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it('rejects another internally valid request query for the same candidate and memory assessment', async () => {
    const value = await fixture();
    value.memory = await loadGenerationMemory({ courseId, loIds: [loId], includeCrossLo: true,
      taskRetrievalProtocol: 'course-task-retrieval-v1', query: 'CAPM original source prompt with a different retrieval request' });
    value.assessment.memoryDigest = value.memory.snapshotDigest;
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it.each([
    ['stored entry text', (value: Fixture) => { value.memory.entries[0].content.stem += ' A forged stored premise.'; }],
    ['stored effective descriptor', (value: Fixture) => { value.memory.entries[0].taskDescriptor = { concepts: ['Unrelated pricing'], requiredInference: 'A substituted task.',
      solutionPath: ['Apply a different formula.'], misconception: 'Different inference.', targetDifficulty: 'hard', passageIds: [], intent: 'create-independent-task' }; }],
    ['snapshot digest', (value: Fixture) => { value.memory.snapshotDigest = 'f'.repeat(64); value.assessment.memoryDigest = value.memory.snapshotDigest; }],
    ['all marked obligations erased', (value: Fixture) => {
      value.memory.taskRetrieval!.requiredComparisonIds = [];
      for (const entry of value.memory.entries) entry.comparisonRole = undefined;
      value.assessment.taskComparisons = [];
    }],
  ] as const)('refuses %s tamper even with unchanged candidate and declared memory binding', async (_label, change) => {
    const value = await fixture(); change(value);
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it('accepts a changed repair only after refreshing its actual query, candidate and assessed selection', async () => {
    const value = await fixture();
    value.candidate.stem = 'How does CAPM distinguish systematic exposure from diversifiable volatility?';
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
    value.memory = await refreshGenerationMemoryForCandidate(value.memory, generationTaskQuery(value.candidate));
    value.assessment.candidate = snapshotQualityCandidate(value.candidate);
    value.assessment.memoryDigest = value.memory.snapshotDigest;
    const selected = selectGenerationMemory(value.memory, { query: generationTaskQuery(value.candidate) });
    value.assessment.comparedEntryIds = selected.entries.map(entry => entry.id);
    value.assessment.taskComparisons = selected.requiredComparisonIds!.map(entryId => ({ entryId, sameInference: false, sameSolutionPath: false,
      contrast: 'Fresh scripted comparison for the repaired inference, not a semantic model result.' }));
    expect(value.memory.taskRetrieval!.query).toBe(generationTaskQuery(value.candidate));
    expect(() => admit(value)).not.toThrow();
  });

  it.each(['edit-existing', 'create-variant'] as const)('keeps %s overlap separate while retaining common candidate/memory bindings', async intent => {
    const value = await fixture(); value.requirements.intent = intent; value.assessment.intent = intent;
    value.assessment.novelty = 'variant'; value.assessment.taskComparisons = [];
    expect(() => admit(value)).not.toThrow();
    value.assessment.memoryDigest = 'stale-memory';
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it('does not treat an optional diagnostic summary as authority for actual required comparisons', async () => {
    const value = await fixture();
    const diagnostic = value.assessment as unknown as { taskRetrieval?: unknown };
    diagnostic.taskRetrieval = { status: 'passed', requiredComparisonIds: [], omitted: true };
    value.assessment.taskComparisons = [];
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });

  it('preserves historical absence without inspecting missing candidate/memory/assessment records', () => {
    expect(() => assertGenerationTaskRetrievalAssessment({ requirements: { intent: 'create-independent-task', requiredChanges: [], preserve: [] },
      candidate: undefined as never, memory: undefined as unknown as GenerationMemorySnapshot, assessment: undefined as never })).not.toThrow();
  });

  it('rejects an unknown explicit selector rather than treating it as historical absence', async () => {
    const value = await fixture(); value.requirements.taskRetrievalProtocol = 'future-v9' as never;
    expect(() => admit(value)).toThrow('generation-task-retrieval-assessment-invalid');
  });
});
