import {
  ApiError,
  assignMaterial,
  getCourseKnowledgeGraph,
  getCourseTree,
  getMaterialWorkspaceDetail,
  getSuggestedHierarchy,
  listContentRuns,
  listMaterials,
  listTrashedMaterials,
  materialSourceUrl,
  resolveClassification,
  restoreMaterial,
  retryMaterial,
  subscribeContentRuns,
  trashMaterial,
  updateMaterialKind,
  uploadMaterials,
  addUrlMaterial,
  type ContentRunSummary,
  type CourseKnowledgeGraph,
  type CourseTree,
  type Material,
  type MaterialAssignment,
  type MaterialKind,
  type MaterialWorkspaceDetail,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { uploadZone } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { assignmentSummary, classificationLabel } from './material-assign.js';

const INGEST_STAGES = ['queued', 'parsing', 'chunking', 'embedding', 'indexing', 'classifying'] as const;
const MATERIAL_KINDS: MaterialKind[] = [
  'lecture',
  'reading',
  'assignment',
  'assessment',
  'solution',
  'reference',
  'other',
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function navigate(path: string): void {
  window.location.hash = path;
}

export function materialErrorMessage(message: string): string {
  const code = message.split(':')[0] ?? message;
  if (code === 'blocked-url') return 'This URL points to a private or local address. Use a public HTTPS URL or upload the file.';
  if (code === 'qdrant-vector-size-mismatch') return 'The vector database was created for a different embedding model. An administrator must migrate it before this can be retried.';
  if (code === 'unsupported-format') return 'Upload a PDF, Word, PowerPoint, text, or Markdown file.';
  return message;
}

function buildAssignChecklist(
  tree: CourseTree,
  initial: MaterialAssignment[],
): { element: HTMLElement; getSelected: () => MaterialAssignment[] } {
  const key = (themeId: string, loId: string): string => `${themeId}:${loId}`;
  const selected = new Set(initial.filter((item) => item.loId).map((item) => key(item.themeId, item.loId!)));
  const blocks = tree.themes.map((theme) =>
    el(
      'div',
      { class: 'workspace-assignment__topic' },
      el('p', { class: 'workspace-assignment__topic-name', text: theme.name }),
      ...(theme.los ?? []).map((lo) => {
        const itemKey = key(theme._id, lo._id);
        const checkbox = el('input', {
          type: 'checkbox',
          checked: selected.has(itemKey) ? 'checked' : undefined,
          onchange: (event: Event) => {
            if ((event.target as HTMLInputElement).checked) selected.add(itemKey);
            else selected.delete(itemKey);
          },
        });
        return el('label', { class: 'workspace-assignment__lo' }, checkbox, el('span', { text: lo.name }));
      }),
    ),
  );
  return {
    element: el('div', { class: 'workspace-assignment' }, ...blocks),
    getSelected: () =>
      [...selected].map((item) => {
        const [themeId, loId] = item.split(':');
        return { themeId, loId };
      }),
  };
}

function confidencePercent(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

async function renderMaterialsInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Opening course knowledge workspace…'));
  const root = el('div', { class: 'view view--knowledge-workspace' }, body);
  mount(outlet, root);

  let tree: CourseTree;
  let materials: Material[];
  let trash: Material[];
  let recentRuns: ContentRunSummary[];
  let graph: CourseKnowledgeGraph;
  try {
    [tree, materials, trash, recentRuns, graph] = await Promise.all([
      getCourseTree(courseId),
      listMaterials(courseId),
      listTrashedMaterials(courseId),
      listContentRuns(courseId, { kind: 'material-ingest', limit: 30 }),
      getCourseKnowledgeGraph(courseId),
    ]);
  } catch (error) {
    body.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    return;
  }

  let fileMode: 'files' | 'review' | 'trash' = 'files';
  let rightTab: 'preview' | 'chunks' | 'metadata' | 'graph' = 'preview';
  let selectedId = materials[0]?._id ?? trash[0]?._id;
  let detail: MaterialWorkspaceDetail | undefined;
  let detailLoading = false;
  let fileSearch = '';
  let graphSearch = '';
  let graphType = 'all';
  let graphZoom = 0.9;
  const runs = new Map(recentRuns.map((run) => [run._id, run]));
  const refreshedTerminalRuns = new Set<string>();
  const assistantMessages: Array<{ role: 'assistant' | 'user'; text: string; action?: { label: string; run: () => void } }> = [
    {
      role: 'assistant',
      text: 'Upload your course files and I’ll classify them, extract concepts, and connect high-confidence evidence to existing LOs. Medium-confidence matches stay in Review.',
    },
  ];
  const feedback = el('div', { class: 'workspace-feedback', 'aria-live': 'polite' });

  async function loadDetail(materialId: string | undefined): Promise<void> {
    detail = undefined;
    if (!materialId) return;
    detailLoading = true;
    refresh();
    try {
      detail = await getMaterialWorkspaceDetail(courseId, materialId);
    } catch (error) {
      feedback.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    } finally {
      detailLoading = false;
      refresh();
    }
  }

  function selectedMaterial(): Material | undefined {
    return [...materials, ...trash].find((material) => material._id === selectedId);
  }

  function selectMaterial(material: Material): void {
    selectedId = material._id;
    if (rightTab === 'graph') rightTab = 'preview';
    void loadDetail(material._id);
  }

  function flash(text: string): void {
    feedback.replaceChildren(el('p', { class: 'workspace-feedback__message', text }));
  }

  async function reloadGraph(): Promise<void> {
    graph = await getCourseKnowledgeGraph(courseId);
  }

  async function doUpload(files: File[]): Promise<void> {
    feedback.replaceChildren();
    try {
      const created = await uploadMaterials(courseId, files);
      materials = [...created, ...materials];
      fileMode = 'files';
      if (created[0]) selectMaterial(created[0]);
      flash(`${created.length} material${created.length === 1 ? '' : 's'} added. Processing is running in the activity stream.`);
      refresh();
    } catch (error) {
      feedback.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }

  async function doAddUrl(input: HTMLInputElement): Promise<void> {
    const url = input.value.trim();
    if (!url) return;
    try {
      const created = await addUrlMaterial(courseId, url);
      input.value = '';
      materials = [...created, ...materials];
      if (created[0]) selectMaterial(created[0]);
      flash('URL added. I’m parsing and indexing it now.');
      refresh();
    } catch (error) {
      feedback.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }

  async function doTrash(material: Material): Promise<void> {
    const confirmed = await confirmDialog({
      title: 'Move material to Trash?',
      message: 'It will stop grounding new questions. Existing questions and provenance remain, and you can restore the source later.',
      confirmLabel: 'Move to Trash',
      tone: 'danger',
    });
    if (!confirmed) return;
    const deleted = await trashMaterial(courseId, material._id);
    materials = materials.filter((item) => item._id !== material._id);
    trash = [deleted, ...trash];
    selectedId = materials[0]?._id;
    detail = undefined;
    await reloadGraph();
    flash(`${material.name} moved to Trash. Its questions were preserved.`);
    refresh();
  }

  async function doRestore(material: Material): Promise<void> {
    const restored = await restoreMaterial(courseId, material._id);
    trash = trash.filter((item) => item._id !== material._id);
    materials = [restored, ...materials];
    fileMode = 'files';
    selectedId = restored._id;
    flash(`${material.name} restored. Its search index is rebuilding.`);
    refresh();
  }

  async function doRetry(material: Material): Promise<void> {
    const updated = await retryMaterial(material._id);
    materials = materials.map((item) => (item._id === updated._id ? updated : item));
    flash(`Retry started for ${material.name}.`);
    refresh();
  }

  async function retryAllFailed(): Promise<void> {
    const failed = materials.filter((material) => material.status === 'failed');
    if (!failed.length) {
      assistantMessages.push({ role: 'assistant', text: 'There are no failed materials to retry.' });
      refresh();
      return;
    }
    const updated = await Promise.all(failed.map((material) => retryMaterial(material._id)));
    const byId = new Map(updated.map((material) => [material._id, material]));
    materials = materials.map((material) => byId.get(material._id) ?? material);
    assistantMessages.push({ role: 'assistant', text: `Retry started for ${updated.length} failed material${updated.length === 1 ? '' : 's'}.` });
    refresh();
  }

  async function buildKnowledgeBase(): Promise<void> {
    assistantMessages.push({ role: 'assistant', text: 'Analyzing the indexed materials for a draft Topic/LO structure…' });
    refresh();
    try {
      const suggestion = await getSuggestedHierarchy(courseId);
      const loCount = suggestion.themes.reduce((total, theme) => total + theme.los.length, 0);
      assistantMessages.push({
        role: 'assistant',
        text: suggestion.themes.length
          ? `I found ${suggestion.themes.length} Topic suggestions and ${loCount} draft LOs. Review and edit them before they become course structure.`
          : 'I could not produce a useful structure yet. Add at least one content-rich material and wait until processing finishes.',
        ...(suggestion.themes.length
          ? { action: { label: 'Review draft structure', run: () => navigate(`/instructor/course/${courseId}/structure`) } }
          : {}),
      });
    } catch (error) {
      assistantMessages.push({ role: 'assistant', text: error instanceof ApiError ? error.message : (error as Error).message });
    }
    refresh();
  }

  function handleAssistantPrompt(input: HTMLTextAreaElement): void {
    const prompt = input.value.trim();
    if (!prompt) return;
    input.value = '';
    assistantMessages.push({ role: 'user', text: prompt });
    const normalized = prompt.toLowerCase();
    if (/build|knowledge|lo|structure|知识|学习目标/.test(normalized)) void buildKnowledgeBase();
    else if (/review|confidence|建议|审核/.test(normalized)) {
      fileMode = 'review';
      assistantMessages.push({ role: 'assistant', text: 'I opened every medium-confidence item that needs instructor review.' });
    } else if (/retry|failed|失败|重试/.test(normalized)) void retryAllFailed();
    else if (/graph|map|关系|图谱/.test(normalized)) {
      rightTab = 'graph';
      assistantMessages.push({ role: 'assistant', text: 'The knowledge graph is open. Search or filter nodes, then select a source to inspect it.' });
    } else {
      assistantMessages.push({
        role: 'assistant',
        text: 'In this first workspace version I can build a draft knowledge base, open classification review, retry failed processing, and explore the graph. Choose an action below.',
      });
    }
    refresh();
  }

  function fileCard(material: Material): HTMLElement {
    const run = material.activeRunId ? runs.get(material.activeRunId) : undefined;
    const isSelected = selectedId === material._id;
    const assignmentState = material.automation?.assignment;
    return el(
      'button',
      {
        class: `workspace-file${isSelected ? ' workspace-file--selected' : ''}`,
        type: 'button',
        onclick: () => selectMaterial(material),
      },
      el('span', { class: `workspace-file__icon workspace-file__icon--${material.status}`, text: material.format.toUpperCase().slice(0, 4) }),
      el(
        'span',
        { class: 'workspace-file__body' },
        el('span', { class: 'workspace-file__name', text: material.name }),
        el('span', {
          class: 'workspace-file__meta',
          text: material.deletedAt
            ? `Trash · ${formatDate(material.deletedAt)}`
            : `${material.kind ?? 'other'} · ${run?.stage ?? material.status}`,
        }),
      ),
      assignmentState?.status === 'needs-review'
        ? el('span', { class: 'workspace-file__review', title: 'Needs review', text: '!' })
        : assignmentState?.status === 'auto-applied'
          ? el('span', { class: 'workspace-file__auto', title: 'Auto-assigned', text: '✓' })
          : false,
    );
  }

  function leftPanel(): HTMLElement {
    const source = fileMode === 'trash'
      ? trash
      : fileMode === 'review'
        ? materials.filter((material) => material.automation?.assignment?.status === 'needs-review' || material.classificationSuggestion)
        : materials;
    const visible = source.filter((material) => material.name.toLowerCase().includes(fileSearch.toLowerCase()));
    const urlInput = el('input', { class: 'input input--sm', type: 'url', 'aria-label': 'Add a public material URL', placeholder: 'Add a public URL…' }) as HTMLInputElement;
    return el(
      'section',
      { class: 'knowledge-workspace__files', 'aria-label': 'Knowledge sources' },
      el(
        'div',
        { class: 'workspace-panel-heading' },
        el('div', {}, el('p', { class: 'workspace-eyebrow', text: 'KNOWLEDGE BASE' }), el('h2', { text: 'Sources' })),
        el('span', { class: 'workspace-count', text: String(materials.length) }),
      ),
      uploadZone('Drop files here or browse', (files) => void doUpload(files)),
      el('div', { class: 'workspace-url' }, urlInput, el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void doAddUrl(urlInput) }, '+')),
      el('input', {
        class: 'input input--sm workspace-search',
        type: 'search',
        'aria-label': 'Search course sources',
        value: fileSearch,
        placeholder: 'Search sources…',
        oninput: (event: Event) => { fileSearch = (event.target as HTMLInputElement).value; refresh(); },
      }),
      el(
        'div',
        { class: 'workspace-file-tabs', role: 'tablist' },
        ...(['files', 'review', 'trash'] as const).map((mode) =>
          el('button', {
            class: `workspace-file-tab${fileMode === mode ? ' workspace-file-tab--active' : ''}`,
            type: 'button',
            role: 'tab',
            'aria-selected': fileMode === mode ? 'true' : 'false',
            text: mode === 'files' ? 'Files' : mode === 'review' ? 'Review' : 'Trash',
            onclick: () => { fileMode = mode; refresh(); },
          }),
        ),
      ),
      el('div', { class: 'workspace-file-list' },
        ...(visible.length ? visible.map(fileCard) : [el('p', { class: 'workspace-empty', text: fileMode === 'review' ? 'Nothing needs review.' : 'No sources here.' })]),
      ),
    );
  }

  function activityTimeline(): HTMLElement {
    const material = selectedMaterial();
    const run = material?.activeRunId ? runs.get(material.activeRunId) : undefined;
    const currentIndex = run ? INGEST_STAGES.indexOf(run.stage as (typeof INGEST_STAGES)[number]) : -1;
    return el(
      'section',
      { class: 'workspace-activity' },
      el('div', { class: 'row row--between' }, el('h3', { text: 'Processing activity' }), run ? el('span', { class: `workspace-run-status workspace-run-status--${run.status}`, text: run.status }) : false),
      material
        ? el('p', { class: 'workspace-activity__source', text: material.name })
        : el('p', { class: 'workspace-empty', text: 'Select a source to inspect its processing.' }),
      run
        ? el(
            'ol',
            { class: 'workspace-timeline' },
            ...INGEST_STAGES.map((stage, index) => {
              const done = run.status === 'completed' || index < currentIndex;
              const active = index === currentIndex && !['completed', 'failed'].includes(run.status);
              const failed = index === currentIndex && run.status === 'failed';
              return el(
                'li',
                { class: `workspace-timeline__item${done ? ' is-done' : ''}${active ? ' is-active' : ''}${failed ? ' is-failed' : ''}` },
                el('span', { class: 'workspace-timeline__dot', text: done ? '✓' : failed ? '!' : '' }),
                el('span', { text: stage.charAt(0).toUpperCase() + stage.slice(1) }),
                active && run.totalUnits !== undefined ? el('span', { class: 'workspace-timeline__units', text: `${run.completedUnits}/${run.totalUnits}` }) : false,
              );
            }),
          )
        : false,
      run?.error ? el('p', { class: 'material-row__error', text: materialErrorMessage(run.error.message) }) : false,
      material?.status === 'failed'
        ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void doRetry(material) }, 'Retry processing')
        : false,
    );
  }

  function assistantPanel(): HTMLElement {
    const prompt = el('textarea', { class: 'input input--area workspace-assistant__input', rows: '2', 'aria-label': 'Ask the course assistant', placeholder: 'Ask the course assistant to build, review, retry, or explore…' }) as HTMLTextAreaElement;
    return el(
      'section',
      { class: 'knowledge-workspace__assistant', 'aria-label': 'Course assistant' },
      el(
        'div',
        { class: 'workspace-assistant__header' },
        el('div', {}, el('p', { class: 'workspace-eyebrow', text: 'COURSE ASSISTANT' }), el('h2', { text: 'Build with your materials' })),
        el('span', { class: 'workspace-live', text: '● Live' }),
      ),
      el(
        'div',
        { class: 'workspace-quick-actions' },
        el('button', { class: 'workspace-action', type: 'button', onclick: () => void buildKnowledgeBase() }, el('strong', { text: 'Build knowledge base' }), el('span', { text: 'Draft Topics and LOs from evidence' })),
        el('button', { class: 'workspace-action', type: 'button', onclick: () => { fileMode = 'review'; refresh(); } }, el('strong', { text: 'Review suggestions' }), el('span', { text: 'Resolve medium-confidence matches' })),
        el('button', { class: 'workspace-action', type: 'button', onclick: () => { rightTab = 'graph'; refresh(); } }, el('strong', { text: 'Explore graph' }), el('span', { text: 'Trace source → concept → LO → question' })),
      ),
      el(
        'div',
        { class: 'workspace-chat', role: 'log', 'aria-live': 'polite' },
        ...assistantMessages.map((message) =>
          el(
            'div',
            { class: `workspace-message workspace-message--${message.role}` },
            el('p', { text: message.text }),
            message.action ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: message.action.run }, message.action.label) : false,
          ),
        ),
      ),
      el('div', { class: 'workspace-assistant__composer' }, prompt, el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: () => handleAssistantPrompt(prompt) }, 'Send')),
      activityTimeline(),
    );
  }

  function metadataPanel(material: Material, loaded: MaterialWorkspaceDetail | undefined): HTMLElement {
    const checklist = buildAssignChecklist(tree, material.assignments);
    const kindSelect = el(
      'select',
      { class: 'input input--sm' },
      ...MATERIAL_KINDS.map((kind) => el('option', { value: kind, selected: (material.kind ?? 'other') === kind ? 'selected' : undefined, text: kind.charAt(0).toUpperCase() + kind.slice(1) })),
    ) as HTMLSelectElement;
    async function saveKind(): Promise<void> {
      const updated = await updateMaterialKind(courseId, material._id, kindSelect.value as MaterialKind);
      materials = materials.map((item) => (item._id === updated._id ? updated : item));
      if (detail) detail.material = updated;
      flash('Material type updated. Manual corrections override AI classification.');
      refresh();
    }
    async function saveAssignments(): Promise<void> {
      const updated = await assignMaterial(material._id, checklist.getSelected());
      materials = materials.map((item) => (item._id === updated._id ? updated : item));
      detail = detail ? { ...detail, material: updated } : detail;
      await reloadGraph();
      flash('LO assignments saved.');
      refresh();
    }
    async function resolve(action: 'accept' | 'reject'): Promise<void> {
      const updated = await resolveClassification(material._id, action);
      materials = materials.map((item) => (item._id === updated._id ? updated : item));
      detail = detail ? { ...detail, material: updated } : detail;
      await reloadGraph();
      flash(action === 'accept' ? 'Suggestion accepted.' : 'Suggestion dismissed.');
      refresh();
    }
    const suggestion = material.classificationSuggestion;
    return el(
      'div',
      { class: 'workspace-inspector__content' },
      material.automation?.assignment
        ? el(
            'div',
            { class: `workspace-automation workspace-automation--${material.automation.assignment.status}` },
            el('strong', { text: material.automation.assignment.status === 'auto-applied' ? 'Auto-assigned' : material.automation.assignment.status === 'needs-review' ? 'Needs review' : 'No confident match' }),
            el('span', { text: `${confidencePercent(material.automation.assignment.confidence)} confidence` }),
          )
        : false,
      suggestion
        ? el(
            'div',
            { class: 'workspace-review-card' },
            el('strong', { text: `Suggested LO match · ${classificationLabel(suggestion.confidence)}` }),
            material.classificationSuggestions?.[0]?.rationale ? el('p', { text: material.classificationSuggestions[0].rationale }) : false,
            el('div', { class: 'row' }, el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => void resolve('accept') }, 'Accept'), el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void resolve('reject') }, 'Dismiss')),
          )
        : false,
      el('label', { class: 'form-field' }, el('span', { text: 'Material type' }), el('div', { class: 'row' }, kindSelect, el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void saveKind() }, 'Save'))),
      el('div', { class: 'workspace-metadata-block' }, el('h3', { text: 'LO coverage' }), el('p', { class: 'workspace-muted', text: assignmentSummary(material, tree) }), checklist.element, el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void saveAssignments() }, 'Save assignments')),
      el(
        'div',
        { class: 'workspace-metadata-block' },
        el('h3', { text: `Concepts (${loaded?.material.knowledgeConcepts?.length ?? 0})` }),
        ...(loaded?.material.knowledgeConcepts?.length
          ? loaded.material.knowledgeConcepts.map((concept) => el('article', { class: 'workspace-concept' }, el('div', { class: 'row row--between' }, el('strong', { text: concept.name }), el('span', { text: confidencePercent(concept.confidence) })), concept.description ? el('p', { text: concept.description }) : false, concept.evidence ? el('blockquote', { text: concept.evidence }) : false))
          : [el('p', { class: 'workspace-empty', text: 'Concepts appear after AI classification completes.' })]),
      ),
    );
  }

  function graphPanel(): HTMLElement {
    const container = el('div', { class: 'workspace-graph' });
    const toolbar = el('div', { class: 'workspace-graph__toolbar' });
    const search = el('input', { class: 'input input--sm', type: 'search', value: graphSearch, 'aria-label': 'Search knowledge graph', placeholder: 'Search graph…' }) as HTMLInputElement;
    const typeSelect = el('select', { class: 'input input--sm', 'aria-label': 'Filter graph node type' }, ...['all', 'material', 'evidence', 'concept', 'topic', 'lo', 'question'].map((type) => el('option', { value: type, selected: graphType === type ? 'selected' : undefined, text: type === 'all' ? 'All node types' : type.charAt(0).toUpperCase() + type.slice(1) }))) as HTMLSelectElement;
    const zoom = el('input', { type: 'range', min: '0.55', max: '1.35', step: '0.05', value: String(graphZoom), 'aria-label': 'Graph zoom' }) as HTMLInputElement;
    const canvas = el('div', { class: 'workspace-graph__canvas' });
    const positions = new Map<string, { x: number; y: number }>();

    function draw(): void {
      graphSearch = search.value;
      graphType = typeSelect.value;
      graphZoom = Number(zoom.value);
      const query = graphSearch.trim().toLowerCase();
      const visibleNodes = graph.nodes.filter((node) => (graphType === 'all' || node.type === graphType) && (!query || `${node.label} ${node.subtitle ?? ''}`.toLowerCase().includes(query)));
      const visibleIds = new Set(visibleNodes.map((node) => node.id));
      const types = ['material', 'evidence', 'concept', 'topic', 'lo', 'question'] as const;
      for (const [column, type] of types.entries()) {
        graph.nodes.filter((node) => node.type === type).forEach((node, row) => {
          if (!positions.has(node.id)) positions.set(node.id, { x: 30 + column * 230, y: 30 + row * 92 });
        });
      }
      const height = Math.max(440, ...[...positions.values()].map((position) => position.y + 80));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 1400 ${height}`);
      svg.setAttribute('width', `${1400 * graphZoom}`);
      svg.setAttribute('height', `${height * graphZoom}`);
      svg.classList.add('workspace-graph__svg');
      for (const edge of graph.edges) {
        if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target) continue;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('d', `M ${source.x + 170} ${source.y + 28} C ${source.x + 195} ${source.y + 28}, ${target.x - 25} ${target.y + 28}, ${target.x} ${target.y + 28}`);
        line.setAttribute('class', `workspace-graph__edge workspace-graph__edge--${edge.type}`);
        svg.append(line);
      }
      for (const node of visibleNodes) {
        const position = positions.get(node.id)!;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('transform', `translate(${position.x} ${position.y})`);
        group.setAttribute('class', `workspace-graph__node workspace-graph__node--${node.type}${node.trashed ? ' is-trashed' : ''}`);
        group.setAttribute('tabindex', '0');
        group.setAttribute('role', 'button');
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', '170'); rect.setAttribute('height', '58'); rect.setAttribute('rx', '10');
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        title.setAttribute('x', '12'); title.setAttribute('y', '24'); title.textContent = node.label.length > 23 ? `${node.label.slice(0, 23)}…` : node.label;
        const subtitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        subtitle.setAttribute('x', '12'); subtitle.setAttribute('y', '43'); subtitle.setAttribute('class', 'workspace-graph__subtitle'); subtitle.textContent = node.type.toUpperCase();
        group.append(rect, title, subtitle);
        const choose = (): void => {
          if (node.materialId) {
            const material = [...materials, ...trash].find((item) => item._id === node.materialId);
            if (material) selectMaterial(material);
          }
        };
        group.addEventListener('click', choose);
        group.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') choose(); });
        let dragStart: { pointerX: number; pointerY: number; x: number; y: number } | undefined;
        group.addEventListener('pointerdown', (event) => {
          const pointer = event as PointerEvent;
          dragStart = { pointerX: pointer.clientX, pointerY: pointer.clientY, x: position.x, y: position.y };
          group.setPointerCapture(pointer.pointerId);
        });
        group.addEventListener('pointermove', (event) => {
          if (!dragStart) return;
          const pointer = event as PointerEvent;
          position.x = dragStart.x + (pointer.clientX - dragStart.pointerX) / graphZoom;
          position.y = dragStart.y + (pointer.clientY - dragStart.pointerY) / graphZoom;
          group.setAttribute('transform', `translate(${position.x} ${position.y})`);
        });
        group.addEventListener('pointerup', () => { dragStart = undefined; draw(); });
        svg.append(group);
      }
      canvas.replaceChildren(svg);
    }
    search.addEventListener('input', draw);
    typeSelect.addEventListener('change', draw);
    zoom.addEventListener('input', draw);
    toolbar.append(search, typeSelect, el('label', { class: 'workspace-zoom' }, el('span', { text: 'Zoom' }), zoom));
    container.append(toolbar);
    if (graph.truncated) {
      container.append(el('p', { class: 'workspace-graph__note', text: 'Overview shows the first four evidence chunks per source. Select a source for every chunk.' }));
    }
    container.append(canvas);
    draw();
    return container;
  }

  function inspectorPanel(): HTMLElement {
    const material = selectedMaterial();
    const tabs: Array<{ id: typeof rightTab; label: string }> = [
      { id: 'preview', label: 'Preview' },
      { id: 'chunks', label: 'Chunks' },
      { id: 'metadata', label: 'Metadata' },
      { id: 'graph', label: 'Graph' },
    ];
    let content: HTMLElement;
    if (rightTab === 'graph') content = graphPanel();
    else if (!material) content = el('p', { class: 'workspace-empty', text: 'Select a source.' });
    else if (detailLoading || detail?.material._id !== material._id) content = loadingState('Loading source…');
    else if (rightTab === 'chunks') {
      content = el('div', { class: 'workspace-inspector__content' }, ...(detail?.chunks.length ? detail.chunks.map((chunk) => el('article', { class: 'workspace-chunk' }, el('div', { class: 'row row--between' }, el('strong', { text: `Chunk ${chunk.index + 1}` }), el('span', { text: `${chunk.characterCount} chars` })), el('p', { text: chunk.text }))) : [el('p', { class: 'workspace-empty', text: material.status === 'processing' ? 'Chunks will appear after parsing.' : 'No extracted chunks.' })]));
    } else if (rightTab === 'metadata') content = metadataPanel(material, detail);
    else {
      const canEmbed = material.format === 'pdf' || material.format === 'url';
      content = el(
        'div',
        { class: 'workspace-inspector__content' },
        el('div', { class: 'workspace-preview__heading' }, el('div', {}, el('h3', { text: material.name }), el('p', { text: `${material.format.toUpperCase()} · Uploaded ${formatDate(material.uploadedAt)}` })), el('a', { class: 'btn btn--ghost btn--sm', href: materialSourceUrl(courseId, material._id), target: '_blank', rel: 'noopener', text: 'Open original' })),
        canEmbed && !material.deletedAt ? el('iframe', { class: 'workspace-preview__frame', src: materialSourceUrl(courseId, material._id), title: `Preview ${material.name}` }) : el('pre', { class: 'workspace-preview__text', text: detail?.material.excerpt || 'No text preview is available.' }),
        material.deletedAt ? el('p', { class: 'workspace-deleted-note', text: 'This source is in Trash. Existing questions keep their provenance, but the source no longer grounds generation.' }) : false,
        el('div', { class: 'workspace-preview__actions' }, material.deletedAt ? el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => void doRestore(material) }, 'Restore source') : el('button', { class: 'btn btn--danger btn--sm', type: 'button', onclick: () => void doTrash(material) }, 'Move to Trash')),
      );
    }
    return el(
      'aside',
      { class: 'knowledge-workspace__inspector', 'aria-label': 'Source inspector' },
      el('div', { class: 'workspace-inspector__tabs', role: 'tablist' }, ...tabs.map((tab) => el('button', { class: `workspace-inspector__tab${rightTab === tab.id ? ' workspace-inspector__tab--active' : ''}`, type: 'button', role: 'tab', 'aria-selected': rightTab === tab.id ? 'true' : 'false', text: tab.label, onclick: () => { rightTab = tab.id; refresh(); } }))),
      content,
    );
  }

  function refresh(): void {
    body.replaceChildren(
      el(
        'div',
        { class: 'knowledge-workspace-shell' },
        el('div', { class: 'knowledge-workspace__title' }, el('div', {}, el('p', { class: 'workspace-eyebrow', text: tree.course.name }), el('h1', { text: 'Course Knowledge Workspace' }), el('p', { text: 'Upload once. AI organizes the evidence; you intervene only when judgment is needed.' }))),
        feedback,
        el('div', { class: 'knowledge-workspace' }, leftPanel(), assistantPanel(), inspectorPanel()),
      ),
    );
  }

  async function applyRunUpdate(run: ContentRunSummary, source: 'snapshot' | 'live'): Promise<void> {
    if (run.kind !== 'material-ingest') return;
    const previous = runs.get(run._id);
    runs.set(run._id, run);
    recentRuns = [run, ...recentRuns.filter((item) => item._id !== run._id)].slice(0, 30);
    const terminal = ['completed', 'partial', 'failed'].includes(run.status);
    const wasActive = previous && !['completed', 'partial', 'failed'].includes(previous.status);
    if (terminal && !refreshedTerminalRuns.has(run._id) && (source === 'live' || wasActive)) {
      refreshedTerminalRuns.add(run._id);
      try {
        [materials, trash, graph] = await Promise.all([listMaterials(courseId), listTrashedMaterials(courseId), getCourseKnowledgeGraph(courseId)]);
        if (selectedId === run.input.materialId) detail = await getMaterialWorkspaceDetail(courseId, selectedId);
      } catch {
        // The next SSE event or reload converges the durable snapshots.
      }
    }
    refresh();
  }

  const closeStream = subscribeContentRuns(courseId, {
    onSnapshot: (snapshot) => { for (const run of snapshot) void applyRunUpdate(run, 'snapshot'); },
    onRun: (run) => void applyRunUpdate(run, 'live'),
  });
  const observer = new MutationObserver(() => {
    if (root.isConnected) return;
    closeStream();
    observer.disconnect();
  });
  observer.observe(outlet, { childList: true });
  refresh();
  if (selectedId) void loadDetail(selectedId);
}

export function renderMaterials(outlet: HTMLElement, params: RouteParams): void {
  void renderMaterialsInner(outlet, params.id);
}
