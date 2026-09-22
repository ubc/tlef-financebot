import {
  ApiError,
  inviteTa,
  listTas,
  reinviteTa,
  updateTaPermissions,
  type Capability,
  type TaInvite,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';
import { attachTutorial } from '../../tutorials.js';

const STANDARD_TA: Capability[] = [
  'question.review',
  'question.suggest-edit',
  'question.mark-reviewed',
  'flag.triage',
  'analytics.view',
];

const EDITABLE: Array<{ capability: Capability; label: string }> = [
  { capability: 'question.review', label: 'Review questions' },
  { capability: 'question.suggest-edit', label: 'Suggest edits' },
  { capability: 'question.mark-reviewed', label: 'Mark reviewed' },
  { capability: 'flag.triage', label: 'Triage flags' },
  { capability: 'analytics.view', label: 'View analytics' },
];

/** Course-scoped controls; the server remains authoritative for every permission. */
async function renderTasInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading teaching assistants…'));
  const root = el('div', { class: 'view admin-workbench ta-workbench' }, body);
  mount(outlet, root);
  let tas: TaInvite[];
  try { tas = await listTas(courseId); }
  catch (error) { body.replaceChildren(errorState((error as Error).message, () => void renderTasInner(outlet, courseId))); return; }
  const notice = el('p', { class: 'admin-notice', role: 'status' });
  const list = el('div');
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search name or email', 'aria-label': 'Search teaching assistants' }) as HTMLInputElement;

  function openEditor(ta?: TaInvite): void {
    let busy = false;
    const dialog = el('dialog', { class: 'app-dialog admin-editor', 'aria-labelledby': 'ta-editor-title' }) as HTMLDialogElement;
    const errorSlot = el('div', { role: 'alert' });
    const email = el('input', { class: 'input', type: 'email', required: true, placeholder: 'name@ubc.ca', 'aria-label': 'TA UBC email' }) as HTMLInputElement;
    const checks = new Map<Capability, HTMLInputElement>();
    const active = ta?.status === 'active';
    const reinvite = ta?.status === 'expired' && Boolean(ta.activatedPuid);
    const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Close', onclick: () => { if (!busy) dialog.close(); } }) as HTMLButtonElement;
    const save = el('button', { class: 'btn btn--instr-primary', type: 'submit', text: !ta ? 'Invite TA' : active ? 'Save permissions' : 'Re-invite' }) as HTMLButtonElement;
    const form = el('form', { class: 'app-dialog__surface' },
      el('h2', { id: 'ta-editor-title', text: ta ? ta.displayName || ta.email : 'Invite a teaching assistant' }),
      el('p', { class: 'muted', text: ta ? `${ta.email} · ${ta.status}` : 'Use the email associated with their UBC account. Access activates after CWL sign-in.' }),
      !ta ? el('label', { class: 'form-field' }, el('span', { text: 'UBC email' }), email) : false,
      ...(active ? EDITABLE.map(({ capability, label }) => {
        const check = el('input', { type: 'checkbox', checked: ta?.permissions?.[capability] ?? STANDARD_TA.includes(capability) }) as HTMLInputElement;
        checks.set(capability, check);
        return el('label', { class: 'admin-check' }, check, el('span', { text: label }));
      }) : []),
      ta?.status === 'pending' ? el('p', { text: 'Waiting for this account to sign in with CWL.' }) : false,
      el('p', { class: 'admin-fine', text: 'Question approval and final flag resolution remain instructor-only.' }), errorSlot,
      el('div', { class: 'app-dialog__actions' }, cancel, !ta || active || reinvite ? save : false));
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      busy = true; save.disabled = true; cancel.disabled = true; save.setAttribute('aria-busy', 'true'); errorSlot.replaceChildren();
      try {
        if (!ta) await inviteTa(courseId, email.value.trim());
        else if (reinvite && ta.activatedPuid) await reinviteTa(courseId, ta.activatedPuid);
        else if (active && ta.activatedPuid) {
          await updateTaPermissions(courseId, ta.activatedPuid, Object.fromEntries([...checks].map(([key, input]) => [key, input.checked])));
        } else throw new Error('This account is not active. Refresh the page and try again.');
        notice.textContent = !ta ? 'Invitation created. Waiting for CWL sign-in.' : reinvite ? 'Teaching assistant re-invited.' : 'Permissions saved.';
        busy = false; dialog.close();
        try { tas = await listTas(courseId); renderList(); }
        catch { notice.textContent += ' Refresh this page to load the updated team.'; }
      } catch (error) { errorSlot.textContent = error instanceof ApiError ? error.message : (error as Error).message; }
      finally { busy = false; save.disabled = false; cancel.disabled = false; save.removeAttribute('aria-busy'); }
    });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.append(form); document.body.append(dialog); dialog.showModal();
  }
  const invite = (): HTMLButtonElement => el('button', { class: 'btn btn--instr-primary', type: 'button', text: 'Invite a TA', onclick: () => openEditor() }) as HTMLButtonElement;
  function renderList(): void {
    const term = search.value.trim().toLowerCase();
    const visible = tas.filter(ta => `${ta.displayName ?? ''} ${ta.email}`.toLowerCase().includes(term));
    if (!tas.length) {
      list.replaceChildren(el('div', { class: 'admin-empty' }, el('div', { class: 'admin-empty-mark', text: '◇', 'aria-hidden': 'true' }),
        el('h2', { text: 'Build your teaching team' }), el('p', { text: 'Invite a UBC account to help review questions, suggest edits and triage student feedback.' }), invite())); return;
    }
    list.replaceChildren(...visible.map(ta => el('div', { class: 'admin-member' },
      el('span', { class: 'admin-avatar', 'aria-hidden': 'true', text: (ta.displayName || ta.email).split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase() }),
      el('div', { class: 'admin-member-copy' }, el('strong', { text: ta.displayName || ta.email }), el('small', { text: ta.email })),
      el('span', { class: `admin-status admin-status--${ta.status}`, text: ta.status }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: ta.status === 'active' ? 'Permissions' : ta.status === 'expired' ? 'Re-invite' : 'View invitation', onclick: () => openEditor(ta) }))),
      ...(!visible.length ? [el('div', { class: 'admin-empty' }, el('h2', { text: 'No matching team members' }), el('p', { text: 'Try another name or email.' }), el('button', { class: 'btn btn--ghost', text: 'Clear search', onclick: () => { search.value = ''; renderList(); search.focus(); } }))] : []));
  }
  search.addEventListener('input', renderList);
  body.replaceChildren(el('div', { class: 'admin-heading' }, pageHeader('Teaching Assistants', 'A clear view of who can help, and what they can do.'), invite()), notice,
    el('div', { class: 'admin-split' }, el('section', { class: 'admin-panel admin-pane' }, el('div', { class: 'admin-subhead' }, el('h2', { text: 'Course team' }), el('small', { text: 'Access ends with the course term' })), search, list),
      el('aside', { class: 'admin-aside' }, el('small', { class: 'admin-eyebrow', text: 'Shared work, clear ownership' }), el('h2', { text: 'Support your team. Keep final decisions.' }), el('p', { text: 'TAs can review and suggest changes within their assigned permissions.' }),
        el('p', { text: 'Approve questions · Instructor only' }), el('p', { text: 'Resolve flags · Instructor only' }), el('p', { text: 'Invitations activate when the matching UBC account signs in with CWL.' }))));
  renderList();
  attachTutorial(root, 'instructor-tas', {
    'ta-team': '.admin-pane',
    'ta-boundaries': '.admin-aside',
  });
}
export function renderTas(outlet: HTMLElement, params: RouteParams): void { void renderTasInner(outlet, params.id); }
