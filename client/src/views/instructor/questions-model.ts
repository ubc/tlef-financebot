// Pure helpers for the instructor Questions workspace (questions.ts). DOM-free
// so they unit-test under node. Spec:
// docs/superpowers/specs/2026-11-09-instructor-questions-workspace-design.md
import {
  WORKSPACE_TABS,
  type AgentRepair,
  type NumericVerification,
  type CourseTree,
  type Difficulty,
  type HiddenReason,
  type QuestionType,
  type QuestionVersion,
  type QuestionWorkspace,
  type WorkspaceReleaseTheme,
  type WorkspaceRow,
  type WorkspaceTab,
} from '../../api.js';

export const TAB_LABEL: Record<WorkspaceTab, string> = {
  review: 'To review',
  approved: 'Approved',
  flags: 'Student flags',
  paused: 'Paused',
  archived: 'Archived',
};

export function parseTab(value: string | null | undefined): WorkspaceTab | null {
  return (WORKSPACE_TABS as readonly string[]).includes(value ?? '') ? value as WorkspaceTab : null;
}

/** To review while anything waits there, otherwise Approved. */
export function defaultTab(counts: QuestionWorkspace['counts']): WorkspaceTab {
  return counts.review > 0 ? 'review' : 'approved';
}

/** The reader's middle-pane mode (spec D2). Read is the default and is
 * never written to the URL. */
export type ReaderMode = 'read' | 'edit' | 'preview' | 'compare' | 'params';

export function parseMode(value: string | null): ReaderMode {
  return value === 'edit' || value === 'preview' || value === 'compare' || value === 'params' ? value : 'read';
}

export interface QuestionsPathParams {
  tab?: WorkspaceTab;
  q?: string;
  runId?: string;
  flag?: string;
  mode?: ReaderMode;
  /** The flagged version being fixed in Edit mode (spec D4). */
  flagVersionId?: string;
  /** A recorded version opened from Student Analytics. */
  analyticsVersionId?: string;
}

export function questionsPath(courseId: string, params: QuestionsPathParams = {}, role: 'instructor' | 'ta' = 'instructor'): string {
  const query = new URLSearchParams();
  if (params.tab) query.set('tab', params.tab);
  if (params.q) query.set('q', params.q);
  if (params.runId) query.set('runId', params.runId);
  if (params.flag) query.set('flag', params.flag);
  // A mode belongs to the selected question, so it is only written with one.
  if (params.q && params.mode && params.mode !== 'read') query.set('mode', params.mode);
  if (params.q && params.mode === 'edit' && params.flagVersionId) query.set('flagVersionId', params.flagVersionId);
  if (params.q && params.analyticsVersionId) query.set('analyticsVersionId', params.analyticsVersionId);
  const qs = query.toString();
  return `/${role}/course/${encodeURIComponent(courseId)}/questions${qs ? `?${qs}` : ''}`;
}

/**
 * Where an old Review Queue / Question Bank / Flags URL, or an old question
 * page (Question details, Parameterization Configuration, Edit together —
 * spec 2026-11-18 D7), now lives. Keeps the selection (`q`, the Flags page's
 * `?question=`, or the question in the path), the run highlight, a
 * notification's `?flag=`, and maps a question page's `intent` to a reader
 * mode. `null` for anything that is not one of those pages.
 */
export function legacyQuestionsPath(path: string, query: URLSearchParams): string | null {
  const page = /^\/instructor\/course\/([^/]+)\/bank\/([^/]+)(\/params|\/collaborate)?$/.exec(path);
  if (page) {
    const courseId = decodeURIComponent(page[1]);
    const q = decodeURIComponent(page[2]);
    if (page[3] === '/params') return questionsPath(courseId, { q, mode: 'params' });
    if (page[3] === '/collaborate') return questionsPath(courseId, { q });
    const intent = query.get('intent');
    if (query.get('from') === 'flags') {
      return questionsPath(courseId, intent === 'edit'
        ? { tab: 'flags', q, mode: 'edit', flagVersionId: query.get('flagVersionId') ?? undefined }
        : { tab: 'flags', q });
    }
    return questionsPath(courseId, {
      q,
      ...(intent === 'regenerate' ? { mode: 'compare' as const } : {}),
      analyticsVersionId: query.get('analyticsVersionId') ?? undefined,
    });
  }
  const match = /^\/instructor\/course\/([^/]+)\/(queue|bank|flags)$/.exec(path);
  if (!match) return null;
  const courseId = decodeURIComponent(match[1]);
  const tab: WorkspaceTab = match[2] === 'queue' ? 'review' : match[2] === 'bank' ? 'approved' : 'flags';
  return questionsPath(courseId, {
    tab,
    q: query.get('q') ?? query.get('question') ?? undefined,
    runId: query.get('runId') ?? undefined,
    flag: query.get('flag') ?? undefined,
  });
}

