import type { ObjectId, WithId } from 'mongodb';
import { canvasEnabled } from '../components/canvas';
import { getDb } from '../components/mongodb';
import { coursesCol } from '../components/mongodb/collections';
import { env } from '../config/env';
import type { Course, CourseRole, User } from '../types/domain';

interface RoleSnapshot {
  _id: ObjectId;
  members: Array<{ puid: string; grants: Array<{ sourceId: string; role: CourseRole }> }>;
}

function eligibleLinkQuery(now: Date) {
  return { domain: env.canvasDomain, identityVersion: 'login-id-v1', autoEnroll: true, validUntil: { $gt: now } };
}
async function linkedCourses(links: RoleSnapshot[], now: Date) {
  return coursesCol().find({ _id: { $in: links.map(l => l._id) }, lifecycle: { $ne: 'archived' }, archivedAt: { $exists: false },
    $or: [{ termEnd: { $exists: false } }, { termEnd: { $gte: now } }] }).toArray();
}
function canvasRoleOpen(course: Course, role: CourseRole, now: Date): boolean {
  return ['student', 'instructor', 'ta'].includes(role)
    && (role !== 'student' || Boolean(course.published && (!course.termStart || course.termStart <= now)));
}
function applyCanvasRoles<T extends User>(user: T, links: RoleSnapshot[], courses: Array<WithId<Course>>, now: Date): T {
  if (user.deactivatedAt) return user;
  const roles = [...user.courseRoles];
  for (const course of courses) {
    const member = links.find(l => l._id.equals(course._id))?.members.find(m => m.puid === user.puid);
    for (const grant of member?.grants ?? []) {
      if (!canvasRoleOpen(course, grant.role, now)) continue;
      if (!roles.some(r => r.courseId.equals(course._id) && r.role === grant.role)) roles.push({ courseId: course._id, role: grant.role });
    }
  }
  return { ...user, courseRoles: roles };
}
/** Called on persisted users at login and every session reload. Never writes grants to User. */
export async function projectCanvasEnrollment(user: User): Promise<User> {
  return (await projectCanvasEnrollmentBatch([user]))[0];
}
/** Batch directory reads use the same exact-PUID and lifecycle checks as login. */
export async function projectCanvasEnrollmentBatch<T extends User>(users: T[]): Promise<T[]> {
  if (!canvasEnabled()) return users;
  const puids = users.filter(u => !u.deactivatedAt).map(u => u.puid);
  if (!puids.length) return users;
  const now = new Date();
  const links = await getDb().collection<RoleSnapshot>('canvasLinks').find({ ...eligibleLinkQuery(now),
    'members.puid': puids.length === 1 ? puids[0] : { $in: puids } }).toArray();
  if (!links.length) return users;
  const courses = await linkedCourses(links, now);
  return users.map(user => applyCanvasRoles(user, links, courses, now));
}
/** Only authorization snapshots participate; Canvas display-only People are excluded. */
export async function canvasRoleCandidatePuids(courseId?: ObjectId, role?: CourseRole): Promise<string[]> {
  if (!canvasEnabled()) return [];
  const now = new Date();
  const links = await getDb().collection<RoleSnapshot>('canvasLinks').find({ ...eligibleLinkQuery(now), ...(courseId ? { _id: courseId } : {}) }).toArray();
  if (!links.length) return [];
  const courses = await linkedCourses(links, now);
  return [...new Set(links.flatMap(link => {
    const course = courses.find(c => c._id.equals(link._id));
    return course ? link.members.filter(m => m.grants.some(g => (!role || g.role === role) && canvasRoleOpen(course, g.role, now))).map(m => m.puid) : [];
  }))];
}
