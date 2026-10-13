import { ObjectId, type WithId } from 'mongodb';
import type { Course, User } from '../../server/src/types/domain';
import type { CoursePeopleImport } from '../../server/src/types/people-import';
import type { CoursePeopleAccess } from '../../server/src/types/course-people';
jest.mock('../../server/src/components/mongodb/collections', () => Object.fromEntries(['usersCol', 'coursesCol', 'coursePeopleImportsCol', 'coursePeopleAccessCol', 'auditCol', 'capabilitySettingsCol', 'platformSettingsCol', 'platformInstructorGrantsCol'].map(name => [name, jest.fn()])));
jest.mock('../../server/src/components/mongodb', () => ({ getDb: jest.fn() }));
jest.mock('../../server/src/components/canvas', () => ({ canvasEnabled: jest.fn(() => true) }));
jest.mock('../../server/src/services/course-sharing.service', () => ({ activeSharedInstructorPuids: jest.fn(async () => []), projectCourseInstructorShares: jest.fn(async users => users), revokeSharedInstructorGrants: jest.fn() }));
import { usersCol, coursesCol, coursePeopleImportsCol, coursePeopleAccessCol } from '../../server/src/components/mongodb/collections';
import { getDb } from '../../server/src/components/mongodb';
import { canvasEnabled } from '../../server/src/components/canvas';
import { env } from '../../server/src/config/env';
import { listUsers } from '../../server/src/services/admin.service';
import { projectCanvasEnrollment } from '../../server/src/services/canvas-enrollment.service';
import { projectImportedCoursePeople } from '../../server/src/services/people-import.service';
const csvId = new ObjectId(), canvasId = new ObjectId();
const identity = (puid: string): WithId<User> => ({ _id: new ObjectId(), puid, uid: `username-${puid}`, displayName: puid, email: '', affiliations: [], isAdmin: false, platformInstructor: false, courseRoles: [], createdAt: new Date(), lastLoginAt: new Date() });
let people: WithId<User>[], courses: WithId<Course>[], imports: CoursePeopleImport[], controls: WithId<CoursePeopleAccess>[];
let links: Array<{ _id: ObjectId; domain: string; identityVersion: string; autoEnroll: boolean; validUntil: Date; members: Array<{ puid: string; grants: Array<{ sourceId: string; role: 'student' | 'ta' | 'instructor' }> }> }>;
const findUsers = jest.fn(), findImports = jest.fn(), findLinks = jest.fn(), writes = jest.fn();
function fields(row: unknown, path: string[]): unknown[] {
  if (Array.isArray(row)) return row.flatMap(value => fields(value, path));
  if (!path.length) return [row];
  return fields(row && typeof row === 'object' ? (row as Record<string, unknown>)[path[0]] : undefined, path.slice(1));
}
function equal(a: unknown, b: unknown): boolean { return a instanceof ObjectId ? a.equals(b as ObjectId) : a === b; }
function valueMatches(value: unknown, expected: unknown): boolean {
  if (!expected || typeof expected !== 'object' || expected instanceof ObjectId || expected instanceof Date) return equal(value, expected);
  const ops = expected as Record<string, unknown>;
  if ('$elemMatch' in ops) return Array.isArray(value) && value.some(row => matches(row, ops.$elemMatch as Record<string, unknown>));
  if ('$exists' in ops) return (value !== undefined) === ops.$exists;
  if ('$in' in ops) return (ops.$in as unknown[]).some(item => equal(value, item));
  if ('$nin' in ops) return !(ops.$nin as unknown[]).some(item => equal(value, item));
  if ('$ne' in ops) return !equal(value, ops.$ne);
  if ('$gt' in ops) return (value as Date) > (ops.$gt as Date);
  if ('$gte' in ops) return (value as Date) >= (ops.$gte as Date);
  if ('$regex' in ops) return new RegExp(String(ops.$regex), String(ops.$options ?? '')).test(String(value ?? ''));
  return false;
}
function matches(row: unknown, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => key === '$and'
    ? (expected as Record<string, unknown>[]).every(q => matches(row, q)) : key === '$or'
      ? (expected as Record<string, unknown>[]).some(q => matches(row, q)) : fields(row, key.split('.')).some(value => valueMatches(value, expected)));
}
const cursor = <T>(rows: T[]) => ({ sort: () => cursor(rows), limit: (count: number) => cursor(rows.slice(0, count)), toArray: async () => rows });
beforeEach(() => {
  people = [identity('Exact.Student.PUID'), identity('CANVAS-STUDENT'), identity('UNMATCHED')];
  courses = [csvId, canvasId].map(_id => ({ _id, published: true, lifecycle: 'published', termEnd: new Date(Date.now() + 86400000) } as WithId<Course>));
  imports = [{ _id: csvId, courseId: csvId, revision: 1, members: [{ puid: people[0].puid, name: 'CSV student', role: 'student' }], importedAt: new Date(), importedByPuid: 'OWNER', fileName: 'gradebook.csv' }];
  links = [{ _id: canvasId, domain: env.canvasDomain, identityVersion: 'login-id-v1', autoEnroll: true, validUntil: new Date(Date.now() + 86400000), members: [{ puid: people[1].puid, grants: [{ role: 'student', sourceId: '101' }] }] }];
  controls = [];
  findUsers.mockImplementation(q => cursor(people.filter(p => matches(p, q))));
  findImports.mockImplementation(q => cursor(imports.filter(p => matches(p, q))));
  findLinks.mockImplementation(q => cursor(links.filter(p => matches(p, q))));
  jest.mocked(canvasEnabled).mockReturnValue(true);
  jest.mocked(usersCol).mockReturnValue({ find: findUsers, updateOne: writes, findOneAndUpdate: writes } as never);
  jest.mocked(coursesCol).mockReturnValue({ find: (q: Record<string, unknown>) => cursor(courses.filter(c => matches(c, q))), findOne: async (q: Record<string, unknown>) => courses.find(c => matches(c, q)) ?? null } as never);
  jest.mocked(coursePeopleImportsCol).mockReturnValue({ find: findImports, updateOne: writes } as never);
  jest.mocked(coursePeopleAccessCol).mockReturnValue({ find: (q: Record<string, unknown>) => cursor(controls.filter(c => matches(c, q))), updateOne: writes } as never);
  jest.mocked(getDb).mockReturnValue({ collection: () => ({ find: findLinks, updateOne: writes }) } as never);
});
test('directory shows the same imported and Canvas Student roles as login without persisting them', async () => {
  const directory = await listUsers();
  expect(directory[0].courseRoles).toEqual([{ courseId: csvId, role: 'student' }]);
  expect(directory[1].courseRoles).toEqual([{ courseId: canvasId, role: 'student' }]);
  expect(directory[2].courseRoles).toEqual([]);
  expect(directory[0].syncedCourseRoles).toEqual([{ courseId: csvId, role: 'student' }]);
  expect(directory[1].syncedCourseRoles).toEqual([{ courseId: canvasId, role: 'student' }]);
  expect(findImports).toHaveBeenCalledTimes(1); expect(findLinks).toHaveBeenCalledTimes(1);
  for (const user of people) {
    const login = await projectImportedCoursePeople(await projectCanvasEnrollment(user));
    expect(directory.find(p => p.puid === user.puid)!.courseRoles).toEqual(login.courseRoles);
    expect(user.courseRoles).toEqual([]);
    expect(user.isAdmin).toBe(false); expect(user.platformInstructor).toBe(false);
  }
  expect(writes).not.toHaveBeenCalled();
});
test('global and course-scoped Student searches find projection-only users with exact identity', async () => {
  expect((await listUsers({ role: 'student' })).map(p => p.puid)).toEqual([people[0].puid, people[1].puid]);
  expect((await listUsers({ role: 'student', courseId: csvId })).map(p => p.puid)).toEqual([people[0].puid]);
  expect((await listUsers({ courseId: canvasId, q: people[1].puid })).map(p => p.puid)).toEqual([people[1].puid]);
  imports[0].members[0].puid = people[0].puid.toLowerCase(); links[0].members[0].puid = people[1].uid;
  expect((await listUsers({ role: 'student' }))).toEqual([]);
  expect(writes).not.toHaveBeenCalled();
});
test.each(['draft', 'future', 'expired', 'archived'] as const)('%s courses do not create Student roles in the directory', async state => {
  for (const course of courses) {
    if (state === 'draft') { course.published = false; course.lifecycle = 'draft'; }
    if (state === 'future') course.termStart = new Date(Date.now() + 86400000);
    if (state === 'expired') course.termEnd = new Date(Date.now() - 1);
    if (state === 'archived') course.lifecycle = 'archived';
  }
  expect((await listUsers()).every(p => !p.courseRoles.length)).toBe(true);
  expect(await listUsers({ role: 'student' })).toEqual([]);
});
test.each(['banned', 'revoked'] as const)('%s People decision overrides both imported and Canvas Student roles', async status => {
  controls = people.slice(0, 2).map((u, i) => ({ _id: new ObjectId(), courseId: i === 0 ? csvId : canvasId, subject: `puid:${u.puid}`, puid: u.puid, role: 'student', status, revision: 1, createdAt: new Date(), updatedAt: new Date(), updatedByPuid: 'OWNER' }));
  expect((await listUsers()).every(p => !p.courseRoles.length)).toBe(true);
  expect(await listUsers({ role: 'student' })).toEqual([]);
});
test('role changes replace the import role; stale Canvas snapshots and platform bans stay excluded', async () => {
  controls = [{ _id: new ObjectId(), courseId: csvId, subject: `puid:${people[0].puid}`, puid: people[0].puid, role: 'ta', status: 'active', revision: 1, createdAt: new Date(), updatedAt: new Date(), updatedByPuid: 'OWNER' }];
  links[0].validUntil = new Date(Date.now() - 1);
  expect((await listUsers())[0].courseRoles).toEqual([{ courseId: csvId, role: 'ta' }]);
  expect(await listUsers({ role: 'student' })).toEqual([]);
  people[0].deactivatedAt = new Date();
  expect((await listUsers())[0].courseRoles).toEqual([]);
  expect(writes).not.toHaveBeenCalled();
});
test('disconnects and import replacement refresh derived roles while retaining manual grants', async () => {
  people[0].courseRoles = [{ courseId: csvId, role: 'student' }];
  imports = []; links = [];
  expect((await listUsers())[0].courseRoles).toEqual(people[0].courseRoles);
  expect((await listUsers())[0].syncedCourseRoles).toBeUndefined();
  expect((await listUsers())[1].courseRoles).toEqual([]);
});
