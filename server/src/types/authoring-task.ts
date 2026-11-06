import type { ObjectId } from 'mongodb';
import type { Difficulty, QuestionType, StepModelConfig } from './domain';
import type { AuthoringIntent, GenerationQualityAssessment, GenerationQualityCandidate } from './generation-quality';
import type { GenerationNumericReviewReceipt } from './generation-numeric-review';
import type { RegenerationContent } from './regeneration';

export interface PedagogicalTaskDescriptor {
  concepts: string[];
  requiredInference: string;
  solutionPath: string[];
  misconception: string;
  targetDifficulty: Difficulty;
  achievedDifficulty?: Difficulty;
  passageIds: string[];
  intent: AuthoringIntent;
}
export interface QuestionPedagogicalFingerprint {
  courseId: ObjectId;
  questionId: ObjectId;
  versionId: ObjectId;
  familyId: ObjectId;
  policy: 'pedagogical-task-v2';
  model: StepModelConfig;
  descriptor: PedagogicalTaskDescriptor;
  /** Retrieval-only vector; neither it nor similarity is a quality verdict. */
  embedding?: number[];
  embeddingModel?: string;
  contentHash: string;
  createdAt: Date;
}
export interface AuthoringTaskPlan {
  courseId: ObjectId;
  runId: ObjectId;
  policy: 'grounded-memory-v2';
  authoringPromptProtocol?: 'compact-authoring-v1';
  numericReviewProtocol?: 'server-rendered-numeric-review-v1';
  exclusionReviewProtocol?: 'literal-exclusion-warrants-v1';
  reviewRepairProtocol?: 'frozen-review-decisions-v1';
  status: 'planned' | 'partial' | 'completed';
  evidencePacketId: string;
  memoryDigest: string;
  model: StepModelConfig;
  requestedCount: number;
  shortfall: number;
  reasons: string[];
  slots: Array<{
    item: number;
    slotId: string;
    descriptor: PedagogicalTaskDescriptor;
    status: 'reserved' | 'generated' | 'accepted' | 'withheld';
    candidate?: RegenerationContent & { type: QuestionType };
    quality?: GenerationQualityAssessment;
    validation?: { roleAssessment: string; moveAssessment?: string };
    review?: { decision: string; reasoning: string; suggestedDifficulty?: string; suggestedMove?: string };
    validationNumericReview?: { candidate: GenerationQualityCandidate; receipt: GenerationNumericReviewReceipt };
    reviewNumericReview?: { candidate: GenerationQualityCandidate; receipt: GenerationNumericReviewReceipt };
    acceptedQuestionId?: ObjectId;
    acceptedVersionId?: ObjectId;
    reasons: string[];
  }>;
  createdAt: Date;
  updatedAt: Date;
}
