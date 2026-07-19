// Course Dashboard (I1) — overview stat tiles, a client-derived pre-publish
// checklist, and Quick Actions (Task 15, Task C). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-id `148:3516`) and `.superpowers/sdd/task-15/i1-course-dashboard.png`.
//
// No `GET .../publish-checklist` endpoint exists (api.ts's `getPublishChecklist`
// throws — see its doc comment), so the five checklist rows below are derived
// client-side from data already fetched for this page: the course record, the
// hierarchy tree, `listMaterials`, and `getPreseeding` (Task-15 Task C brief,
// "CRITICAL resolutions" #1).
import {
  ApiError,
  getCourseTree,
  getPreseeding,
  listMaterials,
  regenerateRegistrationCode,
  updateCourse,
  type CourseTree,
  type CourseTreeTheme,
  type PreseedingLo,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { checklistRow, pageHeader, statTile } from '../../instructor-ui.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function navigate(path: string): void {
  window.location.hash = path;
}

function totalLos(themes: CourseTreeTheme[]): number {
  return themes.reduce((sum, theme) => sum + (theme.los?.length ?? 0), 0);
}

function hasAtLeastOneTopicAndLo(themes: CourseTreeTheme[]): boolean {
  return themes.some((theme) => (theme.los?.length ?? 0) > 0);
}

interface DashboardData {
  tree: CourseTree;
  preseeding: PreseedingLo[];
  materialsReady: boolean; // ≥1 `ready` material with a non-empty `assignments`
}

async function loadData(courseId: string): Promise<DashboardData> {
  const [tree, preseeding, materials] = await Promise.all([
    getCourseTree(courseId),
    getPreseeding(courseId),
    listMaterials(courseId),
  ]);
  const materialsReady = materials.some((m) => m.status === 'ready' && m.assignments.length > 0);
  return { tree, preseeding, materialsReady };
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

function quickActionCard(courseId: string, title: string, subtitle: string, path: string | null): HTMLElement {
  const inactive = path === null;
  return el(
    'button',
    {
      class: `quick-action${inactive ? ' quick-action--disabled' : ''}`,
      type: 'button',
      disabled: inactive ? 'disabled' : undefined,
      onclick: inactive ? undefined : () => navigate(path!.replace(':id', encodeURIComponent(courseId))),
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
    const { course, themes } = data.tree;

    const belowTarget = data.preseeding.filter((lo) => lo.approved < 3).length;
    const questionsChecklistOk = data.preseeding.length > 0 && belowTarget === 0;

    const header = pageHeader(
      course.name,
      `${course.courseCode} · ${course.term} · ${course.published ? 'Published' : 'Sandbox (not yet published)'}`,
      {
        text: 'Publish Course →',
        onClick: () => void publish(),
      },
    );

    const checklist = el(
      'div',
      { class: 'checklist' },
      checklistRow('Term Start & End Dates set', Boolean(course.termStart && course.termEnd)),
      checklistRow('At least 1 Topic and LO configured', hasAtLeastOneTopicAndLo(themes)),
      checklistRow('Registration code generated', Boolean(course.registrationCode), course.registrationCode
        ? undefined
        : { text: 'Generate code →', onClick: () => void generateCode() }),
      checklistRow('Course materials uploaded and assigned', data.materialsReady),
      checklistRow(
        'Minimum 3 approved questions per LO',
        questionsChecklistOk,
        questionsChecklistOk
          ? undefined
          : {
              text: `Review queue → (${belowTarget} LO${belowTarget === 1 ? '' : 's'} below threshold)`,
              onClick: () => navigate(`/instructor/course/${encodeURIComponent(courseId)}/queue`),
            },
      ),
    );

    const quickActions = el(
      'div',
      { class: 'quick-action-grid' },
      quickActionCard(courseId, 'Edit Topic/LO Structure', 'Add, rename, reorder Topics and LOs', '/instructor/course/:id/structure'),
      quickActionCard(courseId, 'Upload Materials', 'Add course materials and assign to LOs', '/instructor/course/:id/materials'),
      quickActionCard(courseId, 'Review Queue', 'Review and approve pending questions', '/instructor/course/:id/queue'),
      quickActionCard(courseId, 'Student Analytics', 'View class performance and engagement', null),
    );

    async function publish(): Promise<void> {
      try {
        await updateCourse(courseId, { published: true });
        await renderDashboardInner(outlet, courseId);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : (error as Error).message;
        body.append(errorState(message));
      }
    }

    async function generateCode(): Promise<void> {
      try {
        await regenerateRegistrationCode(courseId);
        await renderDashboardInner(outlet, courseId);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : (error as Error).message;
        body.append(errorState(message));
      }
    }

    body.replaceChildren(
      header,
      statTiles(data),
      el('h2', { class: 'section-title', text: 'Pre-publish Checklist' }),
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
