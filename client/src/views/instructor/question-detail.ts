// Question Review Detail/editor (I6) — the role-labeled option editor, AI
// Agent Report panel, and Approve/Reject/Save flow (Task 15, Task E). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-id `148:3897`) and `.superpowers/sdd/task-15/i6-question-detail.png`.
//
// Omitted vs. the wireframe (no data source; brief: "omit rather than fake"):
// the "Flagged by N students" banner and the "TA Recommendation" callout both
// come from the Flag collection, which has no endpoint in this task's scope
// (only questions.routes.ts's browse/detail/edit/transition surface). The
// breadcrumb ("Question 1 of 6") implies review-queue position/ordering,
// which also isn't available here — replaced with a plain "Back to Question
// Bank" link.
import {
  addQuestionInternalNote,
  ApiError,
  editQuestion,
  getCourseTree,
  getQuestion,
  listCourseFlags,
  notifyRemediation,
  regenerateQuestion as requestQuestionRegeneration,
  resolveFlag,
  transitionQuestion,
  type CourseTree,
  type Difficulty,
  type Flag,
  type OptionRole,
  type PublicationState,
  type QuestionDetail,
  type QuestionOption,
  type QuestionVersion,
  type RegenerationVariant,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge, ROLE_LABEL } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import { errorState, loadingState } from '../../ui.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { STATUS_LABEL, TYPE_LABEL } from './bank.js';

function navigate(path: string): void {
  window.location.hash = path;
}

/** Generic "did this field change" comparator behind the `.edited` highlight
 * (Task-15 Task E: "compare each field's current editor value to the loaded
 * version's value"). Works for both scalar fields (stem, difficulty, an
 * option's text/explanation) and arrays (loIds) via a structural
 * (JSON-based) comparison — cheap and correct for the plain
 * string/string-array field types this view compares. */
export function isFieldEdited(current: unknown, baseline: unknown): boolean {
  return JSON.stringify(current) !== JSON.stringify(baseline);
}

function provenanceText(provenance: QuestionVersion['provenance']): string {
  if (!provenance) return 'Legacy question · provenance not recorded';
  switch (provenance.kind) {
    case 'generated':
      return (
        `Generated · run ${provenance.runId.slice(-8)} · item ${provenance.item + 1}` +
        (provenance.blueprintId ? ` · blueprint ${provenance.blueprintId.slice(-8)}` : '')
      );
    case 'imported':
      return `Imported from ${provenance.sourceName ?? provenance.format.toUpperCase()} · item ${provenance.item + 1}`;
    case 'script-migration':
      return `Parameterized script migration${provenance.sourceName ? ` · ${provenance.sourceName}` : ''}`;
    case 'edited':
      return `Edited from version ${provenance.parentVersionId.slice(-8)}`;
    case 'manual':
      return 'Manual authoring';
  }
}

// Canonical display order for the four option roles (I6) — Correct Answer,
// Good Confounder, Related but Incorrect, Easy to Eliminate. A true/false
// question only ever has 'correct' + 'common-misconception' (server coerces
// its wrong option's role, see questions.service.ts's assertOptionInvariants)
// so this list is filtered down to the roles actually present.
const ROLE_ORDER: OptionRole[] = ['correct', 'common-misconception', 'partially-correct', 'clearly-wrong'];

/** Instructor approval is deliberately one click, including Draft ->
 * Approved. `null` means there is no forward action. */
function approveTarget(state: PublicationState): PublicationState | null {
  if (state === 'draft' || state === 'pending-review' || state === 'reviewed' || state === 'paused') return 'approved';
  return null;
}

/** Reject & Archive removes the question from practice. Archived questions
 * are recoverable through the separate Restore to Draft action. */
function rejectTarget(state: PublicationState): PublicationState | null {
  if (state !== 'archived') return 'archived';
  return null;
}

interface LoContext {
  theme: CourseTree['themes'][number];
  themeIndex: number;
  lo: NonNullable<CourseTree['themes'][number]['los']>[number];
  loIndex: number;
}

