jest.mock('../../server/src/services/course-people-access.service', () => ({
  projectCoursePeopleAccess: jest.fn(async (user: unknown) => user),
  peopleMembershipFilter: jest.fn(async (_course: unknown, _roles: unknown, filter: unknown) => filter),
  canUseStudentCode: jest.fn(async () => true),
}));
import { ObjectId } from 'mongodb';
import type { User, Course } from '../../server/src/types/domain';
import type { CourseRegistrationCodeBatch } from '../../server/src/types/registration-code';
jest.mock('../../server/src/components/mongodb/collections', () => ({ coursesCol: jest.fn(), usersCol: jest.fn(), registrationCodeBatchesCol: jest.fn() }));
import { coursesCol, usersCol, registrationCodeBatchesCol } from '../../server/src/components/mongodb/collections';
import { createRegistrationCodes, deleteRegistrationCode, listRegistrationCodes, redeemRegistrationCode, resumeClaimedRegistrations, revokeRegistrationCode } from '../../server/src/services/registration-codes.service';

const courseId = new ObjectId();
const codeId = 'e4f2f037-8512-460a-b1d4-3481c9f366b0';
const requestId = '3f0e0aac-f587-4b89-9ad8-89b5c14bd5a9';
const value = 'ABCDEFGH2345';
const student = { puid: 'STUDENT', uid: 'student', email: 'student@ubc.ca', displayName: 'Sam Student', lastLoginAt: new Date(), courseRoles: [] } as unknown as User;
let course: Course & { _id: ObjectId };
let batches: Array<CourseRegistrationCodeBatch & { _id: ObjectId }>;
let persisted: User[];
const userUpdate = jest.fn();
const claim = jest.fn();

function select(filter: Record<string, unknown>) {
  return batches.find(batch => (!filter._id || batch._id.equals(filter._id as ObjectId))
    && (!filter.courseId || batch.courseId.equals(filter.courseId as ObjectId))
    && (!filter.requestId || batch.requestId === filter.requestId)
    && (!filter['codes.code'] || batch.codes.some(code => code.code === filter['codes.code'])));
}
function change(filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) {
  const batch = select(filter);
  if (!batch) return null;
  const condition = (filter.codes as { $elemMatch: Record<string, unknown> }).$elemMatch;
  const entry = batch.codes.find(code => Object.entries(condition).every(([key, value]) => {
    const actual = (code as unknown as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && '$exists' in value) return (actual !== undefined) === value.$exists;
    if (value && typeof value === 'object' && '$in' in value) return (value.$in as unknown[]).includes(actual);
    return actual === value;
  }));
  if (!entry) return null;
  Object.entries(update.$set).forEach(([key, value]) => { (entry as unknown as Record<string, unknown>)[key.replace('codes.$.', '')] = value; });
  return batch;
}
beforeEach(() => {
  jest.clearAllMocks();
  course = { _id: courseId, name: 'Finance', courseCode: 'COMM 298', published: true, lifecycle: 'published', termEnd: new Date(Date.now() + 86400000) } as unknown as typeof course;
  batches = [{ _id: new ObjectId(), courseId, requestId, createdByPuid: 'TEACHER', createdAt: new Date(), codes: [{ id: codeId, code: value, status: 'available' }] }];
  persisted = [{ ...student, courseRoles: [] }, { ...student, puid: 'OTHER', uid: 'other', courseRoles: [] }];
  userUpdate.mockReset().mockImplementation(async (filter, update) => {
    const user = persisted.find(user => user.puid === filter.puid && !user.deactivatedAt);
    if (!user) return { matchedCount: 0 };
    const role = update.$addToSet.courseRoles;
    if (!user.courseRoles.some(entry => entry.courseId.equals(role.courseId) && entry.role === role.role)) user.courseRoles.push(role);
    return { matchedCount: 1 };
  });
  claim.mockReset().mockImplementation(async (filter, update) => change(filter, update));
  jest.mocked(coursesCol).mockReturnValue({ findOne: jest.fn(async () => course) } as never);
  jest.mocked(usersCol).mockReturnValue({ updateOne: userUpdate, findOne: jest.fn(async filter => persisted.find(user => user.puid === filter.puid)),
    find: jest.fn(() => ({ toArray: async () => persisted })) } as never);
  jest.mocked(registrationCodeBatchesCol).mockReturnValue({
    findOne: jest.fn(async filter => {
      const found = select(filter);
      return found ? { ...found, codes: found.codes.map(code => ({ ...code })) } : null;
    }),
    findOneAndUpdate: claim,
    updateOne: jest.fn(async (filter, update) => ({ matchedCount: change(filter, update) ? 1 : 0 })),
    insertOne: jest.fn(async batch => { batches.push({ ...batch, _id: new ObjectId() }); return { insertedId: batches.at(-1)!._id }; }),
    aggregate: jest.fn((pipeline: Array<Record<string, unknown>>) => {
      const statusMatch = pipeline.find(stage => stage.$match && 'displayStatus' in (stage.$match as object))?.$match as { displayStatus: string } | undefined;
      let rows = batches.filter(batch => batch.courseId.equals(courseId)).flatMap(batch => batch.codes.filter(code => !code.deletedAt).map(code => ({ ...batch, codes: [code] })));
      if (statusMatch) rows = rows.filter(batch => {
        const code = batch.codes[0];
        const displayed = code.status === 'available' && (course.lifecycle === 'archived' || Boolean(course.archivedAt) || Boolean(course.termEnd && course.termEnd <= new Date())) ? 'expired' : code.status;
        return displayed === statusMatch.displayStatus;
      });
      if (pipeline.some(stage => stage.$count)) return { toArray: async () => [{ total: rows.length }] };
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b._id.toString().localeCompare(a._id.toString()) || a.codes[0].id.localeCompare(b.codes[0].id));
      const skip = Number(pipeline.find(stage => '$skip' in stage)?.$skip ?? 0);
      const limit = Number(pipeline.find(stage => '$limit' in stage)?.$limit ?? 25);
      return { toArray: async () => rows.slice(skip, skip + limit) };
    }),
    find: jest.fn(filter => {
      const condition = filter.codes?.$elemMatch;
      const rows = batches.filter(batch => (!filter.courseId || batch.courseId.equals(filter.courseId)) && (!condition || batch.codes.some(code => Object.entries(condition).every(([key, value]) => (code as unknown as Record<string, unknown>)[key] === value))));
      const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => rows };
      return cursor;
    }),
  } as never);
});

