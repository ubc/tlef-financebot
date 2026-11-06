// Actual quality wrapper with scripted verdicts and denied external boundaries.
// These controls test transcript integrity, not model accuracy or saved yield.
jest.mock('../../server/src/config/env', () => ({ env: {} }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => new Proxy({}, { get: () => () => { throw new Error('database denied'); } }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn(() => { throw new Error('embedding denied'); }) }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn(() => { throw new Error('vector denied'); }) }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn(() => { throw new Error('queue denied'); }) }));
jest.mock('../../server/src/components/param-worker', () => ({ executeGenerate: jest.fn(() => { throw new Error('worker denied'); }) }));

import { BSON } from 'mongodb';
import retained from '../fixtures/generation-quality/retained-review-size-2026-10-17.json';
import { completeJson } from '../../server/src/components/genai/llm';
import { assessGenerationQuality, renderExclusionReviewCorrectionIssues } from '../../server/src/services/generation-quality.service';
import { contentFingerprint, type GenerationMemoryContent, type GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import { captureReviewDecisions, REVIEW_REPAIR_PROTOCOL, reviewRepairReceiptMatches } from '../../server/src/services/generation-review-repair';
import { buildGenerationSemanticRepairPlan } from '../../server/src/services/generation-semantic-repair';
import type { AuthoringRequirements } from '../../server/src/types/generation-quality';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';

function input() {
  const row = structuredClone(retained.cases.find(row => row.id === 'P02')!);
  const candidate = { ...row.candidate, type: row.type } as GenerationMemoryContent;
  const prior = { ...candidate, stem: 'SCRIPTED distinct previous task; source semantics are not under test.' };
  const memory: GenerationMemorySnapshot = { entries: [{ id: 'prior-bank-version', source: 'bank', content: prior, fingerprint: contentFingerprint(prior) }],
    snapshotDigest: 'scripted-memory', truncated: false, missingVersions: 0, consistency: 'best-effort' };
  const requirements: AuthoringRequirements = { intent: 'create-independent-task', requiredChanges: [], preserve: [],
    answerabilityProtocol: 'option-answerability-v1', exclusionReviewProtocol: 'literal-exclusion-warrants-v1', reviewRepairProtocol: REVIEW_REPAIR_PROTOCOL };
  return { candidate, packet: row.packet as GenerationEvidencePacket, memory, requirements,
    item: 0, policy: 'grounded-memory-v2' as const, step: { model: 'SCRIPTED-NO-PROVIDER', reasoningEffort: 'none' as const } };
}
function review(i = input()) {
  return { sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: ['SCRIPTED verdicts only.'],
    citations: [{ kind: 'premise', claim: 'SCRIPTED premise.', spanIds: ['S1'] }, { kind: 'solution', claim: 'SCRIPTED solution.', spanIds: ['S1'] }],
    taskComparisons: [{ entryId: 'M1', sameInference: false, sameSolutionPath: false, contrast: 'SCRIPTED different inference/path.' }],
    changes: [], invariants: [], achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [], findings: [],
    answerability: { kind: 'mcq', options: i.candidate.options.map(option => ({ key: option.key,
      verdict: option.role === 'correct' ? 'fully-correct' : 'not-fully-correct', reason: 'SCRIPTED literal finding.', spanIds: ['S1'],
      exclusion: option.role === 'correct' ? null : { basis: 'direct-contradiction', optionQuote: option.text.slice(0, 100), stemQuote: '',
        challenge: { status: 'excluded', reason: 'SCRIPTED source contradiction.', spanIds: ['S1'] } } })) } };
}
beforeEach(() => jest.mocked(completeJson).mockReset());

it('rejects R9-shaped duplicate-to-independent semantic drift during a missing-comparator schema correction', async () => {
  const i = input(), first = review(i), second = review(i);
  first.novelty = 'duplicate'; first.taskComparisons = [];
  jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const q = await assessGenerationQuality(i);
  expect(completeJson).toHaveBeenCalledTimes(2);
  expect(q.status).toBe('withheld');
  expect(q.reviewRepair).toMatchObject({ protocol: REVIEW_REPAIR_PROTOCOL, status: 'drift', corrected: true,
    changes: expect.arrayContaining([{ path: 'novelty', before: 'duplicate', after: 'independent' }]) });
  expect(q.responseIssues).toContainEqual({ attempt: 1, path: 'novelty', code: 'review-semantic-decision-changed' });
  expect(jest.mocked(completeJson).mock.calls[1][0]).toContain('SCHEMA REPAIR ONLY');
  expect(buildGenerationSemanticRepairPlan({ ...i, assessment: q, reviewer: { decision: 'reject', reasoning: 'SCRIPTED rejection.' } })).toBeUndefined();
});

it('still admits a source-reference-only repair with unchanged semantic judgments and exact BSON replay', async () => {
  const i = input(), first = review(i), second = review(i);
  first.citations[0].spanIds = ['S9999'];
  jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const q = await assessGenerationQuality(i);
  expect(q.status).toBe('eligible');
  expect(q.reviewRepair).toMatchObject({ status: 'consistent', corrected: true, changes: [] });
  expect(reviewRepairReceiptMatches(q, i.requirements, q.candidate!, i.packet, ['prior-bank-version'])).toBe(true);
  const b = BSON.deserialize(BSON.serialize({ q, i }));
  expect(reviewRepairReceiptMatches(b.q, b.i.requirements, b.q.candidate, b.i.packet, ['prior-bank-version'])).toBe(true);
});

it('records the no-correction branch with one dispatch', async () => {
  const i = input(); jest.mocked(completeJson).mockResolvedValue(review(i));
  const q = await assessGenerationQuality(i);
  expect(q.status).toBe('eligible'); expect(completeJson).toHaveBeenCalledTimes(1);
  expect(q.reviewRepair).toMatchObject({ status: 'consistent', corrected: false, changes: [] });
});

it.each(['sourceSupport', 'notation', 'achievedDifficulty', 'answer', 'challenge', 'premises', 'comparison'] as const)(
  'holds changed %s judgments instead of accepting a syntactically repaired review', async field => {
    const i = input(), first = review(i), second = review(i);
    first.citations[0].spanIds = ['S9999'];
    if (field === 'sourceSupport') first.sourceSupport = 'unsupported';
    if (field === 'notation') first.notation = 'inconsistent';
    if (field === 'achievedDifficulty') first.achievedDifficulty = 'hard';
    if (field === 'answer') first.answerability.options[0].verdict = 'fully-correct';
    if (field === 'challenge') first.answerability.options[0].exclusion!.challenge.status = 'viable';
    if (field === 'premises') (first.missingPremises as string[]).push('SCRIPTED unresolved necessary premise.');
    if (field === 'comparison') { first.taskComparisons[0].sameInference = true; first.taskComparisons[0].sameSolutionPath = true; }
    jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const q = await assessGenerationQuality(i);
    expect(q.status).toBe('withheld'); expect(q.reviewRepair?.status).toBe('drift');
    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(buildGenerationSemanticRepairPlan({ ...i, assessment: q })).toBeUndefined();
  });

it('allows filling an invalid enum while preserving other valid judgments', async () => {
  const i = input(), first = review(i); first.notation = 'invalid-transport-value';
  jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(review(i));
  const q = await assessGenerationQuality(i);
  expect(q.status).toBe('eligible'); expect(q.reviewRepair?.status).toBe('consistent');
  expect(completeJson).toHaveBeenCalledTimes(2);
});

const defect = () => ({ kind: 'source-scope', target: 'stem', status: 'defect',
  observation: 'SCRIPTED ungrounded actor relationship.', correction: 'Remove that unsupported relationship.', sourceSpanIds: ['S9999'], memoryEntryIds: [] });
it.each(['invalid-reference', 'malformed-neighbor'] as const)(
  'retains a negative finding through %s schema repair instead of letting it disappear', async shape => {
    const i = input(), first = review(i) as Record<string, unknown>;
    first.findings = shape === 'invalid-reference' ? [defect()] : [defect(), { kind: 'invalid-neighbor' }];
    jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(review(i));
    const q = await assessGenerationQuality(i);
    expect(q.status).toBe('withheld'); expect(q.reviewRepair?.status).toBe('drift');
    expect(q.reviewRepair?.changes.some(change => change.path.startsWith('findings.'))).toBe(true);
    expect(completeJson).toHaveBeenCalledTimes(2);
  });

it('permits repairing a negative finding reference without erasing the negative judgment', async () => {
  const i = input(), first = review(i) as Record<string, unknown>, second = review(i) as Record<string, unknown>;
  first.findings = [defect()]; second.findings = [{ ...defect(), sourceSpanIds: ['S1'] }];
  jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const q = await assessGenerationQuality(i);
  expect(q.status).toBe('withheld'); expect(q.reviewRepair?.status).toBe('consistent');
  expect(q.findings).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'defect', observation: defect().observation })]));
});

