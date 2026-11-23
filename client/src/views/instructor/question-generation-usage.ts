import { getQuestionGenerationUsage, type ModelUsageSummary, type QuestionDetail } from '../../api.js';
import { el, mount } from '../../dom.js';
import { renderCostEstimate, renderTokenTotals } from '../../model-usage-ui.js';

function usageTotals(summary: ModelUsageSummary, partial: boolean): HTMLElement {
  const incomplete = partial || summary.status !== 'complete';
  return el('div', {},
    renderTokenTotals(summary),
    renderCostEstimate(summary.cost, incomplete),
    incomplete ? el('p', { class: 'muted', text: 'Partial usage · known subtotal' }) : false);
}

export function questionGenerationUsage(question: QuestionDetail): HTMLElement | false {
  const current = question.current.provenance;
  const origin = current?.kind === 'generated' ? current
    : question.versions.find(version => version.provenance?.kind === 'generated')?.provenance;
  if (!origin && !question.regenerations?.length) return false;

  const title = current?.kind === 'generated' ? 'Generation tokens'
    : origin?.kind === 'generated' ? 'Original generation tokens' : 'Alternative generation tokens';
  const details = el('div', { class: 'question-generation-usage__body', 'aria-live': 'polite' });
  const section = el('section', { class: 'question-generation-usage', 'aria-label': title },
    el('h3', { text: title }), details);

  async function load(): Promise<void> {
    mount(details, el('p', { class: 'muted', text: 'Loading token usage…' }));
    try {
      const { original, alternatives, alternativesPartial } = await getQuestionGenerationUsage(question.id);
      const href = original ? '#/instructor/course/' + encodeURIComponent(question.courseId)
        + '/preseeding?runId=' + encodeURIComponent(original.runId) : null;
      mount(details,
        original ? el('div', {},
          original.wholeTask ? el('p', { class: 'muted', text: 'Whole task usage. A per-question count is unavailable.' }) : false,
          original.summary.reportedCalls ? usageTotals(original.summary, original.partial)
            : el('p', { class: 'muted', text: 'Original generation usage is unavailable.' }),
          href ? el('a', { class: 'gw-link', href, text: 'View generation task ↗' }) : false) : false,
        alternatives?.reportedCalls || alternativesPartial ? el('div', { class: 'mu-alternatives' },
          original ? el('h4', { text: 'Alternative generation' }) : false,
          el('p', { class: 'muted', text: 'Usage across Compare generation requests for this question.' }),
          alternatives?.reportedCalls ? usageTotals(alternatives, alternativesPartial)
            : el('p', { class: 'muted', text: 'Alternative generation usage is unavailable.' })) : false,
        !original && !alternatives?.reportedCalls && !alternativesPartial
          ? el('p', { class: 'muted', text: 'No usage was recorded for this question.' }) : false);
    } catch {
      mount(details, el('p', { class: 'muted', text: 'Token usage could not load.' }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: load }, 'Retry'));
    }
  }

  void load();
  return section;
}
