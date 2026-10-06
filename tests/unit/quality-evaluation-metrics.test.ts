import { summarizeEvaluation } from '../../scripts/prompt-ab/evaluation/metrics';
import { hashValue } from '../../scripts/prompt-ab/evaluation/schema';
import type { EvaluationDataset, EvaluationQuestion, EvaluationRun, TeacherLabel } from '../../scripts/prompt-ab/evaluation/schema';
import type { ResolvedReview } from '../../scripts/prompt-ab/evaluation/metrics';

function question(index: number): EvaluationQuestion {
  return { type: 'mcq', stem: `Synthetic task ${index}: What does beta measure?`, options: [
    { key: 'A', text: 'Systematic risk', role: 'correct', explanation: 'The supplied notes associate beta with systematic risk.' },
    { key: 'B', text: 'Total risk', role: 'common-misconception', explanation: 'Total risk includes diversifiable risk.' },
  ] };
}
function dataset(): EvaluationDataset {
  const context = {
    objective: 'Distinguish systematic risk.', request: { type: 'mcq' as const, difficulty: 'easy' as const, count: 4, instruction: '' },
    sources: [{ id: 'S1', role: 'primary' as const, text: 'Beta measures systematic risk.' }], bank: [],
    coverage: { sourcesComplete: true, bankComplete: true, notes: [] },
  };
  const run = (policy: EvaluationRun['policy']): EvaluationRun => ({
    runId: policy, caseId: 'case-1', repetition: 1, policy, contextHash: hashValue(context),
    comparison: { contextTiming: 'before-generation', isolated: true, controlsHash: hashValue({ model: 'synthetic-model', maxCalls: 12 }) },
    requestedSlots: 4,
    slots: Array.from({ length: 4 }, (_, item) => ({ item, outcome: 'saved',
      candidate: { content: question(item), contentHash: hashValue(question(item)), truncated: false },
      automatic: { sourceScope: 'pass', notation: 'pass', duplication: 'pass', gate: 'eligible' },
      numerical: 'not-applicable', limitations: [],
    })),
    usage: { status: 'complete', inputTokens: 100, outputTokens: 20, totalTokens: 120, observedCalls: 12, unknownCalls: 0, pendingCalls: 0, coverageGaps: 0, untracked: false },
    elapsedMs: 1000, limitations: [],
  });
  return { schemaVersion: 'financebot-quality-evaluation-v1', experimentId: 'metrics-fixture', origin: 'recorded', rubricVersion: 'financebot-teacher-v1',
    cases: [{ caseId: 'case-1', repetitions: 1, context }], runs: [run('baseline'), run('grounded-memory-v1')], limitations: [] };
}
function label(runId: string, item: number, patch: Partial<TeacherLabel> = {}): ResolvedReview {
  return { runId, item, label: {
    reviewId: `review-${runId}-${item}`, reviewHash: hashValue([runId, item]),
    sourceScope: 'absent', notation: 'absent', duplication: 'absent', difficulty: 'absent', answerQuality: 'absent',
    disposition: 'accepted', reviewMinutes: 1, evidenceRefs: ['S1'], notes: 'Synthetic teacher-label fixture.', ...patch,
  } };
}
function allReviews(data: EvaluationDataset): ResolvedReview[] {
  return data.runs.flatMap(run => run.slots.map(slot => label(run.runId, slot.item)));
}
function arm(data: EvaluationDataset, reviews: ResolvedReview[] = [], policy: EvaluationRun['policy'] = 'baseline') {
  return summarizeEvaluation(data, reviews).arms.find(value => value.policy === policy)!;
}

