import type { AuthoringBudgetReceipt } from './authoring-budget';
import type { SourceSelectionReport } from './material-upload';
import type { PdfPageTextObservationSummary } from './source-provenance';
import type { OutlineCapabilityAdmission, OutlineCapabilityComparison, OutlineCapabilityDistinctnessProtocol } from './structure-distinctness';

export interface GroundingObjective {
  id: string; themeIndex: number; loIndex: number; topic: string; name: string;
  contentHash: string; evidenceIds: string[]; materialIds: string[]; sourceIds: string[];
  learningPoints: Array<{ id: string; objective: string; materialId: string; sourceIds: string[] }>;
}
export interface OutlineGroundingFinding extends GroundingObjective {
  status: 'supported' | 'unsupported' | 'uncertain'; reason: string; citedSourceIds: string[];
  coveredEvidenceIds: string[];
  /** Present only on the explicit capability review branch; exact raw rows
   * remain independent of the original-source verdict. */
  capabilityComparisons?: OutlineCapabilityComparison[];
  /** Present on v2 reviews only. Historical source verdicts are never inferred
   * from v1 reason text or reclassified using topic placement. */
  topicFit?: 'fits' | 'misgrouped' | 'uncertain'; topicReason?: string;
  /** Diagnostic model claims from a negative/uncertain source verdict. These
   * IDs never count as mapped coverage or justify admission. */
  ignoredModelCoverage?: { authoritative: false; reason: 'negative-source-verdict'; evidenceIds: string[] };
}
interface OutlineGroundingReceiptBase {
  method: 'model-review-of-original-sections';
  totalObjectives: number; reviewedObjectives: number; supportedObjectives: number; withheldObjectives: number;
  complete: boolean; findings: OutlineGroundingFinding[];
  capabilityDistinctness?: OutlineCapabilityAdmission;
}
export type OutlineGroundingReceipt = OutlineGroundingReceiptBase & (
  { version: 'original-final-lo-review-v1'; groupingIssues?: never } |
  { version: 'original-final-lo-review-v2'; groupingIssues: number }
);

export interface StructureOptions {
  /** Experimental whole-proposal peer review. Historical absence keeps the
   * exact original-source-only review contract. */
  capabilityDistinctnessProtocol?: OutlineCapabilityDistinctnessProtocol;
  /** New durable requests select this explicitly. Absent historical requests
   * retain their exact synthesis prompts and pack identities. */
  synthesisProtocol?: 'source-condition-context-v1';
  /** Server-owned additive diagnostics; old exact runs keep field absence. */
  pageTextObservationProtocol?: 'native-page-text-observations-v1';
  sourceBatchId?: string;
  /** Explicit source-selection operation; old material/evidence is retained. */
  sourceReplacements?: Array<{ previousMaterialId: string; replacementMaterialId: string }>;
  materialIds?: string[];
  topicCount?: number;
  losPerTopic?: number;
  level?: 'auto' | 'introductory' | 'advanced';
  emphasis?: 'auto' | 'balanced' | 'conceptual' | 'applied';
  guidance?: string;
}

export interface StructureEvidence {
  id: string;
  objective: string;
  materialId: string;
  materialName: string;
  chunkIndex: number;
  quote: string;
  sourcePassageId?: string;
  extraction?: 'new' | 'reused';
  supportingPassages?: Array<{ passageId: string; quote: string }>;
}

export interface StructureSourceInventory {
  version: 'source-passage-inventory-v1';
  /** Accounting of parsed originals, never a measurement of pedagogical recall. */
  totalPassages: number;
  objectiveLinkedPassages: number;
  mappedPassages: number;
  targets: Array<{ materialId: string; materialName: string; chunkIndex: number; sectionId: string; passageId: string;
    cues: Array<'formula' | 'numerical-relationship' | 'visual-relationship'>;
    status: 'mapped' | 'unmapped-objective' | 'context' | 'non-instructional' | 'visual-review' | 'unreviewed';
    evidenceIds: string[]; reason?: string; quote?: string }>;
  materialsWithoutMappedObjectives: string[];
  potentialRedundantObjectives: Array<{ first: string; second: string; sharedEvidenceIds: string[] }>;
  redundancyAudit: { objectivesConsidered: number; totalObjectives: number; truncated: boolean };
}

