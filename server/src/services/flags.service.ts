import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import {
  flagsCol,
  questionsCol,
  questionVersionsCol,
  attemptsCol,
  coursesCol,
  auditCol,
} from '../components/mongodb/collections';
import { transitionQuestion } from './questions.service';
import { notify, notifyCourseStaff } from './notifications.service';
import { remediationReport, notifyAffectedStudents } from './remediation.service';
import type { RemediationReport } from './remediation.service';
import type { Flag, FlagState, Course, Question, QuestionVersion } from '../types/domain';

// -----------------------------------------------------------------------------
// Flag service (ST-P09, §4.3, §6.2): student flagging, the flag state
// machine, and configurable auto-pause. Flags attach to a specific
// QuestionVersion (never just the mutable Question head) so a later content
// edit doesn't retroactively misattribute or silently resolve a flag raised
// against stale content. Consumed by Task 2 (instructor flag-resolution
// queue UI, done) and Task 3 (notifications, wired below via
// notifications.service's notify()/notifyCourseStaff()). The pending-review
// backlog check (checkReviewBacklog) is NOT wired from here — it runs from
// notifications.service's runDailySummary per-course loop instead, since
// flagging a question never itself moves anything into pending-review.
// resolveFlag's correctness-affecting branch (§6.2, Task 6) delegates to
// remediation.service.ts for both the blast-radius report and the "Notify
// affected students" action — this file only calls into it, never queries
// attemptsCol()/reviewBookCol() directly. See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------

/** Flag case state machine — decoupled from PublicationState (PRD §6.2).
 * Every resolution is terminal: a resolved flag never reopens. A fresh flag
 * raised against the same version instead dedupes via flagQuestion's
 * idempotency check rather than reopening an old one. */
export const FLAG_TRANSITIONS: Record<FlagState, FlagState[]> = {
  open: ['escalated', 'resolved-corrected', 'resolved-archived', 'resolved-cleared'],
  escalated: ['resolved-corrected', 'resolved-archived', 'resolved-cleared'],
  'resolved-corrected': [],
  'resolved-archived': [],
  'resolved-cleared': [],
};

export function canFlagTransition(from: FlagState, to: FlagState): boolean {
  return FLAG_TRANSITIONS[from]?.includes(to) ?? false;
}

const RESOLUTION_TARGET_STATE: Record<'correct' | 'archive' | 'clear', FlagState> = {
  correct: 'resolved-corrected',
  archive: 'resolved-archived',
  clear: 'resolved-cleared',
};

/** Shared by checkAutoPause and resolveFlag's 'clear' re-evaluation so the
 * §4.3 formula lives in exactly one place. Two INDEPENDENT arms, OR'd
 * together, exactly per the phase-2 plan's Global Constraints:
 * `(attempts >= minAttempts AND flag% >= flagPercent) OR (flagCount >=
 * flagCount)`. The absolute-count arm is intentionally NOT gated behind the
 * minAttempts small-sample guard — that guard only protects the percentage
 * arm from firing off a tiny sample. (Fixed post-review: a prior version
 * incorrectly AND'd minAttempts across both arms.) */
function meetsAutoPauseThreshold(attemptersCount: number, openFlagCount: number, autoPause: Course['autoPause']): boolean {
  const percent = attemptersCount === 0 ? 0 : (openFlagCount / attemptersCount) * 100;
  const percentArmMet = attemptersCount >= autoPause.minAttempts && percent >= autoPause.flagPercent;
  const countArmMet = openFlagCount >= autoPause.flagCount;
  return percentArmMet || countArmMet;
}

/** Open/unresolved flags on a version — 'escalated' still counts as
 * unresolved for the auto-pause formula (resolved ambiguity #1).
 * `excludeFlagId`, when given, excludes that specific flag from the count —
 * used by resolveFlag's 'clear' re-evaluation to exclude the just-resolved
 * flag from its own open-flag count via the query itself, independent of
 * write ordering (see resolveFlag's doc comment). */
async function countOpenFlags(questionVersionId: ObjectId, excludeFlagId?: ObjectId): Promise<number> {
  return flagsCol().countDocuments({
    questionVersionId,
    state: { $in: ['open', 'escalated'] },
    ...(excludeFlagId ? { _id: { $ne: excludeFlagId } } : {}),
  });
}

async function countDistinctAttempters(questionVersionId: ObjectId): Promise<number> {
  const puids = await attemptsCol().distinct('puid', { questionVersionId });
  return puids.length;
}

