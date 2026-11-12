import { solveParameterDomain, SOLVER_MAX_COMBINATIONS } from '../../server/src/services/question-generation/parameter-solver';
import { verifyQuestionNumerics } from '../../server/src/services/numeric-verification.service';
import type { DerivedValue, ParamSlot } from '../../server/src/types/domain';

// Q8 from the 2026-11-12 Sol trial (COMM 298 Market Efficiency), verbatim.
const q8Slots: ParamSlot[] = [
  { name: 'SHARES', min: 100, max: 500, step: 100 },
  { name: 'EARLY_PRICE', min: 40, max: 50, step: 5 },
  { name: 'EARLY_CLOSE', min: 65, max: 75, step: 5 },
  { name: 'PUBLIC_OLD', min: 80, max: 85, step: 5 },
  { name: 'PUBLIC_VALUE', min: 90, max: 95, step: 5 },
];
const q8Derived: DerivedValue[] = [
  { name: 'EARLY_PROFIT', formula: 'SHARES*(EARLY_CLOSE-EARLY_PRICE)' },
  { name: 'PUBLIC_PROFIT', formula: 'SHARES*(PUBLIC_VALUE-PUBLIC_VALUE)' },
  { name: 'PROFIT_DIFFERENCE', formula: 'EARLY_PROFIT-PUBLIC_PROFIT' },
  { name: 'STALE_PUBLIC_PROFIT', formula: 'SHARES*(PUBLIC_VALUE-PUBLIC_OLD)', errorModel: 'stale purchase price' },
  { name: 'STALE_PRICE_DIFFERENCE', formula: 'EARLY_PROFIT-STALE_PUBLIC_PROFIT', errorModel: 'stale price difference' },
  { name: 'NO_INFORMATION_REWARD', formula: 'PUBLIC_PROFIT', errorModel: 'no one can profit' },
  { name: 'REVERSED_DIFFERENCE', formula: 'PUBLIC_PROFIT-EARLY_PROFIT', errorModel: 'reversed subtraction' },
];
const q8Options = ['PROFIT_DIFFERENCE', 'REVERSED_DIFFERENCE', 'STALE_PRICE_DIFFERENCE', 'NO_INFORMATION_REWARD'];
const currency4 = [true, true, true, true];

