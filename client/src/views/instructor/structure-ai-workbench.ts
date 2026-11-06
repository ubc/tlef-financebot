import { createOutlineConsolidationPanel } from './outline-consolidation-panel.js';
import type { StructureConsolidationView } from '../../api.js';
import {
  applySuggestedHierarchy, endContentRun, getContentRun, listContentRuns, startStructureGeneration, subscribeContentRuns,
  getSourceReadiness, listMaterials,
  suggestedHierarchyApplyFailure,
  type ContentRunSummary, type Material, type OutlineGroundingFinding, type StructureDraft, type StructureGenerationRun, type StructureOptions, type StructureResult, type StructureRepairView,
} from '../../api.js';
import { el } from '../../dom.js';
import { confirmDialog } from '../../modal.js';
import { materialSourceUrl } from '../../api.js';
import { previewEvidence } from './coverage-graph.js';
import { getSession } from '../../auth.js';
import { buildStructureCoverageReviewModel, createStructureCoverageDiagnostics, createStructureSourceCoverage } from './structure-source-coverage.js';
import { createOutlineRepairPanel } from './outline-repair-panel.js';

type SelectedTheme = Omit<StructureResult['themes'][number], 'los'> & { checked: boolean; los: Array<StructureResult['themes'][number]['los'][number] & { checked: boolean; sourceThemeIndex: number; sourceLoIndex: number }> };
const failureMessage = (code: string) => ({
  'structure-no-materials': 'Choose at least one ready material to build your outline.',
  'structure-material-unavailable': 'A selected file is no longer ready. Refresh the page and check your materials.',
  'structure-chunks-missing': 'Some files have no complete extracted text. Reprocess them in Course Materials before generating.',
  'structure-corpus-too-large': 'This selection is too large to analyze completely in one run. Choose a smaller group of materials.',
  'structure-material-changed': 'A source changed during analysis. Generate again to use its current text.',
  'structure-no-evidence': 'No teachable content was found in the selected files. Check the extracted text in Course Materials.',
  'structure-analysis-invalid': 'The source analysis could not be validated. Try generating again, or choose fewer materials. No objectives were saved.',
  'structure-outline-invalid': 'The draft did not meet the requested structure. Try AI-decided counts or adjust your instructions.',
  'structure-grounding-no-supported-objectives': 'No merged objectives passed the original-source review. Review the findings and source files below. No objectives were saved.',
  'structure-grounding-objective-too-large': 'An objective needs more original source text than one review can safely check. Try a smaller source selection or more focused objectives. No objectives were saved.',
  'structure-grounding-original-unavailable': 'An objective could not be matched to its exact original source passages. Check the source files and generate again. No objectives were saved.',
  'structure-budget-exhausted': 'The analysis reached its model budget before the draft was complete. Completed source analysis is retained. Review the diagnostics before generating again.',
  'structure-enqueue-failed': 'Generation could not be queued. Please try again.',
  'server-restarted': 'Generation was interrupted by a server restart. Generate again to continue.',
  'generation-ended': 'Generation stopped. Your saved course outline is unchanged.',
}[code] ?? 'The draft could not be completed. Your course outline is unchanged. Please try again.');

/** Retained, same-page draft workspace. SSE snapshots update text in place;
 * saved course data is untouched until explicit reviewed apply. */
