import { ObjectId } from 'mongodb';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  reviewBookCol: jest.fn(),
  attemptsCol: jest.fn(),
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
  themesCol: jest.fn(),
  sessionSummariesCol: jest.fn(),
}));

jest.mock('../../server/src/services/mastery.service', () => ({
  getLoStatuses: jest.fn(),
}));

import {
  reviewBookCol,
  attemptsCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
  sessionSummariesCol,
} from '../../server/src/components/mongodb/collections';
import { getLoStatuses } from '../../server/src/services/mastery.service';
import {
  toggleBookmark,
  removeEntry,
  listReviewBook,
  sessionEndSummary,
  storeDeferredSummary,
  getSessionSummaryForStart,
} from '../../server/src/services/review-book.service';

// -----------------------------------------------------------------------------
// Fakes: a single generic in-memory collection fake (find/findOne/insertOne/
// updateOne/deleteOne/countDocuments, with $in/$gte/$ne filter support and
// find().sort().limit()) reused across every collection this service touches
// — genuinely observable state transitions, not mocked-away behavior.
// -----------------------------------------------------------------------------

function idEquals(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  return a === b;
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === 'object' && !(cond instanceof ObjectId) && !(cond instanceof Date)) {
      const condObj = cond as Record<string, unknown>;
      if ('$in' in condObj) {
        return (condObj.$in as unknown[]).some((v) => idEquals(v, value));
      }
      if ('$gte' in condObj) {
        return (value as Date).getTime() >= (condObj.$gte as Date).getTime();
      }
      if ('$ne' in condObj) {
        return !idEquals(value, condObj.$ne);
      }
    }
    return idEquals(value, cond);
  });
}

function makeFakeCollection<T extends Record<string, unknown>>(seed: T[] = []) {
  const store: Array<T & { _id: ObjectId }> = seed.map((d) => ({ ...(d as object), _id: (d as { _id?: ObjectId })._id ?? new ObjectId() }) as T & { _id: ObjectId });

  const find = jest.fn((filter: Record<string, unknown> = {}) => {
    let results = store.filter((d) => matchesFilter(d, filter));
    const cursor: {
      sort: (sortSpec: Record<string, 1 | -1>) => typeof cursor;
      limit: (n: number) => typeof cursor;
      toArray: () => Promise<typeof results>;
    } = {
      sort: jest.fn((sortSpec: Record<string, 1 | -1>) => {
        const [[key, dir]] = Object.entries(sortSpec);
        results = [...results].sort((a, b) => {
          const av = (a as Record<string, unknown>)[key] as Date;
          const bv = (b as Record<string, unknown>)[key] as Date;
          const cmp = av > bv ? 1 : av < bv ? -1 : 0;
          return dir === -1 ? -cmp : cmp;
        });
        return cursor;
      }) as (sortSpec: Record<string, 1 | -1>) => typeof cursor,
      limit: jest.fn((n: number) => {
        results = results.slice(0, n);
        return cursor;
      }) as (n: number) => typeof cursor,
      toArray: jest.fn(async () => results) as () => Promise<typeof results>,
    };
    return cursor;
  });

  const findOne = jest.fn(async (filter: Record<string, unknown>) => store.find((d) => matchesFilter(d, filter)) ?? null);

  const insertOne = jest.fn(async (doc: T) => {
    const withId = { ...(doc as object), _id: (doc as { _id?: ObjectId })._id ?? new ObjectId() } as T & { _id: ObjectId };
    store.push(withId);
    return { insertedId: withId._id };
  });

  const updateOne = jest.fn(
    async (filter: Record<string, unknown>, update: Record<string, unknown>, opts?: { upsert?: boolean }) => {
      let doc = store.find((d) => matchesFilter(d, filter));
      if (!doc) {
        if (!opts?.upsert) return;
        doc = { _id: new ObjectId() } as T & { _id: ObjectId };
        store.push(doc);
      }
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$addToSet) {
        for (const [k, v] of Object.entries(update.$addToSet as Record<string, unknown>)) {
          const arr = ((doc as unknown as Record<string, unknown[]>)[k] ??= []);
          if (!arr.includes(v)) arr.push(v);
        }
      }
    },
  );

  const deleteOne = jest.fn(async (filter: Record<string, unknown>) => {
    const idx = store.findIndex((d) => matchesFilter(d, filter));
    if (idx >= 0) store.splice(idx, 1);
  });

  const countDocuments = jest.fn(async (filter: Record<string, unknown> = {}) => store.filter((d) => matchesFilter(d, filter)).length);

  return { store, find, findOne, insertOne, updateOne, deleteOne, countDocuments };
}

