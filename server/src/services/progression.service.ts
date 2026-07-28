import type { ObjectId, WithId } from 'mongodb';
import { attemptsCol, materialsCol } from '../components/mongodb/collections';
import { notifyCourseStaff } from './notifications.service';
import type { AttemptRecord, Material } from '../types/domain';

// -----------------------------------------------------------------------------
// Student progression surfaces (Phase 2 Task 7, ST-P07). Mastery owns tier
// movement; this service only detects a consecutive easy/medium miss cluster
// after an attempt has been recorded and builds the non-blocking material
// redirect shown to the student.
// -----------------------------------------------------------------------------

export interface RedirectMaterial {
  name: string;
  materialId: string;
}

export interface RedirectPayload {
  materials: RedirectMaterial[];
  message: string;
}

type RedirectEvidence = Pick<AttemptRecord, 'correct' | 'difficulty'>;

const isRedirectMiss = (attempt: RedirectEvidence): boolean =>
  !attempt.correct && (attempt.difficulty === 'easy' || attempt.difficulty === 'medium');

/** Pure threshold rule. Evidence is newest-first and must be consecutive:
 * any correct or hard-tier attempt breaks the cluster. Hard misses therefore
 * remain under mastery.service's tier-step-back behaviour and never redirect. */
export function hasRepeatedFailureCluster(
  newestFirst: RedirectEvidence[],
  threshold: number,
): boolean {
  if (!Number.isInteger(threshold) || threshold < 1) return false;
  return newestFirst.length >= threshold && newestFirst.slice(0, threshold).every(isRedirectMiss);
}

/** Called after recordAttemptInMastery has inserted the current attempt.
 * The redirect response remains present for a continuing miss streak, while
 * staff receives one notification only when the streak first crosses the
 * configured threshold (rather than one notification on every later miss).
 *
 * Notification delivery is deliberately best-effort: a student answer is
 * already durable at this point and must not fail because staff notification
 * storage is temporarily unavailable. */
export async function repeatedFailureRedirect(input: {
  puid: string;
  displayName: string;
  courseId: ObjectId;
  loId: ObjectId;
  threshold: number;
}): Promise<RedirectPayload | undefined> {
  const recent = await attemptsCol()
    .find({ puid: input.puid, courseId: input.courseId, loId: input.loId })
    .sort({ createdAt: -1 })
    .limit(input.threshold + 1)
    .toArray();

  if (!hasRepeatedFailureCluster(recent, input.threshold)) return undefined;

  const materials = await materialsCol()
    .find({
      courseId: input.courseId,
      status: 'ready',
      assignments: { $elemMatch: { loId: input.loId } },
    })
    .sort({ uploadedAt: -1 })
    .toArray();

  // A threshold crossing is the first qualifying window whose immediately
  // preceding attempt does not continue the same easy/medium miss cluster.
  const crossedThreshold = !recent[input.threshold] || !isRedirectMiss(recent[input.threshold]);
  if (crossedThreshold) {
    try {
      await notifyCourseStaff(input.courseId, {
        kind: 'redirect',
        priority: 'standard',
        body: `${input.displayName} reached the repeated-failure redirect threshold for a learning objective.`,
        refType: 'learning-objective',
        refId: input.loId,
      });
    } catch {
      // Best-effort side effect; never roll a submitted attempt back.
    }
  }

  return {
    materials: materials.map((material) => ({
      name: material.name,
      materialId: material._id.toHexString(),
    })),
    message:
      materials.length > 0
        ? 'A quick review of these course materials may help before you continue.'
        : 'Take a short pause and review this learning objective, then continue when you are ready.',
  };
}

export type RedirectMaterialSource =
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string; downloadName: string };

/** Resolves only ready, LO-assigned material sources for an enrolled student.
 * Unassigned instructor uploads are intentionally not exposed through this
 * route even when a student knows a material id. */
export async function getRedirectMaterialSource(
  courseId: ObjectId,
  loId: ObjectId,
  materialId: ObjectId,
): Promise<RedirectMaterialSource | null> {
  const material: WithId<Material> | null = await materialsCol().findOne({
    _id: materialId,
    courseId,
    status: 'ready',
    assignments: { $elemMatch: { loId } },
  });
  if (!material) return null;
  if (material.format === 'url' && material.sourceUrl) {
    try {
      const parsed = new URL(material.sourceUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return { kind: 'url', url: parsed.toString() };
      }
    } catch {
      return null;
    }
    return null;
  }
  if (material.storagePath) {
    return { kind: 'file', path: material.storagePath, downloadName: material.name };
  }
  return null;
}
