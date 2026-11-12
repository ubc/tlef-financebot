// Parameter value solver (spec 2026-11-12-generation-correctness-design.md).
//
// The generator writes each parameter as a range; numeric verification then
// rejects the whole question when any combination of values makes two options
// display the same number. The model keeps making that mistake despite the
// prompt rules, so code now chooses the values: enumerate every combination,
// and drop the slot values that cause failures until none remain. The
// per-draw check is verification's own (`numericDrawFailure`), so a solved
// question passes verification by construction.
//
// It also reports derived values that never vary although they read a
// parameter (e.g. `SHARES*(V-V)`): code cannot fix those, the repair call can.
import type { DerivedValue, ParamSlot } from '../../types/domain';
import { describeFiniteSlotDomain, resolveSlotsAndDerivedAtIndices } from '../params.service';
import { numericDrawFailure, type VerifyInput } from '../numeric-verification.service';
import { formatParamValue } from '../parameter-display';

/** Grids above this are left to sampled verification, unchanged. */
export const SOLVER_MAX_COMBINATIONS = 4096;
/** A solved question must keep at least this much variety. */
export const SOLVER_MIN_COMBINATIONS = 8;
export const SOLVER_MIN_VALUES_PER_SLOT = 2;

export interface SolverInput extends VerifyInput {
  /** The derived value the correct option displays (dependency root for constants). */
  correctName?: string;
}

export interface ParameterSolverReport {
  checkedCombinations: number;
  removed: Array<{ slot: string; values: number[] }>;
}

export interface ConstantDerivedValue {
  name: string;
  /** The single value it displays in every combination. */
  value: string;
}

export type ParameterSolverResult =
  | { status: 'skipped'; reason: 'no-slots' | 'unrepresentable-domain' | 'combination-limit' }
  | { status: 'clean'; report: ParameterSolverReport; constants: ConstantDerivedValue[] }
  | { status: 'solved'; slots: ParamSlot[]; report: ParameterSolverReport; constants: ConstantDerivedValue[] }
  | { status: 'unsolvable'; failure: string; report: ParameterSolverReport; constants: ConstantDerivedValue[] };

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

function identifiers(formula: string): Set<string> {
  return new Set(formula.match(IDENTIFIER) ?? []);
}

/** Names (slots and derived values) that `root` depends on, itself included. */
function dependencyClosure(root: string, derived: DerivedValue[]): Set<string> {
  const byName = new Map(derived.map((d) => [d.name, d]));
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const formula = byName.get(name)?.formula;
    if (formula) for (const id of identifiers(formula)) if (!seen.has(id)) stack.push(id);
  }
  return seen;
}

/** Derived values that read at least one slot (directly or through others). */
function slotDependent(derived: DerivedValue[], slotNames: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const d of derived) {
    const closure = dependencyClosure(d.name, derived);
    if ([...closure].some((name) => slotNames.has(name))) result.add(d.name);
  }
  return result;
}

