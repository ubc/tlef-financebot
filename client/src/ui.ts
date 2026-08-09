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
    // Pre-submit "chosen but not yet locked" affordance (Figma 4) — purely a
    // suffix label driven by the state this function already receives, no
    // new data and no change to the reveal/lock semantics that pick `state`.
    state === 'selected' ? el('span', { class: 'option-btn__suffix', text: '(selected)' }) : false,
  );
}

/** Faint corner watermark (the student's uid) rendered on a practice
 * question card — a light deterrent against sharing screenshots. */
export function watermark(uid: string): HTMLElement {
  return el('span', { class: 'watermark mono', 'aria-hidden': 'true', text: uid });
}

let helpTipSeq = 0;

/**
 * A small "ⓘ" affordance that explains the setting it sits beside.
 *
 * Deliberately not hover-only. WCAG 2.1 AA 1.4.13 (Content on Hover or Focus)
 * requires such content to be reachable without a pointer, to stay put while
 * the pointer travels onto it, and to be dismissable — so the trigger is a real
 * `<button>` that reveals on `:hover` AND `:focus-visible`, the bubble lives
 * inside the hovered wrapper (hoverable), and Escape hides it (dismissable).
 * Phase 4 Task 2 (#58) cleared these surfaces at AA; a `title=` attribute or a
 * bare `<span>` here would have regressed that.
 *
 * `aria-describedby` means screen readers announce `text` with the trigger
 * whatever the visual state is, so the explanation is never pointer-gated.
 * Click toggles the bubble pinned open, which is the only thing that works on
 * touch, where `:hover` never fires.
 *
 * `label` names the setting for the accessible name ("About Auto-pause") — an
 * unlabelled row of identical "More information" buttons is what the Task 2
 * scans flagged on the Question Bank filters.
 *
 * `explicitBubbleId` is for the case where the tip explains a CONTROL, not just
 * a label: the caller needs a stable id so it can point that control's own
 * `aria-describedby` at this same bubble (see the TEST flag checkbox in
 * `views/student/practice-card.ts`, which is pre-checked and must announce its
 * consequence on focus). Callers that pass one own its uniqueness. Omit it and
 * the id is minted from the single module counter exactly as before — the
 * counter is not advanced by the explicit path, so existing auto-generated ids
 * are unaffected by any caller opting in.
 */
export function helpTip(label: string, text: string, explicitBubbleId?: string): HTMLElement {
  const bubbleId = explicitBubbleId ?? `help-tip-${++helpTipSeq}`;
  const bubble = el('span', { class: 'help-tip__bubble', id: bubbleId, role: 'tooltip', text });
  const trigger = el('button', {
    class: 'help-tip__trigger',
    type: 'button',
    'aria-label': `About ${label}`,
    'aria-describedby': bubbleId,
    text: 'i',
  }) as HTMLButtonElement;

  const wrap = el('span', { class: 'help-tip' }, trigger, bubble);

  trigger.addEventListener('click', () => {
    wrap.classList.remove('help-tip--dismissed');
    wrap.classList.toggle('help-tip--pinned');
  });

  // Escape hides the bubble even while the trigger still holds focus (which
  // would otherwise keep :focus-visible showing it). Cleared once the pointer
  // or focus leaves, so the tip is available again on the next visit.
  wrap.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    if (!wrap.classList.contains('help-tip--pinned') && !wrap.contains(document.activeElement)) return;
    wrap.classList.remove('help-tip--pinned');
    wrap.classList.add('help-tip--dismissed');
    event.stopPropagation();
    trigger.focus();
  });
  wrap.addEventListener('pointerleave', () => wrap.classList.remove('help-tip--dismissed'));
  wrap.addEventListener('focusout', (event) => {
    // `relatedTarget` is the element about to receive focus, so "did focus
    // actually leave?" is answered synchronously. Reading `activeElement` from
    // a deferred callback instead loses a race: tabbing away and straight back
    // re-focuses the trigger before the timer runs, the guard then sees focus
    // inside and bails, and the tip stays stuck dismissed for good.
    const next = (event as FocusEvent).relatedTarget;
    if (next instanceof Node && wrap.contains(next)) return;
    wrap.classList.remove('help-tip--dismissed', 'help-tip--pinned');
  });

  return wrap;
}
