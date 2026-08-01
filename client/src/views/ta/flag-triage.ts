import { ApiError, escalateTaFlag, listTaFlags, type Flag } from '../../api.js';
import { el, mount } from '../../dom.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

async function renderInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading flag triage…'));
  mount(outlet, el('div', { class: 'view' }, body));
  let flags: Flag[];
  try {
    flags = (await listTaFlags(courseId)).filter((flag) => flag.state === 'open');
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderInner(outlet, courseId)));
    return;
  }

  function flagCard(flag: Flag): HTMLElement {
    const recommendation = el('select', { class: 'input', 'aria-label': 'Recommendation' },
      el('option', { value: 'correct', text: 'Correct question' }),
      el('option', { value: 'archive', text: 'Archive question' }),
      el('option', { value: 'clear', text: 'Clear flag' }),
    ) as HTMLSelectElement;
    const note = el('textarea', { class: 'input input--area', rows: '2', placeholder: 'Recommendation note' }) as HTMLTextAreaElement;
    const status = el('span', { 'aria-live': 'polite' });
    return el('article', { class: 'card stack' },
      el('strong', { text: flag.currentVersion?.stem ?? 'Question unavailable' }),
      el('p', { text: flag.reason || 'No reason supplied.' }),
      recommendation,
      note,
      el('div', { class: 'cluster' },
        el('button', {
          class: 'btn btn--primary btn--sm', type: 'button', text: 'Escalate with recommendation',
          onclick: async () => {
            try {
              await escalateTaFlag(flag.id, recommendation.value as 'correct' | 'archive' | 'clear', note.value);
              await renderInner(outlet, courseId);
            } catch (error) {
              status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
            }
          },
        }),
        status,
      ),
    );
  }

  body.replaceChildren(
    el('header', { class: 'page-header' },
      el('h1', { text: 'TA Flag Triage' }),
      el('p', { text: 'Escalate a recommendation to the instructor. Resolution is instructor-only.' }),
    ),
    ...(flags.length ? flags.map(flagCard) : [el('p', { class: 'muted', text: 'No open flags.' })]),
  );
}

export function renderTaFlagTriage(outlet: HTMLElement, params: RouteParams): void {
  void renderInner(outlet, params.id);
}
