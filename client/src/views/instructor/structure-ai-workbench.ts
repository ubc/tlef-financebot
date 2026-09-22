import {
  applySuggestedHierarchy, endContentRun, getContentRun, listContentRuns, startStructureGeneration, subscribeContentRuns,
  type ContentRunSummary, type Material, type StructureDraft, type StructureGenerationRun, type StructureOptions, type StructureResult,
} from '../../api.js';
import { el } from '../../dom.js';
import { confirmDialog } from '../../modal.js';
import { materialSourceUrl } from '../../api.js';
import { previewEvidence } from './coverage-graph.js';

type SelectedTheme = Omit<StructureResult['themes'][number], 'los'> & { checked: boolean; los: Array<StructureResult['themes'][number]['los'][number] & { checked: boolean }> };
const failureMessage = (code: string) => ({
  'structure-no-materials': 'Choose at least one ready material to build your outline.',
  'structure-material-unavailable': 'A selected file is no longer ready. Refresh the page and check your materials.',
  'structure-chunks-missing': 'Some files have no complete extracted text. Reprocess them in Course Materials before generating.',
  'structure-corpus-too-large': 'This selection is too large to analyze completely in one run. Choose a smaller group of materials.',
  'structure-material-changed': 'A source changed during analysis. Generate again to use its current text.',
  'structure-no-evidence': 'No teachable content was found in the selected files. Check the extracted text in Course Materials.',
  'structure-analysis-invalid': 'The source analysis could not be validated. Try generating again, or choose fewer materials. No objectives were saved.',
  'structure-outline-invalid': 'The draft did not meet the requested structure. Try AI-decided counts or adjust your instructions.',
  'structure-enqueue-failed': 'Generation could not be queued. Please try again.',
  'server-restarted': 'Generation was interrupted by a server restart. Generate again to continue.',
  'generation-ended': 'Generation stopped. Your saved course outline is unchanged.',
}[code] ?? 'The draft could not be completed. Your course outline is unchanged. Please try again.');

/** Retained, same-page draft workspace. SSE snapshots update text in place;
 * saved course data is untouched until explicit reviewed apply. */
