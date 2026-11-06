jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({}));
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { completeJson } from '../../server/src/components/genai/llm';
import { answerabilityEnabled, answerabilityInstruction, answerabilityReviewSchema, evaluateAnswerability, type AnswerabilityReview } from '../../server/src/services/generation-answerability';
import { assessGenerationQuality, renderGenerationQualityReviewPrompt, reviewCorrectionInstructions } from '../../server/src/services/generation-quality.service';
import { selectGenerationMemory, type GenerationMemoryContent, type GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import { AuthoringBudget, withAuthoringBudget } from '../../server/src/services/authoring-budget.service';
import { buildGenerationSemanticRepairPlan } from '../../server/src/services/generation-semantic-repair';
import type { AuthoringRequirements } from '../../server/src/types/generation-quality';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';

const source = 'An event affecting all investments is market risk. Investors can mitigate market risk by diversifying across asset classes. Market risk cannot be diversified away. Diversification reduces firm-specific risk.';
const packet: GenerationEvidencePacket = { id: 'answerability-source', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2',
  courseId: '000000000000000000000003', loIds: ['lo'], sourceFingerprint: 'source-fingerprint', parsingProvenance: 'unrecorded',
  materials: [{ materialId: 'material', name: 'Synthetic source', contentHash: 'hash', revision: 1, activeRunId: null, chunkCount: 1, role: 'primary', loId: 'lo' }],
  passages: [{ id: 'E1', materialId: 'material', materialName: 'Synthetic source', chunkIndex: 0, start: 0, end: source.length, text: source, role: 'primary', loId: 'lo', selection: 'retrieved' }],
  coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: source.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [] };
const memory: GenerationMemorySnapshot = { entries: [], truncated: false, missingVersions: 0, snapshotDigest: 'memory', consistency: 'best-effort' };
const requirements: AuthoringRequirements = { intent: 'create-independent-task', requiredChanges: [], preserve: [], answerabilityProtocol: 'option-answerability-v1' };
const candidate: GenerationMemoryContent = { type: 'mcq', stem: 'Which risk affects all investments?', options: [
  { key: 'A', text: 'Market risk', role: 'correct', explanation: 'Market risk affects all investments.' },
  { key: 'B', text: 'Firm-specific risk', role: 'common-misconception', explanation: 'Market risk affects all investments.' },
  { key: 'C', text: 'Only one firm is affected', role: 'partially-correct', explanation: 'The stem says all investments.' },
  { key: 'D', text: 'No risk', role: 'clearly-wrong', explanation: 'The source identifies market risk.' },
] };
type Row = Extract<AnswerabilityReview, { kind: 'mcq' }>['options'][number];
const row = (key: string, verdict: Row['verdict'] = key === 'A' ? 'fully-correct' : 'not-fully-correct'): Row => ({ key, verdict,
  reason: 'Literal response assessed against the source and stated task.', spanIds: ['S1'],
  exclusionBasis: verdict === 'fully-correct' ? 'none' : verdict === 'undetermined' ? 'undetermined' : 'source-contradiction',
  exclusion: verdict === 'not-fully-correct' ? 'The source contradicts this literal response.' : '', stemQuote: '' });
const answer = (): Extract<AnswerabilityReview, { kind: 'mcq' }> => ({ kind: 'mcq', options: candidate.options.map(option => row(option.key)) });
const review = (answerability: unknown = answer()) => ({ sourceSupport: 'supported', notation: 'consistent', novelty: 'independent',
  reasons: ['The literal task is supported.'], citations: [{ kind: 'premise', claim: 'Risk scope', spanIds: ['S1'] }, { kind: 'solution', claim: 'Market risk', spanIds: ['S1'] }],
  taskComparisons: [], changes: [], invariants: [], achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [], answerability });
const args = () => ({ packet, memory, candidate, item: 0, step: { model: 'synthetic', reasoningEffort: 'none' as const }, policy: 'grounded-memory-v2' as const, requirements });
beforeEach(() => jest.mocked(completeJson).mockReset().mockResolvedValue(review()));

it('records a same-call unique literal answer without treating truthful corrective feedback as additional answers', async () => {
  const result = await assessGenerationQuality(args());
  expect(result).toMatchObject({ status: 'eligible', answerability: { protocol: 'option-answerability-v1', status: 'passed', keyedOptionKey: 'A', resolvedCorrectKey: 'A' } });
  expect(result.answerability?.kind === 'mcq' && result.answerability.options[1].citations[0].quote).toBe(source);
  expect(completeJson).toHaveBeenCalledTimes(1);
  expect(jest.mocked(completeJson).mock.calls[0][1]).toMatchObject({ maxTokens: 2000, usageContext: { stage: 'quality-review', item: 0 } });
});

it.each(['true', 'false'] as const)('derives the %s T/F answer from actual labels in either order and ignores corrective feedback as answer truth', truth => {
  for (const reversed of [false, true]) {
    const tf: GenerationMemoryContent = { type: 'true-false', stem: truth === 'true' ? 'Diversification reduces firm-specific risk.' : 'Diversification eliminates market risk.',
      options: [{ key: 'X', text: 'False', role: truth === 'false' ? 'correct' : 'common-misconception', explanation: 'Diversification reduces firm-specific risk.' },
        { key: 'Y', text: ' True ', role: truth === 'true' ? 'correct' : 'common-misconception', explanation: 'Diversification reduces firm-specific risk.' }] };
    if (reversed) tf.options.reverse();
    expect(evaluateAnswerability({ kind: 'true-false', stemTruth: truth, reason: 'The whole proposition is judged, not the feedback.', spanIds: ['S1'] }, tf, packet).assessment)
      .toMatchObject({ status: 'passed', resolvedCorrectKey: truth === 'true' ? 'Y' : 'X' });
  }
});

it('states the exact string enum in every explicit T/F prompt and the existing response correction', () => {
  const tf = { ...candidate, type: 'true-false' as const, options: [
    { key: 'A', text: 'True', role: 'correct' as const, explanation: 'Feedback is not a separate proposition.' },
    { key: 'B', text: 'False', role: 'common-misconception' as const, explanation: 'The True choice is supported.' },
  ] };
  const selected = selectGenerationMemory(memory, { query: tf.stem });
  const prompts = [answerabilityInstruction(tf), ...[
    requirements,
    { ...requirements, taskDemandProtocol: 'task-demand-v1' as const },
    { ...requirements, taskDemandProtocol: 'task-demand-v1' as const, authoringPromptProtocol: 'compact-authoring-v1' as const },
  ].map(request => renderGenerationQualityReviewPrompt(packet, selected, tf, [], request))];
  for (const prompt of prompts) {
    expect(prompt).toContain('"true"|"false"|"undetermined"');
    expect(prompt).toContain('never JSON booleans');
    expect(prompt).not.toContain('stemTruth:true|false|undetermined');
  }
  for (const compact of [false, true]) {
    const correction = reviewCorrectionInstructions([{ path: 'answerability.stemTruth', code: 'invalid_type' }], compact);
    expect(correction).toContain('"true"|"false"|"undetermined"');
    expect(correction).toContain('never JSON booleans');
    expect(correction).toContain('Preserve the truth verdict');
  }
});

it('reproduces both actual TF enum failures and isolates a string-only repair without coercing historical raw outputs', () => {
  const retained = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/generation-tf-enum-retained.json'), 'utf8')) as {
    responses: Array<{ rawResponse: { answerability: { kind: 'true-false'; stemTruth: boolean; reason: string; spanIds: string[] } } }> };
  expect(retained.responses).toHaveLength(2);
  for (const { rawResponse } of retained.responses) {
    const before = JSON.stringify(rawResponse), raw = rawResponse.answerability;
    expect(typeof raw.stemTruth).toBe('boolean');
    const parsed = answerabilityReviewSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some(issue => issue.path.join('.') === 'stemTruth')).toBe(true);
    const typed = { ...raw, stemTruth: String(raw.stemTruth) };
    expect(answerabilityReviewSchema.safeParse(typed).success).toBe(true);
    expect({ ...typed, stemTruth: raw.stemTruth }).toEqual(raw);
    expect(JSON.stringify(rawResponse)).toBe(before);
  }
});

