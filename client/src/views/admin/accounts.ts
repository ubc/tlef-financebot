import {
  ApiError,
  grantPlatformInstructor,
  listPlatformInstructors,
  revokePlatformInstructor,
  type PlatformInstructorAccount,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { emptyState, errorState, loadingState } from '../../ui.js';

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : (error as Error).message;
}

function accountCard(
  account: PlatformInstructorAccount,
  onRevoke: (account: PlatformInstructorAccount, button: HTMLButtonElement) => void,
): HTMLElement {
  const revokeButton = el(
    'button',
    {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      onclick: () => onRevoke(account, revokeButton),
    },
    'Revoke Instructor',
  ) as HTMLButtonElement;

  return el(
    'article',
    { class: 'card' },
    el(
      'div',
      { class: 'card__head' },
      el('h3', { class: 'card__title', text: account.user?.displayName || account.uid }),
      statusBadge(
        account.status === 'active' ? 'Active' : 'Pending first login',
        account.status === 'active' ? 'approved' : 'pending',
      ),
    ),
    el(
      'div',
      { class: 'card__body stack' },
      el('p', { class: 'mono', text: `CWL: ${account.uid}` }),
      account.user?.email
        ? el('p', { text: account.user.email })
        : el('p', { text: 'The grant will attach to the real account on first CWL login.' }),
      el('p', {
        class: 'muted',
        text: `Granted ${new Date(account.grantedAt).toLocaleString()}`,
      }),
      el('div', { class: 'row' }, revokeButton),
    ),
  );
}

async function renderAccountsInner(outlet: HTMLElement): Promise<void> {
  const listSlot = el('div', {}, loadingState('Loading Instructor accounts…'));
  const feedbackSlot = el('div', { 'aria-live': 'polite' });
  const searchInput = el('input', {
    class: 'input',
    type: 'search',
    id: 'admin-instructor-search',
    placeholder: 'Search granted CWL usernames',
  }) as HTMLInputElement;
  const uidInput = el('input', {
    class: 'input',
    type: 'text',
    id: 'admin-instructor-cwl',
    autocomplete: 'off',
    required: 'required',
    placeholder: 'e.g. financeprof',
  }) as HTMLInputElement;
  const grantButton = el(
    'button',
    { class: 'btn btn--instr-primary', type: 'submit' },
    'Grant Instructor',
  ) as HTMLButtonElement;

  const load = async (): Promise<void> => {
    listSlot.replaceChildren(loadingState('Loading Instructor accounts…'));
    try {
      const accounts = await listPlatformInstructors(searchInput.value);
      listSlot.replaceChildren(
        accounts.length
          ? el(
              'div',
              { class: 'stack' },
              ...accounts.map((account) => accountCard(account, (item, button) => void revoke(item, button))),
            )
          : emptyState('No platform-Instructor grants match this search.'),
      );
    } catch (error) {
      listSlot.replaceChildren(errorState(errorMessage(error), () => void load()));
    }
  };

  const revoke = async (
    account: PlatformInstructorAccount,
    button: HTMLButtonElement,
  ): Promise<void> => {
    if (!window.confirm(`Revoke platform-Instructor access for ${account.uid}?`)) return;
    button.disabled = true;
    feedbackSlot.replaceChildren();
    try {
      await revokePlatformInstructor(account.uid);
      feedbackSlot.replaceChildren(
        el('p', { role: 'status', text: `Instructor access revoked for ${account.uid}.` }),
      );
      await load();
    } catch (error) {
      button.disabled = false;
      feedbackSlot.replaceChildren(errorState(errorMessage(error)));
    }
  };

  const grant = async (event: Event): Promise<void> => {
    event.preventDefault();
    const uid = uidInput.value.trim();
    if (!uid) return;
    grantButton.disabled = true;
    feedbackSlot.replaceChildren();
    try {
      const account = await grantPlatformInstructor(uid);
      uidInput.value = '';
      feedbackSlot.replaceChildren(
        el('p', {
          role: 'status',
          text: account.status === 'active'
            ? `Instructor access granted to ${account.uid}.`
            : `Grant saved for ${account.uid}; it will activate on first CWL login.`,
        }),
      );
      await load();
    } catch (error) {
      feedbackSlot.replaceChildren(errorState(errorMessage(error)));
    } finally {
      grantButton.disabled = false;
    }
  };

  const search = (event: Event): void => {
    event.preventDefault();
    void load();
  };

  mount(
    outlet,
    el(
      'div',
      { class: 'view' },
      pageHeader(
        'Instructor Accounts',
        'Grant explicit FinanceBot Instructor access by CWL username. Faculty affiliation alone does not grant access.',
      ),
      el(
        'form',
        { class: 'card form stack', onsubmit: (event: Event) => void grant(event) },
        el(
          'div',
          { class: 'card__head' },
          el('h2', { class: 'card__title', text: 'Add professor' }),
        ),
        el(
          'label',
          { class: 'form-field' },
          el('span', { class: 'form-field__label', text: 'CWL username' }),
          uidInput,
        ),
        el('div', { class: 'row' }, grantButton),
      ),
      feedbackSlot,
      el(
        'form',
        { class: 'row', onsubmit: search },
        el(
          'label',
          { class: 'form-field' },
          el('span', { class: 'form-field__label', text: 'Search grants' }),
          searchInput,
        ),
        el('button', { class: 'btn btn--ghost', type: 'submit' }, 'Search'),
      ),
      listSlot,
    ),
  );

  await load();
}

export function renderAdminAccounts(outlet: HTMLElement, _params: RouteParams): void {
  void renderAccountsInner(outlet);
}
