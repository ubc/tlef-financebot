import type { ObjectId } from 'mongodb';

export interface CourseRegistrationCode {
  id: string;
  code: string;
  status: 'available' | 'claimed' | 'used' | 'revoked';
  claimedByPuid?: string;
  claimedAt?: Date;
  usedAt?: Date;
  revokedAt?: Date;
  revokedByPuid?: string;
  deletedAt?: Date;
  deletedByPuid?: string;
}

/** One atomic insert per idempotent instructor batch. Codes are single-use. */
export interface CourseRegistrationCodeBatch {
  courseId: ObjectId;
  requestId: string;
  createdByPuid: string;
  createdAt: Date;
  codes: CourseRegistrationCode[];
}

export interface RegistrationCodeRow {
  id: string;
  code: string;
  status: CourseRegistrationCode['status'] | 'expired';
  createdAt: string;
  claimedAt: string | null;
  usedAt: string | null;
  recipient: { puid: string; cwl: string; displayName: string; email: string; lastLoginAt: string | null } | null;
}

export interface RegistrationCodePage {
  codes: RegistrationCodeRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
