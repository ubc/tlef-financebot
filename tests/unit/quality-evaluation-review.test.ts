jest.mock('node:crypto', () => ({ ...jest.requireActual('node:crypto'), randomInt: jest.fn(() => 0) }));

import { randomInt } from 'node:crypto';
import {
  DatasetSchema, hashValue, type EvaluationContext, type EvaluationDataset,
  type EvaluationQuestion, type ReviewCard, type ReviewFile, type TeacherLabel,
} from '../../scripts/prompt-ab/evaluation/schema';
import { buildReviewCard, createBlindReview, renderReviewHtml, reviewCardHash } from '../../scripts/prompt-ab/evaluation/review';

function question(stem = 'Which input measures systematic risk in CAPM?'): EvaluationQuestion {
  return { type: 'mcq', stem, options: [
    { key: 'A', text: 'Beta', role: 'correct', explanation: 'CAPM uses beta to measure systematic risk.' },
    { key: 'B', text: 'Total volatility', role: 'common-misconception', explanation: 'Total volatility includes diversifiable risk.' },
  ], numericKind: 'conceptual' };
}

function dataset(): EvaluationDataset {
  const context: EvaluationContext = { objective: 'Distinguish systematic risk from total volatility.',
    request: { type: 'mcq', difficulty: 'easy', count: 4, instruction: 'Use the supplied notation.' },
    sources: [{ id: 'PRIVATE-SOURCE-ID', role: 'primary', text: 'CAPM uses beta for systematic risk; total volatility also includes diversifiable risk.' }],
    bank: [{ id: 'PRIVATE-BANK-ID', content: question('What does beta measure?') }],
    coverage: { sourcesComplete: true, bankComplete: true, notes: ['PRIVATE-CONTEXT-NOTE: baseline verdict fail'] },
  };
  const slots = [0, 1, 2, 3].map(item => ({ item,
    outcome: item === 2 ? 'missing' as const : 'saved' as const,
    candidate: item === 2 ? null : { content: question(`Candidate ${item + 1}`), contentHash: hashValue(question(`Candidate ${item + 1}`)), truncated: item === 1 },
    automatic: { sourceScope: 'pass' as const, notation: 'fail' as const, duplication: 'uncertain' as const, gate: 'withheld' as const },
    numerical: 'not-applicable' as const, limitations: ['PRIVATE-SLOT-LIMITATION'],
  }));
  return DatasetSchema.parse({ schemaVersion: 'financebot-quality-evaluation-v1', experimentId: 'PRIVATE-EXPERIMENT-ID',
    origin: 'synthetic', rubricVersion: 'financebot-teacher-v1', cases: [{ caseId: 'PRIVATE-CASE-ID', repetitions: 1, context }],
    runs: ['baseline', 'grounded-memory-v1'].map((policy, index) => ({ runId: `PRIVATE-RUN-${index}`, caseId: 'PRIVATE-CASE-ID', repetition: 1, policy,
      contextHash: hashValue(context), comparison: { contextTiming: 'synthetic', isolated: true, controlsHash: hashValue('PRIVATE-CONTROLS') },
      requestedSlots: 4, slots: structuredClone(slots), usage: { status: 'complete', inputTokens: 987654, outputTokens: 87654, totalTokens: 1075308, observedCalls: 4, unknownCalls: 0, pendingCalls: 0, coverageGaps: 0, untracked: false },
      elapsedMs: 76543, limitations: ['PRIVATE-RUN-LIMITATION'],
    })), limitations: ['PRIVATE-DATASET-LIMITATION'],
  });
}

function label(card: ReviewCard, patch: Partial<TeacherLabel> = {}): TeacherLabel {
  return { reviewId: card.reviewId, reviewHash: card.reviewHash, sourceScope: null, notation: null, duplication: null,
    difficulty: null, answerQuality: null, disposition: null, reviewMinutes: null, evidenceRefs: [], notes: '', ...patch };
}

