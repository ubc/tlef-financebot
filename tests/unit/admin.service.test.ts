import { ObjectId } from 'mongodb';
import {
  auditCol,
  coursesCol,
  platformSettingsCol,
  platformInstructorGrantsCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import {
  grantPlatformInstructor,
  deactivateUser,
  removeRole,
  updatePlatformSettings,
  listAdminAccounts,
  listAdminCourses,
  listUsers,
  revokePlatformInstructor,
} from '../../server/src/services/admin.service';
import { activeSharedInstructorPuids, projectCourseInstructorShares, revokeSharedInstructorGrants } from '../../server/src/services/course-sharing.service';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  auditCol: jest.fn(),
  capabilitySettingsCol: jest.fn(),
  coursesCol: jest.fn(),
  platformSettingsCol: jest.fn(),
  platformInstructorGrantsCol: jest.fn(),
  usersCol: jest.fn(),
}));
jest.mock('../../server/src/services/course-sharing.service', () => ({
  activeSharedInstructorPuids: jest.fn(async () => []),
  projectCourseInstructorShares: jest.fn(async (users: unknown[]) => users),
  revokeSharedInstructorGrants: jest.fn(async () => 0),
}));

const grantId = new ObjectId();
const findGrantAfterUpdate = jest.fn();
const findGrantAndDelete = jest.fn();
const findGrants = jest.fn();
const findUserAfterUpdate = jest.fn();
const updateUser = jest.fn();
const findUsers = jest.fn();
const findCourses = jest.fn();
const insertAudit = jest.fn();
const findUser = jest.fn();
const countUsers = jest.fn();
const findPlatformSettings = jest.fn();
const replacePlatformSettings = jest.fn();

beforeEach(() => {
  jest.mocked(activeSharedInstructorPuids).mockReset().mockResolvedValue([]);
  jest.mocked(projectCourseInstructorShares).mockReset().mockImplementation(async users => users);
  jest.mocked(revokeSharedInstructorGrants).mockReset().mockResolvedValue(0);
  for (const mock of [
    findGrantAfterUpdate,
    findGrantAndDelete,
    findGrants,
    findUserAfterUpdate,
    updateUser,
    findUsers,
    findCourses,
    insertAudit,
    findUser,
    countUsers,
    findPlatformSettings,
    replacePlatformSettings,
  ]) {
    mock.mockReset();
  }

  jest.mocked(platformInstructorGrantsCol).mockReturnValue({
    findOneAndUpdate: findGrantAfterUpdate,
    findOneAndDelete: findGrantAndDelete,
    find: findGrants,
  } as never);
  jest.mocked(usersCol).mockReturnValue({
    findOneAndUpdate: findUserAfterUpdate,
    updateOne: updateUser,
    find: findUsers,
    findOne: findUser,
    countDocuments: countUsers,
  } as never);
  jest.mocked(auditCol).mockReturnValue({ insertOne: insertAudit } as never);
  jest.mocked(coursesCol).mockReturnValue({ find: findCourses } as never);
  jest.mocked(platformSettingsCol).mockReturnValue({
    findOne: findPlatformSettings,
    replaceOne: replacePlatformSettings,
  } as never);
});

