jest.mock('../../server/src/components/mongodb', () => ({ getDb: jest.fn(), getMongoClient: jest.fn() }));
import { ObjectId } from 'mongodb';
import { getDb, getMongoClient } from '../../server/src/components/mongodb';
import { authoringCollection, authoringCommitAvailable, currentAuthoringSession, initializeAuthoringCommitSupport, withCourseAuthoringWrite, withCourseAuthoringFirstWrite } from '../../server/src/services/authoring-commit.service';
const courseId = new ObjectId();
let hello: jest.Mock; let courseWrite: jest.Mock; let session: { withTransaction: jest.Mock; endSession: jest.Mock };
beforeEach(() => {
  jest.clearAllMocks(); hello = jest.fn(async () => ({ setName: 'fixture-rs' })); courseWrite = jest.fn(async () => ({ matchedCount: 1 }));
  session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn(async () => undefined) };
  jest.mocked(getDb).mockReturnValue({ admin: () => ({ command: hello }), collection: () => ({ updateOne: courseWrite }) } as never);
  jest.mocked(getMongoClient).mockReturnValue({ startSession: () => session } as never);
});
describe('atomic course authoring fence', () => {
  it('audits transaction topology and refuses required commits on standalone Mongo', async () => {
    hello.mockResolvedValue({ ok: 1 }); expect(await initializeAuthoringCommitSupport()).toEqual({ available: false, topology: 'standalone' });
    const work = jest.fn(async () => undefined);
    await expect(withCourseAuthoringWrite(courseId, work, { required: true })).rejects.toThrow('authoring-coordinated-commit-unavailable'); expect(work).not.toHaveBeenCalled(); expect(authoringCommitAvailable()).toBe(false);
    await withCourseAuthoringWrite(courseId, work); expect(work).toHaveBeenCalledWith(undefined);
  });
  it('binds the course increment and every participating collection write to one transaction', async () => {
    await initializeAuthoringCommitSupport(); const insert = jest.fn(async () => ({ insertedId: new ObjectId() }));
    await withCourseAuthoringWrite(courseId, async active => {
      expect(active).toBe(session); expect(currentAuthoringSession()).toBe(session);
      await authoringCollection({ insertOne: insert } as never).insertOne({} as never);
    }, { required: true });
    expect(courseWrite).toHaveBeenCalledWith(expect.objectContaining({ _id: courseId, authoringDeletionStartedAt: { $exists: false } }), { $inc: { authoringRevision: 1 } }, { session }); expect(insert).toHaveBeenCalledWith({}, { session });
    expect(session.withTransaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } })); expect(currentAuthoringSession()).toBeUndefined(); expect(session.endSession).toHaveBeenCalledTimes(1);
  });
  it('nested same-course writes reuse the transaction and refuse cross-course mutation', async () => {
    await initializeAuthoringCommitSupport(); await withCourseAuthoringWrite(courseId, async () => {
      await withCourseAuthoringWrite(courseId, async active => { expect(active).toBe(session); });
      await expect(withCourseAuthoringWrite(new ObjectId(), async () => undefined)).rejects.toThrow('authoring-cross-course-transaction');
    }); expect(courseWrite).toHaveBeenCalledTimes(1);
  });
  it('course deletion refuses persistence and closes the session after an error', async () => {
    await initializeAuthoringCommitSupport(); courseWrite.mockResolvedValue({ matchedCount: 0 }); const work = jest.fn(async () => undefined);
    await expect(withCourseAuthoringWrite(courseId, work, { required: true })).rejects.toThrow('course-not-found'); expect(work).not.toHaveBeenCalled(); expect(session.endSession).toHaveBeenCalledTimes(1);
  });
  it('first writes use the transaction and cannot recreate metadata after deletion', async () => {
    await initializeAuthoringCommitSupport(); courseWrite.mockResolvedValue({ matchedCount: 0 }); const work = jest.fn(async () => undefined);
    await expect(withCourseAuthoringFirstWrite(courseId, work, jest.fn())).rejects.toThrow('course-not-found'); expect(work).not.toHaveBeenCalled();
  });
  it('standalone diagnostic first writes clean up a deletion observed after insertion', async () => {
    hello.mockResolvedValue({ ok: 1 }); await initializeAuthoringCommitSupport();
    const read = jest.fn().mockResolvedValueOnce({ _id: courseId }).mockResolvedValueOnce(null);
    jest.mocked(getDb).mockReturnValue({ collection: () => ({ findOne: read }) } as never);
    const work = jest.fn(async () => 'inserted'); const cleanup = jest.fn(async () => undefined);
    await expect(withCourseAuthoringFirstWrite(courseId, work, cleanup)).rejects.toThrow('course-not-found'); expect(work).toHaveBeenCalledTimes(1); expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
