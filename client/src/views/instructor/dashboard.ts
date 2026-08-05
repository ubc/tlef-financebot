// Instructor Course Launch Cockpit — a task-driven summary over the existing
// course, content, review, flag, and analytics sources of truth.
import {
  ApiError,
  getInstructorWorkflow,
  restoreCourse,
  updateCourse,
  type InstructorWorkflowAction,
  type InstructorWorkflowDestination,
  type InstructorWorkflowSummary,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { checklistRow, statTile } from '../../instructor-ui.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { startAnonymousPreview } from '../../preview-session.js';

function navigate(path: string): void {
  window.location.hash = path;
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

const WORKFLOW_DESTINATIONS: Record<Exclude<InstructorWorkflowDestination, 'dashboard'>, string> = {
  settings: '/instructor/course/:id/settings',
  structure: '/instructor/course/:id/structure',
  materials: '/instructor/course/:id/materials',
  'content-map': '/instructor/course/:id/content-map',
  preseeding: '/instructor/course/:id/preseeding',
  'review-queue': '/instructor/course/:id/queue',
  bank: '/instructor/course/:id/bank',
  flags: '/instructor/course/:id/flags',
  analytics: '/instructor/course/:id/analytics',
  'student-preview': '/preview/course/:id',
};

/** Stable server destination -> client route. Dashboard actions are commands. */
export function workflowActionPath(
  destination: InstructorWorkflowDestination,
  courseId: string,
): string | null {
  if (destination === 'dashboard') return null;
  return WORKFLOW_DESTINATIONS[destination].replace(':id', encodeURIComponent(courseId));
}

function statTiles(data: InstructorWorkflowSummary): HTMLElement {
  const { counts } = data;
  return el(
    'div',
    { class: 'stat-tile-row' },
    statTile(counts.topics, 'Topics'),
    statTile(counts.learningObjectives, 'Learning Objectives'),
    statTile(counts.approvedQuestions, 'Approved Questions', 'good'),
    statTile(counts.reviewQueue, 'Waiting for Review', counts.reviewQueue ? 'warn' : 'good'),
    statTile(counts.openFlags, 'Open Flags', counts.openFlags ? 'bad' : 'good'),
    statTile(counts.contentIssues, 'Content Issues', counts.contentIssues ? 'bad' : 'good'),
  );
}

function readinessCard(data: InstructorWorkflowSummary): HTMLElement {
  const { readiness } = data;
  const progress = el('progress', {
    class: 'cockpit-readiness__progress',
    max: '100',
    value: String(readiness.percent),
    'aria-label': `Launch readiness ${readiness.percent}%`,
  });
  return el(
    'section',
    { class: 'cockpit-readiness', 'aria-labelledby': 'launch-readiness-title' },
    el(
      'div',
      { class: 'cockpit-readiness__summary' },
      el(
        'div',
        {},
        el('h2', { id: 'launch-readiness-title', class: 'section-title', text: 'Launch readiness' }),
        el('p', {
          class: 'muted',
          text: `${readiness.completed} of ${readiness.total} launch checks complete`,
        }),
      ),
      el('strong', { class: 'cockpit-readiness__percent', text: `${readiness.percent}%` }),
    ),
    progress,
  );
}

function courseFlow(data: InstructorWorkflowSummary): HTMLElement {
  const { course, counts } = data;
  const steps: Array<{
    number: string;
    label: string;
    detail: string;
    path?: string;
    onClick?: () => void;
  }> = [
    {
      number: '1',
      label: 'Sources',
      detail: `${counts.contentIssues ? `${counts.contentIssues} issue${counts.contentIssues === 1 ? '' : 's'}` : 'Knowledge ready'}`,
      path: `/instructor/course/${encodeURIComponent(course.id)}/materials`,
    },
    {
      number: '2',
      label: 'Learning objectives',
      detail: `${counts.learningObjectives} LO${counts.learningObjectives === 1 ? '' : 's'}`,
      path: `/instructor/course/${encodeURIComponent(course.id)}/structure`,
    },
    {
      number: '3',
      label: 'Questions',
      detail: `${counts.approvedQuestions} approved`,
      path: `/instructor/course/${encodeURIComponent(course.id)}/preseeding`,
    },
    {
      number: '4',
      label: 'Review',
      detail: `${counts.reviewQueue} waiting`,
      path: `/instructor/course/${encodeURIComponent(course.id)}/queue`,
    },
    {
      number: '5',
      label: 'Student preview',
      detail: 'Test the experience',
      onClick: () => startAnonymousPreview(course.id),
      path: `/preview/course/${encodeURIComponent(course.id)}`,
    },
  ];
  return el(
    'nav',
    { class: 'course-flow', 'aria-label': 'Course authoring workflow' },
    ...steps.map((step) =>
      el(
        'a',
        {
          class: 'course-flow__step',
          href: `#${step.path}`,
          onclick: step.onClick,
        },
        el('span', { class: 'course-flow__number', 'aria-hidden': 'true', text: step.number }),
        el(
          'span',
          { class: 'course-flow__body' },
          el('strong', { text: step.label }),
          el('span', { text: step.detail }),
        ),
      ),
    ),
  );
}

function priorityLabel(action: InstructorWorkflowAction): string {
  if (action.priority === 'blocking') return 'Launch blocker';
  if (action.priority === 'high') return 'Needs attention';
  return 'Recommended';
}

function actionList(
  data: InstructorWorkflowSummary,
  onPublish: () => void,
  onRestore: () => void,
): HTMLElement {
  return el(
    'div',
    { class: 'workflow-actions' },
    ...data.actions.map((action) =>
      el(
        'button',
        {
          class: `workflow-action workflow-action--${action.priority}`,
          type: 'button',
          onclick: () => {
            if (action.id === 'publish-course') {
              onPublish();
              return;
            }
            if (action.id === 'restore-course') {
              onRestore();
              return;
            }
            const path = workflowActionPath(action.destination, data.course.id);
            if (!path) return;
            if (action.destination === 'student-preview') startAnonymousPreview(data.course.id);
            navigate(path);
          },
        },
        el(
          'span',
          { class: 'workflow-action__body' },
          el(
            'span',
            { class: 'workflow-action__heading' },
            el('span', { class: 'workflow-action__title', text: action.title }),
            action.count !== undefined
              ? el('span', { class: 'workflow-action__count', text: String(action.count) })
              : false,
          ),
          el('span', { class: 'workflow-action__detail', text: action.detail }),
        ),
        el(
          'span',
          { class: 'workflow-action__aside' },
          el('span', { class: `workflow-action__priority workflow-action__priority--${action.priority}`, text: priorityLabel(action) }),
          el('span', {
            class: 'workflow-action__open',
            text: action.id === 'publish-course' ? 'Publish →' : action.id === 'restore-course' ? 'Restore →' : 'Open →',
          }),
        ),
      ),
    ),
  );
}

function quickActionCard(
  courseId: string,
  title: string,
  subtitle: string,
  destination: Exclude<InstructorWorkflowDestination, 'dashboard'>,
  beforeNavigate?: () => void,
): HTMLElement {
  return el(
    'button',
    {
      class: 'quick-action',
      type: 'button',
      onclick: () => {
        beforeNavigate?.();
        navigate(workflowActionPath(destination, courseId)!);
      },
    },
    el('p', { class: 'quick-action__title', text: title }),
    el('p', { class: 'quick-action__subtitle', text: subtitle }),
  );
}

/** Same card as `quickActionCard`, but for a plain client route rather than a
 * server-modelled workflow destination. The TA workspace is instructor-
 * initiated chrome for inspecting a course, not a step in the launch workflow,
 * so `InstructorWorkflowSummary` has no `InstructorWorkflowDestination` for it
 * — and inventing one would mean the server had an opinion about a screen it
 * never surfaces an action for. */
function pathActionCard(title: string, subtitle: string, path: string): HTMLElement {
  return el(
    'button',
    { class: 'quick-action', type: 'button', onclick: () => navigate(path) },
    el('p', { class: 'quick-action__title', text: title }),
    el('p', { class: 'quick-action__subtitle', text: subtitle }),
  );
}

async function renderDashboardInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading course cockpit…'));
  const root = el('div', { class: 'view view--course-project' }, body);
  mount(outlet, root);

  try {
    const data = await getInstructorWorkflow(courseId);
    const { course } = data;
    const lifecycleLabel = course.lifecycle === 'archived'
      ? 'Archived'
      : course.lifecycle === 'published'
        ? 'Published'
        : 'Sandbox (not yet published)';
    const lifecycleBadge = course.lifecycle === 'archived'
      ? 'Archived'
      : course.lifecycle === 'published'
        ? 'Published'
        : 'Draft';

    async function publish(): Promise<void> {
      try {
        await updateCourse(courseId, { published: course.lifecycle !== 'published' });
        await renderDashboardInner(outlet, courseId);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : (error as Error).message;
        body.append(errorState(message));
      }
    }

    async function restore(): Promise<void> {
      try {
        await restoreCourse(courseId);
        await renderDashboardInner(outlet, courseId);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : (error as Error).message;
        body.append(errorState(message));
      }
    }

    const header = el(
      'header',
      { class: 'project-hero' },
      el(
        'div',
        { class: 'project-hero__body' },
        el('p', { class: 'project-hero__eyebrow', text: 'COURSE PROJECT' }),
        el('h1', { class: 'project-hero__title', text: course.name }),
        el('p', {
          class: 'project-hero__meta page-header__subtitle',
          text: `${course.courseCode}${course.section ? ` · Section ${course.section}` : ''} · ${course.term} · ${lifecycleLabel}`,
        }),
      ),
      el(
        'div',
        { class: 'project-hero__actions' },
        el('span', {
          class: `project-hero__status project-hero__status--${course.lifecycle}`,
          text: lifecycleBadge,
        }),
        course.lifecycle === 'archived'
          ? false
          : el(
              'button',
              {
                class: 'btn btn--instr-primary',
                type: 'button',
                onclick: () => void publish(),
              },
              course.lifecycle === 'published' ? 'Return to draft' : 'Publish course →',
            ),
      ),
    );

    const checklist = el(
      'div',
      { class: 'checklist' },
      ...data.readiness.checklist.map((item) => {
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

    const explore = el(
      'div',
      { class: 'quick-action-grid' },
      quickActionCard(courseId, 'Coverage Map', 'Find thin LOs and trace each one to sources and Approved questions', 'content-map'),
      quickActionCard(courseId, 'Question Bank', 'Search, edit, version, and manage all questions', 'bank'),
      quickActionCard(courseId, 'Student Analytics', 'Explore learning, misconceptions, and engagement', 'analytics'),
      quickActionCard(
        courseId,
        'Preview as Student',
        'Switch into the isolated Approved-only student experience',
        'student-preview',
        () => startAnonymousPreview(courseId),
      ),
      pathActionCard(
        'View as TA',
        'Inspect the TA workspace for this course · live data, not a sandbox',
        `/ta/course/${encodeURIComponent(courseId)}/review`,
      ),
    );

    body.replaceChildren(
      header,
      courseFlow(data),
      el(
        'div',
        { class: 'project-cockpit' },
        el(
          'section',
          { class: 'project-panel project-panel--primary', 'aria-labelledby': 'next-actions-title' },
          el('div', { class: 'project-panel__heading' },
            el('div', {},
              el('p', { class: 'project-panel__eyebrow', text: 'CONTINUE WORKING' }),
              el('h2', { id: 'next-actions-title', class: 'section-title', text: 'Next actions' }),
            ),
            el('span', { class: 'project-panel__count', text: String(data.actions.length) }),
          ),
          actionList(data, () => void publish(), () => void restore()),
          el('details', { class: 'cockpit-checklist' },
            el('summary', { text: 'View launch checklist' }),
            checklist,
          ),
        ),
        el(
          'aside',
          { class: 'project-panel project-panel--status', 'aria-label': 'Course status' },
          readinessCard(data),
          el('h2', { class: 'section-title project-panel__snapshot-title', text: 'Course snapshot' }),
          statTiles(data),
        ),
      ),
      el(
        'section',
        { class: 'project-explore', 'aria-labelledby': 'explore-course-title' },
        el('div', { class: 'project-panel__heading' },
          el('div', {},
            el('p', { class: 'project-panel__eyebrow', text: 'MORE TOOLS' }),
            el('h2', { id: 'explore-course-title', class: 'section-title', text: 'Explore course' }),
          ),
        ),
        explore,
      ),
    );
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderDashboardInner(outlet, courseId)));
  }
}

export function renderDashboard(outlet: HTMLElement, params: RouteParams): void {
  void renderDashboardInner(outlet, params.id);
}
