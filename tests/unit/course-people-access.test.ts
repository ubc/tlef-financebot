import { ObjectId } from 'mongodb';
import type { Course, User } from '../../server/src/types/domain';
import type { CoursePeopleAccess } from '../../server/src/types/course-people';

jest.mock('../../server/src/components/mongodb/collections', () => ({ coursePeopleAccessCol: jest.fn(), coursesCol: jest.fn(), usersCol: jest.fn() }));
import { coursePeopleAccessCol, coursesCol, usersCol } from '../../server/src/components/mongodb/collections';
import { activatePeopleInvitations, canUseStudentCode, peopleMembershipFilter, projectCoursePeopleAccess } from '../../server/src/services/course-people-access.service';

const id = new ObjectId(); const other = new ObjectId();
const user = { puid: 'PERSON', uid: 'person', email: 'person@ubc.ca', courseRoles: [{ courseId: id, role: 'instructor' }, { courseId: id, role: 'student' }, { courseId: other, role: 'student' }] } as User;
let course: Course & { _id: ObjectId };
let control: CoursePeopleAccess & { _id: ObjectId };
let active: Array<typeof control>;
let identities: User[];
const write = jest.fn();
function matches(c: typeof control, q: Record<string, unknown>): boolean {
  if (q.$or) return (q.$or as Record<string, unknown>[]).some(branch => matches(c, branch));
  return Object.entries(q).every(([key, expected]) => {
    const value = c[key as keyof typeof control];
    if (expected instanceof ObjectId) return expected.equals(value as ObjectId);
    if (expected && typeof expected === 'object') {
      if ('$in' in expected) return (expected.$in as unknown[]).includes(value);
      if ('$exists' in expected) return (value !== undefined) === expected.$exists;
    }
    return value === expected;
  });
}
beforeEach(() => {
  course = { _id: id, ownerPuid: 'OWNER', published: true, lifecycle: 'published', termEnd: new Date(Date.now() + 86400000) } as Course & { _id: ObjectId };
  control = { _id: new ObjectId(), courseId: id, subject: 'puid:PERSON', puid: 'PERSON', role: 'ta', status: 'active', revision: 1, createdAt: new Date(), updatedAt: new Date(), updatedByPuid: 'OWNER' };
  active = [control]; identities = [user]; write.mockReset().mockResolvedValue({ matchedCount: 1 });
  jest.mocked(coursePeopleAccessCol).mockReturnValue({ find: (q: Record<string, unknown>) => ({ toArray: async () => active.filter(c => matches(c, q)) }), findOne: async (q: Record<string, unknown>) => active.find(c => matches(c, q)) ?? null, updateOne: write } as never);
  jest.mocked(coursesCol).mockReturnValue({ find: () => ({ toArray: async () => [course] }), findOne: async () => course } as never);
  jest.mocked(usersCol).mockReturnValue({ find: () => ({ limit: () => ({ toArray: async () => identities }) }) } as never);
});
test('a single owner role replaces every legacy/imported role in this course only', async () => {
  expect((await projectCoursePeopleAccess(user)).courseRoles).toEqual([{ courseId: other, role: 'student' }, { courseId: id, role: 'ta' }]);
  expect(user.courseRoles).toHaveLength(3);
});
test.each(['banned', 'revoked'] as const)('%s blocks all sources and supplemental code redemption', async status => {
  control.status = status;
  expect((await projectCoursePeopleAccess(user)).courseRoles).toEqual([{ courseId: other, role: 'student' }]);
  expect(await canUseStudentCode(id, user.puid)).toBe(false);
});
test('the course owner cannot be locked out by a malformed decision', async () => {
  course.ownerPuid = user.puid; control.status = 'banned';
  expect((await projectCoursePeopleAccess(user)).courseRoles).toContainEqual({ courseId: id, role: 'instructor' });
});
test.each(['draft', 'future', 'ended', 'archived'] as const)('new Student invitations respect %s course gates', async state => {
  control.role = 'student';
  if (state === 'draft') { course.lifecycle = 'draft'; course.published = false; }
  if (state === 'future') course.termStart = new Date(Date.now() + 86400000);
  if (state === 'ended') course.termEnd = new Date(Date.now() - 1);
  if (state === 'archived') course.lifecycle = 'archived';
  expect((await projectCoursePeopleAccess(user)).courseRoles.some(r => r.courseId.equals(id))).toBe(false);
});
test('TA may prepare a draft course but loses access at term end', async () => {
  course.published = false; course.lifecycle = 'draft';
  expect((await projectCoursePeopleAccess(user)).courseRoles).toContainEqual({ courseId: id, role: 'ta' });
  course.termEnd = new Date(Date.now() - 1);
  expect((await projectCoursePeopleAccess(user)).courseRoles.some(r => r.courseId.equals(id))).toBe(false);
});
test('no decision preserves legacy roles and does not consume another course decision', async () => {
  active = []; expect(await projectCoursePeopleAccess(user)).toBe(user); expect(await canUseStudentCode(id, user.puid)).toBe(true);
});
test.each(['pending', 'revoked'] as const)('unique canonical email binds %s with a revision CAS, preserving cancellation', async status => {
  delete control.puid; control.email = user.email; control.subject = `email:${user.email}`; control.status = status;
  await activatePeopleInvitations(user);
  expect(write).toHaveBeenCalledWith({ _id: control._id, status, revision: 1 }, expect.objectContaining({ $set: expect.objectContaining({ puid: user.puid, status: status === 'pending' ? 'active' : 'revoked' }) }));
});
test('ambiguous email never binds a pending invitation', async () => {
  delete control.puid; control.email = user.email; control.status = 'pending'; identities = [user, { ...user, puid: 'OTHER' }];
  await activatePeopleInvitations(user); expect(write).not.toHaveBeenCalled();
});
test('an existing PUID ban wins against a pending email activation', async () => {
  control.status = 'banned'; active.push({ ...control, _id: new ObjectId(), puid: undefined, subject: `email:${user.email}`, email: user.email, status: 'pending' });
  await activatePeopleInvitations(user); expect(write).not.toHaveBeenCalled();
});
test('membership readers exclude legacy banned recipients and include only the replacement role', async () => {
  const base = { puid: { $in: ['LEGACY'] } };
  expect(await peopleMembershipFilter(id, ['ta'], base)).toEqual({ $or: [{ $and: [base, { puid: { $nin: ['PERSON'] } }] }, { puid: { $in: ['PERSON'] }, deactivatedAt: { $exists: false } }] });
  control.status = 'banned';
  expect(JSON.stringify(await peopleMembershipFilter(id, ['instructor'], base))).toContain('"$in":[]');
});
test('a deactivated account cannot activate or project an invitation', async () => {
  const deactivated = { ...user, deactivatedAt: new Date() }; await activatePeopleInvitations(deactivated);
  expect(write).not.toHaveBeenCalled(); expect(await projectCoursePeopleAccess(deactivated)).toBe(deactivated);
});

test('cancellation winning email binding still strips legacy roles in that in-flight request', async () => {
  delete control.puid; control.email = user.email; control.status = 'revoked'; control.subject = `email:${user.email}`;
  write.mockResolvedValue({ matchedCount: 0 });
  expect((await projectCoursePeopleAccess(user)).courseRoles).toEqual([{ courseId: other, role: 'student' }]);
});
