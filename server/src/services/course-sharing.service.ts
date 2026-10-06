import type { ObjectId, WithId } from 'mongodb';
import { auditCol, courseInstructorSharesCol, coursesCol, usersCol } from '../components/mongodb/collections';
import { NO_COURSE_ACCESS_BODY } from '../components/auth/course-guards';
import type { Course, User } from '../types/domain';
import type { CourseSharingSummary } from '../types/course-sharing';
import { resolveTeachingIdentity } from './teaching-identity.service';

type SharingActor = Pick<User, 'puid' | 'isAdmin' | 'courseRoles'>;
const UBC_EMAIL = /^[^\s@]+@(?:[^\s@.]+\.)*ubc\.ca$/i;

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

async function courseForSharing(courseId: ObjectId, actor: SharingActor, manage = false): Promise<WithId<Course>> {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) fail('course-not-found', 404);
  const owner = actor.isAdmin || course.ownerPuid === actor.puid;
  if (manage ? !owner : !owner && !actor.courseRoles.some(role => role.role === 'instructor' && role.courseId.equals(courseId))) {
    fail(NO_COURSE_ACCESS_BODY.error, 403);
  }
  return course;
}

async function userByEmail(email: string): Promise<WithId<User> | undefined> {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = await usersCol().find({ email: { $regex: `^${escaped}$`, $options: 'i' } }).limit(2).toArray();
  if (matches.length > 1) fail('course-sharing-ambiguous-email', 409);
  return matches[0];
}

async function auditSharing(actorPuid: string, courseId: ObjectId, targetId: ObjectId, action: string, detail: Record<string, unknown>): Promise<void> {
  await auditCol().insertOne({ actorPuid, courseId, targetType: 'course-instructor-share', targetId, action, detail, createdAt: new Date() });
}

export async function listCourseInstructors(courseId: ObjectId, actor: SharingActor): Promise<CourseSharingSummary> {
  const course = await courseForSharing(courseId, actor);
  const shares = await courseInstructorSharesCol().find({ courseId }).sort({ createdAt: 1, _id: 1 }).toArray();
  const puids = [...new Set([course.ownerPuid, ...shares.flatMap(share => share.recipientPuid ? [share.recipientPuid] : [])])];
  const users = await usersCol().find({ $or: [
    { puid: { $in: puids } },
    { courseRoles: { $elemMatch: { courseId, role: 'instructor' } } },
  ] }).toArray();
  const byPuid = new Map(users.map(user => [user.puid, user]));
  const memberPuids = [...new Set([
    course.ownerPuid,
    ...users.filter(user => user.courseRoles.some(role => role.role === 'instructor' && role.courseId.equals(courseId))).map(user => user.puid),
    ...shares.filter(share => share.status === 'active' && share.recipientPuid && byPuid.has(share.recipientPuid)).map(share => share.recipientPuid!),
  ])];
  return {
    courseId: courseId.toHexString(), courseName: course.name, courseCode: course.courseCode,
    ...(course.section ? { section: course.section } : {}), term: course.term,
    ownerPuid: course.ownerPuid, canManage: actor.isAdmin || course.ownerPuid === actor.puid,
    members: memberPuids.map(puid => {
      const user = byPuid.get(puid);
      return {
        puid, displayName: user?.displayName || user?.email || user?.uid || puid,
        ...(user?.email ? { email: user.email } : {}),
        role: puid === course.ownerPuid ? 'owner' : 'co-instructor',
        deactivated: Boolean(user?.deactivatedAt),
      };
    }),
    invitations: shares.map(share => ({
      id: share._id.toHexString(), email: share.email, status: share.status,
      ...(share.recipientPuid ? { recipientPuid: share.recipientPuid } : {}),
      ...(share.recipientPuid && byPuid.get(share.recipientPuid)?.displayName ? { displayName: byPuid.get(share.recipientPuid)!.displayName } : {}),
      invitedAt: share.createdAt.toISOString(), updatedAt: share.updatedAt.toISOString(),
    })),
  };
}

