import { evaluateFormula, parseFormula } from '../components/formula';
import type { DerivedValue, ParamSlot } from '../types/domain';
import { formatParamValue, isCurrencyPlaceholder, substituteParams } from './parameter-display';

/** Separate from evaluator arithmetic: a historical proof did not check input display. */
export const INPUT_DISPLAY_VERIFICATION_VERSION = 1;

/** Check one actual closed-formula draw using exactly the numbers the stem displays.
 * Rounding an input is permissible only when every answer still displays identically.
 * This does not infer units or recover inputs omitted from the question; those remain
 * separate authoring checks. Neither the original values nor stored answers are changed. */
export function numericInputDisplayFailure(input: {
  stem: string;
  slots: ParamSlot[];
  derivedValues: DerivedValue[];
  optionTexts: string[];
  values: Record<string, number>;
}): string | null {
  const displayedInputs = { ...input.values };
  const slotNames = new Set(input.slots.map(slot => slot.name));
  const seen = new Map<string, number>();
  for (const match of input.stem.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
    const name = match[1]!;
    if (!slotNames.has(name)) continue;
    const raw = input.values[name];
    if (!Number.isFinite(raw)) return `input display check: ${name} is not finite`;
    const value = Number(formatParamValue(raw!, { currency: isCurrencyPlaceholder(input.stem.slice(0, match.index)) }));
    if (seen.has(name) && seen.get(name) !== value) return `input display check: ${name} displays inconsistent input values`;
    seen.set(name, value);
    displayedInputs[name] = value;
  }
  if (![...seen].some(([name, value]) => value !== input.values[name])) return null;
  // All intermediate arithmetic keeps full precision; only the visible premises
  // are substituted. Re-evaluate in the same declaration order as the real draw.
  for (const derived of input.derivedValues) {
    const parsed = parseFormula(derived.formula);
    if (!parsed.ok) return `input display check: ${derived.name}: ${parsed.error}`;
    const computed = evaluateFormula(parsed.ast, displayedInputs);
    if (!computed.ok || !Number.isFinite(computed.value)) return `input display check: ${derived.name} cannot be computed from displayed inputs`;
    displayedInputs[derived.name] = computed.value;
  }
  for (let index = 0; index < input.optionTexts.length; index += 1) {
    if (substituteParams(input.optionTexts[index]!, input.values) !== substituteParams(input.optionTexts[index]!, displayedInputs)) {
      return `input display check: option ${index + 1} changes at display precision when computed from displayed inputs; use representable input values or revise the parameter definition`;
    }
  }
  return null;
}
