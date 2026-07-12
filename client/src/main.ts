// App bootstrap. Decides between the pre-login landing screen and the full app
// shell based on GET /api/auth/me, builds the sidebar + top bar, and starts the
// hash router. Imports use a `.js` extension because the browser loads the
// compiled output as native ES modules (see client/AGENTS.md).
import { APP, NAV, NAV_GROUPS, type NavGroup } from './config.js';
import { byId, el, mount } from './dom.js';
import { badge } from './ui.js';
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

// Path -> view. Adding a page: add a NAV entry (config.ts) and a line here.
const ROUTES: Route[] = [
  { path: '/', render: renderHome },
  { path: '/faculty', render: renderRole('faculty') },
  { path: '/student', render: renderRole('student') },
  { path: '/staff', render: renderRole('staff') },
  { path: '/notes', render: renderNotes },
  { path: '/rag', render: renderRag },
  { path: '/members', render: renderMembers },
];

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

async function bootstrap(): Promise<void> {
  const root = byId('app');
  const session = await loadSession();
  if (session.authenticated) {
    buildShell(root, session);
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
