// LO list for a theme (ST-P01/P02 drill-down): ordered LO rows with a status
// label, each linking to its own practice route, plus a "Start practice"
// shortcut that jumps to the first not-yet-covered LO.
import { getCourseHome, type CourseHomeLo } from '../../api.js';
import { el } from '../../dom.js';
import { emptyState, errorState, eyebrow, loadingState, masteryBadge } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function loRow(courseId: string, entry: CourseHomeLo): HTMLElement {
  return el(
    'a',
    { class: 'lo-row', href: `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(entry.lo._id)}` },
    el('span', { class: 'lo-row__name', text: entry.lo.name }),
    el(
      'span',
      { class: 'lo-row__meta' },
      el('span', { class: 'mono lo-row__count', text: `${entry.approvedCount} question(s)` }),
      masteryBadge(entry.status),
    ),
  );
}

export async function renderLoList(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const themeId = params.themeId;
  const root = el('div', { class: 'view' }, loadingState('Loading learning objectives…'));
  outlet.append(root);

  try {
    const home = await getCourseHome(courseId);
    const group = home.find((g) => g.theme._id === themeId);
    if (!group) {
      root.replaceChildren(errorState('This theme is not available.'));
      return;
    }

    const los = [...group.los].sort((a, b) => a.lo.order - b.lo.order);
    const firstUncovered = los.find((l) => l.status !== 'covered') ?? los[0];

    root.replaceChildren(
      el(
        'div',
        { class: 'view__intro' },
        el(
          'a',
          { class: 'btn btn--ghost btn--sm', href: `#/course/${encodeURIComponent(courseId)}` },
          '← Back to course',
        ),
        eyebrow('Theme'),
        el('h1', { class: 'view__title', text: group.theme.name }),
        firstUncovered
          ? el(
              'a',
              {
                class: 'btn btn--primary',
                href: `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(firstUncovered.lo._id)}`,
              },
              'Start practice',
            )
          : false,
      ),
      los.length
        ? el('section', { class: 'card' }, el('div', { class: 'lo-list' }, ...los.map((entry) => loRow(courseId, entry))))
        : emptyState('No learning objectives are available in this theme yet.'),
    );
  } catch (error) {
    root.replaceChildren(errorState((error as Error).message, () => void renderLoList(outlet, params)));
  }
}
