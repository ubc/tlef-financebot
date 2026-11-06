import { createHash } from 'node:crypto';
import { outlineGroundingProtocolHash, planOutlineGrounding, selectOutlineGroundingBatch, validateOutlineGroundingRows,
  type OutlineGroundingBatch } from './structure-outline-grounding';
import type { GroundingObjective, OutlineGroundingFinding } from '../types/structure';
import type { StructureReviewCheckpointBody } from '../types/structure-review';

export interface RetainedStructureReviewAuthority {
  parentRunId: string;
  parentCourseId: string;
  terminalStatus: 'failed';
  parentFindings: OutlineGroundingFinding[];
  /** Loaded from the authoritative terminal parent and pinned artifact manifest,
   * never accepted from a browser or inferred from requested counts. */
  parentFindingHashes: Array<{ id: string; hash: string }>;
  parentExpectedIds: string[];
  parentAttempts: Record<string, number>;
  corrected: { raw: unknown; rawSha256: string; batch: OutlineGroundingBatch; consumedAttempts: number };
  expectedParentCount: number;
  manifestHash: string;
}

export interface RetainedStructureReviewProjection {
  findings: OutlineGroundingFinding[];
  attempts: Record<string, number>;
  authority: NonNullable<StructureReviewCheckpointBody['importedAuthority']>;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const sha256 = (value: string) => /^[a-f0-9]{64}$/.test(value);
function fail(reason: string): never { throw new Error(`structure-review-retained-${reason}`); }

/** Comparison ignores object key order only; arrays and every property remain
 * authoritative. Original parent bytes are hashed and retained independently. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function binding(finding: GroundingObjective): GroundingObjective {
  return { id: finding.id, themeIndex: finding.themeIndex, loIndex: finding.loIndex, topic: finding.topic, name: finding.name,
    contentHash: finding.contentHash, evidenceIds: finding.evidenceIds, materialIds: finding.materialIds,
    sourceIds: finding.sourceIds, learningPoints: finding.learningPoints };
}

function projectFinding(finding: OutlineGroundingFinding, batch: OutlineGroundingBatch): OutlineGroundingFinding {
  const expected = batch.objectives.find(row => row.id === finding.id);
  if (!expected || canonical(binding(finding)) !== canonical(expected)) fail('finding-binding');
  if (!Array.isArray(finding.coveredEvidenceIds) ||
      (finding.coveredEvidenceIds.length && finding.ignoredModelCoverage !== undefined)) fail('finding-coverage');
  const raw = { id: finding.id, sourceStatus: finding.status, sourceIds: finding.citedSourceIds, sourceReason: finding.reason,
    coveredEvidenceIds: finding.ignoredModelCoverage?.evidenceIds ?? finding.coveredEvidenceIds,
    topicFit: finding.topicFit, topicReason: finding.topicReason };
  const checked = validateOutlineGroundingRows({ reviews: [raw] }, selectOutlineGroundingBatch(batch, [finding.id]));
  if (checked.failures.length || checked.findings.length !== 1) fail('finding-invalid');
  const projected = checked.findings[0]!;
  const permitted = structuredClone(finding);
  if (finding.status !== 'supported' && finding.coveredEvidenceIds.length) {
    permitted.coveredEvidenceIds = [];
    permitted.ignoredModelCoverage = { authoritative: false, reason: 'negative-source-verdict', evidenceIds: [...finding.coveredEvidenceIds] };
  }
  if (canonical(permitted) !== canonical(projected)) fail('finding-changed');
  // Supported parent rows remain byte-identical. Negative projection changes
  // canonical coverage only, while the complete old row stays in authority.
  return finding.status === 'supported' ? structuredClone(finding) : projected;
}

/** Pure compatibility projection, not authority discovery or semantic review.
 * The server-owned loader must authenticate every supplied pin against the
 * immutable failed parent and artifact manifest before calling this function. */
export function projectRetainedStructureReviews(body: StructureReviewCheckpointBody,
  authority: RetainedStructureReviewAuthority): RetainedStructureReviewProjection {
  if (body.origin !== 'retained-artifact-import-v1' || authority.terminalStatus !== 'failed' ||
      body.rootRunId !== authority.parentRunId || body.courseId !== authority.parentCourseId) fail('parent-identity');
  if (!sha256(authority.manifestHash) || body.protocolHash !== outlineGroundingProtocolHash()) fail('manifest-or-protocol');
  if (body.baseBudget.pendingSends !== 0 || body.baseBudget.accounting === 'reported-usage-settlement-v1') fail('parent-budget');
  const replanned = planOutlineGrounding(body.themes, body.evidence, body.corpus.sections, body.reviewInputLimit);
  if (!exact(replanned, body.batches)) fail('proposal-binding');
  const expected = replanned.flatMap(batch => batch.objectives);
  const ids = expected.map(row => row.id);
  if (!exact(ids, authority.parentExpectedIds) || new Set(ids).size !== ids.length) fail('proposal-identity');
  if (!Number.isSafeInteger(authority.expectedParentCount) || authority.expectedParentCount <= 0 ||
      authority.parentFindings.length !== authority.expectedParentCount || authority.parentFindingHashes.length !== authority.expectedParentCount ||
      authority.expectedParentCount >= expected.length) fail('parent-count');
  const originalIds = authority.parentFindings.map(row => row.id);
  if (new Set(originalIds).size !== originalIds.length || !exact(originalIds, authority.parentFindingHashes.map(row => row.id)) ||
      originalIds.some(id => !ids.includes(id))) fail('parent-finding-identity');
  if (Object.keys(authority.parentAttempts).length !== originalIds.length ||
      Object.entries(authority.parentAttempts).some(([id, attempts]) => !originalIds.includes(id) || ![1, 2].includes(attempts))) fail('parent-attempts');
  const projected = authority.parentFindings.map((finding, index) => {
    const pin = authority.parentFindingHashes[index]!;
    if (!sha256(pin.hash) || pin.hash !== digest(finding)) fail('parent-finding-hash');
    const batch = replanned.find(row => row.objectives.some(objective => objective.id === finding.id));
    if (!batch) fail('finding-binding');
    return projectFinding(finding, batch!);
  });
  const correction = authority.corrected;
  if (correction.consumedAttempts !== 2 || correction.batch.objectives.length !== 1 ||
      !sha256(correction.rawSha256) || digest(correction.raw) !== correction.rawSha256) fail('correction-proof');
  const correctedId = correction.batch.objectives[0]!.id;
  if (originalIds.includes(correctedId)) fail('correction-already-resolved');
  const owner = replanned.find(batch => batch.objectives.some(row => row.id === correctedId));
  if (!owner || !exact(selectOutlineGroundingBatch(owner, [correctedId]), correction.batch)) fail('correction-binding');
  const checked = validateOutlineGroundingRows(correction.raw, correction.batch);
  if (checked.failures.length || checked.findings.length !== 1 || checked.findings[0]!.status === 'supported') fail('correction-invalid');
  projected.push(checked.findings[0]!);
  projected.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
  return { findings: projected, attempts: { ...authority.parentAttempts, [correctedId]: correction.consumedAttempts }, authority: {
    manifestHash: authority.manifestHash,
    parentFindingHashes: structuredClone(authority.parentFindingHashes),
    originalFindings: structuredClone(authority.parentFindings),
  } };
}
