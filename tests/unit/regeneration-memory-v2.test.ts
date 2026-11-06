jest.mock('../../server/src/config/env', () => ({ env: { llmModelGenerator: 'generator', llmModelValidator: 'validator', llmModelReviewer: 'reviewer' } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn(async () => [1]) }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(), losCol: jest.fn(), materialsCol: jest.fn(), questionsCol: jest.fn(), questionVersionsCol: jest.fn(), questionPedagogicalFingerprintsCol: jest.fn(), regenerationCandidatesCol: jest.fn(),
}));
jest.mock('../../server/src/services/authoring-commit.service', () => ({ ...jest.requireActual('../../server/src/services/authoring-commit.service'), authoringCommitAvailable: jest.fn(() => true), withCourseAuthoringWrite: jest.fn(async (_course, work) => work({})), withCourseAuthoringFirstWrite: jest.fn(async (_course, work) => work()) }));
jest.mock('../../server/src/services/admin.service', () => ({ getPlatformSettings: jest.fn() }));
jest.mock('../../server/src/services/materials.service', () => ({ courseCollection: () => 'course' }));
jest.mock('../../server/src/services/source-readiness.service', () => ({ assertSourceSelectionReady: jest.fn(async () => ({ ready: true })) }));
jest.mock('../../server/src/services/model-usage.service', () => ({ withModelUsage: jest.fn(async (_scope, work) => work()) }));
jest.mock('../../server/src/services/questions.service', () => ({ createQuestion: jest.fn(), editQuestion: jest.fn() }));
jest.mock('../../server/src/services/authoring-context.service', () => ({ ...jest.requireActual('../../server/src/services/authoring-context.service'), buildAuthoringContext: jest.fn(), assertAuthoringContextCurrent: jest.fn(), fenceAuthoringContext: jest.fn() }));

import { randomUUID } from 'node:crypto';
import { evaluateExclusionReview } from '../../server/src/services/generation-exclusion-review';
import { captureReviewDecisions, createReviewRepairReceipt } from '../../server/src/services/generation-review-repair';
import { ObjectId, BSON, type WithId } from 'mongodb';
import { regenerateQuestion, adoptRegenerationCandidate } from '../../server/src/services/generation.service';
import { completeJson } from '../../server/src/components/genai/llm';
import { search } from '../../server/src/components/qdrant';
import { coursesCol, losCol, materialsCol, questionsCol, questionVersionsCol, questionPedagogicalFingerprintsCol, regenerationCandidatesCol } from '../../server/src/components/mongodb/collections';
import { getPlatformSettings } from '../../server/src/services/admin.service';
import { buildAuthoringContext, assertAuthoringContextCurrent, authoringHash } from '../../server/src/services/authoring-context.service';
import { editQuestion } from '../../server/src/services/questions.service';
import { loadGenerationMemory, lookupGenerationExactBank, selectGenerationMemory } from '../../server/src/services/generation-memory.service';
import { generationTaskQuery } from '../../server/src/services/generation-task-query';
import { withCourseAuthoringWrite } from '../../server/src/services/authoring-commit.service';
import { withModelUsage } from '../../server/src/services/model-usage.service';
import { AuthoringBudget, currentAuthoringBudget, withAuthoringBudget } from '../../server/src/services/authoring-budget.service';
import type { RegenerationCandidateRecord } from '../../server/src/types/regeneration';
import type { QuestionVersion } from '../../server/src/types/domain';

