import { ObjectId } from 'mongodb';
import {
  auditCol,
  platformInstructorGrantsCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import {
  grantPlatformInstructor,
  listPlatformInstructors,
  revokePlatformInstructor,
} from '../../server/src/services/admin.service';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  auditCol: jest.fn(),
  platformInstructorGrantsCol: jest.fn(),
  usersCol: jest.fn(),
}));

const grantId = new ObjectId();
const findGrantAfterUpdate = jest.fn();
const updateGrant = jest.fn();
const findGrantAndDelete = jest.fn();
const findGrants = jest.fn();
const findUserAfterUpdate = jest.fn();
const updateUsers = jest.fn();
const findUsers = jest.fn();
const insertAudit = jest.fn();

beforeEach(() => {
  findGrantAfterUpdate.mockReset();
  updateGrant.mockReset();
  findGrantAndDelete.mockReset();
  findGrants.mockReset();
  findUserAfterUpdate.mockReset();
  updateUsers.mockReset();
  findUsers.mockReset();
  insertAudit.mockReset();

  jest.mocked(platformInstructorGrantsCol).mockReturnValue({
    findOneAndUpdate: findGrantAfterUpdate,
    updateOne: updateGrant,
    findOneAndDelete: findGrantAndDelete,
    find: findGrants,
  } as never);
  jest.mocked(usersCol).mockReturnValue({
    findOneAndUpdate: findUserAfterUpdate,
    updateMany: updateUsers,
    find: findUsers,
  } as never);
  jest.mocked(auditCol).mockReturnValue({ insertOne: insertAudit } as never);
});

function grantDoc(over: Record<string, unknown> = {}) {
  return {
    _id: grantId,
    uid: 'financeprof',
    grantedByPuid: 'PUID-ADMIN-0001',
    createdAt: new Date('2026-07-28T00:00:00Z'),
    updatedAt: new Date('2026-07-28T00:00:00Z'),
    ...over,
  };
}

describe('platform-Instructor administration', () => {
  it('normalizes a CWL username and leaves a grant pending before first login', async () => {
    findGrantAfterUpdate.mockResolvedValue(grantDoc());
    findUserAfterUpdate.mockResolvedValue(null);
    insertAudit.mockResolvedValue({ acknowledged: true });

    const result = await grantPlatformInstructor('  FinanceProf  ', 'PUID-ADMIN-0001');

    expect(findGrantAfterUpdate).toHaveBeenCalledWith(
      { uid: 'financeprof' },
      expect.objectContaining({
        $set: expect.objectContaining({ grantedByPuid: 'PUID-ADMIN-0001' }),
        $setOnInsert: expect.objectContaining({ uid: 'financeprof' }),
      }),
      { upsert: true, returnDocument: 'after' },
    );
    expect(result).toMatchObject({ uid: 'financeprof', status: 'pending' });
    expect(insertAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'role.assign',
      targetType: 'platform-instructor-grant',
      targetId: grantId,
      detail: { uid: 'financeprof', linkedPuid: null },
    }));
  });

  it('activates the grant immediately when the CWL User already exists', async () => {
    findGrantAfterUpdate.mockResolvedValue(grantDoc());
    findUserAfterUpdate.mockResolvedValue({
      _id: new ObjectId(),
      puid: 'PUID-PROF-0001',
      uid: 'FinanceProf',
      displayName: 'Fin Professor',
      email: 'fin.prof@example.ubc.ca',
      lastLoginAt: new Date('2026-07-27T20:00:00Z'),
      platformInstructor: true,
    });
    insertAudit.mockResolvedValue({ acknowledged: true });

    const result = await grantPlatformInstructor('financeprof', 'PUID-ADMIN-0001');

    expect(findUserAfterUpdate).toHaveBeenCalledWith(
      { uid: /^financeprof$/i },
      { $set: { platformInstructor: true } },
      { returnDocument: 'after' },
    );
    expect(updateGrant).toHaveBeenCalledWith(
      { _id: grantId },
      { $set: expect.objectContaining({ appliedToPuid: 'PUID-PROF-0001' }) },
    );
    expect(result).toMatchObject({
      uid: 'financeprof',
      status: 'active',
      user: { puid: 'PUID-PROF-0001', displayName: 'Fin Professor' },
    });
  });

  it('revokes idempotently and clears any linked User flag', async () => {
    findGrantAndDelete.mockResolvedValue(grantDoc({ appliedToPuid: 'PUID-PROF-0001' }));
    updateUsers.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    insertAudit.mockResolvedValue({ acknowledged: true });

    const result = await revokePlatformInstructor('FINANCEPROF', 'PUID-ADMIN-0001');

    expect(findGrantAndDelete).toHaveBeenCalledWith({ uid: 'financeprof' });
    expect(updateUsers).toHaveBeenCalledWith(
      { uid: /^financeprof$/i },
      { $unset: { platformInstructor: '' } },
    );
    expect(result).toEqual({ uid: 'financeprof', granted: false, revoked: true });
    expect(insertAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'role.revoke',
      targetId: grantId,
    }));
  });

  it('lists active and pending grants without exposing raw SAML data', async () => {
    const activeGrant = grantDoc({ appliedToPuid: 'PUID-PROF-0001' });
    const pendingGrant = grantDoc({ _id: new ObjectId(), uid: 'newprof' });
    findGrants.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([activeGrant, pendingGrant]),
        }),
      }),
    });
    findUsers.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{
        puid: 'PUID-PROF-0001',
        uid: 'financeprof',
        displayName: 'Fin Professor',
        email: 'fin.prof@example.ubc.ca',
        lastLoginAt: new Date('2026-07-27T20:00:00Z'),
      }]),
    });

    const result = await listPlatformInstructors('prof');

    expect(findGrants).toHaveBeenCalledWith({ uid: { $regex: 'prof', $options: 'i' } });
    expect(result).toEqual([
      expect.objectContaining({ uid: 'financeprof', status: 'active' }),
      expect.objectContaining({ uid: 'newprof', status: 'pending' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('attributes');
  });
});
