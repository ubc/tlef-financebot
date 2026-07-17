import type { ObjectId } from 'mongodb';
import { masteryCol, attemptsCol, losCol } from '../components/mongodb/collections';
import type { AttemptRecord, Difficulty, MasteryProfile, MasteryStatus, OptionRole } from '../types/domain';

// -----------------------------------------------------------------------------
// Mastery engine, Layer 1 (PRD §9.2): rolling-window recompute, tier
// progression, and the not-attempted/in-progress/covered status fallback used
// until/unless Layer 2 ships. `struggling` is never set here — only Layer 2 /
// the Phase-2 struggle path sets it.
//
// This is the week-1 sync point: recordAttemptInMastery/getMasteryTier are the
// exact names and shapes Task 10 (selection) and Task 11 (attempts/feedback)
// build on directly.
//
// Split deliberately in two: `computeProfile` is a pure function holding every
// tier-progression/status rule (unit-testable without touching Mongo), and
// `recordAttemptInMastery` is a thin persistence wrapper around it.
// -----------------------------------------------------------------------------

const WINDOW_SIZE = 10;
const TIER_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];

function advanceTier(tier: Difficulty): Difficulty {
  const idx = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(idx + 1, TIER_ORDER.length - 1)];
}

function stepBackTier(tier: Difficulty): Difficulty {
  const idx = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(idx - 1, 0)];
}

/**
 * Recompute a (puid, LO) mastery profile from the rolling attempt window.
 *
 * `window` is chronological (oldest first), holding at most the last 10
 * attempts and always ending with the attempt just recorded. `prior` is the
 * profile as of before that attempt (or null if this LO has never been
 * attempted) — its `currentTier`/`status` are the baseline the latest
 * attempt's outcome is applied against. Tier state is therefore a running
 * delta carried via `prior`, not replayed from the window on every call; the
 * window itself only feeds the count/accuracy/role-distribution stats and the
 * "last 3 attempts" lookback the step-back rule needs.
 */
export function computeProfile(window: AttemptRecord[], prior: MasteryProfile | null): MasteryProfile {
  const base = {
    puid: prior?.puid ?? window[0]?.puid ?? '',
    courseId: (prior?.courseId ?? window[0]?.courseId) as ObjectId,
    loId: (prior?.loId ?? window[0]?.loId) as ObjectId,
    examVerified: prior?.examVerified,
    rationale: prior?.rationale,
  };

  if (window.length === 0) {
    return {
      ...base,
      status: 'not-attempted',
      attemptCount: 0,
      windowAccuracy: 0,
      windowRoles: {},
      currentTier: prior?.currentTier ?? 'easy',
      attemptsSinceEvaluation: prior?.attemptsSinceEvaluation ?? 0,
      updatedAt: new Date(),
    };
  }

  const attemptCount = window.length;
  const correctCount = window.filter((a) => a.correct).length;
  const windowAccuracy = correctCount / attemptCount;
  const windowRoles: Partial<Record<OptionRole, number>> = {};
  for (const a of window) {
    windowRoles[a.selectedRole] = (windowRoles[a.selectedRole] ?? 0) + 1;
  }

  const latest = window[window.length - 1];
  const baseTier: Difficulty = prior?.currentTier ?? 'easy';

  let currentTier: Difficulty;
  if (latest.correct) {
    currentTier = advanceTier(baseTier);
  } else if (latest.selectedRole === 'common-misconception') {
    // Repeat the same difficulty/concept rather than penalizing tier.
    currentTier = baseTier;
  } else {
    const last3 = window.slice(-3);
    const missesInLast3 = last3.filter((a) => !a.correct).length;
    currentTier = missesInLast3 >= 2 && (baseTier === 'hard' || baseTier === 'medium') ? stepBackTier(baseTier) : baseTier;
  }

  let status: MasteryStatus;
  if (!latest.correct && baseTier === 'hard') {
    // A miss on a hard question regresses covered -> in-progress. Never
    // struggling — that label is Layer 2's alone.
    status = 'in-progress';
  } else if (attemptCount >= 4 && windowAccuracy >= 0.75 && currentTier !== 'easy') {
    status = 'covered';
  } else {
    status = 'in-progress';
  }

  return {
    ...base,
    status,
    attemptCount,
    windowAccuracy,
    windowRoles,
    currentTier,
    attemptsSinceEvaluation: (prior?.attemptsSinceEvaluation ?? 0) + 1,
    updatedAt: new Date(),
  };
}

