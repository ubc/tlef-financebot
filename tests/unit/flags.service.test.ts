import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import {
  flagsCol,
  questionsCol,
  questionVersionsCol,
  attemptsCol,
  coursesCol,
  auditCol,
} from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  flagsCol: jest.fn(),
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
  attemptsCol: jest.fn(),
  coursesCol: jest.fn(),
  auditCol: jest.fn(),
}));

import { flagQuestion, checkAutoPause, resolveFlag, listFlags, canFlagTransition } from '../../server/src/services/flags.service';
import type { Question, Course, Flag } from '../../server/src/types/domain';

// Per-collection method mocks, wired onto the mocked accessors in beforeEach —
// follows the tests/unit/questions.service.test.ts mocking pattern. flags.
// service calls the REAL questions.service.transitionQuestion (not mocked),
// so questionsFindOne/questionsUpdateOne/auditInsertOne double as the seams
// that exercise transitionQuestion's own CAS + audit behavior too.
const flagsFindOne = jest.fn();
const flagsInsertOne = jest.fn();
const flagsUpdateOne = jest.fn();
const flagsCountDocuments = jest.fn();
const flagsFind = jest.fn();
const flagsFindToArray = jest.fn();

const questionsFindOne = jest.fn();
const questionsUpdateOne = jest.fn();

const versionsFindOne = jest.fn();

const attemptsDistinct = jest.fn();

const coursesFindOne = jest.fn();

const auditInsertOne = jest.fn();

beforeEach(() => {
  flagsFindOne.mockReset();
  flagsInsertOne.mockReset();
  flagsUpdateOne.mockReset();
  flagsCountDocuments.mockReset();
  flagsFind.mockReset();
  flagsFindToArray.mockReset();
  questionsFindOne.mockReset();
  questionsUpdateOne.mockReset();
  versionsFindOne.mockReset();
  attemptsDistinct.mockReset();
  coursesFindOne.mockReset();
  auditInsertOne.mockReset();

  flagsInsertOne.mockResolvedValue({ acknowledged: true, insertedId: new ObjectId() });
  flagsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
  flagsFind.mockReturnValue({ toArray: flagsFindToArray });
  flagsFindToArray.mockResolvedValue([]);
  questionsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
  auditInsertOne.mockResolvedValue({ acknowledged: true });

  jest.mocked(flagsCol).mockReturnValue({
    findOne: flagsFindOne,
    insertOne: flagsInsertOne,
    updateOne: flagsUpdateOne,
    countDocuments: flagsCountDocuments,
    find: flagsFind,
  } as never);
  jest.mocked(questionsCol).mockReturnValue({
    findOne: questionsFindOne,
    updateOne: questionsUpdateOne,
  } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne: versionsFindOne } as never);
  jest.mocked(attemptsCol).mockReturnValue({ distinct: attemptsDistinct } as never);
  jest.mocked(coursesCol).mockReturnValue({ findOne: coursesFindOne } as never);
  jest.mocked(auditCol).mockReturnValue({ insertOne: auditInsertOne } as never);
});

// --- Fixtures ----------------------------------------------------------------

