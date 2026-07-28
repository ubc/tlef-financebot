import {
  ApiError,
  grantPlatformInstructor,
  listAdminAccounts,
  revokePlatformInstructor,
  type AdminAccount,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { emptyState, errorState, loadingState } from '../../ui.js';

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : (error as Error).message;
}

function accountCard(
  account: AdminAccount,
  onGrant: (account: AdminAccount, button: HTMLButtonElement) => void,
  onRevoke: (account: AdminAccount, button: HTMLButtonElement) => void,
): HTMLElement {
  const actionButton = el(
    'button',
    {
      class: account.platformInstructor ? 'btn btn--ghost btn--sm' : 'btn btn--instr-primary btn--sm',
      type: 'button',
    },
    account.platformInstructor ? 'Revoke Instructor' : 'Grant Instructor',
  ) as HTMLButtonElement;
  actionButton.onclick = () =>
    account.platformInstructor
      ? onRevoke(account, actionButton)
      : onGrant(account, actionButton);

  return el(
    'article',
    { class: 'card' },
    el(
      'div',
      { class: 'card__head' },
      el('h3', { class: 'card__title', text: account.displayName || account.puid }),
      el(
        'div',
        { class: 'row' },
        account.isAdmin ? statusBadge('Admin', 'approved') : false,
        account.platformInstructor ? statusBadge('Instructor', 'approved') : false,
        account.status === 'pending' ? statusBadge('Pending first login', 'pending') : false,
      ),
    ),
    el(
      'div',
      { class: 'card__body stack' },
      el('p', { class: 'mono', text: `PUID: ${account.puid}` }),
      account.uid
        ? el('p', { class: 'mono', text: `CWL: ${account.uid}` })
        : el('p', { class: 'muted', text: 'CWL username was not released by SAML.' }),
      account.email ? el('p', { text: account.email }) : false,
      account.affiliations.length
        ? el('p', { class: 'muted', text: `Affiliations: ${account.affiliations.join(', ')}` })
        : false,
      account.lastLoginAt
        ? el('p', {
            class: 'muted',
            text: `Last login: ${new Date(account.lastLoginAt).toLocaleString()}`,
          })
        : el('p', {
            class: 'muted',
            text: 'This PUID is pre-provisioned and will attach on first login.',
          }),
      el('div', { class: 'row' }, actionButton),
    ),
  );
}

async function renderAccountsInner(outlet: HTMLElement): Promise<void> {
  const listSlot = el('div', {}, loadingState('Loading users…'));
  const feedbackSlot = el('div', { 'aria-live': 'polite' });
  const searchInput = el('input', {
    class: 'input',
    type: 'search',
    id: 'admin-user-search',
    placeholder: 'Search by PUID, name, email, or CWL',
  }) as HTMLInputElement;
  const puidInput = el('input', {
    class: 'input',
    type: 'text',
    id: 'admin-instructor-puid',
    autocomplete: 'off',
    required: 'required',
    placeholder: 'e.g. ESI5CZY7J307',
    pattern: '[A-Za-z0-9._-]+',
  }) as HTMLInputElement;
  const grantButton = el(
    'button',
    { class: 'btn btn--instr-primary', type: 'submit' },
    'Add as Instructor',
  ) as HTMLButtonElement;

  const load = async (): Promise<void> => {
    listSlot.replaceChildren(loadingState('Loading users…'));
    try {
      const accounts = await listAdminAccounts(searchInput.value);
      listSlot.replaceChildren(
        accounts.length
          ? el(
              'div',
              { class: 'stack' },
              ...accounts.map((account) =>
                accountCard(
                  account,
                  (item, button) => void grantExisting(item, button),
                  (item, button) => void revoke(item, button),
                ),
              ),
            )
          : emptyState('No users or pending Instructor grants match this search.'),
      );
    } catch (error) {
      listSlot.replaceChildren(errorState(errorMessage(error), () => void load()));
    }
  };

  const grantPuid = async (puid: string, button: HTMLButtonElement): Promise<void> => {
    button.disabled = true;
    feedbackSlot.replaceChildren();
    try {
      const account = await grantPlatformInstructor(puid);
      feedbackSlot.replaceChildren(
        el('p', {
          role: 'status',
          text:
            account.status === 'active'
              ? `Instructor access granted to ${account.displayName}.`
              : `Grant saved for ${account.puid}; it will activate on first login.`,
        }),
      );
      await load();
    } catch (error) {
      button.disabled = false;
      feedbackSlot.replaceChildren(errorState(errorMessage(error)));
    }
  };

  const grantExisting = async (
    account: AdminAccount,
    button: HTMLButtonElement,
  ): Promise<void> => {
    await grantPuid(account.puid, button);
  };

  const revoke = async (
    account: AdminAccount,
    button: HTMLButtonElement,
  ): Promise<void> => {
    if (!window.confirm(`Revoke platform-Instructor access for ${account.displayName}?`)) return;
    button.disabled = true;
    feedbackSlot.replaceChildren();
    try {
      await revokePlatformInstructor(account.puid);
      feedbackSlot.replaceChildren(
        el('p', { role: 'status', text: `Instructor access revoked for ${account.displayName}.` }),
      );
      await load();
    } catch (error) {
      button.disabled = false;
      feedbackSlot.replaceChildren(errorState(errorMessage(error)));
    }
  };

  const grantNew = async (event: Event): Promise<void> => {
    event.preventDefault();
    const puid = puidInput.value.trim();
    if (!puid) return;
    await grantPuid(puid, grantButton);
    if (!grantButton.disabled) return;
    puidInput.value = '';
    grantButton.disabled = false;
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
        'User Accounts',
        'View every user who has logged in and grant or revoke global Instructor access by PUID.',
      ),
      el(
        'form',
        {
          class: 'card admin-account-create',
          onsubmit: (event: Event) => void grantNew(event),
        },
        el(
          'div',
          { class: 'card__head' },
          el('h2', { class: 'card__title', text: 'Add professor' }),
        ),
        el(
          'div',
          { class: 'card__body admin-account-create__body' },
          el(
            'label',
            { class: 'form-field' },
            el('span', { class: 'form-field__label', text: 'UBC PUID' }),
            puidInput,
          ),
          el('p', {
            class: 'muted admin-account-create__help',
            text: 'If the user has not logged in yet, the grant remains pending until that PUID signs in.',
          }),
          el('div', { class: 'row admin-account-create__actions' }, grantButton),
        ),
      ),
      feedbackSlot,
      el(
        'form',
        { class: 'admin-account-search', onsubmit: search },
        el(
          'label',
          { class: 'form-field' },
          el('span', { class: 'form-field__label', text: 'Search users' }),
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
