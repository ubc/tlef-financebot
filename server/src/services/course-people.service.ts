import type { ObjectId, WithId } from 'mongodb';
import { auditCol, capabilitySettingsCol, courseInstructorSharesCol, coursePeopleAccessCol, coursePeopleImportsCol, coursesCol, taInvitesCol, usersCol } from '../components/mongodb/collections';
import { canvasLinks } from './canvas.service';
import { env } from '../config/env';
import { resolveTeachingIdentity } from './teaching-identity.service';
import { peopleRoleOpen } from './course-people-access.service';
import type { Capability, CourseRole, User } from '../types/domain';
import type { CoursePeopleAccess, CoursePeoplePage, CoursePerson } from '../types/course-people';

type Actor = Pick<User, 'puid' | 'isAdmin' | 'courseRoles'>;
const roles = ['instructor', 'ta', 'student'] as const;
export const PEOPLE_TA_CAPABILITIES: Capability[] = ['question.review', 'question.mark-reviewed', 'flag.triage', 'question.suggest-edit', 'analytics.view', 'analytics.individual'];
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
export async function peopleCourse(courseId: ObjectId, actor: Actor, manage = false) {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) fail('Course not found.', 404);
  const canManage = actor.isAdmin || actor.puid === course.ownerPuid;
  if (manage ? !canManage : !canManage && !actor.courseRoles.some(r => r.courseId.equals(courseId) && r.role === 'instructor')) fail('Only the course owner or an Admin can manage people.', 403);
  if (manage && (course.lifecycle === 'archived' || course.archivedAt)) fail('Restore this course before changing access.', 409);
  return { course, canManage };
}
function cleanPermissions(permissions?: Partial<Record<Capability, boolean>>) {
  return Object.fromEntries(PEOPLE_TA_CAPABILITIES.map(k => [k, permissions?.[k] ?? true])) as Partial<Record<Capability, boolean>>;
}

/** Course-scoped union, with identity decisions applied before search and pagination.
 * Only this bounded page is sent to the client; raw gradebooks and grades never leave the import parser. */
