// App bootstrap. Decides between the pre-login landing screen and the full app
// shell based on GET /api/auth/me, builds the sidebar + top bar, and starts the
// hash router. Imports use a `.js` extension because the browser loads the
// compiled output as native ES modules (see client/AGENTS.md).
import { APP } from './config.js';
import { byId, el, mount } from './dom.js';
import { initTheme, createThemeToggle } from './theme.js';
import { loadSession, displayName, type Session } from './auth.js';
import { setUnauthorizedHandler } from './api.js';
import { startRouter, type Route } from './router.js';
import { renderLanding } from './views/landing.js';
import { renderHome } from './views/home.js';
import { renderNotes } from './views/notes.js';
import { renderRag } from './views/rag.js';
import { renderMembers } from './views/members.js';
import { renderRole } from './views/role.js';
import { renderClasses } from './views/classes.js';
import { renderCourseHome } from './views/student/course-home.js';
import { renderLoList } from './views/student/lo-list.js';
import { renderPractice } from './views/student/practice.js';
import { renderReviewBook } from './views/student/review-book.js';
import { renderSessionSummary } from './views/student/session-summary.js';
import {
  INSTRUCTOR_NAV,
  courseIdFromPath,
  resolveHref,
  isNavItemActive,
  type InstructorNavItem,
} from './views/instructor/shell.js';
import {
  STUDENT_NAV,
  courseIdFromPath as studentCourseIdFromPath,
  isPracticePath,
  type StudentNavItem,
} from './views/student/shell.js';
import { practiceContextPanel } from './student-ui.js';
import { getPracticeActions, onPracticeActionsChange } from './practice-actions.js';
import { renderCourses, renderCreateCourse } from './views/instructor/courses.js';
import { renderDashboard } from './views/instructor/dashboard.js';
import { renderStructure } from './views/instructor/structure.js';
import { renderMaterials } from './views/instructor/materials.js';
import { renderSettings } from './views/instructor/settings.js';
import { renderBank } from './views/instructor/bank.js';
import { renderQuestionDetail } from './views/instructor/question-detail.js';
import { renderReviewQueue } from './views/instructor/review-queue.js';
import { renderPreseeding } from './views/instructor/preseeding.js';

// Path -> view. Adding a page: add a NAV entry (config.ts) and a line here.
// Param routes (`:id`, etc.) are matched by router.ts's matchRoute; more
// specific patterns are listed before shorter ones so e.g. `/course/:id/theme/:themeId`
// isn't shadowed by a hypothetical broader pattern (none currently overlap,
// but keeping specific-first is the convention as this list grows).
const ROUTES: Route[] = [
  { path: '/', render: renderHome },
  { path: '/faculty', render: renderRole('faculty') },
  { path: '/student', render: renderRole('student') },
  { path: '/staff', render: renderRole('staff') },
  { path: '/notes', render: renderNotes },
  { path: '/rag', render: renderRag },
  { path: '/classes', render: renderClasses },
  { path: '/members', render: renderMembers },
  { path: '/course/:id/theme/:themeId', render: renderLoList },
  { path: '/course/:id/practice-theme/:themeId', render: renderPractice },
  { path: '/course/:id/practice/:loId', render: renderPractice },
  { path: '/course/:id/review-book', render: renderReviewBook },
  { path: '/course/:id/summary', render: renderSessionSummary },
  { path: '/course/:id', render: renderCourseHome },
];

// Instructor routes (Task 15). Specific-first ordering follows the
// convention above, though `matchRoute`'s exact-segment-count matching means
// these patterns never actually shadow one another. All instructor views
// (Tasks B-G) are now wired — no placeholder routes remain.
const INSTRUCTOR_ROUTES: Route[] = [
  { path: '/instructor/courses/new', render: renderCreateCourse },
  { path: '/instructor/courses', render: renderCourses },
  { path: '/instructor/course/:id/structure', render: renderStructure },
  { path: '/instructor/course/:id/materials', render: renderMaterials },
  { path: '/instructor/course/:id/settings', render: renderSettings },
  { path: '/instructor/course/:id/bank/:questionId', render: renderQuestionDetail },
  { path: '/instructor/course/:id/bank', render: renderBank },
  { path: '/instructor/course/:id/queue', render: renderReviewQueue },
  { path: '/instructor/course/:id/preseeding', render: renderPreseeding },
  { path: '/instructor/course/:id', render: renderDashboard },
];

