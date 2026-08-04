// TA Flag Triage — mirrors the instructor Flag Queue's (views/instructor/
// flags.ts) grouped-row layout, exposing only what a TA is permitted to do:
// escalate a recommendation to the instructor. `flag.resolve` and
// `question.approve` are hard-denied to TAs under every configuration (see
// capabilities.service.ts's `TA_HARD_DENY`), so this view has no Return to
// Students, no Reject & Archive, no editor link, and no remediation panel —
// those live only in the instructor queue.
//
// Grouping/sorting is shared with the instructor queue via flag-groups.ts so
// the two views cannot drift on what counts as "one row" — see that module's
// header note for the (question, version) grouping rationale. Topic/LO comes
// from `getCourseOutline` (question.review), NOT `getCourseTree`
// (instructor-only) — a real TA 403s on the latter; see ta-ui.ts's
// `topicLoLabel`.
import {
  ApiError,
  escalateTaFlag,
  getCourseOutline,
  listTaFlags,
  type CourseOutline,
  type Flag,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge } from '../../instructor-ui.js';
import { renderRichText } from '../../render.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import {
  byCreatedAtDesc,
  groupFlags,
  isGroupOpen,
  latestEscalation,
  openFlags,
  sortGroups,
  type FlagGroup,
} from '../../flag-groups.js';
import { topicLoLabel } from './ta-ui.js';

type Recommendation = 'correct' | 'archive' | 'clear';

const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  correct: 'Correct question',
  archive: 'Archive question',
  clear: 'Clear flag',
};

/** Visible label paired to its control via `for`/`id` — same helper
 * question-detail.ts, courses.ts and exam-templates.ts each keep their own
 * copy of (no shared home for it yet). A `for`/`id` pair gives the field one
 * accessible name (the visible text) rather than the mismatch you'd get from
 * an unpaired `aria-label`, and it lets clicking the label focus the
 * control — this repo runs axe-core scans that catch unlabelled form
 * controls. */
function fieldLabel(text: string, htmlFor: string): HTMLElement {
  return el('label', { class: 'form-field__label', for: htmlFor, text });
}

/** Escalates every still-open flag in the group with one recommendation,
 * stopping at the first failure — the same group-wide semantics
 * `resolveGroupFlags` gives the instructor, so a TA facing three duplicate
 * flags on one question files one recommendation, not three.
 *
 * `escalateFlag` matches on `{ _id, state: 'open' }` server-side and throws
 * `invalid-flag-transition` otherwise, so an already-escalated flag in the
 * group is skipped here rather than being sent and failing the whole batch. */
async function escalateGroup(
  group: FlagGroup,
  recommendation: Recommendation,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const targets = openFlags(group).filter((flag) => flag.state === 'open');
  let escalated = 0;
  for (const flag of targets) {
    try {
      await escalateTaFlag(flag.id, recommendation, note);
      escalated++;
    } catch (error) {
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      return {
        ok: false,
        error: escalated > 0
          ? `${escalated} of ${targets.length} flags escalated, then: ${message}`
          : message,
      };
    }
  }
  return { ok: true };
}

/** Most-recent reason (or "No reason given") + its date, plus "(and N more)"
 * when the group holds more than one flag — same micro-layout as the
 * instructor queue's `reasonsSummary`, which this is a direct copy of (kept
 * duplicated rather than shared since it references nothing TA-specific and
 * the instructor file is not to be imported from here beyond flag-groups.js). */
function reasonsSummary(group: FlagGroup): HTMLElement {
  const sorted = [...group.flags].sort(byCreatedAtDesc);
  const latest = sorted[0];
  const reasonText = latest.reason?.trim() ? latest.reason : 'No reason given';
  const dateText = new Date(latest.createdAt).toLocaleDateString();
  const extra = sorted.length > 1 ? ` (and ${sorted.length - 1} more)` : '';
  return el('p', { class: 'flag-row__reason', text: `"${reasonText}" — ${dateText}${extra}` });
}

/** Flags when the joined `currentVersion` postdates the flag(s) in this
 * group — the stem shown is the question's current content, not necessarily
 * what the student (or TA) saw when the flag was raised. Same check as the
 * instructor queue's `staleVersionNote`. */
