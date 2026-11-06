jest.mock('../../server/src/config/env', () => ({ env: { llmModelGenerator: 'generator', llmModelValidator: 'validator', llmModelReviewer: 'reviewer', embeddingsModel: 'embedding' } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn(async () => [0.1, 0.2]) }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({ losCol: jest.fn(), materialsCol: jest.fn(), contentRunsCol: jest.fn(), authoringTaskPlansCol: jest.fn(), themesCol: jest.fn() }));
jest.mock('../../server/src/services/content-runs.service', () => ({ assertContentRunActive: jest.fn(), updateContentRun: jest.fn(), failContentRun: jest.fn(), getContentRun: jest.fn() }));
jest.mock('../../server/src/services/admin.service', () => ({ getPlatformSettings: jest.fn() }));
jest.mock('../../server/src/services/materials.service', () => ({ courseCollection: () => 'course' }));
jest.mock('../../server/src/services/source-readiness.service', () => ({ assertSourceSelectionReady: jest.fn(async () => ({ ready: true })) }));
jest.mock('../../server/src/services/questions.service', () => ({ createQuestion: jest.fn() }));
jest.mock('../../server/src/services/generation-evidence.service', () => ({ assertGenerationEvidenceCurrent: jest.fn(), expandGenerationEvidence: jest.fn() }));
jest.mock('../../server/src/services/generation-memory.service', () => ({ ...jest.requireActual('../../server/src/services/generation-memory.service'), loadGenerationMemory: jest.fn() }));
jest.mock('../../server/src/services/generation-quality.service', () => ({ ...jest.requireActual('../../server/src/services/generation-quality.service'), generationQualityInstruction: jest.fn(() => 'AUTHORING POLICY: grounded-memory-v2'), assessGenerationQuality: jest.fn() }));
jest.mock('../../server/src/services/authoring-context.service', () => ({ buildAuthoringContext: jest.fn(), fenceAuthoringContext: jest.fn() }));
jest.mock('../../server/src/services/authoring-task-plan.service', () => ({ ...jest.requireActual('../../server/src/services/authoring-task-plan.service'), prepareAuthoringTaskPlan: jest.fn(), recordQuestionPedagogicalFingerprint: jest.fn() }));
jest.mock('../../server/src/services/authoring-commit.service', () => ({ authoringCollection: (value: unknown) => value, withCourseAuthoringWrite: jest.fn(async (_course, work) => work({})) }));
jest.mock('../../server/src/services/authoring-execution.service', () => ({ withAuthoringExecution: jest.fn(async (_run, work) => work()), assertAuthoringExecutionActive: jest.fn(), authoringExecutionToken: () => 'owner' }));
jest.mock('../../server/src/services/generation-exact-bank', () => ({ assertGenerationExactBankCurrent: jest.fn() }));
import { assertGenerationExactBankCurrent } from '../../server/src/services/generation-exact-bank';
import { evaluateExclusionReview } from '../../server/src/services/generation-exclusion-review';
import { expandGenerationEvidence } from '../../server/src/services/generation-evidence.service';
import { generationNumericReviewMetadata, generationNumericReviewStageBinding, generationNumericReviewStageMatches } from '../../server/src/services/generation-numeric-review.service';
import { withCourseAuthoringWrite } from '../../server/src/services/authoring-commit.service';
import type { AuthoringTaskPlan } from '../../server/src/types/authoring-task';
import retainedNumeric from '../fixtures/generation-quality/retained-review-size-2026-10-17.json';
import { ObjectId, BSON } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { defineJob } from '../../server/src/components/jobs';
import { search } from '../../server/src/components/qdrant';
import { losCol, materialsCol, contentRunsCol, authoringTaskPlansCol } from '../../server/src/components/mongodb/collections';
import { updateContentRun, failContentRun, getContentRun } from '../../server/src/services/content-runs.service';
import { getPlatformSettings } from '../../server/src/services/admin.service';
import { runTrackedGenerationPipeline, registerGenerationJobs } from '../../server/src/services/generation.service';
import { buildAuthoringContext } from '../../server/src/services/authoring-context.service';
import { loadGenerationMemory } from '../../server/src/services/generation-memory.service';
import { assessGenerationQuality, snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { evaluateTaskDemand, taskDemandPassed, taskDemandReceiptMatches, type TaskDemandReview } from '../../server/src/services/generation-task-demand';
import { buildGenerationSemanticRepairPlan } from '../../server/src/services/generation-semantic-repair';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import { prepareAuthoringTaskPlan } from '../../server/src/services/authoring-task-plan.service';
import { createQuestion } from '../../server/src/services/questions.service';
import { AuthoringBudget, currentAuthoringBudget, withAuthoringBudget } from '../../server/src/services/authoring-budget.service';
import { admitAuthoringSend } from '../../server/src/components/genai/llm/authoring-budget';
import { EVALUATOR_VERSION } from '../../server/src/components/formula';
import { INPUT_DISPLAY_VERIFICATION_VERSION } from '../../server/src/services/numeric-input-display.service';
import { isNumericQuestion, isServable } from '../../server/src/services/numeric-gate.service';
import type { QuestionGenerationResult, QuestionOption } from '../../server/src/types/domain';

const courseId = new ObjectId(); const loId = new ObjectId(); const themeId = new ObjectId(); const materialId = new ObjectId(); const runId = new ObjectId();
const descriptor = { concepts: ['CAPM'], requiredInference: 'Distinguish beta from volatility.', solutionPath: ['Identify systematic risk.'], misconception: 'Confuse total volatility with beta.', targetDifficulty: 'easy' as const, passageIds: ['E1'], intent: 'create-independent-task' as const };
const packet: GenerationEvidencePacket = { id: 'evidence', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2',
  courseId: courseId.toHexString(), loIds: [loId.toHexString()], sourceFingerprint: 'source', parsingProvenance: 'unrecorded',
  materials: [{ materialId: materialId.toHexString(), role: 'primary', name: 'Chapter.pdf', revision: 1, activeRunId: null, contentHash: 'source', chunkCount: 1 }], findings: [],
  passages: [{ id: 'E1', role: 'primary', materialId: materialId.toHexString(), materialName: 'Chapter.pdf', chunkIndex: 0,
    start: 0, end: 'Beta measures systematic risk.'.length, text: 'Beta measures systematic risk.', selection: 'retrieved' }],
  coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: 'Beta measures systematic risk.'.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' } };
const memory = { entries: [], snapshotDigest: 'memory', truncated: false, missingVersions: 0, consistency: 'best-effort' as const };
const options: QuestionOption[] = [{ key: 'A', text: 'Beta', explanation: 'Beta measures systematic risk.', role: 'correct' }, { key: 'B', text: 'Total volatility', explanation: 'Total volatility is not beta.', role: 'common-misconception' }, { key: 'C', text: 'Beta and volatility', explanation: 'Only beta is systematic risk.', role: 'partially-correct' }, { key: 'D', text: 'Firm name', explanation: 'Names are irrelevant.', role: 'clearly-wrong' }];
let plan: { _id: ObjectId; evidencePacketId: string; memoryDigest: string; slots: Array<{ item: number; status: string; descriptor: typeof descriptor }> };
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(assertGenerationExactBankCurrent).mockReset().mockResolvedValue(undefined); plan = { _id: new ObjectId(), evidencePacketId: 'evidence', memoryDigest: 'memory', slots: [0, 1].map(item => ({ item, status: 'reserved', descriptor: { ...descriptor, requiredInference: `Independent task ${item}` } })) };
  jest.mocked(getPlatformSettings).mockResolvedValue({ models: { generator: { model: 'generator' }, validator: { model: 'validator' }, reviewer: { model: 'reviewer' } }, featureFlags: { reviewerAgent: true, retryOnReject: false } } as never);
  jest.mocked(losCol).mockReturnValue({ findOne: async () => ({ _id: loId, courseId, themeId, name: 'Systematic risk' }) } as never);
  jest.mocked(materialsCol).mockReturnValue({ find: () => ({ toArray: async () => [{ _id: materialId, courseId, status: 'ready', assignments: [{ loId, themeId }] }] }) } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ updateOne: async () => ({ matchedCount: 1 }) } as never);
  jest.mocked(authoringTaskPlansCol).mockReturnValue({ findOne: async () => plan, updateOne: async () => ({ matchedCount: 1 }) } as never);
  jest.mocked(search).mockResolvedValue([{ id: 'source', score: 1, payload: { materialId: materialId.toHexString(), chunk: 'Beta measures systematic risk.' } }]);
  jest.mocked(buildAuthoringContext).mockResolvedValue({ id: 'context', evidence: packet, memory, requirements: { intent: 'create-independent-task', requiredChanges: [], preserve: [] } } as never);
  jest.mocked(loadGenerationMemory).mockResolvedValue(memory); jest.mocked(prepareAuthoringTaskPlan).mockResolvedValue(plan as never);
  jest.mocked(assessGenerationQuality).mockImplementation(async input => ({ policy: 'grounded-memory-v2', status: 'eligible', item: input.item, achievedDifficulty: 'easy', difficultyMismatch: true, citations: [{ passageId: 'E1' }], reasons: [], coverage: {}, sourceSupport: 'supported' }) as never);
  jest.mocked(createQuestion).mockImplementation(async input => ({ questionId: new ObjectId(), version: { _id: new ObjectId(), ...input } }) as never);
  jest.mocked(updateContentRun).mockResolvedValue({} as never);
});
it('runs two independently planned generator sends concurrently, serializes progress writes and commits in slot order', async () => {
  let pending = 0; let maxPending = 0; let sends = 0; let release!: () => void;
  const bothStarted = new Promise<void>(resolve => { release = resolve; });
  let writes = 0; let maxWrites = 0;
  jest.mocked(updateContentRun).mockImplementation(async () => { writes++; maxWrites = Math.max(maxWrites, writes); await new Promise(resolve => setTimeout(resolve, 1)); writes--; return {} as never; });
  jest.mocked(completeJson).mockImplementation(async (_prompt, request) => {
    if (request?.usageContext?.stage === 'generation') {
      const item = sends++; pending++; maxPending = Math.max(maxPending, pending); if (pending === 2) release(); await bothStarted;
      request.onText?.(`{"stem":"Candidate ${item}"}`); pending--;
      return { stem: `Which symbol identifies systematic risk for task ${item}?`, options, difficulty: 'easy', numericKind: 'conceptual', taskDescriptor: plan.slots[item].descriptor } as never;
    }
    return request?.usageContext?.stage === 'validation' ? { roleAssessment: 'Valid roles.' } as never : { decision: 'pass', reasoning: 'Supported.' } as never;
  });
  const result = await runTrackedGenerationPipeline({ courseId, loId, count: 2, type: 'mcq', difficulty: 'hard', pinnedMaterialIds: [materialId], groundingPinned: true, qualityPolicy: 'grounded-memory-v2', byPuid: 'teacher' }, runId);
  expect(result).toHaveLength(2); expect(maxPending).toBe(2); expect(maxWrites).toBe(1);
  expect(jest.mocked(createQuestion).mock.calls.map(([input]) => input.provenance && 'item' in input.provenance ? input.provenance.item : -1)).toEqual([0, 1]);
  expect(createQuestion).toHaveBeenCalledWith(expect.objectContaining({ difficulty: 'easy', authoringQuality: expect.objectContaining({ requestedDifficulty: 'hard', achievedDifficulty: 'easy', difficultyMismatch: true }) }));
  expect(failContentRun).not.toHaveBeenCalled();
});

