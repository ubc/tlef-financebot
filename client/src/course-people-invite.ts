import { el } from './dom.js';
import { getCoursePeople, inviteCoursePerson, type CoursePerson, type PeopleRole } from './course-people-api.js';
import type { Capability } from './api.js';

export const ROLE_LABELS = { student: 'Student', ta: 'TA', instructor: 'Instructor' };
let instance = 0;
export function peopleDialog(title: string, inspector = false) {
  const previousFocus = document.activeElement;
  const id = `people-dialog-${++instance}`;
  const dialog = el('dialog', { class: inspector ? 'people-inspector' : 'people-dialog', 'aria-labelledby': id });
  const close = el('button', { class: 'dialog-close', type: 'button', text: '×', 'aria-label': 'Close dialog', onclick: () => { if (!dialog.hasAttribute('data-busy')) dialog.close(); } });
  dialog.append(close, el('h2', { id, text: title }));
  const priorDisabled = new WeakMap<HTMLElement, boolean>();
  const routeChanged = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (dialog.hasAttribute('data-busy')) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    window.removeEventListener('hashchange', routeChanged); dialog.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }, { once: true });
  window.addEventListener('hashchange', routeChanged);
  return { dialog, show: () => { document.body.append(dialog); dialog.showModal(); }, busy: (value: boolean) => {
    dialog.toggleAttribute('data-busy', value);
    dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button').forEach(n => {
      if (value) { if (!priorDisabled.has(n)) priorDisabled.set(n, n.disabled); n.disabled = true; }
      else { n.disabled = priorDisabled.get(n) ?? n.disabled; priorDisabled.delete(n); }
    });
    close.disabled = value;
  } };
}

export function rolePicker(person?: CoursePerson) {
  const id = `people-role-${++instance}`;
  const field = el('fieldset', { class: 'dialog-field' }, el('legend', { text: 'Course role' }));
  const options = el('div', { class: 'role-options' });
  const radios = (Object.keys(ROLE_LABELS) as PeopleRole[]).map(role => {
    const input = el('input', { type: 'radio', name: id, value: role, checked: (person?.role ?? 'student') === role });
    options.append(el('label', { class: 'role-option' }, input, ROLE_LABELS[role])); return input;
  });
  const description = el('p', { class: 'role-description' });
  const permissions = el('div', { class: 'permission-list' });
  const groups: Array<{ label: string; keys: Capability[] }> = [
    { label: 'Review questions and triage flags', keys: ['question.review', 'question.mark-reviewed', 'flag.triage'] },
    { label: 'Suggest question edits', keys: ['question.suggest-edit'] },
    { label: 'View student analytics and profiles', keys: ['analytics.view', 'analytics.individual'] },
  ];
  const checks = groups.map(group => {
    const input = el('input', { type: 'checkbox', checked: group.keys.every(k => person?.permissions[k] ?? true) });
    permissions.append(el('label', {}, input, group.label)); return { input, keys: group.keys };
  });
  permissions.append(el('p', { class: 'locked-note', text: 'TAs cannot approve questions or finally resolve flags.' }));
  function update(): void {
    const role = radios.find(r => r.checked)!.value as PeopleRole;
    permissions.hidden = role !== 'ta';
    description.textContent = role === 'student' ? 'Practice released questions once the course is published and open.' : role === 'ta' ? 'Help review questions and support students within these permissions.' : 'Author content, approve questions and manage course settings. People management remains with the Owner/Admin.';
  }
  radios.forEach(r => r.addEventListener('change', update)); update();
  field.append(options, description, permissions);
  return { element: field, role: () => radios.find(r => r.checked)!.value as PeopleRole,
    permissions: () => Object.fromEntries(checks.flatMap(c => c.keys.map(k => [k, c.input.checked]))) as Partial<Record<Capability, boolean>> };
}

/** Both People and the topbar Share action use this exact invitation flow. */
export async function openPeopleInvitation(courseId: string, sharing = false): Promise<void> {
  const modal = peopleDialog(sharing ? 'Share course' : 'Invite person');
  const root = el('div', {}, el('p', { class: 'dialog-lead', text: 'Loading course access…' }));
  modal.dialog.append(root); modal.show();
  try {
    const data = await getCoursePeople(courseId);
    if (!modal.dialog.isConnected) return;
    root.replaceChildren(el('p', { class: 'dialog-lead', text: `${data.course.code} · ${data.course.name}` }));
    if (data.canManage) {
      const id = `people-identity-${++instance}`;
      const input = el('input', { class: 'input', id, required: true, maxlength: 254, autocomplete: 'off', placeholder: 'name@ubc.ca or CWL' });
      const picker = rolePicker();
      const error = el('p', { class: 'dialog-error', role: 'alert' });
      const success = el('p', { class: 'inline-feedback', role: 'status' });
      const submit = el('button', { class: 'btn btn--instr-primary', type: 'submit', text: 'Save invitation' });
      const form = el('form', { onsubmit: async (event: Event) => {
        event.preventDefault(); if (modal.dialog.hasAttribute('data-busy')) return;
        error.textContent = ''; success.textContent = ''; modal.busy(true);
        try {
          const result = await inviteCoursePerson(courseId, input.value.trim(), picker.role(), picker.permissions());
          input.value = '';
          success.textContent = result.status === 'pending' ? 'Invitation saved. Access starts at the matching account’s first CWL sign-in.' : 'Course access saved. It takes effect on their next request.';
          window.dispatchEvent(new CustomEvent('course-people-changed', { detail: courseId }));
        } catch (failure) { error.textContent = (failure as Error).message; }
        finally { modal.busy(false); input.focus(); }
      } }, el('div', { class: 'dialog-field' }, el('label', { for: id, text: 'UBC email or CWL' }), input,
        el('p', { class: 'field-note', text: 'Email can invite someone before first sign-in. CWL must match an existing account. No email is sent.' })), picker.element, error, success,
        el('div', { class: 'dialog-actions' }, submit));
      root.append(form); input.focus();
    } else root.append(el('p', { class: 'notice-box', text: 'Only the course owner or an Admin can invite people and change access.' }));
    if (sharing) {
      const link = el('input', { class: 'input', readonly: true, 'aria-label': 'Restricted course link', value: `${location.origin}/#/instructor/course/${encodeURIComponent(courseId)}?workspace=instructor` });
      const feedback = el('p', { role: 'status', class: 'field-note' });
      root.append(el('section', { class: 'sharing-link-section' }, el('h3', { text: 'Restricted course link' }),
        el('p', { class: 'field-note', text: 'Only people with existing course access can open this link.' }),
        el('div', { class: 'course-sharing__link-row' }, link, el('button', { class: 'btn btn--secondary', type: 'button', text: 'Copy link', onclick: async () => {
          try { await navigator.clipboard.writeText(link.value); feedback.textContent = 'Course link copied.'; }
          catch { link.select(); feedback.textContent = 'Select the link and copy it manually.'; }
        } })), feedback, el('a', { class: 'text-link', href: `#/instructor/course/${courseId}/people`, text: 'Manage all people' })));
    }
  } catch (failure) { root.replaceChildren(el('p', { role: 'alert', class: 'dialog-error', text: (failure as Error).message })); }
}
