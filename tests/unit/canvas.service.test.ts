import express from 'express';
import request from 'supertest';
import { ensureCourseInstructor, ensureCourseTa, ensureCourseStudent } from '../../server/src/components/auth/course-guards';
import { ObjectId } from 'mongodb';
import { mergeCanvasPeople, mergeCanvasRosters, projectCanvasEnrollment, saveCanvasLink, canvasLinkStatus } from '../../server/src/services/canvas.service';
import { canvasEnabled, canvas, canvasApi } from '../../server/src/components/canvas';
import { getDb } from '../../server/src/components/mongodb';
import { coursesCol, usersCol } from '../../server/src/components/mongodb/collections';
import type { CourseRole, User } from '../../server/src/types/domain';

jest.mock('../../server/src/components/canvas', () => ({ canvasEnabled: jest.fn(() => true), canvasApi: jest.fn(), canvas: { getCourses: jest.fn(), getCourseUsers: jest.fn() } }));
jest.mock('../../server/src/components/mongodb', () => ({ getDb: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({ coursesCol: jest.fn(), usersCol: jest.fn() }));
jest.mock('../../server/src/services/materials.service', () => ({}));
jest.mock('../../server/src/services/course-sharing.service', () => ({}));
jest.mock('../../server/src/components/jobs', () => ({}));
const enrollment = (type = 'StudentEnrollment', course_id = '101', enrollment_state = 'active') => ({ type, role: type, course_id, enrollment_state });
const student = (id: string, loginId?: string, courseId = '101') => ({ id, loginId, name: 'Alex Chen', raw: { enrollments: [enrollment('StudentEnrollment', courseId)] } });
const merge = (...users: ReturnType<typeof student>[]) => mergeCanvasRosters([{ id: '101', users }]);
beforeEach(() => { (canvasEnabled as jest.Mock).mockReturnValue(true); });

test('two sections union by Login ID; same names remain separate', () => {
  const members = mergeCanvasRosters([{ id: '101', users: [student('1', 'PUID-A'), student('2', 'PUID-B')] }, { id: '102', users: [student('1', 'PUID-A', '102'), student('3', 'PUID-C', '102')] }]);
  expect(members).toHaveLength(3);
  expect(members[0].sourceIds).toEqual(['101', '102']);
  expect(members[0].grants).toHaveLength(2);
});
test('Login ID is authoritative even when integration_id differs; no fallback when missing', () => {
  expect(merge({ ...student('1', 'PUID-A'), integrationId: 'wrong' } as ReturnType<typeof student>)[0].puid).toBe('PUID-A');
  expect(() => merge({ ...student('1'), integrationId: 'PUID-A', email: 'alex@example.com' } as ReturnType<typeof student>)).toThrow('did not release a Login ID');
});
test('conflicting Login IDs and Canvas accounts are rejected; case is preserved', () => {
  expect(() => merge(student('1', 'a'), student('2', 'a'))).toThrow('conflicting');
  expect(() => merge(student('1', 'a'), student('1', 'b'))).toThrow('conflicting');
  expect(merge(student('1', 'A'), student('2', 'a'))).toHaveLength(2);
});
test('only active supported course enrollments grant roles; names cannot impersonate teacher type', () => {
  const member = student('1', 'PUID-A');
  member.raw.enrollments = [enrollment('TeacherEnrollment'), enrollment('TaEnrollment'), enrollment('StudentEnrollment'),
    { ...enrollment('ObserverEnrollment'), role: 'TeacherEnrollment' }, enrollment('TeacherEnrollment', '999'), enrollment('TeacherEnrollment', '101', 'invited')];
  expect(merge(member)[0].grants.map(g => g.role)).toEqual(['instructor', 'ta', 'student']);
  for (const type of ['ObserverEnrollment', 'DesignerEnrollment', 'StudentViewEnrollment', 'AccountAdmin']) {
    member.raw.enrollments = [enrollment(type)]; expect(merge(member)).toEqual([]);
  }
  for (const state of ['invited', 'inactive', 'completed', 'deleted', 'rejected']) {
    member.raw.enrollments = [enrollment('TeacherEnrollment', '101', state)]; expect(merge(member)).toEqual([]);
  }
});
test('custom and section-limited staff do not receive broader FinanceBot teaching access', () => {
  const member = student('1', 'PUID-A');
  member.raw.enrollments = [{ ...enrollment('TeacherEnrollment'), role: 'Restricted teacher' }];
  expect(merge(member)).toEqual([]);
  Object.assign(member.raw.enrollments[0], { role: 'TeacherEnrollment', limit_privileges_to_course_section: true });
  expect(merge(member)).toEqual([]);
});
test('missing enrollment metadata aborts snapshot; missing course association cannot grant access', () => {
  expect(() => merge({ ...student('1', 'a'), raw: {} } as ReturnType<typeof student>)).toThrow('enrollment roles');
  expect(merge({ ...student('1', 'a'), raw: { enrollments: [enrollment('TeacherEnrollment', '')] } })).toEqual([]);
});
test('empty authoritative roster removes eligibility', () => { expect(merge()).toEqual([]); });

function projectionFixture(grants: CourseRole[], published = true) {
  const courseId = new ObjectId();
  const user = { puid: 'puid', isAdmin: false, platformInstructor: false, courseRoles: [] } as unknown as User;
  const links = [{ _id: courseId, members: [{ puid: 'puid', grants: grants.map(role => ({ sourceId: '101', role })) }] }];
  const find = jest.fn(() => ({ toArray: async () => links }));
  (getDb as jest.Mock).mockReturnValue({ collection: () => ({ find }) });
  const courses = [{ _id: courseId, published, termStart: undefined as Date | undefined }];
  const findCourses = jest.fn(() => ({ toArray: async () => courses }));
  (coursesCol as jest.Mock).mockReturnValue({ find: findCourses });
  return { courseId, user, links, find, courses, findCourses };
}
test('exact Login ID version, domain, auto-enroll and freshness are required; no platform escalation or persisted mutation', async () => {
  const { user, find, findCourses } = projectionFixture(['instructor', 'ta', 'student']);
  const projected = await projectCanvasEnrollment(user);
  expect(projected.courseRoles.map(r => r.role)).toEqual(['instructor', 'ta', 'student']);
  expect(user.courseRoles).toEqual([]);
  expect(projected.isAdmin).toBe(false); expect(projected.platformInstructor).toBe(false);
  expect(find).toHaveBeenCalledWith(expect.objectContaining({ identityVersion: 'login-id-v1', domain: expect.any(String), 'members.puid': 'puid', autoEnroll: true, validUntil: { $gt: expect.any(Date) } }));
  expect(findCourses).toHaveBeenCalledWith(expect.objectContaining({ lifecycle: { $ne: 'archived' }, archivedAt: { $exists: false }, $or: expect.any(Array) }));
});
test('draft and future courses allow teaching preparation but not student entry', async () => {
  const { user, courses } = projectionFixture(['student', 'ta', 'instructor'], false);
  expect((await projectCanvasEnrollment(user)).courseRoles.map(r => r.role)).toEqual(['ta', 'instructor']);
  courses[0].published = true; courses[0].termStart = new Date(Date.now() + 86400000);
  expect((await projectCanvasEnrollment(user)).courseRoles.map(r => r.role)).toEqual(['ta', 'instructor']);
});
test('fresh projection reflects demotion, withdrawal and disconnect without removing manual roles', async () => {
  const { user, courseId, links } = projectionFixture(['instructor']);
  user.courseRoles.push({ courseId, role: 'student' });
  expect((await projectCanvasEnrollment(user)).courseRoles.map(r => r.role)).toEqual(['student', 'instructor']);
  links[0].members[0].grants = [{ sourceId: '101', role: 'ta' }];
  expect((await projectCanvasEnrollment(user)).courseRoles.map(r => r.role)).toEqual(['student', 'ta']);
  links.splice(0);
  expect(await projectCanvasEnrollment(user)).toBe(user);
});
test('disabled or deactivated identities receive no derived grants; mismatched PUID cannot get a role', async () => {
  const { user, links } = projectionFixture(['instructor']);
  links[0].members[0].puid = 'PUID';
  expect((await projectCanvasEnrollment(user)).courseRoles).toEqual([]);
  (canvasEnabled as jest.Mock).mockReturnValue(false);
  expect(await projectCanvasEnrollment(user)).toBe(user);
  (canvasEnabled as jest.Mock).mockReturnValue(true);
  user.deactivatedAt = new Date();
  expect(await projectCanvasEnrollment(user)).toBe(user);
});
test('toolkit reads all supported roles with enrollment metadata and writes versioned snapshot; students list excludes staff', async () => {
  const courseId = new ObjectId(); const teacher = student('2', 'teacher');
  teacher.raw.enrollments = [enrollment('TeacherEnrollment')];
  (canvas.getCourses as jest.Mock).mockResolvedValue([{ id: '101', name: 'Finance', code: 'COMM' }]);
  (canvas.getCourseUsers as jest.Mock).mockResolvedValue([student('1', 'student'), teacher]);
  (canvasApi as jest.Mock).mockResolvedValue('api');
  (coursesCol as jest.Mock).mockReturnValue({ findOne: async () => ({ _id: courseId }) });
  const insertOne = jest.fn();
  (getDb as jest.Mock).mockReturnValue({ collection: () => ({ insertOne }) });
  await saveCanvasLink(courseId, 'owner', ['101'], null, true);
  expect(canvas.getCourseUsers).toHaveBeenCalledWith('api', '101', { enrollmentTypes: ['student', 'teacher', 'ta', 'observer', 'designer'], enrollmentStates: ['active', 'invited'], include: ['enrollments'] });
  const snapshot = insertOne.mock.calls[0][0];
  expect(snapshot.identityVersion).toBe('login-id-v1'); expect(snapshot.members).toHaveLength(2);
  (getDb as jest.Mock).mockReturnValue({ collection: () => ({ findOne: async () => snapshot }) });
  (usersCol as jest.Mock).mockReturnValue({ find: () => ({ toArray: async () => [] }) });
  expect((await canvasLinkStatus(courseId))?.students).toHaveLength(1);
});

test.each([
  ['instructor', 200, 403, 403],
  ['ta', 403, 200, 403],
  ['student', 403, 403, 200],
] as const)('projected %s role is enforced by actual course route guards', async (role, instructorStatus, taStatus, studentStatus) => {
  const { user, courseId } = projectionFixture([role]);
  const projected = await projectCanvasEnrollment(user);
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, { user: projected, isAuthenticated: () => true }); next(); });
  app.get('/instructor/:courseId', ensureCourseInstructor(), (_req, res) => { res.sendStatus(200); });
  app.get('/ta/:courseId', ensureCourseTa(), (_req, res) => { res.sendStatus(200); });
  app.get('/student/:courseId', ensureCourseStudent(), (_req, res) => { res.sendStatus(200); });
  await request(app).get(`/instructor/${courseId}`).expect(instructorStatus);
  await request(app).get(`/ta/${courseId}`).expect(taStatus);
  await request(app).get(`/student/${courseId}`).expect(studentStatus);
  await request(app).get(`/instructor/${new ObjectId()}`).expect(403);
});