it('withholds T/F key disagreements, unknown whole propositions and ambiguous labels', () => {
  const tf: GenerationMemoryContent = { type: 'true-false', stem: 'Literal proposition.', options: [
    { key: 'A', text: 'True', role: 'correct', explanation: 'Feedback.' }, { key: 'B', text: 'False', role: 'common-misconception', explanation: 'Feedback.' }] };
  for (const stemTruth of ['false', 'undetermined']) expect(evaluateAnswerability({ kind: 'true-false', stemTruth, reason: 'Whole proposition.', spanIds: ['S1'] }, tf, packet).assessment.status).toBe('withheld');
  tf.options[1].text = 'True';
  expect(evaluateAnswerability({ kind: 'true-false', stemTruth: 'true', reason: 'Whole proposition.', spanIds: ['S1'] }, tf, packet).assessment.issues).toContainEqual({ path: 'answerability.candidate', code: 'true-false-labels-invalid' });
});

it('never treats a fully correct alternative as merely partly correct; partial answers require an actual explicit task condition', () => {
  const ambiguous = answer(); ambiguous.options[2] = row('C', 'fully-correct');
  expect(evaluateAnswerability(ambiguous, candidate, packet).assessment.issues).toContainEqual({ path: 'answerability.options', code: 'multiple-fully-correct-options' });
  const partial = answer(); partial.options[2] = { ...row('C'), exclusionBasis: 'incomplete-response', exclusion: 'Only one mechanism is given.', stemQuote: 'both taught mechanisms' };
  expect(evaluateAnswerability(partial, candidate, packet).assessment.status).toBe('withheld');
  expect(evaluateAnswerability(partial, { ...candidate, stem: 'Which response explains both taught mechanisms?' }, packet).assessment.status).toBe('passed');
});

