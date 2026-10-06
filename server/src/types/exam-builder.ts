import type { ObjectId } from 'mongodb';
import type { Difficulty, QuestionOption, QuestionType } from './domain';

export interface PaperQuestion {
  id: string;
  source: 'bank' | 'generated' | 'variant';
  questionId?: string;
  versionId?: string;
  familyId: string;
  loIds: string[];
  type: QuestionType;
  difficulty: Difficulty;
  stem: string;
  options: QuestionOption[];
  points: number;
  minutes: number;
  seed?: number;
  paramValues?: Record<string, number>;
  validated: boolean;
  approval?: { by: string; at: string };
  assessment?: { decision: string; reasoning: string };
  sourceRefs?: Array<{ materialId: string; chunk?: string }>;
  practiceExposure: boolean;
}
export interface ExamSettings {
  title: string;
  kind: 'midterm' | 'final';
  purpose: 'formal' | 'practice';
  durationMinutes: number;
  opensAt: string;
  closesAt: string;
  timeZone: string;
  feedback: 'instructor' | 'after-close' | 'immediate';
  shuffle: boolean;
  accommodations: Array<{ puid: string; extraMinutes: number }>;
}
export interface BuilderExam {
  courseId: ObjectId;
  revision: number;
  displayTitle?: string;
  deletingAt?: Date;
  settings: ExamSettings;
  items: PaperQuestion[];
  activeRunIds?: string[];
  startedAt?: Date;
  publicationId?: ObjectId;
  publishedRevision?: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface ExamPublication {
  courseId: ObjectId;
  examId: ObjectId;
  revision: number;
  settings: ExamSettings;
  items: PaperQuestion[];
  publishedBy: string;
  publishedAt: Date;
  releasedAt?: Date;
  hash: string;
}
export interface ExamCandidate {
  courseId: ObjectId;
  examId: ObjectId;
  runId: ObjectId;
  item: PaperQuestion;
  createdAt: Date;
}
export interface ExamGenerationCell {
  id: string;
  loId: string;
  secondaryLoIds?: string[];
  type: QuestionType;
  difficulty: Difficulty;
  parent?: { questionId: string; versionId: string; mode: 'parameters' | 'context' };
}
export interface ExamGenerationProgress {
  item: number;
  stage: 'retrieving' | 'generating' | 'validating' | 'reviewing' | 'saving';
  preview?: { stem: string; options?: Array<{ key: string; text: string }> };
}
export interface ExamBuildRun {
  operationId?: string;
  progress?: ExamGenerationProgress;
  courseId: ObjectId;
  examId: ObjectId;
  requestedBy: string;
  requestId: string;
  status: 'planned' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  prompt: string;
  interpretation: string;
  conflicts: string[];
  cells: ExamGenerationCell[];
  completed: string[];
  failures: Array<{ itemId: string; message: string }>;
  createdAt: Date;
  updatedAt: Date;
}
export interface AssessmentAttempt {
  answerRevision: number;
  courseId: ObjectId;
  examId: ObjectId;
  publicationId: ObjectId;
  puid: string;
  revision: number;
  order: string[];
  answers: Record<string, string>;
  startedAt: Date;
  deadline: Date;
  submittedAt?: Date;
  score?: number;
  maxScore: number;
}
