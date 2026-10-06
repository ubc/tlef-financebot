import { el } from './dom.js';
import type { ModelCallReceipt, ModelUsageSummary } from './api.js';
import { tokenCount, usageCoverageLabel, usageCoverageNote } from './model-usage-format.js';

export function renderModelUsage(summary: ModelUsageSummary, compact = false): HTMLElement {
  const totals = el('dl', { class: 'mu-totals' },
    ...([['Input tokens', summary.inputTokens], ['Output tokens', summary.outputTokens], ['Total tokens', summary.totalTokens]] as const)
      .map(([label, value]) => el('div', {}, el('dt', { text: label }), el('dd', { text: tokenCount(value) }))));
  const root = el('section', { class: `model-usage${compact ? ' model-usage--compact' : ''}`, 'aria-label': 'Model token usage' },
    el('h3', { text: 'Model usage' }), el('p', { class: `mu-status mu-status--${summary.status}`, text: usageCoverageLabel(summary) }),
    totals, el('p', { class: 'mu-note', text: usageCoverageNote(summary) }));
  if (summary.untracked) root.append(el('p', { class: 'mu-note', text: 'This operation predates usage tracking or has no confirmed tracking coverage.' }));
  if (summary.coverageGaps) root.append(el('p', { class: 'mu-note', text: `${summary.coverageGaps} recording gaps. These counts do not cover every attempted call.` }));
  if (summary.retryVisibility === 'unknown') root.append(el('p', { class: 'mu-note', text: 'Provider retry visibility is unknown. Counts describe observed calls.' }));
  if (!compact) {
    const breakdown = el('dl', { class: 'mu-breakdown' });
    for (const stage of summary.stages ?? []) breakdown.append(el('dt', { text: stage.stage.replace(/-/g, ' ') }),
      el('dd', { text: `Input ${tokenCount(stage.inputTokens)} · Output ${tokenCount(stage.outputTokens)} · Total ${tokenCount(stage.totalTokens)} · ${stage.observedCalls} calls` }));
    for (const model of summary.models ?? []) breakdown.append(el('dt', { text: `${model.provider} · ${model.model}` }),
      el('dd', { text: `Input ${tokenCount(model.inputTokens)} · Output ${tokenCount(model.outputTokens)} · Total ${tokenCount(model.totalTokens)}` }));
    if (breakdown.children.length) root.append(el('details', {}, el('summary', { text: 'Stage and model breakdown' }), breakdown));
  }
  return root;
}

export function renderModelCalls(calls: ModelCallReceipt[], links = false, contentRunIds: readonly string[] = []): HTMLElement {
  return el('section', { class: 'model-calls', 'aria-label': 'Observed model calls' }, el('h3', { text: 'Observed model calls' }),
    ...calls.map(call => el('details', { class: 'mu-call' },
      el('summary', { text: `${call.stage.replace(/-/g, ' ')} · ${call.actualModel ?? call.requestedModel} · ${call.outcome}` }), renderModelCall(call, links, contentRunIds))),
    !calls.length && el('p', { class: 'mu-note', text: 'No model call receipts available. This does not establish zero consumption.' }));
}

export function renderModelCall(call: ModelCallReceipt, links = false, contentRunIds: readonly string[] = []): HTMLElement {
  const entries: Array<[string, string]> = [
    ['Stage', call.stage], ['Provider', call.provider], ['Requested model', call.requestedModel], ['Actual model', call.actualModel ?? 'Not reported'],
    ['Outcome', call.outcome], ['Started', new Date(call.startedAt).toLocaleString()],
    ['Finished', call.finishedAt ? new Date(call.finishedAt).toLocaleString() : 'Not recorded'],
    ['Input tokens', tokenCount(call.usage.inputTokens)], ['Output tokens', tokenCount(call.usage.outputTokens)], ['Total tokens', tokenCount(call.usage.totalTokens)],
    ['Candidate attempt', call.candidateAttempt === undefined ? 'Not recorded' : String(call.candidateAttempt)],
    ['JSON attempt', call.jsonAttempt === undefined ? 'Not recorded' : String(call.jsonAttempt)],
    ['Provider retries', call.retryVisibility === 'disabled' ? 'Hidden retries disabled' : 'Visibility unknown'], ['Call ID', call._id],
  ];
  if (call.durationMs !== undefined) entries.push(['Duration', `${call.durationMs.toLocaleString()} ms`]);
  if (call.item !== undefined) entries.push(['Item', String(call.item)]);
  if (call.runId) entries.push(['Run ID', call.runId]);
  if (call.operationId) entries.push(['Request ID', call.operationId]);
  const root = el('div', { class: 'mu-call-body' }, el('dl', { class: 'mu-properties' },
    ...entries.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })])));
  if (links) root.append(el('div', { class: 'ac-actions' },
    call.operationId && el('a', { class: 'btn btn--ghost', href: `#/admin/operations/requests/${encodeURIComponent(call.operationId)}`, text: 'Open recorded request' }),
    call.runId && contentRunIds.includes(call.runId) && el('a', { class: 'btn btn--ghost', href: `#/admin/operations/runs/${encodeURIComponent(call.runId)}`, text: 'Open recorded task' })));
  return root;
}
