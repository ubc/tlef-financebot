// Actual quality-wrapper/parser/BSON integration. Every semantic verdict is
// scripted; this file establishes no provider behavior or useful saved yield.
jest.mock('../../server/src/config/env', () => ({ env: { llmModelGenerator: 'scripted', llmModelValidator: 'scripted', llmModelReviewer: 'scripted' } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => new Proxy({}, { get: () => () => { throw new Error('database denied'); } }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn(() => { throw new Error('embedding denied'); }) }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn(() => { throw new Error('vector denied'); }) }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn(() => { throw new Error('queue denied'); }) }));
jest.mock('../../server/src/components/param-worker', () => ({ executeGenerate: jest.fn(() => { throw new Error('worker denied'); }) }));

import { BSON } from 'mongodb';
import retained from '../fixtures/generation-quality/retained-review-size-2026-10-17.json';
import { completeJson } from '../../server/src/components/genai/llm';
import { assessGenerationQuality, renderGenerationQualityReviewPrompt, renderExclusionReviewCorrectionIssues, snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { EXCLUSION_REVIEW_PROTOCOL, exclusionReviewReceiptMatches, type ExclusionReview } from '../../server/src/services/generation-exclusion-review';
import { selectGenerationMemory, contentFingerprint, type GenerationMemoryContent, type GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import { AuthoringBudget, withAuthoringBudget } from '../../server/src/services/authoring-budget.service';
import { buildGenerationSemanticRepairPlan } from '../../server/src/services/generation-semantic-repair';
import type { AuthoringRequirements } from '../../server/src/types/generation-quality';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';

function example(id = 'P02') {
  const row = structuredClone(retained.cases.find(value => value.id === id)!);
  const candidate = { ...row.candidate, type: row.type } as GenerationMemoryContent;
  const packet = row.packet as GenerationEvidencePacket;
  const memory: GenerationMemorySnapshot = { entries: [], truncated: false, missingVersions: 0, snapshotDigest: 'scripted-empty', consistency: 'best-effort' };
  const requirements: AuthoringRequirements = { intent: 'create-independent-task', requiredChanges: [], preserve: [],
    answerabilityProtocol: 'option-answerability-v1', exclusionReviewProtocol: EXCLUSION_REVIEW_PROTOCOL };
  return { row, candidate, packet, memory, requirements, item: 0, policy: 'grounded-memory-v2' as const, step: { model: 'SCRIPTED-NOT-A-PROVIDER', maxTokens: 2000 } };
}

function answer(candidate = example().candidate): ExclusionReview {
  return { kind: 'mcq', options: candidate.options.map(option => ({ key: option.key,
    verdict: option.role === 'correct' ? 'fully-correct' : 'not-fully-correct', reason: 'SCRIPTED literal finding for wrapper mechanics.', spanIds: ['S1'],
    exclusion: option.role === 'correct' ? null : { basis: 'direct-contradiction', optionQuote: option.text.slice(0, 100), stemQuote: '',
      challenge: { status: 'excluded', reason: 'SCRIPTED source-backed exclusion; not a new model judgment.', spanIds: ['S1'] } } })) };
}

function review(input = example(), answerability: unknown = answer(input.candidate)) {
  return { sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: ['SCRIPTED source judgment; no semantic-quality claim.'],
    citations: [{ kind: 'premise', claim: 'SCRIPTED premise.', spanIds: ['S1'] }, { kind: 'solution', claim: 'SCRIPTED solution.', spanIds: ['S1'] }],
    taskComparisons: [] as Array<{ entryId: string; sameInference: boolean; sameSolutionPath: boolean; contrast: string }>,
    changes: input.requirements.requiredChanges.map(requirement => ({ requirement, status: 'fulfilled', reason: 'SCRIPTED teacher-clause finding.' })),
    invariants: input.requirements.preserve.map(requirement => ({ requirement, status: 'preserved', reason: 'SCRIPTED invariant finding.' })),
    achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [], answerability };
}

function legacyAnswer(input = example()) {
  return { kind: 'mcq', options: input.candidate.options.map(option => ({ key: option.key,
    verdict: option.role === 'correct' ? 'fully-correct' : 'not-fully-correct', reason: 'SCRIPTED legacy literal finding.', spanIds: ['S1'],
    exclusionBasis: option.role === 'correct' ? 'none' : 'source-contradiction', exclusion: option.role === 'correct' ? '' : 'SCRIPTED literal contradiction.', stemQuote: '' })) };
}

function warrant(value: ExclusionReview, index = 0) {
  const result = value.options[index].exclusion; if (!result) throw new Error('negative row required'); return result;
}

beforeEach(() => jest.mocked(completeJson).mockReset());

it('produces a selected receipt through the real quality wrapper and replays actual BSON without trusting model metadata', async () => {
  const input = example(), before = structuredClone(input), raw = review(input);
  jest.mocked(completeJson).mockResolvedValue(raw);
  const quality = await assessGenerationQuality(input);
  expect(quality).toMatchObject({ status: 'eligible', answerability: { status: 'passed', resolvedCorrectKey: 'D' },
    exclusionReview: { protocol: EXCLUSION_REVIEW_PROTOCOL, status: 'passed' } });
  expect(quality.candidate).toEqual(snapshotQualityCandidate(input.candidate));
  expect(exclusionReviewReceiptMatches(quality, input.requirements, quality.candidate!, input.packet)).toBe(true);
  const restored = BSON.deserialize(BSON.serialize({ quality, requirements: input.requirements, candidate: quality.candidate, packet: input.packet }, { ignoreUndefined: false }));
  expect(exclusionReviewReceiptMatches(restored.quality, restored.requirements, restored.candidate, restored.packet)).toBe(true);
  expect(input).toEqual(before); expect(completeJson).toHaveBeenCalledTimes(1);
  expect(jest.mocked(completeJson).mock.calls[0][1]).toMatchObject({ maxTokens: 2000, usageContext: { stage: 'quality-review', item: 0 } });
});

it.each(['candidate', 'packet', 'teacher', 'receipt', 'disclosure'] as const)('refuses a changed %s after real wrapper receipt/BSON replay', async target => {
  const input = example(); jest.mocked(completeJson).mockResolvedValue(review(input));
  const quality = await assessGenerationQuality(input);
  const state = BSON.deserialize(BSON.serialize({ quality, requirements: input.requirements, candidate: quality.candidate, packet: input.packet }, { ignoreUndefined: false }));
  if (target === 'candidate') state.candidate.options[0].text += ' changed';
  if (target === 'packet') state.packet.passages[0].text += ' changed';
  if (target === 'teacher') state.requirements.requiredChanges.push('New exact teacher instruction.');
  if (target === 'receipt') state.quality.exclusionReview.review.options[0].exclusion.challenge.reason = 'Forged review';
  if (target === 'disclosure') state.quality.answerability.options[0].exclusionWarrant.challenge.citations[0].quote = 'Forged original';
  expect(exclusionReviewReceiptMatches(state.quality, state.requirements, state.candidate, state.packet)).toBe(false);
});

it.each(['P01', 'P04'])('keeps scripted %s viable alternatives withheld after one actual review dispatch', async id => {
  const input = example(id), value = answer(input.candidate);
  warrant(value).basis = id === 'P01' ? 'strength-only' : 'placement-only';
  warrant(value).challenge.status = 'viable';
  warrant(value).challenge.reason = 'SCRIPTED alternative remains viable; listing and modality do not prove exclusion.';
  jest.mocked(completeJson).mockResolvedValue(review(input, value));
  const result = await assessGenerationQuality(input);
  expect(result.status).toBe('withheld'); expect(result.answerability?.status).toBe('withheld');
  expect(result.exclusionReview?.status).toBe('withheld'); expect(result.responseIssues ?? []).toEqual([]);
  expect(result.findings).toContainEqual(expect.objectContaining({ kind: 'answer-semantics', status: 'uncertain', correction: '' }));
  expect(completeJson).toHaveBeenCalledTimes(1);
});

it('retains source-bound multiple-answer ambiguity without a format retry or forcing the declared key', async () => {
  const input = example(), value = answer(input.candidate);
  value.options[0].verdict = 'fully-correct'; value.options[0].exclusion = null;
  jest.mocked(completeJson).mockResolvedValue(review(input, value));
  const quality = await assessGenerationQuality(input);
  expect(quality.status).toBe('withheld'); expect(quality.responseIssues ?? []).toEqual([]);
  expect(quality.answerability?.issues).toContainEqual({ path: 'answerability.options', code: 'multiple-fully-correct-options' });
  expect(quality.findings).toContainEqual(expect.objectContaining({ kind: 'answer-semantics', status: 'defect' }));
  expect(completeJson).toHaveBeenCalledTimes(1);
});

it('replays the new multiple-correct receipt into a bounded candidate-repair brief without endorsing or erasing the alternative', async () => {
  const input = example(), value = answer(input.candidate);
  value.options[0].verdict = 'fully-correct'; value.options[0].exclusion = null;
  jest.mocked(completeJson).mockResolvedValue(review(input, value));
  const quality = await assessGenerationQuality(input);
  const restored = BSON.deserialize(BSON.serialize({ quality, input }, { ignoreUndefined: false }));
  expect(buildGenerationSemanticRepairPlan({ ...input, assessment: quality })?.critique).toContain('LITERAL-ANSWER HYPOTHESES');
  const plan = buildGenerationSemanticRepairPlan({ assessment: restored.quality, ...restored.input });
  expect(plan).toMatchObject({ strategy: 'correct-candidate', requirements: input.requirements });
  expect(plan!.critique).toContain('LITERAL-ANSWER HYPOTHESES (not semantic proof)');
  expect(plan!.critique).toContain('Preserve genuine alternatives/uncertainty');
  expect(plan!.critique).toContain('invent no task restriction to force the key');
  expect(plan!.critique).toContain('"key":"A","verdict":"fully-correct"');
  expect(plan!.critique).toContain('"key":"D","verdict":"fully-correct"');
  expect(plan!.critique.length).toBeLessThanOrEqual(4500);
  const bad = structuredClone(quality); bad.exclusionReview!.review!.options[0].reason = 'Unrecorded altered hypothesis.';
  const generic = buildGenerationSemanticRepairPlan({ ...input, assessment: bad });
  // Existing source-backed defect planning may remain; the forged selected
  // review must never become the trusted literal-answer detail packet.
  expect(generic?.critique ?? '').not.toContain('LITERAL-ANSWER HYPOTHESES');
  expect(completeJson).toHaveBeenCalledTimes(1);
});

it('losslessly groups the complete code/path multiset including duplicate, empty and common-prefix edge cases', () => {
  const issues = [
    { path: 'answerability.options.0.exclusion.challenge.spanIds', code: 'answer-evidence-invalid' },
    { path: 'answerability.options.1.exclusion.challenge.spanIds', code: 'answer-evidence-invalid' },
    { path: 'answerability.options.1.exclusion.challenge.spanIds', code: 'answer-evidence-invalid' },
    { path: 'answerability.options.0.exclusion.optionQuote', code: 'exclusion-option-quote-invalid' },
    { path: 'answerability.options.1.exclusion.optionQuote', code: 'exclusion-option-quote-invalid' },
    { path: 'a', code: 'prefix-edge' }, { path: 'ab', code: 'prefix-edge' },
    { path: '', code: 'empty-path' }, { path: 'π.字.1', code: 'unicode-path' },
    { path: 'taskDemand.verdict', code: 'task-demand-contradictory-fields' },
  ];
  const before = structuredClone(issues);
  const encoded = renderExclusionReviewCorrectionIssues(issues);
  const grouped = JSON.parse(encoded) as Array<[string, string, string[]]>;
  const decoded = grouped.flatMap(([code, prefix, suffixes]) => suffixes.map(suffix => ({ path: prefix + suffix, code })));
  const multiset = (rows: typeof issues) => rows.map(row => JSON.stringify(row)).sort();
  expect(multiset(decoded)).toEqual(multiset(issues)); expect(issues).toEqual(before);
  expect(encoded.length).toBeLessThan(JSON.stringify(issues).length);
  expect(renderExclusionReviewCorrectionIssues([])).toBe('[]');
});

it('uses only the existing one correction and logical repair budget for malformed challenge references', async () => {
  const input = example(), invalid = answer(input.candidate); warrant(invalid).challenge.spanIds = ['S999'];
  jest.mocked(completeJson).mockResolvedValueOnce(review(input, invalid)).mockResolvedValueOnce(review(input));
  const budget = new AuthoringBudget('scripted-exclusion-correction', { maxSends: 8 });
  const quality = await withAuthoringBudget(budget, () => assessGenerationQuality(input));
  expect(quality.status).toBe('eligible'); expect(completeJson).toHaveBeenCalledTimes(2);
  expect(budget.snapshot().logical.repairCycles).toBe(1);
  const first = jest.mocked(completeJson).mock.calls[0], second = jest.mocked(completeJson).mock.calls[1];
  expect(second[0].startsWith(first[0])).toBe(true); expect(second[0]).toContain('SAME-CANDIDATE REVIEW CORRECTION');
  expect(second[0]).toContain('path=prefix+suffix');
  for (const prompt of [first[0], second[0]]) expect(prompt).not.toContain('one fully-correct matching key');
  const encoded = second[0].split('path=prefix+suffix. ')[1].split('. Full JSON once;')[0];
  const grouped = JSON.parse(encoded) as Array<[string, string, string[]]>;
  const decoded = grouped.flatMap(([code, prefix, suffixes]) => suffixes.map(suffix => ({ path: prefix + suffix, code })));
  const recorded = quality.responseIssues!.filter(issue => issue.attempt === 0).map(({ path, code }) => ({ path, code }));
  expect(decoded.map(row => JSON.stringify(row)).sort()).toEqual(recorded.map(row => JSON.stringify(row)).sort());
  expect(second[1]?.maxTokens).toBe(first[1]?.maxTokens); expect(second[1]?.maxTokens).toBe(2000);
  expect(quality.responseIssues).toContainEqual(expect.objectContaining({ attempt: 0, code: 'answer-evidence-invalid' }));
});

it('refuses old answer rows under the selected schema after the one allowed response correction', async () => {
  const input = example(); jest.mocked(completeJson).mockResolvedValue(review(input, legacyAnswer(input)));
  const quality = await assessGenerationQuality(input);
  expect(quality.status).toBe('withheld'); expect(quality.exclusionReview?.status).toBe('withheld');
  expect(quality.exclusionReview?.review).toBeNull(); expect(completeJson).toHaveBeenCalledTimes(2);
});

it.each(['source', 'notation', 'teacher', 'Bank', 'demand'] as const)('does not waive the independent %s gate when selected warrants pass', async gate => {
  const input = example(); let value = review(input);
  if (gate === 'source') value.sourceSupport = 'unsupported';
  if (gate === 'notation') value.notation = 'inconsistent';
  if (gate === 'teacher') {
    input.requirements.requiredChanges = ['Keep the exact teacher requirement.']; value = review(input); value.changes[0].status = 'unfulfilled';
  }
  if (gate === 'Bank') {
    const content = { ...structuredClone(input.candidate), stem: 'A separate prior Bank task used only for a scripted comparison.' };
    input.memory.entries.push({ id: 'bank-existing', source: 'bank', content, fingerprint: contentFingerprint(content) });
    value.novelty = 'duplicate'; value.taskComparisons = [{ entryId: 'M1', sameInference: true, sameSolutionPath: true, contrast: 'SCRIPTED same required inference and solution path.' }];
  }
  if (gate === 'demand') {
    Object.assign(input.requirements, { taskDemandProtocol: 'task-demand-v1', requestedDifficulty: 'easy', requestedType: 'mcq', requestedKind: 'conceptual' });
    value.achievedDifficulty = 'medium';
    Object.assign(value, { taskDemand: { verdict: 'fulfilled', capacity: 'supported', rationale: 'SCRIPTED fulfilled claim with wrong achieved level.', missingOperation: '', spanIds: ['S1'] } });
  }
  jest.mocked(completeJson).mockResolvedValue(value);
  const quality = await assessGenerationQuality(input);
  expect(quality.answerability?.status).toBe('passed'); expect(quality.exclusionReview?.status).toBe('passed');
  expect(quality.status).toBe('withheld'); expect(exclusionReviewReceiptMatches(quality, input.requirements, quality.candidate!, input.packet)).toBe(false);
});

it('preserves the complete selected source, Bank, teacher and original candidate payloads', () => {
  const input = example(), memory = input.row.memory as unknown as GenerationMemorySnapshot;
  input.requirements.requiredChanges = ['Exact teacher instruction with punctuation: keep it.'];
  input.requirements.preserve = ['Keep this exact invariant.'];
  const selected = selectGenerationMemory(memory);
  const absent = { ...input.requirements }; delete absent.exclusionReviewProtocol;
  const a = renderGenerationQualityReviewPrompt(input.packet, selected, input.candidate, [], absent);
  const b = renderGenerationQualityReviewPrompt(input.packet, selected, input.candidate, [], input.requirements);
  const marker = 'SOURCE EVIDENCE ONLY (S IDs).';
  expect(a.slice(a.indexOf(marker))).toBe(b.slice(b.indexOf(marker)));
  for (const text of [...input.requirements.requiredChanges, ...input.requirements.preserve]) { expect(a).toContain(text); expect(b).toContain(text); }
  expect(b).toContain(`CANDIDATE: ${JSON.stringify(input.candidate)}`);
  expect(b).toContain('independently of key'); expect(b).not.toContain('one fully-correct matching key');
});

it('requires numerical exclusion quotes from the original CAPM template while retaining the historical footer exactly', () => {
  const input = example('CAPM'); input.requirements.numericReviewProtocol = 'server-rendered-numeric-review-v1';
  const absent = { ...input.requirements }; delete absent.exclusionReviewProtocol;
  const selection = selectGenerationMemory(input.memory);
  const old = renderGenerationQualityReviewPrompt(input.packet, selection, input.candidate, [], absent);
  const selected = renderGenerationQualityReviewPrompt(input.packet, selection, input.candidate, [], input.requirements);
  expect(old.endsWith('stemQuote must quote the ORIGINAL CANDIDATE stem verbatim, never sample text. Only original S spans are teaching evidence.')).toBe(true);
  expect(selected.endsWith('optionQuote/stemQuote: exact ORIGINAL CANDIDATE text,never the numeric sample. Only original S spans are teaching evidence.')).toBe(true);
  expect(selected).toContain(`CANDIDATE: ${JSON.stringify(input.candidate)}`);
  for (const option of input.candidate.options) expect(selected).toContain(option.text);
  expect(selected).toContain('SERVER NUMERIC EXAMPLE');
});

it('keeps historical absent/own-undefined and selected T/F prompt bytes and receipt behavior unchanged', async () => {
  const input = example(), absent = { ...input.requirements }; delete absent.exclusionReviewProtocol;
  const selected = selectGenerationMemory(input.memory);
  const a = renderGenerationQualityReviewPrompt(input.packet, selected, input.candidate, [], absent);
  expect(renderGenerationQualityReviewPrompt(input.packet, selected, input.candidate, [], { ...absent, exclusionReviewProtocol: undefined })).toBe(a);
  jest.mocked(completeJson).mockResolvedValue(review(input, legacyAnswer(input)));
  expect((await assessGenerationQuality({ ...input, requirements: absent })).exclusionReview).toBeUndefined();
  const tf = example('TF'), tfAbsent = { ...tf.requirements }; delete tfAbsent.exclusionReviewProtocol;
  const tfSelection = selectGenerationMemory(tf.memory);
  expect(renderGenerationQualityReviewPrompt(tf.packet, tfSelection, tf.candidate, [], tf.requirements))
    .toBe(renderGenerationQualityReviewPrompt(tf.packet, tfSelection, tf.candidate, [], tfAbsent));
  jest.mocked(completeJson).mockReset().mockResolvedValue(review(tf, { kind: 'true-false', stemTruth: 'true', reason: 'SCRIPTED whole-stem truth.', spanIds: ['S1'] }));
  expect((await assessGenerationQuality(tf)).exclusionReview).toBeUndefined();
});

it.each(['baseline', 'grounded-memory-v1'] as const)('refuses selected %s execution before any provider call', async policy => {
  await expect(assessGenerationQuality({ ...example(), policy })).rejects.toThrow('generation-exclusion-review-policy-invalid');
  expect(completeJson).not.toHaveBeenCalled();
});
