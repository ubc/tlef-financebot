import { ObjectId } from 'mongodb';
import type { CoursePeopleAccess } from '../../server/src/types/course-people';
import type { User } from '../../server/src/types/domain';
jest.mock('../../server/src/components/mongodb/collections', () => ({ auditCol: jest.fn(), capabilitySettingsCol: jest.fn(), courseInstructorSharesCol: jest.fn(), coursePeopleAccessCol: jest.fn(), coursePeopleImportsCol: jest.fn(), coursesCol: jest.fn(), taInvitesCol: jest.fn(), usersCol: jest.fn() }));
jest.mock('../../server/src/services/canvas.service', () => ({ canvasLinks: jest.fn(() => ({ findOne: async () => null })) }));
jest.mock('../../server/src/services/teaching-identity.service', () => ({ resolveTeachingIdentity: jest.fn() }));
import { auditCol, capabilitySettingsCol, courseInstructorSharesCol, coursePeopleAccessCol, coursePeopleImportsCol, coursesCol, taInvitesCol, usersCol } from '../../server/src/components/mongodb/collections';
import { changeCoursePerson, inviteCoursePerson, listCoursePeople, removeCoursePeople } from '../../server/src/services/course-people.service';
import { canvasLinks } from '../../server/src/services/canvas.service';
import { resolveTeachingIdentity } from '../../server/src/services/teaching-identity.service';

