import { ObjectId } from 'mongodb';
import type {
  Course,
  ExamAttempt,
  ExamTemplate,
  LearningObjective,
  Question,
  QuestionOption,
  QuestionVersion,
  User,
} from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  attemptsCol: jest.fn(),
  coursesCol: jest.fn(),
  examAttemptsCol: jest.fn(),
  examTemplatesCol: jest.fn(),
  losCol: jest.fn(),
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
  reviewBookCol: jest.fn(),
}));
jest.mock('../../server/src/services/params.service', () => ({
  drawSeed: jest.fn(() => 1234),
  resolveParamValues: jest.fn(),
  substituteParams: jest.fn((text: string, values: Record<string, number>) =>
    text.replace('{{rate}}', String(values.rate))),
}));
jest.mock('../../server/src/services/notifications.service', () => ({
  notifyCourseStaff: jest.fn(),
}));
jest.mock('../../server/src/services/exam-mastery.service', () => ({
  enqueueExamMasteryPass: jest.fn(),
}));

import {
  attemptsCol,
  coursesCol,
  examAttemptsCol,
  examTemplatesCol,
  losCol,
  questionsCol,
  questionVersionsCol,
  reviewBookCol,
} from '../../server/src/components/mongodb/collections';
import { enqueueExamMasteryPass } from '../../server/src/services/exam-mastery.service';
import { notifyCourseStaff } from '../../server/src/services/notifications.service';
import { resolveParamValues } from '../../server/src/services/params.service';
import {
  answerQuestion,
  examState,
  startExam,
  submitExam,
} from '../../server/src/services/exam-attempts.service';

const courseId = new ObjectId();
const templateId = new ObjectId();
const themeA = new ObjectId();
const themeB = new ObjectId();
const loA = new ObjectId();
const loB = new ObjectId();
const puid = 'PUID-STUDENT-EXAM';

const user: User = {
  puid,
  uid: 'examstudent',
  displayName: 'Exam Student',
  email: 'examstudent@example.ubc.ca',
  affiliations: ['student'],
  isAdmin: false,
  courseRoles: [{ courseId, role: 'student' }],
  createdAt: new Date(),
  lastLoginAt: new Date(),
};

const options: QuestionOption[] = [
  { key: 'A', text: 'Correct {{rate}}', role: 'correct', explanation: 'Correct explanation' },
  { key: 'B', text: 'Wrong', role: 'common-misconception', explanation: 'Wrong explanation' },
];

interface BankEntry {
  question: Question & { _id: ObjectId };
  version: QuestionVersion & { _id: ObjectId };
}