it('stops unservable v2 numerical candidates before any paid validation, review or source judgment', async () => {
  plan.slots = plan.slots.slice(0, 1);
  const unsafe = { stem: 'Riskfree {{RF}}%, beta {{BETA}}, risk premium {{RP}} as a fraction. What return does CAPM require?',
    difficulty: 'easy', numericKind: 'numeric', taskDescriptor: descriptor,
    paramSlots: [{ name: 'RF', values: [2.75] }, { name: 'BETA', values: [1.0013] }, { name: 'RP', values: [0.0576] }],
    derivedValues: [{ name: 'GOOD', formula: 'RF+BETA*RP*100' }, { name: 'NO_BETA', formula: 'RF+RP*100', errorModel: 'Ignore beta.' },
      { name: 'ONLY_RP', formula: 'RP*100', errorModel: 'Omit riskfree and beta.' }, { name: 'ONLY_RF', formula: 'RF', errorModel: 'Omit market compensation.' }],
    options: options.map((option, index) => ({ ...option, text: `{{${['GOOD','NO_BETA','ONLY_RP','ONLY_RF'][index]}}}%` })) };
  jest.mocked(completeJson).mockResolvedValue(unsafe as never);
  const result = await runTrackedGenerationPipeline({ courseId, loId, count: 1, type: 'mcq', pinnedMaterialIds: [materialId], groundingPinned: true,
    qualityPolicy: 'grounded-memory-v2', byPuid: 'teacher' }, runId);
  expect(result).toEqual([]); expect(createQuestion).not.toHaveBeenCalled(); expect(assessGenerationQuality).not.toHaveBeenCalled();
  expect(completeJson).toHaveBeenCalledTimes(2);
  expect(jest.mocked(completeJson).mock.calls.every(([, request]) => request?.usageContext?.stage === 'generation')).toBe(true);
  expect(failContentRun).toHaveBeenCalledWith(runId, expect.anything(), expect.objectContaining({ failures: [expect.objectContaining({ stage: 'generating', message: expect.stringContaining('input display check') })] }));
});

