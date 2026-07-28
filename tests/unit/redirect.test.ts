import { ObjectId } from 'mongodb';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  attemptsCol: jest.fn(),
  materialsCol: jest.fn(),
}));

jest.mock('../../server/src/services/notifications.service', () => ({
  notifyCourseStaff: jest.fn(),
}));

import { attemptsCol, materialsCol } from '../../server/src/components/mongodb/collections';
import { notifyCourseStaff } from '../../server/src/services/notifications.service';
import {
  getRedirectMaterialSource,
  hasRepeatedFailureCluster,
  repeatedFailureRedirect,
} from '../../server/src/services/progression.service';

const courseId = new ObjectId();
const loId = new ObjectId();
const puid = 'PUID-STUDENT-0001';

function chainResult<T>(docs: T[]) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn(async () => docs),
  };
}

function attempt(difficulty: 'easy' | 'medium' | 'hard', correct = false) {
  return { correct, difficulty, createdAt: new Date() };
}

beforeEach(() => {
  jest.mocked(attemptsCol).mockReset();
  jest.mocked(materialsCol).mockReset();
  jest.mocked(notifyCourseStaff).mockReset();
  jest.mocked(notifyCourseStaff).mockResolvedValue(undefined);
});

describe('repeatedFailureRedirect', () => {
  it('fires after 3 consecutive easy/medium misses and links ready LO materials', async () => {
    const materialId = new ObjectId();
    const attemptChain = chainResult([attempt('easy'), attempt('medium'), attempt('easy')]);
    const materialChain = chainResult([
      {
        _id: materialId,
        name: 'Week 2 notes',
        format: 'pdf',
        status: 'ready',
        storagePath: '/tmp/week-2.pdf',
        assignments: [{ themeId: new ObjectId(), loId }],
        uploadedAt: new Date(),
      },
    ]);
    jest.mocked(attemptsCol).mockReturnValue({ find: jest.fn(() => attemptChain) } as never);
    jest.mocked(materialsCol).mockReturnValue({ find: jest.fn(() => materialChain) } as never);

    const result = await repeatedFailureRedirect({
      puid,
      displayName: 'Student One',
      courseId,
      loId,
      threshold: 3,
    });

    expect(result).toEqual({
      materials: [{ name: 'Week 2 notes', materialId: materialId.toHexString() }],
      message: 'A quick review of these course materials may help before you continue.',
    });
    expect(notifyCourseStaff).toHaveBeenCalledWith(
      courseId,
      expect.objectContaining({ kind: 'redirect', refType: 'learning-objective', refId: loId }),
    );
  });

  it('does not fire for the same 3 misses when they are hard-tier (step-back precedence)', async () => {
    const attemptChain = chainResult([attempt('hard'), attempt('hard'), attempt('hard')]);
    jest.mocked(attemptsCol).mockReturnValue({ find: jest.fn(() => attemptChain) } as never);

    const result = await repeatedFailureRedirect({
      puid,
      displayName: 'Student One',
      courseId,
      loId,
      threshold: 3,
    });

    expect(result).toBeUndefined();
    expect(materialsCol).not.toHaveBeenCalled();
    expect(notifyCourseStaff).not.toHaveBeenCalled();
  });

  it('continues returning a redirect after threshold but notifies staff only at the crossing', async () => {
    const attemptChain = chainResult([
      attempt('easy'),
      attempt('medium'),
      attempt('easy'),
      attempt('medium'),
    ]);
    const materialChain = chainResult([]);
    jest.mocked(attemptsCol).mockReturnValue({ find: jest.fn(() => attemptChain) } as never);
    jest.mocked(materialsCol).mockReturnValue({ find: jest.fn(() => materialChain) } as never);

    await expect(
      repeatedFailureRedirect({ puid, displayName: 'Student One', courseId, loId, threshold: 3 }),
    ).resolves.toEqual(expect.objectContaining({ materials: [] }));
    expect(notifyCourseStaff).not.toHaveBeenCalled();
  });

  it('does not let a notification storage failure reject the submitted-attempt flow', async () => {
    const attemptChain = chainResult([attempt('easy'), attempt('easy'), attempt('easy')]);
    const materialChain = chainResult([]);
    jest.mocked(attemptsCol).mockReturnValue({ find: jest.fn(() => attemptChain) } as never);
    jest.mocked(materialsCol).mockReturnValue({ find: jest.fn(() => materialChain) } as never);
    jest.mocked(notifyCourseStaff).mockRejectedValue(new Error('notifications unavailable'));

    await expect(
      repeatedFailureRedirect({ puid, displayName: 'Student One', courseId, loId, threshold: 3 }),
    ).resolves.toEqual(expect.objectContaining({ materials: [] }));
  });
});

describe('redirect helpers and source resolution', () => {
  it('requires a consecutive easy/medium miss cluster', () => {
    expect(hasRepeatedFailureCluster([attempt('easy'), attempt('medium'), attempt('easy')], 3)).toBe(true);
    expect(hasRepeatedFailureCluster([attempt('easy'), attempt('hard'), attempt('easy')], 3)).toBe(false);
    expect(hasRepeatedFailureCluster([attempt('easy'), attempt('medium', true), attempt('easy')], 3)).toBe(false);
  });

  it('resolves URL and uploaded sources, while missing sources stay unavailable', async () => {
    const urlId = new ObjectId();
    const fileId = new ObjectId();
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({
        _id: urlId,
        courseId,
        name: 'External reading',
        format: 'url',
        status: 'ready',
        sourceUrl: 'https://example.com/reading',
        assignments: [{ themeId: new ObjectId(), loId }],
        uploadedAt: new Date(),
      })
      .mockResolvedValueOnce({
        _id: fileId,
        courseId,
        name: 'slides.pdf',
        format: 'pdf',
        status: 'ready',
        storagePath: '/tmp/slides.pdf',
        assignments: [{ themeId: new ObjectId(), loId }],
        uploadedAt: new Date(),
      })
      .mockResolvedValueOnce({
        _id: new ObjectId(),
        courseId,
        name: 'Unsafe link',
        format: 'url',
        status: 'ready',
        sourceUrl: 'javascript:alert(1)',
        assignments: [{ themeId: new ObjectId(), loId }],
        uploadedAt: new Date(),
      })
      .mockResolvedValueOnce(null);
    jest.mocked(materialsCol).mockReturnValue({ findOne } as never);

    await expect(getRedirectMaterialSource(courseId, loId, urlId)).resolves.toEqual({
      kind: 'url',
      url: 'https://example.com/reading',
    });
    await expect(getRedirectMaterialSource(courseId, loId, fileId)).resolves.toEqual({
      kind: 'file',
      path: '/tmp/slides.pdf',
      downloadName: 'slides.pdf',
    });
    await expect(getRedirectMaterialSource(courseId, loId, new ObjectId())).resolves.toBeNull();
    await expect(getRedirectMaterialSource(courseId, loId, new ObjectId())).resolves.toBeNull();
  });
});
