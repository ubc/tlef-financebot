import { ObjectId } from 'mongodb';
import type {
  Course,
  LearningObjective,
  Question,
  QuestionOption,
  QuestionVersion,
  Theme,
} from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(),
  themesCol: jest.fn(),
  losCol: jest.fn(),
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
  previewAttemptsCol: jest.fn(),
  attemptsCol: jest.fn(),
  masteryCol: jest.fn(),
  reviewBookCol: jest.fn(),
  flagsCol: jest.fn(),
  notificationsCol: jest.fn(),
  sessionSummariesCol: jest.fn(),
}));

jest.mock('../../server/src/services/serving.service', () => ({
  selectPreviewQuestion: jest.fn(),
  selectPreviewRetryQuestion: jest.fn(),
}));

import {
  coursesCol,
  themesCol,
  losCol,
  questionsCol,
  questionVersionsCol,
  previewAttemptsCol,
  attemptsCol,
  masteryCol,
  reviewBookCol,
  flagsCol,
  notificationsCol,
  sessionSummariesCol,
} from '../../server/src/components/mongodb/collections';
import {
  selectPreviewQuestion,
  selectPreviewRetryQuestion,
} from '../../server/src/services/serving.service';
import {
  getPreviewHome,
  getNextPreviewQuestion,
  submitPreviewAttempt,
} from '../../server/src/services/preview.service';

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();
const questionId = new ObjectId();
const versionId = new ObjectId();
const instructorPuid = 'PUID-INSTRUCTOR-0001';

const options: QuestionOption[] = [
  { key: 'A', text: 'The answer is {{answer}}.', role: 'correct', explanation: '{{answer}} is correct.' },
  { key: 'B', text: 'A distractor', role: 'common-misconception', explanation: 'This is a common trap.' },
];

const course: Course & { _id: ObjectId } = {
  _id: courseId,
  name: 'Unpublished Finance',
  courseCode: 'COMM 298',
  term: '2026W1',
  ownerPuid: instructorPuid,
  registrationCode: 'ABCD2345',
  published: false,
  feedbackStrategy: 'adaptive',
  autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
  redirectFailureThreshold: 3,
  reviewBacklogThreshold: 10,
  createdAt: new Date(),
};

const theme: Theme & { _id: ObjectId } = {
  _id: themeId,
  courseId,
  name: 'Time Value',
  order: 1,
};

const lo: LearningObjective & { _id: ObjectId } = {
  _id: loId,
  courseId,
  themeId,
  name: 'Compound interest',
  order: 1,
};

const question: Question & { _id: ObjectId } = {
  _id: questionId,
  courseId,
  currentVersionId: versionId,
  currentVersion: 1,
  state: 'approved',
  loIds: [loId],
  themeIds: [themeId],
  labels: [],
  internalNotes: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const version: QuestionVersion & { _id: ObjectId } = {
  _id: versionId,
  questionId,
  version: 1,
  type: 'mcq',
  stem: 'What is {{answer}}?',
  options,
  difficulty: 'medium',
  paramSlots: [{ name: 'answer', min: 4, max: 4 }],
  sourceRefs: [],
  createdBy: 'seed',
  createdAt: new Date(),
};

function idEquals(a: unknown, b: unknown): boolean {
  return a instanceof ObjectId && b instanceof ObjectId ? a.equals(b) : a === b;
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId)) {
      if ('$exists' in expected) return (key in doc) === Boolean((expected as { $exists: boolean }).$exists);
    }
    if (Array.isArray(actual)) return actual.some((item) => idEquals(item, expected));
    return idEquals(actual, expected);
  });
}

function collectionFake(docs: object[]) {
  const records = docs as Record<string, unknown>[];
  return {
    findOne: jest.fn(async (filter: Record<string, unknown>) => records.find((doc) => matches(doc, filter)) ?? null),
    find: jest.fn((filter: Record<string, unknown>) => ({
      toArray: async () => records.filter((doc) => matches(doc, filter)),
    })),
    insertOne: jest.fn(async () => ({ acknowledged: true, insertedId: new ObjectId() })),
  };
}

let previewCollection: ReturnType<typeof collectionFake>;

