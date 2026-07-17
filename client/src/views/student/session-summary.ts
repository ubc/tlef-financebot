// Session summary (ST-P10/P11): counts, accuracy-by-LO, missed-question links
// back into the Review Book, and a "Defer to next session" action that stores
// the summary to be surfaced at the start of the student's next session.
import { deferSessionSummary, getSessionSummary, type SessionEndSummary } from '../../api.js';
import { el } from '../../dom.js';
import { emptyState, errorState, eyebrow, loadingState } from '../../ui.js';
import { currentQuery } from '../../router.js';
import type { RouteParams } from '../../router.js';

function accuracyRow(row: SessionEndSummary['accuracyByLo'][number]): HTMLElement {
  return el(
    'div',
    { class: 'kv' },
    el('span', { class: 'kv__key mono', text: row.loId }),
    el('span', { text: `${row.correct}/${row.attempted} (${Math.round(row.accuracy * 100)}%)` }),
  );
}

function summaryBody(courseId: string, summary: SessionEndSummary): HTMLElement {
  return el(
    'div',
    { class: 'stack' },
    el(
      'div',
      { class: 'row' },
      el('span', { class: 'mono', text: `${summary.questionsAttempted} question(s) attempted` }),
      el('span', { class: 'mono', text: `${summary.losCovered.length} LO(s) covered` }),
    ),
    summary.accuracyByLo.length
      ? el('div', { class: 'kv-list' }, ...summary.accuracyByLo.map(accuracyRow))
      : emptyState('No attempts recorded yet.'),
    summary.missedQuestions.length
      ? el(
          'div',
          {},
          el('h3', { class: 'card__title', text: 'Missed questions' }),
          el(
            'a',
            { class: 'btn btn--ghost btn--sm', href: `#/course/${encodeURIComponent(courseId)}/review-book` },
            `Review ${summary.missedQuestions.length} missed question(s) →`,
          ),
        )
      : false,
  );
}

export async function renderSessionSummary(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const sessionStart = new Date();
  // "End session" (practice.ts) navigates here with `?since=<ISO timestamp>`
  // — the practice view's own session start. In that case this is the
  // CURRENT session ending, not a start-of-next-session greeting: reuse the
  // same sessionEndSummary plumbing as "Defer to next session" below
  // (deferSessionSummary computes it live AND stores it) instead of a new
  // fetch/recompute path.
  const sinceParam = currentQuery().get('since');
  const endingSession = sinceParam !== null;

  const root = el(
    'div',
    { class: 'view' },
    el('div', { class: 'view__intro' }, eyebrow('Practice'), el('h1', { class: 'view__title', text: 'Session summary' })),
  );
  const body = el('div', { class: 'card' }, el('div', { class: 'card__body' }, loadingState('Loading your summary…')));
  const actions = el('div', { class: 'row', style: 'margin-top: 1rem' });
  root.append(body, actions);
  outlet.append(root);

  const cardBody = body.firstElementChild as HTMLElement;

  try {
    const state = endingSession
      ? { welcome: false, deferred: await deferSessionSummary(courseId, new Date(sinceParam as string)) }
      : await getSessionSummary(courseId);
    if (state.welcome || !state.deferred) {
      cardBody.replaceChildren(emptyState("You don't have a stored summary yet — practice a few questions first."));
    } else {
      cardBody.replaceChildren(summaryBody(courseId, state.deferred));
    }

    if (endingSession) {
      // Ending the session already called deferSessionSummary above (same
      // plumbing the button below uses) — it's saved, nothing left to defer.
      actions.append(el('p', { class: 'state__text', text: 'Session ended — this will greet you next time.' }));
    } else {
      actions.append(
        el(
          'button',
          {
            class: 'btn btn--primary',
            type: 'button',
            onclick: async () => {
              const deferBtn = actions.firstElementChild as HTMLButtonElement;
              deferBtn.disabled = true;
              try {
                await deferSessionSummary(courseId, sessionStart);
                actions.replaceChildren(el('p', { class: 'state__text', text: 'Saved — this will greet you next time.' }));
              } catch (error) {
                actions.replaceChildren(errorState((error as Error).message));
              }
            },
          },
          'Defer to next session',
        ),
      );
    }
  } catch (error) {
    cardBody.replaceChildren(errorState((error as Error).message, () => void renderSessionSummary(outlet, params)));
  }
}
