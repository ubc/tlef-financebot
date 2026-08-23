// The batch planner as a dialog: "Plan a batch" from the Question Workspace.
// One row per Learning Objective — its kind, per-tier approved counts, and a
// stepper per tier x kind. Auto fills the grid from the server's plan; the
// instructor adjusts any count; one action enqueues one generation run per
// non-empty cell, each carrying an explicit difficulty and kind. The setup
// guide renders the same grid inline on its Questions step.
import {
  enqueueGenerationPlan,
  getGenerationPlan,
  type GenerationPlanCell,
  type GenerationPlanResult,
  type GenerationPlanRow,
} from '../../api.js';
import { el, mount } from '../../dom.js';

type Tier = 'easy' | 'medium' | 'hard';
type Kind = 'calculation' | 'conceptual';
type PlanCounts = Record<Tier, Record<Kind, number>>;
const TIERS: Tier[] = ['easy', 'medium', 'hard'];
const KINDS: Kind[] = ['calculation', 'conceptual'];

export interface GenerationPlanDialogOptions {
  courseId: string;
  /** Whether an LO has a ready assigned material — cells of LOs without one
   * are shown disabled with the reason, never enqueued. */
  hasReadySource: (loId: string) => boolean;
  /** Called with the enqueue result so the page can show runs and refresh. */
  onQueued: (result: GenerationPlanResult, cells: GenerationPlanCell[]) => void;
}

function emptyCounts(): PlanCounts {
  return { easy: { calculation: 0, conceptual: 0 }, medium: { calculation: 0, conceptual: 0 }, hard: { calculation: 0, conceptual: 0 } };
}

function autoCounts(row: GenerationPlanRow): PlanCounts {
  const counts = emptyCounts();
  for (const cell of row.cells) counts[cell.difficulty][cell.kind] += cell.count;
  return counts;
}

