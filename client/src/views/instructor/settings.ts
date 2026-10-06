import { teachingSettingsPanel } from './teaching-settings.js';
import { attachTutorial } from '../../tutorials.js';
// Course Settings (I4) — term dates, feedback strategy, auto-pause,
// supplemental one-time codes and Gradebook enrollment. See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-id `148:3721`) and `.superpowers/sdd/task-15/i4-settings.png`.
//
// Phase 3 WS-10 adds the formerly out-of-scope Exam Templates editor as a
// separate Course Settings route. This page keeps the existing course metadata,
// feedback strategy, auto-pause and enrollment responsibilities.
import {
  ApiError,
  archiveCourse,
  getAuthState,
  getCourseTree,
  permanentlyDeleteCourse,
  restoreCourse,
  updateCourse,
  type AutoPauseConfig,
  type InstructorCourse,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { helpTip, pageHeader, sectionTitleWithHelp } from '../../instructor-ui.js';
import { confirmDialog, textPromptDialog } from '../../modal.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function fieldLabel(text: string, htmlFor: string): HTMLElement {
  return el('label', { class: 'form-field__label', for: htmlFor, text });
}

/** A field label with a `helpTip` beside it. The tip sits OUTSIDE the `<label>`
 *  on purpose: nested in it, clicking the trigger would also activate the
 *  label and steal focus into the input. */
function fieldLabelWithHelp(text: string, htmlFor: string, tip: string): HTMLElement {
  return el('div', { class: 'form-field__label-row' }, fieldLabel(text, htmlFor), helpTip(text, tip));
}

