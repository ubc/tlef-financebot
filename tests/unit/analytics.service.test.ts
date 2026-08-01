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
} from '../../server/src/components/mongodb/collections';
import {
  answerDistributions,
  clusterSessions,
  csvSerialize,
  failureRates,
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
    jest.mocked(losCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: loId, name: 'VaR', order: 1 }])) } as never);

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
    jest.mocked(losCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: loId, name: 'VaR', order: 1 }])) } as never);

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
