import { DatasetSchema, hashValue, issueDimensions } from './schema';
import type { EvaluationDataset, EvaluationRun, EvaluationSlot, IssueDimension, TeacherLabel } from './schema';

type Policy = EvaluationRun['policy'];
type EvaluationCase = EvaluationDataset['cases'][number];
export interface ResolvedReview { runId: string; item: number; label: TeacherLabel }
interface ExpectedRun { fixture: EvaluationCase; repetition: number }
interface Observation { run: EvaluationRun | undefined; slot: EvaluationSlot | undefined; label: TeacherLabel | undefined; reviewable: boolean; judgeContextEligible: boolean }
export interface Rate { numerator: number; denominator: number; value: number | null }
export interface IssueCounts {
  present: number; absent: number; uncertain: number; unreviewed: number;
  presentPerResolved: Rate; presentPerReviewed: Rate;
}
export interface JudgeConfusion {
  automaticPassTeacherPass: number;
  automaticPassTeacherFail: number;
  automaticFailTeacherPass: number;
  automaticFailTeacherFail: number;
  unassessed: number;
  falseAcceptShare: Rate;
  falseRejectShare: Rate;
}

function rate(numerator: number, denominator: number): Rate {
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null };
}
function finiteTotal(values: number[]): number | null {
  const sum = values.reduce((total, value) => total + value, 0);
  return Number.isFinite(sum) ? sum : null;
}
function countTotal(values: number[]): number | null {
  const sum = finiteTotal(values);
  return sum !== null && Number.isSafeInteger(sum) ? sum : null;
}
function slotKey(runId: string, item: number): string { return JSON.stringify([runId, item]); }
function runKey(caseId: string, repetition: number, policy: Policy): string { return JSON.stringify([caseId, repetition, policy]); }
function issueCounts(observations: Observation[], dimension: IssueDimension): IssueCounts {
  const counts = { present: 0, absent: 0, uncertain: 0, unreviewed: 0 };
  for (const observation of observations) {
    const issue = observation.reviewable ? observation.label?.[dimension] : null;
    if (issue === 'present' || issue === 'absent' || issue === 'uncertain') counts[issue] += 1;
    else counts.unreviewed += 1;
  }
  return { ...counts,
    presentPerResolved: rate(counts.present, counts.present + counts.absent),
    presentPerReviewed: rate(counts.present, counts.present + counts.absent + counts.uncertain),
  };
}
function confusion(observations: Observation[], dimension?: 'sourceScope' | 'notation' | 'duplication'): JudgeConfusion {
  const counts = { automaticPassTeacherPass: 0, automaticPassTeacherFail: 0, automaticFailTeacherPass: 0, automaticFailTeacherFail: 0, unassessed: 0 };
  for (const observation of observations) {
    const automatic = dimension ? observation.slot?.automatic[dimension]
      : observation.slot?.automatic.gate === 'eligible' ? 'pass' : observation.slot?.automatic.gate === 'withheld' ? 'fail' : null;
    const issues = dimension ? [observation.label?.[dimension]]
      : [observation.label?.sourceScope, observation.label?.notation, observation.label?.duplication];
    const resolved = observation.judgeContextEligible && issues.every(issue => issue === 'present' || issue === 'absent');
    if (!resolved || (automatic !== 'pass' && automatic !== 'fail')) { counts.unassessed += 1; continue; }
    const teacherPass = issues.every(issue => issue === 'absent');
    if (automatic === 'pass' && teacherPass) counts.automaticPassTeacherPass += 1;
    if (automatic === 'pass' && !teacherPass) counts.automaticPassTeacherFail += 1;
    if (automatic === 'fail' && teacherPass) counts.automaticFailTeacherPass += 1;
    if (automatic === 'fail' && !teacherPass) counts.automaticFailTeacherFail += 1;
  }
  return { ...counts,
    falseAcceptShare: rate(counts.automaticPassTeacherFail, counts.automaticPassTeacherPass + counts.automaticPassTeacherFail),
    falseRejectShare: rate(counts.automaticFailTeacherPass, counts.automaticFailTeacherPass + counts.automaticFailTeacherFail),
  };
}