// Instructors could not tell what these three settings did from their labels
// alone — reported 2026-08-06. Wording checked against the implementations, not
// the labels: the auto-pause formula in server/src/services/flags.service.ts
// (`meetsAutoPauseThreshold`), `decideStrategy` in attempts.service.ts, and
// `enrollByCode` in enrollment.service.ts.
const HELP = {
  autoPause:
    'Automatically hides an approved question from students once enough of them flag it, '
    + 'and sends course staff an elevated-priority notification. A paused question is served in '
    + 'neither practice nor exams until the flags are dealt with — resolving them as cleared can '
    + 'un-pause it automatically.',
  minAttempts:
    'A small-sample guard for the flag-percentage rule only: the question needs this many distinct '
    + 'students to have attempted it before a percentage can pause it. It does not restrain the '
    + 'flag-count rule below.',
  flagPercent:
    'Pauses the question when this share of the students who attempted it have open flags on it — '
    + 'but only once the minimum-attempts guard above is satisfied.',
  flagCount:
    'Pauses the question as soon as this many open flags exist on it, regardless of how many '
    + 'students have attempted it. This rule stands on its own: either threshold alone is enough '
    + 'to pause a question.',
  feedbackStrategy:
    'Controls what a student sees after answering. Strategy A reveals only the explanation for the '
    + 'option they picked, then grants one retry. Strategy B reveals every option’s explanation '
    + 'at once, with no retry. Adaptive decides per answer: picking a known misconception gets '
    + 'Strategy A’s targeted retry, any other wrong answer gets Strategy B’s full '
    + 'explanations. Exam mode defers all feedback to the end-of-exam summary, so no retry is '
    + 'offered there.',
} as const;

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
  const root = el('div', { class: 'view admin-workbench settings-workbench' }, body);
  let activeSection = 'General';
  mount(outlet, root);

  let course: InstructorCourse;
  let canPermanentlyDelete: boolean;
  try {
    const [tree, auth] = await Promise.all([
      getCourseTree(courseId),
      getAuthState(),
    ]);
    course = tree.course;
    canPermanentlyDelete = Boolean(auth.user && (auth.user.isAdmin || auth.user.puid === course.ownerPuid));
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderSettingsInner(outlet, courseId)));
    return;
  }

  let selectedStrategy = course.feedbackStrategy;
  let autoPause: AutoPauseConfig = { ...course.autoPause };
  const nameInput = el('input', { class: 'input', type: 'text', id: 'settings-course-name', value: course.name }) as HTMLInputElement;
  const codeInput = el('input', { class: 'input', type: 'text', id: 'settings-course-code', value: course.courseCode }) as HTMLInputElement;
  const sectionInput = el('input', { class: 'input', type: 'text', id: 'settings-section', value: course.section ?? '' }) as HTMLInputElement;
  const termInput = el('input', { class: 'input', type: 'text', id: 'settings-term', value: course.term }) as HTMLInputElement;

  const termStartInput = el('input', { class: 'input', type: 'date', id: 'settings-term-start', value: toDateInputValue(course.termStart) }) as HTMLInputElement;
  const termEndInput = el('input', { class: 'input', type: 'date', id: 'settings-term-end', value: toDateInputValue(course.termEnd) }) as HTMLInputElement;
  const minAttemptsInput = el('input', { class: 'input', type: 'number', id: 'settings-min-attempts', min: '1', value: String(autoPause.minAttempts) }) as HTMLInputElement;
  const flagPercentInput = el('input', { class: 'input', type: 'number', id: 'settings-flag-percent', min: '0', max: '100', value: String(autoPause.flagPercent) }) as HTMLInputElement;
  const flagCountInput = el('input', { class: 'input', type: 'number', id: 'settings-flag-count', min: '0', value: String(autoPause.flagCount) }) as HTMLInputElement;
  const settingsErrorSlot = el('div', {});
  const settingsStatusSlot = el('div', { 'aria-live': 'polite' });
  const strategyGroup = el('div', { class: 'strategy-group' });
  const deletionErrorSlot = el('div', {});

  function renderStrategyGroup(): void {
    strategyGroup.replaceChildren(
      ...FEEDBACK_STRATEGIES.map((option) =>
        (() => {
          const radio = el('input', {
            type: 'radio',
            name: 'feedback-strategy',
            value: option.value,
            onchange: () => {
              selectedStrategy = option.value;
              renderStrategyGroup();
            },
          }) as HTMLInputElement;
          radio.checked = selectedStrategy === option.value;
          return el(
            'label',
            { class: `strategy-card${radio.checked ? ' strategy-card--active' : ''}` },
            radio,
            el('span', { class: 'strategy-card__title', text: option.title }),
            el('span', { class: 'strategy-card__subtitle', text: option.subtitle }),
          );
        })(),
      ),
    );
  }
  renderStrategyGroup();

  const saveSettings = async (): Promise<void> => {
    settingsErrorSlot.replaceChildren();
    settingsStatusSlot.replaceChildren();
    const minAttempts = Number(minAttemptsInput.value);
    const flagPercent = Number(flagPercentInput.value);
    const flagCount = Number(flagCountInput.value);
    if (activeSection === 'Question safeguards' && (!Number.isInteger(minAttempts) || minAttempts < 1 || !Number.isInteger(flagCount) || flagCount < 0 || !Number.isFinite(flagPercent) || flagPercent < 0 || flagPercent > 100)) {
      settingsErrorSlot.replaceChildren(errorState('Use at least 1 attempt, a flag percentage from 0 to 100, and a non-negative whole flag count.'));
      return;
    }
    if (
      activeSection === 'General' && termStartInput.value
      && termEndInput.value
      && termEndInput.value < termStartInput.value
    ) {
      settingsErrorSlot.replaceChildren(errorState('Term end date must be on or after the start date.'));
      return;
    }
    try {
      const section = activeSection;
      const patch = section === 'General' ? {
        name: nameInput.value.trim(), courseCode: codeInput.value.trim(),
        section: sectionInput.value.trim() || null, term: termInput.value.trim(),
        termStart: termStartInput.value ? new Date(termStartInput.value).toISOString() : undefined,
        termEnd: termEndInput.value ? new Date(termEndInput.value).toISOString() : undefined,
      } : section === 'Learning experience' ? { feedbackStrategy: selectedStrategy }
        : { autoPause: { minAttempts, flagPercent, flagCount } };
      const updated = await updateCourse(courseId, patch, course.revision ?? 0);
      course = updated;
      if (section === 'Question safeguards') autoPause = { ...updated.autoPause };
      settingsStatusSlot.replaceChildren(
        el('p', { class: 'preseeding-queued-message', role: 'status', text: `${section} saved.` }),
      );
    } catch (error) {
      settingsErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  };

  const changeArchiveState = async (): Promise<void> => {
    settingsErrorSlot.replaceChildren();
    if (!await confirmDialog({ title: course.lifecycle === 'archived' ? 'Restore this course?' : 'Archive this course?', message: course.lifecycle === 'archived' ? 'Restore the course as a draft.' : 'Student access will close. Course content and records remain available to instructors.', confirmLabel: course.lifecycle === 'archived' ? 'Restore as draft' : 'Archive course' })) return;
    try {
      course = course.lifecycle === 'archived'
        ? await restoreCourse(courseId)
        : await archiveCourse(courseId);
      await renderSettingsInner(outlet, courseId);
    } catch (error) {
      settingsErrorSlot.replaceChildren(
        errorState(error instanceof ApiError ? error.message : (error as Error).message),
      );
    }
  };

  const permanentlyDelete = async (): Promise<void> => {
    deletionErrorSlot.replaceChildren();
    const requiredPhrase = `DELETE ${[course.courseCode.trim(), course.section?.trim()]
      .filter(Boolean)
      .join(' ')}`;
    const confirmation = await textPromptDialog({
      title: 'Permanently delete this course?',
      message: 'This cannot be undone. It removes the course, roster, materials and source files, knowledge vectors, questions and versions, student and preview activity, analytics, exams, flags, notifications, TA access, and settings.',
      fieldLabel: `Type ${requiredPhrase} to confirm`,
      placeholder: requiredPhrase,
      confirmLabel: 'Delete course permanently',
      tone: 'danger',
      maxLength: 120,
    });
    if (confirmation === null) return;
    if (confirmation !== requiredPhrase) {
      deletionErrorSlot.replaceChildren(errorState(`Confirmation did not match ${requiredPhrase}.`));
      return;
    }
    try {
      await permanentlyDeleteCourse(courseId, confirmation);
      window.location.hash = '/instructor/courses';
    } catch (error) {
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      const friendly = message === 'course-delete-active-work'
        ? 'This course still has background processing in progress. Wait for it to finish, then try again.'
        : message === 'course-delete-owner-required'
          ? 'Only the course owner or an administrator can permanently delete this course.'
          : message === 'course-delete-unsafe-storage-path'
            ? 'A source file is stored outside FinanceBot’s recognized upload folders. Nothing was deleted. An administrator must migrate that file before this course can be removed safely.'
          : message;
      deletionErrorSlot.replaceChildren(errorState(friendly));
    }
  };

  const field = (label: string, input: HTMLElement): HTMLElement => el('div', { class: 'form-field' }, fieldLabel(label, input.id), input);
  const sections: Record<string, HTMLElement> = {
    'General': el('div', { class: 'admin-fields' }, field('Course Name', nameInput), field('Course Code', codeInput), field('Section', sectionInput), field('Term', termInput), field('Term Start Date', termStartInput), field('Term End Date', termEndInput)),
    'Learning experience': el('div', {}, sectionTitleWithHelp('Feedback after an incorrect answer', HELP.feedbackStrategy), strategyGroup),
    'Question safeguards': el('div', {}, el('p', { class: 'admin-fine', text: 'Automatically pause questions that receive repeated student flags. Review paused questions in Flags.' }),
      el('div', { class: 'admin-fields' },
        el('div', { class: 'form-field' }, fieldLabelWithHelp('Minimum attempts before auto-pause applies', minAttemptsInput.id, HELP.minAttempts), minAttemptsInput),
        el('div', { class: 'form-field' }, fieldLabelWithHelp('Flag percentage threshold', flagPercentInput.id, HELP.flagPercent), flagPercentInput),
        el('div', { class: 'form-field' }, fieldLabelWithHelp('Flag count threshold', flagCountInput.id, HELP.flagCount), flagCountInput))),
    'Course lifecycle': el('div', {}, el('h3', { text: 'Archive course' }), el('p', { class: 'admin-fine', text: 'Keep course records while closing student access. You can restore the course as a draft later.' }),
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => changeArchiveState(), text: course.lifecycle === 'archived' ? 'Restore as draft' : 'Archive course' }),
      el('section', { class: 'settings-danger-zone stack', 'aria-labelledby': 'settings-danger-zone-title' },
        el('h3', { id: 'settings-danger-zone-title', text: 'Permanently delete course' }),
        el('p', { class: 'admin-fine', text: 'Permanently delete this course and every record, uploaded file, and knowledge vector that belongs to it. This cannot be reversed.' }), deletionErrorSlot,
        canPermanentlyDelete ? el('button', { class: 'btn btn--danger', type: 'button', onclick: () => permanentlyDelete(), text: 'Delete course permanently' }) : el('p', { text: 'Only the course owner or an administrator can permanently delete this course.' }))),
  };
  sections['Teaching mode'] = teachingSettingsPanel(courseId);
  const nav = el('nav', { class: 'admin-local-nav', 'aria-label': 'Settings sections' });
  const content = el('div', { class: 'admin-pane' });
  const save = el('button', { class: 'btn btn--instr-primary', type: 'button', text: 'Save changes', onclick: () => saveSettings() });
  const footer = el('div', { class: 'admin-footer' }, el('small', { text: 'Changes are saved for this section only.' }), save);
  function selectSection(name: string): void {
    activeSection = name;
    nav.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.textContent === name)));
    content.replaceChildren(el('div', { class: 'admin-subhead' }, el('h2', { text: name }), el('small', { text: `${course.courseCode}${course.section ? ` · Section ${course.section}` : ''}` })), sections[name]);
    footer.hidden = name === 'Course lifecycle' || name === 'Teaching mode';
    settingsStatusSlot.replaceChildren(); settingsErrorSlot.replaceChildren();
  }
  Object.keys(sections).forEach((name, index) => nav.append(el('button', { id: `settings-section-${index}`, class: 'btn btn--ghost', type: 'button', text: name, onclick: () => selectSection(name) })));
  body.replaceChildren(el('div', { class: 'admin-heading' },
    pageHeader('Course Settings', 'Make one change at a time. Keep the rest of your course in view.'),
    el('div', { class: 'heading-actions' }, el('a', { id: 'settings-people-link', class: 'btn btn--secondary', href: `#/instructor/course/${courseId}/people`, text: 'Manage people' }), el('a', { class: 'btn btn--secondary', href: `#/instructor/canvas/${courseId}`, text: 'Link Canvas courses & sections' }))),
    el('div', { class: 'admin-settings-grid' }, nav, el('section', { class: 'admin-panel' }, content, settingsErrorSlot, settingsStatusSlot, footer)));
  selectSection(activeSection);
  attachTutorial(root, 'instructor-course-settings', {"course-settings-dates": "#settings-section-0", "course-settings-roster": "#settings-people-link"});
}

export function renderSettings(outlet: HTMLElement, params: RouteParams): void {
  void renderSettingsInner(outlet, params.id);
}
