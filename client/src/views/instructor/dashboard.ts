import { attachTutorial } from '../../tutorials.js';
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
import { setButtonBusy } from '../../action-state.js';
import { checklistRow, statTile } from '../../instructor-ui.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { startAnonymousPreview } from '../../preview-session.js';
import { suggestedTermDates } from '../../academic-terms.js';

function navigate(path: string): void {
  window.location.hash = path;
}

interface ChecklistAction {
  text: string;
  path: string;
  command?: 'configure-dates';
}

/** Server checklist label -> the shortest screen that can resolve it. */
export function checklistActionFor(label: string): ChecklistAction | undefined {
  const normalized = label.toLocaleLowerCase();
  if (normalized.includes('term date')) {
    return { text: 'Set dates', path: '/instructor/course/:id/settings', command: 'configure-dates' };
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
  'review-queue': '/instructor/course/:id/questions?tab=review',
  bank: '/instructor/course/:id/questions?tab=approved',
  flags: '/instructor/course/:id/questions?tab=flags',
  analytics: '/instructor/course/:id/analytics',
  release: '/instructor/course/:id/questions?tab=approved',
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

/** The six-stage main path (spec 2026-11-12). Publish has no page of its
 * own: it opens the Publish panel on this Dashboard. */
function courseFlow(data: InstructorWorkflowSummary, openPublishPanel: () => void): HTMLElement {
  const { course } = data;
  const statusLabel = {
    'not-started': 'Not started',
    blocked: 'Blocked',
    'in-progress': 'In progress',
    'needs-attention': 'Needs attention',
    ready: 'Ready',
    complete: 'Complete',
  } as const;
  return el(
    'nav',
    { class: 'course-flow', 'aria-label': 'Course progress' },
    ...data.setup.steps.map((step) => {
      const path = workflowActionPath(step.destination, course.id);
      const current = step.id === data.setup.currentStage;
      return el(
        'a',
        {
          class: `course-flow__step course-flow__step--${step.status}${current ? ' is-current' : ''}`,
          href: path ? `#${path}` : '#',
          'aria-current': current ? 'step' : undefined,
          onclick: path ? undefined : (event: MouseEvent) => { event.preventDefault(); openPublishPanel(); },
          'aria-label': `${step.number}. ${step.label}: ${step.detail}. Status: ${statusLabel[step.status]}${current ? '. Current stage' : ''}`,
        },
        el('span', { class: 'course-flow__number', 'aria-hidden': 'true', text: step.status === 'complete' || (step.status === 'ready' && step.id !== 'publish') ? '✓' : String(step.number) }),
        el(
          'span',
          { class: 'course-flow__body' },
          el('strong', { text: step.label }),
          el('span', { text: `${statusLabel[step.status]} · ${step.detail}` }),
        ),
      );
    }),
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
  onConfigureDates: () => void,
): HTMLElement {
  const primary = data.setup.primaryAction;
  const secondary = data.actions.filter((action) => action.id !== primary.id);

  const actionButton = (action: InstructorWorkflowAction, isPrimary: boolean): HTMLElement =>
      el(
        'button',
        {
          class: `workflow-action workflow-action--${action.priority}${isPrimary ? ' workflow-action--primary' : ''}`,
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
            if (action.id === 'configure-course') {
              onConfigureDates();
              return;
            }
            const path = workflowActionPath(action.destination, data.course.id);
            if (!path) return;
            if (action.destination === 'student-preview') {
              if (data.counts.approvedQuestions === 0) {
                navigate(workflowActionPath('review-queue', data.course.id)!);
                return;
              }
              startAnonymousPreview(data.course.id);
            }
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
            text: action.id === 'publish-course'
              ? 'Publish →'
              : action.id === 'restore-course'
                ? 'Restore →'
                : action.id === 'configure-course'
                  ? 'Set dates →'
                  : 'Open →',
          }),
        ),
      );

  return el(
    'div',
    { class: 'workflow-actions' },
    el('p', { class: 'workflow-actions__next-label', text: 'NEXT STEP' }),
    actionButton(primary, true),
    secondary.length > 0
      ? el(
          'details',
          { class: 'workflow-actions__upcoming' },
          el('summary', { text: `Up next (${secondary.length})` }),
          el('div', { class: 'workflow-actions workflow-actions--secondary' },
            ...secondary.map((action) => actionButton(action, false)),
          ),
        )
      : false,
  );
}

function dateOnly(value?: string): string {
  return value?.slice(0, 10) ?? '';
}

/** Dashboard-local setup dialog: complete the blocking date task without
 * losing course-home context. Native date values also open their picker near
 * the prefilled term instead of today's month. */
function openCourseDatesDialog(
  data: InstructorWorkflowSummary,
  onSaved: () => void,
): void {
  const { course } = data;
  const suggestion = suggestedTermDates(course.term);
  const hasSavedDates = Boolean(course.termStart || course.termEnd);
  const startInput = el('input', {
    class: 'input',
    id: 'course-dates-start',
    name: 'termStart',
    type: 'date',
    required: 'true',
    value: dateOnly(course.termStart) || suggestion?.termStart || '',
  }) as HTMLInputElement;
  const endInput = el('input', {
    class: 'input',
    id: 'course-dates-end',
    name: 'termEnd',
    type: 'date',
    required: 'true',
    value: dateOnly(course.termEnd) || suggestion?.termEnd || '',
  }) as HTMLInputElement;
  const error = el('p', {
    class: 'course-dates-dialog__error',
    role: 'alert',
    'aria-live': 'polite',
  });
  const dialog = el('dialog', {
    class: 'app-dialog course-dates-dialog',
    'aria-labelledby': 'course-dates-title',
    'aria-describedby': 'course-dates-description',
  }) as HTMLDialogElement;
  const cancelButton = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel') as HTMLButtonElement;
  const settingsButton = el(
    'button',
    { class: 'btn btn--ghost course-dates-dialog__settings', type: 'button' },
    'Open full settings',
  ) as HTMLButtonElement;
  const saveButton = el('button', { class: 'btn btn--instr-primary', type: 'submit' }, 'Save dates') as HTMLButtonElement;

  const guidance = hasSavedDates
    ? 'Your saved dates are shown below. Adjust them if this section follows a different schedule.'
    : suggestion?.official
      ? `We prefilled UBC’s published standard dates for ${course.term}. Adjust them for this section if needed.`
      : suggestion
        ? `We prefilled a typical ${course.term} window so the calendar opens nearby. Verify it against this section’s official schedule.`
        : 'Choose the first and last day for this course section.';

  const form = el(
    'form',
    { method: 'dialog' },
    el('h2', { class: 'app-dialog__title', id: 'course-dates-title', text: 'Set course dates' }),
    el('p', { class: 'app-dialog__message', id: 'course-dates-description', text: guidance }),
    el(
      'div',
      { class: 'course-dates-dialog__term' },
      el('span', { text: 'Selected term' }),
      el('strong', { text: course.term }),
    ),
    el(
      'div',
      { class: 'course-dates-dialog__fields' },
      el(
        'label',
        { class: 'form-field', for: 'course-dates-start' },
        el('span', { class: 'form-field__label', text: 'Course starts' }),
        startInput,
      ),
      el(
        'label',
        { class: 'form-field', for: 'course-dates-end' },
        el('span', { class: 'form-field__label', text: 'Course ends' }),
        endInput,
      ),
    ),
    error,
    el(
      'p',
      { class: 'course-dates-dialog__note' },
      'You can change these dates any time in ',
      el('strong', { text: 'Course Settings' }),
      '. ',
      el(
        'a',
        {
          href: 'https://vancouver.calendar.ubc.ca/dates-and-deadlines',
          target: '_blank',
          rel: 'noreferrer',
          text: 'Check the UBC calendar ↗',
        },
      ),
    ),
    el('div', { class: 'app-dialog__actions course-dates-dialog__actions' }, settingsButton, cancelButton, saveButton),
  ) as HTMLFormElement;
  dialog.append(el('div', { class: 'app-dialog__surface' }, form));

  const close = (): void => {
    dialog.close();
    dialog.remove();
  };
  cancelButton.addEventListener('click', close);
  settingsButton.addEventListener('click', () => {
    close();
    navigate(`/instructor/course/${encodeURIComponent(course.id)}/settings`);
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    if (!startInput.value || !endInput.value) {
      error.textContent = 'Choose both a start date and an end date.';
      return;
    }
    if (endInput.value <= startInput.value) {
      error.textContent = 'The course end date must be after the start date.';
      endInput.focus();
      return;
    }
    saveButton.disabled = true;
    setButtonBusy(saveButton, true);
    saveButton.textContent = 'Saving…';
    try {
      await updateCourse(course.id, {
        termStart: new Date(`${startInput.value}T00:00:00.000Z`).toISOString(),
        termEnd: new Date(`${endInput.value}T23:59:59.999Z`).toISOString(),
      }, course.revision ?? 0);
      close();
      onSaved();
    } catch (caught) {
      error.textContent = caught instanceof ApiError ? caught.message : (caught as Error).message;
      saveButton.disabled = false;
      saveButton.textContent = 'Save dates';
    } finally {
      setButtonBusy(saveButton, false);
    }
  });

  document.body.append(dialog);
  dialog.showModal();
  startInput.focus();
}

function quickActionCard(
  courseId: string,
  title: string,
  subtitle: string,
  destination: Exclude<InstructorWorkflowDestination, 'dashboard'>,
  beforeNavigate?: () => boolean | void,
): HTMLElement {
  return el(
    'button',
    {
      class: 'quick-action',
      type: 'button',
      onclick: () => {
        if (beforeNavigate?.() === false) return;
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

/** Publish stage: the launch checklist, the Student preview recommendation
 * and the publish control, in one place (spec 2026-11-12). */
function publishPanel(
  data: InstructorWorkflowSummary,
  checklist: HTMLElement,
  onPublish: () => void,
  onRestore: () => void,
): HTMLElement {
  const { course, readiness } = data;
  const previewTested = data.setup.previewTested;
  const canPreview = data.counts.approvedQuestions > 0;
  const preview = el('div', { class: 'publish-panel__preview' },
    el('div', {},
      el('strong', { text: 'Student preview (recommended)' }),
      el('p', { class: 'muted', text: !canPreview
        ? 'Approve at least one question to try the student experience.'
        : previewTested ? 'Tested recently. Preview again after larger changes.' : 'Walk through the Approved-only course before students do.' })),
    canPreview
      ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => {
        startAnonymousPreview(course.id);
        navigate(workflowActionPath('student-preview', course.id)!);
      } }, 'Preview as student')
      : el('a', { class: 'btn btn--ghost btn--sm', href: `#${workflowActionPath('review-queue', course.id)}`, text: 'Review questions' }));
  const control = course.lifecycle === 'archived'
    ? el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: onRestore }, 'Restore course')
    : course.lifecycle === 'published'
      ? el('p', { class: 'publish-panel__state' }, el('strong', { text: 'Published. ' }), 'Students with access can practise released questions.')
      : el('button', {
        class: 'btn btn--instr-primary',
        type: 'button',
        disabled: readiness.completed < readiness.total,
        onclick: onPublish,
      }, 'Publish course →');
  return el('details', {
    class: 'publish-panel project-panel',
    id: 'publish-panel',
    open: data.setup.currentStage === 'publish',
  },
  el('summary', {},
    el('span', { class: 'publish-panel__title', text: '⑥ Publish' }),
    el('span', { class: 'muted', text: `${readiness.completed} of ${readiness.total} launch checks complete` })),
  el('div', { class: 'publish-panel__body' }, checklist, preview, control));
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
        await updateCourse(courseId, { published: course.lifecycle !== 'published' }, course.revision ?? 0);
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

    function configureDates(): void {
      openCourseDatesDialog(data, () => void renderDashboardInner(outlet, courseId));
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
                onclick: () => publish(),
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
                onClick: action.command === 'configure-dates'
                  ? configureDates
                  : () => navigate(action.path.replace(':id', encodeURIComponent(courseId))),
              }
            : undefined,
        );
      }),
    );

    const explore = el(
      'div',
      { class: 'quick-action-grid' },
      quickActionCard(courseId, 'Coverage Map', 'Find thin LOs and trace each one to sources and Approved questions', 'content-map'),
      quickActionCard(courseId, 'Questions', 'Review, edit, release and manage all questions', 'bank'),
      quickActionCard(courseId, 'Student Analytics', 'Explore learning, misconceptions, and engagement', 'analytics'),
      quickActionCard(
        courseId,
        'Preview as Student',
        'Switch into the isolated Approved-only student experience',
        'student-preview',
        () => {
          if (data.counts.approvedQuestions === 0) {
            navigate(workflowActionPath('review-queue', courseId)!);
            return false;
          }
          startAnonymousPreview(courseId);
          return true;
        },
      ),
      pathActionCard(
        'View as TA',
        'Inspect the TA workspace for this course · live data, not a sandbox',
        `/ta/course/${encodeURIComponent(courseId)}/review`,
      ),
    );

    const publishSection = publishPanel(data, checklist, () => void publish(), () => void restore());
    const openPublishPanel = (): void => {
      (publishSection as HTMLDetailsElement).open = true;
      publishSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      publishSection.querySelector<HTMLElement>('summary')?.focus();
    };

    body.replaceChildren(
      header,
      courseFlow(data, openPublishPanel),
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
            el('span', { class: 'project-panel__count', text: '1', 'aria-label': 'One recommended next step' }),
          ),
          actionList(data, () => void publish(), () => void restore(), configureDates),
        ),
        el(
          'aside',
          { class: 'project-panel project-panel--status', 'aria-label': 'Course status' },
          el('h2', { class: 'section-title project-panel__snapshot-title', text: 'Course snapshot' }),
          statTiles(data),
        ),
      ),
      publishSection,
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
    attachTutorial(root, 'instructor-course-setup', {"course-setup-path": ".course-flow", "course-setup-checklist": "#publish-panel"});
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderDashboardInner(outlet, courseId)));
  }
}

export function renderDashboard(outlet: HTMLElement, params: RouteParams): void {
  void renderDashboardInner(outlet, params.id);
}
