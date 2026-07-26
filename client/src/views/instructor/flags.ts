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
//
// Task 6 review fix (Finding 3): the resolve response's `remediation` field
// is one-shot and flags are terminal, so a reload used to permanently lose
// both the report and the "Notify affected students" button. The server now
// persists `resolution.correctnessAffecting` on the flag and exposes
// `GET /api/flags/:flagId/remediation` to regenerate the (pure read-only)
// report. `groupHasCorrectnessAffectingResolution` reads the persisted bit so
// the panel renders for a group on a fresh load too; `remediationReports`
// (below) still takes precedence when already populated — from either an
// in-session resolve or an earlier fetch — so a reload triggered by a resolve
// action never redundantly refetches what it already has.
//
// Task 6 re-review (second round, findings A–F): (A) the fix above had a
// latent bug — reading only the LATEST resolved flag's bit meant a later,
// non-correctness-affecting Clear on a group (e.g. clearing the flag(s) left
// over from the archived->archived edge case above, without re-ticking the
// box) could re-hide an already-shown panel after reload.
// `groupHasCorrectnessAffectingResolution` (renamed from
// `latestResolutionIsCorrectnessAffecting`) now checks ANY resolved flag in
// the group instead of just the latest. (B) "Notify affected students" gets
// the same persisted-marker treatment `correctnessAffecting` got above —
// `resolution.notifiedAt`/`notifiedCount`, stamped by flags.service.ts's
// `notifyRemediation` on every correctness-affecting flag in the group — so a
// reload can't re-arm the button into double-notifying the same students. (C)
// the "Correctness-affecting" checkbox now survives a re-render (see
// `correctnessChecked` below) — `ensureRemediationReport`'s fetch settling
// and `handleNotify` both trigger one, so a render is no longer guaranteed to
// follow only a user action. (D) the notify button's total-failure error
// (`remediation-notify-failed`) is translated to an actionable message
// client-side, the same way the `archived->archived` resolve error is. (E) a
// failed report fetch now offers a "Try again" retry rather than requiring a
// full page reload. (F) `ensureRemediationReport`'s settle-triggered
// re-renders are coalesced via `scheduleRender` to avoid O(M²) DOM churn on a
// queue with many correctness-affecting groups.
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
  // Task 6 re-review (Finding C): the "Correctness-affecting" checkbox's
  // ticked/unticked state, keyed the same way as the maps above. Needed
  // because a render is no longer guaranteed to follow only a user action —
  // `ensureRemediationReport`'s fetch settling and `handleNotify` both call
  // `renderResults()` on their own — so without this, an in-flight settle
  // landing while the box is ticked would silently untick it right before a
  // Correct/Archive/Clear click resolves without remediation. See
  // `groupRow`'s construction of `correctnessCheckbox` below.
  const correctnessChecked = new Map<string, boolean>();

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
      if (!root.isConnected) return;
      renderTimer = undefined;
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
    renderResults();
  }

  async function handleClear(group: FlagGroup, correctnessAffecting: boolean): Promise<void> {
    actionErrorMessage = null;
    const result = await resolveGroupFlags(group, 'clear', correctnessAffecting);
    if (!result.ok) actionErrorMessage = result.error ?? 'Failed to clear flag(s).';
    // Task 6 review fix (Finding 1): recorded unconditionally — `remediation`
    // is valid for every flag that DID resolve even when the group's overall
    // result is a failure. `recordRemediation` itself no-ops when undefined.
    recordRemediation(group, result.remediation);
    await reload();
  }

  async function handleArchive(group: FlagGroup, correctnessAffecting: boolean): Promise<void> {
    const count = openFlags(group).length;
    if (!window.confirm(`Archive this question? This resolves ${count} flag${count === 1 ? '' : 's'} and removes it from student practice.`)) return;
    actionErrorMessage = null;
    const result = await resolveGroupFlags(group, 'archive', correctnessAffecting);
    if (!result.ok) actionErrorMessage = result.error ?? 'Failed to archive question.';
    // See handleClear's comment above — recorded unconditionally (Finding 1).
    // This is the concrete headline case: flag 1 archives and returns the
    // report, flag 2 throws the deterministic archived->archived error and
    // `ok` is false, but the report from flag 1 must not be discarded.
    recordRemediation(group, result.remediation);
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
    // See handleClear's comment above — recorded unconditionally (Finding 1).
    recordRemediation(group, result.remediation);
    if (!result.ok) {
      actionErrorMessage = result.error ?? 'Failed to resolve flag(s); question editor not opened.';
      await reload();
      return;
    }
    if (correctnessAffecting) {
      // A correctness-affecting resolve surfaces the remediation checklist
      // (§6.2, Task 6) — stay on this view instead of the usual
      // navigate-to-editor shortcut, so the instructor sees the blast-radius
      // report and the "Notify affected students" action. The panel itself
      // carries an "Open question editor" link (Finding 2) so the editor is
      // still one click away rather than requiring a manual hunt through the
      // bank.
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

    // Task 6 (§6.2 remediation): the checkbox (and this whole row) is rebuilt
    // on every `renderResults()`. Task 6 re-review (Finding C): a render is
    // no longer guaranteed to follow only a user action —
    // `ensureRemediationReport`'s fetch settling and `handleNotify` both call
    // `renderResults()` on their own — so an unticked-by-default rebuild
    // would silently discard a tick made while one of those was in flight,
    // right before a Correct/Archive/Clear resolves without remediation
    // (unrecoverable, since flags are terminal). State now lives in
    // `correctnessChecked`, keyed by `questionVersionId` like this view's
    // other per-group maps (see their declarations above), read here to seed
    // the checkbox and written on every `change`.
    const correctnessCheckbox = el('input', {
      type: 'checkbox',
      'aria-label': 'Correctness-affecting',
      checked: correctnessChecked.get(group.questionVersionId) ?? false,
      onchange: (e: Event) => {
        correctnessChecked.set(group.questionVersionId, (e.target as HTMLInputElement).checked);
      },
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
