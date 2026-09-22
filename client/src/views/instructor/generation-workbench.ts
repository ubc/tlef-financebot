import { attachTutorial } from '../../tutorials.js';
import {
  browseBank, enqueueGenerationPlan, getContentRun, getCourseTree, getPreseeding,
  getQuestion, listContentRuns, listMaterials, subscribeContentRuns,
  type BankQuestion, type ContentRunSummary, type CourseTreeLo, type GenerationPlanCell, type QuestionGenerationRun,
} from '../../api.js';
import { getSession } from '../../auth.js';
import { el, mount } from '../../dom.js';
import { currentQuery } from '../../router.js';
import { renderRichText } from '../../render.js';
import { rowStemText } from '../../placeholders.js';
import { errorState, loadingState } from '../../ui.js';

type Tier = 'easy' | 'medium' | 'hard';
type Submission = { submissionId: string; cells: GenerationPlanCell[]; prompt: string; runIds?: string[]; errors?: string[] };
const active = (run: ContentRunSummary) => run.status === 'running' || run.status === 'queued';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const stageName = (stage: string) => ({ queued: 'Waiting to start', retrieving: 'Finding source evidence', generating: 'Writing questions', validating: 'Checking answers', reviewing: 'Reviewing quality', persisting: 'Saving drafts', completed: 'Completed' })[stage] ?? stage.replace(/-/g, ' ');