it('strips an injected current proof and stops a numeric-looking conceptual item before paid checks or saving', async () => {
  plan.slots = plan.slots.slice(0, 1);
  const unsafe = { stem: 'An asset costs $100. Which amount is its price?', difficulty: 'easy', numericKind: 'conceptual' as const,
    paramSlots: [], derivedValues: [], taskDescriptor: descriptor,
    options: options.map((option, index) => ({ ...option, text: `$${[100, 10, 110, 90][index]}` })),
    verification: { evaluatorVersion: EVALUATOR_VERSION, inputDisplayVersion: INPUT_DISPLAY_VERIFICATION_VERSION,
      sampleSeeds: [1, 2], verifiedAt: new Date('2026-10-16T00:00:00Z') } };
  // This fixture targets the independent serving backstop: trusting the model's
  // current-looking proof would incorrectly let this uncomputed item pass it.
  expect(isNumericQuestion(unsafe)).toBe(true);
  expect(isServable(unsafe)).toBe(true);
  jest.mocked(completeJson).mockResolvedValue(unsafe as never);
  const result = await runTrackedGenerationPipeline({ courseId, loId, count: 1, type: 'mcq', pinnedMaterialIds: [materialId], groundingPinned: true,
    qualityPolicy: 'grounded-memory-v2', byPuid: 'teacher' }, runId);
  expect(result).toEqual([]);
  expect(completeJson).toHaveBeenCalledTimes(2);
  expect(jest.mocked(completeJson).mock.calls.every(([, request]) => request?.usageContext?.stage === 'generation')).toBe(true);
  expect(assessGenerationQuality).not.toHaveBeenCalled(); expect(createQuestion).not.toHaveBeenCalled();
  expect(failContentRun).toHaveBeenCalledWith(runId, expect.anything(), expect.objectContaining({ failures: [expect.objectContaining({
    stage: 'generating', message: expect.stringContaining('no valid proof'),
  })] }));
});

it('rebinds friendly source span IDs to canonical originals before private storage and saving', async () => {
  plan.slots = plan.slots.slice(0, 1);
  jest.mocked(completeJson).mockImplementation(async (_prompt, request) => request?.usageContext?.stage === 'generation'
    ? { stem: 'Which measure matches systematic risk?', options, difficulty: 'easy', numericKind: 'conceptual', taskDescriptor: { ...descriptor, passageIds: ['S1'] } } as never
    : request?.usageContext?.stage === 'validation' ? { roleAssessment: 'Valid roles.' } as never : { decision: 'pass', reasoning: 'Supported.' } as never);
  const result = await runTrackedGenerationPipeline({ courseId, loId, count: 1, type: 'mcq', pinnedMaterialIds: [materialId], groundingPinned: true, qualityPolicy: 'grounded-memory-v2', byPuid: 'teacher' }, runId);
  expect(result).toHaveLength(1);
  expect(createQuestion).toHaveBeenCalledWith(expect.objectContaining({ taskDescriptor: expect.objectContaining({ passageIds: ['E1'] }) }));
});

