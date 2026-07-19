// Review Queue (I5) — the instructor's prioritized worklist: agent-decision
// filter tabs, inline approve, bulk approve (Task 15, Task F). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-id `148:3779`) and `.superpowers/sdd/task-15/i5-review-queue.png`.
//
// Data-shape note (verified against server/src/services/bank.service.ts's
// reviewQueue() + questions.routes.ts's GET /courses/:courseId/review-queue,
// see api.ts's `ReviewQueueItem`): the queue endpoint returns the same
// trimmed shape as `browseBank` (id/state/labels/loIds/themeIds/current) plus
// `priority` — it does NOT include `agentDecision`. `agentDecision` is
// reserved for the single-question `getQuestion` (Task E's own note, same
// server-side toBankItem() function backs both endpoints). The wireframe's
// "Agent: Flag/Reject/Pass" tabs and per-row Agent Decision badge need real
// (not fabricated) `agentDecision.decision` values, so this view enriches the
// queue with one `getQuestion(id)` per item (Promise.allSettled — a single
// failed lookup doesn't fail the page; that item's Agent Decision just reads
// "—" and never matches an Agent: tab). No server change; `getQuestion`
// already exists (Task E). This trades an extra request per row for real data
// instead of a fake/derived agent decision — flagged in the Task F report as
// a perf tradeoff worth reconsidering if course review queues grow large.
//
// First-paint note (Task F re-review fix): enrichment runs in the
// BACKGROUND, not awaited before the first render — the header/tabs/table/
// stem/status need none of it (all already on `ReviewQueueItem`); only the
// Agent Decision column/tabs do, and they render "—"/0 until enrichment
// fills in. `loadToken` + `root.isConnected` guard `enrichAgentDecisions`'s
// eventual DOM write against two staleness cases: (1) a `reload()`/bulk-
// approve refetch starting a newer enrichment while an older one is still
// in flight (the older one's token no longer matches `loadToken`, so its
// resolution is a no-op), and (2) the user navigating away entirely before
// enrichment settles (`root` is detached from `outlet` by then).
//
// Omitted vs. the wireframe (no data source; "omit rather than fake" per the
// Task F brief): the row flag indicators for "High error rate" and
// "Under-covered LO" — neither an error rate nor a coverage number is
// returned by any endpoint in scope (the server only uses coverage
// internally to rank `priority` tier 3, see reviewQueue()'s doc comment; it
// never serializes the number). "Student Flagged" renders as a plain flag
// (present in `labels`) without the wireframe's fabricated count, since the
// queue item only carries a boolean label, not a per-question flag count.
import {
  ApiError,
  bulkTransition,
  getCourseTree,
  getQuestion,
  getReviewQueue,
  transitionQuestion,
  type CourseTree,
  type PublicationState,
  type QuestionLabel,
  type ReviewQueueItem,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { filterTabs, pageHeader, statusBadge, type BadgeVariant } from '../../instructor-ui.js';
import { renderRichText } from '../../render.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { STATUS_LABEL, TYPE_LABEL, statusToBadgeVariant } from './bank.js';

function navigate(path: string): void {
  window.location.hash = path;
}

/** The subset of a fetched `agentDecision` this view actually renders (the
 * decision drives the badge + tab membership; reasoning/roleAssessment stay
 * in question-detail.ts's Agent Report panel, out of scope here). */
interface AgentDecisionInfo {
  decision: 'pass' | 'flag' | 'reject';
}

export type QueueTab = 'all' | 'flagged' | 'agent-flag' | 'agent-reject' | 'agent-pass';

const QUEUE_TABS: QueueTab[] = ['all', 'flagged', 'agent-flag', 'agent-reject', 'agent-pass'];

const TAB_LABEL: Record<QueueTab, string> = {
  all: 'All',
  flagged: 'Flagged by student',
  'agent-flag': 'Agent: Flag',
  'agent-reject': 'Agent: Reject',
  'agent-pass': 'Agent: Pass',
};

/** The minimal shape `matchesTab`/`queueTabCounts` need — plain data, no DOM
 * — so they're unit-testable in isolation (Task F workflow: TDD any pure
 * helper). `agentDecision` is `undefined` until enrichment resolves (or if it
 * failed for that item), which correctly excludes it from every Agent: tab. */
export interface QueueTabInput {
  labels: QuestionLabel[];
  agentDecision?: AgentDecisionInfo | undefined;
}

/** Does `item` belong on `tab`? 'all' always matches; 'flagged' reads the
 * `student-flagged` overlay label (present regardless of agent decision);
 * the three Agent: tabs match `agentDecision.decision` exactly and never
 * match an item whose agent decision hasn't loaded (yet, or at all). */
export function matchesTab(item: QueueTabInput, tab: QueueTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'flagged':
      return item.labels.includes('student-flagged');
    case 'agent-flag':
      return item.agentDecision?.decision === 'flag';
    case 'agent-reject':
      return item.agentDecision?.decision === 'reject';
    case 'agent-pass':
      return item.agentDecision?.decision === 'pass';
  }
}

