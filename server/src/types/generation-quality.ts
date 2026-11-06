import type { PedagogicalTaskDescriptor } from './authoring-task';
import type { AuthoringBudgetReceipt } from './authoring-budget';
import type { GenerationEvidencePacket } from './generation-evidence';
import type { SourceLocation } from './source-provenance';
import type { QuestionType, QuestionOption, ParamSlot, DerivedValue, Difficulty } from './domain';
import type { GenerationExactBankReceipt } from '../services/generation-memory.service';
import type { GenerationTaskRetrievalReceipt } from '../services/generation-task-retrieval';
import type { GenerationNumericReviewReceipt } from './generation-numeric-review';
import type { GenerationExclusionReviewReceipt, GenerationExclusionWarrant } from './generation-exclusion-review';
import type { GenerationReviewRepairReceipt } from './generation-review-repair';

/** Guarded diagnostics omit private replay vectors and full Bank content. */
export type GenerationTaskRetrievalDiagnostic = Pick<GenerationTaskRetrievalReceipt,
  'protocol' | 'rankerVersion' | 'queryHash' | 'bindingsDigest' | 'status' | 'incompleteReason' |
  'headsScanned' | 'versionsChecked' | 'missingVersions' | 'invalidVersions' | 'invalidHeads' |
  'missingDescriptors' | 'ignoredProfiles' | 'unscannedHeadsLowerBound' | 'nominatedIds' |
  'retainedIds' | 'requiredComparisonIds'>;

/** Versioned, opt-in public authoring policy. Legacy runs remain baseline. */
export type GenerationQualityPolicy = 'baseline' | 'grounded-memory-v1' | 'grounded-memory-v2';

export type AuthoringIntent = 'edit-existing' | 'create-variant' | 'create-independent-task';
export interface AuthoringRequirements {
  intent: AuthoringIntent;
  requiredChanges: string[];
  preserve: string[];
  /** The original is reference data for edit invariants, never evidence. */
  original?: GenerationQualityCandidate;
  requestedDifficulty?: Difficulty;
  plannedTask?: PedagogicalTaskDescriptor;
  /** Server-owned first requiredChanges row; never accepted from model output. */
  plannedInferenceRequirement?: string;
  /** Server-owned opt-in; missing historical receipts keep their original protocol. */
  answerabilityProtocol?: 'option-answerability-v1';
  /** Fixed request demand is independent of a model's plan or achieved label. */
  taskDemandProtocol?: 'task-demand-v1';
  /** Local exact-content coverage is independent of bounded semantic prompts. */
  exactBankProtocol?: 'course-exact-bank-v1';
  /** Current-course task nomination is separate from exact matching and review. */
  taskRetrievalProtocol?: 'course-task-retrieval-v1';
  /** Versioned prompt-only compaction; full teacher/source/Bank data is retained. */
  authoringPromptProtocol?: 'compact-authoring-v1';
  /** Additional server-computed representation; no semantic/source authority. */
  numericReviewProtocol?: 'server-rendered-numeric-review-v1';
  exclusionReviewProtocol?: 'literal-exclusion-warrants-v1';
  reviewRepairProtocol?: 'frozen-review-decisions-v1';
  requestedKind?: 'numeric' | 'conceptual';
  requestedType?: QuestionType;
}

export interface GenerationTaskDemandAssessment {
  protocol: 'task-demand-v1';
  status: 'passed' | 'withheld';
  verdict: 'fulfilled' | 'unfulfilled' | 'uncertain';
  capacity: 'supported' | 'insufficient' | 'uncertain';
  rationale: string;
  missingOperation: string;
  /** Validated current aliases retained for a bounded same-packet repair. */
  spanIds: string[];
  /** Server hash of the complete immutable intent/teacher/plan requirements. */
  requirementsHash: string;
  citations: GenerationQualityCitation[];
  requested: { difficulty?: Difficulty; kind?: 'numeric' | 'conceptual'; type?: QuestionType };
  achieved: { difficulty?: Difficulty; kind?: 'numeric' | 'conceptual'; type: QuestionType };
  issues: Array<{ path: string; code: string }>;
}

export type AnswerabilityVerdict = 'fully-correct' | 'not-fully-correct' | 'undetermined';
export type AnswerabilityExclusion = 'none' | 'source-contradiction' | 'explicit-stem-condition' | 'incomplete-response' | 'undetermined';
export type GenerationAnswerabilityAssessment = {
  protocol: 'option-answerability-v1';
  exclusionProtocol?: 'literal-exclusion-warrants-v1';
  status: 'passed' | 'withheld';
  keyedOptionKey?: string;
  /** Derived from literal-answer findings, never accepted from model output. */
  resolvedCorrectKey?: string;
  issues: Array<{ path: string; code: string }>;
} & ({ kind: 'mcq'; options: Array<{ key: string; verdict: AnswerabilityVerdict; reason: string;
  exclusionBasis: AnswerabilityExclusion; exclusion: string; stemQuote: string; citations: GenerationQualityCitation[]; exclusionWarrant?: GenerationExclusionWarrant }> }
  | { kind: 'true-false'; stemTruth: 'true' | 'false' | 'undetermined'; reason: string; citations: GenerationQualityCitation[] });

