// The batch planner as a dialog: "Batch Generation" from the Question Workspace.
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

// --- Combination rows (multi-LO batch generation, 2026-09-04) ----------------
// An instructor-added row whose questions integrate a primary objective and
// up to two secondaries, tagged to all of them. Auto never creates one: an
// integrated question exists only when the instructor asked for it. Pure
// helpers are exported for unit tests.

export interface PlanCombination {
  loId: string;
  secondaryLoIds: string[];
}

export const MAX_COMBINATION_SECONDARIES = 2;

/** Identity of a combination: the same objectives in the same order. */
export function combinationKey(combo: PlanCombination): string {
  return [combo.loId, ...combo.secondaryLoIds].join('+');
}

/** Which steppers a combination row offers. Calculation questions that
 * integrate another objective are generated at hard only: five of five
 * generated at medium came back flagged "hard" by the reviewer (2026-09-04),
 * because integration is by construction the multi-concept chain the rubric
 * calls hard. Conceptual integrations pass at medium, so they keep every tier. */
export function combinationCellAllowed(tier: Tier, kind: Kind): boolean {
  return kind === 'conceptual' || tier === 'hard';
}

/** A new combination row starts with one hard calculation question. */
export function defaultCombinationCounts(): PlanCounts {
  const counts = emptyCounts();
  counts.hard.calculation = 1;
  return counts;
}

/** Whether the builder's current picks can become a row: a primary, at
 * least one secondary, no repeats, and not already present. */
