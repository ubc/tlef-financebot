import type { GroundingObjective, OutlineGroundingFinding } from './structure';
import type { GroundingSection } from '../services/structure-outline-grounding';

export type OutlineCapabilityDistinctnessProtocol = 'outline-capability-distinctness-v1';
export interface OutlineCapabilityOriginal extends GroundingSection { alias: string }
export interface OutlineCapabilityPair {
  id: string; firstId: string; secondId: string; bindingHash: string;
}
/** A full plan or a deterministic candidate-scoped projection of that plan.
 * Peers are retrieval nominations, never duplicate or source-support verdicts. */
export interface OutlineCapabilityContext {
  version: OutlineCapabilityDistinctnessProtocol;
  protocolHash: string; proposalHash: string; contextHash: string;
  candidateIds: string[];
  objectives: GroundingObjective[];
  nominations: Array<{ objectiveId: string; peerIds: string[] }>;
  pairs: OutlineCapabilityPair[];
  sources: OutlineCapabilityOriginal[];
}
export interface OutlineCapabilityQuote { sourceId: string; quote: string }
export interface OutlineCapabilityWitness { operation: string; quotes: OutlineCapabilityQuote[] }
export interface OutlineSharedCapabilityWitness {
  operation: string; candidateQuotes: OutlineCapabilityQuote[]; peerQuotes: OutlineCapabilityQuote[];
}
/** Exact model-authored same-call rows retained for parser replay. Source
 * snippets validate reference integrity, not the semantic judgment itself. */
export interface OutlineCapabilityComparison {
  objectiveId: string; peerId: string; pairId: string;
  relation: 'distinct' | 'partial-overlap' | 'equivalent' | 'uncertain';
  candidateOperation: string; peerOperation: string;
  sharedCapabilities: OutlineSharedCapabilityWitness[];
  candidateUniqueCapabilities: OutlineCapabilityWitness[];
  peerUniqueCapabilities: OutlineCapabilityWitness[];
  reason: string;
}
export interface OutlineCapabilityFinding {
  id: string; capabilityComparisons: OutlineCapabilityComparison[];
}
export interface OutlineCapabilityFailure { id: string; reason: string }
export interface OutlineCapabilityValidation {
  findings: OutlineCapabilityFinding[]; failures: OutlineCapabilityFailure[];
}
export type CapabilityCheckedSourceFinding = OutlineGroundingFinding & {
  capabilityComparisons?: OutlineCapabilityComparison[];
};
/** A validated relation cannot block an admitted duplicate when its peer is
 * independently source-ineligible in the same immutable, complete review.
 * These are local admission diagnostics, never new semantic verdicts. */
export interface NonBlockingSourceIneligiblePeers {
  version: 'resolved-source-ineligible-peers-v1';
  comparisons: Array<{
    objectiveId: string; peerId: string; pairId: string;
    relation: Exclude<OutlineCapabilityComparison['relation'], 'distinct'>;
    peerSourceStatus: 'unsupported' | 'uncertain';
    peerSourceFindingHash: string; comparisonHash: string;
  }>;
}
export interface OutlineCapabilityAdmission {
  version: OutlineCapabilityDistinctnessProtocol; contextHash: string;
  complete: boolean; eligibleIds: string[];
  held: Array<{ id: string; reasons: Array<'source-not-supported' | 'source-verdict-missing-or-invalid' | 'comparison-missing-or-invalid' | 'review-incomplete' | 'partial-overlap' | 'equivalent' | 'uncertain'> }>;
  nonBlockingSourceIneligiblePeers?: NonBlockingSourceIneligiblePeers;
  bindingHash: string;
}
