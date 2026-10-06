jest.mock('../../server/src/services/course-people-access.service', () => ({
  projectCoursePeopleAccess: jest.fn(async (user: unknown) => user),
  peopleMembershipFilter: jest.fn(async (_course: unknown, _roles: unknown, filter: unknown) => filter),
  canUseStudentCode: jest.fn(async () => true),
}));
import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { parsePeopleImport } from '../../server/src/services/people-import-parser';
import { clearPeopleImport, commitPeopleImport, getPeopleImport, previewPeopleChanges, projectImportedCoursePeople, importedCourseRoleUserFilter, importedTaInvites } from '../../server/src/services/people-import.service';
import { auditCol, capabilitySettingsCol, coursePeopleImportsCol, coursesCol, usersCol } from '../../server/src/components/mongodb/collections';
import { peopleImportRouter } from '../../server/src/routes/people-import.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import type { Course, User } from '../../server/src/types/domain';
import type { CoursePeopleImport } from '../../server/src/types/people-import';

jest.mock('../../server/src/components/mongodb/collections', () => ({ auditCol: jest.fn(), capabilitySettingsCol: jest.fn(), usersCol: jest.fn(), coursePeopleImportsCol: jest.fn(), coursesCol: jest.fn() }));
jest.mock('../../server/src/components/auth', () => ({ ensureApiAuthenticated: () => jest.requireActual('../../server/src/components/auth/guards').ensureApiAuthenticated() }));

const gradebook = 'Student,ID,SIS User ID,SIS Login ID,Section,Final Score\nPoints Possible,,,,,100\n"Chen, Alex",123,99999999,ABC12PUID001,Finance,90\nTest Student,124,,,Finance,0';

describe('Canvas CSV parsing', () => {
  test('Gradebook uses SIS Login ID, ignores scores and Points Possible, rejects Test Student', () => {
    const result = parsePeopleImport(gradebook);
    expect(result.members).toEqual([{ puid: 'ABC12PUID001', name: 'Chen, Alex', role: 'student' }]);
    expect(result.roleColumn).toBeNull(); expect(result.ignoredRows).toBe(1);
    expect(result.rejects[0].line).toBe(4);
    expect(JSON.stringify(result.members)).not.toMatch(/90|99999999|Final Score/);
  });
  test('group roster format, BOM and CRLF work with login_id', () => {
    expect(parsePeopleImport('\ufeffname,canvas_user_id,user_id,login_id,group_name\r\nAlex,123,99999999,ABC12PUID001,G1').members)
      .toEqual([{ puid: 'ABC12PUID001', name: 'Alex', role: 'student' }]);
  });
  test('explicit teaching aliases; multiple roles and PUID case are preserved', () => {
    const result = parsePeopleImport('Login ID,Role\nPUID-A,Teacher\npuid-a,Professor\nPUID-A,TaEnrollment\nPUID-A,StudentEnrollment\nPUID-A,teacher');
    expect(result.members.map(m => [m.puid, m.role])).toEqual([['PUID-A', 'instructor'], ['puid-a', 'instructor'], ['PUID-A', 'ta'], ['PUID-A', 'student']]);
    expect(result.rejects[0].reason).toMatch(/Duplicate/);
  });
  test('inactive, completed, invited, custom, observer, admin and restricted staff never grant access', () => {
    const result = parsePeopleImport('login_id,role,enrollment_state,limit_privileges_to_course_section\n'
      + 'PUID-1,Teacher,active,true\nPUID-2,TA,active,\nPUID-3,Observer,active,false\nPUID-4,Admin,active,false\n'
      + 'PUID-5,Restricted Teacher,active,false\nPUID-6,Teacher,invited,false\nPUID-7,Student,completed,false\nPUID-8,TA,inactive,false\nPUID-9,Teacher,active,false');
    expect(result.members).toEqual([{ puid: 'PUID-9', name: '', role: 'instructor' }]);
    expect(result.rejects).toHaveLength(8);
  });
  test.each(['Name,ID\nAlex,123', 'Student,SIS User ID\nAlex,99999999', 'email,role\nalex@ubc.ca,Teacher', ''])('no guessing when Login ID is absent: %s', csv => {
    expect(() => parsePeopleImport(csv)).toThrow(/Missing Login ID/);
  });
  test('empty role, blank identity, malformed value and email PUID are rejected', () => {
    expect(parsePeopleImport('PUID,Role\nPUID-1,\n,Student\nnot a PUID,Student\nalex@ubc.ca,Teacher').members).toEqual([]);
  });
  test('numeric PUIDs are opaque exact identities; conflicting identity or role aliases cannot grant access', () => {
    expect(parsePeopleImport('Login ID,Role\n87654321,Student').members).toEqual([{ puid: '87654321', name: '', role: 'student' }]);
    expect(parsePeopleImport('PUID,Login ID,Role\nPUID-A,PUID-B,Teacher').members).toEqual([]);
    expect(parsePeopleImport('Login ID,enrollment_type,role\nPUID-A,TeacherEnrollment,Restricted Teacher').members).toEqual([]);
  });
  test('malformed CSV and duplicate headers fail; physical line numbers include blank/multiline rows', () => {
    expect(() => parsePeopleImport('Login ID,Name\nPUID-A,"unclosed')).toThrow(/Invalid CSV/);
    expect(() => parsePeopleImport('Login ID,login_id\nPUID-A,PUID-B')).toThrow(/Duplicate/);
    expect(parsePeopleImport('Login ID,Name,Role\n\nPUID-A,"Two\nLines",Observer').rejects[0].line).toBe(4);
  });
});