export function combinationAddable(
  combo: PlanCombination,
  existingKeys: ReadonlySet<string>,
): boolean {
  const secondaries = combo.secondaryLoIds.filter((id) => id.length > 0);
  if (!combo.loId || secondaries.length === 0 || secondaries.length > MAX_COMBINATION_SECONDARIES) return false;
  const ids = [combo.loId, ...secondaries];
  if (new Set(ids).size !== ids.length) return false;
  return !existingKeys.has(combinationKey({ loId: combo.loId, secondaryLoIds: secondaries }));
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
  // Combination rows, keyed by combinationKey. Kept across Auto: Auto resets
  // the LO rows' counts, never the instructor's combinations.
  const combos = new Map<string, { combo: PlanCombination; counts: PlanCounts }>();
  // The "Add combination" builder's picks, held here because refresh()
  // rebuilds the grid (and the builder with it).
  const builder: { loId: string; secondary: string[] } = { loId: '', secondary: ['', ''] };

  const eligibleIds = (): string[] => planRows.filter((row) => options.hasReadySource(row.loId)).map((row) => row.loId);
  const loName = (loId: string): string => planRows.find((row) => row.loId === loId)?.loName ?? 'Unknown LO';

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
    for (const { combo, counts } of combos.values()) {
      if (![combo.loId, ...combo.secondaryLoIds].every((id) => options.hasReadySource(id))) continue;
      for (const tier of TIERS) for (const kind of KINDS) {
        if (counts[tier][kind] > 0 && combinationCellAllowed(tier, kind)) {
          out.push({ loId: combo.loId, secondaryLoIds: [...combo.secondaryLoIds], difficulty: tier, kind, count: counts[tier][kind] });
        }
      }
    }
    return out;
  };

  /** The per-tier stepper grid shared by LO rows and combination rows.
   * `allowed` greys out a stepper the row does not offer (see
   * combinationCellAllowed); its count is kept but never enqueued. */
  const tierGrid = (
    counts: PlanCounts,
    ariaName: string,
    editable: boolean,
    approved?: Record<Tier, number>,
    allowed: (tier: Tier, kind: Kind) => boolean = () => true,
  ): HTMLElement => {
    const tiers = TIERS.map((tier) => {
      const inputs = KINDS.map((kind) => {
        const offered = allowed(tier, kind);
        const input = el('input', {
          class: 'input generation-plan__count', type: 'number', min: '0', max: '20',
          value: String(offered ? counts[tier][kind] : 0),
          'aria-label': `${ariaName}: ${tier} ${kind} questions`,
          ...(editable && offered ? {} : { disabled: 'disabled' }),
          ...(offered ? {} : { title: 'Calculation questions that integrate another objective are generated at hard only.' }),
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
        el('small', { text: approved ? `${tier} · ${approved[tier]} approved` : tier }),
        el('div', { class: 'generation-plan__kinds' }, ...inputs),
      );
    });
    return el('div', { class: 'generation-plan__grid' }, ...tiers);
  };

  const renderRow = (row: GenerationPlanRow): HTMLElement => {
    const counts = plan.get(row.loId) ?? autoCounts(row);
    plan.set(row.loId, counts);
    const editable = options.hasReadySource(row.loId) && !busy;
    const planned = TIERS.reduce((sum, tier) => sum + counts[tier].calculation + counts[tier].conceptual, 0);
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
      tierGrid(counts, row.loName, editable, row.approved),
    );
  };

  const renderComboRow = (key: string, entry: { combo: PlanCombination; counts: PlanCounts }): HTMLElement => {
    const { combo, counts } = entry;
    const ids = [combo.loId, ...combo.secondaryLoIds];
    const missing = ids.filter((id) => !options.hasReadySource(id));
    const eligible = missing.length === 0;
    const editable = eligible && !busy;
    const planned = TIERS.reduce(
      (sum, tier) => sum + KINDS.reduce((inner, kind) => inner + (combinationCellAllowed(tier, kind) ? counts[tier][kind] : 0), 0),
      0,
    );
    const remove = el(
      'button',
      {
        class: 'generation-plan__remove', type: 'button',
        'aria-label': `Remove the combination ${ids.map(loName).join(' + ')}`,
        title: 'Remove this combination',
        ...(busy ? { disabled: 'disabled' } : {}),
      },
      '×',
    ) as HTMLButtonElement;
    remove.onclick = () => { combos.delete(key); refresh(); };
    const names = el('div', { class: 'generation-plan__combo-los' });
    ids.forEach((id, index) => {
      if (index > 0) names.append(el('span', { class: 'generation-plan__plus', text: '+' }));
      names.append(el('strong', { text: loName(id) }));
    });
    return el(
      'article',
      { class: `generation-plan__row generation-plan__row--combo${eligible ? '' : ' is-excluded'}` },
      remove,
      el(
        'div',
        { class: 'generation-plan__copy' },
        el('small', { text: `Every question will be generated with ${ids.length} objectives and will be tagged to them` }),
        names,
        el('small', {
          text: eligible
            ? planned > 0 ? `${planned} planned` : 'Nothing planned'
            : `Needs a ready assigned source for ${missing.map(loName).join(', ')}`,
        }),
      ),
      tierGrid(counts, ids.map(loName).join(' + '), editable, undefined, combinationCellAllowed),
    );
  };

  const renderBuilder = (): HTMLElement => {
    const primaryOptions = planRows.filter((row) => options.hasReadySource(row.loId));
    const pick = (value: string, label: string, exclude: string[], onchange: (next: string) => void, allowNone: boolean): HTMLElement => {
      const select = el(
        'select',
        { class: 'input', 'aria-label': label, ...(busy ? { disabled: 'disabled' } : {}) },
        el('option', { value: '', text: allowNone ? 'None' : 'Choose…', selected: value ? undefined : 'selected' }),
        ...primaryOptions
          .filter((row) => !exclude.includes(row.loId))
          .map((row) => el('option', { value: row.loId, text: row.loName, selected: value === row.loId ? 'selected' : undefined })),
      ) as HTMLSelectElement;
      select.onchange = () => { onchange(select.value); refresh(); };
      return el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: label }), select);
    };
    const candidate: PlanCombination = { loId: builder.loId, secondaryLoIds: builder.secondary.filter((id) => id.length > 0) };
    const addable = combinationAddable(candidate, new Set(combos.keys())) && !busy;
    const add = el(
      'button',
      { class: 'btn btn--ghost btn--field', type: 'button', ...(addable ? {} : { disabled: 'disabled' }) },
      'Add combination',
    ) as HTMLButtonElement;
    add.onclick = () => {
      combos.set(combinationKey(candidate), { combo: candidate, counts: defaultCombinationCounts() });
      builder.loId = '';
      builder.secondary = ['', ''];
      refresh();
    };
    return el(
      'div',
      { class: 'generation-plan__builder' },
      pick(builder.loId, 'Primary objective', builder.secondary, (next) => {
        builder.loId = next;
        builder.secondary = builder.secondary.map((id) => (id === next ? '' : id));
      }, false),
      pick(builder.secondary[0], 'Integrate with', [builder.loId, builder.secondary[1]], (next) => { builder.secondary[0] = next; }, true),
      pick(builder.secondary[1], 'And with', [builder.loId, builder.secondary[0]], (next) => { builder.secondary[1] = next; }, true),
      add,
      el('p', {
        class: 'generation-plan__builder-note',
        text: 'A combination row generates questions that require every listed objective and are tagged to each. Calculation counts are offered at hard only; conceptual counts at any tier.',
      }),
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
    mount(
      grid,
      header,
      ...(planRows.length ? planRows.map(renderRow) : [el('p', { class: 'app-dialog__message', text: 'No Learning Objectives to plan for.' })]),
      ...[...combos.entries()].map(([key, entry]) => renderComboRow(key, entry)),
      ...(planRows.length ? [renderBuilder()] : []),
    );
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
      el('h2', { class: 'app-dialog__title', id: 'generation-plan-title', text: 'Batch Generation' }),
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
