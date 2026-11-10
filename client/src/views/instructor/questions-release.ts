// "Manage releases" panel for the Questions workspace: one row per Topic with
// its approved count and current state, and the choice Release now /
// Schedule / Keep hidden. Saving PATCHes each changed Topic with its
// `revision` (a stale revision is a 409 the panel reports). This replaces the
// old bank dialog and Course Structure's release controls (spec D6).
import { ApiError, updateTheme, type QuestionWorkspace, type WorkspaceReleaseTheme } from '../../api.js';
import { el } from '../../dom.js';
import { errorState } from '../../ui.js';
import { releaseState, releaseStateText, type ReleaseState } from './questions-model.js';

type Choice = 'now' | 'schedule' | 'hold';

function initialChoice(state: ReleaseState): Choice {
  return state === 'released' ? 'now' : state === 'scheduled' ? 'schedule' : 'hold';
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

interface RowState {
  theme: WorkspaceReleaseTheme;
  choice: Choice;
  date: HTMLInputElement;
  radios: HTMLInputElement[];
}

/** The PATCH value for a row, or `undefined` when nothing changed. Throws a
 * user-facing message for an invalid schedule. */
function patchFor(row: RowState, now: Date): string | null | undefined {
  const state = releaseState(row.theme);
  if (row.choice === 'hold') return state === 'hidden' ? undefined : null;
  if (row.choice === 'now') return state === 'released' ? undefined : now.toISOString();
  const parsed = new Date(row.date.value);
  if (!row.date.value || !Number.isFinite(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
    throw new Error(`Choose a future date and time for ${row.theme.name}.`);
  }
  if (state === 'scheduled' && row.theme.availableFrom && new Date(row.theme.availableFrom).getTime() === parsed.getTime()) return undefined;
  return parsed.toISOString();
}

/** Opens the panel as a modal dialog. `onSaved` runs after at least one
 * Topic was saved (the caller refetches the workspace). `focusThemeId`
 * scrolls a Topic into view (e.g. from the reader's "Release Topic"). */
export function openReleasePanel(release: QuestionWorkspace['release'], onSaved: (message: string) => void, focusThemeId?: string): void {
  const opener = document.activeElement as HTMLElement | null;
  const dialog = el('dialog', { class: 'app-dialog questions-release', 'aria-labelledby': 'questions-release-title' }) as HTMLDialogElement;
  let busy = false;
  const close = (): void => { if (busy) return; dialog.close(); dialog.remove(); opener?.focus(); };
  const errors = el('div', { role: 'alert' });

  const rows: RowState[] = release.themes.map((theme) => {
    const date = el('input', { class: 'input', type: 'datetime-local', 'aria-label': `Release date for ${theme.name}`, value: toLocalInput(theme.availableFrom) }) as HTMLInputElement;
    return { theme, choice: initialChoice(releaseState(theme)), date, radios: [] };
  });

  function rowNode(row: RowState): HTMLElement {
    const name = `release-${row.theme.themeId}`;
    const choice = (value: Choice, label: string): HTMLElement => {
      const radio = el('input', { type: 'radio', name, value, checked: row.choice === value }) as HTMLInputElement;
      radio.addEventListener('change', () => { row.choice = value; row.date.disabled = value !== 'schedule'; });
      row.radios.push(radio);
      return el('label', { class: 'questions-release__choice' }, radio, el('span', { text: label }));
    };
    row.date.disabled = row.choice !== 'schedule';
    const state = releaseState(row.theme);
    return el('fieldset', { class: `questions-release__row is-${state}`, 'data-theme-id': row.theme.themeId },
      el('legend', {}, el('strong', { text: row.theme.name })),
      el('p', { class: 'questions-release__meta', text: `${row.theme.approvedCount} approved · ${releaseStateText(row.theme)}` }),
      el('div', { class: 'questions-release__choices' },
        choice('now', 'Release now'), choice('schedule', 'Schedule'), row.date, choice('hold', 'Keep hidden')));
  }

  const save = el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button' }, 'Save releases') as HTMLButtonElement;
  const cancel = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: close }, 'Cancel') as HTMLButtonElement;
  const setDisabled = (disabled: boolean): void => {
    save.disabled = disabled; cancel.disabled = disabled;
    for (const row of rows) { row.radios.forEach((radio) => { radio.disabled = disabled; }); row.date.disabled = disabled || row.choice !== 'schedule'; }
  };

  save.addEventListener('click', async () => {
    if (busy) return;
    errors.replaceChildren();
    const now = new Date();
    let changes: Array<{ row: RowState; availableFrom: string | null }>;
    try {
      changes = rows.flatMap((row) => {
        const availableFrom = patchFor(row, now);
        return availableFrom === undefined ? [] : [{ row, availableFrom }];
      });
    } catch (error) {
      errors.replaceChildren(errorState((error as Error).message));
      return;
    }
    if (!changes.length) { close(); return; }
    busy = true; setDisabled(true); save.textContent = 'Saving…';
    const failures: string[] = [];
    let saved = 0;
    for (const { row, availableFrom } of changes) {
      try {
        const theme = await updateTheme(row.theme.themeId, { availableFrom }, row.theme.revision);
        row.theme = { ...row.theme, revision: theme.revision ?? row.theme.revision + 1, availableFrom, released: availableFrom !== null && new Date(availableFrom) <= new Date() };
        saved++;
      } catch (error) {
        const message = error instanceof ApiError && error.status === 409
          ? 'changed elsewhere — reload the page and try again'
          : error instanceof Error ? error.message : String(error);
        failures.push(`${row.theme.name}: ${message}`);
      }
    }
    busy = false; setDisabled(false); save.textContent = 'Save releases';
    if (failures.length) {
      // Keep the panel open with the chosen values so nothing is lost.
      errors.replaceChildren(errorState(`${saved ? `Saved ${saved} topic${saved === 1 ? '' : 's'}. ` : ''}Not saved: ${failures.join(' · ')}`));
      if (saved) onSaved(`Release settings saved for ${saved} topic${saved === 1 ? '' : 's'}.`);
      return;
    }
    close();
    onSaved(`Release settings saved for ${saved} topic${saved === 1 ? '' : 's'}.`);
  });

  dialog.append(el('div', { class: 'app-dialog__surface' },
    el('h2', { id: 'questions-release-title', text: 'Manage releases' }),
    el('p', { class: 'muted', text: release.coursePublished
      ? 'Students practise approved questions once every Topic the question is tagged to is released.'
      : 'The course is not published, so students see no questions yet. You can still prepare Topic releases.' }),
    rows.length
      ? el('div', { class: 'questions-release__rows' }, ...rows.map(rowNode))
      : el('p', { text: 'This course has no Topics yet. Add them in Course Structure.' }),
    errors,
    el('footer', { class: 'questions-release__actions' }, cancel, rows.length ? save : false)));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
  if (focusThemeId) {
    const target = dialog.querySelector<HTMLElement>(`[data-theme-id="${CSS.escape(focusThemeId)}"]`);
    target?.scrollIntoView({ block: 'center' });
    target?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
  }
}
