import { MAX_FINITE_VERIFICATION_COMBINATIONS, verifyQuestionNumerics } from '../../server/src/services/numeric-verification.service';
import * as params from '../../server/src/services/params.service';
import type { DerivedValue, ParamSlot } from '../../server/src/types/domain';

const slots: ParamSlot[] = [
  { name: 'X', min: 1, max: 15, step: 1 },
  { name: 'Y', min: 1, max: 9, step: 1 },
];
const hiddenCollision: DerivedValue[] = [
  { name: 'ANSWER', formula: 'X+100' },
  { name: 'DISTRACTOR', formula: 'ANSWER+(X-1)^2+(Y-2)^2' },
];

it('refuses the small-grid collision missed by all 100 historical verification seeds', () => {
  const result = verifyQuestionNumerics({
    stem: 'Given X={{X}} and Y={{Y}}, compute X + 100.',
    slots, derivedValues: hiddenCollision, optionValueNames: ['ANSWER', 'DISTRACTOR'],
  });
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining('at display precision'),
    failingCombination: { indices: [0, 1], slotValues: { X: 1, Y: 2 } } });
  expect(result).not.toHaveProperty('failingSeed');
});

it('reports all 135 combinations in a safe small grid while retaining the 100 historical seeds', () => {
  const result = verifyQuestionNumerics({ stem: '{{X}} and {{Y}}', slots,
    derivedValues: [{ name: 'ANSWER', formula: 'X+Y' }, { name: 'OTHER', formula: 'ANSWER+100' }],
    optionValueNames: ['ANSWER', 'OTHER'] });
  expect(result).toMatchObject({ ok: true, verification: { inputDisplayVersion: 1,
    parameterCoverage: { version: 'finite-slot-grid-v1', mode: 'exhaustive', totalCombinations: 135,
      checkedCombinations: 135, maxCombinations: 256 } } });
  if (result.ok) expect(result.sampleSeeds).toEqual(Array.from({ length: 100 }, (_, index) => 1_000_003 + index));
});

it('finds a division by zero outside the historical sample using the exact tuple evaluator', () => {
  expect(verifyQuestionNumerics({ slots, derivedValues: [
    { name: 'ANSWER', formula: '1/((X-1)^2+(Y-2)^2)' },
    { name: 'OTHER', formula: 'ANSWER+10' },
  ], optionValueNames: ['ANSWER', 'OTHER'] })).toMatchObject({ ok: false,
    error: expect.stringContaining('division by zero'), failingCombination: { indices: [0, 1], slotValues: { X: 1, Y: 2 } } });
});

it('checks visible input precision in unsampled explicit values, separately from collisions', () => {
  const sampled = new Set(Array.from({ length: 100 }, (_, index) => Math.floor(params.seededRandom(1_000_003 + index)() * 135)));
  const missing = Array.from({ length: 135 }, (_, index) => index).find(index => !sampled.has(index))!;
  expect(missing).toBeDefined();
  const values = Array.from({ length: 135 }, (_, index) => index === missing ? 1.0013 : index + 2);
  const result = verifyQuestionNumerics({ stem: 'The input is {{X}}.', slots: [{ name: 'X', values }],
    derivedValues: [{ name: 'ANSWER', formula: 'X*100' }, { name: 'OTHER', formula: 'ANSWER+1000' }],
    optionValueNames: ['ANSWER', 'OTHER'] });
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining('computed from displayed inputs'),
    failingCombination: { indices: [missing], slotValues: { X: 1.0013 } } });
});

function safeGrid(slots: ParamSlot[]) {
  return verifyQuestionNumerics({ slots, derivedValues: [{ name: 'ANSWER', formula: '7' }, { name: 'OTHER', formula: '17' }],
    optionValueNames: ['ANSWER', 'OTHER'] });
}