function summarizeUsage(runs: EvaluationRun[], expectedRuns: number, acceptedIndependent: number) {
  const fields = ['inputTokens', 'outputTokens', 'totalTokens'] as const;
  const fieldCoverage = Object.fromEntries(fields.map(field => {
    const values = runs.flatMap(run => run.usage[field] === null ? [] : [run.usage[field]]);
    return [field, { recordedSubtotal: values.length ? countTotal(values) : null,
      knownRuns: values.length, missingRuns: expectedRuns - values.length,
      overflow: values.length > 0 && countTotal(values) === null }];
  })) as Record<typeof fields[number], { recordedSubtotal: number | null; knownRuns: number; missingRuns: number; overflow: boolean }>;
  const hasKnown = fields.some(field => fieldCoverage[field].knownRuns > 0 && !fieldCoverage[field].overflow);
  const missingRuns = expectedRuns - runs.length;
  const complete = expectedRuns > 0 && missingRuns === 0 && runs.every(run => run.usage.status === 'complete')
    && fields.every(field => fieldCoverage[field].missingRuns === 0 && !fieldCoverage[field].overflow);
  const pending = runs.some(run => run.usage.pendingCalls > 0 || run.usage.status === 'pending');
  const status = complete ? 'complete' : hasKnown ? 'partial' : pending ? 'pending' : 'unavailable';
  const totalTokens = fieldCoverage.totalTokens.recordedSubtotal;
  return {
    scope: 'observed-llm-sdk-invocations' as const,
    status,
    inputTokens: fieldCoverage.inputTokens.recordedSubtotal,
    outputTokens: fieldCoverage.outputTokens.recordedSubtotal,
    totalTokens,
    fieldCoverage,
    measuredRuns: runs.length,
    missingRunMeasurements: missingRuns,
    completeRuns: runs.filter(run => run.usage.status === 'complete').length,
    untrackedRuns: runs.filter(run => run.usage.untracked).length,
    observedCalls: countTotal(runs.map(run => run.usage.observedCalls)),
    unknownCalls: countTotal(runs.map(run => run.usage.unknownCalls)),
    pendingCalls: countTotal(runs.map(run => run.usage.pendingCalls)),
    coverageGaps: countTotal(runs.map(run => run.usage.coverageGaps)),
    recordedTokensPerAcceptedIndependent: totalTokens !== null && acceptedIndependent > 0 ? totalTokens / acceptedIndependent : null,
    ratioBasis: status === 'complete' ? 'reported-observed-call-totals' : 'recorded-subtotal-only',
  };
}