export interface StructureDraft {
  themes: Array<{ name: string; los: Array<{ name: string }> }>;
}

export interface StructureSynthesisReceipt {
  /** Source-local context only: these records are never learning points,
   * source-support verdicts, or additional mapped coverage. */
  conditionContext?: StructureConditionContext;
  originalLedgerCharacters: number;
  deduplicatedLedgerCharacters: number;
  originalPassageReferences: number;
  distinctOriginalPassages: number;
  originalLedgerInputEstimate: number;
  deduplicatedLedgerInputEstimate: number;
  promptInputEstimateBefore?: number;
  promptInputEstimateAfter?: number;
  packCount?: number;
  completedPacks?: number;
  reusedPacks?: number;
  newPacks?: number;
  organizationInputEstimate?: number;
  packUnmappedEvidenceIds?: string[];
  validationFailures?: Array<{ stage: 'outline-synthesis' | 'outline-organization' | 'outline-source-review'; item?: number; attempt: number; reason: string }>;
  /** Minimum known complete experimental review, before its first send.
   * Corrections and unknown work can require more under the same allowance. */
  capabilityReviewPlan?: { version: 'outline-capability-distinctness-v1'; batches: number; inputUnits: number; outputUnits: number;
    minimumAdditionalUnits: number; maximumInputUnits: number; remainingUnits: number; remainingSends: number; fits: boolean };
}

export interface StructureConditionOriginal {
  id: string;
  materialId: string;
  sourceTextHash: string;
  parserVersion: string;
  chunkerVersion: string;
  chunkIndex: number;
  sectionId: string;
  passageId: string;
  quote: string;
}
export interface StructureConditionContext {
  version: 'source-condition-context-v1';
  sourceFingerprint: string;
  passagePolicy: 'word-boundary-v1' | 'line-boundary-v2';
  originals: StructureConditionOriginal[];
  conditions: Array<{ id: string; name: string; originalIds: string[]; evidenceIds: string[]; evidenceKeys: string[] }>;
  linkedConditions: number;
  orphanConditions: number;
  hash: string;
}

export interface StructureResult {
  themes: Array<{ name: string; los: Array<{ name: string; evidenceIds: string[]; materialIds: string[] }> }>;
  evidence: StructureEvidence[];
  coverage: {
    /** Exact original/ingest identities and intended selection used by this durable draft. */
    sourceFingerprint?: string;
    sourceSelection: SourceSelectionReport;
    cache: { hits: number; misses: number; reusedSections: number; extractedSections: number };
    budget: AuthoringBudgetReceipt;
    synthesisInput?: StructureSynthesisReceipt;
    sourceInventory?: StructureSourceInventory;
    /** Independent physical-page text volume, never cleared by mapped passages. */
    pageTextObservations?: StructurePageTextObservations;
    /** Large final merges are checked against originals; withheld wording is
     * diagnostic data and never part of the selectable themes. */
    outlineGrounding?: OutlineGroundingReceipt;
    materials: Array<{ materialId: string; name: string; chunks: number; sections: number; mappedObjectives: number }>;
    analyzedSections: number;
    extractedObjectives: number;
    mappedObjectives: number;
    unmappedEvidenceIds: string[];
    excludedSections: Array<{ materialId: string; chunkIndex: number; reason: string }>;
    warnings: string[];
  };
}

export interface StructurePageTextObservations {
  version: 'pdf-page-text-obligations-v1';
  materials: Array<{ materialId: string; materialName: string; provenanceId?: string; observation: PdfPageTextObservationSummary }>;
}
