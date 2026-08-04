import {
  ApiError,
  getAdminCapabilities,
  saveAdminCapabilities,
  type CapabilityMatrix,
  type CapabilityRole,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

const ROLES: CapabilityRole[] = ['student', 'instructor', 'ta', 'admin'];

async function renderInner(outlet: HTMLElement): Promise<void> {
  const body = el('div', {}, loadingState('Loading capability matrix…'));
  mount(outlet, el('div', { class: 'view view--admin' }, body));
  const courseId = el('input', {
    class: 'input',
    id: 'admin-capability-course',
    placeholder: 'Leave blank for platform defaults',
    autocomplete: 'off',
  }) as HTMLInputElement;
  const matrixSlot = el('div', { class: 'stack admin-capability-list' });
  const status = el('span', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  let matrix: CapabilityMatrix;
  const checks = new Map<string, HTMLInputElement>();

  async function load(): Promise<void> {
    matrixSlot.replaceChildren(loadingState());
    try {
      matrix = await getAdminCapabilities(courseId.value.trim() || undefined);
      checks.clear();
      matrixSlot.replaceChildren(...matrix.matrix.map((row) => el('article', { class: 'card stack capability-card' },
        el('h2', { class: 'capability-card__name mono', text: row.capability }),
        el('div', { class: 'capability-card__roles' }, ...ROLES.map((role) => {
          const input = el('input', { type: 'checkbox' }) as HTMLInputElement;
          input.checked = row.roles[role].value;
          input.disabled = role === 'admin' || (role === 'ta' && ['question.approve', 'flag.resolve'].includes(row.capability));
          checks.set(`${row.capability}:${role}`, input);
          return el('label', { class: 'checkbox-row capability-role' }, input,
            el('span', { class: 'capability-role__copy' },
              el('span', { class: 'capability-role__name', text: role }),
              el('span', { class: 'capability-role__source', text: row.roles[role].source }),
            ),
          );
        })),
      )));
    } catch (error) {
      matrixSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }

  async function save(): Promise<void> {
    const assignments: CapabilityMatrix['assignments'] = {};
    for (const row of matrix.matrix) {
      assignments[row.capability] = Object.fromEntries(ROLES
        .filter((role) => role !== 'admin')
        .map((role) => [role, checks.get(`${row.capability}:${role}`)?.checked ?? false]));
    }
    try {
      await saveAdminCapabilities(assignments, courseId.value.trim() || undefined);
      status.textContent = 'Saved. Existing course overrides remain separate from platform defaults.';
      await load();
    } catch (error) {
      status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
    }
  }

  body.replaceChildren(
    pageHeader('Capability Matrix', 'Platform defaults and optional course overrides with effective-source labels.'),
    el('section', { class: 'admin-toolbar', 'aria-label': 'Capability scope' },
      el('label', { class: 'form-field admin-toolbar__field', for: 'admin-capability-course' },
        el('span', { class: 'form-field__label', text: 'Course ID override' }),
        courseId,
        el('span', { class: 'form-field__help', text: 'Leave blank to edit platform defaults, or enter one 24-character course ID.' }),
      ),
      el('div', { class: 'admin-toolbar__actions' },
        el('button', { class: 'btn btn--secondary', type: 'button', text: 'Load matrix', onclick: () => void load() }),
        el('button', { class: 'btn btn--primary', type: 'button', text: 'Save changes', onclick: () => void save() }),
      ),
      status,
    ),
    el('p', { class: 'admin-note', text: 'Safety rule: Admin access is always enabled. TA approval and flag resolution are structurally locked off.' }),
    matrixSlot,
  );
  await load();
}

export function renderAdminCapabilities(outlet: HTMLElement, _params: RouteParams): void {
  void renderInner(outlet);
}
