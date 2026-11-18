import { attachTutorial } from '../../tutorials.js';
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
  getAnswerDistribution,
  getQuestion,
  getQuestionSample,
  listCourseFlags,
  notifyRemediation,
  regenerateQuestion as requestQuestionRegeneration,
  resolveFlag,
  resolveTaQuestionSuggestion,
  transitionQuestion,
  type CourseTree,
  type Difficulty,
  type Flag,
  type OptionRole,
  type PublicationState,
  type QuestionDetail,
  type QuestionOption,
  type QuestionSample,
  type QuestionVersion,
  type RegenerationVariant,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { similarityLabel, similarityLinks } from './similarity-label.js';
import { runButtonAction } from '../../action-state.js';
import {
  editableVariableNames,
  toDisplayPlaceholders,
  toStoredPlaceholders,
  unresolvedPlaceholderWarning,
} from '../../placeholders.js';
import { statusBadge, ROLE_LABEL } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import { errorState, loadingState } from '../../ui.js';
import { renderRichText } from '../../render.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { STATUS_LABEL, TYPE_LABEL } from '../../question-labels.js';
import { repairSummary, solverSummary } from './questions-model.js';
import { authoringAnswer } from './authoring-answer.js';
import { questionGenerationUsage } from './question-generation-usage.js';

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

/** The "Add LO" picker's choices: every LO not already tagged, labelled by its
 * position in the whole outline. Numbered BEFORE filtering — numbering the
 * filtered list shifted every LO after a tagged one down by one (2026-09-14: a
 * question tagged to LO 2 listed the real LO 3 as "LO 2"). */
