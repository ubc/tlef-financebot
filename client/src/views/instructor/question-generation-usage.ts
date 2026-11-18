import { getContentRunUsage, type ModelCallReceipt, type QuestionDetail } from '../../api.js';
import { el, mount } from '../../dom.js';
import { renderModelCall, renderTokenTotals } from '../../model-usage-ui.js';

const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens'] as const;

function tokenSubtotal(calls: ModelCallReceipt[], field: typeof TOKEN_FIELDS[number]): number | null {
  let subtotal: number | null = null;
  for (const call of calls) {
    const tokens = call.usage[field];
    if (tokens !== null && Number.isSafeInteger(tokens) && tokens >= 0) subtotal = (subtotal ?? 0) + tokens;
  }
  return subtotal;
}

export function questionGenerationUsage(question: QuestionDetail): HTMLElement | false {
  const current = question.current.provenance;
  const origin = current?.kind === 'generated' ? current
    : question.versions.find(version => version.provenance?.kind === 'generated')?.provenance;
  if (origin?.kind !== 'generated') return false;

  const { runId, item } = origin;
  const title = current?.kind === 'generated' ? 'Generation tokens' : 'Original generation tokens';
  const details = el('div', { class: 'question-generation-usage__body', 'aria-live': 'polite' });
  const section = el('section', { class: 'question-generation-usage', 'aria-label': title },
    el('h3', { text: title }), details,
    el('a', { class: 'gw-link', href: `#/instructor/course/${encodeURIComponent(question.courseId)}/preseeding?runId=${encodeURIComponent(runId)}`,
      text: 'View generation task ↗' }));

  async function load(): Promise<void> {
    mount(details, el('p', { class: 'muted', text: 'Loading token usage…' }));
    try {
      const { calls, totalCalls, summary } = await getContentRunUsage(question.courseId, runId);
      const matched = calls.filter(call => call.item === item);
      if (!matched.length) {
        mount(details, el('p', { class: 'muted', text: 'No token usage could be attributed to this question.' }));
        return;
      }
      // Run receipts are bounded. Unassigned or unreturned calls may belong
      // to this item, so known tokens remain a subtotal in those cases.
      const partial = (totalCalls ?? calls.length) > calls.length || summary.untracked || summary.coverageGaps > 0
        || calls.some(call => call.item === undefined)
        || matched.some(call => call.outcome === 'pending' || TOKEN_FIELDS.some(field => call.usage[field] === null));
      mount(details,
        renderTokenTotals({
          inputTokens: tokenSubtotal(matched, 'inputTokens'),
          outputTokens: tokenSubtotal(matched, 'outputTokens'),
          totalTokens: tokenSubtotal(matched, 'totalTokens'),
        }),
        partial ? el('p', { class: 'muted', text: 'Partial usage · known subtotal' }) : false,
        el('details', {}, el('summary', { text: `${matched.length} model ${matched.length === 1 ? 'call' : 'calls'}` }),
          ...matched.map(call => el('details', { class: 'mu-call' },
            el('summary', { text: `${call.stage.replace(/-/g, ' ')} · ${call.actualModel ?? call.requestedModel}` }),
            renderModelCall(call)))));
    } catch {
      mount(details, el('p', { class: 'muted', text: 'Token usage could not load.' }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: load }, 'Retry'));
    }
  }

  if (Number.isSafeInteger(item) && item >= 0) void load();
  else mount(details, el('p', { class: 'muted', text: 'This question has no recorded position in its generation task.' }));
  return section;
}