const courseId = new ObjectId();
const user = (puid = 'owner', role: 'instructor' | 'ta' | 'student' = 'instructor'): User => ({
  puid, uid: 'cwl', email: 'person@ubc.ca', displayName: 'Person', affiliations: [], isAdmin: false,
  platformInstructor: false, courseRoles: [{ courseId, role }], createdAt: new Date(), lastLoginAt: new Date(),
});
let course: Course & { _id: ObjectId };
let saved: CoursePeopleImport | null;
const write = jest.fn(); const read = jest.fn(); const find = jest.fn();
beforeEach(() => {
  saved = null;
  course = { _id: courseId, ownerPuid: 'owner', published: true, lifecycle: 'published' } as typeof course;
  read.mockImplementation(async () => saved);
  find.mockImplementation(() => ({ toArray: async () => saved ? [saved] : [] }));
  write.mockImplementation(async (filter, update, options) => {
    if (saved && filter.revision !== saved.revision) {
      if (options.upsert) throw Object.assign(new Error('duplicate'), { code: 11000 });
      return null;
    }
    if (!saved && !options.upsert) return null;
    saved = { _id: courseId, ...update.$set, revision: (saved?.revision ?? 0) + 1 };
    return saved;
  });
  jest.mocked(coursePeopleImportsCol).mockReturnValue({ findOne: read, find, findOneAndUpdate: write } as never);
  jest.mocked(coursesCol).mockReturnValue({ findOne: async () => course, find: () => ({ toArray: async () => course ? [course] : [] }) } as never);
  jest.mocked(auditCol).mockReturnValue({ insertOne: jest.fn(async () => ({})) } as never);
  jest.mocked(capabilitySettingsCol).mockReturnValue({ findOne: async () => ({ userOverrides: { 'PUID-TA': { 'analytics.view': false } } }) } as never);
  jest.mocked(usersCol).mockReturnValue({ find: () => ({ toArray: async () => [user('PUID-TA', 'student')] }) } as never);
});