describe('offline quality evaluation metrics', () => {
  it('keeps teacher labels absent instead of treating automatic eligibility as acceptance', () => {
    const result = summarizeEvaluation(dataset(), []);
    expect(result.arms[0].outcomes.saved).toBe(4);
    expect(result.arms[0].supply).toMatchObject({ acceptedIndependent: 0, provisionalUnmetIndependentSlots: 4, unresolvedSupplyLabels: 4 });
    expect(result.arms[0].issues.sourceScope).toMatchObject({ present: 0, absent: 0, uncertain: 0, unreviewed: 4 });
    expect(result.arms[0].reviewTime.recordedMinutes).toBeNull();
    expect(result.arms[0].usage.recordedTokensPerAcceptedIndependent).toBeNull();
    expect(result.comparison.teacherLabelsComplete).toBe(false);
  });

  it('uses manifest slots as fixed denominators and does not improve supply by suppressing output', () => {
    const data = dataset();
    data.runs[1].slots[1].outcome = 'withheld';
    data.runs[1].slots[2].outcome = 'failed';
    data.runs[1].slots[3].outcome = 'missing';
    const reviews = [label('grounded-memory-v1', 0)];
    const pilot = arm(data, reviews, 'grounded-memory-v1');
    expect(pilot.outcomes).toEqual({ saved: 1, withheld: 1, failed: 1, missing: 1 });
    expect(pilot.supply.acceptedIndependentPerRequested).toEqual({ numerator: 1, denominator: 4, value: 0.25 });
    expect(pilot.supply.provisionalUnmetIndependentSlots).toBe(3);
    expect(pilot.usage.totalTokens).toBe(120);
  });

  it('counts only saved independent adoptions while separating edits and variants', () => {
    const data = dataset();
    const reviews = [label('baseline', 0), label('baseline', 1, { disposition: 'edited', sourceScope: 'present' }),
      label('baseline', 2, { disposition: 'intentional-variant', duplication: 'present' }), label('baseline', 3, { duplication: 'uncertain' })];
    const summary = arm(data, reviews);
    expect(summary.supply).toMatchObject({ acceptedIndependent: 2, acceptedUnedited: 1, acceptedAfterEdits: 1, intentionalVariantsSaved: 1, unresolvedSupplyLabels: 1 });
    expect(summary.issues.sourceScope.present).toBe(1);
    expect(summary.issues.duplication).toMatchObject({ present: 1, absent: 2, uncertain: 1, unreviewed: 0 });
    expect(summary.supply.acceptedIndependentPerRequested.value).toBe(0.5);
    expect(summary.reviewTime.recordedMinutesPerAcceptedIndependent).toBe(2);
  });

  it('does not inflate delivered supply when a teacher likes a withheld candidate', () => {
    const data = dataset();
    data.runs[0].slots[0].outcome = 'withheld';
    data.runs[0].slots[0].automatic.gate = 'withheld';
    const summary = arm(data, [label('baseline', 0)]);
    expect(summary.supply.acceptedIndependent).toBe(0);
    expect(summary.supply.teacherAcceptableWithheld).toBe(1);
    expect(summary.judge.gate.automaticFailTeacherPass).toBe(1);
    expect(summary.usage.recordedTokensPerAcceptedIndependent).toBeNull();
  });

  it('keeps saved-output incidence separate from all-candidate incidence and recommendation', () => {
    const data = dataset();
    data.runs[0].slots[0].outcome = 'withheld';
    data.runs[0].slots[1].automatic.gate = 'withheld';
    const summary = arm(data, [label('baseline', 0, { sourceScope: 'present' }), label('baseline', 1, { sourceScope: 'present' }), label('baseline', 2)]);
    expect(summary.issues.sourceScope.present).toBe(2);
    expect(summary.savedOutputIssues.sourceScope.present).toBe(1);
    expect(summary.savedOutputIssues.sourceScope.unreviewed).toBe(1);
    expect(summary.savedOutputIssues.sourceScope.presentPerResolved.value).toBe(0.5);
  });

  it('makes uncertainty and review coverage explicit in issue rates', () => {
    const summary = arm(dataset(), [label('baseline', 0, { notation: 'present' }), label('baseline', 1), label('baseline', 2, { notation: 'uncertain' })]);
    expect(summary.issues.notation).toEqual({
      present: 1, absent: 1, uncertain: 1, unreviewed: 1,
      presentPerResolved: { numerator: 1, denominator: 2, value: 0.5 },
      presentPerReviewed: { numerator: 1, denominator: 3, value: 1 / 3 },
    });
    expect(summary.reviewCoverage).toMatchObject({ qualityReviewedSlots: 3, completeIssueLabels: 3, fullyResolvedIssueLabels: 2, unreviewedSlots: 1, unresolvedIssueLabels: 2 });
  });

  it('ignores quality/adoption labels for absent or truncated candidates but includes failure triage time', () => {
    const data = dataset();
    data.runs[0].slots[0].candidate = null;
    data.runs[0].slots[0].outcome = 'failed';
    data.runs[0].slots[1].candidate!.truncated = true;
    const summary = arm(data, [label('baseline', 0, { reviewMinutes: 2, disposition: 'source-shortfall' }), label('baseline', 1, { reviewMinutes: 3 })]);
    expect(summary.supply.acceptedIndependent).toBe(0);
    expect(summary.issues.sourceScope.absent).toBe(0);
    expect(summary.reviewCoverage.ignoredIllegalQualityLabels).toBe(2);
    expect(summary.reviewTime).toMatchObject({ recordedMinutes: 5, knownSlots: 2, missingSlots: 2, status: 'partial' });
    expect(summary.judge.contextExcludedSlots).toBe(2);
    expect(summary.judge.gate.unassessed).toBe(4);
  });

  it('ignores purported quality labels when the run does not bind the supplied context', () => {
    const data = dataset();
    data.runs[0].contextHash = hashValue('different-context');
    const summary = arm(data, [label('baseline', 0)]);
    expect(summary.candidates.contextMismatch).toBe(4);
    expect(summary.supply.acceptedIndependent).toBe(0);
    expect(summary.issues.duplication.unreviewed).toBe(4);
  });

  it('deduplicates identical review delivery and leaves conflicting reviews unresolved', () => {
    const first = label('baseline', 0);
    const conflicting = label('baseline', 1, { sourceScope: 'present' });
    const result = summarizeEvaluation(dataset(), [first, first, label('baseline', 1), conflicting, label('unknown-run', 0)]);
    expect(result.reviewImport).toEqual({ supplied: 5, retainedSlots: 1, unknownSlotsIgnored: 1, duplicateLabels: 2, conflictingSlots: 1 });
    expect(result.arms[0].supply.acceptedIndependent).toBe(1);
    expect(result.arms[0].issues.sourceScope).toMatchObject({ absent: 1, present: 0, unreviewed: 3 });
    expect(result.arms[0].reviewTime.recordedMinutes).toBe(1);
  });

  it('retains whole missing repetitions and missing arms in supply and measurement coverage', () => {
    const data = dataset();
    data.cases[0].repetitions = 2;
    data.runs.pop();
    const result = summarizeEvaluation(data, []);
    expect(result.arms[0]).toMatchObject({ expectedRuns: 2, observedRuns: 1, missingRuns: 1, requestedSlots: 8, outcomes: { saved: 4, missing: 4 } });
    expect(result.arms[1]).toMatchObject({ expectedRuns: 2, observedRuns: 0, missingRuns: 2, requestedSlots: 8, outcomes: { missing: 8 } });
    expect(result.arms[1].usage).toMatchObject({ status: 'unavailable', totalTokens: null, missingRunMeasurements: 2 });
    expect(result.arms[0].usage).toMatchObject({ status: 'partial', totalTokens: 120, missingRunMeasurements: 1 });
    expect(result.arms[0].latency).toMatchObject({ knownRuns: 1, missingRuns: 1 });
    expect(result.comparison.excludedPairs[1].reasons).toEqual(['missing-baseline-run', 'missing-pilot-run']);
  });

  it('includes a declared case with no observed runs', () => {
    const data = dataset();
    data.cases.push({ ...data.cases[0], caseId: 'case-2' });
    const result = summarizeEvaluation(data, []);
    expect(result.cases[1].arms[0]).toMatchObject({ requestedSlots: 4, outcomes: { missing: 4 } });
    expect(result.comparison.excludedPairs).toEqual([{ caseId: 'case-2', repetition: 1, reasons: ['missing-baseline-run', 'missing-pilot-run'] }]);
  });

  it('adds all-run usage despite failures and withheld outputs, keeping partial field coverage', () => {
    const data = dataset();
    data.cases[0].repetitions = 2;
    const second = structuredClone(data.runs[0]);
    second.runId = 'baseline-repeat-2'; second.repetition = 2;
    second.slots.forEach(slot => { slot.outcome = 'failed'; slot.candidate = null; });
    second.usage = { status: 'partial', inputTokens: 300, outputTokens: null, totalTokens: null, observedCalls: 4, unknownCalls: 4, pendingCalls: 0, coverageGaps: 1, untracked: true };
    second.elapsedMs = null;
    data.runs.push(second);
    const summary = arm(data, [label('baseline', 0)]);
    expect(summary.usage).toMatchObject({ status: 'partial', inputTokens: 400, outputTokens: 20, totalTokens: 120, observedCalls: 16, unknownCalls: 4, coverageGaps: 1, untrackedRuns: 1, ratioBasis: 'recorded-subtotal-only' });
    expect(summary.usage.fieldCoverage.totalTokens).toMatchObject({ knownRuns: 1, missingRuns: 1, recordedSubtotal: 120 });
    expect(summary.usage.recordedTokensPerAcceptedIndependent).toBe(120);
    expect(summary.outcomes.failed).toBe(4);
    expect(summary.latency).toMatchObject({ recordedTotalMs: 1000, knownRuns: 1, missingRuns: 1, meanKnownMs: 1000 });
  });

  it('distinguishes tracked zero from unknown usage and pending measurement', () => {
    const data = dataset();
    data.runs[0].usage = { ...data.runs[0].usage, inputTokens: 0, outputTokens: 0, totalTokens: 0, observedCalls: 0 };
    expect(arm(data).usage).toMatchObject({ status: 'complete', inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    data.runs[0].usage = { status: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null, observedCalls: 0, unknownCalls: 0, pendingCalls: 0, coverageGaps: 0, untracked: true };
    expect(arm(data).usage).toMatchObject({ status: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null });
    data.runs[0].usage = { ...data.runs[0].usage, status: 'pending', observedCalls: 1, pendingCalls: 1 };
    expect(arm(data).usage.status).toBe('pending');
  });

  it('does not report an overflowed token aggregate as complete', () => {
    const data = dataset();
    data.cases[0].repetitions = 2;
    data.runs[0].usage = { ...data.runs[0].usage, inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0, totalTokens: Number.MAX_SAFE_INTEGER };
    data.runs.push({ ...structuredClone(data.runs[0]), runId: 'baseline-repeat-2', repetition: 2 });
    const summary = arm(data);
    expect(summary.usage.status).toBe('partial');
    expect(summary.usage.totalTokens).toBeNull();
    expect(summary.usage.fieldCoverage.totalTokens.overflow).toBe(true);
  });

  it('preserves genuine zero review time and keeps absent times unknown', () => {
    const data = dataset();
    const summary = arm(data, [label('baseline', 0, { reviewMinutes: 0 }), label('baseline', 1, { reviewMinutes: null })]);
    expect(summary.reviewTime).toMatchObject({ recordedMinutes: 0, knownSlots: 1, missingSlots: 3, status: 'partial', recordedMinutesPerAcceptedIndependent: 0 });
    expect(arm(data).reviewTime.recordedMinutes).toBeNull();
  });

  it('calculates gate false-accept and false-reject shares for declared before-generation complete context', () => {
    const data = dataset();
    data.runs[0].slots[2].automatic.gate = 'withheld';
    data.runs[0].slots[3].automatic.gate = 'withheld';
    const summary = arm(data, [label('baseline', 0), label('baseline', 1, { sourceScope: 'present' }), label('baseline', 2), label('baseline', 3, { notation: 'present' })]);
    expect(summary.judge.scope).toBe('declared-frozen-complete-review-context');
    expect(summary.judge.contextExcludedSlots).toBe(0);
    expect(summary.judge.gate).toEqual({
      automaticPassTeacherPass: 1, automaticPassTeacherFail: 1, automaticFailTeacherPass: 1, automaticFailTeacherFail: 1, unassessed: 0,
      falseAcceptShare: { numerator: 1, denominator: 2, value: 0.5 }, falseRejectShare: { numerator: 1, denominator: 2, value: 0.5 },
    });
  });

  it.each(['retrospective', 'unrecorded'] as const)('retains descriptive reviews but excludes %s context from judge errors', contextTiming => {
    const data = dataset();
    data.runs[0].comparison.contextTiming = contextTiming;
    data.runs[0].slots[2].automatic = { sourceScope: 'fail', notation: 'fail', duplication: 'fail', gate: 'withheld' };
    const reviews = allReviews(data);
    reviews.find(review => review.runId === 'baseline' && review.item === 1)!.label.sourceScope = 'present';
    const result = summarizeEvaluation(data, reviews);
    const summary = result.arms[0];
    expect(summary.issues.sourceScope.present).toBe(1);
    expect(summary.supply.acceptedIndependent).toBe(4);
    expect(summary.judge.contextExcludedSlots).toBe(4);
    for (const matrix of [summary.judge.gate, summary.judge.sourceScope, summary.judge.notation, summary.judge.duplication]) {
      expect(matrix).toEqual({
        automaticPassTeacherPass: 0, automaticPassTeacherFail: 0, automaticFailTeacherPass: 0, automaticFailTeacherFail: 0, unassessed: 4,
        falseAcceptShare: { numerator: 0, denominator: 0, value: null }, falseRejectShare: { numerator: 0, denominator: 0, value: null },
      });
    }
    expect(result.cases[0].arms[0].judge.contextExcludedSlots).toBe(4);
  });

  it.each(['sourcesComplete', 'bankComplete'] as const)('excludes incomplete %s context from formal judge confusion', field => {
    const data = dataset();
    data.cases[0].context.coverage[field] = false;
    data.runs.forEach(run => { run.contextHash = hashValue(data.cases[0].context); });
    const summary = arm(data, allReviews(data));
    expect(summary.reviewCoverage.qualityReviewedSlots).toBe(4);
    expect(summary.judge.contextExcludedSlots).toBe(4);
    expect(summary.judge.gate).toMatchObject({ unassessed: 4, automaticPassTeacherPass: 0, falseAcceptShare: { value: null } });
  });

  it('permits synthetic timing for explicitly synthetic fixtures without treating them as recorded results', () => {
    const data = dataset();
    data.origin = 'synthetic';
    data.runs.forEach(run => { run.comparison.contextTiming = 'synthetic'; });
    const result = summarizeEvaluation(data, allReviews(data));
    expect(result.arms[0].judge.contextExcludedSlots).toBe(0);
    expect(result.arms[0].judge.gate).toMatchObject({ automaticPassTeacherPass: 4, unassessed: 0 });
    expect(result.limitations.some(value => value.includes('not evidence of real educational improvement'))).toBe(true);
    data.origin = 'recorded';
    expect(() => summarizeEvaluation(data, allReviews(data))).toThrow();
  });

  it('retains only nonempty observation caveats with their run and slot identity', () => {
    const data = dataset();
    expect(summarizeEvaluation(data, []).observationLimitations).toEqual([]);
    data.runs[0].limitations = ['Latency excludes queue wait.'];
    data.runs[0].slots[1].limitations = ['Recorded source excerpts were truncated.'];
    data.runs[1].slots[2].limitations = ['No immutable final candidate was recorded.'];
    expect(summarizeEvaluation(data, []).observationLimitations).toEqual([
      { runId: 'baseline', caseId: 'case-1', repetition: 1, policy: 'baseline', run: ['Latency excludes queue wait.'],
        slots: [{ item: 1, limitations: ['Recorded source excerpts were truncated.'] }] },
      { runId: 'grounded-memory-v1', caseId: 'case-1', repetition: 1, policy: 'grounded-memory-v1', run: [],
        slots: [{ item: 2, limitations: ['No immutable final candidate was recorded.'] }] },
    ]);
  });

  it('keeps uncertain automatic and teacher dimensions outside resolved confusion counts', () => {
    const data = dataset();
    data.runs[0].slots[0].automatic.sourceScope = 'uncertain';
    const summary = arm(data, [label('baseline', 0), label('baseline', 1, { sourceScope: 'uncertain' }), label('baseline', 2, { disposition: 'discarded' })]);
    expect(summary.judge.sourceScope).toMatchObject({ automaticPassTeacherPass: 1, automaticPassTeacherFail: 0, unassessed: 3 });
    expect(summary.judge.gate).toMatchObject({ automaticPassTeacherPass: 2, unassessed: 2 });
    expect(summary.judge.gate.falseRejectShare.value).toBeNull();
  });

  it('computes descriptive deltas only for matched frozen pairs without inferring a winner', () => {
    const data = dataset();
    const reviews = allReviews(data);
    reviews.find(review => review.runId === 'baseline' && review.item === 0)!.label.sourceScope = 'present';
    const result = summarizeEvaluation(data, reviews);
    expect(result.comparison.eligiblePairs).toHaveLength(1);
    expect(result.comparison.provenance).toBe('declared-frozen-metadata');
    expect(result.comparison.teacherLabelsComplete).toBe(true);
    expect(result.comparison.deltas.sourceScopePresentPerResolved).toEqual({ baseline: 0.25, pilot: 0, pilotMinusBaseline: -0.25 });
    expect(result).not.toHaveProperty('winner');
    expect(result.limitations.some(value => value.includes('does not independently attest'))).toBe(true);
  });

  it.each([
    ['retrospective context', (data: EvaluationDataset) => { data.runs[1].comparison.contextTiming = 'retrospective'; }, 'grounded-memory-v1:context-not-frozen-before-generation'],
    ['unknown context hash', (data: EvaluationDataset) => { data.runs[1].contextHash = null; }, 'grounded-memory-v1:context-hash-mismatch-or-unrecorded'],
    ['isolation unconfirmed', (data: EvaluationDataset) => { data.runs[1].comparison.isolated = null; }, 'grounded-memory-v1:isolation-unconfirmed'],
    ['controls absent', (data: EvaluationDataset) => { data.runs[1].comparison.controlsHash = null; }, 'grounded-memory-v1:controls-unrecorded'],
    ['different controls', (data: EvaluationDataset) => { data.runs[1].comparison.controlsHash = hashValue('other-model'); }, 'controls-hash-mismatch'],
    ['source coverage incomplete', (data: EvaluationDataset) => { data.cases[0].context.coverage.sourcesComplete = false; }, 'incomplete-source-context'],
    ['bank coverage incomplete', (data: EvaluationDataset) => { data.cases[0].context.coverage.bankComplete = false; }, 'incomplete-bank-context'],
  ])('excludes %s from paired differences but retains descriptive arm counts', (_name, change, reason) => {
    const data = dataset(); change(data);
    const result = summarizeEvaluation(data, allReviews(data));
    expect(result.comparison.eligiblePairs).toEqual([]);
    expect(result.comparison.excludedPairs[0].reasons).toContain(reason);
    expect(result.arms[0].requestedSlots).toBe(4);
    expect(result.comparison.deltas.acceptedIndependentPerRequested.pilotMinusBaseline).toBeNull();
    expect(result.comparison.teacherLabelsComplete).toBe(false);
  });

  it('permits synthetic timing only for explicitly synthetic datasets and labels the result', () => {
    const data = dataset(); data.origin = 'synthetic';
    data.runs.forEach(run => { run.comparison.contextTiming = 'synthetic'; });
    expect(summarizeEvaluation(data, allReviews(data)).comparison.eligiblePairs).toHaveLength(1);
    expect(summarizeEvaluation(data, []).limitations.some(value => value.includes('not evidence of real educational improvement'))).toBe(true);
    data.origin = 'recorded';
    expect(() => summarizeEvaluation(data, [])).toThrow();
  });

  it('isolates per-case metrics and excludes an unmatched case from paired deltas', () => {
    const data = dataset();
    data.cases.push({ ...structuredClone(data.cases[0]), caseId: 'case-2' });
    const additional = { ...structuredClone(data.runs[0]), runId: 'baseline-case-2', caseId: 'case-2' };
    additional.usage.totalTokens = 900;
    data.runs.push(additional);
    const result = summarizeEvaluation(data, allReviews(data));
    expect(result.arms[0].usage.totalTokens).toBe(1020);
    expect(result.cases[0].arms[0].usage.totalTokens).toBe(120);
    expect(result.cases[1].arms[0].usage.totalTokens).toBe(900);
    expect(result.comparison.baseline.usage.totalTokens).toBe(120);
    expect(result.comparison.pilot.usage.totalTokens).toBe(120);
  });

  it('rejects duplicate authoritative runs instead of double-counting token summaries', () => {
    const data = dataset(); data.runs.push(structuredClone(data.runs[0]));
    expect(() => summarizeEvaluation(data, [])).toThrow();
  });
});
