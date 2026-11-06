jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(), questionVersionsCol: jest.fn(), questionEmbeddingsCol: jest.fn(),
}));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/config/env', () => ({ env: { embeddingsModel: 'test-embed' } }));

import { ObjectId } from 'mongodb';
import { questionsCol, questionVersionsCol, questionEmbeddingsCol } from '../../server/src/components/mongodb/collections';
import { embedOne } from '../../server/src/components/genai/embeddings';
import {
  cosine, nearest, similarityText, refreshQuestionSimilarity,
} from '../../server/src/services/question-similarity.service';

const lo1 = new ObjectId(); const lo2 = new ObjectId(); const t1 = new ObjectId(); const t2 = new ObjectId();

describe('cosine', () => {
  it('is 1 for identical direction, 0 for orthogonal, 0 for a zero vector', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('similarityText', () => {
  it('joins the stem with the correct option text', () => {
    expect(similarityText({ stem: 'Q?', options: [{ text: 'no', role: 'clearly-wrong' }, { text: 'yes', role: 'correct' }] })).toBe('Q?\nyes');
  });
});

describe('nearest', () => {
  const target = { questionId: new ObjectId(), loIds: [lo1], themeIds: [t1], vector: [1, 0] };
  it('finds the closest in the same LO and the closest in the same topic separately', () => {
    const sameLo = { questionId: new ObjectId(), loIds: [lo1], themeIds: [t2], vector: [0.9, 0.1] };
    const sameTopic = { questionId: new ObjectId(), loIds: [lo2], themeIds: [t1], vector: [1, 0.01] };
    const unrelated = { questionId: new ObjectId(), loIds: [lo2], themeIds: [t2], vector: [1, 0] };
    const result = nearest(target, [sameLo, sameTopic, unrelated]);
    expect(result.lo?.questionId).toEqual(sameLo.questionId);
    expect(result.topic?.questionId).toEqual(sameTopic.questionId);
  });
  it('excludes the target itself and returns null for empty scopes', () => {
    expect(nearest(target, [{ ...target }])).toEqual({ lo: null, topic: null });
  });
  it('rounds scores to two decimals', () => {
    const other = { questionId: new ObjectId(), loIds: [lo1], themeIds: [t1], vector: [0.8, 0.6] };
    expect(nearest(target, [other]).lo?.score).toBe(0.8);
  });
});

describe('refreshQuestionSimilarity', () => {
  it('never throws when the embeddings model fails', async () => {
    const qid = new ObjectId(); const vid = new ObjectId(); const courseId = new ObjectId();
    jest.mocked(questionsCol).mockReturnValue({ findOne: async () => ({ _id: qid, courseId, currentVersionId: vid, loIds: [lo1], themeIds: [t1], state: 'draft' }) } as never);
    jest.mocked(questionVersionsCol).mockReturnValue({ findOne: async () => ({ _id: vid, stem: 'Q', options: [{ text: 'a', role: 'correct' }] }) } as never);
    jest.mocked(questionEmbeddingsCol).mockReturnValue({ findOne: async () => null } as never);
    jest.mocked(embedOne).mockRejectedValue(new Error('model missing'));
    await expect(refreshQuestionSimilarity(qid)).resolves.toBeUndefined();
  });

  it('stores the target nearest and raises a neighbour whose stored score was lower', async () => {
    const courseId = new ObjectId(); const qid = new ObjectId(); const vid = new ObjectId(); const other = new ObjectId();
    const updates: Array<{ filter: unknown; update: { $set: { similarity: { lo: unknown } } } }> = [];
    jest.mocked(questionsCol).mockReturnValue({
      findOne: async () => ({ _id: qid, courseId, currentVersionId: vid, loIds: [lo1], themeIds: [t1], state: 'draft' }),
      find: () => ({ toArray: async () => [
        { _id: other, loIds: [lo1], themeIds: [t1], similarity: { lo: { questionId: new ObjectId(), score: 0.1 }, topic: null, model: 'test-embed', computedAt: new Date() } },
      ] }),
      updateOne: jest.fn(async (filter: unknown, update: never) => { updates.push({ filter, update }); return { matchedCount: 1 }; }),
    } as never);
    jest.mocked(questionVersionsCol).mockReturnValue({ findOne: async () => ({ _id: vid, stem: 'Q', options: [{ text: 'a', role: 'correct' }] }) } as never);
    jest.mocked(questionEmbeddingsCol).mockReturnValue({
      findOne: async () => null,
      updateOne: async () => ({}),
      find: () => ({ toArray: async () => [{ _id: other, vector: [1, 0], model: 'test-embed' }] }),
    } as never);
    jest.mocked(embedOne).mockResolvedValue([1, 0]);
    await refreshQuestionSimilarity(qid);
    const own = updates.find(u => (u.filter as { _id: ObjectId })._id.equals(qid));
    const theirs = updates.find(u => (u.filter as { _id: ObjectId })._id.equals(other));
    expect((own!.update.$set.similarity.lo as { score: number }).score).toBe(1);
    expect((theirs!.update.$set.similarity.lo as { questionId: ObjectId }).questionId).toEqual(qid);
  });
  it('recomputes a neighbour whose stored nearest was this question once it moved away', async () => {
    const courseId = new ObjectId(); const qid = new ObjectId(); const vid = new ObjectId(); const other = new ObjectId(); const third = new ObjectId();
    const updates: Array<{ filter: { _id: ObjectId }; update: { $set: { similarity: { lo: { questionId: ObjectId; score: number } | null } } } }> = [];
    jest.mocked(questionsCol).mockReturnValue({
      findOne: async () => ({ _id: qid, courseId, currentVersionId: vid, loIds: [lo1], themeIds: [t1], state: 'draft' }),
      find: () => ({ toArray: async () => [
        { _id: qid, loIds: [lo1], themeIds: [t1] },
        { _id: other, loIds: [lo1], themeIds: [t1], similarity: { lo: { questionId: qid, score: 0.95 }, topic: { questionId: qid, score: 0.95 }, model: 'test-embed', computedAt: new Date() } },
        { _id: third, loIds: [lo1], themeIds: [t1] },
      ] }),
      updateOne: jest.fn(async (filter: never, update: never) => { updates.push({ filter, update }); return { matchedCount: 1 }; }),
    } as never);
    jest.mocked(questionVersionsCol).mockReturnValue({ findOne: async () => ({ _id: vid, stem: 'Q', options: [{ text: 'a', role: 'correct' }] }) } as never);
    jest.mocked(questionEmbeddingsCol).mockReturnValue({
      findOne: async () => null,
      updateOne: async () => ({}),
      find: () => ({ toArray: async () => [
        { _id: qid, vector: [1, 0], model: 'test-embed' }, // stale vector, must be replaced by the new one
        { _id: other, vector: [1, 0], model: 'test-embed' },
        { _id: third, vector: [0.6, 0.8], model: 'test-embed' },
      ] }),
    } as never);
    jest.mocked(embedOne).mockResolvedValue([0, 1]); // edited question moved away from `other`
    await refreshQuestionSimilarity(qid);
    const theirs = updates.find(u => u.filter._id.equals(other));
    expect(theirs!.update.$set.similarity.lo!.questionId).toEqual(third);
    expect(theirs!.update.$set.similarity.lo!.score).toBe(0.6);
  });
});
