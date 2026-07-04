// Role-gated view (role-based authorization reference). One factory renders any
// role's area; the server endpoint enforces access (403 for the wrong role), and
// this view shows that gracefully. The nav only shows a role's item to matching
// users, so a 403 here means someone deep-linked to a role that isn't theirs.
import { getRoleArea, ApiError, type RoleArea } from '../api.js';
import { el } from '../dom.js';
import { eyebrow, badge, loadingState, errorState } from '../ui.js';
import type { ViewRender } from '../router.js';

function renderArea(area: RoleArea): HTMLElement {
  return el(
    'div',
    {},
    el('p', { class: 'role__blurb', text: area.blurb }),
    el(
      'ul',
      { class: 'caps' },
      ...area.capabilities.map((cap) =>
        el(
          'li',
          { class: 'caps__item' },
          el('span', { class: 'caps__mark', 'aria-hidden': 'true', text: '✓' }),
          cap,
        ),
      ),
    ),
    el('div', { class: 'divider' }),
    el(
      'p',
      { class: 'role__foot' },
      'Your role(s): ',
      el('span', { class: 'mono', text: area.yourRoles.join(', ') || 'none' }),
    ),
  );
}

/** Build a render function for one role's area. */
export function renderRole(role: string): ViewRender {
  return (outlet: HTMLElement) => {
    const body = el('div', { class: 'card__body' });

    const load = async (): Promise<void> => {
      body.replaceChildren(loadingState('Loading your area…'));
      try {
        body.replaceChildren(renderArea(await getRoleArea(role)));
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          body.replaceChildren(
            errorState(`The ${role} area is only available to ${role} users — your account has a different role.`),
          );
        } else {
          body.replaceChildren(errorState((error as Error).message, () => void load()));
        }
      }
    };

    outlet.append(
      el(
        'div',
        { class: 'view' },
        el(
          'div',
          { class: 'view__intro' },
          el('div', { class: 'view__eyebrow-row' }, eyebrow('Your area'), badge('ROLE', 'up')),
          el('h1', { class: 'view__title', text: `${role.charAt(0).toUpperCase()}${role.slice(1)} area` }),
          el('p', {
            class: 'view__lead',
            text: 'This screen is gated by role: the server only serves it to users whose eduPersonAffiliation matches.',
          }),
        ),
        el('section', { class: 'card' }, body),
      ),
    );

    void load();
  };
}
