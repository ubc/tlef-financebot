import { getMyCourseCapabilities, type Capability } from '../../api.js';
import { el, mount } from '../../dom.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';
import { renderAnalytics } from '../instructor/analytics.js';
import { renderStudentProfile } from '../instructor/student-profile.js';

function renderWithPermission(
  outlet: HTMLElement,
  params: RouteParams,
  capability: Capability,
  render: (outlet: HTMLElement, params: RouteParams) => void,
): void {
  const root = el('div', { class: 'view' }, loadingState('Checking course access…'));
  mount(outlet, root);
  const route = location.hash;
  void getMyCourseCapabilities(params.id).then(permissions => {
    if (!root.isConnected || location.hash !== route) return;
    if (!permissions[capability]) {
      root.replaceChildren(errorState('This course has not granted you access to these student analytics.'));
      return;
    }
    render(outlet, params);
  }).catch(error => {
    if (!root.isConnected || location.hash !== route) return;
    root.replaceChildren(errorState(error instanceof Error ? error.message : 'Unable to check course access.',
      () => renderWithPermission(outlet, params, capability, render)));
  });
}

export function renderTaAnalytics(outlet: HTMLElement, params: RouteParams): void {
  renderWithPermission(outlet, params, 'analytics.view', (target, route) => renderAnalytics(target, route, 'ta'));
}

export function renderTaStudentProfile(outlet: HTMLElement, params: RouteParams): void {
  renderWithPermission(outlet, params, 'analytics.individual', (target, route) => renderStudentProfile(target, route, 'ta'));
}
