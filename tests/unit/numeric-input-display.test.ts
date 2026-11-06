import { EVALUATOR_VERSION } from '../../server/src/components/formula';
import { isServable } from '../../server/src/services/numeric-gate.service';
import { INPUT_DISPLAY_VERIFICATION_VERSION, numericInputDisplayFailure } from '../../server/src/services/numeric-input-display.service';
import { verifyQuestionNumerics } from '../../server/src/services/numeric-verification.service';
import { drawCollisionFreeParams, resolveSlotsAndDerived, seededRandom, SERVE_DRAW_ATTEMPTS, substituteParams } from '../../server/src/services/params.service';
import type { ParamSlot } from '../../server/src/types/domain';

const stem = 'Risk-free rate {{RF_PCT}}%, beta {{BETA}}, and a market premium of {{RP_DEC}} as a fraction. Compute expected return in percent.';
const slots: ParamSlot[] = [{ name: 'RF_PCT', values: [2.75] }, { name: 'BETA', values: [1.0013] }, { name: 'RP_DEC', values: [0.0576] }];
const derivedValues = [{ name: 'ANSWER', formula: 'RF_PCT+BETA*RP_DEC*100' }, { name: 'OMIT_BETA', formula: 'RF_PCT+RP_DEC*100' }];
const options = [{ key: 'A', text: '{{ANSWER}}%', role: 'correct' as const, explanation: '' }, { key: 'B', text: '{{OMIT_BETA}}%', role: 'clearly-wrong' as const, explanation: '' }];
const version = { stem, paramSlots: slots, derivedValues, options, numericKind: 'numeric' as const };
const proof = { evaluatorVersion: EVALUATOR_VERSION, sampleSeeds: [1], verifiedAt: new Date() };

test('CAPM refuses 1.0013 displayed as beta 1.00, even though the two raw options remain distinct', () => {
  const values = resolveSlotsAndDerived(slots, derivedValues, 1);
  expect(substituteParams(stem, values)).toContain('beta 1.00');
  expect(substituteParams(options[0].text, values)).toBe('8.52%');
  expect(substituteParams(options[1].text, values)).toBe('8.51%');
  const checked = verifyQuestionNumerics({ stem, slots, derivedValues, optionValueNames: ['ANSWER', 'OMIT_BETA'] });
  expect(checked).toMatchObject({ ok: false, error: expect.stringContaining('computed from displayed inputs'), failingSeed: expect.any(Number) });
});

test.each([
  ['negative input', -1.0013, '{{X}}', 'X*100', false],
  ['small fractional input', 0.000123456, '{{X}}', 'X*100000', false],
  ['currency input below one', 0.125, '${{X}}', 'X*100', false],
  ['fraction below one retains significant figures', 0.125, '{{X}}', 'X*100', true],
  ['rounded input leaves final displayed answer unchanged', 1.0013, '{{X}}', '2+X/10', true],
] as const)('%s is compared at the output precision without changing formatting', (_label, value, inputText, formula, safe) => {
  const localSlots = [{ name: 'X', values: [value] }];
  const localDerived = [{ name: 'ANSWER', formula }];
  const values = resolveSlotsAndDerived(localSlots, localDerived, 5);
  const failure = numericInputDisplayFailure({ stem: inputText, slots: localSlots, derivedValues: localDerived, values, optionTexts: ['{{ANSWER}}'] });
  expect(failure === null).toBe(safe);
});

test('percent and fractional rates preserve explicit formula conversion and receive a separate proof marker', () => {
  const safeSlots = slots.map(slot => slot.name === 'BETA' ? { ...slot, values: [1.2, 0.85] } : slot);
  const checked = verifyQuestionNumerics({ stem, slots: safeSlots, derivedValues, optionValueNames: ['ANSWER', 'OMIT_BETA'] });
  expect(checked).toMatchObject({ ok: true, verification: { evaluatorVersion: EVALUATOR_VERSION, inputDisplayVersion: INPUT_DISPLAY_VERIFICATION_VERSION } });
  const percentSlots = [{ name: 'RF_PCT', values: [2.75] }, { name: 'BETA', values: [1.2] }, { name: 'RP_PCT', values: [5.76] }];
  const percentFormulas = [{ name: 'A', formula: '(RF_PCT+BETA*RP_PCT)/100' }, { name: 'B', formula: '(RF_PCT+RP_PCT)/100' }];
  expect(verifyQuestionNumerics({ stem: '{{RF_PCT}}%, beta {{BETA}}, premium {{RP_PCT}}%', slots: percentSlots,
    derivedValues: percentFormulas, optionValueNames: ['A', 'B'] }).ok).toBe(true);
});

test('a repeated input cannot show different currency and fractional premises', () => {
  expect(numericInputDisplayFailure({ stem: '${{X}} versus {{X}}', slots: [{ name: 'X', values: [0.125] }],
    derivedValues: [{ name: 'A', formula: 'X*100' }], values: { X: 0.125, A: 12.5 }, optionTexts: ['{{A}}'] })).toContain('inconsistent input values');
});

