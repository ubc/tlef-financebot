import { ObjectId } from 'mongodb';
import { losCol, questionsCol, questionVersionsCol, themesCol } from '../components/mongodb/collections';
import type { Difficulty, LoKind, QuestionKind } from '../types/domain';
import { effectiveLoKind } from './courses.service';
import { enqueueGenerationRun } from './generation.service';

/**
 * The batch planner (2026-08-23): "Generate for several LOs" opens a grid of
 * counts per LO × difficulty × kind. Auto fills it from each LO's gap and
 * its kind; the instructor adjusts any cell; one action enqueues one
 * generation run per non-empty cell, each carrying an explicit difficulty
 * and kind so the full pipeline engages (the hard stack at hard, the kind
 * contract everywhere).
 *
 * Why per-tier: the practice loop serves by progression tier, so an LO with
 * three approved mediums satisfies "≥3 approved" and still has no easy entry
 * and no hard ceiling. The old seed button sent one untyped run per LO and
 * could not know. The tier targets here are the ONE place the course's idea
 * of a covered LO lives; the instructor's bank runs 28/51/21 easy/mid/high.
 */

/** Approved questions per tier that count as "covered". Sums to 5, the
 * preseeding target the setup guide already shows. */
export const TIER_TARGETS: Readonly<Record<Difficulty, number>> = Object.freeze({ easy: 2, medium: 2, hard: 1 });
export const PLAN_MAX_CELLS = 120;
export const PLAN_MAX_COUNT = 20;

export interface PlanCell {
  loId: ObjectId;
  difficulty: Difficulty;
  kind: QuestionKind;
  count: number;
}

export interface AutoPlanRow {
  loId: ObjectId;
  loName: string;
  themeName: string;
  loKind: LoKind;
  approved: Record<Difficulty, number>;
  cells: Array<{ difficulty: Difficulty; kind: QuestionKind; count: number }>;
}

const TIERS: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** How a tier's needed count splits between kinds for an LO of this kind. */
export function splitByKind(loKind: LoKind, difficulty: Difficulty, needed: number): Array<{ kind: QuestionKind; count: number }> {
  if (needed <= 0) return [];
  if (loKind === 'calculation') return [{ kind: 'calculation', count: needed }];
  if (loKind === 'conceptual') return [{ kind: 'conceptual', count: needed }];
  // Mixed: easy leans conceptual (entry), hard leans calculation (ceiling),
  // medium splits; a single question goes to the tier's leaning kind.
  const lean: QuestionKind = difficulty === 'easy' ? 'conceptual' : 'calculation';
  const other: QuestionKind = lean === 'calculation' ? 'conceptual' : 'calculation';
  const leanCount = Math.ceil(needed / 2);
  return [
    { kind: lean, count: leanCount },
    ...(needed - leanCount > 0 ? [{ kind: other, count: needed - leanCount }] : []),
  ];
}

/** Approved questions per tier for one LO, read off each question's current version. */
async function approvedByTier(courseId: ObjectId, loId: ObjectId): Promise<Record<Difficulty, number>> {
  const approved = await questionsCol()
    .find({ courseId, loIds: loId, state: 'approved' }, { projection: { currentVersionId: 1 } })
    .toArray();
  const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  if (approved.length === 0) return counts;
  const versions = await questionVersionsCol()
    .find({ _id: { $in: approved.map((q) => q.currentVersionId) } }, { projection: { difficulty: 1 } })
    .toArray();
  for (const version of versions) {
    if (version.difficulty in counts) counts[version.difficulty as Difficulty] += 1;
  }
  return counts;
}

/** The Auto plan: every active LO, its per-tier gap against TIER_TARGETS,
 * split by its kind. LOs with no gap come back with no cells, so the grid
 * can still show them as covered. */
export async function autoGenerationPlan(courseId: ObjectId): Promise<AutoPlanRow[]> {
  const [themes, los] = await Promise.all([
    themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
  ]);
  const themeName = new Map(themes.map((theme) => [theme._id.toHexString(), theme.name]));
  const themeOrder = new Map(themes.map((theme) => [theme._id.toHexString(), theme.order]));
  los.sort((a, b) =>
    (themeOrder.get(a.themeId.toHexString()) ?? 0) - (themeOrder.get(b.themeId.toHexString()) ?? 0) || a.order - b.order);

  const rows: AutoPlanRow[] = [];
  for (const lo of los) {
    const approved = await approvedByTier(courseId, lo._id);
    const loKind = effectiveLoKind(lo);
    const cells = TIERS.flatMap((difficulty) =>
      splitByKind(loKind, difficulty, Math.max(0, TIER_TARGETS[difficulty] - approved[difficulty]))
        .map((split) => ({ difficulty, ...split })));
    rows.push({
      loId: lo._id, loName: lo.name, themeName: themeName.get(lo.themeId.toHexString()) ?? '',
      loKind, approved, cells,
    });
  }
  return rows;
}

export interface PlanResult {
  runs: Array<{ loId: ObjectId; difficulty: Difficulty; kind: QuestionKind; count: number; runId?: ObjectId; error?: string }>;
}

/** Enqueue one generation run per cell. A cell that cannot be enqueued (no
 * ready material, daily limit) reports its error and does not stop the rest:
 * the instructor sees exactly which LOs did not start. */
export async function enqueueGenerationPlan(courseId: ObjectId, cells: PlanCell[], byPuid: string): Promise<PlanResult> {
  if (cells.length > PLAN_MAX_CELLS) throw new Error('generation-plan-too-large');
  const runs: PlanResult['runs'] = [];
  for (const cell of cells) {
    const base = { loId: cell.loId, difficulty: cell.difficulty, kind: cell.kind, count: cell.count };
    if (!Number.isInteger(cell.count) || cell.count < 1 || cell.count > PLAN_MAX_COUNT) {
      runs.push({ ...base, error: 'generation-plan-invalid-count' });
      continue;
    }
    try {
      const runId = await enqueueGenerationRun({
        courseId, loId: cell.loId, count: cell.count, type: 'mcq',
        difficulty: cell.difficulty, kind: cell.kind, byPuid,
      });
      runs.push({ ...base, runId });
    } catch (error) {
      runs.push({ ...base, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return runs.length ? { runs } : { runs: [] };
}