const courseId = new ObjectId(); const questionId = new ObjectId(); const versionId = new ObjectId(); const loId = new ObjectId(); const themeId = new ObjectId(); const materialId = new ObjectId();
const options: QuestionVersion['options'] = [
  { key: 'A', text: 'Beta', explanation: 'CAPM uses beta.', role: 'correct' },
  { key: 'B', text: 'Total volatility', explanation: 'Total volatility is not beta.', role: 'common-misconception' },
  { key: 'C', text: 'Total and systematic risk', explanation: 'Only systematic risk is priced.', role: 'partially-correct' },
  { key: 'D', text: 'Firm name', explanation: 'The name is irrelevant.', role: 'clearly-wrong' },
];
const source = 'CAPM measures systematic risk using beta. Only systematic risk is priced; total volatility is not beta.';
let head: Record<string, unknown>; let current: WithId<QuestionVersion>;
let records: Array<WithId<RegenerationCandidateRecord>>;
let edit: jest.Mock;
let additionalHeads: Array<Record<string, unknown>>;
let additionalVersions: Array<WithId<QuestionVersion>>;
function equals(left: unknown, right: unknown): boolean { return left instanceof ObjectId && right instanceof ObjectId ? left.equals(right) : left === right; }
function matches(record: Record<string, unknown>, filter: Record<string, unknown>) {
  return Object.entries(filter).every(([key, value]) => {
    const actual = record[key];
    if (value && typeof value === 'object' && !(value instanceof ObjectId)) {
      const condition = value as { $in?: unknown[]; $nin?: unknown[]; $ne?: unknown; $gt?: ObjectId };
      const values = Array.isArray(actual) ? actual : [actual];
      if (condition.$in && !values.some(item => condition.$in!.some(wanted => equals(item, wanted)))) return false;
      if (condition.$nin && values.some(item => condition.$nin!.some(wanted => equals(item, wanted)))) return false;
      if ('$ne' in condition && equals(actual, condition.$ne)) return false;
      if (condition.$gt && (!(actual instanceof ObjectId) || actual.toHexString() <= condition.$gt.toHexString())) return false;
      return true;
    }
    return equals(actual, value);
  });
}
function cursor<T extends Record<string, unknown>>(rows: T[]) {
  let chosen = [...rows];
  interface Reader { sort(order: Record<string, number>): Reader; limit(count: number): Reader; toArray(): Promise<T[]> }
  const reader: Reader = { sort: order => {
    chosen.sort((left, right) => {
      for (const [key, direction] of Object.entries(order)) {
        const a = left[key], b = right[key];
        const difference = a instanceof ObjectId && b instanceof ObjectId ? a.toHexString().localeCompare(b.toHexString())
          : Number(a ?? 0) - Number(b ?? 0);
        if (difference) return difference * direction;
      }
      return 0;
    }); return reader;
  }, limit: count => { chosen = chosen.slice(0, count); return reader; }, toArray: async () => chosen };
  return reader;
}
function input() { return { qualityPolicy: 'grounded-memory-v2' as const, intent: 'edit-existing' as const, requestId: randomUUID(), expectedVersionId: versionId }; }
function quality() {
  return { sourceSupport: 'supported', notation: 'consistent', novelty: 'uncertain', reasons: ['The edit is supported.'], matchedEntryIds: [],
    citations: [{ kind: 'premise', claim: 'Beta measures systematic risk.', passageId: 'E1', quote: 'CAPM measures systematic risk using beta.' },
      { kind: 'solution', claim: 'Only systematic risk is priced.', passageId: 'E1', quote: 'Only systematic risk is priced' }],
    changes: [{ requirement: 'Change notation only.', status: 'fulfilled', reason: 'The notation is changed consistently.' }],
    invariants: ['Preserve the learning task and correct-answer semantics except for the explicitly requested changes.', 'Preserve unrelated wording, option order and roles.', 'Preserve parameter distributions and the underlying formulas; consistent symbol renaming is allowed.'].map(requirement => ({ requirement, status: 'preserved', reason: 'Preserved in the candidate.' })),
    achievedDifficulty: 'easy', justifiedLength: 'justified',
    taskDemand: { verdict: 'fulfilled', capacity: 'supported', rationale: 'The requested notation edit preserves the existing task.', missingOperation: '', spanIds: ['S1'] },
    // Synthetic assessment rows exercise the new contract and call ceiling;
    // they are not a model-quality verdict on these fixture answers.
    answerability: { kind: 'mcq', options: options.map(option => ({ key: option.key,
      verdict: option.role === 'correct' ? 'fully-correct' : 'not-fully-correct', reason: 'Checked literal response against the supplied CAPM definition.', spanIds: ['S1'],
      exclusion: option.role === 'correct' ? null : { basis: 'direct-contradiction', optionQuote: option.text, stemQuote: '',
        challenge: { status: 'excluded', reason: 'SCRIPTED comparison: this option contradicts the named measure.', spanIds: ['S1'] } } })) } };
}
beforeEach(() => {
  jest.clearAllMocks(); records = []; additionalHeads = []; additionalVersions = [];
  jest.mocked(withCourseAuthoringWrite).mockReset().mockImplementation(async (_course, work) => work({} as never));
  head = { _id: questionId, courseId, currentVersionId: versionId, currentVersion: 1, state: 'approved', loIds: [loId], themeIds: [themeId] };
  current = { _id: versionId, questionId, version: 1, type: 'mcq', stem: 'What measures systematic risk?', options, difficulty: 'easy', numericKind: 'conceptual', sourceRefs: [], createdBy: 'teacher', createdAt: new Date() };
  jest.mocked(questionsCol).mockReturnValue({ findOne: jest.fn(async filter => [head, ...additionalHeads].find(row => matches(row, filter)) ?? null),
    find: jest.fn(filter => cursor([head, ...additionalHeads].filter(row => matches(row, filter)))) } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne: jest.fn(async filter => matches(current as unknown as Record<string, unknown>, filter) ? current : null),
    find: jest.fn((filter: { _id: { $in: ObjectId[] } }) => cursor([current, ...additionalVersions].filter(row => filter._id.$in.some(id => id.equals(row._id))) as unknown as Record<string, unknown>[])) } as never);
  jest.mocked(questionPedagogicalFingerprintsCol).mockReturnValue({ find: jest.fn(() => cursor([])) } as never);
  jest.mocked(coursesCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: courseId })) } as never);
  jest.mocked(losCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: loId, courseId, themeId, name: 'Systematic risk', order: 1 })) } as never);
  jest.mocked(materialsCol).mockReturnValue({ find: jest.fn(() => ({ toArray: async () => [{ _id: materialId, courseId, name: 'Chapter.pdf', status: 'ready', assignments: [{ loId, themeId }] }] })) } as never);
  jest.mocked(regenerationCandidatesCol).mockReturnValue({
    findOne: jest.fn(async filter => records.find(record => matches(record as unknown as Record<string, unknown>, filter)) ?? null),
    insertOne: jest.fn(async record => { records.push(record); return { insertedId: record._id }; }),
    updateOne: jest.fn(async (filter, update) => { const record = records.find(row => matches(row as unknown as Record<string, unknown>, filter)); if (record) Object.assign(record, update.$set); return { matchedCount: record ? 1 : 0 }; }),
  } as never);
  jest.mocked(search).mockResolvedValue([{ id: '1', score: 1, payload: { materialId: materialId.toHexString(), chunkIndex: 0, chunk: source } }]);
  jest.mocked(getPlatformSettings).mockResolvedValue({ models: { generator: { model: 'generator' }, validator: { model: 'validator' }, reviewer: { model: 'reviewer' } }, featureFlags: { reviewerAgent: true } } as never);
  jest.mocked(buildAuthoringContext).mockImplementation(async args => {
    const memory = await loadGenerationMemory({ courseId: args.courseId, loIds: args.loIds, includeCrossLo: true,
      excludeQuestionId: args.excludeQuestionId, query: args.query,
      ...(args.requirements.taskRetrievalProtocol !== undefined ? { taskRetrievalProtocol: args.requirements.taskRetrievalProtocol } : {}),
      ...(args.pinnedOriginal ? { pinnedOriginal: args.pinnedOriginal } : {}) });
    const evidence = { id: 'packet', schemaVersion: 'source-passages-v1' as const, policyVersion: 'grounded-memory-v2' as const, courseId: courseId.toHexString(), loIds: [loId.toHexString()], sourceFingerprint: 'source', parsingProvenance: 'unrecorded' as const,
      materials: [{ materialId: materialId.toHexString(), name: 'Chapter.pdf', role: 'primary', contentHash: 'source', chunkCount: 1, revision: 1, activeRunId: null }],
      passages: [{ id: 'E1', materialId: materialId.toHexString(), materialName: 'Chapter.pdf', role: 'primary', chunkIndex: 0, start: 0, end: source.length, text: source, selection: 'retrieved' }],
      findings: [], coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: source.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' } } as const;
    return { id: authoringHash({ evidence: evidence.id, memory: memory.snapshotDigest, requirements: args.requirements }),
      requirements: args.requirements, memory, evidence: evidence as unknown as Awaited<ReturnType<typeof buildAuthoringContext>>['evidence'] };
  });
  jest.mocked(assertAuthoringContextCurrent).mockResolvedValue(undefined);
  jest.mocked(completeJson).mockReset().mockResolvedValueOnce({ stem: 'Which lecture symbol measures systematic risk?', options, difficulty: 'easy', numericKind: 'conceptual' })
    .mockResolvedValueOnce({ roleAssessment: 'Roles are valid.' }).mockResolvedValueOnce({ decision: 'pass', reasoning: 'Supported.' }).mockResolvedValueOnce(quality());
  edit = jest.fn(async (_id, patch) => ({ ...current, ...patch, _id: new ObjectId(), version: 2 }));
  jest.mocked(editQuestion).mockImplementation(edit);
});