function bankEntry(
  themeId: ObjectId,
  loId: ObjectId,
  type: 'mcq' | 'true-false',
  state: Question['state'] = 'approved',
): BankEntry {
  const questionId = new ObjectId();
  const versionId = new ObjectId();
  return {
    question: {
      _id: questionId,
      courseId,
      currentVersionId: versionId,
      currentVersion: 1,
      state,
      loIds: [loId],
      themeIds: [themeId],
      labels: [],
      internalNotes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    version: {
      _id: versionId,
      questionId,
      version: 1,
      type,
      stem: `Question {{rate}} ${questionId.toHexString()}`,
      options,
      difficulty: 'medium',
      paramSlots: [{ name: 'rate', values: [5] }],
      sourceRefs: [],
      createdBy: 'seed',
      createdAt: new Date(),
    },
  };
}

function template(overrides: Partial<ExamTemplate> = {}): ExamTemplate & { _id: ObjectId } {
  return {
    _id: templateId,
    courseId,
    kind: 'midterm',
    themes: [
      { themeId: themeA, mcqCount: 2, tfCount: 1, pointsPerQuestion: 2 },
      { themeId: themeB, mcqCount: 1, tfCount: 0, pointsPerQuestion: 3 },
    ],
    timeLimitMinutes: 60,
    availabilityStart: new Date('2026-08-01T00:00:00.000Z'),
    availabilityEnd: new Date('2026-12-31T23:59:59.000Z'),
    loBreakdown: true,
    updatedAt: new Date(),
    ...overrides,
  };
}

const course: Course & { _id: ObjectId } = {
  _id: courseId,
  name: 'Finance',
  courseCode: 'COMM 298',
  term: '2026W1',
  ownerPuid: 'PUID-INSTRUCTOR',
  registrationCode: 'EXAM1234',
  published: true,
  feedbackStrategy: 'adaptive',
  autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
  redirectFailureThreshold: 3,
  reviewBacklogThreshold: 10,
  createdAt: new Date(),
};

const los: Array<LearningObjective & { _id: ObjectId }> = [
  { _id: loA, courseId, themeId: themeA, name: 'LO A', order: 0 },
  { _id: loB, courseId, themeId: themeB, name: 'LO B', order: 0 },
];

let currentTemplate: ReturnType<typeof template>;
let bank: BankEntry[];
let examAttempts: Array<ExamAttempt & { _id: ObjectId }>;
let attemptRecords: Record<string, unknown>[];
let reviewBookQuestions: Set<string>;

function equals(left: unknown, right: unknown): boolean {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  return left === right;
}

function applySet(target: Record<string, unknown>, set: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(set)) {
    const parts = path.split('.');
    let cursor: unknown = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const key = parts[index];
      cursor = Array.isArray(cursor)
        ? cursor[Number(key)]
        : (cursor as Record<string, unknown>)[key];
    }
    const last = parts.at(-1)!;
    if (Array.isArray(cursor)) (cursor as unknown[])[Number(last)] = value;
    else (cursor as Record<string, unknown>)[last] = value;
  }
}

function objectKeysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(objectKeysDeep);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...objectKeysDeep(child)]);
}

function matchesAttempt(doc: ExamAttempt & { _id: ObjectId }, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === 'submittedAt' && expected && typeof expected === 'object' && '$exists' in expected) {
      return (expected as { $exists: boolean }).$exists ? doc.submittedAt !== undefined : doc.submittedAt === undefined;
    }
    return equals((doc as unknown as Record<string, unknown>)[key], expected);
  });
}

