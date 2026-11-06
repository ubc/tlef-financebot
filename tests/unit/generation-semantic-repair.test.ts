jest.mock('../../server/src/config/env', () => ({ env: { llmModelGenerator: 'generator', llmModelValidator: 'validator', llmModelReviewer: 'reviewer' } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));

import { completeJson } from '../../server/src/components/genai/llm';
import { bindPlannedAuthoringTask, buildGenerationSemanticRepairPlan } from '../../server/src/services/generation-semantic-repair';
import { assessGenerationQuality, snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { repairGenerationQualityCandidate, type GeneratorOutput } from '../../server/src/services/generation.service';
import { AuthoringBudget, withAuthoringBudget } from '../../server/src/services/authoring-budget.service';
import { withBatchGenerationMemory } from '../../server/src/services/generation-memory.service';
import type { GenerationMemoryContent, GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import { evaluateAnswerability, type AnswerabilityReview } from '../../server/src/services/generation-answerability';
import retained from './fixtures/generation-answerability-retained.json';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { AuthoringRequirements, GenerationQualityAssessment, GenerationValidationFinding } from '../../server/src/types/generation-quality';

const source = 'INVESTORS: diversify across companies. FIRMS: diversify across sectors and countries. Diversification reduces firm-specific risk; market risk remains.';
const materialId = '000000000000000000000001'; const loId = '000000000000000000000002';
const packet: GenerationEvidencePacket = {
  id: 'frozen-original', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2', courseId: '000000000000000000000003', loIds: [loId],
  sourceFingerprint: 'original-bytes', parsingProvenance: 'unrecorded',
  materials: [{ materialId, loId, role: 'primary', name: 'Risk.pdf', contentHash: 'original-hash', revision: 1, activeRunId: null, chunkCount: 1 }],
  passages: [{ id: 'E1', materialId, loId, role: 'primary', materialName: 'Risk.pdf', chunkIndex: 0, start: 0, end: source.length, text: source, selection: 'retrieved' }],
  coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: source.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [],
};
const memory = { entries: [], snapshotDigest: 'starting-bank', truncated: false, missingVersions: 0, consistency: 'best-effort' as const };
const requirements: AuthoringRequirements = { intent: 'create-independent-task', requiredChanges: ['Ask an independent source-supported risk task.'], preserve: [], requestedDifficulty: 'easy' };
const descriptor = { concepts: ['Diversification'], requiredInference: 'Identify the investor action taught by the table.', solutionPath: ['Read the investor row.', 'Match the actor to its action.'], misconception: 'Transfer firm strategies to investors.', targetDifficulty: 'easy' as const, passageIds: ['E1'], intent: 'create-independent-task' as const };
const before: GeneratorOutput = { stem: 'Which action do the notes assign to investors?', difficulty: 'easy', numericKind: 'conceptual', taskDescriptor: descriptor,
  options: [
    { key: 'A', text: 'Diversify across sectors and countries.', role: 'correct', explanation: 'The investor row gives these actions.' },
    { key: 'B', text: 'Diversify across companies.', role: 'common-misconception', explanation: 'This is the firm strategy.' },
    { key: 'C', text: 'Retain only market risk.', role: 'partially-correct', explanation: 'Market risk remains, but that is not the action.' },
    { key: 'D', text: 'Eliminate every risk.', role: 'clearly-wrong', explanation: 'Market risk remains.' },
  ] };
const corrected: GeneratorOutput = { ...before, options: before.options.map(option => option.key === 'A' ? { ...option, text: 'Diversify across companies.', explanation: 'The investor row assigns diversification across companies.' }
  : option.key === 'B' ? { ...option, text: 'Diversify across sectors and countries.', explanation: 'The firm row assigns these strategies, not the investor row.' } : option) };
const finding: GenerationValidationFinding = { kind: 'actor-relation', target: 'options', status: 'defect', observation: 'The keyed answer transfers the FIRMS row to INVESTORS.',
  correction: 'Keep the investor task; use diversification across companies as the correct action and correct the swapped explanations.', passageIds: ['E1'], memoryEntryIds: [] };
function withheld(): GenerationQualityAssessment {
  return { policy: 'grounded-memory-v2', item: 0, status: 'withheld', sourceSupport: 'unsupported', notation: 'consistent', novelty: 'independent', reasons: [finding.observation], citations: [], matchedEntryIds: [],
    comparedEntryIds: [], evidencePacketId: packet.id, memoryDigest: memory.snapshotDigest, checkedAt: new Date(0), findings: [finding],
    coverage: { evidenceTruncated: false, memoryTruncated: false, shownEntries: 0, totalEntries: 0, missingVersions: 0, consistency: 'best-effort' } };
}
function wireReview(fault = false) {
  return { sourceSupport: fault ? 'unsupported' : 'supported', notation: 'consistent', novelty: 'independent', reasons: [fault ? finding.observation : 'The keyed answer now matches the investor row.'],
    citations: [{ kind: 'premise', claim: 'Investors diversify across companies.', spanIds: ['S1'] }, { kind: 'solution', claim: 'Firms diversify across sectors and countries.', spanIds: ['S1'] }], taskComparisons: [],
    changes: requirements.requiredChanges.map(requirement => ({ requirement, status: 'fulfilled', reason: 'The actual question tests a source-supported actor relation.' })), invariants: [], achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [],
    findings: fault ? [{ ...finding, passageIds: undefined, memoryEntryIds: [], sourceSpanIds: ['S1'] }].map(({ passageIds: _unused, ...value }) => value) : [],
  };
}
const models = { embedding: 'embedding', generator: { model: 'generator' }, validator: { model: 'validator' }, reviewer: { model: 'reviewer' } };
const repairArgs = () => ({ loName: 'Diversification', type: 'mcq' as const, candidate: structuredClone(before), assessment: withheld(), requirements, packet, memory, models, difficulty: 'easy' as const });

beforeEach(() => jest.mocked(completeJson).mockReset());

it('creates an actionable actor-row correction only from intact frozen source references', () => {
  const plan = buildGenerationSemanticRepairPlan({ ...repairArgs(), candidate: { ...before, type: 'mcq' } });
  expect(plan).toMatchObject({ strategy: 'correct-candidate', requirements, findings: [finding] });
  expect(plan!.critique).toContain('sourceSpanIds'); expect(plan!.critique).toContain('S1'); expect(plan!.critique).toContain('never as permission to broaden');
  const uncertain = withheld(); uncertain.sourceSupport = 'uncertain'; uncertain.findings![0] = { ...finding, status: 'uncertain', correction: '' };
  expect(buildGenerationSemanticRepairPlan({ ...repairArgs(), candidate: { ...before, type: 'mcq' }, assessment: uncertain })).toBeUndefined();
  const damaged = { ...packet, findings: [{ code: 'source-text-damage' as const, message: 'Unreadable row boundaries.', passageIds: ['E1'] }] };
  expect(buildGenerationSemanticRepairPlan({ ...repairArgs(), candidate: { ...before, type: 'mcq' }, packet: damaged })).toBeUndefined();
  const unknown = withheld(); unknown.findings = [{ ...finding, passageIds: ['another-course:E1'] }];
  expect(buildGenerationSemanticRepairPlan({ ...repairArgs(), candidate: { ...before, type: 'mcq' }, assessment: unknown })).toBeUndefined();
});

it('derives current source references from structured findings and withholds a contradictory positive verdict', async () => {
  const input = repairArgs();
  jest.mocked(completeJson).mockResolvedValue({ ...wireReview(true), sourceSupport: 'supported' });
  const result = await assessGenerationQuality({ ...input, candidate: { ...before, type: 'mcq' }, item: 0, step: models.reviewer, policy: 'grounded-memory-v2' });
  expect(result).toMatchObject({ status: 'withheld', findings: [finding] });
  expect(result.reasons.join(' ')).toContain('unresolved defects');
});

it('rejects actionable findings with unknown source or Bank aliases without fabricating a correction', async () => {
  const input = repairArgs(); const invalid = wireReview(true); invalid.findings![0].sourceSpanIds = ['S99'];
  jest.mocked(completeJson).mockResolvedValue(invalid);
  const result = await assessGenerationQuality({ ...input, candidate: { ...before, type: 'mcq' }, item: 0, step: models.reviewer, policy: 'grounded-memory-v2' });
  expect(result).toMatchObject({ status: 'withheld', sourceSupport: 'uncertain', findings: [] });
  expect(result.responseIssues).toContainEqual({ attempt: 1, path: 'findings.0', code: 'finding-reference-invalid' });
  expect(buildGenerationSemanticRepairPlan({ ...input, assessment: result, candidate: { ...before, type: 'mcq' } })).toBeUndefined();
});

it('retains the original and corrected exact candidate while rerunning all checks once under the same budget', async () => {
  const input = repairArgs(); const exactOriginal = JSON.stringify(input.candidate);
  const stages: string[] = []; const complete = jest.fn(async (_prompt: string, options?: Parameters<typeof completeJson>[1]) => {
    stages.push(options?.usageContext?.stage ?? 'unknown');
    if (options?.usageContext?.stage === 'generation-repair') return corrected;
    if (options?.usageContext?.stage === 'validation-repair') return { roleAssessment: 'All four corrected options match their declared roles and source actor rows.' };
    if (options?.usageContext?.stage === 'review-repair') return { decision: 'pass', reasoning: 'The corrected answer matches the investor row.' };
    return wireReview();
  }) as typeof completeJson;
  const budget = new AuthoringBudget('same-frozen-candidate'); budget.reserveLogical('generator-attempt');
  const result = await withAuthoringBudget(budget, () => repairGenerationQualityCandidate({ ...input, complete }));
  expect(result?.quality.status).toBe('eligible');
  expect(stages).toEqual(['generation-repair', 'validation-repair', 'review-repair', 'quality-review']);
  expect(JSON.stringify(input.candidate)).toBe(exactOriginal);
  expect(result?.quality.semanticRepair).toMatchObject({ version: 1, outcome: 'eligible', before: snapshotQualityCandidate({ ...before, type: 'mcq' }), after: snapshotQualityCandidate({ ...result!.generated, type: 'mcq' }), findingsBefore: [finding] });
  expect(result!.quality.semanticRepair!.before.contentHash).not.toBe(result!.quality.semanticRepair!.after!.contentHash);
  expect(budget.snapshot().logical).toMatchObject({ generatorAttempts: 2, repairCycles: 1, evidenceExpansions: 0 });
  expect(completeJson).not.toHaveBeenCalled();
});

it('does not turn another failed semantic assessment into acceptance or launch a repair loop', async () => {
  const complete = jest.fn(async (_prompt: string, options?: Parameters<typeof completeJson>[1]) => options?.usageContext?.stage === 'generation-repair' ? corrected
    : options?.usageContext?.stage === 'validation-repair' ? { roleAssessment: 'Roles inspected.' }
      : options?.usageContext?.stage === 'review-repair' ? { decision: 'pass', reasoning: 'Reviewer alone is not source proof.' } : wireReview(true)) as typeof completeJson;
  const input = repairArgs(); const budget = new AuthoringBudget('still-wrong'); budget.reserveLogical('generator-attempt');
  const first = await withAuthoringBudget(budget, () => repairGenerationQualityCandidate({ ...input, complete }));
  expect(first?.quality).toMatchObject({ status: 'withheld', semanticRepair: { outcome: 'withheld' } });
  await withAuthoringBudget(budget, () => repairGenerationQualityCandidate({ ...input, candidate: first!.generated, assessment: first!.quality, complete }));
  expect(complete).toHaveBeenCalledTimes(4); expect(first!.quality.semanticRepair!.outcome).toBe('withheld');
});

it('withholds a no-op correction before another source-judge send, ignoring automatic answer shuffling', async () => {
  const complete = jest.fn(async (_prompt: string, options?: Parameters<typeof completeJson>[1]) => options?.usageContext?.stage === 'generation-repair' ? before
    : options?.usageContext?.stage === 'validation-repair' ? { roleAssessment: 'Inspected.' } : { decision: 'pass', reasoning: 'An optimistic Reviewer cannot waive an unchanged defect.' }) as typeof completeJson;
  const result = await repairGenerationQualityCandidate({ ...repairArgs(), complete });
  expect(result?.quality).toMatchObject({ status: 'withheld', semanticRepair: { outcome: 'withheld' } });
  expect(result?.quality.reasons[0]).toContain('unchanged question content'); expect(complete).toHaveBeenCalledTimes(3);
});

it('preserves budget/cancellation failures and never dispatches content repair when the shared cycle is spent', async () => {
  const input = repairArgs(); const budget = new AuthoringBudget('spent-cycle'); budget.reserveLogical('repair-cycle');
  expect(await withAuthoringBudget(budget, () => repairGenerationQualityCandidate(input))).toBeUndefined();
  expect(input.assessment.semanticRepair?.outcome).toBe('budget-stopped'); expect(completeJson).not.toHaveBeenCalled();
  const cancelled = new Error('revoked-teacher-authorization');
  await expect(repairGenerationQualityCandidate({ ...repairArgs(), beforeRequest: async () => { throw cancelled; } })).rejects.toBe(cancelled);
  expect(completeJson).not.toHaveBeenCalled();
});

it('uses Bank identities for duplicate replacement while preserving original edit/variant intent', () => {
  const bank = withBatchGenerationMemory(memory, [{ id: 'batch:frozen:0', content: { ...before, type: 'mcq' } }]);
  const duplicate = { ...withheld(), sourceSupport: 'supported' as const, novelty: 'duplicate' as const, findings: [], matchedEntryIds: ['batch:frozen:0'] };
  const plan = buildGenerationSemanticRepairPlan({ ...repairArgs(), memory: bank, assessment: duplicate, candidate: { ...before, type: 'mcq' } });
  expect(plan?.strategy).toBe('replace-independent-task'); expect(plan?.requirements.original?.contentHash).toBe(snapshotQualityCandidate({ ...before, type: 'mcq' }).contentHash);
  for (const intent of ['edit-existing', 'create-variant'] as const) expect(buildGenerationSemanticRepairPlan({ ...repairArgs(), memory: bank, assessment: duplicate,
    requirements: { ...requirements, intent }, candidate: { ...before, type: 'mcq' } })).toBeUndefined();
  expect(buildGenerationSemanticRepairPlan({ ...repairArgs(), memory: bank, assessment: { ...duplicate, matchedEntryIds: ['source:E1'] }, candidate: { ...before, type: 'mcq' } })).toBeUndefined();
});

it('retires only the server-planned inference when replacing a duplicate task, preserving all teacher constraints', () => {
  const bank = withBatchGenerationMemory(memory, [{ id: 'batch:frozen:0', content: { ...before, type: 'mcq' } }]);
  const duplicate = { ...withheld(), sourceSupport: 'supported' as const, novelty: 'duplicate' as const, findings: [], matchedEntryIds: ['batch:frozen:0'] };
  const teacher = { ...requirements, requiredChanges: ['Use only the provided lecture material.', 'Avoid mathematical calculations.'], preserve: ['Keep the lecture notation.'] };
  const planned = bindPlannedAuthoringTask(teacher, descriptor);
  duplicate.changes = [{ requirement: planned.plannedInferenceRequirement!, status: 'unfulfilled', reason: 'Old planned task was not used.' }];
  const frozen = JSON.stringify(planned);
  const plan = buildGenerationSemanticRepairPlan({ ...repairArgs(), memory: bank, assessment: duplicate, requirements: planned, candidate: { ...before, type: 'mcq' } })!;
  expect(plan.strategy).toBe('replace-independent-task');
  expect(plan.requirements.requiredChanges).toEqual(teacher.requiredChanges);
  expect(plan.requirements.preserve).toEqual(teacher.preserve);
  expect(plan.requirements.plannedTask).toBeUndefined(); expect(plan.requirements.plannedInferenceRequirement).toBeUndefined();
  expect(plan.requirements.original?.contentHash).toBe(snapshotQualityCandidate({ ...before, type: 'mcq' }).contentHash);
  expect(plan.critique).not.toContain('Unfulfilled change: Implement the planned inference:');
  expect(JSON.stringify(planned)).toBe(frozen);
});

it('does not drop unlabelled historical or similarly worded teacher requirements', () => {
  const bank = withBatchGenerationMemory(memory, [{ id: 'batch:frozen:0', content: { ...before, type: 'mcq' } }]);
  const duplicate = { ...withheld(), sourceSupport: 'supported' as const, novelty: 'duplicate' as const, findings: [], matchedEntryIds: ['batch:frozen:0'] };
  const exactText = `Implement the planned inference: ${descriptor.requiredInference}`;
  const teacher = { ...requirements, requiredChanges: [exactText] };
  const marked = bindPlannedAuthoringTask(teacher, descriptor);
  const plan = (req: AuthoringRequirements) => buildGenerationSemanticRepairPlan({ ...repairArgs(), memory: bank, assessment: duplicate, requirements: req, candidate: { ...before, type: 'mcq' } })!;
  expect(plan(marked).requirements.requiredChanges).toEqual([exactText]);
  expect(plan({ ...marked, plannedInferenceRequirement: undefined }).requirements.requiredChanges).toEqual([exactText, exactText]);
  expect(plan({ ...marked, plannedInferenceRequirement: 'Different task' }).requirements.requiredChanges).toEqual([exactText, exactText]);
});

it('preserves the planned inference when correcting the answer of the same task', () => {
  const planned = bindPlannedAuthoringTask(requirements, descriptor);
  const plan = buildGenerationSemanticRepairPlan({ ...repairArgs(), requirements: planned, candidate: { ...before, type: 'mcq' } })!;
  expect(plan.strategy).toBe('correct-candidate'); expect(plan.requirements).toEqual(planned);
});

it('sends the complete failed content once when duplicate replacement already carries that exact original', async () => {
  const bank = withBatchGenerationMemory(memory, [{ id: 'batch:frozen:0', content: { ...before, type: 'mcq' } }]);
  const duplicate = { ...withheld(), sourceSupport: 'supported' as const, novelty: 'duplicate' as const, findings: [], matchedEntryIds: ['batch:frozen:0'] };
  let sent = ''; const complete = jest.fn(async (prompt: string) => { sent = prompt; throw new Error('capture-only-stop'); }) as typeof completeJson;
  await repairGenerationQualityCandidate({ ...repairArgs(), memory: bank, assessment: duplicate, complete });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(sent).toContain('Original reference:');
  expect(sent).toContain('The failed candidate is the complete Original reference or pinned-original above');
  expect(sent).not.toContain('Failed candidate reference (untrusted data):');
  expect(sent.split('"explanation":"The investor row gives these actions."')).toHaveLength(2);
  expect(sent).toContain(source);
  expect(sent).toContain('BANK/QUEUE MEMORY ONLY');
});

it('retains separate failed content when the teacher original differs or was truncated', async () => {
  for (const original of [snapshotQualityCandidate({ ...corrected, type: 'mcq' }), { ...snapshotQualityCandidate({ ...before, type: 'mcq' }), truncated: true }]) {
    let sent = ''; const complete = jest.fn(async (prompt: string) => { sent = prompt; throw new Error('capture-only-stop'); }) as typeof completeJson;
    await repairGenerationQualityCandidate({ ...repairArgs(), requirements: { ...requirements, original }, complete });
    expect(sent).toContain(`Failed candidate reference (untrusted data): ${JSON.stringify(before)}`);
  }
});

function literalControl(id: 'P01' | 'P04') {
  const control = structuredClone(retained.cases.find(row => row.id === id)!);
  const candidate = { ...control.candidate, type: 'mcq' as const } as GenerationMemoryContent;
  const original = control.packet as GenerationEvidencePacket;
  const selectedRequirements = { ...control.requirements, answerabilityProtocol: 'option-answerability-v1' as const } as AuthoringRequirements;
  const selectedMemory = control.memory as unknown as GenerationMemorySnapshot;
  const literalRows = (content: GenerationMemoryContent): AnswerabilityReview => ({ kind: 'mcq', options: content.options.map(option => {
    const fullyCorrect = id === 'P01' ? option.text.includes('Market risk;') : option.role === 'correct';
    const uncertain = id === 'P04' && option.text === 'Diversify across countries.';
    return { key: option.key, verdict: fullyCorrect ? 'fully-correct' : uncertain ? 'undetermined' : 'not-fully-correct',
      reason: id === 'P01' && option.text.includes('mitigates it.') ? 'Mitigation and non-elimination can coexist; the table supports this mitigation claim.'
        : uncertain ? 'Table placement does not establish that country diversification cannot mitigate firm-specific risk.'
          : fullyCorrect ? 'This literal response is supported by the selected original.' : 'This literal response conflicts with the actual source/task.',
      exclusionBasis: fullyCorrect ? 'none' : uncertain ? 'undetermined' : 'source-contradiction',
      exclusion: fullyCorrect || uncertain ? '' : 'The literal response conflicts with the taught distinction.', stemQuote: '',
      spanIds: uncertain ? [] : id === 'P01' && option.text.includes('mitigates it.') ? ['S3', 'S4'] : id === 'P04' && option.role === 'correct' ? ['S6'] : ['S1'] };
  }) });
  const checked = evaluateAnswerability(literalRows(candidate), candidate, original);
  const assessment: GenerationQualityAssessment = { ...withheld(), sourceSupport: 'supported', evidencePacketId: original.id,
    memoryDigest: selectedMemory.snapshotDigest, candidate: snapshotQualityCandidate(candidate), answerability: checked.assessment, findings: checked.findings };
  return { candidate, packet: original, memory: selectedMemory, requirements: selectedRequirements, assessment, literalRows };
}

it('carries named P01 literal conflicts and exact S aliases into the existing repair, without repeating candidate/source bodies', () => {
  const input = literalControl('P01'); const frozen = JSON.stringify(input.assessment);
  const plan = buildGenerationSemanticRepairPlan(input)!;
  expect(plan.critique).toContain('LITERAL-ANSWER HYPOTHESES');
  expect(plan.critique).toContain('"key":"A","verdict":"fully-correct"');
  expect(plan.critique).toContain('"key":"C","verdict":"fully-correct"');
  expect(plan.critique).toContain('Mitigation and non-elimination can coexist');
  expect(plan.critique).toContain('"spanIds":["S3","S4"]');
  expect(plan.critique).not.toContain(input.candidate.stem);
  expect(plan.critique).not.toContain(input.packet.passages[0].text);
  expect(plan.requirements).toBe(input.requirements); expect(JSON.stringify(input.assessment)).toBe(frozen);
});

it('preserves P04 uncertainty-only no-repair and includes its named unresolved row only alongside an independently actionable defect', () => {
  const input = literalControl('P04');
  expect(buildGenerationSemanticRepairPlan(input)).toBeUndefined();
  input.assessment.changes = [{ requirement: input.requirements.requiredChanges[0], status: 'unfulfilled', reason: 'Synthetic independent teacher-clause failure; not a new observed model outcome.' }];
  const plan = buildGenerationSemanticRepairPlan(input)!;
  expect(plan.critique).toContain('"key":"A","verdict":"undetermined"');
  expect(plan.critique).toContain('Table placement does not establish');
  expect(plan.critique).toContain('Preserve uncertainty; never invent an exclusivity restriction');
  expect(plan.critique).toContain('"key":"B","verdict":"fully-correct"');
  expect(plan.requirements.requiredChanges).toEqual(input.requirements.requiredChanges);
});

it.each(['absent protocol', 'unknown protocol', 'foreign packet', 'changed candidate', 'changed stored candidate', 'foreign quote', 'foreign key', 'stale row reason', 'derived-key tamper', 'malformed rows'])(
  'does not inject a literal-answer brief from %s receipts', change => {
    const input = literalControl('P01'); const answer = input.assessment.answerability!;
    if (change === 'absent protocol') delete input.requirements.answerabilityProtocol;
    if (change === 'unknown protocol') answer.protocol = 'unknown' as never;
    if (change === 'foreign packet') input.assessment.evidencePacketId = 'another-packet';
    if (change === 'changed candidate') input.candidate.stem += ' Changed task.';
    if (change === 'changed stored candidate') input.assessment.candidate!.stem += ' Changed retained body with unchanged hash.';
    if (change === 'derived-key tamper') answer.resolvedCorrectKey = 'D';
    if (answer.kind !== 'mcq') throw new Error('Expected fixed MCQ control.');
    if (change === 'foreign quote') answer.options[0].citations[0].quote = 'Unrecorded original quotation.';
    if (change === 'foreign key') answer.options[0].key = 'Z';
    if (change === 'stale row reason') answer.options[0].reason = 'Changed reason without matching frozen citation claim.';
    if (change === 'malformed rows') answer.options = [null] as never;
    expect(buildGenerationSemanticRepairPlan(input)?.critique ?? '').not.toContain('LITERAL-ANSWER HYPOTHESES');
  });

it('keeps literal detail prioritized and the entire new-protocol critique within 4500 characters', () => {
  const input = literalControl('P01');
  input.assessment.findings!.push(...Array.from({ length: 6 }, () => ({ ...finding, observation: 'An independently actionable finding. '.repeat(8).slice(0, 300),
    correction: 'A bounded source-supported correction. '.repeat(8).slice(0, 300), passageIds: [input.packet.passages[0].id] })));
  const plan = buildGenerationSemanticRepairPlan(input)!;
  expect(plan.critique.length).toBeLessThanOrEqual(4500);
  expect(plan.critique).toContain('"key":"A","verdict":"fully-correct"');
  expect(plan.critique).toContain('"key":"C","verdict":"fully-correct"');
  expect(plan.critique).toContain('omitted findings are not waived');
});

it.each([false, true])('retains no-op and still-withheld fresh checks under the new protocol (no-op: %s)', async noOp => {
  const input = literalControl('P01');
  const sent: string[] = [];
  const complete = jest.fn(async (prompt: string, options?: Parameters<typeof completeJson>[1]) => {
    sent.push(options?.usageContext?.stage ?? 'unknown');
    if (options?.usageContext?.stage === 'generation-repair') return { ...input.candidate, ...(noOp ? {} : { stem: `${input.candidate.stem} Use the stated distinction.` }) };
    if (options?.usageContext?.stage === 'validation-repair') return { roleAssessment: 'Synthetic role observation; no eligibility override.' };
    if (options?.usageContext?.stage === 'review-repair') return { decision: 'pass', reasoning: 'Synthetic Reviewer pass cannot waive the literal-answer defect.' };
    const current = JSON.parse(prompt.slice(prompt.lastIndexOf('CANDIDATE: ') + 'CANDIDATE: '.length)) as GenerationMemoryContent;
    return { sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: ['Synthetic same-input ambiguity remains.'],
      citations: [{ kind: 'premise', claim: 'Risk', spanIds: ['S3', 'S4'] }, { kind: 'solution', claim: 'Limit', spanIds: ['S1'] }],
      taskComparisons: [{ entryId: 'M1', sameInference: false, sameSolutionPath: false, contrast: 'Synthetic task comparison.' }],
      changes: input.requirements.requiredChanges.map(requirement => ({ requirement, status: 'fulfilled', reason: 'Synthetic check.' })), invariants: [],
      achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [], answerability: input.literalRows(current) };
  }) as typeof completeJson;
  const result = await repairGenerationQualityCandidate({ ...input, candidate: input.candidate as GeneratorOutput,
    loName: 'Risk', type: 'mcq', models, difficulty: 'easy', complete });
  expect(result?.quality).toMatchObject({ status: 'withheld', semanticRepair: { outcome: 'withheld' } });
  expect(sent).toEqual(noOp ? ['generation-repair', 'validation-repair', 'review-repair'] : ['generation-repair', 'validation-repair', 'review-repair', 'quality-review']);
  expect(completeJson).not.toHaveBeenCalled();
  await repairGenerationQualityCandidate({ ...input, candidate: result!.generated, assessment: result!.quality, loName: 'Risk', type: 'mcq', models, difficulty: 'easy', complete });
  expect(sent.length).toBe(noOp ? 3 : 4);
});
