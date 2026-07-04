// The pre-login screen. Everything else in the app is behind CWL login; this
// screen only uses public endpoints — it lets a developer confirm the backend is
// healthy and then log in. Rendered into the #app root when there is no session.
import { APP } from '../config.js';
import { el, mount } from '../dom.js';
import { eyebrow } from '../ui.js';
import { createThemeToggle } from '../theme.js';
import { healthCard } from './health.js';

/** Show a banner if the IdP bounced us back with ?login=failed. */
function loginBanner(): HTMLElement | false {
  const failed = new URLSearchParams(window.location.search).get('login') === 'failed';
  return (
    failed &&
    el(
      'div',
      { class: 'banner banner--error', role: 'alert' },
      el('strong', { text: 'Login failed. ' }),
      'The IdP rejected the sign-in — usually a certificate or callback-URL ' +
        'mismatch. See the Authentication section of the README.',
    )
  );
}

export function renderLanding(root: HTMLElement): void {
  const topbar = el(
    'header',
    { class: 'landing__bar' },
    el(
      'div',
      { class: 'brand' },
      el('span', { class: 'brand__mark', text: APP.shortName }),
      el('span', { class: 'brand__name', text: APP.name }),
    ),
    createThemeToggle(),
  );

  const hero = el(
    'section',
    { class: 'landing__hero' },
    eyebrow('UBC · Teaching & Learning'),
    el('h1', { class: 'landing__title', text: APP.tagline }),
    el('p', { class: 'landing__intro', text: APP.intro }),
    el(
      'div',
      { class: 'landing__actions' },
      el('a', { class: 'btn btn--primary', href: '/auth/ubcshib' }, 'Log in with CWL'),
    ),
    el(
      'p',
      { class: 'landing__hint' },
      'Local test users (username:password): ',
      el('code', { class: 'mono', text: 'faculty:faculty' }),
      ', ',
      el('code', { class: 'mono', text: 'student:student' }),
      ', ',
      el('code', { class: 'mono', text: 'staff:staff' }),
      '.',
    ),
  );

  mount(
    root,
    el(
      'div',
      { class: 'landing' },
      topbar,
      el(
        'main',
        { class: 'landing__main' },
        loginBanner(),
        el('div', { class: 'landing__grid' }, hero, healthCard()),
      ),
    ),
  );
}