beforeEach(() => {
  for (const mock of [
    coursesCol,
    themesCol,
    losCol,
    questionsCol,
    questionVersionsCol,
    previewAttemptsCol,
    attemptsCol,
    masteryCol,
    reviewBookCol,
    flagsCol,
    notificationsCol,
    sessionSummariesCol,
    selectPreviewQuestion,
    selectPreviewRetryQuestion,
  ]) {
    jest.mocked(mock).mockReset();
  }

  jest.mocked(coursesCol).mockReturnValue(collectionFake([course]) as never);
  jest.mocked(themesCol).mockReturnValue(collectionFake([theme]) as never);
  jest.mocked(losCol).mockReturnValue(collectionFake([lo]) as never);
  jest.mocked(questionsCol).mockReturnValue(collectionFake([question]) as never);
  jest.mocked(questionVersionsCol).mockReturnValue(collectionFake([version]) as never);
  previewCollection = collectionFake([]);
  jest.mocked(previewAttemptsCol).mockReturnValue(previewCollection as never);
});

describe('Instructor student preview service', () => {
  it('shows an unpublished course but hides future themes and LOs without approved questions', async () => {
    const futureThemeId = new ObjectId();
    const futureLoId = new ObjectId();
    const emptyLoId = new ObjectId();
    const futureTheme = {
      ...theme,
      _id: futureThemeId,
      name: 'Future',
      order: 2,
      availableFrom: new Date(Date.now() + 86_400_000),
    };
    const futureLo = { ...lo, _id: futureLoId, themeId: futureThemeId };
    const emptyLo = { ...lo, _id: emptyLoId, name: 'No approved questions', order: 2 };
    jest.mocked(themesCol).mockReturnValue(collectionFake([theme, futureTheme]) as never);
    jest.mocked(losCol).mockReturnValue(collectionFake([lo, futureLo, emptyLo]) as never);

    const home = await getPreviewHome(courseId);

    expect(home).toHaveLength(1);
    expect(home[0].theme._id.equals(themeId)).toBe(true);
    expect(home[0].los).toHaveLength(1);
    expect(home[0].los[0]).toEqual(expect.objectContaining({
      status: 'not-attempted',
      approvedCount: 1,
    }));
  });

  it('returns only the sanitized Approved question selected for preview', async () => {
    jest.mocked(selectPreviewQuestion).mockResolvedValue({
      question,
      version,
      degraded: 'none',
    });

    const served = await getNextPreviewQuestion({
      courseId,
      loId,
      sessionServedIds: [],
      watermarkUid: 'financeprof',
    });

    expect(served).toEqual(expect.objectContaining({
      questionId: questionId.toHexString(),
      questionVersionId: versionId.toHexString(),
      stem: 'What is 4?',
      options: [
        { key: 'A', text: 'The answer is 4.' },
        { key: 'B', text: 'A distractor' },
      ],
      watermark: 'financeprof',
      paramValues: { answer: 4 },
    }));
    expect(JSON.stringify(served)).not.toMatch(/common-misconception|explanation|correct/);
  });

  it('writes one isolated preview snapshot and touches no live learning collection', async () => {
    jest.mocked(selectPreviewRetryQuestion).mockResolvedValue(null);

    const result = await submitPreviewAttempt({
      instructorPuid,
      courseId,
      questionVersionId: versionId,
      loId,
      selectedKey: 'A',
      sessionServedIds: [],
      paramValues: { answer: 4 },
    });

    expect(result.correct).toBe(true);
    expect(result.mastery).toEqual({ loStatus: 'not-attempted' });
    expect(result.reviewBook).toEqual({ added: false });
    expect(previewCollection.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      instructorPuid,
      preview: true,
      courseId,
      questionId,
      questionVersionId: versionId,
      loId,
      selectedKey: 'A',
      correct: true,
      paramValues: { answer: 4 },
    }));

    for (const liveCollection of [
      attemptsCol,
      masteryCol,
      reviewBookCol,
      flagsCol,
      notificationsCol,
      sessionSummariesCol,
    ]) {
      expect(liveCollection).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-approved question instead of persisting preview activity', async () => {
    jest.mocked(questionsCol).mockReturnValue(collectionFake([{ ...question, state: 'draft' }]) as never);

    await expect(submitPreviewAttempt({
      instructorPuid,
      courseId,
      questionVersionId: versionId,
      loId,
      selectedKey: 'A',
      sessionServedIds: [],
    })).rejects.toThrow('question-not-servable');

    expect(previewCollection.insertOne).not.toHaveBeenCalled();
  });
});
