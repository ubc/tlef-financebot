import { attachTutorial } from '../../tutorials.js';
// TA Question Page — the destination of the TA Review Queue's Review → button
// (views/ta/review-queue.ts). This is where the editing-ish work a TA is
// allowed to do now lives, having been pulled off the queue rows: suggest an
// edit and add an internal note. The question itself renders strictly
// read-only.
//
// Escalation is deliberately NOT here. A TA escalates a FLAG, from flag
// triage (views/ta/flag-triage.ts), where the thing being escalated already
// exists and carries a student's reason. Raising a brand-new flag straight
// off a question was a second, near-duplicate path to the same place, and it
// produced flags with no recommendation attached — which is what made an
// escalated group render a form that could not act on it.
//
// The hard constraint (phase-3 exit criterion): TAs never get approve, reject,
// or edit, under any configuration. Concretely, this file must never call
// `editQuestion`, `transitionQuestion`, `updateQuestionParams`, or
// `resolveTaQuestionSuggestion` — accepting or discarding a suggestion is
// `question.approve`, the instructor's call; the TA sees the outcome (a status
// badge) and never the control. Enforcement lives server-side
// (`ensureCapability`, plus the hard-deny list in capabilities.service.ts) and
// is covered by tests/unit/ta-routes.test.ts, which asserts a TA with every
// capability toggled on still gets a 403 on transition-to-approved. See
// views/instructor/question-detail.ts for the instructor equivalent — read for
// pattern reference only, its editing machinery is deliberately not reused.
import {
  ApiError,
  addTaQuestionNote,
  getCourseOutline,
  getMyCourseCapabilities,
  type Capability,
  getQuestion,
  getQuestionSample,
  suggestTaQuestionEdit,
  type CourseOutline,
  type Difficulty,
  type QuestionDetail,
  type QuestionSample,
  type QuestionSuggestion,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge } from '../../instructor-ui.js';
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
    onclick: () => submitSuggestion(),
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
        class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => submitNote(),
      }, 'Add note'),
      status,
    ),
  );
}

/** Read-only question body: rich-text stem, then the options list with the
 * correct option marked. No inputs bound to the live question anywhere in
 * this section — a TA can read the question, never edit it in place. */
function questionBody(detail: QuestionDetail, sample?: QuestionSample): HTMLElement {
  const stemEl = el('div', { class: 'question-stem' });
  renderRichText(stemEl, sample?.stem ?? detail.current.stem);

  const optionsList = el('ol', { class: 'question-options-readonly' },
    ...detail.current.options.map((option) => {
      const textEl = el('span', {});
      const drawn = sample?.options.find(value => value.key === option.key);
      renderRichText(textEl, drawn?.text ?? option.text);
      return el('li', { class: `question-options-readonly__item${option.role === 'correct' ? ' question-options-readonly__item--correct' : ''}` },
        el('span', { class: 'question-options-readonly__key', text: `${option.key}.` }),
        textEl,
        option.role === 'correct' ? el('span', { class: 'muted', text: 'Correct answer' }) : false,
        drawn?.explanation || option.explanation ? (() => { const explanation = el('div', { class: 'ta-option-explanation' }); renderRichText(explanation, drawn?.explanation ?? option.explanation ?? ''); return explanation; })() : false,
      );
    }),
  );

  return el('section', { class: 'card stack' },
    el('h2', { class: 'section-title', text: 'Question' }),
    stemEl,
    optionsList,
  );
}

