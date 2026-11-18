// The reader's right-hand inspector (spec D3): Review / Settings / Team tabs
// over one scrolling panel. Only the active panel is built. Arrow keys,
// Home and End move between tabs (automatic activation).
import { el } from '../../dom.js';

export type InspectorTab = 'review' | 'settings' | 'team';

export const INSPECTOR_TABS: ReadonlyArray<{ id: InspectorTab; label: string }> = [
  { id: 'review', label: 'Review' },
  { id: 'settings', label: 'Settings' },
  { id: 'team', label: 'Team' },
];

export interface InspectorOptions {
  active: InspectorTab;
  /** Pending TA suggestions, shown on the Team tab. */
  teamCount: number;
  panel: HTMLElement;
  onSelect: (tab: InspectorTab, fromKeyboard: boolean) => void;
}

export function inspector(options: InspectorOptions): HTMLElement {
  const tabId = (id: InspectorTab): string => `questions-inspector-tab-${id}`;
  const move = (event: KeyboardEvent): void => {
    const index = INSPECTOR_TABS.findIndex((tab) => tab.id === options.active);
    const last = INSPECTOR_TABS.length - 1;
    const next = event.key === 'ArrowRight' ? (index + 1) % INSPECTOR_TABS.length
      : event.key === 'ArrowLeft' ? (index + last) % INSPECTOR_TABS.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    options.onSelect(INSPECTOR_TABS[next].id, true);
  };
  const tabs = el('div', { class: 'questions-inspector__tabs', role: 'tablist', 'aria-label': 'Question inspector', onkeydown: move },
    ...INSPECTOR_TABS.map((tab) => {
      const selected = tab.id === options.active;
      return el('button', {
        class: `questions-inspector__tab${selected ? ' is-active' : ''}`,
        type: 'button',
        role: 'tab',
        id: tabId(tab.id),
        'aria-selected': String(selected),
        'aria-controls': 'questions-inspector-panel',
        tabindex: selected ? '0' : '-1',
        onclick: () => { if (!selected) options.onSelect(tab.id, false); },
      }, tab.label, tab.id === 'team' && options.teamCount
        ? el('span', { class: 'questions-inspector__count' }, String(options.teamCount), el('span', { class: 'sr-only', text: ' pending' }))
        : false);
    }));
  options.panel.id = 'questions-inspector-panel';
  options.panel.setAttribute('role', 'tabpanel');
  options.panel.setAttribute('aria-labelledby', tabId(options.active));
  options.panel.classList.add('questions-inspector__panel');
  return el('div', { class: 'questions-inspector' }, tabs, options.panel);
}
