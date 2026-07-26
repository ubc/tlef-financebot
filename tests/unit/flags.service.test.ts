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

// notifications.service is mocked wholesale here (rather than mocking its
// underlying collections too) so these tests stay about the flag state
// machine / auto-pause formula, not notification internals -- those are
// covered by tests/unit/notifications.service.test.ts. See the "Task 3:
// notification wiring" describe block below for the wiring assertions.
jest.mock('../../server/src/services/notifications.service', () => ({
  notify: jest.fn(),
  notifyCourseStaff: jest.fn(),
  checkReviewBacklog: jest.fn(),
}));

// remediation.service (Task 6) is mocked wholesale too, for the same reason
// as notifications.service above: these tests are about resolveFlag's
// correctness-affecting WIRING (does it call remediationReport with the right
// version id? does it swallow a failure? does notifyRemediation delegate
// correctly?), not remediation.service's own query/dedup logic -- that's
// covered by tests/unit/remediation.service.test.ts.
jest.mock('../../server/src/services/remediation.service', () => ({
  remediationReport: jest.fn(),
  notifyAffectedStudents: jest.fn(),
}));

import { flagQuestion, checkAutoPause, resolveFlag, listFlags, canFlagTransition, notifyRemediation, remediationReportForFlag } from '../../server/src/services/flags.service';
import { notify, notifyCourseStaff, checkReviewBacklog } from '../../server/src/services/notifications.service';
import { remediationReport, notifyAffectedStudents } from '../../server/src/services/remediation.service';
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
  jest.mocked(notify).mockReset();
  jest.mocked(notifyCourseStaff).mockReset();
  jest.mocked(checkReviewBacklog).mockReset();
  jest.mocked(remediationReport).mockReset();
  jest.mocked(notifyAffectedStudents).mockReset();

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
    reviewBacklogThreshold: 10,
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

  it('7b. absolute-count arm is INDEPENDENT of the minAttempts small-sample guard (regression for the OR-grouping fix)', async () => {
    // 3 attempters (< default minAttempts:5) but 15 open flags (== default
    // flagCount:15). The plan's formula is
    // `(attempts>=minAttempts AND flag%>=flagPercent) OR (flagCount>=flagCount)`
    // -- the flagCount arm alone must fire this, regardless of attempt count.
    const question = baseQuestion({ state: 'approved' });
    const course = baseCourse({ _id: question.courseId });
    questionsFindOne.mockResolvedValue(question);
    coursesFindOne.mockResolvedValue(course);
    attemptsDistinct.mockResolvedValue(attempterPuids(3));
    flagsCountDocuments.mockResolvedValue(15);

    const paused = await checkAutoPause(question._id);

    expect(paused).toBe(true);
    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: question._id, state: 'approved' },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'paused' }) }),
    );
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

  it("9b. resolveFlag 'correct' un-pauses a paused question", async () => {
    const questionId = new ObjectId();
    const flag = baseFlag({ questionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, state: 'paused' });
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);

    const result = await resolveFlag(flag._id, 'correct', 'PUID-INSTR-0001');

    expect(result.state).toBe('resolved-corrected');
    // transitionQuestion's own CAS update proves the question-side effect
    // actually fired (paused -> approved), not just that no error was thrown.
    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: questionId, state: 'paused' },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'approved' }) }),
    );
    const [, flagUpdate] = flagsUpdateOne.mock.calls[0];
    expect(flagUpdate.$set.state).toBe('resolved-corrected');
  });

  it("9c. resolveFlag 'clear' on a paused question un-pauses when the remaining open-flag/attempt counts no longer meet the auto-pause threshold", async () => {
    const questionId = new ObjectId();
    const versionId = new ObjectId();
    const flag = baseFlag({ questionId, questionVersionId: versionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, currentVersionId: versionId, state: 'paused' });
    const course = baseCourse({ _id: question.courseId }); // default: minAttempts 5, flagPercent 30, flagCount 15
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);
    coursesFindOne.mockResolvedValue(course);
    // After excluding this flag: 5 attempters, 0 remaining open flags (0%) --
    // neither arm of the threshold is met any more.
    attemptsDistinct.mockResolvedValue(Array.from({ length: 5 }, (_, i) => `PUID-STU-${i}`));
    flagsCountDocuments.mockResolvedValue(0);

    const result = await resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001');

    expect(result.state).toBe('resolved-cleared');
    // The re-count query must exclude the just-resolved flag by _id.
    expect(flagsCountDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $ne: flag._id } }),
    );
    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: questionId, state: 'paused' },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'approved' }) }),
    );
  });

  it("9d. resolveFlag 'clear' on a paused question stays paused when the remaining open flags STILL meet the threshold", async () => {
    const questionId = new ObjectId();
    const versionId = new ObjectId();
    const flag = baseFlag({ questionId, questionVersionId: versionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, currentVersionId: versionId, state: 'paused' });
    const course = baseCourse({ _id: question.courseId }); // default flagCount: 15
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);
    coursesFindOne.mockResolvedValue(course);
    // After excluding this flag, 15 open flags still remain -> absolute
    // flagCount arm still met -> question must stay paused.
    attemptsDistinct.mockResolvedValue(Array.from({ length: 3 }, (_, i) => `PUID-STU-${i}`));
    flagsCountDocuments.mockResolvedValue(15);

    const result = await resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001');

    expect(result.state).toBe('resolved-cleared');
    // No question-state transition attempted -- the flag document write is
    // the ONLY questionsUpdateOne-adjacent write; questionsUpdateOne itself
    // (the question-state CAS update) must not be called at all.
    expect(questionsUpdateOne).not.toHaveBeenCalled();
  });

  it('10. resolveFlag on an already-resolved flag throws invalid-flag-transition', async () => {
    const flag = baseFlag({ state: 'resolved-cleared' });
    flagsFindOne.mockResolvedValue(flag);

    await expect(resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001')).rejects.toThrow('invalid-flag-transition');

    expect(flagsUpdateOne).not.toHaveBeenCalled();
    expect(questionsUpdateOne).not.toHaveBeenCalled();
    expect(auditInsertOne).not.toHaveBeenCalled();
  });

  it('10b. resolveFlag(\'archive\') on a question already archived (e.g. a second flag on the same question) propagates the domain error WITHOUT writing the flag to a terminal state', async () => {
    // Reproduces the deterministic (non-concurrent) two-open-flags-on-one-
    // question scenario: the question is already 'archived' by the time
    // this second flag's resolution runs. PUBLICATION_TRANSITIONS['archived']
    // = ['draft'], so transitionQuestion throws
    // invalid-transition:archived->archived -- and this flag must NOT be
    // left "resolved" with the consequence never having happened.
    const questionId = new ObjectId();
    const flag = baseFlag({ questionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, state: 'archived' });
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);

    await expect(resolveFlag(flag._id, 'archive', 'PUID-INSTR-0001')).rejects.toThrow(
      'invalid-transition:archived->archived',
    );

    expect(flagsUpdateOne).not.toHaveBeenCalled();
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

// --- Task 3: notification wiring ----------------------------------------------
// These assert flags.service calls notifications.service at exactly the three
// documented points -- new flag, auto-pause, flag-resolved -- with the right
// kind/priority/target. notifications.service's OWN behavior (staff
// resolution, tiering, backlog cooldown, daily summary) is covered by
// tests/unit/notifications.service.test.ts; here it's mocked wholesale.

describe('Task 3: notification wiring', () => {
  it('flagQuestion notifies course staff (kind: flag), but only for a NEW (non-duplicate) flag', async () => {
    const courseId = new ObjectId();
    const question = baseQuestion({ courseId, state: 'draft' });
    questionsFindOne.mockResolvedValue(question);
    flagsFindOne.mockResolvedValue(null);

    await flagQuestion({ puid: 'PUID-STU-0001', questionId: question._id });

    expect(notifyCourseStaff).toHaveBeenCalledWith(courseId, expect.objectContaining({ kind: 'flag', priority: 'standard' }));
    // checkReviewBacklog is NOT wired from flagQuestion (fixed post-review):
    // flagging a question never itself moves anything into pending-review,
    // so the backlog check now runs from runDailySummary's per-course loop
    // instead -- see notifications.service.test.ts's runDailySummary tests.
    expect(checkReviewBacklog).not.toHaveBeenCalled();
  });

  it('flagQuestion does NOT notify on a duplicate flag', async () => {
    const question = baseQuestion({ state: 'draft' });
    questionsFindOne.mockResolvedValue(question);
    flagsFindOne.mockResolvedValue(baseFlag({ questionId: question._id, questionVersionId: question.currentVersionId, puid: 'PUID-STU-0001' }));

    await flagQuestion({ puid: 'PUID-STU-0001', questionId: question._id });

    expect(notifyCourseStaff).not.toHaveBeenCalled();
  });

  it("checkAutoPause notifies course staff with priority: 'elevated' when it pauses a question", async () => {
    const question = baseQuestion({ state: 'approved' });
    const course = baseCourse({ _id: question.courseId });
    questionsFindOne.mockResolvedValue(question);
    coursesFindOne.mockResolvedValue(course);
    attemptsDistinct.mockResolvedValue(Array.from({ length: 5 }, (_, i) => `PUID-STU-${i}`));
    flagsCountDocuments.mockResolvedValue(2);

    await checkAutoPause(question._id);

    expect(notifyCourseStaff).toHaveBeenCalledWith(
      course._id,
      expect.objectContaining({ kind: 'auto-pause', priority: 'elevated' }),
    );
  });

  it('checkAutoPause does NOT notify when the thresholds are not met', async () => {
    const question = baseQuestion({ state: 'approved' });
    const course = baseCourse({ _id: question.courseId });
    questionsFindOne.mockResolvedValue(question);
    coursesFindOne.mockResolvedValue(course);
    attemptsDistinct.mockResolvedValue(Array.from({ length: 3 }, (_, i) => `PUID-STU-${i}`));
    flagsCountDocuments.mockResolvedValue(3);

    await checkAutoPause(question._id);

    expect(notifyCourseStaff).not.toHaveBeenCalled();
  });

  it("resolveFlag notifies the flagging student (kind: 'flag-resolved') on every resolution", async () => {
    const questionId = new ObjectId();
    const flag = baseFlag({ questionId, puid: 'PUID-STU-0007', state: 'open' });
    const question = baseQuestion({ _id: questionId, state: 'approved' });
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);

    await resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001');

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientPuid: 'PUID-STU-0007', kind: 'flag-resolved', priority: 'standard' }),
    );
  });

  it('resolveFlag does NOT notify when the transition is invalid (no state change happened)', async () => {
    const flag = baseFlag({ state: 'resolved-cleared' });
    flagsFindOne.mockResolvedValue(flag);

    await expect(resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001')).rejects.toThrow('invalid-flag-transition');

    expect(notify).not.toHaveBeenCalled();
  });

  // Fixed post-review: notifications are advisory and must never turn an
  // already-committed domain write into a thrown error / 500 for the caller
  // -- each site below already succeeded (flag inserted, question paused,
  // flag resolved+audited) before its notify call runs, so a notify()
  // rejection is logged and swallowed rather than propagated.
  describe('notification failures never propagate past the triggering operation', () => {
    it('flagQuestion resolves normally even when notifyCourseStaff rejects', async () => {
      const question = baseQuestion({ state: 'draft' });
      questionsFindOne.mockResolvedValue(question);
      flagsFindOne.mockResolvedValue(null);
      jest.mocked(notifyCourseStaff).mockRejectedValueOnce(new Error('mongo down'));

      await expect(flagQuestion({ puid: 'PUID-STU-0001', questionId: question._id })).resolves.toEqual({
        flagged: true,
        duplicate: false,
      });
    });

    it('checkAutoPause resolves true even when notifyCourseStaff rejects (the pause itself already committed)', async () => {
      const question = baseQuestion({ state: 'approved' });
      const course = baseCourse({ _id: question.courseId });
      questionsFindOne.mockResolvedValue(question);
      coursesFindOne.mockResolvedValue(course);
      attemptsDistinct.mockResolvedValue(Array.from({ length: 5 }, (_, i) => `PUID-STU-${i}`));
      flagsCountDocuments.mockResolvedValue(2);
      jest.mocked(notifyCourseStaff).mockRejectedValueOnce(new Error('mongo down'));

      await expect(checkAutoPause(question._id)).resolves.toBe(true);
      expect(questionsUpdateOne).toHaveBeenCalledWith(
        { _id: question._id, state: 'approved' },
        expect.objectContaining({ $set: expect.objectContaining({ state: 'paused' }) }),
      );
    });

    it("resolveFlag returns the resolved flag even when notify rejects (a retry must not hit invalid-flag-transition)", async () => {
      const questionId = new ObjectId();
      const flag = baseFlag({ questionId, puid: 'PUID-STU-0007', state: 'open' });
      const question = baseQuestion({ _id: questionId, state: 'approved' });
      flagsFindOne.mockResolvedValue(flag);
      questionsFindOne.mockResolvedValue(question);
      jest.mocked(notify).mockRejectedValueOnce(new Error('mongo down'));

      const result = await resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001');

      expect(result.state).toBe('resolved-cleared');
      expect(flagsUpdateOne).toHaveBeenCalledWith(
        { _id: flag._id },
        expect.objectContaining({ $set: expect.objectContaining({ state: 'resolved-cleared' }) }),
      );
    });
  });
});

