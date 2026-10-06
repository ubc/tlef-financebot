import type { Difficulty, NumericVerification, QuestionType, QuestionKind, QuestionGenerationRun } from './domain';
import type { GenerationEvidencePacket } from './generation-evidence';
import type { GenerationQualityAssessment, GenerationQualityCandidate, GenerationQualityPolicy } from './generation-quality';
import type { ModelCallReceipt, ModelUsageSummary } from './model-usage';

/** An observation export, never a claim that an experiment was prospectively paired. */
export interface GenerationEvaluationCall {
  id: string;
  stage: string;
  item?: number;
  candidateAttempt?: number;
  jsonAttempt?: number;
  provider: string;
  requestedModel: string;
  actualModel: string | null;
  requestOptions: ModelCallReceipt['requestOptions'];
  outcome: ModelCallReceipt['outcome'];
  usage: ModelCallReceipt['usage'];
  retryVisibility: ModelCallReceipt['retryVisibility'];
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface GenerationEvaluationSlot {
  item: number;
  /** Missing historical records are unavailable, not invented generation failures. */
  outcome: 'saved' | 'withheld' | 'failed' | 'unavailable';
  candidate?: GenerationQualityCandidate;
  assessment?: GenerationQualityAssessment;
  questionVersionId?: string;
  failureCodes: string[];
  /** Original copied excerpts, not a reconstructed complete evidence packet. */
  recordedSourceRefs?: Array<{ materialId: string; chunk?: string }>;
  recordedSourceRefsTruncated?: boolean;
  numericVerification?: Omit<NumericVerification, 'verifiedAt'> & { verifiedAt: string };
}

export interface GenerationEvaluationExport {
  schemaVersion: 'generation-evaluation-export-v1';
  exportedAt: string;
  run: {
    id: string;
    courseId: string;
    loId: string;
    secondaryLoIds?: string[];
    policy: GenerationQualityPolicy;
    requestedSlots: number;
    type: QuestionType;
    difficulty?: Difficulty;
    hardnessMove?: string;
    kind?: QuestionKind;
    prompt?: string;
    grounding?: { allowedMaterialIds: string[]; retrievedChunkCount: number; pinned?: boolean };
    status: 'completed' | 'partial' | 'failed';
    models: QuestionGenerationRun['input']['models'];
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
  };
  slots: GenerationEvaluationSlot[];
  evidence?: GenerationEvidencePacket;
  usage: {
    summary: ModelUsageSummary;
    calls: GenerationEvaluationCall[];
    totalCalls: number;
    callsTruncated: boolean;
  };
  limitations: string[];
}
