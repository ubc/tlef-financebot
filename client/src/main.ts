// App bootstrap. Decides between the pre-login landing screen and the full app
// shell based on GET /api/auth/me, builds the sidebar + top bar, and starts the
// hash router. Imports use a `.js` extension because the browser loads the
// compiled output as native ES modules (see client/AGENTS.md).
import { APP } from './config.js';
import { byId, el, mount } from './dom.js';
import { initTheme, createThemeToggle } from './theme.js';
import {
  createAnonymousNotificationBell,
  createNotificationBell,
} from './notifications-bell.js';
import { loadSession, displayName, type Session } from './auth.js';
import { listActiveExams, setUnauthorizedHandler } from './api.js';
import { startRouter, type Route, type RouterHandle } from './router.js';
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
import { renderExamSelect } from './views/student/exam-select.js';
import { renderExamAttempt } from './views/student/exam-attempt.js';
import { renderExamResults } from './views/student/exam-results.js';
import { renderExamHistory } from './views/student/exam-history.js';
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
import { renderContentMap } from './views/instructor/content-map.js';
import { renderSettings } from './views/instructor/settings.js';
import { renderExamTemplates } from './views/instructor/exam-templates.js';
import { renderBank } from './views/instructor/bank.js';
import { renderQuestionDetail } from './views/instructor/question-detail.js';
import { renderParamConfig } from './views/instructor/param-config.js';
import { renderReviewQueue } from './views/instructor/review-queue.js';
import { renderFlagQueue } from './views/instructor/flags.js';
import { renderPreseeding } from './views/instructor/preseeding.js';
import { renderTas } from './views/instructor/tas.js';
import { renderTaReviewQueue } from './views/ta/review-queue.js';
import { renderTaFlagTriage } from './views/ta/flag-triage.js';
import { renderAnalytics } from './views/instructor/analytics.js';
import { renderStudentProfile } from './views/instructor/student-profile.js';
import {
  previewStudentRoutes as buildPreviewStudentRoutes,
} from './views/instructor/student-preview.js';
import { renderImport } from './views/instructor/import.js';
import { renderAdminAccounts } from './views/admin/accounts.js';
import {
  createPreviewStudentExperience,
  previewStudentRoutes as previewNavRoutes,
} from './views/student/experience.js';
import {
  endAnonymousPreview,
  getAnonymousPreviewSession,
  startAnonymousPreview,
} from './preview-session.js';

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
  { path: '/course/:id/exams', render: renderExamSelect },
  { path: '/course/:id/exam-attempt/:attemptId/results', render: renderExamResults },
  { path: '/course/:id/exam-attempt/:attemptId', render: renderExamAttempt },
  { path: '/course/:id/exam-history', render: renderExamHistory },
  { path: '/course/:id', render: renderCourseHome },
];

// Instructor routes (Task 15). Specific-first ordering follows the
// convention above, though `matchRoute`'s exact-segment-count matching means
// these patterns never actually shadow one another. All instructor views
// (Tasks B-G) are now wired — no placeholder routes remain.
const INSTRUCTOR_ROUTES: Route[] = [
  { path: '/admin/accounts', render: renderAdminAccounts },
  { path: '/instructor/courses/new', render: renderCreateCourse },
  { path: '/instructor/courses', render: renderCourses },
  { path: '/instructor/course/:id/structure', render: renderStructure },
  { path: '/instructor/course/:id/materials', render: renderMaterials },
  { path: '/instructor/course/:id/content-map', render: renderContentMap },
  { path: '/instructor/course/:id/settings', render: renderSettings },
  { path: '/instructor/course/:id/exam-templates', render: renderExamTemplates },
  { path: '/instructor/course/:id/bank/:questionId/params', render: renderParamConfig },
  { path: '/instructor/course/:id/bank/:questionId', render: renderQuestionDetail },
  { path: '/instructor/course/:id/bank', render: renderBank },
  { path: '/instructor/course/:id/queue', render: renderReviewQueue },
  { path: '/instructor/course/:id/flags', render: renderFlagQueue },
  { path: '/instructor/course/:id/import', render: renderImport },
  { path: '/instructor/course/:id/preseeding', render: renderPreseeding },
  { path: '/instructor/course/:id/tas', render: renderTas },
  { path: '/instructor/course/:id/student/:puid', render: renderStudentProfile },
  { path: '/instructor/course/:id/analytics', render: renderAnalytics },
  { path: '/instructor/course/:id', render: renderDashboard },
];

