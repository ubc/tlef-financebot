// Pure protocol/citation mechanics. All semantic labels below are scripted.
jest.mock('../../server/src/config/env', () => { throw new Error('env denied'); });
jest.mock('../../server/src/components/genai/llm', () => { throw new Error('provider denied'); });
jest.mock('../../server/src/components/mongodb/collections', () => { throw new Error('database denied'); });
import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import retained from '../fixtures/generation-quality/retained-review-size-2026-10-17.json';
import { answerabilityExample, evaluateAnswerability } from '../../server/src/services/generation-answerability';
import { assertGenerationExclusionReviewProtocol, EXCLUSION_REVIEW_PROTOCOL, evaluateExclusionReview, exclusionReviewEnabled,
  exclusionReviewExample, exclusionReviewInstruction, exclusionReviewReceiptMatches, exclusionReviewRecordedMatches, exclusionReviewSchema, type ExclusionReview } from '../../server/src/services/generation-exclusion-review';
import type { AuthoringRequirements, GenerationQualityAssessment, GenerationQualityCandidate } from '../../server/src/types/generation-quality';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { GenerationExclusionReviewReceipt } from '../../server/src/types/generation-exclusion-review';

const fixture = (id = 'P02') => structuredClone(retained.cases.find(row => row.id === id)!);
function snapshot(id = 'P02'): GenerationQualityCandidate {
  const raw = fixture(id);
  const original = { type: raw.type as 'mcq', stem: raw.candidate.stem,
    options: raw.candidate.options.map(({ key, text, role, explanation }) => ({ key, text, role, explanation })),
    numericKind: raw.candidate.numericKind, paramSlots: raw.candidate.paramSlots, derivedValues: raw.candidate.derivedValues };
  return { ...original, contentHash: createHash('sha256').update(JSON.stringify(original)).digest('hex'), truncated: false } as GenerationQualityCandidate;
}
const packet = () => fixture().packet as GenerationEvidencePacket;
const requirements = (): AuthoringRequirements => ({ ...fixture().requirements as AuthoringRequirements, answerabilityProtocol: 'option-answerability-v1', exclusionReviewProtocol: EXCLUSION_REVIEW_PROTOCOL });
function review(candidate = snapshot()): ExclusionReview {
  return { kind: 'mcq', options: candidate.options.map(option => ({ key: option.key,
    verdict: option.role === 'correct' ? 'fully-correct' : 'not-fully-correct', reason: 'Scripted literal response/source relationship.', spanIds: ['S1'],
    exclusion: option.role === 'correct' ? null : { basis: 'direct-contradiction', optionQuote: option.text.slice(0, 100), stemQuote: '',
      challenge: { status: 'excluded', reason: 'The whole alternative includes a source-contradicting assertion.', spanIds: ['S1'] } } })) };
}
function positive() {
  const value = review();
  value.options[0].reason = 'The whole answer explicitly denies the source averaging mechanism.';
  value.options[0].exclusion!.optionQuote = 'averaging firm-specific effects is not part of the explanation.';
  value.options[0].spanIds = ['S1', 'S2']; value.options[0].exclusion!.challenge.spanIds = ['S1', 'S2'];
  value.options[1].exclusion!.optionQuote = 'diversification removes market-wide risk too.';
  value.options[2].exclusion!.optionQuote = 'every firm-specific action affect the whole portfolio more strongly.';
  value.options[3].spanIds = ['S1', 'S2'];
  return value;
}
function quality(candidate = snapshot(), source = packet(), request = requirements(), value = positive()): GenerationQualityAssessment {
  const result = evaluateExclusionReview(value, candidate, source, request);
  return { policy: 'grounded-memory-v2', item: 0, status: 'eligible', sourceSupport: 'supported', notation: 'consistent', novelty: 'independent',
    reasons: ['SCRIPTED TEST, not a model result.'], citations: [], matchedEntryIds: [], evidencePacketId: source.id, memoryDigest: 'unrelated-memory-binding',
    checkedAt: new Date('2026-10-17T00:00:00.000Z'), candidate, answerability: result.assessment, exclusionReview: result.receipt,
    coverage: { evidenceTruncated: true, memoryTruncated: false, shownEntries: 1, totalEntries: 1, missingVersions: 0, consistency: 'best-effort' } };
}
function warrant(value: ExclusionReview, index = 0) {
  const result = value.options[index].exclusion;
  if (!result) throw new Error('test requires a negative warrant');
  return result;
}

