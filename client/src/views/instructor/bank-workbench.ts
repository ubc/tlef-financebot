import { bankCsv } from '../../bank-csv.js';
import { browseBank, getCourseTree, getQuestion, updateTheme, transitionQuestion, bulkTransition, type BankQuestion, type CourseTree, type CourseTreeTheme } from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import { renderRichText } from '../../render.js';
import { rowStemText } from '../../placeholders.js';
import { currentQuery } from '../../router.js';
import { loadingState, errorState } from '../../ui.js';
import { openBankEditor } from './bank-editor.js';

const rich = (text: string, className = '') => { const node = el('div', { class: className }); renderRichText(node, text); return node; };
type Tab = 'approved' | 'visible' | 'held' | 'paused' | 'archived';
export async function renderBankWorkbench(outlet: HTMLElement, courseId: string): Promise<void> {
  const root = el('div', { class: 'view view--bank-workbench' }); mount(outlet, root); root.append(loadingState('Loading approved questions…'));
  const base = `/instructor/course/${encodeURIComponent(courseId)}`;
  const go = (path: string) => { window.location.hash = `${base}/${path}`; };
  let tree: CourseTree; let rows: BankQuestion[] = []; let tab: Tab = 'approved'; let activeId = ''; let revision = 0; let loadRevision = 0;
  let search = ''; let topic = ''; let loId = currentQuery().get('loId') ?? ''; let type = ''; let difficulty = ''; let changedSource = false;
  let releasesExpanded = false;
  let noticeText = ''; const selected = new Set<string>();
  const tabs = el('nav', { class: 'bank-workbench__tabs', 'aria-label': 'Question status' });
  const releases = el('section', { class: 'bank-releases', 'aria-label': 'Topic releases' });
  const toolbar = el('div', { class: 'bank-workbench__toolbar' });
  const bulk = el('div', { class: 'bank-workbench__bulk', hidden: true });
  const notice = el('div', { class: 'bank-workbench__notice', role: 'status' });
  const collection = el('div', { class: 'bank-workbench__collection' });
  const list = el('div', { class: 'bank-workbench__list' });
  const reader = el('article', { class: 'bank-workbench__reader', 'aria-label': 'Question preview' });
  const workspace = el('section', { class: 'bank-workbench' }, collection, reader);
  const empty = el('section', { class: 'bank-empty', hidden: true });
  const btn = (text: string, onclick: () => void | Promise<void>, primary = false) => el('button', { type: 'button', class: primary ? 'btn btn--instr-primary' : 'btn btn--ghost', onclick }, text);
  function courseOpen(): boolean { return tree.course.published && tree.course.lifecycle !== 'archived'; }
  function heldTopics(q: BankQuestion): CourseTreeTheme[] { return tree.themes.filter(t => q.themeIds.includes(t._id) && (!t.availableFrom || !Number.isFinite(Date.parse(t.availableFrom)) || Date.parse(t.availableFrom) > Date.now())); }
  function available(q: BankQuestion): boolean { return q.state === 'approved' && courseOpen() && q.contentReady === true && !heldTopics(q).length; }
  function status(q: BankQuestion): string { return q.state === 'archived' ? 'Archived' : q.state === 'paused' ? 'Paused' : available(q) ? 'Student-visible' : heldTopics(q).length ? 'Awaiting topic release' : !courseOpen() ? 'Course not published' : q.contentReady === false ? 'Content checks needed' : 'Checking availability'; }
  function onTab(q: BankQuestion, t: Tab): boolean { return t === 'visible' ? available(q) : t === 'held' ? q.state === 'approved' && !available(q) : q.state === t; }
  function objectiveNames(q: BankQuestion): string { return tree.themes.flatMap(t => (t.los ?? []).filter(lo => q.loIds.includes(lo._id)).map(lo => `${t.name} / ${lo.name}`)).join(' · '); }
  function visible(): BankQuestion[] { return rows.filter(q => onTab(q, tab) && (!topic || q.themeIds.includes(topic)) && (!loId || q.loIds.includes(loId)) && (!type || q.current.type === type) && (!difficulty || q.current.difficulty === difficulty) && (!changedSource || q.labels.includes('source-changed')) && `${q.current.stem} ${objectiveNames(q)}`.toLowerCase().includes(search.toLowerCase())); }
  function resetFilters(): void { search = ''; topic = ''; loId = ''; type = ''; difficulty = ''; changedSource = false; tab = 'approved'; selected.clear(); drawToolbar(); draw();
      const active = rows.find(q => q.id === activeId); if (active) void drawReader(active); }
  async function reload(): Promise<void> {
    const request = ++loadRevision;
    try {
      const [nextTree, approved, paused, archived] = await Promise.all([getCourseTree(courseId), browseBank(courseId, { state: 'approved' }), browseBank(courseId, { state: 'paused' }), browseBank(courseId, { state: 'archived' })]);
      if (request !== loadRevision || !root.isConnected) return;
      tree = nextTree; rows = [...approved.questions, ...paused.questions, ...archived.questions].filter(q => ['approved', 'paused', 'archived'].includes(q.state));
      selected.clear(); drawToolbar(); draw();
    } catch (e) { notice.replaceChildren(errorState(e instanceof Error ? e.message : String(e), () => void reload())); }
  }
  function drawToolbar(): void {
    const input = el('input', { type: 'search', class: 'input', 'aria-label': 'Search bank questions', placeholder: 'Search questions or objectives…', value: search, oninput: () => { search = input.value; selected.clear(); draw(); } }) as HTMLInputElement;
    function select(label: string, values: Array<[string, string]>, value: string, change: (value: string) => void) {
      const node = el('select', { class: 'input', 'aria-label': label }, ...values.map(([v, text]) => el('option', { value: v, text, selected: v === value }))) as HTMLSelectElement;
      node.onchange = () => { change(node.value); selected.clear(); draw(); }; return node;
    }
    const filters = el('details', { class: 'bank-workbench__filters' }, el('summary', { text: 'More filters' }),
      select('Learning objective', [['', 'All objectives'], ...tree.themes.flatMap(t => (t.los ?? []).map(lo => [lo._id, lo.name] as [string, string]))], loId, v => { loId = v; }),
      select('Question type', [['', 'All types'], ['mcq', 'Multiple choice'], ['true-false', 'True / false']], type, v => { type = v; }),
      select('Difficulty', [['', 'Any difficulty'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], difficulty, v => { difficulty = v; }),
      el('label', {}, el('input', { type: 'checkbox', checked: changedSource, onchange: (e: Event) => { changedSource = (e.target as HTMLInputElement).checked; selected.clear(); draw(); } }), ' Changed sources'), btn('Clear filters', resetFilters));
    toolbar.replaceChildren(input, select('Topic', [['', 'All topics'], ...tree.themes.map(t => [t._id, t.name] as [string, string])], topic, v => { topic = v; }), filters);
  }
  function drawReleases(): void {
    const releasedCount = tree.themes.filter(t => t.availableFrom && Date.parse(t.availableFrom) <= Date.now()).length;
    const toggle = btn(releasesExpanded ? 'Hide topics ↑' : 'Show topics ↓', () => {
      releasesExpanded = !releasesExpanded; drawReleases();
      releases.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus();
    });
    toggle.setAttribute('aria-expanded', String(releasesExpanded));
    toggle.setAttribute('aria-controls', 'bank-release-topics');
    root.classList.toggle('has-expanded-releases', releasesExpanded);
    releases.replaceChildren(el('div', { class: 'bank-releases__heading' },
      el('div', { class: 'bank-releases__summary' }, el('strong', { text: 'Topic releases' }),
        el('span', { text: tree.themes.length ? `${releasedCount} of ${tree.themes.length} topics released` : 'No topics yet' })), toggle));
    if (!releasesExpanded) return;
    releases.append(el('div', { class: 'bank-releases__topics', id: 'bank-release-topics' }, ...tree.themes.map(t => {
      const date = t.availableFrom ? new Date(t.availableFrom) : null;
      const released = !!date && Number.isFinite(date.getTime()) && date.getTime() <= Date.now();
      return el('button', { type: 'button', class: `bank-release-topic${released ? '' : ' is-held'}`, onclick: () => editRelease(t) }, el('strong', { text: t.name }), el('span', { text: `${rows.filter(q => q.state === 'approved' && q.themeIds.includes(t._id)).length} approved · ${released ? 'Released' : date && Number.isFinite(date.getTime()) ? `Scheduled ${date.toLocaleString()}` : 'Not released'}` }), el('b', { text: released ? 'Manage →' : 'Set release →' }));
    })));
    if (!tree.themes.length) releases.append(el('p', { text: 'Add topics and learning objectives before releasing questions.' }), btn('Open Course Structure', () => go('structure')));
  }
  function dialog(title: string) {
    const d = el('dialog', { class: 'app-dialog bank-topic-dialog', 'aria-label': title }) as HTMLDialogElement;
    d.append(el('h2', { text: title }));
    const close = () => { d.close(); d.remove(); };
    d.addEventListener('cancel', e => { e.preventDefault(); if (d.dataset.busy !== 'true') close(); });
    document.body.append(d); d.showModal(); return { d, close };
  }
  function showTopics(): void {
    if (!tree) return;
    const { d, close } = dialog('Manage topic releases');
    d.append(...tree.themes.map(t => btn(t.name + ' →', () => { close(); editRelease(t); })), btn('Close', close));
  }
  function editRelease(t: CourseTreeTheme): void {
    const { d, close } = dialog('Release topic'); let busy = false;
    let timing = !t.availableFrom ? 'hold' : Date.parse(t.availableFrom) > Date.now() ? 'schedule' : 'now';
    const count = rows.filter(q => q.state === 'approved' && q.themeIds.includes(t._id)).length;
    const date = el('input', { class: 'input', type: 'datetime-local', 'aria-label': 'Release date and time' }) as HTMLInputElement;
    if (t.availableFrom && Number.isFinite(Date.parse(t.availableFrom))) { const value = new Date(t.availableFrom); date.value = new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
    const radios: HTMLInputElement[] = [];
    function choice(value: string, label: string): HTMLElement {
      const radio = el('input', { type: 'radio', name: 'topic-release-timing', value, checked: timing === value }) as HTMLInputElement;
      radio.onchange = () => { timing = value; date.disabled = value !== 'schedule'; };
      radios.push(radio);
      return el('label', { class: 'bank-release-choice' }, radio, el('span', { text: label }));
    }
    const now = choice('now', 'Release now');
    const schedule = choice('schedule', 'Schedule a release');
    const hold = choice('hold', 'Keep hidden from students');
    date.disabled = timing !== 'schedule';
    const errors = el('div');
    const cancel = btn('Close', () => { if (!busy) close(); });
    const save = btn('Save topic release', async () => {
      if (busy) return; errors.replaceChildren();
      try {
        const parsed = new Date(date.value);
        if (timing === 'schedule' && (!date.value || !Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now())) throw new Error('Choose a future date and time.');
        busy = true; d.dataset.busy = 'true'; radios.forEach(r => { r.disabled = true; }); date.disabled = true; cancel.disabled = true;
        await updateTheme(t._id, { availableFrom: timing === 'hold' ? null : timing === 'now' ? new Date().toISOString() : parsed.toISOString() });
        noticeText = `Release settings saved for ${t.name}.`; close(); await reload();
      } catch (e) { errors.replaceChildren(errorState(e instanceof Error ? e.message : String(e))); }
      finally { busy = false; d.dataset.busy = 'false'; radios.forEach(r => { r.disabled = false; }); date.disabled = timing !== 'schedule'; cancel.disabled = false; }
    }, true);
    d.classList.add('bank-release-dialog');
    d.append(el('div', { class: 'bank-release-dialog__topic' }, el('strong', { text: t.name }), el('p', { text: `${count} approved question${count === 1 ? '' : 's'} in this topic` })),
      el('fieldset', { class: 'bank-release-dialog__choices' }, el('legend', { class: 'sr-only', text: 'Release timing' }), now,
        el('p', { class: 'bank-release-dialog__hint', text: courseOpen() ? 'Students can practice approved questions that pass content checks as soon as all their topics are released.' : 'Your course is not published. Releasing this topic does not publish the course.' }), schedule, date, hold),
      errors, el('footer', { class: 'bank-release-dialog__actions' }, cancel, save));
    radios.find(r => r.checked)?.focus();
  }
  async function archive(q: BankQuestion): Promise<void> {
    if (!await confirmDialog({ title: 'Archive question?', message: 'It will leave student practice. Previous versions and student history are retained.', confirmLabel: 'Archive' })) return;
    try { await transitionQuestion(q.id, 'archived', q.current._id); noticeText = 'Question archived.'; await reload(); }
    catch (e) { notice.replaceChildren(errorState(e instanceof Error ? e.message : String(e))); }
  }
  async function restore(q: BankQuestion): Promise<void> {
    if (!await confirmDialog({ title: 'Restore to Review Queue?', message: 'The question returns as a draft and needs approval again.', confirmLabel: 'Restore draft' })) return;
    try { await transitionQuestion(q.id, 'draft', q.current._id); noticeText = 'Draft restored to Review Queue.'; await reload(); }
    catch (e) { notice.replaceChildren(errorState(e instanceof Error ? e.message : String(e))); }
  }
  function draw(): void {
    tabs.replaceChildren(...([['approved', 'All approved'], ['visible', 'Student-visible'], ['held', 'Not yet available'], ['paused', 'Paused'], ['archived', 'Archived']] as Array<[Tab, string]>).map(([value, label]) => el('button', { type: 'button', class: tab === value ? 'is-active' : '', 'aria-pressed': tab === value, onclick: () => { tab = value; selected.clear(); draw(); } }, label, el('span', { text: String(rows.filter(q => onTab(q, value)).length) }))));
    drawReleases(); notice.replaceChildren(...(noticeText ? [el('span', { text: noticeText }), btn('Dismiss', () => { noticeText = ''; notice.replaceChildren(); })] : []));
    const shown = visible(); for (const id of selected) if (!shown.some(q => q.id === id)) selected.delete(id);
    bulk.hidden = selected.size === 0;
    bulk.replaceChildren(el('strong', { text: `${selected.size} selected` }), btn('Archive selected', async () => {
      if (!await confirmDialog({ title: 'Archive selected questions?', message: `${selected.size} questions will leave student practice.`, confirmLabel: 'Archive' })) return;
      try { const { updated } = await bulkTransition([...selected], 'archived'); noticeText = `${updated} questions archived.`; await reload(); }
      catch (e) { notice.replaceChildren(errorState(e instanceof Error ? e.message : String(e))); }
    }), btn('Cancel selection', () => { selected.clear(); draw(); }));
    workspace.hidden = !shown.length; empty.hidden = !!shown.length;
    if (!shown.length) {
      list.replaceChildren(); activeId = ''; revision++; reader.replaceChildren();
      const filtered = !!(search || topic || loId || type || difficulty || changedSource);
      const messages: Record<Tab, [string, string]> = {
        approved: ['Your approved questions belong here', 'Approve questions in Review Queue, then organize and release them here.'],
        visible: ['No student-visible questions yet', 'Release approved questions by topic. The course must also be published and content checks complete.'],
        held: ['Nothing waiting for release', 'Your approved questions are ready for students.'],
        paused: ['No paused questions', 'Questions you pause will appear here. Your approved questions are in All approved.'],
        archived: ['No archived questions', 'Archived questions will appear here, with their versions and history preserved.'],
      };
      const [title, description] = filtered ? ['No matching questions', 'Try a different search or clear your filters to see your approved questions.'] : messages[tab];
      const action = filtered ? btn('Clear filters', resetFilters, true)
        : tab === 'approved' ? btn('Open Review Queue', () => go('queue'), true)
        : tab === 'visible' && rows.some(q => q.state === 'approved') ? btn('Manage topic releases', showTopics, true)
        : btn('View approved questions', resetFilters, true);
      empty.replaceChildren(el('span', { class: 'bank-empty__icon', 'aria-hidden': 'true', text: filtered ? '⌕' : '▤' }),
        el('h2', { text: title }), el('p', { text: description }), el('div', { class: 'bank-empty__actions' }, action));
      return;
    }
    const scroll = list.scrollTop;
    list.replaceChildren(...shown.map((q, i) => el('div', { class: `bank-workbench__item${q.id === activeId ? ' is-current' : ''}` },
      el('input', { type: 'checkbox', 'aria-label': `Select question ${i + 1}`, checked: selected.has(q.id), disabled: q.state === 'archived', onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) selected.add(q.id); else selected.delete(q.id); draw(); } }),
      el('button', { type: 'button', 'aria-pressed': q.id === activeId, onclick: () => { activeId = q.id; draw(); void drawReader(q); } }, el('span', { class: 'bank-workbench__row-stem', text: rowStemText(q) }), el('small', { text: `${i + 1} · ${status(q)} · ${q.current.difficulty}` })))));
    list.scrollTop = scroll;
    const selectAll = el('input', { type: 'checkbox', 'aria-label': 'Select all bank questions', checked: shown.every(q => selected.has(q.id)), disabled: tab === 'archived', onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) shown.filter(q => q.state !== 'archived').forEach(q => selected.add(q.id)); else selected.clear(); draw(); } });
    collection.replaceChildren(el('div', { class: 'bank-workbench__list-head' }, el('label', {}, selectAll, ' Select all'), el('span', { text: `${shown.length} questions` })), list, btn('▦ Question board', () => {
      const { d, close } = dialog('Question board'); d.append(el('div', { class: 'review-question-board__grid' }, ...shown.map((q, i) => el('button', { type: 'button', class: 'review-question-board__square', 'aria-label': `Question ${i + 1}: ${status(q)}`, onclick: () => { activeId = q.id; close(); draw(); void drawReader(q); } }, String(i + 1)))), btn('Close', close));
    }));
    if (!shown.some(q => q.id === activeId)) { activeId = shown[0].id; draw(); void drawReader(shown[0]); }
  }
  async function drawReader(q: BankQuestion): Promise<void> {
    const request = ++revision; reader.replaceChildren(loadingState('Loading question…'));
    try {
      const detail = await getQuestion(q.id); if (request !== revision || !root.isConnected) return;
      if (!['approved', 'paused', 'archived'].includes(detail.state)) { noticeText = 'This question is now in Review Queue.'; await reload(); return; }
      const useSample = detail.current._id === q.current._id ? q.sample : undefined;
      const options = detail.current.options.map(o => ({ ...o, ...(useSample?.options.find(sample => sample.key === o.key) ?? {}) }));
      const reading = el('div', { class: 'bank-workbench__reading' }, el('div', { class: 'bank-workbench__meta', text: `${detail.current.type === 'mcq' ? 'MULTIPLE CHOICE' : 'TRUE / FALSE'} · ${detail.current.difficulty} · Version ${detail.currentVersion}` }), el('p', { class: 'muted', text: objectiveNames(q) }), rich(useSample?.stem ?? detail.current.stem, 'bank-workbench__stem'), ...options.map(o => el('div', { class: `bank-workbench__answer${o.role === 'correct' ? ' is-correct' : ''}` }, el('span', { text: o.key }), el('div', {}, o.role === 'correct' ? el('small', { text: 'Correct answer' }) : false, rich(o.text), rich(o.explanation ?? '', 'bank-workbench__explanation')))));
      reading.append(el('section', { class: 'bank-workbench__availability' }, el('strong', { text: status(q) }), el('p', { text: q.state === 'archived' ? 'Restore this question to review it again.' : heldTopics(q).length ? `Waiting on: ${heldTopics(q).map(t => t.name).join(', ')}. All tagged topics must be released.` : !courseOpen() ? 'Publish the course after completing its checklist.' : q.contentReady === false ? 'This version needs numerical or placeholder checks. Edit the question before approving it again.' : q.contentReady === true ? 'Approval, topic release and content checks are complete.' : 'Refresh to confirm content availability.' }), ...heldTopics(q).map(t => btn(`Release ${t.name} →`, () => editRelease(t), true)), !courseOpen() ? btn('Open course checklist', () => go('')) : false));
      reading.append(el('details', {}, el('summary', { text: 'Source references & version history' }), ...detail.current.sourceRefs.map(ref => el('p', { text: ref.chunk ?? `Source ${ref.materialId}` })), ...detail.versions.map(v => el('p', { text: `Version ${v.version} · ${new Date(v.createdAt).toLocaleString()}` }))));
      reader.replaceChildren(reading, el('footer', { class: 'bank-workbench__footer' }, btn('Open full details', () => go(`bank/${q.id}`)), detail.state === 'archived' ? btn('Restore to review', () => restore(q), true) : btn('Edit question', () => openBankEditor(detail, tree, async () => { noticeText = 'Changes saved. This question is back in Review Queue.'; activeId = ''; await reload(); }), true), detail.state !== 'archived' ? btn('Archive', () => archive(q)) : false));
    } catch (e) { if (request === revision) reader.replaceChildren(errorState(e instanceof Error ? e.message : String(e), () => void drawReader(q))); }
  }
  const portability = el('div', { class: 'cluster bank-portability' }, btn('Import questions', () => go('import')), btn('Export CSV', async () => {
    const exportRows = visible().filter(q => selected.size ? selected.has(q.id) : true);
    if (!await confirmDialog({ title: 'Export questions as CSV?', message: `Export ${exportRows.length} ${selected.size ? 'selected' : 'filtered'} questions. Parameterized questions export as fixed sample questions. Import creates new Drafts; assignments, sources and approval are not copied.`, confirmLabel: 'Export CSV' })) return;
    try { const csv = bankCsv(exportRows); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'question-bank.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { notice.replaceChildren(errorState(e instanceof Error ? e.message : String(e))); }
  }));
  root.replaceChildren(pageHeader('Question Bank', 'Approved questions. Organize, refine, and release by topic.', { text: 'Manage topic releases', onClick: showTopics }), portability, tabs, releases, toolbar, bulk, notice, workspace, empty);
  await reload();
}