/** Live per-tab counts over the full (unfiltered) queue — what the filter
 * strip's "(N)" suffixes show. */
export function queueTabCounts(items: QueueTabInput[]): Record<QueueTab, number> {
  const counts = {} as Record<QueueTab, number>;
  for (const tab of QUEUE_TABS) {
    counts[tab] = items.filter((item) => matchesTab(item, tab)).length;
  }
  return counts;
}

const AGENT_BADGE_VARIANT: Record<AgentDecisionInfo['decision'], BadgeVariant> = {
  pass: 'pass',
  flag: 'flag',
  reject: 'reject',
};

/** Approve always moves toward 'approved' one legal PUBLICATION_TRANSITIONS
 * edge at a time — mirrors question-detail.ts's `approveTarget` exactly (Task
 * F brief: "reuse the same legal-transition logic pattern Task E used"). A
 * Draft question goes to pending-review first (no draft->approved edge);
 * pending-review/reviewed/paused go straight to approved. `null` means no
 * further approval step applies (already approved, or archived). */
function approveTarget(state: PublicationState): PublicationState | null {
  if (state === 'draft') return 'pending-review';
  if (state === 'pending-review' || state === 'reviewed' || state === 'paused') return 'approved';
  return null;
}

/** "Topic 1 / LO 1, LO 4" style label for a question's tagged Topics/LOs —
 * same convention as bank.ts's `topicLoLabel` (kept identical across
 * instructor views rather than the wireframe's literal "LO 2 / Topic 1"
 * order, so a question's Topic/LO column reads the same way everywhere). */