export function createStructureAssistant(courseId: string, materials: Material[], onToggle: () => void, onApplied: (notice?: string) => Promise<void>, owner: HTMLElement) {
  let opened = false;
  let run: StructureGenerationRun | undefined;
  let starting = false;
  let applying = false;
  let reviewedRun = '';
  let dismissedRun = '';
  let draft: SelectedTheme[] = [];
  let result: StructureResult | undefined;
  let disconnected = false;
  let disposed = false;
  let acceptedRunId = '';
  let unsubscribe: (() => void) | undefined;
  let polling: ReturnType<typeof setInterval> | undefined;
  let refreshingSources = false;
  let identityPending = false;
  let pendingSnapshot: StructureGenerationRun | undefined;
  let explicitlyViewedChild = '';
  const snapshots = new Map<string, StructureGenerationRun>();
  const actorKey = `${getSession().user?.puid ?? 'unknown'}:${courseId}`;
  const editsKey = (runId: string) => `financebot:outline-edits:${actorKey}:${runId}`;
  const viewKey = `financebot:outline-view:${actorKey}`;
  const sources = new Set(materials.filter(m => !m.deletedAt).map(m => m._id));
  const replacements = new Map<string, string>();
  let sourceSelectionEdited = false;
  let sourceBatchId: string | undefined;
  try { sourceBatchId = sessionStorage.getItem(`financebot:source-batch:${getSession().user?.puid ?? 'unknown'}:${courseId}`) ?? undefined; } catch { /* Server material selection remains available. */ }
  const element = el('section', { class: 'structure-ai', 'aria-label': 'AI course outline' });
  const message = el('div', { class: 'structure-ai-message', role: 'status' });
  const status = el('div', { class: 'structure-ai-status', role: 'status', 'aria-live': 'polite' });
  const settings = el('details', { class: 'structure-ai-settings' });
  const configFields = el('fieldset', { class: 'structure-ai-fields' }) as HTMLFieldSetElement;
  const field = (label: string, choices: Array<[string, string]>) => {
    const select = el('select', { class: 'input', 'aria-label': label }, ...choices.map(([value, text]) => el('option', { value, text }))) as HTMLSelectElement;
    return { select, element: el('label', {}, el('span', { text: label }), select) };
  };
  const topics = field('Topic count', [['', 'AI decides'], ...Array.from({ length: 30 }, (_, i): [string, string] => [String(i + 1), String(i + 1)])]);
  const objectives = field('Objectives per topic', [['', 'AI decides · varies by topic'], ...Array.from({ length: 12 }, (_, i): [string, string] => [String(i + 1), String(i + 1)])]);
  const level = field('Course level', [['auto', 'Infer from materials'], ['introductory', 'Introductory'], ['advanced', 'Advanced']]);
  const emphasis = field('Emphasis', [['auto', 'Infer from materials'], ['balanced', 'Balanced'], ['conceptual', 'Concepts'], ['applied', 'Applications & calculations']]);
  const guidance = el('textarea', { class: 'input', rows: 2, maxlength: 2000, 'aria-label': 'Optional instructions', placeholder: 'Optional: focus, prerequisites, or teaching preferences…' }) as HTMLTextAreaElement;
  const sourceDetails = el('section', { class: 'structure-ai-sources', 'aria-label': 'Source materials' });
  const sourceSummary = el('p', { class: 'structure-ai-source-summary' });
  const sourceList = el('div', { class: 'structure-ai-source-list' });
  for (const material of materials.filter(m => !m.deletedAt)) {
    const input = el('input', { type: 'checkbox', value: material._id, checked: sources.has(material._id), onchange: () => {
      sourceSelectionEdited = true;
      if (input.checked) sources.add(material._id); else sources.delete(material._id);
      updateControls();
    }, 'aria-label': `Use ${material.name}` }) as HTMLInputElement;
    sourceList.append(el('label', {}, input, el('span', {}, el('strong', { text: material.name }), el('small', { text: sourceCaption(material) }))));
  }
  const sourceNote = el('p', { class: 'structure-ai-note', text: 'Upload a material and wait for processing to finish before generating.' });
  const refreshSources = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { void refreshSourceStatus(); } }, 'Refresh source status') as HTMLButtonElement;
  sourceDetails.append(el('h3', { text: 'Ground in these materials' }), sourceList, sourceSummary, refreshSources, sourceNote,
    el('a', { class: 'btn btn--ghost btn--sm', href: `#/instructor/course/${courseId}/materials`, text: 'Open Course Materials →' }));
  const capabilityCheck = el('input', { type: 'checkbox', 'aria-label': 'Review capability overlap experimentally' }) as HTMLInputElement;
  configFields.append(el('label', {}, capabilityCheck, 'Review source and capability overlap · experimental'), el('p', { class: 'structure-ai-note', text: 'Keeps the current opt-in policy. A terminal source-supported outline can later receive an automatic consolidation proposal and a separate full fresh review if its original allowance permits.' }));
  configFields.append(el('div', { class: 'structure-ai-config-grid' }, topics.element, objectives.element, level.element, emphasis.element), guidance);
  const replacementOptions = () => [el('option', { value: '', text: 'Choose a source' }), ...materials.filter(material => !material.deletedAt).map(material => el('option', { value: material._id, text: material.name }))];
  const previousSource = el('select', { class: 'input', 'aria-label': 'Earlier source to replace' }, ...replacementOptions());
  const replacementSource = el('select', { class: 'input', 'aria-label': 'Replacement source' }, ...replacementOptions());
  const replacementRows = el('div', { class: 'structure-ai-note' });
  const drawReplacements = () => replacementRows.replaceChildren(...[...replacements].map(([previous, replacement]) => el('p', {},
    `${materials.find(material => material._id === previous)?.name} → ${materials.find(material => material._id === replacement)?.name} `,
    el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { replacements.delete(previous); drawReplacements(); } }, 'Remove replacement'))));
  configFields.append(el('details', {}, el('summary', { text: 'Replace a source for this analysis' }),
    el('p', { class: 'structure-ai-note', text: 'Choose the earlier source and its replacement explicitly. Previous sources, outlines and question history are retained.' }),
    previousSource, replacementSource, el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => {
      if (!previousSource.value || !replacementSource.value || previousSource.value === replacementSource.value) return;
      replacements.set(previousSource.value, replacementSource.value); sources.delete(previousSource.value); sources.add(replacementSource.value); sourceSelectionEdited = true;
      sourceList.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.checked = sources.has(input.value); });
      drawReplacements(); updateControls();
    } }, 'Use replacement'), replacementRows));
  settings.append(el('summary', {}, 'Customize generation', el('small', { text: 'Optional' })), configFields);
  configFields.append(el('button', { type: 'button', class: 'structure-ai-reset', onclick: () => { topics.select.value = ''; objectives.select.value = ''; level.select.value = 'auto'; emphasis.select.value = 'auto'; guidance.value = ''; } }, 'Reset to AI defaults')); 
  const generate = el('button', { type: 'button', class: 'btn btn--instr-primary', onclick: start }, 'Generate outline') as HTMLButtonElement;
  const stop = el('button', { type: 'button', class: 'btn btn--ghost', onclick: async () => {
    const runId = consolidation.busy ? consolidation.view?.reviewRunId ?? consolidation.view?.proposalRunId ?? acceptedRunId : repair.busy ? repair.view?.cycle.childRunId ?? acceptedRunId : run?._id ?? acceptedRunId;
    if (!runId) return;
    try { accept(await endContentRun(courseId, runId)); }
    catch { message.textContent = 'Could not stop the run. Try again.'; }
  } }, 'Stop generation') as HTMLButtonElement;
  const composer = el('aside', { class: 'structure-ai-composer', 'aria-label': 'Outline settings' },
    el('h2', { text: 'Shape your outline' }),
    el('p', { class: 'structure-ai-intro', text: 'Start with your course materials. Let AI suggest the structure, then make it your own.' }),
    sourceDetails,
    el('div', { class: 'structure-ai-default' }, el('span', { class: 'structure-ai-eyebrow', text: '✧ AI DECIDES' }),
      el('strong', { text: 'A structure that fits your materials' }),
      el('p', { text: 'Topics, objective counts, level, and balance are inferred from the selected content. Adjust only what you need.' })),
    settings, generate,
    el('p', { class: 'structure-ai-note', text: 'Your draft stays separate until you review and add it to the course.' }));
  const count = el('p');
  const content = el('section', { class: 'structure-ai-drafts', 'aria-label': 'Draft objectives' });
  const coverage = el('details', { class: 'structure-ai-coverage' });
  const grounding = el('details', { class: 'structure-ai-coverage', 'aria-label': 'Original-source review' });
  const footerText = el('span');
  const apply = el('button', { type: 'button', class: 'btn btn--instr-primary', onclick: applyDraft }, 'Add selected to course') as HTMLButtonElement;
  const footer = el('div', { class: 'structure-ai-footer' }, footerText, apply);
  const repair = createOutlineRepairPanel(courseId, {
    onView: resolveRepairView,
    onSelectDraft: selectReviewedDraft,
    onBusyChange: () => { if (!disposed) draw(); },
  });
  const consolidation = createOutlineConsolidationPanel(courseId, { onView: resolveConsolidationView, onSelectDraft: selectConsolidationDraft, onBusyChange: () => { if (!disposed) draw(); } });
  const outlineTitle = el('h2', { text: 'Suggested outline' });
  const draftArea = el('div', { class: 'structure-ai-draft-area' },
    el('header', { class: 'structure-ai-toolbar' }, el('div', {}, outlineTitle, count)),
    message, status, consolidation.element, repair.element, grounding, coverage, content, footer);
  element.append(composer, draftArea);

  const active = () => starting || identityPending || consolidation.busy || repair.busy || (!run && !!acceptedRunId) || run?.status === 'queued' || run?.status === 'running';
  function updateControls(): void {
    const busy = active();
    configFields.disabled = !!busy || applying;
    content.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(node => { node.disabled = applying; });
    sourceList.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = !!busy; });
    generate.disabled = !!busy || applying || !run && !!pendingSnapshot || !sources.size || !materials.some(material => sources.has(material._id) && !material.deletedAt && material.status === 'ready');
    sourceNote.hidden = materials.some(material => !material.deletedAt && material.status === 'ready');
    refreshSources.disabled = refreshingSources || !!busy;
    generate.textContent = busy ? 'Generating…' : result ? 'Generate again' : 'Generate draft →';
    generate.setAttribute('aria-busy', String(!!busy));
    sourceSummary.textContent = `${sources.size} ${sources.size === 1 ? 'material' : 'materials'} selected`; 
    stop.hidden = !busy || identityPending || repair.busy && !repair.view?.cycle.childRunId; stop.disabled = starting;
    const selected = draft.filter(t => t.checked).flatMap(t => t.los.filter(lo => lo.checked));
    const repaired = run?._id === repair.view?.child?.runId;
    const consolidated = run?._id === consolidation.view?.reviewRunId;
    apply.disabled = !!busy || applying || consolidated && (!consolidation.view?.canApply || selected.length !== result?.themes.reduce((sum, theme) => sum + theme.los.length, 0)) || run?.status !== 'completed' || repaired && !repair.view?.child?.canApply || !result || !selected.length || draft.some(t => t.checked && (!t.name.trim() || !t.los.some(lo => lo.checked) || t.los.some(lo => lo.checked && !lo.name.trim())));
    apply.textContent = applying ? 'Adding to course…' : 'Add selected to course';
    footer.hidden = !result;
    footerText.textContent = `${selected.length} objectives selected${consolidated ? ' · Keep the full reviewed child selected to preserve old-credit duties' : ''} · Existing content will be kept${repaired ? ' · Review your final wording; later edits are recorded as instructor edits' : ''}`;
    outlineTitle.textContent = consolidated ? 'Consolidated outline · freshly reviewed' : repaired ? 'Repaired outline' : 'Suggested outline';
  }
  function rememberDraft(): void {
    if (!result || !reviewedRun) return;
    try {
      sessionStorage.setItem(editsKey(reviewedRun), JSON.stringify({ version: 1, base: JSON.stringify(result.themes),
        themes: draft.map(topic => ({ name: topic.name, checked: topic.checked,
          los: topic.los.map(lo => ({ name: lo.name, checked: lo.checked })) })) }));
    } catch { message.textContent = 'Your edits are retained on this page. Browser storage is unavailable, so keep this page open until you finish reviewing.'; }
  }
  function restoreDraft(value: StructureResult, runId: string): SelectedTheme[] {
    const fresh = value.themes.map((topic, sourceThemeIndex) => ({ ...topic, checked: true,
      los: topic.los.map((lo, sourceLoIndex) => ({ ...lo, checked: true, sourceThemeIndex, sourceLoIndex })) }));
    try {
      const text = sessionStorage.getItem(editsKey(runId));
      if (!text) return fresh;
      const saved = JSON.parse(text) as { version?: number; base?: string; themes?: Array<{ name: string; checked: boolean; los: Array<{ name: string; checked: boolean }> }> };
      if (saved.version !== 1 || saved.base !== JSON.stringify(value.themes) || !Array.isArray(saved.themes)
        || saved.themes.length !== fresh.length || !saved.themes.every((topic, index) =>
          typeof topic.name === 'string' && topic.name.length <= 200 && typeof topic.checked === 'boolean'
          && Array.isArray(topic.los) && topic.los.length === fresh[index]!.los.length
          && topic.los.every(lo => typeof lo.name === 'string' && lo.name.length <= 500 && typeof lo.checked === 'boolean')
          && topic.checked === topic.los.some(lo => lo.checked))) return fresh;
      fresh.forEach((topic, index) => {
        const cached = saved.themes![index]!; topic.name = cached.name; topic.checked = cached.checked;
        topic.los.forEach((lo, loIndex) => { lo.name = cached.los[loIndex]!.name; lo.checked = cached.los[loIndex]!.checked; });
      });
    } catch { /* Unavailable or stale browser edits never replace current source bindings. */ }
    return fresh;
  }
  async function resolveConsolidationView(view: StructureConsolidationView): Promise<void> {
    if (disposed || !view.parentRunId) return;
    // Keep parent wording/selection while a proposal or child runs. A reviewed
    // child is shown only after an explicit teacher selection.
    const selectedRun = explicitlyViewedChild === view.reviewRunId && view.canApply ? explicitlyViewedChild : view.parentRunId;
    if (run?._id === selectedRun) return;
    const candidate = snapshots.get(selectedRun) ?? await getContentRun(courseId, selectedRun);
    if (disposed || consolidation.view?.parentRunId !== view.parentRunId || candidate.kind !== 'structure-generation') return;
    acceptKnown(candidate, true);
  }
  async function selectConsolidationDraft(runId: string): Promise<void> {
    const view = consolidation.view;
    if (!view || applying || identityPending || runId !== view.parentRunId && (!view.canApply || runId !== view.reviewRunId)) return;
    rememberDraft();
    const candidate = snapshots.get(runId) ?? await getContentRun(courseId, runId);
    if (disposed || candidate.kind !== 'structure-generation' || runId !== view.parentRunId && (candidate.status !== 'completed' || !candidate.structureResult)) return;
    explicitlyViewedChild = runId === view.parentRunId ? '' : runId;
    acceptKnown(candidate, true); draw();
  }
  async function resolveRepairView(view: StructureRepairView): Promise<void> {
    if (disposed) return;
    const parent = view.parentRunId;
    const relates = !run || run._id === parent || run._id === view.child?.runId || acceptedRunId === parent || acceptedRunId === view.requestedRunId;
    if (!relates) return;
    let selectedRun = explicitlyViewedChild === view.child?.runId && view.child?.canApply ? explicitlyViewedChild : parent;
    if (!run && view.child?.canApply) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(viewKey) ?? 'null') as { parentRunId?: string; runId?: string } | null;
        if (saved?.parentRunId === parent && saved.runId === view.child.runId) selectedRun = saved.runId;
      } catch { /* A fresh original view remains available without browser storage. */ }
    }
    if (run?._id === selectedRun) return;
    const candidate = snapshots.get(selectedRun) ?? await getContentRun(courseId, selectedRun);
    if (disposed || repair.view?.parentRunId !== parent || candidate.kind !== 'structure-generation') return;
    if (selectedRun !== parent && (!view.child?.canApply || candidate.status !== 'completed' || !candidate.structureResult)) return;
    if (selectedRun !== parent) explicitlyViewedChild = selectedRun;
    acceptKnown(candidate, true);
  }
  async function selectReviewedDraft(runId: string): Promise<void> {
    const view = repair.view;
    if (!view || applying || identityPending || repair.busy) return;
    if (runId !== view.parentRunId && (view.child?.runId !== runId || !view.child.canApply || view.child.status !== 'completed')) return;
    rememberDraft();
    const candidate = snapshots.get(runId) ?? await getContentRun(courseId, runId);
    if (disposed || repair.view?.parentRunId !== view.parentRunId || candidate.kind !== 'structure-generation') return;
    if (runId !== view.parentRunId && (candidate.status !== 'completed' || !candidate.structureResult)) return;
    explicitlyViewedChild = runId === view.parentRunId ? '' : runId;
    try { sessionStorage.setItem(viewKey, JSON.stringify({ parentRunId: view.parentRunId, runId })); } catch { /* Current selection still works. */ }
    acceptKnown(candidate, true); draw();
  }
  function sourceCaption(material: Material): string {
    return material.deletedAt ? 'In Trash · excluded' : material.status === 'ready' ? 'Ready to use' : material.status === 'failed' ? 'Processing failed · retry in Course Materials' : 'Processing · not ready yet';
  }
  async function refreshSourceStatus(): Promise<void> {
    if (disposed || refreshingSources) return;
    refreshingSources = true; updateControls();
    try {
      const latest = new Map((await listMaterials(courseId)).map(material => [material._id, material]));
      if (disposed) return;
      // Preserve the instructor's exact selection and row order while metadata
      // changes. Newly uploaded files require reopening this source selector.
      materials = materials.map(material => latest.get(material._id) ?? { ...material, deletedAt: material.deletedAt ?? new Date().toISOString() });
      sourceList.querySelectorAll<HTMLInputElement>('input').forEach(input => {
        const material = materials.find(item => item._id === input.value);
        if (!material) return;
        const caption = input.closest('label')?.querySelector('small');
        if (caption) caption.textContent = sourceCaption(material);
      });
    } catch { /* The authoritative readiness request still guards generation. */ }
    finally { refreshingSources = false; if (!disposed) updateControls(); }
  }
  function options(): StructureOptions {
    return { ...(capabilityCheck.checked ? { capabilityDistinctnessProtocol: 'outline-capability-distinctness-v1' as const } : {}), materialIds: [...sources], ...(sourceBatchId ? { sourceBatchId } : {}), ...(replacements.size ? { sourceReplacements: [...replacements].map(([previousMaterialId, replacementMaterialId]) => ({ previousMaterialId, replacementMaterialId })) } : {}), ...(topics.select.value ? { topicCount: Number(topics.select.value) } : {}),
      ...(objectives.select.value ? { losPerTopic: Number(objectives.select.value) } : {}),
      level: level.select.value as StructureOptions['level'], emphasis: emphasis.select.value as StructureOptions['emphasis'], guidance: guidance.value.trim() };
  }
  async function start(): Promise<void> {
    if (active() || applying || !sources.size) return;
    if (result && !await confirmDialog({ title: 'Generate a new draft?', message: 'This replaces your current AI draft and its unsaved edits. The saved course outline is kept.', confirmLabel: 'Generate new draft' })) return;
    rememberDraft(); repair.clear(); consolidation.clear(); explicitlyViewedChild = ''; pendingSnapshot = undefined;
    starting = true; message.textContent = ''; result = undefined; draft = []; reviewedRun = ''; acceptedRunId = ''; run = undefined;
    settings.open = false; displayKey = ''; draw();
    try {
      if (sourceBatchId && !sourceSelectionEdited) {
        const batch = await getSourceReadiness(courseId, { sourceBatchId });
        if (!batch.ready) throw new Error(`Sources are not ready: ${batch.requested.filter(item => !item.ready).map(item => `${item.name}: ${item.reason ?? item.state}`).join('; ')}. Wait or explicitly change the source selection.`);
      }
      const report = await getSourceReadiness(courseId, { ...(sourceBatchId ? { sourceBatchId } : {}), materialIds: [...sources] });
      if (!report.ready) throw new Error(`Sources are not ready: ${report.requested.filter(item => !item.ready).map(item => `${item.name}: ${item.reason ?? item.state}`).join('; ')}`);
      if (report.excluded.length && !await confirmDialog({ title: 'Use this source selection?', message: `Excluded files: ${report.excluded.map(item => `${item.name} (${item.reason})`).join('; ')}.`, confirmLabel: 'Analyze selected sources' })) return;
      const response = await startStructureGeneration(courseId, options()); acceptedRunId = response.runId;
      accept(await getContentRun(courseId, response.runId));
    } catch (error) {
      if (acceptedRunId) { disconnected = true; message.textContent = 'Generation has started. Reconnecting to its live progress…'; }
      else message.textContent = error instanceof Error && error.message.startsWith('Sources are not ready:') ? error.message : failureMessage(error instanceof Error ? error.message : '');
    }
    finally { starting = false; draw(); }
  }
  function accept(value: ContentRunSummary): void {
    if (disposed || value.kind !== 'structure-generation' || value._id === dismissedRun) return;
    snapshots.set(value._id, value);
    if (Object.prototype.hasOwnProperty.call(value, 'structureConsolidation')) {
      pendingSnapshot = value;
      const initial = !run; if (initial) identityPending = true;
      void consolidation.load(value._id).catch(() => { message.textContent = 'Could not recover the consolidation parent. Refresh status; no unreviewed draft can be applied.'; }).finally(() => { if (initial) identityPending = false; if (!disposed && opened) draw(); });
      return;
    }
    if (value.input.capabilityDistinctnessProtocol && (value.status === 'completed' || value.status === 'failed')) void consolidation.load(value._id).catch(() => {});
    if (value._id === repair.view?.cycle.childRunId) { repair.observe(value); return; }
    if (run?._id === value._id) {
      const changed = value.revision > run.revision;
      acceptKnown(value);
      if (changed && (value.status === 'completed' || value.status === 'failed')) void repair.load(value._id).catch(() => {});
      return;
    }
    if (starting && !acceptedRunId) return;
    if (run && value.createdAt < run.createdAt) return;
    if (pendingSnapshot?._id === value._id && pendingSnapshot.revision >= value.revision) return;
    pendingSnapshot = value;
    // Resolve the saved parent/child identity before showing a new snapshot.
    // A completed child must never be selected implicitly while this GET waits.
    const initial = !run;
    if (initial) { identityPending = true; if (opened) draw(); }
    void repair.load(value._id).then(() => {
      if (pendingSnapshot?._id === value._id) pendingSnapshot = undefined;
    }).catch(() => {
      if (!run) message.textContent = 'Could not recover the saved draft’s identity. Refresh repair status to retry. No draft is available to apply yet.';
    }).finally(() => { if (initial) identityPending = false; if (!disposed && opened) draw(); });
  }
  function acceptKnown(value: StructureGenerationRun, force = false): void {
    if (starting && !acceptedRunId) return;
    if (disposed || value.kind !== 'structure-generation' || value._id === dismissedRun) return;
    if (force && run?._id !== value._id) {
      rememberDraft(); run = undefined; acceptedRunId = value._id; displayKey = '';
    }
    if (acceptedRunId && value._id !== acceptedRunId) return;
    if (run && value._id === run._id && value.revision <= run.revision) return;
    if (run && value._id !== run._id && value.createdAt < run.createdAt) return;
    if (!run) {
      acceptedRunId = value._id;
      sources.clear(); value.input.materialIds.forEach(id => sources.add(id));
      sourceBatchId = value.input.sourceBatchId;
      replacements.clear(); value.input.sourceReplacements?.forEach(item => replacements.set(item.previousMaterialId, item.replacementMaterialId)); drawReplacements();
      topics.select.value = value.input.topicCount ? String(value.input.topicCount) : '';
      objectives.select.value = value.input.losPerTopic ? String(value.input.losPerTopic) : '';
      level.select.value = value.input.level ?? 'auto'; emphasis.select.value = value.input.emphasis ?? 'auto';
      guidance.value = value.input.guidance ?? ''; capabilityCheck.checked = value.input.capabilityDistinctnessProtocol === 'outline-capability-distinctness-v1';
      sourceList.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.checked = sources.has(input.value); });
    }
    run = value;
    if (value.status === 'completed' && value.structureResult && reviewedRun !== value._id) {
      result = value.structureResult; reviewedRun = value._id;
      draft = restoreDraft(result, value._id);
    }
    if (value.status === 'failed') {
      result = undefined; draft = []; reviewedRun = '';
      message.textContent = failureMessage(value.error?.code ?? '');
    }
    else message.textContent = '';
    repair.setDisplayedRun(value._id);
    if (opened) draw();
  }
  function visibleDraft(): StructureDraft { return result ? { themes: draft } : active() ? run?.structurePreview ?? { themes: [] } : { themes: [] }; }
  let displayKey = '';
  function draw(): void {
    updateControls();
    const busy = active();
    const phase = run?.stage;
    const phaseLabel = identityPending ? 'Recovering the saved draft…' : consolidation.busy ? 'Preparing or reviewing the consolidation…' : repair.busy ? 'Checking the selected wording…' : starting ? 'Starting generation…' : run?.progressMessage ?? (phase === 'queued' ? 'Preparing your materials…' : phase === 'analyzing' ? `Reading materials · ${run?.completedUnits ?? 0} / ${run?.totalUnits ?? '…'} sections`
      : phase === 'synthesizing' ? 'Writing your course outline…' : phase === 'checking' ? 'Checking source coverage…' : 'Preparing…');
    status.replaceChildren(el('span', { class: busy ? 'structure-ai-live' : '', text: busy ? phaseLabel : result ? 'Draft ready · Review, edit, and select your objectives' : 'All selected materials will be analyzed before the outline is written.' }), stop);
    if (disconnected) status.prepend(el('small', { text: 'Live connection interrupted · reconnecting. ' }));
    status.hidden = !busy && !result && !disconnected;
    const shown = visibleDraft();
    const failed = run?.status === 'failed';
    content.hidden = failed;
    count.textContent = shown.themes.length ? `${shown.themes.length} topics · ${shown.themes.reduce((n, t) => n + t.los.length, 0)} objectives${busy ? ' · Writing live' : ''}` : failed ? 'No validated draft is available to apply.' : 'Your draft will appear here as it is written.';
    const key = result ? reviewedRun : 'stream';
    if (displayKey !== key) { content.replaceChildren(); displayKey = key; }
    if (!shown.themes.length) {
      content.replaceChildren(el('div', { class: 'structure-ai-blank' },
        el('span', { class: 'structure-ai-eyebrow', text: busy ? 'READING YOUR MATERIALS' : 'FROM MATERIALS TO LEARNING OBJECTIVES' }),
        el('h3', { text: busy ? 'Finding the shape of your course.' : failed ? 'Your saved outline is unchanged.' : 'An outline you can actually teach from.' }),
        el('p', { text: busy ? 'Analyzing the selected source sections. Topics and objectives will appear here as the outline is written.' : failed ? 'The streamed draft did not complete validation and cannot be applied. Review the error and source findings before generating again.' : 'A clear sequence of topics. Complete, measurable objectives. Every suggestion connected to your materials.' }),
        !failed && el('div', { class: 'structure-ai-outline-sketch', 'aria-hidden': 'true' },
          el('div', {}, el('b', { text: '01' }), el('span', { text: 'A focused topic' })),
          el('div', { text: '↳  What students should understand' }), el('div', { text: '↳  What students should be able to do' })),
        !busy && el('small', { text: 'Choose your materials, then select Generate draft.' })));
    } else if (result) {
      if (!content.querySelector('.structure-ai-topic-card')) {
        content.replaceChildren();
        draft.forEach((topic, index) => content.append(buildReviewTopic(topic, index)));
      }
    } else {
      content.querySelector('.structure-ai-blank')?.remove();
      while (content.children.length > shown.themes.length) content.lastElementChild?.remove();
      shown.themes.forEach((topic, index) => {
        let card = content.children[index] as HTMLElement | undefined;
        if (!card) {
          card = el('article', { class: 'structure-ai-topic-card' },
            el('header', {}, el('span', { class: 'structure-ai-topic-number', text: String(index + 1).padStart(2, '0') }), el('h3')),
            el('div', { class: 'structure-ai-live-rows' }));
          content.append(card);
        }
        card.querySelector('h3')!.textContent = topic.name || 'Writing topic…';
        const rows = card.querySelector('.structure-ai-live-rows')!;
        while (rows.children.length > topic.los.length) rows.lastElementChild?.remove();
        topic.los.forEach((lo, i) => {
          if (!rows.children[i]) rows.append(el('div', { class: 'structure-ai-draft-row' }, el('small', { class: 'outline-number', text: `${index + 1}.${i + 1}` }), el('span')));
          rows.children[i].querySelector('span')!.textContent = lo.name || 'Writing objective…';
          rows.children[i].classList.toggle('is-writing', !!busy && index === shown.themes.length - 1 && i === topic.los.length - 1);
        });
      });
    }
    if (result) requestAnimationFrame(() => { if (!disposed && opened) fitDraftFields(); });
    drawGrounding();
    const failedDiagnostics = failed && run?.structureDiagnostics;
    coverage.hidden = !result && !failedDiagnostics;
    const coverageKey = result ? reviewedRun : failedDiagnostics ? `${run!._id}:${run!.revision}:diagnostics` : '';
    if (coverageKey && coverage.dataset.run !== coverageKey) { coverage.dataset.run = coverageKey; drawCoverage(); }
  }
  function drawGrounding(): void {
    const receipt = result?.coverage.outlineGrounding ?? run?.structureDiagnostics?.outlineGrounding;
    grounding.hidden = !receipt;
    if (!receipt) { grounding.replaceChildren(); return; }
    const groupingSummary = receipt.version === 'original-final-lo-review-v2' ? ` · ${receipt.groupingIssues} topic placement ${receipt.groupingIssues === 1 ? 'concern' : 'concerns'}` : '';
    grounding.replaceChildren(el('summary', { 'aria-live': 'polite', text: `Original-source review · ${receipt.reviewedObjectives}/${receipt.totalObjectives} reviewed · ${receipt.supportedObjectives} supported · ${receipt.withheldObjectives} withheld${groupingSummary}` }));
    const remaining = receipt.totalObjectives - receipt.reviewedObjectives;
    const body = el('div', { class: 'structure-ai-coverage-body' },
      el('p', { text: receipt.complete ? 'The merged objectives were checked against their original source sections. This automated review still needs your judgment.' : `Review is incomplete. ${remaining} ${remaining === 1 ? 'objective has' : 'objectives have'} no completed finding. No incomplete draft can be applied.` }));
    const withheld = receipt.findings.filter(finding => finding.status !== 'supported');
    if (withheld.length) body.append(el('h3', { text: 'Objectives withheld from the draft' }),
      el('p', { class: 'structure-ai-note', text: 'These proposed objectives cannot be selected or applied. Shared source points may still be covered by another supported objective; unmapped learning points are listed separately.' }));
    for (const finding of withheld) {
      const detail = groundingDetail(finding, `${finding.status === 'uncertain' ? 'Uncertain' : 'Unsupported'} · ${finding.topic} / ${finding.name}`);
      if (receipt.version === 'original-final-lo-review-v2') {
        const grouping = receipt.findings.find(item => item.id === finding.id);
        if (grouping) detail.append(el('p', { class: 'structure-ai-note', text: `Topic placement: ${grouping.topicFit === 'fits' ? 'fits' : 'needs review'}. ${grouping.topicReason}` }));
      }
      body.append(detail);
    }
    if (receipt.version === 'original-final-lo-review-v2') {
      const placement = receipt.findings.filter(finding => finding.status === 'supported' && finding.topicFit !== 'fits');
      if (placement.length) {
        body.append(el('h3', { text: 'Supported objectives with topic placement concerns' }),
          el('p', { class: 'structure-ai-note', text: result ? 'These objectives are supported by their original sources and remain available in the draft. Review their topic placement before adding them to the course.' : 'These objectives have source support, but the outline is incomplete. Their topic placement also needs review. No incomplete draft can be applied.' }));
        for (const finding of placement) {
          const detail = groundingDetail(finding, `Source supported · ${finding.topic} / ${finding.name}`);
          detail.append(el('p', { class: 'structure-ai-note', text: `Topic placement needs review. ${finding.topicReason}` }));
          body.append(detail);
        }
      }
    }
    grounding.append(body);
  }
  function groundingDetail(finding: OutlineGroundingFinding, title: string): HTMLElement {
    const detail = el('details', { class: 'structure-ai-evidence' },
      el('summary', { text: title }), el('p', { text: finding.reason }));
    for (const materialId of [...new Set(finding.materialIds)]) {
      const name = result?.coverage.materials.find(material => material.materialId === materialId)?.name ?? materials.find(material => material._id === materialId)?.name ?? 'original source';
      detail.append(el('p', {}, el('a', { href: materialSourceUrl(courseId, materialId), target: '_blank', rel: 'noopener', text: `Open ${name} ↗` })));
    }
    const refs = result?.evidence.filter(point => finding.evidenceIds.includes(point.id)) ?? [];
    const passages = [...new Map(refs.flatMap(point => [{ ...point, passageId: point.sourcePassageId },
      ...(point.supportingPassages ?? []).map(passage => ({ ...point, passageId: passage.passageId, quote: passage.quote })),
    ]).map(point => [JSON.stringify([point.materialId, point.chunkIndex, point.passageId ?? '', point.quote]), point])).values()];
    for (const passage of passages) detail.append(el('div', {}, el('small', { text: `${passage.materialName} · ${passage.passageId ?? `Section ${passage.chunkIndex + 1}`}` }),
      el('blockquote', { text: passage.quote }), el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => previewEvidence(courseId, passage.materialId, passage.chunkIndex, passage.quote) }, 'Show passage in context')));
    return detail;
  }
  function fitDraftFields(): void {
    content.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(field => { field.style.height = 'auto'; field.style.height = `${field.scrollHeight + 2}px`; });
  }
  function buildReviewTopic(topic: SelectedTheme, index: number): HTMLElement {
    const title = el('textarea', { class: 'structure-ai-topic-title', rows: 1, maxlength: 200, 'aria-label': `Draft topic ${index + 1} name`, text: topic.name, oninput: () => {
      topic.name = title.value; rememberDraft(); updateControls(); fitDraftFields();
    } }) as HTMLTextAreaElement;
    const topicCheckbox = el('input', { type: 'checkbox', checked: topic.checked, 'aria-label': `Include topic ${index + 1}`, onchange: () => {
      topic.checked = topicCheckbox.checked; topic.los.forEach(lo => { lo.checked = topic.checked; });
      card.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input => { input.checked = topic.checked; });
      rememberDraft();
      updateControls();
    } }) as HTMLInputElement;
    const card = el('article', { class: 'structure-ai-topic-card' });
    const header = el('header', {}, el('span', { class: 'structure-ai-topic-number', text: String(index + 1).padStart(2, '0') }),
      title, topicCheckbox);
    const rows = el('div', { class: 'structure-ai-review-rows' });
    topic.los.forEach((lo, i) => {
      const check = el('input', { type: 'checkbox', checked: lo.checked, 'aria-label': `Include objective ${index + 1}.${i + 1}`, onchange: () => {
        lo.checked = check.checked; topic.checked = topic.los.some(item => item.checked); topicCheckbox.checked = topic.checked; rememberDraft(); updateControls();
      } }) as HTMLInputElement;
      const name = el('textarea', { class: 'structure-ai-lo-text', rows: 2, maxlength: 500, 'aria-label': `Objective ${index + 1}.${i + 1}`, text: lo.name,
        oninput: () => { lo.name = name.value; rememberDraft(); updateControls(); fitDraftFields(); } }) as HTMLTextAreaElement;
      const refs = [...new Map(result!.evidence.filter(e => lo.evidenceIds.includes(e.id)).flatMap(e => [
        { ...e, passageId: e.sourcePassageId, quote: e.quote },
        ...(e.supportingPassages ?? []).map(passage => ({ ...e, passageId: passage.passageId, quote: passage.quote })),
      ]).map(e => [JSON.stringify([e.materialId, e.chunkIndex, e.passageId ?? '', e.quote]), e])).values()];
      const sources = el('details', { class: 'structure-ai-evidence' }, el('summary', { text: `${lo.materialIds.length} supporting ${lo.materialIds.length === 1 ? 'material' : 'materials'} · View evidence` }));
      for (const ref of refs) sources.append(el('div', {}, el('a', { href: materialSourceUrl(courseId, ref.materialId), target: '_blank', rel: 'noopener', text: `${ref.materialName} · Section ${ref.chunkIndex + 1} ↗` }), ref.passageId ? el('small', { text: ref.passageId }) : false, el('blockquote', { text: ref.quote }), el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => previewEvidence(courseId, ref.materialId, ref.chunkIndex, ref.quote) }, 'Show passage in context')));
      const receipt = result?.coverage.outlineGrounding;
      const placement = receipt?.version === 'original-final-lo-review-v2' ? receipt.findings.find(finding => finding.topic === topic.name && finding.name === lo.name && finding.status === 'supported' && finding.topicFit !== 'fits' && lo.evidenceIds.length > 0 && lo.evidenceIds.every(id => finding.coveredEvidenceIds.includes(id))) : undefined;
      const placementNote = placement ? el('p', { class: 'structure-ai-note', text: `Topic placement needs review. ${placement.topicReason}` }) : false;
      rows.append(el('div', { class: 'structure-ai-review-row' }, el('div', { class: 'structure-ai-check' }, check, el('small', { text: `${index + 1}.${i + 1}` })), el('div', {}, name, placementNote, sources)));
    });
    card.append(header, rows);
    return card;
  }
  function drawCoverage(): void {
    const c = result?.coverage ?? (run?.status === 'failed' ? run.structureDiagnostics : undefined);
    if (!c) return;
    const total = (value: number | undefined) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value.toLocaleString() : 'unavailable';
    const reviewModel = result ? buildStructureCoverageReviewModel(result) : undefined;
    coverage.replaceChildren(el('summary', { text: result ? `Source coverage · ${total(reviewModel?.totals?.materials)} materials analyzed · ${total(reviewModel?.totals?.mapped)}/${total(reviewModel?.totals?.extracted)} learning points mapped${result.coverage.unmappedEvidenceIds.length ? ' · Gaps to review' : ''}` : 'Source processing receipt · Outline incomplete' }));
    const body = el('div', { class: 'structure-ai-coverage-body' });
    body.append(result ? createStructureSourceCoverage(courseId, result, reviewModel) : createStructureCoverageDiagnostics(courseId, run!.structureDiagnostics!, materials));
    if (c.sourceSelection?.excluded.length) body.append(el('p', { text: `Excluded sources: ${c.sourceSelection.excluded.map(item => `${item.name} (${item.reason})`).join('; ')}` }));
    if (c.sourceSelection?.replacements?.length) body.append(el('p', { text: `Source replacements: ${c.sourceSelection.replacements.map(item => `${item.previousName} → ${item.replacementName}`).join('; ')}. Historical records retained.` }));
    if (c.cache) body.append(el('p', { text: `Source extraction cache: ${c.cache.hits} reused · ${c.cache.misses} newly analyzed · ${c.cache.reusedSections} sections reused.` }));
    if (c.synthesisInput?.packCount) body.append(el('p', { text: `Outline organization: ${total(c.synthesisInput.completedPacks)}/${total(c.synthesisInput.packCount)} source-supported groups completed before the combined draft. Unmapped group learning points: ${total(c.synthesisInput.packUnmappedEvidenceIds?.length)}.` }));
    if (c.synthesisInput?.reusedPacks !== undefined) body.append(el('p', { text: `Organization reuse: ${total(c.synthesisInput.reusedPacks)} validated groups reused · ${total(c.synthesisInput.newPacks)} groups analyzed. The combined outline is checked again.` }));
    if (c.budget) body.append(el('p', { text: `${c.budget.observedSends} observed model sends · input ${c.budget.reportedInputTokens ?? 'unavailable'} tokens · output ${c.budget.reportedOutputTokens ?? 'unavailable'} tokens. Hidden provider retries remain unknown.` }));
    if (result?.coverage.sourceInventory) {
      body.append(el('p', { text: `${total(reviewModel?.totals?.mappedPassages)}/${total(reviewModel?.totals?.totalPassages)} parsed passages have outline links. These links do not establish that every taught relationship is covered.` }));
    }
    for (const warning of result?.coverage.warnings ?? []) body.append(el('p', { class: 'structure-ai-note', text: warning }));
    coverage.append(body);
  }
  async function applyDraft(): Promise<void> {
    if (apply.disabled || !result) return;
    applying = true; updateControls(); message.textContent = '';
    try {
      const response = await applySuggestedHierarchy(courseId, { runId: reviewedRun, themes: draft.filter(t => t.checked).map(t => ({ name: t.name.trim(), los: t.los.filter(lo => lo.checked).map(lo => ({ name: lo.name.trim(), materialIds: lo.materialIds, sourceThemeIndex: lo.sourceThemeIndex, sourceLoIndex: lo.sourceLoIndex })) })) });
      dismissedRun = run?._id ?? ''; opened = false;
      try { sessionStorage.removeItem(editsKey(reviewedRun)); } catch { /* Course application already succeeded. */ }
      const wordingNotice = response.repairReview?.wording === 'instructor-edited'
        ? 'Your wording changes were recorded as instructor edits; the automated review applies to the earlier repaired wording.' : undefined;
      await onApplied([response.warning, wordingNotice].filter(Boolean).join(' ') || undefined);
      void response;
    } catch (error) { message.textContent = suggestedHierarchyApplyFailure(error); }
    finally { applying = false; updateControls(); }
  }
  function connect(): void {
    if (unsubscribe) return;
    unsubscribe = subscribeContentRuns(courseId, { onSnapshot: values => { disconnected = false; if (values.some(value => value.kind === 'material-ingest')) void refreshSourceStatus(); const latest = values.filter(v => v.kind === 'structure-generation').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; if (latest) accept(latest); if (opened) draw(); },
      onRun: value => { disconnected = false; if (value.kind === 'material-ingest') void refreshSourceStatus(); accept(value); }, onError: () => { disconnected = true; if (opened) draw(); } });
    polling = setInterval(() => {
      if (!opened || document.visibilityState !== 'visible') return;
      if (materials.some(material => !material.deletedAt && material.status === 'processing')) void refreshSourceStatus();
      if (acceptedRunId && (active() || disconnected)) void getContentRun(courseId, acceptedRunId).then(value => { disconnected = false; accept(value); }).catch(() => {});
      if (consolidation.busy || disconnected && consolidation.view?.checkpointId) void consolidation.refresh().catch(() => {});
      if (repair.view?.cycle.childRunId && (repair.busy || disconnected)) void repair.refresh();
    }, 5000);
  }
  let contentWidth = 0;
  const sizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (width && width !== contentWidth) { contentWidth = width; fitDraftFields(); }
  });
  sizeObserver.observe(content);
  const cleanup = () => { rememberDraft(); disposed = true; repair.dispose(); consolidation.dispose(); sizeObserver.disconnect(); unsubscribe?.(); unsubscribe = undefined; if (polling) clearInterval(polling); observer.disconnect(); };
  const observer = new MutationObserver(() => { if (!owner.isConnected) cleanup(); });
  observer.observe(document.body, { childList: true, subtree: true });
  draw();
  return {
    element,
    get isOpen() { return opened; },
    open() {
      opened = true; onToggle(); draw(); connect();
      void refreshSourceStatus();
      void listContentRuns(courseId, { kind: 'structure-generation', limit: 1 }).then(values => { values.forEach(accept); }).catch(() => {});
    },
    close() { opened = false; onToggle(); },
    dispose: cleanup,
  };
}
