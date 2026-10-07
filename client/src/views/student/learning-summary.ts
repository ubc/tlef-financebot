import { el } from '../../dom.js';

export interface SummaryQuestion {
  title: string;
  loName: string;
  status: string;
  open: () => unknown;
}
const labels: Record<string, string> = {
  correct: 'Correct', incorrect: 'Needs review', skipped: 'Skipped', unanswered: 'Not answered',
  remembered: 'Remembered', learning: 'Still learning', unavailable: 'Unavailable',
};
export function remainingQuestion(status: string) { return status === 'skipped' || status === 'unanswered'; }

/** Summary is a compact question overview, with the same fixed action footer. */
export function renderLearningSummary(root: HTMLElement, input: {
  title: string; context: string; questions: SummaryQuestion[]; footer: HTMLElement;
  errors?: HTMLElement; cards?: boolean;
}) {
  root.classList.add('is-summary');
  const remaining = input.questions.filter(q => remainingQuestion(q.status)).length;
  const correct = input.questions.filter(q => q.status === 'correct' || q.status === 'remembered').length;
  const review = input.questions.filter(q => q.status === 'incorrect' || q.status === 'learning').length;
  const answered = correct + review;
  const metric = (label: string, value: number, tone = '') => el('div', { class: `learning-summary-metric ${tone}` }, el('strong', { text: String(value) }), el('span', { text: label }));
  const heading = el('header', { class: 'learning-summary-header' },
    el('p', { class: 'eyebrow', text: input.context }),
    el('div', { class: 'learning-summary-title' }, el('h1', { text: input.title }),
      el('span', { class: `learning-summary-badge${remaining ? ' has-remaining' : ''}`, text: remaining ? `${remaining} remaining` : answered === input.questions.length && answered > 0 ? 'All answered' : 'Question overview' })),
    el('p', { class: 'muted', text: remaining
      ? 'Skipped questions are still available. Return to them whenever you are ready.'
      : 'Revisit a question below to read your response and its explanation.' }));
  const stats = el('div', { class: 'learning-summary-stats', 'aria-label': 'Question results' },
    metric('Answered', answered), metric(input.cards ? 'Remembered' : 'Correct', correct, 'is-correct'),
    metric(input.cards ? 'Still learning' : 'Needs review', review, 'needs-review'), metric('Not answered', remaining));
  const rows = input.questions.map((q, index) => {
    const status = labels[q.status] ?? 'Unavailable';
    return el('tr', {}, el('td', { class: 'learning-summary-number', text: String(index + 1).padStart(2, '0') }),
      el('td', {}, el('strong', { class: 'learning-summary-question', text: q.title.replace(/[#*_]/g, '').slice(0, 240) }), el('small', { class: 'muted', text: q.loName })),
      el('td', {}, el('span', { class: `learning-summary-status is-${q.status}`, text: status })),
      el('td', {}, el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: q.status === 'unavailable', 'aria-label': `${remainingQuestion(q.status) ? 'Answer' : 'View'} question ${index + 1}`, text: remainingQuestion(q.status) ? 'Answer →' : 'View →', onclick: q.open })));
  });
  const table = el('table', {}, el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: '#' }), el('th', { scope: 'col', text: `Questions · ${input.questions.length}` }), el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Action' }))), el('tbody', {}, ...rows));
  root.replaceChildren(el('section', { class: 'learning-summary' }, heading, stats, el('div', { class: 'learning-summary-list' }, table), ...(input.errors ? [input.errors] : [])), input.footer);
}
