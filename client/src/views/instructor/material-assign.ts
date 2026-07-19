// Shared pure logic behind materials-assignment UI (Task 15, Task D):
// consumed by both the Materials view's (I3) "Assign Material" panel (n3 —
// full Topic/LO checklist for one material) and Structure's (I2) LO detail
// "Assigned Course Materials" panel (picking a material to attach to one
// fixed LO). Factored out here rather than duplicated across
// `materials.ts`/`structure.ts` per the Task D brief.
import type { CourseTree, Material, MaterialAssignment } from '../../api.js';

/** Classification confidence -> wireframe display label (IN-S06). The stored
 * `classificationSuggestion` only ever exists when confidence >= 0.5 (server
 * contract, docs/api-contract.md), so in practice "No match" only shows up
 * client-side for a material with NO suggestion at all — this function stays
 * total over the full [0,1] range so it's independently testable. */
export function classificationLabel(confidence: number): 'High' | 'Medium' | 'No match' {
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.5) return 'Medium';
  return 'No match';
}

/** Collapse a sorted list of 1-based LO indices into a wireframe-style range
 * string, e.g. [1,2,3] -> "1-3", [1,3] -> "1, 3", [1,2,4] -> "1-2, 4". */
function formatIndexRanges(sorted: number[]): string {
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (current !== undefined) {
      start = current;
      prev = current;
    }
  }
  return ranges.join(', ');
}

/**
 * Human-readable assignment summary for a Materials-list row (I3) — "Topic 1,
 * LO 1-3" style, or "Unassigned" when `material.assignments` is empty. Themes
 * with no assignment are skipped; a theme-only assignment (no `loId`) shows
 * as just "Topic N". Multiple Topics join with "; ".
 */
export function assignmentSummary(material: Material, tree: CourseTree): string {
  if (!material.assignments.length) return 'Unassigned';

  const parts: string[] = [];
  tree.themes.forEach((theme, themeIndex) => {
    const los = theme.los ?? [];
    const loIndices = material.assignments
      .filter((a) => a.themeId === theme._id && a.loId !== undefined)
      .map((a) => los.findIndex((lo) => lo._id === a.loId))
      .filter((i) => i >= 0)
      .map((i) => i + 1)
      .sort((a, b) => a - b);
    const themeOnly = material.assignments.some((a) => a.themeId === theme._id && a.loId === undefined);

    if (!loIndices.length && !themeOnly) return;
    if (!loIndices.length) {
      parts.push(`Topic ${themeIndex + 1}`);
    } else {
      parts.push(`Topic ${themeIndex + 1}, LO ${formatIndexRanges(loIndices)}`);
    }
  });

  return parts.length ? parts.join('; ') : 'Unassigned';
}

/** Add a themeId/loId pair to `assignments` (a bare `themeId` when `loId` is
 * omitted), de-duplicating against an existing identical entry. Returns a new
 * array; never mutates `assignments`. */
export function addAssignment(assignments: MaterialAssignment[], themeId: string, loId?: string): MaterialAssignment[] {
  const exists = assignments.some((a) => a.themeId === themeId && a.loId === loId);
  if (exists) return assignments;
  return [...assignments, loId === undefined ? { themeId } : { themeId, loId }];
}

/** Remove the matching themeId/loId pair from `assignments`. Returns a new
 * array; never mutates `assignments`. No-op if nothing matches. */
export function removeAssignment(assignments: MaterialAssignment[], themeId: string, loId?: string): MaterialAssignment[] {
  return assignments.filter((a) => !(a.themeId === themeId && a.loId === loId));
}