export function solveParameterDomain(input: SolverInput): ParameterSolverResult {
  const { slots, derivedValues } = input;
  if (slots.length === 0) return { status: 'skipped', reason: 'no-slots' };
  const domains = slots.map((slot) => describeFiniteSlotDomain(slot));
  if (domains.some((domain) => !domain.ok)) return { status: 'skipped', reason: 'unrepresentable-domain' };
  const counts = domains.map((domain) => (domain.ok ? domain.count : 0));
  const total = counts.reduce((product, count) => product * count, 1);
  if (total > SOLVER_MAX_COMBINATIONS) return { status: 'skipped', reason: 'combination-limit' };

  // Evaluate every combination once.
  const currencyByName = new Map(input.optionValueNames.map((name, index) => [name, input.optionCurrency?.[index] ?? false]));
  const displays = new Map<string, Set<string>>(derivedValues.map((d) => [d.name, new Set<string>()]));
  const failing: Array<{ indices: number[]; failure: string }> = [];
  const indices = counts.map(() => 0);
  for (let combination = 0; combination < total; combination += 1) {
    let failure: string | null;
    try {
      const values = resolveSlotsAndDerivedAtIndices(slots, derivedValues, indices);
      for (const d of derivedValues) {
        const value = values[d.name];
        if (value !== undefined && Number.isFinite(value)) displays.get(d.name)!.add(formatParamValue(value, { currency: currencyByName.get(d.name) ?? false }));
      }
      failure = numericDrawFailure(input, values);
    } catch (error) {
      failure = (error as Error).message;
    }
    if (failure) failing.push({ indices: [...indices], failure });
    for (let index = indices.length - 1; index >= 0; index -= 1) {
      indices[index]! += 1;
      if (indices[index]! < counts[index]!) break;
      indices[index] = 0;
    }
  }

  // Constants: only those an option shows or the correct answer depends on.
  const slotNames = new Set(slots.map((slot) => slot.name));
  const dependent = slotDependent(derivedValues, slotNames);
  const relevant = new Set<string>(input.optionValueNames);
  if (input.correctName) for (const name of dependencyClosure(input.correctName, derivedValues)) relevant.add(name);
  const constants: ConstantDerivedValue[] = derivedValues
    .filter((d) => relevant.has(d.name) && dependent.has(d.name) && displays.get(d.name)!.size === 1)
    .map((d) => ({ name: d.name, value: [...displays.get(d.name)!][0]! }));

  const report: ParameterSolverReport = { checkedCombinations: total, removed: [] };
  if (failing.length === 0) return { status: 'clean', report, constants };

  // Greedy pruning: drop the slot value present in the most failing combinations.
  const alive = counts.map((count) => Array.from({ length: count }, () => true));
  const aliveCount = (slot: number) => alive[slot]!.filter(Boolean).length;
  const live = () => failing.filter((row) => row.indices.every((index, slot) => alive[slot]![index]));
  let remaining = live();
  while (remaining.length > 0) {
    let best: { slot: number; index: number; hits: number; edge: boolean; value: number } | undefined;
    for (let slot = 0; slot < slots.length; slot += 1) {
      if (aliveCount(slot) <= SOLVER_MIN_VALUES_PER_SLOT) continue;
      const aliveIndices = alive[slot]!.flatMap((on, index) => (on ? [index] : []));
      const hits = new Map<number, number>();
      for (const row of remaining) hits.set(row.indices[slot]!, (hits.get(row.indices[slot]!) ?? 0) + 1);
      for (const [index, count] of hits) {
        const domain = domains[slot]!;
        const value = domain.ok ? domain.valueAt(index) : 0;
        const edge = index === aliveIndices[0] || index === aliveIndices[aliveIndices.length - 1];
        const better = !best || count > best.hits
          || (count === best.hits && edge && !best.edge)
          || (count === best.hits && edge === best.edge && value > best.value);
        if (better) best = { slot, index, hits: count, edge, value };
      }
    }
    if (!best) break;
    alive[best.slot]![best.index] = false;
    remaining = live();
  }

  const domainValues = (slot: number) => {
    const domain = domains[slot]!;
    return alive[slot]!.flatMap((on, index) => (on && domain.ok ? [domain.valueAt(index)] : []));
  };
  for (let slot = 0; slot < slots.length; slot += 1) {
    const removed = alive[slot]!.flatMap((on, index) => {
      const domain = domains[slot]!;
      return !on && domain.ok ? [domain.valueAt(index)] : [];
    });
    if (removed.length) report.removed.push({ slot: slots[slot]!.name, values: removed });
  }
  const left = alive.reduce((product, row) => product * row.filter(Boolean).length, 1);

  if (remaining.length > 0 || left < SOLVER_MIN_COMBINATIONS) {
    const failure = remaining.length > 0
      ? `no choice of parameter values avoids this problem: ${remaining[0]!.failure}`
      : `avoiding the problem leaves only ${left} parameter combinations (at least ${SOLVER_MIN_COMBINATIONS} are needed): ${failing[0]!.failure}`;
    return { status: 'unsolvable', failure, report, constants };
  }

  const solved: ParamSlot[] = slots.map((slot, index) => {
    if (!report.removed.some((row) => row.slot === slot.name)) return slot;
    const next: ParamSlot = { ...slot, values: domainValues(index) };
    delete next.min;
    delete next.max;
    delete next.step;
    return next;
  });
  return { status: 'solved', slots: solved, report, constants };
}
