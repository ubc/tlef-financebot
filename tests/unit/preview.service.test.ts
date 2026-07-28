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
  previewStudentSessionsCol: jest.fn(),
  materialsCol: jest.fn(),
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

jest.mock('../../server/src/services/flags.service', () => ({
  flagQuestion: jest.fn(),
}));

import {
  coursesCol,
  themesCol,
  losCol,
  questionsCol,
  questionVersionsCol,
  previewAttemptsCol,
  previewStudentSessionsCol,
  materialsCol,
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
import { flagQuestion } from '../../server/src/services/flags.service';
import {
  flagPreviewQuestion,
  getPreviewSessionSummary,
  getPreviewHome,
  getNextPreviewQuestion,
  listPreviewReviewBook,
  removePreviewReviewBookEntry,
  submitPreviewAttempt,
  togglePreviewBookmark,
} from '../../server/src/services/preview.service';

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();
const questionId = new ObjectId();
const versionId = new ObjectId();
const instructorPuid = 'PUID-INSTRUCTOR-0001';
const previewSessionId = '11111111-1111-4111-8111-111111111111';

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
      if ('$in' in expected) {
        return (expected as { $in: unknown[] }).$in.some((item) => idEquals(actual, item));
      }
    }
    if (Array.isArray(actual)) return actual.some((item) => idEquals(item, expected));
    return idEquals(actual, expected);
  });
}

function collectionFake(docs: object[]) {
  const records = docs as Record<string, unknown>[];
  const find = jest.fn((filter: Record<string, unknown>) => {
    let selected = records.filter((doc) => matches(doc, filter));
    interface FakeCursor {
      sort: jest.Mock<FakeCursor, [Record<string, number>]>;
      limit: jest.Mock<FakeCursor, [number]>;
      toArray: jest.Mock<Promise<Record<string, unknown>[]>, []>;
    }
    const cursor = {} as FakeCursor;
    cursor.sort = jest.fn((spec: Record<string, number>): FakeCursor => {
        const [key, direction] = Object.entries(spec)[0];
        selected = [...selected].sort((a, b) => {
          const av = a[key] instanceof Date ? (a[key] as Date).getTime() : 0;
          const bv = b[key] instanceof Date ? (b[key] as Date).getTime() : 0;
          return (av - bv) * direction;
        });
        return cursor;
      });
    cursor.limit = jest.fn((count: number): FakeCursor => {
      selected = selected.slice(0, count);
      return cursor;
    });
    cursor.toArray = jest.fn(async () => selected);
    return cursor;
  });
  return {
    findOne: jest.fn(async (filter: Record<string, unknown>) => records.find((doc) => matches(doc, filter)) ?? null),
    find,
    insertOne: jest.fn(async (doc: Record<string, unknown>) => {
      records.push(doc);
      return { acknowledged: true, insertedId: doc._id ?? new ObjectId() };
    }),
    updateOne: jest.fn(async (
      filter: Record<string, unknown>,
      update: {
        $set?: Record<string, unknown>;
        $setOnInsert?: Record<string, unknown>;
        $push?: Record<string, unknown>;
      },
      options?: { upsert?: boolean },
    ) => {
      let record = records.find((doc) => matches(doc, filter));
      if (!record && options?.upsert) {
        record = { ...filter, ...(update.$setOnInsert ?? {}) };
        records.push(record);
      }
      if (record) {
        Object.assign(record, update.$set ?? {});
        for (const [key, value] of Object.entries(update.$push ?? {})) {
          const list = (record[key] as unknown[] | undefined) ?? [];
          record[key] = [...list, value];
        }
      }
      return { acknowledged: true, matchedCount: record ? 1 : 0 };
    }),
  };
}

let previewCollection: ReturnType<typeof collectionFake>;
let previewSessionCollection: ReturnType<typeof collectionFake>;

