import { el, mount } from '../../dom.js';
import { currentQuery, type RouteParams } from '../../router.js';
import {
  listAdminQuestions, getAdminQuestion, reproduceAdminQuestion,
  type AdminQuestionDiagnostic, type AdminQuestionRow, type DiagnosticPage, type QuestionReproduction,
} from '../../api.js';
import { errorState, loadingState } from '../../ui.js';
import { renderRichText } from '../../render.js';
import { field, selectFilter, details, outcomeBadge, dateLabel, diagnosticLink, courseLabel, userLabel } from './diagnostic-ui.js';
import { attachTutorial } from '../../tutorials.js';

type InspectorTab = 'Preview' | 'Versions' | 'Flags & attempts' | 'Reproduce';
const states = ['draft', 'pending-review', 'reviewed', 'approved', 'paused', 'archived'];
const message = (error: unknown): string => error instanceof Error ? error.message : 'Unable to load this evidence.';
const rich = (text: string): HTMLElement => { const node = el('div', { class: 'rich-text' }); renderRichText(node, text); return node; };
const label = (value: string): string => value.replace(/-/g, ' ');
const positive = (value: string | null, fallback: number): number => /^\d+$/.test(value || '') && Number(value) > 0 ? Math.min(Number(value), 10000) : fallback;

/** Both legacy deep links and the list render the same workspace. Reproduction is
 * server-owned and read-only: saved attempts always own their version and values. */
