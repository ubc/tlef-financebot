import type { ObjectId } from 'mongodb';
import { canvasEnabled } from '../components/canvas';
import { getDb } from '../components/mongodb';
import { coursesCol } from '../components/mongodb/collections';
import { env } from '../config/env';
import type { User } from '../types/domain';

/** Session-only grants avoid overwriting manual enrollment or resurrecting a removed Canvas grant. */
export async function projectCanvasEnrollment(user: User): Promise<User> {
  if (!canvasEnabled() || user.deactivatedAt) return user;
  const now = new Date();
  const links = await getDb().collection<{ _id: ObjectId }>('canvasLinks').find({ domain: env.canvasDomain, autoEnroll: true, validUntil: { $gt: now }, 'members.puid': user.puid }).toArray();
  if (!links.length) return user;
  const courses = await coursesCol().find({ _id: { $in: links.map(l => l._id) }, published: true,
    lifecycle: { $ne: 'archived' }, archivedAt: { $exists: false },
    $and: [{ $or: [{ termEnd: { $exists: false } }, { termEnd: { $gte: now } }] },
      { $or: [{ termStart: { $exists: false } }, { termStart: { $lte: now } }] }] }).toArray();
  const roles = [...user.courseRoles];
  for (const course of courses) if (!roles.some(r => r.courseId.equals(course._id) && r.role === 'student')) roles.push({ courseId: course._id, role: 'student' });
  return { ...user, courseRoles: roles };
}