it.each(['duplicate', 'missing', 'foreign', 'uncertain', 'inconsistent exclusion', 'missing source', 'foreign source', 'duplicate source', 'invented condition'])(
  'withholds %s rows with bounded diagnostic paths', kind => {
    const value = answer();
    if (kind === 'duplicate') value.options[1].key = 'A';
    if (kind === 'missing') value.options.pop();
    if (kind === 'foreign') value.options[1].key = 'Z';
    if (kind === 'uncertain') value.options[1] = { ...row('B', 'undetermined'), spanIds: [] };
    if (kind === 'inconsistent exclusion') value.options[1].exclusionBasis = 'none';
    if (kind === 'missing source') value.options[1].spanIds = [];
    if (kind === 'foreign source') value.options[1].spanIds = ['S999'];
    if (kind === 'duplicate source') value.options[1].spanIds = ['S1', 'S1'];
    if (kind === 'invented condition') value.options[1] = { ...row('B'), exclusionBasis: 'explicit-stem-condition', stemQuote: 'Only the exact table cell' };
    const result = evaluateAnswerability(value, candidate, packet);
    expect(result.assessment.status).toBe('withheld'); expect(result.findings).toEqual([expect.objectContaining({ kind: 'answer-semantics' })]);
    expect(JSON.stringify(result.assessment.issues)).not.toContain('Only the exact table cell');
  });

it('refuses damaged/out-of-scope answer evidence while retaining source-sound positives', () => {
  expect(evaluateAnswerability(answer(), candidate, { ...packet, findings: [{ code: 'source-text-damage', message: 'Damaged', passageIds: ['E1'] }] }).assessment.status).toBe('withheld');
  expect(evaluateAnswerability(answer(), candidate, { ...packet, materials: [{ ...packet.materials[0], role: 'secondary' }] }).assessment.status).toBe('withheld');
});

