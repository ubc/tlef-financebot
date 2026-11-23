import { getAdminAiUsage, type AdminAiUsage } from '../../api.js';
import { el, mount } from '../../dom.js';
import { tokenCount, usageCoverageLabel } from '../../model-usage-format.js';
import { errorState, loadingState } from '../../ui.js';
import { pager } from './diagnostic-ui.js';

type CourseRow = AdminAiUsage['courses'][number];
const number = (value: number | null | undefined) => value == null ? '—' : tokenCount(value);
const compactNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const currency = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 3,
});
const usd = (value: number | null | undefined) => value == null ? '—' : currency.format(value);

function summaryTokens(value: number | null | undefined): string {
  if (value == null || !Number.isSafeInteger(value) || value < 1_000) return number(value);
  if (value >= 1_000_000) return `${compactNumber.format(value / 1_000_000)}M`;
  return `${compactNumber.format(value / 1_000)}K`;
}

function title(row: CourseRow): string {
  return row.name || (row.courseId ? `Course ${row.courseId}` : 'No course assigned');
}

function tile(label: string, value: string, detail: string): HTMLElement {
  return el('div', { class: 'ac-ai-usage__metric' },
    el('dt', { text: label }), el('dd', { text: value }), el('small', { text: detail }));
}

function table(label: string, headers: string[], rows: HTMLElement[]): HTMLElement {
  return el('div', { class: 'ac-ai-usage__table', role: 'region', 'aria-label': label, tabindex: '0' },
    el('table', {},
      el('thead', {}, el('tr', {}, ...headers.map(text => el('th', { scope: 'col', text })))),
      el('tbody', {}, ...rows)));
}

function renderBreakdown(data: AdminAiUsage): HTMLElement {
  const search = el('input', { type: 'search', class: 'input', placeholder: 'Find a course…', 'aria-label': 'Find a course', oninput: () => draw() });
  const sort = el('select', { class: 'input', 'aria-label': 'Sort courses', onchange: () => draw() },
    el('option', { value: 'cost', text: 'Highest cost' }),
    el('option', { value: 'tokens', text: 'Most tokens' }),
    el('option', { value: 'perQuestion', text: 'Highest cost per question' }));
  const body = el('div', {});
  const rank = (row: CourseRow) => (sort.value === 'tokens' ? row.tokens : sort.value === 'perQuestion' ? row.average?.estimatedUsd : row.estimatedUsd) ?? -1;

  function draw(page = 1): void {
    const needle = search.value.trim().toLowerCase();
    const rows = data.courses.filter(row =>
      [row.courseCode, title(row), row.section, row.term].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => rank(b) - rank(a) || title(a).localeCompare(title(b)));
    mount(body, rows.length ? table('Course usage table', [
      'Course', 'Total tokens', 'Est. USD', 'Tokens / question', 'Est. USD / question', 'Sample size',
    ], rows.slice((page - 1) * 25, page * 25).map(row => el('tr', {},
      el('th', { scope: 'row' }, el('strong', { text: title(row) }),
        el('small', { text: [row.courseCode, row.section && `Section ${row.section}`, row.term, row.partial && 'Partial usage'].filter(Boolean).join(' · ') })),
      el('td', { text: number(row.tokens) }), el('td', { text: usd(row.estimatedUsd) }),
      el('td', { text: number(row.average?.tokens) }), el('td', { text: usd(row.average?.estimatedUsd) }),
      el('td', { text: number(row.average?.savedQuestions) }))))
      : el('p', { class: 'ac-ai-usage__empty', text: needle ? 'No courses match this search.' : 'No course usage was recorded in this period.' }),
    rows.length > 25 ? el('div', { class: 'ac-ai-usage__pagination' }, pager(page, rows.length, async next => draw(next))) : false);
  }
  draw();
  return el('section', { class: 'ac-ai-usage__panel', 'aria-labelledby': 'ac-ai-courses' },
    el('div', { class: 'ac-ai-usage__section-head' },
      el('h2', { id: 'ac-ai-courses', text: 'Usage by course' }),
      el('div', { class: 'ac-ai-usage__controls' }, search, sort)), body);
}