function summarizeArm(policy: Policy, expected: ExpectedRun[], runs: EvaluationRun[], labels: Map<string, TeacherLabel>, origin: EvaluationDataset['origin']) {
  const runByKey = new Map(runs.map(run => [runKey(run.caseId, run.repetition, run.policy), run]));
  const contextHashes = new Map<string, string>();
  const observations: Observation[] = [];
  let missingRuns = 0;
  for (const { fixture, repetition } of expected) {
    const run = runByKey.get(runKey(fixture.caseId, repetition, policy));
    if (!run) missingRuns += 1;
    if (run && !contextHashes.has(fixture.caseId)) contextHashes.set(fixture.caseId, hashValue(fixture.context));
    const contextMatches = run !== undefined && run.contextHash === contextHashes.get(fixture.caseId);
    for (let item = 0; item < fixture.context.request.count; item += 1) {
      const slot = run?.slots.find(candidate => candidate.item === item);
      const label = run ? labels.get(slotKey(run.runId, item)) : undefined;
      const reviewable = Boolean(slot?.candidate && !slot.candidate.truncated &&
        slot.candidate.contentHash === hashValue(slot.candidate.content) && contextMatches);
      const judgeContextEligible = reviewable && fixture.context.coverage.sourcesComplete && fixture.context.coverage.bankComplete &&
        (run?.comparison.contextTiming === 'before-generation' || origin === 'synthetic' && run?.comparison.contextTiming === 'synthetic');
      observations.push({ run, slot, label, reviewable, judgeContextEligible });
    }
  }
  const outcomes = { saved: 0, withheld: 0, failed: 0, missing: 0 };
  for (const observation of observations) outcomes[observation.slot?.outcome ?? 'missing'] += 1;
  const saved = observations.filter(observation => observation.slot?.outcome === 'saved');
  const independentAdoption = (observation: Observation) => observation.reviewable && observation.label?.duplication === 'absent' &&
    (observation.label.disposition === 'accepted' || observation.label.disposition === 'edited');
  const acceptedUnedited = saved.filter(observation => independentAdoption(observation) && observation.label?.disposition === 'accepted').length;
  const acceptedAfterEdits = saved.filter(observation => independentAdoption(observation) && observation.label?.disposition === 'edited').length;
  const acceptedIndependent = acceptedUnedited + acceptedAfterEdits;
  const unresolvedSupply = observations.filter(observation => {
    const disposition = observation.label?.disposition;
    if (disposition === null || disposition === undefined || disposition === 'unresolved') return true;
    if (disposition === 'accepted' || disposition === 'edited') return !observation.reviewable || observation.label?.duplication !== 'absent';
    if (disposition === 'intentional-variant') return !observation.reviewable;
    return false;
  }).length;
  const recordedTimes = observations.flatMap(observation => {
    const time = observation.label?.reviewMinutes;
    return typeof time === 'number' && Number.isFinite(time) && time >= 0 ? [time] : [];
  });
  const recordedMinutes = recordedTimes.length ? finiteTotal(recordedTimes) : null;
  const elapsed = runs.flatMap(run => run.elapsedMs === null ? [] : [run.elapsedMs]);
  const totalElapsed = elapsed.length ? finiteTotal(elapsed) : null;
  const issues = Object.fromEntries(issueDimensions.map(dimension => [dimension, issueCounts(observations, dimension)])) as Record<IssueDimension, IssueCounts>;
  const savedOutputIssues = Object.fromEntries(issueDimensions.map(dimension => [dimension, issueCounts(saved, dimension)])) as Record<IssueDimension, IssueCounts>;
  const completeLabels = observations.filter(observation => observation.reviewable && issueDimensions.every(dimension => observation.label?.[dimension] !== null && observation.label?.[dimension] !== undefined)).length;
  const resolvedLabels = observations.filter(observation => observation.reviewable && issueDimensions.every(dimension => observation.label?.[dimension] === 'present' || observation.label?.[dimension] === 'absent')).length;
  const labelled = observations.filter(observation => observation.reviewable && issueDimensions.some(dimension => observation.label?.[dimension] !== null && observation.label?.[dimension] !== undefined)).length;
  const observedRuns = runs.filter(run => run.policy === policy && expected.some(item => item.fixture.caseId === run.caseId && item.repetition === run.repetition));
  return {
    policy,
    expectedRuns: expected.length,
    observedRuns: observedRuns.length,
    missingRuns,
    requestedSlots: observations.length,
    outcomes,
    candidates: {
      available: observations.filter(observation => observation.slot?.candidate).length,
      reviewable: observations.filter(observation => observation.reviewable).length,
      truncated: observations.filter(observation => observation.slot?.candidate?.truncated).length,
      unavailable: observations.filter(observation => !observation.slot?.candidate).length,
      contextMismatch: observations.filter(observation => observation.slot?.candidate && !observation.slot.candidate.truncated && !observation.reviewable).length,
    },
    reviewCoverage: {
      submittedSlots: observations.filter(observation => observation.label).length,
      qualityReviewedSlots: labelled,
      completeIssueLabels: completeLabels,
      fullyResolvedIssueLabels: resolvedLabels,
      unreviewedSlots: observations.length - labelled,
      unresolvedIssueLabels: observations.length - resolvedLabels,
      ignoredIllegalQualityLabels: observations.filter(observation => !observation.reviewable && issueDimensions.some(dimension => observation.label?.[dimension] !== null && observation.label?.[dimension] !== undefined)).length,
    },
    issues,
    savedOutputIssues,
    supply: {
      acceptedIndependent,
      acceptedUnedited,
      acceptedAfterEdits,
      acceptedIndependentPerRequested: rate(acceptedIndependent, observations.length),
      intentionalVariantsSaved: saved.filter(observation => observation.reviewable && observation.label?.disposition === 'intentional-variant').length,
      teacherAcceptableWithheld: observations.filter(observation => observation.slot?.outcome === 'withheld' && independentAdoption(observation)).length,
      provisionalUnmetIndependentSlots: observations.length - acceptedIndependent,
      unresolvedSupplyLabels: unresolvedSupply,
    },
    reviewTime: {
      recordedMinutes,
      knownSlots: recordedTimes.length,
      missingSlots: observations.length - recordedTimes.length,
      status: observations.length > 0 && recordedTimes.length === observations.length && recordedMinutes !== null ? 'complete' : recordedTimes.length ? 'partial' : 'unavailable',
      recordedMinutesPerAcceptedIndependent: recordedMinutes !== null && acceptedIndependent > 0 ? recordedMinutes / acceptedIndependent : null,
    },
    usage: summarizeUsage(observedRuns, expected.length, acceptedIndependent),
    latency: {
      recordedTotalMs: totalElapsed,
      knownRuns: elapsed.length,
      missingRuns: expected.length - elapsed.length,
      meanKnownMs: totalElapsed !== null && elapsed.length ? totalElapsed / elapsed.length : null,
    },
    numerical: {
      verified: observations.filter(observation => observation.slot?.numerical === 'verified').length,
      failed: observations.filter(observation => observation.slot?.numerical === 'failed').length,
      notApplicable: observations.filter(observation => observation.slot?.numerical === 'not-applicable').length,
      unknown: observations.filter(observation => !observation.slot || observation.slot.numerical === 'unknown').length,
    },
    judge: {
      scope: 'declared-frozen-complete-review-context' as const,
      contextExcludedSlots: observations.filter(observation => !observation.judgeContextEligible).length,
      gate: confusion(observations),
      sourceScope: confusion(observations, 'sourceScope'),
      notation: confusion(observations, 'notation'),
      duplication: confusion(observations, 'duplication'),
    },
  };
}
export type ArmEvaluationMetrics = ReturnType<typeof summarizeArm>;

