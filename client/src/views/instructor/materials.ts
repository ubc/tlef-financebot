// Course Materials (I3) — upload (files + URL), durable live ingest progress,
// LLM auto-classification accept/reject, and Topic/LO assignment
// (Task 15, Task D). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-id `148:3664`) and `.superpowers/sdd/task-15/i3-materials.png` +
// `n3-material-assign.png`.
import {
  ApiError,
  addUrlMaterial,
  assignMaterial,
  getCourseTree,
  listContentRuns,
  listMaterials,
  resolveClassification,
  retryMaterial,
  subscribeContentRuns,
  uploadMaterials,
  type ContentRunSummary,
  type CourseTree,
  type Material,
  type MaterialAssignment,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge, uploadZone } from '../../instructor-ui.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { assignmentSummary, classificationLabel } from './material-assign.js';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusLabel(status: Material['status']): string {
  return status === 'ready' ? 'Ready' : status === 'failed' ? 'Failed' : 'Processing';
}

/** A small Topic/LO checkbox tree for the "Or assign manually" section of the
 * Assign Material panel (n3) — every checked LO becomes a `{ themeId, loId }`
 * assignment. `check()` lets the "Modify" action on a suggestion pre-tick one
 * LO without an API call. */
function buildAssignChecklist(
  tree: CourseTree,
  initial: MaterialAssignment[],
): { element: HTMLElement; getSelected: () => MaterialAssignment[]; check: (themeId: string, loId?: string) => void } {
  const key = (themeId: string, loId: string): string => `${themeId}:${loId}`;
  const selected = new Set<string>(initial.filter((a) => a.loId !== undefined).map((a) => key(a.themeId, a.loId!)));
  const checkboxes = new Map<string, HTMLInputElement>();

  const themeBlocks = tree.themes.map((theme) => {
    const los = theme.los ?? [];
    return el(
      'div',
      { class: 'assign-checklist__theme' },
      el('p', { class: 'assign-checklist__theme-name', text: theme.name }),
      ...los.map((lo) => {
        const k = key(theme._id, lo._id);
        const checkbox = el('input', {
          type: 'checkbox',
          checked: selected.has(k) ? 'checked' : undefined,
          onchange: (e: Event) => {
            if ((e.target as HTMLInputElement).checked) selected.add(k);
            else selected.delete(k);
          },
        }) as HTMLInputElement;
        checkboxes.set(k, checkbox);
        return el('label', { class: 'assign-checklist__lo' }, checkbox, el('span', { text: lo.name }));
      }),
    );
  });

  return {
    element: el('div', { class: 'assign-checklist' }, ...themeBlocks),
    getSelected: () =>
      Array.from(selected).map((k) => {
        const [themeId, loId] = k.split(':');
        return { themeId, loId };
      }),
    check: (themeId, loId) => {
      if (loId === undefined) return;
      const k = key(themeId, loId);
      selected.add(k);
      const checkbox = checkboxes.get(k);
      if (checkbox) checkbox.checked = true;
    },
  };
}

