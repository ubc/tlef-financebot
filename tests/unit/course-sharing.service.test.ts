import { ObjectId } from 'mongodb';
import type { Course, User } from '../../server/src/types/domain';
import type { CourseInstructorShare } from '../../server/src/types/course-sharing';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  auditCol: jest.fn(), courseInstructorSharesCol: jest.fn(), coursesCol: jest.fn(), usersCol: jest.fn(),
}));
import { auditCol, courseInstructorSharesCol, coursesCol, usersCol } from '../../server/src/components/mongodb/collections';
import { activateCourseInstructorInvitations, activeSharedInstructorPuids, inviteCourseInstructor, listCourseInstructors, projectCourseInstructorShares, removeCourseInstructor, revokeCourseInstructorInvitation } from '../../server/src/services/course-sharing.service';

type Row = Record<string, unknown>;
const courseId = new ObjectId();
const otherCourseId = new ObjectId();
const ownerPuid = 'OWNER';

function user(puid: string, email: string, roles: User['courseRoles'] = []): User & { _id: ObjectId } {
  return { _id: new ObjectId(), puid, email, uid: puid.toLowerCase(), displayName: puid, affiliations: ['faculty'], isAdmin: false, platformInstructor: false, courseRoles: roles, createdAt: new Date(), lastLoginAt: new Date() };
}
function equal(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  return a === b;
}
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return (expected as Row[]).some(branch => matches(row, branch));
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId)) {
      const condition = expected as Row;
      if ('$in' in condition) return (condition.$in as unknown[]).some(value => equal(actual, value));
      if ('$ne' in condition) return !equal(actual, condition.$ne);
      if ('$regex' in condition) return new RegExp(condition.$regex as string, condition.$options as string).test(String(actual));
      if ('$elemMatch' in condition) return (actual as Row[]).some(value => matches(value, condition.$elemMatch as Row));
    }
    return equal(actual, expected);
  });
}
function fakeCollection(rows: Row[]) {
  const apply = (filter: Row, update: Row) => {
    const selected = rows.filter(row => matches(row, filter));
    let modifiedCount = 0;
    for (const row of selected) {
      if (update.$set) { Object.assign(row, update.$set); modifiedCount++; }
      for (const [key, value] of Object.entries(update.$inc as Row ?? {})) row[key] = Number(row[key] ?? 0) + Number(value);
      for (const key of Object.keys(update.$unset as Row ?? {})) delete row[key];
      for (const [key, value] of Object.entries(update.$pull as Row ?? {})) {
        const prior = row[key] as Row[];
        const next = prior.filter(item => !matches(item, value as Row));
        if (next.length !== prior.length) modifiedCount++;
        row[key] = next;
      }
    }
    return { matchedCount: selected.length, modifiedCount };
  };
  return {
    find: jest.fn((filter: Row) => {
      let selected = rows.filter(row => matches(row, filter));
      interface Cursor { sort: jest.Mock<Cursor>; limit: jest.Mock<Cursor, [number]>; toArray: jest.Mock<Promise<Row[]>> }
      const cursor: Cursor = {
        sort: jest.fn((): Cursor => cursor),
        limit: jest.fn((count: number): Cursor => { selected = selected.slice(0, count); return cursor; }),
        toArray: jest.fn(async () => selected.map(row => ({ ...row }))),
      };
      return cursor;
    }),
    findOne: jest.fn(async (filter: Row) => rows.find(row => matches(row, filter)) ?? null),
    insertOne: jest.fn(async (value: Row) => {
      const row = { _id: new ObjectId(), ...value };
      rows.push(row);
      return { insertedId: row._id };
    }),
    updateOne: jest.fn(async (filter: Row, update: Row) => apply(filter, update)),
    updateMany: jest.fn(async (filter: Row, update: Row) => apply(filter, update)),
    findOneAndUpdate: jest.fn(async (filter: Row, update: Row) => {
      if (!apply(filter, update).matchedCount) return null;
      return rows.find(row => equal(row._id, filter._id)) ?? null;
    }),
  };
}

const owner = user(ownerPuid, 'owner@ubc.ca', [{ courseId, role: 'instructor' }]);
const recipient = user('RECIPIENT', 'colleague@ubc.ca', [{ courseId, role: 'student' }]);
let shares: Array<CourseInstructorShare & { _id: ObjectId }>;
let people: Array<User & { _id: ObjectId }>;
let courses: Array<Partial<Course> & { _id: ObjectId }>;
let shareCollection: ReturnType<typeof fakeCollection>;
let userCollection: ReturnType<typeof fakeCollection>;
let auditCollection: ReturnType<typeof fakeCollection>;

