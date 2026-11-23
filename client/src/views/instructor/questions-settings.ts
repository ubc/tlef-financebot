// Inspector **Settings** tab (spec D3): difficulty and Topics & LOs, moved
// from Question details. The reader owns saving (busy state, 409 reload,
// workspace refetch); this module only builds the form.
import type { CourseTree, Difficulty, QuestionDetail } from '../../api.js';
import { el } from '../../dom.js';
import { topicNames } from './questions-model.js';
import { addableLoOptions, findLoContext } from './question-tags.js';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export interface SettingsOptions {
  detail: QuestionDetail;
  tree: Pick<CourseTree, 'themes'>;
  /** A save or bulk action is running. */
  busy: boolean;
  /** The reader is in Edit mode: a difficulty save would make the open edit stale. */
  editing: boolean;
  onSaveDifficulty: (difficulty: Difficulty) => void;
  onSaveTags: (tags: { loIds: string[]; themeIds: string[] }) => void;
}

export function settingsPanel(options: SettingsOptions): HTMLElement {
  const { detail, tree } = options;
  const disabled = options.busy || options.editing || detail.state === 'archived';
  const returnsToReview = detail.state === 'approved' || detail.state === 'paused';

  const difficulty = el('select', { class: 'input', 'aria-labelledby': 'questions-settings-difficulty', disabled },
    ...DIFFICULTIES.map((value) => el('option', { value, text: capitalize(value), selected: value === detail.current.difficulty }))) as HTMLSelectElement;
  const saveDifficulty = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: true }, 'Save difficulty') as HTMLButtonElement;
  difficulty.addEventListener('change', () => { saveDifficulty.disabled = disabled || difficulty.value === detail.current.difficulty; });
  saveDifficulty.addEventListener('click', () => options.onSaveDifficulty(difficulty.value as Difficulty));

  const chips = detail.loIds.map((loId) => {
    const context = findLoContext(tree, loId);
    const label = context ? `Topic ${context.themeIndex + 1} › LO ${context.loIndex + 1}: ${context.lo.name}` : 'Removed learning objective';
    return el('li', { class: 'questions-settings__chip' },
      el('span', { text: label }),
      el('button', {
        class: 'questions-settings__remove', type: 'button', disabled, 'aria-label': `Remove ${label}`,
        onclick: () => options.onSaveTags({ loIds: detail.loIds.filter((id) => id !== loId), themeIds: detail.themeIds }),
      }, '×'));
  });

  const addable = addableLoOptions(tree, detail.loIds);
  const picker = el('select', { class: 'input', id: 'questions-settings-add-lo', disabled: disabled || !addable.length },
    el('option', { value: '', text: addable.length ? 'Choose a learning objective…' : 'Every learning objective is tagged' }),
    ...addable.map((option) => el('option', { value: option.id, text: option.label }))) as HTMLSelectElement;
  const add = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: true }, 'Add') as HTMLButtonElement;
  picker.addEventListener('change', () => { add.disabled = disabled || !picker.value; });
  add.addEventListener('click', () => {
    const loId = picker.value;
    if (!loId) return;
    // Tagging an LO also tags its Topic, as Question details always did.
    const themeId = findLoContext(tree, loId)?.theme._id;
    options.onSaveTags({
      loIds: [...detail.loIds, loId],
      themeIds: themeId && !detail.themeIds.includes(themeId) ? [...detail.themeIds, themeId] : detail.themeIds,
    });
  });

  const topics = topicNames(tree, detail.themeIds);
  return el('div', { class: 'questions-settings' },
    options.editing ? el('p', { class: 'questions-settings__note', role: 'status', text: 'Finish or cancel editing first.' }) : false,
    el('section', {},
      el('h3', { id: 'questions-settings-difficulty', text: 'Difficulty' }),
      el('div', { class: 'questions-settings__row' }, difficulty, saveDifficulty),
      returnsToReview ? el('p', { class: 'questions-settings__help', text: 'A new difficulty is a new version: it returns this question to To review.' }) : false),
    el('section', {},
      el('h3', { text: 'Topics' }),
      el('p', { class: topics.length ? '' : 'muted', text: topics.join(', ') || 'No Topic' })),
    el('section', {},
      el('h3', { text: 'Learning objectives' }),
      chips.length ? el('ul', { class: 'questions-settings__chips' }, ...chips) : el('p', { class: 'muted', text: 'No learning objective assigned.' }),
      el('label', { class: 'questions-settings__label', for: 'questions-settings-add-lo', text: 'Add a learning objective' }),
      el('div', { class: 'questions-settings__row' }, picker, add),
      el('p', { class: 'questions-settings__help', text: 'Adding an LO also tags its Topic. Tags do not change the question’s state.' })));
}
