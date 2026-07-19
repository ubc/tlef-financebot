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
  ApiError,
  editQuestion,
  getCourseTree,
  getQuestion,
  transitionQuestion,
  type CourseTree,
  type Difficulty,
  type OptionRole,
  type PublicationState,
  type QuestionDetail,
  type QuestionOption,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge, ROLE_LABEL } from '../../instructor-ui.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
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

// Canonical display order for the four option roles (I6) — Correct Answer,
// Good Confounder, Related but Incorrect, Easy to Eliminate. A true/false
// question only ever has 'correct' + 'common-misconception' (server coerces
// its wrong option's role, see questions.service.ts's assertOptionInvariants)
// so this list is filtered down to the roles actually present.
const ROLE_ORDER: OptionRole[] = ['correct', 'common-misconception', 'partially-correct', 'clearly-wrong'];

/** Approve always moves toward 'approved' one step at a time, per
 * PUBLICATION_TRANSITIONS (server/src/types/domain.ts): a Draft question
 * can't jump straight to Approved (only pending-review/archived are legal
 * from draft), so Approve sends it to pending-review first; from
 * pending-review/reviewed/paused it goes straight to approved. `null` means
 * there's no forward action (already approved, or archived). */
function approveTarget(state: PublicationState): PublicationState | null {
  if (state === 'draft') return 'pending-review';
  if (state === 'pending-review' || state === 'reviewed' || state === 'paused') return 'approved';
  return null;
}

/** Reject sends a question back to Draft for rework — only legal from
 * pending-review/reviewed (PUBLICATION_TRANSITIONS has no approved->draft or
 * draft->draft edge). `null` means there's nothing to reject. */
function rejectTarget(state: PublicationState): PublicationState | null {
  if (state === 'pending-review' || state === 'reviewed') return 'draft';
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
  const root = el('div', { class: 'view' }, body);
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

  async function save(): Promise<void> {
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
    if (Object.keys(patch).length === 0) return;

    try {
      const saved = await editQuestion(questionId, patch);
      // The saved version becomes the new edited-comparison baseline
      // (Task-15 Task E: "Reset after a successful save").
      baseline.stem = saved.stem;
      baseline.difficulty = saved.difficulty;
      baseline.options = saved.options.map((o) => ({ ...o }));
      draftStem = saved.stem;
      draftDifficulty = saved.difficulty;

      stemTextarea.value = draftStem;
      stemTextarea.classList.remove('edited');
      difficultySelect.value = draftDifficulty;
      difficultySelect.classList.remove('edited');
      for (const input of optionInputs) {
        const savedOption = saved.options.find((o) => o.role === input.role);
        const draft = draftOptions.find((o) => o.role === input.role);
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
    } catch (error) {
      errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }
  saveButton.addEventListener('click', () => void save());

  // --- Meta row (type · state text; reflected in place on Approve/Reject) --

  const metaLabel = el('span', { class: 'question-meta__label', text: `${TYPE_LABEL[detail.current.type]} · ${STATUS_LABEL[state]}` });

  function renderMeta(): void {
    metaLabel.textContent = `${TYPE_LABEL[detail.current.type]} · ${STATUS_LABEL[state]}`;
  }

  // --- Approve / Reject / Regenerate ---------------------------------------

  const approveButton = el('button', { class: 'btn btn--instr-primary', type: 'button' }, '✓ Approve') as HTMLButtonElement;
  const rejectButton = el('button', { class: 'btn btn--ghost', type: 'button' }, '✕ Reject') as HTMLButtonElement;

  function renderActionButtons(): void {
    const approveTo = approveTarget(state);
    const rejectTo = rejectTarget(state);
    approveButton.disabled = approveTo === null;
    approveButton.title = approveTo ? `Move to ${STATUS_LABEL[approveTo]}` : 'No further approval step from this state';
    rejectButton.disabled = rejectTo === null;
    rejectButton.title = rejectTo ? `Send back to ${STATUS_LABEL[rejectTo]}` : 'Cannot reject from this state';
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
    const to = approveTarget(state);
    if (to) void doTransition(to);
  });
  rejectButton.addEventListener('click', () => {
    const to = rejectTarget(state);
    if (to) void doTransition(to);
  });
  renderActionButtons();

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

  // --- AI Agent Report panel (static — no live updates; Regenerate is out
  // of scope, N8) ------------------------------------------------------------

  const agentDecision = detail.agentDecision;
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
  );

  // --- Assemble --------------------------------------------------------------

  body.replaceChildren(
    el(
      'a',
      {
        class: 'breadcrumb-back',
        href: `#/instructor/course/${encodeURIComponent(courseId)}/bank`,
        onclick: (e: Event) => {
          e.preventDefault();
          navigate(`/instructor/course/${encodeURIComponent(courseId)}/bank`);
        },
      },
      '← Back to Question Bank',
    ),
    pageHeader('Question', ''),
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
        el('div', { class: 'question-actions' }, approveButton, rejectButton, el('button', { class: 'btn btn--ghost', type: 'button', disabled: 'disabled', title: 'Coming soon' }, '↻ Regenerate')),
        el('div', { class: 'question-save-row' }, saveButton),
      ),
      agentPanel,
    ),
  );
  updateSaveButton();
}

export function renderQuestionDetail(outlet: HTMLElement, params: RouteParams): void {
  void renderQuestionDetailInner(outlet, params.questionId, params.id);
}
