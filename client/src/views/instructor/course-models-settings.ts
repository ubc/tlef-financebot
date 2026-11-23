import { ApiError, COURSE_MODEL_STEPS, getCourseModels, saveCourseModels, type CapabilityProfile, type CourseModelStep, type InstructorCourseModels } from '../../api.js';
import { el } from '../../dom.js';
import { errorState, loadingState } from '../../ui.js';

// Spec: docs/superpowers/specs/2026-11-23-instructor-course-models-design.md.
// Instructors pick from the built-in supported models only; there is no free-text model field.

const STEP_LABEL: Record<CourseModelStep, string> = {
  generator: 'Question generator',
  reviewer: 'Question checker',
  utility: 'Utility',
  outlineOrganizer: 'Outline organizer',
  masteryEvaluator: 'Mastery evaluator · not yet in use',
};

const STEP_HELP: Record<CourseModelStep, string> = {
  generator: 'Writes each practice question from your course materials.',
  reviewer: 'Checks every generated question, its answer and its options.',
  utility: 'Classifies uploads, reads materials for Course Structure and checks outline objectives against their sources.',
  outlineOrganizer: 'Writes the final topics and learning objectives in Course Structure. One call per run, so a stronger model here costs little.',
  masteryEvaluator: 'Reserved for a future feature. The choice is saved but nothing uses it yet.',
};

const PROFILE_HINT: Record<CapabilityProfile, string> = {
  classic: 'standard',
  'reasoning-tunable': 'adjustable reasoning',
  'reasoning-fixed': 'fast · lower cost',
  'reasoning-required': 'deeper reasoning · slower, higher cost',
};

export function courseModelsSettingsPanel(courseId: string): HTMLElement {
  const root = el('section', { class: 'course-models-settings stack', 'aria-label': 'AI models' }, loadingState('Loading AI models…'));
  let view: InstructorCourseModels | undefined;
  const selects = new Map<CourseModelStep, HTMLSelectElement>();
  const status = el('div', { role: 'status', 'aria-live': 'polite' });

  function draw(): void {
    if (!view) return;
    const current = view;
    selects.clear();
    const rows = COURSE_MODEL_STEPS.map(step => {
      const chosen = current.overrides[step] ?? '';
      const choices: Array<[string, string]> = [['', `Platform default (${current.platformModels[step]?.model ?? 'not set'})`],
        ...current.selectableModels.map(model => [model.id, `${model.id} — ${PROFILE_HINT[model.profile]}`] as [string, string])];
      // A model an administrator assigned outside the supported list stays visible
      // and is kept as long as it is not changed.
      if (chosen && !current.selectableModels.some(model => model.id === chosen)) choices.push([chosen, `${chosen} — assigned by an administrator`]);
      const id = `course-model-${step}`;
      const node = el('select', { class: 'input', id, 'aria-describedby': `${id}-help` },
        ...choices.map(([value, text]) => el('option', { value, text }))) as HTMLSelectElement;
      node.value = chosen;
      selects.set(step, node);
      const effective = current.effectiveModels[step]?.model;
      return el('div', { class: 'form-field' },
        el('label', { for: id, text: STEP_LABEL[step] }), node,
        el('small', { id: `${id}-help`, class: 'admin-fine', text: `${STEP_HELP[step]}${effective ? ` In use now: ${effective}.` : ''}` }));
    });
    const save = el('button', { class: 'btn btn--instr-primary', type: 'button', text: 'Save AI models', onclick: () => { void submit(save); } }) as HTMLButtonElement;
    root.replaceChildren(
      el('p', { class: 'admin-fine', text: 'Choose which AI model each step uses for this course. Only models FinanceBot supports are listed. '
        + 'Changes apply to new generation runs; runs already in progress keep their model. A stronger model usually gives better results but is slower and costs more.' }),
      el('div', { class: 'admin-fields' }, ...rows), status, save);
  }

  async function submit(save: HTMLButtonElement): Promise<void> {
    if (!view) return;
    const overrides: InstructorCourseModels['overrides'] = {};
    for (const [step, node] of selects) if (node.value) overrides[step] = node.value;
    save.disabled = true; status.replaceChildren();
    try {
      view = await saveCourseModels(courseId, view.revision, overrides);
      draw(); status.replaceChildren(el('p', { text: 'AI models saved for this course.' }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        view = await getCourseModels(courseId); draw();
        status.replaceChildren(errorState('Someone else changed these models. The latest choices are shown; review them and save again.'));
      } else status.replaceChildren(errorState(error instanceof ApiError && error.status === 400 ? 'Choose a supported model for every step.' : (error as Error).message));
    } finally { save.disabled = false; }
  }

  void getCourseModels(courseId).then(value => { view = value; draw(); })
    .catch(error => root.replaceChildren(errorState((error as Error).message)));
  return root;
}
