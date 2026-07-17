// Student course home (ST-P01/P02): theme cards with a coverage indicator and
// a "Practice this Theme" shortcut, plus a start-of-session banner (welcome on
// a student's first-ever visit, or a "pick up where you left off" summary of
// their last deferred session — ST-P11).
import { getCourseHome, getSessionSummary, type CourseHomeTheme, type SessionSummaryForStart } from '../../api.js';
import { el } from '../../dom.js';
import { emptyState, errorState, eyebrow, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function coverage(theme: CourseHomeTheme): { covered: number; total: number } {
  const total = theme.los.length;
  const covered = theme.los.filter((l) => l.status === 'covered').length;
  return { covered, total };
}

function sessionBanner(courseId: string, summary: SessionSummaryForStart, onDismiss: () => void): HTMLElement | false {
  if (summary.welcome) {
    return el(
      'div',
      { class: 'banner banner--welcome' },
      el('p', { class: 'banner__text', text: "Welcome! Pick a theme below to start practicing — there's no rush." }),
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

function themeCard(courseId: string, group: CourseHomeTheme): HTMLElement {
  const { covered, total } = coverage(group);
  return el(
    'article',
    { class: 'theme-card' },
    el(
      'a',
      { class: 'theme-card__title', href: `#/course/${encodeURIComponent(courseId)}/theme/${encodeURIComponent(group.theme._id)}` },
      group.theme.name,
    ),
    el(
      'div',
      { class: 'theme-card__coverage' },
      el('div', { class: 'coverage-bar' }, el('div', { class: 'coverage-bar__fill', style: `width:${total ? (covered / total) * 100 : 0}%` })),
      el('span', { class: 'theme-card__coverage-label mono', text: `${covered}/${total} LOs covered` }),
    ),
    el(
      'a',
      { class: 'btn btn--primary btn--sm', href: `#/course/${encodeURIComponent(courseId)}/practice-theme/${encodeURIComponent(group.theme._id)}` },
      'Practice this Theme',
    ),
  );
}

export async function renderCourseHome(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const root = el(
    'div',
    { class: 'view' },
    el('div', { class: 'view__intro' }, eyebrow('Course'), el('h1', { class: 'view__title', text: 'Practice' })),
  );
  const bannerSlot = el('div', {});
  const body = el('div', {}, loadingState('Loading your course…'));
  root.append(bannerSlot, body);
  outlet.append(root);

  try {
    const [home, summary] = await Promise.all([getCourseHome(courseId), getSessionSummary(courseId)]);
    const banner = sessionBanner(courseId, summary, () => bannerSlot.replaceChildren());
    if (banner) bannerSlot.append(banner);

    if (home.length === 0) {
      body.replaceChildren(emptyState('No themes are available to practice yet — check back once your instructor publishes questions.'));
      return;
    }
    body.replaceChildren(el('div', { class: 'theme-grid' }, ...home.map((group) => themeCard(courseId, group))));
  } catch (error) {
    body.replaceChildren(errorState((error as Error).message, () => void renderCourseHome(outlet, params)));
  }
}