it.each(['protocol', 'status', 'resolvedCorrectKey', 'numericProof', 'sourceLocation'])('rejects model-authored %s fields instead of trusting server verdict/provenance', key => {
  expect(answerabilityReviewSchema.safeParse({ ...answer(), [key]: 'forged' }).success).toBe(false);
  const value = answer(); Object.assign(value.options[0], { [key]: 'forged' });
  expect(answerabilityReviewSchema.safeParse(value).success).toBe(false);
});

it('keeps semantic failures as failures without another review send and supplies a bounded repair finding', async () => {
  const value = answer(); value.options[2] = row('C', 'fully-correct'); jest.mocked(completeJson).mockResolvedValue(review(value));
  const result = await assessGenerationQuality(args());
  expect(result.status).toBe('withheld'); expect(result.findings).toEqual([expect.objectContaining({ kind: 'answer-semantics', status: 'defect', passageIds: ['E1'] })]);
  const plan = buildGenerationSemanticRepairPlan({ assessment: result, requirements, packet, memory, candidate });
  expect(plan?.strategy).toBe('correct-candidate'); expect(plan?.requirements.answerabilityProtocol).toBe('option-answerability-v1');
  expect(completeJson).toHaveBeenCalledTimes(1);
});

it('allows only the existing single schema correction and preserves its output cap/logical budget', async () => {
  const malformed = answer(); malformed.options[1].key = 'A';
  jest.mocked(completeJson).mockResolvedValueOnce(review(malformed)).mockResolvedValueOnce(review());
  const budget = new AuthoringBudget('answerability-fixture', { maxSends: 8 });
  expect((await withAuthoringBudget(budget, () => assessGenerationQuality(args()))).status).toBe('eligible');
  expect(completeJson).toHaveBeenCalledTimes(2); expect(budget.snapshot().logical.repairCycles).toBe(1);
  expect(jest.mocked(completeJson).mock.calls[1][0]).toContain('do not mark alternatives wrong');
  for (const call of jest.mocked(completeJson).mock.calls) expect(call[1]?.maxTokens).toBe(2000);
  jest.mocked(completeJson).mockReset().mockResolvedValue(review(malformed));
  expect((await assessGenerationQuality(args())).status).toBe('withheld'); expect(completeJson).toHaveBeenCalledTimes(2);
});

it('does not add a correction when the existing repair allowance has been consumed', async () => {
  const malformed = answer(); malformed.options[1].key = 'A'; jest.mocked(completeJson).mockResolvedValue(review(malformed));
  const budget = new AuthoringBudget('answerability-fixture', { maxSends: 8 }); budget.reserveLogical('repair-cycle');
  expect((await withAuthoringBudget(budget, () => assessGenerationQuality(args()))).status).toBe('withheld'); expect(completeJson).toHaveBeenCalledTimes(1);
});

it('refuses unknown explicit protocols and non-v2 use before any completion', async () => {
  expect(() => answerabilityEnabled({ ...requirements, answerabilityProtocol: 'unknown' as never })).toThrow('generation-answerability-protocol-invalid');
  await expect(assessGenerationQuality({ ...args(), requirements: { ...requirements, answerabilityProtocol: 'unknown' as never } })).rejects.toThrow('generation-answerability-protocol-invalid');
  await expect(assessGenerationQuality({ ...args(), policy: 'grounded-memory-v1' })).rejects.toThrow('generation-answerability-policy-invalid');
  expect(completeJson).not.toHaveBeenCalled();
});