/**
 * Persist `attempt`, recompute its (puid, LO) mastery profile from the
 * rolling ≤10-attempt window, and upsert it. Any `skipped` flag is cleared —
 * a new attempt always supersedes a prior skip (ST-P06).
 */
export async function recordAttemptInMastery(attempt: AttemptRecord): Promise<MasteryProfile> {
  await attemptsCol().insertOne(attempt);

  const { puid, courseId, loId } = attempt;
  const prior = await masteryCol().findOne({ puid, courseId, loId });
  const recent = await attemptsCol()
    .find({ puid, courseId, loId })
    .sort({ createdAt: -1 })
    .limit(WINDOW_SIZE)
    .toArray();
  const window = recent.slice().reverse(); // chronological, oldest first

  const profile = computeProfile(window, prior);

  await masteryCol().updateOne(
    { puid, courseId, loId },
    { $set: profile, $unset: { skipped: '' } },
    { upsert: true },
  );

  return profile;
}

/** Default 'easy' when the LO has never been attempted. */
export async function getMasteryTier(puid: string, courseId: ObjectId, loId: ObjectId): Promise<Difficulty> {
  const profile = await masteryCol().findOne({ puid, courseId, loId });
  return profile?.currentTier ?? 'easy';
}

/** loId hex -> status, for every LO this student has a mastery profile for. */
export async function getLoStatuses(puid: string, courseId: ObjectId): Promise<Map<string, MasteryStatus>> {
  const profiles = await masteryCol().find({ puid, courseId }).toArray();
  const statuses = new Map<string, MasteryStatus>();
  for (const profile of profiles) {
    statuses.set(profile.loId.toHexString(), profile.status);
  }
  return statuses;
}

/**
 * ST-P06: record a skip. `attempted` distinguishes "skipped after starting"
 * from "skipped without attempting" on the stored profile. Cleared
 * automatically the next time recordAttemptInMastery runs for this LO.
 */
export async function recordSkip(
  puid: string,
  courseId: ObjectId,
  loId: ObjectId,
  attempted: boolean,
): Promise<void> {
  await masteryCol().updateOne(
    { puid, courseId, loId },
    {
      $set: { skipped: attempted ? 'after-attempting' : 'without-attempting', updatedAt: new Date() },
      $setOnInsert: {
        puid,
        courseId,
        loId,
        status: 'not-attempted',
        attemptCount: 0,
        windowAccuracy: 0,
        windowRoles: {},
        currentTier: 'easy',
        attemptsSinceEvaluation: 0,
      },
    },
    { upsert: true },
  );
}

/**
 * A theme is covered once every non-archived active LO under it is either
 * `covered` or skipped (a skipped LO still counts, but flags the caveat via
 * `includesSkipped` — §9.2).
 */
export async function themeCoverage(
  puid: string,
  courseId: ObjectId,
  themeId: ObjectId,
): Promise<{ covered: boolean; includesSkipped: boolean }> {
  const los = await losCol()
    .find({ courseId, themeId, archivedAt: { $exists: false } })
    .toArray();

  let includesSkipped = false;
  let covered = true;
  for (const lo of los) {
    const profile = await masteryCol().findOne({ puid, courseId, loId: lo._id });
    if (profile?.skipped) {
      includesSkipped = true;
      continue;
    }
    if (profile?.status !== 'covered') {
      covered = false;
    }
  }

  return { covered, includesSkipped };
}