function renderResults(data: AdminAiUsage): HTMLElement {
  const { summary, average } = data;
  const { cost } = summary;
  const sample = average ? `${number(average.savedQuestions)} saved draft${average.savedQuestions === 1 ? '' : 's'} in sample` : 'No fully tracked generation sample';
  const metrics = el('dl', { class: 'ac-ai-usage__metrics' },
    tile('Total tokens', summaryTokens(summary.totalTokens), `${summaryTokens(summary.inputTokens)} input · ${summaryTokens(summary.outputTokens)} output`),
    tile(cost.estimatedUsd !== null && (summary.status !== 'complete' || cost.unpricedCalls) ? 'Estimated subtotal · USD' : 'Estimated total · USD',
      usd(cost.estimatedUsd), cost.unpricedCalls ? `${number(cost.unpricedCalls)} calls without an estimate` : usageCoverageLabel(summary)),
    tile('Average tokens / question', summaryTokens(average?.tokens), sample),
    tile('Average cost / question · USD', usd(average?.estimatedUsd), sample));
  const providers = el('section', { class: 'ac-ai-usage__panel', 'aria-labelledby': 'ac-ai-models' },
    el('div', { class: 'ac-ai-usage__section-head' }, el('h2', { id: 'ac-ai-models', text: 'Usage by model' })),
    cost.models.length ? table('Model usage table', ['Model', 'Total tokens', 'Est. USD', 'Unpriced calls'],
      cost.models.map(model => el('tr', {},
        el('th', { scope: 'row' }, el('strong', { text: model.model }), el('small', { text: model.provider })),
        el('td', { text: number(model.tokens) }), el('td', { text: usd(model.estimatedUsd) }),
        el('td', { text: number(model.unpricedCalls) }))))
      : el('p', { class: 'ac-ai-usage__empty', text: 'No model calls were recorded in this period.' }));
  return el('div', { class: 'ac-ai-usage__results' }, metrics,
    el('div', { class: 'ac-ai-usage__coverage' },
      el('strong', { text: data.truncated ? 'Recording limit reached' : usageCoverageLabel(summary) }),
      el('p', { text: `${number(summary.reportedCalls)} of ${number(summary.observedCalls)} observed calls reported token usage.${data.truncated ? ' This view contains the newest retained subset for the selected period.' : ''}` })),
    renderBreakdown(data), providers,
    el('p', { class: 'ac-ai-usage__note', text: 'USD estimates use configured or standard rates for each recorded LLM model. Usage with missing counts or rates can make totals partial. Embeddings and infrastructure are outside this report.' }),
    el('p', { class: 'ac-ai-usage__note', text: 'Per-question averages divide model usage from fully tracked, finished question-generation runs by saved drafts. The sample includes tracked retries and unsuccessful work in those runs. Compare previews and other AI activity appear only in the totals.' }));
}

export function renderAdminAiUsage(outlet: HTMLElement): void {
  const period = el('select', { class: 'input', 'aria-label': 'Reporting period', onchange: () => void load() },
    el('option', { value: '7', text: 'Last 7 days' }),
    el('option', { value: '30', text: 'Last 30 days' }),
    el('option', { value: '90', text: 'Last 90 days' }),
    el('option', { value: '0', text: 'All recorded time', selected: true }));
  const result = el('div', { class: 'ac-ai-usage__body', 'aria-live': 'polite' });
  const root = el('div', { class: 'view admin-console ac-ai-usage' },
    el('header', { class: 'ac-header' },
      el('div', {}, el('h1', { text: 'AI Usage & Cost' }), el('p', { text: 'Monitor recorded model usage and estimated spend across courses.' })),
      el('div', { class: 'ac-ai-usage__controls' }, period,
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Refresh', onclick: () => void load() }))),
    result);
  let revision = 0;

  async function load(): Promise<void> {
    const request = ++revision;
    const days = Number(period.value);
    const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
    mount(result, loadingState('Loading usage…'));
    try {
      const data = await getAdminAiUsage({ from });
      if (request === revision && root.isConnected) mount(result, renderResults(data));
    } catch (error) {
      if (request === revision && root.isConnected) mount(result, errorState(error instanceof Error ? error.message : String(error), () => void load()));
    }
  }
  mount(outlet, root);
  void load();
}
