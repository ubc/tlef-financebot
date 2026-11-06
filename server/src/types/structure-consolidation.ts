import type { GroundingObjective, OutlineGroundingFinding } from './structure';
import type { OutlineCapabilityComparison, OutlineCapabilityContext, OutlineCapabilityOriginal } from './structure-distinctness';

export type OutlineConsolidationProtocol = 'source-preserving-outline-consolidation-v1';
export interface OutlineConsolidationLineage { previousId: string; successorIds: string[] }
export interface OutlineConsolidationReplacement { id: string; name: string; evidenceIds: string[] }
/** Untrusted proposal only. No model-authored support, credit, cost or approval. */
export interface OutlineConsolidationProposal {
  version: OutlineConsolidationProtocol; planHash: string;
  replacements: OutlineConsolidationReplacement[]; lineage: OutlineConsolidationLineage[];
}
export interface OutlineConsolidationParentObservation {
  id: string; sourceFindingHash: string;
  capabilityObservationState: 'absent' | 'retained-parent-observation';
  /** Structurally replayed old rows, never fresh child approval. */
  capabilityComparisons?: OutlineCapabilityComparison[];
}
export interface OutlineConsolidationCreditObligation {
  evidenceId: string; previousOwnerIds: string[];
  point: GroundingObjective['learningPoints'][number];
}
/** Pure, locally bound obligations. The caller must separately authenticate the
 * parent raw history/current corpus in its course transaction. This object is
 * not a durable checkpoint, spending permission or Apply authority. */
export interface OutlineConsolidationPlan {
  version: OutlineConsolidationProtocol; protocolHash: string;
  parentContextHash: string; parentProposalHash: string; parentSourceFindingsHash: string;
  selectedIds: string[];
  members: Array<{ objective: GroundingObjective; sourceObservation: OutlineGroundingFinding;
    observation: OutlineConsolidationParentObservation }>;
  assignedPoints: GroundingObjective['learningPoints'];
  /** Exact retained review aliases AND original corpus IDs; do not join by id. */
  originals: OutlineCapabilityOriginal[];
  oldCreditObligations: OutlineConsolidationCreditObligation[];
  /** Presence/individual structural replay only, never global admission or
   * authenticated durable history; reciprocal contradictions may still exist. */
  parentCapabilityObservations: 'absent' | 'partial' | 'complete';
  authority: 'pure-obligations-only-raw-history-not-authenticated';
  planHash: string;
}
export interface OutlineConsolidationDirectedComparison {
  objectiveId: string; peerId: string; pairId: string; bindingHash: string;
}
export interface OutlineConsolidationComparisonClosure {
  allChildComparisons: OutlineConsolidationDirectedComparison[];
  added: OutlineConsolidationDirectedComparison[];
  removed: OutlineConsolidationDirectedComparison[];
  changed: Array<{ before: OutlineConsolidationDirectedComparison; after: OutlineConsolidationDirectedComparison }>;
  /** All current outgoing rows for every affected candidate, not just the
   * changed edge; the strict same-call parser requires a complete envelope. */
  requiredFreshComparisons: OutlineConsolidationDirectedComparison[];
  freshComparisonCandidateIds: string[];
  affectedUnchangedCandidateIds: string[];
  /** Absent parent rows cannot be reused, even for unchanged endpoints. */
  unreviewedParentComparisonCandidateIds: string[];
}
export interface OutlineConsolidationDraft {
  version: OutlineConsolidationProtocol; protocolHash: string; planHash: string;
  proposal: OutlineConsolidationProposal;
  childContext: OutlineCapabilityContext;
  survivorIds: string[]; retiredIds: string[];
  unchangedObjectiveIds: string[];
  /** Minimum changed targets. This authorizes no unchanged source-row reuse.
   * Every replacement needs new source review, even an unchanged survivor. */
  freshSourceTargetIds: string[];
  sourceReviewScope: 'minimum-replacements-only-unchanged-source-reuse-not-authorized';
  comparisonClosure: OutlineConsolidationComparisonClosure;
  oldCreditObligations: Array<OutlineConsolidationCreditObligation & { assignedSuccessorIds: string[] }>;
  memberCreditObligations: Array<{ previousId: string; evidenceId: string; assignedSuccessorIds: string[] }>;
  inheritedParentObservations: OutlineConsolidationParentObservation[];
  reviewAuthority: 'unreviewed-child-no-credit-or-adoption-authority';
  draftHash: string;
}