const id = new ObjectId(); const actor = { puid: 'OWNER', isAdmin: false, courseRoles: [{ courseId: id, role: 'instructor' }] } as User;
const person = { _id: new ObjectId(), puid: 'PERSON', email: 'person@ubc.ca', displayName: 'Known Student', uid: 'person', courseRoles: [], createdAt: new Date(), lastLoginAt: new Date() } as unknown as User;
let controls: Array<CoursePeopleAccess & { _id: ObjectId }>;
let people: User[];
let imported: Array<{ puid: string; name: string; role: 'student' }>;
const write = jest.fn();
const audit = jest.fn();
beforeEach(() => {
  controls = []; people = [actor, person]; imported = [{ puid: 'PERSON', name: 'Student from import', role: 'student' }];
  jest.mocked(canvasLinks).mockReturnValue({ findOne: async () => null } as never);
  write.mockReset().mockImplementation(async (filter, update) => ({ _id: new ObjectId(), ...update.$setOnInsert, ...update.$set, revision: (filter.revision ?? 0) + 1 })); audit.mockReset();
  const find = (rows: unknown[]) => ({ toArray: async () => rows });
  jest.mocked(coursesCol).mockReturnValue({ findOne: async () => ({ _id: id, ownerPuid: actor.puid, name: 'Course', courseCode: 'TEST', term: '2026W', lifecycle: 'published', published: true, createdAt: new Date() }) } as never);
  jest.mocked(coursePeopleAccessCol).mockReturnValue({ find: () => find(controls), findOne: async (q: { subject: string }) => controls.find(c => c.subject === q.subject) ?? null, findOneAndUpdate: write } as never);
  jest.mocked(usersCol).mockReturnValue({ find: () => find(people) } as never);
  jest.mocked(coursePeopleImportsCol).mockReturnValue({ findOne: async () => ({ members: imported, importedAt: new Date() }) } as never);
  jest.mocked(courseInstructorSharesCol).mockReturnValue({ find: () => find([]) } as never);
  jest.mocked(taInvitesCol).mockReturnValue({ find: () => find([]) } as never);
  jest.mocked(capabilitySettingsCol).mockReturnValue({ findOne: async () => null } as never);
  jest.mocked(auditCol).mockReturnValue({ insertOne: audit } as never);
  jest.mocked(resolveTeachingIdentity).mockReset().mockResolvedValue({ email: 'pending@ubc.ca' });
});
function decision(status: CoursePeopleAccess['status'] = 'active') {
  return { _id: new ObjectId(), courseId: id, subject: 'puid:PERSON', puid: 'PERSON', email: 'person@ubc.ca', role: 'ta' as const, status, revision: 3, createdAt: new Date(), updatedAt: new Date(), updatedByPuid: 'OWNER' };
}
test('a CSV person and an owner role decision deduplicate to one effective identity', async () => {
  controls = [decision()]; const page = await listCoursePeople(id, actor);
  expect(page.total).toBe(2); expect(page.people.find(p => p.puid === 'PERSON')).toMatchObject({ role: 'ta', revision: 3, displayName: 'Known Student', sources: ['Gradebook / CSV', 'Owner override'] });
});
test('owner remains first; search and pagination never return unbounded rows', async () => {
  imported = Array.from({ length: 34 }, (_, i) => ({ puid: `IMPORTED-${i}`, name: `Person ${String(i).padStart(2, '0')}`, role: 'student' }));
  const page = await listCoursePeople(id, actor, { page: 3, pageSize: 10 });
  expect(page.people).toHaveLength(10); expect(page.pageCount).toBe(4); expect(page.total).toBe(35);
  expect((await listCoursePeople(id, actor, { search: 'Person 31' })).people).toHaveLength(1);
  expect((await listCoursePeople(id, actor, { page: 99, pageSize: 10 })).page).toBe(4);
});
test('pre-login Gradebook identities are pending people, not individual email invitations', async () => {
  people = [actor]; const page = await listCoursePeople(id, actor, { tab: 'invitations' });
  expect(page.people).toEqual([]); expect(page.counts.invitations).toBe(0);
});
test('pending email invitation retains its requested role and safe TA preset before first login', async () => {
  await inviteCoursePerson(id, actor, 'pending@ubc.ca', 'ta', { 'question.suggest-edit': false });
  expect(write).toHaveBeenCalledWith({ courseId: id, subject: 'email:pending@ubc.ca', revision: 0 }, expect.objectContaining({ $set: expect.objectContaining({ status: 'pending', role: 'ta', permissions: expect.objectContaining({ 'question.suggest-edit': false, 'question.review': true }) }) }), expect.anything());
  expect(write.mock.calls[0][1].$set).not.toHaveProperty('puid');
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorPuid: 'OWNER', action: 'course.people.invite' }));
});
test('known CWL activates exact PUID without granting platform capability', async () => {
  imported = []; jest.mocked(resolveTeachingIdentity).mockResolvedValue({ email: 'person@ubc.ca', user: person as never });
  await inviteCoursePerson(id, actor, 'person', 'instructor');
  expect(write.mock.calls[0][1].$set).toMatchObject({ puid: 'PERSON', role: 'instructor', status: 'active' });
  expect(write.mock.calls[0][1].$set).not.toHaveProperty('platformInstructor');
});
test('another Instructor is read-only and cannot invite or ban', async () => {
  const instructor = { ...actor, puid: 'COLLEAGUE' };
  expect((await listCoursePeople(id, instructor)).canManage).toBe(false);
  await expect(inviteCoursePerson(id, instructor, 'pending@ubc.ca', 'instructor')).rejects.toMatchObject({ status: 403 });
  await expect(changeCoursePerson(id, instructor, 'puid:PERSON', 0, { action: 'ban' })).rejects.toMatchObject({ status: 403 });
  expect(write).not.toHaveBeenCalled();
});
test('owner and platform Admin identity cannot be banned or demoted', async () => {
  await expect(changeCoursePerson(id, actor, 'puid:OWNER', 0, { action: 'ban' })).rejects.toMatchObject({ status: 403 });
  people = [actor, { ...person, isAdmin: true }];
  await expect(changeCoursePerson(id, actor, 'puid:PERSON', 0, { action: 'role', role: 'student' })).rejects.toMatchObject({ status: 403 });
});
test('a stale revision cannot replace a newer ban', async () => {
  controls = [decision('banned')];
  await expect(changeCoursePerson(id, actor, 'puid:PERSON', 0, { action: 'unban' })).rejects.toMatchObject({ status: 409 });
  expect(write).not.toHaveBeenCalled();
});
test('a ban must be explicitly undone before a role change or reinvitation', async () => {
  controls = [decision('banned')];
  await expect(changeCoursePerson(id, actor, 'puid:PERSON', 3, { action: 'role', role: 'instructor' })).rejects.toMatchObject({ status: 409 });
  jest.mocked(resolveTeachingIdentity).mockResolvedValue({ email: 'person@ubc.ca', user: person as never });
  await expect(inviteCoursePerson(id, actor, 'person', 'instructor')).rejects.toMatchObject({ status: 409 });
});
test('unban restores the saved role and retains records; concurrent writers get 409', async () => {
  controls = [decision('banned')];
  await changeCoursePerson(id, actor, 'puid:PERSON', 3, { action: 'unban' });
  expect(write.mock.calls[0][1].$set).toMatchObject({ role: 'ta', status: 'active' });
  write.mockResolvedValueOnce(null);
  await expect(changeCoursePerson(id, actor, 'puid:PERSON', 3, { action: 'unban' })).rejects.toMatchObject({ status: 409 });
});

