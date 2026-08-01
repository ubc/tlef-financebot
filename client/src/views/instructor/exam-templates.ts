import {
  ApiError,
  getCourseTree,
  listExamTemplates,
  saveExamTemplate,
  type CourseTreeTheme,
  type ExamTemplate,
  type ExamTemplateKind,
  type ExamTemplateSupplyWarning,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

function fieldLabel(text: string, htmlFor: string): HTMLElement {
  return el('label', { class: 'form-field__label', for: htmlFor, text });
}

function toLocalDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(localValue: string): string {
  return new Date(localValue).toISOString();
}

interface ThemeControls {
  selected: HTMLInputElement;
  mcqCount: HTMLInputElement;
  tfCount: HTMLInputElement;
  points: HTMLInputElement;
}

function templateEditor(
  courseId: string,
  kind: ExamTemplateKind,
  themes: CourseTreeTheme[],
  initial: ExamTemplate | undefined,
): HTMLElement {
  const title = kind === 'midterm' ? 'Midterm template' : 'Final template';
  const prefix = `exam-${kind}`;
  const timeLimit = el('input', {
    class: 'input',
    id: `${prefix}-time-limit`,
    type: 'number',
    min: '1',
    value: initial?.timeLimitMinutes === undefined ? '' : String(initial.timeLimitMinutes),
    placeholder: 'Untimed',
  }) as HTMLInputElement;
  const availabilityStart = el('input', {
    class: 'input',
    id: `${prefix}-start`,
    type: 'datetime-local',
    value: toLocalDateTime(initial?.availabilityStart),
  }) as HTMLInputElement;
  const availabilityEnd = el('input', {
    class: 'input',
    id: `${prefix}-end`,
    type: 'datetime-local',
    value: toLocalDateTime(initial?.availabilityEnd),
  }) as HTMLInputElement;
  const loBreakdown = el('input', {
    id: `${prefix}-lo-breakdown`,
    type: 'checkbox',
  }) as HTMLInputElement;
  loBreakdown.checked = initial?.loBreakdown ?? true;
  const errorSlot = el('div', {});
  const statusSlot = el('div', { 'aria-live': 'polite' });
  const warningsSlot = el('div', { 'aria-live': 'polite' });
  const controls = new Map<string, ThemeControls>();

  const themeRows = themes.map((theme) => {
    const saved = initial?.themes.find((entry) => entry.themeId === theme._id);
    const selected = el('input', {
      id: `${prefix}-theme-${theme._id}`,
      type: 'checkbox',
    }) as HTMLInputElement;
    selected.checked = Boolean(saved);
    const mcqCount = el('input', {
      class: 'input exam-template-theme__number',
      type: 'number',
      min: '0',
      value: String(saved?.mcqCount ?? 0),
      'aria-label': `${theme.name} multiple-choice count`,
    }) as HTMLInputElement;
    const tfCount = el('input', {
      class: 'input exam-template-theme__number',
      type: 'number',
      min: '0',
      value: String(saved?.tfCount ?? 0),
      'aria-label': `${theme.name} true-false count`,
    }) as HTMLInputElement;
    const points = el('input', {
      class: 'input exam-template-theme__number',
      type: 'number',
      min: '0.01',
      step: '0.01',
      value: String(saved?.pointsPerQuestion ?? 1),
      'aria-label': `${theme.name} points per question`,
    }) as HTMLInputElement;
    controls.set(theme._id, { selected, mcqCount, tfCount, points });
    return el(
      'div',
      { class: 'exam-template-theme' },
      el(
        'label',
        { class: 'exam-template-theme__select', for: selected.id },
        selected,
        el('span', { text: theme.name }),
      ),
      mcqCount,
      tfCount,
      points,
    );
  });

  function renderWarnings(warnings: ExamTemplateSupplyWarning[]): void {
    if (warnings.length === 0) {
      warningsSlot.replaceChildren();
      return;
    }
    warningsSlot.replaceChildren(
      el(
        'div',
        { class: 'exam-template-warnings', role: 'status' },
        el('p', { class: 'exam-template-warnings__title', text: 'Approved-question supply warnings' }),
        el(
          'ul',
          {},
          ...warnings.map((warning) => el(
            'li',
            { text: `${warning.themeName}: requested ${warning.requested}, available ${warning.available}. The template was saved; the exam will assemble the available questions.` },
          )),
        ),
      ),
    );
  }

  const save = async (): Promise<void> => {
    errorSlot.replaceChildren();
    statusSlot.replaceChildren();
    warningsSlot.replaceChildren();
    const selectedThemes = themes.flatMap((theme) => {
      const control = controls.get(theme._id);
      if (!control?.selected.checked) return [];
      return [{
        themeId: theme._id,
        mcqCount: Number(control.mcqCount.value),
        tfCount: Number(control.tfCount.value),
        pointsPerQuestion: Number(control.points.value),
      }];
    });
    if (selectedThemes.length === 0) {
      errorSlot.replaceChildren(errorState('Select at least one Theme.'));
      return;
    }
    if (!availabilityStart.value || !availabilityEnd.value) {
      errorSlot.replaceChildren(errorState('Set both availability dates.'));
      return;
    }
    if (availabilityEnd.value < availabilityStart.value) {
      errorSlot.replaceChildren(errorState('Availability end must be on or after its start.'));
      return;
    }
    if (selectedThemes.some((theme) => (
      !Number.isInteger(theme.mcqCount)
      || theme.mcqCount < 0
      || !Number.isInteger(theme.tfCount)
      || theme.tfCount < 0
      || theme.mcqCount + theme.tfCount === 0
      || !Number.isFinite(theme.pointsPerQuestion)
      || theme.pointsPerQuestion <= 0
    ))) {
      errorSlot.replaceChildren(errorState('Selected Themes need a positive question total and point value.'));
      return;
    }
    const parsedTime = timeLimit.value ? Number(timeLimit.value) : undefined;
    if (parsedTime !== undefined && (!Number.isInteger(parsedTime) || parsedTime <= 0)) {
      errorSlot.replaceChildren(errorState('Time limit must be a positive whole number of minutes.'));
      return;
    }
    try {
      const result = await saveExamTemplate(courseId, kind, {
        themes: selectedThemes,
        ...(parsedTime !== undefined ? { timeLimitMinutes: parsedTime } : {}),
        availabilityStart: toIso(availabilityStart.value),
        availabilityEnd: toIso(availabilityEnd.value),
        loBreakdown: loBreakdown.checked,
      });
      renderWarnings(result.warnings);
      statusSlot.replaceChildren(el('p', {
        class: 'preseeding-queued-message',
        role: 'status',
        text: `${title} saved. Updates apply to the next generated attempt.`,
      }));
    } catch (error) {
      errorSlot.replaceChildren(errorState(
        error instanceof ApiError ? error.message : (error as Error).message,
      ));
    }
  };

  return el(
    'section',
    { class: 'card exam-template-editor', 'aria-labelledby': `${prefix}-title` },
    el('h2', { class: 'section-title', id: `${prefix}-title`, text: title }),
    el('p', { class: 'view__lead', text: 'Saving is allowed when Approved supply is short; students are never blocked.' }),
    el(
      'div',
      { class: 'exam-template-theme exam-template-theme--head', 'aria-hidden': 'true' },
      el('span', { text: 'Theme' }),
      el('span', { text: 'MCQ' }),
      el('span', { text: 'T/F' }),
      el('span', { text: 'Points' }),
    ),
    ...themeRows,
    el(
      'div',
      { class: 'exam-template-fields' },
      el('div', { class: 'form-field' }, fieldLabel('Time limit (minutes, optional)', timeLimit.id), timeLimit),
      el('div', { class: 'form-field' }, fieldLabel('Available from', availabilityStart.id), availabilityStart),
      el('div', { class: 'form-field' }, fieldLabel('Available until', availabilityEnd.id), availabilityEnd),
    ),
    el(
      'label',
      { class: 'exam-template-checkbox', for: loBreakdown.id },
      loBreakdown,
      el('span', { text: 'Show an LO-level breakdown in results' }),
    ),
    warningsSlot,
    errorSlot,
    statusSlot,
    el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: () => void save() }, `Save ${kind}`),
  );
}

async function renderExamTemplatesInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading exam templates…'));
  mount(outlet, el('div', { class: 'view' }, body));
  try {
    const [tree, templates] = await Promise.all([
      getCourseTree(courseId),
      listExamTemplates(courseId),
    ]);
    const activeThemes = tree.themes;
    body.replaceChildren(
      pageHeader('Exam Templates', 'Configure midterm and final Exam Prep availability and composition.'),
      activeThemes.length
        ? el(
            'div',
            { class: 'exam-template-grid' },
            templateEditor(courseId, 'midterm', activeThemes, templates.find((item) => item.kind === 'midterm')),
            templateEditor(courseId, 'final', activeThemes, templates.find((item) => item.kind === 'final')),
          )
        : errorState('Create at least one Theme before configuring an exam template.'),
    );
  } catch (error) {
    body.replaceChildren(errorState(
      error instanceof ApiError ? error.message : (error as Error).message,
      () => void renderExamTemplatesInner(outlet, courseId),
    ));
  }
}

export function renderExamTemplates(outlet: HTMLElement, params: RouteParams): void {
  void renderExamTemplatesInner(outlet, params.id);
}
