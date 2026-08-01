import {
  ApiError,
  addTaQuestionNote,
  getTaReviewQueue,
  markTaQuestionReviewed,
  proactivelyEscalateTaQuestion,
  suggestTaQuestionEdit,
  type TaReviewQueueItem,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

async function renderInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading TA review queue…'));
  mount(outlet, el('div', { class: 'view' }, body));
  let items: TaReviewQueueItem[];
  try {
    items = await getTaReviewQueue(courseId);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderInner(outlet, courseId)));
    return;
  }

  function questionCard(item: TaReviewQueueItem): HTMLElement {
    const status = el('span', { 'aria-live': 'polite' });
    const stem = el('textarea', { class: 'input input--area', rows: '4', text: item.current.stem }) as HTMLTextAreaElement;
    const note = el('textarea', { class: 'input input--area', rows: '2', placeholder: 'Private instructor/TA note' }) as HTMLTextAreaElement;
    const escalateNote = el('input', { class: 'input', placeholder: 'Escalation note (optional)' }) as HTMLInputElement;
    async function act(operation: () => Promise<unknown>, message: string): Promise<void> {
      try {
        await operation();
        status.textContent = message;
      } catch (error) {
        status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
      }
    }
    return el(
      'article',
      { class: 'card stack' },
      el('div', { class: 'cluster' },
        el('strong', { text: `Priority ${item.priority}` }),
        el('span', { class: 'badge', text: item.state }),
      ),
      el('label', { class: 'form-field__label', text: 'Suggested stem edit' }),
      stem,
      el('div', { class: 'cluster' },
        el('button', {
          class: 'btn btn--secondary btn--sm', type: 'button', text: 'Suggest edit',
          onclick: () => void act(() => suggestTaQuestionEdit(item.id, { stem: stem.value }), 'Suggestion sent.'),
        }),
        el('button', {
          class: 'btn btn--primary btn--sm', type: 'button', text: 'Mark reviewed',
          onclick: () => void act(() => markTaQuestionReviewed(item.id), 'Marked reviewed.'),
        }),
      ),
      el('label', { class: 'form-field__label', text: 'Internal note' }),
      note,
      el('button', {
        class: 'btn btn--secondary btn--sm', type: 'button', text: 'Add internal note',
        onclick: () => void act(() => addTaQuestionNote(item.id, note.value), 'Internal note added.'),
      }),
      el('label', { class: 'form-field__label', text: 'Proactive escalation' }),
      escalateNote,
      el('button', {
        class: 'btn btn--secondary btn--sm', type: 'button', text: 'Escalate question',
        onclick: () => void act(
          () => proactivelyEscalateTaQuestion(item.id, 'TA review concern', escalateNote.value),
          'Escalated to instructor.',
        ),
      }),
      el('span', { class: 'muted', text: `${item.suggestions.length} suggestion(s) · ${item.internalNotes.length} internal note(s)` }),
      status,
    );
  }

  body.replaceChildren(
    el('header', { class: 'page-header' },
      el('h1', { text: 'TA Review Queue' }),
      el('p', { text: 'Review, suggest, annotate, or escalate. Final approval remains instructor-only.' }),
    ),
    ...(items.length ? items.map(questionCard) : [el('p', { class: 'muted', text: 'The review queue is empty.' })]),
  );
}

export function renderTaReviewQueue(outlet: HTMLElement, params: RouteParams): void {
  void renderInner(outlet, params.id);
}
