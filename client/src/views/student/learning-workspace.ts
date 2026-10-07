import { el } from '../../dom.js';
import { errorState, loadingState, emptyState } from '../../ui.js';
import { renderRichText } from '../../render.js';
import { learningApi, type LearningView, type LibraryQuestion } from '../../student-learning-api.js';
import type { StudentExperience } from './experience.js';
import { currentQuery } from '../../router.js';
import { renderLearningSummary, remainingQuestion } from './learning-summary.js';

export function rich(text: string, className = '') { const node = el('div', { class: className }); renderRichText(node, text); return node; }
export function button(text: string, action: () => unknown, className = 'btn btn--ghost btn--sm') { return el('button', { class: className, type: 'button', text, onclick: action }); }
export function select(label: string, choices: Array<[string, string]>, value: string, action: (value: string) => void) {
  const node = el('select', { class: 'input', 'aria-label': label, onchange: () => action(node.value) }, ...choices.map(([id, text]) => el('option', { value: id, text }))); node.value = value; return node;
}
export function dialog(title: string, content: HTMLElement) {
  const node = el('dialog', { class: `learning-dialog${title === 'Question board' ? ' learning-board-dialog' : ''}`, 'aria-label': title });
  const close = button('✕', () => node.close()); close.setAttribute('aria-label', 'Close dialog');
  node.append(el('header', {}, el('h2', { text: title }), close), content);
  node.addEventListener('close', () => node.remove()); document.body.append(node); node.showModal(); return node;
}
export function questionTile(number: number, status: string, title: string, action: () => unknown) {
  return el('button', { type: 'button', class: 'btn learning-board-tile', 'aria-label': `${number} · ${status} · ${title}`, onclick: action },
    el('span', { class: 'learning-board-meta' }, el('strong', { text: String(number) }), el('span', { text: status })),
    el('span', { class: 'learning-board-title', text: title }));
}
const icon = (kind: 'save' | 'report') => kind === 'save' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v1"/></svg>';

