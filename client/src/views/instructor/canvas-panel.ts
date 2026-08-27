// Canvas card (Settings) and Import-from-Canvas dialog (Materials). Phase 6.
// Design: docs/superpowers/specs/2026-08-27-canvas-integration-design.md §UI.
import {
  ApiError,
  canvasLoginUrl,
  disconnectCanvas,
  getCanvasLink,
  getCanvasStatus,
  importCanvasFiles,
  linkCanvasCourse,
  listCanvasCourses,
  listCanvasFiles,
  syncCanvasRoster,
  unlinkCanvasCourse,
  type CanvasCoverage,
  type CanvasSyncResult,
  type Material,
} from '../../api.js';
import { el } from '../../dom.js';
import { confirmDialog } from '../../modal.js';
import { sectionTitleWithHelp } from '../../instructor-ui.js';
import { errorState, loadingState } from '../../ui.js';

const HELP = 'Connect your own Canvas account, link the Canvas course you teach, then sync its roster or import its files. '
  + 'Synced students can enroll with the registration code alone; the CSV roster still works alongside it.';

export function coverageMessage(coverage: CanvasCoverage): string {
  const missing = coverage.total - coverage.integrationId;
  if (missing <= 0) return '';
  return missing === 1
    ? '1 student has no student ID visible in Canvas and was not added.'
    : `${missing} students have no student ID visible in Canvas and were not added.`;
}

export function bucketCounts(report: CanvasSyncResult['report']): { matched: number; rosterOnly: number; appOnly: number } {
  return { matched: report.matched.length, rosterOnly: report.rosterOnly.length, appOnly: report.appOnly.length };
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.message === 'canvas-reconnect') return 'Your Canvas connection has expired. Reconnect to continue.';
    if (error.message === 'canvas-forbidden') return 'Canvas denied access for your account. Check that you teach this course in Canvas.';
    if (error.message === 'roster-coverage') return 'Canvas isn’t exposing student IDs to your account; nothing was changed.';
    if (error.message === 'not-teacher') return 'You are not a teacher of that Canvas course.';
    if (error.message === 'canvas-unavailable') return 'Canvas didn’t respond. Try again in a moment.';
    if (error.status === 401) return 'Your Canvas connection has expired. Reconnect to continue.';
    return error.message;
  }
  return (error as Error).message;
}

const REASON_LABEL: Record<'unknown' | 'not-enrolled' | 'enrollment-ended', string> = {
  unknown: 'not on the Canvas roster',
  'not-enrolled': 'never enrolled in this Canvas course — is the right course linked?',
  'enrollment-ended': 'dropped in Canvas',
};

function reportView(result: CanvasSyncResult): HTMLElement {
  const counts = bucketCounts(result.report);
  const coverage = coverageMessage(result.coverage);
  const bucket = (title: string, rows: string[]): HTMLElement =>
    rows.length
      ? el(
        'details',
        { class: 'canvas-report__bucket' },
        el('summary', { text: `${title} (${rows.length})` }),
        el('ul', {}, ...rows.map((r) => el('li', { text: r }))),
      )
      : el('p', { class: 'canvas-report__empty muted', text: `${title}: none` });
  return el(
    'div',
    { class: 'canvas-report stack', 'aria-live': 'polite' },
    el('p', { class: 'canvas-report__counts', text: `${counts.matched} matched · ${counts.rosterOnly} on Canvas only · ${counts.appOnly} in FinanceBot only` }),
    el('p', {
      class: 'canvas-report__coverage muted',
      text: `Student IDs visible for ${result.coverage.integrationId} of ${result.coverage.total} · ${result.stored} added to the roster · synced ${new Date(result.syncedAt).toLocaleString()}`,
    }),
    coverage ? el('p', { class: 'canvas-report__warn', text: coverage }) : el('span'),
    bucket('Matched', result.report.matched.map((m) => m.name)),
    bucket('On Canvas only', result.report.rosterOnly.map((r) => r.name)),
    bucket('In FinanceBot only', result.report.appOnly.map((a) => `${a.formerEnrollment?.name ?? a.key} — ${REASON_LABEL[a.reason]}`)),
    bucket('Ambiguous', result.report.ambiguous.map((a) => `${a.lmsUserIds.length} Canvas accounts share one ID`)),
  );
}

