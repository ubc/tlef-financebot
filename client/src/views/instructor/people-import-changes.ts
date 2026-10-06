import { el } from '../../dom.js';
import type { PeopleImportChanges } from '../../api.js';

/** Paged identities keep large Gradebooks readable both before and after commit. */
export function peopleImportChangesView(changes: PeopleImportChanges): HTMLElement {
  const root = el('section', { class: 'people-import-changes', 'aria-label': 'Gradebook changes' });
  let group: 'added' | 'removed' | 'roleChanged' = 'added'; let page = 1;
  const labels = { added: 'Newly added', removed: 'Missing from this file', roleChanged: 'Role changes' };
  const toolbar = el('div', { class: 'import-change-tabs' });
  const buttons = (Object.keys(labels) as Array<keyof typeof labels>).map(key => {
    const button = el('button', { class: 'btn btn--secondary', type: 'button', 'aria-pressed': key === group, text: `${labels[key]} (${changes[key].length})`, onclick: () => {
      group = key; page = 1; buttons.forEach((b, index) => b.setAttribute('aria-pressed', String((Object.keys(labels)[index]) === group))); render();
    } }); toolbar.append(button); return button;
  });
  const list = el('div', { class: 'import-change-table' });
  const position = el('span', { 'aria-live': 'polite' });
  const previous = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Previous', 'aria-label': 'Previous import changes page', onclick: () => { page--; render(); } });
  const next = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Next', 'aria-label': 'Next import changes page', onclick: () => { page++; render(); } });
  function render(): void {
    const rows = changes[group]; const pages = Math.max(1, Math.ceil(rows.length / 10));
    const selected = rows.slice((page - 1) * 10, page * 10);
    list.replaceChildren(selected.length ? el('table', { class: 'people-table', 'aria-label': labels[group] },
      el('thead', {}, el('tr', {}, ...['Person', 'Login ID', group === 'roleChanged' ? 'Previous → new CSV role' : 'CSV role'].map(text => el('th', { scope: 'col', text })))),
      el('tbody', {}, ...selected.map(person => el('tr', {}, el('td', { text: person.name || person.puid }), el('td', {}, el('code', { text: person.puid })),
        el('td', { text: `${'previousRoles' in person ? `${(person.previousRoles as string[]).join(', ')} → ` : ''}${person.roles.join(', ')}` })))))
      : el('p', { class: 'field-note', text: group === 'added' ? 'No new people in this upload.' : 'No changes in this category.' }));
    previous.disabled = page === 1; next.disabled = page === pages;
    position.textContent = `${rows.length ? (page - 1) * 10 + 1 : 0}–${Math.min(page * 10, rows.length)} of ${rows.length}`;
  }
  root.append(el('p', { class: 'import-change-summary', text: `${changes.added.length} newly added · ${changes.removed.length} missing · ${changes.roleChanged.length} role changes · ${changes.unchanged} unchanged` }), toolbar, list,
    el('div', { class: 'people-pagination' }, position, el('div', {}, previous, next)),
    el('p', { class: 'field-note', text: 'Compared with the previous CSV import by exact Login ID. A person may already have access through an invitation or code. Missing rows lose only CSV-granted access; owner role overrides and course bans remain.' }));
  render(); return root;
}
