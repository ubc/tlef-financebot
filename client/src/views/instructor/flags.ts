// Flag Queue (Task 2, instructor half) — the instructor's flag-resolution
// worklist: one row per (question, version) group, with Correct / Archive /
// Clear actions that resolve every open/escalated flag in the group. See
// server/src/services/flags.service.ts (Task 1) for the flag state machine
// this consumes, and .superpowers/sdd/p2-task-2-brief.md for the resolved
// UI-ambiguity decisions this view follows.
//
// Data-shape note (verified against server/src/routes/flags.routes.ts's
// GET /courses/:courseId/flags + services/flags.service.ts's listFlags, see
// api.ts's `Flag` type): the endpoint returns one flat row per Flag document,
// each joined with its Question head and CURRENT QuestionVersion (not
// necessarily the version the flag was raised against — a later content edit
// moves `question.currentVersionId` forward while `flag.questionVersionId`
// stays pinned to the original). This view groups client-side by
// `questionVersionId` (resolved ambiguity #1) but renders the joined
// `currentVersion`'s stem, since that's the only content the endpoint
// returns; `staleVersionNote` below flags the mismatch when the two ids
// differ rather than silently presenting stale content as current.
//
// Grouping vs. resolving (resolved ambiguities #1/#2): every action
// (Correct/Archive/Clear) resolves ALL still-open/escalated flags in the
// clicked group via a sequential loop over `resolveFlag` (no bulk-resolve
// endpoint exists). The loop stops at the first failure. One known edge case
// inherited from the service (see resolveFlag's doc comment): archiving a
// group with 2+ open flags on the SAME question succeeds for the first flag
// (question -> archived) but the second `resolveFlag('archive')` call then
// throws `invalid-transition:archived->archived` — by design, so a flag never
// reports "resolved" while its consequence silently failed. That second flag
// is left `open` (the question is already archived either way); the row
// reappears after reload so the instructor can `Clear` the leftover flag.
import { ApiError, getCourseTree, listCourseFlags, resolveFlag as resolveFlagApi, type CourseTree, type Flag } from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge, type BadgeVariant } from '../../instructor-ui.js';
import { renderRichText } from '../../render.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function navigate(path: string): void {
  window.location.hash = path;
}

/** "Topic 1 / LO 1, LO 4" style label — same convention as bank.ts's/
 * review-queue.ts's own `topicLoLabel` (each instructor view keeps its own
 * copy rather than sharing one; see review-queue.ts's module note). */
function topicLoLabel(tree: CourseTree, loIds: string[], themeIds: string[]): string {
  const parts: string[] = [];
  tree.themes.forEach((theme, themeIndex) => {
    const los = (theme.los ?? []).filter((lo) => loIds.includes(lo._id));
    if (los.length > 0) {
      const loLabels = los.map((lo) => `LO ${(theme.los ?? []).findIndex((l) => l._id === lo._id) + 1}`).join(', ');
      parts.push(`Topic ${themeIndex + 1} / ${loLabels}`);
    } else if (themeIds.includes(theme._id)) {
      parts.push(`Topic ${themeIndex + 1}`);
    }
  });
  return parts.length ? parts.join('; ') : '—';
}

type ResolveAction = 'correct' | 'archive' | 'clear';

const RESOLUTION_LABEL: Record<ResolveAction, string> = {
  correct: 'Resolved: corrected',
  archive: 'Resolved: archived',
  clear: 'Resolved: cleared',
};

const RESOLUTION_VARIANT: Record<ResolveAction, BadgeVariant> = {
  correct: 'approved',
  archive: 'archived',
  clear: 'neutral',
};

/** One row: every Flag raised against the same `questionVersionId`. */
interface FlagGroup {
  questionVersionId: string;
  questionId: string;
  question: Flag['question'];
  version: Flag['currentVersion'];
  flags: Flag[];
}

function groupFlags(flags: Flag[]): FlagGroup[] {
  const groups = new Map<string, FlagGroup>();
  for (const flag of flags) {
    let group = groups.get(flag.questionVersionId);
    if (!group) {
      group = {
        questionVersionId: flag.questionVersionId,
        questionId: flag.questionId,
        question: flag.question,
        version: flag.currentVersion,
        flags: [],
      };
      groups.set(flag.questionVersionId, group);
    }
    group.flags.push(flag);
  }
  return [...groups.values()];
}

