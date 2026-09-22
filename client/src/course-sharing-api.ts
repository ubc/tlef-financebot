import { apiRequest } from './api.js';

export interface CourseInstructorMember {
  puid: string;
  displayName: string;
  email?: string;
  role: 'owner' | 'co-instructor';
  deactivated: boolean;
}

export interface CourseInstructorInvitation {
  id: string;
  email: string;
  status: 'pending' | 'active' | 'revoked';
  recipientPuid?: string;
  displayName?: string;
  invitedAt: string;
  updatedAt: string;
}

export interface CourseSharingSummary {
  courseId: string;
  courseName: string;
  courseCode: string;
  section?: string;
  term: string;
  ownerPuid: string;
  canManage: boolean;
  members: CourseInstructorMember[];
  invitations: CourseInstructorInvitation[];
}

const coursePath = (courseId: string): string => `/api/courses/${encodeURIComponent(courseId)}`;

export const getCourseSharing = (courseId: string): Promise<CourseSharingSummary> =>
  apiRequest<CourseSharingSummary>(`${coursePath(courseId)}/instructors`);

export const addCourseInstructor = (courseId: string, identifier: string): Promise<CourseSharingSummary> =>
  apiRequest<CourseSharingSummary>(`${coursePath(courseId)}/instructor-invitations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier }),
  });

export const revokeCourseInvitation = (courseId: string, invitationId: string): Promise<CourseSharingSummary> =>
  apiRequest<CourseSharingSummary>(`${coursePath(courseId)}/instructor-invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' });

export const removeCourseInstructor = (courseId: string, puid: string): Promise<CourseSharingSummary> =>
  apiRequest<CourseSharingSummary>(`${coursePath(courseId)}/instructors/${encodeURIComponent(puid)}`, { method: 'DELETE' });
