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

/** Internal OptionRole -> wireframe display label (I6). */
export const ROLE_LABEL: Record<OptionRole, string> = {
  correct: 'Correct Answer',
  'common-misconception': 'Good Confounder',
  'partially-correct': 'Related but Incorrect',
  'clearly-wrong': 'Easy to Eliminate',
};
