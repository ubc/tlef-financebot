import {
  findUserByPuid,
  isPlatformAdminPuid,
  STAGING_BOOTSTRAP_ADMIN_PUID,
  upsertUserFromSaml,
} from '../../server/src/services/users.service';
import {
  platformInstructorGrantsCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  platformInstructorGrantsCol: jest.fn(),
  usersCol: jest.fn(),
}));
jest.mock('../../server/src/config/env', () => ({
  env: {
    adminCwlAllowlist: ['PUID-ADMIN-0001'],
    samlEnvironment: 'STAGING',
  },
  isProduction: false,
}));

const findOneAndUpdate = jest.fn();
const findUser = jest.fn();
const findGrant = jest.fn();
beforeEach(() => {
  findOneAndUpdate.mockReset();
  findUser.mockReset();
  findGrant.mockReset();
  findGrant.mockResolvedValue(null);
  jest.mocked(usersCol).mockReturnValue({
    findOne: findUser,
    findOneAndUpdate,
  } as never);
  jest.mocked(platformInstructorGrantsCol).mockReturnValue({
    findOne: findGrant,
  } as never);
});

const samlAttrs = (over: Record<string, unknown> = {}) => ({
  ubcEduCwlPuid: 'PUID-STUDENT-0001',
  uid: 'student1',
  mail: 'student1@example.ubc.ca',
  givenName: 'Sam',
  sn: 'Student',
  eduPersonAffiliation: ['student'],
  ...over,
});

describe('upsertUserFromSaml (ST-E01: PUID -> identity mapping)', () => {
  it('upserts keyed on PUID, setting identity fields and setOnInsert defaults', async () => {
    findOneAndUpdate.mockResolvedValue({ puid: 'PUID-STUDENT-0001' });
    await upsertUserFromSaml(samlAttrs());
    const [filter, update, options] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ puid: 'PUID-STUDENT-0001' });
    expect(update.$set).toMatchObject({
      uid: 'student1',
      email: 'student1@example.ubc.ca',
      displayName: 'Sam Student',
      affiliations: ['student'],
      isAdmin: false,
      platformInstructor: false,
    });
    expect(update.$set.lastLoginAt).toBeInstanceOf(Date);
    expect(update.$setOnInsert).toMatchObject({ courseRoles: [] });
    expect(options).toMatchObject({ upsert: true, returnDocument: 'after' });
  });

  it('grants isAdmin from the allowlist', async () => {
    findOneAndUpdate.mockResolvedValue({});
    await upsertUserFromSaml(samlAttrs({ ubcEduCwlPuid: 'PUID-ADMIN-0001' }));
    expect(findOneAndUpdate.mock.calls[0][1].$set.isAdmin).toBe(true);
  });

  it('hard-codes Stephen as an Admin in STAGING only', async () => {
    findOneAndUpdate.mockResolvedValue({});
    await upsertUserFromSaml(samlAttrs({ ubcEduCwlPuid: STAGING_BOOTSTRAP_ADMIN_PUID }));
    expect(findOneAndUpdate.mock.calls[0][1].$set.isAdmin).toBe(true);
    expect(isPlatformAdminPuid(STAGING_BOOTSTRAP_ADMIN_PUID, 'PRODUCTION')).toBe(false);
  });

  it('applies a PUID Instructor grant when the real IdP releases an empty uid', async () => {
    findGrant.mockResolvedValue({ _id: 'grant-id', puid: 'ESIPROF00001' });
    findOneAndUpdate.mockResolvedValue({ puid: 'PUID-PROF-0001' });

    await upsertUserFromSaml(samlAttrs({
      ubcEduCwlPuid: 'ESIPROF00001',
      uid: '',
      givenName: '',
      sn: '',
      displayName: 'Finance Professor',
      eduPersonAffiliation: ['faculty'],
    }));

    expect(findGrant).toHaveBeenCalledWith({ puid: 'ESIPROF00001' });
    expect(findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      uid: '',
      displayName: 'Finance Professor',
      platformInstructor: true,
    });
  });

  it('clears a stale denormalized Instructor bit when no PUID grant exists', async () => {
    findOneAndUpdate.mockResolvedValue({ puid: 'PUID-PROF-0001', platformInstructor: true });

    await upsertUserFromSaml(samlAttrs({
      ubcEduCwlPuid: 'PUID-PROF-0001',
      uid: 'financeprof',
    }));

    expect(findOneAndUpdate.mock.calls[0][1].$set.platformInstructor).toBe(false);
  });

  it('uses cwlLoginName and the tlef-create display-name fallback chain when released', async () => {
    findOneAndUpdate.mockResolvedValue({ puid: 'PUID-PROF-0001' });

    await upsertUserFromSaml(samlAttrs({
      uid: '',
      cwlLoginName: 'financeprof',
      givenName: '',
      sn: '',
      displayName: '',
      cn: 'Finance Professor',
    }));

    expect(findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      uid: 'financeprof',
      displayName: 'Finance Professor',
    });
  });

  it('rejects a profile with no PUID (no partial session, ST-E01)', async () => {
    await expect(upsertUserFromSaml(samlAttrs({ ubcEduCwlPuid: undefined }))).rejects.toThrow(/PUID/);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('findUserByPuid platform authorization refresh', () => {
  const storedUser = {
    puid: 'PUID-PROF-0001',
    uid: '',
    displayName: 'Fin Professor',
    email: 'fin.prof@example.ubc.ca',
    affiliations: ['faculty'],
    isAdmin: false,
    platformInstructor: true,
    courseRoles: [],
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };

  it('treats the grant collection as truth after a revoke, even if the User bit is stale', async () => {
    findUser.mockResolvedValue(storedUser);
    findGrant.mockResolvedValue(null);

    await expect(findUserByPuid('PUID-PROF-0001')).resolves.toMatchObject({
      puid: 'PUID-PROF-0001',
      platformInstructor: false,
    });
  });

  it('restores the capability from an active PUID grant even with an empty uid', async () => {
    findUser.mockResolvedValue({ ...storedUser, platformInstructor: undefined });
    findGrant.mockResolvedValue({ puid: 'PUID-PROF-0001' });

    await expect(findUserByPuid('PUID-PROF-0001')).resolves.toMatchObject({
      puid: 'PUID-PROF-0001',
      platformInstructor: true,
    });
    expect(findGrant).toHaveBeenCalledWith({ puid: 'PUID-PROF-0001' });
  });

  it('returns falsey identity for a deactivated user before refreshing grants', async () => {
    findUser.mockResolvedValue({ ...storedUser, deactivatedAt: new Date() });

    await expect(findUserByPuid('PUID-PROF-0001')).resolves.toBeNull();
    expect(findGrant).not.toHaveBeenCalled();
  });
});
