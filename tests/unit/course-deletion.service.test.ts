import path from 'node:path';
import { ObjectId } from 'mongodb';

jest.mock('node:fs/promises', () => ({ lstat: jest.fn(), rm: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ cancelJobsByDataIds: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ deleteCollectionIfExists: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  attemptsCol: jest.fn(), auditCol: jest.fn(), capabilitySettingsCol: jest.fn(),
  contentRunsCol: jest.fn(), coursesCol: jest.fn(), examAttemptsCol: jest.fn(),
  examTemplatesCol: jest.fn(), flagsCol: jest.fn(), generationBlueprintsCol: jest.fn(),
  losCol: jest.fn(), masteryCol: jest.fn(), materialChunksCol: jest.fn(),
  materialsCol: jest.fn(), notificationsCol: jest.fn(), previewAttemptsCol: jest.fn(),
  previewStudentSessionsCol: jest.fn(), questionVersionsCol: jest.fn(), questionsCol: jest.fn(),
  reviewBookCol: jest.fn(), rosterCol: jest.fn(), sessionSummariesCol: jest.fn(),
  taInvitesCol: jest.fn(), themesCol: jest.fn(), usersCol: jest.fn(),
}));

import { lstat, rm } from 'node:fs/promises';
import { cancelJobsByDataIds } from '../../server/src/components/jobs';
import * as collections from '../../server/src/components/mongodb/collections';
import { deleteCollectionIfExists } from '../../server/src/components/qdrant';
import {
  permanentDeletionConfirmation,
  permanentlyDeleteCourse,
} from '../../server/src/services/course-deletion.service';

type FakeCollection = {
  find: jest.Mock;
  findOne: jest.Mock;
  deleteMany: jest.Mock;
  deleteOne: jest.Mock;
  updateMany: jest.Mock;
};

const accessorNames = [
  'attemptsCol', 'auditCol', 'capabilitySettingsCol', 'contentRunsCol', 'coursesCol',
  'examAttemptsCol', 'examTemplatesCol', 'flagsCol', 'generationBlueprintsCol', 'losCol',
  'masteryCol', 'materialChunksCol', 'materialsCol', 'notificationsCol', 'previewAttemptsCol',
  'previewStudentSessionsCol', 'questionVersionsCol', 'questionsCol', 'reviewBookCol',
  'rosterCol', 'sessionSummariesCol', 'taInvitesCol', 'themesCol', 'usersCol',
] as const;

function fakeCollection(rows: unknown[] = []): FakeCollection {
  return {
    find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(rows) })),
    findOne: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: rows.length || 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
}

