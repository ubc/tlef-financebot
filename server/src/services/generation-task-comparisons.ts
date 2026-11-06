import type { AuthoringRequirements } from '../types/generation-quality';
import type { CitationIssue } from './generation-citation-spans';

export const TASK_RETRIEVAL_COMPARISON_PROTOCOL = 'course-task-retrieval-v1' as const;
type Requirements = Pick<AuthoringRequirements, 'intent'> & { taskRetrievalProtocol?: unknown };

/** Only the already selected, actually rendered M entries may be required.
 * Full comparator rendering and current-course/version receipt validation are
 * owned by memory selection/currentness, not by model-authored comparisons. */
export interface TaskComparisonSelection {
  entries: ReadonlyArray<{
    id: string;
    source: 'bank' | 'batch';
    questionId?: string;
    versionId?: string;
    comparisonRole?: 'pinned-original' | 'retrieved-task';
  }>;
  requiredComparisonIds?: readonly string[];
}
export interface TaskComparisonReview {
  novelty?: unknown;
  taskComparisons?: unknown;
}

export function taskRetrievalComparisonsEnabled(requirements?: Requirements): boolean {
  const protocol = requirements?.taskRetrievalProtocol;
  if (protocol === undefined) return false;
  if (protocol !== TASK_RETRIEVAL_COMPARISON_PROTOCOL) throw new Error('generation-task-retrieval-protocol-invalid');
  // Deliberate edit/variant overlap keeps its existing comparison rules.
  return requirements?.intent === 'create-independent-task';
}

function selectionValid(selection: TaskComparisonSelection): boolean {
  if (!selection || !Array.isArray(selection.entries) || !Array.isArray(selection.requiredComparisonIds)
    || selection.requiredComparisonIds.length > 2 || new Set(selection.requiredComparisonIds).size !== selection.requiredComparisonIds.length) return false;
  const entries = selection.entries;
  if (entries.some(entry => !entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 160
    || !['bank', 'batch'].includes(entry.source)) || new Set(entries.map(entry => entry.id)).size !== entries.length) return false;
  const marked = entries.filter(entry => entry.comparisonRole !== undefined);
  if (marked.length !== selection.requiredComparisonIds.length || marked.filter(entry => entry.comparisonRole === 'pinned-original').length > 1) return false;
  for (const id of selection.requiredComparisonIds) {
    if (typeof id !== 'string') return false;
    const parts = /^q:([a-f0-9]{24}):([a-f0-9]{24})$/.exec(id);
    const rows = entries.filter(entry => entry.id === id);
    if (!parts || rows.length !== 1) return false;
    const entry = rows[0];
    if (entry.source !== 'bank' || entry.questionId !== parts[1] || entry.versionId !== parts[2]
      || !['pinned-original', 'retrieved-task'].includes(entry.comparisonRole ?? '')) return false;
  }
  // A zero-overlap full-course nomination can retain unrelated recent fillers.
  // Its empty obligations are valid; the retrieval receipt/currentness layer
  // binds that actual selection rather than inventing relevance here.
  return true;
}

/** Consume server-resolved actual entry IDs, after M alias parsing. A required
 * comparison can truthfully say different inference/path; rank is no verdict. */
export function requiredTaskComparisonIssues(review: TaskComparisonReview, selection: TaskComparisonSelection,
  requirements?: Requirements): CitationIssue[] {
  if (!taskRetrievalComparisonsEnabled(requirements)) return [];
  if (!selectionValid(selection)) return [{ path: 'memory.requiredComparisonIds', code: 'task-retrieval-selection-invalid' }];
  const issues: CitationIssue[] = [];
  const add = (path: string, code: string) => {
    if (!issues.some(issue => issue.path === path && issue.code === code)) issues.push({ path, code });
  };
  const comparisons = Array.isArray(review?.taskComparisons) ? review.taskComparisons : [];
  if (!Array.isArray(review?.taskComparisons) || comparisons.length > 12) add('taskComparisons', 'task-comparisons-schema-invalid');
  const selected = new Set(selection.entries.map(entry => entry.id));
  const counts = new Map<string, number>();
  const validMatches = new Set<string>();
  for (const [index, value] of comparisons.slice(0, 13).entries()) {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const id = typeof row.entryId === 'string' ? row.entryId : '';
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!selected.has(id) || (counts.get(id) ?? 0) > 1) add(`taskComparisons.${index}.entryId`, 'unknown-or-duplicate-memory-comparison');
    const valid = selected.has(id) && typeof row.sameInference === 'boolean' && typeof row.sameSolutionPath === 'boolean'
      && typeof row.contrast === 'string' && row.contrast.trim().length > 0 && row.contrast.trim().length <= 240;
    if (!valid) add(`taskComparisons.${index}`, 'task-comparison-row-invalid');
    if (valid && row.sameInference && row.sameSolutionPath) validMatches.add(id);
  }
  for (const id of selection.requiredComparisonIds!) {
    const count = counts.get(id) ?? 0;
    if (count !== 1) add('taskComparisons', count > 1 ? 'required-task-comparison-duplicated' : 'required-task-comparison-missing');
  }
  // Ambiguous duplicate rows cannot manufacture a valid matching comparator.
  for (const id of validMatches) if (counts.get(id) !== 1) validMatches.delete(id);
  const novelty = review?.novelty;
  if (!['independent', 'uncertain', 'duplicate', 'variant'].includes(String(novelty))) add('novelty', 'task-comparison-verdict-invalid');
  else if ((novelty === 'independent' || novelty === 'uncertain') && validMatches.size) add('matchedEntryIds', 'nonmatching-verdict-has-matches');
  else if ((novelty === 'duplicate' || novelty === 'variant') && !validMatches.size) add('matchedEntryIds', 'bank-comparator-required');
  return issues;
}

/** Aliases use the exact selected entry order shared by the quality renderer.
 * No actual question ID, source quote or model-authored instruction is added. */
export function taskRetrievalComparisonInstruction(selection: TaskComparisonSelection, requirements?: Requirements): string {
  if (!taskRetrievalComparisonsEnabled(requirements)) return '';
  if (!selectionValid(selection)) throw new Error('generation-task-retrieval-selection-invalid');
  const aliases = selection.requiredComparisonIds!.map(id => `M${selection.entries.findIndex(entry => entry.id === id) + 1}`);
  if (!aliases.length) return '';
  return `Required comparisons: ${aliases.join(',')}; exactly one taskComparisons row each,even if independent/uncertain. Compare necessary inference AND solution path with concrete contrast. Similarity never forces true booleans.`;
}

export function taskRetrievalComparisonCorrection(issues: readonly CitationIssue[], requirements?: Requirements): string {
  if (!taskRetrievalComparisonsEnabled(requirements)) return '';
  const relevant = new Set(['required-task-comparison-missing', 'required-task-comparison-duplicated', 'unknown-or-duplicate-memory-comparison',
    'task-comparisons-schema-invalid', 'task-comparison-row-invalid', 'task-comparison-verdict-invalid',
    'nonmatching-verdict-has-matches', 'bank-comparator-required']);
  if (!issues.some(issue => relevant.has(issue.code))) return '';
  return 'Required M rows exactly once,even if independent/uncertain; shown IDs,valid booleans/contrast. Reconcile actual inference/path matches; preserve differences/duplicates/uncertainty. Similarity never forces true booleans. No candidate/source rewrite.';
}
