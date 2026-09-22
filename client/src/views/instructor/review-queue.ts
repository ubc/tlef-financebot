import { attachTutorial } from '../../tutorials.js';
import { createReviewWorkbench } from './review-workbench.js';
import {
  ApiError,
  bulkDelete,
  type BulkDeleteSkipReason,
  bulkTransition,
  getContentRun,
  getCourseTree,
  getQuestion,
  getReviewQueue,
  type CourseTree,
  type QuestionLabel,
  type ReviewQueueItem,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { filterTabs, pageHeader } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import { errorState, loadingState } from '../../ui.js';
import { currentQuery, type RouteParams } from '../../router.js';

/** Arrival from a generation run (`?runId=` — preseeding.ts's "Review
 * Drafts" links): how many of the run's created questions are in the queue
 * right now, and how many have already left it (approved, archived,
 * deleted). Pure so the banner copy is unit-testable. */
export function runHighlightSummary(
  createdQuestionIds: readonly string[],
  queueIds: readonly string[],
): { shown: number; missing: number } {
  const queue = new Set(queueIds);
  const shown = createdQuestionIds.filter((id) => queue.has(id)).length;
  return { shown, missing: createdQuestionIds.length - shown };
}

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

/** Question-type filter (2026-09-04): when one type is short in the bank the
 * instructor wants the other type's candidates in one place. Orthogonal to
 * the tabs, which are about decisions; this is about the question itself. */
export type QueueTypeFilter = 'all' | 'mcq' | 'true-false';

export const QUEUE_TYPE_FILTERS: QueueTypeFilter[] = ['all', 'mcq', 'true-false'];

const TYPE_FILTER_LABEL: Record<QueueTypeFilter, string> = {
  all: 'All types',
  mcq: 'MCQ only',
  'true-false': 'True/False only',
};

export function matchesType(item: { current: { type: 'mcq' | 'true-false' } }, filter: QueueTypeFilter): boolean {
  return filter === 'all' || item.current.type === filter;
}

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

type SortKey = 'priority' | 'stem';

async function renderReviewQueueInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading review queue…'));
  const root = el('div', { class: 'view view--review-workbench' }, body);
  mount(outlet, root);

  // Arrival from a generation run: the run's created question ids become a
  // highlight over the full queue (never a filter — the instructor asked to
  // see what a run produced, not to lose the rest of their worklist). A run
  // that cannot be loaded degrades to a plain queue with a note; it must not
  // block the page.
  const arrivalRunId = currentQuery().get('runId') ?? '';
  let highlightIds: Set<string> | null = null;
  let highlightError: string | null = null;
  let highlightScrolled = false;

  let tree: CourseTree;
  let queueItems: ReviewQueueItem[];
  try {
    [tree, queueItems] = await Promise.all([
      getCourseTree(courseId),
      getReviewQueue(courseId),
      arrivalRunId
        ? getContentRun(courseId, arrivalRunId).then(
            (run) => {
              if (run.kind === 'question-generation') highlightIds = new Set(run.result?.createdQuestionIds ?? []);
              else highlightError = `Run ${arrivalRunId.slice(-8)} is not a question-generation run.`;
            },
            () => {
              highlightError = `Run ${arrivalRunId.slice(-8)} could not be loaded, so nothing is highlighted.`;
            },
          )
        : Promise.resolve(),
    ]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderReviewQueueInner(outlet, courseId)));
    return;
  }

  const queueBasePath = `/instructor/course/${encodeURIComponent(courseId)}/queue`;

  function highlightBanner(): HTMLElement | false {
    if (highlightError) {
      return el('p', { class: 'queue-message queue-message--highlight', role: 'status', text: highlightError });
    }
    if (!highlightIds) return false;
    const { shown, missing } = runHighlightSummary([...highlightIds], queueItems.map((item) => item.id));
    const plural = (count: number): string => `${count} question${count === 1 ? '' : 's'}`;
    const missingText = missing > 0
      ? ` ${missing} other${missing === 1 ? '' : 's'} from that run ${missing === 1 ? 'is' : 'are'} no longer in the queue.`
      : '';
    return el(
      'p',
      { class: 'queue-message queue-message--highlight', role: 'status' },
      shown > 0
        ? `Highlighting ${plural(shown)} generated by run ${arrivalRunId.slice(-8)}.${missingText}`
        : `Run ${arrivalRunId.slice(-8)} has no questions left in the queue.${missingText}`,
      ' ',
      el(
        'a',
        {
          href: `#${queueBasePath}`,
          onclick: (event: Event) => {
            event.preventDefault();
            navigate(queueBasePath);
          },
        },
        'Clear highlight',
      ),
    );
  }

  /** Bring the first highlighted row into view once, on the first paint that
   * has one — not on every re-render, which would yank the page around while
   * the instructor works. */
  function scrollToHighlight(): void {
    if (highlightScrolled || !highlightIds) return;
    const first = resultsContainer.querySelector<HTMLElement>('.review-workbench__row.is-current');
    if (!first) return;
    highlightScrolled = true;
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    const results: Array<PromiseSettledResult<Awaited<ReturnType<typeof getQuestion>>>> = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (cursor < items.length && token === loadToken && root.isConnected) {
        const index = cursor++;
        try { results[index] = { status: 'fulfilled', value: await getQuestion(items[index].id) }; }
        catch (reason) { results[index] = { status: 'rejected', reason }; }
      }
    }));
    if (token !== loadToken || !root.isConnected) return;
    results.forEach((result, i) => {
      agentDecisions.set(items[i].id, result.status === 'fulfilled' ? result.value.agentDecision : undefined);
    });
    renderTabs();
    renderResults();
  }

  let activeTab: QueueTab = 'all';
  let typeFilter: QueueTypeFilter = 'all';
  let sortKey: SortKey = 'priority';
  const selected = new Set<string>();
  let loadErrorMessage: string | null = null;
  let actionErrorMessage: string | null = null;
  let bulkMessage: string | null = null;
  let bulkBusy = false;

  const tabsContainer = el('div', { class: 'review-workbench-tabs' });
  const filtersContainer = el('div', { class: 'review-workbench-filters' });
  const controlsContainer = el('div', { 'data-tutorial': 'review-filters' });
  const messages = el('div', {});
  const workbench = createReviewWorkbench({ courseId, tree, selected, preferredId: queueItems.find(item => highlightIds?.has(item.id))?.id,
    onSelection: renderControls,
    onClearFilters: () => {
      activeTab = 'all'; typeFilter = 'all'; sortKey = 'priority';
      searchInput.value = ''; workbench.search('');
      renderTabs(); renderControls(); renderResults(); searchInput.focus();
    },
    onDetail: (detail) => { agentDecisions.set(detail.id, detail.agentDecision); renderTabs(); },
    onDecision: (id) => {
      queueItems = queueItems.filter(item => item.id !== id);
      selected.delete(id); renderTabs(); renderControls(); renderResults();
      // Refresh authoritative queue in the background without remounting the reader.
      void reload();
    },
  });
  const resultsContainer = el('div', { class: 'review-workbench-results' }, messages, workbench.root);
  const searchInput = el('input', { class: 'input', type: 'search', 'aria-label': 'Search review questions', placeholder: 'Search questions or objectives…', oninput: () => workbench.search(searchInput.value) });
  const advanced = el('details', { class: 'review-workbench-tools' }, el('summary', { text: 'Bulk actions' }), controlsContainer);
  const toolbar = el('div', { class: 'review-workbench-toolbar' }, searchInput, filtersContainer, advanced);
  const layout = el('div', { class: 'review-workbench-layout' }, tabsContainer, toolbar, resultsContainer);

  function tabInputs(): QueueTabInput[] {
    return queueItems.map((item) => ({ labels: item.labels, agentDecision: agentDecisions.get(item.id) }));
  }

  function visibleRows(): ReviewQueueItem[] {
    const inputs = tabInputs();
    const filtered = queueItems.filter((item, i) => matchesTab(inputs[i], activeTab) && matchesType(item, typeFilter));
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

  /** Runs one bulk action over the selection, then refetches the queue. The
   * action returns the message to show; a thrown error shows as the action
   * error and keeps the selection so the instructor can retry. */
  async function runBulk(action: (ids: string[]) => Promise<string>): Promise<void> {
    if (bulkBusy) return;
    if (workbench.isLocked()) {
      actionErrorMessage = 'Finish editing or wait for the current decision before applying a bulk action.';
      renderResults(); return;
    }
    const ids = [...selected];
    bulkBusy = true;
    actionErrorMessage = null;
    bulkMessage = null;
    renderControls();
    try {
      bulkMessage = await action(ids);
      selected.clear();
      queueItems = await getReviewQueue(courseId);
      agentDecisions.clear();
      renderTabs();
      void enrichAgentDecisions(queueItems); // background — see the module note
    } catch (error) {
      actionErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
    } finally {
      bulkBusy = false;
    }
    renderControls();
    renderResults();
  }

  const plural = (count: number): string => `${count} question${count === 1 ? '' : 's'}`;

  async function bulkApprove(): Promise<void> {
    if (selected.size === 0) return;
    if (!await confirmDialog({
      title: 'Approve selected questions?',
      message: `${plural(selected.size)} will be approved. Student access still follows course publication, topic release and validation checks.`,
      confirmLabel: 'Approve questions',
    })) return;
    await runBulk(async (ids) => {
      const { updated } = await bulkTransition(ids, 'approved');
      return `Approved ${updated} of ${plural(ids.length)} (others were not in an approvable state).`;
    });
  }

  async function bulkArchive(): Promise<void> {
    if (selected.size === 0) return;
    if (!await confirmDialog({
      title: 'Archive selected questions?',
      message: `${plural(selected.size)} will leave the queue and stop being served. Archived questions keep their history and can be restored from the Archived tab.`,
      confirmLabel: 'Archive questions',
    })) return;
    await runBulk(async (ids) => {
      const { updated } = await bulkTransition(ids, 'archived');
      return `Archived ${updated} of ${plural(ids.length)}.`;
    });
  }

  const SKIP_REASON_TEXT: Record<BulkDeleteSkipReason, string> = {
    'ever-approved': 'already approved once — archive instead',
    'has-history': 'referenced by student attempts, flags or review books — archive instead',
    'not-found': 'no longer exist',
  };

  async function bulkDeleteSelected(): Promise<void> {
    if (selected.size === 0) return;
    if (!await confirmDialog({
      title: 'Delete selected questions permanently?',
      message: `${plural(selected.size)} will be deleted, with every version. This cannot be undone. Only questions that were never approved and never served are deleted; anything with student history is skipped and reported so you can archive it instead.`,
      confirmLabel: 'Delete permanently',
      tone: 'danger',
    })) return;
    await runBulk(async (ids) => {
      const { deleted, skipped } = await bulkDelete(ids);
      const reasons = (['ever-approved', 'has-history', 'not-found'] as const)
        .map((reason) => ({ reason, count: skipped.filter((entry) => entry.reason === reason).length }))
        .filter((entry) => entry.count > 0)
        .map((entry) => `${entry.count} ${SKIP_REASON_TEXT[entry.reason]}`);
      return `Deleted ${deleted} of ${plural(ids.length)}.${reasons.length ? ` Skipped: ${reasons.join('; ')}.` : ''}`;
    });
  }

  function renderControls(): void {
    controlsContainer.replaceChildren(controlsRow());
  }

  function controlsRow(): HTMLElement {
    const sortSelect = el(
      'select',
      {
        class: 'input',
        'aria-label': 'Sort the review queue',
        onchange: (e: Event) => {
          sortKey = (e.target as HTMLSelectElement).value as SortKey;
          renderResults();
        },
      },
      el('option', { value: 'priority', text: 'Sort by: Priority', selected: sortKey === 'priority' ? 'selected' : undefined }),
      el('option', { value: 'stem', text: 'Sort by: Question (A–Z)', selected: sortKey === 'stem' ? 'selected' : undefined }),
    ) as HTMLSelectElement;

    // Type filter with live counts over the current tab, so "True/False only
    // (0)" tells the instructor there is nothing to find before they click.
    const inputs = tabInputs();
    const onTab = queueItems.filter((_, i) => matchesTab(inputs[i], activeTab));
    const typeSelect = el(
      'select',
      {
        class: 'input',
        'aria-label': 'Filter the review queue by question type',
        onchange: (e: Event) => {
          typeFilter = (e.target as HTMLSelectElement).value as QueueTypeFilter;
          renderControls();
          renderResults();
        },
      },
      ...QUEUE_TYPE_FILTERS.map((filter) =>
        el('option', {
          value: filter,
          text: `${TYPE_FILTER_LABEL[filter]} (${onTab.filter((item) => matchesType(item, filter)).length})`,
          selected: typeFilter === filter ? 'selected' : undefined,
        }),
      ),
    ) as HTMLSelectElement;

    // Select all / none over the rows this tab + sort currently shows.
    const visible = visibleRows();
    const visibleSelected = visible.filter((item) => selected.has(item.id)).length;
    const selectAll = el('input', {
      type: 'checkbox',
      'aria-label': 'Select every question shown',
      checked: visible.length > 0 && visibleSelected === visible.length ? 'checked' : undefined,
      disabled: visible.length === 0 ? 'disabled' : undefined,
      onchange: (e: Event) => {
        if ((e.target as HTMLInputElement).checked) for (const item of visible) selected.add(item.id);
        else for (const item of visible) selected.delete(item.id);
        renderControls();
        renderResults();
      },
    }) as HTMLInputElement;
    selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
    const selectAllLabel = el(
      'label',
      { class: 'bulk-select-all' },
      selectAll,
      el('span', { text: selected.size > 0 ? `${selected.size} selected` : 'Select all' }),
    );

    // Bulk Approve stays the one-click action; Archive and Delete sit behind
    // a native <select> so the dangerous actions take a deliberate pick.
    const bulkButton = el(
      'button',
      {
        class: 'btn btn--ghost',
        type: 'button',
        disabled: selected.size === 0 || bulkBusy ? 'disabled' : undefined,
        busy: bulkBusy,
        onclick: () => bulkApprove(),
      },
      bulkBusy ? 'Applying…' : 'Bulk Approve…',
    );
    const moreActions = el(
      'select',
      {
        class: 'input',
        'aria-label': 'More bulk actions',
        disabled: selected.size === 0 || bulkBusy ? 'disabled' : undefined,
        onchange: (e: Event) => {
          const menu = e.target as HTMLSelectElement;
          const action = menu.value;
          menu.value = '';
          if (action === 'archive') void bulkArchive();
          else if (action === 'delete') void bulkDeleteSelected();
        },
      },
      el('option', { value: '', text: 'More actions…', selected: 'selected' }),
      el('option', { value: 'archive', text: 'Archive selected' }),
      el('option', { value: 'delete', text: 'Delete selected…' }),
    ) as HTMLSelectElement;

    filtersContainer.replaceChildren(typeSelect, sortSelect);
    return el('div', { class: 'queue-controls' }, selectAllLabel, bulkButton, moreActions);
  }

  function renderResults(): void {
    const rows = visibleRows();
    for (const [id, decision] of agentDecisions) workbench.setAgent(id, decision?.decision);
    mount(messages,
      loadErrorMessage ? errorState(loadErrorMessage, () => void reload()) : false,
      actionErrorMessage ? errorState(actionErrorMessage) : false,
      bulkMessage ? el('p', { class: 'queue-message', text: bulkMessage }) : false,
      highlightBanner());
    toolbar.hidden = queueItems.length === 0;
    tabsContainer.hidden = queueItems.length === 0;
    workbench.update(rows, queueItems.length);
    scrollToHighlight();
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
      'Check each question, then approve it for your Question Bank.',
      { text: 'Open Question Bank →', onClick: () => navigate(`/instructor/course/${encodeURIComponent(courseId)}/bank`) },
    ),
    layout,
  );
  renderTabs();
  renderControls();
  renderResults();
  void enrichAgentDecisions(queueItems);
  attachTutorial(root, 'instructor-review', {});
}

export function renderReviewQueue(outlet: HTMLElement, params: RouteParams): void {
  void renderReviewQueueInner(outlet, params.id);
}