/** The Settings card. Renders nothing when the deployment has no Canvas. */
export function renderCanvasCard(courseId: string, onRosterChanged: () => void): HTMLElement {
  const root = el('div', { class: 'canvas-card stack', id: 'canvas' });
  const body = el('div', {}, loadingState('Checking Canvas…'));
  root.append(sectionTitleWithHelp('Canvas', HELP), body);
  const returnTo = `${location.pathname}#canvas`;

  function step(n: number, title: string, ...children: HTMLElement[]): HTMLElement {
    return el('div', { class: 'canvas-step stack' }, el('p', { class: 'canvas-step__label', text: `Step ${n} of 3 · ${title}` }), ...children);
  }

  async function refresh(): Promise<void> {
    try {
      const status = await getCanvasStatus();
      if (status === null) {
        root.replaceChildren();
        return;
      }
      if (!status.connected) {
        body.replaceChildren(step(1, 'Connect your Canvas account', el('a', { class: 'btn btn--primary', href: canvasLoginUrl(returnTo), text: 'Connect Canvas' })));
        return;
      }
      const link = await getCanvasLink(courseId);
      if (!link.linked) {
        body.replaceChildren(await chooseCourse());
        return;
      }
      body.replaceChildren(linked(link.canvas.name, link.canvas.code));
      onRosterChanged();
    } catch (error) {
      body.replaceChildren(errorState(errorText(error), () => void refresh()));
    }
  }

  function disconnectButton(): HTMLElement {
    return el('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      text: 'Disconnect Canvas',
      onclick: async () => {
        const ok = await confirmDialog({ title: 'Disconnect Canvas?', message: 'Your Canvas connection will be removed for every course. Links and synced rosters stay until you unlink them.', confirmLabel: 'Disconnect' });
        if (!ok) return;
        try {
          await disconnectCanvas();
          await refresh();
        } catch (error) {
          body.replaceChildren(errorState(errorText(error), () => void refresh()));
        }
      },
    });
  }

  async function chooseCourse(): Promise<HTMLElement> {
    const courses = await listCanvasCourses();
    if (courses.length === 0) {
      return step(2, 'Choose the Canvas course', el('p', { text: 'Canvas lists no courses you teach. Check your Canvas enrolments, or reconnect with the right account.' }), disconnectButton());
    }
    const select = el('select', { class: 'input', 'aria-label': 'Canvas course' }, ...courses.map((c) => el('option', { value: c.id, text: `${c.code} — ${c.name}` }))) as HTMLSelectElement;
    const slot = el('div', {});
    const button = el('button', {
      class: 'btn btn--primary',
      type: 'button',
      text: 'Link course',
      onclick: async () => {
        try {
          await linkCanvasCourse(courseId, select.value);
          await refresh();
        } catch (error) {
          slot.replaceChildren(errorState(errorText(error)));
        }
      },
    });
    return step(2, 'Choose the Canvas course', select, el('div', { class: 'canvas-actions' }, button, disconnectButton()), slot);
  }

  function linked(name: string, code: string): HTMLElement {
    const slot = el('div', {});
    const sync = el('button', {
      class: 'btn btn--primary',
      type: 'button',
      text: 'Sync roster',
      onclick: async () => {
        sync.setAttribute('disabled', 'true');
        slot.replaceChildren(loadingState('Reading the Canvas roster…'));
        try {
          slot.replaceChildren(reportView(await syncCanvasRoster(courseId)));
          onRosterChanged();
        } catch (error) {
          slot.replaceChildren(errorState(errorText(error)));
        } finally {
          sync.removeAttribute('disabled');
        }
      },
    });
    const unlink = el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: 'Unlink',
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Unlink Canvas course?',
          message: 'Students added from Canvas will no longer be able to enroll unless they are on the CSV roster. Imported materials stay.',
          confirmLabel: 'Unlink',
          tone: 'danger',
        });
        if (!ok) return;
        try {
          await unlinkCanvasCourse(courseId);
          onRosterChanged();
          await refresh();
        } catch (error) {
          slot.replaceChildren(errorState(errorText(error)));
        }
      },
    });
    return step(3, 'Linked', el('p', { class: 'canvas-linked', text: `${code} — ${name}` }), el('div', { class: 'canvas-actions' }, sync, unlink, disconnectButton()), slot);
  }

  void refresh();
  return root;
}

/** Materials: pick Canvas Files, confirm, import. Resolves with created materials. */
export async function openCanvasImportDialog(courseId: string): Promise<Material[]> {
  const files = await listCanvasFiles(courseId);
  const chosen = new Set<string>();
  const list = el(
    'div',
    { class: 'canvas-files' },
    ...files.map((f) => {
      const box = el('input', { type: 'checkbox', id: `cf-${f.id}`, ...(f.alreadyImported ? { disabled: 'true' } : {}) }) as HTMLInputElement;
      box.addEventListener('change', () => (box.checked ? chosen.add(f.id) : chosen.delete(f.id)));
      const note = f.alreadyImported ? 'already imported' : f.size ? `${Math.round(f.size / 1024)} KB` : '';
      return el('label', { class: 'canvas-files__row', for: `cf-${f.id}` }, box, el('span', { text: f.name }), el('span', { class: 'muted', text: note }));
    }),
  );
  const dialog = el(
    'dialog',
    { class: 'app-dialog' },
    el('h2', { text: 'Import from Canvas' }),
    files.length ? list : el('p', { text: 'No importable files in the linked Canvas course.' }),
    el(
      'div',
      { class: 'app-dialog__actions' },
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
      el('button', { class: 'btn btn--primary', type: 'button', text: 'Import selected', onclick: () => dialog.close('ok') }),
    ),
  ) as HTMLDialogElement;
  document.body.append(dialog);
  dialog.showModal();
  const outcome = await new Promise<string>((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
  dialog.remove();
  if (outcome !== 'ok' || chosen.size === 0) return [];
  const ids = [...chosen];
  const ok = await confirmDialog({
    title: `Import ${ids.length} file${ids.length === 1 ? '' : 's'}?`,
    message: files.filter((f) => chosen.has(f.id)).map((f) => f.name).join(', '),
    confirmLabel: 'Import',
  });
  if (!ok) return [];
  const result = await importCanvasFiles(courseId, ids);
  if (result.failed.length) {
    throw new ApiError(`${result.created.length} imported; ${result.failed.length} failed (${result.failed.map((f) => f.reason).join(', ')}).`, 207);
  }
  return result.created;
}
