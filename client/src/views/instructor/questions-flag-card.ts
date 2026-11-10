// Student-flag card for the Questions workspace reader. Shown at the top of
// the reader, in any tab, whenever the selected question has open flags; the
// resolved history stays below it, collapsed. Extracted from the retired
// Flags page (views/instructor/flags.ts), keeping its resolution rules:
//
// - Flags are grouped by the version they were raised against
//   (flag-groups.ts). Correct / Archive open the question editor with
//   `?from=flags&flagVersionId=&intent=`, which resolves the group on save.
//   Clear resolves every open flag in the group here.
// - Archiving a group with several open flags succeeds for the first and then
//   fails `invalid-transition:archived->archived`; that is translated into
//   "use Clear for the rest".
// - A correctness-affecting resolution shows the remediation checklist and
//   "Notify affected students". The notified marker is persisted on the
//   flags by the server, so a reload never re-arms the button.
import {
  ApiError,
  getRemediationReport,
  listCourseFlags,
  notifyRemediation as notifyRemediationApi,
  resolveFlag as resolveFlagApi,
  type Flag,
  type RemediationReport,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { statusBadge, type BadgeVariant } from '../../instructor-ui.js';
import { textPromptDialog } from '../../modal.js';
import { errorState } from '../../ui.js';
import {
  byCreatedAtDesc,
  groupFlags,
  isGroupEscalated,
  isGroupOpen,
  latestEscalation,
  openFlags,
  sortGroups,
  type FlagGroup,
} from '../../flag-groups.js';

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

/** Imperative wording: a TA recommendation still awaits the instructor. */
const ESCALATION_RECOMMENDATION_LABEL: Record<ResolveAction, string> = {
  correct: 'Correct the question',
  archive: 'Archive the question',
  clear: 'Clear the flag',
};

const SOURCE_LABEL: Record<NonNullable<Flag['source']>, string> = {
  student: 'Student',
  ta: 'TA',
  'instructor-preview-test': 'Instructor preview test',
};

function flagSource(flag: Flag): string {
  if (flag.source) return SOURCE_LABEL[flag.source];
  return flag.raisedBy === 'ta' ? 'TA' : 'Student';
}

function latestResolutionAction(group: FlagGroup): ResolveAction | null {
  const resolved = group.flags.filter((f): f is Flag & { resolution: NonNullable<Flag['resolution']> } => Boolean(f.resolution));
  if (resolved.length === 0) return null;
  resolved.sort((a, b) => new Date(b.resolution.at).getTime() - new Date(a.resolution.at).getTime());
  return resolved[0].resolution.action;
}

/** ANY correctness-affecting resolution in the group keeps the checklist —
 * the obligation belongs to the content that was served, not to whichever
 * resolution landed last (e.g. an archive followed by Clear on the rest). */
function groupHasCorrectnessAffectingResolution(group: FlagGroup): boolean {
  return group.flags.some((flag) => flag.resolution?.correctnessAffecting === true);
}

/** The server stamps the notified count on every correctness-affecting flag
 * of the group; any one answers. */
function persistedNotifiedCount(group: FlagGroup): number | undefined {
  for (const flag of group.flags) {
    if (flag.resolution?.correctnessAffecting && flag.resolution.notifiedCount !== undefined) return flag.resolution.notifiedCount;
  }
  return undefined;
}

const errorText = (error: unknown): string => error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);

export function flagsHelp(): HTMLElement {
  return el('details', { class: 'questions-flags-help' },
    el('summary', { text: 'How flags work' }),
    el('ol', {},
      el('li', { text: 'Students and TAs report problems with a question; reports are grouped by the version they saw.' }),
      el('li', { text: 'Read the question and the reports, then correct it, archive it, or clear the flag to keep it as is.' }),
      el('li', { text: 'If a correction changes which answer is right, tick “affects correctness” in the editor: the remediation checklist then lets you notify affected students.' })),
    el('p', { class: 'muted', text: 'AI generation checks are separate from student flags. A question is paused automatically once enough students flag it.' }));
}

export interface FlagCardOptions {
  courseId: string;
  questionId: string;
  /** Called after a resolution here changed flag or question state. */
  onChanged: () => void;
  /** Flag id from a notification click, highlighted when present. */
  highlightFlagId?: string;
}

/** Fetches and renders the selected question's flags. `root` is empty when
 * the question has never been flagged. */
