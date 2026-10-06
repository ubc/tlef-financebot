import { comparePeopleImports } from './people-import-diff';
import type { PeopleImportChanges } from '../types/people-import';
import { peopleMembershipFilter } from './course-people-access.service';
import type { Filter, ObjectId, WithId } from 'mongodb';
import { auditCol, capabilitySettingsCol, coursePeopleImportsCol, coursesCol, usersCol } from '../components/mongodb/collections';
import type { CourseRole, TaInvite, User } from '../types/domain';
import { parsePeopleImport, peopleImportError } from './people-import-parser';

type Actor = Pick<User, 'puid' | 'isAdmin' | 'courseRoles'>;

async function checkCourse(courseId: ObjectId, actor: Actor, manage = false) {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) peopleImportError('course-not-found', 404);
  const canManage = actor.isAdmin || course.ownerPuid === actor.puid;
  if (manage ? !canManage : !canManage && !actor.courseRoles.some(r => r.role === 'instructor' && r.courseId.equals(courseId))) {
    peopleImportError('Only the course owner or an administrator can manage imported people.', 403);
  }
  if (manage && (course.lifecycle === 'archived' || course.archivedAt)) peopleImportError('Restore this course before importing people.', 409);
  return { course, canManage };
}

export async function getPeopleImport(courseId: ObjectId, actor: Actor) {
  const { canManage } = await checkCourse(courseId, actor);
  const saved = await coursePeopleImportsCol().findOne({ _id: courseId });
  return { revision: saved?.revision ?? 0, members: saved?.members ?? [], canManage,
    importedAt: saved?.importedAt.toISOString() ?? null, fileName: saved?.fileName ?? null, lastChanges: saved?.lastChanges ?? null };
}

/** The preview is tied to the exact import revision used for its comparison. */
export async function previewPeopleChanges(courseId: ObjectId, actor: Actor, text: string) {
  const saved = await getPeopleImport(courseId, actor);
  const preview = parsePeopleImport(text);
  return { ...preview, expectedRevision: saved.revision, changes: comparePeopleImports(saved.members, preview.members) };
}

export async function commitPeopleImport(courseId: ObjectId, actor: Actor, text: string,
  fileName: string, expectedRevision: number, confirmedTeachingAccess: boolean) {
  await checkCourse(courseId, actor, true);
  const preview = parsePeopleImport(text);
  if (!preview.members.length) peopleImportError('No usable people found. The existing import was kept.');
  if (preview.members.some(m => m.role !== 'student') && !confirmedTeachingAccess) {
    peopleImportError('Confirm that all imported teaching roles should receive access to the whole FinanceBot course.');
  }
  const previous = await getPeopleImport(courseId, actor);
  if (previous.revision !== expectedRevision) peopleImportError('People import changed. Reload and preview the file again.', 409);
  const changes = comparePeopleImports(previous.members, preview.members);
  await saveMembers(courseId, actor, expectedRevision, preview.members, fileName, changes);
  return { ...(await getPeopleImport(courseId, actor)), rejects: preview.rejects };
}

async function saveMembers(courseId: ObjectId, actor: Actor, expectedRevision: number,
  members: Awaited<ReturnType<typeof getPeopleImport>>['members'], fileName: string, lastChanges: PeopleImportChanges) {
  try {
    const saved = await coursePeopleImportsCol().findOneAndUpdate({ _id: courseId, revision: expectedRevision }, {
      $set: { courseId, members, lastChanges, fileName: fileName.slice(0, 200), importedAt: new Date(), importedByPuid: actor.puid },
      $inc: { revision: 1 },
    }, { upsert: expectedRevision === 0, returnDocument: 'after' });
    if (!saved) peopleImportError('People import changed. Reload and preview the file again.', 409);
    await auditCol().insertOne({ actorPuid: actor.puid, courseId, targetType: 'course-people-import', targetId: courseId,
      action: members.length ? 'course.people.import' : 'course.people.clear', createdAt: new Date(),
      detail: { revision: saved.revision, count: members.length } });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) peopleImportError('People import changed. Reload and preview the file again.', 409);
    throw error;
  }
}