function openFlags(group: FlagGroup): Flag[] {
  return group.flags.filter((f) => f.state === 'open' || f.state === 'escalated');
}

function isGroupOpen(group: FlagGroup): boolean {
  return openFlags(group).length > 0;
}

function byCreatedAtDesc(a: Flag, b: Flag): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/** The most recent resolution action across the group's resolved flags — a
 * group can, in theory, hold flags resolved at different times with
 * different actions (e.g. an old flag cleared long ago, a newer one just
 * archived); the badge shows the latest, since that's the question's current
 * disposition. */
function latestResolutionAction(group: FlagGroup): ResolveAction | null {
  const resolved = group.flags.filter((f): f is Flag & { resolution: NonNullable<Flag['resolution']> } => Boolean(f.resolution));
  if (resolved.length === 0) return null;
  resolved.sort((a, b) => new Date(b.resolution.at).getTime() - new Date(a.resolution.at).getTime());
  return resolved[0].resolution.action;
}

/** Unresolved groups first (most recently flagged first within that set),
 * then resolved groups (most recently flagged first). */
function sortGroups(groups: FlagGroup[]): FlagGroup[] {
  return [...groups].sort((a, b) => {
    const aOpen = isGroupOpen(a);
    const bOpen = isGroupOpen(b);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    const aLatest = [...a.flags].sort(byCreatedAtDesc)[0];
    const bLatest = [...b.flags].sort(byCreatedAtDesc)[0];
    return byCreatedAtDesc(aLatest, bLatest);
  });
}

function flagCountBadge(group: FlagGroup): HTMLElement {
  const count = openFlags(group).length;
  return statusBadge(`${count} flag${count === 1 ? '' : 's'}`, 'flag');
}

/** Most-recent reason (or "No reason given") + its date, plus "(and N more)"
 * when the group holds more than one flag (resolved ambiguity #1's
 * micro-layout call). */
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
 * what the student saw when they flagged it (see the module note). */
function staleVersionNote(group: FlagGroup): HTMLElement | false {
  if (!group.question || group.questionVersionId === group.question.currentVersionId) return false;
  return el('p', { class: 'flag-row__stale', text: 'Question edited since this flag was raised — showing current content.' });
}

