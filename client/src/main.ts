import { createRoleSwitcher, selectedWorkspaceRole, rememberWorkspaceRole } from './role-workspace.js';
import { renderWorkspaceCourses } from './views/workspace-courses.js';
import { installClientDiagnostics } from './diagnostics.js';
import { renderAdminOperations, renderAdminOperationDetail } from './views/admin/operations.js';
import { renderAdminQuestions, renderAdminQuestionDetail } from './views/admin/questions.js';
import { syncSetupJourney } from './setup-journey.js';
import { renderTutorialHelp, renderWorkspacePreviewHelp } from './views/tutorial-help.js';
// App bootstrap. Decides between the pre-login landing screen and the full app
// shell based on GET /api/auth/me, builds the sidebar + top bar, and starts the
// hash router. Imports use a `.js` extension because the browser loads the
// compiled output as native ES modules (see client/AGENTS.md).
import { APP } from './config.js';
import { byId, el, mount } from './dom.js';
import { initTheme, createThemeToggle, setAdminAppearance } from './theme.js';
import {
  createAnonymousNotificationBell,
  createNotificationBell,
} from './notifications-bell.js';
import { loadSession, displayName, type Session } from './auth.js';
import {
  listActiveExams,
  getCourseOutline,
  getCourseTree,
  setUnauthorizedHandler,
  type InstructorCourse,
} from './api.js';
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
import { renderStudentSettings } from './views/student/settings.js';
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
import { renderCoInstructors } from './views/instructor/co-instructors.js';
import { openCourseSharing } from './course-sharing.js';
import { renderCollaborativeEditor } from './views/instructor/collaborative-editor.js';
import { renderParamConfig } from './views/instructor/param-config.js';
import { renderReviewQueue } from './views/instructor/review-queue.js';
import { renderFlagQueue } from './views/instructor/flags.js';
import { renderPreseeding } from './views/instructor/preseeding.js';
import { renderTas } from './views/instructor/tas.js';
import { renderTaReviewQueue } from './views/ta/review-queue.js';
import { renderTaFlagTriage } from './views/ta/flag-triage.js';
import { renderTaQuestionDetail } from './views/ta/question-detail.js';
import { renderAnalytics } from './views/instructor/analytics.js';
import { renderStudentProfile } from './views/instructor/student-profile.js';
import {
  previewStudentRoutes as buildPreviewStudentRoutes,
} from './views/instructor/student-preview.js';
import { renderImport } from './views/instructor/import.js';
import { renderAdminAccounts } from './views/admin/accounts.js';
import { renderAdminUsers } from './views/admin/users.js';
import { renderAdminCapabilities } from './views/admin/capabilities.js';
import { renderAdminPlatformSettings } from './views/admin/platform-settings.js';
import {
  LIVE_STUDENT_EXPERIENCE,
  createPreviewStudentExperience,
  previewStudentRoutes as previewNavRoutes,
} from './views/student/experience.js';
import {
  endAnonymousPreview,
  getAnonymousPreviewSession,
  startAnonymousPreview,
} from './preview-session.js';

installClientDiagnostics();

