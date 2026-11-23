// Instructor Questions workspace — the merged Review Queue, Question Bank and
// Flags page (spec docs/superpowers/specs/2026-11-09-instructor-questions-workspace-design.md).
//
// Layout: header (Generate more / Import / Export CSV) → status tabs with
// counts → list (search, filters, selection, bulk actions) beside
// the reader. URL state: ?tab=review|approved|flags|paused|archived&q=<id>,
// plus ?runId= (highlight a generation run) and ?flag= (a notification).
// Student visibility comes from the server; this view only words it.
import {
  ApiError,
  getContentRun,
  getCourseTree,
  getCourseOutline,
  getMyCourseCapabilities,
  type Capability,
  getQuestion,
  getQuestionWorkspace,
  listCourseFlags,
  transitionQuestion,
  type CourseTree,
  type PublicationState,
  type QuestionWorkspace,
  type WorkspaceRow,
  type WorkspaceTab,
  WORKSPACE_TABS,
} from '../../api.js';
import { bankCsv } from '../../bank-csv.js';
import { el, mount } from '../../dom.js';
import { confirmDialog, textPromptDialog } from '../../modal.js';
import { rowStemText } from '../../placeholders.js';
import { TYPE_LABEL } from '../../question-labels.js';
import { renderRichText } from '../../render.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { subscribeFlagsChanged } from '../../flag-sync.js';
import { attachTutorial } from '../../tutorials.js';
import { errorState, loadingState } from '../../ui.js';
import {
  bulkActionsFor,
  defaultTab,
  EMPTY_FILTERS,
  filterRows,
  hasActiveFilters,
  legacyQuestionsPath,
  objectiveNames,
  parseTab,
  parseMode,
  questionsPath,
  runBulk,
  runHighlightSummary,
  TAB_LABEL,
  topicNames,
  type BulkAction,
  type QuestionsPathParams,
  type WorkspaceFilters,
} from './questions-model.js';
import { renderTaFlagTriage } from '../ta/flag-triage.js';
import { createQuestionReader } from './questions-reader.js';

const errorText = (error: unknown): string => error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;
type FilterKey = Exclude<keyof WorkspaceFilters, 'search'>;
const FILTER_BUTTON_ID = 'questions-filter-toggle';
const SEARCH_INPUT_ID = 'questions-search';

const TAB_FOR_STATE: Record<PublicationState, WorkspaceTab> = {
  draft: 'review',
  'pending-review': 'review',
  reviewed: 'review',
  approved: 'approved',
  paused: 'paused',
  archived: 'archived',
};

const VERDICT_LABEL: Record<NonNullable<WorkspaceRow['agentVerdict']>, string> = {
  pass: 'AI pass',
  flag: 'AI flag',
  reject: 'AI reject',
};

const EMPTY_COPY: Record<WorkspaceTab, [string, string]> = {
  review: ['Nothing waiting for review', 'Newly generated and imported questions appear here for your review.'],
  approved: ['No approved questions yet', 'Approve questions in To review; they collect here, ready to release by Topic.'],
  flags: ['No open student flags', 'When a student or TA reports a problem with a question, it appears here.'],
  paused: ['No paused questions', 'Questions you pause, or that students flag past the threshold, appear here.'],
  archived: ['No archived questions', 'Rejected and archived questions appear here with their history kept.'],
};

function replaceUrl(path: string): void {
  history.replaceState(null, '', `#${path}`);
}

function rich(text: string, className: string): HTMLElement {
  const node = el('div', { class: className });
  renderRichText(node, text);
  return node;
}

