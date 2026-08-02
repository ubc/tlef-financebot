import type { ObjectId, WithId } from 'mongodb';
import {
  notificationsCol,
  usersCol,
  coursesCol,
  flagsCol,
  questionsCol,
} from '../components/mongodb/collections';
import { defineJob, scheduleRecurring } from '../components/jobs';
import type { Notification } from '../types/domain';

// -----------------------------------------------------------------------------
// Notifications service (§4.3, §9.1): in-app notification creation, the
// pending-review backlog check, and the recurring daily-summary job. Consumed
// by flags.service.ts (new flag / auto-pause / flag-resolved emissions) and
// notifications.routes.ts (poll/read/read-all). See server/src/services/AGENTS.md
// and server/src/components/jobs/AGENTS.md for the registerNotificationJobs()
// pattern this file follows.
// -----------------------------------------------------------------------------

export const DAILY_SUMMARY_JOB = 'notifications.daily-summary';

/** §9.1 default when a course has no explicit reviewBacklogThreshold set —
 * mirrors courses.service.ts's createCourse default. Only relevant for
 * documents written before this field existed; every course created after
 * this change always has the field set. */
const DEFAULT_REVIEW_BACKLOG_THRESHOLD = 10;

const BACKLOG_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1000;

const NOTIFICATIONS_LIST_LIMIT = 50;

export interface NotifyInput {
  recipientPuid: string;
  courseId?: ObjectId;
  kind: Notification['kind'];
  priority: 'standard' | 'elevated';
  body: string;
  refType?: string;
  refId?: ObjectId;
}

/** Insert a single notification. The lowest-level primitive every other
 * emission point in this file (and flags.service.ts) ultimately calls. */
export async function notify(input: NotifyInput): Promise<void> {
  const doc: Notification = {
    recipientPuid: input.recipientPuid,
    ...(input.courseId ? { courseId: input.courseId } : {}),
    kind: input.kind,
    priority: input.priority,
    body: input.body,
    ...(input.refType !== undefined ? { refType: input.refType } : {}),
    ...(input.refId ? { refId: input.refId } : {}),
    createdAt: new Date(),
  };
  await notificationsCol().insertOne(doc);
}

/** Resolve a course's instructor(s) and TAs from `User.courseRoles` — never a
 * student, regardless of what else is passed in. */
async function courseStaffPuids(courseId: ObjectId): Promise<string[]> {
  const staff = await usersCol()
    .find(
      { courseRoles: { $elemMatch: { courseId, role: { $in: ['instructor', 'ta'] } } } },
      { projection: { puid: 1 } },
    )
    .toArray();
  return staff.map((user) => user.puid);
}

/** Notify every instructor/TA on a course (new flag, auto-pause). One
 * notification document per staff member. */
export async function notifyCourseStaff(
  courseId: ObjectId,
  input: Omit<NotifyInput, 'recipientPuid' | 'courseId'>,
): Promise<void> {
  const puids = await courseStaffPuids(courseId);
  await Promise.all(puids.map((puid) => notify({ ...input, recipientPuid: puid, courseId })));
}

/**
 * §9.1: pending-review backlog past the instructor-set threshold ->
 * `review-backlog` notification to course staff, emitted at most once per
 * 24h per course. Called from runDailySummary's per-course loop below —
 * that job already iterates every course once a day independent of flag
 * activity, which is the natural home for a check whose measured quantity
 * (pending-review count) flag creation never actually moves. (Previously
 * called from flags.service.ts's flag-creation path; moved here because
 * flagging a question never transitions it into pending-review, so that
 * trigger point was causally unrelated to what this check measures.)
 *
 * The "not repeated within 24h" guarantee must hold under CONCURRENT flag
 * creation, not just in-process timing — so the check-and-claim happens in a
 * single atomic `findOneAndUpdate` CAS on the course document itself (filter:
 * `lastBacklogNotifiedAt` unset or older than the cooldown window; update:
 * stamp it to now). Only the caller that wins the CAS proceeds to notify;
 * every other concurrent caller's `findOneAndUpdate` simply fails to match
 * and returns null, so exactly one notification goes out even if many flags
 * land on the same course at once.
 */
export async function checkReviewBacklog(courseId: ObjectId): Promise<boolean> {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) return false;

  const threshold = course.reviewBacklogThreshold ?? DEFAULT_REVIEW_BACKLOG_THRESHOLD;
  const pendingCount = await questionsCol().countDocuments({ courseId, state: 'pending-review' });
  if (pendingCount < threshold) return false;

  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - BACKLOG_COOLDOWN_MS);
  const claimed = await coursesCol().findOneAndUpdate(
    {
      _id: courseId,
      $or: [{ lastBacklogNotifiedAt: { $exists: false } }, { lastBacklogNotifiedAt: { $lt: cooldownCutoff } }],
    },
    { $set: { lastBacklogNotifiedAt: now } },
  );
  if (!claimed) return false;

  await notifyCourseStaff(courseId, {
    kind: 'review-backlog',
    priority: 'standard',
    body: `${pendingCount} question${pendingCount === 1 ? '' : 's'} pending review (threshold: ${threshold}).`,
  });
  return true;
}