test('historical approved formula proofs are rechecked without rewriting content; unsafe versions never serve', () => {
  const historical = { ...version, verification: proof };
  expect(isServable(historical)).toBe(false);
  expect(historical.verification).toEqual(proof);
  const safe = { ...historical, paramSlots: slots.map(slot => slot.name === 'BETA' ? { ...slot, values: [1.2] } : slot) };
  expect(isServable(safe)).toBe(true);
  expect(safe.verification).not.toHaveProperty('inputDisplayVersion');
  expect(isServable({ ...historical, generateScript: 'return {}' })).toBe(true);
});

test('all unsafe draws refuse delivery after the bounded redraw allowance', async () => {
  const seedFn = jest.fn(() => 3);
  await expect(drawCollisionFreeParams(version, seedFn)).rejects.toThrow('input display check');
  expect(seedFn).toHaveBeenCalledTimes(SERVE_DRAW_ATTEMPTS);
});

test('an unseen unsafe draw is guarded even after all 100 sampled proof draws passed', async () => {
  const domain = Array.from({ length: 1001 }, () => 1.2);
  const indices = new Set(Array.from({ length: 100 }, (_, i) => Math.floor(seededRandom(1_000_003 + i)() * domain.length)));
  const unsafeIndex = domain.findIndex((_, index) => !indices.has(index));
  domain[unsafeIndex] = 1.0013;
  // Put BETA first so its draw is the first PRNG value, identical to the index search.
  const largeSlots = [{ name: 'BETA', values: domain }, slots[0]!, slots[2]!];
  const largeVersion = { ...version, paramSlots: largeSlots };
  const checked = verifyQuestionNumerics({ stem, slots: largeSlots, derivedValues, optionValueNames: ['ANSWER', 'OMIT_BETA'] });
  expect(checked.ok).toBe(true);
  let unsafeSeed = 0;
  while (Math.floor(seededRandom(unsafeSeed)() * domain.length) !== unsafeIndex) unsafeSeed++;
  const seedFn = jest.fn().mockReturnValueOnce(unsafeSeed).mockReturnValue(1_000_003);
  const draw = await drawCollisionFreeParams(largeVersion, seedFn);
  expect(draw.paramValues?.BETA).toBe(1.2);
  expect(seedFn).toHaveBeenCalledTimes(2);
  await expect(drawCollisionFreeParams(largeVersion, () => unsafeSeed)).rejects.toThrow('input display check');
});

const mixedVersion = {
  stem: 'Compute from {{X}}.', paramSlots: [{ name: 'X', values: [1.0013, 2, 3] }],
  derivedValues: [{ name: 'ANSWER', formula: 'X*100' }, { name: 'OTHER', formula: '200' }],
  options: [{ key: 'A', text: '{{ANSWER}}', role: 'correct' as const, explanation: '' },
    { key: 'B', text: '{{OTHER}}', role: 'clearly-wrong' as const, explanation: '' }],
};
function mixedSeeds(): { collision: number; unsafeInput: number; clean: number } {
  const seedFor = (value: number): number => {
    for (let seed = 0; seed < 100; seed++) {
      if (resolveSlotsAndDerived(mixedVersion.paramSlots, mixedVersion.derivedValues, seed).X === value) return seed;
    }
    throw new Error(`No test seed found for ${value}`);
  };
  return { collision: seedFor(2), unsafeInput: seedFor(1.0013), clean: seedFor(3) };
}

test('a prior collision is never returned when later draws all fail visible-input precision', async () => {
  const seeds = mixedSeeds();
  const seedFn = jest.fn().mockReturnValueOnce(seeds.collision).mockReturnValue(seeds.unsafeInput);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(drawCollisionFreeParams(mixedVersion, seedFn)).rejects.toThrow('input display check');
    expect(seedFn).toHaveBeenCalledTimes(SERVE_DRAW_ATTEMPTS);
    expect(warn).toHaveBeenCalledTimes(1);
  } finally { warn.mockRestore(); }
});

test('a valid final draw still succeeds after mixed collisions and unsafe displayed inputs', async () => {
  const seeds = mixedSeeds();
  const sequence = [seeds.collision, ...Array(SERVE_DRAW_ATTEMPTS - 2).fill(seeds.unsafeInput), seeds.clean];
  const seedFn = jest.fn(() => sequence.shift()!);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const draw = await drawCollisionFreeParams(mixedVersion, seedFn);
    expect(draw.seed).toBe(seeds.clean);
    expect(draw.paramValues?.X).toBe(3);
    expect(mixedVersion.options.map(option => substituteParams(option.text, draw.paramValues!))).toEqual(['300', '200']);
    expect(seedFn).toHaveBeenCalledTimes(SERVE_DRAW_ATTEMPTS);
  } finally { warn.mockRestore(); }
});
