import type { ParamSlot } from '../types/domain';

type SlotDrawShape =
  | { kind: 'values'; values: number[]; count: number }
  | { kind: 'range'; min: number; max: number; step: number; count: number };

/** Keep the historical draw defaults and IEEE-754 arithmetic in one place.
 * Domain inspection may refuse these defaults as malformed, but serving must
 * not reinterpret old parameter definitions while proving a new finite grid. */
function slotDrawShape(slot: ParamSlot): SlotDrawShape {
  if (slot.values && slot.values.length > 0) {
    return { kind: 'values', values: slot.values, count: slot.values.length };
  }
  const min = slot.min ?? 0;
  const max = slot.max ?? min;
  const step = slot.step && slot.step !== 0 ? slot.step : 1;
  return { kind: 'range', min, max, step, count: Math.floor((max - min) / step) + 1 };
}

function valueAt(shape: SlotDrawShape, index: number): number {
  return shape.kind === 'values' ? shape.values[index]! : shape.min + shape.step * index;
}

/** The seeded production draw and finite-domain verification share this exact
 * count/index/value implementation. No decimal endpoint normalization occurs. */
export function drawSlotValue(slot: ParamSlot, random: () => number): number {
  const shape = slotDrawShape(slot);
  const index = Math.min(shape.count - 1, Math.floor(random() * shape.count));
  return valueAt(shape, index);
}

export type FiniteSlotDomainDescription =
  | { ok: true; count: number; valueAt(index: number): number }
  | { ok: false; reason: string };

/** Describe every index of a well-formed finite slot without allocating a
 * range or enumerating its values. Count means entries: duplicate explicit
 * values retain their production weighting and are not called distinct. */
export function describeFiniteSlotDomain(slot: ParamSlot): FiniteSlotDomainDescription {
  if (slot.values !== undefined && !Array.isArray(slot.values)) {
    return { ok: false, reason: `parameter ${slot.name} has a malformed values array` };
  }
  const shape = slotDrawShape(slot);
  if (!Number.isSafeInteger(shape.count) || shape.count < 1) {
    return { ok: false, reason: `parameter ${slot.name} has an unsafe or non-positive domain count` };
  }
  if (shape.kind === 'values') {
    for (let index = 0; index < shape.count; index += 1) {
      if (!Number.isFinite(shape.values[index])) {
        return { ok: false, reason: `parameter ${slot.name} has a non-finite or missing explicit value` };
      }
    }
  } else {
    if (![shape.min, shape.max, shape.step].every(Number.isFinite)
      || (slot.min !== undefined && !Number.isFinite(slot.min))
      || (slot.max !== undefined && !Number.isFinite(slot.max))
      || (slot.step !== undefined && (!Number.isFinite(slot.step) || slot.step <= 0))
      || shape.max < shape.min || shape.step <= 0
      || !Number.isFinite(valueAt(shape, shape.count - 1))) {
      return { ok: false, reason: `parameter ${slot.name} has an invalid finite range` };
    }
  }
  return {
    ok: true,
    count: shape.count,
    valueAt(index: number): number {
      if (!Number.isSafeInteger(index) || index < 0 || index >= shape.count) {
        throw new Error(`parameter ${slot.name} has an out-of-domain index`);
      }
      return valueAt(shape, index);
    },
  };
}