it('does not impose the new schema or prompt on historical absent-selector v1/v2 reviews', async () => {
  const legacyReview = review(); delete (legacyReview as Partial<typeof legacyReview>).answerability;
  // Legacy copied-quote mode is deliberately retained when the selector is absent.
  const legacy = { sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: ['Supported.'],
    citations: [{ kind: 'premise', claim: 'Risk', passageId: 'E1', quote: source }, { kind: 'solution', claim: 'Answer', passageId: 'E1', quote: source }], matchedEntryIds: [] };
  const oldRequirements = { ...requirements }; delete oldRequirements.answerabilityProtocol;
  jest.mocked(completeJson).mockResolvedValue(legacyReview);
  expect((await assessGenerationQuality({ ...args(), requirements: oldRequirements })).status).toBe('eligible');
  expect(jest.mocked(completeJson).mock.calls[0][0]).not.toContain('ANSWERABILITY option-answerability-v1');
  jest.mocked(completeJson).mockResolvedValue(legacy);
  expect((await assessGenerationQuality({ ...args(), policy: 'grounded-memory-v1', requirements: undefined })).status).toBe('eligible');
  const selection = selectGenerationMemory(memory, { query: candidate.stem });
  expect(renderGenerationQualityReviewPrompt(packet, selection, candidate, [], oldRequirements)).toBe(renderGenerationQualityReviewPrompt(packet, selection, candidate, [], { ...oldRequirements, answerabilityProtocol: undefined }));
});

it('compacts only the explicit new header and retains exact historical baseline/v1/v2 bytes and all data payloads', () => {
  const retained = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/generation-answerability-retained.json'), 'utf8')) as {
    cases: Array<{ id: 'P01' | 'P04'; type: 'mcq'; candidate: GenerationMemoryContent; packet: GenerationEvidencePacket; memory: GenerationMemorySnapshot; requirements: AuthoringRequirements }> };
  const historical = {
    P01: { v2: 'b64ae6665fa477b85992b176e74157516498d8ffdc44539b1262937c883328f8', v1: '67f68f53a5141127360e8c891c2e705ec36f2af9e18208d554212646abca866a' },
    P04: { v2: '6671c68bf0d52871f7b11d81443e01b8629c8fc91e3ec54fbff5ae50c60cf793', v1: '7b7ede940b5581d28b931fb938198faadabf9b5a61304d83ef0ba2be4293ef85' },
  };
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  for (const control of retained.cases) {
    const content = { ...control.candidate, type: control.type };
    const oldRequirements = { ...control.requirements }; delete oldRequirements.answerabilityProtocol;
    const query = `${content.stem} ${content.options.filter(option => option.role === 'correct').map(option => `${option.text} ${option.explanation}`).join(' ')}`;
    const selected = selectGenerationMemory(control.memory, { query });
    const legacyV2 = renderGenerationQualityReviewPrompt(control.packet, selected, content, [], oldRequirements);
    const legacyBaselineOrV1 = renderGenerationQualityReviewPrompt(control.packet, selected, content, []);
    expect(sha(legacyV2)).toBe(historical[control.id].v2);
    expect(sha(legacyBaselineOrV1)).toBe(historical[control.id].v1);
    const current = renderGenerationQualityReviewPrompt(control.packet, selected, content, [], { ...oldRequirements, answerabilityProtocol: 'option-answerability-v1' });
    expect(current.split('AUTHORING POLICY:')[1]).toBe(legacyV2.split('AUTHORING POLICY:')[1]);
    expect(current).toContain('all4 actual keys exactly once');
    expect(current).toContain('Duplicate/variant needs a valid M row with both true');
    expect(current).toContain('Supported needs premise+solution+primary citations');
    expect(current).toContain('one row per exact required text');
    expect(current).toContain('Unproven exclusions stay undetermined');
  }
});

it('accepts the known copied-quote v2 form with opt-in rows and keeps the legacy citation fields unchanged', async () => {
  const response = { ...review(), matchedEntryIds: [], citations: [{ kind: 'premise', claim: 'Risk', passageId: 'E1', quote: source }, { kind: 'solution', claim: 'Answer', passageId: 'E1', quote: source }] };
  delete (response as Partial<typeof response>).taskComparisons;
  jest.mocked(completeJson).mockResolvedValue(response);
  expect(await assessGenerationQuality(args())).toMatchObject({ status: 'eligible', answerability: { status: 'passed' } });
  expect(completeJson).toHaveBeenCalledTimes(1);
});

