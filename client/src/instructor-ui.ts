// Shared instructor design-system primitives (Task 15, Task A). The instructor
// views (Tasks B-G) are built against the green/white wireframe language — this
// module is the shared vocabulary so those views stay visually consistent
// without a framework, same spirit as ui.ts for the student/example views. See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md.
import type { OptionRole } from './api.js';
import { el } from './dom.js';

/** A big-number stat tile (I1/I2/N9). `tone` colors the number. */
export function statTile(
  value: string | number,
  label: string,
  tone: 'default' | 'good' | 'warn' | 'bad' = 'default',
): HTMLElement {
  return el(
    'div',
    { class: 'stat-tile' },
    el('p', { class: `stat-tile__value stat-tile__value--${tone}`, text: String(value) }),
    el('p', { class: 'stat-tile__label', text: label }),
  );
}

// Pill badge. `variant` maps to a CSS modifier: question status, agent
// decision, or coverage vocabulary (see wireframe-reference.md "Status/badge
// vocabulary").
export type BadgeVariant =
  | 'approved'
  | 'pending'
  | 'reviewed'
  | 'draft'
  | 'paused'
  | 'archived'
  | 'pass'
  | 'flag'
  | 'reject'
  | 'at-target'
  | 'below-target'
  | 'empty'
  | 'neutral';

export function statusBadge(text: string, variant: BadgeVariant): HTMLElement {
  return el('span', { class: `status-badge status-badge--${variant}`, text });
}

/** Pre-publish checklist row: ok check / open circle, label, optional inline action link. */
export function checklistRow(label: string, ok: boolean, action?: { text: string; onClick: () => void }): HTMLElement {
  return el(
    'div',
    { class: `checklist-row${ok ? ' checklist-row--ok' : ''}` },
    el('span', { class: 'checklist-row__mark', 'aria-hidden': 'true', text: ok ? '✓' : '○' }),
    el('span', { class: `checklist-row__label${ok ? '' : ' checklist-row__label--pending'}`, text: label }),
    action
      ? el(
          'button',
          { class: 'checklist-row__action', type: 'button', onclick: action.onClick },
          action.text,
        )
      : false,
  );
}

/** Filter tab strip; returns the container. `active` by index; `onSelect(i)` on click. */
export function filterTabs(tabs: string[], activeIndex: number, onSelect: (i: number) => void): HTMLElement {
  return el(
    'div',
    { class: 'filter-tabs', role: 'tablist' },
    ...tabs.map((tab, i) =>
      el(
        'button',
        {
          class: `filter-tabs__tab${i === activeIndex ? ' filter-tabs__tab--active' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': i === activeIndex ? 'true' : 'false',
          onclick: () => onSelect(i),
        },
        tab,
      ),
    ),
  );
}

/** Drag-drop + browse upload zone; calls `onFiles` with the picked/dropped files. */
export function uploadZone(hint: string, onFiles: (files: File[]) => void): HTMLElement {
  const input = el('input', {
    class: 'upload-zone__input',
    type: 'file',
    multiple: 'multiple',
    hidden: 'hidden',
    onchange: () => {
      if (input.files?.length) onFiles(Array.from(input.files));
      input.value = '';
    },
  }) as HTMLInputElement;

  const zone = el(
    'div',
    {
      class: 'upload-zone',
      ondragover: (e: DragEvent) => {
        e.preventDefault();
        zone.classList.add('upload-zone--over');
      },
      ondragleave: () => zone.classList.remove('upload-zone--over'),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        zone.classList.remove('upload-zone--over');
        const files = e.dataTransfer?.files;
        if (files?.length) onFiles(Array.from(files));
      },
    },
    el('p', { class: 'upload-zone__hint', text: hint }),
    el(
      'button',
      { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => input.click() },
      'Browse files',
    ),
    input,
  );
  return zone;
}

/** Instructor page header: title, sub-line, optional primary action button (dark). */
export function pageHeader(title: string, subtitle: string, action?: { text: string; onClick: () => void }): HTMLElement {
  return el(
    'div',
    { class: 'page-header' },
    el(
      'div',
      { class: 'page-header__text' },
      el('h1', { class: 'page-header__title', text: title }),
      subtitle ? el('p', { class: 'page-header__subtitle', text: subtitle }) : false,
    ),
    action
      ? el(
          'button',
          { class: 'btn btn--instr-primary', type: 'button', onclick: action.onClick },
          action.text,
        )
      : false,
  );
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
 */
export function helpTip(label: string, text: string): HTMLElement {
  const bubbleId = `help-tip-${++helpTipSeq}`;
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

/** A `section-title` heading with a `helpTip` beside it. */
export function sectionTitleWithHelp(title: string, tip: string): HTMLElement {
  return el('h2', { class: 'section-title section-title--with-help' }, title, helpTip(title, tip));
}

/** Internal OptionRole -> wireframe display label (I6). */
export const ROLE_LABEL: Record<OptionRole, string> = {
  correct: 'Correct Answer',
  'common-misconception': 'Good Confounder',
  'partially-correct': 'Related but Incorrect',
  'clearly-wrong': 'Easy to Eliminate',
};
