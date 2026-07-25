import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import {
  notificationsCol,
  usersCol,
  coursesCol,
  flagsCol,
  questionsCol,
} from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  notificationsCol: jest.fn(),
  usersCol: jest.fn(),
  coursesCol: jest.fn(),
  flagsCol: jest.fn(),
  questionsCol: jest.fn(),
}));

// registerNotificationJobs() touches the jobs component -- mocked the same
// way materials.service.test.ts / generation.service.test.ts mock it, so
// importing notifications.service.ts never requires a started Agenda.
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), scheduleRecurring: jest.fn() }));

import {
  notify,
  notifyCourseStaff,
  checkReviewBacklog,
  runDailySummary,
} from '../../server/src/services/notifications.service';
import type { Course, User } from '../../server/src/types/domain';

const notificationsInsertOne = jest.fn();
const notificationsFind = jest.fn();
const notificationsFindToArray = jest.fn();
const notificationsFindOneAndUpdate = jest.fn();
const notificationsUpdateMany = jest.fn();

const usersFind = jest.fn();
const usersFindToArray = jest.fn();

const coursesFindOne = jest.fn();
const coursesFind = jest.fn();
const coursesFindToArray = jest.fn();
const coursesFindOneAndUpdate = jest.fn();

const flagsCountDocuments = jest.fn();
const questionsCountDocuments = jest.fn();

beforeEach(() => {
  notificationsInsertOne.mockReset();
  notificationsFind.mockReset();
  notificationsFindToArray.mockReset();
  notificationsFindOneAndUpdate.mockReset();
  notificationsUpdateMany.mockReset();
  usersFind.mockReset();
  usersFindToArray.mockReset();
  coursesFindOne.mockReset();
  coursesFind.mockReset();
  coursesFindToArray.mockReset();
  coursesFindOneAndUpdate.mockReset();
  flagsCountDocuments.mockReset();
  questionsCountDocuments.mockReset();

  notificationsInsertOne.mockResolvedValue({ acknowledged: true, insertedId: new ObjectId() });
  notificationsFind.mockReturnValue({ sort: () => ({ limit: () => ({ toArray: notificationsFindToArray }) }) });
  notificationsFindToArray.mockResolvedValue([]);
  usersFind.mockReturnValue({ toArray: usersFindToArray });
  usersFindToArray.mockResolvedValue([]);
  coursesFind.mockReturnValue({ toArray: coursesFindToArray });
  coursesFindToArray.mockResolvedValue([]);

  jest.mocked(notificationsCol).mockReturnValue({
    insertOne: notificationsInsertOne,
    find: notificationsFind,
    findOneAndUpdate: notificationsFindOneAndUpdate,
    updateMany: notificationsUpdateMany,
  } as never);
  jest.mocked(usersCol).mockReturnValue({ find: usersFind } as never);
  jest.mocked(coursesCol).mockReturnValue({
    findOne: coursesFindOne,
    find: coursesFind,
    findOneAndUpdate: coursesFindOneAndUpdate,
  } as never);
  jest.mocked(flagsCol).mockReturnValue({ countDocuments: flagsCountDocuments } as never);
  jest.mocked(questionsCol).mockReturnValue({ countDocuments: questionsCountDocuments } as never);
});

// --- Fixtures ------------------------------------------------------------

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

function staffUser(puid: string, role: 'instructor' | 'ta', courseId: ObjectId): WithId<User> {
  return {
    _id: new ObjectId(),
    puid,
    uid: puid.toLowerCase(),
    displayName: puid,
    email: `${puid}@example.com`,
    affiliations: [],
    isAdmin: false,
    courseRoles: [{ courseId, role }],
    createdAt: new Date('2026-01-01'),
    lastLoginAt: new Date('2026-01-01'),
  };
}

// --- notifyCourseStaff ------------------------------------------------------

