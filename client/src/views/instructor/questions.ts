// Instructor Questions workspace — the merged Review Queue, Question Bank and
// Flags page (spec docs/superpowers/specs/2026-11-09-instructor-questions-workspace-design.md).
//
// Layout: header (Generate more / Import / Export CSV) → release bar → status
// tabs with counts → list (search, filters, selection, bulk actions) beside
// the reader. URL state: ?tab=review|approved|flags|paused|archived&q=<id>,
// plus ?runId= (highlight a generation run) and ?flag= (a notification).
// Student visibility comes from the server; this view only words it.
import {
  ApiError,
  getContentRun,
  getCourseTree,
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
import { pageHeader } from '../../instructor-ui.js';
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
  questionsPath,
  runBulk,
  runHighlightSummary,
  TAB_LABEL,
  topicNames,
  type ApprovedView,
  type BulkAction,
  type VerdictFilter,
  type WorkspaceFilters,
} from './questions-model.js';
import { createQuestionReader } from './questions-reader.js';
import { openReleasePanel } from './questions-release.js';

const errorText = (error: unknown): string => error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

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

async function renderQuestionsInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const root = el('div', { class: 'view questions-workspace' }, loadingState('Loading questions…'));
  mount(outlet, root);
  const coursePath = `/instructor/course/${encodeURIComponent(courseId)}`;
  const query = currentQuery();
  let tab: WorkspaceTab | null = parseTab(query.get('tab'));
  let preferredId = query.get('q') ?? '';
  const runId = query.get('runId') ?? '';
  const highlightFlagId = query.get('flag') ?? undefined;

  let tree: CourseTree;
  let workspace: QuestionWorkspace;
  let highlightIds: Set<string> | null = null;
  let highlightError: string | null = null;
  try {
    const firstTab = tab ?? 'review';
    [tree, workspace] = await Promise.all([
      getCourseTree(courseId),
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
      highlightFlagId && !preferredId
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
    mount(root, errorState(errorText(error), () => void renderQuestionsInner(outlet, courseId)));
    return;
  }
  let activeTab: WorkspaceTab = tab;
  // The Coverage Map links here with ?loId= to show one objective's questions.
  const arrivalLo = query.get('loId') ?? '';
  const arrivalTheme = tree.themes.find((theme) => (theme.los ?? []).some((lo) => lo._id === arrivalLo));
  let filters: WorkspaceFilters = arrivalTheme ? { ...EMPTY_FILTERS, themeId: arrivalTheme._id, loId: arrivalLo } : { ...EMPTY_FILTERS };
  const selected = new Set<string>();
  let bulkBusy = false;
  let bulkMessage = '';
  let bulkError = '';
  let notice = '';
  let loadError = '';
  let narrowReading = false;

  const releaseBar = el('section', { class: 'questions-release-bar', 'aria-label': 'Release to students' });
  const tabs = el('nav', { class: 'questions-tabs', 'aria-label': 'Question status' });
  const highlight = el('div', { class: 'questions-highlight' });
  const toolbar = el('div', { class: 'questions-toolbar' });
  const bulkBar = el('div', { class: 'questions-bulk', role: 'region', 'aria-label': 'Bulk actions' });
  const listHead = el('div', { class: 'questions-list__head' });
  const list = el('ul', { class: 'questions-list__rows', 'aria-label': 'Questions' });
  const empty = el('div', { class: 'questions-empty', hidden: true });
  const messages = el('div', { class: 'questions-messages' });
  const listColumn = el('section', { class: 'questions-list', 'aria-label': 'Question list' }, toolbar, bulkBar, listHead, list, empty);

  const reader = createQuestionReader({
    courseId,
    tree,
    release: () => workspace.release,
    highlightFlagId,
    isBatchBusy: () => bulkBusy,
    onMutated: async (message, questionId) => {
      notice = message;
      await refresh(questionId);
    },
    onOpenQuestion: (questionId) => { void openQuestion(questionId); },
    onOpenRelease: (themeId) => openReleases(themeId),
    onBack: () => { narrowReading = false; body.classList.remove('is-reading'); list.querySelector<HTMLElement>('[aria-current="true"]')?.focus(); },
  });
  const body = el('div', { class: 'questions-body' }, listColumn, reader.root);

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
    if (reader.isLocked() && !await confirmDialog({ title: 'Leave this question?', message: 'Unsaved edits or a pending decision will be lost.', confirmLabel: 'Leave' })) return;
    activeTab = next;
    selected.clear(); bulkMessage = ''; bulkError = '';
    preferredId = selectId;
    filters = { ...filters, approvedView: 'all' };
    mount(list, el('li', {}, loadingState('Loading…')));
    await refresh();
  }

  async function openQuestion(questionId: string): Promise<void> {
    if (workspace.items.some((row) => row.id === questionId)) { preferredId = questionId; filters = { ...EMPTY_FILTERS }; draw(); return; }
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
    openReleasePanel(workspace.release, (message) => {
      notice = message;
      void refresh(reader.currentId() ?? undefined);
    }, themeId);
  }

  function visibleRows(): WorkspaceRow[] {
    return filterRows(workspace.items, filters, tree, activeTab);
  }

  // --- Drawing --------------------------------------------------------------

  function drawReleaseBar(): void {
    const { release, counts } = workspace;
    const released = release.themes.filter((theme) => theme.released).length;
    const manage = el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => openReleases() }, 'Manage releases');
    const warning = release.hiddenApprovedCount > 0;
    releaseBar.classList.toggle('is-warning', warning || !release.coursePublished);
    mount(releaseBar,
      el('div', { class: 'questions-release-bar__text' },
        el('span', { class: 'questions-release-bar__step', text: '⑤ Release' }),
        !release.coursePublished
          ? el('p', { class: 'questions-release-bar__alert' },
            el('strong', { text: 'The course is not published — students see no questions. ' }),
            el('a', { href: `#${coursePath}`, text: 'Publish from the Dashboard →' }))
          : false,
        warning
          ? el('p', { class: 'questions-release-bar__alert' }, el('strong', { text: `${plural(release.hiddenApprovedCount, 'approved question')} ${release.hiddenApprovedCount === 1 ? 'is' : 'are'} not visible to students yet.` }))
          : counts.approved > 0 && release.coursePublished ? el('p', { text: `All ${plural(counts.approved, 'approved question')} ${counts.approved === 1 ? 'is' : 'are'} visible to students.` }) : false,
        el('p', { class: 'muted', text: release.themes.length ? `Released ${released} of ${plural(release.themes.length, 'topic')}.` : 'No topics yet — add them in Course Structure.' })),
      manage);
  }

  function drawTabs(): void {
    const { counts } = workspace;
    mount(tabs, ...WORKSPACE_TABS.map((value) => el('a', {
      class: `questions-tab${value === activeTab ? ' is-active' : ''}${value === 'flags' && counts.flags > 0 ? ' has-attention' : ''}`,
      href: `#${questionsPath(courseId, { tab: value })}`,
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
        replaceUrl(questionsPath(courseId, { tab: activeTab, q: reader.currentId() ?? undefined }));
        draw();
      } }, 'Clear highlight')));
  }

  function select(label: string, value: string, choices: Array<[string, string]>, onChange: (value: string) => void): HTMLElement {
    const node = el('select', { class: 'input input--sm', 'aria-label': label, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
      ...choices.map(([optionValue, text]) => el('option', { value: optionValue, selected: optionValue === value }, text)));
    return node;
  }

  function drawToolbar(): void {
    const setFilter = <K extends keyof WorkspaceFilters>(key: K, value: WorkspaceFilters[K]): void => {
      filters = { ...filters, [key]: value };
      if (key === 'themeId') filters.loId = '';
      drawList();
    };
    const search = el('input', { class: 'input', type: 'search', 'aria-label': 'Search questions', placeholder: 'Search question or learning objective…', value: filters.search,
      oninput: (e: Event) => { filters = { ...filters, search: (e.target as HTMLInputElement).value }; drawList(); } });
    const topic = tree.themes.find((theme) => theme._id === filters.themeId);
    const loChoices = (topic ? topic.los ?? [] : tree.themes.flatMap((theme) => theme.los ?? [])).map((lo): [string, string] => [lo._id, lo.name]);
    mount(toolbar,
      search,
      el('div', { class: 'questions-toolbar__filters' },
        activeTab === 'approved'
          ? select('Student visibility', filters.approvedView, [['all', 'All approved'], ['visible', 'Visible to students'], ['waiting', 'Waiting for release']], (v) => setFilter('approvedView', v as ApprovedView))
          : false,
        select('Topic', filters.themeId, [['', 'All topics'], ...tree.themes.map((theme): [string, string] => [theme._id, theme.name])], (v) => { setFilter('themeId', v); drawToolbar(); }),
        select('Learning objective', filters.loId, [['', 'All LOs'], ...loChoices], (v) => setFilter('loId', v)),
        select('Type', filters.type, [['', 'All types'], ['mcq', TYPE_LABEL.mcq], ['true-false', TYPE_LABEL['true-false']]], (v) => setFilter('type', v as WorkspaceFilters['type'])),
        select('Difficulty', filters.difficulty, [['', 'All difficulties'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], (v) => setFilter('difficulty', v as WorkspaceFilters['difficulty'])),
        select('AI verdict', filters.verdict, [['', 'Any AI verdict'], ['pass', 'AI pass'], ['flag', 'AI flag'], ['reject', 'AI reject'], ['none', 'No AI check']], (v) => setFilter('verdict', v as VerdictFilter)),
        hasActiveFilters(filters) ? el('button', { class: 'link-button', type: 'button', onclick: () => { filters = { ...EMPTY_FILTERS }; drawToolbar(); drawList(); } }, 'Clear filters') : false));
  }

  async function runBulkAction(action: BulkAction): Promise<void> {
    if (bulkBusy || reader.isLocked()) return;
    const rows = workspace.items.filter((row) => selected.has(row.id));
    if (!rows.length) return;
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
    const actions = bulkActionsFor(activeTab);
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
        onclick: () => selectRow(row.id, true) },
      el('span', { class: 'questions-row__meta' },
        `${String(index + 1).padStart(2, '0')} · ${row.current.difficulty} · ${TYPE_LABEL[row.current.type]}`,
        highlighted ? el('b', { class: 'questions-row__new', text: 'New' }) : false),
      rich(rowStemText(row), 'questions-row__stem'),
      el('span', { class: 'questions-row__tags' },
        el('span', { class: 'questions-row__lo', text: objectives[0] ?? topicNames(tree, row.themeIds)[0] ?? 'No LO assigned', title: objectives.join(' · ') }),
        row.agentVerdict ? el('span', { class: `questions-row__verdict is-${row.agentVerdict}`, text: VERDICT_LABEL[row.agentVerdict] }) : false,
        row.openFlagCount ? el('span', { class: 'questions-row__flags', text: `⚑ ${row.openFlagCount}` }) : false,
        row.state === 'approved' ? el('span', { class: `questions-row__visibility${row.studentVisible ? ' is-visible' : ''}`, text: row.studentVisible ? 'Visible' : 'Not visible' }) : false)));
  }

  function drawListHead(): void {
    const shown = visibleRows();
    const selectable = bulkActionsFor(activeTab).length > 0;
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
    const action = filtered
      ? el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => { filters = { ...EMPTY_FILTERS }; drawToolbar(); drawList(); } }, 'Clear filters')
      : activeTab === 'review'
        ? workspace.counts.approved ? el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => void switchTab('approved') }, 'See approved questions') : el('a', { class: 'btn btn--instr-primary btn--sm', href: `#${coursePath}/preseeding`, text: 'Generate questions' })
        : activeTab === 'approved'
          ? workspace.counts.review ? el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => void switchTab('review') }, `Review ${plural(workspace.counts.review, 'question')}`) : el('a', { class: 'btn btn--instr-primary btn--sm', href: `#${coursePath}/preseeding`, text: 'Generate questions' })
          : false;
    mount(empty, el('h2', { text: title }), el('p', { text: description }), action);
  }

  function selectRow(id: string, fromClick = false): void {
    preferredId = id;
    replaceUrl(questionsPath(courseId, { tab: activeTab, q: id, runId: highlightIds ? runId : undefined }));
    const row = workspace.items.find((item) => item.id === id) ?? null;
    if (fromClick) { narrowReading = true; body.classList.add('is-reading'); }
    drawList();
    reader.show(row);
  }

  function drawList(): void {
    const shown = visibleRows();
    const active = shown.find((row) => row.id === preferredId) ?? shown[0];
    const activeId = active?.id ?? '';
    const selectable = bulkActionsFor(activeTab).length > 0;
    const scroll = list.scrollTop;
    mount(list, ...shown.map((row, index) => rowNode(row, index, activeId, selectable)));
    list.scrollTop = scroll;
    drawListHead();
    drawBulk();
    drawEmpty(shown);
    body.classList.toggle('is-empty', shown.length === 0);
    if (!reader.isLocked()) {
      reader.show(active ?? null);
      if (activeId && activeId !== preferredId) {
        preferredId = activeId;
        replaceUrl(questionsPath(courseId, { tab: activeTab, q: activeId, runId: highlightIds ? runId : undefined }));
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

  function draw(): void {
    drawReleaseBar();
    drawTabs();
    drawHighlight();
    drawToolbar();
    drawMessages();
    drawList();
    replaceUrl(questionsPath(courseId, { tab: activeTab, q: preferredId || undefined, runId: highlightIds ? runId : undefined }));
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

  const header = pageHeader('Questions', 'Review, approve and release your course’s practice questions.');
  header.append(el('div', { class: 'cluster questions-header__actions' },
    el('a', { class: 'btn btn--instr-primary btn--sm', href: `#${coursePath}/preseeding`, text: 'Generate more' }),
    el('a', { class: 'btn btn--ghost btn--sm', href: `#${coursePath}/import`, text: 'Import' }),
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void exportCsv() }, 'Export CSV')));

  mount(root, header, releaseBar, tabs, highlight, messages, body);
  draw();
  attachTutorial(root, 'instructor-questions', {
    'questions-tabs': '.questions-tabs',
    'questions-release': '.questions-release-bar',
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

export function renderQuestions(outlet: HTMLElement, params: RouteParams): void {
  void renderQuestionsInner(outlet, params.id);
}

/** `/queue`, `/bank` and `/flags` now live on the Questions page. */
export function renderLegacyQuestionsRedirect(_outlet: HTMLElement, params: RouteParams): void {
  const path = window.location.hash.replace(/^#/, '').split('?')[0];
  const target = legacyQuestionsPath(path, currentQuery()) ?? questionsPath(params.id);
  window.location.replace(`#${target}`);
}