function findLoContext(tree: CourseTree, loId: string): LoContext | undefined {
  for (let themeIndex = 0; themeIndex < tree.themes.length; themeIndex += 1) {
    const theme = tree.themes[themeIndex];
    const los = theme.los ?? [];
    const loIndex = los.findIndex((lo) => lo._id === loId);
    if (loIndex !== -1) return { theme, themeIndex, lo: los[loIndex], loIndex };
  }
  return undefined;
}

interface OptionDraft {
  key: string;
  role: OptionRole;
  text: string;
  explanation: string;
}

async function renderQuestionDetailInner(outlet: HTMLElement, questionId: string, fallbackCourseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading question…'));
  const root = el('div', { class: 'view view--question-detail' }, body);
  mount(outlet, root);

  let detail: QuestionDetail;
  let tree: CourseTree;
  try {
    detail = await getQuestion(questionId);
    tree = await getCourseTree(detail.courseId);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(
      errorState(message, () => void renderQuestionDetailInner(outlet, questionId, fallbackCourseId)),
    );
    return;
  }

  const courseId = detail.courseId || fallbackCourseId;
  const query = currentQuery();
  const fromFlags = query.get('from') === 'flags';
  const flagVersionId = query.get('flagVersionId');
  let flagContext: Flag[] = [];
  if (fromFlags && flagVersionId) {
    try {
      flagContext = (await listCourseFlags(courseId)).filter(
        (flag) =>
          flag.questionVersionId === flagVersionId &&
          (flag.state === 'open' || flag.state === 'escalated'),
      );
    } catch (error) {
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      body.replaceChildren(errorState(message));
      return;
    }
  }
  let state: PublicationState = detail.state;
  let loIds: string[] = [...detail.loIds];
  let themeIds: string[] = [...detail.themeIds];

  const baseline = {
    stem: detail.current.stem,
    difficulty: detail.current.difficulty,
    options: detail.current.options.map((o) => ({ ...o })),
  };
  const draftOptions: OptionDraft[] = detail.current.options.map((o) => ({ ...o }));
  let draftStem = baseline.stem;
  let draftDifficulty: Difficulty = baseline.difficulty;

  const errorSlot = el('div', {});
  const flagUpdateButton = el(
    'button',
    { class: 'btn btn--instr-primary', type: 'button', disabled: 'disabled' },
    'Save & Update Question Bank',
  ) as HTMLButtonElement;

  // --- Persistent form controls (built once; typing/selecting never
  // rebuilds the DOM subtree they live in, so focus is never dropped — see
  // bank.ts's `renderResults` comment for the same concern). ---------------

  const saveButton = el(
    'button',
    { class: 'btn btn--instr-primary', type: 'button', disabled: 'disabled' },
    'Save Changes',
  ) as HTMLButtonElement;

  function updateSaveButton(): void {
    const optionsChanged = draftOptions.some(
      (o, i) => isFieldEdited(o.text, baseline.options[i].text) || isFieldEdited(o.explanation, baseline.options[i].explanation),
    );
    const anyEdited = isFieldEdited(draftStem, baseline.stem) || isFieldEdited(draftDifficulty, baseline.difficulty) || optionsChanged;
    saveButton.disabled = !anyEdited;
    flagUpdateButton.disabled = !anyEdited;
  }

  const stemTextarea = el('textarea', {
    class: 'input input--area question-stem-input',
    rows: '4',
    text: draftStem,
    oninput: (e: Event) => {
      draftStem = (e.target as HTMLTextAreaElement).value;
      stemTextarea.classList.toggle('edited', isFieldEdited(draftStem, baseline.stem));
      updateSaveButton();
    },
  }) as HTMLTextAreaElement;

  const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
  const difficultySelect = el(
    'select',
    {
      class: 'input question-difficulty-select',
      onchange: (e: Event) => {
        draftDifficulty = (e.target as HTMLSelectElement).value as Difficulty;
        difficultySelect.classList.toggle('edited', isFieldEdited(draftDifficulty, baseline.difficulty));
        updateSaveButton();
      },
    },
    ...DIFFICULTIES.map((d) => el('option', { value: d, text: d.charAt(0).toUpperCase() + d.slice(1), selected: d === draftDifficulty ? 'selected' : undefined })),
  ) as HTMLSelectElement;

  const optionInputs: Array<{ role: OptionRole; textInput: HTMLInputElement; explInput: HTMLTextAreaElement }> = [];
  const displayRoles = ROLE_ORDER.filter((role) => draftOptions.some((o) => o.role === role));

  const optionsSection = el(
    'div',
    { class: 'option-editors' },
    ...displayRoles.map((role) => {
      const draft = draftOptions.find((o) => o.role === role)!;
      const baselineIndex = baseline.options.findIndex((o) => o.role === role);

      const textInput = el('input', {
        class: 'input option-editor__text',
        type: 'text',
        value: draft.text,
        oninput: (e: Event) => {
          draft.text = (e.target as HTMLInputElement).value;
          textInput.classList.toggle('edited', isFieldEdited(draft.text, baseline.options[baselineIndex]?.text));
          updateSaveButton();
        },
      }) as HTMLInputElement;

      const explInput = el('textarea', {
        class: 'input input--area option-editor__explanation',
        rows: '2',
        text: draft.explanation,
        oninput: (e: Event) => {
          draft.explanation = (e.target as HTMLTextAreaElement).value;
          explInput.classList.toggle('edited', isFieldEdited(draft.explanation, baseline.options[baselineIndex]?.explanation));
          updateSaveButton();
        },
      }) as HTMLTextAreaElement;

      optionInputs.push({ role, textInput, explInput });

      return el(
        'div',
        { class: 'option-editor' },
        el('span', { class: 'option-editor__role-label', text: ROLE_LABEL[role] }),
        textInput,
        el('label', { class: 'option-editor__explanation-label', text: 'Explanation' }),
        explInput,
      );
    }),
  );

  function applySavedVersion(saved: QuestionVersion): void {
    baseline.stem = saved.stem;
    baseline.difficulty = saved.difficulty;
    baseline.options = saved.options.map((option) => ({ ...option }));
    draftStem = saved.stem;
    draftDifficulty = saved.difficulty;

    stemTextarea.value = draftStem;
    stemTextarea.classList.remove('edited');
    difficultySelect.value = draftDifficulty;
    difficultySelect.classList.remove('edited');
    for (const input of optionInputs) {
      const savedOption = saved.options.find((option) => option.role === input.role);
      const draft = draftOptions.find((option) => option.role === input.role);
      if (savedOption && draft) {
        draft.text = savedOption.text;
        draft.explanation = savedOption.explanation;
        input.textInput.value = savedOption.text;
        input.textInput.classList.remove('edited');
        input.explInput.value = savedOption.explanation;
        input.explInput.classList.remove('edited');
      }
    }
    updateSaveButton();
  }

  async function save(): Promise<{ ok: boolean; changed: boolean }> {
    errorSlot.replaceChildren();
    const patch: { stem?: string; options?: QuestionOption[]; difficulty?: Difficulty } = {};
    if (isFieldEdited(draftStem, baseline.stem)) patch.stem = draftStem;
    const optionsChanged = draftOptions.some(
      (o, i) => isFieldEdited(o.text, baseline.options[i].text) || isFieldEdited(o.explanation, baseline.options[i].explanation),
    );
    if (optionsChanged) {
      patch.options = draftOptions.map((o) => ({ key: o.key, text: o.text, role: o.role, explanation: o.explanation }));
    }
    if (isFieldEdited(draftDifficulty, baseline.difficulty)) patch.difficulty = draftDifficulty;
    if (Object.keys(patch).length === 0) return { ok: true, changed: false };

    try {
      const saved = await editQuestion(questionId, patch);
      // The saved version becomes the new edited-comparison baseline
      // (Task-15 Task E: "Reset after a successful save").
      applySavedVersion(saved);
      return { ok: true, changed: true };
    } catch (error) {
      errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      return { ok: false, changed: false };
    }
  }
  saveButton.addEventListener('click', () => void save());

  // --- Meta row (type · state text; reflected in place on Approve/Reject) --

  const metaLabel = el('span', { class: 'question-meta__label', text: `${TYPE_LABEL[detail.current.type]} · ${STATUS_LABEL[state]}` });

  function renderMeta(): void {
    metaLabel.textContent = `${TYPE_LABEL[detail.current.type]} · ${STATUS_LABEL[state]}`;
  }

  const internalNotes = [...detail.internalNotes];
  const internalNoteInput = el('textarea', {
    class: 'input input--area',
    rows: '3',
    maxlength: '2000',
    placeholder: 'Optional note for instructors and TAs. Students cannot see this.',
  }) as HTMLTextAreaElement;
  const studentReplyInput = el('textarea', {
    class: 'input input--area',
    rows: '3',
    maxlength: '2000',
    placeholder: 'Optional response sent to each student who flagged this question.',
  }) as HTMLTextAreaElement;
  const notesList = el('div', { class: 'question-notes__list' });
  const addInternalNoteButton = el(
    'button',
    { class: 'btn btn--ghost btn--sm', type: 'button' },
    'Add Internal Comment',
  ) as HTMLButtonElement;

  function renderInternalNotes(): void {
    mount(
      notesList,
      ...(internalNotes.length
        ? internalNotes
            .slice()
            .reverse()
            .map((note) =>
              el(
                'article',
                { class: 'question-note' },
                el('p', { class: 'question-note__meta', text: `${note.puid} · ${new Date(note.at).toLocaleString()}` }),
                el('p', { class: 'question-note__text', text: note.text }),
              ),
            )
        : [el('p', { class: 'muted', text: 'No internal review notes yet.' })]),
    );
  }

  async function appendInternalNote(): Promise<boolean> {
    const text = internalNoteInput.value.trim();
    if (!text) return true;
    try {
      const note = await addQuestionInternalNote(questionId, text);
      internalNotes.push(note);
      internalNoteInput.value = '';
      renderInternalNotes();
      return true;
    } catch (error) {
      errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      return false;
    }
  }
  addInternalNoteButton.addEventListener('click', () => void appendInternalNote());

  // --- Approve / Reject / Regenerate ---------------------------------------

  const approveButton = el('button', { class: 'btn btn--instr-primary', type: 'button' }, 'Approve') as HTMLButtonElement;
  const rejectButton = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Reject & Archive') as HTMLButtonElement;
  const restoreButton = el('button', { class: 'btn btn--instr-primary', type: 'button' }, 'Restore to Draft') as HTMLButtonElement;
  const flagArchiveButton = el(
    'button',
    { class: 'btn btn--danger', type: 'button' },
    'Reject & Archive',
  ) as HTMLButtonElement;

  function renderActionButtons(): void {
    const approveTo = approveTarget(state);
    const rejectTo = rejectTarget(state);
    approveButton.disabled = approveTo === null;
    approveButton.title = approveTo ? `Move to ${STATUS_LABEL[approveTo]}` : 'No further approval step from this state';
    rejectButton.disabled = rejectTo === null;
    rejectButton.title = rejectTo ? 'Archive this question after review' : 'This question is already archived';
    restoreButton.hidden = state !== 'archived';
    approveButton.hidden = state === 'archived';
    rejectButton.hidden = state === 'archived';
  }

  async function resolveFlagContext(
    action: 'correct' | 'archive',
    correctnessAffecting: boolean,
  ): Promise<boolean> {
    const reply = studentReplyInput.value.trim();
    for (const flag of flagContext) {
      try {
        await resolveFlag(flag.id, action, correctnessAffecting || undefined, reply || undefined);
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
        return false;
      }
    }
    return true;
  }

  async function doTransition(to: PublicationState): Promise<void> {
    errorSlot.replaceChildren();
    try {
      const updated = await transitionQuestion(questionId, to);
      // Approve/Reject move state and reflect it immediately — no full
      // reload (Task-15 Task E acceptance criteria).
      state = updated.state;
      renderMeta();
      renderActionButtons();
    } catch (error) {
      errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }
  approveButton.addEventListener('click', () => {
    void (async () => {
      const saved = await save();
      if (!saved.ok || !await appendInternalNote()) return;
      const to = approveTarget(state);
      if (to) await doTransition(to);
    })();
  });
  rejectButton.addEventListener('click', () => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: 'Reject and archive this question?',
        message: 'The question will be removed from student practice. It can later be restored to Draft from Question Bank.',
        confirmLabel: 'Reject & Archive',
        tone: 'danger',
      });
      if (!confirmed || !await appendInternalNote()) return;
      const to = rejectTarget(state);
      if (to) await doTransition(to);
    })();
  });
  restoreButton.addEventListener('click', () => void doTransition('draft'));
  flagUpdateButton.addEventListener('click', () => {
    void (async () => {
      const saved = await save();
      if (!saved.ok) return;
      if (!saved.changed) {
        errorSlot.replaceChildren(errorState('Edit the question before updating the Question Bank.'));
        return;
      }
      if (!await appendInternalNote()) return;
      if (!await resolveFlagContext('correct', true)) return;

      // A Test Flag never notifies real students. If a real student flag is
      // also present for this version, use that flag as the remediation
      // notification anchor so affected students are notified by default.
      const notificationAnchor = flagContext.find((flag) => flag.source !== 'instructor-preview-test');
      if (notificationAnchor) {
        try {
          await notifyRemediation(notificationAnchor.id);
        } catch (error) {
          errorSlot.replaceChildren(
            errorState(
              `The question and flags were updated, but affected-student notification failed: ${
                error instanceof ApiError ? error.message : (error as Error).message
              }`,
            ),
          );
          return;
        }
      }
      navigate(`/instructor/course/${encodeURIComponent(courseId)}/flags`);
    })();
  });
  flagArchiveButton.addEventListener('click', () => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: 'Reject and archive this question?',
        message: 'This resolves the open flags and removes the real question from student practice. It can later be restored to Draft.',
        confirmLabel: 'Reject & Archive',
        tone: 'danger',
      });
      if (!confirmed || !await appendInternalNote()) return;
      if (!await resolveFlagContext('archive', false)) return;
      navigate(`/instructor/course/${encodeURIComponent(courseId)}/flags`);
    })();
  });
  renderActionButtons();

  // --- Side-by-side regeneration (IN-Q12) ----------------------------------

  const regenerateButton = el(
    'button',
    { class: 'btn btn--ghost', type: 'button' },
    '↻ Regenerate',
  ) as HTMLButtonElement;
  const regenerationPanel = el('section', {});
  const regenerationPrompt = el('textarea', {
    class: 'input input--area',
    rows: '3',
    text: 'Create a distinct alternative that tests the same learning objective with a different scenario.',
  }) as HTMLTextAreaElement;
  let regenerationOpen = false;
  let regenerationBusy = false;
  let regenerationError: string | null = null;
  let regenerationMessage: string | null = null;
  let regenerationVariant: RegenerationVariant | null = null;

  function previewQuestion(
    title: string,
    question: { stem: string; difficulty: Difficulty; options: QuestionOption[] },
  ): HTMLElement {
    return el(
      'article',
      { class: 'agent-report-panel' },
      el('h4', { class: 'agent-report-panel__title', text: title }),
      el('p', { text: question.stem }),
      el('p', { class: 'question-meta__label', text: `Difficulty: ${question.difficulty}` }),
      el(
        'ol',
        {},
        ...question.options.map((option) =>
          el('li', { text: `${option.key}. ${option.text}` }),
        ),
      ),
    );
  }

  function renderRegenerationPanel(): void {
    if (!regenerationOpen) {
      regenerationPanel.replaceChildren();
      return;
    }
    mount(
      regenerationPanel,
      el('h3', { class: 'detail-section-title', text: 'Regenerate side by side' }),
      el('p', {
        text: 'The alternative is only a preview. The current question stays unchanged until you choose Replace with variant.',
      }),
      el(
        'label',
        { class: 'form-field' },
        el('span', { class: 'form-field__label', text: 'Regeneration prompt' }),
        regenerationPrompt,
      ),
      regenerationError ? errorState(regenerationError) : false,
      regenerationMessage
        ? el('p', { class: 'preseeding-queued-message', role: 'status', text: regenerationMessage })
        : false,
      el(
        'div',
        { class: 'question-actions' },
        el(
          'button',
          {
            class: 'btn btn--instr-primary',
            type: 'button',
            disabled: regenerationBusy ? 'disabled' : undefined,
            onclick: () => void generateVariant(),
          },
          regenerationBusy ? 'Generating alternative…' : 'Generate alternative',
        ),
        el(
          'button',
          {
            class: 'btn btn--ghost',
            type: 'button',
            disabled: regenerationBusy ? 'disabled' : undefined,
            onclick: () => {
              regenerationOpen = false;
              renderRegenerationPanel();
            },
          },
          'Close',
        ),
      ),
      regenerationVariant
        ? el(
            'div',
            { class: 'question-detail-layout' },
            previewQuestion('Current question', {
              stem: baseline.stem,
              difficulty: baseline.difficulty,
              options: baseline.options,
            }),
            previewQuestion('Generated variant', regenerationVariant),
          )
        : false,
      regenerationVariant
        ? el(
            'button',
            {
              class: 'btn btn--instr-primary',
              type: 'button',
              disabled: regenerationBusy ? 'disabled' : undefined,
              onclick: () => void replaceWithVariant(),
            },
            'Replace with variant',
          )
        : false,
    );
  }

  async function generateVariant(): Promise<void> {
    const prompt = regenerationPrompt.value.trim();
    if (!prompt) {
      regenerationError = 'Enter a regeneration prompt.';
      renderRegenerationPanel();
      return;
    }
    regenerationBusy = true;
    regenerationError = null;
    regenerationMessage = null;
    regenerationVariant = null;
    renderRegenerationPanel();
    try {
      const response = await requestQuestionRegeneration(courseId, questionId, prompt);
      regenerationVariant = response.variant;
      regenerationMessage = 'Alternative generated. Compare both versions before replacing.';
    } catch (error) {
      regenerationError = error instanceof ApiError ? error.message : (error as Error).message;
    }
    regenerationBusy = false;
    renderRegenerationPanel();
  }

  async function replaceWithVariant(): Promise<void> {
    if (!regenerationVariant) return;
    regenerationBusy = true;
    regenerationError = null;
    regenerationMessage = null;
    renderRegenerationPanel();
    try {
      const saved = await editQuestion(questionId, {
        stem: regenerationVariant.stem,
        options: regenerationVariant.options,
        difficulty: regenerationVariant.difficulty,
      });
      applySavedVersion(saved);
      regenerationVariant = null;
      regenerationMessage = `Variant saved explicitly as question version ${saved.version}.`;
    } catch (error) {
      regenerationError = error instanceof ApiError ? error.message : (error as Error).message;
    }
    regenerationBusy = false;
    renderRegenerationPanel();
  }

  regenerateButton.addEventListener('click', () => {
    if (!saveButton.disabled) {
      errorSlot.replaceChildren(errorState('Save or discard your current edits before regenerating.'));
      return;
    }
    regenerationOpen = true;
    regenerationError = null;
    regenerationMessage = null;
    renderRegenerationPanel();
  });

  // --- Topics & LOs chips ----------------------------------------------------

  const chipsContainer = el('div', { class: 'question-chips' });
  const chipsErrorSlot = el('div', {});

  async function removeLo(loId: string): Promise<void> {
    chipsErrorSlot.replaceChildren();
    const nextLoIds = loIds.filter((id) => id !== loId);
    try {
      await editQuestion(questionId, { loIds: nextLoIds });
      loIds = nextLoIds;
      renderChips();
    } catch (error) {
      chipsErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }

  async function addLo(loId: string): Promise<void> {
    chipsErrorSlot.replaceChildren();
    const context = findLoContext(tree, loId);
    const nextThemeIds = context && !themeIds.includes(context.theme._id) ? [...themeIds, context.theme._id] : themeIds;
    const nextLoIds = [...loIds, loId];
    try {
      await editQuestion(questionId, { loIds: nextLoIds, themeIds: nextThemeIds });
      loIds = nextLoIds;
      themeIds = nextThemeIds;
      renderChips();
    } catch (error) {
      chipsErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }

  function renderChips(): void {
    const chips = loIds.map((loId) => {
      const context = findLoContext(tree, loId);
      const label = context ? `Topic ${context.themeIndex + 1} › LO ${context.loIndex + 1}` : 'Unknown LO';
      return el(
        'span',
        { class: 'lo-chip' },
        el('span', { text: label }),
        el('button', { class: 'lo-chip__remove', type: 'button', 'aria-label': `Remove ${label}`, onclick: () => void removeLo(loId) }, '×'),
      );
    });

    const available = tree.themes.flatMap((theme, themeIndex) =>
      (theme.los ?? [])
        .filter((lo) => !loIds.includes(lo._id))
        .map((lo, loIndex) => ({ id: lo._id, label: `Topic ${themeIndex + 1} › LO ${loIndex + 1}: ${lo.name}` })),
    );

    const addSelect = el(
      'select',
      { class: 'input lo-chip-add__select' },
      el('option', { value: '', text: 'Choose an LO…' }),
      ...available.map((a) => el('option', { value: a.id, text: a.label })),
    ) as HTMLSelectElement;

    mount(
      chipsContainer,
      ...chips,
      available.length
        ? el(
            'span',
            { class: 'lo-chip-add' },
            addSelect,
            el(
              'button',
              {
                class: 'btn btn--ghost btn--sm',
                type: 'button',
                onclick: () => {
                  if (addSelect.value) void addLo(addSelect.value);
                },
              },
              '+ Add LO',
            ),
          )
        : false,
      chipsErrorSlot,
    );
  }
  renderChips();

  // --- AI Agent Report panel ------------------------------------------------

  const agentDecision = detail.agentDecision;
  const provenance = detail.current.provenance;
  const recordedOrigin = detail.versions
    .map((version) => version.provenance)
    .find((candidate) => candidate?.kind !== 'edited');
  const provenanceLabel =
    provenance?.kind === 'edited' && recordedOrigin
      ? `${provenanceText(provenance)} · Original: ${provenanceText(recordedOrigin)}`
      : provenanceText(provenance);
  const agentPanel = el(
    'div',
    { class: 'agent-report-panel' },
    el('h2', { class: 'agent-report-panel__title', text: 'AI Agent Report' }),
    agentDecision
      ? el(
          'div',
          { class: 'agent-report-block' },
          el(
            'div',
            { class: 'agent-report-block__head' },
            el('span', { text: 'Reviewer Agent' }),
            statusBadge(agentDecision.decision.toUpperCase(), agentDecision.decision),
          ),
          el('p', { class: 'agent-report-block__body', text: agentDecision.reasoning }),
        )
      : el('p', { class: 'agent-report-empty', text: 'No agent report available for this question.' }),
    agentDecision
      ? el(
          'div',
          { class: 'agent-report-block' },
          el('div', { class: 'agent-report-block__head' }, el('span', { text: 'Structure Validator' })),
          el('p', { class: 'agent-report-block__body', text: agentDecision.roleAssessment }),
        )
      : false,
    el(
      'div',
      { class: 'agent-report-block' },
      el('div', { class: 'agent-report-block__head' }, el('span', { text: 'Origin & family' })),
      el('p', { class: 'agent-report-block__body', text: provenanceLabel }),
      detail.templateFamilyId
        ? el('p', { class: 'agent-report-block__body mono', text: `Family ${detail.templateFamilyId}` })
        : false,
    ),
  );

  // --- Assemble --------------------------------------------------------------

  const backPath = fromFlags
    ? `/instructor/course/${encodeURIComponent(courseId)}/flags`
    : `/instructor/course/${encodeURIComponent(courseId)}/bank`;
  const containsTestFlags = flagContext.some((flag) => flag.source === 'instructor-preview-test');
  const containsRealFlags = flagContext.some((flag) => flag.source !== 'instructor-preview-test');
  const flagBanner = fromFlags
    ? el(
        'section',
        { class: `flag-editor-banner${containsTestFlags ? ' flag-editor-banner--test' : ''}` },
        el('h2', {
          class: 'flag-editor-banner__title',
          text: containsTestFlags ? 'Instructor Preview Test Flag' : 'Student Flag Review',
        }),
        el('p', {
          text: containsTestFlags
            ? 'This flag came from Instructor Preview. Saving here changes the real Question Bank, but no real students will be notified for the test flag.'
            : 'Saving an edited question resolves these flags and notifies affected students by default.',
        }),
        containsTestFlags && containsRealFlags
          ? el('p', { text: 'Real student flags also exist for this version; those students will receive the response and affected-content notification.' })
          : false,
        ...flagContext.map((flag) =>
          el(
            'p',
            { class: 'flag-editor-banner__reason' },
            el('strong', { text: flag.source === 'instructor-preview-test' ? 'TEST: ' : 'Student: ' }),
            el('span', { text: flag.reason?.trim() || 'No reason supplied.' }),
          ),
        ),
      )
    : false;

  body.replaceChildren(
    el(
      'a',
      {
        class: 'breadcrumb-back',
        href: `#${backPath}`,
        onclick: (e: Event) => {
          e.preventDefault();
          navigate(backPath);
        },
      },
      fromFlags ? '← Back to Flag Queue' : '← Back to Question Bank',
    ),
    pageHeader('Question', ''),
    ...(flagBanner ? [flagBanner] : []),
    el(
      'div',
      { class: 'question-detail-layout' },
      el(
        'div',
        { class: 'question-editor' },
        el('div', { class: 'question-meta-row' }, metaLabel, el('span', {}, el('label', { text: 'Difficulty: ' }), difficultySelect)),
        el('h3', { class: 'detail-section-title', text: 'Topics & LOs' }),
        chipsContainer,
        el('h3', { class: 'detail-section-title', text: 'Question Stem' }),
        stemTextarea,
        optionsSection,
        errorSlot,
        el(
          'section',
          { class: 'question-notes' },
          el('h3', { class: 'detail-section-title', text: 'Internal review comment' }),
          el('p', { class: 'muted', text: 'Optional. Visible only to instructors and TAs.' }),
          internalNoteInput,
          addInternalNoteButton,
          notesList,
        ),
        fromFlags
          ? el(
              'section',
              { class: 'question-student-reply' },
              el('h3', { class: 'detail-section-title', text: 'Reply to flagging student(s)' }),
              el('p', {
                class: 'muted',
                text: containsRealFlags
                  ? 'Optional. This text is sent to students whose flags are resolved.'
                  : 'This is a Test Flag, so no message will be sent to a real student.',
              }),
              studentReplyInput,
            )
          : false,
        el(
          'div',
          { class: 'question-actions' },
          fromFlags ? flagUpdateButton : approveButton,
          fromFlags ? flagArchiveButton : rejectButton,
          !fromFlags ? restoreButton : false,
          regenerateButton,
          el(
            'a',
            {
              class: 'btn btn--ghost',
              href: `#/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(questionId)}/params`,
              onclick: (e: Event) => {
                e.preventDefault();
                navigate(`/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(questionId)}/params`);
              },
            },
            '⚙ Parameters',
          ),
        ),
        regenerationPanel,
        !fromFlags ? el('div', { class: 'question-save-row' }, saveButton) : false,
      ),
      agentPanel,
    ),
  );
  updateSaveButton();
  renderInternalNotes();
}

export function renderQuestionDetail(outlet: HTMLElement, params: RouteParams): void {
  void renderQuestionDetailInner(outlet, params.questionId, params.id);
}
