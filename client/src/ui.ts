// Small shared UI kit: the repeated building blocks (states, badges, status
// dots, section headers) so every view looks and behaves consistently. Pure
// presentation — no data fetching here.
import { el } from './dom.js';
import { renderRichText } from './render.js';

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

// --- Shared student-practice bits (used by views/student/*.ts) --------------

/** A mastery status ('not-attempted' | 'in-progress' | 'covered' | 'struggling')
 * rendered as a small labeled badge with a consistent color mapping. */
export function masteryBadge(status: string): HTMLElement {
  const labels: Record<string, string> = {
    'not-attempted': 'Not attempted',
    'in-progress': 'In progress',
    covered: 'Covered',
    struggling: 'Struggling',
  };
  const variants: Record<string, 'up' | 'muted' | 'down'> = {
    'not-attempted': 'muted',
    'in-progress': 'muted',
    covered: 'up',
    struggling: 'down',
  };
  return badge(labels[status] ?? status, variants[status] ?? 'muted');
}

/** A selectable, radio-style option button for a practice question. `state`
 * drives the visual treatment once an attempt has been submitted: 'idle'
 * (pre-submit, selectable), 'selected' (chosen, not yet submitted), 'correct'
 * / 'incorrect' (post-submit reveal), or 'hidden-choice' (post-submit,
 * chosen-only reveal under Strategy A — a locked, unlabeled selection). */
export function optionButton(
  key: string,
  text: string,
  state: 'idle' | 'selected' | 'correct' | 'incorrect' | 'hidden-choice',
  onClick?: () => void,
): HTMLElement {
  const textEl = el('span', { class: 'option-btn__text' });
  renderRichText(textEl, text); // ST-P03: options render as rich text, not plain strings.
  return el(
    'button',
    {
      class: `option-btn option-btn--${state}`,
      type: 'button',
      disabled: onClick ? undefined : true,
      'aria-pressed': state === 'selected' ? 'true' : 'false',
      onclick: onClick,
    },
    el('span', { class: 'option-btn__key mono', text: key }),
    textEl,
  );
}

/** Faint corner watermark (the student's uid) rendered on a practice
 * question card — a light deterrent against sharing screenshots. */
export function watermark(uid: string): HTMLElement {
  return el('span', { class: 'watermark mono', 'aria-hidden': 'true', text: uid });
}