async function directory(courseId: ObjectId, actor: Actor) {
  const { course, canManage } = await peopleCourse(courseId, actor);
  const [snapshot, controls, shares, tas, canvas, settings] = await Promise.all([
    coursePeopleImportsCol().findOne({ _id: courseId }), coursePeopleAccessCol().find({ courseId }).toArray(),
    courseInstructorSharesCol().find({ courseId, status: { $ne: 'revoked' } }).toArray(),
    taInvitesCol().find({ courseId, status: { $in: ['pending', 'active'] } }).toArray(),
    canvasLinks().findOne({ _id: courseId, domain: env.canvasDomain, identityVersion: 'login-id-v1', autoEnroll: true, validUntil: { $gt: new Date() } }),
    capabilitySettingsCol().findOne({ scope: 'course', courseId }),
  ]);
  const puids = new Set([course.ownerPuid, ...(snapshot?.members.map(m => m.puid) ?? []), ...controls.flatMap(c => c.puid ? [c.puid] : []),
    ...shares.flatMap(s => s.recipientPuid ? [s.recipientPuid] : []), ...tas.flatMap(t => t.activatedPuid ? [t.activatedPuid] : []), ...(canvas?.members.map(m => m.puid) ?? [])]);
  const emails = [...new Set([...controls, ...shares, ...tas].flatMap(r => r.email ? [r.email.toLowerCase()] : []))];
  const users = await usersCol().find({ $or: [{ puid: { $in: [...puids] } }, { courseRoles: { $elemMatch: { courseId } } }, { email: { $in: emails } }] }, {
    projection: { puid: 1, uid: 1, displayName: 1, email: 1, courseRoles: 1, createdAt: 1, lastLoginAt: 1, deactivatedAt: 1, isAdmin: 1 },
  }).toArray();
  const byPuid = new Map(users.map(u => [u.puid, u]));
  const rows = new Map<string, CoursePerson>();
  function add(puid: string | undefined, email: string | undefined, name: string | undefined, role: CourseRole, source: string, addedAt?: Date) {
    const identity = puid ? byPuid.get(puid) : undefined;
    const id = puid ? `puid:${puid}` : `email:${email!.toLowerCase()}`;
    const previous = rows.get(id);
    if (previous) {
      if (!previous.sources.includes(source)) previous.sources.push(source);
      if (roles.indexOf(role) < roles.indexOf(previous.role)) previous.role = role;
      return previous;
    }
    const row: CoursePerson = { id, puid: puid ?? null, cwl: identity?.uid || null, email: identity?.email || email || null,
      displayName: identity?.displayName || name || email || puid!, role, owner: puid === course.ownerPuid,
      protected: puid === course.ownerPuid || Boolean(identity?.isAdmin), status: identity?.deactivatedAt ? 'deactivated' : puid && identity ? 'active' : 'pending',
      sources: [source], addedAt: addedAt?.toISOString() ?? null, lastLoginAt: identity?.lastLoginAt?.toISOString() ?? null, revision: 0,
      permissions: settings?.userOverrides?.[puid ?? ''] ?? {} };
    rows.set(id, row); return row;
  }
  add(course.ownerPuid, undefined, undefined, 'instructor', 'Course owner', course.createdAt);
  for (const u of users) for (const r of u.courseRoles.filter(r => r.courseId.equals(courseId))) add(u.puid, u.email, u.displayName, r.role, 'Direct access', u.createdAt);
  for (const m of snapshot?.members ?? []) add(m.puid, undefined, m.name, m.role, 'Gradebook / CSV', snapshot!.importedAt);
  for (const m of canvas?.members ?? []) for (const g of m.grants) add(m.puid, undefined, m.name, g.role, 'Canvas', canvas?.syncedAt);
  for (const s of shares) add(s.recipientPuid, s.email, undefined, 'instructor', 'Invitation', s.createdAt);
  for (const t of tas) add(t.activatedPuid, t.email, undefined, 'ta', 'Invitation', t.invitedAt);
  for (const c of controls) {
    // Once bound, suppress the old pending-email representation of the same invitation.
    if (c.puid && c.email) rows.delete(`email:${c.email}`);
    const row = add(c.puid, c.email, undefined, c.role, 'Owner override', c.createdAt);
    if (!row.owner) { row.role = c.role; row.status = c.status; }
    if (c.status === 'active' && c.puid && !byPuid.has(c.puid)) row.status = 'pending';
    row.revision = c.revision;
    row.permissions = { ...c.permissions, ...settings?.userOverrides?.[c.puid ?? ''] };
    row.banReason = c.banReason;
    if (c.status !== 'revoked' && byPuid.get(c.puid ?? '')?.deactivatedAt) row.status = 'deactivated';
  }
  for (const row of rows.values()) if (!row.owner && ['active', 'pending'].includes(row.status) && !peopleRoleOpen(course, row.role)) {
    row.status = course.lifecycle === 'archived' || course.archivedAt || (course.termEnd && course.termEnd <= new Date()) ? 'expired' : 'pending';
  }
  return { course, canManage, people: [...rows.values()] };
}
export async function listCoursePeople(courseId: ObjectId, actor: Actor, options: { page?: number; pageSize?: number; search?: string; role?: CourseRole; status?: string; tab?: 'people' | 'invitations' } = {}): Promise<CoursePeoplePage> {
  const data = await directory(courseId, actor);
  const search = options.search?.trim().toLowerCase() ?? '';
  const people = data.people.filter(p => options.tab === 'invitations' ? !p.puid && ['pending', 'expired'].includes(p.status) : p.status !== 'revoked')
    .filter(p => (!options.role || p.role === options.role) && (!options.status || p.status === options.status)
      && (!search || [p.displayName, p.email, p.cwl, p.puid].some(v => v?.toLowerCase().includes(search))))
    .sort((a, b) => Number(b.owner) - Number(a.owner) || a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  const pageSize = options.pageSize ?? 10;
  const pageCount = Math.max(1, Math.ceil(people.length / pageSize));
  const page = Math.min(options.page ?? 1, pageCount);
  return { course: { id: courseId.toHexString(), name: data.course.name, code: data.course.courseCode, section: data.course.section, term: data.course.term, ownerPuid: data.course.ownerPuid },
    canManage: data.canManage, people: people.slice((page - 1) * pageSize, page * pageSize), total: people.length, page, pageSize, pageCount,
    counts: { people: data.people.filter(p => p.status !== 'revoked').length, invitations: data.people.filter(p => !p.puid && ['pending', 'expired'].includes(p.status)).length } };
}

async function saveDecision(courseId: ObjectId, actor: Actor, subject: string, expectedRevision: number, fields: Pick<CoursePeopleAccess, 'role' | 'status'> & Partial<Pick<CoursePeopleAccess, 'puid' | 'email' | 'permissions' | 'banReason'>>, action: string) {
  const now = new Date();
  let saved: WithId<CoursePeopleAccess> | null;
  try {
    saved = await coursePeopleAccessCol().findOneAndUpdate({ courseId, subject, revision: expectedRevision }, {
      $set: { ...fields, updatedAt: now, updatedByPuid: actor.puid }, $inc: { revision: 1 },
      $setOnInsert: { courseId, subject, createdAt: now },
    }, { upsert: expectedRevision === 0, returnDocument: 'after' });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) fail('Access changed in another session. Refresh People and try again.', 409);
    throw error;
  }
  if (!saved) fail('Access changed in another session. Refresh People and try again.', 409);
  await auditCol().insertOne({ actorPuid: actor.puid, courseId, targetType: 'course-person', targetId: saved._id, action, createdAt: now,
    detail: { subject, role: fields.role, status: fields.status, revision: saved.revision } });
  return { id: subject, status: saved.status, revision: saved.revision };
}
export async function inviteCoursePerson(courseId: ObjectId, actor: Actor, identifier: string, role: CourseRole, permissions?: Partial<Record<Capability, boolean>>) {
  const { course } = await peopleCourse(courseId, actor, true);
  const identity = await resolveTeachingIdentity(identifier, (reason, status) => fail(({
    'invalid-email': 'Enter a UBC email address.', 'invalid-identifier': 'Enter a UBC email or CWL login name.',
    'cwl-not-found': 'This CWL login name has not signed in yet. Invite their UBC email instead.',
    'ambiguous-email': 'This email matches multiple accounts. Use an existing CWL login name.',
    'ambiguous-cwl': 'This CWL login name matches multiple accounts. Contact an Admin.',
    'user-deactivated': 'This account is deactivated. An Admin must restore it first.',
  } as Record<string, string>)[reason] ?? reason, status));
  if (identity.user?.puid === course.ownerPuid) fail('The course owner already has access.', 409);
  const subject = identity.user ? `puid:${identity.user.puid}` : `email:${identity.email}`;
  const previous = await coursePeopleAccessCol().findOne({ courseId, subject });
  if (previous && previous.status !== 'revoked') fail('This person already has an access decision. Use People to change their role or unban them.', 409);
  const existing = (await directory(courseId, actor)).people.find(p => p.id === subject && p.status !== 'revoked');
  if (existing) fail('This person is already listed. Change their role in People.', 409);
  return saveDecision(courseId, actor, subject, previous?.revision ?? 0, {
    ...(identity.user ? { puid: identity.user.puid } : {}), email: identity.email, role, status: identity.user ? 'active' : 'pending',
    permissions: role === 'ta' ? cleanPermissions(permissions) : {},
  }, 'course.people.invite');
}
type PersonChange = { action: 'role' | 'ban' | 'unban' | 'cancel' | 'remove'; role?: CourseRole; permissions?: Partial<Record<Capability, boolean>>; reason?: string };
export async function changeCoursePerson(courseId: ObjectId, actor: Actor, id: string, expectedRevision: number, change: PersonChange) {
  await peopleCourse(courseId, actor, true);
  const row = (await directory(courseId, actor)).people.find(p => p.id === id);
  return changePersonDecision(courseId, actor, row, id, expectedRevision, change);
}
async function changePersonDecision(courseId: ObjectId, actor: Actor, row: CoursePerson | undefined, id: string, expectedRevision: number, change: PersonChange) {
  if (!row) fail('Person not found in this course.', 404);
  if (row.protected) fail('Owner and platform Admin access cannot be changed here.', 403);
  if (row.revision !== expectedRevision) fail('Access changed. Refresh People and try again.', 409);
  if (row.status === 'deactivated' && change.action !== 'remove') fail('This account is deactivated. An Admin must restore it first.', 409);
  if (change.action === 'remove' && row.status === 'revoked') fail('This person has already been removed. Refresh People.', 409);
  if (change.action === 'cancel' && (row.puid || !['pending', 'expired'].includes(row.status))) fail('Only pending email invitations can be cancelled.', 409);
  if (change.action === 'ban' && !row.puid) fail('Cancel this pending invitation instead.', 409);
  if (change.action === 'unban' && row.status !== 'banned') fail('This person is not banned.', 409);
  if (change.action === 'role' && (!change.role || row.status === 'banned' || row.status === 'revoked')) fail('Unban the person before changing their role.', 409);
  const role = change.action === 'role' ? change.role! : row.role;
  return saveDecision(courseId, actor, id, expectedRevision, { ...(row.puid ? { puid: row.puid } : {}), ...(row.email ? { email: row.email.toLowerCase() } : {}), role,
    status: change.action === 'ban' ? 'banned' : change.action === 'unban' ? 'active' : ['cancel', 'remove'].includes(change.action) ? 'revoked' : row.puid ? 'active' : 'pending',
    permissions: role === 'ta' ? cleanPermissions(change.action === 'role' ? change.permissions ?? row.permissions : row.permissions) : {}, banReason: change.action === 'ban' ? (change.reason ?? '').trim().slice(0, 500) : '',
  }, `course.people.${change.action}`);
}

/** Independent revision checks retain successful removals when another row changed. */
export async function removeCoursePeople(courseId: ObjectId, actor: Actor, people: Array<{ id: string; expectedRevision: number }>) {
  await peopleCourse(courseId, actor, true);
  if (!people.length || people.length > 100 || new Set(people.map(p => p.id)).size !== people.length) fail('Select between 1 and 100 distinct people.');
  const rows = new Map((await directory(courseId, actor)).people.map(row => [row.id, row]));
  const removed: string[] = [];
  const failed: Array<{ id: string; status: number; message: string }> = [];
  for (const person of people) {
    try {
      await changePersonDecision(courseId, actor, rows.get(person.id), person.id, person.expectedRevision, { action: 'remove' });
      removed.push(person.id);
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500;
      // Unknown infrastructure errors must not be mistaken for a row-level denial.
      if (status < 400 || status >= 500) throw error;
      failed.push({ id: person.id, status, message: (error as Error).message });
    }
  }
  return { removed, failed };
}
