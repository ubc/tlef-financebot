import { getCourseContentMap, getCourseTree, getCourseKnowledgeGraph, type CourseKnowledgeGraph, type ContentMapLo } from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { coverageGraph } from './coverage-graph.js';

async function renderContentMapInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const root = el('div', { class: 'view view--coverage' }, loadingState('Loading coverage…')); mount(outlet, root);
  try {
    const [map, tree] = await Promise.all([getCourseContentMap(courseId), getCourseTree(courseId)]);
    const rows = map.themes.flatMap(t => t.los.map(lo => ({ ...lo, topic: t.name, themeId: t.themeId })));
    let view = 'coverage', filter = 'all', search = '', selected = rows[0]?.loId ?? '', topic = map.themes[0]?.themeId ?? '';
    let graph: CourseKnowledgeGraph | undefined; let graphRequest = 0;
    const ready = (lo: ContentMapLo) => lo.materials.some(m => m.status === 'ready') && lo.questionCounts.approved >= 3;
    const pending = (lo: ContentMapLo) => lo.questionCounts.draft + lo.questionCounts['pending-review'] + lo.questionCounts.reviewed;
    const destination = (path: string, loId?: string) => `#/instructor/course/${encodeURIComponent(courseId)}/${path}${loId ? '?loId=' + encodeURIComponent(loId) : ''}`;
    const released = (id: string) => { const date = tree.themes.find(t => t._id === id)?.availableFrom; return !!date && Date.parse(date) <= Date.now(); };
    const actions = el('div', { class: 'coverage-switch', 'aria-label': 'Coverage view' });
    const panel = el('div');
    const tabs = el('div', { class: 'coverage-filters' });
    const input = el('input', { type: 'search', class: 'input', placeholder: 'Search objectives…', 'aria-label': 'Search objectives', oninput: () => { search = input.value; void draw(); } }) as HTMLInputElement;
    root.replaceChildren(el('div', { class: 'coverage-header' }, pageHeader('Coverage Map', 'Find gaps in your course. Know what to work on next.'), actions),
      el('div', { class: 'coverage-summary' }, el('strong', { text: `${rows.filter(ready).length} of ${rows.length} objectives meet the coverage target` }),
        el('p', { text: 'Ready linked material + at least 3 approved questions per objective. Coverage does not determine student access.' })),
      el('div', { class: 'coverage-toolbar' }, tabs, input), panel);
    async function draw(): Promise<void> {
      const request = ++graphRequest;
      actions.replaceChildren(...['coverage', 'graph'].map(v => el('button', { type: 'button', 'aria-pressed': v === view, onclick: () => { view = v; void draw(); } }, v === 'coverage' ? '▤ Coverage' : '◇ Graph')));
      tabs.replaceChildren(...[['all', 'All objectives'], ['gaps', 'Coverage gaps'], ['review', 'Ready to review']].map(([value, label]) => el('button', { type: 'button', class: 'btn btn--ghost', 'aria-pressed': filter === value, onclick: () => { filter = value; void draw(); } }, label)));
      const shown = rows.filter(lo => (filter !== 'gaps' || !ready(lo)) && (filter !== 'review' || pending(lo) > 0) && `${lo.name} ${lo.topic}`.toLowerCase().includes(search.toLowerCase()));
      if (!shown.length) { panel.replaceChildren(emptyState(rows.length ? 'No objectives match this view.' : 'Add topics and objectives in Course Structure to see their coverage.'), el('a', { class: 'btn btn--ghost', href: destination('structure'), text: 'Open Course Structure' })); return; }
      if (!shown.some(lo => lo.loId === selected)) selected = shown[0].loId;
      if (view === 'graph') {
        if (!shown.some(lo => lo.themeId === topic)) topic = shown[0].themeId;
        const select = el('select', { class: 'input', 'aria-label': 'Graph topic' }, ...map.themes.filter(t => shown.some(lo => lo.themeId === t.themeId)).map(t => el('option', { value: t.themeId, selected: t.themeId === topic, text: t.name }))) as HTMLSelectElement;
        select.onchange = () => { topic = select.value; void draw(); };
        const host = el('div', {}, loadingState('Loading graph…')); panel.replaceChildren(select, host);
        try {
          graph ??= await getCourseKnowledgeGraph(courseId);
          if (request !== graphRequest || !root.isConnected) return;
          host.replaceChildren(coverageGraph(courseId, graph, shown.filter(lo => lo.themeId === topic).map(lo => lo.loId), id => { selected = id; view = 'coverage'; void draw(); }));
        } catch (e) { if (request === graphRequest) host.replaceChildren(errorState(e instanceof Error ? e.message : String(e), () => void draw())); }
        return;
      }
      const table = el('table', { class: 'coverage-table' }, el('thead', {}, el('tr', {}, ...['Learning objective', 'Materials', 'Questions', 'Topic release'].map(text => el('th', { scope: 'col', text })))));
      const body = el('tbody'); let previous = '';
      for (const lo of shown) {
        if (previous !== lo.topic) { previous = lo.topic; body.append(el('tr', { class: 'coverage-topic-row' }, el('th', { colspan: 4, scope: 'rowgroup', text: lo.topic }))); }
        body.append(el('tr', { class: selected === lo.loId ? 'is-selected' : '' },
          el('td', {}, el('button', { type: 'button', 'aria-pressed': selected === lo.loId, onclick: () => { selected = lo.loId; topic = lo.themeId; void draw(); } }, lo.name)),
          el('td', { text: lo.materials.some(m => m.status === 'ready') ? '✓ Ready' : lo.materials.length ? 'Processing / failed' : 'Missing' }),
          el('td', {}, el('span', { text: `${lo.questionCounts.approved} / 3 approved` }), el('small', { text: `${pending(lo)} to review` })),
          el('td', { text: released(lo.themeId) ? 'Released' : 'Not released' })));
      }
      table.append(body);
      const lo = shown.find(r => r.loId === selected)!;
      const running = lo.latestGenerationRun && ['queued', 'running'].includes(lo.latestGenerationRun.status);
      const noSource = !lo.materials.some(m => m.status === 'ready');
      const path = noSource ? 'materials' : pending(lo) ? 'queue' : running ? 'preseeding' : ready(lo) ? 'bank' : 'preseeding';
      const label = noSource ? 'Review supporting materials' : pending(lo) ? 'Review questions' : running ? 'View generation' : ready(lo) ? 'View approved questions' : 'Generate questions';
      const reason = noSource ? 'Link a ready source before generating questions.' : pending(lo) ? 'Review existing questions before generating more.' : running ? 'Generation is already in progress for this objective.' : ready(lo) ? 'The coverage target is met. Release and content checks still determine student access.' : 'This objective needs more approved questions to meet the coverage target.';
      const inspector = el('aside', { class: 'coverage-inspector' }, el('small', { text: lo.topic }), el('h2', { text: lo.name }),
        el('p', { class: 'coverage-finding', text: reason }), el('p', { text: `${lo.questionCounts.approved} approved · ${pending(lo)} awaiting review` }),
        el('a', { class: 'btn btn--instr-primary', href: destination(path, path === 'materials' ? undefined : lo.loId), text: label + ' →' }),
        el('h3', { text: 'Supporting materials' }), ...lo.materials.map(m => el('p', { text: `${m.name} · ${m.status}` })),
        el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { topic = lo.themeId; view = 'graph'; void draw(); } }, 'Explore relationships →'));
      panel.replaceChildren(el('div', { class: 'coverage-layout' }, el('div', { class: 'coverage-table-wrap' }, table), inspector));
    }
    await draw();
  } catch (e) { root.replaceChildren(errorState(e instanceof Error ? e.message : String(e), () => void renderContentMapInner(outlet, courseId))); }
}
export function renderContentMap(outlet: HTMLElement, params: RouteParams): void { void renderContentMapInner(outlet, params.id); }
