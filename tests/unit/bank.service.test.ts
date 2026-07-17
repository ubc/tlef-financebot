import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import { questionsCol, questionVersionsCol } from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
}));

import {
  browseBank,
  reviewQueue,
  getQuestionCourseId,
  getDistinctQuestionCourseIds,
  getQuestionDetail,
} from '../../server/src/services/bank.service';
import type { Question, QuestionVersion } from '../../server/src/types/domain';

// Per-collection method mocks, wired onto the mocked accessors in beforeEach —
// follows tests/unit/questions.service.test.ts's mocking pattern.
const questionsFind = jest.fn();
const questionsFindToArray = jest.fn();
const questionsFindOne = jest.fn();
const questionsCountDocuments = jest.fn();
const questionsDistinct = jest.fn();
const versionsFind = jest.fn();
const versionsFindToArray = jest.fn();
const versionsSort = jest.fn();
const versionsFindOne = jest.fn();

beforeEach(() => {
  questionsFind.mockReset();
  questionsFindToArray.mockReset();
  questionsFindOne.mockReset();
  questionsCountDocuments.mockReset();
  questionsDistinct.mockReset();
  versionsFind.mockReset();
  versionsFindToArray.mockReset();
  versionsSort.mockReset();
  versionsFindOne.mockReset();

  questionsFind.mockReturnValue({ toArray: questionsFindToArray });
  versionsSort.mockReturnValue({ toArray: versionsFindToArray });
  versionsFind.mockReturnValue({ toArray: versionsFindToArray, sort: versionsSort });

  jest.mocked(questionsCol).mockReturnValue({
    find: questionsFind,
    findOne: questionsFindOne,
    countDocuments: questionsCountDocuments,
    distinct: questionsDistinct,
  } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({
    find: versionsFind,
    findOne: versionsFindOne,
  } as never);
});

const courseId = new ObjectId();

function makeQuestion(overrides: Partial<WithId<Question>> = {}): WithId<Question> {
  const versionId = new ObjectId();
  return {
    _id: new ObjectId(),
    courseId,
    currentVersionId: versionId,
    currentVersion: 1,
    state: 'draft',
    loIds: [new ObjectId()],
    themeIds: [new ObjectId()],
    labels: [],
    internalNotes: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeVersion(questionId: ObjectId, versionId: ObjectId, overrides: Partial<WithId<QuestionVersion>> = {}): WithId<QuestionVersion> {
  return {
    _id: versionId,
    questionId,
    version: 1,
    type: 'mcq',
    stem: 'Stem',
    options: [],
    difficulty: 'easy',
    sourceRefs: [],
    createdBy: 'pipeline',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// --- browseBank --------------------------------------------------------------

describe('browseBank (IN-Q08)', () => {
  it('filters by label separately from state — state stays a strict publication-state field', async () => {
    const head = makeQuestion({ labels: ['student-flagged'] });
    questionsFindToArray.mockResolvedValueOnce([head]);
    versionsFindToArray.mockResolvedValueOnce([makeVersion(head._id, head.currentVersionId)]);

    await browseBank(courseId, { label: 'student-flagged' });

    const [query] = questionsFind.mock.calls[0];
    expect(query.labels).toBe('student-flagged');
    expect(query.state).not.toBe('student-flagged');
  });

  it('hides archived questions by default', async () => {
    questionsFindToArray.mockResolvedValueOnce([]);
    versionsFindToArray.mockResolvedValueOnce([]);

    await browseBank(courseId, {});

    const [query] = questionsFind.mock.calls[0];
    expect(query.state).toEqual({ $ne: 'archived' });
  });

  it('includes archived questions when state: "archived" is requested explicitly', async () => {
    const archived = makeQuestion({ state: 'archived' });
    questionsFindToArray.mockResolvedValueOnce([archived]);
    versionsFindToArray.mockResolvedValueOnce([makeVersion(archived._id, archived.currentVersionId)]);

    const result = await browseBank(courseId, { state: 'archived' });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]._id).toEqual(archived._id);
  });

  it('includes archived questions when includeArchived is set', async () => {
    questionsFindToArray.mockResolvedValueOnce([]);
    versionsFindToArray.mockResolvedValueOnce([]);

    await browseBank(courseId, { includeArchived: true });

    const [query] = questionsFind.mock.calls[0];
    expect(query.state).toBeUndefined();
  });

  it('joins the current version onto each question via $in on currentVersionId', async () => {
    const head = makeQuestion();
    const version = makeVersion(head._id, head.currentVersionId, { stem: 'What is the WACC?' });
    questionsFindToArray.mockResolvedValueOnce([head]);
    versionsFindToArray.mockResolvedValueOnce([version]);

    const result = await browseBank(courseId, {});

    expect(result.total).toBe(1);
    expect(result.questions[0].current.stem).toBe('What is the WACC?');
    const [versionQuery] = versionsFind.mock.calls[0];
    expect(versionQuery).toEqual({ _id: { $in: [head.currentVersionId] } });
  });

  // type/difficulty live on the QuestionVersion, not the head, so they're
  // applied as a post-join JS filter (bank.service.ts:73-74) — never
  // exercised before this review finding.
  it('filters by type after the version join', async () => {
    const mcqHead = makeQuestion();
    const tfHead = makeQuestion();
    questionsFindToArray.mockResolvedValueOnce([mcqHead, tfHead]);
    versionsFindToArray.mockResolvedValueOnce([
      makeVersion(mcqHead._id, mcqHead.currentVersionId, { type: 'mcq' }),
      makeVersion(tfHead._id, tfHead.currentVersionId, { type: 'true-false' }),
    ]);

    const result = await browseBank(courseId, { type: 'true-false' });

    expect(result.total).toBe(1);
    expect(result.questions[0]._id).toEqual(tfHead._id);
  });

  it('filters by difficulty after the version join', async () => {
    const easyHead = makeQuestion();
    const hardHead = makeQuestion();
    questionsFindToArray.mockResolvedValueOnce([easyHead, hardHead]);
    versionsFindToArray.mockResolvedValueOnce([
      makeVersion(easyHead._id, easyHead.currentVersionId, { difficulty: 'easy' }),
      makeVersion(hardHead._id, hardHead.currentVersionId, { difficulty: 'hard' }),
    ]);

    const result = await browseBank(courseId, { difficulty: 'hard' });

    expect(result.total).toBe(1);
    expect(result.questions[0]._id).toEqual(hardHead._id);
  });

  it('applies type and difficulty filters together (both must match)', async () => {
    const match = makeQuestion();
    const wrongType = makeQuestion();
    const wrongDifficulty = makeQuestion();
    questionsFindToArray.mockResolvedValueOnce([match, wrongType, wrongDifficulty]);
    versionsFindToArray.mockResolvedValueOnce([
      makeVersion(match._id, match.currentVersionId, { type: 'true-false', difficulty: 'hard' }),
      makeVersion(wrongType._id, wrongType.currentVersionId, { type: 'mcq', difficulty: 'hard' }),
      makeVersion(wrongDifficulty._id, wrongDifficulty.currentVersionId, { type: 'true-false', difficulty: 'easy' }),
    ]);

    const result = await browseBank(courseId, { type: 'true-false', difficulty: 'hard' });

    expect(result.total).toBe(1);
    expect(result.questions[0]._id).toEqual(match._id);
  });
});

// --- reviewQueue ---------------------------------------------------------------

describe('reviewQueue (IN-Q02 ordering)', () => {
  it('orders flagged before reviewed before the rest, de-duplicated by id', async () => {
    const flagged = makeQuestion({ state: 'draft', labels: ['student-flagged'] });
    const reviewed = makeQuestion({ state: 'reviewed' });
    const freshLoId = new ObjectId();
    const fresh = makeQuestion({ state: 'draft', loIds: [freshLoId] });

    // reviewQueue issues three questionsCol().find() calls in tier order:
    // (1) student-flagged, (2) reviewed, (3) the rest — see bank.service.ts.
    questionsFindToArray
      .mockResolvedValueOnce([flagged])
      .mockResolvedValueOnce([reviewed])
      .mockResolvedValueOnce([flagged, reviewed, fresh]);
    questionsCountDocuments.mockResolvedValue(0);
    versionsFindToArray.mockResolvedValueOnce([
      makeVersion(flagged._id, flagged.currentVersionId),
      makeVersion(reviewed._id, reviewed.currentVersionId),
      makeVersion(fresh._id, fresh.currentVersionId),
    ]);

    const result = await reviewQueue(courseId);

    expect(result.map((q) => q._id)).toEqual([flagged._id, reviewed._id, fresh._id]);
    expect(result[0].priority).toBeLessThan(result[1].priority);
    expect(result[1].priority).toBeLessThan(result[2].priority);
  });

  it('excludes archived and approved questions from every tier', async () => {
    questionsFindToArray.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    versionsFindToArray.mockResolvedValueOnce([]);

    await reviewQueue(courseId);

    for (const [query] of questionsFind.mock.calls) {
      // Each tier's query either restricts state directly (e.g. the
      // 'reviewed' tier: state: 'reviewed') or via $nin — either way
      // 'archived' and 'approved' must never be reachable.
      if (typeof query.state === 'string') {
        expect(['archived', 'approved']).not.toContain(query.state);
      } else {
        expect(query.state.$nin).toEqual(expect.arrayContaining(['archived', 'approved']));
      }
    }
  });

  it('ranks the "rest" tier by under-coverage — fewest approved questions on the first LO first', async () => {
    const wellCoveredLo = new ObjectId();
    const thinLo = new ObjectId();
    const wellCovered = makeQuestion({ state: 'draft', loIds: [wellCoveredLo] });
    const thin = makeQuestion({ state: 'draft', loIds: [thinLo] });

    questionsFindToArray
      .mockResolvedValueOnce([]) // flagged
      .mockResolvedValueOnce([]) // reviewed
      .mockResolvedValueOnce([wellCovered, thin]); // rest
    questionsCountDocuments.mockImplementation(async ({ loIds }: { loIds: ObjectId }) => {
      if (loIds.equals(wellCoveredLo)) return 5;
      if (loIds.equals(thinLo)) return 0;
      return 0;
    });
    versionsFindToArray.mockResolvedValueOnce([
      makeVersion(wellCovered._id, wellCovered.currentVersionId),
      makeVersion(thin._id, thin.currentVersionId),
    ]);

    const result = await reviewQueue(courseId);

    expect(result.map((q) => q._id)).toEqual([thin._id, wellCovered._id]);
  });

  // Review finding 1: the coverage count must be course-scoped. PATCH
  // exposes loIds with no ownership check, so an instructor of course A can
  // tag their question with course B's LO id — without courseId in the
  // filter, that question would count toward B's approved coverage and skew
  // B's review-queue ordering. Pins the exact query shape passed to
  // countDocuments so a regression that drops courseId fails this test.
  it('scopes the under-coverage count to courseId — a same-LO question in another course must not affect it', async () => {
    const sharedLoId = new ObjectId();
    const thin = makeQuestion({ state: 'draft', loIds: [sharedLoId] });

    questionsFindToArray
      .mockResolvedValueOnce([]) // flagged
      .mockResolvedValueOnce([]) // reviewed
      .mockResolvedValueOnce([thin]); // rest
    questionsCountDocuments.mockResolvedValue(0);
    versionsFindToArray.mockResolvedValueOnce([makeVersion(thin._id, thin.currentVersionId)]);

    await reviewQueue(courseId);

    expect(questionsCountDocuments).toHaveBeenCalledWith({ courseId, loIds: sharedLoId, state: 'approved' });
  });

  // Review finding 7: two LO-less questions both rank Number.POSITIVE_INFINITY
  // for coverage; Infinity - Infinity is NaN, which a subtraction comparator
  // would hand to Array.prototype.sort. The explicit comparator must not
  // depend on sort's NaN-to-+0 coercion to keep both questions present and
  // ordered without throwing/dropping either.
  it('ranks two LO-less questions in the rest tier without relying on Infinity - Infinity coercion', async () => {
    const noLoA = makeQuestion({ state: 'draft', loIds: [] });
    const noLoB = makeQuestion({ state: 'draft', loIds: [] });

    questionsFindToArray
      .mockResolvedValueOnce([]) // flagged
      .mockResolvedValueOnce([]) // reviewed
      .mockResolvedValueOnce([noLoA, noLoB]); // rest
    versionsFindToArray.mockResolvedValueOnce([
      makeVersion(noLoA._id, noLoA.currentVersionId),
      makeVersion(noLoB._id, noLoB.currentVersionId),
    ]);

    const result = await reviewQueue(courseId);

    expect(result).toHaveLength(2);
    expect(result.map((q) => q._id.toString()).sort()).toEqual(
      [noLoA._id.toString(), noLoB._id.toString()].sort(),
    );
    // Neither question has an LO, so no coverage lookup should ever run.
    expect(questionsCountDocuments).not.toHaveBeenCalled();
  });
});

// --- loader helpers used by questions.routes.ts's stash middleware -----------

describe('getQuestionCourseId', () => {
  it('returns the courseId of an existing question', async () => {
    const questionId = new ObjectId();
    questionsFindOne.mockResolvedValue({ courseId });

    const result = await getQuestionCourseId(questionId);

    expect(result).toEqual(courseId);
    expect(questionsFindOne).toHaveBeenCalledWith({ _id: questionId }, expect.anything());
  });

  it('returns null for a missing question', async () => {
    questionsFindOne.mockResolvedValue(null);

    expect(await getQuestionCourseId(new ObjectId())).toBeNull();
  });
});

describe('getDistinctQuestionCourseIds', () => {
  it('returns the distinct courseIds among the given question ids', async () => {
    const ids = [new ObjectId(), new ObjectId()];
    questionsDistinct.mockResolvedValue([courseId]);

    const result = await getDistinctQuestionCourseIds(ids);

    expect(result).toEqual([courseId]);
    expect(questionsDistinct).toHaveBeenCalledWith('courseId', { _id: { $in: ids } });
  });
});

describe('getQuestionDetail', () => {
  it('returns the head, current version, and version-list metadata', async () => {
    const head = makeQuestion();
    const current = makeVersion(head._id, head.currentVersionId);
    questionsFindOne.mockResolvedValue(head);
    versionsFindOne.mockResolvedValue(current);
    versionsFindToArray.mockResolvedValueOnce([current]);

    const result = await getQuestionDetail(head._id);

    expect(result.question).toEqual(head);
    expect(result.current).toEqual(current);
    expect(result.versions).toEqual([
      { version: 1, createdBy: 'pipeline', createdAt: current.createdAt, editedFields: undefined },
    ]);
  });

  it('throws question-not-found for a missing question', async () => {
    questionsFindOne.mockResolvedValue(null);

    await expect(getQuestionDetail(new ObjectId())).rejects.toThrow('question-not-found');
  });
});