describe('Phase 3 Admin essentials', () => {
  it('includes sharing-only Instructors in the filtered directory and returns effective course roles', async () => {
    const courseId = new ObjectId();
    const stored = userDoc({ courseRoles: [] });
    const effective = { ...stored, courseRoles: [{ courseId, role: 'instructor' as const }] };
    jest.mocked(activeSharedInstructorPuids).mockResolvedValueOnce([stored.puid]);
    jest.mocked(projectCourseInstructorShares).mockResolvedValueOnce([effective]);
    findUsers.mockReturnValue({ sort: () => ({ limit: () => ({ toArray: async () => [stored] }) }) });

    await expect(listUsers({ courseId, role: 'instructor' })).resolves.toEqual([effective]);
    expect(findUsers).toHaveBeenCalledWith({ $and: [{ $or: [
      { courseRoles: { $elemMatch: { courseId, role: 'instructor' } } },
      { puid: { $in: [stored.puid] } },
    ] }] });
  });

  it('revokes the authoritative sharing grant when Admin removes a sharing-only Instructor', async () => {
    const courseId = new ObjectId();
    const stored = userDoc({ courseRoles: [] });
    findUser.mockResolvedValue(stored);
    jest.mocked(projectCourseInstructorShares).mockResolvedValueOnce([{ ...stored, courseRoles: [{ courseId, role: 'instructor' }] }]);
    jest.mocked(activeSharedInstructorPuids).mockResolvedValueOnce([stored.puid]);
    countUsers.mockResolvedValue(2);
    updateUser.mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });

    await expect(removeRole(stored.puid, courseId, 'instructor', 'ADMIN')).resolves.toEqual({ removed: true });
    expect(revokeSharedInstructorGrants).toHaveBeenCalledWith(courseId, stored.puid);
  });

  it('lists every course using only safe identity fields and normalizes legacy lifecycle', async () => {
    const courses = [
      { _id: new ObjectId(), name: 'Current', courseCode: 'COMM 298', section: '101', term: '2026W1', lifecycle: 'published', published: true },
      { _id: new ObjectId(), name: 'Archived', courseCode: 'COMM 298', term: '2025W1', published: true, archivedAt: new Date() },
      { _id: new ObjectId(), name: 'Legacy published', courseCode: 'COMM 299', term: '2025W1', published: true },
      { _id: new ObjectId(), name: 'Legacy draft', courseCode: 'COMM 300', term: '2025W1', published: false },
    ].map((course) => ({
      ...course, registrationCode: 'PRIVATE', ownerPuid: 'PRIVATE-OWNER',
      identityKey: 'PRIVATE-KEY', autoPause: { minAttempts: 5, flagPercent: 20, flagCount: 3 },
    }));
    const cursor = cursorResult(courses);
    findCourses.mockReturnValue(cursor);

    await expect(listAdminCourses()).resolves.toEqual(courses.map((course, index) => ({
      _id: course._id.toHexString(), name: course.name, courseCode: course.courseCode,
      ...(course.section !== undefined ? { section: course.section } : {}),
      term: course.term, lifecycle: ['published', 'archived', 'published', 'draft'][index],
    })));
    expect(findCourses).toHaveBeenCalledWith({}, {
      projection: {
        _id: 1, name: 1, courseCode: 1, section: 1, term: 1,
        lifecycle: 1, published: 1, archivedAt: 1,
      },
    });
    expect(cursor.sort).toHaveBeenCalledWith({ term: -1, courseCode: 1, section: 1, name: 1, _id: 1 });
  });

  it('warns before orphaning a course and removes only after confirmation', async () => {
    const courseId = new ObjectId();
    const instructor = userDoc({ courseRoles: [{ courseId, role: 'instructor' }] });
    findUser.mockResolvedValue(instructor);
    countUsers.mockResolvedValue(1);
    updateUser.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await expect(removeRole('ESIPROF00001', courseId, 'instructor', 'ADMIN')).resolves.toEqual({
      removed: false, warning: 'orphans-course', courseId: courseId.toHexString(),
    });
    expect(updateUser).not.toHaveBeenCalled();

    await expect(removeRole('ESIPROF00001', courseId, 'instructor', 'ADMIN', true)).resolves.toEqual({ removed: true });
    expect(updateUser).toHaveBeenCalledWith(
      { _id: instructor._id },
      { $pull: { courseRoles: { courseId, role: 'instructor' } } },
    );
    expect(insertAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.revoke' }));
  });

  it('deactivates without deleting records and writes an audit entry', async () => {
    const user = userDoc();
    findUser.mockResolvedValue(user);
    updateUser.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await deactivateUser(user.puid, 'ADMIN');

    expect(updateUser).toHaveBeenCalledWith(
      { _id: user._id },
      { $set: { deactivatedAt: expect.any(Date) } },
    );
    expect(insertAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.deactivate' }));
  });

  it('rejects non-positive cost controls and audits a valid settings mutation', async () => {
    const base = {
      models: {
        generator: { model: 'gpt-5.4-nano' },
        validator: { model: 'gpt-5.4-nano' },
        reviewer: { model: 'gpt-5.4-nano' },
        masteryEvaluator: { model: 'gpt-5.4-nano' },
        utility: { model: 'gpt-5.4-nano' },
      },
      costControls: { maxGenerationsPerDay: 10 },
      featureFlags: { reviewerAgent: true, layer2Evaluator: true, retryOnReject: true },
    };
    findPlatformSettings.mockResolvedValue({ _id: 'platform', ...base });

    await expect(updatePlatformSettings({ ...base, costControls: { maxGenerationsPerDay: 0 } }, 'ADMIN'))
      .rejects.toThrow('invalid-cost-controls');
    await updatePlatformSettings(base, 'ADMIN');

    expect(replacePlatformSettings).toHaveBeenCalledWith(
      { _id: 'platform' }, expect.objectContaining(base), { upsert: true },
    );
    expect(insertAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'platform-settings.update' }));
  });

  it('requires explicit quality-impact confirmation before disabling reviewer', async () => {
    const patch = {
      models: {
        generator: { model: 'gpt-5.4-nano' },
        validator: { model: 'gpt-5.4-nano' },
        reviewer: { model: 'gpt-5.4-nano' },
        masteryEvaluator: { model: 'gpt-5.4-nano' },
        utility: { model: 'gpt-5.4-nano' },
      },
      costControls: { maxGenerationsPerDay: 10 },
      featureFlags: { reviewerAgent: false, layer2Evaluator: true, retryOnReject: true },
    };
    findPlatformSettings.mockResolvedValue({ _id: 'platform', ...patch, featureFlags: { reviewerAgent: true, layer2Evaluator: true, retryOnReject: true } });

    await expect(updatePlatformSettings(patch, 'ADMIN')).rejects.toThrow('reviewer-disable-confirmation-required');
    await expect(updatePlatformSettings({ ...patch, confirmQualityImpact: true }, 'ADMIN')).resolves.toMatchObject(patch);
  });
});

