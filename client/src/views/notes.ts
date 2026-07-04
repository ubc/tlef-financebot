// EXAMPLE view (mongodb demo). Safe to delete with the server-side notes example.
// Demonstrates a gated read/write feature: list notes and add one. The endpoints
// are auth-gated, so this only works while signed in.
import { fetchNotes, addNote, type Note } from '../api.js';
import { el } from '../dom.js';
import { badge, eyebrow, loadingState, emptyState, errorState } from '../ui.js';

function noteItem(note: Note): HTMLElement {
  const when = new Date(note.createdAt).toLocaleString();
  return el(
    'li',
    { class: 'note' },
    el('span', { class: 'note__text', text: note.text }),
    el('time', { class: 'note__time mono', dateTime: note.createdAt, text: when }),
  );
}

export function renderNotes(outlet: HTMLElement): void {
  const list = el('ul', { class: 'note-list', 'aria-live': 'polite' });
  const input = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Write a note…',
    autocomplete: 'off',
    'aria-label': 'Note text',
  }) as HTMLInputElement;
  const submit = el('button', { class: 'btn btn--primary', type: 'submit' }, 'Add note');

  const refresh = async (): Promise<void> => {
    list.replaceChildren(loadingState('Loading notes…'));
    try {
      const notes = await fetchNotes();
      list.replaceChildren(
        ...(notes.length ? notes.map(noteItem) : [emptyState('No notes yet. Add the first one above.')]),
      );
    } catch (error) {
      list.replaceChildren(errorState((error as Error).message, () => void refresh()));
    }
  };

  const form = el('form', { class: 'row' }, input, submit) as HTMLFormElement;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    submit.disabled = true;
    try {
      await addNote(text);
      input.value = '';
      await refresh();
    } catch (error) {
      list.replaceChildren(errorState((error as Error).message, () => void refresh()));
    } finally {
      submit.disabled = false;
      input.focus();
    }
  });

  outlet.append(
    el(
      'div',
      { class: 'view' },
      el(
        'div',
        { class: 'view__intro' },
        el('div', { class: 'view__eyebrow-row' }, eyebrow('MongoDB'), badge('DEMO', 'demo')),
        el('h1', { class: 'view__title', text: 'Notes' }),
        el('p', {
          class: 'view__lead',
          text: 'A minimal read/write feature backed by MongoDB. EXAMPLE — safe to delete.',
        }),
      ),
      el('section', { class: 'card' }, el('div', { class: 'card__body' }, form, list)),
    ),
  );

  void refresh();
}
