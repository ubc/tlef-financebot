import type { ObjectId } from 'mongodb';
import type { StepModelConfig } from './domain';
import type { AuthoringBudgetReceipt } from './authoring-budget';
import type { SourceSelectionReport } from './material-upload';
import type { SourceExtractionSection } from './source-evidence';
import type { StructureEvidence, StructureOptions, StructureResult, StructureSynthesisReceipt, OutlineGroundingFinding, StructurePageTextObservations } from './structure';
import type { GroundingSection, OutlineGroundingBatch, OutlineGroundingRowFailure } from '../services/structure-outline-grounding';

export interface StructureReviewCorpus {
  /** Absent historical receipts retain word-boundary-v1 passage identities. */
  passagePolicy?: 'word-boundary-v1' | 'line-boundary-v2';
  sections: GroundingSection[];
  materials: Array<{ materialId: string; name: string; chunks: number; sections: number; sourceTextHash: string; parserVersion: string; chunkerVersion: string }>;
  fingerprint: string;
  sourceSelection: SourceSelectionReport;
  pageTextObservations?: StructurePageTextObservations;
}

/** This complete proposal is immutable and exists before its first review. */
export interface StructureReviewCheckpointBody {
  version: 'exact-outline-review-v1';
  courseId: string;
  rootRunId: string;
  origin: 'production-proposal-v1' | 'retained-artifact-import-v1' | 'wording-repair-proposal-v1';
  options: StructureOptions;
  corpus: StructureReviewCorpus;
  themes: StructureResult['themes'];
  evidence: StructureEvidence[];
  extractions: Array<{ sectionId: string; row: SourceExtractionSection; reused: boolean }>;
  excludedSections: StructureResult['coverage']['excludedSections'];
  cache: StructureResult['coverage']['cache'];
  synthesisInput?: StructureSynthesisReceipt;
  batches: OutlineGroundingBatch[];
  reviewInputLimit: number;
  model: StepModelConfig;
  providerIdentityHash: string;
  protocolHash: string;
  baseBudget: AuthoringBudgetReceipt;
  /** Only an explicit retained-file import supplies this immutable provenance. */
  importedAuthority?: { manifestHash: string; parentFindingHashes: Array<{ id: string; hash: string }>; originalFindings: OutlineGroundingFinding[] };
}
export interface StructureReviewCheckpoint {
  courseId: ObjectId;
  runId: ObjectId;
  hash: string;
  body: StructureReviewCheckpointBody;
  createdAt: Date;
}
export interface StructureReviewRunLink {
  checkpointId: ObjectId;
  checkpointHash: string;
  parentRunId?: ObjectId;
}
export interface StructureReviewProgress {
  courseId: ObjectId;
  checkpointId: ObjectId;
  checkpointHash: string;
  ownerRunId: ObjectId;
  continuationRunId?: ObjectId;
  continuationStartReservations?: number;
  continuationBaseBudget?: AuthoringBudgetReceipt;
  revision: number;
  findings: OutlineGroundingFinding[];
  attempts: Record<string, number>;
  failures: OutlineGroundingRowFailure[];
  unresolvedDispatchIds: string[];
  /** Cumulative reservations never reclaim failed/unknown work or reset in a child. */
  usedTokens: number;
  /** Covers native streaming envelopes; deliberately overreserves nonstreaming. */
  inputEstimator?: 'max-raw-or-single-user-envelope-utf8-bytes-plus32-v1';
  reservations: number;
  pendingNative: Array<{ id: string; callId?: string; input: number; output: number }>;
  maxTokens: number;
  maxSends: number;
  updatedAt: Date;
}
export interface StructureReviewAttempt {
  courseId: ObjectId;
  checkpointId: ObjectId;
  runId: ObjectId;
  dispatchId: string;
  ids: string[];
  attempt: number;
  item: number;
  status: 'claimed' | 'validated';
  raw?: unknown;
  rawHash?: string;
  findings?: OutlineGroundingFinding[];
  failures?: OutlineGroundingRowFailure[];
  createdAt: Date;
  completedAt?: Date;
}
