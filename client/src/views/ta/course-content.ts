import { getCourseContentMap, getCourseOutline, getMyCourseCapabilities, listMaterials } from '../../api.js';
import { el, mount } from '../../dom.js';
import { statTile } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

async function renderCourseDashboard(outlet: HTMLElement, courseId: string): Promise<void> {
  const root = el('div', { class: 'view view--course-project' }, loadingState('Loading course dashboard…'));
  mount(outlet, root);
  const coursePath = `#/ta/course/${encodeURIComponent(courseId)}`;
  try {
    const [{ course }, map, permissions, materials] = await Promise.all([
      getCourseOutline(courseId), getCourseContentMap(courseId), getMyCourseCapabilities(courseId), listMaterials(courseId),
    ]);
    if (!root.isConnected) return;
    const objectives = map.themes.flatMap(theme => theme.los);
    const gaps = objectives.filter(lo => lo.gaps.length > 0).length;
    const action = (path: string, title: string, subtitle: string): HTMLElement =>
      el('a', { class: 'quick-action', href: `${coursePath}/${path}` },
        el('strong', { class: 'quick-action__title', text: title }),
        el('span', { class: 'quick-action__subtitle', text: subtitle }));
    mount(root,
      el('header', { class: 'project-hero' },
        el('div', { class: 'project-hero__body' },
          el('p', { class: 'project-hero__eyebrow', text: 'COURSE DASHBOARD' }),
          el('h1', { class: 'project-hero__title', text: course.name }),
          el('p', { class: 'project-hero__meta page-header__subtitle', text: [course.courseCode, course.section && `Section ${course.section}`, course.term].filter(Boolean).join(' · ') }))),
      el('div', { class: 'project-cockpit' },
        el('section', { class: 'project-panel', 'aria-label': 'Course workspace' },
          el('h2', { class: 'section-title', text: 'Course workspace' }),
          el('div', { class: 'quick-action-grid' },
            (permissions['question.review'] || permissions['flag.triage']) && action('questions', 'Questions', permissions['question.review']
              ? 'Review questions and share feedback with the teaching team.' : 'Review student reports and recommend next steps.'),
            action('materials', 'Course Materials', 'Open original sources and inspect extracted chunks.'),
            action('structure', 'Course Structure', 'Browse topics and learning objectives.'),
            action('content-map', 'Coverage Map', 'Inspect source and question coverage by objective.'),
            permissions['analytics.view'] && action('analytics', 'Student Analytics', 'Review course activity and learning outcomes.'))),
        el('aside', { class: 'project-panel project-panel--status', 'aria-label': 'Course snapshot' },
          el('h2', { class: 'section-title project-panel__snapshot-title', text: 'Course snapshot' }),
          el('div', { class: 'stat-tile-row' },
            statTile(map.themes.length, 'Topics'),
            statTile(objectives.length, 'Learning Objectives'),
            statTile(materials.length, 'Active Materials'),
            statTile(gaps, 'Objectives with Coverage Gaps', gaps ? 'warn' : 'good')))));
  } catch (error) {
    if (root.isConnected) mount(root, errorState(error instanceof Error ? error.message : String(error),
      () => void renderCourseDashboard(outlet, courseId)));
  }
}

export function renderTaCourseHome(outlet: HTMLElement, { id }: RouteParams): void {
  void renderCourseDashboard(outlet, id);
}
