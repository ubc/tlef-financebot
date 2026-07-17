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
 * **Contract:** `window` is chronological (oldest first), holding at most the
 * last 10 attempts (the rolling-window cap — see `WINDOW_SIZE` /
 * `recordAttemptInMastery`). This function expects `window` to contain the
 * attempt history up to and including exactly ONE new attempt beyond what
 * `prior` already reflects — i.e. `prior` is the profile as of `window` minus
 * its newest (last) entry. That is the only call shape `recordAttemptInMastery`
 * ever produces: `prior` is the previously-persisted profile, and exactly one
 * attempt has just been recorded (`prior` is `null` only on this LO's very
 * first attempt ever, at which point `window` necessarily contains exactly
 * that one attempt).
 *
 * Within that contract:
 *  - `attemptCount`, `windowAccuracy`, and `windowRoles` are derived FRESH
 *    from the full (capped, ≤10) `window` array on every call — these are
 *    cheap, bounded aggregates and recomputing them from scratch each time is
 *    correct and simple.
 *  - `currentTier` and `status`, by contrast, are derived INCREMENTALLY:
 *    exactly one tier transition is applied — using `window`'s newest
 *    (last) entry — on top of `prior?.currentTier ?? 'easy'`. They are not
 *    replayed from the whole window, because the window is a bounded
 *    rolling buffer, not the full history: once an LO has more than 10
 *    attempts, older attempts (including ones that already earned a tier)
 *    are evicted from `window`, and a full replay would silently regress an
 *    already-earned tier that `prior` still correctly remembers.
 *
 * The single tier transition: correct → advance one tier (capped at `hard`);
 * miss with `selectedRole: 'common-misconception'` → hold tier (this must
 * stay tier-neutral even as history ages out of the window — see the
 * "CM-miss streak" regression test); miss with ≥2-of-the-window's-last-3
 * entries at `hard`/`medium` → step back one tier.
 *
 * **Out-of-contract callers** (e.g. a hypothetical batch/backfill path that
 * passes a multi-attempt `window` against a stale or `null` `prior`) will get
 * an UNDER-STEPPED tier: only one transition is ever applied per call,
 * regardless of how many attempts `window` holds beyond `prior`. This is a
 * known, accepted limitation of deriving tier from a bounded rolling window
 * rather than a bug to engineer around — `recordAttemptInMastery` never
 * produces such a call, so it does not arise in production.
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

  // Apply exactly ONE tier transition, using the newest attempt in `window`,
  // on top of `prior`'s tier (see docstring: `window` is a bounded rolling
  // buffer, not the full history, so a full replay would regress an
  // already-earned tier once older evidence ages out of the window).
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

  const profiles = await masteryCol()
    .find({ puid, courseId, loId: { $in: los.map((l) => l._id) } })
    .toArray();
  const profileByLoId = new Map(profiles.map((p) => [p.loId.toHexString(), p]));

  let includesSkipped = false;
  let covered = true;
  for (const lo of los) {
    const profile = profileByLoId.get((lo._id as ObjectId).toHexString());
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
