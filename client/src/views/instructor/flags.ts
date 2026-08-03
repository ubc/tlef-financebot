// Instructor Flag Queue — one row per (question, version) group. An
// instructor can open the real question editor, return the unchanged
// question to students, or review it before Reject & Archive. There is no
// Approve/Reject publication workflow in the queue itself.
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
// Content edits use the question editor and automatically mark the resolution
// correctness-affecting. Its remediation notification runs by default.
// Historical remediation reports remain reloadable for older resolutions.
import {
  ApiError,
  getCourseTree,
  listCourseFlags,
  resolveFlag as resolveFlagApi,
  notifyRemediation as notifyRemediationApi,
  getRemediationReport,
  type CourseTree,
  type Flag,
  type RemediationReport,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge, type BadgeVariant } from '../../instructor-ui.js';
import { textPromptDialog } from '../../modal.js';
import { renderRichText } from '../../render.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { subscribeFlagsChanged } from '../../flag-sync.js';

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

/** Whether the group carries ANY resolution marked correctness-affecting —
 * NOT just the latest one, unlike `latestResolutionAction` immediately above.
 * Remediation obligation is a property of the CONTENT that was served (the
 * question version), not of whichever resolution happened to land last:
 * ticking the box and Archiving a 3-flag group resolves flag 1
 * correctness-affecting, then flag 2 throws the documented
 * `archived->archived` error (see `resolveGroupFlags` below) and is left
 * open; the instructor then Clears the rest per that error message's own
 * guidance — without re-ticking the box, since nothing prompts them to. That
 * produces a LATER, non-correctness-affecting resolution in the same group.
 * A latest-wins rule would make the panel — and the persisted notify marker,
 * Task 6 re-review Finding B — vanish on the very next reload, even though
 * the original correctness-affecting archive still stands and its
 * obligations were never discharged. `.some(...)` is correct here in a way
 * it would NOT be for `latestResolutionAction`'s disposition badge, which
 * legitimately wants "what's true of this question right now," not "was it
 * ever true." Reads the persisted `resolution.correctnessAffecting` bit
 * (Task 6 review fix, Finding 3), so this still answers correctly after a
 * reload, not just in the same session the resolve happened in. */
function groupHasCorrectnessAffectingResolution(group: FlagGroup): boolean {
  return group.flags.some((flag) => flag.resolution?.correctnessAffecting === true);
}

/** The persisted "already notified" count for a group (Task 6 re-review,
 * Finding B) — read off whichever flag in the group carries it. The notify
 * wrapper (`notifyRemediation` in flags.service.ts) stamps it identically
 * onto every correctness-affecting flag in the group on success, so any one
 * of them answers the same; this is what lets the panel show "Notified N
 * students" instead of an armed button after a reload, once the in-session
 * `notifiedCounts` map (which always takes precedence — see
 * `remediationPanel` below) is gone. */