describe('grant lifecycle', () => {
  test('analytics/staff queries include imported identities without adding manual roles; TA rows retain permission overrides', async () => {
    await commitPeopleImport(courseId, user(), 'Login ID,Name,Role\nPUID-TA,TA Person,TA\nPUID-STUDENT,Student Person,Student\nPUID-PENDING,Pending TA,TA', 'people.csv', 0, true);
    expect(await importedCourseRoleUserFilter(courseId, ['student'])).toEqual({ $or: [
      { courseRoles: { $elemMatch: { courseId, role: 'student' } } },
      { puid: { $in: ['PUID-STUDENT'] }, deactivatedAt: { $exists: false } },
    ] });
    expect(await importedTaInvites(courseId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ activatedPuid: 'PUID-TA', status: 'active', source: 'csv-import', permissions: { 'analytics.view': false } }),
      expect.objectContaining({ activatedPuid: 'PUID-PENDING', status: 'pending', source: 'csv-import' }),
    ]));
    course.published = false;
    expect(await importedCourseRoleUserFilter(courseId, ['student'])).toEqual({ courseRoles: { $elemMatch: { courseId, role: 'student' } } });
    course.lifecycle = 'archived';
    expect((await importedTaInvites(courseId)).every(ta => ta.status === 'expired')).toBe(true);
    expect(auditCol().insertOne).toHaveBeenCalledWith(expect.objectContaining({ actorPuid: 'owner', action: 'course.people.import', detail: { revision: 1, count: 3 } }));
  });
  test('owner imports before first login without creating Users or granting platform privilege', async () => {
    const summary = await commitPeopleImport(courseId, user(), gradebook, 'grades.csv', 0, false);
    expect(summary.revision).toBe(1);
    const fresh = { ...user('ABC12PUID001'), courseRoles: [] };
    const projected = await projectImportedCoursePeople(fresh);
    expect(projected.courseRoles).toEqual([{ courseId, role: 'student' }]);
    expect(fresh.courseRoles).toEqual([]); expect(projected.platformInstructor).toBe(false); expect(projected.isAdmin).toBe(false);
    expect(saved?.fileName).toBe('grades.csv'); expect(saved?.importedByPuid).toBe('owner');
    expect(saved).not.toHaveProperty('raw');
  });
  test('staff grants need confirmation and owner/Admin; co-instructors may only read', async () => {
    const csv = 'Login ID,Role\nPUID-A,Teacher';
    await expect(commitPeopleImport(courseId, user('co-instructor'), csv, 'people.csv', 0, true)).rejects.toMatchObject({ status: 403 });
    expect((await getPeopleImport(courseId, user('co-instructor'))).canManage).toBe(false);
    await expect(commitPeopleImport(courseId, user(), csv, 'people.csv', 0, false)).rejects.toThrow(/Confirm/);
    expect(write).not.toHaveBeenCalled();
    await commitPeopleImport(courseId, { ...user('admin'), isAdmin: true }, csv, 'people.csv', 0, true);
    expect((await projectImportedCoursePeople({ ...user('PUID-A'), courseRoles: [] })).courseRoles).toEqual([{ courseId, role: 'instructor' }]);
  });
  test('replace/clear revoke imported roles on reload and preserve manual roles; tombstone prevents replay', async () => {
    const fresh = user('PUID-A', 'student');
    await commitPeopleImport(courseId, user(), 'Login ID,Role\nPUID-A,Teacher', 'people.csv', 0, true);
    expect((await projectImportedCoursePeople(fresh)).courseRoles.map(r => r.role)).toEqual(['student', 'instructor']);
    await commitPeopleImport(courseId, user(), 'Login ID,Role\nPUID-A,TA', 'people.csv', 1, true);
    expect((await projectImportedCoursePeople(fresh)).courseRoles.map(r => r.role)).toEqual(['student', 'ta']);
    await clearPeopleImport(courseId, user(), 2);
    expect((await projectImportedCoursePeople(fresh)).courseRoles).toEqual(fresh.courseRoles);
    expect(saved?.revision).toBe(3);
    await expect(commitPeopleImport(courseId, user(), gradebook, 'old.csv', 0, false)).rejects.toMatchObject({ status: 409 });
    expect(saved?.members).toEqual([]);
  });
  test('all-rejected input and stale revisions preserve previous access', async () => {
    await commitPeopleImport(courseId, user(), gradebook, 'people.csv', 0, false);
    await expect(commitPeopleImport(courseId, user(), 'Login ID\nnot a PUID', 'bad.csv', 1, false)).rejects.toThrow(/kept/);
    await expect(commitPeopleImport(courseId, user(), 'Login ID\nPUID-B', 'stale.csv', 0, false)).rejects.toMatchObject({ status: 409 });
    await expect(clearPeopleImport(courseId, user(), 0)).rejects.toMatchObject({ status: 409 });
    expect(saved?.members[0].puid).toBe('ABC12PUID001');
  });
  test('publication, dates, archiving, deactivation and exact PUID gates apply', async () => {
    await commitPeopleImport(courseId, user(), 'Login ID,Role\nPUID-A,Student\nPUID-A,Teacher\nPUID-A,TA', 'people.csv', 0, true);
    const fresh = { ...user('PUID-A'), courseRoles: [] };
    course.published = false;
    expect((await projectImportedCoursePeople(fresh)).courseRoles.map(r => r.role)).toEqual(['instructor', 'ta']);
    course.published = true; course.termStart = new Date(Date.now() + 86400000);
    expect((await projectImportedCoursePeople(fresh)).courseRoles.map(r => r.role)).toEqual(['instructor', 'ta']);
    course.termEnd = new Date(Date.now() - 86400000);
    expect((await projectImportedCoursePeople(fresh)).courseRoles).toEqual([]);
    delete course.termEnd; course.lifecycle = 'archived';
    expect((await projectImportedCoursePeople(fresh)).courseRoles).toEqual([]);
    course.lifecycle = 'published';
    expect((await projectImportedCoursePeople({ ...fresh, deactivatedAt: new Date() })).courseRoles).toEqual([]);
    expect((await projectImportedCoursePeople({ ...fresh, puid: 'puid-a', uid: 'PUID-A', email: 'PUID-A' })).courseRoles).toEqual([]);
    course = null as unknown as typeof course;
    expect((await projectImportedCoursePeople(fresh)).courseRoles).toEqual([]);
  });
});