function seed(entries: BankEntry[], templateDoc = template()): void {
  currentTemplate = templateDoc;
  bank = entries;
  examAttempts = [];
  attemptRecords = [];
  reviewBookQuestions = new Set();

  jest.mocked(resolveParamValues).mockResolvedValue({ rate: 5 });
  jest.mocked(enqueueExamMasteryPass).mockResolvedValue(undefined);
  jest.mocked(notifyCourseStaff).mockResolvedValue(undefined);

  jest.mocked(examTemplatesCol).mockReturnValue({
    findOne: jest.fn(async (filter: Record<string, unknown>) =>
      equals(filter._id, currentTemplate._id) && equals(filter.courseId, courseId) ? currentTemplate : null),
  } as never);
  jest.mocked(coursesCol).mockReturnValue({
    findOne: jest.fn(async (filter: Record<string, unknown>) => equals(filter._id, courseId) ? course : null),
  } as never);
  jest.mocked(questionsCol).mockReturnValue({
    find: jest.fn((filter: Record<string, unknown>) => ({
      toArray: async () => bank
        .map((entry) => entry.question)
        .filter((question) => equals(question.courseId, filter.courseId) && question.state === filter.state),
    })),
  } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({
    find: jest.fn(() => ({ toArray: async () => bank.map((entry) => entry.version) })),
  } as never);
  jest.mocked(losCol).mockReturnValue({
    find: jest.fn(() => ({ toArray: async () => los })),
  } as never);
  jest.mocked(examAttemptsCol).mockReturnValue({
    findOne: jest.fn(async (filter: Record<string, unknown>) =>
      examAttempts.find((doc) => matchesAttempt(doc, filter)) ?? null),
    insertOne: jest.fn(async (doc: ExamAttempt & { _id?: ObjectId }) => {
      const insertedId = doc._id ?? new ObjectId();
      examAttempts.push({ ...doc, _id: insertedId });
      return { insertedId };
    }),
    findOneAndUpdate: jest.fn(async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown> },
    ) => {
      const found = examAttempts.find((doc) => matchesAttempt(doc, filter));
      if (!found) return null;
      if (update.$set) applySet(found as unknown as Record<string, unknown>, update.$set);
      return found;
    }),
    updateOne: jest.fn(async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown> },
    ) => {
      const found = examAttempts.find((doc) => matchesAttempt(doc, filter));
      if (found && update.$set) applySet(found as unknown as Record<string, unknown>, update.$set);
      return { matchedCount: found ? 1 : 0 };
    }),
  } as never);
  jest.mocked(attemptsCol).mockReturnValue({
    insertMany: jest.fn(async (docs: Record<string, unknown>[]) => {
      attemptRecords.push(...docs);
      return { insertedCount: docs.length };
    }),
  } as never);
  jest.mocked(reviewBookCol).mockReturnValue({
    findOne: jest.fn(async (filter: { questionId: ObjectId }) => (
      reviewBookQuestions.has(filter.questionId.toHexString()) ? { _id: new ObjectId() } : null
    )),
    updateOne: jest.fn(async (filter: { questionId: ObjectId }) => {
      reviewBookQuestions.add(filter.questionId.toHexString());
      return { matchedCount: 1 };
    }),
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('startExam (ST-X01/X02)', () => {
  it('assembles the exact per-Theme MCQ/T-F split when supply suffices', async () => {
    seed([
      bankEntry(themeA, loA, 'mcq'),
      bankEntry(themeA, loA, 'mcq'),
      bankEntry(themeA, loA, 'true-false'),
      bankEntry(themeB, loB, 'mcq'),
    ]);

    const attempt = await startExam(user, courseId, templateId, () => 0);

    expect(attempt.questions).toHaveLength(4);
    expect(attempt.questions.filter((item) => item.themeId.equals(themeA))).toHaveLength(3);
    expect(attempt.questions.filter((item) => item.themeId.equals(themeB))).toHaveLength(1);
    expect(attempt.shortfalls).toEqual([]);
    expect(attempt.maxScore).toBe(9);
    expect(attempt.timeLimitMinutes).toBe(60);
    expect(attempt.templateKind).toBe('midterm');
  });

  it('records a shortfall and starts with what is available', async () => {
    seed([bankEntry(themeA, loA, 'mcq')], template({
      themes: [{ themeId: themeA, mcqCount: 5, tfCount: 0, pointsPerQuestion: 1 }],
    }));

    const attempt = await startExam(user, courseId, templateId, () => 0);

    expect(attempt.questions).toHaveLength(1);
    expect(attempt.shortfalls).toEqual([{ themeId: themeA, requested: 5, assembled: 1 }]);
    expect(notifyCourseStaff).toHaveBeenCalledWith(courseId, expect.objectContaining({
      kind: 'review-backlog',
      priority: 'standard',
    }));
  });

  it('draws only Approved questions', async () => {
    seed([
      bankEntry(themeA, loA, 'mcq', 'draft'),
      bankEntry(themeA, loA, 'mcq', 'approved'),
    ], template({ themes: [{ themeId: themeA, mcqCount: 2, tfCount: 0, pointsPerQuestion: 1 }] }));

    const attempt = await startExam(user, courseId, templateId, () => 0);

    expect(attempt.questions).toHaveLength(1);
    expect(attempt.shortfalls[0]).toMatchObject({ requested: 2, assembled: 1 });
  });

  it('returns the same open attempt with retained answers when restarted', async () => {
    seed([bankEntry(themeA, loA, 'mcq')], template({
      themes: [{ themeId: themeA, mcqCount: 1, tfCount: 0, pointsPerQuestion: 1 }],
    }));
    const first = await startExam(user, courseId, templateId, () => 0);
    await answerQuestion(first._id, puid, 0, 'B');

    const resumed = await startExam(user, courseId, templateId, () => 0);

    expect(resumed._id.equals(first._id)).toBe(true);
    expect(resumed.questions[0].selectedKey).toBe('B');
    expect(examAttempts).toHaveLength(1);
  });
});

describe('answering and submission', () => {
  it('allows answer changes before submit and rejects them afterward', async () => {
    seed([bankEntry(themeA, loA, 'mcq')], template({
      themes: [{ themeId: themeA, mcqCount: 1, tfCount: 0, pointsPerQuestion: 2 }],
    }));
    const attempt = await startExam(user, courseId, templateId, () => 0);

    await answerQuestion(attempt._id, puid, 0, 'B');
    await answerQuestion(attempt._id, puid, 0, 'A');
    expect(examAttempts[0].questions[0].selectedKey).toBe('A');

    await submitExam(attempt._id, puid);
    await expect(answerQuestion(attempt._id, puid, 0, 'B')).rejects.toThrow('exam-already-submitted');
  });

  it('never exposes roles, explanations, or correctness before submission', async () => {
    seed([bankEntry(themeA, loA, 'mcq')], template({
      themes: [{ themeId: themeA, mcqCount: 1, tfCount: 0, pointsPerQuestion: 1 }],
    }));
    const attempt = await startExam(user, courseId, templateId, () => 0);

    const state = await examState(attempt._id, puid);

    expect(objectKeysDeep(state)).not.toEqual(expect.arrayContaining([
      'role',
      'explanation',
      'correct',
      'correctness',
    ]));
    expect(state.questions[0]).toMatchObject({ stem: expect.stringContaining('5') });
    expect(state.questions[0].options).toEqual([
      { key: 'A', text: 'Correct 5' },
      { key: 'B', text: 'Wrong' },
    ]);
  });

  it('auto-submits an expired attempt when its state is touched', async () => {
    seed([bankEntry(themeA, loA, 'mcq')], template({
      themes: [{ themeId: themeA, mcqCount: 1, tfCount: 0, pointsPerQuestion: 1 }],
      timeLimitMinutes: 1,
    }));
    const attempt = await startExam(user, courseId, templateId, () => 0);
    examAttempts[0].startedAt = new Date(Date.now() - 120_000);

    const state = await examState(attempt._id, puid);

    expect(state.submitted).toBe(true);
    expect(examAttempts[0].submittedAt).toBeInstanceOf(Date);
  });

  it('scores pinned versions and writes one exam AttemptRecord per question', async () => {
    seed([
      bankEntry(themeA, loA, 'mcq'),
      bankEntry(themeA, loA, 'mcq'),
    ], template({ themes: [{ themeId: themeA, mcqCount: 2, tfCount: 0, pointsPerQuestion: 3 }] }));
    const attempt = await startExam(user, courseId, templateId, () => 0);
    await answerQuestion(attempt._id, puid, 0, 'A');
    await answerQuestion(attempt._id, puid, 1, 'B');

    const result = await submitExam(attempt._id, puid);

    expect(result).toEqual({ score: 3, maxScore: 6 });
    expect(attemptRecords).toHaveLength(2);
    expect(attemptRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'exam-prep', examAttemptId: attempt._id, correct: true, isRetry: false }),
      expect.objectContaining({ mode: 'exam-prep', examAttemptId: attempt._id, correct: false, isRetry: false }),
    ]));
    expect(enqueueExamMasteryPass).toHaveBeenCalledWith(attempt._id);
    expect(reviewBookQuestions.size).toBe(1);

    await submitExam(attempt._id, puid);
    expect(reviewBookQuestions.size).toBe(1);
  });
});