async function renderWorkspace(outlet: HTMLElement, initialId?: string): Promise<void> {
  const initial = currentQuery();
  const root = el('div', { class: 'view view--admin diagnostic-view admin-console admin-questions' });
  const metrics = el('div', { class: 'ac-metrics', 'aria-label': 'Question result summary' });
  const results = el('div', { class: 'ac-table-scroll', tabindex: '0', 'aria-label': 'Question results' });
  const footer = el('footer', { class: 'ac-footer' });
  const filterChips = el('div', { class: 'aq-filter-chips' });
  const panel = el('aside', { class: 'ac-panel aq-inspector', 'aria-label': 'Question diagnostics', hidden: true });
  const search = el('input', { class: 'input aq-search', type: 'search', placeholder: 'Search questions, IDs, creators…', 'aria-label': 'Search questions', value: initial.get('q') || '', maxlength: '100' });
  const publication = selectFilter('Publication state', states);
  publication.options[0].text = 'All states';
  publication.value = states.includes(initial.get('state') || '') ? initial.get('state')! : '';
  const filters = { actor: initial.get('actor') || '', courseId: initial.get('courseId') || '' };
  let page = positive(initial.get('page'), 1);
  let limit = [10, 25, 50, 100].includes(Number(initial.get('limit'))) ? Number(initial.get('limit')) : 25;
  let appliedSearch = search.value.trim();
  let listRevision = 0;
  let detailRevision = 0;
  let replayRevision = 0;
  let list: DiagnosticPage<AdminQuestionRow> | undefined;
  let selected = initialId;
  let diagnostic: AdminQuestionDiagnostic | undefined;
  let reproduction: QuestionReproduction | undefined;
  let replayError = '';
  let replayLoading = false;
  let detailError = '';
  let tab: InspectorTab = initial.get('attemptId') ? 'Reproduce' : 'Preview';
  let versionId = initial.get('versionId') || '';
  const requestedSeed = initial.get('seed');
  let seed = requestedSeed && /^-?\d+$/.test(requestedSeed) && Number(requestedSeed) >= -2147483648 && Number(requestedSeed) <= 4294967295 ? requestedSeed : '1';
  let attemptId = initial.get('attemptId') || '';
  let mode: 'seeded' | 'recorded' = attemptId ? 'recorded' : 'seeded';
  let focusedRow: HTMLElement | undefined;
  const filtersButton = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Filters', onclick: showFilters });
  const refresh = el('button', { class: 'btn btn--secondary', text: 'Refresh', onclick: () => loadList() });
  const exportButton = el('button', { class: 'btn btn--secondary', text: 'Export this page', disabled: true, onclick: exportPage });

  function query(includeInspection = true): URLSearchParams {
    const value = new URLSearchParams();
    if (appliedSearch) value.set('q', appliedSearch);
    if (publication.value) value.set('state', publication.value);
    if (filters.actor) value.set('actor', filters.actor);
    if (filters.courseId) value.set('courseId', filters.courseId);
    if (page !== 1) value.set('page', String(page));
    if (limit !== 25) value.set('limit', String(limit));
    if (selected && includeInspection) {
      if (mode === 'recorded' && attemptId) value.set('attemptId', attemptId);
      else {
        if (versionId) value.set('versionId', versionId);
        value.set('seed', seed);
      }
    }
    return value;
  }
  function url(includeInspection = true): string {
    const value = query(includeInspection).toString();
    return `#/admin/questions${selected && includeInspection ? `/${encodeURIComponent(selected)}` : ''}${value ? '?' + value : ''}`;
  }
  function persist(push = false): void {
    if (!root.isConnected) return;
    if (push && location.hash !== url()) history.pushState(null, '', url());
    else history.replaceState(null, '', url());
  }
  function download(name: string, value: string, type: string): void {
    const blob = URL.createObjectURL(new Blob([value], { type }));
    const link = el('a', { href: blob, download: name });
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(blob), 1000);
  }
  function exportPage(): void {
    if (!list) return;
    const csv = (value: unknown): string => '"' + String(value ?? '').replace(/"/g, '""').replace(/^[=+@-]/, "'$&") + '"';
    const rows = [['Question ID', 'Stem', 'State', 'Original creator PUID', 'Course', 'Version', 'Origin', 'Created'], ...list.items.map(item => [item._id, item.stem, item.state, item.creator, courseLabel(item.courseId, list!), item.currentVersion, item.origin?.kind || 'unknown', item.createdAt])];
    download(`questions-page-${page}.csv`, rows.map(row => row.map(csv).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function summary(): void {
    const metric = (value: string | number, name: string, note: string): HTMLElement => el('div', { class: 'ac-metric' }, el('strong', { text: String(value) }), el('span', { text: name }), el('small', { text: note }));
    mount(metrics,
      metric(list?.total ?? '—', 'Matching questions', 'Across the current filters'),
      metric(list?.items.length ?? '—', 'Loaded questions', `Page ${page} · newest first`),
      metric(list ? new Set(list.items.map(item => item.courseId)).size : '—', 'Courses', 'On this page'),
      metric(list?.items.filter(item => item.state === 'pending-review').length ?? '—', 'Pending review', 'On this page'));
  }
  function chips(): void {
    const entries = [['actor', 'Creator', filters.actor], ['courseId', 'Course', filters.courseId]] as const;
    filtersButton.textContent = `Filters${entries.filter(([, , value]) => value).length ? ' · ' + entries.filter(([, , value]) => value).length : ''}`;
    mount(filterChips, ...entries.filter(([, , value]) => value).map(([key, title, value]) => el('button', {
      class: 'btn btn--ghost btn--sm', type: 'button', text: `${title}: ${value} ×`, 'aria-label': `Remove ${title.toLowerCase()} filter`, onclick: () => { filters[key] = ''; page = 1; return loadList(); },
    })));
    filterChips.hidden = !filterChips.childElementCount;
  }
  function showFilters(): void {
    const actor = el('input', { class: 'input', value: filters.actor, placeholder: 'All original creators', maxlength: '128' });
    const course = el('input', { class: 'input', value: filters.courseId, placeholder: 'All courses', pattern: '[a-fA-F0-9]{24}', title: 'Use a 24-character course ID' });
    const dialog = el('dialog', { class: 'aq-filter-dialog', 'aria-labelledby': 'aq-filter-title' });
    const close = (): void => { dialog.close(); dialog.remove(); filtersButton.focus(); };
    mount(dialog, el('form', { class: 'stack', onsubmit: (event: Event) => {
      event.preventDefault(); filters.actor = actor.value.trim(); filters.courseId = course.value.trim(); page = 1; close(); return loadList();
    } }, el('h2', { id: 'aq-filter-title', text: 'Filter questions' }), field('Original creator PUID', actor), field('Course ID', course),
    el('p', { class: 'ac-note', text: 'The creator is the original author or generation requester, even when someone else edits the question.' }),
    el('div', { class: 'ac-actions' }, el('button', { class: 'btn btn--ghost', type: 'button', text: 'Clear filters', onclick: () => { actor.value = ''; course.value = ''; } }),
      el('button', { class: 'btn btn--secondary', type: 'button', text: 'Cancel', onclick: close }), el('button', { class: 'btn btn--primary', type: 'submit', text: 'Apply filters' }))));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    root.append(dialog); dialog.showModal(); actor.focus();
  }
  function table(): void {
    if (!list) return;
    const columns = [['Question', ''], ['State', ''], ['Original creator', 'aq-creator-column'], ['Course', 'aq-course-column'], ['Created', 'aq-date-column']];
    mount(results, list.items.length ? el('table', { class: 'ac-table aq-table' },
      el('thead', {}, el('tr', {}, ...columns.map(([name, className]) => el('th', { scope: 'col', class: className, text: name })))),
      el('tbody', {}, ...list.items.map(item => {
        const inspect = el('button', { class: 'aq-question-link', text: item.stem || 'Current version is missing', 'aria-label': `Inspect question ${item._id}`, onclick: () => { focusedRow = inspect; return openQuestion(item._id); } });
        return el('tr', { class: selected === item._id ? 'is-selected' : undefined },
          el('td', {}, inspect, el('span', { class: 'aq-cell-sub', text: `${item._id} · v${item.currentVersion} · ${label(item.origin?.kind || 'unknown origin')}` })),
          el('td', {}, outcomeBadge(item.state)),
          el('td', { class: 'aq-creator-column' }, el('span', { text: userLabel(item.creator, list!) }), item.agentDecision ? el('span', { class: 'aq-cell-sub', text: `AI review: ${item.agentDecision.decision}` }) : false),
          el('td', { class: 'aq-course-column', title: courseLabel(item.courseId, list!) }, el('span', { text: courseLabel(item.courseId, list!) })),
          el('td', { class: 'aq-date-column', text: dateLabel(item.createdAt) }));
      }))) : el('div', { class: 'aq-empty' }, el('h2', { text: 'No matching questions' }), el('p', { class: 'ac-note', text: 'Try another keyword, creator, course or publication state.' }),
      el('button', { class: 'btn btn--secondary', text: 'Clear all filters', onclick: () => { search.value = ''; publication.value = ''; filters.actor = ''; filters.courseId = ''; page = 1; return loadList(); } })));
    const size = el('select', { class: 'input', 'aria-label': 'Questions per page', onchange: () => { limit = Number(size.value); page = 1; return loadList(); } }, ...[10, 25, 50, 100].map(value => el('option', { value, text: `${value} / page`, selected: value === limit })));
    mount(footer, el('span', { class: 'aq-result-count', role: 'status', text: `${list.items.length ? (page - 1) * limit + 1 : 0}–${Math.min((page - 1) * limit + list.items.length, list.total)} of ${list.total} questions` }), size,
      el('button', { class: 'btn btn--ghost btn--sm', text: 'Previous', 'aria-label': 'Previous result page', disabled: page <= 1, onclick: () => { page--; return loadList(); } }),
      el('span', { text: `${page} / ${Math.max(1, Math.ceil(list.total / limit))}` }),
      el('button', { class: 'btn btn--ghost btn--sm', text: 'Next', 'aria-label': 'Next result page', disabled: page * limit >= list.total, onclick: () => { page++; return loadList(); } }));
  }
  async function loadList(): Promise<void> {
    const own = ++listRevision;
    appliedSearch = search.value.trim();
    persist(); chips();
    list = undefined; summary(); exportButton.disabled = true;
    mount(results, loadingState('Loading all questions…')); mount(footer);
    try {
      const value = await listAdminQuestions({ page, limit, q: appliedSearch, actor: filters.actor, courseId: filters.courseId, state: publication.value });
      if (own !== listRevision || !root.isConnected) return;
      const lastPage = Math.max(1, Math.ceil(value.total / limit));
      if (page > lastPage) { page = lastPage; return loadList(); }
      list = value; summary(); table(); exportButton.disabled = value.items.length === 0;
    } catch (error) {
      if (own !== listRevision || !root.isConnected) return;
      mount(results, errorState(message(error)), el('button', { class: 'btn btn--secondary', text: 'Retry questions', onclick: () => loadList() }));
    }
  }
  function closeInspector(): void {
    selected = undefined; diagnostic = undefined; reproduction = undefined; detailRevision++; replayRevision++; replayLoading = false;
    panel.hidden = true; mount(panel); root.classList.remove('has-inspector'); persist(); table(); focusedRow?.focus();
    if (!focusedRow?.isConnected) search.focus();
  }
  async function openQuestion(id: string, preserve = false): Promise<void> {
    selected = id; diagnostic = undefined; reproduction = undefined; detailError = ''; replayError = ''; replayLoading = false; replayRevision++;
    if (!preserve) { versionId = ''; attemptId = ''; seed = '1'; mode = 'seeded'; tab = 'Preview'; }
    const own = ++detailRevision;
    persist(!preserve); renderInspector(); table();
    panel.querySelector<HTMLButtonElement>('[aria-label="Close question details"]')?.focus();
    try {
      const value = await getAdminQuestion(id);
      if (own !== detailRevision || !root.isConnected || selected !== id) return;
      diagnostic = value;
      // Never silently substitute the current version for a missing deep-linked version.
      if (!versionId) versionId = value.question.currentVersionId;
      persist(); renderInspector();
      await reproduce();
    } catch (error) {
      if (own !== detailRevision || !root.isConnected) return;
      detailError = message(error); renderInspector();
    }
  }
  function context(): HTMLElement {
    if (!diagnostic) return el('div');
    const data = diagnostic;
    const row = list?.items.find(item => item._id === selected);
    const original = [...data.versions].sort((a, b) => a.version - b.version)[0];
    const creator = row?.creator || original?.createdBy;
    return el('div', { class: 'aq-context' },
      el('div', { class: 'ac-actions' }, outcomeBadge(data.question.state), el('span', { class: 'ac-note', text: `Current: v${data.question.currentVersion}` })),
      el('dl', { class: 'aq-properties' }, el('dt', { text: 'Course' }), el('dd', { text: courseLabel(data.question.courseId, data) }),
        el('dt', { text: row?.creator ? 'Original creator' : 'Original version author' }), el('dd', {}, creator ? diagnosticLink(userLabel(creator, row ? list! : data), `#/admin/operations?actor=${encodeURIComponent(creator)}`) : 'Not recorded'),
        el('dt', { text: 'Question ID' }), el('dd', { class: 'mono', text: data.question._id })),
      el('div', { class: 'ac-actions' }, diagnosticLink('Course activity', `#/admin/operations?courseId=${data.question.courseId}`), diagnosticLink('Open course', `#/instructor/course/${data.question.courseId}`)));
  }
  function preview(): HTMLElement {
    if (replayLoading) return loadingState('Reproducing the selected version…');
    if (replayError) return el('div', { class: 'stack' }, errorState(replayError), el('button', { class: 'btn btn--secondary', text: 'Retry reproduction', onclick: () => reproduce() }));
    if (!reproduction) return el('p', { class: 'ac-note', text: 'Select a retained version or recorded attempt to inspect a reproduction.' });
    const result = reproduction;
    return el('section', { class: 'aq-reproduction stack', 'aria-label': 'Question reproduction', 'aria-live': 'polite' },
      el('h3', { text: result.attempt ? 'Recorded attempt replay' : `Version ${result.version.version} · Seed ${result.seed}` }),
      el('p', { class: 'ac-note', text: result.attempt ? 'The recorded attempt supplies its own version and saved parameter values.' : 'Repeatable sample from this pinned version. This sample is not evidence of what a student previously saw.' }),
      result.error ? el('div', { class: 'aq-warning', role: 'alert', text: `Reproduction failed: ${result.error}` }) : false,
      ...result.warnings.map(warning => el('div', { class: 'aq-warning', role: 'status', text: warning })),
      rich(result.rendered.stem), ...result.rendered.options.map(option => el('article', { class: `aq-option${option.role === 'correct' ? ' aq-option--correct' : ''}` },
        el('div', { class: 'aq-option-top' }, el('strong', { text: option.key }), el('span', { class: 'ac-note', text: label(option.role) })), rich(option.text),
        el('details', {}, el('summary', { text: 'Explanation' }), rich(option.explanation)))),
      result.attempt ? el('div', { class: 'aq-warning' }, el('strong', { text: `Recorded selection: ${result.attempt.selectedKey} · ${result.attempt.correct ? 'Correct' : 'Incorrect'}` }),
        el('p', { class: 'ac-note', text: `${userLabel(result.attempt.puid, diagnostic!)} · ${dateLabel(result.attempt.createdAt)}` }), details('Recorded student selection', result.attempt)) : false,
      details('Parameter values used', result.values), details('Version, formulas, verification and source evidence', result.version),
      result.version.provenance?.kind === 'generated' ? diagnosticLink('Generation task', `#/admin/operations/runs/${result.version.provenance.runId}`) : false,
      diagnosticLink('Link to this reproduction', url()));
  }
  function previewRegion(): HTMLElement { return el('div', { class: 'aq-preview-region' }, preview()); }
  function versionHistory(): HTMLElement {
    const data = diagnostic!;
    return el('div', { class: 'stack' }, el('p', { class: 'ac-note', text: 'Inspecting an earlier version does not change the version served to students.' }),
      ...data.versions.map(version => el('article', { class: 'aq-evidence-row' },
        el('div', {}, el('strong', { text: `Version ${version.version}` }), version._id === data.question.currentVersionId ? el('span', { class: 'ac-badge', text: 'Current' }) : false,
          el('span', { class: 'aq-cell-sub', text: `${userLabel(version.createdBy, data)} · ${dateLabel(version.createdAt)}` }),
          el('p', { class: 'ac-note', text: version.editedFields?.length ? `Changed: ${version.editedFields.join(', ')}` : label(version.provenance?.kind || 'Origin not recorded') })),
        el('button', { class: 'btn btn--secondary btn--sm', text: `Inspect v${version.version}`, onclick: () => inspectVersion(version._id) }),
        version.provenance?.kind === 'generated' ? diagnosticLink('Generation task', `#/admin/operations/runs/${version.provenance.runId}`) : false)),
      !data.versions.length && el('p', { text: 'No retained versions.' }), details('Question metadata and internal notes', data.question));
  }
  async function inspectVersion(id: string): Promise<void> {
    versionId = id; mode = 'seeded'; attemptId = ''; tab = 'Preview'; seed = '1'; persist(); await reproduce();
  }
  function flagsAndAttempts(): HTMLElement {
    const data = diagnostic!;
    return el('div', { class: 'stack' }, el('h3', { text: 'Recent flags · latest 20' }),
      ...data.recentFlags.map(flag => el('article', { class: 'aq-evidence-row' }, outcomeBadge(flag.state), el('strong', { text: flag.reason || 'No reason recorded' }),
        el('span', { class: 'aq-cell-sub', text: `${dateLabel(flag.createdAt)} · ${flag._id}` }),
        el('button', { class: 'btn btn--secondary btn--sm', text: 'Inspect flagged version', onclick: () => inspectVersion(flag.questionVersionId) }))),
      !data.recentFlags.length && el('p', { class: 'ac-note', text: 'No flags recorded.' }),
      el('h3', { text: 'Recent student attempts · latest 20' }),
      ...data.recentAttempts.map(attempt => el('article', { class: 'aq-evidence-row' }, el('strong', { text: userLabel(attempt.puid, data) }),
        el('span', { class: 'aq-cell-sub', text: `${dateLabel(attempt.createdAt)} · ${label(attempt.mode)}` }),
        el('p', { class: 'ac-note', text: `Selected ${attempt.selectedKey} · ${attempt.correct ? 'Correct' : 'Incorrect'}` }),
        el('button', { class: 'btn btn--secondary btn--sm', text: 'Replay this attempt', onclick: () => { attemptId = attempt._id; mode = 'recorded'; tab = 'Reproduce'; persist(); return reproduce(); } }))),
      !data.recentAttempts.length && el('p', { class: 'ac-note', text: 'No recorded student attempts. A seeded sample cannot establish historical evidence.' }));
  }
  function reproduceForm(): HTMLElement {
    const data = diagnostic!;
    const evidenceMode = el('select', { class: 'input', onchange: () => { mode = evidenceMode.value as typeof mode; reproduction = undefined; replayError = ''; replayRevision++; replayLoading = false; persist(); renderInspector(); } },
      el('option', { value: 'seeded', text: 'New seeded sample', selected: mode === 'seeded' }), el('option', { value: 'recorded', text: 'Recorded attempt', selected: mode === 'recorded' }));
    const version = el('select', { class: 'input', disabled: mode === 'recorded' }, ...data.versions.map(value => el('option', { value: value._id, text: `Version ${value.version}${value._id === data.question.currentVersionId ? ' · current' : ''}` })));
    if (!data.versions.some(value => value._id === versionId)) version.append(el('option', { value: versionId, text: 'Requested version · unavailable' }));
    version.value = versionId;
    const random = el('input', { class: 'input', type: 'number', value: seed, min: '-2147483648', max: '4294967295', step: '1', required: true, disabled: mode === 'recorded' });
    const attempt = el('input', { class: 'input', value: attemptId, placeholder: 'Recorded attempt ID', pattern: '[a-fA-F0-9]{24}', required: true, disabled: mode !== 'recorded' });
    const invalidate = (): void => { versionId = version.value; seed = random.value; attemptId = attempt.value.trim(); reproduction = undefined; replayError = ''; replayRevision++; replayLoading = false; persist(); const previous = panel.querySelector<HTMLElement>('.aq-preview-region'); if (previous) mount(previous, el('p', { class: 'ac-note', text: 'Inputs changed. Run reproduction to inspect these values.' })); const submit = panel.querySelector<HTMLButtonElement>('.aq-reproduce-form button[type=submit]'); if (submit) submit.disabled = false; };
    version.addEventListener('change', invalidate); random.addEventListener('input', invalidate); attempt.addEventListener('input', invalidate);
    return el('form', { class: 'aq-reproduce-form stack', onsubmit: (event: Event) => { event.preventDefault(); versionId = version.value; seed = random.value; attemptId = attempt.value.trim(); persist(); return reproduce(); } },
      el('p', { class: 'ac-note', text: 'Read-only diagnostics. Reproduction never publishes content, creates a student attempt, or changes mastery.' }),
      field('Evidence mode', evidenceMode), el('div', { class: 'aq-two-fields' }, field('Question version', version), field('Random seed', random)),
      mode === 'recorded' ? field('Recorded attempt ID', attempt) : false,
      mode === 'recorded' ? el('p', { class: 'ac-note', text: 'The attempt supplies its saved version and values; version and seed controls are ignored.' }) : false,
      el('button', { class: 'btn btn--primary', type: 'submit', text: mode === 'recorded' ? 'Replay recorded attempt' : 'Reproduce', disabled: replayLoading }));
  }
  async function reproduce(): Promise<void> {
    if (!selected || !diagnostic) return;
    const own = ++replayRevision;
    const ownId = selected;
    reproduction = undefined; replayError = ''; replayLoading = true; renderInspector();
    try {
      const result = await reproduceAdminQuestion(ownId, mode === 'recorded' ? { attemptId } : { versionId, seed: Number(seed) });
      if (own !== replayRevision || !root.isConnected || ownId !== selected) return;
      reproduction = result; if (result.attempt) versionId = result.version._id; replayLoading = false; persist(); renderInspector();
    } catch (error) {
      if (own !== replayRevision || !root.isConnected || ownId !== selected) return;
      replayLoading = false; replayError = message(error); renderInspector();
    }
  }
  function renderInspector(): void {
    panel.hidden = !selected; root.classList.toggle('has-inspector', !!selected);
    if (!selected) return;
    const active = document.activeElement;
    const restoreFocus = active instanceof HTMLElement && panel.contains(active);
    const activeId = active instanceof HTMLElement ? active.id : '';
    const close = el('button', { class: 'btn btn--ghost btn--sm', text: '×', 'aria-label': 'Close question details', onclick: closeInspector });
    const header = el('header', { class: 'ac-panel-header' }, el('div', {}, el('h2', { text: 'Question diagnostics' }), el('p', { class: 'ac-note mono', text: selected })), close);
    if (!diagnostic) {
      mount(panel, header, el('div', { class: 'ac-panel-body' }, detailError ? el('div', { class: 'stack' }, errorState(detailError), el('button', { class: 'btn btn--secondary', text: 'Retry question details', onclick: () => openQuestion(selected!, true) })) : loadingState('Loading question history…')));
      return;
    }
    const tabs: InspectorTab[] = ['Preview', 'Versions', 'Flags & attempts', 'Reproduce'];
    const tabBar = el('div', { class: 'ac-tabs aq-tabs', role: 'tablist', 'aria-label': 'Question inspector' }, ...tabs.map(name => el('button', {
      class: 'btn btn--ghost btn--sm', role: 'tab', id: `aq-tab-${tabs.indexOf(name)}`, 'aria-controls': 'aq-inspector-content', 'aria-selected': tab === name, tabindex: tab === name ? '0' : '-1', text: name,
      onclick: () => { tab = name; renderInspector(); panel.querySelector<HTMLElement>(`[id="aq-tab-${tabs.indexOf(name)}"]`)?.focus(); },
      onkeydown: (event: KeyboardEvent) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(name) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tab = tabs[index]; renderInspector(); panel.querySelector<HTMLElement>(`[id="aq-tab-${index}"]`)?.focus(); },
    })));
    const body = el('div', { id: 'aq-inspector-content', class: 'ac-panel-body', role: 'tabpanel', 'aria-labelledby': `aq-tab-${tabs.indexOf(tab)}`, tabindex: '0' },
      tab === 'Preview' ? el('div', { class: 'stack' }, context(), diagnostic.question.agentDecision ? details('AI review decision', diagnostic.question.agentDecision) : false, previewRegion()) :
      tab === 'Versions' ? versionHistory() : tab === 'Flags & attempts' ? flagsAndAttempts() : el('div', { class: 'stack' }, reproduceForm(), previewRegion()));
    const foot = el('footer', { class: 'ac-panel-footer' }, el('button', { class: 'btn btn--secondary', text: 'Export evidence', disabled: !diagnostic, onclick: () => download(`question-${selected}-evidence.json`, JSON.stringify({ diagnostic, reproduction: reproduction ?? null }, null, 2), 'application/json') }),
      el('button', { class: 'btn btn--primary', text: tab === 'Reproduce' ? 'Back to preview' : 'Reproduce', onclick: () => { tab = tab === 'Reproduce' ? 'Preview' : 'Reproduce'; renderInspector(); panel.querySelector<HTMLSelectElement>('select')?.focus(); } }));
    const scroll = panel.querySelector('.ac-panel-body')?.scrollTop || 0;
    mount(panel, header, tabBar, body, foot); body.scrollTop = scroll;
    if (restoreFocus) (activeId ? panel.querySelector<HTMLElement>(`[id="${activeId}"]`) : null)?.focus();
    if (restoreFocus && !panel.contains(document.activeElement)) close.focus();
  }
  publication.addEventListener('change', () => { page = 1; void loadList(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && selected && !root.querySelector('dialog[open]')) { event.preventDefault(); closeInspector(); } });
  const toolbar = el('form', { class: 'ac-toolbar', onsubmit: (event: Event) => { event.preventDefault(); page = 1; return loadList(); } }, search, publication,
    el('button', { class: 'btn btn--secondary', type: 'submit', text: 'Search' }), filtersButton, el('span', { class: 'ac-note aq-sort-note', text: 'Newest created first' }));
  const main = el('section', { class: 'ac-main', 'aria-label': 'All question results' }, toolbar, filterChips, results, footer);
  mount(root, el('header', { class: 'ac-header' }, el('div', {}, el('h1', { text: 'All questions' }), el('p', { text: 'Inspect retained questions across every course and publication state.' })), el('div', { class: 'ac-actions' }, refresh, exportButton)), metrics,
    el('div', { class: 'ac-workspace' }, main, panel));
  mount(outlet, root); summary(); chips();
  await Promise.all([loadList(), initialId ? openQuestion(initialId, true) : Promise.resolve()]);
  attachTutorial(root, 'admin-questions', {
    'admin-question-filters': '.ac-toolbar',
    'admin-question-results': '.ac-workspace',
  });
}

export async function renderAdminQuestions(outlet: HTMLElement): Promise<void> { await renderWorkspace(outlet); }
export async function renderAdminQuestionDetail(outlet: HTMLElement, params: RouteParams): Promise<void> { await renderWorkspace(outlet, params.id); }
