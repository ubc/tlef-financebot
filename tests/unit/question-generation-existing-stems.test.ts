jest.mock('../../server/src/components/mongodb/collections', () => ({ questionsCol: jest.fn(), questionVersionsCol: jest.fn() }));

import { ObjectId } from 'mongodb';
import { questionsCol, questionVersionsCol } from '../../server/src/components/mongodb/collections';
import { ACTIVE_QUESTION_STATES, loadExistingLoStems, MAX_EXISTING_STEMS } from '../../server/src/services/question-generation/existing-stems';

describe('loadExistingLoStems', () => {
  const courseId = new ObjectId(); const loId = new ObjectId(); const exclude = new ObjectId();
  const v1 = new ObjectId(); const v2 = new ObjectId();
  let headQuery: Record<string, unknown> | undefined; let limit: number | undefined;

  beforeEach(() => {
    jest.mocked(questionsCol).mockReturnValue({ find: jest.fn((q: Record<string, unknown>) => { headQuery = q; return {
      sort: () => ({ limit: (n: number) => { limit = n; return { toArray: async () => [{ currentVersionId: v1 }, { currentVersionId: v2 }] }; } }),
    }; }) } as never);
    jest.mocked(questionVersionsCol).mockReturnValue({ find: jest.fn(() => ({ toArray: async () => [{ _id: v2, stem: 'Second' }, { _id: v1, stem: 'First' }] })) } as never);
  });

  it('queries same-LO active questions excluding one, newest first, capped', async () => {
    const stems = await loadExistingLoStems({ courseId, loIds: [loId], excludeQuestionId: exclude });
    expect(headQuery).toMatchObject({ courseId, loIds: { $in: [loId] }, state: { $in: [...ACTIVE_QUESTION_STATES] }, _id: { $ne: exclude } });
    expect(limit).toBe(MAX_EXISTING_STEMS);
    expect(stems).toEqual(['First', 'Second']);
  });

  it('returns [] instead of throwing when the database read fails', async () => {
    jest.mocked(questionsCol).mockReturnValue({ find: () => { throw new Error('down'); } } as never);
    await expect(loadExistingLoStems({ courseId, loIds: [loId] })).resolves.toEqual([]);
  });
});