async function renderQuestionsInner(outlet: HTMLElement, courseId: string, role: 'instructor' | 'ta'): Promise<void> {
  const root = el('div', { class: 'view questions-workspace' }, loadingState('Loading questions…'));
  mount(outlet, root);
  const ta = role === 'ta';
  const pathFor = (params: QuestionsPathParams) => questionsPath(courseId, params, role);
  const coursePath = `/${role}/course/${encodeURIComponent(courseId)}`;
  const query = currentQuery();
  let tab: WorkspaceTab | null = parseTab(query.get('tab'));
  let preferredId = query.get('q') ?? '';
  const runId = ta ? '' : query.get('runId') ?? '';
  const highlightFlagId = query.get('flag') ?? undefined;
  // The reader state in the URL belongs to the question named by `q` only.
  const initialReaderState = {
    questionId: query.get('q') ?? '',
    mode: parseMode(query.get('mode')),
    flagVersionId: query.get('flagVersionId') ?? undefined,
    analyticsVersionId: query.get('analyticsVersionId') ?? undefined,
  };

  let tree: Pick<CourseTree, 'themes'>;
  let taPermissions: Record<Capability, boolean> | undefined;
  let workspace: QuestionWorkspace;
  let highlightIds: Set<string> | null = null;
  let highlightError: string | null = null;
  try {
    if (ta) {
      taPermissions = await getMyCourseCapabilities(courseId);
      if (!root.isConnected) return;
      if (!taPermissions['question.review']) {
        if (taPermissions['flag.triage']) renderTaFlagTriage(outlet, { id: courseId });
        else mount(root, errorState('This course has not granted you access to review questions or student reports.'));
        return;
      }
      if (tab === 'flags' && !taPermissions['flag.triage']) tab = 'review';
    }
    const firstTab = tab ?? 'review';
    [tree, workspace] = await Promise.all([
      ta ? getCourseOutline(courseId) : getCourseTree(courseId),
      getQuestionWorkspace(courseId, firstTab),
      runId
        ? getContentRun(courseId, runId).then(
          (run) => {
            if (run.kind === 'question-generation') highlightIds = new Set(run.result?.createdQuestionIds ?? []);
            else highlightError = `Run ${runId.slice(-8)} is not a question-generation run.`;
          },
          () => { highlightError = `Run ${runId.slice(-8)} could not be loaded, so nothing is highlighted.`; },
        )
        : Promise.resolve(),
      // A notification names a flag, not its question: look the question up once.
      highlightFlagId && !preferredId && (!ta || taPermissions?.['flag.triage'])
        ? listCourseFlags(courseId).then(
          (flags) => { preferredId = flags.find((flag) => flag.id === highlightFlagId)?.questionId ?? ''; },
          () => undefined,
        )
        : Promise.resolve(),
    ]);
    if (!tab) {
      tab = defaultTab(workspace.counts);
      if (tab !== firstTab) workspace = await getQuestionWorkspace(courseId, tab);
    }
    // A selected question outside this tab (e.g. a flag that was already
    // resolved, or an old /bank?q= link to a paused question): open its tab.
    if (preferredId && !workspace.items.some((row) => row.id === preferredId)) {
      const state = await getQuestion(preferredId).then((detail) => detail.state, () => null);
      if (state && TAB_FOR_STATE[state] !== tab) {
        tab = TAB_FOR_STATE[state];
        workspace = await getQuestionWorkspace(courseId, tab);
      }
    }
  } catch (error) {
    mount(root, errorState(errorText(error), () => void renderQuestionsInner(outlet, courseId, role)));
    return;
  }
  if (!root.isConnected) return;
  let activeTab: WorkspaceTab = tab;
  // The Coverage Map links here with ?loId= to show one objective's questions.
  const arrivalLo = query.get('loId') ?? '';
  const arrivalTheme = tree.themes.find((theme) => (theme.los ?? []).some((lo) => lo._id === arrivalLo));
  let filters: WorkspaceFilters = arrivalTheme ? { ...EMPTY_FILTERS, themeId: arrivalTheme._id, loId: arrivalLo } : { ...EMPTY_FILTERS };
  let filtersOpen = false;
  const selected = new Set<string>();
  let bulkBusy = false;
  let bulkMessage = '';
  let bulkError = '';
  let notice = '';
  let loadError = '';
  let narrowReading = !!preferredId;

  const tabs = el('nav', { class: 'questions-tabs', 'aria-label': 'Question status' });
  const highlight = el('div', { class: 'questions-highlight' });
  const toolbar = el('div', { class: 'questions-toolbar' });
  const bulkBar = el('div', { class: 'questions-bulk', role: 'region', 'aria-label': 'Bulk actions' });
  const listHead = el('div', { class: 'questions-list__head' });
  const list = el('ul', { class: 'questions-list__rows', 'aria-label': 'Questions' });
  const empty = el('div', { class: 'questions-empty', hidden: true });
  const messages = el('div', { class: 'questions-messages' });
  const listColumn = el('section', { class: 'gw-objectives questions-list', 'aria-label': 'Question list' }, toolbar, bulkBar, listHead, list, empty);

  const reader = createQuestionReader({
    courseId,
    tree,
    taPermissions,
    shouldOfferTaDetail: () => narrowReading && activeTab !== 'flags',
    release: () => workspace.release,
    highlightFlagId,
    initialState: initialReaderState,
    onStateChange: () => {
      const q = reader.currentId() ?? preferredId;
      replaceUrl(readerPath(q || undefined));
    },
    isBatchBusy: () => bulkBusy,
    onMutated: async (message, questionId) => {
      notice = message;
      await refresh(questionId);
    },
    onOpenQuestion: (questionId) => { void openQuestion(questionId); },
    onOpenRelease: (themeId) => openReleases(themeId),
    onBack: () => { narrowReading = false; body.classList.remove('is-reading'); list.querySelector<HTMLElement>('[aria-current="true"]')?.focus(); },
  });
  const body = el('div', { class: 'gw-grid questions-body' }, listColumn, reader.root);
  /** The workspace URL for question `q`, with the reader's own state for it. */
  function readerPath(q: string | undefined): string {
    return pathFor({ tab: activeTab, q, runId: highlightIds ? runId : undefined, ...(q && q === reader.currentId() ? reader.urlState() : {}) });
  }

  // --- Data -----------------------------------------------------------------

  /** Refetch the current tab. Keeps `keepId` selected while it is still in
   * the tab; otherwise selects the row that took its place. */
  async function refresh(keepId?: string): Promise<void> {
    const previous = visibleRows();
    const previousIndex = keepId ? previous.findIndex((row) => row.id === keepId) : -1;
    try {
      workspace = await getQuestionWorkspace(courseId, activeTab);
      loadError = '';
    } catch (error) {
      loadError = errorText(error);
    }
    for (const id of [...selected]) if (!workspace.items.some((row) => row.id === id)) selected.delete(id);
    if (keepId && !workspace.items.some((row) => row.id === keepId)) {
      const next = visibleRows();
      preferredId = next[Math.min(Math.max(previousIndex, 0), next.length - 1)]?.id ?? '';
    } else if (keepId) {
      preferredId = keepId;
    }
    draw();
  }

  async function switchTab(next: WorkspaceTab, selectId = ''): Promise<void> {
    if (!await reader.confirmQuestionChange()) return;
    if (reader.isSelectionLocked()) reader.show(null);
    activeTab = next;
    selected.clear(); bulkMessage = ''; bulkError = '';
    preferredId = selectId;
    narrowReading = !!selectId;
    filters = { ...filters, approvedView: 'all' };
    listColumn.scrollTop = 0;
    mount(list, el('li', {}, loadingState('Loading…')));
    await refresh();
  }

  async function openQuestion(questionId: string): Promise<void> {
    if (workspace.items.some((row) => row.id === questionId)) {
      if (!await reader.confirmQuestionChange()) return;
      if (reader.isSelectionLocked()) reader.show(null);
      preferredId = questionId; filters = { ...EMPTY_FILTERS }; draw(); return;
    }
    try {
      const detail = await getQuestion(questionId);
      await switchTab(TAB_FOR_STATE[detail.state], questionId);
      filters = { ...EMPTY_FILTERS }; draw();
    } catch (error) {
      notice = `That question could not be opened: ${errorText(error)}`;
      drawMessages();
    }
  }

  function openReleases(themeId?: string): void {
    window.location.hash = `${coursePath}/publish${themeId ? `?topic=${encodeURIComponent(themeId)}` : '?section=release'}`;
  }

  function visibleRows(): WorkspaceRow[] {
    return filterRows(workspace.items, filters, tree, activeTab);
  }

  // --- Drawing --------------------------------------------------------------

  function drawTabs(): void {
    const { counts } = workspace;
    mount(tabs, ...WORKSPACE_TABS.filter(value => value !== 'flags' || !ta || taPermissions?.['flag.triage']).map((value) => el('a', {
      class: `questions-tab${value === activeTab ? ' is-active' : ''}${value === 'flags' && counts.flags > 0 ? ' has-attention' : ''}`,
      href: `#${pathFor({ tab: value })}`,
      'aria-current': value === activeTab ? 'page' : undefined,
      onclick: (event: Event) => { event.preventDefault(); if (value !== activeTab) void switchTab(value); },
    }, TAB_LABEL[value], el('span', { class: 'questions-tab__count', text: String(counts[value]) }))));
  }

  function drawHighlight(): void {
    if (activeTab !== 'review' || (!highlightIds && !highlightError)) { highlight.replaceChildren(); return; }
    if (highlightError) { mount(highlight, el('p', { class: 'questions-highlight__note', role: 'status', text: highlightError })); return; }
    const ids = highlightIds as Set<string>;
    const { shown, missing } = runHighlightSummary([...ids], workspace.items.map((row) => row.id));
    mount(highlight, el('p', { class: 'questions-highlight__note', role: 'status' },
      `Highlighting ${plural(shown, 'question')} from this generation run.${missing ? ` ${missing} already left the review list.` : ''} `,
      el('button', { class: 'link-button', type: 'button', onclick: () => {
        highlightIds = null;
        replaceUrl(pathFor({ tab: activeTab, q: reader.currentId() ?? undefined, ...reader.urlState() }));
        draw();
      } }, 'Clear highlight')));
  }

  function resetFilters(clearSearch: boolean): void {
    filters = { ...EMPTY_FILTERS, search: clearSearch ? '' : filters.search };
    drawToolbar(clearSearch ? SEARCH_INPUT_ID : FILTER_BUTTON_ID);
    drawList();
  }

  function drawToolbar(focusId = toolbar.contains(document.activeElement) ? document.activeElement?.id : undefined): void {
    function setFilter<K extends FilterKey>(key: K, value: WorkspaceFilters[K], focus: string): void {
      filters = { ...filters, [key]: value };
      if (key === 'themeId') filters.loId = '';
      drawToolbar(focus);
      drawList();
    }
    function field<K extends FilterKey>(key: K, label: string, choices: readonly (readonly [WorkspaceFilters[K], string])[], wide = false) {
      const id = `questions-filter-${key}`;
      const value = filters[key];
      const selectedLabel = value !== EMPTY_FILTERS[key] ? choices.find(([option]) => option === value)?.[1] : undefined;
      const select = el('select', { id, class: 'input input--sm', onchange: () => setFilter(key, select.value as WorkspaceFilters[K], id) },
        ...choices.map(([option, text]) => el('option', { value: option, selected: option === value }, text)));
      return {
        control: el('label', { class: `questions-filter-field${wide ? ' is-wide' : ''}`, for: id },
          el('span', { text: label }), el('span', { class: 'questions-filter-select' }, select)),
        chip: selectedLabel ? el('button', {
          class: 'questions-filter-chip', type: 'button', title: `${label} · ${selectedLabel}`,
          'aria-label': `Remove ${label.toLowerCase()} filter: ${selectedLabel}`,
          onclick: () => setFilter(key, EMPTY_FILTERS[key], FILTER_BUTTON_ID),
        }, el('span', { class: 'questions-filter-chip__value', text: selectedLabel }), el('span', { 'aria-hidden': 'true', text: '×' })) : undefined,
      };
    }

    const search = el('input', { id: SEARCH_INPUT_ID, class: 'input input--sm', type: 'search', 'aria-label': 'Search questions', placeholder: 'Search questions…', value: filters.search,
      oninput: (e: Event) => { filters = { ...filters, search: (e.target as HTMLInputElement).value }; drawList(); } });
    const topic = tree.themes.find((theme) => theme._id === filters.themeId);
    const loChoices = (topic ? topic.los ?? [] : tree.themes.flatMap((theme) => theme.los ?? [])).map((lo): [string, string] => [lo._id, lo.name]);
    const fields = [
      field('themeId', 'Topic', [['', 'All topics'], ...tree.themes.map((theme): [string, string] => [theme._id, theme.name])], true),
      field('loId', 'Learning objective', [['', 'All objectives'], ...loChoices], true),
      field('type', 'Type', [['', 'Any type'], ['mcq', TYPE_LABEL.mcq], ['true-false', TYPE_LABEL['true-false']]]),
      field('difficulty', 'Difficulty', [['', 'Any difficulty'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']]),
      field('verdict', 'AI verdict', [['', 'Any verdict'], ['pass', 'AI pass'], ['flag', 'AI flag'], ['reject', 'AI reject'], ['none', 'No AI check']]),
      ...(activeTab === 'approved' ? [field('approvedView', 'Student visibility', [['all', 'All approved'], ['visible', 'Visible'], ['waiting', 'Not visible']])] : []),
    ];
    const chips = fields.flatMap(({ chip }) => chip ? [chip] : []);
    const panel = el('div', { id: 'questions-filter-panel', class: 'questions-toolbar__filters', role: 'group', 'aria-label': 'Question filters', hidden: !filtersOpen },
      ...fields.map(({ control }) => control));
    const toggle = el('button', {
      id: FILTER_BUTTON_ID, class: 'questions-filter-toggle', type: 'button',
      'aria-label': 'Filters', 'aria-expanded': String(filtersOpen), 'aria-controls': panel.id,
      'aria-describedby': chips.length ? 'questions-filter-count' : undefined,
      onclick: () => {
        filtersOpen = !filtersOpen;
        panel.hidden = !filtersOpen;
        toggle.setAttribute('aria-expanded', String(filtersOpen));
      },
    }, el('span', { class: 'questions-filter-icon', 'aria-hidden': 'true' }, el('i'), el('i')),
    el('span', { class: 'questions-filter-toggle__label', text: 'Filters' }),
    chips.length ? el('span', { class: 'questions-filter-count', 'aria-hidden': 'true', text: String(chips.length) }) : false);

    mount(toolbar, el('div', { class: 'questions-toolbar__bar' },
      el('div', { class: 'questions-toolbar__search' }, el('span', { class: 'questions-search-icon', 'aria-hidden': 'true' }), search), toggle),
    chips.length ? el('div', { class: 'questions-filter-chips' },
      el('span', { id: 'questions-filter-count', class: 'sr-only', text: `${plural(chips.length, 'active filter')}` }),
      ...chips, el('button', { class: 'questions-filter-clear', type: 'button', 'aria-label': 'Clear filters', onclick: () => resetFilters(false) }, 'Clear')) : false,
    panel);
    if (focusId) toolbar.querySelector<HTMLElement>(`#${CSS.escape(focusId)}`)?.focus();
  }

  async function runBulkAction(action: BulkAction): Promise<void> {
    if (bulkBusy || reader.isSelectionLocked()) return;
    const rows = workspace.items.filter((row) => selected.has(row.id));
    if (!rows.length) return;
    if (rows.some((row) => reader.comparisonPending(row.id))) {
      bulkError = 'Finish comparing the selected questions before changing their status.';
      drawBulk();
      return;
    }
    let reason: string | undefined;
    if (action.askReason) {
      const value = await textPromptDialog({
        title: `Reject ${plural(rows.length, 'question')}?`,
        message: 'They will be archived. One optional reason is saved on each as a teaching-team note.',
        fieldLabel: 'Reason for rejecting (optional)',
        placeholder: 'What should be improved?',
        confirmLabel: 'Reject selected',
        tone: 'danger',
      });
      if (value === null) return;
      reason = value;
    } else if (action.to === 'archived' && !await confirmDialog({ title: `Archive ${plural(rows.length, 'question')}?`, message: 'They leave student practice. Versions and history are kept.', confirmLabel: 'Archive selected' })) {
      return;
    }
    bulkBusy = true; bulkMessage = ''; bulkError = '';
    drawBulk();
    const outcome = await runBulk(rows, (row) => transitionQuestion(row.id, action.to, row.current._id, reason));
    for (const row of outcome.succeeded) selected.delete(row.id);
    bulkBusy = false;
    bulkMessage = `${action.done} ${outcome.succeeded.length} of ${plural(rows.length, 'question')}.${outcome.failed.length ? ` ${outcome.failed.length} still selected — retry or check them.` : ''}`;
    bulkError = outcome.failed.map(({ item, error }) => `${rowStemText(item).slice(0, 60)}: ${errorText(error)}`).join(' · ');
    await refresh(reader.currentId() ?? undefined);
  }

  function drawBulk(): void {
    const actions = ta ? [] : bulkActionsFor(activeTab);
    bulkBar.hidden = selected.size === 0 && !bulkMessage && !bulkError;
    mount(bulkBar,
      selected.size ? el('strong', { text: `${selected.size} selected` }) : false,
      ...(selected.size ? actions.map((action) => el('button', {
        class: `btn ${action.to === 'approved' ? 'btn--instr-primary' : 'btn--ghost'} btn--sm`, type: 'button', disabled: bulkBusy,
        onclick: () => { void runBulkAction(action); },
      }, bulkBusy ? 'Working…' : action.label)) : []),
      selected.size ? el('button', { class: 'link-button', type: 'button', disabled: bulkBusy, onclick: () => { selected.clear(); drawList(); } }, 'Clear selection') : false,
      bulkMessage ? el('p', { class: 'questions-bulk__message', role: 'status', text: bulkMessage }) : false,
      bulkError ? el('p', { class: 'questions-bulk__error', role: 'alert', text: `Failed: ${bulkError}` }) : false);
  }

  function rowNode(row: WorkspaceRow, index: number, activeId: string, selectable: boolean): HTMLElement {
    const current = row.id === activeId;
    const highlighted = activeTab === 'review' && highlightIds?.has(row.id);
    const objectives = objectiveNames(tree, row.loIds);
    const checkbox = selectable
      ? el('input', { type: 'checkbox', 'aria-label': `Select question ${index + 1}`, checked: selected.has(row.id), disabled: bulkBusy,
        onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) selected.add(row.id); else selected.delete(row.id); drawBulk(); drawListHead(); } })
      : false;
    return el('li', { class: `questions-row${current ? ' is-current' : ''}${highlighted ? ' is-highlighted' : ''}${selected.has(row.id) ? ' is-selected' : ''}`, 'data-question-id': row.id },
      checkbox,
      el('button', { type: 'button', class: 'questions-row__open', 'aria-current': current ? 'true' : 'false', disabled: bulkBusy,
        onclick: () => { void selectRow(row); } },
      el('span', { class: 'questions-row__meta' },
        `${row.current.difficulty} · ${TYPE_LABEL[row.current.type]}`,
        highlighted ? el('b', { class: 'questions-row__new', text: 'New' }) : false),
      rich(rowStemText(row), 'questions-row__stem'),
      el('span', { class: 'questions-row__tags' },
        el('span', { class: 'questions-row__lo', text: objectives[0] ?? topicNames(tree, row.themeIds)[0] ?? 'No LO assigned', title: objectives.join(' · ') }),
        row.agentVerdict ? el('span', { class: `questions-row__verdict is-${row.agentVerdict}`, text: VERDICT_LABEL[row.agentVerdict] }) : false,
        row.openFlagCount && (!ta || taPermissions?.['flag.triage']) ? el('span', { class: 'questions-row__flags', text: `⚑ ${row.openFlagCount}` }) : false,
        row.state === 'approved' ? el('span', { class: `questions-row__visibility${row.studentVisible ? ' is-visible' : ''}`, text: row.studentVisible ? 'Visible' : 'Not visible' }) : false)));
  }

  function drawListHead(): void {
    const shown = visibleRows();
    const selectable = !ta && bulkActionsFor(activeTab).length > 0;
    const allChecked = selectable && shown.length > 0 && shown.every((row) => selected.has(row.id));
    mount(listHead,
      selectable && shown.length
        ? el('label', {}, el('input', { type: 'checkbox', 'aria-label': 'Select all shown questions', checked: allChecked, disabled: bulkBusy,
          onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) shown.forEach((row) => selected.add(row.id)); else shown.forEach((row) => selected.delete(row.id)); drawList(); } }), ' Select all')
        : el('span'),
      el('span', { class: 'muted', text: shown.length === workspace.items.length ? plural(shown.length, 'question') : `${shown.length} of ${plural(workspace.items.length, 'question')}` }));
  }

  function drawEmpty(shown: WorkspaceRow[]): void {
    empty.hidden = shown.length > 0;
    if (shown.length) return;
    const filtered = workspace.items.length > 0;
    const [title, description] = filtered ? ['No matching questions', 'Try another search or clear your filters.'] : EMPTY_COPY[activeTab];
    const hasSearch = filters.search.trim() !== '';
    const hasFilters = hasActiveFilters({ ...filters, search: '' });
    const action = filtered
      ? el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => resetFilters(hasSearch) },
        hasSearch ? hasFilters ? 'Clear search and filters' : 'Clear search' : 'Reset filters')
      : activeTab === 'review'
        ? workspace.counts.approved ? el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => void switchTab('approved') }, 'See approved questions') : !ta && el('a', { class: 'btn btn--instr-primary btn--sm', href: `#${coursePath}/preseeding`, text: 'Generate questions' })
        : activeTab === 'approved'
          ? workspace.counts.review ? el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => void switchTab('review') }, `Review ${plural(workspace.counts.review, 'question')}`) : !ta && el('a', { class: 'btn btn--instr-primary btn--sm', href: `#${coursePath}/preseeding`, text: 'Generate questions' })
          : false;
    mount(empty, el('h2', { text: title }), el('p', { text: description }), action);
  }

  async function selectRow(row: WorkspaceRow): Promise<void> {
    if (row.id !== reader.currentId() && !await reader.confirmQuestionChange()) return;
    preferredId = row.id;
    narrowReading = true;
    reader.show(row);
    replaceUrl(readerPath(row.id));
    drawList();
  }

  function drawList(): void {
    const shown = visibleRows();
    const active = shown.find((row) => row.id === preferredId) ?? shown[0];
    const activeId = active?.id ?? '';
    const selectable = !ta && bulkActionsFor(activeTab).length > 0;
    const scroll = listColumn.scrollTop;
    mount(list, ...shown.map((row, index) => rowNode(row, index, activeId, selectable)));
    drawListHead();
    drawBulk();
    drawEmpty(shown);
    listColumn.scrollTop = scroll;
    body.classList.toggle('is-empty', shown.length === 0);
    if (!reader.isSelectionLocked()) {
      reader.show(active ?? null);
      if (activeId && activeId !== preferredId) {
        preferredId = activeId;
        replaceUrl(readerPath(activeId));
      }
    }
    if (!active) { narrowReading = false; body.classList.remove('is-reading'); }
    body.classList.toggle('is-reading', narrowReading && !!active);
  }

  function drawMessages(): void {
    mount(messages,
      loadError ? errorState(`Couldn't refresh: ${loadError}`, () => void refresh(reader.currentId() ?? undefined)) : false,
      notice ? el('p', { class: 'questions-notice', role: 'status' }, el('span', { text: notice }), el('button', { class: 'link-button', type: 'button', onclick: () => { notice = ''; drawMessages(); } }, 'Dismiss')) : false);
  }

  let offeredTaTutorial: string | undefined;
  function offerTaTutorial(): void {
    if (!ta) return;
    const id = activeTab === 'flags' ? 'ta-flags' : 'ta-review';
    if (offeredTaTutorial === id) return;
    offeredTaTutorial = id;
    if (id === 'ta-flags') {
      attachTutorial(root, id, { 'ta-flags-context': '.questions-header', 'ta-flags-items': '.questions-list' });
    } else if (!query.get('q')) {
      attachTutorial(root, id, { 'ta-review-context': '.questions-header', 'ta-review-items': '.questions-list' });
    }
  }

  function draw(): void {
    drawTabs();
    drawHighlight();
    drawToolbar();
    drawMessages();
    drawList();
    replaceUrl(readerPath(preferredId || undefined));
    offerTaTutorial();
  }

  async function exportCsv(): Promise<void> {
    const rows = visibleRows().filter((row) => (selected.size ? selected.has(row.id) : true));
    if (!rows.length) { notice = 'There are no questions to export in this view.'; drawMessages(); return; }
    if (!await confirmDialog({ title: 'Export questions as CSV?', message: `Export ${plural(rows.length, selected.size ? 'selected question' : 'question')} from ${TAB_LABEL[activeTab]}. Parameterized questions export as fixed sample questions. Import creates new drafts; tags, sources and approval are not copied.`, confirmLabel: 'Export CSV' })) return;
    const url = URL.createObjectURL(new Blob([bankCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `questions-${activeTab}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const header = el('header', { class: 'gw-header questions-header' },
    el('div', {}, el('h1', { text: 'Questions' }),
      el('p', { text: ta ? 'Review practice questions and share feedback with your teaching team.' : 'Review, edit and approve your course’s practice questions.' })),
    !ta && el('div', { class: 'questions-header__actions' },
    el('a', { class: 'btn btn--instr-primary btn--sm', href: `#${coursePath}/preseeding`, text: 'Generate more' }),
    el('a', { class: 'btn btn--ghost btn--sm', href: `#${coursePath}/import`, text: 'Import' }),
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void exportCsv() }, 'Export CSV')));

  mount(root, header, tabs, highlight, messages, body);
  draw();
  if (!ta) attachTutorial(root, 'instructor-questions', {
    'questions-tabs': '.questions-tabs',
    'questions-reader': '.questions-reader',
  });

  // Flags raised elsewhere (student, TA, another tab) update counts here.
  const unsubscribe = subscribeFlagsChanged(() => { if (!bulkBusy && !reader.isLocked()) void refresh(reader.currentId() ?? undefined); });
  const observer = new MutationObserver(() => {
    if (root.isConnected) return;
    unsubscribe();
    observer.disconnect();
  });
  observer.observe(outlet, { childList: true });
}

export function renderQuestions(outlet: HTMLElement, params: RouteParams, role: 'instructor' | 'ta' = 'instructor'): void {
  void renderQuestionsInner(outlet, params.id, role);
}

/** `/queue`, `/bank`, `/flags` and the old question pages (`/bank/:questionId`,
 * `/params`, `/collaborate`) now live on the Questions page. */
export function renderLegacyQuestionsRedirect(_outlet: HTMLElement, params: RouteParams): void {
  const path = window.location.hash.replace(/^#/, '').split('?')[0];
  const target = legacyQuestionsPath(path, currentQuery()) ?? questionsPath(params.id);
  window.location.replace(`#${target}`);
}
