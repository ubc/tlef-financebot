// App bootstrap. Decides between the pre-login landing screen and the full app
// shell based on GET /api/auth/me, builds the sidebar + top bar, and starts the
// hash router. Imports use a `.js` extension because the browser loads the
// compiled output as native ES modules (see client/AGENTS.md).
import { APP, NAV, NAV_GROUPS, type NavGroup } from './config.js';
import { byId, el, mount } from './dom.js';
import { badge, eyebrow } from './ui.js';
import { initTheme, createThemeToggle } from './theme.js';
import { loadSession, displayName, type Session } from './auth.js';
import { setUnauthorizedHandler } from './api.js';
import { startRouter, type Route, type RouteParams } from './router.js';
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

// Instructor routes (Task 15, Task A). Views for the real instructor pages
// land in Tasks B-G; until then each route resolves to a minimal titled
// placeholder so navigation works end-to-end. Specific-first ordering follows
// the convention above, though `matchRoute`'s exact-segment-count matching
// means these patterns never actually shadow one another.
function instructorPlaceholder(title: string): (outlet: HTMLElement, params: RouteParams) => void {
  return (outlet) => {
    mount(
      outlet,
      el(
        'div',
        { class: 'view' },
        el('div', { class: 'view__intro' }, eyebrow('Instructor'), el('h1', { class: 'view__title', text: title })),
        el('p', { class: 'view__lead', text: 'This view lands in a later task.' }),
      ),
    );
  };
}

const INSTRUCTOR_ROUTES: Route[] = [
  { path: '/instructor/courses', render: instructorPlaceholder('My Courses') },
  { path: '/instructor/course/:id/structure', render: instructorPlaceholder('Course Structure') },
  { path: '/instructor/course/:id/materials', render: instructorPlaceholder('Course Materials') },
  { path: '/instructor/course/:id/settings', render: instructorPlaceholder('Course Settings') },
  { path: '/instructor/course/:id/bank/:questionId', render: instructorPlaceholder('Question Detail') },
  { path: '/instructor/course/:id/bank', render: instructorPlaceholder('Question Bank') },
  { path: '/instructor/course/:id/queue', render: instructorPlaceholder('Review Queue') },
  { path: '/instructor/course/:id/preseeding', render: instructorPlaceholder('Pre-seeding Coverage') },
  { path: '/instructor/course/:id', render: instructorPlaceholder('Course Dashboard') },
];

/** Instructor chrome shows when the session holds an `instructor` course role
 * or `isAdmin` (Task-15 Global Constraints — "Instructor-only"). */
function isInstructor(session: Session): boolean {
  const user = session.user;
  if (!user) return false;
  return user.isAdmin || user.courseRoles.some((cr) => cr.role === 'instructor');
}

const GROUP_ORDER: NavGroup[] = ['main', 'role', 'examples', 'account'];

/** An item shows if it isn't role-gated, or the user holds one of its roles. */
function isVisible(item: (typeof NAV)[number], roles: string[]): boolean {
  return !item.roles || item.roles.some((role) => roles.includes(role));
}

function buildSidebar(
  shell: HTMLElement,
  roles: string[],
): { aside: HTMLElement; links: Map<string, HTMLElement> } {
  const links = new Map<string, HTMLElement>();
  const nav = el('nav', { class: 'nav', 'aria-label': 'Primary' });

  for (const group of GROUP_ORDER) {
    const items = NAV.filter((item) => item.group === group && isVisible(item, roles));
    if (!items.length) continue;
    if (NAV_GROUPS[group]) nav.append(el('p', { class: 'nav__group', text: NAV_GROUPS[group] }));
    for (const item of items) {
      const link = el(
        'a',
        { class: 'nav__link', href: `#${item.path}`, onclick: () => shell.classList.remove('is-open') },
        el('span', { class: 'nav__glyph', 'aria-hidden': 'true', text: item.glyph }),
        el('span', { class: 'nav__text', text: item.label }),
        item.demo ? badge('DEMO', 'demo') : false,
      );
      links.set(item.path, link);
      nav.append(link);
    }
  }

  const aside = el(
    'aside',
    { class: 'sidebar' },
    el(
      'div',
      { class: 'brand' },
      el('span', { class: 'brand__mark', text: APP.shortName }),
      el('span', { class: 'brand__name', text: APP.name }),
    ),
    nav,
    el('div', { class: 'sidebar__foot mono', text: `v${APP.version}` }),
  );
  return { aside, links };
}

function buildShell(root: HTMLElement, session: Session): void {
  const shell = el('div', { class: 'app-shell' });
  const { aside, links } = buildSidebar(shell, session.roles);

  const title = el('h1', { class: 'topbar__title' });
  const user = session.user;
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
    title,
    el(
      'div',
      { class: 'topbar__right' },
      user ? el('span', { class: 'user mono', title: user.puid, text: displayName(user) }) : false,
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
    routes: ROUTES,
    outlet,
    fallback: '/',
    onNavigate: (path) => {
      for (const [itemPath, link] of links) {
        const active = itemPath === path;
        link.classList.toggle('nav__link--active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      const item = NAV.find((entry) => entry.path === path);
      title.textContent = item?.label ?? APP.name;
      document.title = item ? `${item.label} · ${APP.name}` : APP.name;
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

async function bootstrap(): Promise<void> {
  const root = byId('app');
  const session = await loadSession();
  if (session.authenticated) {
    if (isInstructor(session)) buildInstructorShell(root, session);
    else buildShell(root, session);
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
