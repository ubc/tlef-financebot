import { ObjectId } from 'mongodb';
import {
  auditCol,
  platformInstructorGrantsCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import {
  grantPlatformInstructor,
  listAdminAccounts,
  revokePlatformInstructor,
} from '../../server/src/services/admin.service';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  auditCol: jest.fn(),
  platformInstructorGrantsCol: jest.fn(),
  usersCol: jest.fn(),
}));

const grantId = new ObjectId();
const findGrantAfterUpdate = jest.fn();
const findGrantAndDelete = jest.fn();
const findGrants = jest.fn();
const findUserAfterUpdate = jest.fn();
const updateUser = jest.fn();
const findUsers = jest.fn();
const insertAudit = jest.fn();

beforeEach(() => {
  for (const mock of [
    findGrantAfterUpdate,
    findGrantAndDelete,
    findGrants,
    findUserAfterUpdate,
    updateUser,
    findUsers,
    insertAudit,
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
  } as never);
  jest.mocked(auditCol).mockReturnValue({ insertOne: insertAudit } as never);
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