describe('permanent course deletion', () => {
  const courseId = new ObjectId('66b3c0100000000000000001');
  const questionId = new ObjectId('66b3c0100000000000000002');
  const flagId = new ObjectId('66b3c0100000000000000003');
  const runId = new ObjectId('66b3c0100000000000000004');
  const examAttemptId = new ObjectId('66b3c0100000000000000005');
  let fakes: Record<(typeof accessorNames)[number], FakeCollection>;

  beforeEach(() => {
    jest.clearAllMocks();
    fakes = Object.fromEntries(accessorNames.map((name) => [name, fakeCollection()])) as typeof fakes;
    for (const name of accessorNames) {
      jest.mocked(collections[name]).mockReturnValue(fakes[name] as never);
    }
    fakes.coursesCol.findOne.mockResolvedValue({
      _id: courseId,
      courseCode: 'COMM 298',
      section: '101',
      ownerPuid: 'PUID-OWNER',
    });
    fakes.materialsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{
      _id: new ObjectId(),
      courseId,
      storagePath: path.resolve(process.cwd(), 'uploads/lecture.pdf'),
    }]) });
    fakes.questionsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{ _id: questionId, courseId }]) });
    fakes.flagsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{ _id: flagId, courseId }]) });
    fakes.contentRunsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{
      _id: runId,
      courseId,
      status: 'completed',
    }]) });
    fakes.examAttemptsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{
      _id: examAttemptId,
      courseId,
      masteryPassQueuedAt: new Date(),
      masteryPassCompletedAt: new Date(),
    }]) });
    jest.mocked(cancelJobsByDataIds).mockResolvedValue(2);
    jest.mocked(deleteCollectionIfExists).mockResolvedValue(true);
    jest.mocked(lstat).mockResolvedValue({ isFile: () => true } as never);
    jest.mocked(rm).mockResolvedValue(undefined);
  });

  it('derives a section-aware destructive confirmation phrase', () => {
    expect(permanentDeletionConfirmation({ courseCode: 'COMM 298', section: '101' }))
      .toBe('DELETE COMM 298 101');
    expect(permanentDeletionConfirmation({ courseCode: 'COMM 298' }))
      .toBe('DELETE COMM 298');
  });

  it('removes external resources, every child collection, user roles, and the course', async () => {
    const result = await permanentlyDeleteCourse(
      courseId,
      { puid: 'PUID-OWNER', isAdmin: false },
      'DELETE COMM 298 101',
    );

    expect(cancelJobsByDataIds).toHaveBeenCalledWith([runId.toHexString()], [examAttemptId.toHexString()]);
    expect(deleteCollectionIfExists).toHaveBeenCalledWith(`course-${courseId.toHexString()}`);
    expect(rm).toHaveBeenCalledWith(path.resolve(process.cwd(), 'uploads/lecture.pdf'), { force: true });
    expect(fakes.questionVersionsCol.deleteMany).toHaveBeenCalledWith({ questionId: { $in: [questionId] } });
    expect(fakes.auditCol.deleteMany).toHaveBeenCalledWith({ $or: expect.arrayContaining([
      { courseId },
      { targetType: 'question', targetId: { $in: [questionId] } },
      { targetType: 'flag', targetId: { $in: [flagId] } },
    ]) });
    for (const name of accessorNames.filter((name) => !['coursesCol', 'usersCol'].includes(name))) {
      expect(fakes[name].deleteMany).toHaveBeenCalledTimes(1);
    }
    expect(fakes.usersCol.updateMany).toHaveBeenCalledWith(
      { courseRoles: { $elemMatch: { courseId } } },
      { $pull: { courseRoles: { courseId } } },
    );
    expect(fakes.coursesCol.deleteOne).toHaveBeenCalledWith({ _id: courseId });
    expect(result).toMatchObject({
      deleted: true,
      courseId: courseId.toHexString(),
      deletedFiles: 1,
      missingFiles: 0,
      deletedVectorCollection: true,
      cancelledJobs: 2,
    });
  });

  it('rejects a co-instructor or mismatched phrase before any mutation', async () => {
    await expect(permanentlyDeleteCourse(
      courseId,
      { puid: 'PUID-COINSTRUCTOR', isAdmin: false },
      'DELETE COMM 298 101',
    )).rejects.toThrow('course-delete-owner-required');
    await expect(permanentlyDeleteCourse(
      courseId,
      { puid: 'PUID-OWNER', isAdmin: false },
      'DELETE COMM 298',
    )).rejects.toThrow('course-delete-confirmation-mismatch');
    expect(deleteCollectionIfExists).not.toHaveBeenCalled();
    expect(fakes.coursesCol.deleteOne).not.toHaveBeenCalled();
  });

  it('refuses deletion while durable background work is active', async () => {
    fakes.contentRunsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{
      _id: runId,
      courseId,
      status: 'running',
    }]) });
    await expect(permanentlyDeleteCourse(
      courseId,
      { puid: 'PUID-OWNER', isAdmin: false },
      'DELETE COMM 298 101',
    )).rejects.toThrow('course-delete-active-work');
    expect(cancelJobsByDataIds).not.toHaveBeenCalled();
    expect(deleteCollectionIfExists).not.toHaveBeenCalled();
  });

  it('rejects an uploaded-file path outside the course upload directory', async () => {
    fakes.materialsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{
      _id: new ObjectId(),
      courseId,
      storagePath: '/private/tmp/not-a-financebot-upload.pdf',
    }]) });
    await expect(permanentlyDeleteCourse(
      courseId,
      { puid: 'PUID-OWNER', isAdmin: true },
      'DELETE COMM 298 101',
    )).rejects.toThrow('course-delete-unsafe-storage-path');
    expect(rm).not.toHaveBeenCalled();
    expect(deleteCollectionIfExists).not.toHaveBeenCalled();
  });

  it('resolves process-relative files from the historical server/uploads directory', async () => {
    fakes.materialsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{
      _id: new ObjectId(),
      courseId,
      storagePath: 'uploads/legacy.pdf',
    }]) });
    const currentPath = path.resolve(process.cwd(), 'uploads/legacy.pdf');
    const legacyPath = path.resolve(process.cwd(), 'server/uploads/legacy.pdf');
    jest.mocked(lstat).mockImplementation(async (candidate) => {
      if (candidate === legacyPath) return { isFile: () => true } as never;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });

    const result = await permanentlyDeleteCourse(
      courseId,
      { puid: 'PUID-OWNER', isAdmin: false },
      'DELETE COMM 298 101',
    );

    expect(lstat).toHaveBeenCalledWith(currentPath);
    expect(lstat).toHaveBeenCalledWith(legacyPath);
    expect(rm).toHaveBeenCalledWith(legacyPath, { force: true });
    expect(result).toMatchObject({ deletedFiles: 1, missingFiles: 0 });
  });

  it('continues when an obsolete legacy file no longer exists anywhere', async () => {
    fakes.materialsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{
      _id: new ObjectId(),
      courseId,
      storagePath: '/old-release/uploads/gone.pdf',
    }]) });
    jest.mocked(lstat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    const result = await permanentlyDeleteCourse(
      courseId,
      { puid: 'PUID-OWNER', isAdmin: false },
      'DELETE COMM 298 101',
    );

    expect(rm).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deletedFiles: 0, missingFiles: 1 });
    expect(fakes.coursesCol.deleteOne).toHaveBeenCalledWith({ _id: courseId });
  });

  it('accepts only UUID-named uploads inside a historical Claude worktree', async () => {
    const historicalPath = path.resolve(
      process.cwd(),
      '.claude/worktrees/codex+phase-2-content-runs/uploads/7bcc05ab-c378-4bcd-8222-ea215fc525e0.md',
    );
    fakes.materialsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{
      _id: new ObjectId(), courseId, storagePath: historicalPath,
    }]) });

    const result = await permanentlyDeleteCourse(
      courseId,
      { puid: 'PUID-OWNER', isAdmin: false },
      'DELETE COMM 298 101',
    );

    expect(rm).toHaveBeenCalledWith(historicalPath, { force: true });
    expect(result).toMatchObject({ deletedFiles: 1, missingFiles: 0 });
  });

  it('does not allow a non-upload file elsewhere in a historical worktree', async () => {
    const sourcePath = path.resolve(
      process.cwd(),
      '.claude/worktrees/codex+phase-2-content-runs/server/src/app.ts',
    );
    fakes.materialsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{
      _id: new ObjectId(), courseId, storagePath: sourcePath,
    }]) });

    await expect(permanentlyDeleteCourse(
      courseId,
      { puid: 'PUID-OWNER', isAdmin: false },
      'DELETE COMM 298 101',
    )).rejects.toThrow('course-delete-unsafe-storage-path');
    expect(rm).not.toHaveBeenCalled();
  });
});
