import type { ObjectId } from 'mongodb';
import type { Capability, CourseRole } from './domain';

/** One owner-controlled decision overrides every source for a course identity. */
export interface CoursePeopleAccess {
  courseId: ObjectId;
  subject: string;
  puid?: string;
  email?: string;
  role: CourseRole;
  status: 'pending' | 'active' | 'banned' | 'revoked';
  permissions?: Partial<Record<Capability, boolean>>;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  updatedByPuid: string;
  banReason?: string;
}
export interface CoursePerson {
  id: string;
  puid: string | null;
  cwl: string | null;
  email: string | null;
  displayName: string;
  role: CourseRole;
  owner: boolean;
  protected: boolean;
  status: 'active' | 'pending' | 'banned' | 'revoked' | 'expired' | 'deactivated';
  sources: string[];
  addedAt: string | null;
  lastLoginAt: string | null;
  revision: number;
  permissions: Partial<Record<Capability, boolean>>;
  banReason?: string;
}
export interface CoursePeoplePage {
  course: { id: string; name: string; code: string; section?: string; term: string; ownerPuid: string };
  canManage: boolean;
  people: CoursePerson[];
  total: number;
  counts: { people: number; invitations: number };
  page: number;
  pageSize: number;
  pageCount: number;
}