export function createFlagCard(options: FlagCardOptions): { root: HTMLElement; load: () => Promise<void> } {
  const root = el('section', { class: 'questions-flag-card', 'aria-label': 'Student flags', hidden: true });
  let flags: Flag[] = [];
  let actionError: string | null = null;
  let busy = false;
  const remediationReports = new Map<string, RemediationReport>();
  const notifiedCounts = new Map<string, number>();
  const notifyErrors = new Map<string, string>();
  const reportErrors = new Map<string, string>();
  const reportAttempted = new Set<string>();

  const editorPath = (group: FlagGroup, intent?: 'edit' | 'archive'): string => {
    const base = `/instructor/course/${encodeURIComponent(options.courseId)}/bank/${encodeURIComponent(group.questionId)}`;
    if (!intent) return base;
    return `${base}?${new URLSearchParams({ from: 'flags', flagVersionId: group.questionVersionId, intent }).toString()}`;
  };

  function recordRemediation(group: FlagGroup, report: RemediationReport | undefined): void {
    if (!report) return;
    remediationReports.set(group.questionVersionId, report);
    notifiedCounts.delete(group.questionVersionId);
    notifyErrors.delete(group.questionVersionId);
    reportErrors.delete(group.questionVersionId);
  }

  function ensureReport(group: FlagGroup): void {
    const key = group.questionVersionId;
    if (remediationReports.has(key) || reportAttempted.has(key) || !group.flags[0]) return;
    reportAttempted.add(key);
    void getRemediationReport(group.flags[0].id)
      .then((report) => { remediationReports.set(key, report); reportErrors.delete(key); })
      .catch((error) => { reportErrors.set(key, errorText(error)); })
      .finally(() => { if (root.isConnected) draw(); });
  }

  async function resolveGroup(group: FlagGroup, action: ResolveAction, comment?: string): Promise<{ ok: boolean; error?: string; remediation?: RemediationReport }> {
    const targets = openFlags(group);
    let resolvedCount = 0;
    let remediation: RemediationReport | undefined;
    for (const flag of targets) {
      try {
        const resolved = await resolveFlagApi(flag.id, action, undefined, comment);
        if (!remediation && resolved.remediation) remediation = resolved.remediation;
        resolvedCount++;
      } catch (error) {
        const raw = errorText(error);
        if (action === 'archive' && raw === 'invalid-transition:archived->archived') {
          const remaining = targets.length - resolvedCount;
          return { ok: false, remediation, error: `${resolvedCount} of ${targets.length} flag${targets.length === 1 ? '' : 's'} resolved; the question was already archived. Use Clear to close the remaining flag${remaining === 1 ? '' : 's'}.` };
        }
        return { ok: false, error: raw, remediation };
      }
    }
    return { ok: true, remediation };
  }

  async function handleClear(group: FlagGroup): Promise<void> {
    if (busy) return;
    const comment = await textPromptDialog({
      title: 'Clear the flag?',
      message: 'The open reports will be closed and the question kept as it is. If it was paused and no longer exceeds the flag threshold, it returns to student practice.',
      fieldLabel: 'Reply to the flagging student(s) (optional)',
      placeholder: 'Explain why the existing question is being kept.',
      confirmLabel: 'Clear the flag',
    });
    if (comment === null) return;
    busy = true; actionError = null; draw();
    const result = await resolveGroup(group, 'clear', comment);
    if (!result.ok) actionError = result.error ?? 'The flag could not be cleared.';
    recordRemediation(group, result.remediation);
    busy = false;
    await load();
    options.onChanged();
  }

  async function handleNotify(group: FlagGroup): Promise<void> {
    const target = group.flags[0];
    if (!target) return;
    notifyErrors.delete(group.questionVersionId);
    try {
      const result = await notifyRemediationApi(target.id);
      notifiedCounts.set(group.questionVersionId, result.notified);
    } catch (error) {
      const raw = errorText(error);
      notifyErrors.set(group.questionVersionId, raw === 'remediation-notify-failed'
        ? 'Notification failed for every affected student — nothing was sent. Try again, or notify them manually in the meantime.'
        : raw);
    }
    draw();
  }

  function remediationPanel(group: FlagGroup): HTMLElement | false {
    const key = group.questionVersionId;
    if (!remediationReports.has(key) && !groupHasCorrectnessAffectingResolution(group)) return false;
    ensureReport(group);
    const report = remediationReports.get(key);
    const fetchError = reportErrors.get(key);
    const notified = notifiedCounts.has(key) ? notifiedCounts.get(key) : persistedNotifiedCount(group);
    const notifyError = notifyErrors.get(key);
    let stats: string | false = false;
    if (report) {
      const students = report.affectedStudents.length;
      stats = `${report.affectedAttempts} attempt${report.affectedAttempts === 1 ? '' : 's'} across ${students} student${students === 1 ? '' : 's'} `
        + `were served the affected content (${report.examAttempts} in exam-prep mode). `
        + `${report.reviewBookEntries} Review Book entr${report.reviewBookEntries === 1 ? 'y' : 'ies'} may reference it.`;
    } else if (!fetchError) {
      stats = 'Loading affected attempts…';
    }
    return el('div', { class: 'remediation-panel' },
      el('h3', { class: 'remediation-panel__title', text: 'Remediation checklist (correctness-affecting)' }),
      stats ? el('p', { class: 'remediation-panel__stats', text: stats }) : false,
      fetchError ? errorState(`Couldn't load the affected attempts: ${fetchError}`, () => { reportAttempted.delete(key); draw(); }) : false,
      el('ul', { class: 'remediation-panel__checklist' },
        el('li', { text: 'Recompute correctness for the affected attempts.' }),
        el('li', { text: 'Drop the affected attempts from mastery windows and re-evaluate.' }),
        el('li', { text: 'Remove any wrongly-added Review Book entries.' }),
        el('li', { class: 'remediation-panel__notify-item' },
          el('span', { text: 'Notify affected students.' }),
          notified !== undefined
            ? el('span', { class: 'remediation-panel__notified', text: ` Notified ${notified} student${notified === 1 ? '' : 's'}.` })
            : el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => handleNotify(group) }, 'Notify affected students'))),
      notifyError ? errorState(notifyError) : false);
  }

  function reportList(list: Flag[]): HTMLElement {
    return el('ul', { class: 'questions-flag-card__reports' }, ...list.slice().sort(byCreatedAtDesc).map((flag) => el('li', {
      class: flag.id === options.highlightFlagId ? 'is-highlighted' : '',
      'data-flag-id': flag.id,
    },
    el('small', { text: `${flagSource(flag)} · ${new Date(flag.createdAt).toLocaleString()}` }),
    el('p', { text: flag.reason?.trim() ? flag.reason : 'No reason given.' }),
    flag.resolution ? el('p', { class: 'muted', text: `${RESOLUTION_LABEL[flag.resolution.action]} · ${new Date(flag.resolution.at).toLocaleDateString()}${flag.resolution.comment ? ` · ${flag.resolution.comment}` : ''}` }) : false)));
  }

  function openGroup(group: FlagGroup, currentVersionId: string | undefined): HTMLElement {
    const open = openFlags(group);
    const students = new Set(open.filter((flag) => flagSource(flag) === 'Student').map((flag) => flag.puid)).size;
    const escalated = isGroupEscalated(group);
    const escalation = latestEscalation(group);
    return el('div', { class: 'questions-flag-card__group', 'data-flag-version': group.questionVersionId },
      el('div', { class: 'questions-flag-card__heading' },
        el('h3', { text: `${open.length} open report${open.length === 1 ? '' : 's'}` }),
        escalated ? statusBadge('Escalated by TA', 'flag') : false,
        students ? statusBadge(`${students} student${students === 1 ? '' : 's'}`, 'flag') : false,
        group.flags.some((flag) => flag.source === 'instructor-preview-test') ? el('span', { class: 'badge badge--muted', text: 'TEST · Instructor preview' }) : false),
      currentVersionId && currentVersionId !== group.questionVersionId
        ? el('p', { class: 'questions-flag-card__stale', text: 'The question was edited after these reports. The reader shows the current version.' })
        : false,
      escalation
        ? el('p', { class: 'questions-flag-card__escalation' },
          el('strong', { text: `TA recommends: ${ESCALATION_RECOMMENDATION_LABEL[escalation.recommendation]}` }),
          escalation.note ? el('span', { text: ` — “${escalation.note}”` }) : false)
        : escalated ? el('p', { class: 'questions-flag-card__escalation' }, el('strong', { text: 'Escalated by a TA — no recommendation recorded' })) : false,
      reportList(open),
      el('div', { class: 'questions-flag-card__actions' },
        el('a', { class: 'btn btn--instr-primary btn--sm', href: `#${editorPath(group, 'edit')}`, text: 'Correct the question' }),
        el('a', { class: 'btn btn--ghost btn--sm', href: `#${editorPath(group, 'archive')}`, text: 'Archive the question' }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: busy, onclick: () => handleClear(group) }, busy ? 'Clearing…' : 'Clear the flag')),
      remediationPanel(group));
  }

  function resolvedGroup(group: FlagGroup): HTMLElement {
    const action = latestResolutionAction(group);
    return el('div', { class: 'questions-flag-card__resolved-group' },
      statusBadge(action ? RESOLUTION_LABEL[action] : 'Resolved', action ? RESOLUTION_VARIANT[action] : 'neutral'),
      reportList(group.flags),
      remediationPanel(group));
  }

  function draw(): void {
    const groups = sortGroups(groupFlags(flags));
    const currentVersionId = flags[0]?.question?.currentVersionId;
    const open = groups.filter(isGroupOpen);
    const resolved = groups.filter((group) => !isGroupOpen(group));
    root.hidden = groups.length === 0;
    root.classList.toggle('has-open', open.length > 0);
    mount(root,
      actionError ? errorState(actionError) : false,
      ...open.map((group) => openGroup(group, currentVersionId)),
      resolved.length
        ? el('details', { class: 'questions-flag-card__history', open: open.length === 0 && resolved.some((group) => groupHasCorrectnessAffectingResolution(group)) },
          el('summary', { text: `Resolved · ${resolved.reduce((sum, group) => sum + group.flags.length, 0)}` }),
          ...resolved.map(resolvedGroup))
        : false,
      open.length ? flagsHelp() : false);
  }

  async function load(): Promise<void> {
    try {
      flags = await listCourseFlags(options.courseId, undefined, options.questionId);
    } catch (error) {
      root.hidden = false;
      mount(root, errorState(`Flags could not be loaded: ${errorText(error)}`, () => void load()));
      return;
    }
    draw();
  }

  return { root, load };
}
