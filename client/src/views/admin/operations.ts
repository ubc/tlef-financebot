import { el, mount } from '../../dom.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { loadingState, errorState } from '../../ui.js';
import { listAdminOperations, getAdminOperation, listAdminRuns, getAdminRun, listAdminAuditHistory, listAdminModelUsage, listAdminWorkflows,
  type DiagnosticFilters, type DiagnosticRun, type DiagnosticPage, type OperationRecord, type AuditHistoryRecord, type DiagnosticIdentities,
  type ModelUsageSummary, type ModelCallReceipt, type WorkflowGroup, type WorkflowPage } from '../../api.js';
import { field, details, outcomeBadge, dateLabel, diagnosticLink, courseLabel, userLabel } from './diagnostic-ui.js';
import { attachTutorial } from '../../tutorials.js';
import { renderModelUsage, renderModelCalls, renderModelCall } from '../../model-usage-ui.js';
import { tokenCount, usageCoverageLabel, usageCoverageNote } from '../../model-usage-format.js';

type ActivityTab = 'requests' | 'runs' | 'history' | 'usage' | 'workflows';
type Selection = { kind: 'requests' | 'runs'; id: string };
type ActivityRow = { id: string; kind: ActivityTab; outcome: string; title: string; subtitle: string; actor: string; course: string; at: string; duration: string; history?: AuditHistoryRecord; call?: ModelCallReceipt; workflow?: WorkflowGroup };
const tabLabels: Record<ActivityTab, string> = { requests: 'User operations', runs: 'Background tasks', history: 'Change history', usage: 'Model usage', workflows: 'Workflow timeline' };
const isTab = (value: string | null): value is ActivityTab => value !== null && Object.prototype.hasOwnProperty.call(tabLabels, value);
const shortDate = (value: string): string => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const duration = (ms: number): string => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el('a', { href: url, download: name });
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function properties(entries: Array<[string, string]>): HTMLElement {
  return el('dl', { class: 'ac-properties' }, ...entries.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })]));
}
function runLinks(run: DiagnosticRun, params: string, inspectRequest: (id: string) => void): HTMLElement {
  return el('div', { class: 'ac-actions' },
    diagnosticLink('Open course', `#/instructor/course/${run.courseId}`),
    diagnosticLink('User operations', `#/admin/operations?actor=${encodeURIComponent(run.requestedBy)}`),
    run.operationId ? el('a', { class: 'btn btn--ghost', text: 'Originating request', href: `#/admin/operations/requests/${run.operationId}?${params}`, onclick: (event: MouseEvent) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); inspectRequest(run.operationId!); } } }) : false);
}

export function renderAdminOperations(outlet: HTMLElement): Promise<void> { return renderWorkspace(outlet); }
export function renderAdminOperationDetail(outlet: HTMLElement, params: RouteParams): Promise<void> {
  return renderWorkspace(outlet, { kind: params.kind === 'runs' ? 'runs' : 'requests', id: params.id });
}