export type ApprovedView = 'all' | 'visible' | 'waiting';
export type VerdictFilter = '' | 'pass' | 'flag' | 'reject' | 'none';

export interface WorkspaceFilters {
  search: string;
  themeId: string;
  loId: string;
  type: QuestionType | '';
  difficulty: Difficulty | '';
  verdict: VerdictFilter;
  approvedView: ApprovedView;
}

export const EMPTY_FILTERS: WorkspaceFilters = { search: '', themeId: '', loId: '', type: '', difficulty: '', verdict: '', approvedView: 'all' };

export function hasActiveFilters(filters: WorkspaceFilters): boolean {
  return Object.entries(filters).some(([key, value]) => key === 'approvedView' ? value !== 'all' : value !== '');
}

/** Names of the row's LOs, for search and the row label. */
export function objectiveNames(tree: Pick<CourseTree, 'themes'>, loIds: readonly string[]): string[] {
  return tree.themes.flatMap((theme) => (theme.los ?? []).filter((lo) => loIds.includes(lo._id)).map((lo) => lo.name));
}

export function topicNames(tree: Pick<CourseTree, 'themes'>, themeIds: readonly string[]): string[] {
  return tree.themes.filter((theme) => themeIds.includes(theme._id)).map((theme) => theme.name);
}

export function filterRows(rows: readonly WorkspaceRow[], filters: WorkspaceFilters, tree: Pick<CourseTree, 'themes'>, tab: WorkspaceTab): WorkspaceRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.themeId && !row.themeIds.includes(filters.themeId)) return false;
    if (filters.loId && !row.loIds.includes(filters.loId)) return false;
    if (filters.type && row.current.type !== filters.type) return false;
    if (filters.difficulty && row.current.difficulty !== filters.difficulty) return false;
    if (filters.verdict === 'none' ? row.agentVerdict !== undefined : filters.verdict && row.agentVerdict !== filters.verdict) return false;
    if (tab === 'approved' && filters.approvedView === 'visible' && !row.studentVisible) return false;
    if (tab === 'approved' && filters.approvedView === 'waiting' && row.studentVisible) return false;
    if (!needle) return true;
    const haystack = [row.current.stem, row.sample?.stem ?? '', ...objectiveNames(tree, row.loIds)].join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

/** Reader copy for why a question is not in student practice. */
export function hiddenReasonText(reason: HiddenReason | undefined, heldTopics: readonly string[] = []): string {
  switch (reason) {
    case undefined: return 'Visible to students.';
    case 'not-approved': return 'Not visible to students until it is approved.';
    case 'course-unpublished': return 'Not visible: the course is not published yet.';
    case 'topic-unreleased': return `Not visible: ${heldTopics.length ? heldTopics.join(', ') : 'a tagged topic'} ${heldTopics.length > 1 ? 'are' : 'is'} not released.`;
    case 'topic-scheduled': return `Not visible yet: ${heldTopics.length ? heldTopics.join(', ') : 'a tagged topic'} ${heldTopics.length > 1 ? 'are' : 'is'} scheduled for release.`;
    case 'content-not-ready': return 'Not visible: this version needs numerical or placeholder checks. Edit it and approve it again.';
  }
}

export type ReleaseState = 'released' | 'scheduled' | 'hidden';

export function releaseState(theme: Pick<WorkspaceReleaseTheme, 'availableFrom' | 'released'>): ReleaseState {
  if (theme.released) return 'released';
  return theme.availableFrom ? 'scheduled' : 'hidden';
}

export function releaseStateText(theme: Pick<WorkspaceReleaseTheme, 'availableFrom' | 'released'>): string {
  const state = releaseState(theme);
  if (state === 'released') return 'Released';
  if (state === 'scheduled') return `Scheduled for ${new Date(theme.availableFrom as string).toLocaleString()}`;
  return 'Hidden';
}

/** Topic names among `themeIds` that are not released yet. */
export function heldTopicNames(release: QuestionWorkspace['release'], themeIds: readonly string[]): string[] {
  return release.themes.filter((theme) => themeIds.includes(theme.themeId) && !theme.released).map((theme) => theme.name);
}

export interface BulkAction {
  to: 'approved' | 'archived';
  label: string;
  /** Past tense for the result line, e.g. "Approved 3 of 4 questions." */
  done: string;
  /** Reject asks for one optional reason for the whole batch. */
  askReason?: boolean;
}

export function bulkActionsFor(tab: WorkspaceTab): BulkAction[] {
  switch (tab) {
    case 'review': return [{ to: 'approved', label: 'Approve selected', done: 'Approved' }, { to: 'archived', label: 'Reject selected', done: 'Rejected', askReason: true }];
    case 'approved': return [{ to: 'archived', label: 'Archive selected', done: 'Archived' }];
    case 'paused': return [{ to: 'approved', label: 'Resume selected', done: 'Resumed' }, { to: 'archived', label: 'Archive selected', done: 'Archived' }];
    default: return [];
  }
}

