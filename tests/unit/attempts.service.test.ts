import { ObjectId } from 'mongodb';
import type { User, QuestionOption } from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionVersionsCol: jest.fn(),
  questionsCol: jest.fn(),
  coursesCol: jest.fn(),
  reviewBookCol: jest.fn(),
  attemptsCol: jest.fn(),
  losCol: jest.fn(),
}));

jest.mock('../../server/src/services/mastery.service', () => ({
  recordAttemptInMastery: jest.fn(),
  getLoStatuses: jest.fn(),
  themeCoverage: jest.fn(),
}));

jest.mock('../../server/src/services/serving.service', () => ({
  selectRetryQuestion: jest.fn(),
}));

import {
  questionVersionsCol,
  questionsCol,
  coursesCol,
  reviewBookCol,
  losCol,
} from '../../server/src/components/mongodb/collections';
import { recordAttemptInMastery, getLoStatuses, themeCoverage } from '../../server/src/services/mastery.service';
import { selectRetryQuestion } from '../../server/src/services/serving.service';
import { decideStrategy, submitAttempt } from '../../server/src/services/attempts.service';

// -----------------------------------------------------------------------------
// Fakes: questionVersionsCol/questionsCol/coursesCol are read-only single-doc
// lookups here (findOne by _id) — a plain array + `.equals`-aware matcher
// covers that. reviewBookCol needs upsert semantics (find-or-create +
// $set/$addToSet/$setOnInsert), so it gets a small stateful fake so the
// "repeat miss updates the same entry" and "upsert happens before the retry
// resolves" cases are genuinely observable, not just mocked away.
// -----------------------------------------------------------------------------

function idEquals(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  return a === b;
}

function makeReadOnlyCol(docs: Record<string, unknown>[]) {
  return {
    findOne: jest.fn(async (filter: Record<string, unknown>) =>
      docs.find((d) => Object.entries(filter).every(([k, v]) => idEquals(d[k], v))) ?? null,
    ),
  };
}

interface ReviewBookDoc {
  puid: string;
  courseId: ObjectId;
  questionId: ObjectId;
  sources: string[];
  triggeringAttemptId: ObjectId;
  loId: ObjectId;
  themeId: ObjectId;
  addedAt: Date;
  updatedAt: Date;
}

function makeReviewBookFake(seed: ReviewBookDoc[] = []) {
  const store: ReviewBookDoc[] = [...seed];
  const findMatch = (filter: Record<string, unknown>) =>
    store.find((d) => idEquals(d.puid, filter.puid) && idEquals(d.courseId, filter.courseId) && idEquals(d.questionId, filter.questionId));

  return {
    store,
    findOne: jest.fn(async (filter: Record<string, unknown>) => findMatch(filter) ?? null),
    updateOne: jest.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>, opts?: { upsert?: boolean }) => {
      let doc = findMatch(filter);
      if (!doc) {
        if (!opts?.upsert) return;
        doc = { ...(update.$setOnInsert as object) } as ReviewBookDoc;
        store.push(doc);
      }
      Object.assign(doc, update.$set ?? {});
      const addToSet = update.$addToSet as Record<string, unknown> | undefined;
      if (addToSet) {
        for (const [key, value] of Object.entries(addToSet)) {
          const arr = ((doc as unknown as Record<string, unknown[]>)[key] ??= []);
          if (!arr.includes(value)) arr.push(value);
        }
      }
    }),
  };
}

// --- Fixtures -----------------------------------------------------------------

const courseId = new ObjectId();
const questionId = new ObjectId();
const versionId = new ObjectId();
const loId = new ObjectId();
const themeId = new ObjectId();
const puid = 'PUID-STUDENT-0001';

const user: User = {
  puid,
  uid: 'student1',
  displayName: 'Student One',
  email: 'student1@example.ubc.ca',
  affiliations: ['student'],
  isAdmin: false,
  courseRoles: [{ courseId, role: 'student' }],
  createdAt: new Date(),
  lastLoginAt: new Date(),
};

const options: QuestionOption[] = [
  { key: 'A', text: 'Option A', role: 'correct', explanation: 'Because A is right.' },
  { key: 'B', text: 'Option B', role: 'common-misconception', explanation: 'Because B is a common trap.' },
  { key: 'C', text: 'Option C', role: 'partially-correct', explanation: 'Because C is halfway there.' },
  { key: 'D', text: 'Option D', role: 'clearly-wrong', explanation: 'Because D is way off.' },
];