it('corrects a source-backed answer defect and saves only after a fresh complete v2 check, retaining before/after evidence', async () => {
  plan.slots = plan.slots.slice(0, 1);
  const before = { stem: 'Which measure represents systematic risk?', options: options.map(option => option.key === 'A' ? { ...option, text: 'Total volatility', explanation: 'Volatility is systematic risk.' } : option),
    difficulty: 'easy', numericKind: 'conceptual', taskDescriptor: descriptor };
  const after = { ...before, options };
  const stages: string[] = [];
  jest.mocked(completeJson).mockImplementation(async (_prompt, request) => {
    stages.push(String(request?.usageContext?.stage));
    if (request?.usageContext?.stage === 'generation') return before as never;
    if (request?.usageContext?.stage === 'generation-repair') return after as never;
    return String(request?.usageContext?.stage).startsWith('validation') ? { roleAssessment: 'Inspected roles.' } as never : { decision: 'pass', reasoning: 'Reviewed.' } as never;
  });
  const eligible = { policy: 'grounded-memory-v2', status: 'eligible', item: 0, achievedDifficulty: 'easy', citations: [{ passageId: 'E1' }], reasons: [], coverage: {},
    sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', matchedEntryIds: [] };
  jest.mocked(assessGenerationQuality).mockResolvedValueOnce({ ...eligible, status: 'withheld', sourceSupport: 'unsupported', reasons: ['The keyed answer contradicts the source.'],
    findings: [{ kind: 'answer-semantics', target: 'options', status: 'defect', observation: 'Total volatility is wrongly keyed as systematic risk.', correction: 'Use beta as the correct measure and fix the associated explanations.', passageIds: ['E1'], memoryEntryIds: [] }] } as never)
    .mockResolvedValueOnce(eligible as never);
  const result = await runTrackedGenerationPipeline({ courseId, loId, count: 1, type: 'mcq', pinnedMaterialIds: [materialId], groundingPinned: true,
    qualityPolicy: 'grounded-memory-v2', answerabilityProtocol: 'option-answerability-v1', byPuid: 'teacher' }, runId);
  expect(result).toHaveLength(1); expect(createQuestion).toHaveBeenCalledTimes(1); expect(assessGenerationQuality).toHaveBeenCalledTimes(2);
  expect(jest.mocked(assessGenerationQuality).mock.calls.every(([input]) => input.requirements?.answerabilityProtocol === 'option-answerability-v1')).toBe(true);
  expect(stages).toEqual(['generation', 'validation', 'review', 'generation-repair', 'validation-repair', 'review-repair']);
  const completed = jest.mocked(updateContentRun).mock.calls.find(([, update]) => update.status === 'completed');
  const assessment = (completed?.[1].result as QuestionGenerationResult).quality!.assessments[0];
  expect(assessment.semanticRepair).toMatchObject({ version: 1, strategy: 'correct-candidate', outcome: 'eligible', before: { stem: before.stem }, after: { stem: after.stem } });
  expect(assessment.semanticRepair!.before.contentHash).not.toBe(assessment.semanticRepair!.after!.contentHash);
  expect((completed?.[1].result as QuestionGenerationResult).quality!.slotBudgets![0].receipt.logical).toMatchObject({ generatorAttempts: 2, repairCycles: 1 });
});

it('withholds ambiguous source relations without inventing a repair or saving', async () => {
  plan.slots = plan.slots.slice(0, 1);
  jest.mocked(completeJson).mockImplementation(async (_prompt, request) => request?.usageContext?.stage === 'generation'
    ? { stem: 'Which measure matches systematic risk?', options, difficulty: 'easy', numericKind: 'conceptual', taskDescriptor: descriptor } as never
    : request?.usageContext?.stage === 'validation' ? { roleAssessment: 'Roles inspected.' } as never : { decision: 'pass', reasoning: 'Reviewer is not evidence proof.' } as never);
  jest.mocked(assessGenerationQuality).mockResolvedValue({ policy: 'grounded-memory-v2', status: 'withheld', item: 0, achievedDifficulty: 'easy', citations: [], reasons: ['The table is unreadable.'], coverage: {},
    sourceSupport: 'uncertain', notation: 'uncertain', novelty: 'independent', matchedEntryIds: [], findings: [{ kind: 'actor-relation', target: 'options', status: 'uncertain', observation: 'Unrecoverable row boundaries.', correction: '', passageIds: ['E1'], memoryEntryIds: [] }] } as never);
  expect(await runTrackedGenerationPipeline({ courseId, loId, count: 1, pinnedMaterialIds: [materialId], groundingPinned: true, qualityPolicy: 'grounded-memory-v2', byPuid: 'teacher' }, runId)).toEqual([]);
  expect(completeJson).toHaveBeenCalledTimes(3); expect(assessGenerationQuality).toHaveBeenCalledTimes(1); expect(createQuestion).not.toHaveBeenCalled();
});

it('selects reported settlement for v2 run and slot budgets without changing a conservative parent', async () => {
  plan.slots = plan.slots.slice(0, 1);
  const scopes: string[] = [];
  jest.mocked(prepareAuthoringTaskPlan).mockImplementation(async () => {
    scopes.push(currentAuthoringBudget()!.snapshot().accounting!);
    return plan as never;
  });
  jest.mocked(completeJson).mockImplementation(async (_prompt, request) => {
    scopes.push(currentAuthoringBudget()!.snapshot().accounting!);
    const finished = await admitAuthoringSend({ prompt: 'synthetic SDK call', outputCap: 100, provider: 'fixture', model: 'fixture', options: {}, jsonAttempt: 0 });
    finished(undefined, 'succeeded');
    return request?.usageContext?.stage === 'generation'
      ? { stem: 'Which measure matches systematic risk?', options, difficulty: 'easy', numericKind: 'conceptual', taskDescriptor: descriptor } as never
      : request?.usageContext?.stage === 'validation' ? { roleAssessment: 'Valid roles.' } as never : { decision: 'pass', reasoning: 'Supported.' } as never;
  });
  const parent = new AuthoringBudget('parent');
  await withAuthoringBudget(parent, () => runTrackedGenerationPipeline({ courseId, loId, count: 1, pinnedMaterialIds: [materialId], groundingPinned: true,
    qualityPolicy: 'grounded-memory-v2', byPuid: 'teacher' }, runId));
  expect(scopes.length).toBeGreaterThanOrEqual(4);
  expect(scopes.every(mode => mode === 'reported-usage-settlement-v1')).toBe(true);
  const completed = jest.mocked(updateContentRun).mock.calls.find(([, update]) => update.status === 'completed');
  const slot = (completed?.[1].result as QuestionGenerationResult | undefined)?.quality?.slotBudgets?.[0].receipt;
  expect(slot?.accounting).toBe('reported-usage-settlement-v1');
  expect(slot).toMatchObject({ observedSends: 3, pendingSends: 0, settledSends: 0, conservativeFinishedSends: 3, usageCompleteness: 'unknown' });
  expect(slot!.admissionTokens).toBe(slot!.estimatedInputTokens + slot!.reservedOutputTokens);
  expect(parent.snapshot().accounting).toBe('conservative-reservations-v1');
});

it.each(['baseline', 'grounded-memory-v1'] as const)('keeps %s in the default conservative enclosing budget', async policy => {
  let observed: string | undefined;
  jest.mocked(getPlatformSettings).mockImplementation(async () => {
    observed = currentAuthoringBudget()?.snapshot().accounting;
    throw new Error('stop-before-model-work');
  });
  const parent = new AuthoringBudget('existing-caller');
  await expect(withAuthoringBudget(parent, () => runTrackedGenerationPipeline({ courseId, loId, count: 1,
    qualityPolicy: policy, byPuid: 'teacher' }, runId))).rejects.toThrow('stop-before-model-work');
  expect(observed).toBe('conservative-reservations-v1');
  expect(prepareAuthoringTaskPlan).not.toHaveBeenCalled(); expect(completeJson).not.toHaveBeenCalled();
});

// Scripted semantic labels exercise production orchestration and exact receipt
// binding. They do not establish the cognitive difficulty of these fixtures.
function demandQuality(input: Parameters<typeof assessGenerationQuality>[0], achieved: 'easy' | 'hard', wire: TaskDemandReview) {
  const checked = evaluateTaskDemand(wire, input.candidate, packet, input.requirements!, achieved);
  return { policy: 'grounded-memory-v2' as const, item: input.item, status: checked.assessment.status === 'passed' ? 'eligible' as const : 'withheld' as const,
    achievedDifficulty: achieved, difficultyMismatch: achieved !== input.requirements?.requestedDifficulty,
    evidencePacketId: packet.id, candidate: snapshotQualityCandidate(input.candidate), taskDemand: checked.assessment,
    ...(input.requirements?.numericReviewProtocol ? { numericReview: generationNumericReviewMetadata(input.candidate, input.requirements.numericReviewProtocol) } : {}),
    sourceSupport: 'supported' as const, notation: 'consistent' as const, novelty: 'independent' as const,
    justifiedLength: 'justified' as const, citations: [{ kind: 'solution' as const, passageId: 'E1', claim: 'Fixture source support.', quote: 'Beta measures systematic risk.' }],
    reasons: [], findings: checked.findings, matchedEntryIds: [], coverage: {} } as never;
}
const fulfilledDemand: TaskDemandReview = { verdict: 'fulfilled', capacity: 'supported', rationale: 'Fixture operation is fulfilled.', missingOperation: '', spanIds: ['S1'] };

it.each(['missing', 'wrong-level', 'wrong-kind', 'stale-candidate'] as const)('refuses a forged eligible public task-demand result: %s', async fault => {
  plan.slots = plan.slots.slice(0, 1);
  jest.mocked(completeJson).mockImplementation(async (_prompt, request) => request?.usageContext?.stage === 'generation'
    ? { stem: 'Which measure matches systematic risk?', options, difficulty: 'hard', numericKind: 'conceptual', hardnessMove: 'Fixture comparison.', taskDescriptor: descriptor } as never
    : request?.usageContext?.stage === 'validation' ? { roleAssessment: 'Inspected.' } as never : { decision: 'pass', reasoning: 'Fixture.' } as never);
  jest.mocked(assessGenerationQuality).mockImplementation(async input => {
    const quality: Record<string, unknown> = demandQuality(input, fault === 'wrong-level' ? 'easy' : 'hard', fulfilledDemand);
    quality.status = 'eligible'; quality.findings = [];
    if (fault === 'missing') delete quality.taskDemand;
    if (fault === 'wrong-kind') (quality.taskDemand as { achieved: { kind: string } }).achieved.kind = 'numeric';
    if (fault === 'stale-candidate') (quality.candidate as { stem: string }).stem += ' Unreviewed.';
    return quality as never;
  });
  const saved = await runTrackedGenerationPipeline({ courseId, loId, count: 1, type: 'mcq', difficulty: 'hard', kind: 'conceptual',
    pinnedMaterialIds: [materialId], groundingPinned: true, qualityPolicy: 'grounded-memory-v2', taskDemandProtocol: 'task-demand-v1', byPuid: 'teacher' }, runId);
  expect(saved).toEqual([]); expect(createQuestion).not.toHaveBeenCalled();
  expect(completeJson).toHaveBeenCalledTimes(3); expect(assessGenerationQuality).toHaveBeenCalledTimes(1);
});

it.each([undefined, 'server-rendered-numeric-review-v1'] as const)('keeps the original hard request and replayable conceptual-repair cache with numeric pin %s', async numericReviewProtocol => {
  plan.slots = plan.slots.slice(0, 1); const prompts: string[] = []; const controls: unknown[] = [];
  if (numericReviewProtocol) Object.assign(plan, { numericReviewProtocol });
  const write = jest.fn(async () => ({ matchedCount: 1 }));
  jest.mocked(authoringTaskPlansCol).mockReturnValue({ findOne: async () => plan, updateOne: write } as never);
  jest.mocked(completeJson).mockImplementation(async (prompt, request) => {
    if (String(request?.usageContext?.stage).startsWith('generation')) {
      prompts.push(prompt);
      return { stem: request?.usageContext?.stage === 'generation-repair' ? 'Which taught relation distinguishes the second task?' : 'Which measure matches systematic risk?',
        options, difficulty: 'hard', numericKind: 'conceptual', hardnessMove: 'Fixture comparison.', taskDescriptor: descriptor } as never;
    }
    return String(request?.usageContext?.stage).startsWith('validation') ? { roleAssessment: 'Inspected.' } as never : { decision: 'pass', reasoning: 'Fixture.' } as never;
  });
  jest.mocked(assessGenerationQuality).mockImplementationOnce(async input => {
    const quality = demandQuality(input, 'easy', { verdict: 'unfulfilled', capacity: 'supported', rationale: 'Fixture only recalls a definition.', missingOperation: 'Require the taught comparison instead of recall.', spanIds: ['S1'] });
    controls.push({ matches: taskDemandReceiptMatches(quality, input.requirements!, snapshotQualityCandidate(input.candidate), packet),
      repair: Boolean(buildGenerationSemanticRepairPlan({ assessment: quality, requirements: input.requirements!, packet, memory, candidate: input.candidate })) });
    return quality;
  })
    .mockImplementationOnce(async input => {
      const quality = demandQuality(input, 'hard', fulfilledDemand);
      expect(taskDemandPassed(quality, input.requirements!, snapshotQualityCandidate(input.candidate), packet)).toBe(true);
      return quality;
    });
  const saved = await runTrackedGenerationPipeline({ courseId, loId, count: 1, type: 'mcq', difficulty: 'hard', kind: 'conceptual',
    pinnedMaterialIds: [materialId], groundingPinned: true, qualityPolicy: 'grounded-memory-v2', taskDemandProtocol: 'task-demand-v1', ...(numericReviewProtocol ? { numericReviewProtocol } : {}), byPuid: 'teacher' }, runId);
  if (numericReviewProtocol) {
    const repairWrite = write.mock.calls.map(call => (call as unknown as [unknown, { $set: Record<string, unknown> }])[1].$set)
      .find(row => row['slots.$.candidate'] && row['slots.$.validationNumericReview']);
    expect(repairWrite).toBeDefined();
    const stored = BSON.deserialize(BSON.serialize(repairWrite!));
    const current = snapshotQualityCandidate(stored['slots.$.candidate'] as never);
    expect(generationNumericReviewStageMatches(stored['slots.$.validationNumericReview'], current, numericReviewProtocol)).toBe(true);
    expect(generationNumericReviewStageMatches(stored['slots.$.reviewNumericReview'], current, numericReviewProtocol)).toBe(true);
  }
  expect(controls).toEqual([{ matches: true, repair: true }]);
  expect(jest.mocked(assessGenerationQuality).mock.calls).toHaveLength(2);
  expect(jest.mocked(failContentRun).mock.calls.flatMap(call => (call[2] as QuestionGenerationResult | undefined)?.failures ?? []).map(failure => failure.message)).toEqual([]);
  expect(saved).toHaveLength(1);
  expect(prompts).toHaveLength(2);
  expect(prompts.every(prompt => prompt.includes('Requested task difficulty: hard.'))).toBe(true);
  expect(assessGenerationQuality).toHaveBeenCalledTimes(2);
  expect(jest.mocked(assessGenerationQuality).mock.calls.every(([input]) => input.requirements?.requestedDifficulty === 'hard'
    && input.requirements?.requestedType === 'mcq' && input.requirements?.requestedKind === 'conceptual')).toBe(true);
  expect(createQuestion).toHaveBeenCalledWith(expect.objectContaining({ difficulty: 'hard', paramSlots: [], derivedValues: [],
    authoringQuality: expect.objectContaining({ requestedDifficulty: 'hard', achievedDifficulty: 'hard' }) }));
});

it('carries the exact Bank selector through public review and stops a competing duplicate inside the final write', async () => {
  plan.slots = plan.slots.slice(0, 1);
  jest.mocked(completeJson).mockImplementation(async (_prompt, request) => {
    if (request?.usageContext?.stage === 'generation') return { stem: 'Which symbol measures the taught systematic risk?', options,
      difficulty: 'easy', numericKind: 'conceptual', taskDescriptor: plan.slots[0].descriptor } as never;
    return request?.usageContext?.stage === 'validation' ? { roleAssessment: 'Valid roles.' } as never : { decision: 'pass', reasoning: 'Supported.' } as never;
  });
  jest.mocked(assertGenerationExactBankCurrent).mockRejectedValueOnce(new Error('authoring-exact-bank-duplicate'));
  const saved = await runTrackedGenerationPipeline({ courseId, loId, count: 1, type: 'mcq', pinnedMaterialIds: [materialId],
    groundingPinned: true, qualityPolicy: 'grounded-memory-v2', exactBankProtocol: 'course-exact-bank-v1', byPuid: 'teacher' }, runId);
  expect(saved).toEqual([]); expect(createQuestion).not.toHaveBeenCalled();
  expect(assessGenerationQuality).toHaveBeenCalledWith(expect.objectContaining({ requirements: expect.objectContaining({ exactBankProtocol: 'course-exact-bank-v1' }) }));
  expect(assertGenerationExactBankCurrent).toHaveBeenCalledWith(expect.objectContaining({ courseId, session: {},
    candidate: expect.objectContaining({ stem: 'Which symbol measures the taught systematic risk?', type: 'mcq' }),
    requirements: expect.objectContaining({ exactBankProtocol: 'course-exact-bank-v1' }) }));
  expect(failContentRun).toHaveBeenCalledWith(runId, expect.anything(), expect.objectContaining({ failures: [expect.objectContaining({
    message: expect.stringContaining('authoring-exact-bank-duplicate') })] }));
});

// Real production orchestration and arithmetic; all model judgments/storage are
// scripted. These controls establish admission mechanics, never semantic yield.
describe('numeric example pin through public stages and the final course fence', () => {
  const protocol = 'server-rendered-numeric-review-v1' as const;
  function setupNumeric() {
    plan.slots = plan.slots.slice(0, 1);
    Object.assign(plan, { numericReviewProtocol: protocol });
    const candidate = { ...structuredClone(retainedNumeric.cases.find(row => row.id === 'CAPM')!.candidate), taskDescriptor: descriptor };
    jest.mocked(completeJson).mockImplementation(async (_prompt, options) => {
      if (options?.usageContext?.stage === 'generation') return candidate as never;
      return String(options?.usageContext?.stage).startsWith('validation') ? { roleAssessment: 'SCRIPTED roles.' } as never : { decision: 'pass', reasoning: 'SCRIPTED content verdict.' } as never;
    });
    jest.mocked(assessGenerationQuality).mockImplementation(async input => ({ policy: 'grounded-memory-v2', status: 'eligible', item: input.item,
      achievedDifficulty: 'easy', citations: [{ passageId: 'E1' }], reasons: [], coverage: {}, sourceSupport: 'supported',
      candidate: snapshotQualityCandidate(input.candidate), numericReview: generationNumericReviewMetadata(input.candidate, input.requirements?.numericReviewProtocol) }) as never);
    return { courseId, loId, count: 1, type: 'mcq' as const, pinnedMaterialIds: [materialId], groundingPinned: true,
      qualityPolicy: 'grounded-memory-v2' as const, numericReviewProtocol: protocol, byPuid: 'teacher' };
  }
  it('pins planning and both rendered checks, records full stage bindings, then saves only a freshly bound assessment', async () => {
    const input = setupNumeric();
    const write = jest.fn(async () => ({ matchedCount: 1 }));
    jest.mocked(authoringTaskPlansCol).mockReturnValue({ findOne: async () => plan, updateOne: write } as never);
    expect(await runTrackedGenerationPipeline(input, runId)).toHaveLength(1);
    expect(prepareAuthoringTaskPlan).toHaveBeenCalledWith(expect.objectContaining({ numericReviewProtocol: protocol }));
    for (const stage of ['validation', 'review']) {
      const row = jest.mocked(completeJson).mock.calls.find(([, options]) => options?.usageContext?.stage === stage)!;
      expect(row[0]).toContain('SERVER NUMERIC EXAMPLE'); expect(row[0]).toContain('"checks":{"samples":100');
    }
    const sets = write.mock.calls.map(call => (call as unknown as [unknown, { $set: Record<string, unknown> }])[1].$set);
    expect(sets.some(row => row['slots.$.validationNumericReview'] !== undefined)).toBe(true);
    expect(sets.some(row => row['slots.$.reviewNumericReview'] !== undefined)).toBe(true);
    expect(assessGenerationQuality).toHaveBeenCalledWith(expect.objectContaining({ requirements: expect.objectContaining({ numericReviewProtocol: protocol }) }));
    expect(createQuestion).toHaveBeenCalledTimes(1);
  });
  it('restores the durable numeric selector through the registered worker without introducing another model stage', async () => {
    setupNumeric();
    jest.mocked(getContentRun).mockResolvedValue({ _id: runId, kind: 'question-generation', status: 'queued', courseId, requestedBy: 'teacher',
      input: { loId, count: 1, type: 'mcq', qualityPolicy: 'grounded-memory-v2', numericReviewProtocol: protocol,
        models: { generator: 'generator', validator: 'validator', reviewer: 'reviewer', embedding: 'embedding' } },
      grounding: { allowedMaterialIds: [materialId], pinned: true } } as never);
    registerGenerationJobs();
    const handler = jest.mocked(defineJob).mock.calls[0][1] as (value: { runId: string }) => Promise<void>;
    await handler({ runId: runId.toHexString() });
    expect(createQuestion).toHaveBeenCalledTimes(1);
    expect(prepareAuthoringTaskPlan).toHaveBeenCalledWith(expect.objectContaining({ numericReviewProtocol: protocol }));
    expect(jest.mocked(completeJson).mock.calls.map(([, options]) => options?.usageContext?.stage)).toEqual(['generation', 'validation', 'review']);
    expect(assessGenerationQuality).toHaveBeenCalledTimes(1);
  });
  it('reuses only matching BSON-restored cached stages while retaining the fresh final arithmetic check', async () => {
    const input = setupNumeric(); const slot = plan.slots[0] as unknown as AuthoringTaskPlan['slots'][number];
    const candidate = { ...structuredClone(retainedNumeric.cases.find(row => row.id === 'CAPM')!.candidate), taskDescriptor: descriptor, type: 'mcq' as const };
    slot.candidate = { ...candidate, sourceRefs: [], agentDecision: { decision: 'flag', reasoning: 'Pending.', roleAssessment: '' } } as never;
    slot.validation = { roleAssessment: 'Bound role finding.' }; slot.validationNumericReview = generationNumericReviewStageBinding(snapshotQualityCandidate(candidate as never), protocol);
    slot.review = { decision: 'pass', reasoning: 'Bound content finding.' }; slot.reviewNumericReview = BSON.deserialize(BSON.serialize(slot.validationNumericReview!)) as typeof slot.reviewNumericReview;
    expect(await runTrackedGenerationPipeline(input, runId)).toHaveLength(1);
    expect(completeJson).not.toHaveBeenCalled(); expect(assessGenerationQuality).toHaveBeenCalledTimes(1); expect(createQuestion).toHaveBeenCalledTimes(1);
  });
  it.each(['missing', 'wrong-receipt', 'wrong-candidate'] as const)('refuses a stale cached validation before any paid check: %s', async fault => {
    const input = setupNumeric(); const slot = plan.slots[0] as unknown as AuthoringTaskPlan['slots'][number];
    const candidate = { ...structuredClone(retainedNumeric.cases.find(row => row.id === 'CAPM')!.candidate), taskDescriptor: descriptor, type: 'mcq' as const };
    slot.candidate = { ...candidate, sourceRefs: [], agentDecision: { decision: 'flag', reasoning: 'Pending.', roleAssessment: '' } } as never;
    slot.validation = { roleAssessment: 'Old role finding.' };
    if (fault !== 'missing') slot.validationNumericReview = generationNumericReviewStageBinding(snapshotQualityCandidate(candidate as never), protocol);
    if (fault === 'wrong-receipt') slot.validationNumericReview!.receipt = { version: protocol, status: 'unavailable', reason: 'invalid-candidate' };
    if (fault === 'wrong-candidate') slot.validationNumericReview!.candidate.stem += ' Stale input.';
    expect(await runTrackedGenerationPipeline(input, runId)).toEqual([]);
    expect(completeJson).not.toHaveBeenCalled(); expect(assessGenerationQuality).not.toHaveBeenCalled(); expect(createQuestion).not.toHaveBeenCalled();
  });
  it.each(['missing', 'wrong-receipt', 'wrong-candidate'] as const)('refuses a stale cached content review before quality or save: %s', async fault => {
    const input = setupNumeric(); const slot = plan.slots[0] as unknown as AuthoringTaskPlan['slots'][number];
    const candidate = { ...structuredClone(retainedNumeric.cases.find(row => row.id === 'CAPM')!.candidate), taskDescriptor: descriptor, type: 'mcq' as const };
    slot.candidate = { ...candidate, sourceRefs: [], agentDecision: { decision: 'flag', reasoning: 'Pending.', roleAssessment: '' } } as never;
    slot.validation = { roleAssessment: 'Bound role finding.' }; slot.validationNumericReview = generationNumericReviewStageBinding(snapshotQualityCandidate(candidate as never), protocol);
    slot.review = { decision: 'pass', reasoning: 'Stale content.' };
    if (fault !== 'missing') slot.reviewNumericReview = generationNumericReviewStageBinding(snapshotQualityCandidate(candidate as never), protocol);
    if (fault === 'wrong-receipt') slot.reviewNumericReview!.receipt = { version: protocol, status: 'unavailable', reason: 'invalid-candidate' };
    if (fault === 'wrong-candidate') slot.reviewNumericReview!.candidate.stem += ' Stale input.';
    expect(await runTrackedGenerationPipeline(input, runId)).toEqual([]);
    expect(completeJson).not.toHaveBeenCalled(); expect(assessGenerationQuality).not.toHaveBeenCalled(); expect(createQuestion).not.toHaveBeenCalled();
  });
  it.each(['missing-receipt', 'changed-assessed-candidate', 'changed-plan'] as const)('refuses forged eligible state at the final course fence: %s', async fault => {
    const input = setupNumeric(); let assessed: Awaited<ReturnType<typeof assessGenerationQuality>>;
    const implementation = jest.mocked(assessGenerationQuality).getMockImplementation()!;
    jest.mocked(assessGenerationQuality).mockImplementation(async value => { assessed = await implementation(value); return assessed; });
    jest.mocked(withCourseAuthoringWrite).mockImplementationOnce(async (_course, work) => {
      if (fault === 'missing-receipt') delete assessed!.numericReview;
      if (fault === 'changed-assessed-candidate') assessed!.candidate!.stem += ' Unreviewed change.';
      if (fault === 'changed-plan') delete (plan as unknown as AuthoringTaskPlan).numericReviewProtocol;
      return work({} as never);
    });
    expect(await runTrackedGenerationPipeline(input, runId)).toEqual([]);
    expect(createQuestion).not.toHaveBeenCalled(); expect(completeJson).toHaveBeenCalledTimes(3);
  });
  it('refreshes all three sample representations after the one existing semantic repair and records its actual checked candidate', async () => {
    const input = setupNumeric();
    const originalComplete = jest.mocked(completeJson).getMockImplementation()!;
    const repaired = { ...structuredClone(retainedNumeric.cases.find(row => row.id === 'CAPM')!.candidate),
      stem: retainedNumeric.cases.find(row => row.id === 'CAPM')!.candidate.stem + ' Apply the stated relation.', taskDescriptor: descriptor };
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => options?.usageContext?.stage === 'generation-repair' ? repaired as never : originalComplete(prompt, options));
    const originalAssess = jest.mocked(assessGenerationQuality).getMockImplementation()!; let checks = 0;
    jest.mocked(assessGenerationQuality).mockImplementation(async value => {
      const result = await originalAssess(value); checks++;
      return checks === 1 ? { ...result, status: 'withheld', sourceSupport: 'unsupported', notation: 'consistent', novelty: 'independent', matchedEntryIds: [],
        reasons: ['SCRIPTED source-backed correction.'], findings: [{ kind: 'instruction', target: 'stem', status: 'defect', observation: 'SCRIPTED explicit instruction missing.',
          correction: 'State that the student should apply the stated relation.', passageIds: ['E1'], memoryEntryIds: [] }] } as never : result;
    });
    const write = jest.fn(async () => ({ matchedCount: 1 }));
    jest.mocked(authoringTaskPlansCol).mockReturnValue({ findOne: async () => plan, updateOne: write } as never);
    expect(await runTrackedGenerationPipeline(input, runId)).toHaveLength(1);
    expect(jest.mocked(completeJson).mock.calls.map(([, options]) => options?.usageContext?.stage)).toEqual(['generation', 'validation', 'review', 'generation-repair', 'validation-repair', 'review-repair']);
    for (const stage of ['validation-repair', 'review-repair']) {
      const prompt = jest.mocked(completeJson).mock.calls.find(([, options]) => options?.usageContext?.stage === stage)![0];
      expect(prompt).toContain('SERVER NUMERIC EXAMPLE'); expect(prompt).toContain(repaired.stem);
    }
    expect(assessGenerationQuality).toHaveBeenCalledTimes(2);
    expect(jest.mocked(assessGenerationQuality).mock.calls.every(([value]) => value.requirements?.numericReviewProtocol === protocol)).toBe(true);
    const qualityCalls = jest.mocked(assessGenerationQuality).mock.calls;
    expect(snapshotQualityCandidate(qualityCalls[0][0].candidate).contentHash).not.toBe(snapshotQualityCandidate(qualityCalls[1][0].candidate).contentHash);
    const repairedWrite = write.mock.calls.map(call => (call as unknown as [unknown, { $set: Record<string, unknown> }])[1].$set)
      .find(row => row['slots.$.candidate'] && row['slots.$.validationNumericReview']);
    expect(repairedWrite).toBeDefined();
    expect((repairedWrite!['slots.$.validationNumericReview'] as { candidate: { stem: string } }).candidate.stem).toBe(repaired.stem);
    expect(repairedWrite!['slots.$.reviewNumericReview']).toEqual(repairedWrite!['slots.$.validationNumericReview']);
  });
  it('preserves numeric selection and recalculates quality metadata when the existing source expansion runs', async () => {
    const input = setupNumeric(); const expanded = { ...packet, id: 'expanded-packet' };
    jest.mocked(expandGenerationEvidence).mockResolvedValue(expanded);
    const originalAssess = jest.mocked(assessGenerationQuality).getMockImplementation()!; let checks = 0;
    jest.mocked(assessGenerationQuality).mockImplementation(async value => {
      const result = await originalAssess(value); checks++;
      return checks === 1 ? { ...result, status: 'withheld', sourceSupport: 'uncertain', missingPremises: ['SCRIPTED missing original premise.'] } as never : result;
    });
    expect(await runTrackedGenerationPipeline(input, runId)).toHaveLength(1);
    expect(expandGenerationEvidence).toHaveBeenCalledTimes(1); expect(assessGenerationQuality).toHaveBeenCalledTimes(2);
    expect(jest.mocked(assessGenerationQuality).mock.calls[1][0]).toMatchObject({ packet: expanded, requirements: { numericReviewProtocol: protocol } });
    expect(completeJson).toHaveBeenCalledTimes(3);
  });

});


