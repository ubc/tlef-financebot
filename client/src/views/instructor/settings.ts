// Course Settings (I4) — term dates, feedback strategy, auto-pause,
// registration code, and roster (Task 15, Task C). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-id `148:3721`) and `.superpowers/sdd/task-15/i4-settings.png`.
//
// Phase 3 WS-10 adds the formerly out-of-scope Exam Templates editor as a
// separate Course Settings route. This page keeps the existing course metadata,
// feedback strategy, auto-pause, registration code, and roster responsibilities.
import {
  ApiError,
  archiveCourse,
  getAuthState,
  getCourseTree,
  getRoster,
  previewRosterFile,
  putRoster,
  permanentlyDeleteCourse,
  regenerateRegistrationCode,
  restoreCourse,
  updateCourse,
  type AutoPauseConfig,
  type InstructorCourse,
  type RosterParseResult,
  type RosterReject,
  type RosterRejectReason,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { helpTip, pageHeader, sectionTitleWithHelp, uploadZone } from '../../instructor-ui.js';
import { textPromptDialog } from '../../modal.js';
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
  registrationCode:
    'The 8-character code students enter to join this course. It never grants access on its own — '
    + 'the student must also appear on the roster and the course must be published. Regenerating '
    + 'takes effect immediately and invalidates the old code; students already enrolled keep their '
    + 'access.',
  roster:
    'Who is allowed to join this course. A student needs both the registration code and a roster '
    + 'entry, so this list is what actually controls access. Upload a CSV — the identifier column '
    + 'is detected for you and anything unusable is listed before you save — or paste identifiers '
    + 'directly. Saving replaces the whole roster.',
  studentIdentifiers:
    'CWL usernames or email addresses — NOT student numbers. Students sign in with CWL, which '
    + 'tells FinanceBot their CWL username and email and nothing else, so a student number has '
    + 'nothing to match against and that student could never join. Entries that cannot match are '
    + 'skipped when you save, and listed so you can fix them.',
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

const REJECT_REASON_LABEL: Record<RosterRejectReason, string> = {
  'student-number': 'Looks like a student number',
  'malformed-email': 'Not a valid email address',
  'invalid-characters': 'Not a valid CWL username or email',
  duplicate: 'Duplicate of an earlier row',
};

// Shown once, above the per-row list, when student numbers are the problem.
// Naming the constraint matters more than naming the rows: the instructor's
// next move is to re-export with a CWL/email column, and nothing in the UI
// previously told them that was the requirement.
const STUDENT_NUMBER_EXPLANATION =
  'Students sign in with CWL, and a CWL login tells FinanceBot the person’s CWL username and '
  + 'email — never their student number. A roster of student numbers therefore matches nobody. '
  + 'Re-export the file with a CWL username or email column and upload it again.';

/** The rejected rows, capped so a 250-row paste of the wrong column does not
 *  bury the summary that explains it. */
function rejectList(rejects: RosterReject[]): HTMLElement {
  const shown = rejects.slice(0, 10);
  return el(
    'div',
    { class: 'roster-rejects' },
    rejects.some((reject) => reject.reason === 'student-number')
      ? el('p', { class: 'roster-rejects__explanation', text: STUDENT_NUMBER_EXPLANATION })
      : false,
    el(
      'ul',
      { class: 'roster-rejects__list' },
      ...shown.map((reject) =>
        el(
          'li',
          { class: 'roster-rejects__row' },
          el('span', { class: 'roster-rejects__line', text: `Row ${reject.line}` }),
          el('span', { class: 'roster-rejects__value mono', text: reject.value }),
          el('span', { class: 'roster-rejects__reason', text: REJECT_REASON_LABEL[reject.reason] }),
        ),
      ),
    ),
    rejects.length > shown.length
      ? el('p', {
          class: 'roster-rejects__more',
          text: `…and ${rejects.length - shown.length} more.`,
        })
      : false,
  );
}

/** A save/import outcome line followed by the rows that were dropped. */
function rejectSummary(lead: string, rejects: RosterReject[]): HTMLElement {
  return el(
    'div',
    { class: 'roster-import' },
    el('p', {
      class: 'roster-import__summary roster-import__summary--warn',
      role: 'status',
      text: `${lead} ${rejects.length} entr${rejects.length === 1 ? 'y was' : 'ies were'} skipped:`,
    }),
    rejectList(rejects),
  );
}

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
  let canPermanentlyDelete: boolean;
  try {
    const [tree, rosterList, auth] = await Promise.all([
      getCourseTree(courseId),
      getRoster(courseId),
      getAuthState(),
    ]);
    course = tree.course;
    roster = rosterList;
    canPermanentlyDelete = Boolean(auth.user && (auth.user.isAdmin || auth.user.puid === course.ownerPuid));
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderSettingsInner(outlet, courseId)));
    return;
  }

  let selectedStrategy = course.feedbackStrategy;
  let autoPause: AutoPauseConfig = { ...course.autoPause };
  let registrationCode = course.registrationCode;
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
  const codeValueEl = el('span', { class: 'registration-code__value mono', text: registrationCode ?? '— not generated —' });
  const codeErrorSlot = el('div', {});
  const rosterTextarea = el('textarea', {
    class: 'input input--area roster-textarea',
    id: 'settings-roster',
    rows: '8',
    text: roster.map((r) => r.identifier).join('\n'),
  }) as HTMLTextAreaElement;
  const rosterErrorSlot = el('div', {});
  const rosterImportSlot = el('div', { 'aria-live': 'polite' });
  const rosterListEl = el('div', { class: 'roster-list' });
  // The last parsed file is kept so switching the identifier column re-parses
  // it server-side instead of asking the instructor to pick the file again.
  let lastPreview: RosterParseResult | null = null;
  let lastFile: File | null = null;
  const saveRosterButton = el(
    'button',
    { class: 'btn btn--ghost', type: 'button' },
    'Save Roster',
  ) as HTMLButtonElement;

  rosterTextarea.addEventListener('input', () => {
    // Once the instructor edits the preview by hand, the textarea becomes the
    // source of truth again and an earlier all-rejected file must not keep the
    // save control disabled.
    lastPreview = null;
    lastFile = null;
    saveRosterButton.disabled = false;
    rosterImportSlot.replaceChildren();
  });
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
    settingsStatusSlot.replaceChildren();
    const minAttempts = Number(minAttemptsInput.value);
    const flagPercent = Number(flagPercentInput.value);
    const flagCount = Number(flagCountInput.value);
    if (![minAttempts, flagPercent, flagCount].every((n) => Number.isFinite(n) && n >= 0)) {
      settingsErrorSlot.replaceChildren(errorState('Auto-pause fields must be non-negative numbers.'));
      return;
    }
    if (
      termStartInput.value
      && termEndInput.value
      && termEndInput.value < termStartInput.value
    ) {
      settingsErrorSlot.replaceChildren(errorState('Term end date must be on or after the start date.'));
      return;
    }
    try {
      const updated = await updateCourse(courseId, {
        name: nameInput.value.trim(),
        courseCode: codeInput.value.trim(),
        section: sectionInput.value.trim() || null,
        term: termInput.value.trim(),
        termStart: termStartInput.value ? new Date(termStartInput.value).toISOString() : undefined,
        termEnd: termEndInput.value ? new Date(termEndInput.value).toISOString() : undefined,
        feedbackStrategy: selectedStrategy,
        autoPause: { minAttempts, flagPercent, flagCount },
      });
      course = updated;
      autoPause = { ...updated.autoPause };
      selectedStrategy = updated.feedbackStrategy;
      renderStrategyGroup();
      settingsStatusSlot.replaceChildren(
        el('p', { class: 'preseeding-queued-message', role: 'status', text: 'Course settings saved.' }),
      );
    } catch (error) {
      settingsErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  };

  const changeArchiveState = async (): Promise<void> => {
    settingsErrorSlot.replaceChildren();
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
    if (lastPreview && lastPreview.identifiers.length === 0) {
      rosterErrorSlot.replaceChildren(
        errorState('This import has no usable CWL usernames or emails, so the existing roster was not replaced.'),
      );
      return;
    }
    const identifiers = rosterTextarea.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    try {
      const { count, rejected } = await putRoster(courseId, identifiers);
      const refreshed = await getRoster(courseId);
      roster = refreshed;
      rosterTextarea.value = roster.map((r) => r.identifier).join('\n');
      renderRosterList();
      lastPreview = null;
      lastFile = null;
      saveRosterButton.disabled = false;
      // Saving used to be silent about entries it could not use, which is how
      // a roster of student numbers looked like a success and then failed
      // every enrolment. Say so, every time.
      rosterImportSlot.replaceChildren(
        rejected.length
          ? rejectSummary(`Saved ${count} student${count === 1 ? '' : 's'}.`, rejected)
          : el('p', {
              class: 'preseeding-queued-message',
              role: 'status',
              text: `Saved ${count} student${count === 1 ? '' : 's'}.`,
            }),
      );
    } catch (error) {
      rosterErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  };

  /** Loads a parsed file into the textarea and reports what was dropped. */
  function applyPreview(result: RosterParseResult): void {
    lastPreview = result;
    rosterTextarea.value = result.identifiers.join('\n');
    renderRosterImport();
  }

  const uploadRoster = async (file: File, column?: string): Promise<void> => {
    rosterErrorSlot.replaceChildren();
    rosterImportSlot.replaceChildren(loadingState(`Reading ${file.name}…`));
    try {
      lastFile = file;
      applyPreview(await previewRosterFile(courseId, file, column));
    } catch (error) {
      lastFile = null;
      rosterImportSlot.replaceChildren();
      rosterErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  };

  /** The import panel: which column was read, what was rejected, and a way to
   *  correct the column without re-exporting the file. */
  function renderRosterImport(): void {
    if (!lastPreview) {
      saveRosterButton.disabled = false;
      rosterImportSlot.replaceChildren();
      return;
    }
    const { columns, selectedColumn, identifiers, rejects } = lastPreview;
    saveRosterButton.disabled = identifiers.length === 0;

    const columnPicker = columns.length > 1
      ? (() => {
          const select = el('select', { class: 'input', id: 'settings-roster-column' }) as HTMLSelectElement;
          for (const column of columns) {
            const option = el('option', { value: column, text: column }) as HTMLOptionElement;
            option.selected = column === selectedColumn;
            select.append(option);
          }
          select.addEventListener('change', () => {
            if (lastFile) void uploadRoster(lastFile, select.value);
          });
          return el(
            'div',
            { class: 'form-field' },
            fieldLabel('Identifier column', 'settings-roster-column'),
            select,
          );
        })()
      : false;

    rosterImportSlot.replaceChildren(
      el(
        'div',
        { class: 'roster-import' },
        el('p', {
          // Success-green on "0 of 4 rows ready" reads as a green light for a
          // file that will enrol nobody. Tone follows the outcome.
          class: `roster-import__summary${rejects.length ? ' roster-import__summary--warn' : ''}`,
          role: 'status',
          text: `${identifiers.length} of ${lastPreview.totalRows} row${lastPreview.totalRows === 1 ? '' : 's'} ready`
            + `${selectedColumn ? ` from column “${selectedColumn}”` : ''}.`
            + (identifiers.length
              ? ' Review below, then Save Roster.'
              : ' Nothing will be saved; choose a CWL/email column or edit the list.'),
        }),
        columnPicker,
        rejects.length ? rejectList(rejects) : false,
      ),
    );
  }

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
          fieldLabel('Course Name', 'settings-course-name'),
          nameInput,
        ),
        el(
          'div',
          { class: 'form-field' },
          fieldLabel('Course Code', 'settings-course-code'),
          codeInput,
        ),
        el('div', { class: 'form-field' }, fieldLabel('Section', 'settings-section'), sectionInput),
        el('div', { class: 'form-field' }, fieldLabel('Term', 'settings-term'), termInput),
        el('div', { class: 'form-field' }, fieldLabel('Term Start Date', 'settings-term-start'), termStartInput),
        el('div', { class: 'form-field' }, fieldLabel('Term End Date', 'settings-term-end'), termEndInput),

        sectionTitleWithHelp('Auto-pause', HELP.autoPause),
        el('div', { class: 'form-field' }, fieldLabelWithHelp('Minimum attempts before auto-pause applies', 'settings-min-attempts', HELP.minAttempts), minAttemptsInput),
        el('div', { class: 'form-field' }, fieldLabelWithHelp('Flag percentage threshold', 'settings-flag-percent', HELP.flagPercent), flagPercentInput),
        el('div', { class: 'form-field' }, fieldLabelWithHelp('Flag count threshold', 'settings-flag-count', HELP.flagCount), flagCountInput),

        sectionTitleWithHelp('Registration Code', HELP.registrationCode),
        el(
          'div',
          { class: 'registration-code' },
          codeValueEl,
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void regenerateCode() }, 'Regenerate'),
        ),
        codeErrorSlot,

        settingsErrorSlot,
        settingsStatusSlot,
        el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: () => void saveSettings() }, 'Save Settings'),
        el(
          'button',
          {
            class: 'btn btn--ghost',
            type: 'button',
            onclick: () => void changeArchiveState(),
          },
          course.lifecycle === 'archived' ? 'Restore as draft' : 'Archive course',
        ),
      ),
      el(
        'div',
        { class: 'settings-column stack' },
        sectionTitleWithHelp('Feedback Strategy', HELP.feedbackStrategy),
        strategyGroup,

        sectionTitleWithHelp('Roster', HELP.roster),
        el('p', {
          class: 'view__lead',
          text: 'Upload a CSV or paste one identifier per line. Saving replaces the full roster.',
        }),
        uploadZone('Drop a roster CSV here or browse', (files) => {
          if (files[0]) void uploadRoster(files[0]);
        }),
        rosterImportSlot,
        fieldLabelWithHelp('Student identifiers', 'settings-roster', HELP.studentIdentifiers),
        rosterTextarea,
        rosterErrorSlot,
        saveRosterButton,
        rosterListEl,
      ),
    ),
    el(
      'section',
      { class: 'settings-danger-zone stack', 'aria-labelledby': 'settings-danger-zone-title' },
      el('div', {},
        el('h2', { class: 'section-title', id: 'settings-danger-zone-title', text: 'Danger Zone' }),
        el('p', {
          class: 'view__lead',
          text: 'Permanently delete this course and every record, uploaded file, and knowledge vector that belongs to it. This is different from Archive and cannot be reversed.',
        }),
      ),
      deletionErrorSlot,
      canPermanentlyDelete
        ? el(
            'button',
            { class: 'btn btn--danger', type: 'button', onclick: () => void permanentlyDelete() },
            'Delete course permanently',
          )
        : el('p', {
            class: 'view__lead',
            text: 'Only the course owner or an administrator can permanently delete this course.',
          }),
    ),
  );
  saveRosterButton.addEventListener('click', () => void saveRoster());
}

export function renderSettings(outlet: HTMLElement, params: RouteParams): void {
  void renderSettingsInner(outlet, params.id);
}