// --- Task 6: correctness-affecting remediation wiring -------------------------

describe('Task 6: resolveFlag correctness-affecting remediation wiring', () => {
  it("resolveFlag({correctnessAffecting: true}) calls remediationReport(flag.questionVersionId) and returns its result on `remediation` (resolved ambiguity #3 -- report reaches the client on the resolve response)", async () => {
    const questionId = new ObjectId();
    const versionId = new ObjectId();
    const flag = baseFlag({ questionId, questionVersionId: versionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, state: 'approved' });
    const report = { affectedAttempts: 4, affectedStudents: ['PUID-STU-0001', 'PUID-STU-0002'], reviewBookEntries: 1, examAttempts: 1 };
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);
    jest.mocked(remediationReport).mockResolvedValue(report);

    const result = await resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001', { correctnessAffecting: true });

    expect(remediationReport).toHaveBeenCalledWith(versionId);
    expect(result.remediation).toEqual(report);
  });

  it('resolveFlag without correctnessAffecting never calls remediationReport, and the result carries no `remediation` field', async () => {
    const questionId = new ObjectId();
    const flag = baseFlag({ questionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, state: 'approved' });
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);

    const result = await resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001');

    expect(remediationReport).not.toHaveBeenCalled();
    expect(result.remediation).toBeUndefined();
  });

  it('a remediationReport failure never fails the (already-committed) resolution -- logs and omits `remediation` rather than propagating (resolved ambiguity #5)', async () => {
    const questionId = new ObjectId();
    const flag = baseFlag({ questionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, state: 'approved' });
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);
    jest.mocked(remediationReport).mockRejectedValueOnce(new Error('mongo down'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001', { correctnessAffecting: true });

    expect(result.state).toBe('resolved-cleared');
    expect(result.remediation).toBeUndefined();
    // The flag write already committed before the remediation branch runs.
    expect(flagsUpdateOne).toHaveBeenCalledWith(
      { _id: flag._id },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'resolved-cleared' }) }),
    );
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // Task 6 review fix (Finding 3): the resolve response's `remediation` is
  // one-shot and flags are terminal, so the ONLY way the remediation panel
  // can know -- after a reload -- whether a resolution was correctness-
  // affecting is a persisted bit on the flag's own `resolution` sub-document.
  it('resolveFlag({correctnessAffecting: true}) persists resolution.correctnessAffecting: true on the flag write and on the returned resolution', async () => {
    const questionId = new ObjectId();
    const flag = baseFlag({ questionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, state: 'approved' });
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);
    jest.mocked(remediationReport).mockResolvedValue({ affectedAttempts: 0, affectedStudents: [], reviewBookEntries: 0, examAttempts: 0 });

    const result = await resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001', { correctnessAffecting: true });

    const [, update] = flagsUpdateOne.mock.calls[0];
    expect(update.$set.resolution.correctnessAffecting).toBe(true);
    expect(result.resolution!.correctnessAffecting).toBe(true);
  });

  it('resolveFlag without correctnessAffecting omits the key entirely (never writes correctnessAffecting: false)', async () => {
    const questionId = new ObjectId();
    const flag = baseFlag({ questionId, state: 'open' });
    const question = baseQuestion({ _id: questionId, state: 'approved' });
    flagsFindOne.mockResolvedValue(flag);
    questionsFindOne.mockResolvedValue(question);

    const result = await resolveFlag(flag._id, 'clear', 'PUID-INSTR-0001');

    const [, update] = flagsUpdateOne.mock.calls[0];
    expect(Object.hasOwn(update.$set.resolution, 'correctnessAffecting')).toBe(false);
    expect(Object.hasOwn(result.resolution!, 'correctnessAffecting')).toBe(false);
  });
});

