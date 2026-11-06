import type { AuthoringBudgetReceipt } from './authoring-budget';
import type { ObjectId, WithId } from 'mongodb';
import type { Question, QuestionVersion, StepModelConfig } from './domain';
import type { GenerationEvidencePacket } from './generation-evidence';
import type { AuthoringRequirements, GenerationQualityAssessment } from './generation-quality';
import type { GenerationMemorySnapshot } from '../services/generation-memory.service';

export interface RegenerationContent {
  stem: string;
  options: QuestionVersion['options'];
  difficulty: QuestionVersion['difficulty'];
  taskDescriptor?: QuestionVersion['taskDescriptor'];
  numericKind?: QuestionVersion['numericKind'];
  paramSlots?: QuestionVersion['paramSlots'];
  derivedValues?: QuestionVersion['derivedValues'];
  verification?: QuestionVersion['verification'];
  sourceRefs: QuestionVersion['sourceRefs'];
  agentDecision: NonNullable<Question['agentDecision']>;
}

/** Guarded authoring data; never exposed by Student or token-ledger routes. */
export interface RegenerationCandidateRecord {
  courseId: ObjectId;
  questionId: ObjectId;
  requestedBy: string;
  requestId: string;
  requestHash: string;
  policy: 'grounded-memory-v2';
  sourceProvenance?: 'pdf-pages-v1';
  originalVersionId: ObjectId;
  original: WithId<QuestionVersion>;
  originalTags: { loIds: ObjectId[]; themeIds: ObjectId[] };
  originalState: Question['state'];
  prompt: string;
  requirements: AuthoringRequirements;
  status: 'preparing' | 'eligible' | 'withheld' | 'failed' | 'adopting' | 'adopted';
  candidate?: RegenerationContent;
  candidateHash?: string;
  evidence?: GenerationEvidencePacket;
  memory?: GenerationMemorySnapshot;
  contextId?: string;
  models: { generator: StepModelConfig; validator: StepModelConfig; reviewer: StepModelConfig };
  quality?: GenerationQualityAssessment;
  reasons: string[];
  /** ID links to receipts, including failed format/generation checks. */
  usageRunId: string;
  budget?: AuthoringBudgetReceipt;
  createdAt: Date;
  updatedAt: Date;
  adoptedVersionId?: ObjectId;
}
