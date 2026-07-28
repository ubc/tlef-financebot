import { upsertUserFromSaml } from '../../server/src/services/users.service';
import {
  platformInstructorGrantsCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  platformInstructorGrantsCol: jest.fn(),
  usersCol: jest.fn(),
}));
jest.mock('../../server/src/config/env', () => ({
  env: { adminCwlAllowlist: ['PUID-ADMIN-0001'] },
  isProduction: false,
}));

const findOneAndUpdate = jest.fn();
const findGrant = jest.fn();
const updateGrant = jest.fn();
beforeEach(() => {
  findOneAndUpdate.mockReset();
  findGrant.mockReset();
  updateGrant.mockReset();
  findGrant.mockResolvedValue(null);
  jest.mocked(usersCol).mockReturnValue({ findOneAndUpdate } as never);
  jest.mocked(platformInstructorGrantsCol).mockReturnValue({
    findOne: findGrant,
    updateOne: updateGrant,
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

  it('applies a pending platform-Instructor grant to the real PUID on first login', async () => {
    const grantId = 'grant-id';
    findGrant.mockResolvedValue({ _id: grantId, uid: 'financeprof' });
    findOneAndUpdate.mockResolvedValue({ puid: 'PUID-PROF-0001' });

    await upsertUserFromSaml(samlAttrs({
      ubcEduCwlPuid: 'PUID-PROF-0001',
      uid: 'FinanceProf',
      eduPersonAffiliation: ['faculty'],
    }));

    expect(findGrant).toHaveBeenCalledWith({ uid: 'financeprof' });
    expect(findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      uid: 'FinanceProf',
      platformInstructor: true,
    });
    expect(updateGrant).toHaveBeenCalledWith(
      { _id: grantId },
      { $set: expect.objectContaining({ appliedToPuid: 'PUID-PROF-0001' }) },
    );
  });

  it('does not overwrite an existing platform-Instructor value when no grant is pending', async () => {
    findOneAndUpdate.mockResolvedValue({ puid: 'PUID-PROF-0001', platformInstructor: true });

    await upsertUserFromSaml(samlAttrs({
      ubcEduCwlPuid: 'PUID-PROF-0001',
      uid: 'financeprof',
    }));

    expect(findOneAndUpdate.mock.calls[0][1].$set).not.toHaveProperty('platformInstructor');
  });

  it('rejects a profile with no PUID (no partial session, ST-E01)', async () => {
    await expect(upsertUserFromSaml(samlAttrs({ ubcEduCwlPuid: undefined }))).rejects.toThrow(/PUID/);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });
});