export interface BulkOutcome<T> {
  succeeded: T[];
  failed: Array<{ item: T; error: unknown }>;
}

/** Runs `work` over `items`, `concurrency` at a time, and reports each
 * item's outcome so failures can stay selected for a retry. */
export async function runBulk<T>(items: readonly T[], work: (item: T) => Promise<unknown>, concurrency = 4): Promise<BulkOutcome<T>> {
  const outcome: BulkOutcome<T> = { succeeded: [], failed: [] };
  const results: Array<{ ok: true } | { ok: false; error: unknown }> = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        await work(items[index]);
        results[index] = { ok: true };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }));
  items.forEach((item, index) => {
    const result = results[index];
    if (result.ok) outcome.succeeded.push(item);
    else outcome.failed.push({ item, error: result.error });
  });
  return outcome;
}

/** Same summary as the old Review Queue's run banner: how many of a
 * generation run's questions are in this tab now, how many have left it. */
export function runHighlightSummary(createdIds: readonly string[], rowIds: readonly string[]): { shown: number; missing: number } {
  const rows = new Set(rowIds);
  const shown = createdIds.filter((id) => rows.has(id)).length;
  return { shown, missing: createdIds.length - shown };
}

/** "Topic 2 / LO 1" style label from the course tree. */
export function topicLoLabel(tree: Pick<CourseTree, 'themes'>, loIds: readonly string[], themeIds: readonly string[]): string {
  const parts: string[] = [];
  tree.themes.forEach((theme, themeIndex) => {
    const los = (theme.los ?? []).filter((lo) => loIds.includes(lo._id));
    if (los.length > 0) {
      const loLabels = los.map((lo) => `LO ${(theme.los ?? []).findIndex((l) => l._id === lo._id) + 1}`).join(', ');
      parts.push(`Topic ${themeIndex + 1} / ${loLabels}`);
    } else if (themeIds.includes(theme._id)) {
      parts.push(`Topic ${themeIndex + 1}`);
    }
  });
  return parts.length ? parts.join('; ') : '—';
}

const REPAIR_REASON: Record<AgentRepair['trigger'], string> = {
  unstorable: 'its options could not be stored',
  'numeric-verification': 'it failed a numeric check',
  'constant-value': 'a formula never changed with the inputs',
  'checker-reject': 'the AI check rejected it',
};

/** Reader copy for the generation-time repair, or null when none ran. */
export function repairSummary(repair: AgentRepair | undefined): string | null {
  if (!repair?.attempted) return null;
  const reason = REPAIR_REASON[repair.trigger];
  if (repair.error) return `An automatic fix was attempted because ${reason}, but the fix call failed (${repair.error}). This is the original version.`;
  if (repair.adopted) return `Fixed automatically: the first version was replaced because ${reason}. The AI check above is for the fixed version.`;
  return `An automatic fix was tried because ${reason}, but it did not improve the question. This is the original version.`;
}

/** Reader copy for parameter values the solver removed, or null. */
export function solverSummary(verification: Pick<NumericVerification, 'parameterSolver'> | undefined): string | null {
  const removed = verification?.parameterSolver?.removed ?? [];
  if (!removed.length) return null;
  const list = removed.map((row) => `${row.slot} ${row.values.join(', ')}`).join('; ');
  return `Parameter values adjusted automatically so no two options show the same number: removed ${list} (checked ${verification!.parameterSolver!.checkedCombinations} combinations).`;
}

/** "Origin & family" in the Review tab: where this version came from. */
export function provenanceText(provenance: QuestionVersion['provenance']): string {
  if (!provenance) return 'Legacy question · provenance not recorded';
  switch (provenance.kind) {
    case 'generated':
      return `Generated · run ${provenance.runId.slice(-8)} · item ${provenance.item + 1}${provenance.blueprintId ? ` · blueprint ${provenance.blueprintId.slice(-8)}` : ''}`;
    case 'imported':
      return `Imported from ${provenance.sourceName ?? provenance.format.toUpperCase()} · item ${provenance.item + 1}`;
    case 'script-migration':
      return `Parameterized script migration${provenance.sourceName ? ` · ${provenance.sourceName}` : ''}`;
    case 'edited':
      return `Edited from version ${provenance.parentVersionId.slice(-8)}`;
    case 'manual':
      return 'Manual authoring';
  }
}

/** The current version's origin; an edited version also names the original. */
export function originText(current: QuestionVersion['provenance'], versions: ReadonlyArray<{ provenance?: QuestionVersion['provenance'] }>): string {
  const original = versions.map((version) => version.provenance).find((candidate) => candidate?.kind !== 'edited');
  return current?.kind === 'edited' && original ? `${provenanceText(current)} · Original: ${provenanceText(original)}` : provenanceText(current);
}
