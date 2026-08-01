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
  mount(outlet, el('div', { class: 'view' }, body));
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Name, CWL, email, or PUID' }) as HTMLInputElement;
  const results = el('div', { class: 'stack' });
  const status = el('div', { 'aria-live': 'polite' });

  function userCard(user: AdminDirectoryUser): HTMLElement {
    const courseId = el('input', { class: 'input', placeholder: '24-character course id', 'aria-label': 'Course id' }) as HTMLInputElement;
    const role = el('select', { class: 'input', 'aria-label': 'Course role' },
      el('option', { value: 'student', text: 'Student' }),
      el('option', { value: 'instructor', text: 'Instructor' }),
      el('option', { value: 'ta', text: 'TA' }),
    ) as HTMLSelectElement;
    return el('article', { class: 'card stack' },
      el('div', { class: 'cluster' },
        el('strong', { text: user.displayName || user.puid }),
        user.isAdmin ? el('span', { class: 'badge', text: 'Admin' }) : false,
        user.deactivatedAt ? el('span', { class: 'badge', text: 'Deactivated' }) : false,
      ),
      el('span', { class: 'mono', text: `${user.uid || 'no CWL'} · ${user.puid}` }),
      el('span', { text: user.email }),
      el('div', { class: 'stack stack--sm' },
        ...user.courseRoles.map((entry) => el('div', { class: 'cluster' },
          el('span', { text: `${entry.role} · ${entry.courseId}` }),
          el('button', {
            class: 'btn btn--ghost btn--sm', type: 'button', text: 'Remove',
            onclick: async () => {
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
              await load();
            },
          }),
        )),
      ),
      el('div', { class: 'cluster' }, courseId, role,
        el('button', {
          class: 'btn btn--secondary btn--sm', type: 'button', text: 'Assign course role',
          onclick: async () => {
            await assignAdminCourseRole(user.puid, courseId.value.trim(), role.value as CourseRole);
            await load();
          },
        }),
      ),
      el('button', {
        class: user.deactivatedAt ? 'btn btn--secondary btn--sm' : 'btn btn--danger btn--sm',
        type: 'button', text: user.deactivatedAt ? 'Reactivate user' : 'Deactivate user',
        disabled: user.isAdmin ? 'true' : undefined,
        onclick: async () => {
          await setAdminUserActive(user.puid, Boolean(user.deactivatedAt));
          await load();
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
    el('div', { class: 'cluster' }, search, el('button', { class: 'btn btn--secondary', type: 'button', text: 'Search', onclick: () => void load() })),
    status,
    results,
  );
  await load();
}

export function renderAdminUsers(outlet: HTMLElement, _params: RouteParams): void {
  void renderInner(outlet);
}