describe('blinded quality review construction', () => {
  it('creates random review identities, a separately bound key and an unpopulated review file', () => {
    const input = dataset();
    const first = createBlindReview(input); const second = createBlindReview(input);
    expect(first.bundle.cards).toHaveLength(8);
    expect(first.key.datasetHash).toBe(hashValue(input));
    expect(first.key.reviewSetId).toBe(first.bundle.reviewSetId);
    expect(first.reviews).toMatchObject({ reviewSetId: first.bundle.reviewSetId, reviewerId: 'unassigned', labels: [] });
    expect(first.bundle.reviewSetId).not.toBe(second.bundle.reviewSetId);
    expect(new Set(first.bundle.cards.map(card => card.reviewId)).size).toBe(8);
    expect(first.bundle.cards.every(card => /^[a-f0-9-]{36}$/.test(card.reviewId))).toBe(true);
    expect(randomInt).toHaveBeenCalledWith(8);
    expect(first.bundle.cards.map(card => card.reviewId)).not.toEqual(first.key.entries.map(entry => entry.reviewId));
  });

  it('explicitly projects anonymous context and excludes every private diagnostic field', () => {
    const { bundle, key, reviews } = createBlindReview(dataset());
    const serialized = JSON.stringify(bundle);
    for (const secret of ['PRIVATE-', 'baseline', 'grounded-memory-v1', '987654', '76543', 'automatic', 'numerical', 'outcome', 'contextTiming', 'controlsHash', 'datasetHash']) expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('"runId"');
    expect(serialized).not.toContain('"item"');
    expect(serialized).not.toContain('"policy"');
    expect(serialized).not.toContain('"usage"');
    expect(serialized).not.toContain('"reasons"');
    expect(key.entries.every(entry => entry.runId.startsWith('PRIVATE-RUN-'))).toBe(true);
    for (const card of bundle.cards) {
      expect(card.context.sources[0].id).toBe('S1'); expect(card.context.bank[0].id).toBe('Q1');
      expect(card.context.coverage.notes).toEqual([]);
      expect(Object.keys(card).sort()).toEqual(['candidate', 'context', 'earlierCandidates', 'limitations', 'reviewHash', 'reviewId', 'reviewable']);
    }
    const html = renderReviewHtml(bundle, reviews);
    expect(html).not.toContain('PRIVATE-');
    expect(html).not.toContain(key.datasetHash);
  });

  it('binds each card independently of review IDs, display order and object-key order', () => {
    const input = dataset(); const result = createBlindReview(input);
    result.bundle.cards.reverse();
    for (const card of result.bundle.cards) {
      expect(reviewCardHash({ ...card, reviewId: 'a-different-random-id' })).toBe(card.reviewHash);
      const entry = result.key.entries.find(row => row.reviewId === card.reviewId)!;
      const run = input.runs.find(row => row.runId === entry.runId)!;
      expect(buildReviewCard(input, run, run.slots.find(slot => slot.item === entry.item)! ).reviewHash).toBe(entry.reviewHash);
    }
    const original = input.cases[0].context;
    expect(hashValue({ coverage: original.coverage, bank: original.bank, sources: original.sources, request: original.request, objective: original.objective })).toBe(hashValue(original));
  });

  it('binds current candidate, projected teaching context and complete earlier candidates', () => {
    const input = dataset(); const run = input.runs[0]; const current = run.slots[3];
    const before = buildReviewCard(input, run, current).reviewHash;
    run.slots.reverse();
    expect(buildReviewCard(input, run, current).reviewHash).toBe(before);
    const earlier = run.slots.find(slot => slot.item === 0)!.candidate!;
    earlier.content.stem = 'A changed earlier reasoning task'; earlier.contentHash = hashValue(earlier.content);
    expect(buildReviewCard(input, run, current).reviewHash).not.toBe(before);
    const afterEarlier = buildReviewCard(input, run, current).reviewHash;
    current.candidate!.content.stem += ' changed'; current.candidate!.contentHash = hashValue(current.candidate!.content);
    expect(buildReviewCard(input, run, current).reviewHash).not.toBe(afterEarlier);
    const afterCandidate = buildReviewCard(input, run, current).reviewHash;
    input.cases[0].context.request.instruction += ' Use decimal rates.'; run.contextHash = hashValue(input.cases[0].context);
    expect(buildReviewCard(input, run, current).reviewHash).not.toBe(afterCandidate);
  });

  it('does not expose later candidates or bind automatic verdicts to a human card', () => {
    const input = dataset(); const run = input.runs[0];
    const before = buildReviewCard(input, run, run.slots[0]);
    run.slots[3].candidate!.content.stem = 'A future changed candidate';
    run.slots[3].candidate!.contentHash = hashValue(run.slots[3].candidate!.content);
    run.slots[0].automatic.gate = 'eligible'; run.slots[0].outcome = 'withheld';
    expect(buildReviewCard(input, run, run.slots[0])).toEqual(before);
  });

  it('includes complete earlier candidates with B identities and makes excluded comparisons explicit', () => {
    const input = dataset(); const card = buildReviewCard(input, input.runs[0], input.runs[0].slots[3]);
    expect(card.earlierCandidates.map(row => row.id)).toEqual(['B1']);
    expect(card.limitations).toContain('Earlier batch context is incomplete: 1 missing candidate snapshots; 1 truncated snapshots. These snapshots are excluded from comparison.');
    expect(card.reviewable).toBe(true);
  });

  it.each(['missing', 'truncated', 'context-mismatch', 'context-unrecorded'] as const)('permits triage only for %s', condition => {
    const input = dataset(); const run = input.runs[0]; const slot = run.slots[0];
    if (condition === 'missing') slot.candidate = null;
    if (condition === 'truncated') slot.candidate!.truncated = true;
    if (condition === 'context-mismatch') run.contextHash = hashValue('a different context');
    if (condition === 'context-unrecorded') run.contextHash = null;
    const card = buildReviewCard(input, run, slot);
    expect(card.reviewable).toBe(false);
    expect(card.limitations.join(' ')).toContain('triage, notes and active review time only');
  });

  it('keeps incomplete source and bank coverage visible without supplying a judgment', () => {
    const input = dataset(); const run = input.runs[0];
    input.cases[0].context.coverage.sourcesComplete = false; input.cases[0].context.coverage.bankComplete = false;
    run.contextHash = hashValue(input.cases[0].context);
    const card = buildReviewCard(input, run, run.slots[0]);
    expect(card.reviewable).toBe(true);
    expect(card.limitations).toEqual(['The source snapshot is incomplete.', 'The question-bank snapshot is incomplete.']);
    expect(card.context.coverage.notes).toEqual(card.limitations);
  });

  it('rejects more than 500 observed slots before allocating or shuffling blind cards', () => {
    const input = dataset(); input.cases[0].repetitions = 64;
    const arms = input.runs;
    input.runs = Array.from({ length: 64 }, (_, index) => arms.map(run => ({ ...structuredClone(run), repetition: index + 1, runId: `${run.runId}-${index}` }))).flat();
    expect(input.runs.reduce((sum, run) => sum + run.slots.length, 0)).toBe(512);
    expect(() => createBlindReview(input)).toThrow('exceeds 500 cards. Split the dataset');
    expect(randomInt).not.toHaveBeenCalled();
  });

  it('caps repeated projected source context at 25 MiB before rendering a large HTML file', () => {
    const input = dataset();
    input.cases[0].context.sources = Array.from({ length: 100 }, (_, index) => ({ id: `large-source-${index}`, role: 'primary' as const, text: 'x'.repeat(40000) }));
    input.runs.forEach(run => { run.contextHash = hashValue(input.cases[0].context); });
    expect(() => createBlindReview(input)).toThrow('exceeds 25 MiB of projected card data. Split the dataset');
    expect(randomInt).not.toHaveBeenCalled();
  });
});

