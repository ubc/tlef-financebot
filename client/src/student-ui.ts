// client/src/student-ui.ts
// Shared student design-system primitives (Figma "Wireframe v0.2", student
// screens 1-12). Reuses instructor-ui.ts's statTile/pageHeader directly where
// the shape matches; this module adds only what's student-specific.
import { el } from './dom.js';
import { statTile, pageHeader } from './instructor-ui.js';

export { statTile, pageHeader };

/** The blue sidebar's practice-in-progress context card: current Topic/LO,
 * mastery status label, a running "N answered · M correct" line, and the
 * Skip/End-Session actions moved out of the practice card's own body
 * (Task 3) — `onSkip`/`endSessionHref` are the still-owns-the-logic
 * hand-off from practice.ts via practice-actions.ts; this panel only
 * renders them. */
export function practiceContextPanel(
  topicName: string,
  loName: string,
  statusLabel: string,
  answered: number,
  correct: number,
  onSkip: () => void,
  endSessionHref: string,
): HTMLElement {
  return el(
    'div',
    { class: 'practice-context' },
    el('p', { class: 'practice-context__eyebrow', text: `TOPIC · ${topicName}` }),
    el('p', { class: 'practice-context__eyebrow', text: 'CURRENT LO' }),
    el('p', { class: 'practice-context__lo', text: loName }),
    el('p', { class: 'practice-context__status', text: statusLabel }),
    el('p', { class: 'practice-context__counts', text: `${answered} answered · ${correct} correct` }),
    el(
      'div',
      { class: 'practice-context__actions' },
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: onSkip }, 'Skip this LO'),
      el('a', { class: 'btn btn--ghost btn--sm', href: endSessionHref }, 'End Session & Return'),
    ),
  );
}

/** The copyright/disclaimer footer required on every student screen (PRD §4.1). */
export function copyrightFooter(): HTMLElement {
  return el(
    'div',
    { class: 'copyright-footer' },
    el('p', { class: 'copyright-footer__line', text: '© FinanceBot · UBC Sauder.' }),
    el('p', {
      class: 'copyright-footer__line',
      text:
        'All FinanceBot materials are the intellectual property of the instructor. ' +
        'Unauthorized personal or commercial use is prohibited.',
    }),
  );
}

/** A breadcrumb trail, e.g. "Course Name › Topic Name › LO 3: Objective". */
export function breadcrumb(parts: string[]): HTMLElement {
  return el(
    'nav',
    { class: 'breadcrumb', 'aria-label': 'Breadcrumb' },
    ...parts.flatMap((part, i) => [
      i > 0 ? el('span', { class: 'breadcrumb__sep', 'aria-hidden': 'true', text: '›' }) : (false as const),
      el('span', { class: 'breadcrumb__part', text: part }),
    ]),
  );
}

/** A Topic-list or LO-list row: index, title, status badge, meta line, primary action button. */
export function progressRow(
  index: number,
  title: string,
  meta: string | null,
  status: HTMLElement,
  action: { text: string; onClick: () => void; primary: boolean },
): HTMLElement {
  return el(
    'div',
    { class: 'progress-row' },
    el('span', { class: 'progress-row__index', text: String(index) }),
    el(
      'div',
      { class: 'progress-row__text' },
      el('p', { class: 'progress-row__title', text: title }),
      meta ? el('p', { class: 'progress-row__meta', text: meta }) : false,
    ),
    status,
    el(
      'button',
      {
        class: `btn btn--sm ${action.primary ? 'btn--instr-primary' : 'btn--ghost'}`,
        type: 'button',
        onclick: action.onClick,
      },
      action.text,
    ),
  );
}