function baseCourse(overrides: Partial<WithId<Course>> = {}): WithId<Course> {
  return {
    _id: new ObjectId(),
    name: 'Intro to Finance',
    courseCode: 'COMM 298',
    term: '2026W1',
    ownerPuid: 'PUID-INSTR-0001',
    registrationCode: 'ABC123',
    published: true,
    feedbackStrategy: 'adaptive',
    autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
    redirectFailureThreshold: 3,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function baseQuestion(overrides: Partial<WithId<Question>> = {}): WithId<Question> {
  return {
    _id: new ObjectId(),
    courseId: new ObjectId(),
    currentVersionId: new ObjectId(),
    currentVersion: 1,
    state: 'draft',
    loIds: [],
    themeIds: [],
    labels: [],
    internalNotes: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function baseFlag(overrides: Partial<WithId<Flag>> = {}): WithId<Flag> {
  return {
    _id: new ObjectId(),
    courseId: new ObjectId(),
    questionId: new ObjectId(),
    questionVersionId: new ObjectId(),
    puid: 'PUID-STU-0001',
    state: 'open',
    createdAt: new Date('2026-01-05'),
    ...overrides,
  };
}

// --- flagQuestion (ST-P09) ----------------------------------------------------

describe('flagQuestion (ST-P09)', () => {
  it('1. first flag inserts state:open pinned to the CURRENT questionVersionId and adds the student-flagged label', async () => {
    const versionId = new ObjectId();
    const courseId = new ObjectId();
    const question = baseQuestion({ courseId, currentVersionId: versionId, currentVersion: 3, state: 'draft' });
    questionsFindOne.mockResolvedValue(question);
    flagsFindOne.mockResolvedValue(null);

    const result = await flagQuestion({ puid: 'PUID-STU-0001', questionId: question._id, reason: 'This looks wrong' });

    expect(result).toEqual({ flagged: true, duplicate: false });

    expect(flagsInsertOne).toHaveBeenCalledTimes(1);
    const [flagDoc] = flagsInsertOne.mock.calls[0];
    expect(flagDoc.state).toBe('open');
    expect(flagDoc.questionVersionId).toEqual(versionId);
    expect(flagDoc.questionId).toEqual(question._id);
    expect(flagDoc.courseId).toEqual(courseId);
    expect(flagDoc.puid).toBe('PUID-STU-0001');
    expect(flagDoc.reason).toBe('This looks wrong');

    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: question._id },
      { $addToSet: { labels: 'student-flagged' } },
    );
  });

  it('2. same student re-flags same version -> duplicate:true, insert not called', async () => {
    const question = baseQuestion({ state: 'draft' });
    questionsFindOne.mockResolvedValue(question);
    flagsFindOne.mockResolvedValue(baseFlag({ questionId: question._id, questionVersionId: question.currentVersionId, puid: 'PUID-STU-0001' }));

    const result = await flagQuestion({ puid: 'PUID-STU-0001', questionId: question._id });

    expect(result).toEqual({ flagged: true, duplicate: true });
    expect(flagsInsertOne).not.toHaveBeenCalled();
    expect(questionsUpdateOne).not.toHaveBeenCalled();
  });

  it('3. different student flags -> second record', async () => {
    const question = baseQuestion({ state: 'draft' });
    questionsFindOne.mockResolvedValue(question);
    flagsFindOne.mockResolvedValue(null);

    await flagQuestion({ puid: 'PUID-STU-0001', questionId: question._id });
    await flagQuestion({ puid: 'PUID-STU-0002', questionId: question._id });

    expect(flagsInsertOne).toHaveBeenCalledTimes(2);
    expect(flagsInsertOne.mock.calls[0][0].puid).toBe('PUID-STU-0001');
    expect(flagsInsertOne.mock.calls[1][0].puid).toBe('PUID-STU-0002');
  });
});

// --- checkAutoPause (§4.3) ----------------------------------------------------

describe('checkAutoPause (§4.3)', () => {
  function attempterPuids(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `PUID-STU-${i}`);
  }

  it('4. percentage arm: 5 distinct attempters, 2 open flags (40%) -> paused', async () => {
    const question = baseQuestion({ state: 'approved' });
    const course = baseCourse({ _id: question.courseId });
    questionsFindOne.mockResolvedValue(question);
    coursesFindOne.mockResolvedValue(course);
    attemptsDistinct.mockResolvedValue(attempterPuids(5));
    flagsCountDocuments.mockResolvedValue(2);

    const paused = await checkAutoPause(question._id);

    expect(paused).toBe(true);
    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: question._id, state: 'approved' },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'paused' }) }),
    );
    expect(auditInsertOne).toHaveBeenCalledTimes(1);
    expect(auditInsertOne.mock.calls[0][0].actorPuid).toBe('system:auto-pause');
  });

  it('5. small-sample guard: 3 attempters, 3 flags (100%) -> NOT paused', async () => {
    const question = baseQuestion({ state: 'approved' });
    const course = baseCourse({ _id: question.courseId });
    questionsFindOne.mockResolvedValue(question);
    coursesFindOne.mockResolvedValue(course);
    attemptsDistinct.mockResolvedValue(attempterPuids(3));
    flagsCountDocuments.mockResolvedValue(3);

    const paused = await checkAutoPause(question._id);

    expect(paused).toBe(false);
    expect(questionsUpdateOne).not.toHaveBeenCalled();
    expect(auditInsertOne).not.toHaveBeenCalled();
  });

  it('6. absolute arm: 15 flags, 100 attempters (15%) -> paused', async () => {
    const question = baseQuestion({ state: 'approved' });
    const course = baseCourse({ _id: question.courseId });
    questionsFindOne.mockResolvedValue(question);
    coursesFindOne.mockResolvedValue(course);
    attemptsDistinct.mockResolvedValue(attempterPuids(100));
    flagsCountDocuments.mockResolvedValue(15);

    const paused = await checkAutoPause(question._id);

    expect(paused).toBe(true);
    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: question._id, state: 'approved' },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'paused' }) }),
    );
  });

  it('7. thresholds read from course.autoPause override ({minAttempts:2, flagPercent:50, flagCount:99})', async () => {
    const question = baseQuestion({ state: 'approved' });
    const course = baseCourse({ _id: question.courseId, autoPause: { minAttempts: 2, flagPercent: 50, flagCount: 99 } });
    questionsFindOne.mockResolvedValue(question);
    coursesFindOne.mockResolvedValue(course);
    // 2 attempters, 1 open flag == 50% -- fails the DEFAULT thresholds
    // (minAttempts 5) but must pass under this course's overridden config.
    attemptsDistinct.mockResolvedValue(attempterPuids(2));
    flagsCountDocuments.mockResolvedValue(1);

    const paused = await checkAutoPause(question._id);

    expect(paused).toBe(true);
  });
});

