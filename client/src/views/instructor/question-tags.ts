// Topic and LO tagging helpers shared by the Questions workspace's Settings
// tab and Question details: the "Add LO" choices, where an LO sits in the
// outline, and the edited-field comparison.
import type { CourseTree } from '../../api.js';

/** Generic "did this field change" comparator behind the `.edited` highlight
 * (Task-15 Task E: "compare each field's current editor value to the loaded
 * version's value"). Works for both scalar fields (stem, difficulty, an
 * option's text/explanation) and arrays (loIds) via a structural
 * (JSON-based) comparison — cheap and correct for the plain
 * string/string-array field types this view compares. */
export function isFieldEdited(current: unknown, baseline: unknown): boolean {
  return JSON.stringify(current) !== JSON.stringify(baseline);
}

export interface LoContext {
  theme: CourseTree['themes'][number];
  themeIndex: number;
  lo: NonNullable<CourseTree['themes'][number]['los']>[number];
  loIndex: number;
}

/** The "Add LO" picker's choices: every LO not already tagged, labelled by its
 * position in the whole outline. Numbered BEFORE filtering — numbering the
 * filtered list shifted every LO after a tagged one down by one (2026-09-14: a
 * question tagged to LO 2 listed the real LO 3 as "LO 2"). */
export function addableLoOptions(tree: Pick<CourseTree, 'themes'>, taggedLoIds: readonly string[]): Array<{ id: string; label: string }> {
  return tree.themes.flatMap((theme, themeIndex) =>
    (theme.los ?? [])
      .map((lo, loIndex) => ({ id: lo._id, label: `Topic ${themeIndex + 1} › LO ${loIndex + 1}: ${lo.name}` }))
      .filter((option) => !taggedLoIds.includes(option.id)),
  );
}

/** Where an LO sits in the outline (its Topic and position), or `undefined`. */
export function findLoContext(tree: Pick<CourseTree, 'themes'>, loId: string): LoContext | undefined {
  for (let themeIndex = 0; themeIndex < tree.themes.length; themeIndex += 1) {
    const theme = tree.themes[themeIndex];
    const los = theme.los ?? [];
    const loIndex = los.findIndex((lo) => lo._id === loId);
    if (loIndex !== -1) return { theme, themeIndex, lo: los[loIndex], loIndex };
  }
  return undefined;
}
