import type { AuthoringRequirements, GenerationQualityAssessment, GenerationSemanticRepairAudit, GenerationValidationFinding } from '../types/generation-quality';
import type { GenerationEvidencePacket } from '../types/generation-evidence';
import type { GenerationMemoryContent, GenerationMemorySnapshot } from './generation-memory.service';
import { isDeepStrictEqual } from 'node:util';
import { resolveSpanCitations, sourceCitationSpans } from './generation-citation-spans';
import { snapshotQualityCandidate } from './generation-quality.service';
import { evaluateAnswerability, type AnswerabilityReview } from './generation-answerability';
import { taskDemandEnabled, taskDemandReceiptMatches } from './generation-task-demand';
import { exclusionReviewEnabled, exclusionReviewRecordedMatches, evaluateExclusionReview } from './generation-exclusion-review';

/** Recover only exact, unambiguous S aliases from the current server-resolved
 * receipt. A similar quote or a page label cannot establish the selected range. */
function literalAnswerRepairBrief(input: { assessment: GenerationQualityAssessment; requirements: AuthoringRequirements;
  packet: GenerationEvidencePacket; candidate: GenerationMemoryContent }): string | undefined {
  const { assessment, requirements, packet, candidate } = input;
  const answer = assessment.answerability;
  if (requirements.answerabilityProtocol !== 'option-answerability-v1' || answer?.protocol !== 'option-answerability-v1'
    || answer.status !== 'withheld' || assessment.evidencePacketId !== packet.id || !assessment.candidate || assessment.candidate.truncated) return undefined;
  const current = snapshotQualityCandidate(candidate), recorded = snapshotQualityCandidate(assessment.candidate);
  if (current.truncated || recorded.truncated || recorded.contentHash !== assessment.candidate.contentHash || !isDeepStrictEqual(current, recorded)) return undefined;
  if (exclusionReviewEnabled(requirements, current)) {
    const checked = evaluateExclusionReview(assessment.exclusionReview?.review, current, packet, requirements);
    if (!exclusionReviewRecordedMatches(assessment, requirements, current, packet) || !checked.receipt?.review) return undefined;
    const rows = [...checked.receipt.review.options].sort((left, right) => {
      const priority = (row: typeof left) => row.key === answer.keyedOptionKey ? 0 : row.verdict === 'fully-correct' ? 1 : row.verdict === 'undetermined' ? 2 : 3;
      return priority(left) - priority(right);
    });
    const retained = ['LITERAL-ANSWER HYPOTHESES (not semantic proof): recheck these exact literal responses and source-bound exclusions. Preserve genuine alternatives/uncertainty; invent no task restriction to force the key.'];
    let size = retained[0].length;
    for (const row of rows) {
      const text = JSON.stringify(row);
      if (size + text.length + 1 > 1500) break;
      retained.push(text); size += text.length + 1;
    }
    if (retained.length - 1 < rows.length) retained.push('Other bounded rows omitted here still require the fresh complete check.');
    return retained.join('\n');
  }
  const spans = sourceCitationSpans(packet);
  const aliases = (citations: typeof assessment.citations): string[] | undefined => {
    if (!Array.isArray(citations) || citations.length > 3) return undefined;
    const ids: string[] = [];
    for (const citation of citations) {
      if (!citation || typeof citation.passageId !== 'string' || typeof citation.quote !== 'string') return undefined;
      const passages = packet.passages.filter(row => row.id === citation.passageId);
      if (passages.length !== 1 || !citation.quote) return undefined;
      const passage = passages[0]; let start = passage.text.indexOf(citation.quote);
      if (citation.sourceLocation?.status === 'verified') start = citation.sourceLocation.chunkStart - passage.start;
      else if (start < 0 || passage.text.indexOf(citation.quote, start + 1) >= 0) return undefined;
      const end = start + citation.quote.length;
      const selected = spans.filter(span => span.passageId === passage.id && span.start >= start && span.end <= end);
      if (start < 0 || passage.text.slice(start, end) !== citation.quote || !selected.length || selected[0].start !== start
        || selected.at(-1)!.end !== end || selected.some((span, index) => index > 0 && selected[index - 1].end !== span.start)) return undefined;
      const resolved = resolveSpanCitations(packet, [{ kind: citation.kind, claim: citation.claim, spanIds: selected.map(span => span.id) }]);
      if (resolved.issues.length || resolved.citations.length !== 1 || !isDeepStrictEqual(resolved.citations[0], citation)) return undefined;
      ids.push(...selected.map(span => span.id));
    }
    return ids.length <= 3 && new Set(ids).size === ids.length ? ids : undefined;
  };
  let wire: AnswerabilityReview;
  if (answer.kind === 'mcq') {
    if (!Array.isArray(answer.options) || answer.options.length !== 4 || answer.options.some(row => !row || typeof row !== 'object')) return undefined;
    const rows = answer.options.map(row => ({ key: row.key, verdict: row.verdict, reason: row.reason,
      exclusionBasis: row.exclusionBasis, exclusion: row.exclusion, stemQuote: row.stemQuote, spanIds: aliases(row.citations) }));
    if (rows.some(row => row.spanIds === undefined)) return undefined;
    wire = { kind: 'mcq', options: rows as Extract<AnswerabilityReview, { kind: 'mcq' }>['options'] };
  } else if (answer.kind === 'true-false') {
    const ids = aliases(answer.citations); if (!ids) return undefined;
    wire = { kind: 'true-false', stemTruth: answer.stemTruth, reason: answer.reason, spanIds: ids };
  } else return undefined;
  const checked = evaluateAnswerability(wire, candidate, packet);
  if (checked.responseIssues.length || !isDeepStrictEqual(checked.assessment, answer)) return undefined;
  const header = 'LITERAL-ANSWER HYPOTHESES (not semantic proof): compare these named literal responses with the exact stem/source. Feedback is not another choice. Preserve uncertainty; never invent an exclusivity restriction or a missing stem condition to force one answer.';
  const details = { protocol: answer.protocol, keyedOptionKey: answer.keyedOptionKey,
    resolvedCorrectKey: answer.resolvedCorrectKey, issues: [...new Set(answer.issues.map(issue => issue.code))] };
  const rows = wire.kind === 'mcq' ? [...wire.options].sort((left, right) => {
    const priority = (row: typeof left) => row.key === answer.keyedOptionKey ? 0 : row.verdict === 'fully-correct' ? 1 : row.verdict === 'undetermined' ? 2 : 3;
    return priority(left) - priority(right);
  }).map(row => JSON.stringify(row)) : [JSON.stringify(wire)];
  const retained = [header, JSON.stringify(details)]; let size = retained.join('\n').length;
  for (const row of rows) { if (size + row.length + 1 > 1650) break; retained.push(row); size += row.length + 1; }
  if (retained.length - 2 < rows.length) retained.push('Other literal-answer rows omitted from this bounded brief remain unresolved and must pass the fresh check.');
  return retained.join('\n');
}

