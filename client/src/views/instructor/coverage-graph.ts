import { getMaterialWorkspaceDetail, materialSourceUrl, getQuestion, type CourseKnowledgeGraph, type KnowledgeGraphNode } from '../../api.js';
import { el } from '../../dom.js';
import { errorState, loadingState } from '../../ui.js';
import { renderRichText } from '../../render.js';

export async function previewEvidence(courseId: string, materialId: string, chunkIndex?: number, quote?: string): Promise<void> {
  const dialog = el('dialog', { class: 'app-dialog coverage-source', 'aria-label': 'Source evidence preview' }) as HTMLDialogElement;
  const content = el('div', { class: 'coverage-source__body' }, loadingState('Loading source…'));
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.append(el('header', {}, el('h2', { text: 'Source evidence' }), el('button', { type: 'button', class: 'btn btn--ghost', onclick: close }, 'Close')), content);
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  document.body.append(dialog); dialog.showModal();
  try {
    const detail = await getMaterialWorkspaceDetail(courseId, materialId);
    if (!dialog.isConnected) return;
    const chunks = detail.chunks.length ? detail.chunks : detail.material.excerpt ? [{ index: 0, text: detail.material.excerpt, characterCount: detail.material.excerpt.length }] : [];
    const matched = quote ? chunks.find(c => c.text.includes(quote)) : chunks.find(c => c.index === chunkIndex);
    const target = matched?.index;
    const original = el('a', { class: 'btn btn--instr-primary', href: materialSourceUrl(courseId, materialId), target: '_blank', rel: 'noopener', text: 'Open original file ↗' });
    content.replaceChildren(el('div', { class: 'coverage-source__intro' }, el('h3', { text: detail.material.name }), original,
      el('p', { text: 'Extracted source text. Highlighting identifies the stored evidence; original document page coordinates are not available.' })));
    if ((quote || chunkIndex !== undefined) && !matched) content.append(el('p', { role: 'status', text: 'The referenced passage could not be matched to the current extracted text. No approximate match has been highlighted.' }));
    if (!chunks.length) content.append(el('p', { text: 'No extracted text is available. Open the original file to inspect this source.' }));
    for (const chunk of chunks) {
      const passage = el('p', { class: 'coverage-source__text' });
      if (chunk.index === target && quote) {
        const at = chunk.text.indexOf(quote);
        passage.append(document.createTextNode(chunk.text.slice(0, at)), el('mark', { text: quote }), document.createTextNode(chunk.text.slice(at + quote.length)));
      } else if (chunk.index === target) passage.append(el('mark', { text: chunk.text }));
      else passage.textContent = chunk.text;
      content.append(el('section', { class: 'coverage-source__chunk' }, el('h4', { text: `Evidence ${chunk.index + 1}` }), passage));
    }
    content.querySelector('mark')?.scrollIntoView({ block: 'center' });
  } catch (e) { if (dialog.isConnected) content.replaceChildren(errorState(e instanceof Error ? e.message : String(e))); }
}

