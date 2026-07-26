import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import { attemptsCol, reviewBookCol } from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  attemptsCol: jest.fn(),
  reviewBookCol: jest.fn(),
}));

// notifications.service is mocked wholesale (same convention as
// flags.service.test.ts) so these tests stay about the remediation query /
// notify-fanout logic, not notification internals.
jest.mock('../../server/src/services/notifications.service', () => ({
  notify: jest.fn(),
}));

import { remediationReport, notifyAffectedStudents } from '../../server/src/services/remediation.service';
import { notify } from '../../server/src/services/notifications.service';
import type { AttemptRecord } from '../../server/src/types/domain';

const attemptsFind = jest.fn();
const attemptsFindToArray = jest.fn();
const attemptsDistinct = jest.fn();

const reviewBookCountDocuments = jest.fn();

beforeEach(() => {
  attemptsFind.mockReset();
  attemptsFindToArray.mockReset();
  attemptsDistinct.mockReset();
  reviewBookCountDocuments.mockReset();
  jest.mocked(notify).mockReset();

  attemptsFind.mockReturnValue({ toArray: attemptsFindToArray });
  attemptsFindToArray.mockResolvedValue([]);
  reviewBookCountDocuments.mockResolvedValue(0);

  jest.mocked(attemptsCol).mockReturnValue({
    find: attemptsFind,
    distinct: attemptsDistinct,
  } as never);
  jest.mocked(reviewBookCol).mockReturnValue({ countDocuments: reviewBookCountDocuments } as never);
});

// --- Fixtures ----------------------------------------------------------------

function baseAttempt(overrides: Partial<WithId<AttemptRecord>> = {}): WithId<AttemptRecord> {
  return {
    _id: new ObjectId(),
    puid: 'PUID-STU-0001',
    courseId: new ObjectId(),
    questionId: new ObjectId(),
    questionVersionId: new ObjectId(),
    loId: new ObjectId(),
    themeId: new ObjectId(),
    mode: 'topic-practice',
    strategy: 'a',
    selectedKey: 'A',
    correct: false,
    selectedRole: 'clearly-wrong',
    difficulty: 'medium',
    isRetry: false,
    createdAt: new Date('2026-01-05'),
    ...overrides,
  };
}

// --- remediationReport (§6.2 step 1) ------------------------------------------

describe('remediationReport (§6.2 step 1)', () => {
  it('counts only attempts pinned to the exact questionVersionId -- attempts on a different version of the same question are excluded', async () => {
    const questionId = new ObjectId();
    const badVersionId = new ObjectId();

    // The mocked `find` is not itself filtering (that's Mongo's job in
    // production); this test proves remediationReport queries `attemptsCol()`
    // with a filter scoped to the exact bad version, not the whole question --
    // by asserting the filter passed to attemptsCol().find(...), AND by only
    // resolving the "bad version" attempts from the mock (as production Mongo
    // would after applying that filter).
    const badAttempts = [
      baseAttempt({ questionId, questionVersionId: badVersionId, puid: 'PUID-STU-0001' }),
      baseAttempt({ questionId, questionVersionId: badVersionId, puid: 'PUID-STU-0002' }),
    ];
    attemptsFindToArray.mockResolvedValue(badAttempts);
    reviewBookCountDocuments.mockResolvedValue(1);

    const report = await remediationReport(badVersionId);

    // Exact-match form (Task 6 review fix, Minor 4) -- matches the
    // `reviewBookEntries` test below's convention. The previous
    // `objectContaining` + `not.toHaveBeenCalledWith(otherVersionId)` pair
    // was weaker than it read: `objectContaining` would still pass if the
    // implementation ALSO passed `questionId` in the filter (exactly the
    // over-broad query this test claims to guard against), and the negative
    // assertion was vacuous -- remediationReport makes exactly one `find`
    // call with whatever argument it's given, so no implementation could
    // fail it. Asserting the filter is EXACTLY `{ questionVersionId:
    // badVersionId }` (no `questionId`, no other keys) is the real guard.
    expect(attemptsFind).toHaveBeenCalledWith({ questionVersionId: badVersionId }, expect.anything());

    expect(report.affectedAttempts).toBe(2);
    expect(report.affectedStudents.sort()).toEqual(['PUID-STU-0001', 'PUID-STU-0002']);
  });

  it('affectedStudents is deduplicated when one student has multiple affected attempts', async () => {
    const versionId = new ObjectId();
    attemptsFindToArray.mockResolvedValue([
      baseAttempt({ questionVersionId: versionId, puid: 'PUID-STU-0001' }),
      baseAttempt({ questionVersionId: versionId, puid: 'PUID-STU-0001' }),
      baseAttempt({ questionVersionId: versionId, puid: 'PUID-STU-0002' }),
    ]);

    const report = await remediationReport(versionId);

    expect(report.affectedAttempts).toBe(3);
    expect(report.affectedStudents.sort()).toEqual(['PUID-STU-0001', 'PUID-STU-0002']);
  });

  it('examAttempts counts only the affected attempts that carry examAttemptId (exam-prep mode) -- resolved ambiguity #1, no examAttemptsCol() query', async () => {
    const versionId = new ObjectId();
    attemptsFindToArray.mockResolvedValue([
      baseAttempt({ questionVersionId: versionId, puid: 'PUID-STU-0001', mode: 'exam-prep', examAttemptId: new ObjectId() }),
      baseAttempt({ questionVersionId: versionId, puid: 'PUID-STU-0002', mode: 'topic-practice' }),
      baseAttempt({ questionVersionId: versionId, puid: 'PUID-STU-0003', mode: 'exam-prep', examAttemptId: new ObjectId() }),
    ]);

    const report = await remediationReport(versionId);

    expect(report.examAttempts).toBe(2);
  });

  it('examAttempts does not count an attempt with an explicit examAttemptId: null (Task 6 review fix, Minor 9)', async () => {
    const versionId = new ObjectId();
    attemptsFindToArray.mockResolvedValue([
      baseAttempt({ questionVersionId: versionId, puid: 'PUID-STU-0001', mode: 'exam-prep', examAttemptId: new ObjectId() }),
      // `examAttemptId: null` is not something any current writer sets, but
      // `!= null` (not `!== undefined`) is the correct guard so a nullable
      // field can't be miscounted if one ever does.
      baseAttempt({ questionVersionId: versionId, puid: 'PUID-STU-0002', mode: 'topic-practice', examAttemptId: null as never }),
    ]);

    const report = await remediationReport(versionId);

    expect(report.examAttempts).toBe(1);
  });

  it('reviewBookEntries is a count joined through the affected attempts\' _ids via triggeringAttemptId', async () => {
    const versionId = new ObjectId();
    const attempt1 = baseAttempt({ questionVersionId: versionId, puid: 'PUID-STU-0001' });
    const attempt2 = baseAttempt({ questionVersionId: versionId, puid: 'PUID-STU-0002' });
    attemptsFindToArray.mockResolvedValue([attempt1, attempt2]);
    reviewBookCountDocuments.mockResolvedValue(2);

    const report = await remediationReport(versionId);

    expect(reviewBookCountDocuments).toHaveBeenCalledWith({
      triggeringAttemptId: { $in: [attempt1._id, attempt2._id] },
    });
    expect(report.reviewBookEntries).toBe(2);
  });

  it('returns all-zero when there are no affected attempts, without querying reviewBookCol', async () => {
    const versionId = new ObjectId();
    attemptsFindToArray.mockResolvedValue([]);

    const report = await remediationReport(versionId);

    expect(report).toEqual({ affectedAttempts: 0, affectedStudents: [], reviewBookEntries: 0, examAttempts: 0 });
    expect(reviewBookCountDocuments).not.toHaveBeenCalled();
  });

  it('returns exactly the four specified fields -- no mastery field (resolved ambiguity #2)', async () => {
    const versionId = new ObjectId();
    attemptsFindToArray.mockResolvedValue([baseAttempt({ questionVersionId: versionId })]);

    const report = await remediationReport(versionId);

    expect(Object.keys(report).sort()).toEqual(
      ['affectedAttempts', 'affectedStudents', 'examAttempts', 'reviewBookEntries'].sort(),
    );
  });
});