it('enumerates a 256-entry domain completely rather than silently clipping the boundary', () => {
  expect(MAX_FINITE_VERIFICATION_COMBINATIONS).toBe(256);
  expect(safeGrid([{ name: 'X', min: 0, max: 255, step: 1 }])).toMatchObject({ ok: true,
    verification: { parameterCoverage: { mode: 'exhaustive', totalCombinations: 256, checkedCombinations: 256 } } });
});

it.each([
  { slots: [{ name: 'X', min: 0, max: 256, step: 1 }], count: 257 },
  { slots: [{ name: 'X', min: 1, max: 16 }, { name: 'Y', min: 1, max: 17 }], count: 272 },
  { slots: [{ name: 'X', min: 0, max: 100_000_000 }, { name: 'Y', min: 0, max: 100_000_000 }], count: null },
])('uses explicit sampled coverage without enumerating an oversized grid: $count', ({ slots, count }) => {
  const explicit = jest.spyOn(params, 'resolveSlotsAndDerivedAtIndices');
  try {
    expect(safeGrid(slots)).toMatchObject({ ok: true, verification: { parameterCoverage: {
      mode: 'sampled', totalCombinations: count, checkedCombinations: 0, reason: 'combination-limit',
    } } });
    expect(explicit).not.toHaveBeenCalled();
  } finally { explicit.mockRestore(); }
});

it('verifies a decimal CAPM grid without changing any input or formula bytes', () => {
  const input = { stem: 'Riskfree rate {{RF}}%, beta {{BETA}}, premium {{RP}}%.', slots: [
    { name: 'BETA', values: [0.8, 0.9, 1.1] }, { name: 'RF', values: [2.5, 2.75, 3] }, { name: 'RP', values: [5, 5.5, 6] },
  ], derivedValues: [{ name: 'ANSWER', formula: 'RF+BETA*RP' }, { name: 'OTHER', formula: 'RF+RP' }],
  optionValueNames: ['ANSWER', 'OTHER'] };
  const before = JSON.stringify(input);
  expect(verifyQuestionNumerics(input)).toMatchObject({ ok: true, verification: { parameterCoverage: {
    mode: 'exhaustive', totalCombinations: 27, checkedCombinations: 27,
  } } });
  expect(JSON.stringify(input)).toBe(before);
});

it('keeps binary floating-point endpoint semantics and counts duplicate entries honestly', () => {
  expect(safeGrid([{ name: 'X', min: 0.1, max: 0.3, step: 0.1 }])).toMatchObject({ ok: true,
    verification: { parameterCoverage: { mode: 'exhaustive', totalCombinations: 2, checkedCombinations: 2 } } });
  expect(safeGrid([{ name: 'X', values: [2.5, 2.5, 2.5] }])).toMatchObject({ ok: true,
    verification: { parameterCoverage: { mode: 'exhaustive', totalCombinations: 3, checkedCombinations: 3 } } });
});

it('checks the single constant combination when there are no drawn slots', () => {
  expect(safeGrid([])).toMatchObject({ ok: true,
    verification: { parameterCoverage: { mode: 'exhaustive', totalCombinations: 1, checkedCombinations: 1 } } });
});

it('does not call malformed historical ranges or duplicate names exhaustive', () => {
  expect(safeGrid([{ name: 'X', min: 1, max: 3, step: 0 }])).toMatchObject({ ok: true,
    verification: { parameterCoverage: { mode: 'sampled', totalCombinations: null, checkedCombinations: 0, reason: 'unrepresentable-domain' } } });
  expect(safeGrid([{ name: 'X', values: [1] }, { name: 'X', values: [2] }])).toMatchObject({ ok: true,
    verification: { parameterCoverage: { mode: 'sampled', checkedCombinations: 0, reason: 'ambiguous-parameter-names' } } });
  expect(safeGrid([{ name: '__proto__', values: [1] }])).toMatchObject({ ok: true,
    verification: { parameterCoverage: { mode: 'sampled', checkedCombinations: 0, reason: 'ambiguous-parameter-names' } } });
});
