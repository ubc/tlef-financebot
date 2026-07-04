// Light/dark theme. Light is the default; the choice is persisted and initially
// taken from the OS preference. The active theme is stamped as `data-theme` on
// <html>, which the CSS keys off (see public/styles/main.css).
import { el } from './dom.js';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'tlef-theme';

function systemPreference(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : systemPreference();
}

function apply(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/** Apply the persisted/system theme. Call once at startup (before first paint). */
export function initTheme(): void {
  apply(getTheme());
}

function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(STORAGE_KEY, next);
  apply(next);
  return next;
}

/** A button that toggles the theme and keeps its own sun/moon glyph in sync. */
export function createThemeToggle(): HTMLButtonElement {
  const button = el('button', {
    class: 'icon-btn',
    type: 'button',
    title: 'Toggle light/dark theme',
    'aria-label': 'Toggle light or dark theme',
  });
  const sync = (): void => {
    button.textContent = getTheme() === 'dark' ? '☀' : '☾';
  };
  button.addEventListener('click', () => {
    toggleTheme();
    sync();
  });
  sync();
  return button;
}
