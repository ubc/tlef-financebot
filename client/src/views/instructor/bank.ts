// Question Bank browser (I7) — filterable/searchable table over the course's
// question bank, with Edit/Archive row actions and entry points into
// Generate/Import (Task 15, Task E). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-id `148:3962`) and `.superpowers/sdd/task-15/i7-bank.png`.
import {
  ApiError,
  browseBank,
  getCourseTree,
  transitionQuestion,
  type BankQuestion,
  type CourseTree,
  type Difficulty,
  type PublicationState,
  type QuestionLabel,
  type QuestionType,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge, type BadgeVariant } from '../../instructor-ui.js';
import { renderRichText } from '../../render.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function navigate(path: string): void {
  window.location.hash = path;
}

/** Question status -> wireframe display label. `reviewed` reads as
 * "Pre-Approved" in the wireframe (see task-15-wireframe-reference.md's
 * "Status/badge vocabulary"), not the raw domain name. */
export const STATUS_LABEL: Record<PublicationState, string> = {
  draft: 'Draft',
  'pending-review': 'Pending Review',
  reviewed: 'Pre-Approved',
  approved: 'Approved',
  paused: 'Paused',
  archived: 'Archived',
};

export const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'MCQ',
  'true-false': 'True/False',
};

/** Question status -> `statusBadge` variant (instructor-ui.ts). Exported for
 * reuse by question-detail.ts's own state badge. */
export function statusToBadgeVariant(state: PublicationState): BadgeVariant {
  switch (state) {
    case 'draft':
      return 'draft';
    case 'pending-review':
      return 'pending';
    case 'reviewed':
      return 'reviewed';
    case 'approved':
      return 'approved';
    case 'paused':
      return 'paused';
    case 'archived':
      return 'archived';
  }
}

