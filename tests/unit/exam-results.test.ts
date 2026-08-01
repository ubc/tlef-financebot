import { ObjectId } from 'mongodb';
import type {
  AttemptRecord,
  ExamAttempt,
  LearningObjective,
  MasteryProfile,
  QuestionVersion,
  Theme,
} from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  attemptsCol: jest.fn(),
  coursesCol: jest.fn(),
  examAttemptsCol: jest.fn(),
  examTemplatesCol: jest.fn(),
  losCol: jest.fn(),
  masteryCol: jest.fn(),
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
  reviewBookCol: jest.fn(),
  themesCol: jest.fn(),
}));
jest.mock('../../server/src/components/jobs', () => ({
  defineJob: jest.fn(),
  enqueueJob: jest.fn(),
}));
jest.mock('../../server/src/services/notifications.service', () => ({
  notifyCourseStaff: jest.fn(),
}));
jest.mock('../../server/src/services/params.service', () => ({
  drawSeed: jest.fn(),
  resolveParamValues: jest.fn(),
  substituteParams: jest.fn((text: string, values: Record<string, number>) =>
    text.replace('{{amount}}', String(values.amount))),
}));

import {
  attemptsCol,
  examAttemptsCol,
  losCol,
  masteryCol,
  questionVersionsCol,
  themesCol,
} from '../../server/src/components/mongodb/collections';
import { defineJob } from '../../server/src/components/jobs';
import {
  examHistory,
  examResults,
} from '../../server/src/services/exam-attempts.service';
import {
  EXAM_MASTERY_JOB,
  registerExamMasteryJobs,
  runExamMasteryPass,
} from '../../server/src/services/exam-mastery.service';

const courseId = new ObjectId();
const templateId = new ObjectId();
const attemptId = new ObjectId();
const puid = 'PUID-EXAM-RESULTS';
const themeA = new ObjectId();
const themeB = new ObjectId();
const loA = new ObjectId();
const loB = new ObjectId();
const questionA = new ObjectId();
const questionB = new ObjectId();
const versionA = new ObjectId();
const versionB = new ObjectId();

const versions: Array<QuestionVersion & { _id: ObjectId }> = [
  {
    _id: versionA,
    questionId: questionA,
    version: 1,
    type: 'mcq',
    stem: 'Present value of {{amount}}',
    options: [
      { key: 'a', text: '100', role: 'correct', explanation: 'Discounted correctly.' },
      { key: 'b', text: '120', role: 'common-misconception', explanation: 'No discounting.' },
    ],
    difficulty: 'medium',
    paramSlots: [{ name: 'amount', values: [120] }],
    sourceRefs: [],
    createdBy: 'seed',
    createdAt: new Date(),
  },
  {
    _id: versionB,
    questionId: questionB,
    version: 1,
    type: 'true-false',
    stem: 'Diversification can reduce risk.',
    options: [
      { key: 'true', text: 'True', role: 'correct', explanation: 'Correct.' },
      { key: 'false', text: 'False', role: 'clearly-wrong', explanation: 'Incorrect.' },
    ],
    difficulty: 'easy',
    sourceRefs: [],
    createdBy: 'seed',
    createdAt: new Date(),
  },
];

function attempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt & { _id: ObjectId } {
  return {
    _id: attemptId,
    puid,
    courseId,
    templateId,
    templateKind: 'midterm',
    loBreakdown: true,
    questions: [
      {
        questionId: questionA,
        questionVersionId: versionA,
        loId: loA,
        themeId: themeA,
        points: 3,
        paramValues: { amount: 120 },
        selectedKey: 'b',
      },
      {
        questionId: questionB,
        questionVersionId: versionB,
        loId: loB,
        themeId: themeB,
        points: 2,
        selectedKey: 'true',
      },
    ],
    shortfalls: [],
    startedAt: new Date('2026-08-01T12:00:00.000Z'),
    submittedAt: new Date('2026-08-01T12:30:00.000Z'),
    score: 2,
    maxScore: 5,
    ...overrides,
  };
}

const themes: Array<Theme & { _id: ObjectId }> = [
  { _id: themeA, courseId, name: 'Time Value', order: 0 },
  { _id: themeB, courseId, name: 'Portfolio Risk', order: 1 },
];
const los: Array<LearningObjective & { _id: ObjectId }> = [
  { _id: loA, courseId, themeId: themeA, name: 'Discount cash flows', order: 0 },
  { _id: loB, courseId, themeId: themeB, name: 'Explain diversification', order: 0 },
];