export function openGenerationPlanDialog(options: GenerationPlanDialogOptions): void {
  const dialog = el('dialog', { class: 'app-dialog app-dialog--wide', 'aria-labelledby': 'generation-plan-title' }) as HTMLDialogElement;
  const grid = el('div', { class: 'generation-plan__rows' });
  const status = el('p', { class: 'app-dialog__message', role: 'status', 'aria-live': 'polite' });
  const generateButton = el('button', { class: 'btn btn--instr-primary', type: 'button' }, 'Loading plan…') as HTMLButtonElement;
  const autoButton = el('button', { class: 'btn btn--ghost', type: 'button', title: 'Reset every count to the suggested plan' }, 'Auto') as HTMLButtonElement;
  const cancelButton = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Close') as HTMLButtonElement;

  let planRows: GenerationPlanRow[] = [];
  let plan = new Map<string, PlanCounts>();
  // Which LOs run NOW — separate from how many each needs, so an instructor
  // can keep Auto's counts and still generate for a subset.
  let selected = new Set<string>();
  let busy = false;

  const eligibleIds = (): string[] => planRows.filter((row) => options.hasReadySource(row.loId)).map((row) => row.loId);

  const resetToAuto = (): void => {
    plan = new Map(planRows.map((row) => [row.loId, autoCounts(row)]));
    // Auto selects every eligible LO that has something planned.
    selected = new Set(planRows
      .filter((row) => options.hasReadySource(row.loId) && row.cells.some((cell) => cell.count > 0))
      .map((row) => row.loId));
  };

  const cells = (): GenerationPlanCell[] => {
    const out: GenerationPlanCell[] = [];
    for (const [loId, counts] of plan) {
      if (!options.hasReadySource(loId) || !selected.has(loId)) continue;
      for (const tier of TIERS) for (const kind of KINDS) {
        if (counts[tier][kind] > 0) out.push({ loId, difficulty: tier, kind, count: counts[tier][kind] });
      }
    }
    return out;
  };

  const renderRow = (row: GenerationPlanRow): HTMLElement => {
    const counts = plan.get(row.loId) ?? autoCounts(row);
    plan.set(row.loId, counts);
    const editable = options.hasReadySource(row.loId) && !busy;
    const planned = TIERS.reduce((sum, tier) => sum + counts[tier].calculation + counts[tier].conceptual, 0);
    const tiers = TIERS.map((tier) => {
      const inputs = KINDS.map((kind) => {
        const input = el('input', {
          class: 'input generation-plan__count', type: 'number', min: '0', max: '20',
          value: String(counts[tier][kind]),
          'aria-label': `${row.loName}: ${tier} ${kind} questions`,
          ...(editable ? {} : { disabled: 'disabled' }),
        }) as HTMLInputElement;
        input.onchange = () => {
          counts[tier][kind] = Math.max(0, Math.min(20, Math.floor(Number(input.value) || 0)));
          input.value = String(counts[tier][kind]);
          refresh();
        };
        return el('label', { class: 'generation-plan__kind' }, el('small', { text: kind === 'calculation' ? 'calc' : 'concept' }), input);
      });
      return el(
        'div',
        { class: 'generation-plan__tier' },
        el('small', { text: `${tier} · ${row.approved[tier]} approved` }),
        el('div', { class: 'generation-plan__kinds' }, ...inputs),
      );
    });
    const eligible = options.hasReadySource(row.loId);
    const toggle = el('input', {
      class: 'generation-plan__select', type: 'checkbox',
      'aria-label': `Include ${row.loName} in this batch`,
      ...(eligible && selected.has(row.loId) ? { checked: 'checked' } : {}),
      ...(eligible && !busy ? {} : { disabled: 'disabled' }),
    }) as HTMLInputElement;
    toggle.onchange = () => {
      if (toggle.checked) selected.add(row.loId); else selected.delete(row.loId);
      refresh();
    };
    return el(
      'article',
      { class: `generation-plan__row${eligible && selected.has(row.loId) ? '' : ' is-excluded'}` },
      toggle,
      el(
        'div',
        { class: 'generation-plan__copy' },
        el('small', { text: `${row.themeName} · ${row.loKind}` }),
        el('strong', { text: row.loName }),
        el('small', {
          text: options.hasReadySource(row.loId)
            ? planned > 0 ? `${planned} planned` : 'Nothing planned'
            : 'Needs a ready assigned source',
        }),
      ),
      el('div', { class: 'generation-plan__grid' }, ...tiers),
    );
  };

  const refresh = (): void => {
    const planned = cells();
    const questions = planned.reduce((sum, cell) => sum + cell.count, 0);
    const los = new Set(planned.map((cell) => cell.loId)).size;
    generateButton.disabled = busy || questions === 0;
    generateButton.textContent = busy
      ? 'Queuing…'
      : questions > 0
        ? `Generate ${questions} question${questions === 1 ? '' : 's'} across ${los} LO${los === 1 ? '' : 's'} → ${questions} to review`
        : 'Nothing planned — adjust a count or press Auto';
    autoButton.disabled = busy;
    const eligible = eligibleIds();
    const selectedEligible = eligible.filter((loId) => selected.has(loId));
    const selectAll = el('input', {
      class: 'generation-plan__select', type: 'checkbox', 'aria-label': 'Include every Learning Objective with a ready source',
      ...(eligible.length > 0 && selectedEligible.length === eligible.length ? { checked: 'checked' } : {}),
      ...(busy || eligible.length === 0 ? { disabled: 'disabled' } : {}),
    }) as HTMLInputElement;
    selectAll.indeterminate = selectedEligible.length > 0 && selectedEligible.length < eligible.length;
    selectAll.onchange = () => {
      if (selectAll.checked) for (const loId of eligible) selected.add(loId);
      else selected.clear();
      refresh();
    };
    const header = el(
      'label',
      { class: 'generation-plan__header' },
      selectAll,
      el('span', { text: `${selectedEligible.length} of ${eligible.length} Learning Objective${eligible.length === 1 ? '' : 's'} selected — counts are kept when a row is unselected` }),
    );
    mount(grid, header, ...(planRows.length ? planRows.map(renderRow) : [el('p', { class: 'app-dialog__message', text: 'No Learning Objectives to plan for.' })]));
  };

  const generate = async (): Promise<void> => {
    const planned = cells();
    if (planned.length === 0) return;
    busy = true;
    status.textContent = '';
    refresh();
    try {
      const result = await enqueueGenerationPlan(options.courseId, planned);
      const started = result.runs.filter((run) => run.runId);
      const failed = result.runs.filter((run) => !run.runId);
      const queued = started.reduce((sum, run) => sum + run.count, 0);
      status.textContent = `Queued ${started.length} run${started.length === 1 ? '' : 's'} (${queued} question${queued === 1 ? '' : 's'}).`
        + (failed.length ? ` ${failed.length} cell${failed.length === 1 ? '' : 's'} could not start: ${[...new Set(failed.map((run) => run.error ?? 'unknown'))].join('; ')}.` : '');
      options.onQueued(result, planned);
      if (failed.length === 0) { close(); return; }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
    busy = false;
    refresh();
  };

  const close = (): void => {
    dialog.close();
    dialog.remove();
  };

  autoButton.onclick = () => { resetToAuto(); refresh(); };
  generateButton.onclick = () => void generate();
  cancelButton.onclick = close;
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });

  dialog.append(
    el(
      'div',
      { class: 'app-dialog__surface generation-plan' },
      el('h2', { class: 'app-dialog__title', id: 'generation-plan-title', text: 'Plan a batch of questions' }),
      el('p', {
        class: 'app-dialog__message',
        text: 'Auto suggests how many easy, medium and hard questions each Learning Objective needs, split into calculation and conceptual by its kind. Adjust any count, then generate. Every question enters the review queue first.',
      }),
      grid,
      status,
      el('div', { class: 'app-dialog__actions' }, cancelButton, autoButton, generateButton),
    ),
  );
  document.body.append(dialog);
  dialog.showModal();
  refresh();

  void getGenerationPlan(options.courseId).then((rows) => {
    planRows = rows;
    resetToAuto();
    refresh();
  }).catch((error) => {
    status.textContent = error instanceof Error ? error.message : String(error);
    generateButton.textContent = 'Could not load the plan';
  });
}
