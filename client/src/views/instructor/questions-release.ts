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
  status: HTMLElement;
}

/** The PATCH value for a row, or `undefined` when nothing changed. Throws a
 * user-facing message for an invalid schedule. */
function patchFor(row: RowState, now: Date): string | null | undefined {
  const state = releaseState(row.theme);
  if (row.choice === 'hold') return state === 'hidden' ? undefined : null;
  if (row.choice === 'now') return state === 'released' ? undefined : now.toISOString();
  if (state === 'scheduled' && row.date.value === toLocalInput(row.theme.availableFrom)) return undefined;
  const parsed = new Date(row.date.value);
  if (!row.date.value || !Number.isFinite(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
    throw new Error(`Choose a future date and time for ${row.theme.name}.`);
  }
  return parsed.toISOString();
}

export function createTopicReleaseEditor(
  release: QuestionWorkspace['release'],
  onSaved: () => Promise<void>,
  onSaving: (busy: boolean) => void,
): HTMLFieldSetElement {
  let busy = false;
  const notice = el('p', { role: 'status', class: 'muted' });
  const errors = el('div', { role: 'alert' });

  const rows: RowState[] = release.themes.map((theme) => {
    const date = el('input', { class: 'input', type: 'datetime-local', 'aria-label': `Release date for ${theme.name}`, value: toLocalInput(theme.availableFrom) }) as HTMLInputElement;
    return { theme, choice: initialChoice(releaseState(theme)), date, status: el('span') };
  });

  function rowNode(row: RowState): HTMLElement {
    const name = `release-${row.theme.themeId}`;
    const nameId = `${name}-name`;
    // The date field only shows (and is only editable) while Schedule is chosen.
    const syncDate = (): void => {
      const scheduling = row.choice === 'schedule';
      row.date.hidden = !scheduling;
      row.date.disabled = !scheduling;
    };
    const choice = (value: Choice, label: string): HTMLElement => {
      const radio = el('input', { type: 'radio', name, value, checked: row.choice === value }) as HTMLInputElement;
      radio.addEventListener('change', () => { row.choice = value; syncDate(); });
      return el('label', { class: 'questions-release__choice' }, radio, el('span', { text: label }));
    };
    syncDate();
    updateStatus(row);
    return el('div', { class: 'questions-release__row', 'data-theme-id': row.theme.themeId },
      el('div', { class: 'questions-release__topic' },
        el('strong', { id: nameId, class: 'questions-release__name', text: row.theme.name }),
        el('span', { class: 'questions-release__meta' },
          `${row.theme.approvedCount} approved`,
          row.status)),
      el('div', { class: 'questions-release__choices', role: 'radiogroup', 'aria-labelledby': nameId },
        choice('now', 'Release now'), choice('schedule', 'Schedule'), choice('hold', 'Keep hidden')),
      row.date);
  }

  function updateStatus(row: RowState): void {
    row.status.className = `questions-release__state is-${releaseState(row.theme)}`;
    row.status.textContent = releaseStateText(row.theme);
  }

  const save = el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button' }, 'Save releases') as HTMLButtonElement;
  const fields = el('fieldset', { class: 'topic-release-editor', 'aria-label': 'Topic release settings' }) as HTMLFieldSetElement;
  save.addEventListener('click', async () => {
    if (busy) return;
    errors.replaceChildren();
    notice.textContent = '';
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
    if (!changes.length) {
      notice.textContent = 'Release settings are up to date.';
      return;
    }
    busy = true;
    fields.disabled = true;
    onSaving(true);
    save.textContent = 'Saving…';
    const failures: string[] = [];
    let saved = 0;
    for (const { row, availableFrom } of changes) {
      try {
        const theme = await updateTheme(row.theme.themeId, { availableFrom }, row.theme.revision);
        row.theme = { ...row.theme, revision: theme.revision ?? row.theme.revision + 1, availableFrom, released: availableFrom !== null && new Date(availableFrom) <= new Date() };
        updateStatus(row);
        saved++;
      } catch (error) {
        const message = error instanceof ApiError && error.status === 409
          ? 'changed elsewhere — reload the page and try again'
          : error instanceof Error ? error.message : String(error);
        failures.push(`${row.theme.name}: ${message}`);
      }
    }
    if (failures.length) {
      errors.replaceChildren(errorState(`Could not save: ${failures.join(' · ')}`));
    }
    if (saved) {
      notice.textContent = `Release settings saved for ${saved} topic${saved === 1 ? '' : 's'}.`;
    }
    try {
      if (saved) await onSaved();
    } finally {
      busy = false;
      fields.disabled = false;
      onSaving(false);
      save.textContent = 'Save releases';
    }
  });

  fields.append(
    rows.length
      ? el('div', { class: 'questions-release__rows' }, ...rows.map(rowNode))
      : el('p', { text: 'Add Topics in Course Structure to set their release dates.' }),
    errors,
    notice,
  );
  if (rows.length) fields.append(el('footer', { class: 'questions-release__actions' }, save));
  return fields;
}
