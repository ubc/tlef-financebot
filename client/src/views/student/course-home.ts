// Student course home / "Topic List" (ST-P01/P02, Figma wireframe screen 2):
// a pageHeader (course name + code · term · overall LO coverage) followed by
// a "Topic Practice" list of progressRows — one per Topic (the domain model
// still calls this a Theme; see student-ui.ts/design-doc note that "Topic
// List" is this same screen, not a new page) — plus a start-of-session
// banner (welcome on a student's first-ever visit, or a "pick up where you
// left off" summary of their last deferred session — ST-P11).
import {
  getCourseHome,
  getSessionSummary,
  listEnrollments,
  type CourseHomeTheme,
  type SessionSummaryForStart,
} from '../../api.js';
import { el } from '../../dom.js';
import { emptyState, errorState, loadingState, masteryBadge } from '../../ui.js';
import { pageHeader, progressRow, copyrightFooter } from '../../student-ui.js';
import type { RouteParams } from '../../router.js';

function coverage(theme: CourseHomeTheme): { covered: number; total: number } {
  const total = theme.los.length;
  const covered = theme.los.filter((l) => l.status === 'covered').length;
  return { covered, total };
}

function overallCoverage(home: CourseHomeTheme[]): { covered: number; total: number } {
  return home.reduce(
    (acc, group) => {
      const { covered, total } = coverage(group);
      return { covered: acc.covered + covered, total: acc.total + total };
    },
    { covered: 0, total: 0 },
  );
}

/** A Topic's aggregate mastery, reusing the LO-level `MasteryStatus`
 * vocabulary (masteryBadge) rather than inventing topic-specific wording —
 * 'covered' once every LO is covered, 'in-progress' once any LO has been
 * touched, else 'not-attempted'. */
function topicStatus(theme: CourseHomeTheme): 'not-attempted' | 'in-progress' | 'covered' {
  const { covered, total } = coverage(theme);
  if (total > 0 && covered === total) return 'covered';
  const touched = theme.los.some((l) => l.status !== 'not-attempted');
  return touched ? 'in-progress' : 'not-attempted';
}

function sessionBanner(courseId: string, summary: SessionSummaryForStart, onDismiss: () => void): HTMLElement | false {
  if (summary.welcome) {
    return el(
      'div',
      { class: 'banner banner--welcome' },
      el('p', { class: 'banner__text', text: "Welcome! Pick a topic below to start practicing — there's no rush." }),
      el('button', { class: 'icon-btn banner__dismiss', type: 'button', 'aria-label': 'Dismiss', onclick: onDismiss }, '✕'),
    );
  }
  const deferred = summary.deferred;
  if (!deferred) return false;
  const accuracy = deferred.accuracyByLo.length
    ? Math.round(
        (deferred.accuracyByLo.reduce((sum, a) => sum + a.correct, 0) /
          Math.max(1, deferred.accuracyByLo.reduce((sum, a) => sum + a.attempted, 0))) *
          100,
      )
    : null;
  return el(
    'div',
    { class: 'banner' },
    el(
      'div',
      {},
      el('p', { class: 'banner__text', text: `Welcome back — last time you covered ${deferred.losCovered.length} learning objective(s)${accuracy !== null ? ` at ${accuracy}% accuracy` : ''}.` }),
      el(
        'a',
        { class: 'banner__link', href: `#/course/${encodeURIComponent(courseId)}/summary` },
        'View full summary →',
      ),
    ),
    el('button', { class: 'icon-btn banner__dismiss', type: 'button', 'aria-label': 'Dismiss', onclick: onDismiss }, '✕'),
  );
}

function topicRow(courseId: string, group: CourseHomeTheme, index: number): HTMLElement {
  const { covered, total } = coverage(group);
  const status = topicStatus(group);
  const href = `#/course/${encodeURIComponent(courseId)}/practice-theme/${encodeURIComponent(group.theme._id)}`;
  return progressRow(
    index,
    group.theme.name,
    `${covered}/${total} LOs covered`,
    masteryBadge(status),
    {
      text: status === 'not-attempted' ? 'Start →' : 'Practice again',
      primary: true,
      onClick: () => {
        window.location.hash = href;
      },
    },
  );
}

export async function renderCourseHome(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const root = el('div', { class: 'view' }, loadingState('Loading your course…'));
  outlet.append(root);

  try {
    const [home, enrollments, summary] = await Promise.all([
      getCourseHome(courseId),
      listEnrollments(),
      getSessionSummary(courseId),
    ]);
    const enrollment = enrollments.find((e) => e.courseId === courseId);
    const { covered, total } = overallCoverage(home);
    const coverageLabel = `${covered}/${total} LOs covered`;
    const subtitle = enrollment ? `${enrollment.courseCode} · ${enrollment.term} · ${coverageLabel}` : coverageLabel;

    const bannerSlot = el('div', {});
    const banner = sessionBanner(courseId, summary, () => bannerSlot.replaceChildren());
    if (banner) bannerSlot.append(banner);

    const body =
      home.length === 0
        ? emptyState('No topics are available to practice yet — check back once your instructor publishes questions.')
        : el(
            'section',
            {},
            el('h2', { class: 'section-title', text: 'Topic Practice' }),
            el('div', { class: 'stack' }, ...home.map((group, i) => topicRow(courseId, group, i + 1))),
          );

    root.replaceChildren(
      pageHeader(enrollment?.name ?? 'Course', subtitle),
      bannerSlot,
      body,
      copyrightFooter(),
    );
  } catch (error) {
    root.replaceChildren(errorState((error as Error).message, () => void renderCourseHome(outlet, params)));
  }
}