function pairExclusions(dataset: EvaluationDataset, expected: ExpectedRun, baseline?: EvaluationRun, pilot?: EvaluationRun): string[] {
  const reasons: string[] = [];
  if (!baseline) reasons.push('missing-baseline-run');
  if (!pilot) reasons.push('missing-pilot-run');
  if (!expected.fixture.context.coverage.sourcesComplete) reasons.push('incomplete-source-context');
  if (!expected.fixture.context.coverage.bankComplete) reasons.push('incomplete-bank-context');
  for (const run of [baseline, pilot]) {
    if (!run) continue;
    if (run.contextHash !== hashValue(expected.fixture.context)) reasons.push(`${run.policy}:context-hash-mismatch-or-unrecorded`);
    if (!(run.comparison.contextTiming === 'before-generation' || dataset.origin === 'synthetic' && run.comparison.contextTiming === 'synthetic')) reasons.push(`${run.policy}:context-not-frozen-before-generation`);
    if (run.comparison.isolated !== true) reasons.push(`${run.policy}:isolation-unconfirmed`);
    if (run.comparison.controlsHash === null) reasons.push(`${run.policy}:controls-unrecorded`);
  }
  if (baseline?.comparison.controlsHash && pilot?.comparison.controlsHash && baseline.comparison.controlsHash !== pilot.comparison.controlsHash) reasons.push('controls-hash-mismatch');
  return reasons;
}