// Path -> view. Adding a page: add a NAV entry (config.ts) and a line here.
// Param routes (`:id`, etc.) are matched by router.ts's matchRoute; more
// specific patterns are listed before shorter ones so e.g. `/course/:id/theme/:themeId`
// isn't shadowed by a hypothetical broader pattern (none currently overlap,
// but keeping specific-first is the convention as this list grows).
const ROUTES: Route[] = [
  { path: '/', render: renderHome },
  { path: '/settings', render: renderStudentSettings },
  { path: '/help', render: renderTutorialHelp },
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
  { path: '/instructor/help', render: renderTutorialHelp },
  { path: '/admin/operations', render: renderAdminOperations },
  { path: '/admin/operations/:kind/:id', render: renderAdminOperationDetail },
  { path: '/admin/questions', render: renderAdminQuestions },
  { path: '/admin/questions/:id', render: renderAdminQuestionDetail },
  { path: '/admin/help', render: renderTutorialHelp },
  { path: '/admin/platform-settings', render: renderAdminPlatformSettings },
  { path: '/admin/capabilities', render: renderAdminCapabilities },
  { path: '/admin/users', render: renderAdminUsers },
  { path: '/admin/accounts', render: renderAdminAccounts },
  { path: '/instructor/courses/new', render: renderCreateCourse },
  { path: '/instructor/courses', render: renderCourses },
  { path: '/instructor/course/:id/structure', render: renderStructure },
  { path: '/instructor/course/:id/materials', render: renderMaterials },
  { path: '/instructor/course/:id/content-map', render: renderContentMap },
  { path: '/instructor/course/:id/settings', render: renderSettings },
  { path: '/instructor/course/:id/co-instructors', render: renderCoInstructors },
  { path: '/instructor/course/:id/bank/:questionId/collaborate', render: renderCollaborativeEditor },
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
  { path: '/ta/course/:id/help', render: renderTutorialHelp },
  { path: '/ta/course/:id/question/:questionId', render: renderTaQuestionDetail },
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

function taCourseIdFromPath(path: string): string | undefined {
  const match = /^\/ta\/course\/([^/]+)/.exec(path);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function createSidebarCollapse(
  shell: HTMLElement,
  preferenceKey: string,
  startsCollapsed: boolean,
): HTMLButtonElement {
  const button = el(
    'button',
    {
      class: 'sidebar__collapse',
      type: 'button',
      'aria-label': startsCollapsed ? 'Expand navigation' : 'Collapse navigation',
      'aria-expanded': startsCollapsed ? 'false' : 'true',
      title: startsCollapsed ? 'Expand navigation' : 'Collapse navigation',
    },
    el('span', { 'aria-hidden': 'true', text: startsCollapsed ? '›' : '‹' }),
  ) as HTMLButtonElement;
  button.addEventListener('click', () => {
    const collapsed = !shell.classList.contains('is-collapsed');
    shell.classList.toggle('is-collapsed', collapsed);
    window.localStorage.setItem(preferenceKey, String(collapsed));
    button.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('title', collapsed ? 'Expand navigation' : 'Collapse navigation');
    button.replaceChildren(el('span', { 'aria-hidden': 'true', text: collapsed ? '›' : '‹' }));
  });
  return button;
}

/** TA View uses live course data and the TA action surface. Instructor/Admin
 * permissions remain those of the signed-in account; only real TAs exercise
 * capability denials configured for their course role. */
function buildTaShell(root: HTMLElement, session: Session, viewAs = false): RouterHandle {
  // The same shell can navigate actual TA courses and Instructor TA views.
  // Admins also reach all-course choices through the shared My Courses page.
  const courseIds = [...new Set(session.user?.courseRoles.filter(entry => entry.role === 'ta' || (viewAs && entry.role === 'instructor')).map(entry => entry.courseId) ?? [])];
  const initialCourseId = taCourseIdFromPath(hashPath());
  const preferenceKey = 'financebot:ta-sidebar-collapsed';
  const startsCollapsed = window.localStorage.getItem(preferenceKey) === 'true';
  const shell = el('div', {
    class: `app-shell app-shell--unified app-shell--role app-shell--ta${startsCollapsed ? ' is-collapsed' : ''}`,
  });
  const nav = el('nav', { class: 'nav', 'aria-label': 'Teaching assistant' });
  const coursesLink = el('a', { class: 'nav__link', href: '#/ta/courses', title: 'My Courses' },
    el('span', { class: 'nav__glyph', 'aria-hidden': 'true', text: 'C' }),
    el('span', { class: 'nav__text', text: 'My Courses' }),
  );
  const reviewLink = el('a', { class: 'nav__link', title: 'Review Queue' },
    el('span', { class: 'nav__glyph nav__glyph--step', 'aria-hidden': 'true', text: '1' }),
    el('span', { class: 'nav__text', text: 'Review Queue' }),
  ) as HTMLAnchorElement;
  const flagsLink = el('a', { class: 'nav__link', title: 'Flag Triage' },
    el('span', { class: 'nav__glyph nav__glyph--step', 'aria-hidden': 'true', text: '2' }),
    el('span', { class: 'nav__text', text: 'Flag Triage' }),
  ) as HTMLAnchorElement;
  const picker = el('select', {
    class: 'input ta-course-picker',
    'aria-label': 'TA course',
    onchange: () => {
      window.location.hash = `/ta/course/${encodeURIComponent(picker.value)}/review`;
    },
  }, ...courseIds.map((courseId, index) => el('option', {
    value: courseId,
    text: `Course project ${index + 1}`,
  }))) as HTMLSelectElement;
  const workflowSection = el('div', { class: 'nav__section' },
    el('p', { class: 'nav__group', text: 'Course workflow' }),
    reviewLink,
    flagsLink,
  );
  nav.append(el('div', { class: 'nav__section' }, coursesLink), workflowSection);
  const helpLink = el('a', { class: 'nav__link', href: '#', title: 'Help & Tutorials' }, el('span', { class: 'nav__glyph', 'aria-hidden': 'true', text: '?' }), el('span', { class: 'nav__text', text: 'Help & Tutorials' }));
  nav.append(helpLink);
  const courseContextName = el('strong', { class: 'course-context__name', text: 'Course project' });
  const courseContextMeta = el('span', { class: 'course-context__meta', text: 'Loading course…' });
  const courseContext = el('section', { class: 'course-context', 'aria-label': 'Current course' },
    el('div', { class: 'course-context__project' },
      el('span', { class: 'course-context__mark', 'aria-hidden': 'true', text: 'TA' }),
      el('span', { class: 'course-context__body' }, courseContextName, courseContextMeta),
    ),
    courseIds.length > 1
      ? el('div', { class: 'course-context__picker' }, picker)
      : false,
  );
  const collapseButton = createSidebarCollapse(shell, preferenceKey, startsCollapsed);
  const aside = el('aside', { class: 'sidebar sidebar--instructor sidebar--ta' },
    el('div', { class: 'sidebar__brand-row' },
      el('a', { class: 'brand', href: '#/ta/courses', title: APP.name },
        el('span', { class: 'brand__mark', 'aria-hidden': 'true', text: 'F' }),
        el('span', { class: 'brand__name', text: APP.name }),
      ),
      collapseButton,
    ),
    el('span', { class: 'instructor-pill', text: viewAs ? 'TA VIEW' : 'TEACHING ASSISTANT' }),
    courseContext,
    nav,
    session.user ? el('div', { class: 'sidebar__foot', text: displayName(session.user) }) : false,
  );
  const outlet = el('main', { class: 'outlet', id: 'view-root', tabindex: '-1' });
  const topbarTitle = el('span', { class: 'topbar__title', text: 'TA workspace' });
  const topbar = el('header', { class: 'topbar' },
    el('button', {
      class: 'icon-btn topbar__menu', type: 'button', 'aria-label': 'Toggle navigation',
      onclick: () => shell.classList.toggle('is-open'),
    }, '≡'),
    topbarTitle,
    el('div', { class: 'topbar__right' },
      // Deliberately spells out "live data" — this is not the student
      // preview's sandbox, and an escalation raised from here is real.
      viewAs
        ? el('span', { class: 'preview-mode-label', text: 'Viewing as TA · live course data' })
        : false,
      createNotificationBell('ta'), createRoleSwitcher(session, 'ta'), createThemeToggle(),
      el('a', { class: 'btn btn--ghost btn--sm', href: '/auth/logout' }, 'Log out'),
    ),
  );
  shell.append(
    aside,
    el('div', { class: 'main' }, topbar, outlet),
    el('div', { class: 'backdrop', 'aria-hidden': 'true', onclick: () => shell.classList.remove('is-open') }),
  );
  mount(root, shell);
  const courseIndex = new Map<string, ReturnType<typeof getCourseOutline>>();
  let contextVersion = 0;
  function updateCourseContext(courseId: string): void {
    const version = ++contextVersion;
    courseContextName.textContent = 'Course project';
    courseContextMeta.textContent = 'Loading course…';
    topbarTitle.textContent = 'TA workspace';
    let request = courseIndex.get(courseId);
    if (!request) {
      request = getCourseOutline(courseId);
      courseIndex.set(courseId, request);
    }
    void request.then(({ course }) => {
      if (version !== contextVersion) return;
      courseContextName.textContent = `${course.courseCode} · ${course.name}`;
      courseContextMeta.textContent = [course.term, course.section ? `Section ${course.section}` : '']
        .filter(Boolean)
        .join(' · ');
      topbarTitle.textContent = `${course.courseCode} · ${course.name}`;
      const option = Array.from(picker.options).find((candidate) => candidate.value === courseId);
      if (option) option.textContent = `${course.courseCode} · ${course.name}`;
    }).catch(() => {
      if (version !== contextVersion) return;
      courseIndex.delete(courseId);
      courseContextMeta.textContent = 'Teaching assistant workspace';
    });
  }
  for (const courseId of courseIds) {
    void getCourseOutline(courseId).then(({ course }) => {
      const option = Array.from(picker.options).find((candidate) => candidate.value === courseId);
      if (option) option.textContent = `${course.courseCode} · ${course.name}`;
    }).catch(() => undefined);
  }
  return startRouter({
    routes: [
      { path: '/ta/courses', render: outlet => renderWorkspaceCourses(outlet, 'ta') },
      { path: '/ta/help', render: outlet => viewAs ? renderWorkspacePreviewHelp(outlet, 'ta') : renderTutorialHelp(outlet) },
      ...TA_ROUTES.map(route => viewAs && route.path === '/ta/course/:id/help'
        ? { ...route, render: (outlet: HTMLElement, params: { id?: string }) => renderWorkspacePreviewHelp(outlet, 'ta', params.id) }
        : route),
    ],
    outlet,
    fallback: initialCourseId ? `/ta/course/${encodeURIComponent(initialCourseId)}/review` : '/ta/courses',
    onNavigate: (path) => {
      const courseId = taCourseIdFromPath(path);
      courseContext.hidden = !courseId;
      workflowSection.hidden = !courseId;
      helpLink.href = courseId ? `#/ta/course/${encodeURIComponent(courseId)}/help` : '#/ta/help';
      helpLink.classList.toggle('nav__link--active', path === '/ta/help' || path.endsWith('/help'));
      if (helpLink.classList.contains('nav__link--active')) helpLink.setAttribute('aria-current', 'page');
      else helpLink.removeAttribute('aria-current');
      coursesLink.classList.toggle('nav__link--active', path === '/ta/courses');
      if (path === '/ta/courses') coursesLink.setAttribute('aria-current', 'page');
      else coursesLink.removeAttribute('aria-current');
      shell.classList.remove('is-open');
      if (!courseId) {
        ++contextVersion;
        topbarTitle.textContent = 'My courses';
        document.title = `My Courses · ${APP.name}`;
        return;
      }
      updateCourseContext(courseId);
      picker.value = courseId;
      reviewLink.href = `#/ta/course/${encodeURIComponent(courseId)}/review`;
      flagsLink.href = `#/ta/course/${encodeURIComponent(courseId)}/flags`;
      reviewLink.classList.toggle(
        'nav__link--active',
        path.endsWith('/review') || path.includes('/question/'),
      );
      flagsLink.classList.toggle('nav__link--active', path.endsWith('/flags'));
      if (reviewLink.classList.contains('nav__link--active')) reviewLink.setAttribute('aria-current', 'page');
      else reviewLink.removeAttribute('aria-current');
      if (flagsLink.classList.contains('nav__link--active')) flagsLink.setAttribute('aria-current', 'page');
      else flagsLink.removeAttribute('aria-current');
      shell.classList.remove('is-open');
      document.title = viewAs ? `TA View · ${APP.name}` : `Teaching Assistant · ${APP.name}`;
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
function buildInstructorShell(root: HTMLElement, session: Session, isAdmin = session.user?.isAdmin === true): RouterHandle {
  const anonymousInstructorPreview = session.user?.isAdmin === true && !isAdmin;
  const sidebarPreferenceKey = isAdmin ? 'financebot:admin-sidebar-collapsed' : 'financebot:instructor-sidebar-collapsed';
  const startsCollapsed = window.localStorage.getItem(sidebarPreferenceKey) === 'true';
  const shell = el('div', {
    class: `app-shell app-shell--unified app-shell--instructor${isAdmin ? ' app-shell--admin' : ''}${anonymousInstructorPreview ? ' app-shell--instructor-preview' : ''}${startsCollapsed ? ' is-collapsed' : ''}`,
  });
  const nav = el('nav', { class: 'nav', 'aria-label': isAdmin ? 'Admin' : 'Instructor' });
  const anchors: Array<{
    item: InstructorNavItem;
    link: HTMLAnchorElement;
    section: HTMLElement;
    courseScoped: boolean;
  }> = [];
  const sections: Array<{ element: HTMLElement; courseScoped: boolean }> = [];
  const routes = isAdmin
    ? INSTRUCTOR_ROUTES
    : INSTRUCTOR_ROUTES.filter((route) => !route.path.startsWith('/admin/'));
  const navGroups = isAdmin
    ? [
        {
          label: 'Admin',
          items: [
            { label: 'Operations & Issues', path: '/admin/operations', glyph: 'O' },
            { label: 'All Questions', path: '/admin/questions', glyph: 'Q' },
            { label: 'User Directory', path: '/admin/users', glyph: 'U' },
            { label: 'Capabilities', path: '/admin/capabilities', glyph: 'C' },
            { label: 'Platform Settings', path: '/admin/platform-settings', glyph: 'S' },
          ],
        },
        ...INSTRUCTOR_NAV.map((group) => group.label ? group : {
          ...group,
          label: 'Teaching tools',
          items: group.items.map((item) => item.path === '/instructor/help' ? { ...item, label: 'Help & Tutorials', path: '/admin/help' } : item),
        }),
      ]
    : INSTRUCTOR_NAV;

  for (const group of navGroups) {
    const courseScoped = group.items.some((item) => item.path?.includes(':id'));
    const section = el('div', {
      class: `nav__section${courseScoped ? ' nav__section--course' : ''}`,
    });
    sections.push({ element: section, courseScoped });
    if (group.label) section.append(el('p', { class: 'nav__group', text: group.label }));
    for (const item of group.items) {
      const link = el(
        'a',
        {
          class: `nav__link${item.disabled ? ' nav__link--disabled' : ''}`,
          href: '#',
          'aria-disabled': item.disabled ? 'true' : undefined,
          'aria-label': item.label,
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
          title: item.label,
        },
        el('span', {
          class: `nav__glyph${/^\d$/.test(item.glyph ?? '') ? ' nav__glyph--step' : ''}`,
          'aria-hidden': 'true',
          text: item.glyph ?? '·',
        }),
        el('span', { class: 'nav__text', text: item.label }),
      ) as HTMLAnchorElement;
      anchors.push({ item, link, section, courseScoped });
      section.append(link);
    }
    nav.append(section);
  }

  const user = session.user;
  const courseContextName = el('strong', { class: 'course-context__name', text: 'Course project' });
  const courseContextMeta = el('span', { class: 'course-context__meta', text: 'Loading course…' });
  const courseContext = el(
    'section',
    { class: 'course-context', hidden: 'hidden', 'aria-label': 'Current course' },
    el('a', { class: 'course-context__back', href: '#/instructor/courses' }, '← All courses'),
    el(
      'div',
      { class: 'course-context__project' },
      el('span', { class: 'course-context__mark', 'aria-hidden': 'true', text: 'P' }),
      el('span', { class: 'course-context__body' }, courseContextName, courseContextMeta),
    ),
  );
  const collapseButton = createSidebarCollapse(shell, sidebarPreferenceKey, startsCollapsed);
  const aside = el(
    'aside',
    { class: 'sidebar sidebar--instructor' },
    el(
      'div',
      { class: 'sidebar__brand-row' },
      el(
        'a',
        { class: 'brand', href: isAdmin ? '#/admin/users' : '#/instructor/courses', title: isAdmin ? `${APP.name} Admin` : APP.name },
        el('span', { class: 'brand__mark', 'aria-hidden': 'true', text: isAdmin ? 'A' : 'F' }),
        el('span', { class: 'brand__name', text: isAdmin ? 'Admin' : APP.name }),
      ),
      collapseButton,
    ),
    el('span', { class: 'instructor-pill', text: isAdmin ? 'PLATFORM CONSOLE' : anonymousInstructorPreview ? 'PREVIEW MODE' : 'INSTRUCTOR' }),
    courseContext,
    nav,
    user ? el('div', { class: 'sidebar__foot', text: displayName(user) }) : false,
  );

  const topbarTitle = el('span', { class: 'topbar__title', text: 'All courses' });
  const shareButton = el('button', { class: 'btn btn--instr-primary btn--sm', hidden: true, onclick: () => {
    const courseId = courseIdFromPath(hashPath());
    if (courseId) openCourseSharing(courseId);
  } }, 'Share');
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
    topbarTitle,
    el(
      'div',
      { class: 'topbar__right' },
      anonymousInstructorPreview
        ? el('span', {
            class: 'preview-mode-label',
            text: 'Anonymous Instructor Preview',
            title: 'Admin identity retained · course changes are live',
            'aria-label': 'Anonymous Instructor Preview; course changes are live',
          })
        : false,
      createNotificationBell('instructor'),
      shareButton,
      createRoleSwitcher(session, isAdmin ? 'admin' : 'instructor'),
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

  const courseIndex = new Map<string, Promise<InstructorCourse>>();
  let courseContextVersion = 0;
  function updateCourseContext(courseId: string | null, path: string): void {
    const version = ++courseContextVersion;
    shareButton.hidden = !courseId;
    if (!courseId) {
      courseContext.hidden = true;
      topbarTitle.textContent = path.startsWith('/admin/')
        ? 'Platform administration'
        : path === '/instructor/courses/new'
          ? 'Create course project'
          : anonymousInstructorPreview ? 'Instructor preview' : 'Course projects';
      return;
    }
    courseContext.hidden = false;
    courseContextName.textContent = 'Course project';
    courseContextMeta.textContent = 'Loading course…';
    topbarTitle.textContent = 'Course project';
    let courseRequest = courseIndex.get(courseId);
    if (!courseRequest) {
      courseRequest = getCourseTree(courseId).then((tree) => tree.course);
      courseIndex.set(courseId, courseRequest);
    }
    void courseRequest.then((course) => {
      if (version !== courseContextVersion) return;
      courseContextName.textContent = `${course.courseCode} · ${course.name}`;
      courseContextMeta.textContent = [course.term, course.section ? `Section ${course.section}` : '']
        .filter(Boolean)
        .join(' · ');
      topbarTitle.textContent = `${course.courseCode} · ${course.name}`;
    }).catch(() => {
      if (version !== courseContextVersion) return;
      courseIndex.delete(courseId);
      courseContextMeta.textContent = 'Instructor workspace';
    });
  }

  return startRouter({
    routes,
    outlet,
    fallback: isAdmin ? '/admin/users' : '/instructor/courses',
    onNavigate: (path) => {
      const courseId = courseIdFromPath(path);
      updateCourseContext(courseId, path);
      for (const { item, link, courseScoped } of anchors) {
        const resolvedHref = resolveHref(item, courseId);
        const href = item.path === '/instructor/help' && courseId ? `${resolvedHref}?courseId=${encodeURIComponent(courseId)}` : resolvedHref;
        link.hidden = courseScoped && !courseId;
        link.setAttribute('href', href ?? '#');
        const active = isNavItemActive(item, isAdmin && path === '/admin/accounts' ? '/admin/users' : path);
        link.classList.toggle('nav__link--active', active);
        link.classList.toggle('nav__link--disabled', !href);
        if (href) {
          link.removeAttribute('aria-disabled');
          link.removeAttribute('tabindex');
        } else {
          link.setAttribute('aria-disabled', 'true');
          link.setAttribute('tabindex', '-1');
        }
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      for (const section of sections) {
        section.element.hidden = section.courseScoped && !courseId;
      }
      document.title = `${isAdmin ? 'Admin' : anonymousInstructorPreview ? 'Instructor Preview' : 'Instructor'} · ${APP.name}`;
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
  loadCourseContext(courseId: string): Promise<{ name: string; courseCode: string; term: string }>;
  preview?: {
    courseId?: string;
  };
}

const LIVE_STUDENT_SHELL: StudentShellConfig = {
  routes: ROUTES,
  fallback: '/',
  navItems: STUDENT_NAV,
  courseIdFromPath: studentCourseIdFromPath,
  practicePath: isPracticePath,
  loadCourseContext: async (courseId) => {
    const enrollment = (await LIVE_STUDENT_EXPERIENCE.listEnrollments())
      .find((candidate) => candidate.courseId === courseId);
    if (!enrollment) throw new Error('course-not-found');
    return enrollment;
  },
};

function previewCourseIdFromPath(path: string): string | undefined {
  const match = /^\/preview\/course\/([^/]+)/.exec(path);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function isPreviewPracticePath(path: string): boolean {
  return /^\/preview\/course\/[^/]+\/practice(-theme)?\//.test(path);
}

function previewNavItems(courseId?: string): StudentNavItem[] {
  const routes = previewNavRoutes();
  return [
    { label: 'My Courses', glyph: 'C', path: () => '/preview/courses' },
    { label: 'Help & Tutorials', glyph: '?', path: () => '/preview/help' },
    { label: 'Course Home', glyph: 'H', path: () => routes.course(courseId ?? '').replace(/^#/, '') },
    { label: 'Review Book', glyph: 'R', path: () => routes.reviewBook(courseId ?? '').replace(/^#/, '') },
    { label: 'Exam Prep', glyph: 'E', path: () => '#', disabled: true },
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
  const preferenceKey = config.preview
    ? 'financebot:student-preview-sidebar-collapsed'
    : 'financebot:student-sidebar-collapsed';
  const startsCollapsed = window.localStorage.getItem(preferenceKey) === 'true';
  const shell = el('div', {
    class: `app-shell app-shell--unified app-shell--role app-shell--student${startsCollapsed ? ' is-collapsed' : ''}`,
  });
  shell.dataset.previewCourse = config.preview?.courseId ?? '';
  const nav = el('nav', { class: 'nav', 'aria-label': 'Student' });
  const overviewSection = el('div', { class: 'nav__section' },
    el('p', { class: 'nav__group', text: 'Courses' }),
  );
  const courseSection = el('div', { class: 'nav__section nav__section--course' },
    el('p', { class: 'nav__group', text: 'Learning workspace' }),
  );
  const anchors: Array<{ item: StudentNavItem; link: HTMLAnchorElement; courseScoped: boolean }> = [];

  for (const item of config.navItems) {
    const courseScoped = studentNavNeedsCourse(item)
      || (config.preview !== undefined && item.label !== 'My Courses' && item.label !== 'Help & Tutorials');
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
        'aria-label': item.label,
        title: item.label,
      },
      el('span', { class: 'nav__glyph', 'aria-hidden': 'true', text: item.glyph }),
      el('span', { class: 'nav__text', text: item.label }),
    ) as HTMLAnchorElement;
    if (item.examOnly) link.hidden = true;
    anchors.push({ item, link, courseScoped });
    (courseScoped ? courseSection : overviewSection).append(link);
  }
  nav.append(overviewSection, courseSection);

  const practiceContextSlot = el('div', { class: 'practice-context-slot' });

  const user = session.user;
  const courseContextName = el('strong', { class: 'course-context__name', text: 'Course project' });
  const courseContextMeta = el('span', { class: 'course-context__meta', text: 'Loading course…' });
  const courseContext = el('section', {
    class: 'course-context', hidden: 'hidden', 'aria-label': 'Current course',
  },
    el('a', {
      class: 'course-context__back',
      href: config.preview
        ? (studentNavHref(config.navItems[0], config.preview.courseId) ?? '#')
        : '#/',
    }, config.preview ? '← Preview courses' : '← All courses'),
    el('div', { class: 'course-context__project' },
      el('span', { class: 'course-context__mark', 'aria-hidden': 'true', text: 'L' }),
      el('span', { class: 'course-context__body' }, courseContextName, courseContextMeta),
    ),
  );
  const collapseButton = createSidebarCollapse(shell, preferenceKey, startsCollapsed);
  const aside = el(
    'aside',
    { class: 'sidebar sidebar--student' },
    el('div', { class: 'sidebar__brand-row' },
      el('a', {
        class: 'brand',
        href: config.preview
          ? (studentNavHref(config.navItems[0], config.preview.courseId) ?? '#')
          : '#/',
        title: APP.name,
      },
        el('span', { class: 'brand__mark', 'aria-hidden': 'true', text: 'F' }),
        el('span', { class: 'brand__name', text: APP.name }),
      ),
      collapseButton,
    ),
    config.preview
      ? el('span', { class: 'student-preview-pill', text: 'PREVIEW MODE' })
      : el('span', { class: 'student-preview-pill', text: 'STUDENT' }),
    courseContext,
    nav,
    practiceContextSlot,
    config.preview
      ? el('div', { class: 'sidebar__foot', text: 'Anonymous Student' })
      : user
        ? el('div', { class: 'sidebar__foot', text: displayName(user) })
        : false,
  );

  const topbarTitle = el('span', { class: 'topbar__title', text: 'My courses' });
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
    topbarTitle,
    el(
      'div',
      { class: 'topbar__right' },
      config.preview
        ? el('span', { class: 'preview-mode-label', text: 'Anonymous Student Preview' })
        : false,
      config.preview ? createAnonymousNotificationBell() : createNotificationBell('student'),
      createRoleSwitcher(session, 'student'),
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
  let examAvailabilityRequest = 0;
  const courseIndex = new Map<string, ReturnType<StudentShellConfig['loadCourseContext']>>();
  let contextVersion = 0;

  function updateCourseContext(courseId: string | undefined): void {
    const version = ++contextVersion;
    if (!courseId) {
      courseContext.hidden = true;
      courseSection.hidden = true;
      topbarTitle.textContent = config.preview ? 'Student preview' : 'My courses';
      return;
    }
    courseContext.hidden = false;
    courseSection.hidden = false;
    courseContextName.textContent = 'Course project';
    courseContextMeta.textContent = 'Loading course…';
    topbarTitle.textContent = config.preview ? 'Student preview' : 'Course learning';
    let request = courseIndex.get(courseId);
    if (!request) {
      request = config.loadCourseContext(courseId);
      courseIndex.set(courseId, request);
    }
    void request.then((course) => {
      if (version !== contextVersion) return;
      courseContextName.textContent = `${course.courseCode} · ${course.name}`;
      courseContextMeta.textContent = course.term;
      topbarTitle.textContent = `${course.courseCode} · ${course.name}`;
    }).catch(() => {
      if (version !== contextVersion) return;
      courseIndex.delete(courseId);
      courseContextMeta.textContent = 'Student learning workspace';
    });
  }

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
      updateCourseContext(courseId);
      if (!courseId && path === '/settings') topbarTitle.textContent = 'Settings';
      const availabilityRequest = ++examAvailabilityRequest;
      practiceMode = config.practicePath(path);
      nav.hidden = practiceMode;
      for (const { item, link, courseScoped } of anchors) {
        const resolvedHref = studentNavHref(item, courseId);
        const href = (item.label === 'Help & Tutorials' || item.label === 'Settings') && courseId ? `${resolvedHref}?courseId=${encodeURIComponent(courseId)}` : resolvedHref;
        link.hidden = courseScoped && !courseId;
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
  courseId?: string,
): RouterHandle {
  const previewSessionId = getAnonymousPreviewSession(courseId ?? 'course-picker');
  const experience = createPreviewStudentExperience(previewSessionId, { sendToInstructorQueue: Boolean(session.user?.isAdmin || session.user?.courseRoles.some(entry => entry.courseId === courseId && entry.role === 'instructor')) });
  return buildStudentShell(root, session, {
    routes: [
      { path: '/preview/courses', render: outlet => renderWorkspaceCourses(outlet, 'student') },
      { path: '/preview/help', render: outlet => renderWorkspacePreviewHelp(outlet, 'student') },
      ...buildPreviewStudentRoutes(experience),
    ],
    fallback: courseId ? `/preview/course/${encodeURIComponent(courseId)}` : '/preview/courses',
    navItems: previewNavItems(courseId),
    courseIdFromPath: previewCourseIdFromPath,
    practicePath: isPreviewPracticePath,
    loadCourseContext: async (currentCourseId) => {
      const enrollment = (await experience.listEnrollments(currentCourseId))
        .find((candidate) => candidate.courseId === currentCourseId);
      if (!enrollment) throw new Error('course-not-found');
      return enrollment;
    },
    preview: {
      courseId,
    },
  });
}

type ShellMode = 'landing' | 'admin' | 'instructor' | 'ta' | 'ta-view' | 'student' | 'preview';
let activeRouter: RouterHandle | undefined;
let activeMode: ShellMode | undefined;
let activeSession: Session | undefined;
let bootstrapGeneration = 0;

/**
 * `ta-view` is kept distinct from `ta` rather than folded into it with a
 * boolean, because the hashchange listener rebuilds the shell only when the
 * MODE string changes. Sharing one mode would leave the "TA VIEW" state
 * stale when a hand-typed URL moves between a course the user
 * really TAs and one they only instruct.
 */
function shellMode(session: Session, path: string): ShellMode {
  if (!session.authenticated) return 'landing';
  if ((isInstructor(session) || isTa(session)) && path.startsWith('/preview/')) return 'preview';
  const preferred = selectedWorkspaceRole(session);
  const taCourseId = taCourseIdFromPath(path);
  if (path.startsWith('/ta/') && (isInstructor(session) || isTa(session))) {
    if (taCourseId && taCourseIds(session).includes(taCourseId)) return 'ta';
    return isInstructor(session) ? 'ta-view' : 'ta';
  }
  if (path.startsWith('/admin/') && session.user?.isAdmin) return 'admin';
  if (path.startsWith('/instructor/') && isInstructor(session)) return session.user?.isAdmin && preferred !== 'instructor' ? 'admin' : 'instructor';
  if (preferred === 'student' && (isInstructor(session) || isTa(session))) return 'preview';
  if (preferred === 'ta') return isInstructor(session) ? 'ta-view' : 'ta';
  if (preferred === 'admin' && session.user?.isAdmin) return 'admin';
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
  const generation = ++bootstrapGeneration;
  activeRouter?.stop();
  activeRouter = undefined;
  const root = byId('app');
  const session = await loadSession();
  if (generation !== bootstrapGeneration) return;
  activeSession = session;
  syncSetupJourney();

  if (redirectLegacyPreview(session)) return;

  activeMode = shellMode(session, hashPath());
  setAdminAppearance(activeMode === 'admin');
  if (activeMode !== 'landing') rememberWorkspaceRole(session, activeMode === 'preview' ? 'student' : activeMode === 'ta-view' ? 'ta' : activeMode);
  if (activeMode === 'landing') {
    document.title = APP.name;
    renderLanding(root);
    return;
  }
  if (activeMode === 'preview') {
    activeRouter = buildPreviewStudentShell(root, session, previewCourseIdFromPath(hashPath()));
    return;
  }
  if (activeMode === 'ta-view') {
    activeRouter = buildTaShell(root, session, true);
    return;
  }
  activeRouter = activeMode === 'instructor' || activeMode === 'admin'
    ? buildInstructorShell(root, session, activeMode === 'admin')
    : activeMode === 'ta'
      ? buildTaShell(root, session)
      : buildStudentShell(root, session);
}

// A 401 from a gated endpoint (e.g. the session expired) re-bootstraps: the
// session reloads as signed-out and the landing screen takes over.
setUnauthorizedHandler(() => void bootstrap());

initTheme();
window.addEventListener('hashchange', (event) => {
  if (activeRouter?.guardNavigation(event)) return;
  if (!activeSession) return;
  // A share can grant Instructor access while this tab still has its older
  // Student/TA session projection. Resolve the new deep-link with fresh roles.
  if (activeSession.authenticated && hashPath().startsWith('/instructor/') && !isInstructor(activeSession)) {
    activeRouter?.stop();
    activeRouter = undefined;
    event.stopImmediatePropagation();
    void bootstrap();
    return;
  }
  if (redirectLegacyPreview(activeSession)) {
    activeRouter?.stop();
    activeRouter = undefined;
    event.stopImmediatePropagation();
    return;
  }
  const nextMode = shellMode(activeSession, hashPath());
  if (nextMode === activeMode && !(nextMode === 'preview' && (previewCourseIdFromPath(hashPath()) ?? '') !== document.querySelector<HTMLElement>('.app-shell')?.dataset.previewCourse)) return;
  if (activeMode === 'preview' && nextMode !== 'preview') endAnonymousPreview();
  activeRouter?.stop();
  activeRouter = undefined;
  void bootstrap();
});
document.addEventListener('DOMContentLoaded', () => void bootstrap());