export interface GenerationQualityCitation {
  kind: 'premise' | 'solution' | 'correction';
  claim: string;
  passageId: string;
  quote: string;
  /** Exact server-resolved source identity for guarded instructor page links. */
  materialId?: string;
  /** Server-resolved exact quote location; a locator, never a support verdict. */
  sourceLocation?: SourceLocation;
}

export interface GenerationQualityCandidate {
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  numericKind?: 'numeric' | 'conceptual';
  paramSlots?: ParamSlot[];
  derivedValues?: DerivedValue[];
  contentHash: string;
  truncated: boolean;
}

/** Externally checkable repair targets, never hidden model reasoning or proof. */
export interface GenerationValidationFinding {
  kind: 'source-scope' | 'actor-relation' | 'notation' | 'task-duplication' | 'answer-semantics' | 'instruction' | 'verbosity';
  target: 'stem' | 'options' | 'parameters' | 'task';
  status: 'defect' | 'uncertain';
  observation: string;
  correction: string;
  /** Exact original IDs resolved from the review's current S aliases. */
  passageIds: string[];
  /** Pinned Bank/Queue identities resolved from current M aliases. */
  memoryEntryIds: string[];
}

export interface GenerationSemanticRepairAudit {
  version: 1;
  strategy: 'correct-candidate' | 'replace-independent-task';
  critique: string;
  before: GenerationQualityCandidate;
  reasonsBefore: string[];
  findingsBefore: GenerationValidationFinding[];
  outcome: 'eligible' | 'withheld' | 'no-candidate' | 'budget-stopped' | 'failed';
  /** Safe error/admission code only; provider error payloads are not copied. */
  stopCode?: string;
  after?: GenerationQualityCandidate;
}

/** Model assessments plus server-validated references, not a proof of quality. */
export interface GenerationQualityAssessment {
  policy: 'grounded-memory-v1' | 'grounded-memory-v2';
  item: number;
  status: 'eligible' | 'withheld';
  sourceSupport: 'supported' | 'unsupported' | 'uncertain';
  notation: 'consistent' | 'inconsistent' | 'uncertain';
  novelty: 'independent' | 'duplicate' | 'variant' | 'uncertain';
  reasons: string[];
  citations: GenerationQualityCitation[];
  matchedEntryIds: string[];
  /** Explicit bounded task comparisons; source examples are never comparators. */
  taskComparisons?: Array<{ entryId: string; sameInference: boolean; sameSolutionPath: boolean; contrast: string }>;
  /** Pinned question/version identities shown to the novelty judge. */
  comparedEntryIds?: string[];
  evidencePacketId: string;
  memoryDigest: string;
  checkedAt: Date;
  intent?: AuthoringIntent;
  changes?: Array<{ requirement: string; status: 'fulfilled' | 'unfulfilled' | 'uncertain'; reason: string }>;
  invariants?: Array<{ requirement: string; status: 'preserved' | 'violated' | 'uncertain'; reason: string }>;
  achievedDifficulty?: Difficulty;
  requestedDifficulty?: Difficulty;
  difficultyMismatch?: boolean;
  justifiedLength?: 'justified' | 'excessive' | 'uncertain';
  missingPremises?: string[];
  /** Safe validation paths/codes, never raw model responses or hidden reasoning. */
  responseIssues?: Array<{ attempt: number; path: string; code: string }>;
  /** Validated references are locators; findings remain model judgments. */
  findings?: GenerationValidationFinding[];
  /** Same-call literal-answer check; source/model judgments are not formal proof. */
  answerability?: GenerationAnswerabilityAssessment;
  /** Same-call demand findings; labels/references are not semantic proof. */
  taskDemand?: GenerationTaskDemandAssessment;
  /** Server-derived current-template witness identity, never a model verdict. */
  numericReview?: GenerationNumericReviewReceipt;
  /** Same-call bounded literal exclusions; citations are locators, not entailment proof. */
  exclusionReview?: GenerationExclusionReviewReceipt;
  /** Logical schema correction preserves known semantic judgments. */
  reviewRepair?: GenerationReviewRepairReceipt;
  /** Server-computed current-version scan, never a model novelty verdict. */
  exactBank?: GenerationExactBankReceipt;
  /** Local nominations are retrieval coverage, never semantic verdicts. */
  taskRetrieval?: GenerationTaskRetrievalDiagnostic;
  /** One bounded content-repair history, retained only in guarded diagnostics. */
  semanticRepair?: GenerationSemanticRepairAudit;
  /** Bounded authoring evidence for withheld items that have no saved version. */
  candidate?: GenerationQualityCandidate;
  coverage: {
    evidenceTruncated: boolean;
    memoryTruncated: boolean;
    shownEntries: number;
    totalEntries: number;
    missingVersions: number;
    consistency: 'best-effort';
  };
}

export interface GenerationQualityRunResult {
  policy: 'grounded-memory-v1' | 'grounded-memory-v2';
  assessments: GenerationQualityAssessment[];
  /** Frozen originals used for review; kept outside the metadata-only usage ledger. */
  evidence?: GenerationEvidencePacket;
  evidencePackets?: GenerationEvidencePacket[];
  slotBudgets?: Array<{ item: number; receipt: AuthoringBudgetReceipt }>;
  taskPlanId?: string;
  independentRequested?: number;
  independentPlanned?: number;
  variantsCreated?: number;
  /** Initial planning readiness, including failures before any quality call. */
  taskRetrieval?: GenerationTaskRetrievalDiagnostic;
}
