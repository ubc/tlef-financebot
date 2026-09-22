import { createCourseSharingPanel } from '../../course-sharing.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { attachTutorial } from '../../tutorials.js';

export function renderCoInstructors(outlet: HTMLElement, params: RouteParams): void {
  const panel = createCourseSharingPanel(params.id);
  const root = el('div', { class: 'view view--course-sharing' },
    pageHeader('Co-instructors', 'Share course authoring with your teaching colleagues.'), panel.element);
  mount(outlet, root);
  attachTutorial(root, 'instructor-sharing', {
    'sharing-people': '.course-sharing__members',
    'sharing-link': '.course-sharing__restricted',
  });
  const routeChanged = (): void => {
    panel.dispose(); window.removeEventListener('hashchange', routeChanged);
  };
  window.addEventListener('hashchange', routeChanged);
  void panel.refresh();
}