describe('durable v2 regeneration', () => {
  it('refuses a historical script template before provider work so adoption cannot inherit unchecked code', async () => {
    current.generateScript = 'function generate(random) { return {}; }';
    await expect(regenerateQuestion(questionId, 'Use different numbers.', 'teacher', courseId, input())).rejects.toThrow('regeneration-script-template-requires-manual-edit');
    expect(completeJson).not.toHaveBeenCalled(); expect(records).toHaveLength(0); expect(edit).not.toHaveBeenCalled();
  });
  it('shares original evidence and current Bank memory, and never overwrites an approved head automatically', async () => {
    const request = input(); const result = await regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, request);
    expect(records[0].sourceProvenance).toBe('pdf-pages-v1');
    expect(records[0].requirements.answerabilityProtocol).toBe('option-answerability-v1');
    expect(records[0].requirements.numericReviewProtocol).toBe('server-rendered-numeric-review-v1');
    expect(records[0].requirements.exclusionReviewProtocol).toBe('literal-exclusion-warrants-v1');
    expect(records[0].quality?.exclusionReview?.status).toBe('passed');
    expect(records[0].requirements.reviewRepairProtocol).toBe('frozen-review-decisions-v1');
    expect(records[0].quality?.reviewRepair).toMatchObject({ protocol: 'frozen-review-decisions-v1', status: 'consistent', corrected: false });
    expect(records[0].quality!.numericReview).toMatchObject({ version: 'server-rendered-numeric-review-v1', status: 'not-applicable' });
    expect(records[0].requirements.exactBankProtocol).toBe('course-exact-bank-v1');
    expect(records[0].requirements.taskRetrievalProtocol).toBe('course-task-retrieval-v1');
    expect(records[0].requirements).toMatchObject({ taskDemandProtocol: 'task-demand-v1', requestedType: 'mcq' });
    expect(records[0].requirements).not.toHaveProperty('requestedDifficulty');
    expect(records[0].requirements).not.toHaveProperty('requestedKind');
    expect(buildAuthoringContext).toHaveBeenCalledWith(expect.objectContaining({ sourceProvenance: 'pdf-pages-v1' }));
    expect(result.status).toBe('eligible'); expect(result.variant?.options.map(option => option.key)).toEqual(options.map(option => option.key));
    expect(head.currentVersionId).toBe(versionId); expect(edit).not.toHaveBeenCalled();
    expect(buildAuthoringContext).toHaveBeenCalledWith(expect.objectContaining({ excludeQuestionId: questionId, loIds: [loId], requirements: expect.objectContaining({ intent: 'edit-existing' }) }));
    expect(records[0]).toMatchObject({ status: 'eligible', requestId: request.requestId, originalVersionId: versionId,
      contextId: authoringHash({ evidence: records[0].evidence!.id, memory: records[0].memory!.snapshotDigest, requirements: records[0].requirements }), candidateHash: authoringHash(result.variant) });
    expect(records[0].memory!.taskRetrieval).toMatchObject({ status: 'complete', query: generationTaskQuery({ ...records[0].candidate!, type: current.type }) });
    expect(records[0].quality!.memoryDigest).toBe(records[0].memory!.snapshotDigest);
    expect(withModelUsage).toHaveBeenCalledWith(expect.objectContaining({ runId: result.usageRunId, actor: { puid: 'teacher' } }), expect.any(Function));
    const replay = await regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, request);
    expect(replay.candidateId).toBe(result.candidateId); expect(completeJson).toHaveBeenCalledTimes(4);
  });
  it('replays a historical same-UUID candidate without upgrading its retained answerability contract', async () => {
    const request = input(); await regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, request);
    delete records[0].requirements.answerabilityProtocol;
    delete records[0].requirements.exclusionReviewProtocol; delete records[0].quality!.exclusionReview;
    delete records[0].requirements.reviewRepairProtocol; delete records[0].quality!.reviewRepair;
    delete records[0].requirements.numericReviewProtocol;
    delete records[0].quality!.numericReview;
    delete records[0].requirements.taskDemandProtocol;
    delete records[0].requirements.exactBankProtocol;
    delete records[0].requirements.taskRetrievalProtocol;
    records[0].memory = await loadGenerationMemory({ courseId, loIds: [loId], excludeQuestionId: questionId, includeCrossLo: true });
    records[0].quality!.memoryDigest = records[0].memory.snapshotDigest;
    delete records[0].quality!.taskRetrieval;
    records[0].contextId = authoringHash({ evidence: records[0].evidence!.id, memory: records[0].memory.snapshotDigest, requirements: records[0].requirements });
    const calls = jest.mocked(completeJson).mock.calls.length;
    const result = await regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, request);
    expect(result.candidateId).toBe(records[0]._id.toHexString());
    expect(records[0].requirements).not.toHaveProperty('answerabilityProtocol');
    expect(records[0].requirements).not.toHaveProperty('exclusionReviewProtocol');
    expect(records[0].requirements).not.toHaveProperty('reviewRepairProtocol');
    expect(records[0].quality).not.toHaveProperty('reviewRepair');
    expect(records[0].requirements).not.toHaveProperty('numericReviewProtocol');
    expect(records[0].quality).not.toHaveProperty('numericReview');
    expect(records[0].requirements).not.toHaveProperty('taskDemandProtocol');
    expect(records[0].requirements).not.toHaveProperty('exactBankProtocol');
    expect(records[0].requirements).not.toHaveProperty('taskRetrievalProtocol');
    expect(records[0].memory).not.toHaveProperty('taskRetrieval');
    expect(completeJson).toHaveBeenCalledTimes(calls);
  });
  it('selects the v2 settlement receipt while preserving an enclosing conservative allowance', async () => {
    let leafMode: string | undefined;
    const originalContext = jest.mocked(buildAuthoringContext).getMockImplementation()!;
    jest.mocked(buildAuthoringContext).mockImplementationOnce(async args => {
      leafMode = currentAuthoringBudget()?.snapshot().accounting;
      return originalContext(args);
    });
    const parent = new AuthoringBudget('existing-caller');
    const result = await withAuthoringBudget(parent, () => regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, input()));
    expect(result.status).toBe('eligible'); expect(leafMode).toBe('reported-usage-settlement-v1');
    expect(result.budget?.accounting).toBe('reported-usage-settlement-v1');
    expect(parent.snapshot().accounting).toBe('conservative-reservations-v1');
  });
  it('rejects conflicting reuse of a request UUID', async () => {
    const request = input(); await regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, request);
    await expect(regenerateQuestion(questionId, 'Change the answer.', 'teacher', courseId, request)).rejects.toThrow('regeneration-request-conflict');
    expect(completeJson).toHaveBeenCalledTimes(4);
  });
  it('pins the current original for an independent-task request without changing edit/variant exclusions', async () => {
    await regenerateQuestion(questionId, 'Require a different inference.', 'teacher', courseId, { ...input(), intent: 'create-independent-task' });
    expect(buildAuthoringContext).toHaveBeenCalledWith(expect.objectContaining({ excludeQuestionId: questionId,
      pinnedOriginal: { questionId, versionId }, requirements: expect.objectContaining({ intent: 'create-independent-task' }) }));
    expect(edit).not.toHaveBeenCalled();
  });
  it('persists failed work and replays failure without spending again', async () => {
    jest.mocked(completeJson).mockReset().mockRejectedValue(new Error('provider-unavailable'));
    const request = input(); const result = await regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, request);
    expect(result).toMatchObject({ status: 'failed', reasons: ['provider-unavailable'] }); expect(records[0].usageRunId).toBe(result.usageRunId);
    await regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, request); expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('refuses v2 when the Reviewer is disabled, without making a generation call', async () => {
    jest.mocked(getPlatformSettings).mockResolvedValue({ featureFlags: { reviewerAgent: false } } as never);
    await expect(regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, input())).rejects.toThrow('generation-quality-reviewer-required');
    expect(completeJson).not.toHaveBeenCalled(); expect(records).toHaveLength(0);
  });
  it('repairs an unrelated explanation change using the named invariant within the same bounded cycle', async () => {
    const badOptions = options.map(option => ({ ...option, explanation: `Unrequested expansion: ${option.explanation}` }));
    const first = quality(); first.invariants[1] = { ...first.invariants[1], status: 'violated', reason: 'The unrelated explanations were expanded.' };
    jest.mocked(completeJson).mockReset()
      .mockResolvedValueOnce({ stem: 'Which lecture symbol measures systematic risk?', options: badOptions, difficulty: 'easy', numericKind: 'conceptual' })
      .mockResolvedValueOnce({ roleAssessment: 'Valid.' }).mockResolvedValueOnce({ decision: 'pass', reasoning: 'Supported.' }).mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ stem: 'Which lecture symbol measures systematic risk?', options, difficulty: 'easy', numericKind: 'conceptual' })
      .mockResolvedValueOnce({ roleAssessment: 'Valid.' }).mockResolvedValueOnce({ decision: 'pass', reasoning: 'Supported.' }).mockResolvedValueOnce(quality());
    const result = await regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, input());
    expect(result.status).toBe('eligible'); expect(result.variant!.options).toEqual(options); expect(completeJson).toHaveBeenCalledTimes(8);
    expect(jest.mocked(completeJson).mock.calls[4][0]).toContain('Violated invariant: Preserve unrelated wording, option order and roles.');
    expect(jest.mocked(completeJson).mock.calls[4][0]).toContain('The unrelated explanations were expanded.');
    expect(jest.mocked(completeJson).mock.calls[4][0]).toContain('CORRECT THE SAME ORIGINAL QUESTION, not a new learning task');
    expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('copy unrelated fields verbatim,including option order/roles,explanations,task/answer semantics');
    expect(result.budget!.logical.repairCycles).toBe(1); expect(head.currentVersionId).toBe(versionId); expect(edit).not.toHaveBeenCalled();
    const memoryWrites = jest.mocked(regenerationCandidatesCol().updateOne).mock.calls.flatMap(([, update]) => {
      const value = (update as { $set?: { memory?: RegenerationCandidateRecord['memory'] } }).$set?.memory;
      return value ? [value] : [];
    });
    expect(memoryWrites.some(memory => memory.taskRetrieval?.query.includes('Unrequested expansion:'))).toBe(true);
    expect(records[0].memory!.taskRetrieval!.query).toBe(generationTaskQuery({ ...records[0].candidate!, type: current.type }));
    expect(records[0].quality!.memoryDigest).toBe(records[0].memory!.snapshotDigest);
  });
  it('requires the original version pin and does not recreate deleted candidate records', async () => {
    await expect(regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, { ...input(), expectedVersionId: new ObjectId() })).rejects.toThrow('question-changed-during-regeneration');
    expect(completeJson).not.toHaveBeenCalled();
  });
});

