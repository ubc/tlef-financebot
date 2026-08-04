// TA Review Queue (TA-01) — the instructor review queue's layout with only
// TA-permitted actions. Phase 3 Task 6 specified "same data as the instructor
// queue but the payload/UI carry no approve/reject affordances"; this view is
// that, sharing the instructor view's tab logic (`matchesTab`/`queueTabCounts`)
// and its badge/label vocabulary so the two read identically.
//
// Deliberately absent: Approve, Bulk Approve, and any editing control. Approve
// is `question.approve`, which no configuration grants a TA (phase-3 constraint).
// Suggesting an edit, annotating, and escalating live on the question page
// (views/ta/question-detail.ts) — one question at a time, like the instructor's
// Review → flow — rather than crammed into every row.
//
// Topic/LO comes from `getCourseOutline` (question.review), NOT `getCourseTree`
// (instructor-only): a real TA 403s on the latter. See ta-ui.ts.
import {
  ApiError,
  getCourseOutline,
  getQuestion,
  getTaReviewQueue,
  markTaQuestionReviewed,
  type CourseOutline,
  type TaReviewQueueItem,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { filterTabs, pageHeader, statusBadge, type BadgeVariant } from '../../instructor-ui.js';
import { renderRichText } from '../../render.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { STATUS_LABEL, TYPE_LABEL, statusToBadgeVariant } from '../instructor/bank.js';
import {
  matchesTab,
  queueTabCounts,
  type QueueTab,
  type QueueTabInput,
} from '../instructor/review-queue.js';
import { pendingSuggestionCount, topicLoLabel } from './ta-ui.js';

function navigate(path: string): void {
  window.location.hash = path;
}

const QUEUE_TABS: QueueTab[] = ['all', 'flagged', 'agent-flag', 'agent-reject', 'agent-pass'];

const TAB_LABEL: Record<QueueTab, string> = {
  all: 'All',
  flagged: 'Flagged by student',
  'agent-flag': 'Agent: Flag',
  'agent-reject': 'Agent: Reject',
  'agent-pass': 'Agent: Pass',
};

const AGENT_BADGE_VARIANT: Record<'pass' | 'flag' | 'reject', BadgeVariant> = {
  pass: 'pass',
  flag: 'flag',
  reject: 'reject',
};

type SortKey = 'priority' | 'stem';

async function renderInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading TA review queue…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  let outline: CourseOutline;
  let items: TaReviewQueueItem[];
  try {
    [outline, items] = await Promise.all([getCourseOutline(courseId), getTaReviewQueue(courseId)]);
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
  let actionErrorMessage: string | null = null;
  let actionMessage: string | null = null;

  const tabsContainer = el('div', {});
  const controlsContainer = el('div', {});
  const resultsContainer = el('div', {});

  function tabInputs(): QueueTabInput[] {
    return items.map((item) => ({ labels: item.labels, agentDecision: agentDecisions.get(item.id) }));
  }

  function visibleRows(): TaReviewQueueItem[] {
    const inputs = tabInputs();
    const filtered = items.filter((_, i) => matchesTab(inputs[i], activeTab));
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
    mount(controlsContainer, el('div', { class: 'queue-controls' }, sortSelect));
  }

  async function markReviewed(item: TaReviewQueueItem): Promise<void> {
    actionErrorMessage = null;
    actionMessage = null;
    try {
      await markTaQuestionReviewed(item.id);
      items = await getTaReviewQueue(courseId);
      agentDecisions.clear();
      actionMessage = 'Marked reviewed.';
      renderTabs();
      void enrichAgentDecisions(items);
    } catch (error) {
      actionErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
    }
    renderResults();
  }

  function agentBadge(item: TaReviewQueueItem): HTMLElement {
    const decision = agentDecisions.get(item.id);
    if (!decision) return statusBadge('—', 'neutral');
    return statusBadge(decision.decision.toUpperCase(), AGENT_BADGE_VARIANT[decision.decision]);
  }

  function questionRow(item: TaReviewQueueItem): HTMLElement {
    const stemCell = el('div', { class: 'queue-row__stem' });
    renderRichText(stemCell, item.current.stem);
    const pending = pendingSuggestionCount(item);

    return el('div', { class: 'queue-row queue-row--ta' },
      el('div', {},
        stemCell,
        item.labels.includes('student-flagged')
          ? el('p', { class: 'queue-row__flag queue-row__flag--red', text: '🔴 Student Flagged' })
          : false,
        pending > 0
          ? el('p', { class: 'queue-row__suggestions', text: `${pending} suggestion${pending === 1 ? '' : 's'} awaiting the instructor` })
          : false,
      ),
      el('div', { class: 'queue-row__type-lo' },
        el('span', { text: TYPE_LABEL[item.current.type] }),
        el('span', { text: topicLoLabel(outline, item.loIds, item.themeIds) }),
      ),
      agentBadge(item),
      statusBadge(STATUS_LABEL[item.state], statusToBadgeVariant(item.state)),
      el('div', { class: 'queue-row__actions' },
        el('button', {
          class: 'btn btn--instr-primary btn--sm', type: 'button',
          onclick: () => navigate(`/ta/course/${encodeURIComponent(courseId)}/question/${encodeURIComponent(item.id)}`),
        }, 'Review →'),
        el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          disabled: item.state === 'reviewed' ? 'disabled' : undefined,
          title: item.state === 'reviewed' ? 'Already marked reviewed' : 'Mark this question reviewed for the instructor',
          onclick: () => void markReviewed(item),
        }, 'Mark reviewed'),
      ),
    );
  }

  function renderResults(): void {
    const rows = visibleRows();
    mount(resultsContainer,
      actionErrorMessage ? errorState(actionErrorMessage) : false,
      actionMessage ? el('p', { class: 'queue-message', text: actionMessage }) : false,
      el('div', { class: 'queue-table' },
        el('div', { class: 'queue-row queue-row--ta queue-row--head' },
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

  body.replaceChildren(
    pageHeader(
      'TA Review Queue',
      `${items.length} question${items.length === 1 ? '' : 's'} awaiting review · Review, suggest, annotate or escalate. Final approval remains instructor-only.`,
    ),
    el('div', {}, tabsContainer, controlsContainer, resultsContainer),
  );
  renderTabs();
  renderControls();
  renderResults();
  void enrichAgentDecisions(items);
}

export function renderTaReviewQueue(outlet: HTMLElement, params: RouteParams): void {
  void renderInner(outlet, params.id);
}