// --- Fixtures -----------------------------------------------------------------

const puid = 'PUID-STUDENT-0001';
const courseId = new ObjectId();
const questionId = new ObjectId();
const versionId = new ObjectId();
const loId = new ObjectId();
const themeId = new ObjectId();
const attemptId = new ObjectId();

function reviewBookEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new ObjectId(),
    puid,
    courseId,
    questionId,
    sources: ['auto'],
    triggeringAttemptId: attemptId,
    loId,
    themeId,
    addedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function attemptDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: attemptId,
    puid,
    courseId,
    questionId,
    questionVersionId: versionId,
    loId,
    themeId,
    mode: 'topic-practice',
    strategy: 'b',
    selectedKey: 'A',
    correct: true,
    selectedRole: 'correct',
    difficulty: 'medium',
    isRetry: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function questionDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

function versionDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: versionId,
    questionId,
    version: 1,
    type: 'mcq',
    stem: 'What is 2+2?',
    options: [],
    difficulty: 'medium',
    sourceRefs: [],
    createdBy: 'seed',
    createdAt: new Date(),
    ...overrides,
  };
}

function themeDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return { _id: themeId, courseId, name: 'Theme One', order: 0, ...overrides };
}

beforeEach(() => {
  jest.mocked(getLoStatuses).mockReset();
  jest.mocked(getLoStatuses).mockResolvedValue(new Map());
});

// --- toggleBookmark ------------------------------------------------------------

describe('toggleBookmark', () => {
  it('bookmarking an auto-collected entry keeps it with sources including auto (survives un-bookmarking)', async () => {
    const reviewBook = makeFakeCollection([reviewBookEntry({ sources: ['auto'] })]);
    jest.mocked(reviewBookCol).mockReturnValue(reviewBook as never);
    jest.mocked(attemptsCol).mockReturnValue(makeFakeCollection([attemptDoc()]) as never);

    const result = await toggleBookmark(puid, courseId, questionId);

    expect(result.bookmarked).toBe(true);
    expect(reviewBook.store).toHaveLength(1);
    expect(reviewBook.store[0].sources).toEqual(['auto', 'bookmark']);

    // Un-bookmarking now: the auto source keeps the entry alive.
    const second = await toggleBookmark(puid, courseId, questionId);
    expect(second.bookmarked).toBe(false);
    expect(reviewBook.store).toHaveLength(1);
    expect(reviewBook.store[0].sources).toEqual(['auto']);
  });

  it('bookmark on a never-missed question (no existing entry) creates a fresh sources:["bookmark"] entry sourced from the latest attempt', async () => {
    const reviewBook = makeFakeCollection<Record<string, unknown>>([]);
    jest.mocked(reviewBookCol).mockReturnValue(reviewBook as never);
    jest.mocked(attemptsCol).mockReturnValue(makeFakeCollection([attemptDoc({ correct: true })]) as never);

    const result = await toggleBookmark(puid, courseId, questionId);

    expect(result.bookmarked).toBe(true);
    expect(reviewBook.store).toHaveLength(1);
    expect(reviewBook.store[0].sources).toEqual(['bookmark']);
    expect((reviewBook.store[0].loId as ObjectId).equals(loId)).toBe(true);
    expect((reviewBook.store[0].themeId as ObjectId).equals(themeId)).toBe(true);
    expect((reviewBook.store[0].triggeringAttemptId as ObjectId).equals(attemptId)).toBe(true);
  });

  it('a bookmark-only entry is deleted entirely when un-bookmarked (no other source keeps it alive)', async () => {
    const reviewBook = makeFakeCollection([reviewBookEntry({ sources: ['bookmark'] })]);
    jest.mocked(reviewBookCol).mockReturnValue(reviewBook as never);
    jest.mocked(attemptsCol).mockReturnValue(makeFakeCollection([attemptDoc()]) as never);

    const result = await toggleBookmark(puid, courseId, questionId);

    expect(result.bookmarked).toBe(false);
    expect(reviewBook.store).toHaveLength(0);
  });

  it("throws 'no-attempt-context' when bookmarking a question with neither an entry nor an attempt", async () => {
    jest.mocked(reviewBookCol).mockReturnValue(makeFakeCollection([]) as never);
    jest.mocked(attemptsCol).mockReturnValue(makeFakeCollection([]) as never);

    await expect(toggleBookmark(puid, courseId, questionId)).rejects.toThrow('no-attempt-context');
  });
});