describe('explicit exclusion protocol and historical compatibility', () => {
  it('validates exact selector/policy and requires existing literal answerability only for selected MCQ', () => {
    expect(assertGenerationExclusionReviewProtocol(undefined, 'baseline')).toBe(false);
    expect(exclusionReviewEnabled(undefined, snapshot())).toBe(false);
    expect(exclusionReviewEnabled(requirements(), snapshot())).toBe(true);
    expect(() => assertGenerationExclusionReviewProtocol(null)).toThrow('protocol-invalid');
    expect(() => assertGenerationExclusionReviewProtocol('future')).toThrow('protocol-invalid');
    expect(() => assertGenerationExclusionReviewProtocol(EXCLUSION_REVIEW_PROTOCOL, 'grounded-memory-v1')).toThrow('policy-invalid');
    expect(() => exclusionReviewEnabled({ ...requirements(), answerabilityProtocol: undefined }, snapshot())).toThrow('answerability-required');
  });

  it('delegates absent historical data exactly without receipt, marker or new example shape', () => {
    const candidate = snapshot(), value = { kind: 'mcq' as const, options: candidate.options.map(option => ({ key: option.key,
      verdict: option.role === 'correct' ? 'fully-correct' as const : 'not-fully-correct' as const, reason: 'Scripted source finding.', spanIds: ['S1'],
      exclusionBasis: option.role === 'correct' ? 'none' as const : 'source-contradiction' as const,
      exclusion: option.role === 'correct' ? '' : 'The whole literal response contradicts the original.', stemQuote: '' })) };
    const result = evaluateExclusionReview(value, candidate, packet(), { ...requirements(), exclusionReviewProtocol: undefined });
    expect(result).toEqual(evaluateAnswerability(value, candidate, packet()));
    expect(result).not.toHaveProperty('receipt'); expect(result.assessment).not.toHaveProperty('exclusionProtocol');
    expect(exclusionReviewReceiptMatches({ ...quality(), exclusionReview: undefined }, { ...requirements(), exclusionReviewProtocol: undefined }, candidate, packet())).toBe(true);
  });

  it('preserves selected T/F evaluator/example with zero new receipt', () => {
    const body = { type: 'true-false' as const, stem: 'Market-wide risk cannot be diversified away.', options: [
      { key: 'A', text: 'True', role: 'correct' as const, explanation: 'Feedback is not a separate answer.' },
      { key: 'B', text: 'False', role: 'common-misconception' as const, explanation: 'Corrective feedback can itself be true.' }] };
    const tf = { ...body, contentHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), truncated: false };
    const value = { kind: 'true-false', stemTruth: 'true', reason: 'Whole literal proposition.', spanIds: ['S1'] };
    expect(exclusionReviewEnabled(requirements(), tf)).toBe(false);
    expect(exclusionReviewExample(tf)).toEqual(answerabilityExample(tf));
    expect(evaluateExclusionReview(value, tf, packet(), requirements())).toEqual(evaluateAnswerability(value, tf, packet()));
    const q = { ...quality(), candidate: tf, exclusionReview: undefined };
    expect(exclusionReviewReceiptMatches(q, requirements(), tf, packet())).toBe(true);
    expect(exclusionReviewReceiptMatches({ ...q, exclusionReview: quality().exclusionReview }, requirements(), tf, packet())).toBe(false);
  });

  it('instructs independent literal judgments with the complete selected envelope and no key-forcing goal', () => {
    const text = exclusionReviewInstruction();
    expect(text).toContain('answerability:{kind:"mcq",options:');
    expect(text).toContain('independently of key/roles/feedback'); expect(text).toContain('even multiples/key conflicts');
    expect(text).toContain('mitigate!=eliminate'); expect(text).toContain('Taught formulas refute wrong math');
    expect(text.length).toBeLessThanOrEqual(1_050);
    for (const bound of ['reason<=180', 'challenge.reason/quotes<=120', 'refs<=3 S IDs']) expect(text).toContain(bound);
    expect(exclusionReviewExample(snapshot())).toEqual({ kind: 'mcq', options: [{ key: 'A', verdict: 'undetermined',
      reason: 'Literal response finding, not a prescribed verdict.', spanIds: [], exclusion: null }] });
  });
});

