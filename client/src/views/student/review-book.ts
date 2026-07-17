// Review Book (ST-R02..R07/R05): collapsed theme groups with entry counts,
// a sort dropdown (theme | date — the two sorts review-book.service.ts
// actually implements), a re-practice shortcut, and a remove button per
// entry.
import {
  getReviewBook,
  removeReviewBookEntry,
  type ReviewBookEntry,
  type ReviewBookGroup,
  type ReviewBookSort,
} from '../../api.js';
import { el } from '../../dom.js';
import { badge, emptyState, errorState, eyebrow, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function entryRow(courseId: string, entry: ReviewBookEntry, onRemove: () => void): HTMLElement {
  const practiceHref = `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(entry.loId)}?mode=review-book&questionId=${encodeURIComponent(entry.questionId)}`;
  return el(
    'div',
    { class: 'review-entry' },
    el(
      'div',
      { class: 'review-entry__main' },
      el('p', { class: 'review-entry__stem', text: entry.question.stem.slice(0, 140) }),
      el(
        'div',
        { class: 'review-entry__badges' },
        ...entry.sources.map((s) => badge(s === 'bookmark' ? 'BOOKMARK' : 'AUTO', s === 'bookmark' ? 'demo' : 'muted')),
      ),
    ),
    el(
      'div',
      { class: 'review-entry__actions' },
      el('a', { class: 'btn btn--sm btn--primary', href: practiceHref }, 'Re-practice'),
      el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: onRemove }, 'Remove'),
    ),
  );
}

function themeGroup(courseId: string, group: ReviewBookGroup, onRemove: (entryId: string) => void): HTMLElement {
  const details = el(
    'details',
    { class: 'review-group' },
    el(
      'summary',
      { class: 'review-group__summary' },
      el('span', { class: 'review-group__name', text: group.theme.name }),
      el('span', { class: 'mono review-group__count', text: `${group.entries.length}` }),
    ),
    el('div', { class: 'review-group__entries' }, ...group.entries.map((entry) => entryRow(courseId, entry, () => onRemove(entry._id)))),
  );
  return details;
}

export async function renderReviewBook(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  let sort: ReviewBookSort = 'theme';

  const root = el(
    'div',
    { class: 'view' },
    el('div', { class: 'view__intro' }, eyebrow('Practice'), el('h1', { class: 'view__title', text: 'Review Book' })),
  );
  const controls = el('div', { class: 'row review-book__controls' });
  const body = el('div', {}, loadingState('Loading your Review Book…'));
  root.append(controls, body);
  outlet.append(root);

  const load = async (): Promise<void> => {
    body.replaceChildren(loadingState('Loading your Review Book…'));
    try {
      const groups = await getReviewBook(courseId, sort);
      if (groups.length === 0) {
        body.replaceChildren(emptyState('Nothing in your Review Book yet — missed questions and bookmarks land here.'));
        return;
      }
      const onRemove = async (entryId: string): Promise<void> => {
        await removeReviewBookEntry(entryId);
        void load();
      };
      body.replaceChildren(el('div', { class: 'review-groups' }, ...groups.map((g) => themeGroup(courseId, g, (id) => void onRemove(id)))));
    } catch (error) {
      body.replaceChildren(errorState((error as Error).message, () => void load()));
    }
  };

  const select = el(
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
  );
  controls.append(select);

  void load();
}