beforeEach(() => {
  for (const mock of [
    coursesCol,
    themesCol,
    losCol,
    questionsCol,
    questionVersionsCol,
    previewAttemptsCol,
    previewStudentSessionsCol,
    materialsCol,
    attemptsCol,
    masteryCol,
    reviewBookCol,
    flagsCol,
    notificationsCol,
    sessionSummariesCol,
    selectPreviewQuestion,
    selectPreviewRetryQuestion,
    flagQuestion,
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
  previewSessionCollection = collectionFake([]);
  jest.mocked(previewStudentSessionsCol).mockReturnValue(previewSessionCollection as never);
  jest.mocked(materialsCol).mockReturnValue(collectionFake([]) as never);
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
      instructorPuid,
      previewSessionId,
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
      previewSessionId,
      courseId,
      questionVersionId: versionId,
      loId,
      mode: 'topic-practice',
      selectedKey: 'A',
      sessionServedIds: [],
      paramValues: { answer: 4 },
    });

    expect(result.correct).toBe(true);
    expect(result.mastery).toEqual({ loStatus: 'in-progress' });
    expect(result.reviewBook).toEqual({ added: false });
    expect(previewCollection.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      instructorPuid,
      previewSessionId,
      preview: true,
      courseId,
      questionId,
      questionVersionId: versionId,
      loId,
      mode: 'topic-practice',
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
      previewSessionId,
      courseId,
      questionVersionId: versionId,
      loId,
      mode: 'topic-practice',
      selectedKey: 'A',
      sessionServedIds: [],
    })).rejects.toThrow('question-not-servable');

    expect(previewCollection.insertOne).not.toHaveBeenCalled();
  });

  it('supports isolated flag, Review Book, bookmark, removal, and summary flows', async () => {
    jest.mocked(selectPreviewRetryQuestion).mockResolvedValue(null);

    const result = await submitPreviewAttempt({
      instructorPuid,
      previewSessionId,
      courseId,
      questionVersionId: versionId,
      loId,
      mode: 'topic-practice',
      selectedKey: 'B',
      sessionServedIds: [],
      paramValues: { answer: 4 },
    });

    expect(result.correct).toBe(false);
    expect(result.reviewBook).toEqual({ added: true });

    await expect(flagPreviewQuestion(
      courseId,
      { instructorPuid, previewSessionId },
      questionId,
      'The wording is unclear.',
    )).resolves.toEqual({ flagged: true, testQueued: false });
    expect(flagQuestion).not.toHaveBeenCalled();

    let groups = await listPreviewReviewBook(
      courseId,
      { instructorPuid, previewSessionId },
      'theme',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].entries[0]).toEqual(expect.objectContaining({
      puid: 'anonymous-preview',
      questionId,
      sources: ['auto'],
      question: expect.objectContaining({ stem: 'What is 4?' }),
    }));

    await togglePreviewBookmark(
      courseId,
      { instructorPuid, previewSessionId },
      questionId,
      true,
    );
    groups = await listPreviewReviewBook(
      courseId,
      { instructorPuid, previewSessionId },
      'theme',
    );
    expect(groups[0].entries[0].sources).toEqual(['auto', 'bookmark']);

    const summary = await getPreviewSessionSummary(
      courseId,
      { instructorPuid, previewSessionId },
    );
    expect(summary).toEqual(expect.objectContaining({
      questionsAttempted: 1,
      missedQuestions: [questionId.toHexString()],
    }));
    expect(summary.reviewBookAdditions).toHaveLength(1);

    await removePreviewReviewBookEntry(
      courseId,
      { instructorPuid, previewSessionId },
      groups[0].entries[0]._id,
    );
    await expect(listPreviewReviewBook(
      courseId,
      { instructorPuid, previewSessionId },
      'theme',
    )).resolves.toEqual([]);

    expect(previewSessionCollection.updateOne).toHaveBeenCalled();
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

  it('optionally mirrors an isolated Preview flag into the Instructor Queue as TEST', async () => {
    jest.mocked(flagQuestion).mockResolvedValue({ flagged: true, duplicate: false });

    await expect(flagPreviewQuestion(
      courseId,
      { instructorPuid, previewSessionId },
      questionId,
      'Exercise the workflow.',
      true,
    )).resolves.toEqual({ flagged: true, testQueued: true });

    expect(flagQuestion).toHaveBeenCalledWith({
      puid: instructorPuid,
      questionId,
      source: 'instructor-preview-test',
      reason: 'Exercise the workflow.',
    });
  });
});