it('retains a valid necessary premise beside a malformed neighboring premise', async () => {
  const i = input(), first = review(i) as Record<string, unknown>;
  first.missingPremises = ['A necessary SCRIPTED convention is missing.', null];
  jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(review(i));
  const q = await assessGenerationQuality(i);
  expect(q.status).toBe('withheld'); expect(q.reviewRepair?.status).toBe('drift');
});

it.each(['blank-premise', 'blank-finding', 'wrong-answer-kind', 'extra-stem-truth'] as const)(
  'allows correction of an invalid %s field without inventing a prior valid decision', async shape => {
    const i = input(), first = review(i) as Record<string, unknown>;
    if (shape === 'blank-premise') first.missingPremises = ['  '];
    if (shape === 'blank-finding') first.findings = [{ ...defect(), observation: '   ' }];
    if (shape === 'wrong-answer-kind') first.answerability = { kind: 'true-false', stemTruth: 'true', reason: 'Wrong shape.', spanIds: ['S1'] };
    if (shape === 'extra-stem-truth') (first.answerability as Record<string, unknown>).stemTruth = 'true';
    jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(review(i));
    const q = await assessGenerationQuality(i);
    expect(q.status).toBe('eligible'); expect(q.reviewRepair?.status).toBe('consistent');
    expect(reviewRepairReceiptMatches(q, i.requirements, q.candidate!, i.packet, ['prior-bank-version'])).toBe(true);
  });

