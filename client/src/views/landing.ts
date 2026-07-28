// The pre-login screen. Everything else in the app is behind CWL login; this
// screen is rendered into the #app root when there is no session.
//
// Mirrors Figma "Wireframe v0.2" frame `0 - Login` (file 3lSS05Sk1OWpnxFQNyVsM9,
// node 148:5448): one centered card holding the wordmark, the CWL button, and a
// redirect note — deliberately nothing else. The system-health card that used to
// live here still exists on the signed-in overview (views/home.ts).
import { APP } from '../config.js';
import { el, mount } from '../dom.js';
import { createThemeToggle } from '../theme.js';

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
  // The arrow is decorative: hiding it keeps the link's accessible name exactly
  // "Log in with CWL" instead of "Log in with CWL right arrow".
  const card = el(
    'div',
    { class: 'login-card' },
    el('h1', { class: 'login-card__wordmark', text: APP.name }),
    el(
      'a',
      { class: 'login-card__cta', href: '/auth/ubcshib' },
      'Log in with CWL',
      el('span', { 'aria-hidden': 'true', text: '→' }),
    ),
    el('p', {
      class: 'login-card__note',
      text: 'You’ll be redirected to UBC’s CWL login.',
    }),
  );

  // Not in the wireframe (frame 0 - Login draws no chrome at all), but without
  // it a signed-out visitor cannot switch themes — the only other toggle lives
  // in the signed-in shell's topbar. Parked in the corner so it stays clear of
  // the card's composition.
  mount(
    root,
    el(
      'div',
      { class: 'landing' },
      el('header', { class: 'landing__theme-toggle' }, createThemeToggle()),
      el('main', { class: 'landing__main' }, loginBanner(), card),
    ),
  );
}
