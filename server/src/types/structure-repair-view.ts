import type { StructureCoverageRepairAssessment, StructureCoverageRepairRequest } from './structure-repair';

export type StructureRepairMode = 'wording-only-outline-repair-v1' | 'coverage-wording-outline-repair-v1';
export type StructureRepairRequest =
  | { version: 'wording-only-outline-repair-v1'; targetIds: string[] }
  | { version: 'coverage-wording-outline-repair-v1'; targets: StructureCoverageRepairRequest[] };

export interface StructureRepairPointView {
  id: string; objective: string; materialId: string; materialName: string; chunkIndex: number;
  /** Exact retained quotes. These display excerpts do not replace the full originals used by review. */
  quotes: Array<{ passageId?: string; text: string }>;
}
export interface StructureRepairTargetView {
  id: string; topic: string; name: string; status: 'supported' | 'unsupported' | 'uncertain';
  mode: StructureRepairMode; reason: string;
  preservedEvidenceIds: string[]; missingEvidenceIds: string[];
  points: StructureRepairPointView[];
}
export interface StructureRepairChildView {
  runId: string; parentRunId: string; mode: StructureRepairMode;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
  /** True only for a completed, locally replayed authoritative child. Apply remains explicit. */
  canApply: boolean; unknownWork: boolean;
  error?: { code: string; message: string };
  targets: Array<{ id: string; topic: string; before: string; after?: string;
    proposalStatus: 'pending' | 'proposed' | 'no-repair'; proposalReason?: string;
    finding?: { status: 'supported' | 'unsupported' | 'uncertain'; reason: string;
      coveredEvidenceIds: string[]; citedSourceIds: string[] } }>;
  coverageAssessment?: Pick<StructureCoverageRepairAssessment, 'status' | 'targets'>;
}
/** Instructor-only projection. No checkpoint, model/provider configuration or raw model reply is public. */
export interface StructureRepairView {
  version: 'outline-wording-repair-view-v1'; requestedRunId: string; parentRunId: string;
  parentStatus: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
  availability: { canStart: boolean; reason: string | null; message: string };
  limits: { maxTargets: 2; maxPointsPerTarget: 8; maxSends: 10;
    maxInputUnits: 48000; maxOutputUnits: 6000; maxNewUnits: 540000 };
  budget: { accounting: 'conservative-units-v1'; remainingSends: number; remainingUnits: number };
  cycle: { used: boolean; childRunId?: string; childStatus?: StructureRepairChildView['status']; mode?: StructureRepairMode };
  /** Available choices are paginated before a cycle. A used cycle returns its
   * at-most-two original selected targets together on page 1 for quote review. */
  targets: { items: StructureRepairTargetView[]; total: number; page: number; pageSize: number };
  child?: StructureRepairChildView;
}
