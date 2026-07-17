import type { WithId, ObjectId } from 'mongodb';
import { questionsCol, questionVersionsCol, themesCol, losCol } from '../components/mongodb/collections';
import { getMasteryTier, getLoStatuses } from './mastery.service';
import type { Question, QuestionVersion, Difficulty, Theme, LearningObjective, MasteryStatus } from '../types/domain';

// -----------------------------------------------------------------------------
// Serving service (Task 10, PRD §5.1): mastery-driven question selection with
// a three-rung graceful degradation ladder, plus the student course-home view.
// Pure selection logic over an in-memory candidate list fetched ONCE per call
// — no worker sandbox / parameterized execution here (Phase 2). If a served
// QuestionVersion happens to carry `paramSlots`, Phase 1 still serves it as-is
// (no {{slot}} substitution); the caller is expected to render slot defaults
// at `min` until Phase 2 Task 4 builds real parameterized execution.
// See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------

const TIER_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];

export type Degraded = 'none' | 'repeat' | 'adjacent' | 'any';

export interface SelectResult {
  question: WithId<Question>;
  version: WithId<QuestionVersion>;
  degraded: Degraded;
}

interface Candidate {
  question: WithId<Question>;
  version: WithId<QuestionVersion>;
}

/** Picks a uniformly random element via the injected `rand` (default
 * `Math.random`), so degradation-ladder tests can pin the choice. */
function pickRandom<T>(pool: T[], rand: () => number): T {
  const idx = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
  return pool[idx];
}

/** Approved questions tagged to `loId`, joined to their current
 * QuestionVersion — fetched once, then filtered in memory by the caller. A
 * head whose current version is missing is dropped (should never happen —
 * versions are never deleted, PRD §2). */
async function approvedCandidatesForLo(courseId: ObjectId, loId: ObjectId): Promise<Candidate[]> {
  const heads = await questionsCol()
    .find({ courseId, loIds: loId, state: 'approved' })
    .toArray();
  if (heads.length === 0) return [];

  const versionIds = heads.map((h) => h.currentVersionId);
  const versions = await questionVersionsCol()
    .find({ _id: { $in: versionIds } })
    .toArray();
  const versionById = new Map(versions.map((v) => [v._id.toString(), v]));

  const candidates: Candidate[] = [];
  for (const head of heads) {
    const version = versionById.get(head.currentVersionId.toString());
    if (version) candidates.push({ question: head, version });
  }
  return candidates;
}

/**
 * Runs the tier-targeting + degradation ladder over an already-fetched
 * candidate pool. Ideal case: an unseen question at the target tier
 * (`degraded: 'none'`). Otherwise, in order:
 *   1. same tier, already served this session -> repeat (`degraded: 'repeat'`)
 *   2. adjacent tier (one step up or down), unseen -> `degraded: 'adjacent'`
 *   3. anything else Approved for the LO -> `degraded: 'any'`
 * `null` only when `candidates` is empty (zero Approved for the LO).
 */
function selectFromCandidates(
  candidates: Candidate[],
  tier: Difficulty,
  sessionServedIds: ObjectId[],
  rand: () => number,
): SelectResult | null {
  if (candidates.length === 0) return null;

  const servedIds = new Set(sessionServedIds.map((id) => id.toString()));
  const isServed = (c: Candidate) => servedIds.has(c.question._id.toString());

  const sameTierUnseen = candidates.filter((c) => c.version.difficulty === tier && !isServed(c));
  if (sameTierUnseen.length > 0) {
    return { ...pickRandom(sameTierUnseen, rand), degraded: 'none' };
  }

  const sameTierServed = candidates.filter((c) => c.version.difficulty === tier && isServed(c));
  if (sameTierServed.length > 0) {
    return { ...pickRandom(sameTierServed, rand), degraded: 'repeat' };
  }

  const tierIdx = TIER_ORDER.indexOf(tier);
  const adjacentTiers = [TIER_ORDER[tierIdx - 1], TIER_ORDER[tierIdx + 1]].filter((t): t is Difficulty => Boolean(t));
  const adjacentUnseen = candidates.filter((c) => adjacentTiers.includes(c.version.difficulty) && !isServed(c));
  if (adjacentUnseen.length > 0) {
    return { ...pickRandom(adjacentUnseen, rand), degraded: 'adjacent' };
  }

  // Rung 3: whatever's left (served adjacent, or non-adjacent tier
  // regardless of served state) — every candidate not already exhausted by
  // rungs above, which by construction is every remaining candidate since
  // rungs 1 and 2 both came up empty.
  return { ...pickRandom(candidates, rand), degraded: 'any' };
}

