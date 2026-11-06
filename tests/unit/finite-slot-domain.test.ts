import type { ParamSlot } from '../../server/src/types/domain';

jest.mock('../../server/src/components/param-worker', () => ({ executeGenerate: jest.fn() }));

import { drawSlotValue } from '../../server/src/services/finite-slot-domain';
import {
  describeFiniteSlotDomain,
  resolveSlotsAndDerived,
  resolveSlotsAndDerivedAtIndices,
  seededRandom,
} from '../../server/src/services/params.service';

function domain(slot: ParamSlot) {
  const described = describeFiniteSlotDomain(slot);
  if (!described.ok) throw new Error(described.reason);
  return described;
}

describe('finite slot domains use the actual seeded draw semantics', () => {
  test('explicit decimal entries preserve order, duplicate weighting and precedence over ranges', () => {
    const slot = { name: 'BETA', values: [2.5, 2.75, 2.75, 3], min: -999, max: 999, step: -1 };
    const described = domain(slot);
    expect(described.count).toBe(4);
    expect(Array.from({ length: described.count }, (_, index) => described.valueAt(index))).toEqual([2.5, 2.75, 2.75, 3]);
    for (const [random, expected] of [[0, 2.5], [0.25, 2.75], [0.5, 2.75], [0.999, 3]]) {
      expect(drawSlotValue(slot, () => random!)).toBe(expected);
    }
  });

  test('decimal ranges keep the current floating-point endpoint omission rather than invent a value', () => {
    const described = domain({ name: 'RATE', min: 0.1, max: 0.3, step: 0.1 });
    // The historical floor gives two entries. Correcting it to a rational
    // three-entry grid here would prove values different from serving.
    expect(described.count).toBe(2);
    expect([described.valueAt(0), described.valueAt(1)]).toEqual([0.1, 0.2]);
    expect(() => described.valueAt(2)).toThrow('out-of-domain');
  });

  test('decimal multiplication retains the exact binary double, without rounding', () => {
    const described = domain({ name: 'RATE', min: 0, max: 0.4, step: 0.1 });
    expect(described.count).toBe(5);
    expect(described.valueAt(3)).toBe(0.30000000000000004);
  });

  test.each<{ slot: ParamSlot; expected: number }>([
    { slot: { name: 'X' }, expected: 0 },
    { slot: { name: 'X', min: 7.25 }, expected: 7.25 },
    { slot: { name: 'X', min: -2.5, max: -2.5 }, expected: -2.5 },
    { slot: { name: 'X', values: [] }, expected: 0 },
  ])('preserves historical default singleton domain $slot', ({ slot, expected }) => {
    const described = domain(slot);
    expect(described.count).toBe(1);
    expect(described.valueAt(0)).toBe(expected);
    expect(drawSlotValue(slot, () => 0.8)).toBe(expected);
  });

  test('a huge valid range is described without allocating its values', () => {
    const described = domain({ name: 'X', min: 0, max: 1_000_000_000, step: 1 });
    expect(described.count).toBe(1_000_000_001);
    expect(described.valueAt(described.count - 1)).toBe(1_000_000_000);
  });

  test('an explicit 257-entry domain stays 257 entries for the caller to refuse exhaustive work', () => {
    const described = domain({ name: 'X', values: Array.from({ length: 257 }, (_, index) => index / 4) });
    expect(described.count).toBe(257);
    expect(described.valueAt(256)).toBe(64);
  });

  test.each([
    { name: 'X', min: 2, max: 1, step: 1 },
    { name: 'X', min: 2, max: 1, step: -1 },
    { name: 'X', min: 1, max: 2, step: 0 },
    { name: 'X', min: 0, max: 10, step: -1 },
    { name: 'X', min: 0, max: Number.MAX_SAFE_INTEGER, step: 1 },
    { name: 'X', min: -Number.MAX_VALUE, max: Number.MAX_VALUE, step: 1 },
    { name: 'X', min: 1, max: Infinity, step: 1 },
    { name: 'X', min: NaN, max: 2, step: 1 },
    { name: 'X', min: 1, max: 2, step: NaN },
    { name: 'X', min: null as unknown as number, max: 2, step: 1 },
    { name: 'X', values: [1, Infinity] },
    { name: 'X', values: [NaN] },
    { name: 'X', values: Array<number>(3) },
    { name: 'X', values: 'bad' as unknown as number[] },
  ])('makes malformed/negative/unsafe domains explicitly ineligible: %j', slot => {
    expect(describeFiniteSlotDomain(slot)).toMatchObject({ ok: false, reason: expect.any(String) });
  });

  test('legacy seeded draws keep their existing zero-step and descending behavior', () => {
    expect(drawSlotValue({ name: 'X', min: 2, max: 4, step: 0 }, () => 0.9)).toBe(4);
    expect(drawSlotValue({ name: 'X', min: 4, max: 2, step: -1 }, () => 0.9)).toBe(2);
    const random = jest.fn(() => 0.9);
    drawSlotValue({ name: 'X', min: 2, max: 1, step: 1 }, random);
    expect(random).toHaveBeenCalledTimes(1);
  });

  test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid index %p', index => {
    expect(() => domain({ name: 'X', values: [1, 2] }).valueAt(index)).toThrow('out-of-domain');
  });

  test('single and multi-slot seeded draws equal the explicit index tuple across 500 seeds', () => {
    const slots: ParamSlot[] = [
      { name: 'P', min: 100, max: 175, step: 25 },
      { name: 'R', values: [0.025, 0.035, 0.035, 0.045] },
      { name: 'N', min: 2, max: 4, step: 1 },
    ];
    const formulas = [{ name: 'GROWTH', formula: '(1+R)^N' }, { name: 'ANSWER', formula: 'P*GROWTH' }];
    const domains = slots.map(domain);
    for (let seed = 0; seed < 500; seed += 1) {
      const random = seededRandom(seed);
      const indices = domains.map(current => Math.min(current.count - 1, Math.floor(random() * current.count)));
      expect(resolveSlotsAndDerivedAtIndices(slots, formulas, indices)).toEqual(resolveSlotsAndDerived(slots, formulas, seed));
      expect(resolveSlotsAndDerivedAtIndices(slots.slice(0, 1), [], indices.slice(0, 1)))
        .toEqual(resolveSlotsAndDerived(slots.slice(0, 1), [], seed));
    }
  });
});