export function createStructureAssistant(courseId: string, materials: Material[], onToggle: () => void, onApplied: () => Promise<void>, owner: HTMLElement) {
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
  const ready = materials.filter(m => m.status === 'ready' && !m.deletedAt);
  const sources = new Set(ready.map(m => m._id));
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
    const input = el('input', { type: 'checkbox', checked: sources.has(material._id), disabled: material.status !== 'ready', onchange: () => {
      if (input.checked) sources.add(material._id); else sources.delete(material._id);
      updateControls();
    }, 'aria-label': `Use ${material.name}` }) as HTMLInputElement;
    sourceList.append(el('label', {}, input, el('span', {}, el('strong', { text: material.name }), el('small', { text: material.status === 'ready' ? 'Ready to use' : 'Processing · not ready yet' }))));
  }
  sourceDetails.append(el('h3', { text: 'Ground in these materials' }), sourceList, sourceSummary);
  if (!ready.length) sourceDetails.append(el('p', { class: 'structure-ai-note', text: 'Upload a material and wait for processing to finish before generating.' }), el('a', { class: 'btn btn--ghost btn--sm', href: `#/instructor/course/${courseId}/materials`, text: 'Open Course Materials →' }));
  configFields.append(el('div', { class: 'structure-ai-config-grid' }, topics.element, objectives.element, level.element, emphasis.element), guidance);
  settings.append(el('summary', {}, 'Customize generation', el('small', { text: 'Optional' })), configFields);
  configFields.append(el('button', { type: 'button', class: 'structure-ai-reset', onclick: () => { topics.select.value = ''; objectives.select.value = ''; level.select.value = 'auto'; emphasis.select.value = 'auto'; guidance.value = ''; } }, 'Reset to AI defaults')); 
  const generate = el('button', { type: 'button', class: 'btn btn--instr-primary', onclick: start }, 'Generate outline') as HTMLButtonElement;
  const stop = el('button', { type: 'button', class: 'btn btn--ghost', onclick: async () => {
    const runId = run?._id ?? acceptedRunId;
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
  const footerText = el('span');
  const apply = el('button', { type: 'button', class: 'btn btn--instr-primary', onclick: applyDraft }, 'Add selected to course') as HTMLButtonElement;
  const footer = el('div', { class: 'structure-ai-footer' }, footerText, apply);
  const draftArea = el('div', { class: 'structure-ai-draft-area' },
    el('header', { class: 'structure-ai-toolbar' }, el('div', {}, el('h2', { text: 'Suggested outline' }), count)),
    message, status, content, coverage, footer);
  element.append(composer, draftArea);

  const active = () => starting || (!run && !!acceptedRunId) || run?.status === 'queued' || run?.status === 'running';
  function updateControls(): void {
    const busy = active();
    configFields.disabled = !!busy || applying;
    content.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(node => { node.disabled = applying; });
    sourceList.querySelectorAll<HTMLInputElement>('input').forEach((input, i) => { input.disabled = !!busy || materials.filter(m => !m.deletedAt)[i].status !== 'ready'; });
    generate.disabled = !!busy || applying || !sources.size;
    generate.textContent = busy ? 'Generating…' : result ? 'Generate again' : 'Generate draft →';
    generate.setAttribute('aria-busy', String(!!busy));
    sourceSummary.textContent = `${sources.size} ${sources.size === 1 ? 'material' : 'materials'} selected`; 
    stop.hidden = !busy; stop.disabled = starting;
    const selected = draft.filter(t => t.checked).flatMap(t => t.los.filter(lo => lo.checked));
    apply.disabled = !!busy || applying || !result || !selected.length || draft.some(t => t.checked && (!t.name.trim() || !t.los.some(lo => lo.checked) || t.los.some(lo => lo.checked && !lo.name.trim())));
    apply.textContent = applying ? 'Adding to course…' : 'Add selected to course';
    footer.hidden = !result;
    footerText.textContent = `${selected.length} objectives selected · Existing content will be kept`;
  }
  function options(): StructureOptions {
    return { materialIds: [...sources], ...(topics.select.value ? { topicCount: Number(topics.select.value) } : {}),
      ...(objectives.select.value ? { losPerTopic: Number(objectives.select.value) } : {}),
      level: level.select.value as StructureOptions['level'], emphasis: emphasis.select.value as StructureOptions['emphasis'], guidance: guidance.value.trim() };
  }
  async function start(): Promise<void> {
    if (active() || applying || !sources.size) return;
    if (result && !await confirmDialog({ title: 'Generate a new draft?', message: 'This replaces your current AI draft and its unsaved edits. The saved course outline is kept.', confirmLabel: 'Generate new draft' })) return;
    starting = true; message.textContent = ''; result = undefined; draft = []; reviewedRun = ''; acceptedRunId = ''; run = undefined;
    settings.open = false; displayKey = ''; draw();
    try {
      const response = await startStructureGeneration(courseId, options()); acceptedRunId = response.runId;
      accept(await getContentRun(courseId, response.runId));
    } catch (error) {
      if (acceptedRunId) { disconnected = true; message.textContent = 'Generation has started. Reconnecting to its live progress…'; }
      else message.textContent = failureMessage(error instanceof Error ? error.message : '');
    }
    finally { starting = false; draw(); }
  }
  function accept(value: ContentRunSummary): void {
    if (starting && !acceptedRunId) return;
    if (disposed || value.kind !== 'structure-generation' || value._id === dismissedRun) return;
    if (acceptedRunId && value._id !== acceptedRunId) return;
    if (run && value._id === run._id && value.revision <= run.revision) return;
    if (run && value._id !== run._id && value.createdAt < run.createdAt) return;
    if (!run) {
      acceptedRunId = value._id;
      sources.clear(); value.input.materialIds.forEach(id => sources.add(id));
      topics.select.value = value.input.topicCount ? String(value.input.topicCount) : '';
      objectives.select.value = value.input.losPerTopic ? String(value.input.losPerTopic) : '';
      level.select.value = value.input.level ?? 'auto'; emphasis.select.value = value.input.emphasis ?? 'auto';
      guidance.value = value.input.guidance ?? '';
      sourceList.querySelectorAll<HTMLInputElement>('input').forEach((input, i) => { input.checked = sources.has(materials.filter(m => !m.deletedAt)[i]._id); });
    }
    run = value;
    if (value.status === 'completed' && value.structureResult && reviewedRun !== value._id) {
      result = value.structureResult; reviewedRun = value._id;
      draft = result.themes.map(t => ({ ...t, checked: true, los: t.los.map(lo => ({ ...lo, checked: true })) }));
    }
    if (value.status === 'failed') message.textContent = failureMessage(value.error?.code ?? '');
    else message.textContent = '';
    if (opened) draw();
  }
  function visibleDraft(): StructureDraft { return result ? { themes: draft } : run?.structurePreview ?? { themes: [] }; }
  let displayKey = '';
  function draw(): void {
    updateControls();
    const busy = active();
    const phase = run?.stage;
    const phaseLabel = starting ? 'Starting generation…' : run?.progressMessage ?? (phase === 'queued' ? 'Preparing your materials…' : phase === 'analyzing' ? `Reading materials · ${run?.completedUnits ?? 0} / ${run?.totalUnits ?? '…'} sections`
      : phase === 'synthesizing' ? 'Writing your course outline…' : phase === 'checking' ? 'Checking source coverage…' : 'Preparing…');
    status.replaceChildren(el('span', { class: busy ? 'structure-ai-live' : '', text: busy ? phaseLabel : result ? 'Draft ready · Review, edit, and select your objectives' : 'All selected materials will be analyzed before the outline is written.' }), stop);
    if (disconnected) status.prepend(el('small', { text: 'Live connection interrupted · reconnecting. ' }));
    status.hidden = !busy && !result && !disconnected;
    const shown = visibleDraft();
    count.textContent = shown.themes.length ? `${shown.themes.length} topics · ${shown.themes.reduce((n, t) => n + t.los.length, 0)} objectives${busy ? ' · Writing live' : ''}` : 'Your draft will appear here as it is written.';
    const key = result ? reviewedRun : 'stream';
    if (displayKey !== key) { content.replaceChildren(); displayKey = key; }
    if (!shown.themes.length) {
      content.replaceChildren(el('div', { class: 'structure-ai-blank' },
        el('span', { class: 'structure-ai-eyebrow', text: busy ? 'READING YOUR MATERIALS' : 'FROM MATERIALS TO LEARNING OBJECTIVES' }),
        el('h3', { text: busy ? 'Finding the shape of your course.' : 'An outline you can actually teach from.' }),
        el('p', { text: busy ? 'Analyzing the selected source sections. Topics and objectives will appear here as the outline is written.' : 'A clear sequence of topics. Complete, measurable objectives. Every suggestion connected to your materials.' }),
        el('div', { class: 'structure-ai-outline-sketch', 'aria-hidden': 'true' },
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
    coverage.hidden = !result;
    if (result && coverage.dataset.run !== reviewedRun) { coverage.dataset.run = reviewedRun; drawCoverage(); }
  }
  function fitDraftFields(): void {
    content.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(field => { field.style.height = 'auto'; field.style.height = `${field.scrollHeight + 2}px`; });
  }
  function buildReviewTopic(topic: SelectedTheme, index: number): HTMLElement {
    const title = el('textarea', { class: 'structure-ai-topic-title', rows: 1, maxlength: 200, 'aria-label': `Draft topic ${index + 1} name`, text: topic.name, oninput: () => {
      topic.name = title.value; updateControls(); fitDraftFields();
    } }) as HTMLTextAreaElement;
    const topicCheckbox = el('input', { type: 'checkbox', checked: topic.checked, 'aria-label': `Include topic ${index + 1}`, onchange: () => {
      topic.checked = topicCheckbox.checked; topic.los.forEach(lo => { lo.checked = topic.checked; });
      card.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input => { input.checked = topic.checked; });
      updateControls();
    } }) as HTMLInputElement;
    const card = el('article', { class: 'structure-ai-topic-card' });
    const header = el('header', {}, el('span', { class: 'structure-ai-topic-number', text: String(index + 1).padStart(2, '0') }),
      title, topicCheckbox);
    const rows = el('div', { class: 'structure-ai-review-rows' });
    topic.los.forEach((lo, i) => {
      const check = el('input', { type: 'checkbox', checked: lo.checked, 'aria-label': `Include objective ${index + 1}.${i + 1}`, onchange: () => {
        lo.checked = check.checked; topic.checked = topic.los.some(item => item.checked); topicCheckbox.checked = topic.checked; updateControls();
      } }) as HTMLInputElement;
      const name = el('textarea', { class: 'structure-ai-lo-text', rows: 2, maxlength: 500, 'aria-label': `Objective ${index + 1}.${i + 1}`, text: lo.name,
        oninput: () => { lo.name = name.value; updateControls(); fitDraftFields(); } }) as HTMLTextAreaElement;
      const refs = [...new Map(result!.evidence.filter(e => lo.evidenceIds.includes(e.id))
        .map(e => [JSON.stringify([e.materialId, e.chunkIndex, e.quote]), e])).values()];
      const sources = el('details', { class: 'structure-ai-evidence' }, el('summary', { text: `${lo.materialIds.length} supporting ${lo.materialIds.length === 1 ? 'material' : 'materials'} · View evidence` }));
      for (const ref of refs) sources.append(el('div', {}, el('a', { href: materialSourceUrl(courseId, ref.materialId), target: '_blank', rel: 'noopener', text: `${ref.materialName} · Section ${ref.chunkIndex + 1} ↗` }), el('blockquote', { text: ref.quote }), el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => previewEvidence(courseId, ref.materialId, ref.chunkIndex, ref.quote) }, 'Show passage in context')));
      rows.append(el('div', { class: 'structure-ai-review-row' }, el('div', { class: 'structure-ai-check' }, check, el('small', { text: `${index + 1}.${i + 1}` })), el('div', {}, name, sources)));
    });
    card.append(header, rows);
    return card;
  }
  function drawCoverage(): void {
    if (!result) return;
    const c = result.coverage;
    coverage.replaceChildren(el('summary', { text: `Source coverage · ${c.materials.length} materials analyzed · ${c.mappedObjectives}/${c.extractedObjectives} learning points mapped${c.unmappedEvidenceIds.length ? ' · Gaps to review' : ''}` }));
    const body = el('div', { class: 'structure-ai-coverage-body' }, el('p', { text: 'These counts describe the AI draft before your edits and selections.' }));
    for (const m of c.materials) body.append(el('p', {}, el('strong', { text: m.name }), ` · ${m.chunks} source sections · ${m.mappedObjectives} learning points mapped`));
    if (c.unmappedEvidenceIds.length) body.append(el('h3', { text: 'Learning points not yet mapped' }), el('ul', {}, ...result.evidence.filter(e => c.unmappedEvidenceIds.includes(e.id)).map(e => el('li', { text: `${e.objective} — ${e.materialName}` }))));
    if (c.excludedSections.length) body.append(el('h3', { text: 'Sections without extracted objectives' }), el('ul', {}, ...c.excludedSections.map(e => el('li', { text: `${c.materials.find(m => m.materialId === e.materialId)?.name} · Section ${e.chunkIndex + 1}: ${e.reason}` }))));
    for (const warning of c.warnings) body.append(el('p', { class: 'structure-ai-note', text: warning }));
    coverage.append(body);
  }
  async function applyDraft(): Promise<void> {
    if (apply.disabled || !result) return;
    applying = true; updateControls(); message.textContent = '';
    try {
      const response = await applySuggestedHierarchy(courseId, { themes: draft.filter(t => t.checked).map(t => ({ name: t.name.trim(), los: t.los.filter(lo => lo.checked).map(lo => ({ name: lo.name.trim(), materialIds: lo.materialIds })) })) });
      dismissedRun = run?._id ?? ''; opened = false;
      await onApplied();
      void response;
    } catch { message.textContent = 'Could not apply the draft. Your edits are retained; please try again.'; }
    finally { applying = false; updateControls(); }
  }
  function connect(): void {
    if (unsubscribe) return;
    unsubscribe = subscribeContentRuns(courseId, { onSnapshot: values => { disconnected = false; const latest = values.filter(v => v.kind === 'structure-generation').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; if (latest) accept(latest); if (opened) draw(); },
      onRun: value => { disconnected = false; accept(value); }, onError: () => { disconnected = true; if (opened) draw(); } });
    polling = setInterval(() => { if (opened && document.visibilityState === 'visible' && acceptedRunId && (active() || disconnected)) void getContentRun(courseId, acceptedRunId).then(value => { disconnected = false; accept(value); }).catch(() => {}); }, 5000);
  }
  let contentWidth = 0;
  const sizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (width && width !== contentWidth) { contentWidth = width; fitDraftFields(); }
  });
  sizeObserver.observe(content);
  const cleanup = () => { disposed = true; sizeObserver.disconnect(); unsubscribe?.(); unsubscribe = undefined; if (polling) clearInterval(polling); observer.disconnect(); };
  const observer = new MutationObserver(() => { if (!owner.isConnected) cleanup(); });
  observer.observe(document.body, { childList: true, subtree: true });
  draw();
  return {
    element,
    get isOpen() { return opened; },
    open() {
      opened = true; onToggle(); draw(); connect();
      void listContentRuns(courseId, { kind: 'structure-generation', limit: 1 }).then(values => { values.forEach(accept); }).catch(() => {});
    },
    close() { opened = false; onToggle(); },
    dispose: cleanup,
  };
}
