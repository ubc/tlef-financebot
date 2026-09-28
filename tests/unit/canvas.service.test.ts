import { ObjectId } from 'mongodb';
import { mergeCanvasRosters, projectCanvasEnrollment } from '../../server/src/services/canvas.service';
import { canvasEnabled } from '../../server/src/components/canvas';
import { getDb } from '../../server/src/components/mongodb';
import { coursesCol } from '../../server/src/components/mongodb/collections';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/components/canvas', () => ({ canvasEnabled: jest.fn(() => true) }));
jest.mock('../../server/src/components/mongodb', () => ({ getDb: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({ coursesCol: jest.fn() }));
jest.mock('../../server/src/services/materials.service', () => ({}));
jest.mock('../../server/src/services/course-sharing.service', () => ({}));
jest.mock('../../server/src/components/jobs', () => ({}));
const student = (id: string, puid?: string, name = 'Alex Chen') => ({ id, integrationId: puid, name, raw: {} });
test('two sections union by opaque PUID; same names remain separate and overlapping students appear once', () => {
  const members = mergeCanvasRosters([{ id: '101', users: [student('1', 'PUID-A'), student('2', 'PUID-B')] }, { id: '102', users: [student('1', 'PUID-A'), student('3', 'PUID-C')] }]);
  expect(members).toHaveLength(3);
  expect(members[0].sourceIds).toEqual(['101', '102']);
});
test('missing PUID never falls back to name, email or Canvas id', () => {
  expect(() => mergeCanvasRosters([{ id: '101', users: [student('1')] }])).toThrow('did not release a PUID');
});
test('conflicting PUIDs and Canvas accounts are rejected', () => {
  expect(() => mergeCanvasRosters([{ id: '101', users: [student('1', 'a'), student('2', 'a')] }])).toThrow('conflicting');
  expect(() => mergeCanvasRosters([{ id: '101', users: [student('1', 'a'), student('1', 'b')] }])).toThrow('conflicting');
});
test('opaque PUID case is preserved', () => {
  expect(mergeCanvasRosters([{ id: '101', users: [student('1', 'A'), student('2', 'a')] }])).toHaveLength(2);
});
test('empty authoritative rosters remove Canvas eligibility', () => {
  expect(mergeCanvasRosters([{ id: '101', users: [] }, { id: '102', users: [] }])).toEqual([]);
});
test('session projection only adds published fresh course access; it never persists or mutates manual roles', async () => {
  const manualId = new ObjectId(); const canvasId = new ObjectId();
  const user = { puid: 'puid', courseRoles: [{ courseId: manualId, role: 'student' }] } as User;
  const find = jest.fn(() => ({ toArray: async () => [{ _id: canvasId }] }));
  (getDb as jest.Mock).mockReturnValue({ collection: () => ({ find }) });
  const findCourses = jest.fn(() => ({ toArray: async () => [{ _id: canvasId }] }));
  (coursesCol as jest.Mock).mockReturnValue({ find: findCourses });
  const projected = await projectCanvasEnrollment(user);
  expect(projected.courseRoles).toHaveLength(2); expect(user.courseRoles).toHaveLength(1);
  expect(find.mock.calls[0]).toEqual([expect.objectContaining({ 'members.puid': 'puid', autoEnroll: true, validUntil: { $gt: expect.any(Date) } })]);
  expect(findCourses.mock.calls[0]).toEqual([expect.objectContaining({ published: true, lifecycle: { $ne: 'archived' } })]);
  (canvasEnabled as jest.Mock).mockReturnValue(false);
  expect(await projectCanvasEnrollment(user)).toBe(user);
});
