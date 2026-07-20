// LO list for a topic (ST-P01/P02 drill-down, Figma wireframe screen 3):
// pageHeader (topic name + LO coverage), a "Session Summary" ghost link and
// "Start Practice" primary link (jumps to the first not-yet-covered LO) in
// the header's action area, a lead line, and ordered progressRows per LO —
// each linking to its own practice route. The in-progress row additionally
// shows a "Continue here" sub-line.
import { getCourseHome, listEnrollments, type CourseHomeLo, type CourseHomeTheme } from '../../api.js';
import { el } from '../../dom.js';
import { emptyState, errorState, loadingState, masteryBadge } from '../../ui.js';
import { progressRow, copyrightFooter, breadcrumb } from '../../student-ui.js';
import type { RouteParams } from '../../router.js';

function coverage(group: CourseHomeTheme): { covered: number; total: number } {
  const total = group.los.length;
  const covered = group.los.filter((l) => l.status === 'covered').length;
  return { covered, total };
}

/** Mirrors `pageHeader` (student-ui.ts) visually but supports the two
 * header actions Figma screen 3 calls for ("Session Summary →" ghost,
 * "Start Practice →" primary) — `pageHeader` itself only takes one. */
function loListHeader(
  themeName: string,
  coverageLabel: string,
  courseId: string,
  firstUncovered: CourseHomeLo | undefined,
): HTMLElement {
  return el(
    'div',
    { class: 'page-header' },
    el(
      'div',
      { class: 'page-header__text' },
      el('h1', { class: 'page-header__title', text: themeName }),
      el('p', { class: 'page-header__subtitle', text: coverageLabel }),
    ),
    el(
      'div',
      { class: 'row', style: 'flex-shrink:0' },
      el(
        'a',
        { class: 'btn btn--ghost btn--sm', href: `#/course/${encodeURIComponent(courseId)}/summary` },
        'Session Summary →',
      ),
      firstUncovered
        ? el(
            'a',
            {
              class: 'btn btn--instr-primary btn--sm',
              href: `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(firstUncovered.lo._id)}`,
            },
            'Start Practice →',
          )
        : false,
    ),
  );
}

function loRow(courseId: string, entry: CourseHomeLo, index: number): HTMLElement {
  const href = `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(entry.lo._id)}`;
  const row = progressRow(
    index,
    entry.lo.name,
    `${entry.approvedCount} question(s) available`,
    masteryBadge(entry.status),
    {
      text: entry.status === 'not-attempted' ? 'Practice →' : 'Practice again',
      primary: true,
      onClick: () => {
        window.location.hash = href;
      },
    },
  );
  if (entry.status === 'in-progress') {
    row.append(el('p', { class: 'progress-row__continue', text: '▸ Continue here' }));
  }
  return row;
}

export async function renderLoList(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const themeId = params.themeId;
  const root = el('div', { class: 'view' }, loadingState('Loading learning objectives…'));
  outlet.append(root);

  try {
    const [home, enrollments] = await Promise.all([getCourseHome(courseId), listEnrollments()]);
    const group = home.find((g) => g.theme._id === themeId);
    if (!group) {
      root.replaceChildren(errorState('This topic is not available.'));
      return;
    }

    const los = [...group.los].sort((a, b) => a.lo.order - b.lo.order);
    const firstUncovered = los.find((l) => l.status !== 'covered');
    const { covered, total } = coverage(group);
    const courseName = enrollments.find((e) => e.courseId === courseId)?.name ?? 'Course';

    root.replaceChildren(
      breadcrumb([courseName, group.theme.name]),
      loListHeader(group.theme.name, `${covered}/${total} LOs covered`, courseId, firstUncovered),
      el('p', {
        class: 'view__lead',
        text: "Select a LO to jump directly to practice, or click ‘Start Practice’ to begin with the first uncovered LO.",
      }),
      los.length
        ? el('div', { class: 'stack' }, ...los.map((entry, i) => loRow(courseId, entry, i + 1)))
        : emptyState('No learning objectives are available in this topic yet.'),
      copyrightFooter(),
    );
  } catch (error) {
    root.replaceChildren(errorState((error as Error).message, () => void renderLoList(outlet, params)));
  }
}
