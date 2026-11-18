import { el } from '../../dom.js';
import { renderRichText } from '../../render.js';

export function authoringAnswer(
  option: { key: string; text: string; explanation?: string },
  correct: boolean,
  className = '',
): HTMLElement {
  const answer = el('div');
  renderRichText(answer, option.text);
  const explanation = el('div', { class: 'gw-option-explanation' });
  if (option.explanation) renderRichText(explanation, option.explanation);
  return el('section', {
    class: ['gw-answer', className, correct ? 'is-correct' : ''].filter(Boolean).join(' '),
    'aria-label': `Option ${option.key}${correct ? ', correct answer' : ''}`,
  },
  el('span', { class: 'gw-option-key', text: option.key }),
  el('div', { class: 'gw-option-body' },
    correct ? el('small', { text: 'Correct answer' }) : false,
    answer, option.explanation ? explanation : false));
}