/** Compact default authoring surface; the existing editor retains advanced tools. */
export async function renderGenerationWorkbench(outlet: HTMLElement, courseId: string): Promise<void> {
  const root = el('section', { class: 'generation-workbench' });
  mount(outlet, root); mount(root, loadingState('Preparing your question workspace…'));
  try {
    const [tree, coverage, materials, recent, queued, running] = await Promise.all([
      getCourseTree(courseId), getPreseeding(courseId), listMaterials(courseId),
      listContentRuns(courseId, { kind: 'question-generation', limit: 25 }),
      listContentRuns(courseId, { kind: 'question-generation', status: 'queued' }),
      listContentRuns(courseId, { kind: 'question-generation', status: 'running' }),
    ]);
    if (!root.isConnected) return;
    const base = `#/instructor/course/${encodeURIComponent(courseId)}`;
    const runs = new Map([...recent, ...queued, ...running].map(run => [run._id, run]));
    const objectives = [...tree.themes].sort((a,b) => a.order - b.order).flatMap(theme =>
      [...(theme.los ?? [])].sort((a,b) => a.order - b.order).map(lo => ({ ...lo, topic: theme.name, themeId: theme._id })));
    const sourcesFor = (lo: CourseTreeLo) => materials.filter(material => !material.deletedAt && material.status === 'ready' && material.assignments.some(a => a.loId === lo._id || (!a.loId && a.themeId === lo.themeId)));
    const covered = (id: string) => coverage.find(row => row.loId === id);
    const gaps = () => objectives.filter(lo => sourcesFor(lo).length && (covered(lo._id)?.approved ?? 0) + (covered(lo._id)?.unapproved ?? 0) < (covered(lo._id)?.target ?? 5));
    const query = currentQuery();
    const requested = objectives.filter(lo => sourcesFor(lo).length && (query.get('loId') === lo._id || query.get('themeId') === lo.themeId));
    const selected = new Set((requested.length ? requested : gaps()).map(lo => lo._id));
    const storageKey = `question-workbench:${getSession().user?.puid ?? 'anonymous'}:${courseId}`;
    let submission: Submission | undefined;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Submission | null;
      if (stored && typeof stored.submissionId === 'string' && Array.isArray(stored.cells) && typeof stored.prompt === 'string') submission = stored;
    } catch { /* Storage may be unavailable; in-session request identity is retained. */ }
    const persist = () => { try { if (submission) localStorage.setItem(storageKey, JSON.stringify(submission)); else localStorage.removeItem(storageKey); } catch { /* Request identity is also held in memory. */ } };
    if (submission?.runIds) {
      const restored = await Promise.allSettled(submission.runIds.filter(id => !runs.has(id)).map(id => getContentRun(courseId, id)));
      restored.forEach(result => { if (result.status === 'fulfilled') runs.set(result.value._id, result.value); });
    }
    if (!root.isConnected) return;
    let mode: 'setup' | 'live' = submission || [...runs.values()].some(active) ? 'live' : 'setup';
    let busy = false;
    let count = 3;
    let difficulty: Tier | 'balanced' = 'balanced';
    let focus: 'auto' | 'conceptual' | 'calculation' = 'auto';
    let bank: BankQuestion[] = [];
    let selectedQuestion = '';
    let previewRunId = '';
    let previewKey = '';
    let textFrame: number | undefined;
    const streamFields = new Map<HTMLElement,string>();
    const stopTextReveal = () => { if (textFrame !== undefined) cancelAnimationFrame(textFrame); textFrame = undefined; streamFields.clear(); };
    let readerRevision = 0;
    let disposed = false;
    let fetching = false;
    let refreshAgain = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const watched = () => [...runs.values()].filter(run => run.kind === 'question-generation' && (submission?.runIds ? submission.runIds.includes(run._id) : true));
    const locked = () => busy || !!submission && (!submission.runIds || submission.runIds.some(id => !runs.has(id) || active(runs.get(id)!))) || [...runs.values()].some(active);
    const link = (label: string, path: string, primary = false) => el('a', { class: primary ? 'btn btn--primary' : 'gw-link', href: path, text: label });
    const notice = el('div', { class: 'gw-notice', role: 'status', hidden: true });
    const say = (text: string) => { notice.textContent = text; notice.hidden = !text; };
    const setup = el('div', { class: 'gw-grid' });
    const live = el('div', { class: 'gw-grid gw-live' });
    const tabs = el('div', { class: 'gw-tabs', 'aria-label': 'Generation workspace views' });
    function drawTabs(): void {
      mount(tabs, ...(['setup', 'live'] as const).map(value => el('button', { type: 'button', 'aria-pressed': mode === value, onclick: () => { mode = value; showMode(); } }, value === 'setup' ? 'Create a batch' : 'Generation activity')));
    }
    function showMode(): void { setup.hidden = mode !== 'setup'; live.hidden = mode !== 'live'; drawTabs(); if (mode === 'live') { drawLive(); void refreshDrafts(); } }
    mount(root, el('header', { class: 'gw-header' }, el('div', {}, el('h1', { text: 'Generate questions' }), el('p', { text: 'Choose what to teach. Shape the practice. Review what arrives.' })), tabs), notice, setup, live);
    if (!objectives.length || !objectives.some(lo => sourcesFor(lo).length)) {
      mount(setup, el('div', { class: 'gw-empty' }, el('div', { class: 'gw-empty-mark', 'aria-hidden': 'true', text: '＋' }),
        el('h2', { text: objectives.length ? 'Give your questions a starting point' : 'Start with your learning objectives' }),
        el('p', { text: objectives.length ? 'Assign a ready course material to an objective. Your questions will be grounded in what you teach.' : 'Add the skills and concepts students should practise, then return here to create questions.' }),
        link(objectives.length ? 'Open course materials →' : 'Add learning objectives →', `${base}/${objectives.length ? 'materials' : 'structure'}`, true)));
    }

    const draftList = el('div', { class: 'gw-drafts' });
    const reader = el('article', { class: 'gw-reader', 'aria-label': 'Generated question preview' });
    const progress = el('aside', { class: 'gw-plan', 'aria-label': 'Generation progress' });
    mount(live, el('nav', { class: 'gw-objectives', 'aria-label': 'Generated drafts' }, el('div', { class: 'gw-pane-title', text: 'GENERATED QUESTIONS' }), draftList,
      el('div', { class: 'gw-pane-foot' }, link('Open review queue →', `${base}/queue`))), reader, progress);

    function cells(): GenerationPlanCell[] {
      return objectives.filter(lo => selected.has(lo._id)).flatMap(lo => {
        const result: GenerationPlanCell[] = [];
        for (let i = 0; i < count; i++) {
          const tier: Tier = difficulty === 'balanced' ? (['easy','medium','hard','easy','medium'] as Tier[])[i] : difficulty;
          const kind = focus !== 'auto' ? focus : lo.kind === 'calculation' ? 'calculation' : lo.kind === 'mixed' && i % 2 ? 'calculation' : 'conceptual';
          const existing = result.find(cell => cell.difficulty === tier && cell.kind === kind);
          if (existing) existing.count++; else result.push({ loId: lo._id, difficulty: tier, kind, count: 1 });
        }
        return result;
      });
    }
    let updateSetup = () => {};
    function buildSetup(): void {
      const objectivesList = el('div', { class: 'gw-objective-list' });
      const selectionSummary = el('p', { class: 'gw-selection' });
      const summary = el('aside', { class: 'gw-plan', 'aria-label': 'Batch summary' });
      const prompt = el('textarea', { id: 'gw-prompt', rows: 5, maxlength: 2000, placeholder: 'e.g. Use everyday situations to help students distinguish mass from weight. Include plausible misconceptions.' });
      const amount = el('output', { 'aria-live': 'polite', text: '3' });
      const minus = el('button', { type: 'button', 'aria-label': 'Fewer questions per objective', onclick: () => { count = Math.max(1,count-1); updateSetup(); } }, '−');
      const plus = el('button', { type: 'button', 'aria-label': 'More questions per objective', onclick: () => { count = Math.min(5,count+1); updateSetup(); } }, '+');
      const tiers = el('div', { class: 'gw-segments', role: 'group', 'aria-label': 'Difficulty' });
      const focusSelect = el('select', { id: 'gw-focus', onchange: () => { focus = focusSelect.value as typeof focus; updateSetup(); } },
        el('option', { value: 'auto', text: 'Match each objective' }), el('option', { value: 'conceptual', text: 'Conceptual understanding' }), el('option', { value: 'calculation', text: 'Calculation practice' }));
      const generate = el('button', { class: 'btn btn--primary', type: 'button', onclick: async () => {
        if (locked() || !selected.size) return;
        selectedQuestion = ''; previewRunId = ''; previewKey = ''; readerRevision++;
        submission = { submissionId: crypto.randomUUID(), cells: cells(), prompt: prompt.value.trim() }; persist(); await submit();
      } });
      const selections = el('div', { class: 'gw-objective-tools' }, el('button', { type: 'button', onclick: () => { selected.clear(); gaps().forEach(lo => selected.add(lo._id)); updateSetup(); } }, 'Select coverage gaps'),
        el('button', { type: 'button', onclick: () => { selected.clear(); updateSetup(); } }, 'Clear'));
      const settings = el('fieldset', { class: 'gw-settings' }, el('legend', { class: 'sr-only', text: 'Question settings' }),
        el('div', {}, el('span', { class: 'gw-label', text: 'Questions per objective' }), el('div', { class: 'gw-stepper' }, minus, amount, plus)),
        el('div', {}, el('span', { class: 'gw-label', text: 'Difficulty' }), tiers));
      mount(setup, el('aside', { class: 'gw-objectives', 'aria-label': 'Learning objectives' }, el('div', { class: 'gw-pane-title', text: 'LEARNING OBJECTIVES' }), selections, objectivesList,
        el('div', { class: 'gw-pane-foot', text: 'Existing drafts count toward coverage. You can select an objective to create additional practice.' })),
        el('div', { class: 'gw-composer' }, el('div', { class: 'gw-body' }, el('p', { class: 'gw-eyebrow', text: 'YOUR TEACHING BRIEF' }), el('h2', { text: 'What should students practise?' }),
          el('p', { class: 'gw-lead', text: 'Start with a few focused questions. We’ll use the materials assigned to each objective.' }), selectionSummary,
          el('label', { for: 'gw-prompt', class: 'gw-label', text: 'Instructions · optional' }), prompt,
          el('div', { class: 'gw-suggestions' }, ...['Concept check', 'Apply a formula', 'Spot a misconception'].map((label,index) => el('button', { type: 'button', onclick: () => { prompt.value = ['Test conceptual understanding with a familiar everyday scenario.', 'Ask students to apply a formula and interpret the result.', 'Use plausible distractors to uncover common misconceptions.'][index]; focus = index === 1 ? 'calculation' : 'conceptual'; focusSelect.value = focus; updateSetup(); prompt.focus(); } }, label))),
          settings, el('details', { class: 'gw-advanced' }, el('summary', { text: 'More control' }), el('label', { for: 'gw-focus', class: 'gw-label', text: 'Practice focus' }), focusSelect,
            el('p', {}, link('Open advanced generation →', `${base}/preseeding?advanced=1`)), el('small', { text: 'True / false, combined objectives, saved setups and detailed distributions.' }))),
          el('footer', { class: 'gw-footer' }, el('small', { text: 'New questions are saved for your review.' }), generate)), summary);
      updateSetup = () => {
        const focusKey = document.activeElement?.getAttribute('data-gw-focus');
        const isLocked = locked();
        amount.value = String(count); minus.disabled = isLocked || count === 1; plus.disabled = isLocked || count === 5;
        settings.disabled = isLocked; prompt.disabled = isLocked; focusSelect.disabled = isLocked;
        selections.querySelectorAll('button').forEach(button => { button.disabled = isLocked; });
        setup.querySelectorAll<HTMLButtonElement>('.gw-suggestions button').forEach(button => { button.disabled = isLocked; });
        mount(tiers, ...(['balanced','easy','medium','hard'] as const).map(tier => el('button', { type: 'button', 'aria-pressed': tier === difficulty, 'data-gw-focus': `tier-${tier}`, disabled: isLocked, onclick: () => { difficulty = tier; updateSetup(); } }, tier[0].toUpperCase()+tier.slice(1))));
        const scroll = objectivesList.scrollTop;
        mount(objectivesList, ...tree.themes.flatMap(theme => [el('h3', { class: 'gw-topic', text: theme.name }), ...(objectives.filter(lo => lo.themeId === theme._id).map(lo => {
          const ready = sourcesFor(lo).length > 0;
          const checkbox = el('input', { type: 'checkbox', 'data-gw-focus': `lo-${lo._id}`, checked: selected.has(lo._id), disabled: isLocked || !ready, onchange: () => { if (checkbox.checked) selected.add(lo._id); else selected.delete(lo._id); updateSetup(); } });
          return el('label', { class: `gw-objective${selected.has(lo._id) ? ' is-selected' : ''}` }, checkbox, el('span', {}, el('strong', { text: lo.name }), el('small', { text: ready ? `${covered(lo._id)?.approved ?? 0} approved · ${covered(lo._id)?.unapproved ?? 0} awaiting review` : 'Assign a ready source to select' })));
        }))]));
        objectivesList.scrollTop = scroll;
        if (focusKey) setup.querySelector<HTMLElement>(`[data-gw-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
        selectionSummary.textContent = `${selected.size} ${selected.size === 1 ? 'objective' : 'objectives'} selected · ${count} ${count === 1 ? 'question' : 'questions'} each`;
        const total = count * selected.size;
        generate.textContent = isLocked ? 'Generation in progress' : `Generate ${total} ${total === 1 ? 'question' : 'questions'} →`;
        generate.disabled = isLocked || !total || cells().length > 120;
        const selectedSources = materials.filter(m => objectives.some(lo => selected.has(lo._id) && sourcesFor(lo).some(s => s._id === m._id)));
        mount(summary, el('h3', { text: 'YOUR BATCH' }), el('div', { class: 'gw-total' }, String(total), el('small', { text: total === 1 ? 'question' : 'questions' })), el('p', { class: 'gw-lead', text: `Across ${selected.size} learning ${selected.size === 1 ? 'objective' : 'objectives'}` }),
          el('div', { class: 'gw-fact' }, 'Format', el('strong', { text: 'Multiple choice' })), el('div', { class: 'gw-fact' }, 'Difficulty', el('strong', { text: difficulty === 'balanced' ? 'Mixed difficulty' : difficulty })),
          el('div', { class: 'gw-fact' }, 'Practice focus', el('strong', { text: focus === 'auto' ? 'Match each objective' : focus === 'conceptual' ? 'Conceptual understanding' : 'Calculation practice' })),
          el('div', { class: 'gw-sources' }, el('h3', { text: 'SOURCE MATERIALS' }), ...selectedSources.map(source => el('p', {}, el('span', { text: source.name }), el('small', { text: 'Ready · assigned material' }))), !selectedSources.length && el('p', { text: 'Select an objective to see its sources.' })),
          el('p', { class: 'gw-plan-note', text: 'You decide what students see. Generated drafts require approval and topic release.' }),
          cells().length > 120 && el('p', { text: 'Choose fewer objectives for this batch.' }));
      };
      updateSetup();
    }

    async function submit(): Promise<void> {
      if (busy || !submission) return;
      busy = true; updateSetup(); say('Starting your batch…');
      const current = submission;
      try {
        const result = await enqueueGenerationPlan(courseId, current.cells, { submissionId: current.submissionId, prompt: current.prompt });
        current.runIds = result.runs.flatMap(row => row.runId ? [row.runId] : []);
        current.errors = result.runs.flatMap(row => row.error ? [`${objectives.find(lo => lo._id === row.loId)?.name ?? 'Objective'}: ${row.error}`] : []);
        persist();
        const snapshots = await Promise.allSettled(current.runIds.map(id => getContentRun(courseId,id)));
        snapshots.forEach(result => { if (result.status === 'fulfilled' && (runs.get(result.value._id)?.revision ?? -1) < result.value.revision) runs.set(result.value._id,result.value); });
        say(current.errors.length ? `${current.errors.length} parts could not start. See generation activity for details.` : 'Your batch has started. Saved questions will appear here as they arrive.');
      } catch (error) {
        say(`We could not confirm the request. Recover this batch to check it safely without creating duplicates. ${message(error)}`);
      } finally {
        busy = false;
        if (!disposed) { mode = 'live'; showMode(); updateSetup(); }
      }
    }

    function openTimeline(run: ContentRunSummary): void {
      const opener = document.activeElement as HTMLElement | null;
      const body = el('div', { class: 'gw-timeline-body' });
      const dialog = el('dialog', { class: 'app-dialog gw-timeline', 'aria-labelledby': 'gw-timeline-title' });
      const close = () => { dialog.close(); dialog.remove(); opener?.focus(); };
      const refresh = async () => {
        mount(body, loadingState('Loading saved steps…'));
        try {
          const snapshot = await getContentRun(courseId,run._id);
          if (!dialog.isConnected) return;
          mount(body, el('ol', {}, ...snapshot.events.map(event => el('li', {},
            el('strong', { text: stageName(event.stage) }), el('time', { text: new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
            el('p', { text: event.message ?? `${event.status} · ${event.completedUnits} processed` })))));
        } catch (error) { if (dialog.isConnected) mount(body,errorState(message(error))); }
      };
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      mount(dialog, el('h2', { id: 'gw-timeline-title', text: 'Generation steps' }), el('p', { class: 'gw-plan-note', text: 'Recorded activity and check results for this task.' }), body,
        el('div', { class: 'gw-footer' }, el('button', { type: 'button', class: 'btn btn--ghost', onclick: refresh, text: 'Refresh' }), el('button', { type: 'button', class: 'btn btn--primary', onclick: close, text: 'Close' })));
      root.append(dialog); dialog.showModal(); void refresh();
    }
    function sourceRun(question: BankQuestion): QuestionGenerationRun | undefined {
      return watched().find((run): run is QuestionGenerationRun => run.kind === 'question-generation' && (
        run.result?.createdQuestionIds.includes(question.id) === true ||
        (question.current.provenance?.kind === 'generated' && question.current.provenance.runId === run._id)));
    }
    function drawLive(): void {
      if (disposed) return;
      const focusKey = document.activeElement?.getAttribute('data-gw-focus');
      const listScroll = draftList.scrollTop;
      const items = watched();
      const streaming = items.filter((run): run is QuestionGenerationRun => run.kind === 'question-generation' && !!run.preview && active(run));
      const drafts = bank.filter(question => sourceRun(question));
      mount(draftList, ...streaming.filter(run => !drafts.some(q => q.current.provenance?.kind === 'generated' && q.current.provenance.runId === run._id && q.current.provenance.item === run.preview?.item)).map(run => el('button', { type: 'button', 'data-gw-focus': `preview-${run._id}`, 'aria-current': !selectedQuestion && previewRunId === run._id ? 'true' : 'false', onclick: () => { selectedQuestion = ''; previewRunId = run._id; readerRevision++; drawLive(); } },
        el('span', { text: `${run.stage === 'generating' ? 'Writing now' : 'Checking draft'} · question ${(run.preview?.item ?? 0)+1}` }), el('strong', { text: run.preview?.stem || objectives.find(lo => lo._id === run.input.loId)?.name || 'Preparing question…' }), el('small', { text: 'Live draft · not yet checked' }))), ...drafts.map((q,index) => el('button', { type: 'button', 'data-gw-focus': `question-${q.id}`, 'aria-current': q.id === selectedQuestion ? 'true' : 'false', onclick: () => { void showQuestion(q); } },
        el('span', { text: `${String(index+1).padStart(2,'0')} · ${q.current.difficulty}` }), el('strong', { text: rowStemText(q) }), el('small', { text: q.state === 'approved' ? 'Approved' : 'Saved · ready to review' }))),
        !drafts.length && !streaming.length && el('p', { class: 'gw-placeholder', text: items.some(active) ? 'Your first question will appear here once its checks are complete and it is saved.' : 'Saved questions from your recent generation will appear here.' }));
      if (!selectedQuestion) {
        const preview = streaming.find(run => run._id === previewRunId) ?? streaming[0];
        const saved = preview && drafts.find(q => q.current.provenance?.kind === 'generated' && q.current.provenance.runId === preview._id && q.current.provenance.item === preview.preview?.item);
        if (saved) void showQuestion(saved);
        else if (preview) { previewRunId = preview._id; drawPreview(preview); }
        else if (drafts[0]) void showQuestion(drafts[0]);
      }
      if (!drafts.length && !selectedQuestion && !streaming.length) mount(reader, el('div', { class: 'gw-waiting' }, el('span', { class: items.some(active) ? 'gw-live-dot' : 'gw-empty-mark', 'aria-hidden': 'true', text: items.some(active) ? '' : '＋' }), el('h2', { text: items.some(active) ? 'Your questions are taking shape' : 'Ready for your next batch' }),
        el('p', { text: items.some(active) ? 'Follow the checks on the right. You can review completed questions while the rest of the batch runs.' : 'Choose learning objectives and a short teaching brief to begin.' }), link('Open review queue →', `${base}/queue`)));
      const completed = items.reduce((sum,run) => sum + (run.kind === 'question-generation' ? run.result?.createdQuestionIds.length ?? 0 : 0),0);
      const total = submission ? submission.cells.reduce((sum,cell) => sum+cell.count,0) : items.reduce((sum,run) => sum+(run.totalUnits ?? (run.kind === 'question-generation' ? run.input.count : 0)),0);
      mount(progress, el('h3', { text: 'GENERATION ACTIVITY' }), el('div', { class: 'gw-total' }, String(completed), el('small', { text: `/ ${total} saved` })),
        el('progress', { max: Math.max(total,1), value: completed, 'aria-label': 'Questions saved' }),
        el('p', { class: 'gw-plan-note', text: items.some(active) ? 'You can leave this page. Generation continues in the background.' : 'Drafts stay private until you approve and release them.' }),
        submission && !submission.runIds && el('button', { type: 'button', class: 'btn btn--primary', disabled: busy, onclick: submit, text: 'Recover this batch' }),
        ...(submission?.errors ?? []).map(error => el('p', { class: 'gw-run-error', text: error })),
        ...items.map(run => el('div', { class: 'gw-run' }, el('strong', { text: run.kind === 'question-generation' ? objectives.find(lo => lo._id === run.input.loId)?.name ?? 'Learning objective' : '' }),
          el('span', { text: `${run.status === 'completed' ? 'Completed' : run.status === 'failed' ? 'Stopped / failed' : run.status === 'partial' ? 'Partially completed' : stageName(run.stage)} · ${run.completedUnits}/${run.totalUnits ?? '?'} processed` }),
          run.error && el('small', { class: 'gw-run-error', text: run.error.message }),
          el('button', { class: 'gw-step-link', type: 'button', 'data-gw-focus': `steps-${run._id}`, onclick: () => openTimeline(run), text: 'View steps' }))),
        link('Manage runs & retries →', `${base}/preseeding?advanced=1`),
        !!submission?.runIds?.length && el('button', { type: 'button', class: 'gw-step-link', onclick: async () => {
          const refreshed = await Promise.allSettled(submission!.runIds!.map(id => getContentRun(courseId,id)));
          if (disposed) return;
          refreshed.forEach(result => { if (result.status === 'fulfilled') applyRun(result.value); });
          say(refreshed.some(result => result.status === 'rejected') ? 'Some task statuses could not refresh. Try again when your connection returns.' : 'Batch status refreshed.');
          drawLive(); void refreshDrafts();
        }, text: 'Refresh batch status' }),
        submission?.runIds && !locked() && el('button', { type: 'button', class: 'btn btn--ghost', onclick: async () => {
          submission = undefined; persist(); mode = 'setup';
          try { const fresh = await getPreseeding(courseId); coverage.splice(0,coverage.length,...fresh); } catch { say('Could not refresh coverage. Check existing drafts before generating more.'); }
          if (!disposed) { selected.clear(); gaps().forEach(lo => selected.add(lo._id)); updateSetup(); showMode(); }
        }, text: 'Create another batch' }));
      draftList.scrollTop = listScroll;
      if (focusKey) live.querySelector<HTMLElement>(`[data-gw-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    }
    function drawPreview(run: QuestionGenerationRun): void {
      const preview = run.preview!;
      const key = `${run._id}:${preview.item}:${preview.attempt}`;
      if (previewKey !== key || !reader.querySelector('.gw-stream-text')) {
        stopTextReveal();
        previewKey = key;
        mount(reader, el('div', { class: 'gw-body' }, el('p', { class: 'gw-eyebrow', text: `LIVE DRAFT · QUESTION ${preview.item+1} · NOT YET CHECKED` }),
          el('p', { class: 'gw-plan-note', text: objectives.find(lo => lo._id === run.input.loId)?.name ?? '' }),
          el('div', { class: 'gw-stream-text gw-stem', 'aria-label': 'Live question text' }),
          el('p', { class: 'gw-stream-meta gw-plan-note', hidden: true }),
          el('section', { class: 'gw-stream-options', 'aria-label': 'Live answer choices' }),
          el('p', { class: 'gw-stream-status gw-plan-note', role: 'status' })),
          el('footer', { class: 'gw-footer' }, el('small', { text: 'Draft text can change during checks. Approval becomes available after the question is saved.' })));
      }
      const text = reader.querySelector<HTMLElement>('.gw-stream-text')!;
      streamFields.set(text,preview.stem);
      const meta = reader.querySelector<HTMLElement>('.gw-stream-meta')!;
      meta.hidden = !preview.difficulty;
      meta.textContent = preview.difficulty ? `Suggested difficulty: ${preview.difficulty}` : '';
      const options = reader.querySelector<HTMLElement>('.gw-stream-options')!;
      const incoming = preview.options ?? [];
      while (options.children.length > incoming.length) options.lastElementChild?.remove();
      incoming.forEach((option,index) => {
        let row = options.children[index] as HTMLElement | undefined;
        if (!row) {
          row = el('div', { class: 'gw-answer gw-stream-option' }, el('span', { class: 'gw-option-key' }),
            el('div', { class: 'gw-option-body' }, el('div', { class: 'gw-option-text', 'aria-label': `Live option ${index+1}` }),
              el('small', { class: 'gw-option-role' }), el('div', { class: 'gw-option-explanation', 'aria-label': `Live explanation ${index+1}` })));
          options.append(row);
        }
        row.querySelector<HTMLElement>('.gw-option-key')!.textContent = option.key || String(index+1);
        streamFields.set(row.querySelector<HTMLElement>('.gw-option-text')!,option.text);
        const explanation = row.querySelector<HTMLElement>('.gw-option-explanation')!;
        explanation.hidden = !option.explanation;
        streamFields.set(explanation,option.explanation ?? '');
        row.classList.toggle('is-proposed',option.role === 'correct');
        const role = row.querySelector<HTMLElement>('.gw-option-role')!;
        const labels: Record<string,string> = { correct: 'Proposed correct answer · unverified', 'clearly-wrong': 'Distractor', 'partially-correct': 'Partially correct', 'common-misconception': 'Common misconception' };
        role.textContent = labels[option.role ?? ''] ?? ''; role.hidden = !role.textContent;
      });
      for (const node of streamFields.keys()) if (!node.isConnected) streamFields.delete(node);
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion) {
        if (textFrame !== undefined) cancelAnimationFrame(textFrame);
        textFrame = undefined;
        streamFields.forEach((target,node) => { node.textContent = target; });
      } else if (textFrame === undefined) {
        const reveal = () => {
          textFrame = undefined;
          if (disposed || !text.isConnected) return;
          let pending = false;
          streamFields.forEach((target,node) => {
            if (!node.isConnected || node.textContent === target) return;
            const shown = node.textContent ?? '';
            const prefix = target.startsWith(shown) ? Array.from(shown).length : 0;
            const characters = Array.from(target);
            node.textContent = characters.slice(0,prefix+Math.max(3,Math.ceil((characters.length-prefix)/12))).join('');
            if (node.textContent !== target) pending = true;
          });
          if (pending) textFrame = requestAnimationFrame(reveal);
        };
        textFrame = requestAnimationFrame(reveal);
      }
      text.classList.toggle('is-writing', run.stage === 'generating');
      const status = reader.querySelector<HTMLElement>('.gw-stream-status')!;
      const label = run.stage === 'generating' ? preview.options?.length ? 'Receiving answer choices and explanations…' : preview.stem ? 'Receiving question text…' : 'Waiting for the model to start the question…' : `${stageName(run.stage)}. This draft is not ready for approval yet.`;
      if (status.textContent !== label) status.textContent = label;
    }
    async function showQuestion(question: BankQuestion): Promise<void> {
      stopTextReveal();
      selectedQuestion = question.id;
      const revision = ++readerRevision;
      drawLive();
      const content = el('div', { class: 'gw-body' });
      const rich = (text: string, className: string) => { const node = el('div', { class: className }); renderRichText(node,text); return node; };
      mount(content, el('p', { class: 'gw-eyebrow', text: `${question.current.type === 'mcq' ? 'MULTIPLE CHOICE' : 'TRUE / FALSE'} · ${question.current.difficulty} · ${question.state}` }),
        rich(rowStemText(question),'gw-stem'),
        ...((question.sample?.options ?? question.current.options) ?? []).map(option => el('div', { class: `gw-answer${question.current.options?.find(original => original.key === option.key)?.role === 'correct' ? ' is-correct' : ''}` }, el('span', { text: option.key }), el('div', {}, rich(option.text,''), question.current.options?.find(original => original.key === option.key)?.role === 'correct' && el('small', { text: 'Correct answer' }), option.explanation && rich(option.explanation,'gw-option-explanation')))),
        !question.sample && el('p', { class: 'gw-plan-note', text: 'Authoring preview. Parameterized questions may show template variables; inspect a student example in the full editor.' }));
      const assessment = el('div', { class: 'gw-assessment' }); content.append(assessment);
      mount(reader, content, el('footer', { class: 'gw-footer' }, el('small', { text: 'Review the answer and evidence before approving.' }), link('Review questions →', `${base}/queue?runId=${encodeURIComponent(sourceRun(question)?._id ?? '')}`, true)));
      try {
        const detail = await getQuestion(question.id);
        if (disposed || revision !== readerRevision) return;
        if (detail.currentVersionId !== question.current._id) { assessment.textContent = 'This question has changed. Open Review Queue to see the current version.'; return; }
        if (detail.agentDecision) mount(assessment, el('h3', { text: detail.agentDecision.decision === 'pass' ? 'AI quality check passed' : detail.agentDecision.decision === 'flag' ? 'AI flagged this question' : 'AI recommends rejection' }), rich(detail.agentDecision.reasoning,''), detail.agentDecision.roleAssessment && el('details', {}, el('summary', { text: 'Answer checks' }), rich(detail.agentDecision.roleAssessment,'')));
        else assessment.textContent = 'AI assessment is not available. Review this question yourself.';
      } catch { if (!disposed && revision === readerRevision) assessment.textContent = 'Assessment could not load. Open Review Queue to try again.'; }
    }
    async function refreshDrafts(): Promise<void> {
      if (disposed) return;
      if (fetching) { refreshAgain = true; return; }
      fetching = true;
      try { const result = await browseBank(courseId); if (!disposed) { bank = result.questions; drawLive(); } }
      catch { if (!disposed) say('Draft previews could not refresh. Your generation is still tracked; open Review Queue or refresh this page.'); }
      finally { fetching = false; if (refreshAgain && !disposed) { refreshAgain = false; scheduleRefresh(); } }
    }
    function scheduleRefresh(): void {
      if (refreshTimer || disposed) return;
      refreshTimer = setTimeout(() => { refreshTimer = undefined; void refreshDrafts(); }, 700);
    }
    function applyRun(run: ContentRunSummary): void {
      if (disposed || run.kind !== 'question-generation' || run.courseId !== courseId) return;
      const previous = runs.get(run._id);
      if (previous && previous.revision >= run.revision) return;
      runs.set(run._id,run); updateSetup(); if (mode === 'live') drawLive();
      if (!previous || run.completedUnits !== previous.completedUnits || !active(run)) scheduleRefresh();
    }
    if (objectives.some(lo => sourcesFor(lo).length)) buildSetup();
    showMode();
    if (submission && !submission.runIds) say('A previous request needs confirmation. Recover the same batch below to avoid duplicate questions.');
    attachTutorial(root, 'instructor-generation', { 'generation-scope': '.gw-objectives', 'generation-actions': '.gw-footer' });
    const unsubscribe = subscribeContentRuns(courseId, { onSnapshot: snapshot => { if (notice.textContent?.startsWith('Live connection')) say('Live connection restored.'); snapshot.forEach(applyRun); scheduleRefresh(); }, onRun: applyRun,
      onError: () => { if (!disposed) say('Live connection interrupted. Reconnecting automatically; saved drafts and generation are preserved.'); } });
    const observer = new MutationObserver(() => {
      if (!root.isConnected) { disposed = true; stopTextReveal(); unsubscribe(); observer.disconnect(); if (refreshTimer) clearTimeout(refreshTimer); }
    });
    observer.observe(outlet, { childList: true });
  } catch (error) {
    if (root.isConnected) mount(root, errorState(message(error), () => { void renderGenerationWorkbench(outlet,courseId); }));
  }
}
