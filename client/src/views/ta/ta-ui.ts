// Shared, DOM-free helpers for the TA workspace views (review queue, flag
// triage, question page). Kept out of the view files so they unit-test
// without jsdom — same split as views/instructor/review-queue.ts's exported
// `matchesTab`/`queueTabCounts`.
import type { CourseOutline, Difficulty, QuestionSuggestion } from '../../api.js';

/** The shape `topicLoLabel` actually reads. Structurally satisfied by
 * `CourseOutline`; named separately so the test fixture doesn't have to
 * import the full API type. */
export type CourseOutlineForLabel = CourseOutline;

/** "Topic 1 / LO 1, LO 4" — the same convention bank.ts, review-queue.ts and
 * flags.ts each keep a private copy of, over the outline shape rather than
 * the instructor-only CourseTree. One copy here, shared by every TA view. */
export function topicLoLabel(outline: CourseOutlineForLabel, loIds: string[], themeIds: string[]): string {
  const parts: string[] = [];
  outline.themes.forEach((theme, themeIndex) => {
    const los = theme.los.filter((lo) => loIds.includes(lo._id));
    if (los.length > 0) {
      const loLabels = los
        .map((lo) => `LO ${theme.los.findIndex((candidate) => candidate._id === lo._id) + 1}`)
        .join(', ');
      parts.push(`Topic ${themeIndex + 1} / ${loLabels}`);
    } else if (themeIds.includes(theme._id)) {
      parts.push(`Topic ${themeIndex + 1}`);
    }
  });
  return parts.length ? parts.join('; ') : '—';
}

/** How many of a question's TA suggestions are still awaiting an instructor
 * decision — the queue row's "N pending" affordance. */
export function pendingSuggestionCount(item: { suggestions: QuestionSuggestion[] }): number {
  return item.suggestions.filter((suggestion) => suggestion.status === 'pending').length;
}

/** Builds the minimal patch for a suggested edit, or `null` when the draft is
 * unchanged (or blank). Returning `null` is what lets the view disable Submit
 * instead of POSTing an empty suggestion an instructor then has to triage —
 * the current TA queue submits `{ stem }` unconditionally, so re-clicking
 * "Suggest edit" without typing files a duplicate no-op suggestion. */
export function buildSuggestionPatch(
  original: { stem: string; difficulty?: Difficulty },
  draft: { stem: string; difficulty?: Difficulty },
): QuestionSuggestion['patch'] | null {
  const patch: QuestionSuggestion['patch'] = {};
  if (draft.stem.trim() && draft.stem !== original.stem) patch.stem = draft.stem;
  if (draft.difficulty && draft.difficulty !== original.difficulty) patch.difficulty = draft.difficulty;
  return Object.keys(patch).length > 0 ? patch : null;
}