describe('notifyCourseStaff', () => {
  it('1. flag emission targets exactly the course staff (instructor + TA), one notification each', async () => {
    const courseId = new ObjectId();
    const instructor = staffUser('PUID-INSTR-0001', 'instructor', courseId);
    const ta = staffUser('PUID-TA-0001', 'ta', courseId);
    usersFindToArray.mockResolvedValue([instructor, ta]);

    await notifyCourseStaff(courseId, { kind: 'flag', priority: 'standard', body: 'A question was flagged.' });

    // The staff query must scope by this course and only instructor/ta roles
    // -- never a student -- so a student courseRole entry could never match.
    expect(usersFind).toHaveBeenCalledWith(
      expect.objectContaining({
        courseRoles: { $elemMatch: { courseId, role: { $in: ['instructor', 'ta'] } } },
      }),
      expect.anything(),
    );

    expect(notificationsInsertOne).toHaveBeenCalledTimes(2);
    const recipients = notificationsInsertOne.mock.calls.map(([doc]) => doc.recipientPuid).sort();
    expect(recipients).toEqual(['PUID-INSTR-0001', 'PUID-TA-0001'].sort());
    for (const [doc] of notificationsInsertOne.mock.calls) {
      expect(doc.kind).toBe('flag');
      expect(doc.priority).toBe('standard');
      expect(doc.courseId).toEqual(courseId);
    }
  });

  it("2. auto-pause emits priority: 'elevated' to course staff", async () => {
    const courseId = new ObjectId();
    const instructor = staffUser('PUID-INSTR-0001', 'instructor', courseId);
    usersFindToArray.mockResolvedValue([instructor]);

    await notifyCourseStaff(courseId, {
      kind: 'auto-pause',
      priority: 'elevated',
      body: 'Question auto-paused after exceeding flag thresholds.',
      refType: 'question',
      refId: new ObjectId(),
    });

    expect(notificationsInsertOne).toHaveBeenCalledTimes(1);
    const [doc] = notificationsInsertOne.mock.calls[0];
    expect(doc.kind).toBe('auto-pause');
    expect(doc.priority).toBe('elevated');
    expect(doc.refType).toBe('question');
  });
});

// --- runDailySummary (notifications.daily-summary job) ----------------------

describe('runDailySummary', () => {
  it('3a. sends nothing on a quiet day (zero new flags, zero pending-review changes)', async () => {
    const course = baseCourse();
    coursesFindToArray.mockResolvedValue([course]);
    flagsCountDocuments.mockResolvedValue(0);
    questionsCountDocuments.mockResolvedValue(0);

    await runDailySummary();

    expect(notificationsInsertOne).not.toHaveBeenCalled();
  });

  it('3b. sends exactly one daily-summary notification per instructor on an active day', async () => {
    const course = baseCourse();
    coursesFindToArray.mockResolvedValue([course]);
    flagsCountDocuments.mockResolvedValue(3);
    questionsCountDocuments.mockResolvedValue(2);
    const instructorA = staffUser('PUID-INSTR-0001', 'instructor', course._id);
    const instructorB = staffUser('PUID-INSTR-0002', 'instructor', course._id);
    usersFindToArray.mockResolvedValue([instructorA, instructorB]);

    await runDailySummary();

    expect(notificationsInsertOne).toHaveBeenCalledTimes(2);
    const recipients = notificationsInsertOne.mock.calls.map(([doc]) => doc.recipientPuid).sort();
    expect(recipients).toEqual(['PUID-INSTR-0001', 'PUID-INSTR-0002'].sort());
    for (const [doc] of notificationsInsertOne.mock.calls) {
      expect(doc.kind).toBe('daily-summary');
      expect(doc.priority).toBe('standard');
    }
  });

  // Fixed post-review: checkReviewBacklog moved here from flags.service.ts's
  // flag-creation path (flagging a question never itself moves anything into
  // pending-review, so that trigger point was causally unrelated to what the
  // check measures). This pins that it now runs for every course visited by
  // this loop, and specifically that it is NOT skipped by the `total === 0`
  // early-continue -- the backlog condition is independent of the day's
  // flag/pending-review-change count.
  it('3c. runs checkReviewBacklog for every course even on a quiet day, and it still fires when the backlog is over threshold', async () => {
    const course = baseCourse({ reviewBacklogThreshold: 10 });
    coursesFindToArray.mockResolvedValue([course]);
    coursesFindOne.mockResolvedValue(course);
    flagsCountDocuments.mockResolvedValue(0); // quiet day: no new flags
    // Differentiate checkReviewBacklog's plain pending-review count query
    // (no updatedAt filter) from runDailySummary's own recent-changes query
    // (has an updatedAt filter) -- the backlog is over threshold overall,
    // but nothing changed in the last 24h.
    questionsCountDocuments.mockImplementation((filter: Record<string, unknown>) =>
      Promise.resolve('updatedAt' in filter ? 0 : 12),
    );
    coursesFindOneAndUpdate.mockResolvedValueOnce(course);
    const instructor = staffUser('PUID-INSTR-0001', 'instructor', course._id);
    usersFindToArray.mockResolvedValue([instructor]);

    await runDailySummary();

    // The daily-summary total (newFlags + pendingReviewChanges) is 0, so no
    // daily-summary notification goes out -- but the backlog check still ran
    // and still fired its own review-backlog notification.
    expect(notificationsInsertOne).toHaveBeenCalledTimes(1);
    const [doc] = notificationsInsertOne.mock.calls[0];
    expect(doc.kind).toBe('review-backlog');
  });
});