/** Instructor chrome shows when the session holds an `instructor` course role
 * or `isAdmin` (Task-15 Global Constraints — "Instructor-only"). */
// Who gets the instructor shell. Deliberately keyed on an EXPLICIT grant —
// `isAdmin` or an instructor `courseRole` — NOT on faculty affiliation.
//
// Provisioning model (decided 2026-07-18): instructors are added by an Admin;
// affiliation alone does not make someone an instructor. Interim for the pilot:
// admins pre-provision an instructor course-role before first login, so a
// provisioned instructor always has a role here and reaches the instructor
// shell (and Create Course) with no dead-end. A first-time, affiliation-only
// faculty user intentionally does NOT get this shell — they aren't an
// instructor until an admin says so.
//
// Phase-2 follow-up: a platform-level "instructor" grant on the User, set via
// an admin management surface (the A1/A2/I11 admin/TA screens), so admins can
// provision instructors self-serve and an instructor with zero courses still
// gets the shell without a seeded course-role. Until that lands, keep this
// check as-is.
function isInstructor(session: Session): boolean {
  const user = session.user;
  if (!user) return false;
  return user.isAdmin || user.courseRoles.some((cr) => cr.role === 'instructor');
}

/**
 * The green instructor shell — a distinct sidebar (not a NAV.roles-gated
 * variant of the default shell) per the Task-15 wireframe. Course-scoped nav
 * items (Dashboard/Structure/Materials/Bank/Queue/Settings) need the current
 * courseId spliced into their href, and that changes on every navigation
 * (moving between courses, or between "My Courses" and a course's pages), so
 * — unlike the default shell's static NAV hrefs — the anchors here are
 * rebuilt on every `onNavigate` rather than just toggling an active class.
 */