describe('standalone offline review HTML', () => {
  it('escapes malicious closing tags, markup, ampersands and Unicode script separators', () => {
    const input = dataset(); const payload = '</script><script>window.pwned=true</script><img src="https://attacker.invalid"> & \u2028 \u2029';
    input.cases[0].context.objective = payload;
    input.cases[0].context.sources[0].text = payload;
    input.cases[0].context.bank[0].content.options[0].explanation = payload;
    for (const run of input.runs) {
      run.contextHash = hashValue(input.cases[0].context);
      run.slots[0].candidate!.content.stem = payload;
      run.slots[0].candidate!.contentHash = hashValue(run.slots[0].candidate!.content);
    }
    const { bundle, reviews } = createBlindReview(input);
    const card = bundle.cards.find(row => row.reviewable)!;
    const html = renderReviewHtml(bundle, { ...reviews, reviewerId: payload, labels: [label(card, { notes: payload })] });
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain(payload);
    expect(html).toContain('\\u003c/script\\u003e');
    expect(html).toContain('\\u0026'); expect(html).toContain('\\u2028'); expect(html).toContain('\\u2029');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).toContain("default-src 'none'");
  });

  it('renders a matching manual review for resume without filling other cards', () => {
    const { bundle, reviews } = createBlindReview(dataset());
    const card = bundle.cards.find(row => row.reviewable)!;
    const manual: ReviewFile = { ...reviews, reviewerId: 'teacher-a', labels: [label(card, { notation: 'uncertain', reviewMinutes: 0, evidenceRefs: ['S1'], notes: 'Check source notation.' })] };
    const html = renderReviewHtml(bundle, manual);
    expect(html).toContain('Check source notation.');
    expect(html).toContain('"notation":"uncertain"');
    expect(html).toContain('"reviewMinutes":0');
    expect(html).not.toContain('"sourceScope":"absent"');
  });

  it.each(['unknown-id', 'stale-hash', 'duplicate-label', 'unknown-reference', 'other-review-set'] as const)('rejects %s before rendering previous reviews', condition => {
    const { bundle, reviews } = createBlindReview(dataset());
    const card = bundle.cards.find(row => row.reviewable)!;
    const entry = label(card); const file = { ...reviews, reviewerId: 'teacher-a', labels: [entry] };
    if (condition === 'unknown-id') entry.reviewId = 'unknown';
    if (condition === 'stale-hash') entry.reviewHash = hashValue('stale');
    if (condition === 'duplicate-label') file.labels.push({ ...entry });
    if (condition === 'unknown-reference') entry.evidenceRefs = ['PRIVATE-SOURCE-ID'];
    if (condition === 'other-review-set') file.reviewSetId = 'another-set';
    expect(() => renderReviewHtml(bundle, file)).toThrow();
  });

  it('accepts manual triage for incomplete cards and rejects quality or positive disposition labels', () => {
    const { bundle, reviews } = createBlindReview(dataset()); const card = bundle.cards.find(row => !row.reviewable)!;
    expect(() => renderReviewHtml(bundle, { ...reviews, reviewerId: 'teacher-a', labels: [label(card, { disposition: 'source-shortfall', reviewMinutes: 2.5, notes: 'Missing context.' })] })).not.toThrow();
    for (const patch of [{ sourceScope: 'uncertain' as const }, { disposition: 'accepted' as const }, { disposition: 'intentional-variant' as const }]) {
      expect(() => renderReviewHtml(bundle, { ...reviews, reviewerId: 'teacher-a', labels: [label(card, patch)] })).toThrow('triage');
    }
  });

  it('requires a nonblank assigned reviewer for entered decisions, time, notes or references', () => {
    const { bundle, reviews } = createBlindReview(dataset()); const card = bundle.cards.find(row => row.reviewable)!;
    expect(() => renderReviewHtml(bundle, { ...reviews, reviewerId: '   ' })).toThrow('Reviewer identifier cannot be blank');
    for (const patch of [{ sourceScope: 'absent' as const }, { disposition: 'accepted' as const }, { reviewMinutes: 0 }, { notes: 'Manual note.' }, { evidenceRefs: ['S1'] }]) {
      expect(() => renderReviewHtml(bundle, { ...reviews, labels: [label(card, patch)] })).toThrow('Assign an anonymized reviewer');
    }
    expect(() => renderReviewHtml(bundle, { ...reviews, labels: [label(card)] })).not.toThrow();
  });
});