// The actual pure receipt/evidence parser executes here; semantic judgments,
// provider responses, Mongo transactions and saves are explicitly scripted.
describe('literal exclusion receipt through public worker and final fence', () => {
  function setupExclusions() {
    plan.slots = plan.slots.slice(0, 1);
    Object.assign(plan, { exclusionReviewProtocol: 'literal-exclusion-warrants-v1' });
    jest.mocked(completeJson).mockImplementation(async (_prompt, request) => request?.usageContext?.stage === 'generation'
      ? { stem: 'Which source symbol measures systematic risk?', options, difficulty: 'easy', numericKind: 'conceptual', taskDescriptor: descriptor } as never
      : request?.usageContext?.stage === 'validation' ? { roleAssessment: 'SCRIPTED roles.' } as never : { decision: 'pass', reasoning: 'SCRIPTED content.' } as never);
    jest.mocked(assessGenerationQuality).mockImplementation(async input => {
      const candidate = snapshotQualityCandidate(input.candidate);
      const checked = evaluateExclusionReview({ kind: 'mcq', options: candidate.options.map(option => ({ key: option.key,
        verdict: option.role === 'correct' ? 'fully-correct' : 'not-fully-correct', reason: 'SCRIPTED literal comparison.', spanIds: ['S1'],
        exclusion: option.role === 'correct' ? null : { basis: 'direct-contradiction', optionQuote: option.text, stemQuote: '',
          challenge: { status: 'excluded', reason: 'SCRIPTED source-based exclusion.', spanIds: ['S1'] } } })) }, candidate, input.packet, input.requirements!);
      return { policy: 'grounded-memory-v2', status: 'eligible', item: input.item, achievedDifficulty: 'easy',
        sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', matchedEntryIds: [], reasons: [],
        evidencePacketId: input.packet.id, memoryDigest: input.memory.snapshotDigest,
        candidate, answerability: checked.assessment, exclusionReview: checked.receipt,
        citations: [{ passageId: 'E1' }], coverage: {} } as never;
    });
    return { courseId, loId, count: 1, pinnedMaterialIds: [materialId], groundingPinned: true,
      qualityPolicy: 'grounded-memory-v2' as const, answerabilityProtocol: 'option-answerability-v1' as const,
      exclusionReviewProtocol: 'literal-exclusion-warrants-v1' as const, byPuid: 'teacher' };
  }
  it('saves only after replaying a complete current receipt with unchanged three role/content calls', async () => {
    const input = setupExclusions();
    expect(await runTrackedGenerationPipeline(input, runId)).toHaveLength(1);
    expect(createQuestion).toHaveBeenCalledTimes(1); expect(completeJson).toHaveBeenCalledTimes(3);
    expect(prepareAuthoringTaskPlan).toHaveBeenCalledWith(expect.objectContaining({ exclusionReviewProtocol: input.exclusionReviewProtocol }));
    expect(assessGenerationQuality).toHaveBeenCalledWith(expect.objectContaining({ requirements: expect.objectContaining({ exclusionReviewProtocol: input.exclusionReviewProtocol }) }));
  });
  it('restores the exact durable selector in the actual registered worker', async () => {
    const input = setupExclusions();
    jest.mocked(getContentRun).mockResolvedValue({ _id: runId, courseId, requestedBy: 'teacher', kind: 'question-generation', status: 'queued',
      input: { loId, count: 1, type: 'mcq', qualityPolicy: input.qualityPolicy, answerabilityProtocol: input.answerabilityProtocol,
        exclusionReviewProtocol: input.exclusionReviewProtocol, models: { generator: 'generator', validator: 'validator', reviewer: 'reviewer', embedding: 'embedding' } },
      grounding: { allowedMaterialIds: [materialId], pinned: true } } as never);
    registerGenerationJobs();
    const handler = jest.mocked(defineJob).mock.calls[0][1] as (value: { runId: string }) => Promise<void>;
    await handler({ runId: runId.toHexString() });
    expect(createQuestion).toHaveBeenCalledTimes(1);
    expect(prepareAuthoringTaskPlan).toHaveBeenCalledWith(expect.objectContaining({ exclusionReviewProtocol: input.exclusionReviewProtocol }));
    expect(assessGenerationQuality).toHaveBeenCalledTimes(1);
  });
  it.each(['missing', 'changed-candidate', 'changed-requirements', 'changed-source', 'changed-raw-review', 'stripped-plan'] as const)(
    'refuses %s at the real public orchestration fence without new checks or save', async fault => {
      const input = setupExclusions(); let assessed: Awaited<ReturnType<typeof assessGenerationQuality>>;
      const original = jest.mocked(assessGenerationQuality).getMockImplementation()!;
      jest.mocked(assessGenerationQuality).mockImplementation(async args => { assessed = await original(args); return assessed; });
      jest.mocked(withCourseAuthoringWrite).mockImplementationOnce(async (_course, work) => {
        if (fault === 'missing') delete assessed!.exclusionReview;
        if (fault === 'changed-candidate') assessed!.candidate!.options[0].text += ' Unchecked.';
        if (fault === 'changed-requirements') assessed!.exclusionReview!.requirementsHash = '0'.repeat(64);
        if (fault === 'changed-source') assessed!.exclusionReview!.evidenceHash = '0'.repeat(64);
        if (fault === 'changed-raw-review') assessed!.exclusionReview!.review!.options[0].reason += ' Changed.';
        if (fault === 'stripped-plan') delete (plan as unknown as AuthoringTaskPlan).exclusionReviewProtocol;
        return work({} as never);
      });
      expect(await runTrackedGenerationPipeline(input, runId)).toEqual([]);
      expect(createQuestion).not.toHaveBeenCalled(); expect(assessGenerationQuality).toHaveBeenCalledTimes(1); expect(completeJson).toHaveBeenCalledTimes(3);
    });
});
