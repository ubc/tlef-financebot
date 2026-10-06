import type { summarizeEvaluation } from './metrics';

type Report = ReturnType<typeof summarizeEvaluation>;
const safe = (value: string) => value.replace(/[\\`*_{}[\]()#+.!|<>-]/g, '\\$&').replace(/\r?\n/g, ' ');
const number = (value: number | null) => value === null ? 'Unavailable' : value.toLocaleString('en-US', { maximumFractionDigits: 3 });
const ratio = (value: { numerator: number; denominator: number; value: number | null }) => value.value === null ? `Unavailable (${value.numerator}/${value.denominator})` : `${(value.value * 100).toFixed(1)}% (${value.numerator}/${value.denominator})`;

export function renderEvaluationReport(report: Report): string {
  const [baseline, pilot] = report.arms;
  const rows: Array<[string, string, string]> = [
    ['Requested independent slots', number(baseline.requestedSlots), number(pilot.requestedSlots)],
    ['Saved / withheld / failed / missing', Object.values(baseline.outcomes).join(' / '), Object.values(pilot.outcomes).join(' / ')],
    ['Teacher accepted independent (saved)', number(baseline.supply.acceptedIndependent), number(pilot.supply.acceptedIndependent)],
    ['Accepted after edits (included above)', number(baseline.supply.acceptedAfterEdits), number(pilot.supply.acceptedAfterEdits)],
    ['Intentional variants (saved)', number(baseline.supply.intentionalVariantsSaved), number(pilot.supply.intentionalVariantsSaved)],
    ['Provisional unmet independent slots', number(baseline.supply.provisionalUnmetIndependentSlots), number(pilot.supply.provisionalUnmetIndependentSlots)],
    ['Unresolved supply labels', number(baseline.supply.unresolvedSupplyLabels), number(pilot.supply.unresolvedSupplyLabels)],
    ['Source issues / resolved labels, all slots', ratio(baseline.issues.sourceScope.presentPerResolved), ratio(pilot.issues.sourceScope.presentPerResolved)],
    ['Source uncertain / unreviewed', `${baseline.issues.sourceScope.uncertain} / ${baseline.issues.sourceScope.unreviewed}`, `${pilot.issues.sourceScope.uncertain} / ${pilot.issues.sourceScope.unreviewed}`],
    ['Duplicate tasks / resolved labels, all slots', ratio(baseline.issues.duplication.presentPerResolved), ratio(pilot.issues.duplication.presentPerResolved)],
    ['Duplicate uncertain / unreviewed', `${baseline.issues.duplication.uncertain} / ${baseline.issues.duplication.unreviewed}`, `${pilot.issues.duplication.uncertain} / ${pilot.issues.duplication.unreviewed}`],
    ['Source issues / resolved labels, saved outputs', ratio(baseline.savedOutputIssues.sourceScope.presentPerResolved), ratio(pilot.savedOutputIssues.sourceScope.presentPerResolved)],
    ['Recorded review minutes (coverage)', `${number(baseline.reviewTime.recordedMinutes)} (${baseline.reviewTime.status})`, `${number(pilot.reviewTime.recordedMinutes)} (${pilot.reviewTime.status})`],
    ['Minutes per accepted independent, recorded subtotal', number(baseline.reviewTime.recordedMinutesPerAcceptedIndependent), number(pilot.reviewTime.recordedMinutesPerAcceptedIndependent)],
    ['Recorded input / output tokens', `${number(baseline.usage.inputTokens)} / ${number(baseline.usage.outputTokens)}`, `${number(pilot.usage.inputTokens)} / ${number(pilot.usage.outputTokens)}`],
    ['Recorded total tokens (coverage)', `${number(baseline.usage.totalTokens)} (${baseline.usage.status})`, `${number(pilot.usage.totalTokens)} (${pilot.usage.status})`],
    ['Tokens per accepted independent, recorded subtotal', number(baseline.usage.recordedTokensPerAcceptedIndependent), number(pilot.usage.recordedTokensPerAcceptedIndependent)],
    ['Quality gate false-accept share (resolved only)', ratio(baseline.judge.gate.falseAcceptShare), ratio(pilot.judge.gate.falseAcceptShare)],
    ['Quality gate false-reject share (resolved only)', ratio(baseline.judge.gate.falseRejectShare), ratio(pilot.judge.gate.falseRejectShare)],
    ['Judge rows excluded: generation context unbound/incomplete', number(baseline.judge.contextExcludedSlots), number(pilot.judge.contextExcludedSlots)],
  ];
  return [
    '# FinanceBot quality evaluation', '',
    `Experiment: ${safe(report.experimentId)}. Origin: **${report.origin}**.`, '',
    report.origin === 'synthetic' ? '**Walkthrough only. These are synthetic fixtures, not measured product quality or teacher evidence.**' : 'Descriptive observations. Read comparison eligibility and review coverage before interpreting differences.', '',
    '| Measure | Baseline | Source and memory pilot |', '| --- | --- | --- |', ...rows.map(row => `| ${row.join(' | ')} |`), '',
    '## Comparison eligibility', '',
    `${report.comparison.eligiblePairs.length} eligible declared-context pairs; ${report.comparison.excludedPairs.length} excluded or missing pairs. Fully resolved teacher labels: ${report.comparison.teacherLabelsComplete ? 'yes' : 'no'}.`, '',
    'Matching hashes check the supplied manifest; they do not attest that execution used that manifest. Missing reviews are not clean passes. Zero accepted questions makes per-accepted ratios unavailable. No winner is inferred.', '',
    ...report.comparison.excludedPairs.map(pair => `- ${safe(pair.caseId)} / repetition ${pair.repetition}: ${pair.reasons.map(safe).join(', ')}.`), '',
    'The JSON report includes per-case results, all five issue dimensions, denominators, uncertainty, recorded measurement coverage, and descriptive deltas restricted to eligible pairs.', '',
    '## Recorded observation limits', '',
    ...report.observationLimitations.flatMap(entry => [
      ...entry.run.map(limit => `- ${safe(entry.runId)} (${safe(entry.caseId)}, repetition ${entry.repetition}, ${safe(entry.policy)}): ${safe(limit)}`),
      ...entry.slots.flatMap(slot => slot.limitations.map(limit => `- ${safe(entry.runId)}, slot ${slot.item + 1}: ${safe(limit)}`)),
    ]), '',
    '## Limits', '', ...report.limitations.map(limit => `- ${safe(limit)}`), '',
  ].join('\n');
}
