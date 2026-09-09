import { ObjectId } from 'mongodb';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  attemptsCol: jest.fn(),
  flagsCol: jest.fn(),
  losCol: jest.fn(),
  masteryCol: jest.fn(),
  questionVersionsCol: jest.fn(),
  questionsCol: jest.fn(),
  reviewBookCol: jest.fn(),
  themesCol: jest.fn(),
  usersCol: jest.fn(),
}));

import {
  attemptsCol,
  losCol,
  questionVersionsCol,
  questionsCol,
  themesCol,
  reviewBookCol,
} from '../../server/src/components/mongodb/collections';
import {
  answerDistributions,
  clusterSessions,
  csvSerialize,
  failureRates,
  engagement,
  questionPatterns,
} from '../../server/src/services/analytics.service';

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();
const questionId = new ObjectId();
const versionId = new ObjectId();

function cursor<T>(rows: T[]): { sort: jest.Mock; toArray: () => Promise<T[]> } {
  const result = { sort: jest.fn(), toArray: async () => rows };
  result.sort.mockReturnValue(result);
  return result;
}

beforeEach(() => jest.clearAllMocks());

describe('failure rates (IN-A01)', () => {
  it('returns the insufficient-data floor below five attempts', async () => {
    jest.mocked(attemptsCol).mockReturnValue({
      aggregate: jest.fn(() => ({ toArray: async () => [{
        _id: { themeId, loId }, attempts: 4, misses: 4,
      }] })),
    } as never);
    jest.mocked(themesCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: themeId, name: 'Risk', order: 1 }])) } as never);
    jest.mocked(losCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: loId, themeId, name: 'VaR', order: 1 }])) } as never);

    const [result] = await failureRates(courseId, 'topic-practice');

    expect(result).toMatchObject({ attempts: 4, insufficient: true });
    expect(result.failureRate).toBeUndefined();
    expect(result.los[0].failureRate).toBeUndefined();
  });

  it('computes four misses over ten attempts as a 40% failure rate', async () => {
    jest.mocked(attemptsCol).mockReturnValue({
      aggregate: jest.fn(() => ({ toArray: async () => [{
        _id: { themeId, loId }, attempts: 10, misses: 4,
      }] })),
    } as never);
    jest.mocked(themesCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: themeId, name: 'Risk', order: 1 }])) } as never);
    jest.mocked(losCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: loId, themeId, name: 'VaR', order: 1 }])) } as never);

    const [result] = await failureRates(courseId, 'exam-prep');

    expect(result.failureRate).toBe(0.4);
    expect(result.los[0].failureRate).toBe(0.4);
  });
});

describe('answer distribution (IN-A02)', () => {
  it('highlights common-misconception share above 1.5x uniform expectation', async () => {
    jest.mocked(questionsCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: questionId, courseId, currentVersionId: versionId })) } as never);
    jest.mocked(questionVersionsCol).mockReturnValue({ findOne: jest.fn(async () => ({
      _id: versionId,
      options: [
        { key: 'A', role: 'correct' }, { key: 'B', role: 'common-misconception' },
        { key: 'C', role: 'partially-correct' }, { key: 'D', role: 'clearly-wrong' },
      ],
    })) } as never);
    jest.mocked(attemptsCol).mockReturnValue({ aggregate: jest.fn(() => ({ toArray: async () => [
      { _id: { key: 'A', role: 'correct' }, count: 2 },
      { _id: { key: 'B', role: 'common-misconception' }, count: 6 },
      { _id: { key: 'C', role: 'partially-correct' }, count: 1 },
      { _id: { key: 'D', role: 'clearly-wrong' }, count: 1 },
    ] })) } as never);

    const result = await answerDistributions(courseId, questionId);

    expect(result.misconceptionHighlight).toBe(true);
    expect(result.options.find((option) => option.key === 'B')?.pct).toBe(0.6);
  });
});

describe('engagement helpers (IN-A03)', () => {
  it('clusters two attempts 40 minutes apart into two sessions', () => {
    const start = new Date('2026-08-01T10:00:00Z');
    expect(clusterSessions([
      { puid: 'student', createdAt: start },
      { puid: 'student', createdAt: new Date(start.getTime() + 40 * 60_000) },
    ])).toHaveLength(2);
  });

  it('CSV serializer escapes commas and quotes', () => {
    expect(csvSerialize([{ name: 'Doe, "Jane"', attempts: 10 }])).toBe(
      'name,attempts\r\n"Doe, ""Jane""",10',
    );
  });
});

it('includes active objectives without attempts and excludes archived objectives', async () => {
  const emptyId = new ObjectId();
  jest.mocked(attemptsCol).mockReturnValue({ aggregate: jest.fn(() => cursor([])) } as never);
  jest.mocked(themesCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: themeId, name: 'Risk' }])) } as never);
  const find = jest.fn(() => cursor([{ _id: loId, themeId, name: 'VaR' }, { _id: emptyId, themeId, name: 'Duration' }]));
  jest.mocked(losCol).mockReturnValue({ find } as never);
  const [result] = await failureRates(courseId, 'topic-practice');
  expect(result.los).toHaveLength(2);
  expect(result.los[1]).toMatchObject({ attempts: 0, insufficient: true });
  expect(find).toHaveBeenCalledWith({ courseId, archivedAt: { $exists: false } });
});