export function addableLoOptions(tree: CourseTree, taggedLoIds: readonly string[]): Array<{ id: string; label: string }> {
  return tree.themes.flatMap((theme, themeIndex) =>
    (theme.los ?? [])
      .map((lo, loIndex) => ({ id: lo._id, label: `Topic ${themeIndex + 1} › LO ${loIndex + 1}: ${lo.name}` }))
      .filter((option) => !taggedLoIds.includes(option.id)),
  );
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
  const body = el('div', { class: 'question-detail-workbench' }, loadingState('Loading question…'));
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
  const analyticsVersionId = query.get('analyticsVersionId');
  const analyticsRoute = location.hash;
  const analyticsNotice = el('section', { class: 'card stack', 'aria-label': 'Recorded analytics version' });
  async function loadAnalyticsVersion(): Promise<void> {
    analyticsNotice.replaceChildren(el('h2', { text: 'Recorded analytics version' }),
      el('p', { text: 'Loading recorded content… The editor below shows current content.' }));
    try {
      const recorded = await getAnswerDistribution(courseId, questionId, { versionId: analyticsVersionId! });
      if (!root.isConnected || location.hash !== analyticsRoute) return;
      analyticsNotice.replaceChildren(el('h2', { text: 'Recorded analytics version' }),
        el('p', { text: `Version ${recorded.version} · ${recorded.isCurrent ? 'Current content' : 'Historical content — the editor below shows the current version.'}` }),
        el('p', { text: recorded.stem }),
        el('ul', {}, ...recorded.options.map((option) => el('li', { text: `${option.key}. ${option.text} (${option.role})` }))));
    } catch (error) {
      if (!root.isConnected || location.hash !== analyticsRoute) return;
      analyticsNotice.replaceChildren(el('h2', { text: 'Recorded analytics version' }),
        el('p', { text: 'The editor below shows current content.' }),
        error instanceof ApiError && (error.status === 404 || error.status === 400)
          ? el('p', { text: 'The requested recorded version was not found or its identifier is invalid.' })
          : errorState(`Unable to load recorded content: ${error instanceof Error ? error.message : 'Temporary request failure.'}`, () => void loadAnalyticsVersion()));
    }
  }
  if (analyticsVersionId) void loadAnalyticsVersion();
  const fromFlags = query.get('from') === 'flags';
  // Every way back lands on the Questions workspace with this question
  // selected; without a tab it opens the tab that holds the question's state.
  const questionsBackPath = `/instructor/course/${encodeURIComponent(courseId)}/questions?${new URLSearchParams({
    ...(fromFlags ? { tab: 'flags' } : {}),
    q: questionId,
  }).toString()}`;
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
  let expectedVersionId = detail.current._id;
  let loIds: string[] = [...detail.loIds];
  let themeIds: string[] = [...detail.themeIds];

  // Variables are STORED as {{NAME}} but EDITED as [NAME] — see
  // placeholders.ts. Drafts and the edited-comparison baseline are both held
  // in display form, so the "edited" highlighting compares like with like; the
  // save path converts back — including names the stored text uses as
  // placeholders without a variable, so an unrelated save cannot flatten them
  // into literal brackets (see editableVariableNames).
  const variableNames = editableVariableNames(detail.current);
  const toDisplay = toDisplayPlaceholders;
  const toStored = (text: string): string => toStoredPlaceholders(text, variableNames);

  const baseline = {
    stem: toDisplay(detail.current.stem),
    difficulty: detail.current.difficulty,
    options: detail.current.options.map((o) => ({
      ...o,
      text: toDisplay(o.text),
      explanation: toDisplay(o.explanation),
    })),
  };
  const draftOptions: OptionDraft[] = detail.current.options.map((o) => ({
    ...o,
    text: toDisplay(o.text),
    explanation: toDisplay(o.explanation),
  }));

  // Worked example: what a STUDENT would see. The editor above shows the raw
  // {{placeholder}} template, which is correct for editing but unreadable for
  // judging whether the question is any good. Substitution is done server-side
  // (GET .../sample) so this example and the real serve path can never drift.
  //
  // This panel renders markdown + KaTeX, like the student card does. It used to
  // print raw strings, so an instructor approving a question saw LaTeX source
  // where the student sees maths — which made it impossible to review the one
  // thing this panel exists to show, and hid bad LaTeX until a student hit it.
  const sampleSection = el('section', { class: 'question-sample', id: 'question-student-preview', hidden: true, 'aria-label': 'Student preview' });
  let sampleVersionId = '';
  let sampleRequest = 0;

  // Placeholders the server can never fill keep the question from being served.
  // In the editor they look like any other [NAME] variable, so say so plainly.
  const placeholderWarningSlot = el('div', { class: 'question-detail__placeholder-warning' });
  function renderPlaceholderWarning(problems: readonly string[] | undefined): void {
    const warning = unresolvedPlaceholderWarning(problems);
    mount(
      placeholderWarningSlot,
      warning
        ? el(
            'section',
            { class: 'duplicate-callout question-placeholder-warning', role: 'status' },
            el('p', { class: 'duplicate-callout__title', text: warning.title }),
            el('p', { class: 'duplicate-callout__body', text: warning.body }),
          )
        : false,
    );
  }
  renderPlaceholderWarning(detail.current.unresolvablePlaceholders);

  /** `div`, not `p`: marked emits block-level HTML, which a `<p>` auto-closes. */
  function sampleStem(stem: string): HTMLElement {
    const node = el('div', { class: 'gw-stem question-sample__stem' });
    renderRichText(node, stem);
    return node;
  }

  function renderSample(sample: QuestionSample): void {
    sampleSection.replaceChildren(
      el('h2', { text: 'Student preview' }),
      el('p', {
        class: 'gw-lead',
        text: sample.parameterized
          ? 'One computed example from the saved version. Students may receive different values.'
          : 'Preview of the saved question and its explanations.',
      }),
      sampleStem(sample.stem),
      el(
        'div',
        { class: 'question-sample__options' },
        ...sample.options.map((option) => authoringAnswer(
          option, baseline.options.some((saved) => saved.key === option.key && saved.role === 'correct'), 'question-sample__option',
        )),
      ),
    );
  }

  async function loadSample(): Promise<void> {
    if (sampleVersionId === expectedVersionId) return;
    const request = ++sampleRequest;
    const version = expectedVersionId;
    mount(sampleSection, loadingState('Loading student preview…'));
    try {
      const sample = await getQuestionSample(questionId);
      if (request !== sampleRequest || version !== expectedVersionId || !root.isConnected) return;
      sampleVersionId = version;
      renderSample(sample);
    } catch {
      if (request === sampleRequest && version === expectedVersionId) {
        mount(sampleSection, errorState('The student preview could not load.', () => void loadSample()));
      }
    }
  }
  let draftStem = baseline.stem;
  let draftDifficulty: Difficulty = baseline.difficulty;

  const pendingSuggestions = detail.suggestions?.filter((suggestion) => suggestion.status === 'pending') ?? [];

  const errorSlot = el('div', { class: 'question-detail__error' });
  const editStatus = el('span', { class: 'muted', role: 'status' });
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
    const statusText = anyEdited ? 'Unsaved changes' : '';
    if (editStatus.textContent !== statusText) editStatus.textContent = statusText;
    root.querySelectorAll<HTMLButtonElement>('[data-regen-requires-saved]').forEach(button => {
      button.disabled = anyEdited || button.dataset.regenLocked === 'true';
    });
    flagUpdateButton.disabled = !anyEdited;
  }

  const stemTextarea = el('textarea', {
    class: 'input input--area question-stem-input',
    'aria-label': 'Question stem',
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
      'aria-label': 'Difficulty',
      onchange: (e: Event) => {
        draftDifficulty = (e.target as HTMLSelectElement).value as Difficulty;
        difficultySelect.classList.toggle('edited', isFieldEdited(draftDifficulty, baseline.difficulty));
        updateSaveButton();
      },
    },
    ...DIFFICULTIES.map((d) => el('option', { value: d, text: d.charAt(0).toUpperCase() + d.slice(1), selected: d === draftDifficulty ? 'selected' : undefined })),
  ) as HTMLSelectElement;

  const suggestionPanel = el(
    'section',
    { class: 'question-detail__suggestions stack' },
    el('h3', { text: 'TA suggested edits' }),
    ...(pendingSuggestions.length
      ? pendingSuggestions.map((suggestion) => {
          const summary = Object.entries(suggestion.patch)
            .map(([field, value]) => `${field}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
            .join('\n');
          const status = el('span', { 'aria-live': 'polite' });
          return el('article', { class: 'stack stack--sm' },
            el('p', { class: 'muted', text: `${suggestion.puid} · ${new Date(suggestion.at).toLocaleString()}` }),
            el('pre', { class: 'code-block', text: summary }),
            el('div', { class: 'cluster' },
              el('button', {
                class: 'btn btn--secondary btn--sm', type: 'button', text: 'Load into editor',
                onclick: () => {
                  if (suggestion.patch.stem !== undefined) {
                    draftStem = toDisplay(suggestion.patch.stem);
                    stemTextarea.value = draftStem;
                    stemTextarea.classList.toggle('edited', isFieldEdited(draftStem, baseline.stem));
                  }
                  if (suggestion.patch.difficulty !== undefined) {
                    draftDifficulty = suggestion.patch.difficulty;
                    difficultySelect.value = draftDifficulty;
                    difficultySelect.classList.toggle('edited', isFieldEdited(draftDifficulty, baseline.difficulty));
                  }
                  updateSaveButton();
                },
              }),
              el('button', {
                class: 'btn btn--instr-primary btn--sm', type: 'button', text: 'Accept exactly',
                onclick: async () => {
                  await resolveTaQuestionSuggestion(questionId, suggestion.id, 'accept');
                  await renderQuestionDetailInner(outlet, questionId, fallbackCourseId);
                },
              }),
              el('button', {
                class: 'btn btn--ghost btn--sm', type: 'button', text: 'Discard',
                onclick: async () => {
                  try {
                    await resolveTaQuestionSuggestion(questionId, suggestion.id, 'discard');
                    await renderQuestionDetailInner(outlet, questionId, fallbackCourseId);
                  } catch (error) {
                    status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
                  }
                },
              }),
              status,
            ),
          );
        })
      : [el('p', { class: 'muted', text: 'No pending TA suggestions.' })]),
  );

  const optionInputs = new Map<string, { card: HTMLElement; label: HTMLElement; textInput: HTMLTextAreaElement; explInput: HTMLTextAreaElement }>();

  const optionsSection = el(
    'div',
    { class: 'option-editors' },
    ...[...draftOptions].sort((a, b) => a.key.localeCompare(b.key)).map((draft) => {
      const label = el('span', { class: 'option-editor__role-label', text: ROLE_LABEL[draft.role] });

      const textInput = el('textarea', {
        class: 'input input--area option-editor__text',
        rows: '2',
        'aria-label': `Option ${draft.key} text`,
        text: draft.text,
        oninput: (e: Event) => {
          draft.text = (e.target as HTMLTextAreaElement).value;
          textInput.classList.toggle('edited', isFieldEdited(draft.text, baseline.options.find((option) => option.key === draft.key)?.text));
          updateSaveButton();
        },
      });

      const explInput = el('textarea', {
        class: 'input input--area option-editor__explanation',
        'aria-label': `Option ${draft.key} explanation`,
        rows: '3',
        text: draft.explanation,
        oninput: (e: Event) => {
          draft.explanation = (e.target as HTMLTextAreaElement).value;
          explInput.classList.toggle('edited', isFieldEdited(draft.explanation, baseline.options.find((option) => option.key === draft.key)?.explanation));
          updateSaveButton();
        },
      }) as HTMLTextAreaElement;

      const card = el(
        'section',
        { class: `option-editor${draft.role === 'correct' ? ' is-correct' : ''}`, 'aria-label': `Option ${draft.key}` },
        el('header', { class: 'option-editor__heading' }, el('strong', { text: draft.key }), label),
        textInput,
        el('label', { class: 'option-editor__explanation-label' }, 'Explanation', explInput),
      );
      optionInputs.set(draft.key, { card, label, textInput, explInput });
      return card;
    }),
  );

  function applySavedVersion(saved: QuestionVersion): void {
    expectedVersionId = saved._id;
    renderPlaceholderWarning(saved.unresolvablePlaceholders);
    // `saved` comes from the server in STORED form; the editor works in
    // display form, so convert on the way in.
    baseline.stem = toDisplay(saved.stem);
    baseline.difficulty = saved.difficulty;
    const savedOptions = new Map(saved.options.map((option) => [option.key, option]));
    baseline.options = draftOptions.map((draft) => {
      const option = savedOptions.get(draft.key) ?? draft;
      return { ...option, text: toDisplay(option.text), explanation: toDisplay(option.explanation) };
    });
    draftStem = toDisplay(saved.stem);
    draftDifficulty = saved.difficulty;

    stemTextarea.value = draftStem;
    stemTextarea.classList.remove('edited');
    difficultySelect.value = draftDifficulty;
    difficultySelect.classList.remove('edited');
    for (const [index, draft] of draftOptions.entries()) {
      const option = baseline.options[index];
      const input = optionInputs.get(draft.key)!;
      Object.assign(draft, option);
      input.textInput.value = option.text;
      input.textInput.classList.remove('edited');
      input.explInput.value = option.explanation;
      input.explInput.classList.remove('edited');
      input.label.textContent = ROLE_LABEL[option.role];
      input.card.classList.toggle('is-correct', option.role === 'correct');
    }
    updateSaveButton();
    if (!sampleSection.hidden) void loadSample();
  }

  async function save(): Promise<{ ok: boolean; changed: boolean }> {
    errorSlot.replaceChildren();
    const patch: { stem?: string; options?: QuestionOption[]; difficulty?: Difficulty } = {};
    if (isFieldEdited(draftStem, baseline.stem)) patch.stem = toStored(draftStem);
    const optionsChanged = draftOptions.some(
      (o, i) => isFieldEdited(o.text, baseline.options[i].text) || isFieldEdited(o.explanation, baseline.options[i].explanation),
    );
    if (optionsChanged) {
      patch.options = draftOptions.map((o) => ({
        key: o.key,
        text: toStored(o.text),
        role: o.role,
        explanation: toStored(o.explanation),
      }));
    }
    if (isFieldEdited(draftDifficulty, baseline.difficulty)) patch.difficulty = draftDifficulty;
    if (Object.keys(patch).length === 0) return { ok: true, changed: false };

    try {
      const saved = await editQuestion(questionId, { ...patch, expectedVersionId });
      // The saved version becomes the new edited-comparison baseline
      // (Task-15 Task E: "Reset after a successful save").
      applySavedVersion(saved);
      return { ok: true, changed: true };
    } catch (error) {
      errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      return { ok: false, changed: false };
    }
  }
  saveButton.addEventListener('click', () => void runButtonAction(saveButton, save));

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
  addInternalNoteButton.addEventListener('click', () => void runButtonAction(addInternalNoteButton, appendInternalNote));

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
      const updated = await transitionQuestion(questionId, to, expectedVersionId);
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
    void runButtonAction(approveButton, async () => {
      const saved = await save();
      if (!saved.ok || !await appendInternalNote()) return;
      const to = approveTarget(state);
      if (to) await doTransition(to);
    });
  });
  rejectButton.addEventListener('click', () => {
    void runButtonAction(rejectButton, async () => {
      const confirmed = await confirmDialog({
        title: 'Reject and archive this question?',
        message: 'The question will be removed from student practice. It can later be restored to review from Questions → Archived.',
        confirmLabel: 'Reject & Archive',
        tone: 'danger',
      });
      if (!confirmed || !await appendInternalNote()) return;
      const to = rejectTarget(state);
      if (to) await doTransition(to);
    });
  });
  restoreButton.addEventListener('click', () => void runButtonAction(restoreButton, () => doTransition('draft')));
  flagUpdateButton.addEventListener('click', () => {
    void runButtonAction(flagUpdateButton, async () => {
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
      navigate(questionsBackPath);
    });
  });
  flagArchiveButton.addEventListener('click', () => {
    void runButtonAction(flagArchiveButton, async () => {
      const confirmed = await confirmDialog({
        title: 'Reject and archive this question?',
        message: 'This resolves the open flags and removes the real question from student practice. It can later be restored to Draft.',
        confirmLabel: 'Reject & Archive',
        tone: 'danger',
      });
      if (!confirmed || !await appendInternalNote()) return;
      if (!await resolveFlagContext('archive', false)) return;
      navigate(questionsBackPath);
    });
  });
  renderActionButtons();

  // --- Side-by-side regeneration (IN-Q12) ----------------------------------

  const regenerateButton = el(
    'button',
    { class: 'btn btn--ghost', type: 'button' },
    'Regenerate',
  ) as HTMLButtonElement;
  const regenerationPanel = el('section', { class: 'question-detail__regeneration' });
  const regenerationPrompt = el('textarea', {
    class: 'input input--area',
    rows: '3',
    text: 'Create a distinct alternative that tests the same learning objective with a different scenario.',
  }) as HTMLTextAreaElement;
  let regenerationOpen = false;
  let regenerationBusy = false;
  let regenerationBusyAction: 'generate' | 'replace' | null = null;
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
          el('li', { text: `${option.key}. ${toDisplayPlaceholders(option.text)}` }),
        ),
      ),
    );
  }

  function variantDecisionPanel(decision: RegenerationVariant['agentDecision']): HTMLElement {
    return el(
      'article',
      { class: 'agent-report-panel', 'aria-label': 'Check of generated variant' },
      el('h4', { class: 'agent-report-panel__title', text: 'Check of generated variant' }),
      statusBadge(decision.decision.toUpperCase(), decision.decision),
      el('p', { class: 'agent-report-block__body', text: decision.reasoning }),
      decision.suggestions?.length
        ? el('ul', { class: 'agent-report-block__body' }, ...decision.suggestions.map((suggestion) => el('li', { text: suggestion })))
        : false,
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
            'data-regen-requires-saved': 'true',
            'data-regen-locked': String(regenerationBusy),
            disabled: regenerationBusy || !saveButton.disabled ? 'disabled' : undefined,
            busy: regenerationBusyAction === 'generate',
            onclick: () => generateVariant(),
          },
          regenerationBusyAction === 'generate' ? 'Generating alternative…' : 'Generate alternative',
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
      regenerationVariant ? variantDecisionPanel(regenerationVariant.agentDecision) : false,
      regenerationVariant
        ? el(
            'button',
            {
              class: 'btn btn--instr-primary',
              type: 'button',
              'data-regen-requires-saved': 'true',
              'data-regen-locked': String(regenerationBusy),
              disabled: regenerationBusy || !saveButton.disabled ? 'disabled' : undefined,
              busy: regenerationBusyAction === 'replace',
              onclick: () => replaceWithVariant(),
            },
            regenerationBusyAction === 'replace' ? 'Replacing…' : 'Replace with variant',
          )
        : false,
    );
  }

  async function generateVariant(): Promise<void> {
    if (!saveButton.disabled) { regenerationError = 'Save or discard your current edits before regenerating.'; renderRegenerationPanel(); return; }
    const prompt = regenerationPrompt.value.trim();
    if (!prompt) {
      regenerationError = 'Enter a regeneration prompt.';
      renderRegenerationPanel();
      return;
    }
    regenerationBusy = true;
    regenerationBusyAction = 'generate';
    regenerationError = null;
    regenerationMessage = null;
    regenerationVariant = null;
    renderRegenerationPanel();
    try {
      const response = await requestQuestionRegeneration(courseId, questionId, prompt);
      regenerationVariant = response.variant;
      regenerationMessage = 'Alternative generated. Compare both versions and its check before replacing.';
    } catch (error) {
      const failure = error instanceof ApiError ? error.message : (error as Error).message;
      regenerationError = failure;
    }
    regenerationBusy = false;
    regenerationBusyAction = null;
    renderRegenerationPanel();
  }

  async function replaceWithVariant(): Promise<void> {
    if (!saveButton.disabled) { regenerationError = 'Save or discard your current edits before replacing.'; renderRegenerationPanel(); return; }
    if (!regenerationVariant) return;
    regenerationBusy = true;
    regenerationBusyAction = 'replace';
    regenerationError = null;
    regenerationMessage = null;
    renderRegenerationPanel();
    try {
      const saved = await editQuestion(questionId, {
        expectedVersionId,
        stem: regenerationVariant.stem,
        options: regenerationVariant.options,
        difficulty: regenerationVariant.difficulty,
        ...(regenerationVariant.paramSlots !== undefined
          ? { paramSlots: regenerationVariant.paramSlots }
          : {}),
        ...(regenerationVariant.derivedValues !== undefined
          ? { derivedValues: regenerationVariant.derivedValues }
          : {}),
        ...(regenerationVariant.numericKind !== undefined
          ? { numericKind: regenerationVariant.numericKind }
          : {}),
      });
      applySavedVersion(saved);
      regenerationVariant = null;
      regenerationMessage = `Variant saved explicitly as question version ${saved.version}.`;
    } catch (error) {
      regenerationError = error instanceof ApiError ? error.message : (error as Error).message;
    }
    regenerationBusy = false;
    regenerationBusyAction = null;
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
    showEditor();
    regenerationPanel.scrollIntoView({ block: 'start' });
  });

  // --- Topics & LOs chips ----------------------------------------------------

  const chipsContainer = el('div', { class: 'question-chips' });
  const chipsErrorSlot = el('div', {});

  async function removeLo(loId: string): Promise<void> {
    chipsErrorSlot.replaceChildren();
    const nextLoIds = loIds.filter((id) => id !== loId);
    try {
      await editQuestion(questionId, { expectedVersionId, expectedTags: { loIds, themeIds }, loIds: nextLoIds });
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
      await editQuestion(questionId, { expectedVersionId, expectedTags: { loIds, themeIds }, loIds: nextLoIds, themeIds: nextThemeIds });
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
        el('button', { class: 'lo-chip__remove', type: 'button', 'aria-label': `Remove ${label}`, onclick: () => removeLo(loId) }, '×'),
      );
    });

    const available = addableLoOptions(tree, loIds);

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
  const repair = agentDecision?.repair;
  const repairText = repairSummary(repair);
  const solverText = solverSummary(detail.current.verification);
  const provenance = detail.current.provenance;
  const recordedOrigin = detail.versions
    .map((version) => version.provenance)
    .find((candidate) => candidate?.kind !== 'edited');
  const provenanceLabel =
    provenance?.kind === 'edited' && recordedOrigin
      ? `${provenanceText(provenance)} · Original: ${provenanceText(recordedOrigin)}`
      : provenanceText(provenance);
  const agentPanel = el(
    'section',
    { class: 'agent-report-panel', 'aria-label': 'AI check' },
    el('h2', { class: 'agent-report-panel__title', text: 'AI check' }),
    agentDecision
      ? el(
          'div',
          { class: 'agent-report-block' },
          el(
            'div',
            { class: 'agent-report-block__head' },
            statusBadge(agentDecision.decision.toUpperCase(), agentDecision.decision),
          ),
          el('p', { class: 'agent-report-block__body', text: agentDecision.reasoning }),
          agentDecision.suggestions?.length
            ? el('ul', { class: 'agent-report-block__body' }, ...agentDecision.suggestions.map((s) => el('li', { text: s })))
            : false,
        )
      : el('p', { class: 'agent-report-empty', text: 'No agent report available for this question.' }),
    repairText
      ? el('div', { class: 'agent-report-block questions-reader__repair' },
          el('p', { text: repairText }),
          repair?.originalFindings.length
            ? el('details', {}, el('summary', { text: 'What the first version got wrong' }),
                el('ul', {}, ...repair.originalFindings.map((finding) => el('li', { text: finding }))))
            : false)
      : false,
    solverText ? el('p', { class: 'questions-reader__solver', text: solverText }) : false,
    detail.similarity
      ? el(
          'div',
          { class: 'agent-report-block' },
          el('div', { class: 'agent-report-block__head' }, el('span', { text: 'Similarity' })),
          el('p', { class: 'agent-report-block__body', text: similarityLabel(detail.similarity) }),
          similarityLinks(courseId, detail.similarity),
        )
      : false,
    agentDecision
      ? el(
          'details',
          { class: 'agent-report-block' },
          el('summary', { class: 'agent-report-block__head', text: 'Answer structure' }),
          el('p', { class: 'agent-report-block__body', text: agentDecision.roleAssessment }),
        )
      : false,
    el(
      'details',
      { class: 'agent-report-block' },
      el('summary', { class: 'agent-report-block__head', text: 'Origin & family' }),
      el('p', { class: 'agent-report-block__body', text: provenanceLabel }),
      detail.templateFamilyId
        ? el('p', { class: 'agent-report-block__body mono', text: `Family ${detail.templateFamilyId}` })
        : false,
    ),
  );

  // --- Assemble --------------------------------------------------------------

  const backPath = questionsBackPath;
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

  const editor = el('div', { class: 'question-editor', id: 'question-detail-fields' },
    placeholderWarningSlot,
    el('label', { class: 'question-detail__stem-label' },
      el('span', { text: 'Question stem' }), stemTextarea),
    el('section', { 'aria-labelledby': 'question-detail-options' },
      el('h2', { id: 'question-detail-options', text: 'Answer options' }), optionsSection),
    el('details', { class: 'question-detail__team', open: fromFlags || pendingSuggestions.length > 0 },
      el('summary', { text: pendingSuggestions.length ? `Teaching team · ${pendingSuggestions.length} pending` : 'Teaching team' }),
      pendingSuggestions.length ? suggestionPanel : false,
      el('section', { class: 'question-notes' },
        el('label', { class: 'question-detail__stem-label' },
          el('span', { text: 'Internal review comment' }), internalNoteInput),
        addInternalNoteButton, notesList)),
    fromFlags ? el('section', { class: 'question-student-reply' },
      el('label', { class: 'question-detail__stem-label' },
        el('span', { text: 'Reply to flagging students' }), studentReplyInput),
      el('p', { class: 'muted', text: containsRealFlags
        ? 'Optional. This text is sent to students whose flags are resolved.'
        : 'This is a Test Flag, so no message will be sent to a real student.' })) : false,
    regenerationPanel);

  function showEditor(): void {
    editor.hidden = false;
    sampleSection.hidden = true;
    editorTab.setAttribute('aria-pressed', 'true');
    previewTab.setAttribute('aria-pressed', 'false');
  }

  const editorTab = el('button', { type: 'button', 'aria-pressed': 'true', 'aria-controls': editor.id, onclick: showEditor }, 'Edit question');
  const previewTab = el('button', {
    type: 'button', 'aria-pressed': 'false', 'aria-controls': sampleSection.id,
    onclick: () => {
      editor.hidden = true;
      sampleSection.hidden = false;
      editorTab.setAttribute('aria-pressed', 'false');
      previewTab.setAttribute('aria-pressed', 'true');
      void loadSample();
    },
  }, 'Student preview');

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
      '← Back to Questions',
    ),
    el('header', { class: 'gw-header question-detail__header' },
      el('div', {}, el('h1', { text: 'Question details' }), metaLabel),
      el('div', { class: 'questions-header__actions' },
        detail.state !== 'archived'
          ? el('a', { class: 'btn btn--ghost btn--sm', href: `#/instructor/course/${detail.courseId}/bank/${questionId}/collaborate`, text: 'Edit together' })
          : false,
        regenerateButton,
        el('a', { class: 'btn btn--ghost btn--sm',
          href: `#/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(questionId)}/params`,
          text: 'Parameters' }))),
    ...(analyticsVersionId ? [analyticsNotice] : []),
    ...(flagBanner ? [flagBanner] : []),
    el(
      'div',
      { class: 'gw-grid question-detail__grid' },
      el(
        'div',
        { class: 'question-detail__main' },
        el('div', { class: 'question-detail__mode' },
          el('div', { class: 'gw-tabs', role: 'group', 'aria-label': 'Question detail view' }, editorTab, previewTab)),
        el('div', { class: 'gw-body question-detail__body' }, editor, sampleSection),
      ),
      el('aside', { class: 'gw-plan question-detail__inspector', 'aria-label': 'Question review and settings' },
        questionGenerationUsage(detail),
        agentPanel,
        el('section', { class: 'question-detail__settings' },
          el('h2', { text: 'Question settings' }),
          el('label', { class: 'question-detail__stem-label' }, el('span', { text: 'Difficulty' }), difficultySelect),
          el('h3', { text: 'Topics & LOs' }), chipsContainer)),
      el('div', { class: 'question-detail__footer' },
        errorSlot,
        el(
          'footer',
          { class: 'gw-footer question-actions' },
          el('div', { class: 'question-detail__decision' },
          fromFlags ? flagArchiveButton : rejectButton,
          !fromFlags ? restoreButton : false),
          el('div', { class: 'question-detail__save' }, editStatus,
            !fromFlags ? saveButton : false,
            fromFlags ? flagUpdateButton : approveButton))),
    ),
  );
  updateSaveButton();
  renderInternalNotes();
  // The Questions reader's "Regenerate side by side" lands here.
  if (query.get('intent') === 'regenerate' && detail.state !== 'archived') {
    regenerationOpen = true;
    renderRegenerationPanel();
    regenerationPanel.scrollIntoView({ block: 'start' });
  }
  attachTutorial(body, 'instructor-question-editor', {"question-editor-content": ".question-editor", "question-editor-actions": ".question-actions"});
}

export function renderQuestionDetail(outlet: HTMLElement, params: RouteParams): void {
  void renderQuestionDetailInner(outlet, params.questionId, params.id);
}