function staleVersionNote(group: FlagGroup): HTMLElement | false {
  if (!group.question || group.questionVersionId === group.question.currentVersionId) return false;
  return el('p', { class: 'flag-row__stale', text: 'Question edited since this flag was raised — showing current content.' });
}

function flagCountBadge(group: FlagGroup): HTMLElement {
  const count = openFlags(group).length;
  return statusBadge(`${count} flag${count === 1 ? '' : 's'}`, 'flag');
}

/** An already-escalated group shows the recommendation back instead of the
 * controls — re-escalating is a no-op server-side, and a TA needs to see what
 * they (or another TA) already told the instructor. */
function escalationSummary(group: FlagGroup): HTMLElement | false {
  const escalation = latestEscalation(group);
  if (!escalation) return false;
  return el('p', { class: 'flag-row__escalation' },
    el('strong', { text: `Escalated — recommends: ${RECOMMENDATION_LABEL[escalation.recommendation]}` }),
    escalation.note ? el('span', { text: ` — "${escalation.note}"` }) : false,
    el('span', { class: 'muted', text: ` · ${new Date(escalation.at).toLocaleDateString()}` }),
  );
}

/** One-shot state for the notification landing highlight, created once per
 * view instance in `renderTaFlagTriage` and threaded through every re-render
 * (escalate, error-state retry). Matches the instructor queue's
 * `highlightApplied` guard: `renderInner` re-runs on the TA's own escalate
 * action and nothing strips `?flag=` from the hash, so without this,
 * escalating group Y while `?flag=X` is still in the URL would re-scroll and
 * re-flash X's row on every re-render. Set only on a SUCCESSFUL match, so a
 * late-arriving row still gets its single highlight and a stale id cannot
 * burn the shot.
 *
 * Rows are GROUPS here (Task 6 rewrite), not individual flags, so unlike the
 * flat-list version this guard replaced, the lookup can no longer key on a
 * single `data-flag-id` — it keys on a group's `data-flag-ids`
 * (space-separated, same attribute and format the instructor queue's
 * `highlightFromQuery` reads), matching against any flag id the group
 * contains. */
type HighlightOnce = { applied: boolean };