function difficultyLabel(d: Difficulty): string {
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** "Topic 1 / LO 1, LO 4" style label for a question's tagged Topics/LOs,
 * derived from the course tree (server only gives loIds/themeIds arrays —
 * this is display-only client derivation, no server change). Questions
 * tagged to a Topic with no matching LO in `loIds` still show the bare Topic. */
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

interface BankFilterState {
  search: string;
  themeId: string;
  loId: string;
  type: QuestionType | '';
  status: PublicationState | '';
  label: QuestionLabel | '';
}

const EMPTY_FILTERS: BankFilterState = { search: '', themeId: '', loId: '', type: '', status: '', label: '' };

interface Summary {
  total: number;
  approved: number;
  pendingReview: number;
  flagged: number;
  draft: number;
  sourceChanged: number;
}

function summarize(all: BankQuestion[], total: number): Summary {
  return {
    total,
    approved: all.filter((q) => q.state === 'approved').length,
    pendingReview: all.filter((q) => q.state === 'pending-review').length,
    flagged: all.filter((q) => q.labels.includes('student-flagged')).length,
    draft: all.filter((q) => q.state === 'draft').length,
    sourceChanged: all.filter((q) => q.labels.includes('source-changed')).length,
  };
}

async function renderBankInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading question bank…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  let tree: CourseTree;
  try {
    tree = await getCourseTree(courseId);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderBankInner(outlet, courseId)));
    return;
  }

  let filters: BankFilterState = { ...EMPTY_FILTERS };
  let summary: Summary = { total: 0, approved: 0, pendingReview: 0, flagged: 0, draft: 0, sourceChanged: 0 };
  let listQuestions: BankQuestion[] = [];
  let listTotal = 0;
  let loadErrorMessage: string | null = null;

  // Two independent containers, not one rebuilt-every-time layout: the filter
  // bar (incl. the search `<input>`) is only rebuilt on a `reload()` (a
  // server-driven filter change or the initial load). Typing in the search
  // box calls `renderResults()` alone, which never touches `filterContainer`
  // — rebuilding the whole layout on every keystroke would recreate the
  // search input and drop focus mid-word (the same class of bug
  // materials.ts/structure.ts's `urlInput`/`addNameForm` comments call out).
  const filterContainer = el('div', {});
  const resultsContainer = el('div', {});
  const layout = el('div', {}, filterContainer, resultsContainer);
  body.replaceChildren(pageHeader('Question Bank', tree.course.name), layout);

  async function loadSummary(): Promise<void> {
    const { total, questions } = await browseBank(courseId, {});
    summary = summarize(questions, total);
  }

  async function loadList(): Promise<void> {
    const { total, questions } = await browseBank(courseId, {
      state: filters.status || undefined,
      themeId: filters.themeId || undefined,
      loId: filters.loId || undefined,
      type: filters.type || undefined,
      label: filters.label || undefined,
    });
    listTotal = total;
    listQuestions = questions;
  }

  async function reload(): Promise<void> {
    loadErrorMessage = null;
    try {
      await Promise.all([loadSummary(), loadList()]);
    } catch (error) {
      loadErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
    }
    renderFilters();
    renderResults();
  }

  function displayedQuestions(): BankQuestion[] {
    const search = filters.search.trim().toLowerCase();
    if (!search) return listQuestions;
    return listQuestions.filter((q) => q.current.stem.toLowerCase().includes(search));
  }

  function hasActiveFilters(): boolean {
    return Boolean(filters.search || filters.themeId || filters.loId || filters.type || filters.status || filters.label);
  }

  function clearFilters(): void {
    filters = { ...EMPTY_FILTERS };
    void reload();
  }

  async function archive(question: BankQuestion): Promise<void> {
    if (!window.confirm('Archive this question? It will no longer be served to students.')) return;
    try {
      await transitionQuestion(question.id, 'archived');
      listQuestions = listQuestions.map((q) => (q.id === question.id ? { ...q, state: 'archived' } : q));
      if (filters.status !== 'archived') {
        listQuestions = listQuestions.filter((q) => q.id !== question.id);
        listTotal = Math.max(0, listTotal - 1);
      }
      renderResults();
      void loadSummary().then(renderResults);
    } catch (error) {
      loadErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
      renderResults();
    }
  }

  function summaryLine(): HTMLElement {
    return el('p', {
      class: 'bank-summary',
      text: `${tree.course.name} · ${summary.total} total questions · ${summary.approved} Approved · ${summary.pendingReview} Pending Review · ${summary.flagged} Flagged · ${summary.draft} Draft`,
    });
  }

  function filterRow(): HTMLElement {
    const searchInput = el('input', {
      class: 'input bank-filters__search',
      type: 'search',
      placeholder: 'Search question stems…',
      value: filters.search,
      oninput: (e: Event) => {
        // Client-side only (no server free-text search endpoint exists, see
        // the module note) — updates just the results pane, never
        // `filterContainer`, so this input keeps focus while typing.
        filters = { ...filters, search: (e.target as HTMLInputElement).value };
        renderResults();
      },
    }) as HTMLInputElement;

    const themeSelect = el(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          filters = { ...filters, themeId: (e.target as HTMLSelectElement).value, loId: '' };
          void reload();
        },
      },
      el('option', { value: '', text: 'Topic: All', selected: filters.themeId === '' ? 'selected' : undefined }),
      ...tree.themes.map((theme, i) =>
        el('option', {
          value: theme._id,
          text: `Topic ${i + 1}: ${theme.name}`,
          selected: filters.themeId === theme._id ? 'selected' : undefined,
        }),
      ),
    ) as HTMLSelectElement;

    // Labels stay relative to each LO's own Topic (never a flattened
    // cross-topic index) whether or not a Topic filter narrows the list, so
    // "LO 2" here always matches the same LO's label everywhere else (rows,
    // chips).
    const losInScope: Array<{ id: string; label: string }> = filters.themeId
      ? (tree.themes.find((t) => t._id === filters.themeId)?.los ?? []).map((lo, i) => ({ id: lo._id, label: `LO ${i + 1}: ${lo.name}` }))
      : tree.themes.flatMap((t, ti) => (t.los ?? []).map((lo, li) => ({ id: lo._id, label: `Topic ${ti + 1} / LO ${li + 1}: ${lo.name}` })));
    const loSelect = el(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          filters = { ...filters, loId: (e.target as HTMLSelectElement).value };
          void reload();
        },
      },
      el('option', { value: '', text: 'LO: All', selected: filters.loId === '' ? 'selected' : undefined }),
      ...losInScope.map((lo) =>
        el('option', { value: lo.id, text: lo.label, selected: filters.loId === lo.id ? 'selected' : undefined }),
      ),
    ) as HTMLSelectElement;

    const typeSelect = el(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          filters = { ...filters, type: (e.target as HTMLSelectElement).value as QuestionType | '' };
          void reload();
        },
      },
      el('option', { value: '', text: 'Type: All', selected: filters.type === '' ? 'selected' : undefined }),
      el('option', { value: 'mcq', text: 'MCQ', selected: filters.type === 'mcq' ? 'selected' : undefined }),
      el('option', { value: 'true-false', text: 'True/False', selected: filters.type === 'true-false' ? 'selected' : undefined }),
    ) as HTMLSelectElement;

    const statusOptions: Array<[PublicationState | '', string]> = [
      ['', 'Status: All'],
      ['draft', 'Draft'],
      ['pending-review', 'Pending Review'],
      ['reviewed', 'Pre-Approved'],
      ['approved', 'Approved'],
      ['paused', 'Paused'],
      ['archived', 'Archived'],
    ];
    const statusSelect = el(
      'select',
      {
        class: 'input',
        onchange: (e: Event) => {
          filters = { ...filters, status: (e.target as HTMLSelectElement).value as PublicationState | '' };
          void reload();
        },
      },
      ...statusOptions.map(([value, text]) =>
        el('option', { value, text, selected: filters.status === value ? 'selected' : undefined }),
      ),
    ) as HTMLSelectElement;

    return el(
      'div',
      { class: 'bank-filters' },
      searchInput,
      themeSelect,
      loSelect,
      typeSelect,
      statusSelect,
      el('button', { class: 'btn btn--ghost', type: 'button', disabled: 'disabled', title: 'Coming soon' }, '↑ Import'),
      el(
        'button',
        {
          class: 'btn btn--instr-primary',
          type: 'button',
          onclick: () => navigate(`/instructor/course/${encodeURIComponent(courseId)}/preseeding`),
        },
        '+ Generate Question',
      ),
    );
  }

  function questionRow(q: BankQuestion): HTMLElement {
    const stemCell = el('div', { class: 'bank-row__stem' });
    renderRichText(stemCell, q.current.stem);

    const sourceChanged = q.labels.includes('source-changed');

    return el(
      'div',
      { class: 'bank-row' },
      stemCell,
      el('span', { class: 'bank-row__type', text: TYPE_LABEL[q.current.type] }),
      el('span', { class: 'bank-row__topic', text: topicLoLabel(tree, q.loIds, q.themeIds) }),
      el('span', { class: 'bank-row__difficulty', text: difficultyLabel(q.current.difficulty) }),
      statusBadge(STATUS_LABEL[q.state], statusToBadgeVariant(q.state)),
      el(
        'div',
        { class: 'bank-row__actions' },
        el(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            onclick: () => navigate(`/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(q.id)}`),
          },
          'Edit',
        ),
        q.state === 'archived'
          ? false
          : el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void archive(q) }, 'Archive'),
      ),
      sourceChanged ? el('span', { class: 'bank-row__source-changed', text: 'Source changed' }) : el('span', {}),
    );
  }

  function renderFilters(): void {
    filterContainer.replaceChildren(filterRow());
  }

  function renderResults(): void {
    const displayed = displayedQuestions();
    mount(
      resultsContainer,
      loadErrorMessage ? errorState(loadErrorMessage, () => void reload()) : false,
      summaryLine(),
      el(
        'div',
        { class: 'bank-table' },
        el(
          'div',
          { class: 'bank-row bank-row--head' },
          el('span', { text: 'Question Stem' }),
          el('span', { text: 'Type' }),
          el('span', { text: 'Topic / LO' }),
          el('span', { text: 'Difficulty' }),
          el('span', { text: 'Status' }),
          el('span', { text: 'Actions' }),
          el('span', { text: '' }),
        ),
        displayed.length
          ? el('div', { class: 'bank-table__rows' }, ...displayed.map(questionRow))
          : emptyState('No questions match the current filters.'),
      ),
      el('p', {
        class: 'bank-footer',
        text:
          `Showing ${displayed.length} of ${listTotal} question${listTotal === 1 ? '' : 's'}` +
          (hasActiveFilters() ? ` · Clear filters to see all ${summary.total}` : ''),
      }),
      hasActiveFilters() ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: clearFilters }, 'Clear filters') : false,
      summary.sourceChanged > 0
        ? el(
            'button',
            {
              class: 'bank-source-banner',
              type: 'button',
              onclick: () => {
                filters = { ...EMPTY_FILTERS, label: 'source-changed' };
                void reload();
              },
            },
            `⚠ ${summary.sourceChanged} question${summary.sourceChanged === 1 ? ' has' : 's have'} changed source materials — review →`,
          )
        : false,
    );
  }

  void reload();
}

export function renderBank(outlet: HTMLElement, params: RouteParams): void {
  void renderBankInner(outlet, params.id);
}