async function renderWorkspace(outlet: HTMLElement, initialSelection?: Selection): Promise<void> {
  const query = currentQuery();
  const requestedTab = query.get('tab');
  let tab: ActivityTab = isTab(requestedTab) ? requestedTab : initialSelection?.kind ?? 'requests';
  let page = Math.max(1, Math.min(10000, Number(query.get('page')) || 1));
  let total = 0;
  let revision = 0;
  let detailRevision = 0;
  let selected: Selection | undefined = initialSelection;
  let rows: ActivityRow[] = [];
  let monitoring: DiagnosticPage<OperationRecord>['monitoring'];
  let usageSummary: ModelUsageSummary | undefined;
  let usageOperation = query.get('operationId') || '';
  let usageRun = query.get('runId') || '';
  let usagePoll: ReturnType<typeof setTimeout> | undefined;
  let usagePollUntil = 0;
  let workflowLimitations: string[] = [];
  let origin: HTMLElement | undefined;
  const root = el('div', { class: 'view view--admin admin-console diagnostic-view' });
  const search = el('input', { class: 'input', type: 'search', 'aria-label': 'Search activity', maxlength: 100, value: query.get('q') || '', placeholder: 'Search user, action, error or request ID…' });
  const status = el('select', { class: 'input', 'aria-label': 'Outcome' });
  const activity = el('select', { class: 'input', 'aria-label': 'Request scope' }, el('option', { value: 'actions', text: 'Actions & problems' }), el('option', { value: 'all', text: 'Include successful reads' }));
  activity.value = query.get('activity') === 'all' ? 'all' : 'actions';
  let actor = query.get('actor') || '';
  let course = query.get('courseId') || '';
  let from = query.get('from') || '';
  let until = query.get('until') || '';
  const metrics = el('div', { class: 'ac-metrics', 'aria-label': 'Activity summary' });
  const tabs = el('nav', { class: 'ac-tabs', 'aria-label': 'Activity type' });
  const chips = el('div', { class: 'ac-chips' });
  const usageOverview = el('div', { class: 'ac-usage-overview', hidden: true });
  const tableRegion = el('div', { class: 'ac-table-scroll', 'aria-label': 'Activity results', tabindex: 0 });
  const footer = el('div', { class: 'ac-footer' });
  const announcement = el('span', { class: 'ac-page-note', role: 'status' });
  const exportButton = el('button', { class: 'btn btn--secondary', text: 'Export page', disabled: true, onclick: () => {
    const csv = (value: string): string => `"${(/^[=+@\-\t\r]/.test(value) ? "'" : '') + value.replace(/"/g, '""')}"`;
    const values = [['ID', 'Source', 'Outcome', 'Action', 'User', 'Course', 'Time', 'Duration'], ...rows.map(row => [row.id, row.kind, row.outcome, row.title, row.actor, row.course, row.at, row.duration])];
    download(`financebot-${tab}-page-${page}.csv`, '\uFEFF' + values.map(row => row.map(csv).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  } });
  const panel = el('aside', { class: 'ac-panel', hidden: true, 'aria-label': 'Activity inspector' });
  const panelTitle = el('h2', { text: 'Operation details', tabindex: -1 });
  const panelBody = el('div', { class: 'ac-panel-body', tabindex: 0 });
  const panelFooter = el('div', { class: 'ac-panel-footer' });
  const closeButton = el('button', { class: 'btn btn--ghost', text: '×', 'aria-label': 'Close inspector', onclick: () => closePanel() });
  mount(panel, el('header', { class: 'ac-panel-header' }, el('div', {}, el('small', { text: 'RETAINED EVIDENCE' }), panelTitle), closeButton), panelBody, panelFooter);
  function filterParams(): URLSearchParams {
    const params = new URLSearchParams({ tab });
    if (search.value.trim()) params.set('q', search.value.trim());
    if (actor) params.set('actor', actor);
    if (course) params.set('courseId', course);
    if (from) params.set('from', from);
    if (until) params.set('until', until);
    if (tab === 'usage' && usageOperation) params.set('operationId', usageOperation);
    if (tab === 'usage' && usageRun) params.set('runId', usageRun);
    if (status.value && (tab === 'requests' || tab === 'runs')) params.set(tab === 'runs' ? 'status' : 'outcome', status.value);
    if (tab === 'requests') params.set('activity', activity.value);
    if (page > 1) params.set('page', String(page));
    return params;
  }
  function syncURL(): void {
    const path = selected ? `/admin/operations/${selected.kind}/${encodeURIComponent(selected.id)}` : '/admin/operations';
    history.replaceState(null, '', `#${path}?${filterParams()}`);
  }
  function closePanel(updateURL = true): void {
    detailRevision++;
    selected = undefined;
    panel.hidden = true;
    root.classList.remove('has-inspector');
    tableRegion.querySelectorAll('.is-selected').forEach(row => row.classList.remove('is-selected'));
    if (updateURL) syncURL();
    if (origin?.isConnected) origin.focus();
  }
  function renderMetrics(loaded: boolean): void {
    if (tab === 'usage') {
      mount(metrics, ...[['Matching calls', loaded ? total.toLocaleString() : '—'], ['Input tokens', tokenCount(usageSummary?.inputTokens)], ['Output tokens', tokenCount(usageSummary?.outputTokens)], ['Total tokens', tokenCount(usageSummary?.totalTokens)]].map(([label, value]) => el('div', { class: 'ac-metric ac-usage-metric' },
        el('span', { text: label }), el('strong', { text: value }), el('small', { text: label === 'Matching calls' ? 'Across matching pages' : usageSummary?.status === 'complete' ? 'Recorded LLM consumption' : 'Known subtotal when available' }))));
      return;
    }
    if (tab === 'workflows') {
      const entries = rows.flatMap(row => row.workflow?.entries ?? []);
      const values = [total, entries.filter(entry => entry.kind === 'operation').length, entries.filter(entry => entry.kind === 'run').length,
        new Set(entries.flatMap(entry => entry.relations.map(relation => `${relation.requestId}:${relation.runId}`))).size];
      mount(metrics, ...['Matching windows', 'Requests', 'Background tasks', 'Recorded links'].map((label, index) => el('div', { class: 'ac-metric' }, el('span', { text: label }), el('strong', { text: loaded ? String(values[index]) : '—' }), el('small', { text: index ? 'On this page' : 'Within retained scan limits' }))));
      return;
    }
    const counts = [total, rows.filter(row => ['failed', 'partial', 'interrupted'].includes(row.outcome)).length,
      rows.filter(row => ['accepted', 'running', 'queued'].includes(row.outcome)).length,
      rows.filter(row => ['succeeded', 'completed'].includes(row.outcome)).length];
    mount(metrics, ...['Matching records', 'Needs attention', 'Accepted / active', 'Succeeded'].map((label, index) => el('div', { class: 'ac-metric' },
      el('span', { text: label }), el('strong', { text: !loaded || (tab === 'history' && index > 0) ? '—' : counts[index].toLocaleString() }),
      el('small', { text: index === 0 ? 'Across all matching pages' : tab === 'history' ? 'Outcomes not recorded' : index === 2 ? 'On this page · check task outcome' : 'On this page' }))));
  }
  function renderFilters(resetStatus = false): void {
    const selectedStatus = resetStatus ? '' : status.value || query.get(tab === 'runs' ? 'status' : 'outcome') || '';
    const values = tab === 'runs' ? ['failed', 'partial', 'queued', 'running', 'completed'] : ['failed', 'partial', 'interrupted', 'accepted', 'succeeded'];
    mount(status, el('option', { value: '', text: 'All outcomes' }), ...values.map(value => el('option', { value, text: value[0].toUpperCase() + value.slice(1) })));
    status.value = values.includes(selectedStatus) ? selectedStatus : '';
    status.hidden = tab !== 'requests' && tab !== 'runs'; activity.hidden = tab !== 'requests'; search.hidden = tab === 'usage' || tab === 'workflows';
    search.placeholder = tab === 'runs' ? 'Search creator PUID, task, source or error…' : tab === 'history' ? 'Search actor PUID, action or target type…' : 'Search user, action, error or request ID…';
    mount(tabs, ...Object.entries(tabLabels).map(([key, label]) => el('button', { type: 'button', 'aria-current': tab === key ? 'page' : undefined, text: label, onclick: () => {
      if (tab === key) return;
      tab = key as ActivityTab; page = 1; closePanel(false); renderFilters(true); return load(1);
    } })));
  }
  function renderChips(): void {
    const values = [actor && `User: ${actor}`, course && `Course: ${course}`, from && `From: ${dateLabel(from)}`, until && `Until: ${dateLabel(until)}`, tab === 'usage' && usageOperation && `Request: ${usageOperation}`, tab === 'usage' && usageRun && `Task: ${usageRun}`].filter((value): value is string => typeof value === 'string' && value.length > 0);
    mount(chips, ...values.map(text => el('span', { class: 'ac-chip', text })), values.length > 0 && el('button', { class: 'btn btn--ghost', text: 'Clear filters', onclick: () => { actor = course = from = until = usageOperation = usageRun = ''; return load(1); } }));
  }
  function filtersDialog(): void {
    const localValue = (value: string): string => { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''; };
    const actorInput = el('input', { class: 'input', value: actor, maxlength: 128, placeholder: 'Any user' });
    const courseInput = el('input', { class: 'input', value: course, pattern: '[a-fA-F0-9]{24}', title: 'A 24-character course ID', placeholder: 'Any course' });
    const fromInput = el('input', { class: 'input', type: 'datetime-local', value: localValue(from) });
    const untilInput = el('input', { class: 'input', type: 'datetime-local', value: localValue(until) });
    const operationInput = el('input', { class: 'input', value: usageOperation, maxlength: 128, placeholder: 'Any request' });
    const runInput = el('input', { class: 'input', value: usageRun, maxlength: 128, placeholder: 'Any background task' });
    const dialog = el('dialog', { class: 'ac-filter-dialog', 'aria-labelledby': 'ac-filter-title' });
    const validate = (): void => untilInput.setCustomValidity(fromInput.value && untilInput.value && fromInput.value > untilInput.value ? 'End time must be after start time.' : '');
    fromInput.addEventListener('input', validate); untilInput.addEventListener('input', validate);
    dialog.append(el('form', { onsubmit: (event: Event) => { event.preventDefault(); actor = actorInput.value.trim(); course = courseInput.value.trim(); from = fromInput.value ? new Date(fromInput.value).toISOString() : ''; until = untilInput.value ? new Date(untilInput.value).toISOString() : ''; if (tab === 'usage') { usageOperation = operationInput.value.trim(); usageRun = runInput.value.trim(); } dialog.close(); return load(1); } },
      el('h2', { id: 'ac-filter-title', text: 'Filter activity' }), el('div', { class: 'ac-filter-fields' }, field('User PUID', actorInput), field('Course ID', courseInput), field('From (local time)', fromInput), field('Until (local time)', untilInput), tab === 'usage' && field('Request ID', operationInput), tab === 'usage' && field('Task ID', runInput)),
      el('div', { class: 'ac-actions' }, el('button', { type: 'button', class: 'btn btn--secondary', text: 'Cancel', onclick: () => dialog.close() }), el('button', { class: 'btn btn--primary', type: 'submit', text: 'Apply filters' }))));
    dialog.addEventListener('close', () => dialog.remove()); root.append(dialog); dialog.showModal();
  }
  async function healthDialog(): Promise<void> {
    const dialog = el('dialog', { class: 'ac-filter-dialog', 'aria-labelledby': 'ac-health-title' });
    const body = el('div', {}, loadingState('Loading audit status…'));
    dialog.append(el('section', {}, el('h2', { id: 'ac-health-title', text: 'Audit coverage & health' }), body, el('div', { class: 'ac-actions' }, el('button', { class: 'btn btn--secondary', text: 'Close', onclick: () => dialog.close() }))));
    dialog.addEventListener('close', () => dialog.remove()); root.append(dialog); dialog.showModal();
    try {
      if (!monitoring) monitoring = (await listAdminOperations({ limit: 1 })).monitoring;
      if (!dialog.isConnected) return;
      mount(body, properties([['Lost writes', monitoring ? String(monitoring.failedWrites) : 'Unavailable'], ['Pending writes', monitoring ? String(monitoring.pendingWrites) : 'Unavailable'], ['Earliest record', monitoring?.oldestRecordAt ? dateLabel(monitoring.oldestRecordAt) : 'No retained request'], ...(monitoring?.lastFailureAt ? [['Last write failure', dateLabel(monitoring.lastFailureAt)] as [string, string]] : [])]),
        el('p', { text: 'Write counters cover this server process since restart. Request tracking starts with the audit release; older change history covers selected actions only.' }),
        el('p', { text: 'Browser errors are reported when connectivity allows. Successful health checks, session checks, notification polls and live streams are excluded. Accepted requests need their linked background task checked for the final outcome.' }));
    } catch (error) { if (dialog.isConnected) mount(body, errorState((error as Error).message)); }
  }
  function renderTable(): void {
    const headers = [['Outcome', ''], ['Action / resource', ''], ['User', 'ac-hide-xs'], ['Course', 'ac-hide-md ac-hide-panel'], ['Time', 'ac-hide-sm'], ['Duration', 'ac-hide-md ac-hide-panel'], ['', '']];
    const table = el('table', { class: 'ac-table ac-operation-table' }, el('thead', {}, el('tr', {}, ...headers.map(([text, className]) => el('th', { scope: 'col', class: className, text })))));
    table.append(el('tbody', {}, ...rows.map(row => {
      const href = row.kind === 'requests' || row.kind === 'runs' ? `#/admin/operations/${row.kind}/${encodeURIComponent(row.id)}?${filterParams()}` : undefined;
      const open = (event: Event): void => {
        if (event instanceof MouseEvent && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
        event.preventDefault(); origin = event.currentTarget as HTMLElement;
        if (row.history) inspectHistory(row.history);
        else if (row.call) inspectCall(row.call);
        else if (row.workflow) inspectWorkflow(row.workflow);
        else void inspect({ kind: row.kind as Selection['kind'], id: row.id });
      };
      const link = href ? el('a', { href, class: 'ac-cell-primary', title: row.title, text: row.title, onclick: open }) : el('button', { class: 'btn ac-cell-primary', title: row.title, text: row.title, onclick: open });
      return el('tr', { class: selected?.id === row.id ? 'is-selected' : '', 'data-record': row.id },
        el('td', {}, outcomeBadge(row.outcome)), el('td', {}, link, el('span', { class: 'ac-cell-sub', text: row.subtitle, title: row.subtitle })),
        el('td', { class: 'ac-hide-xs' }, el('span', { class: 'ac-row-author', text: row.actor, title: row.actor })),
        el('td', { class: 'ac-hide-md ac-hide-panel', text: row.course, title: row.course }),
        el('td', { class: 'ac-hide-sm', text: shortDate(row.at), title: dateLabel(row.at) }),
        el('td', { class: 'ac-hide-md ac-hide-panel', text: row.duration }),
        el('td', {}, el('button', { class: 'btn ac-row-open', text: '›', 'aria-label': `Inspect ${row.title}`, onclick: open })));
    })));
    mount(tableRegion, rows.length ? table : el('div', { class: 'ac-empty' }, el('h2', { text: 'No matching activity' }), el('p', { text: 'Try another search or clear the filters to see more records.' })));
    mount(footer, el('span', { text: total ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} of ${total.toLocaleString()} records` : '0 records' }),
      el('nav', { class: 'ac-actions', 'aria-label': 'Result pages' }, el('span', { text: `Page ${page} of ${Math.max(1, Math.ceil(total / 25))}` }),
        el('button', { class: 'btn btn--secondary', text: 'Previous', disabled: page <= 1, onclick: () => load(page - 1) }),
        el('button', { class: 'btn btn--secondary', text: 'Next', disabled: page * 25 >= total, onclick: () => load(page + 1) })));
  }
  async function load(nextPage = page, automatic = false): Promise<void> {
    if (usagePoll) clearTimeout(usagePoll);
    usagePoll = undefined;
    if (!automatic) { usageSummary = undefined; usagePollUntil = Date.now() + 60000; }
    const own = ++revision; page = nextPage; rows = []; exportButton.disabled = true; renderMetrics(false); renderChips(); syncURL();
    usageOverview.hidden = true;
    mount(tableRegion, loadingState('Loading activity…')); mount(footer); announcement.textContent = '';
    if (tab === 'workflows' && !actor && !course) {
      total = 0; renderMetrics(true);
      mount(tableRegion, el('div', { class: 'ac-empty' }, el('h2', { text: 'Choose a user or course' }), el('p', { text: 'Open Filters to view a scoped workflow timeline. Time windows group recorded activity; they do not record browser clicks.' })));
      return;
    }
    const filters: DiagnosticFilters = { page, limit: 25, q: search.value.trim(), actor, courseId: course, from, until,
      ...(tab === 'runs' ? { status: status.value } : tab === 'requests' ? { outcome: status.value, activity: activity.value as 'all' | 'actions' } : {}) };
    try {
      let data: DiagnosticPage<OperationRecord> | DiagnosticPage<DiagnosticRun> | DiagnosticPage<AuditHistoryRecord> | DiagnosticPage<ModelCallReceipt> | WorkflowPage;
      let nextRows: ActivityRow[];
      if (tab === 'usage') {
        const result = await listAdminModelUsage({ page, limit: 25, actor, courseId: course, from, until, operationId: usageOperation, runId: usageRun }); data = result;
        if (own !== revision || !root.isConnected) return;
        usageSummary = result.summary;
        nextRows = result.items.map(call => ({ id: call._id, kind: 'usage', outcome: call.outcome, title: `${call.stage} · ${call.actualModel ?? call.requestedModel}`, subtitle: `Input ${tokenCount(call.usage.inputTokens)} · Output ${tokenCount(call.usage.outputTokens)} · Total ${tokenCount(call.usage.totalTokens)}`, actor: call.actor?.displayName || call.actor?.uid || call.actor?.puid || 'Identity unavailable', course: courseLabel(call.courseId, result), at: call.startedAt, duration: call.durationMs === undefined ? '—' : duration(call.durationMs), call }));
      } else if (tab === 'workflows') {
        const result = await listAdminWorkflows({ page, limit: 25, actor, courseId: course, from, until }); data = result;
        if (own !== revision || !root.isConnected) return;
        workflowLimitations = result.limitations;
        nextRows = result.items.map(workflow => ({ id: workflow.id, kind: 'workflows', outcome: 'grouped', title: `Activity window · ${workflow.entries.length} records`, subtitle: `Inferred ${result.windowMinutes}-minute grouping${result.truncated ? ' · bounded results' : ''}`, actor: userLabel(workflow.actorPuid, result), course: courseLabel(workflow.courseId, result), at: workflow.startedAt, duration: duration(Math.max(0, new Date(workflow.endedAt).getTime() - new Date(workflow.startedAt).getTime())), workflow }));
      } else if (tab === 'runs') {
        const result = await listAdminRuns(filters); data = result;
        nextRows = result.items.map(run => ({ id: run._id, kind: 'runs', outcome: run.status, title: run.kind.replace(/-/g, ' '), subtitle: run.error?.message || `${run.stage} · ${run.completedUnits}/${run.totalUnits ?? '?'} completed`, actor: userLabel(run.requestedBy, result), course: courseLabel(run.courseId, result), at: run.createdAt, duration: run.startedAt && run.completedAt ? duration(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) : '—' }));
      } else if (tab === 'history') {
        const result = await listAdminAuditHistory(filters); data = result;
        nextRows = result.items.map(item => ({ id: item._id, kind: 'history', outcome: 'recorded', title: item.action, subtitle: `${item.targetType} · ${item.targetId}`, actor: userLabel(item.actorPuid, result), course: courseLabel(item.courseId, result), at: item.createdAt, duration: '—', history: item }));
      } else {
        const result = await listAdminOperations(filters); data = result;
        nextRows = result.items.map(item => ({ id: item.requestId, kind: 'requests', outcome: item.outcome, title: `${item.method} ${item.route}`, subtitle: item.response.error ? String(item.response.error) : item.requestId, actor: item.actor?.displayName || item.actor?.uid || 'Identity unavailable', course: courseLabel(item.targets.courseId, result), at: item.createdAt, duration: duration(item.durationMs) }));
      }
      if (own !== revision || !root.isConnected) return;
      rows = nextRows; total = data.total;
      if (data.monitoring) monitoring = data.monitoring;
      if (page > 1 && !rows.length) { await load(Math.max(1, Math.ceil(total / 25))); return; }
      renderMetrics(true); renderTable(); exportButton.disabled = rows.length === 0;
      if (tab === 'usage' && usageSummary) {
        usageOverview.hidden = false;
        mount(usageOverview, el('strong', { text: usageCoverageLabel(usageSummary) }), el('p', { text: usageCoverageNote(usageSummary) }),
          usageSummary.retryVisibility === 'unknown' && el('p', { text: 'Provider retry visibility is unknown; these are observed calls.' }));
        if (usageSummary.pendingCalls || usageSummary.status === 'partial' && Date.now() < usagePollUntil) usagePoll = setTimeout(() => { if (root.isConnected && tab === 'usage') void load(page, true); }, 5000);
      }
      announcement.textContent = monitoring?.failedWrites ? `${monitoring.failedWrites} audit writes were lost on this server. Open Audit health for details.` : tab === 'history' ? 'Selected historical changes · records do not establish outcomes for other actions.' : tab === 'usage' ? 'Newest first · totals cover matching recorded calls across pages, subject to reported coverage gaps.' : tab === 'workflows' ? 'Newest first · select a group to inspect recorded operations and inferred relationships.' : 'Newest first · page metrics summarize the visible records · select a row to inspect evidence.';
      if (tab === 'workflows') announcement.textContent = 'Activity is grouped by time. Recorded request/task IDs establish direct links; timing alone does not establish causation.';
    } catch (error) { if (own === revision && root.isConnected) { mount(tableRegion, errorState((error as Error).message, () => { void load(); })); announcement.textContent = 'Activity could not be loaded.'; } }
  }
  function openPanel(title: string): void {
    panel.hidden = false; root.classList.add('has-inspector'); panelTitle.textContent = title;
    mount(panelBody, loadingState('Loading evidence…')); mount(panelFooter); panelTitle.focus();
    for (const row of tableRegion.querySelectorAll('tr[data-record]')) row.classList.toggle('is-selected', row.getAttribute('data-record') === selected?.id);
  }
  function evidenceTabs(sections: Array<[string, () => HTMLElement]>): void {
    const nav = el('nav', { class: 'ac-tabs', 'aria-label': 'Evidence sections' });
    const content = el('div');
    const show = (index: number): void => {
      mount(content, sections[index][1]());
      nav.querySelectorAll('button').forEach((button, at) => button.setAttribute('aria-pressed', String(at === index)));
    };
    nav.append(...sections.map(([label], index) => el('button', { text: label, 'aria-pressed': String(index === 0), onclick: () => show(index) })));
    mount(panelBody, nav, content); show(0);
  }
  function evidenceFooter(snapshot: unknown, filename: string): void {
    mount(panelFooter, el('button', { class: 'btn btn--secondary', text: 'Download evidence', onclick: () => download(`${filename}.json`, JSON.stringify(snapshot, null, 2), 'application/json') }), el('span', { class: 'ac-note', text: 'Read-only inspection' }));
  }
  function usageSection(initial: { modelUsage?: ModelUsageSummary; modelCalls?: ModelCallReceipt[]; modelCallsTotal?: number }, reload: () => Promise<typeof initial>, contentRunIds: readonly string[] = []): HTMLElement {
    const widget = el('section', { class: 'ac-model-usage' });
    const body = el('div');
    let poll: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 60000;
    let refreshing = false;
    const draw = (data: typeof initial): void => {
      mount(body, data.modelUsage ? renderModelUsage(data.modelUsage) : el('p', { class: 'mu-note', text: 'Usage unavailable for this operation.' }),
        renderModelCalls(data.modelCalls ?? [], true, contentRunIds),
        (data.modelCallsTotal ?? 0) > (data.modelCalls?.length ?? 0) && el('p', { class: 'mu-note', text: `Showing ${data.modelCalls?.length ?? 0} of ${data.modelCallsTotal} recent calls. Totals cover all scoped calls.` }));
      if (data.modelUsage && (data.modelUsage.pendingCalls || data.modelUsage.status === 'partial' && Date.now() < deadline)) poll = setTimeout(() => { if (widget.isConnected) void refresh(); }, 5000);
    };
    const refresh = async (): Promise<void> => {
      if (refreshing || !widget.isConnected) return;
      refreshing = true;
      if (poll) clearTimeout(poll);
      try { const next = await reload(); if (widget.isConnected) draw(next); }
      catch { if (widget.isConnected) body.append(el('p', { class: 'mu-note', text: 'Usage could not refresh. Try again when your connection returns.' })); }
      finally { refreshing = false; }
    };
    widget.append(body, el('button', { class: 'btn btn--secondary', text: 'Refresh model usage', onclick: refresh }));
    draw(initial);
    return widget;
  }
  function inspectHistory(item: AuditHistoryRecord): void {
    detailRevision++; selected = undefined; syncURL(); openPanel('Change details');
    mount(panelBody, outcomeBadge('recorded'), el('h3', { text: item.action }), properties([['Recorded', dateLabel(item.createdAt)], ['Actor PUID', item.actorPuid], ['Target type', item.targetType], ['Target ID', item.targetId]]), details('Recorded change', item.detail), el('p', { class: 'ac-note', text: 'This historical record describes a selected change. It does not establish the outcome of unrecorded activity.' }));
    evidenceFooter(item, `change-${item._id}`);
  }
  function inspectCall(call: ModelCallReceipt): void {
    detailRevision++; selected = undefined; syncURL(); openPanel('Model call details');
    mount(panelBody, renderModelCall(call, true), el('p', { class: 'ac-note', text: 'Metadata-only receipt. Prompts and model responses are not included.' }));
    evidenceFooter(call, `model-call-${call._id}`);
  }
  function inspectWorkflow(workflow: WorkflowGroup): void {
    detailRevision++; selected = undefined; syncURL(); openPanel('Workflow timeline');
    mount(panelBody, el('p', { class: 'ac-callout', text: 'Inferred time window. Adjacent requests may describe separate work; this timeline is not a recording of clicks or a proven sequence of causes.' }),
      properties([['User PUID', workflow.actorPuid || 'Identity unavailable'], ['Started', dateLabel(workflow.startedAt)], ['Ended', dateLabel(workflow.endedAt)]]),
      el('ol', { class: 'ac-timeline' }, ...workflow.entries.map(entry => el('li', {}, el('strong', { text: entry.label }), outcomeBadge(entry.outcome), el('small', { text: dateLabel(entry.createdAt) }),
        entry.material && el('p', { text: `Material: ${entry.material.name}` }),
        !entry.material && !!entry.materials?.length && el('p', { text: `Materials: ${entry.materials!.map(material => material.name).join(', ')}` }),
        el('div', { class: 'ac-actions' }, entry.requestId && diagnosticLink('Inspect request', `#/admin/operations/requests/${encodeURIComponent(entry.requestId)}`), entry.runId && diagnosticLink('Inspect task', `#/admin/operations/runs/${encodeURIComponent(entry.runId)}`)),
        ...entry.relations.map(relation => el('p', { class: 'ac-note', text: `Recorded request–task link: ${relation.requestId} → ${relation.runId}` }))))),
      ...workflowLimitations.map(text => el('p', { class: 'ac-note', text })));
    evidenceFooter(workflow, `workflow-${workflow.id}`);
  }
  async function inspect(selection: Selection): Promise<void> {
    const own = ++detailRevision; selected = selection; syncURL(); openPanel(selection.kind === 'runs' ? 'Background task details' : 'Operation details');
    try {
      if (selection.kind === 'runs') {
        const data = await getAdminRun(selection.id);
        if (own !== detailRevision || !root.isConnected) return;
        showRun(data.run, data); evidenceFooter(data, `task-${selection.id}`);
      } else {
        const data = await getAdminOperation(selection.id);
        if (own !== detailRevision || !root.isConnected) return;
        showRequest(data.operation, data.runs, data); evidenceFooter(data, `request-${selection.id}`);
      }
    } catch (error) { if (own === detailRevision && root.isConnected) mount(panelBody, errorState((error as Error).message, () => { void inspect(selection); })); }
  }
  function showRequest(operation: OperationRecord, runs: DiagnosticRun[], usageData: { modelUsage?: ModelUsageSummary; modelCalls?: ModelCallReceipt[]; modelCallsTotal?: number }): void {
    evidenceTabs([
      ['Overview', () => el('div', {}, outcomeBadge(operation.outcome), el('h3', { text: `${operation.method} ${operation.route}` }),
        operation.response.error ? el('div', { class: 'ac-callout ac-callout--danger' }, el('strong', { text: 'Operation failed' }), el('p', { text: String(operation.response.error) })) : false,
        operation.outcome === 'interrupted' && el('div', { class: 'ac-callout ac-callout--warning', text: 'The connection ended before completion was confirmed. This action may already have changed data. Check its linked task or resource before retrying.' }),
        operation.outcome === 'accepted' && el('div', { class: 'ac-callout', text: 'The request was accepted. Check associated background work for its final outcome.' }),
        properties([['User', operation.actor?.displayName || 'Identity unavailable'], ['PUID', operation.actor?.puid || 'Not recorded'], ['Recorded', dateLabel(operation.createdAt)], ['Response', operation.method === 'CLIENT' ? 'Browser report (unverified)' : `HTTP ${operation.statusCode}`], ['Duration', duration(operation.durationMs)]]),
        el('p', { class: 'mono', text: `Request ID: ${operation.requestId}` }), el('h3', { text: 'Related resources' }),
        el('div', { class: 'ac-actions' }, operation.targets.courseId ? diagnosticLink('Open course', `#/instructor/course/${operation.targets.courseId}`) : false,
          operation.targets.questionId ? diagnosticLink('Reproduce question', `#/admin/questions/${operation.targets.questionId}`) : false,
          operation.actor ? diagnosticLink('All user activity', `#/admin/operations?actor=${encodeURIComponent(operation.actor.puid)}`) : false),
        el('h3', { text: 'Associated background work' }), ...runs.map(run => el('a', { class: 'ac-linked', href: `#/admin/operations/runs/${run._id}`, onclick: (event: MouseEvent) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); void inspect({ kind: 'runs', id: run._id }); } } }, el('span', {}, run.kind.replace(/-/g, ' '), el('small', { text: run.stage })), outcomeBadge(run.status))), !runs.length && el('p', { class: 'ac-note', text: 'No linked background task recorded.' }))],
      ['Input & response', () => el('div', {}, details('Targets', operation.targets), details('Recorded input controls', operation.input), details('Outcome and validation details', operation.response), el('p', { class: 'ac-note', text: 'Passwords, tokens, request bodies, uploaded documents and student answers are not copied into request logs. Linked tasks and question versions retain content evidence.' }))],
      ['Model usage', () => usageSection(usageData, () => getAdminOperation(operation.requestId), runs.map(run => run._id))],
    ]);
  }
  function showRun(run: DiagnosticRun, identities: DiagnosticIdentities & { modelUsage?: ModelUsageSummary; modelCalls?: ModelCallReceipt[]; modelCallsTotal?: number }): void {
    evidenceTabs([
      ['Overview', () => el('div', {}, outcomeBadge(run.status), el('h3', { text: run.kind.replace(/-/g, ' ') }), run.error ? el('div', { class: 'ac-callout ac-callout--danger' }, el('strong', { text: `Failed at ${run.error.atStage}` }), el('p', { text: run.error.message }), el('small', { text: run.error.code })) : false,
        properties([['Created by', userLabel(run.requestedBy, identities)], ['Course', courseLabel(run.courseId, identities)], ['Started', dateLabel(run.createdAt)], ['Stage', run.stage], ['Completed', `${run.completedUnits}/${run.totalUnits ?? '?'} units`], ['Task ID', run._id]]), runLinks(run, filterParams().toString(), id => { void inspect({ kind: 'requests', id }); }), details('Warnings', run.warnings), el('p', { class: 'ac-note', text: 'Retained evidence. Viewing this task does not retry it. A new AI execution may produce different results.' }))],
      ['Timeline', () => el('div', {}, el('h3', { text: 'Progress timeline' }), el('ol', { class: 'ac-timeline' }, ...(run.events ?? []).map(event => el('li', {}, el('strong', { text: `${event.stage} · ${event.status}` }), el('p', { text: event.message || `${event.completedUnits}/${event.totalUnits ?? '?'} completed` }), el('small', { text: dateLabel(event.at) })))), !run.events?.length && el('p', { class: 'ac-note', text: 'No retained stage events.' }))],
      ['Evidence', () => el('div', {}, details('Recorded inputs and models', run.input), details('Complete diagnostic snapshot', run))],
      ['Results', () => el('div', {}, el('h3', { text: 'Created questions' }), run.kind === 'question-generation' && run.result ? el('div', { class: 'stack' }, ...run.result.createdQuestionIds.map(id => diagnosticLink(`Inspect ${id}`, `#/admin/questions/${id}`)), !run.result.createdQuestionIds.length && el('p', { text: 'No questions created.' }), details('Item failures', run.result.failures)) : el('p', { class: 'ac-note', text: 'No question-generation result retained.' }), run.kind !== 'question-generation' ? details('Task result', run.kind === 'structure-generation' ? run.structureResult : run.result) : false)],
      ['Model usage', () => usageSection(identities, () => getAdminRun(run._id), [run._id])],
    ]);
  }
  search.addEventListener('input', () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { if (root.isConnected) void load(1); }, 250); });
  let searchTimer: number | undefined;
  status.addEventListener('change', () => { void load(1); });
  activity.addEventListener('change', () => { void load(1); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && !root.querySelector('dialog[open]') && !panel.hidden) { event.preventDefault(); closePanel(); } });
  renderFilters(); renderMetrics(false);
  mount(root, el('header', { class: 'ac-header' }, el('div', {}, el('h1', { text: 'Operations & Issues' }), el('p', { text: 'Trace user activity, inspect failures and follow background work.' })),
    el('div', { class: 'ac-actions' }, el('button', { class: 'btn btn--secondary', text: 'Audit health', onclick: healthDialog }), exportButton)), metrics,
    el('div', { class: 'ac-workspace' }, el('section', { class: 'ac-main', 'aria-label': 'Activity workspace' }, tabs,
      el('form', { class: 'ac-toolbar', role: 'search', onsubmit: (event: Event) => { event.preventDefault(); window.clearTimeout(searchTimer); return load(1); } }, search, status, activity, el('button', { class: 'btn btn--secondary', type: 'button', text: 'Filters', onclick: filtersDialog }), el('button', { class: 'btn btn--ghost', type: 'submit', text: 'Refresh' })), chips, usageOverview, tableRegion, footer)), announcement, panel);
  mount(outlet, root);
  await Promise.all([load(page), initialSelection ? inspect(initialSelection) : Promise.resolve()]);
  const observer = new MutationObserver(() => { if (!root.isConnected) { if (usagePoll) clearTimeout(usagePoll); window.clearTimeout(searchTimer); observer.disconnect(); } });
  observer.observe(outlet, { childList: true });
  attachTutorial(root, 'admin-operations', {
    'admin-operations-filters': '.ac-toolbar',
    'admin-operations-results': '.ac-workspace',
  });
}