async function renderInner(outlet: HTMLElement, courseId: string, highlight: HighlightOnce): Promise<void> {
  const body = el('div', {}, loadingState('Loading flag triage…'));
  mount(outlet, el('div', { class: 'view' }, body));

  let outline: CourseOutline;
  let flags: Flag[];
  try {
    [outline, flags] = await Promise.all([getCourseOutline(courseId), listTaFlags(courseId)]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderInner(outlet, courseId, highlight)));
    return;
  }

  // `isGroupOpen` (open OR escalated), not `flag.state === 'open'`: the old
  // filter made a flag vanish from the list the instant the TA escalated it
  // — their own work disappearing out from under them. A group stays listed
  // until the INSTRUCTOR resolves it, with `escalationSummary` below showing
  // what was already sent up.
  const groups = sortGroups(groupFlags(flags).filter(isGroupOpen));
  const flagCount = groups.reduce((sum, group) => sum + openFlags(group).length, 0);

  function groupRow(group: FlagGroup): HTMLElement {
    const stemCell = el('div', { class: 'flag-row__stem' });
    if (group.version) renderRichText(stemCell, group.version.stem);
    else stemCell.textContent = '(question content unavailable)';

    const topicLo = group.question ? topicLoLabel(outline, group.question.loIds, group.question.themeIds) : '—';
    const escalation = latestEscalation(group);

    // Any escalation already on the group hides the controls entirely (even
    // if the group also holds a still-open, never-escalated flag) — the
    // brief's call: a TA sees their (or another TA's) prior recommendation
    // rather than a live form inviting a redundant one. `escalateGroup`
    // itself is separately defensive about mixed open/escalated flags
    // within a group (it filters to `state === 'open'` before sending), for
    // whichever group DOES still show controls.
    let actionsCell: HTMLElement | false = false;
    if (!escalation) {
      const idBase = `flag-${group.questionVersionId}`;
      const recommendationId = `${idBase}-recommendation`;
      const noteId = `${idBase}-note`;
      const recommendation = el(
        'select',
        { class: 'input', id: recommendationId },
        el('option', { value: 'correct', text: RECOMMENDATION_LABEL.correct }),
        el('option', { value: 'archive', text: RECOMMENDATION_LABEL.archive }),
        el('option', { value: 'clear', text: RECOMMENDATION_LABEL.clear }),
      ) as HTMLSelectElement;
      const note = el('textarea', {
        class: 'input input--area',
        id: noteId,
        rows: '2',
        placeholder: 'Recommendation note (optional)',
      }) as HTMLTextAreaElement;
      const status = el('p', { class: 'flag-row__reason', 'aria-live': 'polite' });

      actionsCell = el(
        'div',
        { class: 'flag-row__actions flag-row__actions--stack' },
        fieldLabel('Recommendation', recommendationId),
        recommendation,
        fieldLabel('Note (optional)', noteId),
        note,
        el('button', {
          class: 'btn btn--instr-primary btn--sm',
          type: 'button',
          text: 'Escalate with recommendation',
          onclick: async () => {
            const result = await escalateGroup(group, recommendation.value as Recommendation, note.value);
            if (!result.ok) {
              status.textContent = result.error ?? 'Failed to escalate.';
              return;
            }
            await renderInner(outlet, courseId, highlight);
          },
        }),
        status,
      );
    }

    const row = el(
      'div',
      { class: 'flag-row' },
      el(
        'div',
        {},
        stemCell,
        el('p', { class: 'flag-row__topic', text: topicLo }),
        reasonsSummary(group),
        staleVersionNote(group),
        escalationSummary(group),
      ),
      flagCountBadge(group),
      actionsCell,
    );

    return el(
      'div',
      {
        class: 'flag-group',
        'data-question-id': group.questionId,
        'data-flag-ids': group.flags.map((flag) => flag.id).join(' '),
      },
      row,
    );
  }

  body.replaceChildren(
    pageHeader(
      'TA Flag Triage',
      `${flagCount} flag${flagCount === 1 ? '' : 's'} across ${groups.length} question version${groups.length === 1 ? '' : 's'} · Escalate a recommendation to the instructor. Resolution is instructor-only.`,
    ),
    groups.length
      ? el(
          'div',
          { class: 'flag-table' },
          el(
            'div',
            { class: 'flag-row flag-row--head' },
            el('span', { text: 'Question' }),
            el('span', { text: 'Flags' }),
            el('span', { text: 'Recommendation' }),
          ),
          el('div', { class: 'flag-table__rows' }, ...groups.map(groupRow)),
        )
      : emptyState('No open flags.'),
  );

  // A notification click lands here with ?flag= (see notification-target.ts).
  // Rows are now GROUPS, so the lookup checks a group's `data-flag-ids`
  // (space-separated) for the notified flag id, rather than matching a
  // single `data-flag-id` the way the old flat-list view did. A stale id
  // (the flag has since been resolved by the instructor, so its group no
  // longer passes `isGroupOpen`) highlights nothing, which is the right
  // outcome.
  const flagId = highlight.applied ? null : currentQuery().get('flag');
  if (flagId) {
    const match = Array.from(body.querySelectorAll<HTMLElement>('.flag-group'))
      .find((group) => (group.dataset.flagIds ?? '').split(' ').includes(flagId));
    if (match) {
      highlight.applied = true;
      match.classList.add('flag-group--highlight');
      // The highlight alone is visual-only: the router's replaceChildren()
      // drops focus to <body>, so a keyboard or screen-reader user would
      // land here with no idea which group they were sent to. tabindex="-1"
      // is programmatic-focus-only -- it adds no tab stop to normal
      // traversal and no trap -- and preventScroll leaves the smooth scroll
      // below in charge of the viewport rather than having focus() jump it
      // first.
      match.setAttribute('tabindex', '-1');
      match.focus({ preventScroll: true });
      match.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

export function renderTaFlagTriage(outlet: HTMLElement, params: RouteParams): void {
  void renderInner(outlet, params.id, { applied: false });
}
