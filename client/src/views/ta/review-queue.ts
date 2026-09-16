import { attachTutorial } from '../../tutorials.js';
// TA Review Queue (TA-01) — the instructor review queue's layout with only
// TA-permitted actions. Phase 3 Task 6 specified "same data as the instructor
// queue but the payload/UI carry no approve/reject affordances"; this view is
// that, sharing the instructor view's tab logic (`matchesTab`/`queueTabCounts`)
// and its badge/label vocabulary so the two read identically.
//
// Deliberately absent: Approve, Bulk Approve, and any editing control. Approve
// is `question.approve`, which no configuration grants a TA (phase-3 constraint).
// The shared TA question reader is embedded here for suggestions and notes.
// Flag escalation stays in Flag Triage; instructor mutation controls are never reused.
//
// Topic/LO comes from `getCourseOutline` (question.review), NOT `getCourseTree`
// (instructor-only): a real TA 403s on the latter. See ta-ui.ts.
import {
  ApiError,
  getCourseOutline,
  getMyCourseCapabilities,
  type Capability,
  getQuestion,
  getTaReviewQueue,
  markTaQuestionReviewed,
  type CourseOutline,
  type TaReviewQueueItem,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { rowStemText } from '../../placeholders.js';
import { filterTabs, pageHeader } from '../../instructor-ui.js';
import { renderTaQuestionDetail } from './question-detail.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { TYPE_LABEL } from '../instructor/bank.js';
import {
  matchesTab,
  queueTabCounts,
  type QueueTab,
  type QueueTabInput,
} from '../instructor/review-queue.js';
import { pendingSuggestionCount, topicLoLabel } from './ta-ui.js';


const QUEUE_TABS: QueueTab[] = ['all', 'flagged', 'agent-flag', 'agent-reject', 'agent-pass'];

const TAB_LABEL: Record<QueueTab, string> = {
  all: 'All',
  flagged: 'Flagged by student',
  'agent-flag': 'Agent: Flag',
  'agent-reject': 'Agent: Reject',
  'agent-pass': 'Agent: Pass',
};

type SortKey = 'priority' | 'stem';

async function renderInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading TA review queue…'));
  const root = el('div', { class: 'view view--review-workbench ta-review-workspace' }, body);
  mount(outlet, root);

  let outline: CourseOutline;
  let items: TaReviewQueueItem[];
  let permissions: Record<Capability, boolean>;
  try {
    [outline, items, permissions] = await Promise.all([getCourseOutline(courseId), getTaReviewQueue(courseId), getMyCourseCapabilities(courseId)]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderInner(outlet, courseId)));
    return;
  }

  // Agent decisions are enriched in the BACKGROUND, exactly as the instructor
  // queue does it (see views/instructor/review-queue.ts's module note): the
  // queue payload carries no `agentDecision`, so each row needs its own
  // getQuestion(). `loadToken` + `root.isConnected` drop a stale run.
  const agentDecisions = new Map<string, { decision: 'pass' | 'flag' | 'reject' } | undefined>();
  let loadToken = 0;

  async function enrichAgentDecisions(list: TaReviewQueueItem[]): Promise<void> {
    const token = ++loadToken;
    const results = await Promise.allSettled(list.map((item) => getQuestion(item.id)));
    if (token !== loadToken || !root.isConnected) return;
    results.forEach((result, i) => {
      agentDecisions.set(list[i].id, result.status === 'fulfilled' ? result.value.agentDecision : undefined);
    });
    renderTabs();
    renderResults();
  }

  let activeTab: QueueTab = 'all';
  let sortKey: SortKey = 'priority';
  let query = '';
  let activeId = '';
  const readers = new Map<string, HTMLElement>();
  let actionErrorMessage: string | null = null;
  let actionMessage: string | null = null;
  const pendingReviewIds = new Set<string>();

  const tabsContainer = el('div', { class: 'review-workbench-tabs' });
  const controlsContainer = el('div', {});
  const resultsContainer = el('div', { 'data-tutorial': 'ta-review-items' });

  function tabInputs(): QueueTabInput[] {
    return items.map((item) => ({ labels: item.labels, agentDecision: agentDecisions.get(item.id) }));
  }

  function visibleRows(): TaReviewQueueItem[] {
    const inputs = tabInputs();
    const filtered = items.filter((item, i) => matchesTab(inputs[i], activeTab) && `${rowStemText(item)} ${topicLoLabel(outline, item.loIds, item.themeIds)}`.toLowerCase().includes(query));
    if (sortKey === 'stem') return [...filtered].sort((a, b) => a.current.stem.localeCompare(b.current.stem));
    return filtered; // already server-prioritized
  }

  function renderTabs(): void {
    const counts = queueTabCounts(tabInputs());
    mount(
      tabsContainer,
      filterTabs(
        QUEUE_TABS.map((tab) => `${TAB_LABEL[tab]} (${counts[tab]})`),
        QUEUE_TABS.indexOf(activeTab),
        (i) => {
          activeTab = QUEUE_TABS[i];
          renderTabs();
          renderResults();
        },
      ),
    );
  }

  function renderControls(): void {
    const sortSelect = el('select', {
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
    const search = el('input', { class: 'input', type: 'search', placeholder: 'Search questions or objectives…', 'aria-label': 'Search questions or objectives', value: query, oninput: (event: Event) => { query = (event.target as HTMLInputElement).value.toLowerCase(); renderResults(); } });
    mount(controlsContainer, el('div', { class: 'ta-review-tools' }, search, sortSelect));
  }

  async function markReviewed(item: TaReviewQueueItem): Promise<void> {
    if (pendingReviewIds.has(item.id)) return;
    pendingReviewIds.add(item.id);
    actionErrorMessage = null;
    actionMessage = null;
    renderResults();
    try {
      await markTaQuestionReviewed(item.id);
      items = await getTaReviewQueue(courseId);
      agentDecisions.clear();
      actionMessage = 'Marked reviewed.';
      renderTabs();
      void enrichAgentDecisions(items);
    } catch (error) {
      actionErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
    } finally {
      pendingReviewIds.delete(item.id);
    }
    renderResults();
  }

  function openBoard(rows: TaReviewQueueItem[]): void {
    const dialog = el('dialog', { class: 'app-dialog ta-question-board', 'aria-label': 'Question board' }) as HTMLDialogElement;
    dialog.append(el('div', { class: 'app-dialog__surface' }, el('h2', { text: 'Jump to a question' }),
      el('div', { class: 'ta-board-grid' }, ...rows.map((item, index) => el('button', { type: 'button', class: 'btn btn--ghost', text: String(index + 1), title: rowStemText(item), 'aria-label': `Question ${index + 1}: ${rowStemText(item)}`, onclick: () => { activeId = item.id; dialog.close(); renderResults(); } }))),
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Close', onclick: () => dialog.close() })));
    dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
  }

  function renderResults(): void {
    const rows = visibleRows();
    if (!rows.some(item => item.id === activeId)) activeId = rows[0]?.id ?? '';
    const item = rows.find(row => row.id === activeId);
    tabsContainer.hidden = items.length === 0;
    controlsContainer.hidden = items.length === 0;
    if (!item) {
      mount(resultsContainer, el('section', { class: 'review-empty' },
        el('div', { class: `review-empty__art${items.length ? ' is-search' : ''}`, 'aria-hidden': 'true' },
          el('span', { class: 'review-empty__sheet review-empty__sheet--back' }),
          el('span', { class: 'review-empty__sheet' }, el('i', {}), el('i', {}), el('i', {})),
          el('span', { class: 'review-empty__seal', text: items.length ? '⌕' : '✓' })),
        el('div', { class: 'review-empty__content' },
          el('p', { class: 'review-empty__eyebrow', text: items.length ? 'REFINE YOUR SEARCH' : 'YOUR REVIEW QUEUE' }),
          el('h2', { text: items.length ? 'No matching questions' : 'Nothing waiting for review' }),
          el('p', { class: 'review-empty__description', text: items.length ? 'Try another keyword or clear your filters to see the rest of the queue.' : 'Newly generated and imported questions will appear here when they’re ready for your review.' }),
          items.length ? el('div', { class: 'review-empty__actions' }, el('button', { type: 'button', class: 'btn btn--instr-primary', text: 'Clear filters', onclick: () => { query = ''; activeTab = 'all'; renderControls(); renderTabs(); renderResults(); } })) : false,
          el('p', { class: 'review-empty__footnote', text: 'Suggest edits and leave notes here. Final approval remains instructor-only.' }))));
      return;
    }
    let reader = readers.get(item.id);
    const isNew = !reader;
    if (!reader) { reader = el('div', { class: 'ta-embedded' }); readers.set(item.id, reader); }
    const pending = pendingSuggestionCount(item);
    const marking = pendingReviewIds.has(item.id);
    mount(resultsContainer,
      actionErrorMessage ? errorState(actionErrorMessage) : false,
      actionMessage ? el('p', { role: 'status', text: actionMessage }) : false,
      el('section', { class: 'ta-review-workbench' },
        el('nav', { class: 'review-workbench__queue', 'aria-label': 'Question queue' },
          el('div', { class: 'review-workbench__list-title', text: `QUESTIONS · ${rows.length}` }),
          el('div', { class: 'review-workbench__list' }, ...rows.map((row, index) => el('div', { class: `review-workbench__row${row.id === activeId ? ' is-current' : ''}` },
            el('button', { type: 'button', 'aria-current': row.id === activeId ? 'true' : undefined, onclick: () => { activeId = row.id; renderResults(); } },
              el('span', { class: 'review-workbench__row-meta', text: `${String(index + 1).padStart(2, '0')} · ${TYPE_LABEL[row.current.type]} · ${row.current.difficulty}` }),
              el('span', { class: 'review-workbench__row-title', text: rowStemText(row) }),
              el('span', { class: 'review-workbench__row-status', text: row.state === 'reviewed' ? 'Reviewed' : agentDecisions.get(row.id)?.decision === 'flag' ? 'Needs attention' : 'Awaiting review' }))))),
          el('div', { class: 'review-workbench__list-footer' }, el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: `▦ Question board · ${rows.length}`, onclick: () => openBoard(rows) }))),
        el('article', { class: 'ta-review-reader', 'aria-label': 'Selected question' },
          reader,
          el('div', { class: 'ta-reader-actions' }, el('span', { text: pending ? `${pending} suggestions awaiting instructor review` : 'Final approval remains instructor-only.' }),
            permissions['question.mark-reviewed'] ? el('button', { class: 'btn btn--instr-primary', type: 'button', text: item.state === 'reviewed' ? 'Reviewed' : 'Mark reviewed', busy: marking, disabled: marking || item.state === 'reviewed', onclick: () => markReviewed(item) }) : el('small', { text: 'Mark reviewed is unavailable for your permissions.' })))));
    if (isNew) renderTaQuestionDetail(reader, { id: courseId, questionId: item.id });
  }

  body.replaceChildren(
    pageHeader(
      'Review Queue',
      'Check each question, suggest edits, and leave notes for your instructor.',
    ),
    el('div', {}, tabsContainer, controlsContainer, resultsContainer),
  );
  renderTabs();
  renderControls();
  renderResults();
  void enrichAgentDecisions(items);
  attachTutorial(root, 'ta-review', { 'ta-review-context': '.page-header' });
}

export function renderTaReviewQueue(outlet: HTMLElement, params: RouteParams): void {
  void renderInner(outlet, params.id);
}
