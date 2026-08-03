import { ApiError, escalateTaFlag, listTaFlags, type Flag } from '../../api.js';
import { el, mount } from '../../dom.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

/** One-shot state for the notification landing highlight, created once per
 * view instance in `renderTaFlagTriage` and threaded through every re-render
 * (escalate, error-state retry). Matches the instructor queue's
 * `highlightApplied` guard: `renderInner` re-runs on the TA's own escalate
 * action and nothing strips `?flag=` from the hash, so without this, escalating
 * flag Y while `?flag=X` is still in the URL re-scrolls and re-flashes X. Set
 * only on a SUCCESSFUL match, so a late-arriving row still gets its single
 * highlight and a stale id cannot burn the shot. */
type HighlightOnce = { applied: boolean };

async function renderInner(outlet: HTMLElement, courseId: string, highlight: HighlightOnce): Promise<void> {
  const body = el('div', {}, loadingState('Loading flag triage…'));
  mount(outlet, el('div', { class: 'view' }, body));
  let flags: Flag[];
  try {
    flags = (await listTaFlags(courseId)).filter((flag) => flag.state === 'open');
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderInner(outlet, courseId, highlight)));
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
    return el('article', { class: 'card stack', 'data-flag-id': flag.id },
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
              await renderInner(outlet, courseId, highlight);
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

  // A notification click lands here with ?flag= (see notification-target.ts).
  // The TA view is a flat list, so the lookup is a direct id match. A stale
  // id highlights nothing, which is the right outcome for a flag that has
  // already been escalated out of the open list.
  const flagId = highlight.applied ? null : currentQuery().get('flag');
  if (flagId) {
    const match = body.querySelector<HTMLElement>(`[data-flag-id="${CSS.escape(flagId)}"]`);
    if (match) {
      highlight.applied = true;
      match.classList.add('card--highlight');
      // The outline alone is visual-only: the router's replaceChildren() drops
      // focus to <body>, so a keyboard or screen-reader user would land here
      // with no idea which card they were sent to. tabindex="-1" is
      // programmatic-focus-only -- it adds no tab stop to normal traversal and
      // no trap -- and preventScroll leaves the smooth scroll below in charge
      // of the viewport rather than having focus() jump it first.
      match.setAttribute('tabindex', '-1');
      match.focus({ preventScroll: true });
      match.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

export function renderTaFlagTriage(outlet: HTMLElement, params: RouteParams): void {
  void renderInner(outlet, params.id, { applied: false });
}
