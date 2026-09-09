jest.mock('../../server/src/components/mongodb/collections', () => ({
  tutorialProgressCol: jest.fn(),
}));

import { tutorialProgressCol } from '../../server/src/components/mongodb/collections';
import {
  TUTORIAL_CATALOG,
  listTutorials,
  resetTutorialProgress,
  saveTutorialProgress,
} from '../../server/src/services/tutorials.service';

const find = jest.fn();
const updateOne = jest.fn();
const deleteMany = jest.fn();

beforeEach(() => {
  find.mockReset();
  updateOne.mockReset();
  deleteMany.mockReset();
  jest.mocked(tutorialProgressCol).mockReturnValue({ find, updateOne, deleteMany } as never);
});

describe('tutorial service', () => {
  it('keeps every Student micro-tutorial at 20 seconds or less', () => {
    expect(TUTORIAL_CATALOG.filter((item) => item.role === 'student')).toHaveLength(9);
    expect(TUTORIAL_CATALOG.filter((item) => String(item.role) === 'admin')).toHaveLength(4);
    expect(TUTORIAL_CATALOG.filter((item) => item.role === 'instructor')).toHaveLength(9);
    expect(TUTORIAL_CATALOG.filter((item) => item.role === 'ta')).toHaveLength(3);
    expect(new Set(TUTORIAL_CATALOG.map((item) => item.id)).size).toBe(TUTORIAL_CATALOG.length);
    expect(TUTORIAL_CATALOG.every((item) => item.estimatedSeconds <= 20)).toBe(true);
  });

  it('treats missing and older-version progress as not viewed', async () => {
    find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          puid: 'p1',
          role: 'student',
          tutorialId: 'student-welcome',
          version: 1,
          status: 'completed',
          updatedAt: new Date('2026-09-01T00:00:00Z'),
        },
        {
          puid: 'p1',
          role: 'student',
          tutorialId: 'student-practice',
          version: 0,
          status: 'completed',
          updatedAt: new Date('2026-09-01T00:00:00Z'),
        },
      ]),
    });

    const states = await listTutorials('p1', 'student');
    expect(states.find((item) => item.id === 'student-welcome')?.status).toBe('completed');
    expect(states.find((item) => item.id === 'student-practice')?.status).toBe('not-viewed');
    expect(states.find((item) => item.id === 'student-review-book')?.status).toBe('not-viewed');
  });

  it('upserts the current tutorial version and resets only one user role', async () => {
    updateOne.mockResolvedValue({ acknowledged: true });
    deleteMany.mockResolvedValue({ deletedCount: 4 });

    const progress = await saveTutorialProgress('p1', 'student', 'student-welcome', 'dismissed');
    expect(progress).toMatchObject({
      puid: 'p1',
      role: 'student',
      tutorialId: 'student-welcome',
      version: 1,
      status: 'dismissed',
    });
    expect(updateOne).toHaveBeenCalledWith(
      { puid: 'p1', role: 'student', tutorialId: 'student-welcome' },
      { $set: expect.objectContaining({ status: 'dismissed', version: 1 }) },
      { upsert: true },
    );
    await expect(resetTutorialProgress('p1', 'student')).resolves.toBe(4);
    expect(deleteMany).toHaveBeenCalledWith({ puid: 'p1', role: 'student' });
  });

  it('rejects tutorial ids outside the role catalogue', async () => {
    await expect(
      saveTutorialProgress('p1', 'student', 'ta-review', 'completed'),
    ).rejects.toThrow('tutorial-not-found');
    expect(updateOne).not.toHaveBeenCalled();
  });
});
