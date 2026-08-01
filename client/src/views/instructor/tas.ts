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

async function renderTasInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading teaching assistants…'));
  mount(outlet, el('div', { class: 'view' }, body));

  let tas: TaInvite[];
  try {
    tas = await listTas(courseId);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderTasInner(outlet, courseId)));
    return;
  }

  const email = el('input', {
    class: 'input',
    type: 'email',
    placeholder: 'name@ubc.ca',
    'aria-label': 'TA UBC email',
  }) as HTMLInputElement;
  const inviteStatus = el('span', { 'aria-live': 'polite' });
  const inviteButton = el('button', {
    class: 'btn btn--primary',
    type: 'button',
    text: 'Invite TA',
    onclick: async () => {
      inviteButton.setAttribute('disabled', '');
      try {
        await inviteTa(courseId, email.value);
        await renderTasInner(outlet, courseId);
      } catch (error) {
        inviteStatus.textContent = error instanceof ApiError ? error.message : (error as Error).message;
        inviteButton.removeAttribute('disabled');
      }
    },
  });

  function card(ta: TaInvite): HTMLElement {
    const permissionStatus = el('span', { 'aria-live': 'polite' });
    const checks = new Map<Capability, HTMLInputElement>();
    const controls = EDITABLE.map(({ capability, label }) => {
      const checkbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
      checkbox.checked = ta.permissions?.[capability] ?? STANDARD_TA.includes(capability);
      checkbox.disabled = ta.status !== 'active';
      checks.set(capability, checkbox);
      return el('label', { class: 'checkbox-row' }, checkbox, el('span', { text: label }));
    });
    const save = el('button', {
      class: 'btn btn--secondary btn--sm',
      type: 'button',
      text: 'Save permissions',
      disabled: ta.status !== 'active' ? 'true' : undefined,
      onclick: async () => {
        if (!ta.activatedPuid) return;
        save.setAttribute('disabled', '');
        try {
          await updateTaPermissions(
            courseId,
            ta.activatedPuid,
            Object.fromEntries([...checks].map(([capability, input]) => [capability, input.checked])),
          );
          permissionStatus.textContent = 'Saved.';
        } catch (error) {
          permissionStatus.textContent = error instanceof ApiError ? error.message : (error as Error).message;
        } finally {
          save.removeAttribute('disabled');
        }
      },
    });
    const reinvite = ta.status === 'expired' && ta.activatedPuid
      ? el('button', {
          class: 'btn btn--secondary btn--sm',
          type: 'button',
          text: 'Re-invite',
          onclick: async () => {
            await reinviteTa(courseId, ta.activatedPuid!);
            await renderTasInner(outlet, courseId);
          },
        })
      : false;
    return el(
      'article',
      { class: 'card stack' },
      el('div', { class: 'cluster' },
        el('strong', { text: ta.displayName || ta.email }),
        el('span', { class: 'badge', text: ta.status }),
      ),
      ta.displayName ? el('span', { class: 'muted', text: ta.email }) : false,
      el('div', { class: 'stack stack--sm' }, ...controls),
      el('p', { class: 'muted', text: 'Approve questions and resolve flags are locked off for every TA.' }),
      el('div', { class: 'cluster' }, save, reinvite, permissionStatus),
    );
  }

  body.replaceChildren(
    pageHeader('Teaching Assistants', 'Invite UBC accounts and grant course-scoped permissions.'),
    el('section', { class: 'card stack' },
      el('h2', { text: 'Invite a TA' }),
      el('div', { class: 'cluster' }, email, inviteButton, inviteStatus),
    ),
    el('section', { class: 'stack' },
      el('h2', { text: 'Course TAs' }),
      ...(tas.length ? tas.map(card) : [el('p', { class: 'muted', text: 'No teaching assistants yet.' })]),
    ),
  );
}

export function renderTas(outlet: HTMLElement, params: RouteParams): void {
  void renderTasInner(outlet, params.id);
}
