import { ObjectId } from 'mongodb';
import { activateCwlAssignments } from '../../server/src/services/cwl-assignments.service';
import type { User } from '../../server/src/types/domain';

const mockPlatformAdmin = { findOne: jest.fn(), updateOne: jest.fn(), deleteOne: jest.fn() };
const mockPlatformInstructor = { findOne: jest.fn(), updateOne: jest.fn(), deleteOne: jest.fn() };
const mockCourses = { find: jest.fn(), updateOne: jest.fn() };
const mockUsers = { find: jest.fn() };
jest.mock('../../server/src/components/mongodb/collections', () => ({
  platformAdminGrantsCol: () => mockPlatformAdmin,
  platformInstructorGrantsCol: () => mockPlatformInstructor,
  coursePeopleAccessCol: () => mockCourses,
  usersCol: () => mockUsers,
}));

const user = { puid: 'EXACT-PUID', uid: 'stale' } as User;
const key = 'cwl:new.cwl';
const grant = { _id: new ObjectId(), puid: key };
const invitation = { _id: new ObjectId(), courseId: new ObjectId(), revision: 2 };
const identityResults = jest.fn();
const invitationResults = jest.fn();

beforeEach(() => {
  mockPlatformAdmin.findOne.mockReset().mockResolvedValue(grant);
  mockPlatformInstructor.findOne.mockReset().mockResolvedValue(grant);
  mockPlatformAdmin.updateOne.mockReset().mockResolvedValue({});
  mockPlatformInstructor.updateOne.mockReset().mockResolvedValue({});
  mockCourses.updateOne.mockReset().mockResolvedValue({});
  identityResults.mockReset().mockResolvedValue([user]);
  invitationResults.mockReset().mockResolvedValue([invitation]);
  mockUsers.find.mockReturnValue({ limit: () => ({ toArray: identityResults }) });
  mockCourses.find.mockReturnValue({ toArray: invitationResults });
});

it('binds all matching scopes to the asserted PUID and retains their existing role records', async () => {
  await activateCwlAssignments(user, ' New.CWL ');
  expect(mockPlatformAdmin.findOne).toHaveBeenCalledWith({ puid: key });
  expect(mockUsers.find).toHaveBeenCalledWith({ uid: { $regex: '^New\\.CWL$', $options: 'i' } });
  for (const collection of [mockPlatformAdmin, mockPlatformInstructor]) {
    expect(collection.updateOne).toHaveBeenCalledWith({ _id: grant._id, puid: key },
      { $set: { puid: user.puid, updatedAt: expect.any(Date) } });
  }
  expect(mockCourses.updateOne).toHaveBeenCalledWith(
    { _id: invitation._id, subject: key, status: 'pending', revision: 2 },
    { $set: { subject: `puid:${user.puid}`, puid: user.puid, status: 'active', updatedAt: expect.any(Date) }, $inc: { revision: 1 } },
  );
});

it('leaves grants pending for missing assertions, banned users, or conflicting identities', async () => {
  await activateCwlAssignments(user, '');
  await activateCwlAssignments({ ...user, deactivatedAt: new Date() }, 'New.CWL');
  expect(mockPlatformAdmin.findOne).not.toHaveBeenCalled();
  identityResults.mockResolvedValue([user, { puid: 'OTHER-PUID' }]);
  await activateCwlAssignments(user, 'New.CWL');
  expect(mockPlatformAdmin.updateOne).not.toHaveBeenCalled();
  expect(mockPlatformInstructor.updateOne).not.toHaveBeenCalled();
  expect(mockCourses.updateOne).not.toHaveBeenCalled();
});

it('does not overwrite an existing course decision or retain a redundant platform assignment', async () => {
  const duplicate = Object.assign(new Error('Duplicate key'), { code: 11000 });
  mockPlatformInstructor.updateOne.mockRejectedValueOnce(duplicate);
  mockCourses.updateOne.mockRejectedValueOnce(duplicate);
  await activateCwlAssignments(user, 'New.CWL');
  expect(mockPlatformInstructor.deleteOne).toHaveBeenCalledWith({ _id: grant._id, puid: key });
  expect(mockCourses.updateOne).toHaveBeenLastCalledWith(
    { _id: invitation._id, subject: key, status: 'pending', revision: 2 },
    { $set: { status: 'revoked', updatedAt: expect.any(Date) }, $inc: { revision: 1 } },
  );
});
