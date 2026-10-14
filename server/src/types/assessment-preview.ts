import type { ObjectId } from 'mongodb';
import type { AssessmentSubmissionReason, AssessmentWindowLease, ExamSettings, PaperQuestion } from './exam-builder';

/** Teaching-team rehearsals are keyed to the real actor, never a student PUID. */
export interface AssessmentPreviewContext {
  instructorPuid: string;
  previewSessionId: string;
  access: 'restricted' | 'unrestricted';
}

export interface PreviewAssessmentAttempt extends AssessmentPreviewContext {
  window?: AssessmentWindowLease;
  submissionReason?: AssessmentSubmissionReason;
  courseId: ObjectId;
  examId: ObjectId;
  sourceStatus: 'published' | 'draft';
  publicationId?: ObjectId;
  sourceRevision: number;
  snapshot: {
    title: string;
    settings: ExamSettings;
    items: PaperQuestion[];
    releasedAt?: Date;
  };
  answerRevision: number;
  order: string[];
  answers: Record<string, string>;
  startedAt: Date;
  deadline: Date;
  expiresAt: Date;
  submittedAt?: Date;
  score?: number;
  maxScore: number;
}