/**
 * ST-P09: attaches a flag to the question's CURRENT version. Idempotent per
 * (puid, questionVersionId) — a student re-flagging the same version they
 * already flagged (in any flag state) gets `duplicate: true` and no new
 * record; the route surfaces `{ flagged: true }` either way (idempotent
 * UX). Non-blocking: never itself changes the question's publication state
 * directly — that only happens via checkAutoPause below (called after every
 * new flag) or later via resolveFlag.
 */
export async function flagQuestion(input: {
  puid: string;
  questionId: ObjectId;
  reason?: string;
}): Promise<{ flagged: true; duplicate: boolean }> {
  const question = await questionsCol().findOne({ _id: input.questionId });
  if (!question) throw new Error('question-not-found');

  const existing = await flagsCol().findOne({ puid: input.puid, questionVersionId: question.currentVersionId });
  if (existing) return { flagged: true, duplicate: true };

  const flagId = new ObjectId();
  const flag: Flag = {
    courseId: question.courseId,
    questionId: input.questionId,
    questionVersionId: question.currentVersionId,
    puid: input.puid,
    state: 'open',
    createdAt: new Date(),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };
  await flagsCol().insertOne({ _id: flagId, ...flag });
  await questionsCol().updateOne({ _id: input.questionId }, { $addToSet: { labels: 'student-flagged' } });

  await checkAutoPause(input.questionId);

  // Task 3: notify(course staff, kind: 'flag') — standard-priority, one per
  // new (non-duplicate) flag. Notifications are advisory: a failure here must
  // never turn an already-committed flag write into a 500 for the caller (and
  // must never make a retry look like a duplicate/invalid transition), so it
  // is logged and swallowed rather than propagated.
  try {
    await notifyCourseStaff(question.courseId, {
      kind: 'flag',
      priority: 'standard',
      body: input.reason ? `A question was flagged: "${input.reason}"` : 'A question was flagged.',
      refType: 'flag',
      refId: flagId,
    });
  } catch (err) {
    console.error('notifications: failed to emit new-flag notification', err);
  }

  return { flagged: true, duplicate: false };
}

/**
 * §4.3: distinct-attempter + open-flag-count thresholds, configurable per
 * course via `course.autoPause`. Only fires from 'approved' — an already
 * paused/archived/draft/etc. question has nothing further to auto-pause
 * into.
 */
export async function checkAutoPause(questionId: ObjectId): Promise<boolean> {
  const question = await questionsCol().findOne({ _id: questionId });
  if (!question) throw new Error('question-not-found');
  if (question.state !== 'approved') return false;

  const course = await coursesCol().findOne({ _id: question.courseId });
  if (!course) throw new Error('course-not-found');

  const [attemptersCount, openFlagCount] = await Promise.all([
    countDistinctAttempters(question.currentVersionId),
    countOpenFlags(question.currentVersionId),
  ]);

  if (!meetsAutoPauseThreshold(attemptersCount, openFlagCount, course.autoPause)) return false;

  await transitionQuestion(questionId, 'paused', 'system:auto-pause');
  // Task 3: notify(course staff, kind: 'auto-pause', priority: 'elevated') —
  // visually distinct client-side (border + icon per §4.3). This runs after
  // transitionQuestion has already committed the pause, so a notification
  // failure here must not propagate — the pause itself already succeeded.
  try {
    await notifyCourseStaff(course._id, {
      kind: 'auto-pause',
      priority: 'elevated',
      body: 'A question was auto-paused after exceeding the flag thresholds.',
      refType: 'question',
      refId: questionId,
    });
  } catch (err) {
    console.error('notifications: failed to emit auto-pause notification', err);
  }
  return true;
}

/**
 * §6.2: records the instructor's resolution, applies the question-side
 * consequence, then closes the flag. The question-side consequence (if any)
 * is applied FIRST and must succeed (or determine there's nothing to do)
 * BEFORE the flag document is written to its terminal state. This ordering
 * is deliberate: `transitionQuestion` can throw a domain error (e.g.
 * `invalid-transition:archived->archived` if two open flags on the same
 * question are both resolved with `archive`) and we must never leave a flag
 * "resolved" while its stated consequence silently failed to apply — so any
 * such error propagates before `flagsCol()` is touched at all. The 'clear'
 * re-evaluation excludes this flag from its own open-flag recount via an
 * explicit `_id: {$ne}` in the query (see `countOpenFlags`), not via write
 * ordering, so this reordering doesn't change its result.
 *
 * Return type is widened ADDITIVELY with an optional `remediation` field
 * (resolved ambiguity #3) — present only when `opts.correctnessAffecting` is
 * true AND the report computed successfully, so Task 2's existing callers
 * (which ignore the extra field) keep working unchanged.
 */