function persistedNotifiedCount(group: FlagGroup): number | undefined {
  for (const flag of group.flags) {
    if (flag.resolution?.correctnessAffecting && flag.resolution.notifiedCount !== undefined) {
      return flag.resolution.notifiedCount;
    }
  }
  return undefined;
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
  const initialGroups = groupFlags(flags);
  const header = pageHeader(
    'Flags',
    `${flags.length} flag${flags.length === 1 ? '' : 's'} across ${initialGroups.length} question version${initialGroups.length === 1 ? '' : 's'}`,
  );
  const headerSubtitle = header.querySelector('.page-header__subtitle');

  function updateHeader(): void {
    const groups = groupFlags(flags);
    const text = `${flags.length} flag${flags.length === 1 ? '' : 's'} across ${groups.length} question version${groups.length === 1 ? '' : 's'}`;
    if (headerSubtitle) headerSubtitle.textContent = text;
  }

  // Task 6 (§6.2 remediation): per-group state, keyed by `questionVersionId`
  // (the grouping key — see the module note). Survives `reload()` (which only
  // replaces `flags`, not these maps) so the checklist panel stays visible
  // across the re-render a resolve action triggers.
  const remediationReports = new Map<string, RemediationReport>();
  const notifiedCounts = new Map<string, number>();
  const notifyErrorMessages = new Map<string, string>();
  // Task 6 review fix (Finding 3): report re-fetch state, separate from the
  // notify state above. `remediationFetchAttempted` gates `ensureRemediationReport`
  // to at most one fetch per group per page load (whether it succeeds or
  // fails) — without it, a failed fetch would refire on every re-render
  // (`renderResults()` rebuilds every row), spamming the endpoint forever. A
  // full page reload gets a fresh attempt since these maps are recreated with
  // the view.
  const remediationFetchErrors = new Map<string, string>();
  const remediationFetchAttempted = new Set<string>();
  function recordRemediation(group: FlagGroup, remediation: RemediationReport | undefined): void {
    if (!remediation) return;
    remediationReports.set(group.questionVersionId, remediation);
    // A fresh correctness-affecting resolve on this group supersedes any
    // earlier notify/fetch-error state (defensive — the common case is this
    // only ever happens once per group).
    notifiedCounts.delete(group.questionVersionId);
    notifyErrorMessages.delete(group.questionVersionId);
    remediationFetchErrors.delete(group.questionVersionId);
  }

  // Task 6 re-review (Finding F): on first render, `ensureRemediationReport`
  // fires once per correctness-affecting group in the queue — M parallel GETs
  // on an M-group queue, each of which independently calls `renderResults()`
  // (rebuilding every row) when it settles. Left alone that's O(M²) DOM
  // churn. Coalescing the settle-triggered renders (rather than restructuring
  // the fetch itself, which is out of scope) fixes this with a minimal,
  // local change: any number of `scheduleRender()` calls arriving before the
  // pending timer fires collapse into the ONE `renderResults()` that timer
  // runs. `setTimeout(..., 0)` (not `queueMicrotask`) deliberately, since
  // network responses land on separate macrotask turns — a microtask alone
  // would rarely catch two in the same window; a zero-delay timer gives
  // near-simultaneous settles (the common case: everything was kicked off in
  // the same initial render) a real chance to coalesce.
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleRender(): void {
    if (renderTimer !== undefined) return;
    renderTimer = setTimeout(() => {
      // Cleared BEFORE the isConnected bail and before renderResults(), so a
      // settle landing mid-render schedules a fresh timer rather than being
      // swallowed, and a torn-down view doesn't leave the slot wedged.
      renderTimer = undefined;
      if (!root.isConnected) return;
      renderResults();
    }, 0);
  }

  /** Fetches the remediation report for a group that's correctness-affecting
   * but not yet in `remediationReports` (Task 6 review fix, Finding 3) — e.g.
   * after a reload, where only the persisted `correctnessAffecting` bit
   * survived, not the report itself. The in-memory map always wins: this is
   * a no-op whenever `group.questionVersionId` is already a key in it
   * (either from an in-session resolve or an earlier fetch), so a resolve
   * action's own `reload()` never redundantly refetches what it just
   * received on the resolve response. Fire-and-forget: schedules a
   * (coalesced, see `scheduleRender` above) re-render when it settles so the
   * panel picks up the numbers (or the error) once they're in. */
  function ensureRemediationReport(group: FlagGroup): void {
    const key = group.questionVersionId;
    if (remediationReports.has(key) || remediationFetchAttempted.has(key)) return;
    const targetFlag = group.flags[0];
    if (!targetFlag) return;
    remediationFetchAttempted.add(key);
    void getRemediationReport(targetFlag.id)
      .then((report) => {
        remediationReports.set(key, report);
        remediationFetchErrors.delete(key);
        scheduleRender();
      })
      .catch((error) => {
        remediationFetchErrors.set(key, error instanceof ApiError ? error.message : (error as Error).message);
        scheduleRender();
      });
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
   * kept and returned, so the caller renders the checklist once per group.
   *
   * Task 6 review fix (Finding 1): `remediation` is included on BOTH failure
   * returns below, not just the success path. The headline §6.2 failure mode
   * is exactly this loop hitting the documented `archived->archived` error on
   * flag 2 after flag 1 already resolved and returned a report — dropping
   * `remediation` there would discard the one deliverable the instructor
   * came for, with no way to recover it (flags are terminal, so re-resolving
   * can't regenerate it). Every caller now records whatever `remediation`
   * comes back regardless of `ok`, since the report is valid for every flag
   * that DID resolve even when a later one in the loop failed. */
  async function resolveGroupFlags(
    group: FlagGroup,
    action: ResolveAction,
    correctnessAffecting: boolean,
    comment?: string,
  ): Promise<{ ok: boolean; error?: string; remediation?: RemediationReport }> {
    const targets = openFlags(group);
    let resolvedCount = 0;
    let remediation: RemediationReport | undefined;
    for (const flag of targets) {
      try {
        const resolved = await resolveFlagApi(
          flag.id,
          action,
          correctnessAffecting || undefined,
          comment,
        );
        if (!remediation && resolved.remediation) remediation = resolved.remediation;
        resolvedCount++;
      } catch (error) {
        const rawMessage = error instanceof ApiError ? error.message : (error as Error).message;
        if (action === 'archive' && rawMessage === 'invalid-transition:archived->archived') {
          const remaining = targets.length - resolvedCount;
          return {
            ok: false,
            error: `${resolvedCount} of ${targets.length} flag${targets.length === 1 ? '' : 's'} resolved; the question was already archived. Use Clear to close the remaining flag${remaining === 1 ? '' : 's'}.`,
            remediation,
          };
        }
        return { ok: false, error: rawMessage, remediation };
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
    updateHeader();
    renderResults();
  }

  async function handleClear(group: FlagGroup): Promise<void> {
    const comment = await textPromptDialog({
      title: 'Return this question to students?',
      message: 'The open flags will be closed. If the question was paused and no longer exceeds the flag threshold, it will return to student practice.',
      fieldLabel: 'Reply to flagging student(s) (optional)',
      placeholder: 'Explain why the existing question is being kept.',
      confirmLabel: 'Return to Students',
    });
    if (comment === null) return;
    actionErrorMessage = null;
    const result = await resolveGroupFlags(group, 'clear', false, comment);
    if (!result.ok) actionErrorMessage = result.error ?? 'Failed to return the question.';
    // Task 6 review fix (Finding 1): recorded unconditionally — `remediation`
    // is valid for every flag that DID resolve even when the group's overall
    // result is a failure. `recordRemediation` itself no-ops when undefined.
    recordRemediation(group, result.remediation);
    await reload();
  }

  function handleEdit(group: FlagGroup, intent: 'edit' | 'archive' = 'edit'): void {
    const query = new URLSearchParams({
      from: 'flags',
      flagVersionId: group.questionVersionId,
      intent,
    });
    navigate(
      `/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(group.questionId)}?${query.toString()}`,
    );
  }

  /** "Notify affected students" (§6.2, Task 6) — fires once per group, using
   * any one flag in the group (the server resolves the notify target from
   * that flag's `questionVersionId`, which every flag in the group shares by
   * construction). An explicit user action: unlike resolve failures, a
   * notify failure is shown inline in the checklist panel rather than
   * silently retried.
   *
   * Task 6 re-review (Finding B): on success the server persists the
   * notified marker onto every correctness-affecting flag in the group (see
   * flags.service.ts's `notifyRemediation`), so this button can't be re-armed
   * by a reload into double-notifying the same students — `notifiedCounts`
   * here is just the in-session cache; `remediationPanel` below also
   * consults the persisted marker via `persistedNotifiedCount`. */
  async function handleNotify(group: FlagGroup): Promise<void> {
    const targetFlag = group.flags[0];
    if (!targetFlag) return;
    notifyErrorMessages.delete(group.questionVersionId);
    try {
      const result = await notifyRemediationApi(targetFlag.id);
      notifiedCounts.set(group.questionVersionId, result.notified);
    } catch (error) {
      const rawMessage = error instanceof ApiError ? error.message : (error as Error).message;
      // Task 6 re-review (Finding D): `remediation-notify-failed` (thrown
      // when EVERY notify() call in the fan-out rejected — see
      // remediation.service.ts's `notifyAffectedStudents`) is a genuine
      // server fault, correctly a 5xx rather than something client-
      // correctable, but its raw message reads as an internal error code
      // rather than something actionable. Translated the same way
      // `resolveGroupFlags` above translates the one known
      // `invalid-transition:archived->archived` resolve error.
      notifyErrorMessages.set(
        group.questionVersionId,
        rawMessage === 'remediation-notify-failed'
          ? 'Notification failed for every affected student — nothing was sent. Try again, or notify them manually in the meantime.'
          : rawMessage,
      );
    }
    renderResults();
  }

  /** The §6.2 remediation checklist panel: an editor link, report numbers,
   * and the four checklist items (three manual, one automated via the
   * "Notify affected students" button) — rendered under a group's row once
   * it's correctness-affecting (resolved ambiguity #4: pilot scope is a
   * MANUAL checklist plus exactly one automated action). Returns `false`
   * (rendering nothing) for groups that were never resolved with
   * `correctnessAffecting`.
   *
   * Task 6 review fix (Finding 2): "Open question editor" links to the same
   * target `handleCorrect`'s post-resolve navigate used before it was
   * suppressed for a correctness-affecting Correct — that suppression left no
   * other path back to the editor from this view, so the panel now carries
   * one, following the hash-router `<a href="#/...">` + `preventDefault` +
   * `navigate()` convention used by question-detail.ts's breadcrumb-back link
   * and preseeding.ts's queued-message link (a plain onclick-only button
   * would skip the real `href`, which is what makes it a genuine link rather
   * than a disguised button — e.g. reachable via "open in new tab").
   *
   * Task 6 review fix (Finding 3): shown whenever the group is
   * correctness-affecting, whether or not the report has arrived yet —
   * `hasStoredReport` renders immediately from an in-session resolve or an
   * earlier fetch; otherwise `ensureRemediationReport` kicks off a fetch (a
   * no-op if one is already in flight or already failed once) and the panel
   * renders with the checklist and notify button right away, with a "loading"
   * placeholder where the numbers go until the fetch resolves — or a brief
   * inline error if it fails, without blocking the rest of the queue.
   *
   * Task 6 re-review (Finding A): the correctness-affecting check now reads
   * `groupHasCorrectnessAffectingResolution` (ANY resolved flag, not just the
   * latest) — see that function's doc comment for why "latest" was wrong.
   * Finding B: the "Notified N students" state now also reads a persisted
   * marker (`persistedNotifiedCount`) when the in-session `notifiedCounts`
   * map has no entry, so it survives a reload. Finding E: a failed report
   * fetch now offers a "Try again" retry rather than requiring a full page
   * reload, by clearing this group's key out of `remediationFetchAttempted`
   * (the gate stays — this only lets it re-arm once, on demand). */
  function remediationPanel(group: FlagGroup): HTMLElement | false {
    const key = group.questionVersionId;
    const hasStoredReport = remediationReports.has(key);
    if (!hasStoredReport && !groupHasCorrectnessAffectingResolution(group)) return false;

    ensureRemediationReport(group);

    const report = remediationReports.get(key);
    const fetchError = remediationFetchErrors.get(key);
    const notified = notifiedCounts.has(key) ? notifiedCounts.get(key) : persistedNotifiedCount(group);
    const notifyError = notifyErrorMessages.get(key);

    const editorPath = `/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(group.questionId)}`;

    let stats: string | false = false;
    if (report) {
      const studentCount = report.affectedStudents.length;
      stats =
        `${report.affectedAttempts} attempt${report.affectedAttempts === 1 ? '' : 's'} across ${studentCount} student${studentCount === 1 ? '' : 's'} ` +
        `were served the affected content (${report.examAttempts} in exam-prep mode). ` +
        `${report.reviewBookEntries} Review Book entr${report.reviewBookEntries === 1 ? 'y' : 'ies'} may reference it.`;
    } else if (!fetchError) {
      stats = 'Loading blast-radius numbers…';
    }

    return el(
      'div',
      { class: 'remediation-panel' },
      el('h3', { class: 'remediation-panel__title', text: 'Remediation checklist (correctness-affecting)' }),
      el(
        'p',
        { class: 'remediation-panel__editor-link' },
        el(
          'a',
          {
            href: `#${editorPath}`,
            onclick: (e: Event) => {
              e.preventDefault();
              navigate(editorPath);
            },
          },
          'Open question editor →',
        ),
      ),
      stats ? el('p', { class: 'remediation-panel__stats', text: stats }) : false,
      fetchError
        ? errorState(`Couldn't load the blast-radius numbers: ${fetchError}`, () => {
            remediationFetchAttempted.delete(key);
            renderResults();
          })
        : false,
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

    const actions = open
      ? el(
          'div',
          { class: 'flag-row__actions' },
          el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => handleEdit(group) }, 'Edit'),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void handleClear(group) }, 'Return to Students'),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => handleEdit(group, 'archive') }, 'Reject & Archive'),
        )
      : false;

    const row = el(
      'div',
      { class: 'flag-row' },
      el(
        'div',
        {},
        group.flags.some((flag) => flag.source === 'instructor-preview-test')
          ? el('span', { class: 'badge badge--muted flag-test-badge', text: 'TEST · Instructor Preview' })
          : false,
        stemCell,
        el('p', { class: 'flag-row__topic', text: topicLo }),
        reasonsSummary(group),
        staleVersionNote(group),
      ),
      badge,
      actions,
    );

    return el(
      'div',
      {
        class: 'flag-group',
        'data-question-id': group.questionId,
        'data-flag-ids': group.flags.map((flag) => flag.id).join(' '),
      },
      row,
      remediationPanel(group),
    );
  }

  // Review fix (round 1): `renderResults()` — and therefore
  // `highlightFromQuery()` below — reruns on every background trigger
  // (`subscribeFlagsChanged`, tab-focus/visibilitychange, any resolve/notify
  // action), not just the initial notification landing, and nothing ever
  // clears `?flag=`/`?question=` from the hash. Without a one-shot guard the
  // instructor gets re-scrolled and re-flashed on every one of those events
  // for as long as they stay on the URL, even after scrolling away or
  // mid-edit elsewhere. Set only on a SUCCESSFUL match (not on every call/on
  // entry): a stale id never matches regardless of when the flag is set, so
  // gating on entry would only cost us the (harmless, no-op) case of a
  // genuinely late-arriving match still getting its one highlight.
  let highlightApplied = false;

  /** A notification click lands here with ?flag= or ?question= (see
   * client/src/notification-target.ts). Scroll that group into view and mark
   * it, so the user sees the thing they were notified about rather than the
   * top of an undifferentiated queue. A stale id (flag already resolved and
   * filtered out) simply highlights nothing -- being on the right page is
   * still the right outcome. Runs at most once per page load (see
   * `highlightApplied` above) so later background re-renders don't re-scroll
   * the instructor back to a group they've since navigated away from. */
  function highlightFromQuery(): void {
    if (highlightApplied) return;
    const query = currentQuery();
    const flagId = query.get('flag');
    const questionId = query.get('question');
    if (!flagId && !questionId) return;

    const groups = Array.from(resultsContainer.querySelectorAll<HTMLElement>('.flag-group'));
    const match = groups.find((group) =>
      questionId
        ? group.dataset.questionId === questionId
        : (group.dataset.flagIds ?? '').split(' ').includes(flagId as string),
    );
    if (!match) return;

    highlightApplied = true;
    for (const group of groups) group.classList.remove('flag-group--highlight');
    match.classList.add('flag-group--highlight');
    match.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    highlightFromQuery();
  }

  body.replaceChildren(
    header,
    resultsContainer,
  );
  updateHeader();
  renderResults();

  const unsubscribeFlagsChanged = subscribeFlagsChanged(() => void reload());
  const refreshWhenVisible = (): void => {
    if (document.visibilityState === 'visible' && root.isConnected) void reload();
  };
  document.addEventListener('visibilitychange', refreshWhenVisible);
  window.addEventListener('focus', refreshWhenVisible);
  const lifecycleObserver = new MutationObserver(() => {
    if (root.isConnected) return;
    unsubscribeFlagsChanged();
    document.removeEventListener('visibilitychange', refreshWhenVisible);
    window.removeEventListener('focus', refreshWhenVisible);
    lifecycleObserver.disconnect();
  });
  lifecycleObserver.observe(outlet, { childList: true });
}

export function renderFlagQueue(outlet: HTMLElement, params: RouteParams): void {
  void renderFlagQueueInner(outlet, params.id);
}