it('bounds the type-specific prompt increment within the retained P02 conservative input margin', () => {
  const selection = selectGenerationMemory(memory, { query: candidate.stem });
  const historical = { ...requirements }; delete historical.answerabilityProtocol;
  for (const type of ['mcq', 'true-false'] as const) {
    const question = { ...candidate, type };
    const oldPrompt = renderGenerationQualityReviewPrompt(packet, selection, question, [], historical);
    const newPrompt = renderGenerationQualityReviewPrompt(packet, selection, question, [], requirements);
    const increment = Buffer.byteLength(newPrompt) - Buffer.byteLength(oldPrompt);
    // New schema prose may be smaller after instruction compaction; only the
    // bounded cost increase and preserved literal-answer obligations matter.
    expect(increment).toBeLessThanOrEqual(1512);
    expect(newPrompt).toContain('Formal numerical proof stays separate');
  }
});

it('never lets answerability override source, novelty, teacher requirements or missing premises', async () => {
  for (const patch of [{ sourceSupport: 'unsupported' }, { novelty: 'uncertain' }, { missingPremises: ['Required premise.'] }, { justifiedLength: 'excessive' }]) {
    jest.mocked(completeJson).mockResolvedValue({ ...review(), ...patch });
    expect(await assessGenerationQuality(args())).toMatchObject({ status: 'withheld', answerability: { status: 'passed' } });
  }
  jest.mocked(completeJson).mockResolvedValue(review());
  expect((await assessGenerationQuality({ ...args(), requirements: { ...requirements, requiredChanges: ['Keep teacher constraint.'] } })).status).toBe('withheld');
});

it('retains exact P01/P04 candidate/source inputs while demonstrating only synthetic withholding mechanics', () => {
  const retained = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/generation-answerability-retained.json'), 'utf8')) as {
    sourceControlsSha256: string; cases: Array<{ id: string; type: 'mcq'; candidate: GenerationMemoryContent; packet: GenerationEvidencePacket }> };
  expect(retained.sourceControlsSha256).toBe('486d151093e76bf2bed8b2a869c8f9484a9349cbb5994b1008d0c6eef1cc0bd5');
  for (const control of retained.cases) {
    const fixed = { ...control.candidate, type: control.type };
    if (control.id === 'P01') {
      const value = { kind: 'mcq' as const, options: fixed.options.map(option => ({ ...row(option.key, ['A', 'C'].includes(option.key) ? 'fully-correct' : 'not-fully-correct'), spanIds: option.key === 'A' ? ['S3', 'S4'] : ['S1', 'S5'] })) };
      expect(evaluateAnswerability(value, fixed, control.packet).assessment.issues.some(issue => issue.code === 'multiple-fully-correct-options')).toBe(true);
    } else {
      const value = { kind: 'mcq' as const, options: fixed.options.map(option => ({ ...row(option.key, option.key === 'B' ? 'fully-correct' : option.key === 'A' ? 'undetermined' : 'not-fully-correct'), spanIds: option.key === 'A' ? [] : option.key === 'D' ? ['S1'] : ['S5', 'S6'] })) };
      expect(evaluateAnswerability(value, fixed, control.packet).assessment.issues.some(issue => issue.code === 'answer-option-undetermined')).toBe(true);
    }
    expect(fixed.options.find(option => option.role === 'correct')?.key).toBe(control.id === 'P01' ? 'C' : 'B');
  }
  // This identity pins the retained portable fixture, not a model semantic result.
  expect(createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'fixtures/generation-answerability-retained.json'))).digest('hex')).toBe('c038224179f0cfecfd9c6bf2c39fa3de4826f191c9d0c3d59d3b4fc2d626067b');
});
