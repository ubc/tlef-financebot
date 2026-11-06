/** Versioned peer-review driver. Keep the historical source-only driver byte-identical. */
import {
  admitGroundedOutline, type OutlineGroundingBatch, type OutlineGroundingRowFailure,
} from './structure-outline-grounding';
import { selectCapabilityOutlineGroundingBatch as selectOutlineGroundingBatch,
  validateCapabilityOutlineGroundingRows as validateOutlineGroundingRows } from './structure-capability-grounding';
import type { GroundingObjective, OutlineGroundingFinding } from '../types/structure';

export interface ReviewProgress {
  findings: OutlineGroundingFinding[];
  attempts: Record<string, number>;
  unresolvedDispatchIds: string[];
  /** Exact unresolved validation diagnostics, retained for a later correction. */
  failures?: OutlineGroundingRowFailure[];
}

export interface StructureProposalReviewInput {
  batches: OutlineGroundingBatch[];
  progress: ReviewProgress;
  assertCurrent: () => Promise<void>;
  complete: (prompt: string, item: number, attempt: number) => Promise<unknown>;
  beforeDispatch: (ids: string[], attempt: number, item: number) => Promise<void>;
  afterValidation: (input: {
    ids: string[]; attempt: number; item: number; raw: unknown;
    findings: OutlineGroundingFinding[]; failures: OutlineGroundingRowFailure[];
  }) => Promise<void>;
  onReceipt?: (findings: OutlineGroundingFinding[], expected: GroundingObjective[]) => Promise<void>;
}

const correctionPolicy = '\nThe review schema or objective/source identities were invalid. Correct ONLY the remaining objectives below. '
  + 'The other rows were validated and retained; do not repeat them. Use the exact allowed IDs in these diagnostics. '
  + 'Do not add curriculum, waive uncertainty or change the source-versus-grouping distinction. '
  + 'Return every required capability comparison for the remaining objectives using the complete unchanged peer/source packet. ';

function validateCompletedFinding(finding: OutlineGroundingFinding, batch: OutlineGroundingBatch): void {
  const objective = batch.objectives.find(row => row.id === finding.id);
  if (!objective) throw new Error('structure-grounding-review-identity');
  // Admission validates immutable bindings and positive/negative coverage. Use a
  // one-objective projection only after checking the original coordinates.
  if (finding.themeIndex !== objective.themeIndex || finding.loIndex !== objective.loIndex) {
    throw new Error('structure-grounding-review-content-changed');
  }
  try {
    admitGroundedOutline([{ name: objective.topic, los: [{ name: objective.name,
      evidenceIds: [...objective.evidenceIds], materialIds: [...objective.materialIds] }] }],
    [{ ...structuredClone(finding), themeIndex: 0, loIndex: 0 }],
    [{ ...structuredClone(objective), themeIndex: 0, loIndex: 0 }]);
  } catch (error) {
    // A valid completed negative row intentionally admits no selectable LO.
    if (!(error instanceof Error) || error.message !== 'structure-grounding-no-supported-objectives') throw error;
  }
  const checked = validateOutlineGroundingRows({ reviews: [{ id: finding.id,
    sourceStatus: finding.status, sourceIds: finding.citedSourceIds,
    coveredEvidenceIds: finding.coveredEvidenceIds, sourceReason: finding.reason,
    topicFit: finding.topicFit, topicReason: finding.topicReason }],
    capabilityComparisons: finding.capabilityComparisons ?? [] }, selectOutlineGroundingBatch(batch, [finding.id]));
  if (checked.failures.length) throw new Error(checked.failures[0]!.reason);
}

function validateFailure(failure: OutlineGroundingRowFailure, objective: GroundingObjective | undefined): void {
  const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  if (!objective || !equal(failure.allowedSourceIds, objective.sourceIds) || !equal(failure.allowedEvidenceIds, objective.evidenceIds) ||
      typeof failure.reason !== 'string' || !failure.reason.trim() || failure.reason.length > 600) {
    throw new Error('structure-grounding-review-failure-binding');
  }
  if (failure.coverageRequirements !== undefined) {
    if (!Array.isArray(failure.coverageRequirements) ||
        new Set(failure.coverageRequirements.map(row => row.evidenceId)).size !== failure.coverageRequirements.length ||
        failure.coverageRequirements.some(requirement => {
          const point = objective.learningPoints.find(row => row.id === requirement.evidenceId);
          return !point || !equal(requirement.requiredSourceIds, point.sourceIds);
        })) throw new Error('structure-grounding-review-failure-binding');
  }
}

/** Review only unresolved immutable objectives. Durable callbacks own writes;
 * this service has no extraction, organization, model client or database path. */
