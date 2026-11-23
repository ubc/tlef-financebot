// Inspector **Team** tab (spec D3): TA suggested edits and internal review
// comments, moved from Question details. The reader owns the requests; this
// module builds the cards and the comment form.
import type { CourseTree, QuestionDetail, QuestionSuggestion } from '../../api.js';
import { el } from '../../dom.js';
import { objectiveNames } from './questions-model.js';

export function pendingSuggestions(detail: QuestionDetail): QuestionSuggestion[] {
  return detail.suggestions?.filter((suggestion) => suggestion.status === 'pending') ?? [];
}

/** True when a suggestion changes something the reader's editor can hold. */
export function suggestionEditsText(suggestion: QuestionSuggestion): boolean {
  return suggestion.patch.stem !== undefined || suggestion.patch.options !== undefined;
}

/** One line per field the suggestion changes, in plain words. */
export function suggestionSummary(suggestion: QuestionSuggestion, detail: QuestionDetail, tree: Pick<CourseTree, 'themes'>): string[] {
  const { patch } = suggestion;
  const lines: string[] = [];
  if (patch.stem !== undefined) lines.push(`Stem: ${patch.stem}`);
  for (const option of patch.options ?? []) {
    const before = detail.current.options.find((current) => current.key === option.key);
    if (before?.text !== option.text) lines.push(`Option ${option.key}: ${option.text}`);
    if (before?.explanation !== option.explanation) lines.push(`Option ${option.key} explanation: ${option.explanation}`);
  }
  if (patch.difficulty !== undefined) lines.push(`Difficulty: ${patch.difficulty} (set it in Settings)`);
  if (patch.loIds !== undefined) lines.push(`Learning objectives: ${objectiveNames(tree, patch.loIds).join(', ') || 'none'} (set them in Settings)`);
  return lines.length ? lines : ['No changes recorded.'];
}

export interface TeamOptions {
  detail: QuestionDetail;
  tree: Pick<CourseTree, 'themes'>;
  busy: boolean;
  /** Edit mode exists for this question (not archived). */
  canEdit: boolean;
  onLoad: (suggestion: QuestionSuggestion) => void;
  suggest?: HTMLElement;
  onResolve?: (suggestion: QuestionSuggestion, action: 'accept' | 'discard') => void;
  /** Resolves true when the comment was saved, so the field can clear. */
  onAddNote: (text: string) => Promise<boolean>;
}

export function teamPanel(options: TeamOptions): HTMLElement {
  const { detail, busy } = options;
  const suggestions = options.onResolve ? pendingSuggestions(detail) : detail.suggestions ?? [];
  const cards = suggestions.map((suggestion) => el('article', { class: 'questions-team__card' },
    el('p', { class: 'questions-team__by', text: `${suggestion.puid} · ${new Date(suggestion.at).toLocaleString()}` }),
    el('ul', { class: 'questions-team__changes' }, ...suggestionSummary(suggestion, detail, options.tree).map((line) => el('li', { text: line }))),
    options.onResolve ? el('div', { class: 'questions-team__actions' },
      options.canEdit && suggestionEditsText(suggestion)
        ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: busy, onclick: () => options.onLoad(suggestion) }, 'Load into editor')
        : false,
      el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', disabled: busy, onclick: () => options.onResolve?.(suggestion, 'accept') }, 'Accept exactly'),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: busy, onclick: () => options.onResolve?.(suggestion, 'discard') }, 'Discard')) : el('small', { class: 'muted', text: suggestion.status })));

  const note = el('textarea', { class: 'input', id: 'questions-team-note', rows: '3', placeholder: 'Visible to instructors and TAs only', disabled: busy }) as HTMLTextAreaElement;
  const addNote = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: true }, 'Add comment') as HTMLButtonElement;
  note.addEventListener('input', () => { addNote.disabled = busy || !note.value.trim(); });
  addNote.addEventListener('click', async () => {
    const text = note.value.trim();
    if (!text) return;
    addNote.disabled = true;
    if (await options.onAddNote(text)) note.value = '';
    else addNote.disabled = false;
  });

  return el('div', { class: 'questions-team' },
    el('section', {},
      el('h3', { text: 'TA suggested edits' }),
      options.suggest,
      ...(cards.length ? cards : [el('p', { class: 'muted', text: options.onResolve ? 'No pending TA suggestions.' : 'No suggestions yet.' })])),
    el('section', {},
      el('h3', { text: 'Internal comments' }),
      detail.internalNotes.length
        ? el('ul', { class: 'questions-team__notes' }, ...detail.internalNotes.map((entry) => el('li', {},
          el('p', { text: entry.text }),
          el('small', { text: `${entry.puid} · ${new Date(entry.at).toLocaleDateString()}` }))))
        : el('p', { class: 'muted', text: 'No internal comments yet.' }),
      el('label', { class: 'questions-settings__label', for: 'questions-team-note', text: 'Add a comment' }),
      note,
      el('div', { class: 'questions-team__actions' }, addNote)));
}