export function coverageGraph(courseId: string, graph: CourseKnowledgeGraph, focusLoIds: string[], onObjective: (id: string) => void): HTMLElement {
  const root = el('section', { class: 'coverage-graph' });
  const inspector = el('aside', { class: 'coverage-inspector', 'aria-label': 'Node details' }, el('h2', { text: 'Explore relationships' }), el('p', { text: 'Select a node to inspect its details and connected evidence.' }));
  const canvas = el('div', { class: 'coverage-graph__canvas' });
  const viewport = el('div', { class: 'coverage-graph__viewport', tabindex: 0, 'aria-label': 'Relationship graph. Scroll to explore.' }, canvas);
  let revision = 0;
  const relevant = new Set(focusLoIds.map(id => `lo:${id}`));
  // Expand incoming ancestors and outgoing assessed questions, never traverse a
  // shared source back into every other objective in the course.
  for (const edge of graph.edges) if (relevant.has(edge.source) && edge.type === 'assesses') relevant.add(edge.target);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) if (relevant.has(edge.target) && edge.type !== 'sourced-from' && !relevant.has(edge.source)) { relevant.add(edge.source); changed = true; }
  }
  for (const edge of graph.edges) if (relevant.has(edge.source) && edge.type === 'sourced-from') relevant.add(edge.target);
  for (const edge of graph.edges) if (relevant.has(edge.source) && edge.type === 'contains' && edge.target.startsWith('evidence:')) relevant.add(edge.target);
  const nodes = focusLoIds.length ? graph.nodes.filter(n => relevant.has(n.id)) : graph.nodes;
  const ids = new Set(nodes.map(n => n.id));
  const edges = graph.edges.filter(e => ids.has(e.source) && ids.has(e.target));
  const types = ['material', 'evidence', 'concept', 'topic', 'lo', 'question'];
  const positions = new Map<string, { x: number; y: number }>();
  let height = 450;
  types.forEach((type, col) => {
    canvas.append(el('div', { class: 'coverage-graph__column', style: `left:${24 + col * 225}px`, text: type === 'lo' ? 'Learning objectives' : type }));
    nodes.filter(n => n.type === type).forEach((n, i) => { positions.set(n.id, { x: 24 + col * 225, y: 62 + i * 110 }); height = Math.max(height, 172 + i * 110); });
  });
  canvas.style.width = '1380px'; canvas.style.height = `${height}px`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '1380'); svg.setAttribute('height', String(height)); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('coverage-graph__edges');
  const paths = edges.map(edge => {
    const a = positions.get(edge.source)!, b = positions.get(edge.target)!;
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', `M ${a.x + 190} ${a.y + 35} C ${a.x + 215} ${a.y + 35}, ${b.x - 25} ${b.y + 35}, ${b.x} ${b.y + 35}`);
    svg.append(path); return { edge, path };
  });
  canvas.append(svg);
  async function inspect(node: KnowledgeGraphNode): Promise<void> {
    const request = ++revision;
    const connected = new Set([node.id]);
    // Directed ancestors + descendants, without switching direction at shared nodes.
    for (const direction of ['source', 'target'] as const) {
      const branch = new Set([node.id]); let grow = true;
      while (grow) { grow = false; for (const e of edges) {
        if (e.type === 'sourced-from') continue;
        const from = e[direction], to = e[direction === 'source' ? 'target' : 'source'];
        if (branch.has(from) && !branch.has(to)) { branch.add(to); grow = true; }
      } }
      branch.forEach(id => connected.add(id));
    }
    paths.forEach(({ edge, path }) => path.classList.toggle('is-traced', connected.has(edge.source) && connected.has(edge.target)));
    canvas.querySelectorAll<HTMLButtonElement>('[data-node]').forEach(b => { b.classList.toggle('is-dimmed', !connected.has(b.dataset.node!)); b.setAttribute('aria-pressed', String(b.dataset.node === node.id)); });
    inspector.replaceChildren(el('small', { text: node.type.toUpperCase() }), el('h2', { text: node.label }), el('p', { text: node.subtitle ?? '' }));
    const extra = el('div'); inspector.append(extra);
    if (node.trashed) extra.append(el('p', { text: 'This source is in Trash. Its provenance is retained; restore it in Course Materials before using it again.' }));
    const action = (text: string, callback: () => void | Promise<void>) => el('button', { type: 'button', class: 'btn btn--instr-primary', onclick: callback }, text);
    if (node.materialId && !node.trashed) {
      const chunkIndex = node.type === 'evidence' ? Number(node.id.split(':').slice(-1)[0]) : undefined;
      extra.append(action(node.type === 'evidence' ? 'Preview highlighted evidence' : 'Preview source text', () => previewEvidence(courseId, node.materialId!, chunkIndex)),
        el('a', { class: 'btn btn--ghost', href: materialSourceUrl(courseId, node.materialId), target: '_blank', rel: 'noopener', text: 'Open original file ↗' }));
    }
    if (node.type === 'lo') extra.append(action('View objective coverage', () => onObjective(node.id.slice(3))));
    if (node.type === 'topic') extra.append(el('a', { class: 'btn btn--ghost', href: `#/instructor/course/${courseId}/structure`, text: 'Open Course Structure' }));
    const links = edges.filter(e => e.source === node.id || e.target === node.id);
    extra.append(el('h3', { text: 'Connections' }), ...links.map(e => {
      const neighbor = nodes.find(n => n.id === (e.source === node.id ? e.target : e.source))!;
      return el('button', { class: 'coverage-connection', type: 'button', onclick: () => inspect(neighbor) }, `${e.label ?? e.type} · ${neighbor.label}`);
    }));
    if (node.type === 'concept') extra.append(el('p', { text: 'Concept relationships reflect extracted concepts and source assignments; they are not a claim that every question used this passage.' }));
    if (node.type === 'question') {
      const detail = el('div', {}, loadingState('Loading question…')); extra.prepend(detail);
      try {
        const q = await getQuestion(node.id.slice('question:'.length));
        if (request !== revision || !root.isConnected) return;
        const stem = el('div'); renderRichText(stem, q.current.stem);
        detail.replaceChildren(stem, ...q.current.options.map(o => { const item = el('div', { class: 'coverage-question-option' }); renderRichText(item, `${o.key}. ${o.text}\n\n${o.explanation ?? ''}`); return item; }));
        detail.append(el('h3', { text: 'Recorded source references' }));
        for (const ref of q.current.sourceRefs) detail.append(action(ref.chunk ? 'View quoted evidence' : 'View source', () => previewEvidence(courseId, ref.materialId, undefined, ref.chunk)));
        if (!q.current.sourceRefs.length) detail.append(el('p', { text: 'No source references were recorded for this version.' }));
      } catch (e) { if (request === revision) detail.replaceChildren(errorState(e instanceof Error ? e.message : String(e))); }
    }
  }
  nodes.forEach(node => { const p = positions.get(node.id)!; canvas.append(el('button', { type: 'button', class: 'coverage-graph__node', 'data-node': node.id, style: `left:${p.x}px;top:${p.y}px`, onclick: () => inspect(node) }, el('small', { text: node.type }), el('strong', { text: node.label }))); });
  const zoom = el('input', { type: 'range', min: '50', max: '125', value: '85', 'aria-label': 'Graph zoom', oninput: () => { canvas.style.setProperty('zoom', String(Number(zoom.value) / 100)); } }) as HTMLInputElement;
  canvas.style.setProperty('zoom', '.85');
  root.append(el('div', { class: 'coverage-graph__tools' }, el('span', { text: 'Select a node to inspect its evidence and connections.' }), el('label', {}, 'Zoom ', zoom)), el('div', { class: 'coverage-graph__layout' }, viewport, inspector));
  if (graph.truncated) root.prepend(el('p', { class: 'coverage-note', text: 'Graph overview includes up to four evidence chunks per source. Source preview contains every stored chunk.' }));
  if (!nodes.length) viewport.replaceChildren(el('p', { text: 'No graph relationships are available for this selection.' }));
  return root;
}