function app(actor?: User) {
  const instance = express(); instance.use(express.json());
  instance.use((req, _res, next) => { req.isAuthenticated = (() => Boolean(actor)) as typeof req.isAuthenticated; req.user = actor; next(); });
  instance.use('/api', peopleImportRouter); instance.use(errorHandler); return instance;
}
const path = `/api/courses/${courseId}/people-import`;
describe('HTTP boundary with real guards and service', () => {
  test('signed-out, student, TA and foreign-course users cannot read, preview or import', async () => {
    for (const actor of [undefined, user('student', 'student'), user('ta', 'ta'), { ...user(), courseRoles: [] }]) {
      const status = actor ? 403 : 401;
      expect((await request(app(actor)).get(path)).status).toBe(status);
      expect((await request(app(actor)).post(`${path}/preview`).attach('file', Buffer.from(gradebook), 'grades.csv')).status).toBe(status);
      expect((await request(app(actor)).put(path).field('expectedRevision', '0').attach('file', Buffer.from(gradebook), 'grades.csv')).status).toBe(status);
    }
    expect(write).not.toHaveBeenCalled();
  });
  test('preview is read-only; commit reparses original and requires revision; clear checks revision', async () => {
    const api = app(user());
    const preview = await request(api).post(`${path}/preview`).attach('file', Buffer.from(gradebook), 'grades.csv');
    expect(preview.status).toBe(200); expect(write).not.toHaveBeenCalled();
    expect((await request(api).put(path).attach('file', Buffer.from(gradebook), 'grades.csv')).status).toBe(400);
    const committed = await request(api).put(path).field('expectedRevision', '0').attach('file', Buffer.from(gradebook), 'grades.csv');
    expect(committed.status).toBe(200); expect(committed.body.members[0].role).toBe('student');
    expect((await request(api).delete(path).send({ expectedRevision: 1 })).body.members).toEqual([]);
  });
  test('missing, malformed and oversized uploads return 400 without granting roles', async () => {
    const api = app(user());
    expect((await request(api).post(`${path}/preview`)).status).toBe(400);
    expect((await request(api).post(`${path}/preview`).attach('file', Buffer.from('Login ID\n"broken'), 'bad.csv')).status).toBe(400);
    expect((await request(api).post(`${path}/preview`).attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), 'huge.csv')).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
});


test('re-upload preview and persisted receipt identify late joiners against the exact previous CSV revision', async () => {
  const owner = user();
  await commitPeopleImport(courseId, owner, 'Login ID,Name\nOLD,Original Student', 'initial.csv', 0, false);
  const preview = await previewPeopleChanges(courseId, owner, 'Login ID,Name\nOLD,Original Student\nLATE,New Student');
  expect(preview.expectedRevision).toBe(1);
  expect(preview.changes.added).toEqual([{ puid: 'LATE', name: 'New Student', roles: ['student'] }]);
  const committed = await commitPeopleImport(courseId, owner, 'Login ID,Name\nOLD,Original Student\nLATE,New Student', 'updated.csv', preview.expectedRevision, false);
  expect(committed.lastChanges).toEqual(preview.changes);
  const replay = await previewPeopleChanges(courseId, owner, 'Login ID,Name\nLATE,Renamed Student\nOLD,Original Student');
  expect(replay.changes.added).toEqual([]); expect(replay.changes.unchanged).toBe(2);
  await expect(commitPeopleImport(courseId, owner, 'Login ID,Name\nOTHER,Concurrent Upload', 'stale.csv', preview.expectedRevision, false)).rejects.toMatchObject({ status: 409 });
});