async function renderInner(outlet: HTMLElement, courseId: string, questionId: string, listSample?: QuestionSample, listVersionId?: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading question…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  let outline: CourseOutline;
  let detail: QuestionDetail;
  let permissions: Record<Capability, boolean>;
  try {
    [outline, detail, permissions] = await Promise.all([getCourseOutline(courseId), getQuestion(questionId), getMyCourseCapabilities(courseId)]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderInner(outlet, courseId, questionId)));
    return;
  }
  const parameterized = Boolean(detail.current.paramSlots?.length || detail.current.generateScript || detail.current.derivedValues?.length);
  const sample = parameterized
    ? (listVersionId === detail.current._id ? listSample : undefined) ?? await getQuestionSample(questionId).catch(() => undefined)
    : undefined;

  async function refresh(): Promise<void> {
    await renderInner(outlet, courseId, questionId);
  }

  const backPath = `/ta/course/${encodeURIComponent(courseId)}/review`;

  if (outlet.classList.contains('ta-embedded')) {
    const rich = (text: string, className = ''): HTMLElement => { const node = el('div', { class: className }); renderRichText(node, text); return node; };
    const content = el('div', { class: 'review-workbench__body' },
      el('div', { class: 'review-workbench__metadata', text: `${detail.current.type.toUpperCase()} · ${detail.current.difficulty} · ${detail.state}` }),
      el('p', { class: 'review-workbench__objective', text: topicLoLabel(outline, detail.loIds, detail.themeIds) }),
      parameterized ? el('p', { class: 'review-workbench__sample-note', text: sample ? 'One computed sample. Students may receive different values.' : 'Template preview. Sample values are unavailable for this question.' }) : false,
      rich(sample?.stem ?? detail.current.stem, 'review-workbench__stem question-stem'),
      el('div', { class: 'review-workbench__answers' }, ...detail.current.options.map(option =>
        el('section', { class: `review-workbench__answer${option.role === 'correct' ? ' is-correct' : ''}` },
          el('span', { class: 'review-workbench__key', text: option.key }),
          el('div', {}, option.role === 'correct' ? el('span', { class: 'review-workbench__correct-label', text: 'Correct answer' }) : false,
            rich(sample?.options.find(value => value.key === option.key)?.text ?? option.text),
            rich(sample?.options.find(value => value.key === option.key)?.explanation ?? option.explanation ?? '', 'review-workbench__explanation'))))),
      permissions['question.suggest-edit'] ? el('details', { class: 'ta-detail-disclosure' }, el('summary', { text: 'Suggest an edit' }), suggestPanel(detail, () => void refresh())) : false,
      el('details', { class: 'ta-detail-disclosure' }, el('summary', { text: `Your suggestions · ${detail.suggestions?.length ?? 0}` }), suggestionsList(detail.suggestions ?? [])),
      notesPanel(detail));
    const inspector = el('aside', { class: 'review-workbench__inspector' },
      el('h2', { text: 'Review context' }),
      el('section', {}, el('h3', { text: detail.agentDecision ? `AI check · ${detail.agentDecision.decision.toUpperCase()}` : 'AI check unavailable' }),
        rich(detail.agentDecision?.reasoning ?? 'No AI review result was recorded for this question.'),
        detail.agentDecision?.roleAssessment ? el('details', {}, el('summary', { text: 'Answer structure' }), rich(detail.agentDecision.roleAssessment)) : false),
      el('section', {}, el('h3', { text: 'Source evidence' }),
        ...(detail.current.sourceRefs?.length ? detail.current.sourceRefs.map((ref, index) => el('details', {}, el('summary', { text: `Reference ${index + 1}` }), rich(ref.chunk ?? 'No excerpt recorded.'))) : [el('p', { text: 'No source references recorded.' })])),
      el('section', {}, el('h3', { text: 'Your role' }), el('p', { text: 'Suggest edits and add notes. Your instructor makes the final approval decision.' })));
    mount(outlet, el('div', { class: 'ta-reader-layout' }, content, inspector));
    return;
  }

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
    ...(parameterized ? [el('p', { class: 'review-workbench__sample-note', text: sample ? 'One computed sample. Students may receive different values.' : 'Template preview. Sample values are unavailable for this question.' })] : []),
    questionBody(detail, sample),
    detail.agentDecision ? el('details', { class: 'ta-detail-disclosure' },
      el('summary', { text: `AI assessment · ${detail.agentDecision.decision.toUpperCase()}` }),
      (() => { const report = el('div', { class: 'ta-assessment' }); renderRichText(report, detail.agentDecision.reasoning); return report; })(),
      detail.agentDecision.roleAssessment ? (() => { const report = el('div', { class: 'ta-assessment' }); renderRichText(report, detail.agentDecision.roleAssessment); return report; })() : false) : '',
    permissions['question.suggest-edit'] ? el('details', { class: 'ta-detail-disclosure' }, el('summary', { text: 'Suggest an edit' }), suggestPanel(detail, () => void refresh())) : el('p', { class: 'muted', text: 'Suggested edits are unavailable. Add a review note or ask your Instructor about course permissions.' }),
    suggestionsList(detail.suggestions ?? []),
    el('div', { 'data-tutorial': 'ta-question-actions' }, notesPanel(detail)),
  );
  if (!outlet.classList.contains('ta-embedded')) attachTutorial(root, 'ta-question-review', {"ta-question-content": ".question-stem"});
}

export function renderTaQuestionDetail(outlet: HTMLElement, params: RouteParams, sample?: QuestionSample, sampleVersionId?: string): void {
  void renderInner(outlet, params.id, params.questionId, sample, sampleVersionId);
}