async function renderFlagQueueInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading flags…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  let tree: CourseTree;
  let flags: Flag[];
  try {
    [tree, flags] = await Promise.all([getCourseTree(courseId), listCourseFlags(courseId)]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderFlagQueueInner(outlet, courseId)));
    return;
  }

  let loadErrorMessage: string | null = null;
  let actionErrorMessage: string | null = null;

  const resultsContainer = el('div', {});

  /** Resolves every open/escalated flag in `group` with `action`, stopping at
   * the first failure (resolved ambiguity #4, applied to all three actions
   * for consistent, simple error handling — see the module note re: the
   * archive edge case this can surface).
   *
   * One failure mode is deterministic and well-understood rather than a
   * genuine error: `resolveFlag('archive')` (Task 1) always calls
   * `transitionQuestion(..., 'archived', ...)` unconditionally, so archiving
   * a group with 2+ open flags on the SAME question succeeds for the first
   * flag (question -> archived) and then throws the raw
   * `invalid-transition:archived->archived` on the second. That raw string is
   * a confusing thing to show an instructor — it gives no indication the
   * question WAS archived, or that the fix is to `Clear` the rest of the
   * group rather than retry `Archive` (which will fail identically forever).
   * Detected and translated to an actionable message here; any other
   * unexpected error still surfaces as-is (no general error-translation layer
   * for cases we haven't seen). */
  async function resolveGroupFlags(group: FlagGroup, action: ResolveAction): Promise<{ ok: boolean; error?: string }> {
    const targets = openFlags(group);
    let resolvedCount = 0;
    for (const flag of targets) {
      try {
        await resolveFlagApi(flag.id, action);
        resolvedCount++;
      } catch (error) {
        const rawMessage = error instanceof ApiError ? error.message : (error as Error).message;
        if (action === 'archive' && rawMessage === 'invalid-transition:archived->archived') {
          const remaining = targets.length - resolvedCount;
          return {
            ok: false,
            error: `${resolvedCount} of ${targets.length} flag${targets.length === 1 ? '' : 's'} resolved; the question was already archived. Use Clear to close the remaining flag${remaining === 1 ? '' : 's'}.`,
          };
        }
        return { ok: false, error: rawMessage };
      }
    }
    return { ok: true };
  }

  async function reload(): Promise<void> {
    loadErrorMessage = null;
    try {
      flags = await listCourseFlags(courseId);
    } catch (error) {
      loadErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
    }
    renderResults();
  }

  async function handleClear(group: FlagGroup): Promise<void> {
    actionErrorMessage = null;
    const result = await resolveGroupFlags(group, 'clear');
    if (!result.ok) actionErrorMessage = result.error ?? 'Failed to clear flag(s).';
    await reload();
  }

  async function handleArchive(group: FlagGroup): Promise<void> {
    const count = openFlags(group).length;
    if (!window.confirm(`Archive this question? This resolves ${count} flag${count === 1 ? '' : 's'} and removes it from student practice.`)) return;
    actionErrorMessage = null;
    const result = await resolveGroupFlags(group, 'archive');
    if (!result.ok) actionErrorMessage = result.error ?? 'Failed to archive question.';
    await reload();
  }

  async function handleCorrect(group: FlagGroup): Promise<void> {
    const count = openFlags(group).length;
    if (!window.confirm(`Resolve ${count} flag${count === 1 ? '' : 's'} as corrected and open the question editor?`)) return;
    actionErrorMessage = null;
    const result = await resolveGroupFlags(group, 'correct');
    if (!result.ok) {
      actionErrorMessage = result.error ?? 'Failed to resolve flag(s); question editor not opened.';
      await reload();
      return;
    }
    navigate(`/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(group.questionId)}`);
  }

  function groupRow(group: FlagGroup): HTMLElement {
    const stemCell = el('div', { class: 'flag-row__stem' });
    if (group.version) renderRichText(stemCell, group.version.stem);
    else stemCell.textContent = '(question content unavailable)';

    const topicLo = group.question ? topicLoLabel(tree, group.question.loIds, group.question.themeIds) : '—';
    const open = isGroupOpen(group);
    const resolutionAction = latestResolutionAction(group);

    const badge = open
      ? flagCountBadge(group)
      : statusBadge(resolutionAction ? RESOLUTION_LABEL[resolutionAction] : 'Resolved', resolutionAction ? RESOLUTION_VARIANT[resolutionAction] : 'neutral');

    const actions = open
      ? el(
          'div',
          { class: 'flag-row__actions' },
          el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => void handleCorrect(group) }, 'Correct'),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void handleArchive(group) }, 'Archive'),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void handleClear(group) }, 'Clear'),
        )
      : false;

    return el(
      'div',
      { class: 'flag-row' },
      el('div', {}, stemCell, el('p', { class: 'flag-row__topic', text: topicLo }), reasonsSummary(group), staleVersionNote(group)),
      badge,
      actions,
    );
  }

  function renderResults(): void {
    const groups = sortGroups(groupFlags(flags));
    mount(
      resultsContainer,
      loadErrorMessage ? errorState(loadErrorMessage, () => void reload()) : false,
      actionErrorMessage ? errorState(actionErrorMessage) : false,
      groups.length
        ? el(
            'div',
            { class: 'flag-table' },
            el(
              'div',
              { class: 'flag-row flag-row--head' },
              el('span', { text: 'Question' }),
              el('span', { text: 'Flags' }),
              el('span', { text: 'Actions' }),
            ),
            el('div', { class: 'flag-table__rows' }, ...groups.map(groupRow)),
          )
        : emptyState('No flagged questions.'),
    );
  }

  body.replaceChildren(
    pageHeader('Flags', `${flags.length} flag${flags.length === 1 ? '' : 's'} across ${groupFlags(flags).length} question version${groupFlags(flags).length === 1 ? '' : 's'}`),
    resultsContainer,
  );
  renderResults();
}

export function renderFlagQueue(outlet: HTMLElement, params: RouteParams): void {
  void renderFlagQueueInner(outlet, params.id);
}
