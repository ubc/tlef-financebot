import type { Filter, ObjectId } from 'mongodb';
import { coursePeopleAccessCol, coursesCol, usersCol } from '../components/mongodb/collections';
import type { Course, CourseRole, User } from '../types/domain';

export function peopleRoleOpen(course: Course, role: CourseRole, now = new Date()): boolean {
  if (course.lifecycle === 'archived' || course.archivedAt || (course.termEnd && course.termEnd <= now)) return false;
  return role !== 'student' || Boolean(course.published && course.lifecycle !== 'draft' && (!course.termStart || course.termStart <= now));
}

/** Email is bound only through the canonical, unique persisted SAML identity. */
export async function activatePeopleInvitations(user: User): Promise<string | null> {
  if (user.deactivatedAt || !user.email) return null;
  const email = user.email.trim().toLowerCase();
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const identities = await usersCol().find({ email: { $regex: `^${escaped}$`, $options: 'i' } }).limit(2).toArray();
  if (identities.length !== 1 || identities[0].puid !== user.puid) return null;
  const invitations = await coursePeopleAccessCol().find({ email, status: { $in: ['pending', 'revoked', 'banned'] }, puid: { $exists: false } }).toArray();
  for (const invitation of invitations) {
    // An existing identity decision (especially a ban) takes precedence.
    if (await coursePeopleAccessCol().findOne({ courseId: invitation.courseId, subject: `puid:${user.puid}` })) continue;
    try {
      await coursePeopleAccessCol().updateOne({ _id: invitation._id, status: invitation.status, revision: invitation.revision }, {
        $set: { subject: `puid:${user.puid}`, puid: user.puid, status: invitation.status === 'pending' ? 'active' : invitation.status, updatedAt: new Date() }, $inc: { revision: 1 },
      });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
    }
  }
  return email;
}

/** Apply LAST at session reload: no CSV, Canvas or legacy invitation can restore a ban or an old role. */
export async function projectCoursePeopleAccess<T extends User>(user: T): Promise<T> {
  if (user.deactivatedAt) return user;
  const verifiedEmail = await activatePeopleInvitations(user);
  // A cancellation/role edit can win the binding CAS. Apply the verified email
  // decision too so a legacy grant cannot escape for that in-flight request.
  const controls = await coursePeopleAccessCol().find(verifiedEmail ? { $or: [{ puid: user.puid }, { email: verifiedEmail, puid: { $exists: false } }] } : { puid: user.puid }).toArray();
  if (!controls.length) return user;
  const bound = new Set(controls.filter(c => c.puid === user.puid).map(c => c.courseId.toHexString()));
  const effective = controls.filter(c => c.puid === user.puid || !bound.has(c.courseId.toHexString()));
  const courses = await coursesCol().find({ _id: { $in: effective.map(c => c.courseId) } }).toArray();
  const controlled = new Set(controls.map(c => c.courseId.toHexString()));
  const courseRoles = user.courseRoles.filter(r => !controlled.has(r.courseId.toHexString()));
  for (const control of effective) {
    const course = courses.find(c => c._id.equals(control.courseId));
    if (!course) continue;
    // Owner access cannot be removed, including by malformed historical records.
    if (course.ownerPuid === user.puid) { courseRoles.push({ courseId: course._id, role: 'instructor' }); continue; }
    if (control.status === 'active' && peopleRoleOpen(course, control.role)) courseRoles.push({ courseId: control.courseId, role: control.role });
  }
  return { ...user, courseRoles };
}

export async function canUseStudentCode(courseId: ObjectId, puid: string): Promise<boolean> {
  const control = await coursePeopleAccessCol().findOne({ courseId, puid });
  return !control || (control.status === 'active' && control.role === 'student');
}

/** Use for analytics/notifications as well as sessions: include new grants and exclude superseded sources. */
export async function peopleMembershipFilter(courseId: ObjectId, roles: CourseRole[], base: Filter<User>): Promise<Filter<User>> {
  const controls = await coursePeopleAccessCol().find({ courseId, puid: { $exists: true } }).toArray();
  if (!controls.length) return base;
  const course = await coursesCol().findOne({ _id: courseId });
  const included = controls.filter(c => course && c.status === 'active' && roles.includes(c.role) && peopleRoleOpen(course, c.role)).map(c => c.puid!);
  const excluded = controls.filter(c => c.puid !== course?.ownerPuid).map(c => c.puid!);
  return { $or: [{ $and: [base, { puid: { $nin: excluded } }] }, { puid: { $in: included }, deactivatedAt: { $exists: false } }] };
}