describe("Task 6: notifyRemediation ('Notify affected students' button)", () => {
  it('resolves the target flag and delegates to notifyAffectedStudents(questionVersionId, courseId)', async () => {
    const courseId = new ObjectId();
    const versionId = new ObjectId();
    const flag = baseFlag({ courseId, questionVersionId: versionId });
    flagsFindOne.mockResolvedValue(flag);
    jest.mocked(notifyAffectedStudents).mockResolvedValue({ notified: 3 });

    const result = await notifyRemediation(flag._id);

    expect(notifyAffectedStudents).toHaveBeenCalledWith(versionId, courseId);
    expect(result).toEqual({ notified: 3 });
  });

  it('throws flag-not-found for a nonexistent flag, without calling notifyAffectedStudents', async () => {
    flagsFindOne.mockResolvedValue(null);

    await expect(notifyRemediation(new ObjectId())).rejects.toThrow('flag-not-found');
    expect(notifyAffectedStudents).not.toHaveBeenCalled();
  });
});

// Task 6 review fix (Finding 3): `remediationReportForFlag` is the
// flag->version lookup GET /api/flags/:flagId/remediation calls into, so the
// remediation panel can regenerate its report after a reload (flags are
// terminal; the resolve response's one-shot `remediation` field is gone by
// then). Mirrors notifyRemediation's own lookup, tested just above.
describe('Task 6: remediationReportForFlag (GET /api/flags/:flagId/remediation)', () => {
  it("resolves the target flag and delegates to remediationReport(flag.questionVersionId)", async () => {
    const versionId = new ObjectId();
    const flag = baseFlag({ questionVersionId: versionId });
    const report = { affectedAttempts: 4, affectedStudents: ['PUID-STU-0001'], reviewBookEntries: 1, examAttempts: 0 };
    flagsFindOne.mockResolvedValue(flag);
    jest.mocked(remediationReport).mockResolvedValue(report);

    const result = await remediationReportForFlag(flag._id);

    expect(remediationReport).toHaveBeenCalledWith(versionId);
    expect(result).toEqual(report);
  });

  it('throws flag-not-found for a nonexistent flag, without calling remediationReport', async () => {
    flagsFindOne.mockResolvedValue(null);

    await expect(remediationReportForFlag(new ObjectId())).rejects.toThrow('flag-not-found');
    expect(remediationReport).not.toHaveBeenCalled();
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