describe('explicit stored-candidate adoption', () => {
  async function ready() { const result = await regenerateQuestion(questionId, 'Change notation only.', 'teacher', courseId, input()); return { courseId, questionId, byPuid: 'teacher', candidateId: new ObjectId(result.candidateId), expectedVersionId: versionId }; }
  async function independentReady() {
    const request = await ready(); const record = records[0];
    // This control isolates the new deterministic contract; independent semantic
    // labels are fixture inputs, not a real model judgment or source acceptance.
    record.requirements.intent = 'create-independent-task'; delete record.requirements.taskDemandProtocol;
    record.memory = await loadGenerationMemory({ courseId, loIds: [loId], includeCrossLo: true, excludeQuestionId: questionId,
      pinnedOriginal: { questionId, versionId }, taskRetrievalProtocol: record.requirements.taskRetrievalProtocol,
      query: generationTaskQuery({ ...record.candidate!, type: current.type }) });
    const selected = selectGenerationMemory(record.memory, { query: generationTaskQuery({ ...record.candidate!, type: current.type }) });
    record.quality!.intent = 'create-independent-task'; record.quality!.novelty = 'independent';
    record.quality!.memoryDigest = record.memory.snapshotDigest; record.quality!.comparedEntryIds = selected.entries.map(entry => entry.id);
    record.quality!.taskComparisons = selected.requiredComparisonIds!.map(entryId => ({ entryId, sameInference: false, sameSolutionPath: false, contrast: 'Fixture independent inference and path.' }));
    record.contextId = authoringHash({ evidence: record.evidence!.id, memory: record.memory.snapshotDigest, requirements: record.requirements });
    record.quality!.exactBank = await lookupGenerationExactBank({ protocol: 'course-exact-bank-v1', courseId,
      candidate: { ...record.candidate!, type: current.type } });
    // Intent changed above: replay the scripted finding against the complete
    // revised requirements instead of reusing its previous edit receipt.
    const exclusion = evaluateExclusionReview(record.quality!.exclusionReview!.review, record.quality!.candidate!, record.evidence!, record.requirements);
    record.quality!.answerability = exclusion.assessment; record.quality!.exclusionReview = exclusion.receipt;
    // The revised independent decisions above are an explicit scripted review,
    // not a format correction of the earlier edit judgment. Bind a fresh
    // consistent receipt to those exact decisions and the revised full inputs.
    const decisions = captureReviewDecisions(record.quality!, record.quality!.candidate!, record.quality!.comparedEntryIds ?? [], record.requirements);
    record.quality!.reviewRepair = createReviewRepairReceipt({ before: decisions, after: decisions, corrected: false,
      candidate: record.quality!.candidate!, requirements: record.requirements, packet: record.evidence!, initialIssues: [] });
    return request;
  }
  function addCurrentBankVersion(duplicate: boolean) {
    const record = records[0], id = new ObjectId(), vid = new ObjectId();
    additionalHeads.push({ _id: id, courseId, currentVersionId: vid, state: 'approved' });
    additionalVersions.push({ ...current, ...record.candidate!, stem: duplicate ? record.candidate!.stem : 'A different current question.',
      _id: vid, questionId: id });
  }
  it('rechecks the actual full-Bank receipt before adopting a selected independent candidate', async () => {
    const request = await independentReady(); const sends = jest.mocked(completeJson).mock.calls.length;
    await adoptRegenerationCandidate(request);
    expect(records[0].status).toBe('adopted'); expect(edit).toHaveBeenCalledTimes(1);
    expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it.each([
    [true, 'authoring-exact-bank-duplicate'], [false, 'authoring-memory-changed'],
  ] as const)('blocks a current Bank insert after review inside the adoption callback: duplicate=%s', async (duplicate, code) => {
    const request = await independentReady(); const sends = jest.mocked(completeJson).mock.calls.length;
    jest.mocked(withCourseAuthoringWrite).mockImplementationOnce(async (_course, work) => {
      addCurrentBankVersion(duplicate); return work({} as never);
    });
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow(code);
    expect(edit).not.toHaveBeenCalled(); expect(records[0].status).toBe('eligible');
    expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it('refuses a missing selected exact-Bank receipt at adoption without editing or dispatching again', async () => {
    const request = await independentReady(); delete records[0].quality!.exactBank;
    const sends = jest.mocked(completeJson).mock.calls.length;
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('generation-exact-bank-receipt-invalid');
    expect(edit).not.toHaveBeenCalled(); expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it.each(['missing', 'candidate', 'requirements', 'achieved', 'source'] as const)('refuses a forged eligible demand receipt: %s', async tamper => {
    const request = await ready(); const record = records[0];
    if (tamper === 'missing') delete record.quality!.taskDemand;
    if (tamper === 'candidate') { record.candidate!.stem += ' Unreviewed change.'; record.candidateHash = authoringHash(record.candidate); }
    if (tamper === 'requirements') record.requirements.requiredChanges.push('Also introduce a new learning task.');
    if (tamper === 'achieved') record.quality!.achievedDifficulty = 'hard';
    if (tamper === 'source') record.evidence!.passages[0].text = record.evidence!.passages[0].text.replace('CAPM', 'Changed');
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible');
    expect(edit).not.toHaveBeenCalled();
  });
  it('refuses an older independent-task candidate without a checked pinned-original comparison', async () => {
    const request = await ready(); records[0].requirements.intent = 'create-independent-task';
    delete records[0].requirements.taskDemandProtocol;
    delete records[0].requirements.taskRetrievalProtocol;
    delete records[0].requirements.exclusionReviewProtocol; delete records[0].quality!.exclusionReview;
    delete records[0].requirements.reviewRepairProtocol; delete records[0].quality!.reviewRepair;
    records[0].quality!.novelty = 'independent';
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-original-comparison-required');
    expect(edit).not.toHaveBeenCalled();
  });
  it('refuses an older eligible candidate that still reports missing necessary premises', async () => {
    const request = await ready(); records[0].quality!.missingPremises = ['A required course convention.'];
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible');
    expect(edit).not.toHaveBeenCalled();
  });
  it('rechecks source/memory and numerical validity, then makes an explicitly reviewed version', async () => {
    const request = await ready(); await adoptRegenerationCandidate(request);
    expect(assertAuthoringContextCurrent).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledWith(questionId, expect.objectContaining({ expectedVersionId: versionId, regenerationCandidateId: request.candidateId, submitForReview: true, authoringQuality: expect.objectContaining({ intent: 'edit-existing', achievedDifficulty: 'easy' }) }), 'teacher');
    expect(records[0].status).toBe('adopted');
  });
  it.each(['authoring-memory-changed', 'generation-evidence-source-changed'])('refuses stale context: %s', async reason => {
    const request = await ready(); jest.mocked(assertAuthoringContextCurrent).mockRejectedValue(new Error(reason));
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow(reason); expect(edit).not.toHaveBeenCalled();
  });
  it('refuses a forged passed flag if the stored candidate content has changed', async () => {
    const request = await ready(); records[0].candidate!.stem = 'Forged unsupported question';
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible'); expect(edit).not.toHaveBeenCalled();
  });
  it('refuses historical eligible candidates containing internal evidence IDs even with a matching stored hash', async () => {
    const request = await ready(); records[0].candidate!.options[0].explanation += ' [E1]';
    records[0].candidateHash = authoringHash(records[0].candidate);
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible'); expect(edit).not.toHaveBeenCalled();
  });
  it.each(['before-read', 'inside-fence'] as const)('refuses a missing numeric-review receipt at %s without calls or edits', async where => {
    const request = await ready(); const sends = jest.mocked(completeJson).mock.calls.length;
    if (where === 'before-read') delete records[0].quality!.numericReview;
    else jest.mocked(withCourseAuthoringWrite).mockImplementationOnce(async (_course, work) => {
      delete records[0].quality!.numericReview; return work({} as never);
    });
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible');
    expect(edit).not.toHaveBeenCalled(); expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it('refuses a stripped numeric selector on the fresh transactional read without rewriting historical absence', async () => {
    const request = await ready(); const sends = jest.mocked(completeJson).mock.calls.length;
    jest.mocked(withCourseAuthoringWrite).mockImplementationOnce(async (_course, work) => {
      delete records[0].requirements.numericReviewProtocol; delete records[0].quality!.numericReview;
      return work({} as never);
    });
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible');
    expect(edit).not.toHaveBeenCalled(); expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it.each(['before-read', 'inside-fence'] as const)('refuses a missing literal-exclusion receipt at %s without model calls or edits', async where => {
    const request = await ready(); const sends = jest.mocked(completeJson).mock.calls.length;
    if (where === 'before-read') delete records[0].quality!.exclusionReview;
    else jest.mocked(withCourseAuthoringWrite).mockImplementationOnce(async (_course, work) => {
      delete records[0].quality!.exclusionReview; return work({} as never);
    });
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible');
    expect(edit).not.toHaveBeenCalled(); expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it('refuses removing the selected exclusion contract at transactional reread', async () => {
    const request = await ready(); const sends = jest.mocked(completeJson).mock.calls.length;
    jest.mocked(withCourseAuthoringWrite).mockImplementationOnce(async (_course, work) => {
      delete records[0].requirements.exclusionReviewProtocol; delete records[0].quality!.exclusionReview;
      return work({} as never);
    });
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible');
    expect(edit).not.toHaveBeenCalled(); expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it.each(['before-read', 'inside-fence'] as const)('refuses a missing frozen-review receipt at %s without model calls or edits', async where => {
    const request = await ready(); const sends = jest.mocked(completeJson).mock.calls.length;
    if (where === 'before-read') delete records[0].quality!.reviewRepair;
    else jest.mocked(withCourseAuthoringWrite).mockImplementationOnce(async (_course, work) => {
      delete records[0].quality!.reviewRepair; return work({} as never);
    });
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible');
    expect(edit).not.toHaveBeenCalled(); expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it.each(['before-read', 'inside-fence'] as const)('refuses tampered frozen-review decisions at %s without model calls or edits', async where => {
    const request = await ready(); const sends = jest.mocked(completeJson).mock.calls.length;
    const tamper = () => { records[0].quality!.reviewRepair!.after.sourceSupport = 'unsupported'; };
    if (where === 'before-read') tamper();
    else jest.mocked(withCourseAuthoringWrite).mockImplementationOnce(async (_course, work) => { tamper(); return work({} as never); });
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible');
    expect(edit).not.toHaveBeenCalled(); expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it.each(['remove', 'unknown'] as const)('refuses %s frozen-review selector at transactional reread', async change => {
    const request = await ready(); const sends = jest.mocked(completeJson).mock.calls.length;
    jest.mocked(withCourseAuthoringWrite).mockImplementationOnce(async (_course, work) => {
      if (change === 'remove') { delete records[0].requirements.reviewRepairProtocol; delete records[0].quality!.reviewRepair; }
      else (records[0].requirements as unknown as Record<string, unknown>).reviewRepairProtocol = 'unknown-review-contract';
      return work({} as never);
    });
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('regeneration-candidate-not-eligible');
    expect(edit).not.toHaveBeenCalled(); expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it('replays complete exclusion and frozen-review receipts after real BSON encoding before an isolated adoption', async () => {
    const request = await ready(); const sends = jest.mocked(completeJson).mock.calls.length;
    const receipt = records[0].quality!.reviewRepair;
    expect(receipt).toMatchObject({ protocol: 'frozen-review-decisions-v1', status: 'consistent' });
    records[0] = BSON.deserialize(BSON.serialize(records[0])) as typeof records[number];
    expect(records[0].quality!.reviewRepair).toEqual(receipt);
    await adoptRegenerationCandidate(request);
    expect(records[0].status).toBe('adopted'); expect(edit).toHaveBeenCalledTimes(1);
    expect(completeJson).toHaveBeenCalledTimes(sends);
  });
  it('refuses original edits and another actor or course', async () => {
    const request = await ready(); head.currentVersionId = new ObjectId();
    await expect(adoptRegenerationCandidate(request)).rejects.toThrow('question-changed-during-regeneration');
    await expect(adoptRegenerationCandidate({ ...request, byPuid: 'other' })).rejects.toThrow('regeneration-candidate-not-found');
    await expect(adoptRegenerationCandidate({ ...request, courseId: new ObjectId() })).rejects.toThrow('regeneration-candidate-not-found');
  });
});