beforeEach(() => {
  jest.clearAllMocks();
  shares = [];
  people = [{ ...owner, courseRoles: [...owner.courseRoles] }, { ...recipient, courseRoles: [...recipient.courseRoles] }];
  courses = [{ _id: courseId, ownerPuid, name: 'Finance', courseCode: 'COMM 298', section: '101', term: '2026W1', registrationCode: 'PRIVATE' }];
  shareCollection = fakeCollection(shares as unknown as Row[]);
  userCollection = fakeCollection(people as unknown as Row[]);
  auditCollection = fakeCollection([]);
  jest.mocked(courseInstructorSharesCol).mockReturnValue(shareCollection as never);
  jest.mocked(usersCol).mockReturnValue(userCollection as never);
  jest.mocked(coursesCol).mockReturnValue(fakeCollection(courses as unknown as Row[]) as never);
  jest.mocked(auditCol).mockReturnValue(auditCollection as never);
});

describe('course sharing authorization and membership', () => {
  it('grants only the selected course to a known identity and deduplicates repeated invites', async () => {
    const summary = await inviteCourseInstructor(courseId, owner, ' Colleague@UBC.ca ');
    await inviteCourseInstructor(courseId, owner, 'colleague@ubc.ca');
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ email: 'colleague@ubc.ca', recipientPuid: recipient.puid, status: 'active' });
    expect(summary).toMatchObject({ courseId: courseId.toHexString(), courseName: 'Finance', canManage: true, ownerPuid });
    expect(summary.members).toEqual(expect.arrayContaining([expect.objectContaining({ puid: recipient.puid, role: 'co-instructor' })]));
    expect(JSON.stringify(summary)).not.toContain('PRIVATE');
    const [effective] = await projectCourseInstructorShares([recipient]);
    expect(effective.courseRoles).toEqual([{ courseId, role: 'student' }, { courseId, role: 'instructor' }]);
    expect(effective.platformInstructor).toBe(false);
    expect(recipient.courseRoles).toEqual([{ courseId, role: 'student' }]);
    expect(userCollection.updateOne).not.toHaveBeenCalled();
    expect(auditCollection.insertOne).toHaveBeenCalledTimes(1);
  });

  it('resolves an existing account by CWL and rejects unknown CWL names', async () => {
    const summary = await inviteCourseInstructor(courseId, owner, recipient.uid.toUpperCase());
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ email: recipient.email, recipientPuid: recipient.puid, status: 'active' });
    expect(summary.members).toEqual(expect.arrayContaining([expect.objectContaining({ puid: recipient.puid, role: 'co-instructor' })]));
    await expect(inviteCourseInstructor(courseId, owner, 'not-a-user')).rejects.toMatchObject({ status: 404, message: 'course-sharing-cwl-not-found' });
  });

  it('shows co-instructors the membership list but reserves mutations for owner/Admin', async () => {
    const co = user('CO', 'co@ubc.ca', [{ courseId, role: 'instructor' }]);
    expect((await listCourseInstructors(courseId, co)).canManage).toBe(false);
    await expect(inviteCourseInstructor(courseId, co, recipient.email)).rejects.toMatchObject({ status: 403 });
    await expect(removeCourseInstructor(courseId, co, recipient.puid)).rejects.toMatchObject({ status: 403 });
    await expect(listCourseInstructors(courseId, recipient)).rejects.toMatchObject({ status: 403 });
    const foreign = user('OTHER', 'other@ubc.ca', [{ courseId: otherCourseId, role: 'instructor' }]);
    await expect(listCourseInstructors(courseId, foreign)).rejects.toMatchObject({ status: 403 });
    await expect(inviteCourseInstructor(courseId, { ...foreign, isAdmin: true }, recipient.email)).resolves.toMatchObject({ canManage: true });
  });

  it('protects the owner and removes only the chosen co-instructor role and shares', async () => {
    people[1].courseRoles.push({ courseId, role: 'ta' }, { courseId, role: 'instructor' }, { courseId: otherCourseId, role: 'instructor' });
    await expect(removeCourseInstructor(courseId, owner, ownerPuid)).rejects.toMatchObject({ status: 409, message: 'course-sharing-owner-protected' });
    await removeCourseInstructor(courseId, owner, recipient.puid);
    expect(people[1].courseRoles).toEqual([{ courseId, role: 'student' }, { courseId, role: 'ta' }, { courseId: otherCourseId, role: 'instructor' }]);
  });

  it('keeps invitations pending until the matching canonical CWL identity appears', async () => {
    const summary = await inviteCourseInstructor(courseId, owner, 'new@ubc.ca');
    expect(summary.invitations[0]).toMatchObject({ email: 'new@ubc.ca', status: 'pending' });
    await activateCourseInstructorInvitations(recipient);
    expect(shares[0].status).toBe('pending');
    const newcomer = user('NEW', 'New@UBC.ca');
    people.push(newcomer);
    await activateCourseInstructorInvitations(newcomer);
    expect(shares[0]).toMatchObject({ status: 'active', recipientPuid: newcomer.puid, revision: 1 });
    expect((await projectCourseInstructorShares([newcomer]))[0].courseRoles).toEqual([{ courseId, role: 'instructor' }]);
  });

  it('a revoke winning the pending claim CAS never creates a copied or effective grant', async () => {
    await inviteCourseInstructor(courseId, owner, 'new@ubc.ca');
    const newcomer = user('NEW', 'new@ubc.ca');
    people.push(newcomer);
    shareCollection.findOneAndUpdate.mockImplementationOnce(async () => {
      shares[0].status = 'revoked'; shares[0].revision++;
      return null;
    });
    await activateCourseInstructorInvitations(newcomer);
    expect((await projectCourseInstructorShares([newcomer]))[0].courseRoles).toEqual([]);
    expect(userCollection.updateOne).not.toHaveBeenCalled();
  });

  it('revoking after activation removes access on the next projection and can be explicitly reinvited', async () => {
    await inviteCourseInstructor(courseId, owner, recipient.email);
    await revokeCourseInstructorInvitation(courseId, owner, shares[0]._id);
    expect((await projectCourseInstructorShares([recipient]))[0].courseRoles).toEqual(recipient.courseRoles);
    await inviteCourseInstructor(courseId, owner, recipient.email);
    expect(shares).toHaveLength(1);
    expect(shares[0].status).toBe('active');
    expect(shares[0].revision).toBe(2);
  });

  it('removing a member also cancels their pending email invitation before login', async () => {
    await inviteCourseInstructor(courseId, owner, 'new@ubc.ca');
    const newcomer = user('NEW', 'new@ubc.ca');
    people.push(newcomer);
    await removeCourseInstructor(courseId, owner, newcomer.puid);
    await activateCourseInstructorInvitations(newcomer);
    expect(shares[0].status).toBe('revoked');
    expect((await projectCourseInstructorShares([newcomer]))[0].courseRoles).toEqual([]);
  });

  it('rejects unsupported, ambiguous and banned recipients without granting access', async () => {
    await expect(inviteCourseInstructor(courseId, owner, 'outside@example.com')).rejects.toMatchObject({ status: 400 });
    people.push(user('DUP', recipient.email));
    await expect(inviteCourseInstructor(courseId, owner, recipient.email)).rejects.toMatchObject({ status: 409, message: 'course-sharing-ambiguous-email' });
    people.pop();
    people[1].deactivatedAt = new Date();
    await expect(inviteCourseInstructor(courseId, owner, recipient.email)).rejects.toMatchObject({ status: 409, message: 'course-sharing-user-deactivated' });
    expect(shares).toHaveLength(0);
  });

  it('does not project grants for deleted courses or banned accounts', async () => {
    await inviteCourseInstructor(courseId, owner, recipient.email);
    const banned = { ...recipient, deactivatedAt: new Date() };
    expect((await projectCourseInstructorShares([banned]))[0].courseRoles).toEqual(recipient.courseRoles);
    // Admin retained-record management can display and revoke the assignment;
    // session authorization uses the default, banned-safe path.
    expect((await projectCourseInstructorShares([banned], { includeDeactivated: true }))[0].courseRoles).toContainEqual({ courseId, role: 'instructor' });
    courses.length = 0;
    expect((await projectCourseInstructorShares([recipient]))[0].courseRoles).toEqual(recipient.courseRoles);
    await expect(activeSharedInstructorPuids(courseId)).resolves.toEqual([]);
  });

  it('refuses a foreign invitation id without touching either grant', async () => {
    await inviteCourseInstructor(courseId, owner, recipient.email);
    await expect(revokeCourseInstructorInvitation(courseId, owner, new ObjectId())).rejects.toMatchObject({ status: 404 });
    expect(shares[0].status).toBe('active');
  });
});