export async function inviteCourseInstructor(courseId: ObjectId, actor: SharingActor, rawIdentifier: string): Promise<CourseSharingSummary> {
  const course = await courseForSharing(courseId, actor, true);
  const { email, user: recipient } = await resolveTeachingIdentity(rawIdentifier, (reason, status) => fail(`course-sharing-${reason}`, status));
  if (recipient?.puid === course.ownerPuid) return listCourseInstructors(courseId, actor);
  if (recipient?.courseRoles.some(role => role.role === 'instructor' && role.courseId.equals(courseId))) return listCourseInstructors(courseId, actor);
  const existing = await courseInstructorSharesCol().findOne({ courseId, email });
  if (existing && existing.status !== 'revoked') return listCourseInstructors(courseId, actor);
  const now = new Date();
  const values = {
    status: recipient ? 'active' as const : 'pending' as const,
    ...(recipient ? { recipientPuid: recipient.puid } : {}),
    invitedByPuid: actor.puid, updatedAt: now,
  };
  let changedId: ObjectId | undefined;
  if (existing) {
    const changed = await courseInstructorSharesCol().findOneAndUpdate(
      { _id: existing._id, status: 'revoked', revision: existing.revision },
      { $set: values, $inc: { revision: 1 }, ...(!recipient ? { $unset: { recipientPuid: '' as const } } : {}) },
      { returnDocument: 'after' },
    );
    changedId = changed?._id;
  } else {
    try {
      const result = await courseInstructorSharesCol().insertOne({ courseId, email, ...values, revision: 0, createdAt: now });
      changedId = result.insertedId;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      // A concurrent identical invite won the unique (course,email) insertion.
    }
  }
  if (changedId) await auditSharing(actor.puid, courseId, changedId, 'course.instructor.invite', { email, ...(recipient ? { recipientPuid: recipient.puid } : {}) });
  return listCourseInstructors(courseId, actor);
}

export async function revokeCourseInstructorInvitation(courseId: ObjectId, actor: SharingActor, invitationId: ObjectId): Promise<CourseSharingSummary> {
  const course = await courseForSharing(courseId, actor, true);
  const share = await courseInstructorSharesCol().findOne({ _id: invitationId, courseId });
  if (!share) fail('course-sharing-invitation-not-found', 404);
  if (share.recipientPuid === course.ownerPuid) fail('course-sharing-owner-protected', 409);
  const result = await courseInstructorSharesCol().updateOne(
    { _id: invitationId, courseId, status: { $ne: 'revoked' } },
    { $set: { status: 'revoked', updatedAt: new Date() }, $inc: { revision: 1 } },
  );
  if (result.modifiedCount) await auditSharing(actor.puid, courseId, invitationId, 'course.instructor.revoke', { email: share.email });
  return listCourseInstructors(courseId, actor);
}

export async function removeCourseInstructor(courseId: ObjectId, actor: SharingActor, puid: string): Promise<CourseSharingSummary> {
  const course = await courseForSharing(courseId, actor, true);
  if (puid === course.ownerPuid) fail('course-sharing-owner-protected', 409);
  const target = await usersCol().findOne({ puid });
  // Revoke the authoritative grants before removing a legacy/direct role.
  const revoked = await revokeSharedInstructorGrants(courseId, puid);
  const direct = await usersCol().updateOne({ puid }, { $pull: { courseRoles: { courseId, role: 'instructor' } } });
  if (revoked || direct.modifiedCount) {
    await auditSharing(actor.puid, courseId, target?._id ?? courseId, 'course.instructor.remove', { recipientPuid: puid });
  }
  return listCourseInstructors(courseId, actor);
}

/** Claim only still-pending invitations against canonical, SAML-persisted email.
 * There is no copied User grant to resurrect if a revoke races this CAS. */