function seedResultCollections(attempts: Array<ExamAttempt & { _id: ObjectId }>): void {
  jest.mocked(examAttemptsCol).mockReturnValue({
    findOne: jest.fn(async (filter: Record<string, unknown>) => attempts.find((item) => (
      item._id.equals(filter._id as ObjectId) && item.puid === filter.puid
    )) ?? null),
    find: jest.fn(() => ({
      sort: jest.fn(() => ({
        toArray: async () => [...attempts].sort(
          (left, right) => (right.submittedAt?.getTime() ?? 0) - (left.submittedAt?.getTime() ?? 0),
        ),
      })),
    })),
  } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({
    find: jest.fn(() => ({ toArray: async () => versions })),
  } as never);
  jest.mocked(themesCol).mockReturnValue({
    find: jest.fn(() => ({ toArray: async () => themes })),
  } as never);
  jest.mocked(losCol).mockReturnValue({
    find: jest.fn(() => ({ toArray: async () => los })),
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('exam results and history (ST-X03/X04)', () => {
  it('hides all result/review data before submission', async () => {
    seedResultCollections([attempt({ submittedAt: undefined, score: undefined })]);

    await expect(examResults(attemptId, puid)).rejects.toThrow('exam-not-submitted');
  });

  it('returns score-consistent Theme/LO totals and the full post-submit review', async () => {
    seedResultCollections([attempt()]);

    const result = await examResults(attemptId, puid);

    expect(result.score).toBe(2);
    expect(result.byTheme).toEqual([
      expect.objectContaining({ themeId: themeA, name: 'Time Value', earned: 0, possible: 3 }),
      expect.objectContaining({ themeId: themeB, name: 'Portfolio Risk', earned: 2, possible: 2 }),
    ]);
    expect(result.byLo).toEqual([
      expect.objectContaining({ loId: loA, name: 'Discount cash flows', earned: 0, possible: 3 }),
      expect.objectContaining({ loId: loB, name: 'Explain diversification', earned: 2, possible: 2 }),
    ]);
    expect(result.byTheme[0].practiceLink).toEqual({ courseId, themeId: themeA });
    expect(result.byLo?.[0].practiceLink).toEqual({ courseId, loId: loA });
    expect(result.questions[0]).toEqual(expect.objectContaining({
      stem: 'Present value of 120',
      selectedKey: 'b',
      correct: false,
      options: expect.arrayContaining([
        expect.objectContaining({ key: 'a', role: 'correct', explanation: 'Discounted correctly.' }),
      ]),
    }));
    expect(result.byTheme.reduce((sum, item) => sum + item.earned, 0)).toBe(result.score);
  });

  it('omits the LO breakdown when the sitting pinned loBreakdown false', async () => {
    seedResultCollections([attempt({ loBreakdown: false })]);

    expect(await examResults(attemptId, puid)).not.toHaveProperty('byLo');
  });

  it('orders submitted history newest first with stable result drill-in ids', async () => {
    const olderId = new ObjectId();
    seedResultCollections([
      attempt({ _id: olderId, submittedAt: new Date('2026-07-01T12:00:00.000Z') } as never),
      attempt(),
    ]);

    const history = await examHistory(puid, courseId);

    expect(history.map((item) => item.attemptId)).toEqual([attemptId, olderId]);
    expect(history[0]).toEqual(expect.objectContaining({ kind: 'midterm', score: 2, maxScore: 5 }));
  });
});

describe('exam.mastery-pass', () => {
  it('sets the qualifier only on missed LOs without overwriting practice-derived status', async () => {
    const submitted = attempt();
    const records: Array<AttemptRecord & { _id: ObjectId }> = [
      {
        _id: new ObjectId(), puid, courseId, questionId: questionA,
        questionVersionId: versionA, loId: loA, themeId: themeA,
        mode: 'exam-prep', strategy: 'a', selectedKey: 'b', correct: false,
        selectedRole: 'common-misconception', difficulty: 'medium', isRetry: false,
        examAttemptId: attemptId, createdAt: submitted.submittedAt!,
      },
      {
        _id: new ObjectId(), puid, courseId, questionId: questionB,
        questionVersionId: versionB, loId: loB, themeId: themeB,
        mode: 'exam-prep', strategy: 'b', selectedKey: 'true', correct: true,
        selectedRole: 'correct', difficulty: 'easy', isRetry: false,
        examAttemptId: attemptId, createdAt: submitted.submittedAt!,
      },
    ];
    const profiles = new Map<string, MasteryProfile>([
      [loA.toHexString(), {
        puid, courseId, loId: loA, status: 'struggling', attemptCount: 8,
        windowAccuracy: 0.5, windowRoles: {}, currentTier: 'medium',
        attemptsSinceEvaluation: 1, updatedAt: new Date(),
      }],
      [loB.toHexString(), {
        puid, courseId, loId: loB, status: 'covered', attemptCount: 5,
        windowAccuracy: 0.8, windowRoles: {}, currentTier: 'hard',
        attemptsSinceEvaluation: 0, updatedAt: new Date(),
      }],
    ]);
    jest.mocked(examAttemptsCol).mockReturnValue({
      findOne: jest.fn(async () => submitted),
      updateOne: jest.fn(async (_filter, update: { $set: Record<string, unknown> }) => {
        Object.assign(submitted, update.$set);
        return { matchedCount: 1 };
      }),
    } as never);
    jest.mocked(attemptsCol).mockReturnValue({
      find: jest.fn((filter: { correct?: boolean }) => ({
        toArray: async () => records.filter((record) => (
          filter.correct === undefined || record.correct === filter.correct
        )),
      })),
    } as never);
    jest.mocked(masteryCol).mockReturnValue({
      updateOne: jest.fn(async (filter: { loId: ObjectId }, update: {
        $set: Partial<MasteryProfile>;
        $setOnInsert: MasteryProfile;
      }) => {
        const key = filter.loId.toHexString();
        const current = profiles.get(key) ?? update.$setOnInsert;
        profiles.set(key, { ...current, ...update.$set } as MasteryProfile);
        return { matchedCount: current ? 1 : 0 };
      }),
    } as never);

    await runExamMasteryPass({ examAttemptId: attemptId.toHexString() });
    await runExamMasteryPass({ examAttemptId: attemptId.toHexString() });

    expect(profiles.get(loA.toHexString())).toEqual(expect.objectContaining({
      status: 'struggling',
      examVerified: true,
    }));
    expect(profiles.get(loB.toHexString())).toEqual(expect.objectContaining({ status: 'covered' }));
    expect(profiles.get(loB.toHexString())).not.toHaveProperty('examVerified');
    expect(submitted.masteryPassCompletedAt).toBeInstanceOf(Date);
  });

  it('registers its handler explicitly instead of defining at module load', () => {
    expect(defineJob).not.toHaveBeenCalled();

    registerExamMasteryJobs();

    expect(defineJob).toHaveBeenCalledWith(EXAM_MASTERY_JOB, expect.any(Function));
  });
});