function topicLoLabel(tree: CourseTree, loIds: string[], themeIds: string[]): string {
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

type SortKey = 'priority' | 'stem';

async function renderReviewQueueInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading review queue…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  let tree: CourseTree;
  let queueItems: ReviewQueueItem[];
  try {
    [tree, queueItems] = await Promise.all([getCourseTree(courseId), getReviewQueue(courseId)]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderReviewQueueInner(outlet, courseId)));
    return;
  }

  const agentDecisions = new Map<string, AgentDecisionInfo | undefined>();

  // Bumped every time a fresh enrichment starts (initial load, reload(), a
  // bulk-approve refetch). `enrichAgentDecisions` captures its own token at
  // start and checks it on resolve — a superseded (stale) run drops its
  // result instead of overwriting newer data or re-rendering over a newer
  // render. See the module note.
  let loadToken = 0;

  /** Fetches the real `agentDecision` for every queue item in parallel (see
   * the module note), in the BACKGROUND — callers never await this before
   * their own first paint. On resolve, bails out silently if a newer
   * enrichment has since started (`token !== loadToken`) or the view has been
   * navigated away from (`!root.isConnected`); otherwise fills in
   * `agentDecisions` and re-renders the tabs (counts) + rows (badges). */
  async function enrichAgentDecisions(items: ReviewQueueItem[]): Promise<void> {
    const token = ++loadToken;
    const results = await Promise.allSettled(items.map((item) => getQuestion(item.id)));
    if (token !== loadToken || !root.isConnected) return;
    results.forEach((result, i) => {
      agentDecisions.set(items[i].id, result.status === 'fulfilled' ? result.value.agentDecision : undefined);
    });
    renderTabs();
    renderResults();
  }

  let activeTab: QueueTab = 'all';
  let sortKey: SortKey = 'priority';
  const selected = new Set<string>();
  let loadErrorMessage: string | null = null;
  let actionErrorMessage: string | null = null;
  let bulkMessage: string | null = null;

  const tabsContainer = el('div', {});
  const controlsContainer = el('div', {});
  const resultsContainer = el('div', {});
  const layout = el('div', {}, tabsContainer, controlsContainer, resultsContainer);

  function tabInputs(): QueueTabInput[] {
    return queueItems.map((item) => ({ labels: item.labels, agentDecision: agentDecisions.get(item.id) }));
  }

  function visibleRows(): ReviewQueueItem[] {
    const inputs = tabInputs();
    const filtered = queueItems.filter((_, i) => matchesTab(inputs[i], activeTab));
    if (sortKey === 'stem') {
      return [...filtered].sort((a, b) => a.current.stem.localeCompare(b.current.stem));
    }
    return filtered; // already server-prioritized (priority tier, then coverage) order
  }

  function renderTabs(): void {
    const counts = queueTabCounts(tabInputs());
    const activeIndex = QUEUE_TABS.indexOf(activeTab);
    mount(
      tabsContainer,
      filterTabs(
        QUEUE_TABS.map((tab) => `${TAB_LABEL[tab]} (${counts[tab]})`),
        activeIndex,
        (i) => {
          activeTab = QUEUE_TABS[i];
          renderTabs();
          renderResults();
        },
      ),
    );
  }

  async function approveOne(item: ReviewQueueItem): Promise<void> {
    const to = approveTarget(item.state);
    if (!to) return;
    actionErrorMessage = null;
    try {
      const updated = await transitionQuestion(item.id, to);
      queueItems = queueItems.map((q) => (q.id === item.id ? { ...q, state: updated.state } : q));
    } catch (error) {
      actionErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
    }
    renderResults();
  }

  async function bulkApprove(): Promise<void> {
    if (selected.size === 0) return;
    const ids = [...selected];
    if (!window.confirm(`Approve ${ids.length} question${ids.length === 1 ? '' : 's'}?`)) return;
    actionErrorMessage = null;
    bulkMessage = null;
    try {
      const { updated } = await bulkTransition(ids, 'approved');
      bulkMessage = `Approved ${updated} of ${ids.length} question${ids.length === 1 ? '' : 's'} (others were not in an approvable state).`;
      selected.clear();
      queueItems = await getReviewQueue(courseId);
      agentDecisions.clear();
      renderTabs();
      void enrichAgentDecisions(queueItems); // background — see the module note
    } catch (error) {
      actionErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
    }
    renderControls();
    renderResults();
  }

  function renderControls(): void {
    controlsContainer.replaceChildren(controlsRow());
  }

  function controlsRow(): HTMLElement {
    const sortSelect = el(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          sortKey = (e.target as HTMLSelectElement).value as SortKey;
          renderResults();
        },
      },
      el('option', { value: 'priority', text: 'Sort by: Priority', selected: sortKey === 'priority' ? 'selected' : undefined }),
      el('option', { value: 'stem', text: 'Sort by: Question (A–Z)', selected: sortKey === 'stem' ? 'selected' : undefined }),
    ) as HTMLSelectElement;

    const bulkButton = el(
      'button',
      {
        class: 'btn btn--ghost',
        type: 'button',
        disabled: selected.size === 0 ? 'disabled' : undefined,
        onclick: () => void bulkApprove(),
      },
      'Bulk Approve…',
    );

    return el('div', { class: 'queue-controls' }, sortSelect, bulkButton);
  }

  function flagIndicator(item: ReviewQueueItem): HTMLElement | false {
    if (!item.labels.includes('student-flagged')) return false;
    return el('p', { class: 'queue-row__flag queue-row__flag--red', text: '🔴 Student Flagged' });
  }

  function agentBadge(item: ReviewQueueItem): HTMLElement {
    const decision = agentDecisions.get(item.id);
    if (!decision) return statusBadge('—', 'neutral');
    return statusBadge(decision.decision.toUpperCase(), AGENT_BADGE_VARIANT[decision.decision]);
  }

  function questionRow(item: ReviewQueueItem): HTMLElement {
    const stemCell = el('div', { class: 'queue-row__stem' });
    renderRichText(stemCell, item.current.stem);

    const approveTo = approveTarget(item.state);
    const checkbox = el('input', {
      type: 'checkbox',
      'aria-label': 'Select question',
      checked: selected.has(item.id) ? 'checked' : undefined,
      onchange: (e: Event) => {
        if ((e.target as HTMLInputElement).checked) selected.add(item.id);
        else selected.delete(item.id);
        renderControls();
        renderResults();
      },
    }) as HTMLInputElement;

    return el(
      'div',
      { class: 'queue-row' },
      checkbox,
      el('div', {}, stemCell, flagIndicator(item)),
      el('div', { class: 'queue-row__type-lo' }, el('span', { text: TYPE_LABEL[item.current.type] }), el('span', { text: topicLoLabel(tree, item.loIds, item.themeIds) })),
      agentBadge(item),
      statusBadge(STATUS_LABEL[item.state], statusToBadgeVariant(item.state)),
      el(
        'div',
        { class: 'queue-row__actions' },
        el(
          'button',
          {
            class: 'btn btn--instr-primary btn--sm',
            type: 'button',
            onclick: () => navigate(`/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(item.id)}`),
          },
          'Review →',
        ),
        el(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            disabled: approveTo === null ? 'disabled' : undefined,
            title: approveTo ? `Move to ${STATUS_LABEL[approveTo]}` : 'No further approval step from this state',
            onclick: () => void approveOne(item),
          },
          'Approve',
        ),
      ),
    );
  }

  function renderResults(): void {
    const rows = visibleRows();
    mount(
      resultsContainer,
      loadErrorMessage ? errorState(loadErrorMessage, () => void reload()) : false,
      actionErrorMessage ? errorState(actionErrorMessage) : false,
      bulkMessage ? el('p', { class: 'queue-message', text: bulkMessage }) : false,
      el(
        'div',
        { class: 'queue-table' },
        el(
          'div',
          { class: 'queue-row queue-row--head' },
          el('span', {}),
          el('span', { text: 'Question' }),
          el('span', { text: 'Type / LO' }),
          el('span', { text: 'Agent Decision' }),
          el('span', { text: 'Status' }),
          el('span', { text: 'Actions' }),
        ),
        rows.length
          ? el('div', { class: 'queue-table__rows' }, ...rows.map(questionRow))
          : emptyState('No questions match this filter.'),
      ),
    );
  }

  async function reload(): Promise<void> {
    loadErrorMessage = null;
    let fetched: ReviewQueueItem[] | null = null;
    try {
      fetched = await getReviewQueue(courseId);
    } catch (error) {
      loadErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
    }
    if (fetched) {
      queueItems = fetched;
      agentDecisions.clear();
    }
    renderTabs();
    renderControls();
    renderResults();
    if (fetched) void enrichAgentDecisions(queueItems); // background — see the module note
  }

  // First paint happens immediately — none of the header/tabs/table/stem/
  // status needs `agentDecision`, only the Agent Decision column/tabs do
  // (they render "—"/0 until enrichment, kicked off right after, fills them
  // in and re-renders — see the module note).
  body.replaceChildren(
    pageHeader(
      'Review Queue',
      `${queueItems.length} question${queueItems.length === 1 ? '' : 's'} awaiting review · Prioritized: flagged first, then high-error pre-approved, then under-covered LOs`,
    ),
    layout,
  );
  renderTabs();
  renderControls();
  renderResults();
  void enrichAgentDecisions(queueItems);
}

export function renderReviewQueue(outlet: HTMLElement, params: RouteParams): void {
  void renderReviewQueueInner(outlet, params.id);
}