/**
 * Selects the next question to serve for (puid, courseId, loId): Approved
 * bank tagged to the LO, excluding `sessionServedIds`, targeting the
 * student's current mastery tier (Task 9's `getMasteryTier`), with graceful
 * degradation when the ideal pool is empty. `null` only when the LO has zero
 * Approved questions — callers must hide such LOs (ST-P01/P02 gate on ≥1
 * approved, enforced by `studentCourseHome` below).
 */
export async function selectNextQuestion(
  input: { puid: string; courseId: ObjectId; loId: ObjectId; sessionServedIds: ObjectId[] },
  rand: () => number = Math.random,
): Promise<SelectResult | null> {
  const candidates = await approvedCandidatesForLo(input.courseId, input.loId);
  if (candidates.length === 0) return null;

  const tier = await getMasteryTier(input.puid, input.courseId, input.loId);
  return selectFromCandidates(candidates, tier, input.sessionServedIds, rand);
}

/**
 * Strategy A retry (§5.1): a NEW question testing the same concept —
 * `excludeQuestionId` is removed from the candidate pool entirely (not just
 * treated as "served") before the same tier-targeting/degradation ladder
 * runs. `null` when the LO's only Approved question is the excluded one —
 * callers degrade to Strategy B.
 */
export async function selectRetryQuestion(
  input: { puid: string; courseId: ObjectId; loId: ObjectId; excludeQuestionId: ObjectId; sessionServedIds: ObjectId[] },
  rand: () => number = Math.random,
): Promise<SelectResult | null> {
  const candidates = (await approvedCandidatesForLo(input.courseId, input.loId)).filter(
    (c) => !c.question._id.equals(input.excludeQuestionId),
  );
  if (candidates.length === 0) return null;

  const tier = await getMasteryTier(input.puid, input.courseId, input.loId);
  return selectFromCandidates(candidates, tier, input.sessionServedIds, rand);
}

export interface StudentCourseHomeLo {
  lo: WithId<LearningObjective>;
  status: MasteryStatus;
  approvedCount: number;
}

export interface StudentCourseHomeTheme {
  theme: WithId<Theme>;
  available: boolean;
  los: StudentCourseHomeLo[];
}

/**
 * Student-facing course home (ST-P01/P02): only themes/LOs with ≥1 Approved
 * question are shown. Archived themes/LOs are excluded outright. A theme
 * whose `availableFrom` is still in the future (progressive release) is
 * hidden entirely, not merely flagged — the `available` field it would carry
 * is therefore always `true` for every entry actually returned, kept on the
 * shape for forward-compat with a future "shown but locked" UI.
 */
export async function studentCourseHome(
  puid: string,
  courseId: ObjectId,
): Promise<StudentCourseHomeTheme[]> {
  const [themes, los, statuses, approvedQuestions] = await Promise.all([
    themesCol()
      .find({ courseId, archivedAt: { $exists: false } })
      .toArray(),
    losCol()
      .find({ courseId, archivedAt: { $exists: false } })
      .toArray(),
    getLoStatuses(puid, courseId),
    questionsCol()
      .find({ courseId, state: 'approved' })
      .toArray(),
  ]);

  // Fetch once, tally in memory (avoids an N+1 countDocuments per LO — a
  // question's `loIds` is many-to-many, IN-Q13, so one question can bump
  // the count for several LOs).
  const approvedCountByLoId = new Map<string, number>();
  for (const question of approvedQuestions) {
    for (const loId of question.loIds) {
      const key = loId.toString();
      approvedCountByLoId.set(key, (approvedCountByLoId.get(key) ?? 0) + 1);
    }
  }

  const now = new Date();
  const result: StudentCourseHomeTheme[] = [];

  for (const theme of themes) {
    const available = !theme.availableFrom || theme.availableFrom <= now;
    if (!available) continue;

    const themeLos = los.filter((lo) => lo.themeId.equals(theme._id));
    const losWithCoverage: StudentCourseHomeLo[] = [];
    for (const lo of themeLos) {
      const approvedCount = approvedCountByLoId.get(lo._id.toString()) ?? 0;
      if (approvedCount === 0) continue;
      losWithCoverage.push({
        lo,
        status: statuses.get(lo._id.toString()) ?? 'not-attempted',
        approvedCount,
      });
    }
    if (losWithCoverage.length === 0) continue;

    result.push({ theme, available, los: losWithCoverage });
  }

  return result;
}