const TA_ROUTES: Route[] = [
  { path: '/ta/course/:id/review', render: renderTaReviewQueue },
  { path: '/ta/course/:id/flags', render: renderTaFlagTriage },
];

/** Instructor chrome shows for an explicit global/course Instructor grant or
 * Admin. SAML faculty affiliation alone is not authorization. */
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
function isInstructor(session: Session): boolean {
  const user = session.user;
  if (!user) return false;
  return user.isAdmin
    || user.platformInstructor === true
    || user.courseRoles.some((cr) => cr.role === 'instructor');
}

function taCourseIds(session: Session): string[] {
  return session.user?.courseRoles
    .filter((role) => role.role === 'ta')
    .map((role) => role.courseId) ?? [];
}

function isTa(session: Session): boolean {
  return taCourseIds(session).length > 0;
}

function buildTaShell(root: HTMLElement, session: Session): RouterHandle {
  const courseIds = taCourseIds(session);
  const initialCourseId = /^\/ta\/course\/([^/]+)/.exec(hashPath())?.[1]
    ? decodeURIComponent(/^\/ta\/course\/([^/]+)/.exec(hashPath())![1])
    : courseIds[0];
  const shell = el('div', { class: 'app-shell' });
  const nav = el('nav', { class: 'nav', 'aria-label': 'Teaching assistant' });
  const reviewLink = el('a', { class: 'nav__link', text: 'Review Queue' }) as HTMLAnchorElement;
  const flagsLink = el('a', { class: 'nav__link', text: 'Flag Triage' }) as HTMLAnchorElement;
  const picker = el('select', {
    class: 'input',
    'aria-label': 'TA course',
    onchange: () => {
      window.location.hash = `/ta/course/${encodeURIComponent(picker.value)}/review`;
    },
  }, ...courseIds.map((courseId, index) => el('option', {
    value: courseId,
    text: `Course ${index + 1}`,
  }))) as HTMLSelectElement;
  if (courseIds.length > 1) {
    nav.append(el('div', { class: 'stack stack--sm' }, el('label', { text: 'Course' }), picker));
  }
  nav.append(
    el('p', { class: 'nav__group', text: 'TA WORKSPACE' }),
    reviewLink,
    flagsLink,
  );
  const aside = el('aside', { class: 'sidebar sidebar--instructor' },
    el('div', { class: 'brand' }, el('span', { class: 'brand__name', text: APP.name })),
    el('span', { class: 'instructor-pill', text: 'TEACHING ASSISTANT' }),
    nav,
    session.user ? el('div', { class: 'sidebar__foot', text: displayName(session.user) }) : false,
  );
  const outlet = el('main', { class: 'outlet', id: 'view-root', tabindex: '-1' });
  const topbar = el('header', { class: 'topbar' },
    el('button', {
      class: 'icon-btn topbar__menu', type: 'button', 'aria-label': 'Toggle navigation',
      onclick: () => shell.classList.toggle('is-open'),
    }, '≡'),
    el('span', { class: 'topbar__title', text: 'TA Workspace' }),
    el('div', { class: 'topbar__right' },
      createNotificationBell(), createThemeToggle(),
      el('a', { class: 'btn btn--ghost btn--sm', href: '/auth/logout' }, 'Log out'),
    ),
  );
  shell.append(
    aside,
    el('div', { class: 'main' }, topbar, outlet),
    el('div', { class: 'backdrop', 'aria-hidden': 'true', onclick: () => shell.classList.remove('is-open') }),
  );
  mount(root, shell);
  return startRouter({
    routes: TA_ROUTES,
    outlet,
    fallback: `/ta/course/${encodeURIComponent(initialCourseId)}/review`,
    onNavigate: (path) => {
      const match = /^\/ta\/course\/([^/]+)/.exec(path);
      const courseId = match ? decodeURIComponent(match[1]) : initialCourseId;
      picker.value = courseId;
      reviewLink.href = `#/ta/course/${encodeURIComponent(courseId)}/review`;
      flagsLink.href = `#/ta/course/${encodeURIComponent(courseId)}/flags`;
      reviewLink.classList.toggle('nav__link--active', path.endsWith('/review'));
      flagsLink.classList.toggle('nav__link--active', path.endsWith('/flags'));
      shell.classList.remove('is-open');
      document.title = `Teaching Assistant · ${APP.name}`;
    },
  });
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
function buildInstructorShell(root: HTMLElement, session: Session): RouterHandle {
  const shell = el('div', { class: 'app-shell' });
  const nav = el('nav', { class: 'nav', 'aria-label': 'Instructor' });
  const anchors: Array<{ item: InstructorNavItem; link: HTMLAnchorElement }> = [];
  const routes = session.user?.isAdmin
    ? INSTRUCTOR_ROUTES
    : INSTRUCTOR_ROUTES.filter((route) => !route.path.startsWith('/admin/'));
  const navGroups = session.user?.isAdmin
    ? [
        {
          label: 'Admin',
          items: [{ label: 'User Accounts', path: '/admin/accounts' }],
        },
        ...INSTRUCTOR_NAV,
      ]
    : INSTRUCTOR_NAV;

  for (const group of navGroups) {
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
  const aside = el(
    'aside',
    { class: 'sidebar sidebar--instructor' },
    el('div', { class: 'brand' }, el('span', { class: 'brand__name', text: APP.name })),
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
      createNotificationBell(),
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

  return startRouter({
    routes,
    outlet,
    fallback: session.user?.isAdmin ? '/admin/accounts' : '/instructor/courses',
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
      document.title = `${path.startsWith('/admin/') ? 'Admin' : 'Instructor'} · ${APP.name}`;
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
  if (item.examOnly) {
    return path.startsWith(`/course/${courseId}/exams`)
      || path.startsWith(`/course/${courseId}/exam-attempt/`)
      || path.startsWith(`/course/${courseId}/exam-history`);
  }
  return item.path(courseId) === path;
}

interface StudentShellConfig {
  routes: Route[];
  fallback: string;
  navItems: StudentNavItem[];
  courseIdFromPath(path: string): string | undefined;
  practicePath(path: string): boolean;
  preview?: {
    courseId: string;
    exitHref: string;
  };
}

const LIVE_STUDENT_SHELL: StudentShellConfig = {
  routes: ROUTES,
  fallback: '/',
  navItems: STUDENT_NAV,
  courseIdFromPath: studentCourseIdFromPath,
  practicePath: isPracticePath,
};

function previewCourseIdFromPath(path: string): string | undefined {
  const match = /^\/preview\/course\/([^/]+)/.exec(path);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function isPreviewPracticePath(path: string): boolean {
  return /^\/preview\/course\/[^/]+\/practice(-theme)?\//.test(path);
}

function previewNavItems(courseId: string): StudentNavItem[] {
  const routes = previewNavRoutes();
  return [
    { label: 'My Courses', path: () => routes.courses(courseId).replace(/^#/, '') },
    { label: 'Review Book', path: () => routes.reviewBook(courseId).replace(/^#/, '') },
    { label: 'Exam Prep', path: () => '#', disabled: true },
  ];
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
function buildStudentShell(
  root: HTMLElement,
  session: Session,
  config: StudentShellConfig = LIVE_STUDENT_SHELL,
): RouterHandle {
  const shell = el('div', { class: 'app-shell' });
  const nav = el('nav', { class: 'nav', 'aria-label': 'Student' });
  const anchors: Array<{ item: StudentNavItem; link: HTMLAnchorElement }> = [];

  for (const item of config.navItems) {
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
    if (item.examOnly) link.hidden = true;
    anchors.push({ item, link });
    nav.append(link);
  }

  const practiceContextSlot = el('div', { class: 'practice-context-slot' });

  const user = session.user;
  const aside = el(
    'aside',
    { class: 'sidebar sidebar--student' },
    el('div', { class: 'brand' }, el('span', { class: 'brand__name', text: APP.name })),
    config.preview
      ? el('span', { class: 'student-preview-pill', text: 'PREVIEW MODE' })
      : false,
    nav,
    practiceContextSlot,
    config.preview
      ? el('div', { class: 'sidebar__foot', text: 'Anonymous Student' })
      : user
        ? el('div', { class: 'sidebar__foot', text: displayName(user) })
        : false,
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
      config.preview
        ? el('span', { class: 'preview-mode-label', text: 'Anonymous Student Preview' })
        : false,
      config.preview ? createAnonymousNotificationBell() : createNotificationBell(),
      createThemeToggle(),
      config.preview
        ? el(
            'a',
            {
              class: 'btn btn--ghost btn--sm',
              href: config.preview.exitHref,
              onclick: () => endAnonymousPreview(),
            },
            'Exit Preview',
          )
        : false,
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
  let examAvailabilityRequest = 0;

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

  return startRouter({
    routes: config.routes,
    outlet,
    fallback: config.fallback,
    onNavigate: (path) => {
      const courseId = config.courseIdFromPath(path);
      const availabilityRequest = ++examAvailabilityRequest;
      practiceMode = config.practicePath(path);
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

      const examAnchors = anchors.filter(({ item }) => item.examOnly);
      if (examAnchors.length && courseId && !config.preview) {
        void listActiveExams(courseId).then((templates) => {
          if (availabilityRequest !== examAvailabilityRequest) return;
          for (const { item, link } of examAnchors) {
            const available = templates.length > 0;
            link.hidden = !available;
            link.setAttribute('href', available ? (studentNavHref(item, courseId) ?? '#') : '#');
            link.classList.toggle('nav__link--disabled', !available);
          }
        }).catch(() => {
          if (availabilityRequest !== examAvailabilityRequest) return;
          for (const { link } of examAnchors) link.hidden = true;
        });
      } else {
        for (const { link } of examAnchors) link.hidden = true;
      }

      syncPracticeContext();

      document.title = config.preview ? `Student Preview · ${APP.name}` : APP.name;
    },
  });
}

function hashPath(): string {
  const raw = window.location.hash.replace(/^#/, '').split('?')[0];
  return raw || '/';
}

function buildPreviewStudentShell(
  root: HTMLElement,
  session: Session,
  courseId: string,
): RouterHandle {
  const previewSessionId = getAnonymousPreviewSession(courseId);
  const experience = createPreviewStudentExperience(previewSessionId);
  return buildStudentShell(root, session, {
    routes: buildPreviewStudentRoutes(experience),
    fallback: `/preview/course/${encodeURIComponent(courseId)}`,
    navItems: previewNavItems(courseId),
    courseIdFromPath: previewCourseIdFromPath,
    practicePath: isPreviewPracticePath,
    preview: {
      courseId,
      exitHref: `#/instructor/course/${encodeURIComponent(courseId)}`,
    },
  });
}

type ShellMode = 'landing' | 'instructor' | 'ta' | 'student' | 'preview';
let activeRouter: RouterHandle | undefined;
let activeMode: ShellMode | undefined;
let activeSession: Session | undefined;

function shellMode(session: Session, path: string): ShellMode {
  if (!session.authenticated) return 'landing';
  if (isInstructor(session) && previewCourseIdFromPath(path)) return 'preview';
  if (isInstructor(session)) return 'instructor';
  return isTa(session) ? 'ta' : 'student';
}

function redirectLegacyPreview(session: Session): boolean {
  const match = /^\/instructor\/course\/([^/]+)\/preview$/.exec(hashPath());
  if (!session.authenticated || !isInstructor(session) || !match) return false;
  const courseId = decodeURIComponent(match[1]);
  startAnonymousPreview(courseId);
  window.location.hash = `/preview/course/${encodeURIComponent(courseId)}`;
  return true;
}

async function bootstrap(): Promise<void> {
  activeRouter?.stop();
  activeRouter = undefined;
  const root = byId('app');
  const session = await loadSession();
  activeSession = session;

  if (redirectLegacyPreview(session)) return;

  activeMode = shellMode(session, hashPath());
  if (activeMode === 'landing') {
    document.title = APP.name;
    renderLanding(root);
    return;
  }
  if (activeMode === 'preview') {
    const courseId = previewCourseIdFromPath(hashPath());
    if (courseId) {
      activeRouter = buildPreviewStudentShell(root, session, courseId);
      return;
    }
  }
  activeRouter = activeMode === 'instructor'
    ? buildInstructorShell(root, session)
    : activeMode === 'ta'
      ? buildTaShell(root, session)
      : buildStudentShell(root, session);
}

// A 401 from a gated endpoint (e.g. the session expired) re-bootstraps: the
// session reloads as signed-out and the landing screen takes over.
setUnauthorizedHandler(() => void bootstrap());

initTheme();
window.addEventListener('hashchange', (event) => {
  if (!activeSession) return;
  if (redirectLegacyPreview(activeSession)) {
    activeRouter?.stop();
    activeRouter = undefined;
    event.stopImmediatePropagation();
    return;
  }
  const nextMode = shellMode(activeSession, hashPath());
  if (nextMode === activeMode) return;
  activeRouter?.stop();
  activeRouter = undefined;
  void bootstrap();
});
document.addEventListener('DOMContentLoaded', () => void bootstrap());