it.each(['answer', 'comparison', 'teacher-change', 'teacher-invariant'] as const)(
  'does not resolve conflicting duplicate %s decisions by choosing the convenient last row', async shape => {
    const i = input(), first = review(i) as Record<string, unknown>, second = review(i) as Record<string, unknown>;
    if (shape === 'answer') {
      const answer = first.answerability as ReturnType<typeof review>['answerability'];
      answer.options.unshift({ ...answer.options[0], verdict: 'fully-correct' });
    }
    if (shape === 'comparison') (first.taskComparisons as unknown[]).unshift({ entryId: 'M1', sameInference: true, sameSolutionPath: true, contrast: 'Conflicting SCRIPTED comparison.' });
    if (shape === 'teacher-change') {
      i.requirements.requiredChanges = ['Use the supplied notation.'];
      first.changes = [{ requirement: i.requirements.requiredChanges[0], status: 'unfulfilled', reason: 'Initial SCRIPTED defect.' },
        { requirement: i.requirements.requiredChanges[0], status: 'fulfilled', reason: 'Conflicting SCRIPTED fulfillment.' }];
      second.changes = [(first.changes as unknown[])[1]];
      (first.citations as ReturnType<typeof review>['citations'])[0].spanIds = ['S9999'];
    }
    if (shape === 'teacher-invariant') {
      i.requirements.preserve = ['Keep the taught scope.'];
      first.invariants = [{ requirement: i.requirements.preserve[0], status: 'violated', reason: 'Initial SCRIPTED defect.' },
        { requirement: i.requirements.preserve[0], status: 'preserved', reason: 'Conflicting SCRIPTED invariant.' }];
      second.invariants = [(first.invariants as unknown[])[1]];
      (first.citations as ReturnType<typeof review>['citations'])[0].spanIds = ['S9999'];
    }
    jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const q = await assessGenerationQuality(i);
    expect(q.status).toBe('withheld'); expect(q.reviewRepair?.status).toBe('drift');
    expect(Object.values(q.reviewRepair!.before).some(value => typeof value === 'string' && value.startsWith('conflict:'))).toBe(true);
  });

it('allows deduplicating identical option judgments without changing their semantics', async () => {
  const i = input(), first = review(i); first.answerability.options.push(structuredClone(first.answerability.options[0]));
  jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(review(i));
  const q = await assessGenerationQuality(i);
  expect(q.status).toBe('eligible'); expect(q.reviewRepair?.status).toBe('consistent');
});