describe('explicit tuple resolution retains formula evaluation and validates tuple integrity', () => {
  test('resolves declaration-order dependent formulas without slot draws', () => {
    expect(resolveSlotsAndDerivedAtIndices([], [{ name: 'BASE', formula: '2.5' }, { name: 'ANSWER', formula: 'BASE*4' }], []))
      .toEqual({ BASE: 2.5, ANSWER: 10 });
    expect(resolveSlotsAndDerivedAtIndices([], [], [])).toEqual({});
  });

  test('reports the same named formula parse and arithmetic failures as seeded serving', () => {
    const slots = [{ name: 'X', values: [0] }];
    for (const formula of ['X +', '1/X', 'LATER + 1']) {
      const derived = [{ name: 'ANSWER', formula }];
      let seededMessage: string | undefined;
      try { resolveSlotsAndDerived(slots, derived, 1); } catch (error) { seededMessage = (error as Error).message; }
      expect(seededMessage).toBeDefined();
      expect(() => resolveSlotsAndDerivedAtIndices(slots, derived, [0])).toThrow(seededMessage);
    }
  });

  test.each([{ indices: [] }, { indices: [0, 1] }])('refuses tuple arity $indices for a single slot', ({ indices }) => {
    expect(() => resolveSlotsAndDerivedAtIndices([{ name: 'X', values: [1] }], [], indices))
      .toThrow('one index per slot');
  });

  test.each([
    { slots: [{ name: 'X', values: [1] }, { name: 'X', values: [2] }] },
    { slots: [{ name: 'not-a-name', values: [1] }] },
    { slots: [{ name: '__proto__', values: [1] }] },
  ])('refuses namespace corruption: $slots', ({ slots }) => {
    expect(() => resolveSlotsAndDerivedAtIndices(slots, [], slots.map(() => 0))).toThrow('unique, valid');
  });

  test('refuses derived/input name shadowing and repeated derived names', () => {
    expect(() => resolveSlotsAndDerivedAtIndices([{ name: 'X', values: [1] }], [{ name: 'X', formula: '2' }], [0]))
      .toThrow('unique, valid');
    expect(() => resolveSlotsAndDerivedAtIndices([], [{ name: 'A', formula: '1' }, { name: 'A', formula: '2' }], []))
      .toThrow('unique, valid');
  });

  test('refuses an invalid domain and never substitutes a sampled value', () => {
    expect(() => resolveSlotsAndDerivedAtIndices([{ name: 'X', min: 2, max: 1 }], [], [0]))
      .toThrow('domain count');
  });
});
