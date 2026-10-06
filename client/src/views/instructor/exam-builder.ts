import { subscribeExamBuilder, browseBank, getCourseOutline, examBuilderRequest, type BankQuestion, type BuilderDetail, type BuilderExam, type BuilderItem, type BuilderRun, type BuilderSettings, type CourseOutline, type Difficulty, type QuestionType } from '../../api.js';
import { el, mount } from '../../dom.js';
import { renderRichText } from '../../render.js';
import { protectUnsavedChanges, type RouteParams } from '../../router.js';
import { loadingState, errorState } from '../../ui.js';
import { runButtonAction } from '../../action-state.js';

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const rich = (value: string): string => `<div class="eb-rich">${esc(value)}</div>`;
function hydrate(root: HTMLElement): void { root.querySelectorAll<HTMLElement>('.eb-rich').forEach(node => renderRichText(node, node.textContent ?? '')); }
const err = (error: unknown): string => error instanceof Error ? error.message : 'Unable to complete this request.';
const types: QuestionType[] = ['mcq', 'true-false'];
const examTitle = (exam: BuilderExam): string => exam.displayTitle ?? exam.settings.title;
const typeLabel = (type: string): string => type === 'mcq' ? 'MCQ' : 'True / False';

export async function renderExamBuilder(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id, examId = params.examId;
  const root = el('div', { class: 'view exam-builder' }, loadingState('Loading exams…')); mount(outlet, root);
  if (!examId) {
    try {
      const exams = await examBuilderRequest<BuilderExam[]>(courseId);
      if (!root.isConnected) return;
      root.innerHTML = `<div class="eb-heading"><div><p class="eb-eyebrow">ASSESSMENT WORKSPACE</p><h1>Exam Builder</h1><p>Compose, review and publish a Midterm or Final.</p></div><a class="btn btn--secondary" href="#/instructor/course/${courseId}/exam-templates">Legacy Exam Prep</a></div><form class="eb-panel eb-create"><label>Exam title<input name="title" required maxlength="150" placeholder="e.g. Fall midterm"></label><button class="eb-primary" type="submit">Create exam</button></form><div class="eb-catalog">${exams.map(e => `<article class="eb-panel eb-pad"><span class="eb-pill">${e.deletingAt ? 'Deletion interrupted · retry' : e.publicationId ? 'Published revision available' : 'Draft'}</span><h2>${esc(examTitle(e))}</h2><p>${e.settings.kind === 'midterm' ? 'Midterm' : 'Final'} · ${e.settings.purpose} · ${e.settings.durationMinutes} minutes</p><div class="eb-catalog-actions">${e.deletingAt ? '' : `<a class="btn btn--secondary" href="#/instructor/course/${courseId}/exam-builder/${e._id}">Open exam →</a>`}<button type="button" data-catalog-action="rename" data-id="${e._id}" aria-label="Rename ${esc(examTitle(e))}" ${e.deletingAt ? 'disabled' : ''}>Rename</button><button type="button" data-catalog-action="delete" data-id="${e._id}" aria-label="Delete ${esc(examTitle(e))}" ${e.startedAt ? 'disabled title="Students have started this exam"' : ''}>${e.deletingAt ? 'Finish deletion' : 'Delete'}</button></div></article>`).join('') || '<p class="muted">No exams yet. Create a draft to select questions from this course.</p>'}</div><p class="eb-error" role="alert"></p>`;
      root.addEventListener('click', event => {
        const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-catalog-action]');
        if (!action || action.disabled) return;
        const exam = exams.find(row => row._id === action.dataset.id); if (!exam) return;
        const deleting = action.dataset.catalogAction === 'delete';
        root.querySelector('dialog')?.remove();
        const title = examTitle(exam);
        const modal = el('dialog', { class: 'eb-dialog', 'aria-label': deleting ? `Delete ${title}` : `Rename ${title}`, html: `<form class="eb-catalog-form"><div class="eb-dialog-head"><h2>${deleting ? 'Delete exam' : 'Rename exam'}</h2><button type="button" data-close aria-label="Close dialog">×</button></div><div class="eb-dialog-body"><p><strong>${esc(title)}</strong></p>${deleting ? `<p>This permanently deletes the exam, its generated candidates and publication. Students cannot start it afterward.</p><label>Type the exam title to confirm<input name="confirmation" required autocomplete="off" aria-label="Type the exam title to confirm"></label>` : `<label>New exam title<input name="title" required maxlength="150" value="${esc(title)}" aria-label="New exam title"></label>`}<p class="eb-error" role="alert"></p></div><div class="eb-dialog-foot"><button type="button" data-close>Cancel</button><button class="${deleting ? 'eb-danger' : 'eb-primary'}" type="submit">${deleting ? 'Delete exam' : 'Save name'}</button></div></form>` });
        root.append(modal); modal.showModal();
        modal.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => modal.close()));
        modal.querySelector('form')!.addEventListener('submit', submit => {
          submit.preventDefault();
          const form = submit.currentTarget as HTMLFormElement;
          const fields = new FormData(form);
          if (deleting && fields.get('confirmation') !== title) { modal.querySelector<HTMLElement>('.eb-error')!.textContent = 'Enter the exact exam title to delete it.'; return; }
          const nextTitle = String(fields.get('title') ?? '').trim();
          void runButtonAction(form.querySelector<HTMLButtonElement>('button[type="submit"]')!, async () => {
            try {
              await examBuilderRequest(courseId, `/${exam._id}${deleting ? '' : '/title'}`, deleting ? 'DELETE' : 'PUT', deleting ? { revision: exam.revision } : { revision: exam.revision, title: nextTitle });
              if (root.isConnected) void renderExamBuilder(outlet, params);
            } catch (error) { modal.querySelector<HTMLElement>('.eb-error')!.textContent = err(error); }
          });
        });
        modal.querySelector<HTMLInputElement>('input')?.focus();
      });
      root.querySelector('form')!.addEventListener('submit', event => {
        event.preventDefault(); const form = event.target as HTMLFormElement;
        void runButtonAction(form.querySelector('button')!, async () => {
          try { const created = await examBuilderRequest<BuilderExam>(courseId, '', 'POST', { title: new FormData(form).get('title') }); if (root.isConnected) window.location.hash = `/instructor/course/${courseId}/exam-builder/${created._id}`; }
          catch (error) { root.querySelector('.eb-error')!.textContent = err(error); }
        });
      });
    } catch (error) { if (root.isConnected) root.replaceChildren(errorState(err(error), () => void renderExamBuilder(outlet, params))); }
    return;
  }
  let detail: BuilderDetail, outline: CourseOutline, bank: BankQuestion[] = [];
  let tab: 'questions' | 'review' | 'publish' = 'questions', source = 'bank', search = '', loFilter = '', status = 'approved';
  let settingsDraft: BuilderSettings | undefined, dirty = false, busy = false, message = '', connected = false, pendingSnapshot: BuilderDetail | undefined;
  const selected = new Set<string>();
  const gen = { loIds: [] as string[], types: ['mcq'] as QuestionType[], count: 4, difficulty: 'medium' as Difficulty, prompt: '' };
  const api = <T>(suffix = '', method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown) => examBuilderRequest<T>(courseId, `/${examId}${suffix}`, method, body);
  const allLos = () => outline.themes.flatMap(theme => theme.los.map(lo => ({ ...lo, topic: theme.name })));
  const loName = (id: string) => allLos().find(lo => lo._id === id)?.name ?? 'Unavailable objective';
  const locked = () => detail.exam.publishedRevision === detail.exam.revision;
  function showError(error: unknown): void { message = err(error); const slot = root.querySelector('.eb-message'); if (slot) { slot.textContent = message; slot.removeAttribute('hidden'); } }
  function dialog(title: string, body: string, actions = ''): HTMLDialogElement {
    root.querySelector('dialog')?.remove();
    const node = el('dialog', { class: 'eb-dialog', 'aria-label': title, html: `<div class="eb-dialog-head"><h2>${esc(title)}</h2><button data-action="close" aria-label="Close dialog">×</button></div><div class="eb-dialog-body">${body}</div><div class="eb-dialog-foot">${actions || '<button data-action="close">Close</button>'}</div>` });
    root.append(node); hydrate(node); if (root.isConnected) node.showModal(); return node;
  }
  async function load(): Promise<void> {
    const result = await api<BuilderDetail>(); if (!root.isConnected) return;
    detail = result; if (!dirty) settingsDraft = { ...structuredClone(detail.exam.settings), title: examTitle(detail.exam) };
  }
  function acceptSnapshot(next: BuilderDetail): void {
    if (!root.isConnected) return;
    if (busy) { pendingSnapshot = next; return; }
    if (next.exam.revision < detail.exam.revision) return;
    const changed = JSON.stringify(next.candidates) !== JSON.stringify(detail.candidates);
    detail.runs = next.runs; detail.candidates = next.candidates;
    // Keep the original revision while settings are dirty so concurrent changes
    // cause a conflict instead of silently overwriting another author's settings.
    if (!dirty && !root.querySelector('.eb-paper input:focus')) {
      const paperChanged = JSON.stringify(detail.exam) !== JSON.stringify(next.exam);
      detail.exam = next.exam; settingsDraft = { ...structuredClone(next.exam.settings), title: examTitle(next.exam) };
      if (paperChanged) { renderPaper(); renderMeta(); }
    }
    renderRunArea();
    if (changed) renderCandidates();
  }
  function connectStream(): void {
    const close = subscribeExamBuilder(courseId, examId, {
      onSnapshot: acceptSnapshot,
      onConnection: value => { connected = value; if (root.isConnected) renderRunArea(); },
      onUnavailable: () => { if (root.isConnected) window.location.hash = `/instructor/course/${courseId}/exam-builder`; },
    });
    const observer = new MutationObserver(() => { if (!root.isConnected) { close(); observer.disconnect(); } });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  async function mutate(suffix: string, body: object = {}, method: 'POST' | 'PUT' = 'POST'): Promise<void> {
    await api(suffix, method, { revision: detail.exam.revision, ...body }); await load(); if (root.isConnected) render();
  }
  const button = (label: string, action: string, id = '', disabled = false) => `<button data-action="${action}" data-id="${esc(id)}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  function renderMeta(): void {
    const node = root.querySelector('.eb-meta'); if (!node) return;
    const heading = root.querySelector('.eb-title'); if (heading) heading.textContent = examTitle(detail.exam);
    node.innerHTML = `<span class="eb-pill">${locked() ? 'Published · locked' : 'Draft'}</span><span>${detail.exam.settings.kind} · ${detail.exam.items.length} questions · ${detail.exam.items.reduce((n, i) => n + i.points, 0)} points</span><span class="eb-muted">Revision ${detail.exam.revision}</span>`;
  }
  function render(): void {
    if (!root.isConnected) return;
    root.innerHTML = `<div class="eb-heading"><div><a href="#/instructor/course/${courseId}/exam-builder" class="eb-back">← All exams</a><h1 class="eb-title">${esc(examTitle(detail.exam))}</h1><p>Build a paper from your course. Review every question before publication.</p></div><div class="eb-actions">${button('Student preview', 'preview')}${button('Duplicate exam', 'duplicate')}</div></div><div class="eb-meta"></div><div class="eb-message eb-notice eb-warn" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</div><div class="eb-tabs">${(['questions', 'review', 'publish'] as const).map((t, i) => `<button data-tab="${t}" class="${tab === t ? 'active' : ''}" aria-current="${tab === t ? 'step' : 'false'}">${i + 1} &nbsp; ${t === 'questions' ? 'Questions' : t === 'review' ? 'Review paper' : 'Publish'}</button>`).join('')}<span class="eb-spacer"></span>${button('Reload', 'reload')}</div><div class="eb-workbench"><section class="eb-content"></section><aside class="eb-paper"></aside></div>`;
    renderMeta(); renderContent(); renderPaper(); hydrate(root);
  }
  function renderContent(): void {
    const node = root.querySelector<HTMLElement>('.eb-content')!;
    if (tab === 'review') { node.innerHTML = `<div class="eb-panel eb-pad"><h2>Review the complete paper</h2><p>Approval applies to the exact question shown here.</p><div class="eb-notice">${detail.exam.items.filter(i => !i.approval).length} questions need approval. ${new Set(detail.exam.items.map(i => i.familyId)).size < detail.exam.items.length ? 'Related question families appear in this paper; check for repeated skills.' : ''}</div></div>${detail.exam.items.map((item, i) => `<article class="eb-review">${questionCard(item, i)}<div class="eb-actions"><span class="eb-pill">${item.approval ? 'Approved' : 'Needs review'}</span>${button(item.approval ? 'Approved ✓' : 'Approve question', 'approve', item.id, Boolean(item.approval) || locked() || item.assessment?.decision === 'reject')}</div></article>`).join('') || '<p class="eb-empty">Add questions before reviewing.</p>'}`; return; }
    if (tab === 'publish') { renderSettings(node); return; }
    if (locked()) { node.innerHTML = `<div class="eb-panel eb-pad"><h2>This published paper is locked.</h2><p>Students receive the saved publication. Future changes belong to a revised draft.</p>${detail.exam.startedAt ? '<p>Students have started this exam. Use Duplicate exam to make changes.</p>' : button('Create revised draft', 'revise')} ${button('Release results', 'release-results')}<p class="eb-muted">Answers can be released after the exam closes.</p></div>`; return; }
    node.innerHTML = `<div class="eb-panel"><div class="eb-panel-head"><div><h2>Add questions</h2><p>Reuse course questions or create something new.</p></div><div class="eb-source-tabs"><button data-source="bank" class="${source === 'bank' ? 'active' : ''}">Course bank</button><button data-source="generate" class="${source === 'generate' ? 'active' : ''}">Generate new</button></div></div><div class="eb-runs"></div><div class="eb-source"></div></div>`;
    if (source === 'bank') renderBank(); else renderGeneration(); renderRunArea();
  }
  function questionCard(q: BuilderItem, i?: number, student = false): string {
    return `<div class="eb-q-meta"><strong>${i !== undefined ? `QUESTION ${i + 1}` : typeLabel(q.type)}</strong><span>${q.points} points · ${q.minutes} min</span></div>${rich(q.stem)}${q.options.map(o => `<div class="eb-option ${!student && o.role === 'correct' ? 'correct' : ''}"><b>${esc(o.key)}</b>${rich(o.text)}${!student && o.role === 'correct' ? '<small>Correct</small>' : ''}</div>`).join('')}${student ? '' : `<details><summary>Answer explanations and evidence</summary>${q.options.map(o => `<div class="eb-rationale"><strong>${esc(o.key)}</strong>${rich(o.explanation ?? '')}</div>`).join('')}${q.assessment ? `<p>${esc(q.assessment.decision)} — ${esc(q.assessment.reasoning)}</p>` : ''}<p>${q.loIds.map(loName).map(esc).join(' · ')} · ${esc(q.source)}${q.source === 'bank' ? ' · pinned version' : ' · Exam only'}</p>${q.practiceExposure ? '<p class="eb-notice eb-warn">This question or its source family may have appeared in practice.</p>' : ''}</details>`}`;
  }
  function renderBank(): void {
    const node = root.querySelector<HTMLElement>('.eb-source'); if (!node) return;
    const filtered = bank.filter(q => (!status || q.state === status) && (!loFilter || q.loIds.includes(loFilter)) && (q.sample?.stem ?? q.current.stem).toLowerCase().includes(search.toLowerCase()));
    node.innerHTML = `<div class="eb-toolbar"><input id="eb-search" type="search" aria-label="Search questions" placeholder="Search course questions…" value="${esc(search)}"><select id="eb-lo-filter" aria-label="Filter by learning objective"><option value="">All learning objectives</option>${allLos().map(lo => `<option value="${lo._id}" ${loFilter === lo._id ? 'selected' : ''}>${esc(lo.name)}</option>`).join('')}</select><select id="eb-status" aria-label="Question status"><option value="">All available statuses</option>${['approved', 'reviewed', 'pending-review', 'draft', 'paused'].map(s => `<option ${status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div><p class="eb-caption">${filtered.length} questions · Current course only · Versions are pinned when added</p>${filtered.map(q => { const added = detail.exam.items.some(i => i.source === 'bank' && i.questionId === q.id); return `<article class="eb-bank-row"><input type="checkbox" data-select="${q.id}" aria-label="Select question ${q.id}" ${selected.has(q.id) ? 'checked' : ''} ${added ? 'disabled' : ''}><div><div class="eb-q-meta"><span class="eb-pill">${esc(q.state)}</span><span>${typeLabel(q.current.type)} · ${q.current.difficulty}</span></div>${rich(q.sample?.stem ?? q.current.stem)}<div class="eb-row-foot"><small>${q.loIds.map(loName).map(esc).join(' · ')}</small>${button('Preview', 'bank-preview', q.id)}${button('Create variant', 'variant', q.id)}${button(added ? 'Added ✓' : '+ Add', 'add-bank', q.id, added || q.state === 'paused')}</div></div></article>`; }).join('') || '<div class="eb-empty">No matching questions. Try another filter.</div>'}<div class="eb-addbar"><span id="eb-selected">${selected.size} selected</span>${button('Add selected', 'bulk-add', '', !selected.size)}</div>`;
    hydrate(node);
  }
  function renderGeneration(): void {
    root.querySelector('.eb-source')!.innerHTML = `<div class="eb-pad"><div class="eb-notice">New candidates are private to this exam. Generation is optional.</div><h3>1. Choose course learning objectives</h3><div class="eb-lo-grid">${allLos().map(lo => `<label><input type="checkbox" data-gen-lo="${lo._id}" ${gen.loIds.includes(lo._id) ? 'checked' : ''}><span>${esc(lo.name)}<small>${esc(lo.topic)}</small></span></label>`).join('')}</div><h3>2. Set the question mix</h3><div class="eb-actions">${types.map(type => `<label><input type="checkbox" data-gen-type="${type}" ${gen.types.includes(type) ? 'checked' : ''}> ${typeLabel(type)}</label>`).join('')}</div><div class="eb-fields"><label>Total new questions<input id="eb-count" type="number" min="1" max="20" value="${gen.count}"></label><label>Difficulty<select id="eb-difficulty">${['easy', 'medium', 'hard'].map(d => `<option ${d === gen.difficulty ? 'selected' : ''}>${d}</option>`).join('')}</select></label></div><label class="eb-field">3. Additional instructions · optional<textarea id="eb-prompt" maxlength="2000" placeholder="Use business scenarios, plausible calculation mistakes and clear wording.">${esc(gen.prompt)}</textarea></label><small>Leave blank to use your selections and assigned course evidence.</small><div class="eb-actions">${button('Preview generation plan →', 'plan')}</div></div><div class="eb-panel-head"><h3>Generated candidates</h3><small>Select what belongs in the paper.</small></div><div class="eb-candidates"></div>`;
    renderCandidates();
  }
  function renderCandidates(): void {
    const node = root.querySelector<HTMLElement>('.eb-candidates'); if (!node) return;
    node.innerHTML = `${detail.candidates.map(c => `<article class="eb-bank-row"><span>✧</span><div><div class="eb-q-meta"><span class="eb-pill">${esc(c.item.assessment?.decision ?? 'Draft')}</span><span>${typeLabel(c.item.type)} · ${c.item.difficulty}</span></div>${rich(c.item.stem)}<div class="eb-row-foot"><small>${c.item.loIds.map(loName).map(esc).join(' · ')} · Exam only</small>${button('Preview', 'candidate-preview', c._id)}${button(detail.exam.items.some(i => i.id === c.item.id) ? 'Added ✓' : '+ Add to paper', 'add-candidate', c._id, detail.exam.items.some(i => i.id === c.item.id))}</div></div></article>`).join('') || '<p class="eb-empty">Candidates appear here after generation.</p>'}`;
    hydrate(node);
  }
  function renderRunArea(): void {
    const node = root.querySelector<HTMLElement>('.eb-runs'); if (!node) return;
    const labels = { retrieving: 'Retrieving course evidence', generating: 'Writing question', validating: 'Checking answers and numerical validity', reviewing: 'Reviewing quality and alignment', saving: 'Saving candidate' };
    const runs = [...detail.runs].sort((a, b) => Number(['queued', 'running'].includes(b.status)) - Number(['queued', 'running'].includes(a.status)));
    node.innerHTML = `<p class="eb-stream-state" role="status">${connected ? 'Live updates connected' : 'Reconnecting to live updates… Saved work is preserved.'}</p>` + runs.map(run => {
      const active = ['queued', 'running'].includes(run.status), progress = active ? run.progress : undefined;
      return `<div class="eb-pad eb-run"><div class="eb-row-foot"><strong>Generation · ${esc(run.status)}</strong><span>${run.completed.length}/${run.cells.length} saved</span>${run.status === 'planned' ? button('Review plan', 'show-plan', run._id) : ''}${active ? button('Cancel', 'cancel-run', run._id) : ''}${['failed', 'partial', 'cancelled'].includes(run.status) ? button('Retry missing items', 'retry-run', run._id) : ''}</div>${active ? `<progress aria-label="Generation progress" max="${run.cells.length}" value="${run.completed.length + run.failures.filter(f => f.itemId).length}"></progress><p role="status">${progress ? `Question ${progress.item} of ${run.cells.length} · ${labels[progress.stage]}` : 'Waiting for the generation worker…'}</p>` : ''}${progress?.preview?.stem ? `<div class="eb-live-preview"><small>LIVE DRAFT · Not yet validated or saved</small>${rich(progress.preview.stem)}${(progress.preview.options ?? []).map(o => `<div class="eb-option"><b>${esc(o.key)}</b>${rich(o.text)}</div>`).join('')}</div>` : ''}${run.failures.map(f => {
        const index = run.cells.findIndex(c => c.id === f.itemId);
        const summary = /unknown function/.test(f.message) ? 'The formula used an unsupported function. Retry will request a supported calculation.' : /identical at display precision|duplicate|collision/.test(f.message) ? 'Two answer options evaluate to the same displayed value. This question was not saved.' : /verification|proof|numericKind/.test(f.message) ? 'The numerical answer could not be verified. This question was not saved.' : 'This question could not be generated.';
        return `<div class="eb-error"><p>${index >= 0 ? `Question ${index + 1} · ${esc(loName(run.cells[index].loId))}: ` : ''}${summary}</p><details><summary>Technical details</summary>${esc(f.message)}</details></div>`;
      }).join('')}<details><summary>Generation instructions</summary><small>${esc(run.interpretation)}</small></details></div>`;
    }).join('');
    hydrate(node);
  }
  function renderPaper(): void {
    const node = root.querySelector('.eb-paper'); if (!node) return;
    const items = detail.exam.items, points = items.reduce((n, i) => n + i.points, 0);
    node.innerHTML = `<div class="eb-panel"><div class="eb-pad"><div class="eb-eyebrow">YOUR PAPER</div><h2>${esc(examTitle(detail.exam))}</h2><div class="eb-metrics"><div><strong>${items.length}</strong><small>questions</small></div><div><strong>${points}</strong><small>points</small></div><div><strong>${items.reduce((n, i) => n + i.minutes, 0)}</strong><small>est. minutes</small></div></div></div><div class="eb-paper-list">${items.map((item, i) => `<div class="eb-paper-item"><div class="eb-q-meta"><b>${i + 1}.</b><span class="eb-pill ${item.approval ? '' : 'eb-warn'}">${item.approval ? 'Ready' : 'Review'}</span></div><p>${esc(item.stem.slice(0, 110))}${item.stem.length > 110 ? '…' : ''}</p><div class="eb-paper-controls"><label><input type="number" data-points="${item.id}" aria-label="Points for question ${i + 1}" min="0.1" step="0.1" value="${item.points}" ${locked() ? 'disabled' : ''}> pts</label><label><input type="number" data-minutes="${item.id}" aria-label="Estimated minutes for question ${i + 1}" min="1" value="${item.minutes}" ${locked() ? 'disabled' : ''}> min</label><button data-action="up" data-id="${item.id}" aria-label="Move question ${i + 1} up" ${locked() || i === 0 ? 'disabled' : ''}>↑</button><button data-action="down" data-id="${item.id}" aria-label="Move question ${i + 1} down" ${locked() || i === items.length - 1 ? 'disabled' : ''}>↓</button><button data-action="remove" data-id="${item.id}" aria-label="Remove question ${i + 1}" ${locked() ? 'disabled' : ''}>×</button></div></div>`).join('') || '<div class="eb-empty">Add the first question to your paper.</div>'}</div><div class="eb-pad"><h3>Learning objective coverage</h3>${allLos().map(lo => { const count = items.filter(i => i.loIds.includes(lo._id)).reduce((n, i) => n + i.points / i.loIds.length, 0); return `<div class="eb-coverage"><div><span>${esc(lo.name)}</span><small>${Number(count.toFixed(1))} pt</small></div><div class="eb-track"><i style="width:${points ? count / points * 100 : 0}%"></i></div></div>`; }).join('')}<small>Multi-objective points are split evenly. Time is an estimate.</small></div><div class="eb-addbar">${button(tab === 'questions' ? 'Review paper →' : 'Configure publication →', 'next')}</div></div>`;
  }
  function renderSettings(node: HTMLElement): void {
    const s = settingsDraft ?? detail.exam.settings;
    if (locked()) { node.innerHTML = `<div class="eb-panel eb-pad"><span class="eb-pill">Published revision</span><h2>${esc(examTitle(detail.exam))}</h2><p>${new Date(s.opensAt).toLocaleString()} → ${new Date(s.closesAt).toLocaleString()}</p><p>${detail.exam.items.length} fixed questions · ${s.durationMinutes} minutes · ${esc(s.feedback)}</p>${detail.exam.startedAt ? '<p>Students have started this exam. Use Duplicate exam to make changes.</p>' : button('Create revised draft', 'revise')} ${button('Release results', 'release-results')}</div>`; return; }
    const local = (iso: string) => iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    node.innerHTML = `<div class="eb-panel"><div class="eb-panel-head"><div><h2>Publish this exam</h2><p>Lock the paper and decide when students can access it.</p></div></div><div class="eb-pad"><label class="eb-field">Exam title<input data-setting="title" maxlength="150" value="${esc(s.title)}"></label><div class="eb-fields"><label>Exam kind<select data-setting="kind">${['midterm', 'final'].map(t => `<option ${s.kind === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Purpose<select data-setting="purpose">${['formal', 'practice'].map(t => `<option ${s.purpose === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Opens · your timezone (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)})<input type="datetime-local" data-setting="opensAt" value="${local(s.opensAt)}"></label><label>Closes · your timezone<input type="datetime-local" data-setting="closesAt" value="${local(s.closesAt)}"></label><label>Duration (minutes)<input data-setting="durationMinutes" type="number" min="1" max="1440" value="${s.durationMinutes}"></label><label>Score and answer release<select data-setting="feedback">${[['instructor', 'Instructor release'], ['after-close', 'After exam closes'], ...(s.purpose === 'practice' ? [['immediate', 'After submission']] : [])].map(([value, label]) => `<option value="${value}" ${s.feedback === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><label><input data-setting="shuffle" type="checkbox" ${s.shuffle ? 'checked' : ''}> Shuffle question order</label><details><summary>Individual timing accommodations</summary><p>One student PUID and extra minutes per line, separated by a comma. The exam close time still applies.</p><label class="eb-field">Student PUID, extra minutes<textarea id="eb-accommodations" placeholder="PUID-STUDENT-0001, 30">${s.accommodations.map(a => `${a.puid}, ${a.extraMinutes}`).join('\n')}</textarea></label></details><div class="eb-notice">One resumable attempt per student. The server enforces the deadline. Exam-only answers stay out of practice and Review Book.</div><div class="eb-actions">${button('Save settings', 'save-settings')}<small>${dirty ? 'Unsaved settings' : 'Settings saved'}</small></div><h3>Publication checklist</h3><ul class="eb-checks"><li>${detail.exam.items.length ? '✓' : '○'} Paper contains questions</li><li>${detail.exam.items.every(i => i.approval) && detail.exam.items.length ? '✓' : '○'} Every question is approved</li><li>${detail.exam.activeRunIds?.length ? '○' : '✓'} No active generation</li><li>${s.opensAt && s.closesAt && s.closesAt > s.opensAt ? '✓' : '○'} Valid availability window</li></ul><small>Publishing stores an immutable question and settings snapshot.</small></div><div class="eb-addbar"><small>${dirty ? 'Save settings before publishing.' : 'Review the exact paper before release.'}</small>${button('Review & publish →', 'publish-confirm', '', dirty || !detail.exam.items.length || detail.exam.items.some(i => !i.approval) || Boolean(detail.exam.activeRunIds?.length))}</div></div>`;
  }
  function showPlan(run: BuilderRun): void {
    dialog('Confirm generation plan', `<p>${esc(run.interpretation)}</p>${run.conflicts.map(c => `<p class="eb-notice eb-warn">${esc(c)}</p>`).join('')}<table class="eb-plan-table"><thead><tr><th>Learning objective</th><th>Type</th><th>Difficulty</th></tr></thead><tbody>${run.cells.map(c => `<tr><td>${[c.loId, ...(c.secondaryLoIds ?? [])].map(loName).map(esc).join(' · ')}</td><td>${typeLabel(c.type)}</td><td>${c.difficulty}</td></tr>`).join('')}</tbody></table><p>${run.cells.length} candidates · Retrieve evidence → generate → validate → review</p><p>These become private candidates. You select and approve them before publication.</p>`, `${button('Close', 'close')}${button('Generate candidates', 'confirm-run', run._id, run.conflicts.length > 0)}`);
  }
  root.addEventListener('input', event => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'eb-search') { search = target.value; const caret = target.selectionStart; renderBank(); const input = root.querySelector<HTMLInputElement>('#eb-search')!; input.focus(); input.setSelectionRange(caret, caret); }
    if (target.id === 'eb-prompt') gen.prompt = target.value;
    if (target.dataset.setting || target.id === 'eb-accommodations') dirty = true;
  });
  root.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.select) { if (input.checked) selected.add(input.dataset.select); else selected.delete(input.dataset.select); renderBank(); }
    if (input.id === 'eb-lo-filter') { loFilter = input.value; renderBank(); }
    if (input.id === 'eb-status') { status = input.value; renderBank(); }
    if (input.dataset.genLo) { gen.loIds = [...root.querySelectorAll<HTMLInputElement>('[data-gen-lo]:checked')].map(i => i.dataset.genLo!); }
    if (input.dataset.genType) { gen.types = [...root.querySelectorAll<HTMLInputElement>('[data-gen-type]:checked')].map(i => i.dataset.genType as QuestionType); }
    if (input.id === 'eb-count') gen.count = Number(input.value);
    if (input.id === 'eb-difficulty') gen.difficulty = input.value as Difficulty;
    if (input.dataset.setting && settingsDraft) {
      const key = input.dataset.setting as keyof BuilderSettings;
      const value = input.type === 'checkbox' ? input.checked : key === 'durationMinutes' ? Number(input.value) : ['opensAt', 'closesAt'].includes(key) ? (input.value ? new Date(input.value).toISOString() : '') : input.value;
      settingsDraft = { ...settingsDraft, [key]: value, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      if (settingsDraft.purpose === 'formal' && settingsDraft.feedback === 'immediate') settingsDraft.feedback = 'instructor';
      dirty = true; if (key === 'purpose') render();
    }
    if (input.id === 'eb-accommodations' && settingsDraft) { settingsDraft.accommodations = input.value.split('\n').filter(line => line.trim()).map(line => { const [puid, extra] = line.split(','); return { puid: puid.trim(), extraMinutes: Number(extra) }; }); dirty = true; }
    if ((input.dataset.points || input.dataset.minutes) && !busy) {
      const items = detail.exam.items.map(i => ({ id: i.id, points: input.dataset.points === i.id ? Number(input.value) : i.points, minutes: input.dataset.minutes === i.id ? Number(input.value) : i.minutes }));
      busy = true; void mutate('/items', { items }, 'PUT').catch(showError).finally(() => { busy = false; });
    }
  });
  root.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!target || target.disabled || busy) return;
    if (target.dataset.tab) { if (dirty) { showError(new Error('Save settings before leaving this tab.')); return; } tab = target.dataset.tab as typeof tab; render(); return; }
    if (target.dataset.source) { source = target.dataset.source; render(); return; }
    const action = target.dataset.action, id = target.dataset.id!; if (!action) return;
    if (action === 'close') { root.querySelector('dialog')?.close(); return; }
    void runButtonAction(target, async () => {
      busy = true; message = '';
      try {
        if (action === 'reload') { if (dirty && !window.confirm('Discard unsaved settings and reload?')) return; dirty = false; await load(); render(); }
        if (action === 'next') { if (dirty) throw new Error('Save settings first.'); tab = tab === 'questions' ? 'review' : 'publish'; render(); }
        if (action === 'add-bank' || action === 'bulk-add') { const ids = action === 'add-bank' ? [id] : [...selected]; const questions = ids.map(id => { const q = bank.find(q => q.id === id)!; return { questionId: q.id, versionId: q.current._id }; }); await mutate('/bank-items', { questions }); selected.clear(); render(); }
        if (action === 'add-candidate') await mutate('/candidate-items', { candidateId: id });
        if (action === 'approve') await mutate('/approve', { itemId: id });
        if (action === 'up' || action === 'down' || action === 'remove') { const items = [...detail.exam.items]; const i = items.findIndex(q => q.id === id), j = i + (action === 'up' ? -1 : 1); if (action === 'remove') items.splice(i, 1); else [items[i], items[j]] = [items[j], items[i]]; await mutate('/items', { items: items.map(({ id, points, minutes }) => ({ id, points, minutes })) }, 'PUT'); }
        if (action === 'candidate-preview') {
          const item = detail.candidates.find(c => c._id === id)!.item;
          const original = bank.find(q => q.id === item.questionId && q.current._id === item.versionId);
          dialog('Candidate preview', `${original ? `<h3>Source question</h3>${rich(original.sample?.stem ?? original.current.stem)}<p class="eb-caption">${esc(original.id)} · Pinned version ${esc(item.versionId ?? '')}</p><hr><h3>New variant</h3>` : ''}${questionCard(item)}`);
        }
        if (action === 'bank-preview') { const q = bank.find(q => q.id === id)!; dialog('Course question preview', `${rich(q.sample?.stem ?? q.current.stem)}${q.current.options.map(o => `<div class="eb-option ${o.role === 'correct' ? 'correct' : ''}"><b>${esc(o.key)}</b>${rich(q.sample?.options.find(s => s.key === o.key)?.text ?? o.text)}</div>`).join('')}`); }
        if (action === 'preview') dialog('Student preview', `<div class="eb-notice">Isolated preview · answers and explanations are hidden.</div>${detail.exam.items.map((i, n) => `<article class="eb-review">${questionCard(i, n, true)}</article>`).join('')}`);
        if (action === 'variant') { const q = bank.find(q => q.id === id)!; dialog('Create question variants', `${rich(q.sample?.stem ?? q.current.stem)}<p>Preserve the learning objective, type and difficulty. The original question stays intact.</p><label class="eb-field">Variant mode<select id="eb-variant-mode"><option value="context">Change context</option><option value="parameters" ${q.current.paramSlots?.length && !q.current.generateScript ? '' : 'disabled'}>Change numbers</option></select></label><label class="eb-field">Count<input id="eb-variant-count" type="number" min="1" max="20" value="2"></label><label class="eb-field">Instructions · optional<textarea id="eb-variant-prompt" maxlength="2000"></textarea></label>`, button('Preview variant plan', 'variant-plan', id)); }
        if (action === 'plan' || action === 'variant-plan') {
          const parent = action === 'variant-plan' ? { questionId: id, versionId: bank.find(q => q.id === id)!.current._id, mode: root.querySelector<HTMLSelectElement>('#eb-variant-mode')!.value } : undefined;
          const body = { revision: detail.exam.revision, requestId: crypto.randomUUID(), ...gen, ...(parent ? { parent, count: Number(root.querySelector<HTMLInputElement>('#eb-variant-count')!.value), prompt: root.querySelector<HTMLTextAreaElement>('#eb-variant-prompt')!.value } : {}) };
          const run = await api<BuilderRun>('/plans', 'POST', body); if (root.isConnected) { await load(); showPlan(run); }
        }
        if (action === 'show-plan') showPlan(detail.runs.find(r => r._id === id)!);
        if (action === 'confirm-run') { await mutate(`/runs/${id}/confirm`); source = 'generate'; render(); }
        if (action === 'cancel-run') await mutate(`/runs/${id}/cancel`);
        if (action === 'retry-run') { const run = await api<BuilderRun>(`/runs/${id}/retry`, 'POST', { requestId: crypto.randomUUID() }); await load(); showPlan(run); }
        if (action === 'save-settings') { await api('/settings', 'PUT', { revision: detail.exam.revision, settings: settingsDraft }); dirty = false; await load(); render(); }
        if (action === 'publish-confirm') { if (dirty) throw new Error('Save settings before publishing.'); dialog('Publish this exact paper?', `<h3>${esc(examTitle(detail.exam))}</h3><p>${detail.exam.items.length} pinned questions · ${detail.exam.items.reduce((n, i) => n + i.points, 0)} points · ${detail.exam.settings.durationMinutes} minutes</p><p>Students can start during the saved availability window. Published versions are immutable.</p><div class="eb-notice eb-warn">${detail.exam.items.filter(i => i.practiceExposure).length} selected questions or source families may have appeared in practice.</div>`, `${button('Back', 'close')}${button('Publish exam', 'publish')}`); }
        if (action === 'publish') await mutate('/publish');
        if (action === 'revise') await mutate('/revise');
        if (action === 'release-results') { await api('/release-results', 'POST', {}); root.querySelector('dialog')?.close(); message = 'Results released.'; render(); }
        if (action === 'duplicate') { const copy = await api<BuilderExam>('/duplicate', 'POST', {}); if (root.isConnected) window.location.hash = `/instructor/course/${courseId}/exam-builder/${copy._id}`; }
      } catch (error) { showError(error); const d = root.querySelector('dialog[open] .eb-dialog-body'); if (d) d.append(el('p', { class: 'eb-error', role: 'alert', text: err(error) })); }
      finally { busy = false; if (pendingSnapshot) { const next = pendingSnapshot; pendingSnapshot = undefined; acceptSnapshot(next); } }
    });
  });
  protectUnsavedChanges(root, () => dirty || busy, async () => window.confirm('Leave this exam? Unsaved settings will be lost.'));
  try {
    const [data, course, questions] = await Promise.all([api<BuilderDetail>(), getCourseOutline(courseId), browseBank(courseId)]);
    if (!root.isConnected) return; detail = data; outline = course; bank = questions.questions; settingsDraft = { ...structuredClone(detail.exam.settings), title: examTitle(detail.exam) }; render(); connectStream();
  } catch (error) { if (root.isConnected) root.replaceChildren(errorState(err(error), () => void renderExamBuilder(outlet, params))); }
}