async function renderMaterialsInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading course materials…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  let tree: CourseTree;
  let materials: Material[];
  let recentRuns: ContentRunSummary[];
  try {
    [tree, materials, recentRuns] = await Promise.all([
      getCourseTree(courseId),
      listMaterials(courseId),
      listContentRuns(courseId, { kind: 'material-ingest', limit: 25 }),
    ]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderMaterialsInner(outlet, courseId)));
    return;
  }

  let mode: { type: 'list' } | { type: 'assign'; materialId: string } = { type: 'list' };
  const runs = new Map(recentRuns.map((run) => [run._id, run]));
  const refreshedTerminalRuns = new Set<string>();

  function refresh(): void {
    body.replaceChildren(mode.type === 'list' ? buildListView() : buildAssignPanel(mode.materialId));
  }

  function applyMaterials(next: Material[]): void {
    materials = next;
  }

  function applyMaterialUpdate(updated: Material): void {
    materials = materials.map((m) => (m._id === updated._id ? updated : m));
  }

  const uploadErrorSlot = el('div', {});
  const urlInput = el('input', { class: 'input', type: 'url', placeholder: 'https://example.com/reading.pdf' }) as HTMLInputElement;

  async function doUpload(files: File[]): Promise<void> {
    uploadErrorSlot.replaceChildren();
    try {
      // The upload endpoint already returns the created Material(s) (status
      // 'processing') — append them to the local list instead of an extra
      // round-trip refetch; durable run events converge the rest as ingest runs.
      const created = await uploadMaterials(courseId, files);
      applyMaterials([...materials, ...created]);
      refresh();
    } catch (error) {
      uploadErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }

  async function doAddUrl(): Promise<void> {
    uploadErrorSlot.replaceChildren();
    const url = urlInput.value.trim();
    if (!url) return;
    try {
      const created = await addUrlMaterial(courseId, url);
      urlInput.value = '';
      applyMaterials([...materials, ...created]);
      refresh();
    } catch (error) {
      uploadErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }

  async function doRetry(material: Material): Promise<void> {
    uploadErrorSlot.replaceChildren();
    try {
      applyMaterialUpdate(await retryMaterial(material._id));
      refresh();
    } catch (error) {
      uploadErrorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }

  function materialRun(material: Material): ContentRunSummary | undefined {
    const run = material.activeRunId ? runs.get(material.activeRunId) : undefined;
    return run?.kind === 'material-ingest' ? run : undefined;
  }

  function runProgress(run: ContentRunSummary | undefined): string | null {
    if (!run) return null;
    const stage = run.stage.charAt(0).toUpperCase() + run.stage.slice(1);
    const units = run.totalUnits !== undefined ? ` · ${run.completedUnits}/${run.totalUnits}` : '';
    if (run.status === 'failed') return `Failed during ${stage}${units}`;
    if (run.status === 'completed') return `Completed · ${stage}${units}`;
    return `${stage}${units}`;
  }

  function materialRow(material: Material): HTMLElement {
    const run = materialRun(material);
    const progress = runProgress(run);
    const suggestion = material.classificationSuggestion;
    const classificationText =
      material.status !== 'ready' ? '—' : suggestion ? `Auto-classified (${classificationLabel(suggestion.confidence)})` : 'No match';

    const action =
      material.status === 'failed'
        ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void doRetry(material) }, 'Retry')
        : el(
            'button',
            {
              class: 'btn btn--ghost btn--sm',
              type: 'button',
              disabled: material.status === 'processing' ? 'disabled' : undefined,
              onclick: () => {
                mode = { type: 'assign', materialId: material._id };
                refresh();
              },
            },
            'Assign →',
          );

    return el(
      'div',
      { class: 'material-row' },
      el('span', { class: `material-row__dot material-row__dot--${material.status}`, 'aria-hidden': 'true' }),
      el(
        'div',
        { class: 'material-row__main' },
        el('p', { class: 'material-row__name', text: material.name }),
        el('p', {
          class: 'material-row__meta',
          text: `${statusLabel(material.status)}${progress ? ` · ${progress}` : ''} · Uploaded ${formatDate(material.uploadedAt)}`,
        }),
        material.status === 'failed' && material.error
          ? el('p', { class: 'material-row__error', text: material.error })
          : run?.error
            ? el('p', { class: 'material-row__error', text: run.error.message })
            : false,
      ),
      el('p', { class: 'material-row__assign', text: material.status === 'ready' ? assignmentSummary(material, tree) : '—' }),
      el('p', { class: 'material-row__class', text: classificationText }),
      action,
    );
  }

  function buildListView(): HTMLElement {
    const unassignedCount = materials.filter((m) => m.status === 'ready' && m.assignments.length === 0).length;

    return el(
      'div',
      {},
      pageHeader('Course Materials', `${tree.course.name} · Upload and assign materials to ground question generation`),
      uploadZone('Drag & drop files here, or click to browse — PDF, Word, PowerPoint, or plain text', (files) => void doUpload(files)),
      el(
        'div',
        { class: 'row material-url-row' },
        urlInput,
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void doAddUrl() }, 'Add URL'),
      ),
      uploadErrorSlot,
      el('h2', { class: 'section-title', text: 'Uploaded Materials' }),
      materials.length
        ? el('div', { class: 'material-list' }, ...materials.map((m) => materialRow(m)))
        : emptyState('No materials uploaded yet.'),
      recentRuns.length > 0
        ? el(
            'div',
            { class: 'content-run-history' },
            el('h2', { class: 'section-title', text: 'Recent Processing Activity' }),
            ...recentRuns.filter((run) => run.kind === 'material-ingest').slice(0, 8).map((run) =>
              el(
                'p',
                { class: 'material-row__meta' },
                `${run.input.sourceName} · ${run.status} · ${runProgress(run) ?? run.stage}`,
              ),
            ),
          )
        : false,
      unassignedCount > 0
        ? el(
            'div',
            { class: 'unassigned-banner', role: 'status' },
            el('p', {
              text: `${unassignedCount} material${unassignedCount === 1 ? ' is' : 's are'} unassigned — assign to a Topic or LO to include it in question generation.`,
            }),
          )
        : false,
    );
  }

  function buildSuggestionBox(
    material: Material,
    suggestion: NonNullable<Material['classificationSuggestion']>,
    checklist: ReturnType<typeof buildAssignChecklist>,
    onResolved: () => void,
  ): HTMLElement {
    const theme = tree.themes.find((t) => t._id === suggestion.themeId);
    const lo = theme?.los?.find((l) => l._id === suggestion.loId);
    const description = theme ? `${theme.name}${lo ? ` › ${lo.name}` : ''}` : 'Unknown Topic/LO';
    const label = classificationLabel(suggestion.confidence);
    const errorSlot = el('div', {});

    async function resolve(action: 'accept' | 'reject'): Promise<void> {
      errorSlot.replaceChildren();
      try {
        applyMaterialUpdate(await resolveClassification(material._id, action));
        onResolved();
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    }

    return el(
      'div',
      { class: 'suggestion-box' },
      el('p', { class: 'suggestion-box__eyebrow', text: 'SUGGESTED ASSIGNMENT · AUTO-CLASSIFIED' }),
      el(
        'div',
        { class: 'suggestion-box__row' },
        el(
          'div',
          {},
          el('p', { class: 'suggestion-box__desc', text: description }),
          statusBadge(`Confidence: ${label}`, label === 'High' ? 'approved' : 'pending'),
        ),
        el(
          'div',
          { class: 'row' },
          el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', onclick: () => void resolve('accept') }, 'Accept'),
          el(
            'button',
            { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => checklist.check(suggestion.themeId, suggestion.loId) },
            'Modify',
          ),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void resolve('reject') }, 'Reject'),
        ),
      ),
      errorSlot,
    );
  }

  function buildAssignPanel(materialId: string): HTMLElement {
    const found = materials.find((m) => m._id === materialId);
    if (!found) {
      mode = { type: 'list' };
      return buildListView();
    }
    // TS doesn't retain the `!found` narrowing inside the nested `save`
    // closure below (only direct references in this function body stay
    // narrowed) — rebind to an explicitly non-undefined const.
    const material: Material = found;

    const checklist = buildAssignChecklist(tree, material.assignments);
    const errorSlot = el('div', {});

    function backToList(): void {
      mode = { type: 'list' };
      refresh();
    }

    async function save(): Promise<void> {
      errorSlot.replaceChildren();
      try {
        applyMaterialUpdate(await assignMaterial(material._id, checklist.getSelected()));
        backToList();
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    }

    return el(
      'div',
      {},
      pageHeader('Assign Material', `${material.name} · ${material.format.toUpperCase()} · Uploaded ${formatDate(material.uploadedAt)}`),
      material.classificationSuggestion
        ? buildSuggestionBox(material, material.classificationSuggestion, checklist, backToList)
        : false,
      el('h2', { class: 'section-title', text: 'Or assign manually' }),
      checklist.element,
      errorSlot,
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn btn--instr-primary', type: 'button', onclick: () => void save() }, 'Save assignment'),
        el('button', { class: 'btn btn--ghost', type: 'button', onclick: backToList }, 'Cancel'),
      ),
    );
  }

  async function applyRunUpdate(run: ContentRunSummary, source: 'snapshot' | 'live'): Promise<void> {
    if (run.kind !== 'material-ingest') return;
    const previous = runs.get(run._id);
    runs.set(run._id, run);
    recentRuns = [run, ...recentRuns.filter((existing) => existing._id !== run._id)]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 25);

    const terminal = ['completed', 'partial', 'failed'].includes(run.status);
    const materialKnown = materials.some((material) => material._id === run.input.materialId);
    const wasActive = previous !== undefined && !['completed', 'partial', 'failed'].includes(previous.status);
    const terminalNeedsRefresh =
      terminal && !refreshedTerminalRuns.has(run._id) && (source === 'live' || wasActive);
    if (terminalNeedsRefresh) {
      refreshedTerminalRuns.add(run._id);
    }
    if (!materialKnown || terminalNeedsRefresh) {
      try {
        applyMaterials(await listMaterials(courseId));
      } catch {
        // The persisted run remains visible; a later event/reload can converge
        // the Material snapshot if this one refresh fails transiently.
      }
    }
    if (mode.type === 'list') refresh();
  }

  const closeStream = subscribeContentRuns(courseId, {
    onSnapshot: (recent) => {
      for (const run of recent) void applyRunUpdate(run, 'snapshot');
    },
    onRun: (run) => void applyRunUpdate(run, 'live'),
  });
  const lifecycleObserver = new MutationObserver(() => {
    if (root.isConnected) return;
    closeStream();
    lifecycleObserver.disconnect();
  });
  lifecycleObserver.observe(outlet, { childList: true });
  refresh();
}

export function renderMaterials(outlet: HTMLElement, params: RouteParams): void {
  void renderMaterialsInner(outlet, params.id);
}
