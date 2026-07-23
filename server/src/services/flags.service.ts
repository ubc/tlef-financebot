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
import type { Flag, FlagState, Course, Question, QuestionVersion } from '../types/domain';

// -----------------------------------------------------------------------------
// Flag service (ST-P09, §4.3, §6.2): student flagging, the flag state
// machine, and configurable auto-pause. Flags attach to a specific
// QuestionVersion (never just the mutable Question head) so a later content
// edit doesn't retroactively misattribute or silently resolve a flag raised
// against stale content. Consumed by Task 2 (instructor flag-resolution
// queue UI) and Task 3 (notifications) — neither exists yet; see the two
// `// Task 3:` / `// Task 6:` comments below for their future wiring points.
// See server/src/services/AGENTS.md.
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
 * §4.3 formula lives in exactly one place. Below course.autoPause.minAttempts
 * is an absolute small-sample guard — it blocks a pause even if the
 * percentage or absolute-count arm would otherwise fire. */
function meetsAutoPauseThreshold(attemptersCount: number, openFlagCount: number, autoPause: Course['autoPause']): boolean {
  if (attemptersCount < autoPause.minAttempts) return false;
  const percent = attemptersCount === 0 ? 0 : (openFlagCount / attemptersCount) * 100;
  return percent >= autoPause.flagPercent || openFlagCount >= autoPause.flagCount;
}

/** Open/unresolved flags on a version — 'escalated' still counts as
 * unresolved for the auto-pause formula (resolved ambiguity #1). */
async function countOpenFlags(questionVersionId: ObjectId): Promise<number> {
  return flagsCol().countDocuments({ questionVersionId, state: { $in: ['open', 'escalated'] } });
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
  if (!course) throw new Error('question-not-found');

  const [attemptersCount, openFlagCount] = await Promise.all([
    countDistinctAttempters(question.currentVersionId),
    countOpenFlags(question.currentVersionId),
  ]);

  if (!meetsAutoPauseThreshold(attemptersCount, openFlagCount, course.autoPause)) return false;

  await transitionQuestion(questionId, 'paused', 'system:auto-pause');
  // Task 3: notify(course staff, kind: 'auto-pause', priority: 'elevated')
  return true;
}

/**
 * §6.2: records the instructor's resolution, closes the flag, and applies
 * the question consequence. The flag's state is written BEFORE any
 * question-state re-evaluation so the 'clear' re-check below naturally
 * excludes this flag from its own open-flag count (resolved ambiguity #7).
 */
export async function resolveFlag(
  flagId: ObjectId,
  action: 'correct' | 'archive' | 'clear',
  byPuid: string,
  opts?: { correctnessAffecting?: boolean },
): Promise<WithId<Flag>> {
  const flag = await flagsCol().findOne({ _id: flagId });
  if (!flag) throw new Error('flag-not-found');

  const target = RESOLUTION_TARGET_STATE[action];
  if (!canFlagTransition(flag.state, target)) throw new Error('invalid-flag-transition');

  const resolvedAt = new Date();
  const resolution = { action, puid: byPuid, at: resolvedAt };
  await flagsCol().updateOne({ _id: flagId }, { $set: { state: target, resolution } });

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
    await transitionQuestion(flag.questionId, 'archived', byPuid);
  } else {
    // clear: leave the question untouched unless it was paused, in which
    // case re-run the same threshold formula (now excluding this
    // just-resolved flag) and un-pause if it's no longer met.
    const question = await questionsCol().findOne({ _id: flag.questionId });
    if (question?.state === 'paused') {
      const course = await coursesCol().findOne({ _id: question.courseId });
      if (course) {
        const [attemptersCount, openFlagCount] = await Promise.all([
          countDistinctAttempters(flag.questionVersionId),
          countOpenFlags(flag.questionVersionId),
        ]);
        if (!meetsAutoPauseThreshold(attemptersCount, openFlagCount, course.autoPause)) {
          await transitionQuestion(flag.questionId, 'approved', byPuid);
        }
      }
    }
  }

  await auditCol().insertOne({
    actorPuid: byPuid,
    action: 'flag.resolve',
    targetType: 'flag',
    targetId: flagId,
    courseId: flag.courseId,
    detail: { flagAction: action, from: flag.state, to: target },
    createdAt: resolvedAt,
  });

  // Task 3: notify(flagging student, kind: 'flag-resolved')
  if (opts?.correctnessAffecting) {
    // Task 6: trigger remediation report + notification when correctnessAffecting
  }

  return { ...flag, state: target, resolution };
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