// --- notifyAffectedStudents (§6.2 "Notify affected students" button) ---------

describe('notifyAffectedStudents', () => {
  it('notifies each distinct affected student exactly once, even when a student has multiple affected attempts', async () => {
    const versionId = new ObjectId();
    const courseId = new ObjectId();
    // Mongo's own `distinct` already dedupes server-side; the mock returns
    // the deduplicated set a real distinct() call against 3 attempts (2 from
    // the same student) would produce.
    attemptsDistinct.mockResolvedValue(['PUID-STU-0001', 'PUID-STU-0002']);

    const result = await notifyAffectedStudents(versionId, courseId);

    expect(attemptsDistinct).toHaveBeenCalledWith('puid', { questionVersionId: versionId });
    expect(notify).toHaveBeenCalledTimes(2);
    const recipients = jest.mocked(notify).mock.calls.map(([input]) => input.recipientPuid).sort();
    expect(recipients).toEqual(['PUID-STU-0001', 'PUID-STU-0002']);
    for (const [input] of jest.mocked(notify).mock.calls) {
      expect(input.kind).toBe('correction');
      expect(input.priority).toBe('standard'); // resolved ambiguity #6 -- 'elevated' is reserved for auto-pause
      expect(input.courseId).toEqual(courseId);
    }
    expect(result).toEqual({ notified: 2 });
  });

  it('notifies zero students when there are no affected attempts', async () => {
    const versionId = new ObjectId();
    const courseId = new ObjectId();
    attemptsDistinct.mockResolvedValue([]);

    const result = await notifyAffectedStudents(versionId, courseId);

    expect(notify).not.toHaveBeenCalled();
    expect(result).toEqual({ notified: 0 });
  });

  // Task 6 review fix (Minor 6): a rejected notify() must not throw the
  // whole batch away -- Promise.all previously meant one failure lost the
  // count of every notification that DID succeed, and left the "Notify
  // affected students" button visible for a retry that would double-notify
  // those already-succeeded students.
  it('a partial notify failure returns the count actually sent, logging the rejection, rather than throwing', async () => {
    const versionId = new ObjectId();
    const courseId = new ObjectId();
    attemptsDistinct.mockResolvedValue(['PUID-STU-0001', 'PUID-STU-0002', 'PUID-STU-0003']);
    jest
      .mocked(notify)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValueOnce(undefined as never);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await notifyAffectedStudents(versionId, courseId);

    expect(result).toEqual({ notified: 2 });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('a TOTAL notify failure (every recipient rejected) throws rather than reporting a false "0 notified" success', async () => {
    const versionId = new ObjectId();
    const courseId = new ObjectId();
    attemptsDistinct.mockResolvedValue(['PUID-STU-0001', 'PUID-STU-0002']);
    jest.mocked(notify).mockRejectedValue(new Error('smtp down'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(notifyAffectedStudents(versionId, courseId)).rejects.toThrow();

    errorSpy.mockRestore();
  });
});
