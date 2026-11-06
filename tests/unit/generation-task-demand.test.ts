jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn(() => { throw new Error('unexpected-vector-request'); }) }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({}));
import { createHash } from 'node:crypto';
import { completeJson } from '../../server/src/components/genai/llm';
import { evaluateTaskDemand, taskDemandEnabled, taskDemandPassed, taskDemandReviewSchema, type TaskDemandReview } from '../../server/src/services/generation-task-demand';
import { assessGenerationQuality, authoringIntentInstruction, renderGenerationQualityReviewPrompt, snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { bindPlannedAuthoringTask, buildGenerationSemanticRepairPlan } from '../../server/src/services/generation-semantic-repair';
import { repairGenerationQualityCandidate, type GeneratorOutput } from '../../server/src/services/generation.service';
import { AuthoringBudget, withAuthoringBudget } from '../../server/src/services/authoring-budget.service';
import { selectGenerationMemory, type GenerationMemoryContent, type GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { AuthoringRequirements } from '../../server/src/types/generation-quality';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import retained from './fixtures/generation-answerability-retained.json';

// Synthetic structural judgments below test the contract, not actual model difficulty.
const text = 'Firm-specific risk can be diversified away; market risk remains. Distinguish the two rules when selecting a portfolio strategy.';
const packet: GenerationEvidencePacket = { id: 'demand-source', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2',
  courseId: '000000000000000000000003', loIds: ['lo'], sourceFingerprint: 'source', parsingProvenance: 'unrecorded',
  materials: [{ materialId: 'material', name: 'Synthetic source', contentHash: 'hash', revision: 1, activeRunId: null, chunkCount: 1, role: 'primary', loId: 'lo' }],
  passages: [{ id: 'E1', materialId: 'material', materialName: 'Synthetic source', chunkIndex: 0, start: 0, end: text.length, text, role: 'primary', loId: 'lo', selection: 'retrieved' }],
  coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: text.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [] };
const memory: GenerationMemorySnapshot = { entries: [], truncated: false, missingVersions: 0, snapshotDigest: 'memory', consistency: 'best-effort' };
const requirements: AuthoringRequirements = { intent: 'create-independent-task', requiredChanges: ['Stay within the source and keep reading brief.'], preserve: [],
  taskDemandProtocol: 'task-demand-v1', requestedDifficulty: 'hard', requestedKind: 'conceptual', requestedType: 'mcq' };
const candidate: GenerationMemoryContent = { type: 'mcq', stem: 'Which risk remains?', numericKind: 'conceptual', options: [
  { key: 'A', text: 'Market risk', role: 'correct', explanation: 'Market risk remains.' },
  { key: 'B', text: 'Firm-specific risk', role: 'common-misconception', explanation: 'Firm-specific risk can be diversified away.' },
  { key: 'C', text: 'Both', role: 'partially-correct', explanation: 'Only market risk remains.' },
  { key: 'D', text: 'Neither', role: 'clearly-wrong', explanation: 'Market risk remains.' },
] };
const demand = (overrides: Partial<TaskDemandReview> = {}): TaskDemandReview => ({ verdict: 'unfulfilled', capacity: 'supported',
  rationale: 'This asks direct recall rather than the required discrimination between the two taught rules.',
  missingOperation: 'Require selecting a strategy by distinguishing both taught risk rules.', spanIds: ['S1'], ...overrides });
const wire = (level = 'easy', row: unknown = demand()) => ({ sourceSupport: 'supported', notation: 'consistent', novelty: 'independent',
  reasons: ['The task uses the supplied risk rules.'], citations: [{ kind: 'premise', claim: 'Two risk rules', spanIds: ['S1'] }, { kind: 'solution', claim: 'Market risk remains', spanIds: ['S1'] }],
  taskComparisons: [], changes: requirements.requiredChanges.map(requirement => ({ requirement, status: 'fulfilled', reason: 'Source and brevity retained.' })),
  invariants: [], achievedDifficulty: level, justifiedLength: 'justified', missingPremises: [], taskDemand: row });
const args = () => ({ packet, memory, candidate, item: 0, step: { model: 'synthetic' }, policy: 'grounded-memory-v2' as const, requirements });
beforeEach(() => jest.mocked(completeJson).mockReset().mockResolvedValue(wire()));

it('withholds actual achieved/requested mismatches without a new schema-correction call and exposes a supported operation repair', async () => {
  const result = await assessGenerationQuality(args());
  expect(result).toMatchObject({ status: 'withheld', achievedDifficulty: 'easy', difficultyMismatch: true,
    taskDemand: { status: 'withheld', capacity: 'supported', requested: { difficulty: 'hard', kind: 'conceptual', type: 'mcq' }, achieved: { difficulty: 'easy' } } });
  expect(completeJson).toHaveBeenCalledTimes(1);
  const plan = buildGenerationSemanticRepairPlan({ assessment: result, requirements, packet, memory, candidate });
  expect(plan?.critique).toContain('Missing taught operation'); expect(plan?.critique).toContain('S1');
  expect(plan?.requirements).toEqual(requirements); expect(plan!.critique.length).toBeLessThanOrEqual(4500);
  expect(jest.mocked(completeJson).mock.calls[0][1]?.maxTokens).toBe(2000);
});

it.each(['easy', 'medium', 'hard'] as const)('keeps matching %s targets eligible when the same-call operation judgment and all other gates pass', async level => {
  jest.mocked(completeJson).mockResolvedValue(wire(level, demand({ verdict: 'fulfilled', missingOperation: '', rationale: 'The necessary operation fulfills the fixed request.' })));
  const result = await assessGenerationQuality({ ...args(), requirements: { ...requirements, requestedDifficulty: level } });
  expect(result.status).toBe('eligible'); expect(result.taskDemand?.status).toBe('passed');
});

it.each(['kind', 'type', 'difficulty'] as const)('does not let a fulfilled label override the actual %s mismatch', dimension => {
  const req = { ...requirements, requestedDifficulty: 'easy' as const, ...(dimension === 'kind' ? { requestedKind: 'numeric' as const }
    : dimension === 'type' ? { requestedType: 'true-false' as const } : { requestedDifficulty: 'hard' as const }) };
  const result = evaluateTaskDemand(demand({ verdict: 'fulfilled', missingOperation: '' }), candidate, packet, req, 'easy');
  expect(result.assessment.status).toBe('withheld'); expect(result.responseIssues).toHaveLength(0);
  expect(result.findings[0].status).toBe('uncertain');
});

it.each(['insufficient', 'uncertain'] as const)('retains %s capacity as a scoped shortfall and refuses another defect as permission to invent harder prerequisites', async capacity => {
  jest.mocked(completeJson).mockResolvedValue(wire('easy', demand({ capacity, verdict: capacity === 'uncertain' ? 'uncertain' : 'unfulfilled', spanIds: [] })));
  const result = await assessGenerationQuality(args());
  result.findings!.push({ kind: 'verbosity', target: 'stem', status: 'defect', observation: 'Independent synthetic defect.', correction: 'Shorten wording.', passageIds: ['E1'], memoryEntryIds: [] });
  expect(result.status).toBe('withheld'); expect(result.taskDemand?.capacity).toBe(capacity);
  expect(buildGenerationSemanticRepairPlan({ assessment: result, requirements, packet, memory, candidate })).toBeUndefined();
  expect(completeJson).toHaveBeenCalledTimes(1);
});

it.each(['foreign', 'duplicate', 'missing', 'damaged', 'scope'] as const)('refuses %s demand evidence and preserves bounded response diagnostics', kind => {
  const row = demand({ spanIds: kind === 'foreign' ? ['S99'] : kind === 'duplicate' ? ['S1', 'S1'] : kind === 'missing' ? [] : ['S1'] });
  const source = kind === 'damaged' ? { ...packet, findings: [{ code: 'source-text-damage' as const, message: 'Damage', passageIds: ['E1'] }] }
    : kind === 'scope' ? { ...packet, materials: [{ ...packet.materials[0], role: 'secondary' as const }] } : packet;
  expect(evaluateTaskDemand(row, candidate, source, requirements, 'easy').responseIssues).toContainEqual({ path: 'taskDemand.spanIds', code: 'task-demand-evidence-invalid' });
});

it.each(['status', 'protocol', 'requested', 'achieved', 'citations', 'sourceLocation', 'requirementsHash'] as const)('rejects model-authored %s server fields', key => {
  expect(taskDemandReviewSchema.safeParse({ ...demand(), [key]: 'forged' }).success).toBe(false);
});

it('binds final persistence/adoption to exact current candidate, full teacher requirements, packet and achieved fields without I/O', async () => {
  const req: AuthoringRequirements = { ...requirements, requestedDifficulty: 'easy' };
  jest.mocked(completeJson).mockResolvedValue(wire('easy', demand({ verdict: 'fulfilled', missingOperation: '' })));
  const result = await assessGenerationQuality({ ...args(), requirements: req });
  const current = snapshotQualityCandidate(candidate);
  expect(taskDemandPassed(result, req, current, packet)).toBe(true);
  expect(taskDemandPassed(result, { ...req, requiredChanges: ['A different teacher requirement.'] }, current, packet)).toBe(false);
  expect(taskDemandPassed(result, req, snapshotQualityCandidate({ ...candidate, stem: 'Changed after review.' }), packet)).toBe(false);
  expect(taskDemandPassed(result, req, current, { ...packet, id: 'other' })).toBe(false);
  expect(taskDemandPassed({ ...result, achievedDifficulty: 'hard' }, req, current, packet)).toBe(false);
  expect(taskDemandPassed({ ...result, taskDemand: undefined }, req, current, packet)).toBe(false);
  expect(taskDemandPassed({ ...result, taskDemand: { ...result.taskDemand!, status: 'withheld' } }, req, current, packet)).toBe(false);
  expect(taskDemandPassed(result, { ...req, taskDemandProtocol: undefined }, current, packet)).toBe(true);
});

it('uses only the existing one schema-correction allowance and output cap, including persistent missing rows', async () => {
  const missing = wire(); delete (missing as Partial<typeof missing>).taskDemand;
  jest.mocked(completeJson).mockResolvedValueOnce(missing).mockResolvedValueOnce(wire());
  const budget = new AuthoringBudget('demand', { maxSends: 8 });
  const result = await withAuthoringBudget(budget, () => assessGenerationQuality(args()));
  expect(result.status).toBe('withheld'); expect(result.taskDemand?.capacity).toBe('supported');
  expect(completeJson).toHaveBeenCalledTimes(2); expect(budget.snapshot().logical.repairCycles).toBe(1);
  for (const call of jest.mocked(completeJson).mock.calls) expect(call[1]?.maxTokens).toBe(2000);
  jest.mocked(completeJson).mockReset().mockResolvedValue(missing);
  expect((await assessGenerationQuality(args())).taskDemand?.status).toBe('withheld'); expect(completeJson).toHaveBeenCalledTimes(2);
});

it('refuses unknown selectors, dimensions and non-v2 use before completion', async () => {
  expect(() => taskDemandEnabled({ ...requirements, taskDemandProtocol: 'unknown' as never })).toThrow('generation-task-demand-protocol-invalid');
  await expect(assessGenerationQuality({ ...args(), requirements: { ...requirements, requestedKind: 'auto' as never } })).rejects.toThrow('generation-task-demand-request-invalid');
  await expect(assessGenerationQuality({ ...args(), policy: 'grounded-memory-v1' })).rejects.toThrow('generation-task-demand-policy-invalid');
  expect(completeJson).not.toHaveBeenCalled();
});

it('does not invent a fixed difficulty or numerical kind for freeform regeneration with only an intrinsic type target', async () => {
  const req: AuthoringRequirements = { ...requirements, intent: 'edit-existing', requestedDifficulty: undefined, requestedKind: undefined,
    requiredChanges: ['Change the task to a conceptual explanation.'] };
  jest.mocked(completeJson).mockResolvedValue({ ...wire('easy', demand({ verdict: 'fulfilled', missingOperation: '' })),
    changes: req.requiredChanges.map(requirement => ({ requirement, status: 'fulfilled', reason: 'The actual task is conceptual.' })) });
  const result = await assessGenerationQuality({ ...args(), requirements: req });
  expect(result.status).toBe('eligible'); expect(result.taskDemand?.requested).toEqual({ type: 'mcq' });
  expect(taskDemandPassed(result, req, snapshotQualityCandidate(candidate), packet)).toBe(true);
});

it('rejects stale, foreign or mutated demand receipts as repair instructions', async () => {
  const result = await assessGenerationQuality(args());
  for (const altered of [{ ...result, evidencePacketId: 'other' }, { ...result, candidate: { ...result.candidate!, contentHash: 'forged' } },
    { ...result, taskDemand: { ...result.taskDemand!, spanIds: ['S99'] } }, { ...result, taskDemand: { ...result.taskDemand!, requested: { difficulty: 'easy' as const } } }]) {
    expect(buildGenerationSemanticRepairPlan({ assessment: altered, requirements, packet, memory, candidate })).toBeUndefined();
  }
});

it('replans a source-supported missing operation without retiring fixed demand or any teacher constraint', async () => {
  const planned = bindPlannedAuthoringTask(requirements, { concepts: ['Risk'], requiredInference: 'Recall the remaining risk.',
    solutionPath: ['Recall market risk.'], misconception: 'Confuse risk categories.', targetDifficulty: 'hard', passageIds: ['E1'], intent: 'create-independent-task' });
  jest.mocked(completeJson).mockResolvedValue({ ...wire(), changes: planned.requiredChanges.map(requirement => ({ requirement, status: 'fulfilled', reason: 'Synthetic observation.' })) });
  const result = await assessGenerationQuality({ ...args(), requirements: planned });
  const plan = buildGenerationSemanticRepairPlan({ assessment: result, requirements: planned, packet, memory, candidate });
  expect(plan?.strategy).toBe('replace-independent-task'); expect(plan?.requirements.plannedTask).toBeUndefined();
  expect(plan?.requirements.requiredChanges).toEqual(requirements.requiredChanges);
  expect(plan?.requirements).toMatchObject({ requestedDifficulty: 'hard', requestedKind: 'conceptual', requestedType: 'mcq', taskDemandProtocol: 'task-demand-v1' });
  expect(plan?.requirements.original?.contentHash).toBe(result.candidate?.contentHash);
});

it('preserves absent-selector historical prompt bytes and advisory mismatch behavior', async () => {
  const old = { ...requirements }; delete old.taskDemandProtocol;
  const review = wire(); delete (review as Partial<typeof review>).taskDemand; jest.mocked(completeJson).mockResolvedValue(review);
  expect((await assessGenerationQuality({ ...args(), requirements: old })).status).toBe('eligible');
  expect(authoringIntentInstruction(old)).not.toContain('Fixed requested demand');
  const selection = selectGenerationMemory(memory, { query: candidate.stem });
  expect(renderGenerationQualityReviewPrompt(packet, selection, candidate, [], old)).toBe(renderGenerationQualityReviewPrompt(packet, selection, candidate, [], { ...old, taskDemandProtocol: undefined }));
  // Actual retained R5 absent-selector regression: no new demand text/data.
  const row = retained.cases.find(c => c.id === 'P04')!;
  const legacy = renderGenerationQualityReviewPrompt(row.packet as GenerationEvidencePacket, selectGenerationMemory(row.memory as typeof memory, { query: row.candidate.stem }), { ...row.candidate, type: 'mcq' } as GenerationMemoryContent, [], row.requirements as AuthoringRequirements);
  expect(createHash('sha256').update(legacy).digest('hex')).toBe('6671c68bf0d52871f7b11d81443e01b8629c8fc91e3ec54fbff5ae50c60cf793');
});

it('retains exact P04 request, sources and Bank under a synthetic demand finding without claiming a new semantic review', async () => {
  const row = retained.cases.find(c => c.id === 'P04')!;
  const req: AuthoringRequirements = { ...row.requirements as AuthoringRequirements, taskDemandProtocol: 'task-demand-v1', requestedKind: 'conceptual', requestedType: 'mcq' };
  const review = { ...wire(), changes: req.requiredChanges.map(requirement => ({ requirement, status: 'fulfilled', reason: 'Synthetic structural finding.' })) };
  const original = JSON.stringify(row); jest.mocked(completeJson).mockResolvedValue(review);
  const result = await assessGenerationQuality({ ...args(), candidate: { ...row.candidate, type: 'mcq' } as GenerationMemoryContent,
    packet: row.packet as GenerationEvidencePacket, memory: row.memory as typeof memory, requirements: req });
  expect(result.status).toBe('withheld'); expect(result.taskDemand?.requested.difficulty).toBe('hard'); expect(JSON.stringify(row)).toBe(original);
});

it('spends one existing repair, keeps fixed Hard in the prompt, and independently rechecks all stages before new eligibility', async () => {
  const assessment = await assessGenerationQuality(args());
  const generated: GeneratorOutput = { ...candidate, stem: 'Which response distinguishes the taught risk rules when selecting a strategy?', difficulty: 'hard', hardnessMove: 'Distinguish both taught rules.',
    taskDescriptor: { concepts: ['Risk'], requiredInference: 'Distinguish both risk rules.', solutionPath: ['Distinguish the taught rules.'], misconception: 'Confusing risks.', targetDifficulty: 'hard', passageIds: ['E1'], intent: 'create-independent-task' } };
  const stages: string[] = [];
  const complete = jest.fn(async (_prompt: string, options?: Parameters<typeof completeJson>[1]) => {
    const stage = options?.usageContext?.stage ?? ''; stages.push(stage);
    if (stage === 'generation-repair') return generated;
    if (stage === 'validation-repair') return { roleAssessment: 'Synthetic keyed role check.' };
    if (stage === 'quality-review' && options?.maxTokens === 2000) return wire('hard', demand({ verdict: 'fulfilled', missingOperation: '', rationale: 'Synthetic operation fulfillment finding.' }));
    return { decision: 'pass', reasoning: 'Synthetic content check.' };
  }) as typeof completeJson;
  const result = await repairGenerationQualityCandidate({ type: 'mcq', loName: 'Risk', candidate: { ...candidate } as GeneratorOutput, assessment,
    requirements, packet, memory, difficulty: requirements.requestedDifficulty, models: { embedding: 'none', generator: { model: 'g' }, validator: { model: 'v' }, reviewer: { model: 'r' } }, complete });
  expect(result?.quality.status).toBe('eligible'); expect(stages).toEqual(['generation-repair', 'validation-repair', 'review-repair', 'quality-review']);
  expect(jest.mocked(complete).mock.calls[0][0]).toContain('Requested task difficulty: hard');
  expect(result?.requirements).toEqual(requirements); expect(result?.quality.semanticRepair?.outcome).toBe('eligible');
});

it.each(['persistent-mismatch', 'no-op'] as const)('retains %s after one repair without a second corrective loop or forced acceptance', async outcome => {
  const assessment = await assessGenerationQuality(args());
  const generated: GeneratorOutput = { ...candidate, ...(outcome === 'no-op' ? {} : { stem: 'Which taught risk remains after portfolio diversification?' }),
    difficulty: 'hard', hardnessMove: 'Declared move does not prove achieved difficulty.',
    taskDescriptor: { concepts: ['Risk'], requiredInference: 'Recall the remaining risk.', solutionPath: ['Recall risk.'], misconception: 'Confusing risks.', targetDifficulty: 'hard', passageIds: ['E1'], intent: 'create-independent-task' } };
  const complete = jest.fn(async (_prompt: string, options?: Parameters<typeof completeJson>[1]) => options?.usageContext?.stage === 'generation-repair' ? generated
    : options?.usageContext?.stage === 'validation-repair' ? { roleAssessment: 'Synthetic roles.' }
      : options?.usageContext?.stage === 'review-repair' ? { decision: 'pass', reasoning: 'Source-sound question; demand checked separately.' } : wire()) as typeof completeJson;
  const input = { type: 'mcq' as const, loName: 'Risk', candidate: { ...candidate } as GeneratorOutput, assessment,
    requirements, packet, memory, difficulty: requirements.requestedDifficulty, models: { embedding: 'none', generator: { model: 'g' }, validator: { model: 'v' }, reviewer: { model: 'r' } }, complete };
  const result = await repairGenerationQualityCandidate(input);
  expect(result?.quality.status).toBe('withheld'); expect(jest.mocked(complete).mock.calls).toHaveLength(outcome === 'no-op' ? 3 : 4);
  expect(result?.quality.semanticRepair?.outcome).toBe('withheld');
  expect(await repairGenerationQualityCandidate({ ...input, assessment: result!.quality, candidate: result!.generated })).toBeUndefined();
  expect(jest.mocked(complete).mock.calls).toHaveLength(outcome === 'no-op' ? 3 : 4);
});

it('keeps an exhausted existing repair allowance as an explicit stop without dispatch', async () => {
  const assessment = await assessGenerationQuality(args()); const complete = jest.fn() as typeof completeJson;
  const budget = new AuthoringBudget('demand-repair-spent', { maxSends: 8 }); budget.reserveLogical('repair-cycle');
  expect(await withAuthoringBudget(budget, () => repairGenerationQualityCandidate({ type: 'mcq', loName: 'Risk', candidate: { ...candidate } as GeneratorOutput,
    assessment, requirements, packet, memory, difficulty: 'hard', models: { embedding: 'none', generator: { model: 'g' }, validator: { model: 'v' }, reviewer: { model: 'r' } }, complete }))).toBeUndefined();
  expect(complete).not.toHaveBeenCalled(); expect(assessment.semanticRepair?.outcome).toBe('budget-stopped');
});