it('normalizes schema-trimmed text and ignores wrong-kind extra decisions for T/F', () => {
  const candidate = { ...input().candidate, type: 'true-false' as const };
  const first = captureReviewDecisions({ missingPremises: ['  A taught premise.  '],
    answerability: { kind: 'true-false', stemTruth: 'false', options: review().answerability.options },
    findings: [{ ...defect(), observation: '  Same defect.  ', correction: '  Same correction.  ' }] }, candidate);
  const second = captureReviewDecisions({ missingPremises: ['A taught premise.'],
    answerability: { kind: 'true-false', stemTruth: 'false' }, findings: [{ ...defect(), observation: 'Same defect.', correction: 'Same correction.' }] }, candidate);
  expect(second).toEqual(first); expect(Object.keys(first).some(key => key.includes('verdict'))).toBe(false);
});

it('retains every exact code/path and duplicate through indexed correction metadata', () => {
  const issues = [
    ...[0, 1, 2, 3].map(index => ({ code: 'answer-evidence-invalid', path: `answerability.options.${index}.spanIds` })),
    ...[0, 1, 2].map(index => ({ code: 'answer-evidence-invalid', path: `answerability.options.${index}.exclusion.challenge.spanIds` })),
    { code: 'answer-evidence-invalid', path: 'answerability.options.0.spanIds' },
    { code: 'schema', path: 'answerability.options.01.stemQuote' },
    { code: 'schema', path: 'answerability.options.99999999999999999.stemQuote' },
    { code: 'citation', path: 'citations' },
  ];
  const encoded = JSON.parse(renderExclusionReviewCorrectionIssues(issues, true)) as [string, string, (string | [string, number[]])[]][];
  const decoded = encoded.flatMap(([code, prefix, suffixes]) => suffixes.flatMap(suffix => typeof suffix === 'string'
    ? [{ code, path: prefix + suffix }] : suffix[1].map(index => ({ code, path: prefix + index + suffix[0] }))));
  const key = (row: { code: string; path: string }) => JSON.stringify([row.code, row.path]);
  expect(decoded.map(key).sort()).toEqual(issues.map(key).sort());
  expect(Buffer.byteLength(renderExclusionReviewCorrectionIssues(issues, true))).toBeLessThan(Buffer.byteLength(renderExclusionReviewCorrectionIssues(issues)));
});

it.each([null, 'unknown-protocol'] as const)('refuses an explicit invalid repair selector %s before dispatch', async protocol => {
  const i = input(); (i.requirements as unknown as Record<string, unknown>).reviewRepairProtocol = protocol;
  await expect(assessGenerationQuality(i)).rejects.toThrow('generation-review-repair-protocol-invalid');
  expect(completeJson).not.toHaveBeenCalled();
});

it('keeps the absent historical correction branch unchanged', async () => {
  const i = input(); delete i.requirements.reviewRepairProtocol;
  const first = review(i); first.novelty = 'duplicate'; first.taskComparisons = [];
  jest.mocked(completeJson).mockResolvedValueOnce(first).mockResolvedValueOnce(review(i));
  const q = await assessGenerationQuality(i);
  expect(q.status).toBe('eligible'); expect(q.reviewRepair).toBeUndefined();
  expect(jest.mocked(completeJson).mock.calls[1][0]).not.toContain('SCHEMA REPAIR ONLY');
});

it.each(['candidate', 'source', 'teacher', 'decision', 'receipt'] as const)('refuses final admission after changed %s binding', async change => {
  const i = input(); jest.mocked(completeJson).mockResolvedValue(review(i));
  const q = await assessGenerationQuality(i), c = q.candidate!;
  if (change === 'candidate') c.stem += ' changed';
  if (change === 'source') i.packet.passages[0].text += ' changed';
  if (change === 'teacher') i.requirements.requiredChanges.push('New teacher requirement.');
  if (change === 'decision') q.novelty = 'duplicate';
  if (change === 'receipt' && q.reviewRepair) q.reviewRepair.before.novelty = 'uncertain';
  expect(reviewRepairReceiptMatches(q, i.requirements, c, i.packet, ['prior-bank-version'])).toBe(false);
});