// --- removeEntry -----------------------------------------------------------------

describe('removeEntry', () => {
  it('deletes only the review-book entry; never calls attemptsCol', async () => {
    const entry = reviewBookEntry();
    const reviewBook = makeFakeCollection([entry]);
    jest.mocked(reviewBookCol).mockReturnValue(reviewBook as never);
    jest.mocked(attemptsCol).mockReturnValue(makeFakeCollection([attemptDoc()]) as never);

    await removeEntry(puid, entry._id as ObjectId);

    expect(reviewBook.store).toHaveLength(0);
    expect(attemptsCol).not.toHaveBeenCalled();
  });
});

// --- listReviewBook --------------------------------------------------------------

describe('listReviewBook', () => {
  it('groups entries by theme with counts and honours the "date" sort (newest first)', async () => {
    const themeTwo = new ObjectId();
    const questionTwo = new ObjectId();
    const versionTwo = new ObjectId();

    const entryOld = reviewBookEntry({ addedAt: new Date('2026-01-01T00:00:00Z') });
    const entryNew = reviewBookEntry({ _id: new ObjectId(), questionId: questionTwo, themeId, addedAt: new Date('2026-02-01T00:00:00Z') });
    const entryOtherTheme = reviewBookEntry({ _id: new ObjectId(), themeId: themeTwo, addedAt: new Date('2026-01-15T00:00:00Z') });

    jest.mocked(reviewBookCol).mockReturnValue(makeFakeCollection([entryOld, entryNew, entryOtherTheme]) as never);
    jest.mocked(questionsCol).mockReturnValue(
      makeFakeCollection([questionDoc(), questionDoc({ _id: questionTwo, currentVersionId: versionTwo })]) as never,
    );
    jest.mocked(questionVersionsCol).mockReturnValue(
      makeFakeCollection([versionDoc(), versionDoc({ _id: versionTwo, questionId: questionTwo, stem: 'Second stem' })]) as never,
    );
    jest.mocked(themesCol).mockReturnValue(
      makeFakeCollection([themeDoc({ order: 0 }), themeDoc({ _id: themeTwo, order: 1, name: 'Theme Two' })]) as never,
    );

    const groups = await listReviewBook(puid, courseId, 'date');

    expect(groups).toHaveLength(2);
    expect(groups[0].theme._id.equals(themeId)).toBe(true);
    expect(groups[0].entries).toHaveLength(2); // count via entries.length
    // "date" sort = newest first.
    expect(groups[0].entries[0].addedAt.getTime()).toBe(entryNew.addedAt.getTime());
    expect(groups[0].entries[1].addedAt.getTime()).toBe(entryOld.addedAt.getTime());
    expect(groups[0].entries[0].question.stem).toBe('Second stem');

    expect(groups[1].theme._id.equals(themeTwo)).toBe(true);
    expect(groups[1].entries).toHaveLength(1);
  });

  it('returns an empty array when the student has no review-book entries', async () => {
    jest.mocked(reviewBookCol).mockReturnValue(makeFakeCollection([]) as never);
    jest.mocked(questionsCol).mockReturnValue(makeFakeCollection([]) as never);
    jest.mocked(questionVersionsCol).mockReturnValue(makeFakeCollection([]) as never);
    jest.mocked(themesCol).mockReturnValue(makeFakeCollection([]) as never);

    const groups = await listReviewBook(puid, courseId, 'theme');

    expect(groups).toEqual([]);
  });
});

