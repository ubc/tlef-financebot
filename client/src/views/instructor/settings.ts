// Course Settings (I4) — term dates, feedback strategy, auto-pause,
// registration code, and roster (Task 15, Task C). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-id `148:3721`) and `.superpowers/sdd/task-15/i4-settings.png`.
//
// The wireframe's "Exam Templates" section has no backing endpoint anywhere
// in docs/api-contract.md — omitted rather than faked (Task-15 Global
// Constraints: "derive client-side... do not add or change a server
// endpoint"). Course Name / Course Code are shown read-only for context: only
// term dates / feedback strategy / auto-pause are patchable via `updateCourse`
// (docs/api-contract.md's Courses section).
import {
  ApiError,
  getCourseTree,
  getRoster,
  putRoster,
  regenerateRegistrationCode,
  updateCourse,
  type AutoPauseConfig,
  type InstructorCourse,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function fieldLabel(text: string): HTMLElement {
  return el('label', { class: 'form-field__label', text });
}

const FEEDBACK_STRATEGIES: Array<{
  value: InstructorCourse['feedbackStrategy'];
  title: string;
  subtitle: string;
}> = [
  { value: 'adaptive', title: 'Adaptive (default)', subtitle: 'Strategy A for confounders, Strategy B for random errors' },
  { value: 'strategy-a', title: 'Strategy A only', subtitle: "Always show only chosen option's explanation + 1 retry" },
  { value: 'strategy-b', title: 'Strategy B only', subtitle: 'Always show all explanations immediately' },
];

/** yyyy-mm-dd for an `<input type="date">` from an ISO date string, or ''. */
function toDateInputValue(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

async function renderSettingsInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading course settings…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  let course: InstructorCourse;
  let roster: Array<{ identifier: string; extendedUntil?: string }>;
  try {
    const [tree, rosterList] = await Promise.all([getCourseTree(courseId), getRoster(courseId)]);
    course = tree.course;
    roster = rosterList;
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderSettingsInner(outlet, courseId)));
    return;
  }

  let selectedStrategy = course.feedbackStrategy;
  let autoPause: AutoPauseConfig = { ...course.autoPause };
  let registrationCode = course.registrationCode;

  const termStartInput = el('input', { class: 'input', type: 'date', value: toDateInputValue(course.termStart) }) as HTMLInputElement;
  const termEndInput = el('input', { class: 'input', type: 'date', value: toDateInputValue(course.termEnd) }) as HTMLInputElement;
  const minAttemptsInput = el('input', { class: 'input', type: 'number', min: '1', value: String(autoPause.minAttempts) }) as HTMLInputElement;
  const flagPercentInput = el('input', { class: 'input', type: 'number', min: '0', max: '100', value: String(autoPause.flagPercent) }) as HTMLInputElement;
  const flagCountInput = el('input', { class: 'input', type: 'number', min: '0', value: String(autoPause.flagCount) }) as HTMLInputElement;
  const settingsErrorSlot = el('div', {});
  const strategyGroup = el('div', { class: 'strategy-group' });
  const codeValueEl = el('span', { class: 'registration-code__value mono', text: registrationCode ?? '— not generated —' });
  const codeErrorSlot = el('div', {});
  const rosterTextarea = el('textarea', {
    class: 'input input--area roster-textarea',
    rows: '8',
    text: roster.map((r) => r.identifier).join('\n'),
  }) as HTMLTextAreaElement;
  const rosterErrorSlot = el('div', {});
  const rosterListEl = el('div', { class: 'roster-list' });

  function renderStrategyGroup(): void {
    strategyGroup.replaceChildren(
      ...FEEDBACK_STRATEGIES.map((option) =>
        el(
          'button',
          {
            class: `strategy-card${selectedStrategy === option.value ? ' strategy-card--active' : ''}`,
            type: 'button',
            onclick: () => {
              selectedStrategy = option.value;
              renderStrategyGroup();
            },
          },
          el('p', { class: 'strategy-card__title', text: option.title }),
          el('p', { class: 'strategy-card__subtitle', text: option.subtitle }),
        ),
      ),
    );
  }
  renderStrategyGroup();

  function renderRosterList(): void {
    rosterListEl.replaceChildren(
      roster.length
        ? el(
            'div',
            { class: 'roster-list__rows' },
            ...roster.map((r) =>
              el(
                'div',
                { class: 'roster-list__row' },
                el('span', { class: 'roster-list__identifier mono', text: r.identifier }),
                r.extendedUntil
                  ? el('span', { class: 'roster-list__extended', text: `Extended until ${r.extendedUntil.slice(0, 10)}` })
                  : false,
              ),
            ),
          )
        : el('p', { class: 'roster-list__empty', text: 'No students on the roster yet.' }),
    );
  }
  renderRosterList();

  const saveSettings = async (): Promise<void> => {
    settingsErrorSlot.replaceChildren();
    const minAttempts = Number(minAttemptsInput.value);
    const flagPercent = Number(flagPercentInput.value);
    const flagCount = Number(flagCountInput.value);
    if (![minAttempts, flagPercent, flagCount].every((n) => Number.isFinite(n) && n >= 0)) {
      settingsErrorSlot.replaceChildren(errorState('Auto-pause fields must be non-negative numbers.'));
      return;
    }
    try {
      const updated = await updateCourse(courseId, {
        termStart: termStartInput.value ? new Date(termStartInput.value).toISOString() : undefined,
        termEnd: termEndInput.value ? new Date(termEndInput.value).toISOString() : undefined,
        feedbackStrategy: selectedStrategy,
        autoPause: { minAttempts, flagPercent, flagCount },
      });
      course = updated;
      autoPause = { ...updated.autoPause };
      selectedStrategy = updated.feedbackStrategy;
      renderStrategyGroup();
    } catch (error) {
      settingsErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  };

  const regenerateCode = async (): Promise<void> => {
    codeErrorSlot.replaceChildren();
    try {
      const result = await regenerateRegistrationCode(courseId);
      registrationCode = result.registrationCode;
      codeValueEl.textContent = registrationCode;
    } catch (error) {
      codeErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  };

  const saveRoster = async (): Promise<void> => {
    rosterErrorSlot.replaceChildren();
    const identifiers = rosterTextarea.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    try {
      await putRoster(courseId, identifiers);
      const refreshed = await getRoster(courseId);
      roster = refreshed;
      rosterTextarea.value = roster.map((r) => r.identifier).join('\n');
      renderRosterList();
    } catch (error) {
      rosterErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  };

  body.replaceChildren(
    pageHeader('Course Settings', ''),
    el(
      'div',
      { class: 'settings-layout' },
      el(
        'div',
        { class: 'settings-column stack' },
        el('h2', { class: 'section-title', text: 'General' }),
        el(
          'div',
          { class: 'form-field' },
          fieldLabel('Course Name'),
          el('input', { class: 'input', type: 'text', value: course.name, disabled: 'disabled' }),
        ),
        el(
          'div',
          { class: 'form-field' },
          fieldLabel('Course Code'),
          el('input', { class: 'input', type: 'text', value: course.courseCode, disabled: 'disabled' }),
        ),
        el('div', { class: 'form-field' }, fieldLabel('Term Start Date'), termStartInput),
        el('div', { class: 'form-field' }, fieldLabel('Term End Date'), termEndInput),

        el('h2', { class: 'section-title', text: 'Auto-pause' }),
        el('div', { class: 'form-field' }, fieldLabel('Minimum attempts before auto-pause applies'), minAttemptsInput),
        el('div', { class: 'form-field' }, fieldLabel('Flag percentage threshold'), flagPercentInput),
        el('div', { class: 'form-field' }, fieldLabel('Flag count threshold'), flagCountInput),

        el('h2', { class: 'section-title', text: 'Registration Code' }),
        el(
          'div',
          { class: 'registration-code' },
          codeValueEl,
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void regenerateCode() }, 'Regenerate'),
        ),
        codeErrorSlot,

        settingsErrorSlot,
        el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: () => void saveSettings() }, 'Save Settings'),
      ),
      el(
        'div',
        { class: 'settings-column stack' },
        el('h2', { class: 'section-title', text: 'Feedback Strategy' }),
        strategyGroup,

        el('h2', { class: 'section-title', text: 'Roster' }),
        el('p', { class: 'view__lead', text: 'One student identifier per line. Saving replaces the full roster.' }),
        rosterTextarea,
        rosterErrorSlot,
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => void saveRoster() }, 'Save Roster'),
        rosterListEl,
      ),
    ),
  );
}

export function renderSettings(outlet: HTMLElement, params: RouteParams): void {
  void renderSettingsInner(outlet, params.id);
}
