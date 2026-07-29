// Course Dashboard (I1) — overview stat tiles, a server-backed pre-publish
// checklist, and Quick Actions (Task 15, Task C). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-id `148:3516`) and `.superpowers/sdd/task-15/i1-course-dashboard.png`.
//
// checklist, and shortcuts into the setup workflow.
import {
  ApiError,
  getCourseTree,
  getPublishChecklist,
  getPreseeding,
  updateCourse,
  type CourseTree,
  type CourseTreeTheme,
  type ChecklistItem,
  type PreseedingLo,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { checklistRow, pageHeader, statTile } from '../../instructor-ui.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { startAnonymousPreview } from '../../preview-session.js';

function navigate(path: string): void {
  window.location.hash = path;
}

function totalLos(themes: CourseTreeTheme[]): number {
  return themes.reduce((sum, theme) => sum + (theme.los?.length ?? 0), 0);
}

interface DashboardData {
  tree: CourseTree;
  preseeding: PreseedingLo[];
  checklist: ChecklistItem[];
}

interface ChecklistAction {
  text: string;
  path: string;
}

/** Server checklist label -> the shortest screen that can resolve it. */
export function checklistActionFor(label: string): ChecklistAction | undefined {
  const normalized = label.toLocaleLowerCase();
  if (normalized.includes('term date')) {
    return { text: 'Set dates', path: '/instructor/course/:id/settings' };
  }
  if (normalized.includes('theme') || normalized.includes('topic')) {
    return { text: 'Add Topic', path: '/instructor/course/:id/structure' };
  }
  if (normalized.includes('learning objective')) {
    return { text: 'Add LO', path: '/instructor/course/:id/structure' };
  }
  if (normalized.includes('registration code')) {
    return { text: 'Open Settings', path: '/instructor/course/:id/settings' };
  }
  if (normalized.includes('approved question')) {
    return { text: 'Generate Questions', path: '/instructor/course/:id/preseeding' };
  }
  return undefined;
}

async function loadData(courseId: string): Promise<DashboardData> {
  const [tree, preseeding, checklist] = await Promise.all([
    getCourseTree(courseId),
    getPreseeding(courseId),
    getPublishChecklist(courseId),
  ]);
  return { tree, preseeding, checklist };
}

function statTiles(data: DashboardData): HTMLElement {
  const approved = data.preseeding.reduce((sum, lo) => sum + lo.approved, 0);
  // Draft/Pending and Student Flags tiles from the wireframe are omitted: both
  // need the question-bank (Task E) / flag data that isn't available yet — the
  // brief says omit a tile rather than fake its count.
  return el(
    'div',
    { class: 'stat-tile-row' },
    statTile(data.tree.themes.length, 'Topics'),
    statTile(totalLos(data.tree.themes), 'Learning Objectives'),
    statTile(approved, 'Approved Questions', 'good'),
  );
}

function quickActionCard(
  courseId: string,
  title: string,
  subtitle: string,
  path: string | null,
  beforeNavigate?: () => void,
): HTMLElement {
  const inactive = path === null;
  return el(
    'button',
    {
      class: `quick-action${inactive ? ' quick-action--disabled' : ''}`,
      type: 'button',
      disabled: inactive ? 'disabled' : undefined,
      onclick: inactive
        ? undefined
        : () => {
            beforeNavigate?.();
            navigate(path!.replace(':id', encodeURIComponent(courseId)));
          },
    },
    el('p', { class: 'quick-action__title', text: title }),
    el('p', { class: 'quick-action__subtitle', text: subtitle }),
  );
}

async function renderDashboardInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading course dashboard…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  try {
    const data = await loadData(courseId);
    const { course } = data.tree;

    const lifecycle = course.lifecycle ?? (course.published ? 'published' : 'draft');
    const lifecycleLabel =
      lifecycle === 'archived' ? 'Archived' : lifecycle === 'published' ? 'Published' : 'Sandbox (not yet published)';

    const header = pageHeader(
      course.name,
      `${course.courseCode}${course.section ? ` · Section ${course.section}` : ''} · ${course.term} · ${lifecycleLabel}`,
      lifecycle === 'archived' ? undefined : {
        text: lifecycle === 'published' ? 'Return to draft' : 'Publish Course →',
        onClick: () => void publish(),
      },
    );

    const checklist = el(
      'div',
      { class: 'checklist' },
      ...data.checklist.map((item) => {
        const action = item.ok ? undefined : checklistActionFor(item.item);
        return checklistRow(
          item.item,
          item.ok,
          action
            ? {
                text: action.text,
                onClick: () => navigate(action.path.replace(':id', encodeURIComponent(courseId))),
              }
            : undefined,
        );
      }),
    );

    const quickActions = el(
      'div',
      { class: 'quick-action-grid' },
      quickActionCard(
        courseId,
        data.checklist.find((item) => item.item === 'Term dates set')?.ok
          ? 'Course Settings'
          : 'Set Term Dates',
        data.checklist.find((item) => item.item === 'Term dates set')?.ok
          ? 'Update term dates, feedback strategy, registration, and roster'
          : 'Required before publishing · choose the course start and end dates',
        '/instructor/course/:id/settings',
      ),
      quickActionCard(courseId, 'Edit Topic/LO Structure', 'Add, rename, reorder Topics and LOs', '/instructor/course/:id/structure'),
      quickActionCard(courseId, 'Upload Materials', 'Add course materials and assign to LOs', '/instructor/course/:id/materials'),
      quickActionCard(courseId, 'Content Map', 'Inspect material kinds and LO coverage gaps', '/instructor/course/:id/content-map'),
      quickActionCard(courseId, 'Review Queue', 'Review and approve pending questions', '/instructor/course/:id/queue'),
      quickActionCard(
        courseId,
        'Preview as Student',
        'Switch into the complete anonymous student experience',
        '/preview/course/:id',
        () => startAnonymousPreview(courseId),
      ),
      quickActionCard(courseId, 'Student Analytics', 'View class performance and engagement', null),
    );

    async function publish(): Promise<void> {
      try {
        await updateCourse(courseId, { published: lifecycle !== 'published' });
        await renderDashboardInner(outlet, courseId);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : (error as Error).message;
        body.append(errorState(message));
      }
    }

    body.replaceChildren(
      header,
      statTiles(data),
      el('h2', { class: 'section-title', text: 'Authoring Checklist' }),
      checklist,
      el('h2', { class: 'section-title', text: 'Quick Actions' }),
      quickActions,
    );
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderDashboardInner(outlet, courseId)));
  }
}

export function renderDashboard(outlet: HTMLElement, params: RouteParams): void {
  void renderDashboardInner(outlet, params.id);
}