export async function activateCourseInstructorInvitations(user: User): Promise<void> {
  const email = (user.email ?? '').trim().toLowerCase();
  if (user.deactivatedAt || !UBC_EMAIL.test(email)) return;
  const pending = await courseInstructorSharesCol().find({ email, status: 'pending' }).toArray();
  if (!pending.length) return;
  let matched: WithId<User> | undefined;
  try { matched = await userByEmail(email); } catch (error) {
    // Ambiguous identity must never grant access, but should not block CWL login.
    if (error instanceof Error && error.message === 'course-sharing-ambiguous-email') return;
    throw error;
  }
  if (!matched || matched.puid !== user.puid || matched.deactivatedAt) return;
  for (const share of pending) {
    if (!await coursesCol().findOne({ _id: share.courseId }, { projection: { _id: 1 } })) continue;
    const claimed = await courseInstructorSharesCol().findOneAndUpdate(
      { _id: share._id, status: 'pending', revision: share.revision },
      { $set: { status: 'active', recipientPuid: user.puid, updatedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    );
    if (claimed) await auditSharing(user.puid, share.courseId, share._id, 'course.instructor.accept', { recipientPuid: user.puid, email });
  }
}

/** Internal primitive shared with Admin revocation. Also cancels pending email
 * invitations, so a concurrent first CWL login cannot re-grant removed access. */
export async function revokeSharedInstructorGrants(courseId: ObjectId, puid: string): Promise<number> {
  const target = await usersCol().findOne({ puid });
  const email = target?.email.trim().toLowerCase();
  const result = await courseInstructorSharesCol().updateMany(
    { courseId, status: { $ne: 'revoked' }, $or: [{ recipientPuid: puid }, ...(email ? [{ email }] : [])] },
    { $set: { status: 'revoked', updatedAt: new Date() }, $inc: { revision: 1 } },
  );
  return result.modifiedCount;
}

/** Effective active grants for read-only directory/notification consumers. */
export async function activeSharedInstructorPuids(courseId?: ObjectId): Promise<string[]> {
  const shares = await courseInstructorSharesCol().find({ status: 'active', ...(courseId ? { courseId } : {}) }).toArray();
  if (!shares.length) return [];
  const ids = [...new Map(shares.map(share => [share.courseId.toHexString(), share.courseId])).values()];
  const existing = await coursesCol().find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray();
  const exists = new Set(existing.map(course => course._id.toHexString()));
  return [...new Set(shares.flatMap(share => share.recipientPuid && exists.has(share.courseId.toHexString()) ? [share.recipientPuid] : []))];
}

/** Read-only projection for sessions and directory consumers. Active records are
 * authoritative; revoked grants and deleted courses cannot survive a refresh. */
export async function projectCourseInstructorShares<T extends User>(users: T[], options: { includeDeactivated?: boolean } = {}): Promise<T[]> {
  if (!users.length) return [];
  const shares = await courseInstructorSharesCol().find({ status: 'active', recipientPuid: { $in: users.filter(user => options.includeDeactivated || !user.deactivatedAt).map(user => user.puid) } }).toArray();
  if (!shares.length) return users;
  const ids = [...new Map(shares.map(share => [share.courseId.toHexString(), share.courseId])).values()];
  const existing = await coursesCol().find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray();
  const exists = new Set(existing.map(course => course._id.toHexString()));
  return users.map(user => {
    const courseRoles = [...user.courseRoles];
    if (options.includeDeactivated || !user.deactivatedAt) for (const share of shares) {
      if (share.recipientPuid !== user.puid || !exists.has(share.courseId.toHexString())) continue;
      if (!courseRoles.some(role => role.role === 'instructor' && role.courseId.equals(share.courseId))) courseRoles.push({ courseId: share.courseId, role: 'instructor' });
    }
    return { ...user, courseRoles };
  });
}
