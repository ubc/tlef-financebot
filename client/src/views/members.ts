// The members-only area — the reference example of a GATED feature. It reads
// GET /api/members/overview, which is protected by ensureApiAuthenticated() on
// the server. The nav item is only shown while signed in (UX), but the real
// enforcement is server-side: a signed-out caller gets 401 (which drops the app
// back to the landing screen via the api.ts unauthorized handler).
import { getMembersOverview, type MembersOverview } from '../api.js';
import { el } from '../dom.js';
import { eyebrow, badge, loadingState, errorState } from '../ui.js';

function renderOverview(data: MembersOverview): HTMLElement {
  const signedInAt = new Date(data.serverTime).toLocaleString();
  const affiliations = data.affiliations.length ? data.affiliations.join(', ') : '—';
  return el(
    'div',
    {},
    el('p', { class: 'members__welcome', text: data.message }),
    el(
      'div',
      { class: 'kv-list' },
      el('div', { class: 'kv' }, el('span', { class: 'kv__key', text: 'Name' }), el('span', { text: data.displayName })),
      el('div', { class: 'kv' }, el('span', { class: 'kv__key', text: 'CWL PUID' }), el('span', { class: 'mono', text: data.puid })),
      el('div', { class: 'kv' }, el('span', { class: 'kv__key', text: 'Affiliations' }), el('span', { class: 'mono', text: affiliations })),
      el('div', { class: 'kv' }, el('span', { class: 'kv__key', text: 'Server time' }), el('span', { class: 'mono', text: signedInAt })),
    ),
  );
}

export function renderMembers(outlet: HTMLElement): void {
  const body = el('div', { class: 'card__body' });

  const load = async (): Promise<void> => {
    body.replaceChildren(loadingState('Loading your members-only data…'));
    try {
      body.replaceChildren(renderOverview(await getMembersOverview()));
    } catch (error) {
      body.replaceChildren(errorState((error as Error).message, () => void load()));
    }
  };

  outlet.append(
    el(
      'div',
      { class: 'view' },
      el(
        'div',
        { class: 'view__intro' },
        el('div', { class: 'view__eyebrow-row' }, eyebrow('Account'), badge('GATED', 'up')),
        el('h1', { class: 'view__title', text: 'Members area' }),
        el('p', {
          class: 'view__lead',
          text:
            'This data comes from a server endpoint protected by ensureApiAuthenticated() — ' +
            'only signed-in users can load it.',
        }),
      ),
      el('section', { class: 'card' }, body),
    ),
  );

  void load();
}
