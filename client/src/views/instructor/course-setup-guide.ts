import {
  ApiError,
  addUrlMaterial,
  applySuggestedHierarchy,
  enqueueGenerationPlan,
  getGenerationPlan,
  type GenerationPlanCell,
  type GenerationPlanRow,
  getCourseTree,
  getContentRun,
  getInstructorWorkflow,
  getPreseeding,
  getReviewQueue,
  getSuggestedHierarchy,
  listContentRuns,
  listMaterials,
  retryMaterial,
  subscribeContentRuns,
  transitionQuestion,
  uploadMaterials,
  upsertCourseOutline,
  updateLo,
  type ContentRunSummary,
  type CourseTree,
  type InstructorWorkflowSummary,
  type Material,
  type PreseedingLo,
  type ReviewQueueItem,
  type SuggestedHierarchy,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { getSession } from '../../auth.js';
import { setButtonBusy } from '../../action-state.js';
import { uploadZone } from '../../instructor-ui.js';
import { startAnonymousPreview } from '../../preview-session.js';

type GuideScreen = 'choice' | 'objectives' | 'manual-los' | 'sources' | 'hierarchy' | 'generation' | 'review' | 'preview';

export interface CourseSetupGuideOptions {
  courseId: string;
  actionId: string;
  learningObjectiveCount: number;
  onChanged: () => void;
}

interface HierarchyDraftLo {
  checked: boolean;
  name: string;
  materialIds: string[];
}

interface HierarchyDraftTheme {
  checked: boolean;
  name: string;
  los: HierarchyDraftLo[];
}

interface GenerationRow {
  loId: string;
  loName: string;
  themeName: string;
  approved: number;
  unapproved: number;
  target: number;
  needed: number;
  hasReadySource: boolean;
  active: boolean;
}

const TERMINAL_RUN_STATUSES = new Set<ContentRunSummary['status']>(['completed', 'partial', 'failed']);
const GENERATION_TARGET = 3;

let closeActiveGuide: (() => void) | undefined;

/**
 * Convert a one-LO-per-line textarea into retry-safe outline input. Empty
 * lines, common bullet/number prefixes, and case-insensitive duplicates are
 * removed while preserving the instructor's first spelling and order.
 */
export function parseLearningObjectiveLines(value: string): string[] {
  const seen = new Set<string>();
  const parsed: string[] = [];
  for (const raw of value.split(/\r?\n/)) {
    const line = raw
      .trim()
      .replace(/^(?:[-*\u2022]\s+|\d+[.)]\s+)/, '')
      .trim();
    if (!line) continue;
    const key = line.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(line);
  }
  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

function isTerminal(run: ContentRunSummary): boolean {
  return TERMINAL_RUN_STATUSES.has(run.status);
}

function runStageLabel(stage: string): string {
  return stage
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initialScreen(actionId: string, learningObjectiveCount: number): GuideScreen {
  if (['upload-sources', 'monitor-sources', 'assign-materials', 'repair-content'].includes(actionId)) return 'sources';
  if (['build-structure'].includes(actionId)) return 'hierarchy';
  if (['seed-thin-los', 'monitor-generation'].includes(actionId)) return 'generation';
  if (actionId === 'review-questions') return 'review';
  if (actionId === 'preview-course') return 'preview';
  if (actionId === 'choose-authoring-path') return 'choice';
  return learningObjectiveCount > 0 ? 'sources' : 'choice';
}

/**
 * Open the end-to-end, dashboard-local course setup guide. The guide never
 * starts hierarchy or question generation on its own: both paid AI actions
 * require an explicit instructor click after showing their scope.
 */
export function openCourseSetupGuide(options: CourseSetupGuideOptions): void {
  closeActiveGuide?.();

  const returnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : undefined;
  const coursePath = (suffix = ''): string =>
    `/instructor/course/${encodeURIComponent(options.courseId)}${suffix}`;

  let closed = false;
  let currentScreen = initialScreen(options.actionId, options.learningObjectiveCount);
  let screenRevision = 0;
  let workflow: InstructorWorkflowSummary | undefined;
  let learningObjectiveCount = options.learningObjectiveCount;
  let materials: Material[] = [];
  let materialsLoaded = false;
  let courseTree: CourseTree | undefined;
  let preseeding: PreseedingLo[] = [];
  let reviewItems: ReviewQueueItem[] = [];
  let hierarchyDrafts: HierarchyDraftTheme[] | undefined;
  let hierarchyError = '';
  let hierarchyBusy = false;
  let applyingHierarchy = false;
  let generationBusy = false;
  let generationError = '';
  let generationMessage = '';
  let reviewError = '';
  let reviewLoading = false;
  let sourceMutationBusy = false;
  const retryingMaterials = new Set<string>();
  const approvingQuestions = new Set<string>();
  /**
   * LO -> queued run id. `null` covers the short interval before the enqueue
   * request returns. Keeping the run id prevents an older SSE snapshot for the
   * same LO from clearing the optimistic "queued" state.
   */
  const locallyQueuedRuns = new Map<string, string | null>();
  const runs = new Map<string, ContentRunSummary>();
  const terminalRefreshes = new Set<string>();

  const dialog = el('dialog', {
    class: 'app-dialog course-setup-guide',
    'aria-labelledby': 'course-setup-guide-title',
    'aria-describedby': 'course-setup-guide-description',
  }) as HTMLDialogElement;
  const progress = el('nav', {
    class: 'course-setup-guide__progress',
    'aria-label': 'Course preparation stages',
  });
  const body = el('div', { class: 'course-setup-guide__body' });
  const liveRegion = el('p', {
    class: 'course-setup-guide__live',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });
  const closeButton = el(
    'button',
    {
      class: 'icon-btn course-setup-guide__close',
      type: 'button',
      'aria-label': 'Close course setup guide',
    },
    '\u00d7',
  ) as HTMLButtonElement;

  dialog.append(
    el(
      'div',
      { class: 'app-dialog__surface course-setup-guide__surface' },
      el(
        'header',
        { class: 'course-setup-guide__header' },
        el(
          'div',
          {},
          el('p', { class: 'course-setup-guide__eyebrow', text: 'GUIDED COURSE SETUP' }),
          el('h2', { class: 'app-dialog__title course-setup-guide__title', id: 'course-setup-guide-title', text: 'Prepare this course, one step at a time' }),
          el('p', {
            class: 'app-dialog__message',
            id: 'course-setup-guide-description',
            text: 'Complete the suggested task here, or open any full workspace when you need advanced controls.',
          }),
        ),
        closeButton,
      ),
      progress,
      liveRegion,
      body,
    ),
  );

  let closeRunStream: (() => void) | undefined;

  function close(): void {
    if (closed) return;
    closed = true;
    closeRunStream?.();
    closeRunStream = undefined;
    if (closeActiveGuide === close) closeActiveGuide = undefined;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (returnFocus?.isConnected) {
      returnFocus.focus();
      return;
    }
    const fallback = document.querySelector<HTMLElement>('.view--course-project h1, main h1');
    if (fallback) {
      if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
      fallback.focus();
    }
  }

  function navigate(path: string): void {
    close();
    window.location.hash = path;
  }

  function notifyChanged(): void {
    try {
      options.onChanged();
    } catch {
      // The guide owns the mutation result. A detached dashboard callback must
      // not turn a successful save into a visible failure.
    }
  }

  function setLive(message: string, tone: 'default' | 'success' | 'error' = 'default'): void {
    liveRegion.textContent = message;
    liveRegion.className = `course-setup-guide__live course-setup-guide__live--${tone}`;
  }

  function screenHeading(title: string, description: string): HTMLElement {
    return el(
      'div',
      { class: 'course-setup-guide__screen-heading' },
      el('h3', { class: 'course-setup-guide__screen-title', 'data-guide-heading': 'true', tabindex: '-1', text: title }),
      el('p', { class: 'course-setup-guide__screen-description', text: description }),
    );
  }

  function alert(message: string, tone: 'info' | 'success' | 'error' = 'info'): HTMLElement {
    return el('p', {
      class: `course-setup-guide__alert course-setup-guide__alert--${tone}`,
      role: tone === 'error' ? 'alert' : undefined,
      text: message,
    });
  }

  function workspaceButton(label: string, path: string): HTMLButtonElement {
    return el(
      'button',
      { class: 'btn btn--ghost', type: 'button', onclick: () => navigate(path) },
      `${label} \u2197`,
    ) as HTMLButtonElement;
  }

  function actionRow(workspaceLabel: string, workspacePath: string, ...primaryActions: HTMLElement[]): HTMLElement {
    return el(
      'div',
      { class: 'course-setup-guide__actions' },
      workspaceButton(workspaceLabel, workspacePath),
      el('div', { class: 'course-setup-guide__actions-primary' }, ...primaryActions),
    );
  }

  function screenStage(screen: GuideScreen): 'sources' | 'learning-objectives' | 'questions' | 'review' | 'student-preview' {
    if (screen === 'sources' || screen === 'choice') return 'sources';
    if (screen === 'objectives' || screen === 'manual-los' || screen === 'hierarchy') return 'learning-objectives';
    if (screen === 'generation') return 'questions';
    if (screen === 'review') return 'review';
    return 'student-preview';
  }

  const stageTargets: Array<{
    id: 'sources' | 'learning-objectives' | 'questions' | 'review' | 'student-preview';
    number: number;
    label: string;
    screen: GuideScreen;
  }> = [
    { id: 'sources', number: 1, label: 'Sources', screen: 'sources' },
    { id: 'learning-objectives', number: 2, label: 'Learning objectives', screen: 'objectives' },
    { id: 'questions', number: 3, label: 'Questions', screen: 'generation' },
    { id: 'review', number: 4, label: 'Review', screen: 'review' },
    { id: 'student-preview', number: 5, label: 'Student preview', screen: 'preview' },
  ];

  function renderProgress(): void {
    const activeStage = screenStage(currentScreen);
    mount(
      progress,
      ...stageTargets.map((target) => {
        const serverStage = workflow?.setup.steps.find((step) => step.id === target.id);
        const status = serverStage?.status ?? 'not-started';
        const statusLabel: Record<typeof status, string> = {
          'not-started': 'Not started',
          blocked: 'Blocked',
          'in-progress': 'In progress',
          'needs-attention': 'Needs attention',
          ready: 'Ready',
          complete: 'Complete',
        };
        return el(
          'button',
          {
            class: `course-setup-guide__stage course-setup-guide__stage--${status}${activeStage === target.id ? ' is-active' : ''}`,
            type: 'button',
            'aria-current': activeStage === target.id ? 'step' : undefined,
            'aria-label': `${target.number}. ${target.label}${serverStage ? `: ${serverStage.detail}. Status: ${statusLabel[status]}` : ''}`,
            onclick: () => renderScreen(target.screen),
          },
          el('span', { class: 'course-setup-guide__stage-number', text: String(target.number) }),
          el(
            'span',
            { class: 'course-setup-guide__stage-copy' },
            el('strong', { text: target.label }),
            el(
              'small',
              {},
              el('span', { class: 'course-setup-guide__stage-status', text: statusLabel[status] }),
              serverStage
                ? el('span', { class: 'course-setup-guide__stage-detail', text: ` \u00b7 ${serverStage.detail}` })
                : false,
            ),
          ),
        );
      }),
    );
  }

  function renderScreen(next: GuideScreen): void {
    if (closed) return;
    currentScreen = next;
    body.classList.toggle('course-setup-guide__body--objectives', next === 'objectives' || next === 'generation');
    dialog.classList.toggle('course-setup-guide--compact', next === 'objectives' || next === 'manual-los' || next === 'generation');
    screenRevision += 1;
    sourceUi = undefined;
    generationUi = undefined;
    reviewUi = undefined;
    previewUi = undefined;
    renderProgress();
    switch (next) {
      case 'choice': renderChoiceScreen(); break;
      case 'objectives': void renderObjectivesScreen(); break;
      case 'manual-los': renderManualLoScreen(); break;
      case 'sources': renderSourcesScreen(); break;
      case 'hierarchy': renderHierarchyScreen(); break;
      case 'generation': renderGenerationScreen(); break;
      case 'review': renderReviewScreen(); break;
      case 'preview': renderPreviewScreen(); break;
    }
    window.requestAnimationFrame(() => {
      if (!closed) body.querySelector<HTMLElement>('[data-guide-heading]')?.focus();
    });
  }

  async function refreshWorkflow(): Promise<void> {
    try {
      const next = await getInstructorWorkflow(options.courseId);
      if (closed) return;
      workflow = next;
      learningObjectiveCount = next.counts.learningObjectives;
      renderProgress();
      refreshReviewPanel();
      refreshPreviewPanel();
    } catch {
      // Each setup screen remains usable through its focused endpoint even if
      // the aggregate dashboard read model is briefly unavailable.
    }
  }

  function renderChoiceScreen(): void {
    mount(
      body,
      screenHeading(
        'How do you want to define the course?',
        'Choose the path that matches what you already have. You can switch paths or edit everything later.',
      ),
      el(
        'div',
        { class: 'course-setup-guide__choices' },
        el(
          'button',
          { class: 'course-setup-guide__choice', type: 'button', onclick: () => renderScreen('manual-los') },
          el('span', { class: 'course-setup-guide__choice-icon', 'aria-hidden': 'true', text: 'LO' }),
          el(
            'span',
            {},
            el('strong', { text: 'I already have Learning Objectives' }),
            el('small', { text: 'Paste them one per line under a Topic. Duplicate lines are ignored safely.' }),
          ),
          el('span', { class: 'course-setup-guide__choice-arrow', 'aria-hidden': 'true', text: '\u2192' }),
        ),
        el(
          'button',
          { class: 'course-setup-guide__choice is-recommended', type: 'button', onclick: () => renderScreen('sources') },
          el('span', { class: 'course-setup-guide__choice-icon', 'aria-hidden': 'true', text: 'AI' }),
          el(
            'span',
            {},
            el('span', { class: 'course-setup-guide__recommended', text: 'RECOMMENDED' }),
            el('strong', { text: 'Create them from my course materials' }),
            el('small', { text: 'Upload sources first, then review and edit an AI-proposed Topic/LO structure before applying it.' }),
          ),
          el('span', { class: 'course-setup-guide__choice-arrow', 'aria-hidden': 'true', text: '\u2192' }),
        ),
      ),
      alert('Nothing is generated or saved until you explicitly confirm it.'),
      actionRow('Open Course Structure', coursePath('/structure')),
    );
  }

  async function renderObjectivesScreen(): Promise<void> {
    const revision = screenRevision;
    const content = el('div', { class: 'course-setup-guide__objectives', role: 'region', 'aria-label': 'Learning objectives by topic', tabindex: '0' });
    mount(body, screenHeading('Your learning objectives', 'Review what students should learn, then continue to questions.'), content);
    content.append(el('p', { role: 'status', text: 'Loading learning objectives…' }));
    try {
      const tree = await getCourseTree(options.courseId);
      if (closed || revision !== screenRevision) return;
      courseTree = tree;
      const topics = [...tree.themes].sort((a, b) => a.order - b.order);
      const count = topics.reduce((total, topic) => total + (topic.los?.length ?? 0), 0);
      learningObjectiveCount = count;
      const addButton = el('button', {
        class: 'btn btn--ghost', type: 'button', onclick: () => renderScreen('manual-los'),
      }, '+ Add learning objectives');
      mount(content,
        el('div', { class: 'course-setup-guide__objective-toolbar' },
          el('p', { class: 'course-setup-guide__hint', text: `${count} learning objective${count === 1 ? '' : 's'} across ${topics.length} topic${topics.length === 1 ? '' : 's'}` }),
          addButton),
        count === 0 ? el('div', { class: 'course-setup-guide__objective-empty' },
          el('h4', { text: 'What should students be able to do?' }),
          el('p', { text: 'Add your learning objectives, or create a suggested outline from your course materials.' }),
          el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderScreen('sources') }, 'Start from course materials')) : false,
        ...topics.map((topic, index) => el('section', { class: 'course-setup-guide__objective-topic', 'aria-label': topic.name },
          el('header', {}, el('span', { class: 'course-setup-guide__hint', text: `Topic ${index + 1}` }),
            el('h4', { text: topic.name })),
          ...(topic.los?.length ? [...topic.los].sort((a, b) => a.order - b.order).map((lo) => {
            const row = el('div', { class: 'course-setup-guide__objective-row' });
            const show = (): void => {
              const edit = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Edit ${lo.name}`, onclick: () => {
                const input = el('input', { class: 'input', value: lo.name, maxlength: '500', 'aria-label': 'Learning objective name' }) as HTMLInputElement;
                const error = el('p', { role: 'alert', class: 'course-setup-guide__form-error' });
                let saving = false;
                const cancel = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { show(); row.querySelector('button')?.focus(); } }, 'Cancel') as HTMLButtonElement;
                const save = el('button', { class: 'btn btn--instr-primary btn--sm', type: 'submit' }, 'Save') as HTMLButtonElement;
                const form = el('form', { class: 'course-setup-guide__objective-edit' }, input,
                  el('div', {}, cancel, save), error);
                form.addEventListener('submit', async (event) => {
                  event.preventDefault();
                  if (saving) return;
                  if (!input.value.trim()) { error.textContent = 'Enter a learning objective.'; input.focus(); return; }
                  saving = true;
                  save.disabled = cancel.disabled = input.disabled = true;
                  setButtonBusy(save, true);
                  try {
                    const updated = await updateLo(lo._id, { name: input.value.trim() }, lo.revision ?? 0);
                    lo.revision = updated.revision;
                    lo.name = updated.name;
                    notifyChanged();
                    if (closed || revision !== screenRevision) return;
                    show();
                    row.querySelector('button')?.focus();
                    setLive('Learning objective updated.', 'success');
                  } catch (caught) { error.textContent = errorMessage(caught); }
                  finally { saving = false; save.disabled = cancel.disabled = input.disabled = false; setButtonBusy(save, false); }
                });
                mount(row, form);
                input.focus();
              } }, 'Edit');
              mount(row, el('span', { text: lo.name }), edit);
            };
            show();
            return row;
          }) : [el('p', { class: 'course-setup-guide__hint', text: 'No learning objectives yet.' })]))));
      body.append(actionRow('Open Course Structure', coursePath('/structure'),
        el('button', { class: 'btn btn--instr-primary', type: 'button', disabled: count === 0, onclick: () => renderScreen('generation') }, 'Continue to questions →')));
    } catch (caught) {
      if (closed || revision !== screenRevision) return;
      mount(content, el('p', { role: 'alert', class: 'course-setup-guide__form-error', text: errorMessage(caught) }),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderScreen('objectives') }, 'Try again'));
    }
  }

  function renderManualLoScreen(): void {
    const revision = screenRevision;
    let saving = false;
    const topicInput = el('input', {
      class: 'input',
      id: 'course-setup-topic-name',
      type: 'text',
      maxlength: '160',
      value: 'Topic 1',
      placeholder: 'e.g. Time Value of Money',
    }) as HTMLInputElement;
    const topics = [...(courseTree?.themes ?? [])].sort((a, b) => a.order - b.order);
    const topicSelect = el('select', { class: 'input', id: 'course-setup-topic-selection' },
      ...topics.map((topic) => el('option', { value: topic._id, text: topic.name })),
      el('option', { value: '', text: 'Create a new topic' })) as HTMLSelectElement;
    const topicField = el('label', { class: 'form-field', for: 'course-setup-topic-name' },
      el('span', { class: 'form-field__label', text: 'Topic name' }), topicInput);
    const updateTopicField = (): void => { topicField.hidden = topicSelect.value !== ''; };
    topicSelect.addEventListener('change', updateTopicField);
    updateTopicField();
    const loInput = el('textarea', {
      class: 'input input--area course-setup-guide__lo-input',
      id: 'course-setup-lo-lines',
      rows: '8',
      placeholder: 'Explain present and future value\nCalculate the value of an annuity\nCompare nominal and effective interest rates',
    }) as HTMLTextAreaElement;
    const error = el('p', { class: 'course-setup-guide__form-error', role: 'alert', 'aria-live': 'polite' });
    const saveButton = el('button', { class: 'btn btn--instr-primary', type: 'submit' }, 'Save Learning Objectives') as HTMLButtonElement;
    const form = el(
      'form',
      { class: 'course-setup-guide__form' },
      el('label', { class: 'form-field', for: 'course-setup-topic-selection' },
        el('span', { class: 'form-field__label', text: 'Topic' }), topicSelect),
      topicField,
      el(
        'label',
        { class: 'form-field', for: 'course-setup-lo-lines' },
        el('span', { class: 'form-field__label', text: 'Learning Objectives \u2014 one per line' }),
        loInput,
        el('small', { class: 'course-setup-guide__hint', text: 'You can paste bullets or a numbered list. This step is safe to retry; existing names are reused.' }),
      ),
      error,
      actionRow(
        'Open Course Structure',
        coursePath('/structure'),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderScreen('objectives') }, 'Cancel'),
        saveButton,
      ),
    ) as HTMLFormElement;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      const topicName = topics.find((topic) => topic._id === topicSelect.value)?.name ?? topicInput.value.trim();
      const los = parseLearningObjectiveLines(loInput.value);
      error.textContent = '';
      if (!topicName) {
        error.textContent = 'Enter a Topic name.';
        topicInput.focus();
        return;
      }
      if (los.length === 0) {
        error.textContent = 'Enter at least one Learning Objective.';
        loInput.focus();
        return;
      }
      saving = true;
      topicSelect.disabled = topicInput.disabled = loInput.disabled = true;
      saveButton.disabled = true;
      setButtonBusy(saveButton, true);
      saveButton.textContent = 'Saving\u2026';
      try {
        const result = await upsertCourseOutline(options.courseId, [{ name: topicName, los }]);
        if (closed) return;
        learningObjectiveCount = Math.max(learningObjectiveCount, los.length);
        notifyChanged();
        void refreshWorkflow();
        setLive(
          result.losCreated > 0
            ? `Saved ${result.losCreated} new Learning Objective${result.losCreated === 1 ? '' : 's'}.`
            : 'Those Topic and Learning Objective names already exist; no duplicates were created.',
          'success',
        );
        if (revision === screenRevision) renderScreen('objectives');
      } catch (caught) {
        error.textContent = errorMessage(caught);
        saveButton.disabled = false;
        saveButton.textContent = 'Save Learning Objectives';
      } finally {
        saving = false;
        topicSelect.disabled = topicInput.disabled = loInput.disabled = false;
        setButtonBusy(saveButton, false);
      }
    });

    mount(
      body,
      screenHeading(
        'Add learning objectives',
        'Choose a topic and describe what students should be able to do. Add one objective per line.',
      ),
      form,
    );
  }

  interface SourceUi {
    summary: HTMLElement;
    list: HTMLElement;
    status: HTMLElement;
    processingNotice: HTMLElement;
    continueButton: HTMLButtonElement;
  }
  let sourceUi: SourceUi | undefined;

  function latestMaterialRun(material: Material): ContentRunSummary | undefined {
    const candidates = [...runs.values()].filter((run) =>
      run.kind === 'material-ingest' && run.input.materialId === material._id,
    );
    return candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  }

  function mergeMaterials(created: Material[]): void {
    const byId = new Map(materials.map((material) => [material._id, material]));
    for (const material of created) byId.set(material._id, material);
    materials = [...byId.values()];
    materialsLoaded = true;
  }

  function renderMaterialCard(material: Material): HTMLElement {
    const run = latestMaterialRun(material);
    const progressText = run && !isTerminal(run)
      ? `${runStageLabel(run.stage)}${run.totalUnits ? ` \u00b7 ${run.completedUnits}/${run.totalUnits}` : ''}`
      : material.status === 'ready'
        ? 'Ready for course setup'
        : material.status === 'failed'
          ? material.error ?? run?.error?.message ?? 'Processing failed'
          : 'Queued for processing';
    const retryButton = material.status === 'failed'
      ? el(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            disabled: retryingMaterials.has(material._id) ? 'disabled' : undefined,
            busy: retryingMaterials.has(material._id),
            onclick: () => retrySource(material),
          },
          retryingMaterials.has(material._id) ? 'Retrying\u2026' : 'Retry',
        )
      : false;
    return el(
      'article',
      { class: `course-setup-guide__source course-setup-guide__source--${material.status}` },
      el('span', { class: 'course-setup-guide__source-format', text: material.format.toUpperCase() }),
      el(
        'div',
        { class: 'course-setup-guide__source-copy' },
        el('strong', { text: material.name }),
        el(
          'small',
          { class: run && !isTerminal(run) ? 'course-setup-guide__source-progress' : undefined },
          run && !isTerminal(run) ? el('span', { class: 'spinner spinner--inline', 'aria-hidden': 'true' }) : false,
          progressText,
        ),
      ),
      el('span', { class: `course-setup-guide__status course-setup-guide__status--${material.status}`, text: material.status }),
      retryButton,
    );
  }

  function refreshSourcesPanel(): void {
    if (!sourceUi || currentScreen !== 'sources') return;
    const activeMaterials = materials
      .filter((material) => !material.deletedAt)
      .sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));
    const ready = activeMaterials.filter((material) => material.status === 'ready').length;
    const processing = activeMaterials.filter((material) => material.status === 'processing').length;
    const failed = activeMaterials.filter((material) => material.status === 'failed').length;
    mount(
      sourceUi.summary,
      el('strong', { text: `${ready} ready` }),
      el('span', { text: `${processing} processing` }),
      el('span', { text: `${failed} need attention` }),
    );
    const sourceNodes = !materialsLoaded
      ? [el('p', { class: 'course-setup-guide__empty', text: 'Loading your sources\u2026' })]
      : activeMaterials.length === 0
        ? [el('p', { class: 'course-setup-guide__empty', text: 'No sources yet. Upload a file or add a web link above.' })]
        : activeMaterials.map(renderMaterialCard);
    mount(sourceUi.list, ...sourceNodes);
    sourceUi.continueButton.disabled = ready === 0;
    sourceUi.continueButton.textContent = ready === 0
      ? (processing > 0 ? 'Waiting for a ready source\u2026' : 'Add a source to continue')
      : learningObjectiveCount > 0
        ? 'Continue to questions'
        : 'Create a draft structure';
    sourceUi.processingNotice.replaceChildren();
    if (!sourceMutationBusy && ready === 0 && processing > 0) {
      sourceUi.processingNotice.append(
        el('span', { class: 'spinner spinner--inline', 'aria-hidden': 'true' }),
        ` ${processing} source${processing === 1 ? ' is' : 's are'} still processing. This page updates as each stage completes.`,
      );
    } else if (!sourceMutationBusy && ready === 0 && failed > 0 && processing === 0) {
      sourceUi.processingNotice.textContent = 'No source is ready. Retry a failed source or add another source to continue.';
    }
  }

  async function loadSources(revision = screenRevision): Promise<void> {
    try {
      const next = await listMaterials(options.courseId);
      if (closed) return;
      materials = next;
      materialsLoaded = true;
      if (revision === screenRevision && currentScreen === 'sources') refreshSourcesPanel();
    } catch (caught) {
      if (sourceUi && revision === screenRevision && currentScreen === 'sources') {
        sourceUi.status.textContent = errorMessage(caught);
        sourceUi.status.className = 'course-setup-guide__form-error';
      }
    }
  }

  async function uploadSourceFiles(files: File[]): Promise<void> {
    if (sourceMutationBusy || files.length === 0 || !sourceUi) return;
    const ui = sourceUi;
    sourceMutationBusy = true;
    ui.status.replaceChildren(
      el('span', { class: 'spinner spinner--inline', 'aria-hidden': 'true' }),
      ` Uploading ${files.length} file${files.length === 1 ? '' : 's'}\u2026`,
    );
    try {
      const created = await uploadMaterials(options.courseId, files);
      if (closed) return;
      mergeMaterials(created);
      if (ui === sourceUi && currentScreen === 'sources') {
        ui.status.textContent = `${created.length} source${created.length === 1 ? '' : 's'} uploaded. Processing continues even if you close this guide.`;
      }
      notifyChanged();
      void refreshWorkflow();
      refreshSourcesPanel();
    } catch (caught) {
      if (ui === sourceUi && currentScreen === 'sources') {
        ui.status.textContent = errorMessage(caught);
        ui.status.className = 'course-setup-guide__form-error';
      } else if (!closed) {
        setLive(errorMessage(caught), 'error');
      }
    } finally {
      sourceMutationBusy = false;
    }
  }

  async function retrySource(material: Material): Promise<void> {
    if (retryingMaterials.has(material._id)) return;
    retryingMaterials.add(material._id);
    refreshSourcesPanel();
    try {
      const updated = await retryMaterial(material._id);
      if (closed) return;
      mergeMaterials([updated]);
      setLive(`Retry queued for ${material.name}.`, 'success');
      notifyChanged();
      refreshSourcesPanel();
    } catch (caught) {
      setLive(errorMessage(caught), 'error');
    } finally {
      retryingMaterials.delete(material._id);
      refreshSourcesPanel();
    }
  }

  function renderSourcesScreen(): void {
    const revision = screenRevision;
    const urlInput = el('input', {
      class: 'input',
      type: 'url',
      placeholder: 'https://example.com/course-reading',
      'aria-label': 'Course material URL',
    }) as HTMLInputElement;
    const urlButton = el('button', { class: 'btn btn--ghost', type: 'submit' }, 'Add link') as HTMLButtonElement;
    const status = el('p', { class: 'course-setup-guide__upload-status', role: 'status', 'aria-live': 'polite' });
    const processingNotice = el('p', { class: 'course-setup-guide__upload-status', role: 'status', 'aria-live': 'polite' });
    const summary = el('div', { class: 'course-setup-guide__source-summary' });
    const list = el('div', { class: 'course-setup-guide__source-list' });
    const continueButton = el(
      'button',
      {
        class: 'btn btn--instr-primary',
        type: 'button',
        onclick: () => renderScreen(learningObjectiveCount > 0 ? 'generation' : 'hierarchy'),
      },
      'Continue',
    ) as HTMLButtonElement;
    const urlForm = el(
      'form',
      { class: 'course-setup-guide__url-form' },
      urlInput,
      urlButton,
    ) as HTMLFormElement;
    urlForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const url = urlInput.value.trim();
      if (!url || sourceMutationBusy) return;
      sourceMutationBusy = true;
      status.replaceChildren(el('span', { class: 'spinner spinner--inline', 'aria-hidden': 'true' }), ' Adding link\u2026');
      setButtonBusy(urlButton, true);
      try {
        const created = await addUrlMaterial(options.courseId, url);
        if (closed) return;
        mergeMaterials(created);
        urlInput.value = '';
        status.textContent = 'Link added. Processing continues in the background.';
        notifyChanged();
        void refreshWorkflow();
        refreshSourcesPanel();
      } catch (caught) {
        status.textContent = errorMessage(caught);
        status.className = 'course-setup-guide__form-error';
      } finally {
        sourceMutationBusy = false;
        setButtonBusy(urlButton, false);
      }
    });

    sourceUi = { summary, list, status, processingNotice, continueButton };
    mount(
      body,
      screenHeading(
        'Add the sources the course should trust',
        'Upload lecture notes, readings, assignments, or links. FinanceBot parses, chunks, indexes, and classifies them in the background.',
      ),
      el(
        'div',
        { class: 'course-setup-guide__source-inputs' },
        uploadZone('Drop files here, or browse from your computer.', (files) => void uploadSourceFiles(files)),
        el(
          'div',
          { class: 'course-setup-guide__url-panel' },
          el('strong', { text: 'Add a web source' }),
          el('p', { text: 'Use a public course reading or reference URL.' }),
          urlForm,
        ),
      ),
      status,
      processingNotice,
      summary,
      list,
      alert('Live processing status is durable. You can close this window and return later without losing progress.'),
      actionRow(
        'Open Course Materials',
        coursePath('/materials'),
        learningObjectiveCount === 0
          ? el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderScreen('manual-los') }, 'Enter LOs instead')
          : el('span'),
        continueButton,
      ),
    );
    refreshSourcesPanel();
    if (!materialsLoaded) void loadSources(revision);
  }

  function suggestionToDrafts(suggestion: SuggestedHierarchy): HierarchyDraftTheme[] {
    return suggestion.themes.map((theme, themeIndex) => ({
      checked: true,
      name: theme.name,
      los: theme.los.map((name, loIndex) => ({
        checked: true,
        name,
        materialIds: suggestion.assignments.find(
          (assignment) => assignment.themeIndex === themeIndex && assignment.loIndex === loIndex,
        )?.materialIds ?? [],
      })),
    }));
  }

  function selectedHierarchyInput(): Array<{ name: string; los: Array<{ name: string; materialIds: string[] }> }> {
    if (!hierarchyDrafts) return [];
    return hierarchyDrafts
      .filter((theme) => theme.checked)
      .map((theme) => ({
        name: theme.name.trim(),
        los: theme.los
          .filter((lo) => lo.checked)
          .map((lo) => ({ name: lo.name.trim(), materialIds: lo.materialIds })),
      }));
  }

  function validateHierarchySelection(): string | undefined {
    const selected = selectedHierarchyInput();
    if (selected.length === 0) return 'Select at least one Topic.';
    for (const theme of selected) {
      if (!theme.name) return 'Every selected Topic needs a name.';
      if (theme.los.length === 0) return `Select at least one Learning Objective under "${theme.name}".`;
      if (theme.los.some((lo) => !lo.name)) return `Every selected Learning Objective under "${theme.name}" needs a name.`;
    }
    return undefined;
  }

  async function requestHierarchySuggestion(): Promise<void> {
    if (hierarchyBusy) return;
    hierarchyBusy = true;
    hierarchyError = '';
    renderHierarchyScreen();
    try {
      const suggestion = await getSuggestedHierarchy(options.courseId);
      if (closed) return;
      hierarchyDrafts = suggestionToDrafts(suggestion);
      if (hierarchyDrafts.length === 0) hierarchyError = 'No structure could be suggested from the ready sources. Try adding a more detailed source or enter LOs manually.';
    } catch (caught) {
      hierarchyError = errorMessage(caught);
    } finally {
      hierarchyBusy = false;
      if (!closed && currentScreen === 'hierarchy') renderHierarchyScreen();
    }
  }

  async function applyHierarchy(): Promise<void> {
    if (applyingHierarchy) return;
    const validation = validateHierarchySelection();
    if (validation) {
      hierarchyError = validation;
      renderHierarchyScreen();
      return;
    }
    applyingHierarchy = true;
    hierarchyError = '';
    renderHierarchyScreen();
    try {
      const selected = selectedHierarchyInput();
      const result = await applySuggestedHierarchy(options.courseId, { themes: selected });
      if (closed) return;
      learningObjectiveCount = Math.max(
        learningObjectiveCount,
        selected.reduce((count, theme) => count + theme.los.length, 0),
      );
      hierarchyDrafts = undefined;
      notifyChanged();
      void refreshWorkflow();
      setLive(
        `Applied ${result.losCreated} new Learning Objective${result.losCreated === 1 ? '' : 's'} and ${result.assignmentsCreated} source assignment${result.assignmentsCreated === 1 ? '' : 's'}.`,
        'success',
      );
      renderScreen('generation');
    } catch (caught) {
      hierarchyError = errorMessage(caught);
      applyingHierarchy = false;
      if (!closed) renderHierarchyScreen();
    }
  }

  function hierarchyEditor(): HTMLElement {
    if (!hierarchyDrafts) return el('div');
    return el(
      'div',
      { class: 'course-setup-guide__hierarchy' },
      ...hierarchyDrafts.map((theme, themeIndex) => {
        const themeCheckbox = el('input', {
          type: 'checkbox',
          'aria-label': `Include suggested Topic ${themeIndex + 1}`,
        }) as HTMLInputElement;
        themeCheckbox.checked = theme.checked;
        const themeNameInput = el('input', {
          class: 'input',
          type: 'text',
          value: theme.name,
          'aria-label': `Suggested Topic ${themeIndex + 1} name`,
          oninput: (event: Event) => { theme.name = (event.target as HTMLInputElement).value; },
        }) as HTMLInputElement;
        const loControls = theme.los.map((lo, loIndex) => {
          const checkbox = el('input', {
            type: 'checkbox',
            'aria-label': `Include suggested Topic ${themeIndex + 1} Learning Objective ${loIndex + 1}`,
          }) as HTMLInputElement;
          checkbox.checked = lo.checked;
          const nameInput = el('input', {
            class: 'input',
            type: 'text',
            value: lo.name,
            'aria-label': `Suggested Topic ${themeIndex + 1} Learning Objective ${loIndex + 1} name`,
            oninput: (event: Event) => { lo.name = (event.target as HTMLInputElement).value; },
          }) as HTMLInputElement;
          return {
            lo,
            checkbox,
            nameInput,
            row: el(
              'div',
              { class: 'course-setup-guide__draft-lo' },
              checkbox,
              nameInput,
              el('small', { text: `${lo.materialIds.length} matched source${lo.materialIds.length === 1 ? '' : 's'}` }),
            ),
          };
        });
        const section = el(
          'section',
          { class: `course-setup-guide__draft-theme${theme.checked ? '' : ' is-disabled'}` },
          el(
            'div',
            { class: 'course-setup-guide__draft-title' },
            themeCheckbox,
            themeNameInput,
          ),
          el(
            'div',
            { class: 'course-setup-guide__draft-los' },
            ...loControls.map((control) => control.row),
          ),
        );
        const syncControls = (): void => {
          section.classList.toggle('is-disabled', !theme.checked);
          themeNameInput.disabled = !theme.checked;
          for (const control of loControls) {
            control.checkbox.disabled = !theme.checked;
            control.checkbox.checked = control.lo.checked;
            control.nameInput.disabled = !theme.checked || !control.lo.checked;
          }
        };
        themeCheckbox.addEventListener('change', () => {
          theme.checked = themeCheckbox.checked;
          for (const control of loControls) control.lo.checked = theme.checked;
          syncControls();
        });
        for (const control of loControls) {
          control.checkbox.addEventListener('change', () => {
            control.lo.checked = control.checkbox.checked;
            syncControls();
          });
        }
        syncControls();
        return section;
      }),
    );
  }

  function renderHierarchyScreen(): void {
    const revision = screenRevision;
    const readySources = materials.filter((material) => !material.deletedAt && material.status === 'ready').length;
    const generateButton = el(
      'button',
      {
        class: 'btn btn--instr-primary',
        type: 'button',
        disabled: hierarchyBusy || (materialsLoaded && readySources === 0) ? 'disabled' : undefined,
        busy: hierarchyBusy,
        onclick: () => requestHierarchySuggestion(),
      },
      hierarchyBusy ? 'Generating AI draft\u2026' : 'Generate an AI draft',
    );
    const content = hierarchyDrafts
      ? [
          alert('Review every selected Topic and Learning Objective. Nothing below is part of the course until you apply it.'),
          hierarchyEditor(),
          hierarchyError ? alert(hierarchyError, 'error') : false,
          actionRow(
            'Open Course Structure',
            coursePath('/structure'),
            el('button', { class: 'btn btn--ghost', type: 'button', disabled: applyingHierarchy ? 'disabled' : undefined, onclick: () => { hierarchyDrafts = undefined; renderHierarchyScreen(); } }, 'Discard draft'),
            el('button', { class: 'btn btn--instr-primary', type: 'button', busy: applyingHierarchy, onclick: () => applyHierarchy() }, applyingHierarchy ? 'Applying\u2026' : 'Apply selected structure'),
          ),
        ]
      : [
          el(
            'div',
            { class: 'course-setup-guide__ai-step' },
            el('span', { class: 'course-setup-guide__ai-icon', 'aria-hidden': 'true', text: '\u2726' }),
            el(
              'div',
              {},
              el('h4', { text: 'Create an editable draft from ready sources' }),
              el('p', { text: 'This is an AI action and may incur model cost. It will only run after you press the button. You will review the complete draft before anything is saved.' }),
            ),
            generateButton,
          ),
          materialsLoaded && readySources === 0
            ? alert('At least one processed source is required before FinanceBot can propose a structure.', 'error')
            : materialsLoaded
              ? alert(`${readySources} ready source${readySources === 1 ? '' : 's'} will be used.`, 'success')
              : alert('Checking for ready sources\u2026'),
          hierarchyError ? alert(hierarchyError, 'error') : false,
          actionRow(
            'Open Course Structure',
            coursePath('/structure'),
            el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderScreen('manual-los') }, 'Enter LOs manually'),
              ),
        ];
    mount(
      body,
      screenHeading(
        'Build and confirm the course structure',
        'FinanceBot can propose Topics, Learning Objectives, and source mappings. You remain in control of every selected item.',
      ),
      ...content.filter((node): node is HTMLElement => node instanceof HTMLElement),
    );
    if (!materialsLoaded) {
      void listMaterials(options.courseId).then((next) => {
        if (closed) return;
        materials = next;
        materialsLoaded = true;
        if (currentScreen === 'hierarchy' && revision === screenRevision) renderHierarchyScreen();
      }).catch((caught: unknown) => {
        hierarchyError = errorMessage(caught);
        materialsLoaded = true;
        if (!closed && currentScreen === 'hierarchy' && revision === screenRevision) renderHierarchyScreen();
      });
    }
  }

  interface GenerationUi {
    summary: HTMLElement;
    list: HTMLElement;
    runs: HTMLElement;
    status: HTMLElement;
    generateButton: HTMLButtonElement;
    selection: HTMLElement;
    planSummary: HTMLElement;
  }
  let generationUi: GenerationUi | undefined;

  // The batch planner: a grid of counts per LO x tier x kind. `planRows` is
  // the server's Auto plan (per-tier approved counts and the cells that reach
  // the tier targets); `plan` is the instructor's editable copy. Auto resets
  // it; any stepper edit marks it dirty so a background refresh does not
  // overwrite what they typed.
  type Tier = 'easy' | 'medium' | 'hard';
  type Kind = 'calculation' | 'conceptual';
  type PlanCounts = Record<Tier, Record<Kind, number>>;
  const TIERS: Tier[] = ['easy', 'medium', 'hard'];
  const KINDS: Kind[] = ['calculation', 'conceptual'];
  let planRows: GenerationPlanRow[] = [];
  let plan = new Map<string, PlanCounts>();
  let planDirty = false;
  let generationLoaded = false;
  let additionalQuestions = false;
  let perObjectiveCount = 0;
  let generationPrompt = '';
  const deselectedObjectives = new Set<string>();
  type Submission = { submissionId: string; cells: GenerationPlanCell[]; prompt: string; runIds?: string[] };
  const submissionKey = `guided-generation:${getSession().user?.puid ?? 'anonymous'}:${options.courseId}`;
  let submission: Submission | undefined;
  function readSubmission(): void {
    try { submission = JSON.parse(localStorage.getItem(submissionKey) ?? 'null') ?? undefined; } catch { /* Keep the in-memory request when storage is unavailable. */ }
  }
  function storeSubmission(): void {
    try { if (submission) localStorage.setItem(submissionKey, JSON.stringify(submission)); else localStorage.removeItem(submissionKey); } catch { /* Server idempotency still protects in-session retries. */ }
  }
  readSubmission();
  function submissionActive(): boolean {
    return !!submission && (!submission.runIds || submission.runIds.some(id => !runs.has(id) || !isTerminal(runs.get(id)!)));
  }
  function plannedCells(): GenerationPlanCell[] {
    return planCellsFor(new Set(generationRows().filter(row => row.hasReadySource && !row.active && !deselectedObjectives.has(row.loId)).map(row => row.loId)));
  }


  function emptyCounts(): PlanCounts {
    return { easy: { calculation: 0, conceptual: 0 }, medium: { calculation: 0, conceptual: 0 }, hard: { calculation: 0, conceptual: 0 } };
  }
  function autoCounts(row: GenerationPlanRow): PlanCounts {
    const counts = emptyCounts();
    for (const cell of row.cells) counts[cell.difficulty][cell.kind] += cell.count;
    const pending = preseeding.find(item => item.loId === row.loId)?.unapproved ?? 0;
    if (!additionalQuestions) {
      let remaining = pending;
      for (const tier of TIERS) for (const kind of KINDS) {
        const used = Math.min(remaining, counts[tier][kind]);
        counts[tier][kind] -= used; remaining -= used;
      }
    }
    if (perObjectiveCount > 0 || additionalQuestions) {
      const current = TIERS.reduce((sum, tier) => sum + counts[tier].calculation + counts[tier].conceptual, 0);
      const target = additionalQuestions ? (perObjectiveCount || 5) : Math.min(current, perObjectiveCount);
      for (const tier of TIERS) for (const kind of KINDS) counts[tier][kind] = 0;
      for (let i = 0; i < target; i++) {
        const tier = (['easy', 'medium', 'easy', 'medium', 'hard'] as Tier[])[i % 5];
        const kind = row.loKind === 'calculation' ? 'calculation' : row.loKind === 'conceptual' ? 'conceptual' : i % 2 ? 'calculation' : 'conceptual';
        counts[tier][kind]++;
      }
    }
    return counts;
  }
  function resetPlanToAuto(): void {
    plan = new Map(planRows.map((row) => [row.loId, autoCounts(row)]));
    planDirty = false;
  }
  function planCellsFor(loIds: Set<string>): GenerationPlanCell[] {
    const cells: GenerationPlanCell[] = [];
    for (const [loId, counts] of plan) {
      if (!loIds.has(loId)) continue;
      for (const tier of TIERS) for (const kind of KINDS) {
        const count = counts[tier][kind];
        if (count > 0) cells.push({ loId, difficulty: tier, kind, count });
      }
    }
    return cells;
  }

  function activeGenerationFor(loId: string): boolean {
    if (locallyQueuedRuns.has(loId)) return true;
    return [...runs.values()].some((run) =>
      run.kind === 'question-generation' && run.input.loId === loId && !isTerminal(run),
    );
  }

  function generationRows(): GenerationRow[] {
    if (!courseTree) return [];
    const coverage = new Map(preseeding.map((row) => [row.loId, row]));
    return courseTree.themes.flatMap((theme) => (theme.los ?? []).map((lo) => {
      const row = coverage.get(lo._id);
      const hasReadySource = materials.some((material) =>
        !material.deletedAt
        && material.status === 'ready'
        && material.assignments.some((assignment) =>
          assignment.loId === lo._id || (assignment.themeId === theme._id && !assignment.loId),
        ),
      );
      return {
        loId: lo._id,
        loName: lo.name,
        themeName: theme.name,
        approved: row?.approved ?? 0,
        unapproved: row?.unapproved ?? 0,
        target: Math.max(row?.target ?? GENERATION_TARGET, GENERATION_TARGET),
        needed: Math.max(
          0,
          Math.max(row?.target ?? GENERATION_TARGET, GENERATION_TARGET)
            - (row?.approved ?? 0)
            - (row?.unapproved ?? 0),
        ),
        hasReadySource,
        active: activeGenerationFor(lo._id),
      };
    }));
  }

  function renderGenerationRuns(): HTMLElement[] {
    return [...runs.values()]
      .filter((run) => run.kind === 'question-generation')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 6)
      .map((run) => {
        const progress = run.totalUnits ? `${run.completedUnits}/${run.totalUnits}` : String(run.completedUnits);
        const detail = run.error?.message ?? `${runStageLabel(run.stage)} \u00b7 ${progress}`;
        return el(
          'div',
          { class: `course-setup-guide__run course-setup-guide__run--${run.status}` },
          el('span', { class: 'course-setup-guide__run-dot', 'aria-hidden': 'true' }),
          el(
            'span',
            {},
            el('strong', { text: `Run ${run._id.slice(-8)}` }),
            el('small', { text: detail }),
          ),
          el('span', { class: 'course-setup-guide__run-status', text: run.status }),
        );
      });
  }

  /** One LO of the planner: coverage per tier and a stepper per tier x kind. */
  function renderPlanRow(row: GenerationRow): HTMLElement {
    const auto = planRows.find((candidate) => candidate.loId === row.loId);
    const counts = plan.get(row.loId) ?? (auto ? autoCounts(auto) : emptyCounts());
    if (!plan.has(row.loId)) plan.set(row.loId, counts);
    const editable = row.hasReadySource && !row.active && !submissionActive();
    const planned = TIERS.reduce((sum, tier) => sum + counts[tier].calculation + counts[tier].conceptual, 0);
    const tierCells = TIERS.map((tier) => {
      const approved = auto?.approved[tier] ?? 0;
      const inputs = KINDS.map((kind) => {
        const input = el('input', {
          class: 'input course-setup-guide__plan-count',
          type: 'number', min: '0', max: '20', value: String(counts[tier][kind]),
          'aria-label': `${row.loName}: ${tier} ${kind} questions`,
          ...(editable ? {} : { disabled: 'disabled' }),
        }) as HTMLInputElement;
        input.onchange = () => {
          counts[tier][kind] = Math.max(0, Math.min(20, Math.floor(Number(input.value) || 0)));
          input.value = String(counts[tier][kind]);
          planDirty = true;
          refreshGenerationPanel();
        };
        return el('label', { class: 'course-setup-guide__plan-kind' }, el('small', { text: kind === 'calculation' ? 'calc' : 'concept' }), input);
      });
      return el(
        'div',
        { class: 'course-setup-guide__plan-tier' },
        el('small', { text: `${tier} \u00b7 ${approved} approved` }),
        el('div', { class: 'course-setup-guide__plan-kinds' }, ...inputs),
      );
    });
    return el(
      'article',
      { class: `course-setup-guide__generation-row${row.approved >= row.target ? ' is-complete' : ''}` },
      el(
        'div',
        { class: 'course-setup-guide__generation-copy' },
        el('small', { text: `${row.themeName} \u00b7 ${auto?.loKind ?? 'mixed'}` }),
        el('strong', { text: row.loName }),
        el('span', {
          class: `course-setup-guide__eligibility${row.hasReadySource ? ' is-ready' : ''}`,
          text: row.active
            ? 'Generating\u2026'
            : row.hasReadySource
              ? planned > 0 ? `${planned} planned` : 'Nothing planned'
              : 'Needs a ready assigned source',
        }),
      ),
      el('div', { class: 'course-setup-guide__plan-grid' }, ...tierCells),
    );
  }

  function refreshGenerationPanel(): void {
    if (!generationUi || currentScreen !== 'generation') return;
    const rows = generationRows();
    const active = rows.filter(row => row.active).length;
    const awaitingReview = rows.reduce((count, row) => count + row.unapproved, 0);
    const approved = rows.reduce((count, row) => count + row.approved, 0);
    mount(generationUi.summary,
      el('span', { text: `${approved} approved objective assignments` }),
      el('span', { text: `${awaitingReview} awaiting-review objective assignments` }),
      el('span', { text: `${active} objectives in progress` }));
    mount(generationUi.selection, ...rows.map(row => el('label', { class: 'guide-composer__objective' },
      el('input', { type: 'checkbox', checked: !deselectedObjectives.has(row.loId), disabled: !row.hasReadySource || row.active || submissionActive(),
        onchange: (event: Event) => { if ((event.target as HTMLInputElement).checked) deselectedObjectives.delete(row.loId); else deselectedObjectives.add(row.loId); refreshGenerationPanel(); } }),
      el('span', {}, el('strong', { text: row.loName }), el('small', { text: row.active ? 'In progress' : !row.hasReadySource ? 'Assign a ready source to continue' : `${row.themeName} · ${row.approved} approved · ${row.unapproved} awaiting review` })))));
    mount(generationUi.list, ...rows.filter(row => !deselectedObjectives.has(row.loId)).map(row => renderPlanRow(row)));
    const cells = plannedCells();
    const total = cells.reduce((sum, cell) => sum + cell.count, 0);
    const objectives = new Set(cells.map(cell => cell.loId)).size;
    mount(generationUi.planSummary,
      el('strong', { text: submissionActive() ? 'Your submitted batch is still in progress' : `${total} question${total === 1 ? '' : 's'} across ${objectives} learning objective${objectives === 1 ? '' : 's'}` }),
      el('p', { text: !generationLoaded ? 'Loading objectives and sources…' : total === 0 && awaitingReview > 0 ? 'Review existing drafts before adding more. You can explicitly request additional questions below.' : 'Questions are saved as drafts for your review. Student access still requires approval and release.' }));
    mount(generationUi.runs, ...renderGenerationRuns());
    setButtonBusy(generationUi.generateButton, generationBusy);
    generationUi.generateButton.disabled = generationBusy || !generationLoaded || (!!submission?.runIds && submissionActive()) || (!submissionActive() && total === 0);
    generationUi.generateButton.textContent = generationBusy ? 'Submitting…' : submission && !submission.runIds ? 'Resume submission' : submissionActive() ? 'Generation in progress' : 'Generate questions';
    body.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('.guide-composer__fields input, .guide-composer__fields select, .guide-composer__fields textarea, .guide-composer__additional input').forEach(control => { control.disabled = generationBusy || submissionActive(); });
    const reload = body.querySelector<HTMLElement>('[data-generation-reload]');
    if (reload) reload.hidden = !generationError;
    generationUi.status.textContent = generationError || generationMessage;
    generationUi.status.className = generationError
      ? 'course-setup-guide__form-error'
      : 'course-setup-guide__upload-status';
  }

  async function loadGenerationData(revision = screenRevision): Promise<void> {
    try {
      const [tree, materialRows, coverage, recentRuns, autoPlan] = await Promise.all([
        getCourseTree(options.courseId),
        listMaterials(options.courseId),
        getPreseeding(options.courseId),
        Promise.all([listContentRuns(options.courseId, { kind: 'question-generation', limit: 30 }), listContentRuns(options.courseId, { kind: 'question-generation', status: 'queued' }), listContentRuns(options.courseId, { kind: 'question-generation', status: 'running' }), ...(submission?.runIds ?? []).map(id => getContentRun(options.courseId, id).then(run => [run]))]).then(groups => groups.flat()),
        getGenerationPlan(options.courseId),
      ]);
      if (closed) return;
      courseTree = tree;
      materials = materialRows;
      materialsLoaded = true;
      preseeding = coverage;
      planRows = autoPlan;
      generationLoaded = true;
      generationError = '';
      if (!planDirty) resetPlanToAuto();
      learningObjectiveCount = tree.themes.reduce((count, theme) => count + (theme.los?.length ?? 0), 0);
      for (const run of recentRuns) runs.set(run._id, run);
      if (revision === screenRevision && currentScreen === 'generation') refreshGenerationPanel();
    } catch (caught) {
      generationError = errorMessage(caught);
      if (revision === screenRevision && currentScreen === 'generation') refreshGenerationPanel();
    }
  }

  async function generateStarterQuestions(): Promise<void> {
    if (generationBusy) return;
    readSubmission();
    if (submission?.runIds && submissionActive()) { refreshGenerationPanel(); return; }
    const revision = screenRevision;
    const cells = submission && !submission.runIds ? submission.cells : plannedCells();
    if (cells.length === 0) return;
    const eligible = [...new Set(cells.map((cell) => cell.loId))].map((loId) => ({ loId }));
    if (!submission || submission.runIds) submission = { submissionId: crypto.randomUUID(), cells, prompt: generationPrompt };
    storeSubmission();
    generationBusy = true;
    generationError = '';
    generationMessage = '';
    for (const row of eligible) locallyQueuedRuns.set(row.loId, null);
    refreshGenerationPanel();
    let planResult: Awaited<ReturnType<typeof enqueueGenerationPlan>>;
    try {
      planResult = await enqueueGenerationPlan(options.courseId, cells, { submissionId: submission.submissionId, prompt: submission.prompt });
    } catch (caught) {
      if (closed) return;
      generationBusy = false;
      generationError = errorMessage(caught);
      for (const row of eligible) locallyQueuedRuns.delete(row.loId);
      refreshGenerationPanel();
      return;
    }
    if (closed) return;
    // One run per cell; an LO is "queued" if any of its cells started, and a
    // cell that could not start is reported by name so the instructor sees
    // exactly what did not happen.
    const started = planResult.runs.filter((run) => run.runId);
    const failed = planResult.runs.filter((run) => !run.runId);
    submission.runIds = started.map(run => run.runId!);
    storeSubmission();
    planDirty = false;
    for (const { loId } of eligible) {
      const firstRun = started.find((run) => run.loId === loId);
      if (!firstRun?.runId) { locallyQueuedRuns.delete(loId); continue; }
      if (runs.get(firstRun.runId)) locallyQueuedRuns.delete(loId);
      else locallyQueuedRuns.set(loId, firstRun.runId);
    }
    const queuedQuestions = started.reduce((sum, run) => sum + run.count, 0);
    generationBusy = false;
    generationMessage = started.length > 0
      ? `Your batch of ${queuedQuestions} questions has been submitted. Drafts will appear here as they become ready.`
      : '';
    if (failed.length > 0) {
      const byLo = new Map<string, string>();
      for (const run of failed) byLo.set(run.loId, run.error ?? 'could not start');
      const names = [...byLo].map(([loId, error]) =>
        `${generationRows().find((row) => row.loId === loId)?.loName ?? loId} (${error})`);
      generationError = `${failed.length} cell${failed.length === 1 ? '' : 's'} could not be queued: ${names.join('; ')}. You can retry safely.`;
    }
    notifyChanged();
    void refreshWorkflow();
    try {
      const recent = await listContentRuns(options.courseId, { kind: 'question-generation', limit: 30 });
      if (!closed) for (const run of recent) runs.set(run._id, run);
    } catch {
      // SSE will still deliver the durable run snapshot.
    }
    refreshGenerationPanel();
    if (started.length && !closed && revision === screenRevision && currentScreen === 'generation') {
      renderScreen('review');
      setLive(generationError || generationMessage, generationError ? 'error' : 'default');
    }
  }

  function renderGenerationScreen(): void {
    generationLoaded = false;
    const revision = screenRevision;
    const summary = el('div', { class: 'course-setup-guide__source-summary' });
    const list = el('div', { class: 'course-setup-guide__generation-list' });
    const selection = el('div', { class: 'guide-composer__objectives' });
    const planSummary = el('div', { class: 'guide-composer__summary', role: 'status' });
    const runList = el('div');
    const status = el('p', { class: 'course-setup-guide__upload-status', role: 'status' });
    const generateButton = el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: () => generateStarterQuestions() }, 'Generate questions') as HTMLButtonElement;
    const count = el('select', { class: 'input', 'aria-label': 'Questions per objective', onchange: (event: Event) => {
      perObjectiveCount = Number((event.target as HTMLSelectElement).value); resetPlanToAuto(); refreshGenerationPanel();
    } }, ...[0, 3, 5, 10].map(value => el('option', { value: String(value), selected: value === perObjectiveCount, text: value ? `Up to ${value} per objective` : 'Recommended: fill remaining gaps' })));
    const instructions = el('textarea', { class: 'input', rows: '2', maxlength: '4000', 'aria-label': 'Optional instructions', placeholder: 'e.g. Use short practical scenarios and focus on common misconceptions.', oninput: (event: Event) => { generationPrompt = (event.target as HTMLTextAreaElement).value; } }, generationPrompt);
    generationUi = { summary, list, selection, planSummary, runs: runList, status, generateButton };
    mount(body,
      screenHeading('Generate questions', 'Choose what students should practise. We suggest a balanced mix of questions.'),
      planSummary,
      el('details', { class: 'guide-composer__details' }, el('summary', { text: 'Choose learning objectives' }), selection),
      el('div', { class: 'guide-composer__fields' },
        el('label', {}, el('span', { text: 'Questions per objective' }), count),
        el('label', {}, el('span', { text: 'Optional instructions' }), instructions)),
      el('details', { class: 'guide-composer__details' }, el('summary', { text: 'Customize distribution & existing supply' }),
        summary,
        el('label', { class: 'guide-composer__additional' }, el('input', { type: 'checkbox', checked: additionalQuestions, onchange: (event: Event) => { additionalQuestions = (event.target as HTMLInputElement).checked; resetPlanToAuto(); refreshGenerationPanel(); } }), 'Generate additional questions beyond existing supply'),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { resetPlanToAuto(); refreshGenerationPanel(); } }, 'Reset to suggested mix'), list),
      el('details', { class: 'guide-composer__details' }, el('summary', { text: 'Generation activity' }), runList,
        workspaceButton('Open generation workspace for stop and retry controls', coursePath('/preseeding'))),
      status,
      el('button', { class: 'btn btn--ghost', type: 'button', 'data-generation-reload': 'true', hidden: true, onclick: () => loadGenerationData() }, 'Retry loading'),
      el('p', { class: 'course-setup-guide__hint', text: 'Uses AI generation. Starts only when you submit this plan.' }),
      actionRow('Review existing questions', coursePath('/queue'),
        generateButton),
      el('div', { class: 'guide-composer__links' }, workspaceButton('Sources', coursePath('/materials')), workspaceButton('Advanced workspace & import', coursePath('/preseeding'))));
    const heading = body.firstElementChild!;
    const footer = body.querySelector('.course-setup-guide__actions')!;
    const content = el('div', { class: 'guide-composer__content', role: 'region', 'aria-label': 'Generation settings', tabindex: '0' });
    for (const child of Array.from(body.children)) if (child !== heading && child !== footer) content.append(child);
    body.replaceChildren(heading, content, footer);
    refreshGenerationPanel();
    void loadGenerationData(revision);
  }

  interface ReviewUi {
    list: HTMLElement;
    status: HTMLElement;
    previewButton: HTMLButtonElement;
  }
  let reviewUi: ReviewUi | undefined;

  function refreshReviewPanel(): void {
    if (!reviewUi || currentScreen !== 'review') return;
    const reviewNodes = reviewLoading
      ? [el('p', { class: 'course-setup-guide__empty', text: 'Loading the review queue\u2026' })]
      : reviewItems.length === 0
        ? workflow?.counts.totalQuestions
          ? [el(
                'div',
                { class: 'course-setup-guide__complete-state' },
                el('span', { 'aria-hidden': 'true', text: '\u2713' }),
                el('strong', { text: 'No questions are waiting for review' }),
                el('p', { text: 'All current questions have moved out of the review queue.' }),
              )]
          : [el(
                'div',
                { class: 'course-setup-guide__empty' },
                el('strong', { text: workflow ? 'No questions have been created yet' : 'Checking the course question count\u2026' }),
                el('p', { text: 'Create a small grounded starter set in Step 3, then return here to review it.' }),
              )]
        : reviewItems.slice(0, 10).map((item) => {
            const requiresFullReview = item.state === 'paused' || item.labels.includes('student-flagged');
            const stemSummary = item.current.stem.length > 72
              ? `${item.current.stem.slice(0, 69)}\u2026`
              : item.current.stem;
            return el(
                'article',
                { class: `course-setup-guide__review-item${requiresFullReview ? ' needs-full-review' : ''}` },
                el(
                  'div',
                  { class: 'course-setup-guide__review-copy' },
                  el(
                    'div',
                    { class: 'course-setup-guide__review-meta' },
                    el('span', { text: item.current.type === 'true-false' ? 'True / False' : 'Multiple choice' }),
                    el('span', { text: item.current.difficulty }),
                    el('span', { text: item.state.replace('-', ' ') }),
                    el('span', { text: `${item.current.sourceRefs.length} source reference${item.current.sourceRefs.length === 1 ? '' : 's'}` }),
                    ...item.labels.map((label) => el('span', { text: label.replace('-', ' ') })),
                  ),
                  el('strong', { text: item.current.stem }),
                  el(
                    'ul',
                    { class: 'course-setup-guide__review-options', 'aria-label': 'Answer options' },
                    ...item.current.options.map((option) => {
                      const roleLabel: Record<typeof option.role, string> = {
                        correct: 'Correct answer',
                        'common-misconception': 'Common misconception',
                        'partially-correct': 'Partially correct',
                        'clearly-wrong': 'Incorrect',
                      };
                      return el(
                        'li',
                        { class: option.role === 'correct' ? 'is-correct' : '' },
                        el('span', { class: 'course-setup-guide__option-key', text: option.key }),
                        el(
                          'span',
                          { class: 'course-setup-guide__option-copy' },
                          el('span', { text: option.text }),
                          option.explanation
                            ? el('small', { text: option.explanation })
                            : false,
                        ),
                        el('span', { class: 'course-setup-guide__option-role', text: roleLabel[option.role] }),
                      );
                    }),
                  ),
                ),
                el(
                  'button',
                  {
                    class: `btn ${requiresFullReview ? 'btn--ghost' : 'btn--instr-primary'} btn--sm`,
                    type: 'button',
                    disabled: approvingQuestions.has(item.id) ? 'disabled' : undefined,
                    'aria-label': requiresFullReview
                      ? `Review flagged question in full queue: ${stemSummary}`
                      : `Approve for students: ${stemSummary}`,
                    onclick: () => {
                      if (requiresFullReview) {
                        navigate(`${coursePath('/bank')}/${encodeURIComponent(item.id)}?from=queue`);
                        return;
                      }
                      void approveQuestion(item);
                    },
                  },
                  requiresFullReview
                    ? 'Review in full queue \u2197'
                    : approvingQuestions.has(item.id)
                      ? 'Approving\u2026'
                      : 'Approve for students',
                ),
              );
          });
    mount(reviewUi.list, ...reviewNodes);
    reviewUi.status.textContent = reviewError;
    const canPreview = (workflow?.counts.approvedQuestions ?? 0) > 0;
    reviewUi.previewButton.disabled = !canPreview;
    reviewUi.previewButton.textContent = workflow === undefined
      ? 'Checking preview readiness\u2026'
      : canPreview
        ? 'Preview as a student \u2192'
        : 'Approve a question to preview';
  }

  async function loadReview(revision = screenRevision): Promise<void> {
    reviewLoading = true;
    refreshReviewPanel();
    try {
      const next = await getReviewQueue(options.courseId);
      if (closed) return;
      reviewItems = next;
      reviewError = '';
    } catch (caught) {
      reviewError = errorMessage(caught);
    } finally {
      reviewLoading = false;
      if (revision === screenRevision && currentScreen === 'review') refreshReviewPanel();
    }
  }

  async function approveQuestion(item: ReviewQueueItem): Promise<void> {
    if (approvingQuestions.has(item.id)) return;
    approvingQuestions.add(item.id);
    reviewError = '';
    refreshReviewPanel();
    try {
      await transitionQuestion(item.id, 'approved', item.current._id);
      if (closed) return;
      reviewItems = reviewItems.filter((candidate) => candidate.id !== item.id);
      setLive('Question approved for student use.', 'success');
      notifyChanged();
      void refreshWorkflow();
    } catch (caught) {
      reviewError = errorMessage(caught);
    } finally {
      approvingQuestions.delete(item.id);
      refreshReviewPanel();
    }
  }

  function renderReviewScreen(): void {
    const revision = screenRevision;
    const list = el('div', { class: 'course-setup-guide__review-list' });
    const status = el('p', { class: 'course-setup-guide__form-error', role: 'alert', 'aria-live': 'polite' });
    const previewButton = el(
      'button',
      { class: 'btn btn--instr-primary', type: 'button', onclick: () => renderScreen('preview') },
      'Checking preview readiness\u2026',
    ) as HTMLButtonElement;
    reviewUi = { list, status, previewButton };
    mount(
      body,
      screenHeading(
        'Review before students can see anything',
        'Approve questions one at a time here. Use the full Review Queue for editing, agent reports, filters, and bulk actions.',
      ),
      list,
      status,
      actionRow(
        'Open full Review Queue',
        coursePath('/queue'),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderScreen('generation') }, 'Back to generation'),
        previewButton,
      ),
    );
    refreshReviewPanel();
    void loadReview(revision);
  }

  function openStudentPreview(): void {
    if ((workflow?.counts.approvedQuestions ?? 0) === 0) return;
    startAnonymousPreview(options.courseId);
    navigate(`/preview/course/${encodeURIComponent(options.courseId)}`);
  }

  interface PreviewUi {
    status: HTMLElement;
    previewButton: HTMLButtonElement;
  }
  let previewUi: PreviewUi | undefined;

  function refreshPreviewPanel(): void {
    if (!previewUi || currentScreen !== 'preview') return;
    const approved = workflow?.counts.approvedQuestions;
    const canPreview = (approved ?? 0) > 0;
    previewUi.previewButton.disabled = !canPreview;
    previewUi.previewButton.textContent = approved === undefined
      ? 'Checking approved questions\u2026'
      : canPreview
        ? 'Open real Student Preview \u2192'
        : 'Approve a question before preview';
    previewUi.status.className = canPreview
      ? 'course-setup-guide__alert course-setup-guide__alert--success'
      : 'course-setup-guide__alert';
    previewUi.status.textContent = approved === undefined
      ? 'Checking whether this course has student-ready content\u2026'
      : canPreview
        ? `${approved} Approved question${approved === 1 ? ' is' : 's are'} ready for an isolated preview.`
        : 'Student Preview needs at least one Approved question. Return to Review and approve a question first.';
  }

  function renderPreviewScreen(): void {
    const status = el('p', { class: 'course-setup-guide__alert', role: 'status', 'aria-live': 'polite' });
    const previewButton = el(
      'button',
      { class: 'btn btn--instr-primary', type: 'button', onclick: openStudentPreview },
      'Checking approved questions\u2026',
    ) as HTMLButtonElement;
    previewUi = { status, previewButton };
    mount(
      body,
      screenHeading(
        'Test the real student experience',
        'Student Preview uses the same released-course interface with a fresh anonymous learner. Preview attempts stay isolated from live student records and analytics.',
      ),
      el(
        'div',
        { class: 'course-setup-guide__preview-card' },
        el('span', { class: 'course-setup-guide__preview-icon', 'aria-hidden': 'true', text: '\u25b7' }),
        el(
          'div',
          {},
          el('h4', { text: 'What to verify' }),
          el(
            'ul',
            {},
            el('li', { text: 'Only Approved questions and available content are visible.' }),
            el('li', { text: 'Course wording, navigation, practice, explanations, and remediation feel clear.' }),
            el('li', { text: 'Use the role menu at any time to return to this course project.' }),
          ),
        ),
      ),
      status,
      actionRow(
        'Return to Course Home',
        coursePath(),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => renderScreen('review') }, 'Back to review'),
        previewButton,
      ),
    );
    refreshPreviewPanel();
  }

  function handleRunUpdate(run: ContentRunSummary, source: 'snapshot' | 'live'): void {
    const previous = runs.get(run._id);
    if (previous && run.revision <= previous.revision) return;
    runs.set(run._id, run);
    if (run.kind === 'question-generation' && locallyQueuedRuns.has(run.input.loId)) {
      const trackedRunId = locallyQueuedRuns.get(run.input.loId);
      if (trackedRunId === run._id || (trackedRunId === null && source === 'live' && !isTerminal(run))) {
        locallyQueuedRuns.delete(run.input.loId);
      }
    }
    if (currentScreen === 'sources') refreshSourcesPanel();
    if (currentScreen === 'generation') refreshGenerationPanel();

    const becameTerminal = isTerminal(run) && (previous === undefined || !isTerminal(previous));
    const stageChanged = previous === undefined
      || previous.stage !== run.stage
      || previous.status !== run.status;
    if (source === 'live' && stageChanged) {
      const subject = run.kind === 'material-ingest'
        ? run.input.sourceName
        : 'Question generation';
      const detail = run.status === 'completed'
        ? 'Completed'
        : run.status === 'partial'
          ? 'Completed with warnings'
          : run.status === 'failed'
            ? (run.error?.message ?? 'Failed')
            : runStageLabel(run.stage);
      setLive(
        `${subject}: ${detail}`,
        run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : 'default',
      );
    }
    if (source !== 'live' || !becameTerminal || terminalRefreshes.has(run._id)) return;
    terminalRefreshes.add(run._id);
    notifyChanged();
    void refreshWorkflow();
    if (run.kind === 'material-ingest' && currentScreen === 'sources') void loadSources();
    if (run.kind === 'question-generation') {
      if (currentScreen === 'generation') void loadGenerationData();
      if (currentScreen === 'review') void loadReview();
    }
  }

  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  closeActiveGuide = close;
  document.body.append(dialog);
  dialog.showModal();
  renderScreen(currentScreen);
  void refreshWorkflow();
  void listContentRuns(options.courseId, { limit: 50 }).then((recent) => {
    if (closed) return;
    for (const run of recent) handleRunUpdate(run, 'snapshot');
  }).catch(() => undefined);
  closeRunStream = subscribeContentRuns(options.courseId, {
    onSnapshot: (recent) => {
      for (const run of recent) handleRunUpdate(run, 'snapshot');
    },
    onRun: (run) => handleRunUpdate(run, 'live'),
    onError: () => {
      if (!closed) setLive('Live progress is reconnecting. Saved background work is not affected.');
    },
  });
}
