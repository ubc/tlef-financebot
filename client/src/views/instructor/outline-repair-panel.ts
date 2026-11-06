import {
  getStructureRepair, startStructureRepair, materialSourceUrl,
  type ContentRunSummary, type StructureRepairMode, type StructureRepairPointView,
  type StructureRepairRequest, type StructureRepairTargetView, type StructureRepairView,
} from '../../api.js';
import { el } from '../../dom.js';
import { confirmDialog } from '../../modal.js';

const COVERAGE = 'coverage-wording-outline-repair-v1';
const WORDING = 'wording-only-outline-repair-v1';
const terminal = (status: string) => status !== 'queued' && status !== 'running';
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

/** Safe read projection only. A failed or unknown response cannot identify a
 * child as its parent or enable applying an unreviewed proposal. */
function isView(value: StructureRepairView): boolean {
  return value?.version === 'outline-wording-repair-view-v1'
    && typeof value.parentRunId === 'string' && value.parentRunId.length > 0
    && typeof value.availability?.canStart === 'boolean'
    && typeof value.availability.message === 'string'
    && typeof value.cycle?.used === 'boolean' && Array.isArray(value.targets?.items)
    && count(value.targets.total) && count(value.targets.page) && value.targets.page >= 1
    && count(value.targets.pageSize) && value.targets.pageSize >= 1 && value.targets.pageSize <= 10
    && value.targets.items.length <= 10
    && value.budget?.accounting === 'conservative-units-v1'
    && count(value.budget.remainingSends) && count(value.budget.remainingUnits)
    && value.limits?.maxTargets === 2 && value.limits.maxPointsPerTarget === 8
    && value.limits.maxSends === 10 && value.limits.maxInputUnits === 48000
    && value.limits.maxOutputUnits === 6000 && value.limits.maxNewUnits === 540000
    && value.targets.items.every(target => target && typeof target.id === 'string'
      && typeof target.name === 'string' && typeof target.topic === 'string' && typeof target.reason === 'string'
      && [COVERAGE, WORDING].includes(target.mode) && strings(target.preservedEvidenceIds)
      && strings(target.missingEvidenceIds) && Array.isArray(target.points) && target.points.every(point =>
        point && [point.id, point.objective, point.materialId, point.materialName].every(text => typeof text === 'string')
        && count(point.chunkIndex) && Array.isArray(point.quotes)
        && point.quotes.every(quote => quote && typeof quote.text === 'string')))
    && (!value.child || (value.child.parentRunId === value.parentRunId
      && typeof value.child.runId === 'string' && typeof value.child.canApply === 'boolean'
      && typeof value.child.unknownWork === 'boolean' && [COVERAGE, WORDING].includes(value.child.mode)
      && ['queued', 'running', 'completed', 'partial', 'failed'].includes(value.child.status)
      && Array.isArray(value.child.targets) && value.child.targets.every(target => target
        && typeof target.id === 'string' && typeof target.before === 'string'
        && (target.after === undefined || typeof target.after === 'string')
        && (!target.finding || typeof target.finding.reason === 'string'))
      && (!value.child.coverageAssessment || Array.isArray(value.child.coverageAssessment.targets)
        && value.child.coverageAssessment.targets.every(target => target && typeof target.id === 'string'
          && strings(target.requestedEvidenceIds) && strings(target.preservedEvidenceIds)
          && strings(target.missingEvidenceIds) && strings(target.lostEvidenceIds) && strings(target.reasons)))
      && (!value.child.canApply || value.child.status === 'completed' && !value.child.unknownWork
        && value.child.coverageAssessment?.status !== 'shortfall')));
}