test('an authenticated student missing from Gradebook can claim a code exactly once', async () => {
  await expect(redeemRegistrationCode(student, value.toLowerCase())).resolves.toMatchObject({ courseId });
  expect(batches[0].codes[0]).toMatchObject({ status: 'used', claimedByPuid: student.puid });
  expect(persisted[0].courseRoles).toEqual([{ courseId, role: 'student' }]);
  await expect(redeemRegistrationCode(persisted[1], value)).rejects.toMatchObject({ status: 409 });
  expect(persisted[1].courseRoles).toEqual([]);
});
test('two simultaneous claimants cannot share one code', async () => {
  const results = await Promise.allSettled([redeemRegistrationCode(student, value), redeemRegistrationCode(persisted[1], value)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(persisted.filter(user => user.courseRoles.length)).toHaveLength(1);
});
test('legacy shared codes cannot bypass the new enrollment contract', async () => {
  await expect(redeemRegistrationCode(student, 'OLDCODE8')).rejects.toMatchObject({ status: 404 });
  expect(claim).not.toHaveBeenCalled();
});
test.each([
  [{ published: false }, 409], [{ termStart: new Date(Date.now() + 86400000) }, 409],
  [{ termEnd: new Date(0) }, 410], [{ lifecycle: 'archived' }, 410], [{ archivedAt: new Date() }, 410],
] as const)('course availability is checked before consuming a code: %j', async (patch, status) => {
  Object.assign(course, patch);
  await expect(redeemRegistrationCode(student, value)).rejects.toMatchObject({ status });
  expect(batches[0].codes[0].status).toBe('available');
  expect(userUpdate).not.toHaveBeenCalled();
});
test('Gradebook-enrolled students do not consume supplemental codes', async () => {
  await expect(redeemRegistrationCode({ ...student, courseRoles: [{ courseId, role: 'student' }] }, value)).rejects.toMatchObject({ status: 409 });
  expect(batches[0].codes[0].status).toBe('available');
});
test('a failed membership write reserves the code and session reload recovers it for the same user', async () => {
  userUpdate.mockRejectedValueOnce(new Error('write failed'));
  await expect(redeemRegistrationCode(student, value)).rejects.toThrow('write failed');
  expect(batches[0].codes[0]).toMatchObject({ status: 'claimed', claimedByPuid: student.puid });
  await expect(redeemRegistrationCode(persisted[1], value)).rejects.toMatchObject({ status: 409 });
  const recovered = await resumeClaimedRegistrations(student);
  expect(recovered.courseRoles).toEqual([{ courseId, role: 'student' }]);
  expect(batches[0].codes[0].status).toBe('used');
});
test('session recovery never regrants access from an already-used code after role removal', async () => {
  await redeemRegistrationCode(student, value);
  persisted[0].courseRoles = [];
  userUpdate.mockClear();
  await resumeClaimedRegistrations(persisted[0]);
  expect(userUpdate).not.toHaveBeenCalled();
});
test('revoking an unused code prevents enrollment; a used code cannot be revoked', async () => {
  await revokeRegistrationCode(courseId, codeId, 'TEACHER');
  await expect(redeemRegistrationCode(student, value)).rejects.toMatchObject({ status: 410 });
  await expect(revokeRegistrationCode(courseId, codeId, 'TEACHER')).rejects.toMatchObject({ status: 409 });
  expect(persisted[0].courseRoles).toEqual([]);
});
test('a repeated generation request returns the same batch without issuing extra codes', async () => {
  batches = [];
  const first = await createRegistrationCodes(courseId, 'TEACHER', 3, requestId);
  const second = await createRegistrationCodes(courseId, 'TEACHER', 3, requestId);
  expect(second).toEqual(first);
  expect(batches).toHaveLength(1);
  expect(new Set(batches[0].codes.map(code => code.code)).size).toBe(3);
  await expect(createRegistrationCodes(courseId, 'TEACHER', 2, requestId)).rejects.toMatchObject({ status: 409 });
});
test.each([0, 51, 1.5])('invalid batch size %s does not generate codes', async count => {
  await expect(createRegistrationCodes(courseId, 'TEACHER', count, requestId)).rejects.toMatchObject({ status: 400 });
});
test('instructor receipts identify the claimant and last login without exposing the complete user', async () => {
  await redeemRegistrationCode(student, value);
  const result = await listRegistrationCodes(courseId);
  expect(result.codes[0].recipient).toEqual({ puid: student.puid, cwl: student.uid, email: student.email, displayName: student.displayName, lastLoginAt: student.lastLoginAt.toISOString() });
  expect(result.codes[0].status).toBe('used');
  expect(result.codes[0].recipient).not.toHaveProperty('courseRoles');
});
test('deleting an unused record invalidates the code and hides it from the list', async () => {
  await deleteRegistrationCode(courseId, codeId, 'TEACHER');
  expect(batches[0].codes[0]).toMatchObject({ status: 'revoked', deletedByPuid: 'TEACHER' });
  await expect(redeemRegistrationCode(student, value)).rejects.toMatchObject({ status: 410 });
  expect((await listRegistrationCodes(courseId)).total).toBe(0);
  expect(userUpdate).not.toHaveBeenCalled();
});
test('deleting a used receipt preserves enrollment and prevents reuse', async () => {
  await redeemRegistrationCode(student, value);
  userUpdate.mockClear();
  await deleteRegistrationCode(courseId, codeId, 'TEACHER');
  expect(persisted[0].courseRoles).toHaveLength(1);
  expect(userUpdate).not.toHaveBeenCalled();
  expect(batches[0].codes[0].claimedByPuid).toBe(student.puid);
  expect((await listRegistrationCodes(courseId)).codes).toHaveLength(0);
  await expect(redeemRegistrationCode(persisted[1], value)).rejects.toMatchObject({ status: 409 });
});
test('pending claims and other-course records cannot be deleted', async () => {
  userUpdate.mockRejectedValueOnce(new Error('write failed'));
  await expect(redeemRegistrationCode(student, value)).rejects.toThrow('write failed');
  await expect(deleteRegistrationCode(courseId, codeId, 'TEACHER')).rejects.toMatchObject({ status: 409 });
  expect(batches[0].codes[0].deletedAt).toBeUndefined();
  await expect(deleteRegistrationCode(new ObjectId(), codeId, 'TEACHER')).rejects.toMatchObject({ status: 409 });
});
test('pages contain distinct code records and filters/reset handle a shrinking last page', async () => {
  batches = [];
  await createRegistrationCodes(courseId, 'TEACHER', 12, requestId);
  const first = await listRegistrationCodes(courseId, { page: 1, pageSize: 10 });
  const last = await listRegistrationCodes(courseId, { page: 2, pageSize: 10 });
  expect(first).toMatchObject({ total: 12, pageCount: 2 });
  expect(first.codes).toHaveLength(10); expect(last.codes).toHaveLength(2);
  expect(new Set([...first.codes, ...last.codes].map(code => code.id)).size).toBe(12);
  for (const row of last.codes) await deleteRegistrationCode(courseId, row.id, 'TEACHER');
  expect(await listRegistrationCodes(courseId, { page: 2, pageSize: 10 })).toMatchObject({ total: 10, page: 1, pageCount: 1 });
  expect(await listRegistrationCodes(courseId, { status: 'used' })).toMatchObject({ total: 0, codes: [] });
});