/** Keep generated slot constraints distinguishable from the teacher's request. */
export function bindPlannedAuthoringTask(requirements: AuthoringRequirements, plannedTask: NonNullable<AuthoringRequirements['plannedTask']>): AuthoringRequirements {
  const plannedInferenceRequirement = `Implement the planned inference: ${plannedTask.requiredInference}`;
  return { ...requirements, plannedTask, plannedInferenceRequirement,
    requiredChanges: [plannedInferenceRequirement, ...requirements.requiredChanges] };
}

export interface GenerationSemanticRepairPlan {
  strategy: GenerationSemanticRepairAudit['strategy'];
  critique: string;
  requirements: AuthoringRequirements;
  findings: GenerationValidationFinding[];
}

/** Plan a single corrective attempt from known defects, not a positive override.
 * The resulting candidate must pass the normal complete pipeline independently. */
export function buildGenerationSemanticRepairPlan(input: {
  assessment: GenerationQualityAssessment;
  requirements: AuthoringRequirements;
  packet: GenerationEvidencePacket;
  memory: GenerationMemorySnapshot;
  candidate: GenerationMemoryContent;
  reviewer?: { decision: string; reasoning: string };
}): GenerationSemanticRepairPlan | undefined {
  const { assessment, requirements, packet, memory } = input;
  if (assessment.policy !== 'grounded-memory-v2') return undefined;
  // An unstable schema retry is not a verified defect in this unchanged
  // candidate. Do not spend a content rewrite to hide a changed judgment.
  if (requirements.reviewRepairProtocol !== undefined && assessment.reviewRepair?.status !== 'consistent') return undefined;
  let demandBrief: string | undefined;
  if (taskDemandEnabled(requirements)) {
    const receipt = assessment.taskDemand;
    const current = snapshotQualityCandidate(input.candidate);
    if (!receipt || !taskDemandReceiptMatches(assessment, requirements, current, packet)) return undefined;
    // No independent defect permits inventing capacity for a fixed demand.
    // Supported actionable shortfalls use the same existing repair cycle.
    if (receipt.status !== 'passed') {
      if (receipt.capacity !== 'supported' || receipt.verdict !== 'unfulfilled' || !receipt.missingOperation || assessment.sourceSupport === 'uncertain') return undefined;
      demandBrief = `Fixed requested demand ${JSON.stringify(receipt.requested)} remains binding. Missing taught operation: ${receipt.missingOperation}. Evidence: ${receipt.spanIds.join(',')}. Finding: ${receipt.rationale}. Construct and independently recheck the actual task; never merely raise its label or add wording.`;
    }
  }
  const knownSources = new Set(packet.passages.map(passage => passage.id));
  const damaged = new Set((packet.findings ?? []).filter(finding => finding.code === 'source-text-damage').flatMap(finding => finding.passageIds));
  const knownMemory = new Set(memory.entries.map(entry => entry.id));
  const cleanSources = (ids: string[]) => ids.length > 0 && ids.every(id => knownSources.has(id) && !damaged.has(id));
  const findings = (assessment.findings ?? []).filter(finding => {
    if (finding.status !== 'defect' || !finding.correction.trim()) return false;
    if (finding.kind === 'task-duplication') return requirements.intent === 'create-independent-task' &&
      finding.memoryEntryIds.length > 0 && finding.memoryEntryIds.every(id => knownMemory.has(id));
    // An unreadable relationship cannot be made reliable by asking the model
    // to rewrite it. Known source-backed defects can receive a new attempt.
    return assessment.sourceSupport !== 'uncertain' && cleanSources(finding.passageIds);
  });
  const duplicate = requirements.intent === 'create-independent-task' &&
    (assessment.novelty === 'duplicate' || assessment.novelty === 'variant') &&
    assessment.matchedEntryIds.some(id => knownMemory.has(id));
  const legacyRepair = assessment.sourceSupport === 'supported' && (
    assessment.notation === 'inconsistent' || assessment.justifiedLength === 'excessive' ||
    assessment.changes?.some(change => change.status === 'unfulfilled') ||
    assessment.invariants?.some(invariant => invariant.status === 'violated'));
  const reviewerRepair = input.reviewer?.decision === 'reject' && assessment.sourceSupport === 'supported' &&
    assessment.notation === 'consistent' && !(assessment.findings ?? []).some(finding => finding.status === 'uncertain');
  if (!findings.length && !duplicate && !legacyRepair && !reviewerRepair) return undefined;
  if (assessment.status === 'eligible' && !reviewerRepair) return undefined;
  const demandReplan = demandBrief && requirements.intent === 'create-independent-task' && requirements.plannedTask && !requirements.original;
  const strategy = duplicate || demandReplan || findings.some(finding => finding.kind === 'task-duplication') ? 'replace-independent-task' : 'correct-candidate';
  const replacementInstruction = 'Create a supported independent task with a different required inference or solution path from the failed candidate and the shown Bank/Queue; changed numbers or wording are insufficient.';
  const replacePlan = strategy === 'replace-independent-task' && !requirements.original;
  const generatedRequirement = requirements.plannedTask ? `Implement the planned inference: ${requirements.plannedTask.requiredInference}` : undefined;
  // Remove only the exact server-bound first row, never a substring, a teacher
  // instruction, or an unlabelled historical requirement that merely resembles it.
  const retirePlannedRequirement = replacePlan && generatedRequirement !== undefined &&
    requirements.plannedInferenceRequirement === generatedRequirement && requirements.requiredChanges[0] === generatedRequirement;
  const repairedRequirements: AuthoringRequirements = strategy === 'replace-independent-task' && !requirements.original ? {
    ...requirements, plannedTask: undefined, plannedInferenceRequirement: undefined,
    requiredChanges: retirePlannedRequirement ? requirements.requiredChanges.slice(1) : [...requirements.requiredChanges],
    original: snapshotQualityCandidate(input.candidate),
  } : requirements;
  const spans = sourceCitationSpans(packet);
  const literalBrief = literalAnswerRepairBrief(input);
  const parts = [
    'BOUNDED SEMANTIC REPAIR. Treat the following findings as defect hypotheses to correct and independently recheck, never as permission to broaden teaching scope or waive uncertainty.',
    strategy === 'replace-independent-task' ? replacementInstruction :
      'Keep the intended task, answer semantics and unrelated fields unless a named defect requires a change. An edit-existing request must preserve every unrelated original field and option order.',
    'Use only the frozen original sources and displayed current Bank memory. If no supported correction exists, do not invent one. Source/memory IDs belong only in task metadata, never learner text.',
    ...(literalBrief ? [literalBrief] : []),
    ...(demandBrief ? [demandBrief] : []),
    ...findings.map(finding => JSON.stringify({ kind: finding.kind, target: finding.target, observation: finding.observation,
      correction: finding.correction, sourceSpanIds: spans.filter(span => finding.passageIds.includes(span.passageId)).map(span => span.id).slice(0, 6) })),
    ...(!findings.length ? assessment.reasons.slice(0, 3).map(reason => `Recorded assessment: ${reason.slice(0, 600)}`) : []),
    ...(assessment.changes ?? []).filter(change => change.status === 'unfulfilled' &&
      !(retirePlannedRequirement && change.requirement === generatedRequirement)).slice(0, 3).map(change => `Unfulfilled change: ${change.requirement}. ${change.reason}`.slice(0, 700)),
    ...(assessment.invariants ?? []).filter(invariant => invariant.status === 'violated').slice(0, 3).map(invariant => `Violated invariant: ${invariant.requirement}. ${invariant.reason}`.slice(0, 700)),
    ...(reviewerRepair ? [`Reviewer finding (must be rechecked): ${input.reviewer!.reasoning.slice(0, 600)}`] : []),
  ];
  const retained: string[] = []; let size = 0; let omitted = 0;
  const critiqueLimit = requirements.answerabilityProtocol === 'option-answerability-v1' || requirements.taskDemandProtocol === 'task-demand-v1' ? 4300 : 4500;
  for (const part of parts) {
    if (size + part.length + 1 <= critiqueLimit) { retained.push(part); size += part.length + 1; }
    else omitted++;
  }
  if (omitted) retained.push(`${omitted} additional finding rows were omitted from this bounded repair brief. All original requirements and all post-repair checks still apply; omitted findings are not waived.`);
  const critique = retained.join('\n');
  return { strategy, critique, requirements: repairedRequirements, findings };
}

/** At most one bounded, hash-labelled before/after record lives with the
 * guarded authoring assessment. Usage receipts never receive this content. */
export function semanticRepairAudit(plan: GenerationSemanticRepairPlan, assessment: GenerationQualityAssessment,
  candidate: GenerationMemoryContent): GenerationSemanticRepairAudit {
  return { version: 1, strategy: plan.strategy, critique: plan.critique, before: snapshotQualityCandidate(candidate),
    reasonsBefore: assessment.reasons.slice(0, 12).map(reason => reason.slice(0, 600)),
    findingsBefore: plan.findings, outcome: 'failed' };
}