export function createOutlineRepairPanel(courseId: string, callbacks: {
  onView(view: StructureRepairView): Promise<void>;
  onSelectDraft(runId: string): Promise<void>;
  onBusyChange(): void;
}) {
  const element = el('section', { class: 'structure-ai-coverage', 'aria-label': 'Repair outline wording' });
  let view: StructureRepairView | undefined;
  let requestRunId = '';
  let displayedRunId = '';
  let mode: StructureRepairMode = COVERAGE;
  let loading = false, sending = false, unknownRequest = false, disposed = false;
  let revision = 0;
  let notice = '';
  const selected = new Map<string, { target: StructureRepairTargetView; points: Set<string> }>();
  const details = el('details', {}, el('summary', { text: 'Repair outline wording' }));
  const body = el('div', { class: 'structure-ai-coverage-body' });
  details.append(body); element.append(details); element.hidden = true;
  const busy = () => sending || unknownRequest || !!view?.child && !terminal(view.child.status);
  const locked = () => loading || sending || unknownRequest || !!view?.cycle.used || !view?.availability.canStart;

  async function load(runId: string, page = 1): Promise<StructureRepairView> {
    requestRunId = runId;
    const ticket = ++revision;
    loading = true; element.hidden = false; draw();
    try {
      const next = await getStructureRepair(courseId, runId, page);
      if (!isView(next)) throw new Error('Repair options could not be verified.');
      if (disposed || ticket !== revision) return next;
      if (view?.parentRunId !== next.parentRunId) selected.clear();
      view = next; loading = false; unknownRequest = false; notice = '';
      if (next.cycle.mode) mode = next.cycle.mode;
      draw(); callbacks.onBusyChange();
      await callbacks.onView(next);
      return next;
    } catch (error) {
      if (!disposed && ticket === revision) {
        loading = false;
        notice = error instanceof Error && error.message === 'Repair options could not be verified.'
          ? error.message : 'Could not load repair options. Your current draft and edits are retained.';
        draw(); callbacks.onBusyChange();
      }
      throw error;
    }
  }

  function point(point: StructureRepairPointView, target: StructureRepairTargetView): HTMLElement {
    const choice = selected.get(target.id);
    const missing = target.missingEvidenceIds.includes(point.id);
    const elsewhere = [...selected].some(([id, value]) => id !== target.id && value.points.has(point.id));
    const check = el('input', { type: 'checkbox', checked: choice?.points.has(point.id),
      disabled: locked() || mode !== COVERAGE || !choice || !missing || elsewhere
        || !choice.points.has(point.id) && choice.points.size >= 8,
      'aria-label': `Cover source point ${point.id} for ${target.id}`,
      onchange: () => {
        if (!choice) return;
        if (check.checked) choice.points.add(point.id); else choice.points.delete(point.id);
        draw();
      } }) as HTMLInputElement;
    const title = el('label', { class: 'row row--wrap' }, missing ? check : false,
      el('span', { text: `${point.id} · ${point.objective}${target.preservedEvidenceIds.includes(point.id) ? ' · Previously credited' : ''}${elsewhere ? ' · Selected in another objective' : ''}` }));
    const original = el('details', { class: 'structure-ai-evidence' },
      el('summary', { text: `${point.materialName} · Source quotes` }),
      el('a', { href: materialSourceUrl(courseId, point.materialId), target: '_blank', rel: 'noopener', text: 'Open original material' }));
    for (const quote of point.quotes) original.append(el('div', {},
      quote.passageId ? el('small', { text: quote.passageId }) : false, el('blockquote', { text: quote.text })));
    return el('div', {}, title, original);
  }

  function targetRow(target: StructureRepairTargetView): HTMLElement {
    const entry = selected.get(target.id);
    const check = el('input', { type: 'checkbox', checked: !!entry,
      disabled: locked() || target.mode !== mode || !entry && selected.size >= 2,
      'aria-label': `Select ${target.id} for wording repair`, onchange: () => {
        if (check.checked) selected.set(target.id, { target, points: new Set() }); else selected.delete(target.id);
        draw();
      } }) as HTMLInputElement;
    const row = el('details', { class: 'structure-ai-evidence', open: !!entry },
      el('summary', { text: `${target.id} · ${target.status === 'supported' ? 'Source supported' : 'Withheld'} · ${target.name}` }),
      el('label', { class: 'row row--wrap' }, check, el('span', { text: `Select ${target.id} · ${target.topic}` })),
      el('p', { text: target.reason }),
      el('p', { class: 'structure-ai-note', text: target.mode === COVERAGE
        ? `Uncredited source points to review: ${target.missingEvidenceIds.join(', ') || 'None'}. Previously credited: ${target.preservedEvidenceIds.join(', ') || 'None'}.`
        : 'A repair may narrow this wording to the original source. A fresh review can still withhold it.' }));
    if (target.mode !== mode) row.append(el('p', { class: 'structure-ai-note', text: 'Choose the other repair goal to select this objective.' }));
    for (const item of target.points) row.append(point(item, target));
    return row;
  }

  function draw(): void {
    if (disposed) return;
    const heading = 'One repair attempt per draft. Select up to two objectives; review changes before applying.';
    body.replaceChildren(el('p', { text: heading }));
    if (notice) body.append(el('p', { class: 'structure-ai-message', role: 'status', text: notice }));
    const refresh = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: loading || sending,
      onclick: () => load(requestRunId, view?.targets.page ?? 1).catch(() => {}) }, loading ? 'Loading repair options…' : 'Refresh repair status');
    body.append(refresh);
    if (!view) return;
    body.append(el('p', { class: 'structure-ai-note', text: view.availability.message }));
    const budget = el('details', { class: 'structure-ai-evidence' }, el('summary', { text: 'Repair budget' }),
      el('p', { text: `At most 10 model sends, limited by the original draft’s remaining allowance (${view.budget.remainingSends} sends; ${view.budget.remainingUnits.toLocaleString()} conservative units).` }),
      el('p', { text: 'Per send: at most 48,000 input units and 6,000 output units. This repair can reserve at most 540,000 new conservative units. These are admission limits, not reported provider tokens or a cost estimate.' }));
    body.append(budget);
    const child = view.child;
    if (child) {
      body.append(el('h3', { text: `Repair ${child.status === 'completed' && child.canApply ? 'ready for review' : child.status}` }),
        el('p', { class: 'structure-ai-note', role: 'status', text: child.unknownWork
          ? 'Some model work has an unknown outcome. This attempt cannot be restarted. The original draft is retained.'
          : 'The original draft and your edits are retained. Nothing is added to the course automatically.' }),
        el('div', { class: 'row row--wrap' },
          el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-pressed': displayedRunId === view.parentRunId,
            onclick: () => callbacks.onSelectDraft(view!.parentRunId) }, 'Review original draft'),
          el('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: !child.canApply || child.status !== 'completed',
            'aria-pressed': displayedRunId === child.runId, onclick: () => callbacks.onSelectDraft(child.runId) }, 'Review repaired draft')));
      if (child.error) body.append(el('p', { class: 'structure-ai-note', text: child.error.message }));
      for (const change of child.targets) {
        const comparison = el('details', { class: 'structure-ai-evidence' }, el('summary', { text: `${change.id} · Before and after` }),
          el('p', {}, el('strong', { text: 'Original: ' }), el('span', { text: change.before })),
          el('p', {}, el('strong', { text: 'Proposal: ' }), el('span', { text: change.after ?? (change.proposalStatus === 'pending' ? 'Waiting for a proposal.' : 'No supported repair was proposed.') })));
        if (change.proposalReason) comparison.append(el('p', { text: change.proposalReason }));
        comparison.append(el('p', { text: change.finding ? `Fresh source review: ${change.finding.status}. ${change.finding.reason}` : 'Fresh source review: unavailable.' }));
        const receipt = child.coverageAssessment?.targets.find(item => item.id === change.id);
        if (receipt) {
          comparison.append(el('p', { text: `Coverage check: ${receipt.status}. Requested: ${receipt.requestedEvidenceIds.join(', ') || 'None'}. Preserved: ${receipt.preservedEvidenceIds.join(', ') || 'None'}. Missing: ${receipt.missingEvidenceIds.join(', ') || 'None'}. Lost: ${receipt.lostEvidenceIds.join(', ') || 'None'}.` }));
          for (const reason of receipt.reasons) comparison.append(el('p', { text: reason }));
        }
        const original = view.targets.items.find(target => target.id === change.id) ?? selected.get(change.id)?.target;
        if (original) for (const item of original.points) comparison.append(point(item, original));
        body.append(comparison);
      }
      if (child.coverageAssessment?.status === 'shortfall') body.append(el('p', { class: 'structure-ai-note', text: 'The repair has an unresolved coverage shortfall and cannot be applied. Review the retained proposal and original sources.' }));
    }
    if (view.cycle.used) {
      body.append(el('p', { class: 'structure-ai-note', text: 'This draft’s one repair attempt has been used. Changing the goal or selection does not create another attempt.' }));
    } else {
      const goal = el('select', { class: 'input', 'aria-label': 'Repair goal', disabled: locked(), onchange: () => {
      mode = goal.value as StructureRepairMode; selected.clear(); draw();
    } }, el('option', { value: COVERAGE, text: 'Cover uncredited source points' }),
    el('option', { value: WORDING, text: 'Repair withheld wording' })) as HTMLSelectElement;
    goal.value = mode;
    body.append(el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Repair goal' }), goal),
      el('p', { class: 'structure-ai-note', text: 'Repairs use the saved original wording. Local edits stay separate. Choose one goal for this attempt; missing source points are review prompts, not a proven curriculum gap.' }));
    }
    if (!view.cycle.used) for (const target of view.targets.items) body.append(targetRow(target));
    if (!view.targets.items.length) body.append(el('p', { class: 'structure-ai-note', text: 'No repair targets are available in this saved draft.' }));
    const page = view.targets.page, pages = Math.max(1, Math.ceil(view.targets.total / view.targets.pageSize));
    body.append(el('div', { class: 'row row--wrap' },
      el('span', { text: `Page ${page} of ${pages} · ${view.targets.total} objectives` }),
      el('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: loading || page <= 1,
        onclick: () => load(view!.parentRunId, page - 1).catch(() => {}) }, 'Previous repair targets'),
      el('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: loading || page >= pages,
        onclick: () => load(view!.parentRunId, page + 1).catch(() => {}) }, 'Next repair targets')));
    if (view.cycle.used) return;
    const validSelection = selected.size > 0 && [...selected.values()].every(item => mode === WORDING || item.points.size > 0);
    body.append(el('p', { class: 'structure-ai-note', text: `${selected.size}/2 objectives selected${mode === COVERAGE ? ' · Select up to 8 uncredited points per objective' : ''}` }),
      el('button', { type: 'button', class: 'btn btn--instr-primary', disabled: locked() || !validSelection,
        onclick: submit }, sending ? 'Starting repair…' : 'Repair selected wording'));
  }

  async function submit(): Promise<void> {
    if (locked() || !view || !selected.size) return;
    const entries = [...selected.values()];
    if (mode === COVERAGE && entries.some(item => !item.points.size)) return;
    const input: StructureRepairRequest = mode === WORDING
      ? { version: WORDING, targetIds: entries.map(item => item.target.id) }
      : { version: COVERAGE, targets: entries.map(item => ({ id: item.target.id, evidenceIds: [...item.points] })) };
    const parent = view.parentRunId;
    const confirmed = await confirmDialog({ title: 'Repair the selected wording?', confirmLabel: 'Start one repair attempt',
      message: `${entries.map(({ target, points }) => `${target.id}: ${target.name}${mode === COVERAGE ? ` Requested source points: ${target.points.filter(point => points.has(point.id)).map(point => `${point.id}: ${point.objective}`).join('; ')}` : ''}`).join('\n\n')}\n\nThis uses the draft’s one repair attempt and may make up to 10 model sends within its remaining allowance. The original draft and your local edits are kept. Review the result before adding anything to the course.` });
    if (!confirmed || disposed || locked() || view.parentRunId !== parent) return;
    sending = true; notice = ''; draw(); callbacks.onBusyChange();
    try {
      const response = await startStructureRepair(courseId, parent, input);
      requestRunId = response.runId;
      await load(response.runId);
      sending = false; draw(); callbacks.onBusyChange();
    } catch {
      sending = false; unknownRequest = true;
      notice = 'The request may have started. Refresh repair status to recover the same attempt before trying anything else.';
      draw(); callbacks.onBusyChange();
    }
  }

  return {
    element, load, get view() { return view; }, get busy() { return busy(); },
    setDisplayedRun(runId: string) { displayedRunId = runId; draw(); },
    observe(value: ContentRunSummary) {
      if (!view || value.kind !== 'structure-generation' || value._id !== view.cycle.childRunId) return;
      if (view.child && terminal(view.child.status) && !terminal(value.status)) return;
      if (view.child) view.child = { ...view.child, status: value.status };
      draw(); callbacks.onBusyChange();
      if (terminal(value.status)) void load(value._id, view.targets.page).catch(() => {});
    },
    refresh() { return requestRunId ? load(requestRunId, view?.targets.page ?? 1).catch(() => undefined) : Promise.resolve(undefined); },
    clear() { revision += 1; view = undefined; requestRunId = ''; selected.clear(); notice = ''; element.hidden = true; },
    dispose() { disposed = true; revision += 1; },
  };
}