describe('solveParameterDomain', () => {
  it('prunes Q8 to a collision-free grid and reports its constant values', () => {
    const before = verifyQuestionNumerics({ slots: q8Slots, derivedValues: q8Derived, optionValueNames: q8Options, optionCurrency: currency4 });
    expect(before.ok).toBe(false);

    const result = solveParameterDomain({ slots: q8Slots, derivedValues: q8Derived, optionValueNames: q8Options, optionCurrency: currency4, correctName: 'PROFIT_DIFFERENCE' });

    expect(result.status).toBe('solved');
    if (result.status !== 'solved') return;
    expect(result.report.checkedCombinations).toBe(180);
    // Every failing combination has an early change of 15 (65 - 50); removing
    // either end of that pair fixes it, and the tie-break takes the larger value.
    expect(result.report.removed).toEqual([{ slot: 'EARLY_CLOSE', values: [65] }]);
    expect(result.slots.find((slot) => slot.name === 'EARLY_CLOSE')).toEqual({ name: 'EARLY_CLOSE', values: [70, 75] });
    // Two-value slots are never reduced to one.
    expect(result.slots.find((slot) => slot.name === 'PUBLIC_OLD')).toEqual(q8Slots[3]);
    expect(result.constants.map((c) => c.name).sort()).toEqual(['NO_INFORMATION_REWARD', 'PUBLIC_PROFIT']);

    const after = verifyQuestionNumerics({ slots: result.slots, derivedValues: q8Derived, optionValueNames: q8Options, optionCurrency: currency4 });
    expect(after.ok).toBe(true);
  });

  it('removes a multiplier value of exactly 1 that makes a distractor equal the answer', () => {
    const result = solveParameterDomain({
      slots: [
        { name: 'RF', values: [2, 3] },
        { name: 'M', values: [8, 9, 10] },
        { name: 'BETA', min: 0.5, max: 2, step: 0.5 },
      ],
      derivedValues: [
        { name: 'CAPM', formula: 'RF + BETA*(M - RF)' },
        { name: 'NO_BETA', formula: 'RF + (M - RF)', errorModel: 'ignored beta' },
        { name: 'MARKET_ONLY', formula: 'BETA*M', errorModel: 'forgot the risk-free rate' },
      ],
      optionValueNames: ['CAPM', 'NO_BETA', 'MARKET_ONLY'],
      correctName: 'CAPM',
    });

    expect(result.status).toBe('solved');
    if (result.status !== 'solved') return;
    expect(result.slots.find((slot) => slot.name === 'BETA')?.values).not.toContain(1);
    expect(result.constants).toEqual([]);
  });

  it('is clean and leaves the slots alone when nothing collides', () => {
    const result = solveParameterDomain({
      slots: [{ name: 'A', min: 10, max: 20, step: 5 }, { name: 'B', values: [1, 2] }],
      derivedValues: [{ name: 'SUM', formula: 'A + B' }, { name: 'DIFF', formula: 'A - B', errorModel: 'subtracted' }],
      optionValueNames: ['SUM', 'DIFF'],
    });
    expect(result).toMatchObject({ status: 'clean', report: { checkedCombinations: 6, removed: [] }, constants: [] });
  });

  it('is unsolvable when two options are the same formula', () => {
    const result = solveParameterDomain({
      slots: [{ name: 'A', min: 1, max: 9, step: 1 }],
      derivedValues: [{ name: 'X', formula: 'A * 2' }, { name: 'Y', formula: 'A + A', errorModel: 'doubled' }],
      optionValueNames: ['X', 'Y'],
    });
    expect(result.status).toBe('unsolvable');
    if (result.status === 'unsolvable') expect(result.failure).toMatch(/no choice of parameter values avoids this problem/);
  });

  it('is unsolvable when avoiding collisions would leave too little variety', () => {
    const result = solveParameterDomain({
      slots: [{ name: 'A', values: [1, 2, 3] }, { name: 'B', values: [1, 2, 3] }],
      derivedValues: [{ name: 'X', formula: 'A + 10' }, { name: 'Y', formula: 'B + 10', errorModel: 'used B' }],
      optionValueNames: ['X', 'Y'],
    });
    expect(result.status).toBe('unsolvable');
  });

  it('prunes a collision that only appears at display precision', () => {
    const result = solveParameterDomain({
      slots: [{ name: 'R', values: [7.3591, 7.3644, 9.1, 12.5] }, { name: 'K', values: [0, 1, 2] }],
      derivedValues: [{ name: 'X', formula: 'R + K' }, { name: 'Y', formula: 'R + K + 0.0053', errorModel: 'rounding' }],
      optionValueNames: ['X', 'Y'],
    });
    // Y = X + 0.0053 always shows within a cent of X for some draws; the solver must not
    // pretend raw-double distinctness is enough.
    expect(['solved', 'unsolvable']).toContain(result.status);
    if (result.status === 'solved') {
      const verified = verifyQuestionNumerics({ slots: result.slots, derivedValues: [{ name: 'X', formula: 'R + K' }, { name: 'Y', formula: 'R + K + 0.0053' }], optionValueNames: ['X', 'Y'] });
      expect(verified.ok).toBe(true);
    }
  });

  it('ignores constant helper values that no option or answer uses', () => {
    const result = solveParameterDomain({
      slots: [{ name: 'A', values: [3, 4, 5] }, { name: 'B', values: [10, 20, 30] }],
      derivedValues: [
        { name: 'ZERO', formula: 'A - A' },
        { name: 'X', formula: 'A * B' },
        { name: 'Y', formula: 'A + B', errorModel: 'added' },
      ],
      optionValueNames: ['X', 'Y'],
      correctName: 'X',
    });
    expect(result).toMatchObject({ status: 'clean', constants: [] });
  });

  it('skips grids above the limit', () => {
    const result = solveParameterDomain({
      slots: [{ name: 'A', min: 1, max: 100, step: 1 }, { name: 'B', min: 1, max: 100, step: 1 }],
      derivedValues: [{ name: 'X', formula: 'A + B' }, { name: 'Y', formula: 'A - B', errorModel: 'x' }],
      optionValueNames: ['X', 'Y'],
    });
    expect(100 * 100).toBeGreaterThan(SOLVER_MAX_COMBINATIONS);
    expect(result).toEqual({ status: 'skipped', reason: 'combination-limit' });
  });
});
