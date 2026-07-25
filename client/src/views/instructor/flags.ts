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
//
// Task 6 (§6.2 remediation): a "Correctness-affecting" checkbox next to the
// resolve actions threads `correctnessAffecting` through to every
// resolveFlagApi call in the group. Per the resolved grouping ambiguity, a
// correctness-affecting group resolve produces one IDENTICAL remediation
// report per flag in the group (same questionVersionId) — this view keeps
// only the first one it sees per group and renders the checklist panel ONCE,
// not once per flag. "Notify affected students" likewise fires once per
// group (any one flag id in the group — the server resolves the notify
// target from that flag's questionVersionId, shared by the whole group).
import {
  ApiError,
  getCourseTree,
  listCourseFlags,
  resolveFlag as resolveFlagApi,
  notifyRemediation as notifyRemediationApi,
  type CourseTree,
  type Flag,
  type RemediationReport,
} from '../../api.js';
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

  // Task 6 (§6.2 remediation): per-group state, keyed by `questionVersionId`
  // (the grouping key — see the module note). Survives `reload()` (which only
  // replaces `flags`, not these maps) so the checklist panel stays visible
  // across the re-render a resolve action triggers.
  const remediationReports = new Map<string, RemediationReport>();
  const notifiedCounts = new Map<string, number>();
  const notifyErrorMessages = new Map<string, string>();

  function recordRemediation(group: FlagGroup, remediation: RemediationReport | undefined): void {
    if (!remediation) return;
    remediationReports.set(group.questionVersionId, remediation);
    // A fresh correctness-affecting resolve on this group supersedes any
    // earlier notify state (defensive — the common case is this only ever
    // happens once per group).
    notifiedCounts.delete(group.questionVersionId);
    notifyErrorMessages.delete(group.questionVersionId);
  }

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
   * for cases we haven't seen).
   *
   * Task 6: also threads `correctnessAffecting` through to every
   * `resolveFlagApi` call. Per the resolved grouping ambiguity, a
   * correctness-affecting group resolve returns one IDENTICAL remediation
   * report per flag (same questionVersionId) — only the FIRST one seen is
   * kept and returned, so the caller renders the checklist once per group. */
  async function resolveGroupFlags(
    group: FlagGroup,
    action: ResolveAction,
    correctnessAffecting: boolean,
  ): Promise<{ ok: boolean; error?: string; remediation?: RemediationReport }> {
    const targets = openFlags(group);
    let resolvedCount = 0;
    let remediation: RemediationReport | undefined;
    for (const flag of targets) {
      try {
        const resolved = await resolveFlagApi(flag.id, action, correctnessAffecting || undefined);
        if (!remediation && resolved.remediation) remediation = resolved.remediation;
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
    return { ok: true, remediation };
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

  async function handleClear(group: FlagGroup, correctnessAffecting: boolean): Promise<void> {
    actionErrorMessage = null;
    const result = await resolveGroupFlags(group, 'clear', correctnessAffecting);
    if (!result.ok) actionErrorMessage = result.error ?? 'Failed to clear flag(s).';
    else recordRemediation(group, result.remediation);
    await reload();
  }

  async function handleArchive(group: FlagGroup, correctnessAffecting: boolean): Promise<void> {
    const count = openFlags(group).length;
    if (!window.confirm(`Archive this question? This resolves ${count} flag${count === 1 ? '' : 's'} and removes it from student practice.`)) return;
    actionErrorMessage = null;
    const result = await resolveGroupFlags(group, 'archive', correctnessAffecting);
    if (!result.ok) actionErrorMessage = result.error ?? 'Failed to archive question.';
    else recordRemediation(group, result.remediation);
    await reload();
  }

  async function handleCorrect(group: FlagGroup, correctnessAffecting: boolean): Promise<void> {
    const count = openFlags(group).length;
    const confirmText = correctnessAffecting
      ? `Resolve ${count} flag${count === 1 ? '' : 's'} as corrected?`
      : `Resolve ${count} flag${count === 1 ? '' : 's'} as corrected and open the question editor?`;
    if (!window.confirm(confirmText)) return;
    actionErrorMessage = null;
    const result = await resolveGroupFlags(group, 'correct', correctnessAffecting);
    if (!result.ok) {
      actionErrorMessage = result.error ?? 'Failed to resolve flag(s); question editor not opened.';
      await reload();
      return;
    }
    if (correctnessAffecting) {
      // A correctness-affecting resolve surfaces the remediation checklist
      // (§6.2, Task 6) — stay on this view instead of the usual
      // navigate-to-editor shortcut, so the instructor sees the blast-radius
      // report and the "Notify affected students" action.
      recordRemediation(group, result.remediation);
      await reload();
      return;
    }
    navigate(`/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(group.questionId)}`);
  }

  /** "Notify affected students" (§6.2, Task 6) — fires once per group, using
   * any one flag in the group (the server resolves the notify target from
   * that flag's `questionVersionId`, which every flag in the group shares by
   * construction). An explicit user action: unlike resolve failures, a
   * notify failure is shown inline in the checklist panel rather than
   * silently retried. */
  async function handleNotify(group: FlagGroup): Promise<void> {
    const targetFlag = group.flags[0];
    if (!targetFlag) return;
    notifyErrorMessages.delete(group.questionVersionId);
    try {
      const result = await notifyRemediationApi(targetFlag.id);
      notifiedCounts.set(group.questionVersionId, result.notified);
    } catch (error) {
      notifyErrorMessages.set(group.questionVersionId, error instanceof ApiError ? error.message : (error as Error).message);
    }
    renderResults();
  }

  /** The §6.2 remediation checklist panel: report numbers + the four
   * checklist items (three manual, one automated via the "Notify affected
   * students" button) — rendered under a group's row once it has a stored
   * remediation report (resolved ambiguity #4: pilot scope is a MANUAL
   * checklist plus exactly one automated action). Returns `false` (rendering
   * nothing) for groups that were never resolved with `correctnessAffecting`. */
  function remediationPanel(group: FlagGroup): HTMLElement | false {
    const report = remediationReports.get(group.questionVersionId);
    if (!report) return false;

    const notified = notifiedCounts.get(group.questionVersionId);
    const notifyError = notifyErrorMessages.get(group.questionVersionId);
    const studentCount = report.affectedStudents.length;

    const stats =
      `${report.affectedAttempts} attempt${report.affectedAttempts === 1 ? '' : 's'} across ${studentCount} student${studentCount === 1 ? '' : 's'} ` +
      `were served the affected content (${report.examAttempts} in exam-prep mode). ` +
      `${report.reviewBookEntries} Review Book entr${report.reviewBookEntries === 1 ? 'y' : 'ies'} may reference it.`;

    return el(
      'div',
      { class: 'remediation-panel' },
      el('h3', { class: 'remediation-panel__title', text: 'Remediation checklist (correctness-affecting)' }),
      el('p', { class: 'remediation-panel__stats', text: stats }),
      el(
        'ul',
        { class: 'remediation-panel__checklist' },
        el('li', { text: 'Recompute correctness for the affected attempts.' }),
        el('li', { text: 'Drop the affected attempts from mastery windows and re-evaluate.' }),
        el('li', { text: 'Remove any wrongly-added Review Book entries.' }),
        el(
          'li',
          { class: 'remediation-panel__notify-item' },
          el('span', { text: 'Notify affected students.' }),
          notified !== undefined
            ? el('span', { class: 'remediation-panel__notified', text: ` Notified ${notified} student${notified === 1 ? '' : 's'}.` })
            : el(
                'button',
                { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => void handleNotify(group) },
                'Notify affected students',
              ),
        ),
      ),
      notifyError ? errorState(notifyError) : false,
    );
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

    // Task 6 (§6.2 remediation): read at click time via closure, rather than
    // tracked in module state — the checkbox (and this whole row) is rebuilt
    // on every `renderResults()`, so there's nothing to persist between
    // renders.
    const correctnessCheckbox = el('input', {
      type: 'checkbox',
      'aria-label': 'Correctness-affecting',
    }) as HTMLInputElement;

    const actions = open
      ? el(
          'div',
          { class: 'flag-row__actions' },
          el(
            'label',
            { class: 'flag-row__correctness', title: 'Mark this resolution as correctness-affecting to see the remediation checklist.' },
            correctnessCheckbox,
            el('span', { text: 'Correctness-affecting' }),
          ),
          el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => void handleCorrect(group, correctnessCheckbox.checked) }, 'Correct'),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void handleArchive(group, correctnessCheckbox.checked) }, 'Archive'),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void handleClear(group, correctnessCheckbox.checked) }, 'Clear'),
        )
      : false;

    const row = el(
      'div',
      { class: 'flag-row' },
      el('div', {}, stemCell, el('p', { class: 'flag-row__topic', text: topicLo }), reasonsSummary(group), staleVersionNote(group)),
      badge,
      actions,
    );

    return el('div', { class: 'flag-group' }, row, remediationPanel(group));
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
