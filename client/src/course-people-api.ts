import { apiRequest, type Capability } from './api.js';
export type PeopleRole = 'student' | 'ta' | 'instructor';
export interface CoursePerson {
  id: string; puid: string | null; cwl: string | null; email: string | null; displayName: string; role: PeopleRole;
  owner: boolean; protected: boolean; status: 'active' | 'pending' | 'banned' | 'revoked' | 'expired' | 'deactivated'; sources: string[];
  addedAt: string | null; lastLoginAt: string | null; revision: number; permissions: Partial<Record<Capability, boolean>>; banReason?: string;
}
export interface CoursePeoplePage {
  course: { id: string; name: string; code: string; section?: string; term: string; ownerPuid: string };
  canManage: boolean; people: CoursePerson[]; total: number; counts: { people: number; invitations: number }; page: number; pageSize: number; pageCount: number;
}
const path = (id: string) => `/api/courses/${encodeURIComponent(id)}/people`;
export function getCoursePeople(id: string, options: Record<string, string | number> = {}): Promise<CoursePeoplePage> {
  return apiRequest(`${path(id)}?${new URLSearchParams(Object.entries(options).map(([k, v]) => [k, String(v)]))}`);
}
export function inviteCoursePerson(id: string, identifier: string, role: PeopleRole, permissions: Partial<Record<Capability, boolean>>) {
  return apiRequest<{ id: string; status: string; revision: number }>(path(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, role, ...(role === 'ta' ? { permissions } : {}) }) });
}
export function changeCoursePerson(courseId: string, person: CoursePerson, change: { action: 'role' | 'ban' | 'unban' | 'cancel' | 'remove'; role?: PeopleRole; permissions?: Partial<Record<Capability, boolean>>; reason?: string }) {
  return apiRequest(`${path(courseId)}/${encodeURIComponent(person.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...change, expectedRevision: person.revision }) });
}
export function removeCoursePeople(courseId: string, people: CoursePerson[]) {
  return apiRequest<{ removed: string[]; failed: Array<{ id: string; status: number; message: string }> }>(`${path(courseId)}/remove`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ people: people.map(person => ({ id: person.id, expectedRevision: person.revision })) }),
  });
}
