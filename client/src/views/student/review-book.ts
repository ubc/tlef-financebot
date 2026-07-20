// Review Book (ST-R02..R07/R05, Figma wireframe screen 11): topic-grouped
// header rows ("Topic Practice"/"Practice All" — both existing practice
// routes, no new backend calls) followed by per-LO progressRow-style rows
// (auto-collected/bookmarked counts, question-count badge, "Review"/
// "Practice again" entry points). Each LO row expands via a caret to reveal
// its individual entries: stem excerpt, source badges, a heart-icon bookmark
// toggle (bookmarkQuestion/unbookmarkQuestion, ST-R02 — the one place in the
// client this control actually surfaces), and the pre-existing "Remove"
// action (removeReviewBookEntry, ST-R03), preserved unchanged.
//
// LO names come from `getCourseHome` (already used by lo-list.ts/practice.ts)
// since `getReviewBook`'s entries only carry `loId` — this is an existing
// API call, not a new endpoint, used purely to label the per-LO rows.
import {
  bookmarkQuestion,
  getCourseHome,
  getReviewBook,
  removeReviewBookEntry,
  unbookmarkQuestion,
  type CourseHomeTheme,
  type ReviewBookEntry,
  type ReviewBookGroup,
  type ReviewBookSort,
} from '../../api.js';
import { el } from '../../dom.js';
import { badge, emptyState, errorState, loadingState } from '../../ui.js';
import { renderRichText } from '../../render.js';
import { copyrightFooter } from '../../student-ui.js';
import type { RouteParams } from '../../router.js';

interface LoMeta {
  name: string;
  order: number;
}

interface LoSubgroup {
  loId: string;
  loName: string;
  order: number;
  entries: ReviewBookEntry[];
}

function buildLoNameMap(home: CourseHomeTheme[]): Map<string, LoMeta> {
  const map = new Map<string, LoMeta>();
  for (const group of home) {
    for (const entry of group.los) map.set(entry.lo._id, { name: entry.lo.name, order: entry.lo.order });
  }
  return map;
}

function groupByLo(entries: ReviewBookEntry[], loNames: Map<string, LoMeta>): LoSubgroup[] {
  const byLo = new Map<string, ReviewBookEntry[]>();
  for (const entry of entries) {
    const list = byLo.get(entry.loId) ?? [];
    list.push(entry);
    byLo.set(entry.loId, list);
  }
  return [...byLo.entries()]
    .map(([loId, list]) => ({
      loId,
      loName: loNames.get(loId)?.name ?? loId,
      order: loNames.get(loId)?.order ?? 0,
      entries: list,
    }))
    .sort((a, b) => a.order - b.order);
}

function sourceCounts(entries: ReviewBookEntry[]): { auto: number; bookmark: number } {
  let auto = 0;
  let bookmark = 0;
  for (const entry of entries) {
    if (entry.sources.includes('auto')) auto += 1;
    if (entry.sources.includes('bookmark')) bookmark += 1;
  }
  return { auto, bookmark };
}

function entryRow(
  courseId: string,
  entry: ReviewBookEntry,
  onToggleBookmark: () => void,
  onRemove: () => void,
): HTMLElement {
  const stem = el('p', { class: 'review-entry__stem' });
  renderRichText(stem, entry.question.stem.slice(0, 180));
  const isBookmarked = entry.sources.includes('bookmark');
  const practiceHref = `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(entry.loId)}?mode=review-book&questionId=${encodeURIComponent(entry.questionId)}`;

  return el(
    'div',
    { class: 'review-entry' },
    el(
      'div',
      { class: 'review-entry__main' },
      stem,
      el(
        'div',
        { class: 'review-entry__badges' },
        ...entry.sources.map((s) =>
          badge(s === 'bookmark' ? 'Bookmarked' : 'Auto-collected', s === 'bookmark' ? 'demo' : 'muted'),
        ),
      ),
    ),
    el(
      'div',
      { class: 'review-entry__actions' },
      el(
        'button',
        {
          class: `review-entry__heart${isBookmarked ? ' review-entry__heart--active' : ''}`,
          type: 'button',
          'aria-label': isBookmarked ? 'Remove bookmark' : 'Bookmark this question',
          'aria-pressed': String(isBookmarked),
          onclick: onToggleBookmark,
        },
        isBookmarked ? '♥' : '♡',
      ),
      el('a', { class: 'btn btn--sm btn--primary', href: practiceHref }, 'Re-practice'),
      el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: onRemove }, 'Remove'),
    ),
  );
}

/** A per-LO row (progressRow-flavored markup, hand-built rather than reusing
 * `progressRow` because this row needs two action buttons where
 * `progressRow` only supports one) with its own expand caret — separate from
 * `<details>`/`<summary>` so the "Review"/"Practice again" links inside it
 * don't also trigger the native toggle on click. */