export async function clearPeopleImport(courseId: ObjectId, actor: Actor, expectedRevision: number) {
  await checkCourse(courseId, actor, true);
  // Retain the revision tombstone so a stale tab cannot replay an old import.
  const previous = await getPeopleImport(courseId, actor);
  await saveMembers(courseId, actor, expectedRevision, [], '', comparePeopleImports(previous.members, []));
  return getPeopleImport(courseId, actor);
}

/** Recomputed from persisted User each request; independent of Canvas OAuth. */
export async function projectImportedCoursePeople(user: User): Promise<User> {
  if (user.deactivatedAt) return user;
  const snapshots = await coursePeopleImportsCol().find({ 'members.puid': user.puid }).toArray();
  if (!snapshots.length) return user;
  const courses = await coursesCol().find({ _id: { $in: snapshots.map(s => s.courseId) } }).toArray();
  const now = new Date();
  const courseRoles = [...user.courseRoles];
  for (const course of courses) {
    if (course.lifecycle === 'archived' || course.archivedAt || (course.termEnd && course.termEnd < now)) continue;
    for (const member of snapshots.find(s => s.courseId.equals(course._id))?.members ?? []) {
      if (member.puid !== user.puid || !['instructor', 'ta', 'student'].includes(member.role)) continue;
      if (member.role === 'student' && (!course.published || (course.termStart && course.termStart > now))) continue;
      if (!courseRoles.some(r => r.courseId.equals(course._id) && r.role === member.role)) courseRoles.push({ courseId: course._id, role: member.role });
    }
  }
  return { ...user, courseRoles };
}

/** Membership readers must include imported users without copying grants into User. */
export async function importedCourseRoleUserFilter(courseId: ObjectId, roles: CourseRole[]): Promise<Filter<User>> {
  const direct: Filter<User> = { courseRoles: { $elemMatch: { courseId, role: roles.length === 1 ? roles[0] : { $in: roles } } } };
  const snapshot = await coursePeopleImportsCol().findOne({ _id: courseId });
  if (!snapshot?.members.length) return peopleMembershipFilter(courseId, roles, direct);
  const course = await coursesCol().findOne({ _id: courseId });
  const now = new Date();
  if (!course || course.lifecycle === 'archived' || course.archivedAt || (course.termEnd && course.termEnd < now)) return peopleMembershipFilter(courseId, roles, direct);
  const puids = [...new Set(snapshot.members.filter(m => roles.includes(m.role)
    && (m.role !== 'student' || (course.published && (!course.termStart || course.termStart <= now)))).map(m => m.puid))];
  return peopleMembershipFilter(courseId, roles, puids.length ? { $or: [direct, { puid: { $in: puids }, deactivatedAt: { $exists: false } }] } : direct);
}

export async function importedTaInvites(courseId: ObjectId): Promise<Array<WithId<TaInvite> & { displayName: string; source: 'csv-import' }>> {
  const snapshot = await coursePeopleImportsCol().findOne({ _id: courseId });
  const members = snapshot?.members.filter(m => m.role === 'ta') ?? [];
  if (!snapshot || !members.length) return [];
  const [course, users, settings] = await Promise.all([
    coursesCol().findOne({ _id: courseId }),
    usersCol().find({ puid: { $in: members.map(m => m.puid) } }).toArray(),
    capabilitySettingsCol().findOne({ scope: 'course', courseId }),
  ]);
  const expired = !course || course.lifecycle === 'archived' || Boolean(course.archivedAt) || Boolean(course.termEnd && course.termEnd < new Date());
  return members.map(member => {
    const user = users.find(u => u.puid === member.puid);
    return { _id: courseId, courseId, email: user?.email ?? '', source: 'csv-import',
      displayName: user?.displayName || member.name || member.puid,
      activatedPuid: member.puid, status: expired || user?.deactivatedAt ? 'expired' : user ? 'active' : 'pending',
      invitedAt: snapshot.importedAt, updatedAt: snapshot.importedAt,
      permissions: settings?.userOverrides?.[member.puid] ?? {},
    };
  });
}
