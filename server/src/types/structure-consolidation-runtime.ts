import type { ObjectId } from 'mongodb';
import type { StepModelConfig } from './domain';
import type { AuthoringBudgetReceipt } from './authoring-budget';
import type { OutlineConsolidationProposal } from './structure-consolidation';
import type { OutlineGroundingFinding } from './structure';
import type { OutlineGroundingRowFailure } from '../services/structure-outline-grounding';
import type { ModelCallEvent } from '../components/genai/llm';

export const DURABLE_OUTLINE_CONSOLIDATION = 'durable-outline-consolidation-v1' as const;
export interface StructureConsolidationRunLink {
  version: typeof DURABLE_OUTLINE_CONSOLIDATION;
  checkpointId: ObjectId; checkpointHash: string; parentRunId: ObjectId;
  phase: 'proposal' | 'review';
  reviewBindingHash?: string;
}
/** Immutable prospective identity. Parent originals remain in their immutable
 * authenticated checkpoint; no source verdict is inherited by the child. */
export interface StructureConsolidationBody {
  version: typeof DURABLE_OUTLINE_CONSOLIDATION;
  courseId: string; parentRunId: string; parentCheckpointId: string; parentCheckpointHash: string;
  parentAuthorityHash: string; sourceFingerprint: string; selectedIds: string[];
  obligationsHash: string; runtimeHash: string; reviewProtocolHash: string;
  model: StepModelConfig; providerIdentityHash: string; baseBudget: AuthoringBudgetReceipt;
  inputLimit: number; mode: 'automatic' | 'manual';
  manualProposal?: OutlineConsolidationProposal;
}
export interface StructureConsolidationCheckpoint {
  courseId: ObjectId; parentCheckpointId: ObjectId; parentCheckpointHash: string;
  cycle: 1; body: StructureConsolidationBody; hash: string; revision: number;
  proposalRunId: ObjectId; reviewRunId?: ObjectId;
  state: 'proposing' | 'proposed' | 'reviewing' | 'completed' | 'failed';
  proposal?: OutlineConsolidationProposal; proposalHash?: string;
  acceptedProposal?: OutlineConsolidationProposal; reviewPlanHash?: string;
  reviewBaseBudget?: AuthoringBudgetReceipt; reviewBindingHash?: string;
  projectionHash?: string; resultHash?: string;
  findings: OutlineGroundingFinding[]; failures: OutlineGroundingRowFailure[];
  attempts: Record<string, number>; unresolvedDispatchIds: string[];
  nativeCount: number; estimatedInputUnits: number; reservedOutputUnits: number;
  createdAt: Date; updatedAt: Date; error?: string;
}
export interface StructureConsolidationDispatch {
  courseId: ObjectId; checkpointId: ObjectId; runId: ObjectId;
  dispatchId: string; sequence: number; phase: 'proposal' | 'review';
  item: number; attempt: number; ids: string[]; status: 'claimed' | 'validated';
  prompt?: string; promptHash?: string; raw?: unknown; rawHash?: string;
  planHash?: string; findings?: OutlineGroundingFinding[]; failures?: OutlineGroundingRowFailure[];
  createdAt: Date; completedAt?: Date;
}
/** Actual instrumented SDK attempts, including native JSON correction. Unknown
 * attempts retain the full reservation. Hidden transport retries are unknown. */
export interface StructureConsolidationNativeAttempt {
  courseId: ObjectId; checkpointId: ObjectId; runId: ObjectId; dispatchId: string;
  sequence: number; jsonAttempt: number; prompt: string; promptHash: string;
  inputUnits: number; outputUnits: number; model: string;
  status: 'reserved' | 'started' | 'succeeded' | 'failed';
  callId?: string; started?: ModelCallEvent; finished?: ModelCallEvent;
  visible?: string; visibleHash?: string; createdAt: Date; completedAt?: Date;
}
export interface StructureConsolidationView {
  version: typeof DURABLE_OUTLINE_CONSOLIDATION; parentRunId: string;
  available: boolean; reason?: string;
  selectedIds: string[]; candidates: Array<{ id: string; topic: string; name: string; coveredPoints: number }>;
  checkpointId?: string; revision?: number; state?: StructureConsolidationCheckpoint['state'];
  proposalRunId?: string; reviewRunId?: string; proposal?: OutlineConsolidationProposal;
  proposalHash?: string; proposalStatus?: 'unreviewed';
  obligations?: { points: Array<{ id: string; objective: string; sourceIds: string[] }>; originals: Array<{ alias: string; id: string; materialName: string; text: string }>; oldCredits: Array<{ evidenceId: string; previousOwnerIds: string[] }> };
  changes?: Array<{ id: string; before: string; after?: string }>;
  budget?: { consumedUnits: number; remainingUnits: number; consumedSends: number; remainingSends: number; accounting: 'conservative-reservations-v1' };
  canReview: boolean; canApply: boolean;
  scope: 'full-child-fresh-source-and-capability-review';
}