describe('bounded same-call warrants, not semantic entailment proof', () => {
  it('retains substantive P02 whole-response denial/source links and a replayable positive scripted receipt', () => {
    const candidate = snapshot(), source = packet(), request = requirements(), raw = positive();
    const before = structuredClone({ candidate, source, request, raw });
    const result = evaluateExclusionReview(raw, candidate, source, request);
    expect(result.responseIssues).toEqual([]); expect(result.findings).toEqual([]);
    expect(result.assessment).toMatchObject({ status: 'passed', resolvedCorrectKey: 'D', exclusionProtocol: EXCLUSION_REVIEW_PROTOCOL });
    expect(result.receipt).toMatchObject({ protocol: EXCLUSION_REVIEW_PROTOCOL, status: 'passed', review: raw });
    if (result.assessment.kind !== 'mcq') throw new Error('MCQ expected');
    expect(result.assessment.options[0].exclusionBasis).toBe('source-contradiction');
    expect(result.assessment.options[0].exclusionWarrant?.challenge.citations[0].quote).toContain('average out to zero');
    expect({ candidate, source, request, raw }).toEqual(before);
    raw.options[0].reason = 'Mutated caller raw';
    expect(result.receipt!.review!.options[0].reason).not.toBe(raw.options[0].reason);
  });

  it.each(['placement-only', 'strength-only', 'silence-only', 'undetermined'] as const)('holds %s basis semantically without spending response correction', basis => {
    const value = positive(); warrant(value).basis = basis;
    const result = evaluateExclusionReview(value, snapshot(), packet(), requirements());
    expect(result.responseIssues).toEqual([]); expect(result.assessment.status).toBe('withheld');
    expect(result.assessment).not.toHaveProperty('resolvedCorrectKey');
    expect(result.assessment.issues).toContainEqual({ path: 'answerability.options.0.exclusion', code: 'exclusion-basis-does-not-exclude' });
    expect(result.findings).toEqual([expect.objectContaining({ status: 'uncertain', correction: '' })]);
  });

  it.each(['viable', 'uncertain'] as const)('holds a source-backed %s challenge without correcting it into an exclusion', status => {
    const value = positive(); warrant(value).challenge.status = status;
    if (status === 'uncertain') warrant(value).challenge.spanIds = [];
    const result = evaluateExclusionReview(value, snapshot(), packet(), requirements());
    expect(result.responseIssues).toEqual([]); expect(result.assessment.status).toBe('withheld');
    expect(result.findings[0]).toMatchObject({ status: 'uncertain', correction: '' });
  });

  it('retains literal ambiguity instead of forcing the key or consuming response correction; preserves the existing candidate-repair finding', () => {
    const value = positive(); value.options[0].verdict = 'fully-correct'; value.options[0].exclusion = null;
    const result = evaluateExclusionReview(value, snapshot(), packet(), requirements());
    expect(result.responseIssues).toEqual([]); expect(result.assessment.status).toBe('withheld');
    expect(result.assessment.issues.some(issue => issue.code === 'multiple-fully-correct-options')).toBe(true);
    expect(result.findings[0]).toMatchObject({ status: 'defect' }); expect(result.findings[0].correction).not.toBe('');
    expect(result.receipt!.review!.options[0].verdict).toBe('fully-correct');
  });

  it('preserves a clean source-bound wrong-key defect for the same bounded candidate-repair path', () => {
    const value = positive(); value.options[0].verdict = 'fully-correct'; value.options[0].exclusion = null;
    value.options[3].verdict = 'not-fully-correct'; value.options[3].exclusion = { ...warrant(positive()), optionQuote: snapshot().options[3].text.slice(0, 100) };
    const result = evaluateExclusionReview(value, snapshot(), packet(), requirements());
    expect(result.responseIssues).toEqual([]); expect(result.assessment.issues.some(issue => issue.code === 'answer-key-disagrees')).toBe(true);
    expect(result.findings[0].status).toBe('defect'); expect(result.findings[0].correction).not.toBe('');
  });

  it.each(['P01', 'P04'])('keeps actual %s listing/modality exclusions unresolved when scripted challenge identifies viable counterevidence', id => {
    const candidate = snapshot(id), value = review(candidate), source = fixture(id).packet as GenerationEvidencePacket;
    const first = warrant(value); first.basis = id === 'P01' ? 'strength-only' : 'placement-only';
    first.challenge = { status: 'viable', reason: 'Listing is nonexclusive; mitigation need not mean elimination.', spanIds: [id === 'P01' ? 'S4' : 'S6'] };
    const result = evaluateExclusionReview(value, candidate, source, requirements());
    expect(result.responseIssues).toEqual([]); expect(result.assessment.status).toBe('withheld');
    expect(result.findings[0].correction).toBe(''); expect(result.findings[0].passageIds).toContain(source.passages.find(p => p.text.includes('asset classes'))!.id);
  });

  it('resolves challenge source by actual key even when review rows have a different order', () => {
    const value = positive(); value.options.reverse();
    const result = evaluateExclusionReview(value, snapshot(), packet(), requirements());
    expect(result.responseIssues).toEqual([]); expect(result.assessment.status).toBe('passed');
    expect(result.receipt!.options.find(row => row.key === 'A')!.exclusionWarrant!.challenge.citations[0].quote).toContain('average out to zero');
  });
});

