import type { ObjectId } from 'mongodb';
import type { StepModelConfig } from './domain';
import type { AuthoringBudgetReceipt } from './authoring-budget';
import type { OutlineGroundingFinding } from './structure';
import type { StructureReviewCheckpointBody } from './structure-review';
import type { OutlineGroundingRowFailure } from '../services/structure-outline-grounding';

export interface StructureRepairRunLink { branchId: ObjectId; inputHash: string; parentRunId: ObjectId }
export interface StructureCoverageRepairRequest { id: string; evidenceIds: string[] }
export interface StructureCoverageRepairTarget extends StructureCoverageRepairRequest {
  /** Derived only from the exact supported parent finding. */
  preserveEvidenceIds: string[];
  contentHash: string;
  findingHash: string;
}
export interface StructureCoverageRepairAssessment {
  version: 'coverage-wording-outline-repair-v1';
  status: 'passed' | 'shortfall';
  targets: Array<{ id: string; status: 'covered' | 'shortfall'; requestedEvidenceIds: string[];
    preservedEvidenceIds: string[]; missingEvidenceIds: string[]; lostEvidenceIds: string[]; reasons: string[] }>;
  /** Binds exact target requirements and fresh immutable objective findings. */
  bindingHash: string;
}
interface StructureRepairInputBase {
  cycle: 1; parentRunId: string; parentRunHash: string;
  parentCheckpointId: string; parentCheckpointHash: string; parentProgressHash: string;
  targetIds: string[]; model: StepModelConfig; providerIdentityHash: string; protocolHash: string;
  sourceFingerprint: string; baseBudget: AuthoringBudgetReceipt;
  limits: { maxSends: 10; maxInputTokens: 48000; maxOutputTokens: 6000; maxEstimatedTokens: 540000 };
}
export type StructureRepairInput = StructureRepairInputBase & (
  { version: 'wording-only-outline-repair-v1'; coverageTargets?: never } |
  { version: 'coverage-wording-outline-repair-v1'; coverageTargets: StructureCoverageRepairTarget[] }
);
export interface StructureRepairReviewAttempt {
  id: string; ids: string[]; attempt: number; item: number; status: 'claimed' | 'validated';
  raw?: unknown; rawHash?: string; findings?: OutlineGroundingFinding[]; failures?: OutlineGroundingRowFailure[];
}
export interface StructureRepairBranch {
  courseId: ObjectId; runId: ObjectId; requestedBy: string; inputHash: string; input: StructureRepairInput;
  revision: number; createdAt: Date; updatedAt: Date;
  proposalState: 'unclaimed' | 'claimed' | 'validated'; proposalRaw?: unknown; proposalRawHash?: string;
  /** Written once, before independent review; never overwritten with results. */
  proposalBody?: StructureReviewCheckpointBody; proposalBodyHash?: string; changedIds?: string[];
  findings: OutlineGroundingFinding[]; attempts: Record<string, number>; failures: OutlineGroundingRowFailure[];
  unresolvedDispatchIds: string[]; reviewAttempts: StructureRepairReviewAttempt[];
  /** Server-computed admission result; model proposals cannot set this. */
  coverageAssessment?: StructureCoverageRepairAssessment;
  usedTokens: number; reservations: number; newReservations: number;
  inputEstimator: 'max-raw-or-single-user-envelope-utf8-bytes-plus32-v1';
  pendingNative: Array<{ id: string; callId?: string; input: number; output: number; stage: string }>;
}