/**
 * Job `notifications.daily-summary` (recurring, every 24h): per course, count
 * new flags + questions that entered pending-review in the past 24h; only if
 * that total is nonzero, send one `daily-summary` standard notification to
 * each instructor (TAs are intentionally excluded here — the brief specifies
 * "instructor(s)" for this emission, unlike notifyCourseStaff's broader
 * instructor+TA target used by the other three). Also runs checkReviewBacklog
 * for every course, unconditionally — that check is an independent condition
 * from the day's flag/pending-review-change count, so it must not be skipped
 * by the `total === 0` short-circuit below.
 */
export async function runDailySummary(): Promise<void> {
  const since = new Date(Date.now() - DAILY_SUMMARY_WINDOW_MS);
  const courses = await coursesCol().find({}).toArray();

  for (const course of courses) {
    await checkReviewBacklog(course._id);

    const [newFlags, pendingReviewChanges] = await Promise.all([
      flagsCol().countDocuments({ courseId: course._id, createdAt: { $gte: since } }),
      questionsCol().countDocuments({ courseId: course._id, state: 'pending-review', updatedAt: { $gte: since } }),
    ]);
    const total = newFlags + pendingReviewChanges;
    if (total === 0) continue;

    const instructors = await usersCol()
      .find({ courseRoles: { $elemMatch: { courseId: course._id, role: 'instructor' } } }, { projection: { puid: 1 } })
      .toArray();
    const body =
      `${newFlags} new flag${newFlags === 1 ? '' : 's'} and ${pendingReviewChanges} ` +
      `question${pendingReviewChanges === 1 ? '' : 's'} moved to pending review in the past 24h.`;

    await Promise.all(
      instructors.map((instructor) =>
        notify({
          recipientPuid: instructor.puid,
          courseId: course._id,
          kind: 'daily-summary',
          priority: 'standard',
          body,
        }),
      ),
    );
  }
}

/**
 * Registers the `notifications.daily-summary` job handler AND schedules its
 * recurrence, in one call. Per components/jobs/AGENTS.md, `defineJob()` must
 * NEVER run at module scope — notifications.routes.ts (mounted by app.ts)
 * imports this service, and the compiled CommonJS import graph pulls it in
 * via a hoisted synchronous require() that runs before server.ts's main()
 * even starts, well before startJobs() has run. So this is an explicit
 * function, called from server.ts after startJobs() resolves — same shape as
 * materials.service.ts's registerMaterialJobs() and generation.service.ts's
 * registerGenerationJobs(). Tests mock the jobs component and never call this.
 */
export async function registerNotificationJobs(): Promise<void> {
  defineJob(DAILY_SUMMARY_JOB, () => runDailySummary());
  await scheduleRecurring(DAILY_SUMMARY_JOB, '24 hours');
}

// --- Routes surface: list / mark-read / mark-all-read -----------------------
// Kept here (rather than in notifications.routes.ts) per routes/AGENTS.md:
// "No database or SDK calls directly in a route." Every query below is
// scoped by the CALLER-SUPPLIED puid — notifications.routes.ts is
// responsible for passing the AUTHENTICATED user's own puid, never one taken
// from the request body/params, so a user can never read or mark-read
// another user's notifications.

export async function listNotifications(
  puid: string,
  opts?: { unreadOnly?: boolean },
): Promise<WithId<Notification>[]> {
  const filter = {
    recipientPuid: puid,
    ...(opts?.unreadOnly ? { readAt: { $exists: false } } : {}),
    // Dismissed notifications stay in the collection but leave the bell for
    // good -- the 30s client poll would otherwise resurrect anything the
    // user cleared.
    dismissedAt: { $exists: false },
  };
  return notificationsCol().find(filter).sort({ createdAt: -1 }).limit(NOTIFICATIONS_LIST_LIMIT).toArray();
}

/** Mark one notification read. Scoped by (id, recipientPuid) so a user can
 * only ever mark-read their OWN notifications — a mismatched id/puid pair
 * (wrong owner, or a nonexistent id) throws 'notification-not-found'. */
export async function markNotificationRead(id: ObjectId, puid: string): Promise<WithId<Notification>> {
  const updated = await notificationsCol().findOneAndUpdate(
    { _id: id, recipientPuid: puid },
    { $set: { readAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new Error('notification-not-found');
  return updated;
}

/** Mark every unread notification for this puid read; returns the count
 * touched. */
export async function markAllNotificationsRead(puid: string): Promise<number> {
  const result = await notificationsCol().updateMany(
    { recipientPuid: puid, readAt: { $exists: false } },
    { $set: { readAt: new Date() } },
  );
  return result.modifiedCount;
}

/** Dismiss one notification. Scoped by (id, recipientPuid) exactly like
 * markNotificationRead, so a user can only ever dismiss their OWN. */
export async function dismissNotification(id: ObjectId, puid: string): Promise<WithId<Notification>> {
  const updated = await notificationsCol().findOneAndUpdate(
    { _id: id, recipientPuid: puid },
    { $set: { dismissedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new Error('notification-not-found');
  return updated;
}

/** Dismiss every not-yet-dismissed notification for this puid ("Clear all");
 * returns the count touched. Deliberately clears read AND unread -- the bell
 * is a nudge surface, and the flag queue keeps the underlying work. */
export async function dismissAllNotifications(puid: string): Promise<number> {
  const result = await notificationsCol().updateMany(
    { recipientPuid: puid, dismissedAt: { $exists: false } },
    { $set: { dismissedAt: new Date() } },
  );
  return result.modifiedCount;
}