describe('malformed locators/response fields use only the existing response correction classification', () => {
  it.each(['empty-target', 'foreign-target', 'changed-case', 'invented-condition', 'blank-condition', 'source-basis-with-condition'] as const)('refuses %s', fault => {
    const value = positive(), w = warrant(value);
    if (fault === 'empty-target') w.optionQuote = ' ';
    if (fault === 'foreign-target') w.optionQuote = 'A different option claim';
    if (fault === 'changed-case') w.optionQuote = 'Averaging firm-specific effects';
    if (fault === 'invented-condition') { w.basis = 'explicit-task-restriction'; w.stemQuote = 'both mechanisms are required'; }
    if (fault === 'blank-condition') { w.basis = 'required-component-missing'; w.stemQuote = ' '; }
    if (fault === 'source-basis-with-condition') w.stemQuote = 'Why can';
    const result = evaluateExclusionReview(value, snapshot(), packet(), requirements());
    expect(result.assessment.status).toBe('withheld'); expect(result.responseIssues.length).toBeGreaterThan(0);
    expect(result.findings[0]).toMatchObject({ status: 'uncertain', correction: '' });
  });

  it.each(['explicit-task-restriction', 'required-component-missing'] as const)('maps exact %s quotes without pretending substring identity proves entailment', basis => {
    const value = positive(); warrant(value).basis = basis; warrant(value).stemQuote = 'Why can adding many investments';
    const result = evaluateExclusionReview(value, snapshot(), packet(), requirements());
    expect(result.responseIssues).toEqual([]);
    if (result.assessment.kind !== 'mcq') throw new Error('MCQ expected');
    expect(result.assessment.options[0].exclusionBasis).toBe(basis === 'explicit-task-restriction' ? 'explicit-stem-condition' : 'incomplete-response');
  });

  it.each(['foreign-main', 'foreign-challenge', 'duplicate-challenge', 'missing-excluded', 'missing-viable', 'damage', 'scope'] as const)('refuses %s references through unchanged source guards', fault => {
    const value = positive(), source = packet();
    if (fault === 'foreign-main') value.options[0].spanIds = ['S999'];
    if (fault === 'foreign-challenge') warrant(value).challenge.spanIds = ['S999'];
    if (fault === 'duplicate-challenge') warrant(value).challenge.spanIds = ['S1', 'S1'];
    if (fault === 'missing-excluded' || fault === 'missing-viable') { warrant(value).challenge.spanIds = []; warrant(value).challenge.status = fault === 'missing-viable' ? 'viable' : 'excluded'; }
    if (fault === 'damage') source.findings.push({ code: 'source-text-damage', message: 'Synthetic damage control.', passageIds: [source.passages[0].id] });
    if (fault === 'scope') source.materials[0].role = 'secondary';
    const result = evaluateExclusionReview(value, snapshot(), source, requirements());
    expect(result.assessment.status).toBe('withheld'); expect(result.responseIssues.length).toBeGreaterThan(0);
  });

  it.each(['missing-negative-warrant', 'neutral-with-warrant', 'extra', 'too-long', 'oversized-alias', 'missing-option', 'foreign-key', 'duplicate-key'] as const)('strictly refuses %s', fault => {
    const value = positive();
    if (fault === 'missing-negative-warrant') value.options[0].exclusion = null;
    if (fault === 'neutral-with-warrant') value.options[3].exclusion = warrant(positive());
    if (fault === 'extra') Object.assign(warrant(value), { verified: true });
    if (fault === 'too-long') value.options[0].reason = 'x'.repeat(181);
    if (fault === 'oversized-alias') value.options[0].spanIds = ['S' + '9'.repeat(1000)];
    if (fault === 'missing-option') value.options.pop();
    if (fault === 'foreign-key') value.options[0].key = 'Z';
    if (fault === 'duplicate-key') value.options[0].key = 'B';
    const result = evaluateExclusionReview(value, snapshot(), packet(), requirements());
    expect(result.assessment.status).toBe('withheld'); expect(result.responseIssues.length).toBeGreaterThan(0);
    if (['extra', 'too-long', 'oversized-alias', 'missing-option'].includes(fault)) expect(result.receipt!.review).toBeNull();
  });

  it('holds a corrupt canonical snapshot as a server-input failure rather than a model-format retry', () => {
    const candidate = snapshot(); candidate.contentHash = '0'.repeat(64);
    const result = evaluateExclusionReview(positive(), candidate, packet(), requirements());
    expect(result.responseIssues).toEqual([]); expect(result.assessment.status).toBe('withheld');
    expect(result.assessment.issues.some(issue => issue.code === 'exclusion-candidate-snapshot-invalid')).toBe(true);
  });
});