// --- checkReviewBacklog (§9.1) ----------------------------------------------

describe('checkReviewBacklog', () => {
  it('4. backlog notification is NOT repeated within 24h -- the second check in the window sends nothing', async () => {
    const course = baseCourse({ reviewBacklogThreshold: 10 });
    coursesFindOne.mockResolvedValue(course);
    questionsCountDocuments.mockResolvedValue(12); // over threshold
    const instructor = staffUser('PUID-INSTR-0001', 'instructor', course._id);
    usersFindToArray.mockResolvedValue([instructor]);

    // First check: no prior lastBacklogNotifiedAt -- the CAS update claims
    // the notification slot and a real doc comes back.
    coursesFindOneAndUpdate.mockResolvedValueOnce(course);
    const first = await checkReviewBacklog(course._id);
    expect(first).toBe(true);
    expect(notificationsInsertOne).toHaveBeenCalledTimes(1);

    // Pin the actual CAS mechanism itself -- not just the externally observed
    // call count -- so this test would fail if the atomic filter were ever
    // weakened (e.g. filtering only by _id) or if lastBacklogNotifiedAt were
    // never actually stamped.
    expect(coursesFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filterArg, updateArg] = coursesFindOneAndUpdate.mock.calls[0];
    expect(filterArg).toMatchObject({ _id: course._id });
    expect(Array.isArray(filterArg.$or)).toBe(true);
    expect(filterArg.$or).toContainEqual({ lastBacklogNotifiedAt: { $exists: false } });
    expect(
      filterArg.$or.some(
        (clause: Record<string, unknown>) =>
          typeof clause.lastBacklogNotifiedAt === 'object' &&
          clause.lastBacklogNotifiedAt !== null &&
          '$lt' in (clause.lastBacklogNotifiedAt as Record<string, unknown>) &&
          (clause.lastBacklogNotifiedAt as { $lt: unknown }).$lt instanceof Date,
      ),
    ).toBe(true);
    expect(updateArg).toMatchObject({ $set: { lastBacklogNotifiedAt: expect.any(Date) } });

    // Second check within the same 24h window: the CAS filter (unset OR
    // older than 24h) no longer matches server-side, so findOneAndUpdate
    // returns null and NO further notification is sent.
    coursesFindOneAndUpdate.mockResolvedValueOnce(null);
    const second = await checkReviewBacklog(course._id);
    expect(second).toBe(false);
    expect(notificationsInsertOne).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the pending-review count is under threshold', async () => {
    const course = baseCourse({ reviewBacklogThreshold: 10 });
    coursesFindOne.mockResolvedValue(course);
    questionsCountDocuments.mockResolvedValue(4);

    const result = await checkReviewBacklog(course._id);

    expect(result).toBe(false);
    expect(coursesFindOneAndUpdate).not.toHaveBeenCalled();
    expect(notificationsInsertOne).not.toHaveBeenCalled();
  });
});

// --- notify -------------------------------------------------------------------

describe('notify', () => {
  it('persists every provided field, including refType/refId', async () => {
    const courseId = new ObjectId();
    const refId = new ObjectId();

    await notify({
      recipientPuid: 'PUID-STU-0001',
      courseId,
      kind: 'flag-resolved',
      priority: 'standard',
      body: 'Your flag was resolved.',
      refType: 'flag',
      refId,
    });

    expect(notificationsInsertOne).toHaveBeenCalledTimes(1);
    const [doc] = notificationsInsertOne.mock.calls[0];
    expect(doc).toMatchObject({
      recipientPuid: 'PUID-STU-0001',
      courseId,
      kind: 'flag-resolved',
      priority: 'standard',
      body: 'Your flag was resolved.',
      refType: 'flag',
      refId,
    });
    expect(doc.createdAt).toBeInstanceOf(Date);
  });
});