function buildInstructorShell(root: HTMLElement, session: Session): void {
  const shell = el('div', { class: 'app-shell' });
  const nav = el('nav', { class: 'nav', 'aria-label': 'Instructor' });
  const anchors: Array<{ item: InstructorNavItem; link: HTMLAnchorElement }> = [];

  for (const group of INSTRUCTOR_NAV) {
    if (group.label) nav.append(el('p', { class: 'nav__group', text: group.label }));
    for (const item of group.items) {
      const link = el(
        'a',
        {
          class: `nav__link${item.disabled ? ' nav__link--disabled' : ''}`,
          href: '#',
          onclick: (e: Event) => {
            // No resolved destination yet (out-of-scope item, or a
            // course-scoped item before any course is selected) — the '#'
            // placeholder href must not navigate.
            if (link.getAttribute('href') === '#') {
              e.preventDefault();
              return;
            }
            shell.classList.remove('is-open');
          },
        },
        el('span', { class: 'nav__text', text: item.label }),
      ) as HTMLAnchorElement;
      anchors.push({ item, link });
      nav.append(link);
    }
  }

  const user = session.user;
  // The wireframe's instructor brand mark is literally "FinanceBot" — hardcoded
  // rather than routed through config.ts's APP.name (the app-wide re-skin
  // point, see client/AGENTS.md) since renaming that would also rebrand the
  // still-generic landing/student shell, which is outside this task's scope.
  const aside = el(
    'aside',
    { class: 'sidebar sidebar--instructor' },
    el('div', { class: 'brand' }, el('span', { class: 'brand__name', text: 'FinanceBot' })),
    el('span', { class: 'instructor-pill', text: 'INSTRUCTOR' }),
    nav,
    user ? el('div', { class: 'sidebar__foot', text: displayName(user) }) : false,
  );

  const topbar = el(
    'header',
    { class: 'topbar' },
    el(
      'button',
      {
        class: 'icon-btn topbar__menu',
        type: 'button',
        'aria-label': 'Toggle navigation',
        onclick: () => shell.classList.toggle('is-open'),
      },
      '≡',
    ),
    el('span', { class: 'topbar__title' }),
    el(
      'div',
      { class: 'topbar__right' },
      createThemeToggle(),
      el('a', { class: 'btn btn--ghost btn--sm', href: '/auth/logout' }, 'Log out'),
    ),
  );

  const outlet = el('main', { class: 'outlet', id: 'view-root', tabindex: '-1' });
  const backdrop = el('div', {
    class: 'backdrop',
    'aria-hidden': 'true',
    onclick: () => shell.classList.remove('is-open'),
  });

  shell.append(aside, el('div', { class: 'main' }, topbar, outlet), backdrop);
  mount(root, shell);

  startRouter({
    routes: INSTRUCTOR_ROUTES,
    outlet,
    fallback: '/instructor/courses',
    onNavigate: (path) => {
      const courseId = courseIdFromPath(path);
      for (const { item, link } of anchors) {
        const href = resolveHref(item, courseId);
        link.setAttribute('href', href ?? '#');
        const active = isNavItemActive(item, path);
        link.classList.toggle('nav__link--active', active);
        link.classList.toggle('nav__link--disabled', !href);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      document.title = `Instructor · ${APP.name}`;
    },
  });
}

/** Whether a student nav item's href needs the current courseId spliced in
 * (`item.path` declared with a param) vs. being course-less (declared with
 * none, e.g. 'My Courses'). Relies on `Function.length`, which reflects the
 * declared parameter count regardless of whether the body reads it. */
function studentNavNeedsCourse(item: StudentNavItem): boolean {
  return item.path.length > 0;
}

/** The href for a student nav item given the current course context, or
 * `null` when it has nowhere to go yet (disabled, or course-scoped before
 * any course is selected). Mirrors instructor/shell.ts's `resolveHref`. */
function studentNavHref(item: StudentNavItem, courseId: string | undefined): string | null {
  if (item.disabled) return null;
  if (!studentNavNeedsCourse(item)) return `#${item.path('')}`;
  if (!courseId) return null;
  return `#${item.path(courseId)}`;
}

/** Whether `item` is the active nav entry for the current student path. */
function isStudentNavActive(item: StudentNavItem, path: string, courseId: string | undefined): boolean {
  if (item.disabled) return false;
  if (!studentNavNeedsCourse(item)) return item.path('') === path;
  if (!courseId) return false;
  return item.path(courseId) === path;
}

/**
 * The blue student shell — mirrors `buildInstructorShell`'s structure
 * (persistent sidebar, static routes, per-navigate active-state resolution).
 * Two differences from the instructor shell: (1) nav items are keyed by
 * label, not a route pattern, since STUDENT_NAV mixes course-less and
 * course-scoped entries with no shared prefix; (2) while a practice route is
 * active (`isPracticePath`), the static nav gives way to a practice-context
 * panel sourced from `getPracticeActions()` — the currently-rendered
 * practice view's hand-off slot (practice-actions.ts), since no student nav
 * item targets an in-progress practice session directly.
 */
function buildStudentShell(root: HTMLElement, session: Session): void {
  const shell = el('div', { class: 'app-shell' });
  const nav = el('nav', { class: 'nav', 'aria-label': 'Student' });
  const anchors: Array<{ item: StudentNavItem; link: HTMLAnchorElement }> = [];

  for (const item of STUDENT_NAV) {
    const link = el(
      'a',
      {
        class: `nav__link${item.disabled ? ' nav__link--disabled' : ''}`,
        href: '#',
        onclick: (e: Event) => {
          // No resolved destination yet (disabled item, or a course-scoped
          // item before any course is selected) — the '#' placeholder href
          // must not navigate.
          if (link.getAttribute('href') === '#') {
            e.preventDefault();
            return;
          }
          shell.classList.remove('is-open');
        },
      },
      el('span', { class: 'nav__text', text: item.label }),
    ) as HTMLAnchorElement;
    anchors.push({ item, link });
    nav.append(link);
  }

  const practiceContextSlot = el('div', { class: 'practice-context-slot' });

  const user = session.user;
  // Same "hardcode the wireframe's literal brand mark" rationale as
  // buildInstructorShell above.
  const aside = el(
    'aside',
    { class: 'sidebar sidebar--student' },
    el('div', { class: 'brand' }, el('span', { class: 'brand__name', text: 'FinanceBot' })),
    nav,
    practiceContextSlot,
    user ? el('div', { class: 'sidebar__foot', text: displayName(user) }) : false,
  );

  const topbar = el(
    'header',
    { class: 'topbar' },
    el(
      'button',
      {
        class: 'icon-btn topbar__menu',
        type: 'button',
        'aria-label': 'Toggle navigation',
        onclick: () => shell.classList.toggle('is-open'),
      },
      '≡',
    ),
    el('span', { class: 'topbar__title' }),
    el(
      'div',
      { class: 'topbar__right' },
      createThemeToggle(),
      el('a', { class: 'btn btn--ghost btn--sm', href: '/auth/logout' }, 'Log out'),
    ),
  );

  const outlet = el('main', { class: 'outlet', id: 'view-root', tabindex: '-1' });
  const backdrop = el('div', {
    class: 'backdrop',
    'aria-hidden': 'true',
    onclick: () => shell.classList.remove('is-open'),
  });

  shell.append(aside, el('div', { class: 'main' }, topbar, outlet), backdrop);
  mount(root, shell);

  // Whether the currently-resolved route is a practice route — set on every
  // onNavigate, read by `syncPracticeContext` too, since that can also run
  // asynchronously (via `onPracticeActionsChange`) well after onNavigate.
  let practiceMode = false;

  // Renders (or clears) the sidebar context panel from whatever
  // `getPracticeActions()` currently holds. Called both on navigation and
  // whenever practice.ts calls `setPracticeActions()`/`clearPracticeActions()`
  // mid-render — the router's onNavigate fires BEFORE the new route's view
  // renders (see router.ts), so relying on onNavigate alone would show a
  // stale or empty panel until the *next* navigation.
  const syncPracticeContext = (): void => {
    const actions = practiceMode ? getPracticeActions() : null;
    mount(
      practiceContextSlot,
      actions
        ? practiceContextPanel(
            actions.topicName,
            actions.loName,
            actions.statusLabel,
            actions.answered,
            actions.correct,
            actions.onSkip,
            actions.endSessionHref,
          )
        : null,
    );
  };
  onPracticeActionsChange(syncPracticeContext);

  startRouter({
    routes: ROUTES,
    outlet,
    fallback: '/',
    onNavigate: (path) => {
      const courseId = studentCourseIdFromPath(path);
      practiceMode = isPracticePath(path);
      nav.hidden = practiceMode;
      for (const { item, link } of anchors) {
        const href = studentNavHref(item, courseId);
        link.setAttribute('href', href ?? '#');
        const active = !practiceMode && isStudentNavActive(item, path, courseId);
        link.classList.toggle('nav__link--active', active);
        link.classList.toggle('nav__link--disabled', Boolean(item.disabled) || !href);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }

      syncPracticeContext();

      document.title = APP.name;
    },
  });
}

async function bootstrap(): Promise<void> {
  const root = byId('app');
  const session = await loadSession();
  if (session.authenticated) {
    if (isInstructor(session)) buildInstructorShell(root, session);
    else buildStudentShell(root, session);
  } else {
    document.title = APP.name;
    renderLanding(root);
  }
}

// A 401 from a gated endpoint (e.g. the session expired) re-bootstraps: the
// session reloads as signed-out and the landing screen takes over.
setUnauthorizedHandler(() => void bootstrap());

initTheme();
document.addEventListener('DOMContentLoaded', () => void bootstrap());
