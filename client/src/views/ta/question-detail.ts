// TA Question Page — the destination of the TA Review Queue's Review → button
// (views/ta/review-queue.ts). This is where the editing-ish work a TA is
// allowed to do now lives, having been pulled off the queue rows: suggest an
// edit, add an internal note, escalate to the instructor. The question itself
// renders strictly read-only.
//
// The hard constraint (phase-3 exit criterion): TAs never get approve, reject,
// or edit, under any configuration. This file must never call the question
// PATCH/transition/params-update endpoints, nor the suggestion accept/discard
// endpoint — accepting or discarding a suggestion is `question.approve`, the
// instructor's call; the TA sees the outcome (a status badge) and never the
// control. See views/instructor/question-detail.ts for the instructor
// equivalent — read for pattern reference only, its editing machinery is
// deliberately not reused here.
import {
  ApiError,
  addTaQuestionNote,
  getCourseOutline,
  getQuestion,
  proactivelyEscalateTaQuestion,
  suggestTaQuestionEdit,
  type CourseOutline,
  type Difficulty,
  type QuestionDetail,
  type QuestionSuggestion,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import { renderRichText } from '../../render.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { STATUS_LABEL, statusToBadgeVariant } from '../instructor/bank.js';
import { buildSuggestionPatch, topicLoLabel } from './ta-ui.js';

function navigate(path: string): void {
  window.location.hash = path;
}

/** Visible label paired to its control via `for`/`id` — the same helper
 * `views/instructor/courses.ts` and `exam-templates.ts` use. A `for`/`id` pair
 * gives the field one accessible name (the visible text) instead of the
 * mismatch you get from an unpaired `aria-label` next to a visible label that
 * says something else, and it makes clicking the label focus the control. */
function fieldLabel(text: string, htmlFor: string): HTMLElement {
  return el('label', { class: 'form-field__label', for: htmlFor, text });
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

const SUGGESTION_STATUS_VARIANT: Record<QuestionSuggestion['status'], 'pending' | 'approved' | 'archived'> = {
  pending: 'pending',
  accepted: 'approved',
  discarded: 'archived',
};

const SUGGESTION_STATUS_LABEL: Record<QuestionSuggestion['status'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  discarded: 'Discarded',
};

/** The suggest-edit composer. `Submit` stays disabled until the draft
 * actually differs from the current version — `buildSuggestionPatch` returns
 * null otherwise. Without this gate, re-clicking files duplicate no-op
 * suggestions the instructor then has to triage one by one (which is what the
 * old row-level "Suggest edit" button did). */
function suggestPanel(
  detail: QuestionDetail,
  onSubmitted: () => void,
): HTMLElement {
  const original = { stem: detail.current.stem, difficulty: detail.current.difficulty };
  const status = el('span', { 'aria-live': 'polite' });

  const stemInput = el('textarea', {
    class: 'input input--area', rows: '5', text: original.stem,
    id: 'ta-question-suggest-stem',
  }) as HTMLTextAreaElement;

  const difficultyInput = el('select', { class: 'input', id: 'ta-question-suggest-difficulty' },
    ...DIFFICULTIES.map((level) => el('option', {
      value: level,
      text: level,
      selected: level === original.difficulty ? 'selected' : undefined,
    })),
  ) as HTMLSelectElement;

  const hint = el('p', { class: 'muted' });
  const submit = el('button', {
    class: 'btn btn--instr-primary btn--sm', type: 'button',
    onclick: () => void submitSuggestion(),
  }, 'Submit suggestion') as HTMLButtonElement;

  function draft(): { stem: string; difficulty: Difficulty } {
    return { stem: stemInput.value, difficulty: difficultyInput.value as Difficulty };
  }

  function syncSubmitState(): void {
    const patch = buildSuggestionPatch(original, draft());
    submit.disabled = patch === null;
    hint.textContent = patch === null
      ? 'No changes yet — edit the stem or difficulty to suggest something.'
      : `Will suggest: ${Object.keys(patch).join(', ')}.`;
  }

  async function submitSuggestion(): Promise<void> {
    const patch = buildSuggestionPatch(original, draft());
    if (!patch) return;
    try {
      await suggestTaQuestionEdit(detail.id, patch);
      status.textContent = 'Suggestion sent to the instructor.';
      onSubmitted();
    } catch (error) {
      status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
    }
  }

  stemInput.addEventListener('input', syncSubmitState);
  difficultyInput.addEventListener('change', syncSubmitState);
  syncSubmitState();

  return el('section', { class: 'card stack' },
    el('h2', { class: 'section-title', text: 'Suggest an edit' }),
    fieldLabel('Stem', stemInput.id),
    stemInput,
    fieldLabel('Difficulty', difficultyInput.id),
    difficultyInput,
    hint,
    el('div', { class: 'cluster' }, submit, status),
  );
}

/** "Your suggestions" — read-only history of this TA's own filed suggestions.
 * Accept/discard is `question.approve`; there is no button here, only the
 * outcome once the instructor has acted. */
function suggestionsList(suggestions: QuestionSuggestion[]): HTMLElement {
  return el('section', { class: 'card stack' },
    el('h2', { class: 'section-title', text: 'Your suggestions' }),
    ...(suggestions.length
      ? suggestions.map((suggestion) => {
          const summary = Object.entries(suggestion.patch)
            .map(([field, value]) => `${field}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
            .join('\n');
          return el('article', { class: 'stack stack--sm' },
            el('div', { class: 'cluster' },
              statusBadge(SUGGESTION_STATUS_LABEL[suggestion.status], SUGGESTION_STATUS_VARIANT[suggestion.status]),
              el('span', { class: 'muted', text: new Date(suggestion.at).toLocaleString() }),
            ),
            el('pre', { class: 'code-block', text: summary }),
          );
        })
      : [el('p', { class: 'muted', text: 'You have not suggested any edits to this question.' })]),
  );
}

/** Internal note composer + the existing thread, attributed and timestamped.
 * A new note is appended to the local (already-loaded) list in place, the
 * same "no full reload" convention the instructor view's `appendInternalNote`
 * uses — a full re-fetch would also wipe the success message this handler
 * just wrote. Same `act`-style handler as the rest of the workspace: catch
 * `ApiError`, surface it in the `aria-live` status span, never throw into the
 * void. */
function notesPanel(detail: QuestionDetail): HTMLElement {
  const notes = [...detail.internalNotes];
  const status = el('span', { 'aria-live': 'polite' });
  const noteInput = el('textarea', {
    class: 'input input--area', rows: '3', maxlength: '2000',
    id: 'ta-question-note', placeholder: 'Optional note for instructors and other TAs. Students cannot see this.',
  }) as HTMLTextAreaElement;
  const notesList = el('div', { class: 'stack stack--sm' });

  function renderNotesList(): void {
    mount(
      notesList,
      ...(notes.length
        ? notes.slice().reverse().map((note) =>
            el('article', { class: 'question-note' },
              el('p', { class: 'question-note__meta', text: `${note.puid} · ${new Date(note.at).toLocaleString()}` }),
              el('p', { class: 'question-note__text', text: note.text }),
            ),
          )
        : [el('p', { class: 'muted', text: 'No internal notes yet.' })]),
    );
  }
  renderNotesList();

  async function submitNote(): Promise<void> {
    const text = noteInput.value.trim();
    if (!text) return;
    try {
      const note = await addTaQuestionNote(detail.id, text);
      notes.push(note);
      noteInput.value = '';
      status.textContent = 'Note added.';
      renderNotesList();
    } catch (error) {
      status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
    }
  }

  return el('section', { class: 'card stack' },
    el('h2', { class: 'section-title', text: 'Internal note' }),
    notesList,
    fieldLabel('Add a note', noteInput.id),
    noteInput,
    el('div', { class: 'cluster' },
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void submitNote(),
      }, 'Add note'),
      status,
    ),
  );
}

/** Proactive escalation — raises a flag for the instructor, so it is confirmed
 * first (same convention as the instructor's Reject & Archive). The TA cannot
 * withdraw an escalation once filed; `confirmDialog` says so up front. */
async function escalate(detail: QuestionDetail, note: string, status: HTMLElement): Promise<void> {
  if (!await confirmDialog({
    title: 'Escalate this question to the instructor?',
    message: 'This raises a flag on the question for the instructor to resolve. You cannot withdraw it yourself.',
    confirmLabel: 'Escalate',
  })) return;
  try {
    await proactivelyEscalateTaQuestion(detail.id, 'TA review concern', note);
    status.textContent = 'Escalated to the instructor.';
  } catch (error) {
    status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
  }
}

function escalatePanel(detail: QuestionDetail): HTMLElement {
  const status = el('span', { 'aria-live': 'polite' });
  const noteInput = el('textarea', {
    class: 'input input--area', rows: '2', maxlength: '2000',
    id: 'ta-question-escalate-note', placeholder: 'Optional note for the instructor about your concern.',
  }) as HTMLTextAreaElement;

  return el('section', { class: 'card stack' },
    el('h2', { class: 'section-title', text: 'Escalate to instructor' }),
    el('p', { class: 'muted', text: 'Raises a flag for the instructor to resolve. Use this for anything that needs their attention beyond a suggested edit.' }),
    fieldLabel('Note (optional)', noteInput.id),
    noteInput,
    el('div', { class: 'cluster' },
      el('button', {
        class: 'btn btn--danger btn--sm', type: 'button',
        onclick: () => void escalate(detail, noteInput.value.trim(), status),
      }, 'Escalate'),
      status,
    ),
  );
}

/** Read-only question body: rich-text stem, then the options list with the
 * correct option marked. No inputs bound to the live question anywhere in
 * this section — a TA can read the question, never edit it in place. */
function questionBody(detail: QuestionDetail): HTMLElement {
  const stemEl = el('div', { class: 'question-stem' });
  renderRichText(stemEl, detail.current.stem);

  const optionsList = el('ol', { class: 'question-options-readonly' },
    ...detail.current.options.map((option) => {
      const textEl = el('span', {});
      renderRichText(textEl, option.text);
      return el('li', { class: `question-options-readonly__item${option.role === 'correct' ? ' question-options-readonly__item--correct' : ''}` },
        el('span', { class: 'question-options-readonly__key', text: `${option.key}.` }),
        textEl,
        option.role === 'correct' ? el('span', { class: 'muted', text: '(correct)' }) : false,
      );
    }),
  );

  return el('section', { class: 'card stack' },
    el('h2', { class: 'section-title', text: 'Question' }),
    stemEl,
    optionsList,
  );
}

async function renderInner(outlet: HTMLElement, courseId: string, questionId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading question…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  let outline: CourseOutline;
  let detail: QuestionDetail;
  try {
    [outline, detail] = await Promise.all([getCourseOutline(courseId), getQuestion(questionId)]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderInner(outlet, courseId, questionId)));
    return;
  }

  async function refresh(): Promise<void> {
    await renderInner(outlet, courseId, questionId);
  }

  const backPath = `/ta/course/${encodeURIComponent(courseId)}/review`;

  body.replaceChildren(
    el('a', {
      class: 'breadcrumb-back',
      href: `#${backPath}`,
      onclick: (e: Event) => {
        e.preventDefault();
        navigate(backPath);
      },
    }, '← Back to Review Queue'),
    pageHeader(
      'Question',
      topicLoLabel(outline, detail.loIds, detail.themeIds),
    ),
    el('div', { class: 'cluster' }, statusBadge(STATUS_LABEL[detail.state], statusToBadgeVariant(detail.state))),
    questionBody(detail),
    suggestPanel(detail, () => void refresh()),
    suggestionsList(detail.suggestions ?? []),
    notesPanel(detail),
    escalatePanel(detail),
  );
}

export function renderTaQuestionDetail(outlet: HTMLElement, params: RouteParams): void {
  void renderInner(outlet, params.id, params.questionId);
}
