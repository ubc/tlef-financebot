import type { ObjectId } from 'mongodb';
import type { QuestionVersion } from './domain';

export interface InstructorQuestionNote {
  questionId: string;
  visibility: 'always' | 'after-submit';
  text?: string;
  materialId?: string;
  pageStart?: number;
  pageEnd?: number;
}
export interface LearningSettings {
  courseId: ObjectId;
  revision: number;
  mode: 'topic-practice' | 'linear';
  order: 'instructor' | 'personalized';
  questionOrder: string[];
  notes: InstructorQuestionNote[];
  updatedAt: Date;
}
export interface LearningActor { puid: string; previewSessionId?: string }
export interface LearningItem {
  questionId: string;
  versionId: string;
  loId: string;
  themeId: string;
  loName: string;
  themeName: string;
  version: QuestionVersion;
  paramValues?: Record<string, number>;
  selectedKey?: string;
  skipped: boolean;
  answer?: { key: string; correct: boolean; attemptId: ObjectId; at: Date };
  rating?: 'remembered' | 'learning';
  projected?: boolean;
}
export interface LearningSession {
  courseId: ObjectId;
  owner: string;
  previewSessionId?: string;
  kind: 'lesson' | 'test' | 'cards' | 'browse';
  scope: string;
  revision: number;
  cursor: number;
  items: LearningItem[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}
export interface ReviewMetadata {
  courseId: ObjectId;
  owner: string;
  previewSessionId?: string;
  questionId: string;
  saved: boolean;
  tags: string[];
  confusing: boolean;
  addedAt?: Date;
  lastReviewedAt?: Date;
  lastIncorrectAt?: Date;
  updatedAt: Date;
  expiresAt?: Date;
}
export type DiscussionCategory = 'general' | 'concept' | 'method' | 'explanation' | 'material' | 'logistics' | 'note';
export interface DiscussionReply {
  id: string;
  authorPuid: string;
  authorName: string;
  staff: boolean;
  anonymous: boolean;
  kind: 'student' | 'instructor' | 'followup';
  text: string;
  endorsed: boolean;
  createdAt: Date;
}
export interface DiscussionPost {
  courseId: ObjectId;
  previewOwner?: string;
  previewSessionId?: string;
  authorPuid: string;
  authorName: string;
  anonymous: boolean;
  category: DiscussionCategory;
  audience: 'course' | 'staff';
  title: string;
  text: string;
  questionId?: string;
  themeId?: string;
  loId?: string;
  pinned: boolean;
  resolved: boolean;
  closed: boolean;
  deletedAt?: Date;
  deletedBy?: string;
  revision: number;
  replies: DiscussionReply[];
  voters: string[];
  followers: string[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}
