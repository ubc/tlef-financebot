import {
  ApiError,
  assignAdminCourseRole,
  listAdminUsers,
  removeAdminCourseRole,
  setAdminUserActive,
  type AdminDirectoryUser,
  type CourseRole,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

async function renderInner(outlet: HTMLElement): Promise<void> {
  const body = el('div', {}, loadingState('Loading user directory…'));
  mount(outlet, el('div', { class: 'view view--admin' }, body));
  const search = el('input', {
    class: 'input',
    id: 'admin-directory-search',
    type: 'search',
    placeholder: 'Name, CWL, email, or PUID',
  }) as HTMLInputElement;
  const results = el('div', { class: 'stack admin-user-list' });
  const status = el('div', { class: 'form-status', role: 'status', 'aria-live': 'polite' });

  function report(error: unknown): void {
    status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
  }

  function userCard(user: AdminDirectoryUser): HTMLElement {
    const courseId = el('input', { class: 'input', placeholder: '24-character course id', 'aria-label': 'Course id' }) as HTMLInputElement;
    const role = el('select', { class: 'input', 'aria-label': 'Course role' },
      el('option', { value: 'student', text: 'Student' }),
      el('option', { value: 'instructor', text: 'Instructor' }),
      el('option', { value: 'ta', text: 'TA' }),
    ) as HTMLSelectElement;
    return el('article', { class: 'card stack admin-user-card' },
      el('header', { class: 'admin-user-card__header' },
        el('div', { class: 'stack stack--sm' },
          el('h2', { class: 'admin-user-card__name', text: user.displayName || user.puid }),
          el('span', { class: 'muted', text: user.email || 'Email not released' }),
        ),
        el('div', { class: 'cluster' },
          user.isAdmin ? el('span', { class: 'badge badge--up', text: 'Admin' }) : false,
          user.deactivatedAt ? el('span', { class: 'badge badge--down', text: 'Deactivated' }) : el('span', { class: 'badge badge--muted', text: 'Active' }),
        ),
      ),
      el('dl', { class: 'admin-user-meta' },
        el('div', {}, el('dt', { text: 'CWL' }), el('dd', { class: 'mono', text: user.uid || 'Not released' })),
        el('div', {}, el('dt', { text: 'PUID' }), el('dd', { class: 'mono', text: user.puid })),
      ),
      el('section', { class: 'stack stack--sm admin-user-roles', 'aria-label': 'Course roles' },
        el('h3', { text: `Course roles (${user.courseRoles.length})` }),
        ...(user.courseRoles.length ? user.courseRoles.map((entry) => el('div', { class: 'admin-course-role' },
          el('div', { class: 'admin-course-role__identity' },
            el('span', { class: 'badge badge--muted', text: entry.role }),
            el('span', { class: 'mono', text: entry.courseId }),
          ),
          el('button', {
            class: 'btn btn--ghost btn--sm', type: 'button', text: 'Remove',
            onclick: async () => {
              try {
                try {
                  await removeAdminCourseRole(user.puid, entry.courseId, entry.role);
                } catch (error) {
                  if (!(error instanceof ApiError) || error.message !== 'orphans-course') throw error;
                  const confirmed = await confirmDialog({
                    title: 'Leave course without an instructor?',
                    message: 'This is the final Instructor role. The course will be orphaned until another Instructor is assigned.',
                    confirmLabel: 'Remove final Instructor', tone: 'danger',
                  });
                  if (!confirmed) return;
                  await removeAdminCourseRole(user.puid, entry.courseId, entry.role, true);
                }
                status.textContent = `${entry.role} role removed.`;
                await load();
              } catch (error) {
                report(error);
              }
            },
          }),
        )) : [el('p', { class: 'muted', text: 'No course roles assigned.' })]),
      ),
      el('div', { class: 'admin-role-assignment' },
        el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Course ID' }), courseId),
        el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Role' }), role),
        el('button', {
          class: 'btn btn--secondary btn--sm', type: 'button', text: 'Assign course role',
          onclick: async () => {
            try {
              await assignAdminCourseRole(user.puid, courseId.value.trim(), role.value as CourseRole);
              status.textContent = `${role.value} role assigned.`;
              await load();
            } catch (error) {
              report(error);
            }
          },
        }),
      ),
      el('button', {
        class: user.deactivatedAt ? 'btn btn--secondary btn--sm admin-user-card__state-action' : 'btn btn--danger btn--sm admin-user-card__state-action',
        type: 'button', text: user.deactivatedAt ? 'Reactivate user' : 'Deactivate user',
        disabled: user.isAdmin ? 'true' : undefined,
        onclick: async () => {
          if (!user.deactivatedAt) {
            const confirmed = await confirmDialog({
              title: `Deactivate ${user.displayName || user.puid}?`,
              message: 'The user will lose platform access. Their records and course-role history will be retained.',
              confirmLabel: 'Deactivate user',
              tone: 'danger',
            });
            if (!confirmed) return;
          }
          try {
            await setAdminUserActive(user.puid, Boolean(user.deactivatedAt));
            status.textContent = user.deactivatedAt ? 'User reactivated.' : 'User deactivated.';
            await load();
          } catch (error) {
            report(error);
          }
        },
      }),
    );
  }

  async function load(): Promise<void> {
    results.replaceChildren(loadingState('Loading users…'));
    try {
      const users = await listAdminUsers({ q: search.value.trim() });
      results.replaceChildren(...users.map(userCard));
    } catch (error) {
      results.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }

  body.replaceChildren(
    pageHeader('User Directory', 'Search identities, manage course roles, and revoke platform access without deleting records.'),
    el('form', {
      class: 'admin-directory-search',
      onsubmit: (event: Event) => { event.preventDefault(); void load(); },
    },
    el('label', { class: 'form-field', for: 'admin-directory-search' },
      el('span', { class: 'form-field__label', text: 'Find a user' }),
      search,
    ),
    el('button', { class: 'btn btn--secondary', type: 'submit', text: 'Search' })),
    status,
    results,
  );
  await load();
}

export function renderAdminUsers(outlet: HTMLElement, _params: RouteParams): void {
  void renderInner(outlet);
}
