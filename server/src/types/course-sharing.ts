import type { ObjectId } from 'mongodb';

/** Authoritative course-scoped Instructor grants; never copied into User. */
export interface CourseInstructorShare {
  courseId: ObjectId;
  email: string;
  status: 'pending' | 'active' | 'revoked';
  recipientPuid?: string;
  invitedByPuid: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseSharingSummary {
  courseId: string;
  courseName: string;
  courseCode: string;
  section?: string;
  term: string;
  ownerPuid: string;
  canManage: boolean;
  members: Array<{
    puid: string;
    displayName: string;
    email?: string;
    role: 'owner' | 'co-instructor';
    deactivated: boolean;
  }>;
  invitations: Array<{
    id: string;
    email: string;
    status: CourseInstructorShare['status'];
    recipientPuid?: string;
    displayName?: string;
    invitedAt: string;
    updatedAt: string;
  }>;
}