function grantDoc(over: Record<string, unknown> = {}) {
  return {
    _id: grantId,
    puid: 'ESIPROF00001',
    grantedByPuid: 'ESI5CZY7J307',
    createdAt: new Date('2026-07-28T00:00:00Z'),
    updatedAt: new Date('2026-07-28T00:00:00Z'),
    ...over,
  };
}

function userDoc(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    puid: 'ESIPROF00001',
    uid: '',
    displayName: 'Finance Professor',
    email: '',
    affiliations: ['faculty'],
    isAdmin: false,
    courseRoles: [],
    createdAt: new Date('2026-07-27T19:00:00Z'),
    lastLoginAt: new Date('2026-07-27T20:00:00Z'),
    ...over,
  };
}

function cursorResult<T>(value: T[]) {
  return {
    sort: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(value),
    }),
  };
}

describe('PUID-backed Admin account management', () => {
  it('pre-provisions a PUID grant before the user first logs in', async () => {
    findGrantAfterUpdate.mockResolvedValue(grantDoc());
    findUserAfterUpdate.mockResolvedValue(null);
    insertAudit.mockResolvedValue({ acknowledged: true });

    const result = await grantPlatformInstructor('  ESIPROF00001  ', 'ESI5CZY7J307');

    expect(findGrantAfterUpdate).toHaveBeenCalledWith(
      { puid: 'ESIPROF00001' },
      expect.objectContaining({
        $set: expect.objectContaining({ grantedByPuid: 'ESI5CZY7J307' }),
        $setOnInsert: expect.objectContaining({ puid: 'ESIPROF00001' }),
      }),
      { upsert: true, returnDocument: 'after' },
    );
    expect(result).toMatchObject({
      puid: 'ESIPROF00001',
      status: 'pending',
      platformInstructor: true,
    });
    expect(insertAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'role.assign',
      detail: { puid: 'ESIPROF00001', accountStatus: 'pending' },
    }));
  });

  it('activates an existing real-IdP user even when uid and email are empty', async () => {
    findGrantAfterUpdate.mockResolvedValue(grantDoc());
    findUserAfterUpdate.mockResolvedValue(userDoc({ platformInstructor: true }));
    insertAudit.mockResolvedValue({ acknowledged: true });

    const result = await grantPlatformInstructor('ESIPROF00001', 'ESI5CZY7J307');

    expect(findUserAfterUpdate).toHaveBeenCalledWith(
      { puid: 'ESIPROF00001' },
      { $set: { platformInstructor: true } },
      { returnDocument: 'after' },
    );
    expect(result).toMatchObject({
      puid: 'ESIPROF00001',
      uid: '',
      displayName: 'Finance Professor',
      status: 'active',
      platformInstructor: true,
    });
  });

  it('revokes idempotently and clears the matching PUID User flag', async () => {
    findGrantAndDelete.mockResolvedValue(grantDoc());
    updateUser.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    insertAudit.mockResolvedValue({ acknowledged: true });

    const result = await revokePlatformInstructor('ESIPROF00001', 'ESI5CZY7J307');

    expect(findGrantAndDelete).toHaveBeenCalledWith({ puid: 'ESIPROF00001' });
    expect(updateUser).toHaveBeenCalledWith(
      { puid: 'ESIPROF00001' },
      { $unset: { platformInstructor: '' } },
    );
    expect(result).toEqual({
      puid: 'ESIPROF00001',
      granted: false,
      revoked: true,
    });
  });

  it('lists every matching user plus a pending PUID grant without raw SAML data', async () => {
    const activeGrant = grantDoc();
    const pendingGrant = grantDoc({ _id: new ObjectId(), puid: 'ESIPENDING01' });
    findUsers.mockReturnValue(cursorResult([userDoc()]));
    findGrants.mockReturnValue(cursorResult([activeGrant, pendingGrant]));

    const result = await listAdminAccounts('finance');

    expect(findUsers).toHaveBeenCalledWith({
      $or: expect.arrayContaining([
        { displayName: { $regex: 'finance', $options: 'i' } },
      ]),
    });
    expect(result).toEqual([
      expect.objectContaining({
        puid: 'ESIPROF00001',
        displayName: 'Finance Professor',
        platformInstructor: true,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('attributes');
  });

  it('shows a matching pending PUID even before a User document exists', async () => {
    findUsers.mockReturnValue(cursorResult([]));
    findGrants.mockReturnValue(cursorResult([
      grantDoc({ puid: 'ESIPENDING01' }),
    ]));

    await expect(listAdminAccounts('pending')).resolves.toEqual([
      expect.objectContaining({
        puid: 'ESIPENDING01',
        status: 'pending',
        platformInstructor: true,
      }),
    ]);
  });
});