function delta(baseline: number | null, pilot: number | null) {
  return { baseline, pilot, pilotMinusBaseline: baseline !== null && pilot !== null ? pilot - baseline : null };
}

/** Summarize imported observations without invoking models or inferring labels.
 * Review ID/hash binding is validated by the importer; this layer additionally
 * prevents absent, truncated, or wrong-context content from becoming quality truth. */
export function summarizeEvaluation(dataset: EvaluationDataset, reviews: ResolvedReview[]) {
  DatasetSchema.parse(dataset);
  const policies: Policy[] = ['baseline', 'grounded-memory-v1'];
  const expected = dataset.cases.flatMap(fixture => Array.from({ length: fixture.repetitions }, (_, index) => ({ fixture, repetition: index + 1 })));
  const knownSlots = new Set(dataset.runs.flatMap(run => run.slots.map(slot => slotKey(run.runId, slot.item))));
  const labels = new Map<string, TeacherLabel>();
  const conflicts = new Set<string>();
  let unknownSlots = 0;
  let duplicateLabels = 0;
  for (const review of reviews) {
    const key = slotKey(review.runId, review.item);
    if (!knownSlots.has(key)) { unknownSlots += 1; continue; }
    if (conflicts.has(key)) { duplicateLabels += 1; continue; }
    const old = labels.get(key);
    if (old) {
      duplicateLabels += 1;
      if (hashValue(old) !== hashValue(review.label)) { conflicts.add(key); labels.delete(key); }
    } else labels.set(key, review.label);
  }
  const arms = policies.map(policy => summarizeArm(policy, expected, dataset.runs.filter(run => run.policy === policy), labels, dataset.origin));
  const cases = dataset.cases.map(fixture => ({
    caseId: fixture.caseId,
    arms: policies.map(policy => summarizeArm(policy, expected.filter(item => item.fixture.caseId === fixture.caseId), dataset.runs.filter(run => run.caseId === fixture.caseId && run.policy === policy), labels, dataset.origin)),
  }));
  const eligiblePairs: Array<{ caseId: string; repetition: number; baselineRunId: string; pilotRunId: string }> = [];
  const excludedPairs: Array<{ caseId: string; repetition: number; reasons: string[] }> = [];
  const eligibleExpected: ExpectedRun[] = [];
  for (const item of expected) {
    const baseline = dataset.runs.find(run => run.caseId === item.fixture.caseId && run.repetition === item.repetition && run.policy === 'baseline');
    const pilot = dataset.runs.find(run => run.caseId === item.fixture.caseId && run.repetition === item.repetition && run.policy === 'grounded-memory-v1');
    const reasons = pairExclusions(dataset, item, baseline, pilot);
    if (reasons.length) excludedPairs.push({ caseId: item.fixture.caseId, repetition: item.repetition, reasons });
    else {
      eligibleExpected.push(item);
      eligiblePairs.push({ caseId: item.fixture.caseId, repetition: item.repetition, baselineRunId: baseline!.runId, pilotRunId: pilot!.runId });
    }
  }
  const pairedBaseline = summarizeArm('baseline', eligibleExpected, dataset.runs.filter(run => run.policy === 'baseline' && eligiblePairs.some(pair => pair.baselineRunId === run.runId)), labels, dataset.origin);
  const pairedPilot = summarizeArm('grounded-memory-v1', eligibleExpected, dataset.runs.filter(run => run.policy === 'grounded-memory-v1' && eligiblePairs.some(pair => pair.pilotRunId === run.runId)), labels, dataset.origin);
  return {
    schemaVersion: 'financebot-quality-metrics-v1' as const,
    experimentId: dataset.experimentId,
    origin: dataset.origin,
    rubricVersion: dataset.rubricVersion,
    reviewImport: { supplied: reviews.length, retainedSlots: labels.size, unknownSlotsIgnored: unknownSlots, duplicateLabels, conflictingSlots: conflicts.size },
    arms,
    cases,
    observationLimitations: dataset.runs.flatMap(run => {
      const slots = run.slots.filter(slot => slot.limitations.length > 0).map(slot => ({ item: slot.item, limitations: [...slot.limitations] }));
      return run.limitations.length > 0 || slots.length > 0
        ? [{ runId: run.runId, caseId: run.caseId, repetition: run.repetition, policy: run.policy, run: [...run.limitations], slots }] : [];
    }),
    comparison: {
      provenance: 'declared-frozen-metadata' as const,
      eligiblePairs,
      excludedPairs,
      baseline: pairedBaseline,
      pilot: pairedPilot,
      teacherLabelsComplete: eligiblePairs.length > 0 && [pairedBaseline, pairedPilot].every(summary => summary.reviewCoverage.unresolvedIssueLabels === 0 && summary.supply.unresolvedSupplyLabels === 0),
      deltas: {
        acceptedIndependentPerRequested: delta(pairedBaseline.supply.acceptedIndependentPerRequested.value, pairedPilot.supply.acceptedIndependentPerRequested.value),
        sourceScopePresentPerResolved: delta(pairedBaseline.issues.sourceScope.presentPerResolved.value, pairedPilot.issues.sourceScope.presentPerResolved.value),
        duplicationPresentPerResolved: delta(pairedBaseline.issues.duplication.presentPerResolved.value, pairedPilot.issues.duplication.presentPerResolved.value),
        savedSourceScopePresentPerResolved: delta(pairedBaseline.savedOutputIssues.sourceScope.presentPerResolved.value, pairedPilot.savedOutputIssues.sourceScope.presentPerResolved.value),
        recordedMinutesPerAcceptedIndependent: delta(pairedBaseline.reviewTime.recordedMinutesPerAcceptedIndependent, pairedPilot.reviewTime.recordedMinutesPerAcceptedIndependent),
        recordedTokensPerAcceptedIndependent: delta(pairedBaseline.usage.recordedTokensPerAcceptedIndependent, pairedPilot.usage.recordedTokensPerAcceptedIndependent),
      },
    },
    limitations: [
      ...dataset.limitations,
      'Comparability uses declared frozen metadata and matching hashes; it does not independently attest historical execution or isolation.',
      'Judge confusion requires a bound complete candidate and declared frozen, complete source and bank context. Retrospective, unrecorded, incomplete, or mismatched context remains unassessed; synthetic timing is accepted only for explicitly synthetic datasets.',
      'All requested slots are intended independent questions. Only saved outputs explicitly accepted or edited with duplication absent count as delivered independent supply.',
      'Issue labels describe the original candidate. Accepted-after-edit supply does not establish that the original content was error-free.',
      'Saved Drafts are not automatic recommendations or teacher acceptance. Saved-output incidence is reported separately from automatic gate decisions.',
      'Unreviewed and uncertain labels remain visible. Differences are descriptive estimates within eligible pairs, not winner or causal-improvement claims.',
      'Recorded token and time subtotals include failures and withheld outputs. Missing measurements are unknown; partial ratios are not complete cost comparisons.',
      'LLM usage excludes unobserved SDK retries, embeddings, parsing, and infrastructure. Token totals are not a currency invoice.',
      ...(dataset.origin === 'synthetic' ? ['All outcomes and labels in this synthetic dataset are fixtures, not evidence of real educational improvement.'] : []),
    ],
  };
}