test('Canvas deployments omitting included enrollments use explicit user/course/state metadata from toolkit fallback', async () => {
  const courseId = new ObjectId();
  (canvas.getCourses as jest.Mock).mockResolvedValue([{ id: '101', name: 'Finance', code: 'COMM' }]);
  (canvas.getCourseUsers as jest.Mock).mockResolvedValue([{ id: '1', loginId: 'PUID', name: 'Alex', raw: {} }]);
  const getAll = jest.fn().mockResolvedValue([{ user_id: 1, ...enrollment('TaEnrollment') }, { user_id: 1, ...enrollment('TeacherEnrollment', '999') }, { user_id: 1, ...enrollment('TeacherEnrollment', '101', 'invited') }]);
  (canvasApi as jest.Mock).mockResolvedValue({ getAll });
  (coursesCol as jest.Mock).mockReturnValue({ findOne: async () => ({ _id: courseId }) });
  const insertOne = jest.fn();
  (getDb as jest.Mock).mockReturnValue({ collection: () => ({ insertOne }) });
  await saveCanvasLink(courseId, 'owner', ['101'], null, true);
  expect(getAll).toHaveBeenCalledWith('/courses/101/enrollments', expect.objectContaining({ state: ['active', 'invited'] }));
  expect(insertOne.mock.calls[0][0].members[0].grants).toEqual([{ sourceId: '101', role: 'ta' }]);
  insertOne.mockClear(); getAll.mockRejectedValue(new Error('403'));
  await expect(saveCanvasLink(courseId, 'owner', ['101'], null, true)).rejects.toThrow('Developer Key scope');
  expect(insertOne).not.toHaveBeenCalled();
  getAll.mockResolvedValue([{ user_id: 1, course_id: 101 }]);
  await expect(saveCanvasLink(courseId, 'owner', ['101'], null, true)).rejects.toThrow('incomplete enrollment');
  expect(insertOne).not.toHaveBeenCalled();
});

