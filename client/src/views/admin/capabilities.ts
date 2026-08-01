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
  mount(outlet, el('div', { class: 'view' }, body));
  const courseId = el('input', { class: 'input', placeholder: 'Course id (blank = platform)' }) as HTMLInputElement;
  const matrixSlot = el('div', { class: 'stack' });
  const status = el('span', { 'aria-live': 'polite' });
  let matrix: CapabilityMatrix;
  const checks = new Map<string, HTMLInputElement>();

  async function load(): Promise<void> {
    matrixSlot.replaceChildren(loadingState());
    try {
      matrix = await getAdminCapabilities(courseId.value.trim() || undefined);
      checks.clear();
      matrixSlot.replaceChildren(...matrix.matrix.map((row) => el('article', { class: 'card stack' },
        el('strong', { class: 'mono', text: row.capability }),
        el('div', { class: 'cluster' }, ...ROLES.map((role) => {
          const input = el('input', { type: 'checkbox' }) as HTMLInputElement;
          input.checked = row.roles[role].value;
          input.disabled = role === 'admin' || (role === 'ta' && ['question.approve', 'flag.resolve'].includes(row.capability));
          checks.set(`${row.capability}:${role}`, input);
          return el('label', { class: 'checkbox-row' }, input, el('span', { text: `${role} (${row.roles[role].source})` }));
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
    el('div', { class: 'cluster' }, courseId,
      el('button', { class: 'btn btn--secondary', type: 'button', text: 'Load matrix', onclick: () => void load() }),
      el('button', { class: 'btn btn--primary', type: 'button', text: 'Save', onclick: () => void save() }),
      status,
    ),
    el('p', { class: 'muted', text: 'TA approval and flag resolution are structurally locked off.' }),
    matrixSlot,
  );
  await load();
}

export function renderAdminCapabilities(outlet: HTMLElement, _params: RouteParams): void {
  void renderInner(outlet);
}
