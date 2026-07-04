// Small shared UI kit: the repeated building blocks (states, badges, status
// dots, section headers) so every view looks and behaves consistently. Pure
// presentation — no data fetching here.
import { el } from './dom.js';

/** Uppercase, tracked label used above headings and on data. */
export function eyebrow(text: string): HTMLElement {
  return el('p', { class: 'eyebrow', text });
}

/** A small pill. `variant`: 'demo' | 'muted' | 'up' | 'down'. */
export function badge(text: string, variant: 'demo' | 'muted' | 'up' | 'down' = 'muted'): HTMLElement {
  return el('span', { class: `badge badge--${variant}`, text });
}

/** A colored status dot with a mono label, e.g. ● mongodb up. */
export function statusDot(label: string, state: 'up' | 'down' | 'unknown'): HTMLElement {
  return el(
    'span',
    { class: `status status--${state}` },
    el('span', { class: 'status__dot', 'aria-hidden': 'true' }),
    el('span', { class: 'status__label', text: label }),
  );
}

/** Centered loading state with a spinner. */
export function loadingState(message = 'Loading…'): HTMLElement {
  return el(
    'div',
    { class: 'state', role: 'status' },
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    el('p', { class: 'state__text', text: message }),
  );
}

/** Empty state — an invitation to act. */
export function emptyState(message: string): HTMLElement {
  return el('div', { class: 'state state--empty' }, el('p', { class: 'state__text', text: message }));
}

/** Error state with an optional Retry button. */
export function errorState(message: string, onRetry?: () => void): HTMLElement {
  return el(
    'div',
    { class: 'state state--error', role: 'alert' },
    el('p', { class: 'state__text', text: message }),
    onRetry ? el('button', { class: 'btn btn--ghost', type: 'button', onclick: onRetry }, 'Try again') : false,
  );
}