function version(overrides: Partial<{ difficulty: string }> = {}) {
  return {
    _id: versionId,
    questionId,
    version: 1,
    type: 'mcq',
    stem: 'What is 2+2?',
    options,
    difficulty: overrides.difficulty ?? 'medium',
    sourceRefs: [],
    createdBy: 'seed',
    createdAt: new Date(),
  };
}

function questionHead(overrides: Partial<{ state: string; loIds: ObjectId[]; themeIds: ObjectId[] }> = {}) {
  return {
    _id: questionId,
    courseId,
    currentVersionId: versionId,
    currentVersion: 1,
    state: overrides.state ?? 'approved',
    loIds: overrides.loIds ?? [loId],
    themeIds: overrides.themeIds ?? [themeId],
    labels: [],
    internalNotes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** LearningObjective fixture — themeId is the single source of truth for
 * which theme an LO belongs to (a LearningObjective has exactly one
 * themeId); this is what the fix derives AttemptRecord.themeId from,
 * instead of the buggy question.themeIds[0]. */
function loDoc(id: ObjectId, loTheme: ObjectId) {
  return { _id: id, courseId, themeId: loTheme, name: 'An LO', order: 0 };
}

function courseDoc(feedbackStrategy: string) {
  return {
    _id: courseId,
    name: 'Intro to Finance',
    courseCode: 'COMM 298',
    term: '2026W1',
    ownerPuid: 'PUID-INSTR-0001',
    registrationCode: 'ABCD2345',
    published: true,
    feedbackStrategy,
    autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
    redirectFailureThreshold: 3,
    createdAt: new Date(),
  };
}

function seedCollections(opts: {
  feedbackStrategy: string;
  questionState?: string;
  reviewBookSeed?: ReviewBookDoc[];
  loIds?: ObjectId[];
  themeIds?: ObjectId[];
  los?: ReturnType<typeof loDoc>[];
}) {
  jest.mocked(questionVersionsCol).mockReturnValue(makeReadOnlyCol([version()]) as never);
  jest
    .mocked(questionsCol)
    .mockReturnValue(makeReadOnlyCol([questionHead({ state: opts.questionState, loIds: opts.loIds, themeIds: opts.themeIds })]) as never);
  jest.mocked(coursesCol).mockReturnValue(makeReadOnlyCol([courseDoc(opts.feedbackStrategy)]) as never);
  jest.mocked(losCol).mockReturnValue(makeReadOnlyCol(opts.los ?? [loDoc(loId, themeId)]) as never);
  const reviewBookFake = makeReviewBookFake(opts.reviewBookSeed);
  jest.mocked(reviewBookCol).mockReturnValue(reviewBookFake as never);
  return reviewBookFake;
}

function baseInput(overrides: Partial<{ selectedKey: string; isRetry: boolean }> = {}) {
  return {
    user,
    questionVersionId: versionId,
    loId,
    mode: 'topic-practice' as const,
    selectedKey: overrides.selectedKey ?? 'A',
    sessionServedIds: [],
    ...(overrides.isRetry !== undefined ? { isRetry: overrides.isRetry } : {}),
  };
}

beforeEach(() => {
  jest.mocked(recordAttemptInMastery).mockReset();
  jest.mocked(getLoStatuses).mockReset();
  jest.mocked(themeCoverage).mockReset();
  jest.mocked(selectRetryQuestion).mockReset();

  jest.mocked(getLoStatuses).mockResolvedValue(new Map());
  jest.mocked(recordAttemptInMastery).mockResolvedValue({
    puid,
    courseId,
    loId,
    status: 'in-progress',
    attemptCount: 1,
    windowAccuracy: 1,
    windowRoles: {},
    currentTier: 'medium',
    attemptsSinceEvaluation: 1,
    updatedAt: new Date(),
  } as never);
});

// --- Case 1: decideStrategy truth table ---------------------------------------

describe('decideStrategy', () => {
  it.each([
    ['strategy-a', 'common-misconception', 'a'],
    ['strategy-a', 'clearly-wrong', 'a'],
    ['strategy-b', 'common-misconception', 'b'],
    ['strategy-b', 'clearly-wrong', 'b'],
    ['adaptive', 'common-misconception', 'a'],
    ['adaptive', 'clearly-wrong', 'b'],
  ] as const)('case 1: %s + %s -> %s', (courseStrategy, role, expected) => {
    expect(decideStrategy(courseStrategy, role)).toBe(expected);
  });
});

// --- Case 2: correct answer -----------------------------------------------------

describe('submitAttempt: correct answer', () => {
  it('case 2: revealed includes all options; no review-book write', async () => {
    const reviewBook = seedCollections({ feedbackStrategy: 'adaptive' });

    const result = await submitAttempt(baseInput({ selectedKey: 'A' }));

    expect(result.correct).toBe(true);
    expect(result.feedback.revealed).toHaveLength(4);
    expect(result.feedback.retry).toBeUndefined();
    expect(result.reviewBook.added).toBe(false);
    expect(reviewBook.updateOne).not.toHaveBeenCalled();
  });
});

// --- Case 3: adaptive + CM miss --------------------------------------------------

describe('submitAttempt: adaptive + common-misconception miss', () => {
  it('case 3: revealed has ONLY the chosen option; retry returned; review-book upserted BEFORE retry resolves', async () => {
    const reviewBook = seedCollections({ feedbackStrategy: 'adaptive' });
    const retryQuestionId = new ObjectId();
    const retryVersionId = new ObjectId();
    jest.mocked(selectRetryQuestion).mockResolvedValue({
      question: { _id: retryQuestionId } as never,
      version: {
        _id: retryVersionId,
        type: 'mcq',
        stem: 'A retry question',
        options: [
          { key: 'A', text: 'Retry A', role: 'correct', explanation: 'x' },
          { key: 'B', text: 'Retry B', role: 'clearly-wrong', explanation: 'y' },
        ],
      } as never,
      degraded: 'none',
    });

    const result = await submitAttempt(baseInput({ selectedKey: 'B' }));

    expect(result.correct).toBe(false);
    expect(result.feedback.strategy).toBe('a');
    expect(result.feedback.revealed).toHaveLength(1);
    expect(result.feedback.revealed[0].key).toBe('B');
    expect(result.feedback.retry).toEqual({
      questionId: retryQuestionId.toString(),
      questionVersionId: retryVersionId.toString(),
      type: 'mcq',
      stem: 'A retry question',
      options: [
        { key: 'A', text: 'Retry A' },
        { key: 'B', text: 'Retry B' },
      ],
    });
    expect(result.reviewBook.added).toBe(true);

    // Ordering: the review-book upsert must happen BEFORE selectRetryQuestion resolves.
    expect(reviewBook.updateOne).toHaveBeenCalled();
    const upsertOrder = reviewBook.updateOne.mock.invocationCallOrder[0];
    const retryOrder = jest.mocked(selectRetryQuestion).mock.invocationCallOrder[0];
    expect(upsertOrder).toBeLessThan(retryOrder);
  });
});

// --- Case 4: no retry available -> degrade to full reveal ------------------------

describe('submitAttempt: adaptive + CM miss with no retry available', () => {
  it('case 4: degrades to full reveal, no retry field, strategy stays a', async () => {
    seedCollections({ feedbackStrategy: 'adaptive' });
    jest.mocked(selectRetryQuestion).mockResolvedValue(null);

    const result = await submitAttempt(baseInput({ selectedKey: 'B' }));

    expect(result.feedback.strategy).toBe('a');
    expect(result.feedback.revealed).toHaveLength(4);
    expect(result.feedback.retry).toBeUndefined();
  });
});

// --- Case 5: adaptive + clearly-wrong miss ---------------------------------------

describe('submitAttempt: adaptive + clearly-wrong miss', () => {
  it("case 5: uses strategy 'b', full reveal, no retry attempted", async () => {
    seedCollections({ feedbackStrategy: 'adaptive' });

    const result = await submitAttempt(baseInput({ selectedKey: 'D' }));

    expect(result.feedback.strategy).toBe('b');
    expect(result.feedback.revealed).toHaveLength(4);
    expect(result.feedback.retry).toBeUndefined();
    expect(selectRetryQuestion).not.toHaveBeenCalled();
  });
});

// --- Case 6: locked strategy-b wins over role -------------------------------------

describe('submitAttempt: locked strategy-b course', () => {
  it("case 6: strategy 'b' regardless of role (lock wins)", async () => {
    seedCollections({ feedbackStrategy: 'strategy-b' });

    const result = await submitAttempt(baseInput({ selectedKey: 'B' }));

    expect(result.feedback.strategy).toBe('b');
    expect(result.feedback.revealed).toHaveLength(4);
    expect(selectRetryQuestion).not.toHaveBeenCalled();
  });
});

// --- Case 7: repeat miss updates the same review-book entry ----------------------

describe('submitAttempt: repeat miss on the same question', () => {
  it('case 7: reviewBook upsert updates the same entry (no duplicate), updatedAt advances', async () => {
    const oldAttemptId = new ObjectId();
    const addedAt = new Date('2026-01-01T00:00:00Z');
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    const reviewBook = seedCollections({
      feedbackStrategy: 'strategy-b',
      reviewBookSeed: [
        {
          puid,
          courseId,
          questionId,
          sources: ['auto'],
          triggeringAttemptId: oldAttemptId,
          loId,
          themeId,
          addedAt,
          updatedAt,
        },
      ],
    });

    const result = await submitAttempt(baseInput({ selectedKey: 'D' }));

    expect(result.reviewBook.added).toBe(false);
    expect(reviewBook.store).toHaveLength(1);
    expect(reviewBook.store[0].triggeringAttemptId.equals(oldAttemptId)).toBe(false);
    expect(reviewBook.store[0].updatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
  });
});

// --- Case 8: retry attempts are full-weight, independent attempts ----------------

describe('submitAttempt: retry attempt', () => {
  it('case 8: writes AttemptRecord with isRetry:true; mastery service called identically', async () => {
    seedCollections({ feedbackStrategy: 'adaptive' });

    await submitAttempt(baseInput({ selectedKey: 'A', isRetry: true }));

    expect(recordAttemptInMastery).toHaveBeenCalledTimes(1);
    const [attempt] = jest.mocked(recordAttemptInMastery).mock.calls[0];
    expect(attempt.isRetry).toBe(true);
  });

  it('non-retry attempt writes isRetry:false', async () => {
    seedCollections({ feedbackStrategy: 'adaptive' });

    await submitAttempt(baseInput({ selectedKey: 'A' }));

    const [attempt] = jest.mocked(recordAttemptInMastery).mock.calls[0];
    expect(attempt.isRetry).toBe(false);
  });
});

// --- Case 9: AttemptRecord pins version/LO/mode/strategy/difficulty --------------

describe('submitAttempt: AttemptRecord pinning', () => {
  it('case 9: pins questionVersionId, loId, mode, strategy, difficulty', async () => {
    seedCollections({ feedbackStrategy: 'strategy-a' });

    await submitAttempt(baseInput({ selectedKey: 'A' }));

    const [attempt] = jest.mocked(recordAttemptInMastery).mock.calls[0];
    expect(attempt.questionVersionId.equals(versionId)).toBe(true);
    expect(attempt.loId.equals(loId)).toBe(true);
    expect(attempt.mode).toBe('topic-practice');
    expect(attempt.strategy).toBe('a');
    expect(attempt.difficulty).toBe('medium');
  });
});

// --- Case 10: non-approved question -> question-not-servable ---------------------

describe('submitAttempt: non-approved question', () => {
  it("case 10: throws 'question-not-servable' for a non-approved head", async () => {
    seedCollections({ feedbackStrategy: 'adaptive', questionState: 'draft' });

    await expect(submitAttempt(baseInput({ selectedKey: 'A' }))).rejects.toThrow('question-not-servable');
    expect(recordAttemptInMastery).not.toHaveBeenCalled();
  });
});

// --- Case 11: recommendation + themeId derivation (Task 11 review fix) -----------
//
// AttemptRecord.themeId must be "the LO context actually served under"
// (§5.1 multi-LO rule) — derived from the served LO's own themeId via
// losCol(), NOT question.themeIds[0]. A question tagged to LOs spanning
// multiple themes has no reliable "first" theme, and themeCoverage() must be
// evaluated against the theme the student was actually practicing, or
// 'advance-theme' can fire for a theme unrelated to the attempt.

describe('submitAttempt: recommendation', () => {
  it("case 11a: LO flips to covered but theme isn't fully covered -> 'advance-lo'", async () => {
    seedCollections({ feedbackStrategy: 'adaptive' });
    jest.mocked(getLoStatuses).mockResolvedValue(new Map([[loId.toHexString(), 'in-progress']]));
    jest.mocked(recordAttemptInMastery).mockResolvedValue({
      puid,
      courseId,
      loId,
      status: 'covered',
      attemptCount: 5,
      windowAccuracy: 1,
      windowRoles: {},
      currentTier: 'medium',
      attemptsSinceEvaluation: 5,
      updatedAt: new Date(),
    } as never);
    jest.mocked(themeCoverage).mockResolvedValue({ covered: false, includesSkipped: false });

    const result = await submitAttempt(baseInput({ selectedKey: 'A' }));

    expect(result.mastery.loStatus).toBe('covered');
    expect(result.mastery.recommendation).toBe('advance-lo');
    expect(themeCoverage).toHaveBeenCalledWith(puid, courseId, themeId);
    const [attempt] = jest.mocked(recordAttemptInMastery).mock.calls[0];
    expect(attempt.themeId.equals(themeId)).toBe(true);
  });

  it("case 11b: LO flips to covered AND completes the theme -> 'advance-theme' (theme supersedes LO)", async () => {
    seedCollections({ feedbackStrategy: 'adaptive' });
    jest.mocked(getLoStatuses).mockResolvedValue(new Map([[loId.toHexString(), 'in-progress']]));
    jest.mocked(recordAttemptInMastery).mockResolvedValue({
      puid,
      courseId,
      loId,
      status: 'covered',
      attemptCount: 5,
      windowAccuracy: 1,
      windowRoles: {},
      currentTier: 'medium',
      attemptsSinceEvaluation: 5,
      updatedAt: new Date(),
    } as never);
    jest.mocked(themeCoverage).mockResolvedValue({ covered: true, includesSkipped: false });

    const result = await submitAttempt(baseInput({ selectedKey: 'A' }));

    expect(result.mastery.loStatus).toBe('covered');
    expect(result.mastery.recommendation).toBe('advance-theme');
    expect(themeCoverage).toHaveBeenCalledWith(puid, courseId, themeId);
  });

  it('case 11c: question tagged to LOs spanning multiple themes -> themeId derives from the SERVED lo, not themeIds[0] (regression for the themeIds[0] bug)', async () => {
    // The question is tagged (many-to-many, IN-Q13) to two LOs in two
    // different themes. themeIds[0] is deliberately the WRONG theme (the one
    // NOT associated with the LO actually served) so this test would have
    // failed under the old `question.themeIds[0]` logic.
    const otherLoId = new ObjectId();
    const wrongThemeId = new ObjectId(); // themeIds[0] — NOT what was served
    const rightThemeId = new ObjectId(); // the served LO's real theme

    seedCollections({
      feedbackStrategy: 'adaptive',
      loIds: [otherLoId, loId],
      themeIds: [wrongThemeId, rightThemeId],
      los: [loDoc(otherLoId, wrongThemeId), loDoc(loId, rightThemeId)],
    });
    jest.mocked(getLoStatuses).mockResolvedValue(new Map([[loId.toHexString(), 'in-progress']]));
    jest.mocked(recordAttemptInMastery).mockResolvedValue({
      puid,
      courseId,
      loId,
      status: 'covered',
      attemptCount: 5,
      windowAccuracy: 1,
      windowRoles: {},
      currentTier: 'medium',
      attemptsSinceEvaluation: 5,
      updatedAt: new Date(),
    } as never);
    jest.mocked(themeCoverage).mockResolvedValue({ covered: true, includesSkipped: false });

    const result = await submitAttempt(baseInput({ selectedKey: 'A' }));

    // Correct behaviour: themeCoverage/AttemptRecord use rightThemeId (the
    // served LO's theme), never wrongThemeId (themeIds[0]).
    expect(themeCoverage).toHaveBeenCalledWith(puid, courseId, rightThemeId);
    expect(themeCoverage).not.toHaveBeenCalledWith(puid, courseId, wrongThemeId);
    expect(result.mastery.recommendation).toBe('advance-theme');

    const [attempt] = jest.mocked(recordAttemptInMastery).mock.calls[0];
    expect(attempt.themeId.equals(rightThemeId)).toBe(true);
    expect(attempt.themeId.equals(wrongThemeId)).toBe(false);
  });

  it("case 11d: throws 'lo-not-found' when the served LO does not exist (data-corruption guard)", async () => {
    seedCollections({ feedbackStrategy: 'adaptive', los: [] });

    await expect(submitAttempt(baseInput({ selectedKey: 'A' }))).rejects.toThrow('lo-not-found');
    expect(recordAttemptInMastery).not.toHaveBeenCalled();
  });
});