function persistDecisions(): void {
  write.mockImplementation(async (filter, update) => {
    const previous = controls.find(control => control.subject === filter.subject);
    if (previous && previous.revision !== filter.revision) return null;
    const saved = { _id: previous?._id ?? new ObjectId(), ...previous, ...update.$setOnInsert, ...update.$set, revision: filter.revision + 1 };
    controls = [...controls.filter(control => control.subject !== filter.subject), saved];
    return saved;
  });
}
test('remove hides a multi-source person without editing CSV, Canvas, other roles or learning records', async () => {
  persistDecisions();
  const other = new ObjectId();
  const member = { ...person, courseRoles: [{ courseId: id, role: 'student' as const }, { courseId: other, role: 'student' as const }] };
  people = [actor, member];
  const canvas = { members: [{ puid: 'PERSON', name: 'Canvas person', grants: [{ sourceId: '345', role: 'student' }] }], syncedAt: new Date() };
  jest.mocked(canvasLinks).mockReturnValue({ findOne: async () => canvas } as never);
  await changeCoursePerson(id, actor, 'puid:PERSON', 0, { action: 'remove' });
  expect((await listCoursePeople(id, actor)).people.map(row => row.puid)).toEqual(['OWNER']);
  expect(controls[0]).toMatchObject({ status: 'revoked', role: 'student', puid: 'PERSON', revision: 1 });
  expect(member.courseRoles).toHaveLength(2);
  expect(imported).toHaveLength(1); expect(canvas.members).toHaveLength(1);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'course.people.remove', courseId: id, actorPuid: 'OWNER' }));
  // Refreshing the external sources cannot restore a controlling removal.
  imported = [{ puid: 'PERSON', name: 'Re-imported person', role: 'student' }];
  expect((await listCoursePeople(id, actor)).total).toBe(1);
});
test('a Canvas/CSV person awaiting first sign-in can be removed by exact PUID', async () => {
  persistDecisions(); people = [actor];
  await changeCoursePerson(id, actor, 'puid:PERSON', 0, { action: 'remove' });
  expect((await listCoursePeople(id, actor)).total).toBe(1);
  expect(controls[0]).toMatchObject({ status: 'revoked', puid: 'PERSON' });
});
test('removed deactivated accounts stay hidden and can be explicitly reinvited after restoration', async () => {
  persistDecisions(); people = [actor, { ...person, deactivatedAt: new Date() }];
  await changeCoursePerson(id, actor, 'puid:PERSON', 0, { action: 'remove' });
  expect((await listCoursePeople(id, actor)).total).toBe(1);
  people = [actor, person];
  jest.mocked(resolveTeachingIdentity).mockResolvedValue({ email: 'person@ubc.ca', user: person as never });
  await inviteCoursePerson(id, actor, 'person', 'student');
  expect((await listCoursePeople(id, actor)).people.find(row => row.puid === 'PERSON')).toMatchObject({ status: 'active', revision: 2 });
});
test('bulk removal returns exact successes and protected, stale and foreign failures independently', async () => {
  persistDecisions(); controls = [decision()];
  imported.push({ puid: 'SECOND', name: 'Second person', role: 'student' });
  const response = await removeCoursePeople(id, actor, [
    { id: 'puid:PERSON', expectedRevision: 0 }, { id: 'puid:OWNER', expectedRevision: 0 },
    { id: 'puid:SECOND', expectedRevision: 0 }, { id: 'puid:FOREIGN', expectedRevision: 0 },
  ]);
  expect(response.removed).toEqual(['puid:SECOND']);
  expect(response.failed).toEqual([
    expect.objectContaining({ id: 'puid:PERSON', status: 409 }), expect.objectContaining({ id: 'puid:OWNER', status: 403 }),
    expect.objectContaining({ id: 'puid:FOREIGN', status: 404 }),
  ]);
  expect(write).toHaveBeenCalledTimes(1);
  expect((await listCoursePeople(id, actor)).people.map(row => row.puid)).toEqual(['OWNER', 'PERSON']);
});
test('a concurrent CAS loss is reported without overwriting the newer decision', async () => {
  write.mockResolvedValueOnce(null);
  const response = await removeCoursePeople(id, actor, [{ id: 'puid:PERSON', expectedRevision: 0 }]);
  expect(response.removed).toEqual([]); expect(response.failed[0]).toMatchObject({ id: 'puid:PERSON', status: 409 });
  expect(audit).not.toHaveBeenCalled();
});
test('co-instructors cannot remove people, including bulk calls', async () => {
  const colleague = { ...actor, puid: 'COLLEAGUE' };
  await expect(changeCoursePerson(id, colleague, 'puid:PERSON', 0, { action: 'remove' })).rejects.toMatchObject({ status: 403 });
  await expect(removeCoursePeople(id, colleague, [{ id: 'puid:PERSON', expectedRevision: 0 }])).rejects.toMatchObject({ status: 403 });
  expect(write).not.toHaveBeenCalled();
});
test('bulk rejects duplicate, empty and oversized selections before any write', async () => {
  for (const selection of [[], [{ id: 'puid:PERSON', expectedRevision: 0 }, { id: 'puid:PERSON', expectedRevision: 0 }],
    Array.from({ length: 101 }, (_, n) => ({ id: `puid:${n}`, expectedRevision: 0 }))]) {
    await expect(removeCoursePeople(id, actor, selection)).rejects.toMatchObject({ status: 400 });
  }
  expect(write).not.toHaveBeenCalled();
});