export async function reviewCapabilityStructureProposal(input: StructureProposalReviewInput): Promise<OutlineGroundingFinding[]> {
  const { batches, progress } = input;
  const expected = batches.flatMap(batch => batch.objectives);
  const expectedById = new Map(expected.map(row => [row.id, row]));
  if (expectedById.size !== expected.length ||
      new Set(expected.map(row => `${row.themeIndex}:${row.loIndex}`)).size !== expected.length) {
    throw new Error('structure-grounding-review-identity');
  }
  if (progress.unresolvedDispatchIds.length) throw new Error('structure-grounding-review-unresolved-dispatch');
  if (new Set(progress.findings.map(row => row.id)).size !== progress.findings.length) {
    throw new Error('structure-grounding-review-identity');
  }
  for (const [id, attempts] of Object.entries(progress.attempts)) {
    if (!expectedById.has(id) || !Number.isSafeInteger(attempts) || attempts < 0 || attempts > 2) {
      throw new Error('structure-grounding-review-attempt-state');
    }
  }
  for (const finding of progress.findings) {
    const batch = batches.find(row => row.objectives.some(objective => objective.id === finding.id));
    if (!batch) throw new Error('structure-grounding-review-identity');
    validateCompletedFinding(finding, batch);
  }
  const resolved = new Set(progress.findings.map(row => row.id));
  const failures = progress.failures ?? [];
  if (new Set(failures.map(row => row.id)).size !== failures.length) throw new Error('structure-grounding-review-failure-binding');
  for (const failure of failures) {
    validateFailure(failure, expectedById.get(failure.id));
    if (resolved.has(failure.id) || (progress.attempts[failure.id] ?? 0) === 0) throw new Error('structure-grounding-review-attempt-state');
  }
  for (const objective of expected) {
    if (resolved.has(objective.id)) continue;
    const attempts = progress.attempts[objective.id] ?? 0;
    if (attempts >= 2) throw new Error(failures.find(row => row.id === objective.id)?.reason ?? 'structure-grounding-review-attempt-limit');
    if (attempts === 1 && !failures.some(row => row.id === objective.id)) throw new Error('structure-grounding-review-correction-unavailable');
  }
  const sort = (rows: OutlineGroundingFinding[]) => rows.sort((left, right) =>
    expected.findIndex(row => row.id === left.id) - expected.findIndex(row => row.id === right.id));
  progress.findings = sort([...progress.findings]);
  progress.failures = [...failures];
  await input.assertCurrent();
  await input.onReceipt?.(structuredClone(progress.findings), structuredClone(expected));
  for (const [item, batch] of batches.entries()) {
    while (batch.objectives.some(row => !resolved.has(row.id))) {
      const unresolved = batch.objectives.filter(row => !resolved.has(row.id));
      const attempt = Math.min(...unresolved.map(row => progress.attempts[row.id] ?? 0));
      const ids = unresolved.filter(row => (progress.attempts[row.id] ?? 0) === attempt).map(row => row.id);
      if (attempt >= 2) throw new Error(progress.failures.find(row => ids.includes(row.id))?.reason ?? 'structure-grounding-review-attempt-limit');
      const pending = selectOutlineGroundingBatch(batch, ids);
      const diagnostics = progress.failures.filter(row => ids.includes(row.id));
      if (attempt === 1 && diagnostics.length !== ids.length) throw new Error('structure-grounding-review-correction-unavailable');
      const retainedComparisons = progress.findings.flatMap(row => row.capabilityComparisons ?? []).filter(row =>
        ids.includes(row.peerId));
      const correction = attempt ? correctionPolicy + JSON.stringify(diagnostics) + (retainedComparisons.length
        ? '\nPreviously retained peer comparisons (untrusted judgments, not source proof): ' + JSON.stringify(retainedComparisons)
          + '\nResolve any contradictory operation judgments against the complete originals. Do not force a positive result or invent a distinction; uncertainty remains explicit.' : '') : '';
      await input.assertCurrent();
      // Claim before the send. A transport failure or unknown persistence leaves
      // these IDs unresolved, so replay cannot purchase a duplicate model send.
      await input.beforeDispatch([...ids], attempt, item);
      for (const id of ids) progress.attempts[id] = attempt + 1;
      progress.unresolvedDispatchIds = [...ids];
      const raw = await input.complete(pending.prompt + correction, item, attempt);
      await input.assertCurrent();
      const checked = validateOutlineGroundingRows(raw, pending, progress.findings);
      await input.afterValidation({ ids: [...ids], attempt, item, raw,
        findings: structuredClone(checked.findings), failures: structuredClone(checked.failures) });
      progress.unresolvedDispatchIds = [];
      progress.findings = sort([...progress.findings, ...checked.findings]);
      progress.failures = [...progress.failures.filter(row => !ids.includes(row.id)), ...checked.failures];
      for (const finding of checked.findings) resolved.add(finding.id);
      await input.onReceipt?.(structuredClone(progress.findings), structuredClone(expected));
      if (checked.failures.length && (attempt === 1 || checked.failures.some(row => !ids.includes(row.id)))) {
        throw new Error(checked.failures[0]!.reason);
      }
    }
  }
  await input.assertCurrent();
  return structuredClone(progress.findings);
}