export async function resolveFlag(
  flagId: ObjectId,
  action: 'correct' | 'archive' | 'clear',
  byPuid: string,
  opts?: { correctnessAffecting?: boolean },
): Promise<WithId<Flag> & { remediation?: RemediationReport }> {
  const flag = await flagsCol().findOne({ _id: flagId });
  if (!flag) throw new Error('flag-not-found');

  const target = RESOLUTION_TARGET_STATE[action];
  if (!canFlagTransition(flag.state, target)) throw new Error('invalid-flag-transition');

  if (action === 'correct') {
    // Direct instructor correction path (§6.2): only un-pause. The actual
    // content fix happens through a separate PATCH /api/questions/:id call
    // the instructor makes first (out of scope here).
    const question = await questionsCol().findOne({ _id: flag.questionId });
    if (question?.state === 'paused') {
      await transitionQuestion(flag.questionId, 'approved', byPuid);
    }
  } else if (action === 'archive') {
    // Both paused->archived and approved->archived are valid transitions
    // (PUBLICATION_TRANSITIONS) — always apply, regardless of current state.
    // If the question is already archived (e.g. a second open flag on the
    // same question being resolved after the first archived it),
    // transitionQuestion throws `invalid-transition:archived->archived`
    // BEFORE this flag is ever written — it stays in its prior state rather
    // than getting stuck "resolved" with no consequence applied.
    await transitionQuestion(flag.questionId, 'archived', byPuid);
  } else {
    // clear: leave the question untouched unless it was paused, in which
    // case re-run the same threshold formula (now excluding this
    // just-resolved flag via the query) and un-pause if it's no longer met.
    const question = await questionsCol().findOne({ _id: flag.questionId });
    if (question?.state === 'paused') {
      const course = await coursesCol().findOne({ _id: question.courseId });
      if (course) {
        const [attemptersCount, openFlagCount] = await Promise.all([
          countDistinctAttempters(flag.questionVersionId),
          countOpenFlags(flag.questionVersionId, flagId),
        ]);
        if (!meetsAutoPauseThreshold(attemptersCount, openFlagCount, course.autoPause)) {
          await transitionQuestion(flag.questionId, 'approved', byPuid);
        }
      }
    }
  }

  const resolvedAt = new Date();
  // `correctnessAffecting` (Task 6 review fix): persisted on the resolution
  // sub-document, not just returned in-memory, so the remediation panel can
  // tell — after a reload, once the resolve response's one-shot `remediation`
  // field is long gone — whether THIS flag's resolution is one it should
  // still be showing the checklist for. Conditional spread (not `false`)
  // mirrors this file's `reason` field and notifications.service's `notify()`
  // — an absent key, never an explicit `correctnessAffecting: false`.
  const resolution = {
    action,
    puid: byPuid,
    at: resolvedAt,
    ...(opts?.correctnessAffecting ? { correctnessAffecting: true as const } : {}),
  };
  await flagsCol().updateOne({ _id: flagId }, { $set: { state: target, resolution } });

  await auditCol().insertOne({
    actorPuid: byPuid,
    action: 'flag.resolve',
    targetType: 'flag',
    targetId: flagId,
    courseId: flag.courseId,
    detail: { flagAction: action, from: flag.state, to: target },
    createdAt: resolvedAt,
  });

  // Task 3: notify(flagging student, kind: 'flag-resolved'). The resolution
  // (and its question-side consequence) has already been committed above, so
  // a notification failure here must not turn this into a 500 — a retry
  // would otherwise hit invalid-flag-transition since the resolution already
  // landed, leaving the instructor believing a successful action failed.
  try {
    await notify({
      recipientPuid: flag.puid,
      courseId: flag.courseId,
      kind: 'flag-resolved',
      priority: 'standard',
      body: `Your flag was resolved (${action}).`,
      refType: 'flag',
      refId: flagId,
    });
  } catch (err) {
    console.error('notifications: failed to emit flag-resolved notification', err);
  }
  // §6.2 remediation (Task 6): the flag write + audit entry above have
  // ALREADY committed, so — mirroring the notify() try/catches above — a
  // failure computing the report must never turn this already-succeeded
  // resolution into a 500. On failure, log and omit `remediation`; the
  // instructor still gets a resolved flag, just without the checklist (they
  // can be told to retry / escalate manually).
  let remediation: RemediationReport | undefined;
  if (opts?.correctnessAffecting) {
    try {
      remediation = await remediationReport(flag.questionVersionId);
    } catch (err) {
      console.error('remediation: failed to compute remediation report', err);
    }
  }

  return { ...flag, state: target, resolution, ...(remediation ? { remediation } : {}) };
}