// --- resolveFlag (§6.2) -------------------------------------------------------

describe('resolveFlag (§6.2)', () => {
  it("8. resolveFlag 'clear' closes the flag, question untouched", async () => {
    const questionId = new ObjectId();
    const flag = baseFlag({ questionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, state: 'approved' });
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);

    const result = await resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001');

    expect(result.state).toBe('resolved-cleared');
    expect(flagsUpdateOne).toHaveBeenCalledTimes(1);
    const [, update] = flagsUpdateOne.mock.calls[0];
    expect(update.$set.state).toBe('resolved-cleared');
    expect(update.$set.resolution).toMatchObject({ action: 'clear', puid: 'PUID-INSTR-0001' });

    // approved (not paused) -> the clear-path re-evaluation never fires, and
    // the question is never transitioned.
    expect(questionsUpdateOne).not.toHaveBeenCalled();
  });

  it("9. resolveFlag 'archive' transitions the question to archived", async () => {
    const questionId = new ObjectId();
    const flag = baseFlag({ questionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, state: 'approved' });
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);

    const result = await resolveFlag(flag._id, 'archive', 'PUID-INSTR-0001');

    expect(result.state).toBe('resolved-archived');
    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: questionId, state: 'approved' },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'archived' }) }),
    );
  });

  it('10. resolveFlag on an already-resolved flag throws invalid-flag-transition', async () => {
    const flag = baseFlag({ state: 'resolved-cleared' });
    flagsFindOne.mockResolvedValue(flag);

    await expect(resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001')).rejects.toThrow('invalid-flag-transition');

    expect(flagsUpdateOne).not.toHaveBeenCalled();
    expect(questionsUpdateOne).not.toHaveBeenCalled();
    expect(auditInsertOne).not.toHaveBeenCalled();
  });
});

// --- canFlagTransition ---------------------------------------------------------

describe('canFlagTransition', () => {
  it('allows open -> resolved-corrected and rejects a terminal state -> anything', () => {
    expect(canFlagTransition('open', 'resolved-corrected')).toBe(true);
    expect(canFlagTransition('resolved-archived', 'open')).toBe(false);
  });
});

// --- listFlags -----------------------------------------------------------------

describe('listFlags', () => {
  it('returns an empty array when the course has no matching flags', async () => {
    flagsFindToArray.mockResolvedValue([]);

    const result = await listFlags(new ObjectId(), 'open');

    expect(result).toEqual([]);
    expect(flagsFind).toHaveBeenCalledWith(expect.objectContaining({ state: 'open' }));
  });

  it('joins a flag with its question and current version', async () => {
    const questionId = new ObjectId();
    const versionId = new ObjectId();
    const courseId = new ObjectId();
    const flag = baseFlag({ courseId, questionId, questionVersionId: versionId });
    const question = baseQuestion({ _id: questionId, currentVersionId: versionId });
    const version = { _id: versionId, questionId, version: 1, type: 'mcq' as const, stem: 'Stem', options: [], difficulty: 'easy' as const, sourceRefs: [], createdBy: 'pipeline', createdAt: new Date() };

    flagsFindToArray.mockResolvedValue([flag]);
    questionsFindOne.mockResolvedValue(question);
    versionsFindOne.mockResolvedValue(version);

    const result = await listFlags(courseId);

    expect(result).toHaveLength(1);
    expect(result[0].question).toEqual(question);
    expect(result[0].currentVersion).toEqual(version);
    expect(flagsFind).toHaveBeenCalledWith({ courseId });
  });
});
