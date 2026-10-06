import { el, mount } from '../../dom.js';
import { changeCoursePerson, getCoursePeople, type CoursePeoplePage, type CoursePerson } from '../../course-people-api.js';
import { openPeopleInvitation, peopleDialog, rolePicker, ROLE_LABELS } from '../../course-people-invite.js';
import { confirmDialog } from '../../modal.js';
import type { RouteParams } from '../../router.js';
import { peopleImportPanel } from './people-import.js';
import { registrationCodesPanel } from './registration-codes.js';

const date = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const STATUS = { active: 'Active', pending: 'Pending', banned: 'Banned', expired: 'Expired', deactivated: 'Deactivated', revoked: 'Cancelled' };

export function renderPeople(outlet: HTMLElement, params: RouteParams): void {
  const courseId = params.id;
  let result: CoursePeoplePage | undefined;
  let tab = 'people'; let page = 1; let generation = 0; let disposed = false; let mutation = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const root = el('div', { class: 'view people-workspace' });
  const meta = el('div', { class: 'course-line' });
  const notice = el('p', { class: 'inline-feedback', role: 'status' });
  const error = el('p', { class: 'directory-error', role: 'alert' });
  const body = el('div', { id: 'people-content', 'data-tutorial': 'people-list' });
  const invite = el('button', { class: 'btn btn--instr-primary', type: 'button', disabled: true, 'data-tutorial': 'people-invite', text: 'Invite person', onclick: () => openPeopleInvitation(courseId) });
  const importButton = el('button', { class: 'btn btn--secondary', type: 'button', disabled: true, text: 'Import Gradebook', onclick: () => {
    const modal = peopleDialog('Import people from Canvas'); modal.dialog.classList.add('import-dialog');
    modal.dialog.append(peopleImportPanel(courseId));
    modal.dialog.addEventListener('people-import-busy', event => modal.busy(Boolean((event as CustomEvent<boolean>).detail)));
    modal.dialog.addEventListener('close', () => { void load(); }, { once: true }); modal.show();
  } });
  const tabs = el('nav', { class: 'people-tabs', 'aria-label': 'People sections' });
  const tabButtons = ['people', 'invitations', 'codes'].map(value => {
    const button = el('button', { type: 'button', 'aria-pressed': value === tab, text: value === 'people' ? 'People' : value === 'invitations' ? 'Invitations' : 'Registration codes', onclick: () => {
      if (mutation) return;
      tab = value; page = 1; generation++;
      tabButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(['people', 'invitations', 'codes'][i] === tab)));
      if (tab === 'codes') { body.replaceChildren(registrationCodesPanel(courseId, Boolean(result?.canManage))); error.textContent = ''; }
      else { renderDirectory(); void load(); }
    } });
    tabs.append(button); return button;
  });
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search name, email, CWL or Login ID', 'aria-label': 'Search people', maxlength: 200 });
  const role = el('select', { class: 'input', 'aria-label': 'Filter course role' }, el('option', { value: '', text: 'All roles' }),
    ...Object.entries(ROLE_LABELS).map(([value, text]) => el('option', { value, text })));
  const status = el('select', { class: 'input', 'aria-label': 'Filter people status' }, el('option', { value: '', text: 'All statuses' }),
    ...Object.entries(STATUS).filter(([value]) => value !== 'revoked').map(([value, text]) => el('option', { value, text })));
  const size = el('select', { class: 'input', 'aria-label': 'People per page' }, ...[10, 25, 50].map(value => el('option', { value, text: `${value} / page` })));
  const refresh = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Refresh', onclick: () => load() });
  const tableSlot = el('div', { class: 'table-wrap' });
  const pageLabel = el('span', { 'aria-live': 'polite' });
  const prev = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Previous', 'aria-label': 'Previous people page', onclick: () => { page--; return load(); } });
  const next = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Next', 'aria-label': 'Next people page', onclick: () => { page++; return load(); } });
  const directory = el('div', {},
    el('div', { class: 'people-toolbar' }, el('div', { class: 'search-wrap' }, search), role, status, refresh),
    tableSlot, el('nav', { class: 'people-pagination', 'aria-label': 'People pagination' }, pageLabel, el('div', {}, size, prev, next)));
  function renderDirectory(): void { if (body.firstChild !== directory) body.replaceChildren(directory); }
  function row(person: CoursePerson): HTMLTableRowElement {
    const actions = el('div', { class: 'row-actions' }, el('button', { class: 'btn btn--ghost', type: 'button', text: 'View', 'aria-label': `View ${person.displayName}`, onclick: () => inspect(person) }));
    if (result?.canManage && !person.protected && person.status !== 'deactivated') {
      const label = !person.puid ? 'Cancel invite' : person.status === 'banned' ? 'Unban' : 'Ban';
      actions.append(el('button', { class: 'btn btn--ghost danger-button', type: 'button', text: label, 'aria-label': `${label} ${person.displayName}`, onclick: () => updateAccess(person, !person.puid ? 'cancel' : person.status === 'banned' ? 'unban' : 'ban') }));
    }
    return el('tr', { class: 'person-row' },
      el('td', {}, el('div', { class: 'person-cell' }, el('span', { class: 'avatar', 'aria-hidden': true, text: person.displayName.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase() }),
        el('div', {}, el('button', { class: 'person-name', type: 'button', text: person.displayName, onclick: () => inspect(person) }), el('small', { text: person.email ?? 'Awaiting first CWL sign-in' })))),
      el('td', {}, el('button', { class: 'role-edit', type: 'button', disabled: !result?.canManage || person.protected || ['banned', 'deactivated'].includes(person.status),
        'aria-label': `Change role for ${person.displayName}`, text: person.owner ? 'Owner' : ROLE_LABELS[person.role], onclick: () => editRole(person) })),
      el('td', {}, el('code', { text: person.cwl ?? '—' }), el('small', { text: person.puid ?? 'Awaiting identity' })),
      el('td', {}, el('span', { class: `status-badge ${person.status}`, text: STATUS[person.status] })),
      el('td', { class: 'people-source' }, person.sources.join(' · '), el('small', { text: person.addedAt ? `Added ${date(person.addedAt)}` : '' })),
      el('td', { class: 'time-cell' }, date(person.lastLoginAt)), el('td', {}, actions));
  }
  async function load(): Promise<void> {
    if (disposed || tab === 'codes') return;
    const version = ++generation; refresh.disabled = true; prev.disabled = true; next.disabled = true; error.textContent = '';
    tableSlot.setAttribute('aria-busy', 'true');
    tableSlot.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
    if (!result) tableSlot.replaceChildren(el('div', { class: 'directory-skeleton', role: 'status', text: 'Loading course people…' }));
    try {
      const data = await getCoursePeople(courseId, { tab, page, pageSize: size.value, ...(search.value.trim() ? { search: search.value.trim() } : {}), ...(role.value ? { role: role.value } : {}), ...(status.value ? { status: status.value } : {}) });
      if (disposed || version !== generation) return;
      result = data; page = data.page; invite.disabled = !data.canManage; importButton.disabled = !data.canManage;
      meta.replaceChildren(el('span', { text: `${data.course.code}${data.course.section ? ` · Section ${data.course.section}` : ''} · ${data.course.term}` }),
        el('span', { class: 'badge-soft', text: data.canManage ? 'Owner / Admin · Manage access' : 'Instructor · View only' }));
      tabButtons[0].textContent = `People (${data.counts.people})`; tabButtons[1].textContent = `Invitations (${data.counts.invitations})`;
      tableSlot.replaceChildren(data.people.length ? el('table', { class: 'people-table', 'aria-label': tab === 'invitations' ? 'Course invitations' : 'Course people' },
        el('thead', {}, el('tr', {}, ...['Person', 'Course role', 'CWL / Login ID', 'Status', 'Access source', 'Last CWL login', 'Actions'].map(text => el('th', { scope: 'col', text })))),
        el('tbody', {}, ...data.people.map(row))) : el('div', { class: 'empty' }, el('h2', { text: tab === 'invitations' ? 'No pending invitations' : 'No matching people' }), el('p', { text: 'Change the filters or invite a person.' })));
      pageLabel.textContent = `${data.total ? (page - 1) * data.pageSize + 1 : 0}–${Math.min(page * data.pageSize, data.total)} of ${data.total} · Page ${page} of ${data.pageCount}`;
    } catch (failure) { if (!disposed && version === generation) error.textContent = `${(failure as Error).message} Use Refresh to try again.`; }
    finally { if (!disposed && version === generation) { refresh.disabled = false; prev.disabled = page <= 1; next.disabled = page >= (result?.pageCount ?? 1); tableSlot.setAttribute('aria-busy', 'false'); } }
  }
  async function editRole(person: CoursePerson): Promise<void> {
    if (mutation || !result?.canManage) return;
    const modal = peopleDialog(`Change role · ${person.displayName}`);
    const picker = rolePicker(person); const errors = el('p', { class: 'dialog-error', role: 'alert' });
    modal.dialog.append(el('p', { class: 'dialog-lead', text: 'This course role overrides CSV, Canvas and previous invitations. Other courses are unchanged.' }),
      el('form', { onsubmit: async (event: Event) => {
        event.preventDefault(); if (mutation) return;
        mutation = true; modal.busy(true); errors.textContent = '';
        try { await changeCoursePerson(courseId, person, { action: 'role', role: picker.role(), ...(picker.role() === 'ta' ? { permissions: picker.permissions() } : {}) });
          modal.dialog.close(); notice.textContent = 'Course role saved.'; await load(); }
        catch (failure) { errors.textContent = (failure as Error).message; }
        finally { mutation = false; modal.busy(false); }
      } }, picker.element, errors, el('div', { class: 'dialog-actions' }, el('button', { class: 'btn btn--instr-primary', type: 'submit', text: 'Save role' })))); modal.show();
  }
  async function updateAccess(person: CoursePerson, action: 'ban' | 'unban' | 'cancel'): Promise<void> {
    if (mutation || !result?.canManage) return;
    const label = action === 'ban' ? 'Ban from course' : action === 'unban' ? 'Unban person' : 'Cancel invitation';
    const message = action === 'ban' ? `${person.displayName} will lose all access to this course on their next request. Their learning records are retained. Re-importing the class will not restore access.`
      : action === 'unban' ? `${person.displayName} will regain their ${ROLE_LABELS[person.role]} role, subject to the course’s publication and term dates.` : `Cancel the saved invitation for ${person.email}?`;
    if (!await confirmDialog({ title: `${label}?`, message, confirmLabel: label, tone: action === 'unban' ? undefined : 'danger' })) return;
    mutation = true;
    try { await changeCoursePerson(courseId, person, { action }); notice.textContent = `${label} saved.`; await load(); }
    catch (failure) { error.textContent = (failure as Error).message; }
    finally { mutation = false; }
  }
  function inspect(person: CoursePerson): void {
    const modal = peopleDialog(person.displayName, true);
    const dl = el('dl', { class: 'profile-details' });
    for (const [label, value] of Object.entries({ 'UBC email': person.email, 'CWL': person.cwl, 'Login ID': person.puid, 'Course role': person.owner ? 'Owner' : ROLE_LABELS[person.role], Status: STATUS[person.status], 'Access source': person.sources.join(' · '), Added: date(person.addedAt), 'Last CWL sign-in': date(person.lastLoginAt), ...(person.banReason ? { 'Ban reason': person.banReason } : {}) })) {
      dl.append(el('dt', { text: label }), el('dd', { text: value ?? '—' }));
    }
    modal.dialog.append(el('p', { class: 'dialog-lead', text: 'Identity and access for this course.' }), dl,
      el('p', { class: 'field-note', text: 'Last CWL sign-in records a login event; it does not indicate online presence.' }));
    if (person.role === 'ta') modal.dialog.append(el('h3', { text: 'TA permissions' }), el('ul', { class: 'field-note' },
      ...Object.entries(person.permissions).map(([key, value]) => el('li', { text: `${key}: ${value ? 'Allowed' : 'Disabled'}` }))),
      el('p', { class: 'locked-note', text: 'Approval and final flag resolution remain disabled. Course/Admin overrides can further configure capabilities.' }));
    if (result?.canManage && !person.protected && !['banned', 'deactivated'].includes(person.status)) modal.dialog.append(el('div', { class: 'dialog-actions' },
      el('button', { class: 'btn btn--secondary', type: 'button', text: 'Change role', onclick: () => { modal.dialog.close(); return editRole(person); } })));
    modal.show();
  }
  const filtered = () => { page = 1; void load(); };
  search.addEventListener('input', () => { clearTimeout(timer); generation++;
    tableSlot.setAttribute('aria-busy', 'true');
    tableSlot.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
    timer = setTimeout(filtered, 250);
  });
  [role, status, size].forEach(input => input.addEventListener('change', filtered));
  const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === courseId) void load(); };
  const cleanup = () => { disposed = true; generation++; clearTimeout(timer); window.removeEventListener('course-people-changed', changed); window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('course-people-changed', changed); window.addEventListener('hashchange', cleanup);
  root.append(el('header', { class: 'people-heading' }, el('div', {}, el('h1', { text: 'People' }), el('p', { text: 'Manage your class and teaching team in one place.' })), el('div', { class: 'heading-actions' }, importButton, invite)), meta,
    el('section', { class: 'people-panel' }, tabs, notice, error, body),
    el('div', { class: 'people-footnote' }, el('span', { text: 'Student access requires a published course within its term dates. Only the Owner/Admin can change people.' }),
      el('span', { text: 'Last CWL login is not online presence.' })));
  mount(outlet, root); renderDirectory(); void load();
}
