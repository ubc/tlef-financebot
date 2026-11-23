import { getCourseDashboardMetrics, type CourseDashboardMetrics } from '../../api.js';
import { el, mount } from '../../dom.js';
import { tokenCount } from '../../model-usage-format.js';
import { estimatedUsd, renderCostByModel } from '../../model-usage-ui.js';

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });

function metric(label: string, value: string, note?: string): HTMLElement {
  return el('div', {}, el('dt', { text: label }), el('dd', { text: value }),
    note ? el('dd', { class: 'project-metric-note', text: note }) : false);
}

function studentActivity(data: NonNullable<CourseDashboardMetrics['students']>, courseId: string): HTMLElement {
  return el('div', {},
    el('dl', { class: 'project-metric-values' },
      metric('Enrolled students', data.enrolled.toLocaleString()),
      metric(`Active in last ${data.windowDays} days`, data.active.toLocaleString()),
      metric('Usage rate', data.usageRate === null ? '—' : percent.format(data.usageRate))),
    el('p', { class: 'project-metric-note', text: data.enrolled
      ? 'Active students submitted at least one practice answer in this course.' : 'No students are enrolled yet.' }),
    el('a', { class: 'gw-link', href: `#/instructor/course/${encodeURIComponent(courseId)}/analytics`, text: 'Open Student Analytics →' }));
}

function generationCosts(data: NonNullable<CourseDashboardMetrics['generation']>): HTMLElement {
  const { average, forecast, total } = data;
  const tokens = (value: number | null) => value === null ? 'Token count unavailable' : `${tokenCount(value)} tokens`;
  const alternatives = average?.sampleKind === 'alternative';
  return el('div', {},
    el('dl', { class: 'project-metric-values' },
      metric(total.partial && total.estimatedUsd !== null ? 'Cumulative estimated subtotal' : 'Cumulative estimated spend',
        estimatedUsd(total.estimatedUsd), `${tokens(total.tokens)} across recorded course AI calls`),
      metric('Question generation', tokenCount(data.generationTokens), 'Recorded tokens from generation and Compare'),
      metric(alternatives ? 'Average per alternative' : 'Average per saved question', estimatedUsd(average?.estimatedUsd ?? null),
        average ? tokens(average.tokens) : 'Awaiting a tracked generation run'),
      metric('Estimate for next question', estimatedUsd(forecast.estimatedUsd), tokens(forecast.tokens))),
    el('p', { class: 'project-metric-note', text: `Next question uses ${forecast.generator} for generation and ${forecast.checker} for checking.` }),
    average ? el('p', { class: 'project-metric-note', text: alternatives
      ? `The forecast uses ${average.sampleSize.toLocaleString()} tracked Compare ${average.sampleSize === 1 ? 'alternative' : 'alternatives'} and current uncached rates. Average cost per saved question is unavailable.`
      : `Per-question figures use ${average.sampleSize.toLocaleString()} saved ${average.sampleSize === 1 ? 'question' : 'questions'} from fully tracked tasks. The forecast applies current uncached rates.` }) : false,
    el('p', { class: 'project-metric-note', text: total.partial
      ? 'USD estimates use model rates. Some historical usage or rates are unavailable.'
      : 'USD estimates use the rate for each recorded model.' }),
    renderCostByModel(total));
}

export function courseDashboardMetrics(courseId: string): HTMLElement {
  const studentBody = el('div', { 'aria-live': 'polite' });
  const generationBody = el('div', { 'aria-live': 'polite' });
  const panel = (title: string, id: string, body: HTMLElement) => el('section', { class: 'project-panel', 'aria-labelledby': id },
    el('h2', { id, class: 'section-title project-panel__snapshot-title', text: title }), body);
  const root = el('div', { class: 'project-metrics' },
    panel('Student activity', 'dashboard-student-activity', studentBody),
    panel('AI usage and cost estimates', 'dashboard-ai-usage', generationBody));
  const unavailable = (message: string) => el('div', {}, el('p', { class: 'project-metric-note', text: message }),
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: load }, 'Retry'));

  async function load(): Promise<void> {
    mount(studentBody, el('p', { class: 'project-metric-note', text: 'Loading student activity…' }));
    mount(generationBody, el('p', { class: 'project-metric-note', text: 'Loading AI usage…' }));
    const data = await getCourseDashboardMetrics(courseId).catch(() => null);
    if (!root.isConnected) return;
    mount(studentBody, data?.students ? studentActivity(data.students, courseId) : unavailable('Student activity could not load.'));
    mount(generationBody, data?.generation ? generationCosts(data.generation) : unavailable('AI usage could not load.'));
  }

  void load();
  return root;
}