function loGroupRow(
  courseId: string,
  sub: LoSubgroup,
  index: number,
  onToggleBookmark: (entry: ReviewBookEntry) => void,
  onRemove: (entryId: string) => void,
): HTMLElement {
  const { auto, bookmark } = sourceCounts(sub.entries);
  const reviewHref = `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(sub.loId)}?mode=review-book`;
  const practiceAgainHref = `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(sub.loId)}`;

  const entriesPanel = el(
    'div',
    { class: 'review-lo__entries', hidden: true },
    ...sub.entries.map((entry) =>
      entryRow(courseId, entry, () => onToggleBookmark(entry), () => onRemove(entry._id)),
    ),
  );
  const caret = el(
    'button',
    {
      class: 'review-lo__caret',
      type: 'button',
      'aria-expanded': 'false',
      'aria-label': `Expand entries for ${sub.loName}`,
      onclick: () => {
        const expanded = caret.getAttribute('aria-expanded') === 'true';
        caret.setAttribute('aria-expanded', String(!expanded));
        entriesPanel.hidden = expanded;
        caret.textContent = expanded ? '▸' : '▾';
      },
    },
    '▸',
  );

  return el(
    'div',
    { class: 'review-lo' },
    el(
      'div',
      { class: 'review-lo__summary' },
      caret,
      el('span', { class: 'progress-row__index', text: String(index) }),
      el(
        'div',
        { class: 'progress-row__text' },
        el('p', { class: 'progress-row__title', text: sub.loName }),
        el('p', { class: 'progress-row__meta', text: `${auto} auto-collected · ${bookmark} bookmarked` }),
      ),
      badge(String(sub.entries.length), 'muted'),
      el(
        'div',
        { class: 'row review-lo__actions' },
        el('a', { class: 'btn btn--ghost btn--sm', href: reviewHref }, 'Review'),
        el('a', { class: 'btn btn--sm btn--instr-primary', href: practiceAgainHref }, 'Practice again'),
      ),
    ),
    entriesPanel,
  );
}

/** Topic-group header row ("Topic Practice"/"Practice All") plus its per-LO
 * rows. "Topic Practice" starts a fresh theme-practice session
 * (`practice-theme/:themeId`, no query — new Approved questions, same as the
 * Topic List page); "Practice All" reuses the same route with the existing
 * `?mode=review-book` query (already understood by practice.ts, ST-R07's
 * "request more practice across the LO set tied to their misses") to walk
 * every Review Book entry under this topic. Neither is a new route/endpoint. */
function topicGroup(
  courseId: string,
  group: ReviewBookGroup,
  loNames: Map<string, LoMeta>,
  onToggleBookmark: (entry: ReviewBookEntry) => void,
  onRemove: (entryId: string) => void,
): HTMLElement {
  const subgroups = groupByLo(group.entries, loNames);
  const topicPracticeHref = `#/course/${encodeURIComponent(courseId)}/practice-theme/${encodeURIComponent(group.theme._id)}`;
  const practiceAllHref = `${topicPracticeHref}?mode=review-book`;

  return el(
    'div',
    { class: 'review-topic' },
    el(
      'div',
      { class: 'review-topic__header' },
      el(
        'div',
        {},
        el('p', { class: 'review-topic__name', text: group.theme.name }),
        el('p', { class: 'review-topic__count', text: `${group.entries.length} question(s)` }),
      ),
      el(
        'div',
        { class: 'row' },
        el('a', { class: 'btn btn--ghost btn--sm', href: topicPracticeHref }, 'Topic Practice →'),
        el('a', { class: 'btn btn--ghost btn--sm', href: practiceAllHref }, 'Practice All →'),
      ),
    ),
    el(
      'div',
      { class: 'review-topic__los' },
      ...subgroups.map((sub, i) => loGroupRow(courseId, sub, i + 1, onToggleBookmark, onRemove)),
    ),
  );
}

export async function renderReviewBook(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  let sort: ReviewBookSort = 'theme';

  const header = el(
    'div',
    { class: 'page-header' },
    el(
      'div',
      { class: 'page-header__text' },
      el('h1', { class: 'page-header__title', text: 'Review Book' }),
      el('p', {
        class: 'page-header__subtitle',
        text: 'Missed questions and bookmarks, grouped by topic and learning objective.',
      }),
    ),
    el(
      'select',
      {
        class: 'input review-book__sort',
        'aria-label': 'Sort by',
        onchange: (e: Event) => {
          sort = (e.target as HTMLSelectElement).value as ReviewBookSort;
          void load();
        },
      },
      el('option', { value: 'theme', text: 'Sort by theme' }),
      el('option', { value: 'date', text: 'Sort by date added' }),
    ),
  );
  const body = el('div', {}, loadingState('Loading your Review Book…'));
  const root = el('div', { class: 'view' }, header, body, copyrightFooter());
  outlet.append(root);

  const load = async (): Promise<void> => {
    body.replaceChildren(loadingState('Loading your Review Book…'));
    try {
      const [groups, home] = await Promise.all([getReviewBook(courseId, sort), getCourseHome(courseId)]);
      if (groups.length === 0) {
        body.replaceChildren(emptyState('Nothing in your Review Book yet — missed questions and bookmarks land here.'));
        return;
      }
      const loNames = buildLoNameMap(home);

      const onToggleBookmark = async (entry: ReviewBookEntry): Promise<void> => {
        if (entry.sources.includes('bookmark')) await unbookmarkQuestion(entry.questionId);
        else await bookmarkQuestion(entry.questionId);
        void load();
      };
      const onRemove = async (entryId: string): Promise<void> => {
        await removeReviewBookEntry(entryId);
        void load();
      };

      body.replaceChildren(
        el(
          'div',
          { class: 'review-groups' },
          ...groups.map((g) =>
            topicGroup(courseId, g, loNames, (entry) => void onToggleBookmark(entry), (id) => void onRemove(id)),
          ),
        ),
      );
    } catch (error) {
      body.replaceChildren(errorState((error as Error).message, () => void load()));
    }
  };

  void load();
}