test('display includes self, custom teachers, TAs, observers and invited users without granting them extra permissions', () => {
  const teacher = { ...student('1', 'SELF'), raw: { enrollments: [{ ...enrollment('TeacherEnrollment'), role: 'Restricted Teacher', limit_privileges_to_course_section: true }] } };
  const observer = { ...student('2'), raw: { enrollments: [enrollment('ObserverEnrollment')] } };
  const ta = { ...student('3', 'TA'), raw: { enrollments: [enrollment('TaEnrollment')] } };
  const invited = { ...student('4'), raw: { enrollments: [enrollment('StudentEnrollment', '101', 'invited')] } };
  const sources = [{ id: '101', users: [teacher, observer, ta, invited] }];
  expect(mergeCanvasPeople(sources).map(p => p.roles)).toEqual([['Restricted Teacher'], ['Observer'], ['TA'], ['Student']]);
  expect(mergeCanvasRosters(sources).map(p => p.puid)).toEqual(['TA']);
  expect(mergeCanvasPeople([...sources, ...sources])).toHaveLength(4);
});
test('people response marks the viewer and never exposes raw Login IDs', async () => {
  const courseId = new ObjectId();
  const people = mergeCanvasPeople([{ id: '101', users: [student('1', 'PRIVATE-SELF')] }]);
  (getDb as jest.Mock).mockReturnValue({ collection: () => ({ findOne: async () => ({ _id: courseId, members: [], people, sources: [] }) }) });
  (usersCol as jest.Mock).mockReturnValue({ find: () => ({ toArray: async () => [{ puid: 'PRIVATE-SELF' }] }) });
  const result = await canvasLinkStatus(courseId, 'PRIVATE-SELF');
  expect(result?.people?.[0]).toMatchObject({ isSelf: true, roles: ['Student'], status: 'CWL account matched' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE-SELF');
});