describe('complete immutable replay and durable compatibility', () => {
  it('replays a withheld viable alternative after real BSON without granting admission or changing its semantic judgment', () => {
    const candidate = snapshot(), source = packet(), request = requirements(), value = positive();
    warrant(value).challenge.status = 'viable';
    const assessed = quality(candidate, source, request, value); assessed.status = 'withheld';
    expect(exclusionReviewRecordedMatches(assessed, request, candidate, source)).toBe(true);
    const restored = BSON.deserialize(BSON.serialize({ assessed, request, candidate, source }));
    expect(exclusionReviewRecordedMatches(restored.assessed, restored.request, restored.candidate, restored.source)).toBe(true);
    expect(restored.assessed.answerability.status).toBe('withheld');
    expect(exclusionReviewReceiptMatches(restored.assessed, restored.request, restored.candidate, restored.source)).toBe(false);
  });

  it.each(['raw', 'source', 'requirements', 'answerability', 'receipt', 'candidate'] as const)('refuses changed withheld %s replay', fault => {
    const candidate = snapshot(), source = packet(), request = requirements(), value = positive();
    warrant(value).basis = 'placement-only';
    const assessed = quality(candidate, source, request, value); assessed.status = 'withheld';
    if (fault === 'raw') assessed.exclusionReview!.review!.options[0].reason += ' New unsupported raw.';
    if (fault === 'source') source.coverage.selectedCharacters += 1;
    if (fault === 'requirements') request.preserve.push('A new actual teacher condition.');
    if (fault === 'answerability') assessed.answerability!.issues = [];
    if (fault === 'receipt') assessed.exclusionReview!.issues = [];
    if (fault === 'candidate') candidate.contentHash = '0'.repeat(64);
    expect(exclusionReviewRecordedMatches(assessed, request, candidate, source)).toBe(false);
  });

  it('does not call malformed raw/evidence replay valid merely because the resulting judgment is withheld', () => {
    const value = positive(); warrant(value).challenge.spanIds = ['S999'];
    const assessed = quality(snapshot(), packet(), requirements(), value); assessed.status = 'withheld';
    expect(exclusionReviewRecordedMatches(assessed, requirements(), snapshot(), packet())).toBe(false);
    assessed.exclusionReview!.review = null;
    expect(exclusionReviewRecordedMatches(assessed, requirements(), snapshot(), packet())).toBe(false);
  });

  it('matches complete current receipt and answerability after JSON and actual BSON round trips', () => {
    const candidate = snapshot(), source = packet(), request = requirements(), assessed = quality(candidate, source, request);
    expect(exclusionReviewReceiptMatches(assessed, request, candidate, source)).toBe(true);
    expect(exclusionReviewReceiptMatches(JSON.parse(JSON.stringify(assessed)), JSON.parse(JSON.stringify(request)), JSON.parse(JSON.stringify(candidate)), JSON.parse(JSON.stringify(source)))).toBe(true);
    expect(exclusionReviewReceiptMatches(BSON.deserialize(BSON.serialize(assessed)) as GenerationQualityAssessment,
      BSON.deserialize(BSON.serialize(request)) as AuthoringRequirements, BSON.deserialize(BSON.serialize(candidate)) as GenerationQualityCandidate,
      BSON.deserialize(BSON.serialize(source)) as GenerationEvidencePacket)).toBe(true);
  });

  it.each(['candidate', 'feedback', 'unused-source', 'coverage', 'teacher', 'requirements-extra', 'raw-review', 'receipt-options', 'answerability', 'status', 'missing', 'unknown-pin'] as const)('refuses changed %s even with the same stored packet ID', change => {
    let candidate = snapshot(); const source = packet(), request = requirements(), assessed = quality(candidate, source, request);
    if (change === 'candidate' || change === 'feedback') { const body = structuredClone(candidate); if (change === 'candidate') body.stem += ' Changed condition.'; else body.options[0].explanation += ' Changed feedback.';
      const values = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'contentHash' && key !== 'truncated')) as Omit<GenerationQualityCandidate, 'contentHash' | 'truncated'>;
      candidate = { ...values, contentHash: createHash('sha256').update(JSON.stringify(values)).digest('hex'), truncated: false }; }
    if (change === 'unused-source') { const row = source.passages[source.passages.length - 1]; row.text += ' Changed unused original.'; row.end = row.start + row.text.length; }
    if (change === 'coverage') source.coverage.sourceChunks += 1;
    if (change === 'teacher') request.requiredChanges.push('A new exact teacher clause.');
    if (change === 'requirements-extra') request.preserve.push('A new preserved invariant.');
    if (change === 'raw-review') assessed.exclusionReview!.review!.options[0].reason += ' Mutated';
    if (change === 'receipt-options') assessed.exclusionReview!.options[0].exclusionWarrant!.challenge.reason += ' Mutated';
    if (change === 'answerability' && assessed.answerability?.kind === 'mcq') assessed.answerability.options[0].reason += ' Mutated';
    if (change === 'status') assessed.status = 'withheld';
    if (change === 'missing') delete assessed.exclusionReview;
    if (change === 'unknown-pin') Object.assign(request, { exclusionReviewProtocol: 'future' });
    expect(exclusionReviewReceiptMatches(assessed, request, candidate, source)).toBe(false);
  });

  it('refuses consistently rehashed candidate changes without replaying stale raw judgment as new authority', () => {
    const assessed = quality(), candidate = snapshot(), source = packet(), request = requirements();
    candidate.options[0].role = 'correct'; candidate.options[3].role = 'clearly-wrong';
    const body = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'contentHash' && key !== 'truncated'));
    candidate.contentHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    assessed.candidate = candidate;
    expect(exclusionReviewReceiptMatches(assessed, request, candidate, source)).toBe(false);
  });

  it('keeps invalid/corrupt null receipts and unknown model fields untrusted', () => {
    const assessed = quality(); Object.assign(assessed, { exclusionReview: null });
    expect(exclusionReviewReceiptMatches(assessed, requirements(), snapshot(), packet())).toBe(false);
    expect(exclusionReviewSchema.safeParse({ ...positive(), protocol: EXCLUSION_REVIEW_PROTOCOL }).success).toBe(false);
    expect(exclusionReviewSchema.safeParse({ ...positive(), numericProof: { passed: true } }).success).toBe(false);
    const receipt = quality().exclusionReview as GenerationExclusionReviewReceipt;
    expect(JSON.stringify(receipt)).not.toContain('checkedAt');
  });
});
