import type { ObjectId } from 'mongodb';
import { canvasEnabled } from '../components/canvas';
import { getDb } from '../components/mongodb';
import { coursesCol } from '../components/mongodb/collections';
import { env } from '../config/env';
import type { CourseRole, User } from '../types/domain';

interface RoleSnapshot {
  _id: ObjectId;
  members: Array<{ puid: string; grants: Array<{ sourceId: string; role: CourseRole }> }>;
}

/** Called on persisted users at login and every session reload. Never writes grants to User. */
export async function projectCanvasEnrollment(user: User): Promise<User> {
  if (!canvasEnabled() || user.deactivatedAt) return user;
  const now = new Date();
  // Old integration_id snapshots must be refreshed before they can authorize anyone.
  const links = await getDb().collection<RoleSnapshot>('canvasLinks').find({ domain: env.canvasDomain,
    identityVersion: 'login-id-v1', autoEnroll: true, validUntil: { $gt: now }, 'members.puid': user.puid }).toArray();
  if (!links.length) return user;
  const courses = await coursesCol().find({ _id: { $in: links.map(l => l._id) },
    lifecycle: { $ne: 'archived' }, archivedAt: { $exists: false },
    $or: [{ termEnd: { $exists: false } }, { termEnd: { $gte: now } }] }).toArray();
  const roles = [...user.courseRoles];
  for (const course of courses) {
    const member = links.find(l => l._id.equals(course._id))?.members.find(m => m.puid === user.puid);
    for (const grant of member?.grants ?? []) {
      if (!['student', 'instructor', 'ta'].includes(grant.role)) continue;
      if (grant.role === 'student' && (!course.published || (course.termStart && course.termStart > now))) continue;
      if (!roles.some(r => r.courseId.equals(course._id) && r.role === grant.role)) roles.push({ courseId: course._id, role: grant.role });
    }
  }
  return { ...user, courseRoles: roles };
}