it('isolates the default distribution to the current recorded version', async () => {
  jest.mocked(questionsCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: questionId, currentVersionId: versionId })) } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: versionId, questionId, options: [] })) } as never);
  const aggregate = jest.fn(() => cursor([]));
  jest.mocked(attemptsCol).mockReturnValue({ aggregate } as never);
  await answerDistributions(courseId, questionId);
  expect(aggregate).toHaveBeenCalledWith(expect.arrayContaining([{ $match: expect.objectContaining({ courseId, questionId, questionVersionId: versionId }) }]));
});

it('filters recorded version, LO, exact dates and mode without falling back to the current version', async () => {
  const historicalId = new ObjectId(); const from = new Date('2026-08-01'); const to = new Date('2026-08-28');
  jest.mocked(questionsCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: questionId, currentVersionId: versionId })) } as never);
  const findOne = jest.fn(async () => ({ _id: historicalId, questionId, version: 1, stem: 'Historic', options: [{ key: 'A', text: 'old answer', role: 'correct' }] }));
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne } as never);
  const aggregate = jest.fn(() => cursor([{ _id: { key: 'A', role: 'correct' }, count: 4 }]));
  jest.mocked(attemptsCol).mockReturnValue({ aggregate } as never);
  const result = await answerDistributions(courseId, questionId, { versionId: historicalId, mode: 'exam-prep', loId, from, to });
  expect(findOne).toHaveBeenCalledWith({ _id: historicalId, questionId });
  expect(aggregate).toHaveBeenCalledWith(expect.arrayContaining([{ $match: { courseId, questionId, questionVersionId: historicalId, mode: 'exam-prep', loId, createdAt: { $gte: from, $lte: to } } }]));
  expect(result).toMatchObject({ versionId: historicalId.toHexString(), isCurrent: false, attempts: 4, insufficient: true });
  expect(result.options[0].pct).toBeUndefined();
});
it('rejects foreign questions and foreign versions before reading answers', async () => {
  const aggregate = jest.fn(); jest.mocked(attemptsCol).mockReturnValue({ aggregate } as never);
  const findOne = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: questionId, currentVersionId: versionId });
  jest.mocked(questionsCol).mockReturnValue({ findOne } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne: jest.fn(async () => null) } as never);
  await expect(answerDistributions(courseId, questionId)).rejects.toThrow('question-not-found');
  await expect(answerDistributions(courseId, questionId, { versionId })).rejects.toThrow('question-version-not-found');
  expect(findOne).toHaveBeenCalledWith({ _id: questionId, courseId }); expect(aggregate).not.toHaveBeenCalled();
});
it('bounds pattern metadata and suppresses rates below five for each recorded version', async () => {
  const historic = new ObjectId();
  const aggregate = jest.fn(() => cursor([{ items: [
    { _id: { questionId, versionId }, loId, themeId, objectiveIds: [loId, new ObjectId()], attempts: 6, misses: 3, misconceptions: 2 },
    { _id: { questionId, versionId: historic }, loId, themeId, attempts: 4, misses: 4, misconceptions: 4 },
  ], count: [{ total: 23 }] }]));
  jest.mocked(attemptsCol).mockReturnValue({ aggregate } as never);
  jest.mocked(questionsCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: questionId, currentVersionId: versionId }])) } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: versionId, questionId, version: 2, stem: 'Current' }, { _id: historic, questionId, version: 1, stem: 'Historic' }])) } as never);
  jest.mocked(losCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: loId, name: 'VaR', archivedAt: new Date() }])) } as never);
  jest.mocked(themesCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: themeId, name: 'Risk' }])) } as never);
  const result = await questionPatterns(courseId, { mode: 'topic-practice', loId }, 2);
  expect(result).toMatchObject({ total: 23, limit: 2 });
  expect(result.items[0]).toMatchObject({ failureRate: .5, loName: 'VaR (archived)', isCurrent: true, objectiveCount: 2 });
  expect(result.items[1]).toMatchObject({ insufficient: true, isCurrent: false });
  expect(result.items[1].failureRate).toBeUndefined(); expect(result.items[1].misconceptionRate).toBeUndefined();
  expect(aggregate).toHaveBeenCalledWith(expect.arrayContaining([{ $facet: { items: [{ $limit: 2 }], count: [{ $count: 'total' }] } }]));
});
it('counts only active LO coverage and fills empty weeks with mode-scoped activity', async () => {
  const archived = new ObjectId(); const from = new Date('2026-08-02'); const to = new Date('2026-08-23');
  const find = jest.fn(() => cursor([{ puid: 'student', loId, createdAt: new Date('2026-08-03') }, { puid: 'student', loId: archived, createdAt: new Date('2026-08-03T00:10:00Z') }]));
  jest.mocked(attemptsCol).mockReturnValue({ find } as never);
  jest.mocked(losCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: loId }])) } as never);
  jest.mocked(reviewBookCol).mockReturnValue({ find: jest.fn(() => cursor([{ puid: 'other', addedAt: from }])) } as never);
  const result = await engagement(courseId, { from, to, mode: 'exam-prep' });
  expect(result.totals).toMatchObject({ questionsAttempted: 2, loCoverageRate: 1, reviewBookActivityRate: 0, sessionsPerStudent: 1, avgSessionMinutes: 10 });
  expect(result.weeks).toHaveLength(4); expect(result.weeks[1].questionsAttempted).toBe(0);
  expect(find).toHaveBeenCalledWith({ courseId, mode: 'exam-prep', createdAt: { $gte: from, $lte: to } });
});