export async function renderLearningWorkspace(outlet: HTMLElement, courseId: string, experience: StudentExperience, initial: LearningView, onExit?: () => void, browse?: { questions: LibraryQuestion[]; onSelect: (id: string) => void; onTest: () => unknown; onMetadata?: () => unknown }): Promise<void> {
  const api = learningApi(courseId, experience.preview);
  let state = initial; let busy = false; let library = browse?.questions ?? (await api.library()).questions; let selected = state.current?.selectedKey;
  let pending: Promise<void> = Promise.resolve(); let transitioning = false;
  const root = el('div', { class: 'learning-workspace' }); outlet.append(root);
  const errors = el('div', { role: 'status', 'aria-live': 'polite' });
  const apply = async (input: Parameters<typeof api.change>[1]) => {
    busy = true; errors.replaceChildren();
    try { state = await api.change(state.id, { ...input, revision: state.revision }); if (input.action !== 'draft') { selected = state.current?.selectedKey; draw(); } }
    catch (error) { errors.replaceChildren(errorState((error as Error).message)); if ((error as { status?: number }).status === 409) { state = await api.session(state.id); if (input.action !== 'draft') { selected = state.current?.selectedKey; draw(); } } }
    finally { busy = false; }
  };
  // Serialize draft writes before navigation/submission without replacing the reader.
  const change = (input: Omit<Parameters<typeof api.change>[1], 'revision'>) => {
    if (transitioning) return Promise.resolve();
    const transition = input.action !== 'draft'; if (transition) transitioning = true;
    const task = pending.then(() => apply({ ...input, revision: state.revision })).finally(() => { if (transition) transitioning = false; });
    pending = task.catch(error => { errors.replaceChildren(errorState((error as Error).message)); });
    return pending;
  };
  const board = () => {
    if (browse) { const popup = dialog('Question board', el('div', { class: 'learning-board-grid' }, ...browse.questions.map((q, i) => questionTile(i + 1, q.answered ? q.mistake ? 'Needs review' : 'Answered' : 'Not answered', q.stem, () => { popup.close(); browse.onSelect(q.questionId); })))); return; }
    const tiles = el('div', { class: 'learning-board-grid' }); let filter = 'all';
    const popup = dialog('Question board', el('div', { class: 'stack' }, select('Question status', [['all', 'All questions'], ['remaining', 'Remaining'], ['skipped', 'Skipped'], ['incorrect', 'Needs review']], filter, value => { filter = value; redraw(); }), tiles));
    const redraw = () => tiles.replaceChildren(...state.items.flatMap((item, i) => {
      if (filter === 'remaining' && !['unanswered', 'skipped'].includes(item.status) || filter !== 'all' && filter !== 'remaining' && item.status !== filter) return [];
      return [questionTile(i + 1, item.status, item.title, async () => { popup.close(); await change({ action: 'move', cursor: i }); })];
    })); redraw();
  };
  const footerTools = () => {
    const current = state.current; if (!current) return el('div');
    const row = library.find(q => q.questionId === current.questionId);
    const save = el('button', { class: `btn btn--ghost learning-icon${row?.saved ? ' is-saved' : ''}`, type: 'button', title: row?.saved ? 'Remove bookmark' : 'Save to Review Book', 'aria-label': row?.saved ? 'Remove bookmark' : 'Save to Review Book', 'aria-pressed': String(!!row?.saved), html: icon('save'), onclick: async () => { try { await api.metadata(current.questionId, { saved: !row?.saved }); library = (await api.library()).questions; draw(); browse?.onMetadata?.(); } catch (error) { errors.replaceChildren(errorState((error as Error).message)); } } });
    const report = el('button', { class: 'btn btn--ghost learning-icon', type: 'button', 'aria-label': 'Report a problem', title: 'Report a problem', html: icon('report'), onclick: () => {
      const text = el('textarea', { class: 'input', rows: 4, maxlength: 500, 'aria-label': 'Describe the problem', placeholder: 'What is wrong with this question?' });
      const status = el('div', { role: 'status' }); const pop = dialog('Report a problem', el('div', { class: 'stack' }, text, status, button('Submit report', async () => { try { await experience.flag(courseId, current.questionId, text.value.trim() || undefined); pop.close(); } catch (error) { status.replaceChildren(errorState((error as Error).message)); } }, 'btn btn--instr-primary')));
    } });
    return el('div', { class: 'learning-tools' }, save, report,
      state.kind === 'browse' && row ? button('Personal tags', () => {
        const tags = el('input', { class: 'input', value: row.tags.join(', '), 'aria-label': 'Personal tags', placeholder: 'Tags, separated by commas' });
        const confusing = el('input', { type: 'checkbox', ...(row.confusing ? { checked: true } : {}) });
        const status = el('div', { role: 'status' }); const pop = dialog('Personal tags', el('div', { class: 'stack' }, tags, el('label', {}, confusing, ' Still confusing'), status, button('Save tags', async () => { try { await api.metadata(row.questionId, { tags: tags.value.split(',').map(s => s.trim()).filter(Boolean), confusing: confusing.checked }); library = (await api.library()).questions; pop.close(); draw(); browse?.onMetadata?.(); } catch (error) { status.replaceChildren(errorState((error as Error).message)); } }, 'btn btn--instr-primary')));
      }) : false,
      state.kind === 'browse' ? el('a', { class: 'btn btn--ghost btn--sm', href: `${experience.routes.course(courseId)}/discussion?questionId=${current.questionId}` }, 'Ask the class') : false);
  };
  let drawnQuestionId: string | undefined;
  const draw = () => {
    const scroll = root.querySelector('.learning-question-body')?.scrollTop ?? 0;
    const listScroll = root.querySelector('.learning-list')?.scrollTop ?? 0;
    const current = state.current; const answered = state.items.filter(i => (state.kind === 'cards' ? ['remembered', 'learning'] : ['correct', 'incorrect']).includes(i.status)).length;
    root.classList.remove('is-summary');
    if (!current && state.cursor >= state.items.length) {
      const remaining = state.items.findIndex(item => remainingQuestion(item.status));
      const previous = button('← Previous question', () => change({ action: 'move', cursor: state.items.length - 1 })); previous.disabled = !state.items.length;
      const missed = state.items.filter(item => item.status === 'incorrect' || item.status === 'learning').map(item => item.questionId);
      const leading = onExit ? button('Back to Review Book', onExit) : el('a', { class: 'btn btn--ghost btn--sm', href: experience.routes.course(courseId), text: 'Course Home' });
      const primary = remaining >= 0 ? button('Return to unanswered questions', () => change({ action: 'move', cursor: remaining }), 'btn btn--instr-primary')
        : (state.kind === 'test' || state.kind === 'cards') && missed.length ? button('Review these questions again', async () => {
          if (busy) return; busy = true; errors.replaceChildren();
          try { state = await api.start({ kind: state.kind, questionIds: missed, roundId: crypto.randomUUID() }); selected = undefined; history.replaceState(null, '', `${experience.routes.reviewBook(courseId)}?session=${state.id}`); }
          catch (error) { errors.replaceChildren(errorState((error as Error).message)); }
          finally { busy = false; draw(); }
        }, 'btn btn--instr-primary') : el('a', { class: 'btn btn--instr-primary btn--sm', href: experience.routes.reviewBook(courseId), text: 'Open Review Book' });
      renderLearningSummary(root, {
        title: state.kind === 'lesson' ? 'Lesson summary' : 'Review summary',
        context: state.items[0]?.themeName ?? 'Your questions', cards: state.kind === 'cards', errors,
        questions: state.items.map((item, cursor) => ({ title: item.title, loName: item.loName, status: item.status, open: () => change({ action: 'move', cursor }) })),
        footer: el('footer', { class: 'learning-footer' }, el('div', { class: 'learning-tools' }, leading), el('div', { class: 'learning-navigation' }, previous, primary)),
      });
      return;
    }
    const list = browse ? el('div', { class: 'learning-list' }, ...browse.questions.map(q => el('button', { class: `learning-list-item${q.questionId === current?.questionId ? ' is-active' : ''}`, type: 'button', onclick: () => { browse.onSelect(q.questionId); } }, el('small', { text: `${q.themeName} · ${q.answered ? 'Answered' : 'Not answered'}` }), el('strong', { text: q.stem.slice(0, 90) })))) : el('div', { class: 'learning-list' }, ...state.items.map((item, i) => el('button', { type: 'button', class: `learning-list-item${i === state.cursor ? ' is-active' : ''}`, onclick: () => { void change({ action: 'move', cursor: i }); } }, el('small', { text: `${String(i + 1).padStart(2, '0')} · ${item.status}` }), el('strong', { text: item.title.replace(/[#*_]/g, '').slice(0, 90) }), el('small', { text: item.loName }))));
    const rail = el('aside', { class: 'learning-rail' }, el('h2', { class: 'eyebrow', text: state.kind === 'lesson' ? 'Your lesson' : state.kind === 'test' ? 'Your self-test' : 'Review questions' }), list, el('div', { class: 'learning-board-entry' }, button(`▦ Question board · ${browse?.questions.length ?? state.items.length}`, board)));
    const pane = el('section', { class: 'learning-pane' });
    const body = el('div', { class: 'learning-question-body' });
    if (!current) {
      body.append(el('h1', { text: 'Question unavailable' }), el('p', { text: 'Your instructor changed the availability of this question.' }));
    } else {
      body.append(el('p', { class: 'eyebrow', text: `Question ${state.cursor + 1} of ${state.items.length} · ${current.difficulty}` }), rich(current.stem, 'learning-stem'));
      const options = el('div', { class: 'learning-options' });
      for (const option of current.options) {
        const reveal = current.revealed?.find(r => r.key === option.key);
        const optionNode = el('button', { class: `learning-option${selected === option.key ? ' is-selected' : ''}${reveal?.correct ? ' is-correct' : ''}`, type: 'button', disabled: !!current.answer || state.kind === 'browse' || state.kind === 'cards', 'aria-pressed': String(selected === option.key), onclick: () => {
          if (transitioning) return;
          selected = option.key;
          options.querySelectorAll('button').forEach(node => { const chosen = node === optionNode; node.classList.toggle('is-selected', chosen); node.setAttribute('aria-pressed', String(chosen)); });
          const submit = root.querySelector<HTMLButtonElement>('.learning-navigation .btn--instr-primary'); if (submit) submit.disabled = false;
          void change({ action: 'draft', key: option.key });
        } }, el('span', { class: 'mono', text: option.key }), rich(option.text), reveal ? rich(reveal.explanation, 'learning-explanation') : false);
        options.append(optionNode);
      }
      body.append(options);
      if (current.answer) body.append(el('div', { class: `learning-feedback${current.answer.correct ? ' is-correct' : ''}`, role: 'status', text: current.answer.correct ? 'Correct. Continue when you are ready.' : 'Review the explanation, then continue to the next question.' }));
      else if (state.items[state.cursor].status === 'skipped') body.append(el('p', { class: 'muted', text: 'You skipped this question. You can answer it now.' }));
      if (state.kind === 'browse' || state.kind === 'cards') {
        body.append(button(current.revealed ? 'Answer shown' : 'Show answer & explanation', () => change({ action: 'reveal' })));
        if (state.kind === 'cards' && current.revealed) body.append(el('div', { class: 'row' }, button('Still learning', async () => { await change({ action: 'rate', rating: 'learning' }); await change({ action: 'move', cursor: state.cursor + 1 }); }), button('Remembered', async () => { await change({ action: 'rate', rating: 'remembered' }); await change({ action: 'move', cursor: state.cursor + 1 }); }, 'btn btn--instr-primary')));
      }
    }
    const nav = el('div', { class: 'learning-navigation' }, button('← Previous question', () => change({ action: 'move', cursor: Math.max(0, state.cursor - 1) })), button('Next question →', () => change({ action: 'move', cursor: Math.min(state.items.length, state.cursor + 1) })), state.kind === 'lesson' || state.kind === 'test' ? el('button', { class: 'btn btn--instr-primary', type: 'button', disabled: !current || !!current.answer || !selected, text: 'Submit', onclick: () => change({ action: 'submit', key: selected }) }) : false);
    (nav.firstElementChild as HTMLButtonElement).disabled = state.cursor === 0;
    (nav.children[1] as HTMLButtonElement).disabled = state.cursor >= state.items.length;
    if (browse && current) {
      const position = browse.questions.findIndex(q => q.questionId === current.questionId);
      const previous = button('← Previous question', () => browse.onSelect(browse.questions[position - 1].questionId)); previous.disabled = position <= 0;
      const next = button('Next question →', () => browse.onSelect(browse.questions[position + 1].questionId)); next.disabled = position >= browse.questions.length - 1;
      nav.replaceChildren(previous, next, button('Test this question', browse.onTest, 'btn btn--instr-primary'));
    }
    pane.append(body, errors, el('footer', { class: 'learning-footer' }, footerTools(), nav));
    const inspector = el('aside', { class: 'learning-inspector' }, el('p', { class: 'eyebrow', text: 'Progress' }), el('strong', { class: 'learning-progress', text: `${answered}/${state.items.length}` }), el('p', { class: 'muted', text: state.kind === 'cards' ? 'cards reviewed' : 'questions answered' }), el('hr'), el('strong', { text: current?.loName ?? (answered < state.items.length ? 'Questions remaining' : state.kind === 'lesson' ? 'Lesson complete' : 'Review complete') }), el('p', { class: 'muted', text: current?.themeName ?? '' }));
    if (browse && current) { const row = library.find(q => q.questionId === current.questionId); if (row) inspector.append(el('hr'), el('strong', { text: 'Your review history' }), ...[['Added to Review Book', row.addedAt], ['Last reviewed', row.lastReviewedAt], ['Last incorrect answer', row.lastIncorrectAt]].map(([label, date]) => el('div', {}, el('p', { class: 'muted', text: label }), el('span', { text: date ? new Date(date).toLocaleString() : '—' }))), el('hr'), el('strong', { text: 'Personal tags' }), el('p', { text: row.tags.join(', ') || 'No tags yet' })); }
    if (current?.note) inspector.append(el('hr'), el('strong', { text: 'Instructor notes' }), ...(current.note.text ? [rich(current.note.text)] : []), ...(current.note.materialId ? [el('a', { href: api.materialHref(state.id, current.note.pageStart), target: '_blank', rel: 'noopener', text: `Open instructor notes ↗${current.note.pageStart ? ` · pp. ${current.note.pageStart}${current.note.pageEnd ? `–${current.note.pageEnd}` : ''}` : ''}` })] : []));
    root.replaceChildren(rail, pane, inspector);
    list.scrollTop = listScroll;
    if (drawnQuestionId === current?.questionId) body.scrollTop = scroll;
    drawnQuestionId = current?.questionId;
  };
  draw();
}
export async function renderLinearLesson(outlet: HTMLElement, courseId: string, themeId: string, experience: StudentExperience) {
  const status = el('div', {}, loadingState('Loading your lesson…')); outlet.append(status);
  try { const initial = await learningApi(courseId, experience.preview).start({ kind: 'lesson', themeId }); status.remove(); await renderLearningWorkspace(outlet, courseId, experience, initial); }
  catch (error) { status.replaceChildren(errorState((error as Error).message)); }
}

export async function renderReviewLibrary(outlet: HTMLElement, courseId: string, experience: StudentExperience) {
  const api = learningApi(courseId, experience.preview); const root = el('div', { class: 'view review-library' }, loadingState('Loading Review Book…')); outlet.append(root);
  try {
    let library = (await api.library()).questions; let collection = 'all', topic = '', lo = '', tag = '', sort = 'order', search = ''; let activeId = currentQuery().get('questionId') ?? '';
    const panel = el('div', { class: 'review-reader' }); const count = el('small'); let drawToken = 0;
    const filtered = () => library.filter(q => (!topic || q.themeId === topic) && (!lo || q.loId === lo) && (!tag || q.tags.includes(tag)) && (!search || q.stem.toLowerCase().includes(search.toLowerCase())) && (collection === 'all' || collection === 'saved' && q.saved || collection === 'mistakes' && q.mistake || collection === 'confusing' && q.confusing || collection === 'unanswered' && !q.answered)).sort((a, b) => sort === 'added' ? (b.addedAt ?? '').localeCompare(a.addedAt ?? '') : sort === 'reviewed' ? (a.lastReviewedAt ?? '').localeCompare(b.lastReviewedAt ?? '') : sort === 'incorrect' ? (b.lastIncorrectAt ?? '').localeCompare(a.lastIncorrectAt ?? '') : 0);
    const startRound = async (kind: 'test' | 'cards', random = false) => {
      const qs = filtered(); if (!qs.length) return;
      const state = await api.start({ kind, questionIds: qs.map(q => q.questionId), random, roundId: crypto.randomUUID() });
      history.replaceState(null, '', `${experience.routes.reviewBook(courseId)}?session=${state.id}`);
      root.replaceChildren(); await renderLearningWorkspace(root, courseId, experience, state, async () => { history.replaceState(null, '', experience.routes.reviewBook(courseId)); root.remove(); await renderReviewLibrary(outlet, courseId, experience); });
    };
    const filters = el('div', { class: 'review-filters' });
    const tabs = el('nav', { class: 'review-tabs', 'aria-label': 'Question collections' }, ...[['all', 'All questions'], ['saved', 'Saved'], ['mistakes', 'Mistakes'], ['confusing', 'Still confusing'], ['unanswered', 'Not answered']].map(([id, text]) => button(text, () => { collection = id; tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.textContent === text))); void draw(); })));
    const searchInput = el('input', { class: 'input', placeholder: 'Search questions…', 'aria-label': 'Search questions', oninput: () => { search = searchInput.value; void draw(); } });
    const topicSelect = select('Topic', [['', 'All topics'], ...[...new Map(library.map(q => [q.themeId, q.themeName])).entries()]], topic, value => { topic = value; lo = ''; loSelect.replaceChildren(el('option', { value: '', text: 'All learning objectives' }), ...[...new Map(library.filter(q => !topic || q.themeId === topic).map(q => [q.loId, q.loName])).entries()].map(([value, text]) => el('option', { value, text }))); void draw(); });
    const loSelect = select('Learning objective', [['', 'All learning objectives'], ...[...new Map(library.map(q => [q.loId, q.loName])).entries()]], lo, value => { lo = value; void draw(); });
    const tagSelect = select('Personal tag', [['', 'All personal tags'], ...[...new Set(library.flatMap(q => q.tags))].map(t => [t, t] as [string, string])], tag, value => { tag = value; void draw(); });
    const sortSelect = select('Review order', [['order', 'Course question order'], ['added', 'Recently added'], ['reviewed', 'Least recently reviewed'], ['incorrect', 'Recent incorrect answers']], sort, value => { sort = value; void draw(); });
    filters.append(searchInput, topicSelect, loSelect, tagSelect, sortSelect, button('Clear filters', () => { collection = 'all'; topic = lo = tag = sort = search = ''; topicSelect.value = loSelect.value = tagSelect.value = ''; sortSelect.value = 'order'; searchInput.value = ''; tabs.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === 0))); void draw(); }));
    tabs.querySelector('button')?.setAttribute('aria-pressed', 'true');
    root.replaceChildren(el('header', { class: 'review-platform' },
      el('div', { class: 'review-heading' }, el('h1', { text: 'Review Book' }), count),
      el('div', { class: 'review-modes', 'aria-label': 'Review mode' }, button('Review one by one', () => { activeId = ''; void draw(); }), button('Sequential self-test', () => startRound('test')), button('Random self-test', () => startRound('test', true), 'btn btn--instr-primary'), button('Flashcards', () => startRound('cards')))), tabs, filters, panel);
    const draw = async () => {
      const token = ++drawToken; library = (await api.library()).questions; if (token !== drawToken) return; tagSelect.replaceChildren(el('option', { value: '', text: 'All personal tags' }), ...[...new Set(library.flatMap(q => q.tags))].map(t => el('option', { value: t, text: t }))); tagSelect.value = tag; const qs = filtered(); count.textContent = `${qs.length} questions`;
      if (!qs.length) { panel.replaceChildren(emptyState('No questions match this selection.')); return; }
      if (!qs.some(q => q.questionId === activeId)) activeId = qs[0].questionId;
      const state = await api.start({ kind: 'browse', questionIds: [activeId] }); if (token !== drawToken || !root.isConnected) return;
      panel.replaceChildren();
      await renderLearningWorkspace(panel, courseId, experience, state, undefined, {
        questions: qs,
        onMetadata: () => { void draw(); },
        onSelect: id => { activeId = id; void draw(); },
        onTest: async () => {
          const initial = await api.start({ kind: 'test', questionIds: [activeId], roundId: crypto.randomUUID() });
          history.replaceState(null, '', `${experience.routes.reviewBook(courseId)}?session=${initial.id}`);
          root.replaceChildren();
          await renderLearningWorkspace(root, courseId, experience, initial, async () => { history.replaceState(null, '', experience.routes.reviewBook(courseId)); root.remove(); await renderReviewLibrary(outlet, courseId, experience); });
        },
      });
    };
    const resumed = currentQuery().get('session');
    if (resumed) { const state = await api.session(resumed); root.replaceChildren(); await renderLearningWorkspace(root, courseId, experience, state, async () => { history.replaceState(null, '', experience.routes.reviewBook(courseId)); root.remove(); await renderReviewLibrary(outlet, courseId, experience); }); }
    else await draw();
  } catch (error) { root.replaceChildren(errorState((error as Error).message)); }
}
