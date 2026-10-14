import { subscribeExamBuilder, getExamBank, getCourseOutline, examBuilderRequest, type ExamBankQuestion, type ExamBankSample, type BuilderDetail, type BuilderExam, type BuilderItem, type BuilderSettings, type CourseOutline, type Difficulty, type QuestionType } from '../../api.js';
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
const localDateTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
};

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
  let detail: BuilderDetail, outline: CourseOutline, bank: ExamBankQuestion[] = [];
  let tab: 'questions' | 'review' | 'publish' = 'questions', source = 'bank', search = '', topicFilter = '', loFilter = '', typeFilter = '', difficultyFilter = '', bankPage = 1;
  let settingsDraft: BuilderSettings | undefined, dirty = false, busy = false, message = '', connected = false, pendingSnapshot: BuilderDetail | undefined;
  let reviewedRevision: number | undefined;
  const selected = new Set<string>();
  const mix = { mode: 'total', count: 10, topics: new Map<string, number>(), type: '', difficulty: '', numbers: false };
  let sample: ExamBankSample | undefined;
  const api = <T>(suffix = '', method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown) => examBuilderRequest<T>(courseId, `/${examId}${suffix}`, method, body);
  const allLos = () => outline.themes.flatMap(theme => theme.los.map(lo => ({ ...lo, topic: theme.name })));
  const loName = (id: string) => allLos().find(lo => lo._id === id)?.name ?? 'Unavailable objective';
  const topicName = (id: string) => outline.themes.find(t => t._id === id)?.name ?? 'Other questions';
  const supportsNumbers = (q: ExamBankQuestion) => Boolean(q.contentReady && q.current.paramSlots?.length && !q.current.generateScript);
  const added = (q: ExamBankQuestion) => detail.exam.items.some(i => i.questionId === q.id);
  const available = (q: ExamBankQuestion) => q.contentReady === true && !added(q);
  const bankRefs = (ids: string[], numbers = false) => ids.map(id => { const q = bank.find(q => q.id === id)!; return { questionId: q.id, versionId: q.current._id, ...(numbers && supportsNumbers(q) ? { mode: 'parameters' as const } : {}) }; });
  const locked = () => detail.exam.publishedRevision === detail.exam.revision;
  function showError(error: unknown): void { message = err(error); const slot = root.querySelector('.eb-message'); if (slot) { slot.textContent = message; slot.removeAttribute('hidden'); } }
  function dialog(title: string, body: string, actions = ''): HTMLDialogElement {
    root.querySelector('dialog')?.remove();
    const node = el('dialog', { class: 'eb-dialog', 'aria-label': title, html: `<div class="eb-dialog-head"><h2>${esc(title)}</h2><button data-action="close" aria-label="Close dialog">×</button></div><div class="eb-dialog-body">${body}</div><div class="eb-dialog-foot">${actions || '<button data-action="close">Close</button>'}</div>` });
    const confirmationRevision = reviewedRevision;
    node.addEventListener('close', () => { if (confirmationRevision !== undefined && reviewedRevision === confirmationRevision) reviewedRevision = undefined; });
    root.append(node); hydrate(node); if (root.isConnected) node.showModal(); return node;
  }
  function resetSettingsDraft(exam: BuilderExam): void {
    settingsDraft = { ...structuredClone(exam.settings), title: examTitle(exam) };
    if (exam.publishedRevision !== exam.revision && !settingsDraft.opensAt) {
      settingsDraft.opensAt = new Date().toISOString(); dirty = true;
    }
  }
  async function load(): Promise<void> {
    const result = await api<BuilderDetail>(); if (!root.isConnected) return;
    detail = result; if (!dirty) resetSettingsDraft(detail.exam);
  }
  function acceptSnapshot(next: BuilderDetail): void {
    if (!root.isConnected) return;
    if (busy) { pendingSnapshot = next; return; }
    if (next.exam.revision < detail.exam.revision) return;
    if (reviewedRevision !== undefined && next.exam.revision !== reviewedRevision) {
      root.querySelector('dialog')?.close(); reviewedRevision = undefined;
      showError(new Error('The paper changed after your review. Review the updated paper before publishing.'));
    }
    const changed = JSON.stringify(next.candidates) !== JSON.stringify(detail.candidates);
    detail.runs = next.runs; detail.candidates = next.candidates;
    // Keep the original revision while settings are dirty so concurrent changes
    // cause a conflict instead of silently overwriting another author's settings.
    if (!dirty && !root.querySelector('.eb-paper input:focus')) {
      const paperChanged = JSON.stringify(detail.exam) !== JSON.stringify(next.exam);
      detail.exam = next.exam; resetSettingsDraft(next.exam);
      if (paperChanged) { renderPaper(); renderMeta(); if (tab === 'questions' && source === 'bank') renderBank(); if (tab === 'publish') renderSettings(root.querySelector<HTMLElement>('.eb-content')!); }
    }
    renderRunArea();
    if (changed) { root.querySelector<HTMLButtonElement>('[data-source="saved"]')?.toggleAttribute('hidden', !detail.candidates.length); renderCandidates(); }
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
    if (dirty) await saveSettings();
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
    root.innerHTML = `<div class="eb-heading"><div><a href="#/instructor/course/${courseId}/exam-builder" class="eb-back">← All exams</a><h1 class="eb-title">${esc(examTitle(detail.exam))}</h1><p>Choose approved bank questions, set your topic mix, then review and publish.</p></div><div class="eb-actions">${button('Student preview', 'preview')}${button('Duplicate exam', 'duplicate')}</div></div><div class="eb-meta"></div><div class="eb-message eb-notice eb-warn" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</div><div class="eb-tabs">${(['questions', 'review', 'publish'] as const).map((t, i) => `<button data-tab="${t}" class="${tab === t ? 'active' : ''}" aria-current="${tab === t ? 'step' : 'false'}">${i + 1} &nbsp; ${t === 'questions' ? 'Questions' : t === 'review' ? 'Review paper' : 'Publish'}</button>`).join('')}<span class="eb-spacer"></span>${button('Reload', 'reload')}</div><div class="eb-workbench"><section class="eb-content"></section><aside class="eb-paper"></aside></div>`;
    renderMeta(); renderContent(); renderPaper(); hydrate(root);
  }
  function renderContent(): void {
    const node = root.querySelector<HTMLElement>('.eb-content')!;
    if (tab === 'review') { node.innerHTML = `<div class="eb-panel eb-pad"><h2>Review the complete paper</h2><p>Approval applies to the exact question shown here.</p><div class="eb-notice">${detail.exam.items.filter(i => !i.approval).length} questions need approval. ${new Set(detail.exam.items.map(i => i.familyId)).size < detail.exam.items.length ? 'Related question families appear in this paper; check for repeated skills.' : ''}</div></div>${detail.exam.items.map((item, i) => `<article class="eb-review">${questionCard(item, i)}<div class="eb-actions"><span class="eb-pill">${item.approval ? 'Approved' : 'Needs review'}</span>${button(item.approval ? 'Approved ✓' : 'Approve question', 'approve', item.id, Boolean(item.approval) || locked() || item.assessment?.decision === 'reject')}</div></article>`).join('') || '<p class="eb-empty">Add questions before reviewing.</p>'}`; return; }
    if (tab === 'publish') { renderSettings(node); return; }
    if (locked()) { node.innerHTML = `<div class="eb-panel eb-pad"><h2>This published paper is locked.</h2><p>Students receive the saved publication. Future changes belong to a revised draft.</p>${detail.exam.startedAt ? '<p>Students have started this exam. Use Duplicate exam to make changes.</p>' : button('Create revised draft', 'revise')} ${button('Release results', 'release-results')}<p class="eb-muted">Answers can be released after the exam closes.</p></div>`; return; }
    node.innerHTML = `<div class="eb-panel"><div class="eb-panel-head"><div><h2>Add questions</h2><p>Use existing approved questions. Select directly or sample a topic mix.</p></div><div class="eb-source-tabs"><button data-source="bank" class="${source === 'bank' ? 'active' : ''}">Browse bank</button><button data-source="sample" class="${source === 'sample' ? 'active' : ''}">Sample by topic</button><button data-source="saved" class="${source === 'saved' ? 'active' : ''}" ${detail.candidates.length ? '' : 'hidden'}>Saved candidates</button></div></div><div class="eb-runs"></div><div class="eb-source"></div></div>`;
    if (source === 'bank') renderBank(); else if (source === 'sample') renderSampling(); else { node.querySelector('.eb-source')!.innerHTML = '<p class="eb-caption">Previously created candidates remain available for this exam.</p><div class="eb-candidates"></div>'; renderCandidates(); } renderRunArea();
  }
  function questionCard(q: BuilderItem, i?: number, student = false): string {
    return `<div class="eb-q-meta"><strong>${i !== undefined ? `QUESTION ${i + 1}` : typeLabel(q.type)}</strong><span>${q.points} points · ${q.minutes} min</span></div>${rich(q.stem)}${q.options.map(o => `<div class="eb-option ${!student && o.role === 'correct' ? 'correct' : ''}"><b>${esc(o.key)}</b>${rich(o.text)}${!student && o.role === 'correct' ? '<small>Correct</small>' : ''}</div>`).join('')}${student ? '' : `<details><summary>Answer explanations and evidence</summary>${q.options.map(o => `<div class="eb-rationale"><strong>${esc(o.key)}</strong>${rich(o.explanation ?? '')}</div>`).join('')}${q.assessment ? `<p>${esc(q.assessment.decision)} — ${esc(q.assessment.reasoning)}</p>` : ''}<p>${q.loIds.map(loName).map(esc).join(' · ')} · ${esc(q.source)}${q.source === 'bank' ? ' · pinned version' : ' · Exam only'}</p>${q.practiceExposure ? '<p class="eb-notice eb-warn">This question or its source family may have appeared in practice.</p>' : ''}</details>`}`;
  }
  function renderBank(): void {
    const node = root.querySelector<HTMLElement>('.eb-source'); if (!node) return;
    for (const id of selected) { const q = bank.find(q => q.id === id); if (!q || !available(q)) selected.delete(id); }
    const filtered = bank.filter(q => (!topicFilter || q.themeIds.includes(topicFilter)) && (!loFilter || q.loIds.includes(loFilter))
      && (!typeFilter || q.current.type === typeFilter) && (!difficultyFilter || q.current.difficulty === difficultyFilter)
      && (q.sample?.stem ?? q.current.stem).toLowerCase().includes(search.toLowerCase()));
    const pages = Math.max(1, Math.ceil(filtered.length / 15)); bankPage = Math.min(bankPage, pages);
    const page = filtered.slice((bankPage - 1) * 15, bankPage * 15);
    const groups = new Map<string, ExamBankQuestion[]>();
    for (const q of page) { const topic = topicFilter || q.themeIds[0] || ''; groups.set(topic, [...(groups.get(topic) ?? []), q]); }
    node.innerHTML = `<div class="eb-toolbar"><input id="eb-search" type="search" aria-label="Search questions" placeholder="Search bank questions…" value="${esc(search)}"><select id="eb-topic-filter" aria-label="Filter by topic"><option value="">All topics</option>${outline.themes.map(t => `<option value="${t._id}" ${topicFilter === t._id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select><select id="eb-type-filter" aria-label="Question type"><option value="">All types</option>${types.map(t => `<option value="${t}" ${typeFilter === t ? 'selected' : ''}>${typeLabel(t)}</option>`).join('')}</select><select id="eb-difficulty-filter" aria-label="Question difficulty"><option value="">All difficulties</option>${['easy', 'medium', 'hard'].map(d => `<option ${difficultyFilter === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div><div class="eb-bank-detail-filter"><label>Learning objective · optional<select id="eb-lo-filter"><option value="">All objectives in these topics</option>${allLos().filter(lo => !topicFilter || outline.themes.find(t => t._id === topicFilter)?.los.some(l => l._id === lo._id)).map(lo => `<option value="${lo._id}" ${loFilter === lo._id ? 'selected' : ''}>${esc(lo.name)}</option>`).join('')}</select></label><span>${filtered.length} approved questions · ${filtered.filter(q => q.contentReady).length} ready for exams</span></div>${[...groups].map(([topic, questions]) => `<section class="eb-topic-group"><div class="eb-topic-head"><h3>${esc(topicName(topic))}</h3><small>${questions.length} on this page</small></div>${questions.map(q => `<article class="eb-bank-row"><input type="checkbox" data-select="${q.id}" aria-label="Select question ${q.id}" ${selected.has(q.id) ? 'checked' : ''} ${available(q) ? '' : 'disabled'}><div><div class="eb-q-meta"><span class="eb-pill ${q.contentReady ? '' : 'eb-warn'}">${added(q) ? 'In paper' : q.contentReady ? 'Approved' : 'Needs verification'}</span><span>${typeLabel(q.current.type)} · ${q.current.difficulty}</span></div>${rich(q.sample?.stem ?? q.current.stem)}${q.blockedReason ? `<p class="eb-error">${esc(q.blockedReason)}</p><a href="#/instructor/course/${courseId}/bank/${q.id}" class="eb-back">Open question details →</a>` : ''}<div class="eb-row-foot"><small>${q.loIds.map(loName).map(esc).join(' · ')}</small>${button('Preview', 'bank-preview', q.id)}${supportsNumbers(q) ? button('Change numbers', 'numbers-add', q.id, added(q)) : ''}${button(added(q) ? 'Added ✓' : '+ Add', 'add-bank', q.id, !available(q))}</div></div></article>`).join('')}</section>`).join('') || '<div class="eb-empty">No matching approved questions. Try another filter or approve questions in Question Bank.</div>'}<div class="eb-pagination"><span>${filtered.length ? (bankPage - 1) * 15 + 1 : 0}–${Math.min(bankPage * 15, filtered.length)} of ${filtered.length}</span><div>${button('Previous', 'bank-prev', '', bankPage === 1)}<span>Page ${bankPage} of ${pages}</span>${button('Next', 'bank-next', '', bankPage === pages)}</div></div><div class="eb-addbar"><span>${selected.size} selected</span>${button('Add selected', 'bulk-add', '', !selected.size)}</div>`;
    hydrate(node);
  }
  function renderSampling(): void {
    const node = root.querySelector<HTMLElement>('.eb-source'); if (!node) return;
    node.innerHTML = `<div class="eb-pad"><h3>Set the topic mix</h3><p class="eb-muted">Sample without replacement across all learning objectives in each topic. Questions already in your paper are excluded.</p><div class="eb-fields"><label>Sampling structure<select id="eb-mix-mode"><option value="total" ${mix.mode === 'total' ? 'selected' : ''}>Total across selected topics</option><option value="per-topic" ${mix.mode === 'per-topic' ? 'selected' : ''}>Set a count for each topic</option></select></label><label>Total questions<input id="eb-mix-count" type="number" min="1" max="100" value="${mix.count}" ${mix.mode === 'per-topic' ? 'disabled' : ''}></label><label>Question type<select id="eb-mix-type"><option value="">All types</option>${types.map(t => `<option value="${t}" ${mix.type === t ? 'selected' : ''}>${typeLabel(t)}</option>`).join('')}</select></label><label>Difficulty<select id="eb-mix-difficulty"><option value="">All difficulties</option>${['easy', 'medium', 'hard'].map(d => `<option ${mix.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label></div><div class="eb-topic-head"><strong>Topics</strong><div>${button('Select all', 'mix-all')}${button('Clear', 'mix-clear')}</div></div><div class="eb-topic-mix">${outline.themes.map(topic => {
      const pool = bank.filter(q => available(q) && q.themeIds.includes(topic._id) && (!mix.type || q.current.type === mix.type) && (!mix.difficulty || q.current.difficulty === mix.difficulty));
      return `<div class="eb-mix-row"><label><input type="checkbox" data-mix-topic="${topic._id}" ${mix.topics.has(topic._id) ? 'checked' : ''}><span>${esc(topic.name)}<small>${pool.length} eligible questions · ${topic.los.length} objectives</small></span></label>${mix.mode === 'per-topic' ? `<label class="eb-mix-quota">Questions<input type="number" min="1" max="100" data-mix-quota="${topic._id}" aria-label="Question count for ${esc(topic.name)}" value="${mix.topics.get(topic._id) ?? 1}" ${mix.topics.has(topic._id) ? '' : 'disabled'}></label>` : ''}</div>`;
    }).join('') || '<p class="eb-empty">Add topics in Course Structure first.</p>'}</div><label class="eb-number-toggle"><input id="eb-mix-numbers" type="checkbox" ${mix.numbers ? 'checked' : ''}> Use different numbers for supported numerical questions</label><small>Existing formulas and answer roles are preserved. Other questions use the bank version. No model call is needed.</small><p class="eb-notice">${mix.mode === 'per-topic' ? [...mix.topics.values()].reduce((a, b) => a + b, 0) : mix.count} questions requested from ${mix.topics.size} topics. Preview fixes the selection; every student receives this paper.</p></div><div class="eb-addbar"><small>Only approved, verified questions are sampled.</small>${button('Preview random selection', 'sample-preview', '', !mix.topics.size)}</div>`;
  }
  function showSample(): void {
    if (!sample) return;
    dialog('Review random selection', `<p>${sample.questions.length} existing bank questions. Nothing has been added yet.</p>${mix.numbers ? '<p class="eb-notice">Supported numerical questions will receive new values when added. Review the frozen numbers in Review paper.</p>' : ''}${sample.questions.map((ref, i) => { return `<article class="eb-sample-question"><div class="eb-q-meta"><strong>${i + 1}. ${esc(topicName(ref.topicId))}</strong><span>${typeLabel(ref.type)} · ${ref.difficulty}</span></div>${rich(ref.stem)}</article>`; }).join('')}`, `${button('Back', 'close')}${button('Resample', 'sample-preview')}${button('Add selection to paper', 'sample-add')}`);
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
    if (!runs.length) { node.innerHTML = ''; return; }
    node.innerHTML = `<p class="eb-stream-state" role="status">${connected ? 'Live updates connected' : 'Reconnecting to live updates… Saved work is preserved.'}</p>` + runs.map(run => {
      const active = ['queued', 'running'].includes(run.status), progress = active ? run.progress : undefined;
      return `<div class="eb-pad eb-run"><div class="eb-row-foot"><strong>Generation · ${esc(run.status)}</strong><span>${run.completed.length}/${run.cells.length} saved</span>${active ? button('Cancel', 'cancel-run', run._id) : ''}</div>${active ? `<progress aria-label="Generation progress" max="${run.cells.length}" value="${run.completed.length + run.failures.filter(f => f.itemId).length}"></progress><p role="status">${progress ? `Question ${progress.item} of ${run.cells.length} · ${labels[progress.stage]}` : 'Waiting for the generation worker…'}</p>` : ''}${progress?.preview?.stem ? `<div class="eb-live-preview"><small>LIVE DRAFT · Not yet validated or saved</small>${rich(progress.preview.stem)}${(progress.preview.options ?? []).map(o => `<div class="eb-option"><b>${esc(o.key)}</b>${rich(o.text)}</div>`).join('')}</div>` : ''}${run.failures.map(f => {
        const index = run.cells.findIndex(c => c.id === f.itemId);
        const summary = /unknown function/.test(f.message) ? 'The formula used an unsupported function. This historical candidate was not saved.' : /identical at display precision|duplicate|collision/.test(f.message) ? 'Two answer options evaluate to the same displayed value. This question was not saved.' : /verification|proof|numericKind/.test(f.message) ? 'The numerical answer could not be verified. This question was not saved.' : 'This question could not be generated.';
        return `<div class="eb-error"><p>${index >= 0 ? `Question ${index + 1} · ${esc(loName(run.cells[index].loId))}: ` : ''}${summary}</p><details><summary>Technical details</summary>${esc(f.message)}</details></div>`;
      }).join('')}<details><summary>Generation instructions</summary><small>${esc(run.interpretation)}</small></details></div>`;
    }).join('');
    hydrate(node);
  }
  function renderPaper(): void {
    const node = root.querySelector('.eb-paper'); if (!node) return;
    const items = detail.exam.items, points = items.reduce((n, i) => n + i.points, 0);
    node.innerHTML = `<div class="eb-panel"><div class="eb-pad"><div class="eb-eyebrow">YOUR PAPER</div><h2>${esc(examTitle(detail.exam))}</h2><div class="eb-metrics"><div><strong>${items.length}</strong><small>questions</small></div><div><strong>${points}</strong><small>points</small></div><div><strong>${items.reduce((n, i) => n + i.minutes, 0)}</strong><small>est. minutes</small></div></div></div><div class="eb-paper-list">${items.map((item, i) => `<div class="eb-paper-item"><div class="eb-q-meta"><b>${i + 1}.</b><span class="eb-pill ${item.approval ? '' : 'eb-warn'}">${item.approval ? 'Ready' : 'Review'}</span></div><p>${esc(item.stem.slice(0, 110))}${item.stem.length > 110 ? '…' : ''}</p><div class="eb-paper-controls"><label><input type="number" data-points="${item.id}" aria-label="Points for question ${i + 1}" min="0.1" step="0.1" value="${item.points}" ${locked() ? 'disabled' : ''}> pts</label><label><input type="number" data-minutes="${item.id}" aria-label="Estimated minutes for question ${i + 1}" min="1" value="${item.minutes}" ${locked() ? 'disabled' : ''}> min</label><button data-action="up" data-id="${item.id}" aria-label="Move question ${i + 1} up" ${locked() || i === 0 ? 'disabled' : ''}>↑</button><button data-action="down" data-id="${item.id}" aria-label="Move question ${i + 1} down" ${locked() || i === items.length - 1 ? 'disabled' : ''}>↓</button><button data-action="remove" data-id="${item.id}" aria-label="Remove question ${i + 1}" ${locked() ? 'disabled' : ''}>×</button></div></div>`).join('') || '<div class="eb-empty">Add the first question to your paper.</div>'}</div><div class="eb-pad"><h3>Topic coverage</h3>${outline.themes.map(topic => { const count = items.filter(i => i.loIds.some(id => topic.los.some(lo => lo._id === id))).length; return `<div class="eb-coverage"><div><span>${esc(topic.name)}</span><small>${count} questions</small></div><div class="eb-track"><i style="width:${items.length ? count / items.length * 100 : 0}%"></i></div></div>`; }).join('')}<details class="eb-lo-coverage"><summary>Learning objective detail</summary>${allLos().map(lo => `<p>${esc(lo.name)} <small>${items.filter(i => i.loIds.includes(lo._id)).length} questions</small></p>`).join('')}</details><small>A question can cover multiple topics. Time is an estimate.</small></div><div class="eb-addbar">${button(tab === 'questions' ? 'Review paper →' : 'Configure publication →', 'next')}</div></div>`;
  }
  function renderSettings(node: HTMLElement): void {
    const s = settingsDraft ?? detail.exam.settings;
    if (locked()) { node.innerHTML = `<div class="eb-panel eb-pad"><span class="eb-pill">Published revision</span><h2>${esc(examTitle(detail.exam))}</h2><p>${new Date(s.opensAt).toLocaleString()} → ${new Date(s.closesAt).toLocaleString()}</p><p>${detail.exam.items.length} fixed questions · ${s.durationMinutes} minutes · ${esc(s.feedback)}</p>${detail.exam.startedAt ? '<p>Students have started this exam. Use Duplicate exam to make changes.</p>' : button('Create revised draft', 'revise')} ${button('Release results', 'release-results')}</div>`; return; }
    node.innerHTML = `<div class="eb-panel"><div class="eb-panel-head"><div><h2>Publish this exam</h2><p>Lock the paper and decide when students can access it.</p></div></div><div class="eb-pad"><label class="eb-field">Exam title<input data-setting="title" maxlength="150" value="${esc(s.title)}"></label><div class="eb-fields"><label>Exam kind<select data-setting="kind">${['midterm', 'final'].map(t => `<option ${s.kind === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Purpose<select data-setting="purpose">${['formal', 'practice'].map(t => `<option ${s.purpose === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Opens · your timezone (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)})<input type="datetime-local" data-setting="opensAt" value="${localDateTime(s.opensAt)}"></label><label>Closes · your timezone<input type="datetime-local" data-setting="closesAt" value="${localDateTime(s.closesAt)}"></label><label>Duration (minutes)<input data-setting="durationMinutes" type="number" min="1" max="1440" value="${s.durationMinutes}"></label><label>Score and answer release<select data-setting="feedback">${[['instructor', 'Instructor release'], ['after-close', 'After exam closes'], ...(s.purpose === 'practice' ? [['immediate', 'After submission']] : [])].map(([value, label]) => `<option value="${value}" ${s.feedback === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><label><input data-setting="shuffle" type="checkbox" ${s.shuffle ? 'checked' : ''}> Shuffle question order</label><details><summary>Individual timing accommodations</summary><p>One student PUID and extra minutes per line, separated by a comma. The exam close time still applies.</p><label class="eb-field">Student PUID, extra minutes<textarea id="eb-accommodations" placeholder="PUID-STUDENT-0001, 30">${s.accommodations.map(a => `${a.puid}, ${a.extraMinutes}`).join('\n')}</textarea></label></details><div class="eb-notice">One resumable attempt per student. The server enforces the deadline. Exam-only answers stay out of practice and Review Book.</div><p class="eb-caption" data-settings-status role="status">${dirty ? 'Settings will save when you review publication.' : 'Settings saved. Changes save when you review publication.'}</p><h3>Publication checklist</h3><ul class="eb-checks"><li>${detail.exam.items.length ? '✓' : '○'} Paper contains questions</li><li>${detail.exam.items.every(i => i.approval) && detail.exam.items.length ? '✓' : '○'} Every question is approved</li><li>${detail.exam.activeRunIds?.length ? '○' : '✓'} No active generation</li><li>${s.opensAt && s.closesAt && s.closesAt > s.opensAt ? '✓' : '○'} Valid availability window</li></ul><small>Publishing stores an immutable question and settings snapshot.</small></div><div class="eb-addbar"><small>Settings save automatically before the final review.</small>${button('Review & publish →', 'publish-confirm', '', !detail.exam.items.length || detail.exam.items.some(i => !i.approval) || Boolean(detail.exam.activeRunIds?.length))}</div></div>`;
  }
  // Read the visible fields at the action boundary, including a focused field
  // whose native change event has not fired yet. No background writes occur.
  function captureSettings(): void {
    if (!settingsDraft || !root.querySelector('[data-setting]')) return;
    const draft = structuredClone(settingsDraft);
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach(input => {
      const key = input.dataset.setting as keyof BuilderSettings;
      let value: string | number | boolean = input.value;
      if (key === 'shuffle') value = (input as HTMLInputElement).checked;
      if (key === 'durationMinutes') value = Number(input.value);
      if (key === 'opensAt' || key === 'closesAt') value = input.value === localDateTime(draft[key]) ? draft[key] : input.value && Number.isFinite(new Date(input.value).getTime()) ? new Date(input.value).toISOString() : '';
      Object.assign(draft, { [key]: value });
    });
    const accommodations = root.querySelector<HTMLTextAreaElement>('#eb-accommodations');
    if (accommodations) draft.accommodations = accommodations.value.split('\n').filter(line => line.trim()).map(line => {
      const [puid, extra, unexpected] = line.split(',');
      return { puid: puid.trim(), extraMinutes: extra?.trim() && unexpected === undefined ? Number(extra) : Number.NaN };
    });
    if (draft.purpose === 'formal' && draft.feedback === 'immediate') draft.feedback = 'after-close';
    if (JSON.stringify(draft) !== JSON.stringify(settingsDraft)) draft.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    settingsDraft = draft;
    dirty = JSON.stringify(draft) !== JSON.stringify({ ...detail.exam.settings, title: examTitle(detail.exam) });
    const status = root.querySelector('[data-settings-status]');
    if (status) status.textContent = dirty ? 'Settings will save when you review publication.' : 'Settings saved. Changes save when you review publication.';
  }
  function validateDraft(publishing = false): void {
    const s = settingsDraft!;
    if (!s.title.trim() || s.title.trim().length > 150) throw new Error('Enter an exam title of up to 150 characters.');
    if (!Number.isInteger(s.durationMinutes) || s.durationMinutes < 1 || s.durationMinutes > 1440) throw new Error('Duration must be a whole number from 1 to 1440 minutes.');
    if (s.accommodations.some(a => !a.puid || a.puid.length > 128 || !Number.isInteger(a.extraMinutes) || a.extraMinutes < 0 || a.extraMinutes > 1440) || s.accommodations.length > 1000) throw new Error('Use one student PUID and a whole number of extra minutes from 0 to 1440 per line.');
    if (new Set(s.accommodations.map(a => a.puid)).size !== s.accommodations.length) throw new Error('Each student can have only one accommodation.');
    if (publishing && (!s.opensAt || !s.closesAt || !Number.isFinite(Date.parse(s.opensAt)) || !Number.isFinite(Date.parse(s.closesAt)) || Date.parse(s.closesAt) <= Date.parse(s.opensAt))) throw new Error('Choose a closing time after the opening time.');
  }
  async function saveSettings(): Promise<void> {
    validateDraft();
    if (!dirty) return;
    const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-setting], #eb-accommodations')];
    inputs.forEach(input => { input.disabled = true; });
    const status = root.querySelector('[data-settings-status]'); if (status) status.textContent = 'Saving settings…';
    try {
      const saved = await api<BuilderExam>('/settings', 'PUT', { revision: detail.exam.revision, settings: structuredClone(settingsDraft) });
      if (!root.isConnected) return;
      detail.exam = saved;
      settingsDraft = { ...structuredClone(saved.settings), title: examTitle(saved) }; dirty = false;
    } finally {
      inputs.forEach(input => { input.disabled = false; });
      if (status?.isConnected) status.textContent = dirty ? 'Settings were not saved. Your changes are still here; review publication to retry.' : 'Settings saved.';
    }
  }
  root.addEventListener('input', event => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'eb-search') { search = target.value; bankPage = 1; const caret = target.selectionStart; renderBank(); const input = root.querySelector<HTMLInputElement>('#eb-search')!; input.focus(); input.setSelectionRange(caret, caret); }
    if (!busy && (target.dataset.setting || target.id === 'eb-accommodations')) captureSettings();
  });
  root.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.select) { if (input.checked) selected.add(input.dataset.select); else selected.delete(input.dataset.select); renderBank(); }
    if (input.id === 'eb-topic-filter') { topicFilter = input.value; loFilter = ''; bankPage = 1; renderBank(); }
    if (input.id === 'eb-lo-filter') { loFilter = input.value; bankPage = 1; renderBank(); }
    if (input.id === 'eb-type-filter') { typeFilter = input.value; bankPage = 1; renderBank(); }
    if (input.id === 'eb-difficulty-filter') { difficultyFilter = input.value; bankPage = 1; renderBank(); }
    if (input.dataset.mixTopic) { if (input.checked) mix.topics.set(input.dataset.mixTopic, 1); else mix.topics.delete(input.dataset.mixTopic); renderSampling(); }
    if (input.dataset.mixQuota) { mix.topics.set(input.dataset.mixQuota, Number(input.value)); renderSampling(); }
    if (input.id === 'eb-mix-mode') { mix.mode = input.value; renderSampling(); }
    if (input.id === 'eb-mix-count') { mix.count = Number(input.value); renderSampling(); }
    if (input.id === 'eb-mix-type') { mix.type = input.value; renderSampling(); }
    if (input.id === 'eb-mix-difficulty') { mix.difficulty = input.value; renderSampling(); }
    if (input.id === 'eb-mix-numbers') mix.numbers = input.checked;
    if (input.dataset.setting || input.id === 'eb-accommodations') {
      captureSettings();
      if (input.dataset.setting === 'purpose') render();
    }
    if ((input.dataset.points || input.dataset.minutes) && !busy) {
      const items = detail.exam.items.map(i => ({ id: i.id, points: input.dataset.points === i.id ? Number(input.value) : i.points, minutes: input.dataset.minutes === i.id ? Number(input.value) : i.minutes }));
      busy = true; void mutate('/items', { items }, 'PUT').catch(showError).finally(() => { busy = false; });
    }
  });
  root.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!target || target.disabled || busy) return;
    if (target.dataset.tab) { tab = target.dataset.tab as typeof tab; render(); return; }
    if (target.dataset.source) { source = target.dataset.source; render(); return; }
    const action = target.dataset.action, id = target.dataset.id!; if (!action) return;
    if (action === 'bank-prev' || action === 'bank-next') { bankPage += action === 'bank-next' ? 1 : -1; renderBank(); return; }
    if (action === 'mix-all' || action === 'mix-clear') { mix.topics.clear(); if (action === 'mix-all') outline.themes.forEach(t => mix.topics.set(t._id, 1)); renderSampling(); return; }
    if (action === 'close') { root.querySelector('dialog')?.close(); reviewedRevision = undefined; return; }
    void runButtonAction(target, async () => {
      busy = true; message = '';
      try {
        if (action === 'reload') { if (dirty && !window.confirm('Discard unsaved settings and reload?')) return; dirty = false; await load(); bank = (await getExamBank(courseId)).questions; render(); }
        if (action === 'next') { tab = tab === 'questions' ? 'review' : 'publish'; render(); }
        if (action === 'add-bank' || action === 'bulk-add' || action === 'numbers-add') { const ids = action === 'bulk-add' ? [...selected] : [id]; await mutate('/bank-items', { questions: bankRefs(ids, action === 'numbers-add') }); selected.clear(); render(); }
        if (action === 'sample-preview') {
          sample = await api<ExamBankSample>('/sample-bank', 'POST', { revision: detail.exam.revision, mode: mix.mode, topics: [...mix.topics].map(([topicId, count]) => ({ topicId, count })), count: mix.count, ...(mix.type ? { type: mix.type as QuestionType } : {}), ...(mix.difficulty ? { difficulty: mix.difficulty as Difficulty } : {}) });
          if (root.isConnected) showSample();
        }
        if (action === 'sample-add' && sample) {
          if (sample.revision !== detail.exam.revision) throw new Error('The paper changed since this preview. Resample before adding.');
          const questions = sample.questions.map(ref => { return { questionId: ref.questionId, versionId: ref.versionId, ...(mix.numbers && ref.supportsNumbers ? { mode: 'parameters' as const } : {}) }; });
          await mutate('/bank-items', { questions }); sample = undefined; selected.clear(); source = 'bank'; render();
        }
        if (action === 'add-candidate') await mutate('/candidate-items', { candidateId: id });
        if (action === 'approve') await mutate('/approve', { itemId: id });
        if (action === 'up' || action === 'down' || action === 'remove') { const items = [...detail.exam.items]; const i = items.findIndex(q => q.id === id), j = i + (action === 'up' ? -1 : 1); if (action === 'remove') items.splice(i, 1); else [items[i], items[j]] = [items[j], items[i]]; await mutate('/items', { items: items.map(({ id, points, minutes }) => ({ id, points, minutes })) }, 'PUT'); }
        if (action === 'candidate-preview') {
          const item = detail.candidates.find(c => c._id === id)!.item;
          const original = bank.find(q => q.id === item.questionId && q.current._id === item.versionId);
          dialog('Candidate preview', `${original ? `<h3>Source question</h3>${rich(original.sample?.stem ?? original.current.stem)}<p class="eb-caption">${esc(original.id)} · Pinned version ${esc(item.versionId ?? '')}</p><hr><h3>New variant</h3>` : ''}${questionCard(item)}`);
        }
        if (action === 'bank-preview') { const q = bank.find(q => q.id === id)!; dialog('Course question preview', `${rich(q.sample?.stem ?? q.current.stem)}${q.current.options.map(o => `<div class="eb-option ${o.role === 'correct' ? 'correct' : ''}"><b>${esc(o.key)}</b>${rich(q.sample?.options.find(s => s.key === o.key)?.text ?? o.text)}</div>`).join('')}`); }
        if (action === 'preview') { captureSettings(); await saveSettings(); if (root.isConnected) window.location.hash = `/preview/course/${encodeURIComponent(courseId)}/assessments?examId=${encodeURIComponent(examId)}&workspace=student`; }
        if (action === 'cancel-run') await mutate(`/runs/${id}/cancel`);
        if (action === 'publish-confirm') { captureSettings(); validateDraft(true); await saveSettings(); if (!root.isConnected) return; render(); reviewedRevision = detail.exam.revision; dialog('Publish this exact paper?', `<h3>${esc(examTitle(detail.exam))}</h3><p>${detail.exam.items.length} pinned questions · ${detail.exam.items.reduce((n, i) => n + i.points, 0)} points · ${detail.exam.settings.durationMinutes} minutes</p><p>Opens ${esc(new Date(detail.exam.settings.opensAt).toLocaleString())} · Closes ${esc(new Date(detail.exam.settings.closesAt).toLocaleString())}</p><p>Score and answer release: ${detail.exam.settings.feedback === 'after-close' ? 'After exam closes' : detail.exam.settings.feedback === 'immediate' ? 'After submission' : 'Instructor release'}.</p><p>Students can start during the saved availability window. Published versions are immutable.</p><div class="eb-notice eb-warn">${detail.exam.items.filter(i => i.practiceExposure).length} selected questions or source families may have appeared in practice.</div>`, `${button('Back', 'close')}${button('Publish exam', 'publish')}`); }
        if (action === 'publish') {
          if (reviewedRevision === undefined) throw new Error('Review this paper before publishing.');
          await api('/publish', 'POST', { revision: reviewedRevision }); reviewedRevision = undefined;
          await load(); render();
        }
        if (action === 'revise') await mutate('/revise');
        if (action === 'release-results') { await api('/release-results', 'POST', {}); root.querySelector('dialog')?.close(); message = 'Results released.'; render(); }
        if (action === 'duplicate') { const copy = await api<BuilderExam>('/duplicate', 'POST', {}); if (root.isConnected) window.location.hash = `/instructor/course/${courseId}/exam-builder/${copy._id}`; }
      } catch (error) { showError(error); const d = root.querySelector('dialog[open] .eb-dialog-body'); if (d) d.append(el('p', { class: 'eb-error', role: 'alert', text: err(error) })); }
      finally { busy = false; if (pendingSnapshot) { const next = pendingSnapshot; pendingSnapshot = undefined; acceptSnapshot(next); } }
    });
  });
  protectUnsavedChanges(root, () => dirty || busy, async () => window.confirm('Leave this exam? Unsaved settings will be lost.'));
  try {
    const [data, course, questions] = await Promise.all([api<BuilderDetail>(), getCourseOutline(courseId), getExamBank(courseId)]);
    if (!root.isConnected) return; detail = data; outline = course; bank = questions.questions; resetSettingsDraft(detail.exam); render(); connectStream();
  } catch (error) { if (root.isConnected) root.replaceChildren(errorState(err(error), () => void renderExamBuilder(outlet, params))); }
}