/**
 * §6.2 "Notify affected students" button (Task 6): an EXPLICIT instructor
 * action, unlike the advisory `notify()` calls above — a failure here must
 * surface to the caller as an error rather than being swallowed, since
 * nothing has committed yet from the caller's point of view (no flag write
 * precedes this; it's invoked independently via
 * `POST /api/flags/:flagId/remediation/notify`).
 *
 * Task 6 re-review (Finding B): on success, stamps `resolution.notifiedAt` /
 * `resolution.notifiedCount` onto every flag in the group — i.e. every flag
 * sharing this flag's `questionVersionId` whose resolution is
 * correctness-affecting — not just `flagId` itself. The client treats the
 * group as the unit and reads the marker off whichever flag it happens to
 * look at, so a partial stamp (only the URL's flag) would leave the button
 * re-armed for the group's other flags after a reload. Deliberately placed
 * here rather than in remediation.service.ts (flag-agnostic — it only knows
 * `questionVersionId`) or in the route (no DB/service calls in routes, per
 * routes/AGENTS.md). Never stamps on a thrown `notifyAffectedStudents` (the
 * `await` below throws before the update runs), so a total notify failure
 * leaves the marker unset and the button re-armed for a genuine retry.
 */
export async function notifyRemediation(flagId: ObjectId): Promise<{ notified: number }> {
  const flag = await flagsCol().findOne({ _id: flagId });
  if (!flag) throw new Error('flag-not-found');
  const result = await notifyAffectedStudents(flag.questionVersionId, flag.courseId);
  // §6.2 remediation (Task 6): the notify call above has ALREADY sent the
  // correction notices to every affected student, so — mirroring the notify()
  // try/catches above — a failure stamping the marker must never turn this
  // already-succeeded notify into an error. On failure, log and omit the stamp;
  // the instructor gets their notification delivered to all students, just
  // without the persisted marker (which is strictly better than a UI that
  // advertises a retry for a notify that already succeeded).
  try {
    await flagsCol().updateMany(
      { questionVersionId: flag.questionVersionId, 'resolution.correctnessAffecting': true },
      { $set: { 'resolution.notifiedAt': new Date(), 'resolution.notifiedCount': result.notified } },
    );
  } catch (err) {
    console.error('remediation: failed to stamp notification marker', err);
  }
  return result;
}

/**
 * §6.2 remediation panel reload fix (Task 6 review, Finding 3): the report is
 * a pure read-only query over `questionVersionId`, so it's always
 * regenerable from a flag id — this is what `GET /api/flags/:flagId/remediation`
 * calls so the checklist panel's blast-radius numbers survive a reload (flags
 * are terminal; the resolve response's one-shot `remediation` field can never
 * be refetched any other way). Mirrors `notifyRemediation`'s flag -> version
 * lookup just above.
 */
export async function remediationReportForFlag(flagId: ObjectId): Promise<RemediationReport> {
  const flag = await flagsCol().findOne({ _id: flagId });
  if (!flag) throw new Error('flag-not-found');
  return remediationReport(flag.questionVersionId);
}

/**
 * Instructor flag-resolution queue read (Task 2 consumes this). Joins each
 * flag with its Question head and current QuestionVersion so the UI can
 * render context without N follow-up requests.
 */
export async function listFlags(
  courseId: ObjectId,
  state?: FlagState,
): Promise<Array<WithId<Flag> & { question: WithId<Question> | null; currentVersion: WithId<QuestionVersion> | null }>> {
  const flags = await flagsCol()
    .find({ courseId, ...(state !== undefined ? { state } : {}) })
    .toArray();

  return Promise.all(
    flags.map(async (flag) => {
      const question = await questionsCol().findOne({ _id: flag.questionId });
      const currentVersion = question ? await questionVersionsCol().findOne({ _id: question.currentVersionId }) : null;
      return { ...flag, question, currentVersion };
    }),
  );
}
