import type { ObjectId } from 'mongodb';

export interface QuestionDraft {
  courseId: ObjectId;
  questionId: ObjectId;
  baseVersionId: ObjectId;
  state: string;
  revision: number;
  updatedAt: Date;
  updatedBy: string;
  commit?: { id: string; by: string; until: Date };
  lastCommit?: { id: string; versionId: ObjectId };
}

export interface QuestionPresence {
  courseId: ObjectId;
  questionId: ObjectId;
  clientId: string;
  puid: string;
  name: string;
  field: string;
  expiresAt: Date;
}