// --- sessionEndSummary -------------------------------------------------------------

describe('sessionEndSummary', () => {
  it("missedQuestions ids equal the review-book additions in the window (not a divergent list, ST-R06)", async () => {
    const since = new Date('2026-03-01T00:00:00Z');
    const inWindowQuestion = new ObjectId();
    const beforeWindowQuestion = new ObjectId();

    const attempts = [
      attemptDoc({ _id: new ObjectId(), createdAt: new Date('2026-03-02T00:00:00Z'), correct: false, questionId: inWindowQuestion }),
      attemptDoc({ _id: new ObjectId(), createdAt: new Date('2026-02-15T00:00:00Z'), correct: false, questionId: beforeWindowQuestion }), // before `since` — excluded
    ];
    const reviewBookEntries = [
      reviewBookEntry({ _id: new ObjectId(), questionId: inWindowQuestion, addedAt: new Date('2026-03-02T00:00:01Z') }),
      // Added before `since` (a repeat-miss updatedAt bump wouldn't move addedAt) — must NOT appear as an "addition" in this window.
      reviewBookEntry({ _id: new ObjectId(), questionId: beforeWindowQuestion, addedAt: new Date('2026-02-15T00:00:01Z') }),
    ];

    jest.mocked(attemptsCol).mockReturnValue(makeFakeCollection(attempts) as never);
    jest.mocked(reviewBookCol).mockReturnValue(makeFakeCollection(reviewBookEntries) as never);
    jest.mocked(getLoStatuses).mockResolvedValue(new Map([[loId.toHexString(), 'covered']]));

    const summary = await sessionEndSummary(puid, courseId, since);

    expect(summary.questionsAttempted).toBe(1);
    expect(summary.reviewBookAdditions).toHaveLength(1);
    expect(summary.missedQuestions).toEqual(summary.reviewBookAdditions.map((a) => a.questionId));
    expect(summary.missedQuestions).toEqual([inWindowQuestion.toString()]);
    expect(summary.losCovered).toEqual([loId.toHexString()]);
  });
});

// --- deferred summary storage / start-of-session retrieval -----------------------

describe('storeDeferredSummary + getSessionSummaryForStart', () => {
  it('stores the computed summary and later returns it as `deferred`; welcome is false once attempts exist', async () => {
    const since = new Date('2026-03-01T00:00:00Z');
    jest.mocked(attemptsCol).mockReturnValue(
      makeFakeCollection([attemptDoc({ createdAt: new Date('2026-03-02T00:00:00Z') })]) as never,
    );
    jest.mocked(reviewBookCol).mockReturnValue(makeFakeCollection([]) as never);
    const sessionSummaries = makeFakeCollection<Record<string, unknown>>([]);
    jest.mocked(sessionSummariesCol).mockReturnValue(sessionSummaries as never);

    const computed = await storeDeferredSummary(puid, courseId, since);

    expect(sessionSummaries.store).toHaveLength(1);
    expect(sessionSummaries.store[0].summary).toEqual(computed);

    const startOfSession = await getSessionSummaryForStart(puid, courseId);
    expect(startOfSession.deferred).toEqual(computed);
    expect(startOfSession.welcome).toBe(false);
  });

  it('welcome is true when the student has no attempts in the course yet, and deferred is absent with no stored summary', async () => {
    jest.mocked(attemptsCol).mockReturnValue(makeFakeCollection([]) as never);
    jest.mocked(sessionSummariesCol).mockReturnValue(makeFakeCollection([]) as never);

    const result = await getSessionSummaryForStart(puid, courseId);

    expect(result.welcome).toBe(true);
    expect(result.deferred).toBeUndefined();
  });
});
