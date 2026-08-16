// Multi-seed verification of a parameterized numerical question. Node env,
// no DB — the service is pure apart from the Tier 3 sandbox. See
// docs/superpowers/specs/2026-08-05-numerical-question-correctness-design.md.
import type { DerivedValue, ParamSlot } from '../../server/src/types/domain';
import {
  MAX_ABS_VALUE,
  VERIFICATION_SAMPLE_COUNT,
  SCRIPT_SAMPLE_COUNT,
  optionValueNamesForVerification,
  resolveDerivedValues,
  verifyGenerateScript,
  verifyQuestionNumerics,
} from '../../server/src/services/numeric-verification.service';
import { formatParamValue, substituteParams } from '../../server/src/services/params.service';

const slots: ParamSlot[] = [
  { name: 'CF1', min: 100, max: 500, step: 100 },
  { name: 'CF2', min: 100, max: 500, step: 100 },
  { name: 'RATE', min: 0.03, max: 0.09, step: 0.01 },
];

const derived: DerivedValue[] = [
  { name: 'PV', formula: 'CF1/(1+RATE)^1 + CF2/(1+RATE)^2' },
  { name: 'PV_err1', formula: 'CF1/(1+RATE)^1 + CF2/(1+RATE)^1', errorModel: 'discounted both one period' },
  { name: 'PV_err2', formula: 'CF1 + CF2', errorModel: 'did not discount at all' },
];

describe('option answer coverage', () => {
  it('requires every option to display exactly one computed derived value', () => {
    expect(optionValueNamesForVerification(
      ['${{PV}}', '${{PV_err1}}', '$470.96'],
      ['PV', 'PV_err1', 'PV_err2'],
    )).toEqual({ ok: false, error: 'option 3 must display exactly one computed value' });
  });

  it('preserves one value name per option so reused answers collide', () => {
    expect(optionValueNamesForVerification(
      ['${{PV}}', '${{PV}}'],
      ['PV'],
    )).toEqual({ ok: true, names: ['PV', 'PV'] });
  });

  it('ignores input placeholders while selecting the computed answer', () => {
    expect(optionValueNamesForVerification(
      ['At {{RATE}}, the answer is ${{PV}}', '${{PV_err1}}'],
      ['PV', 'PV_err1'],
    )).toEqual({ ok: true, names: ['PV', 'PV_err1'] });
  });
});

describe('resolveDerivedValues', () => {
  it('is deterministic for a given seed', () => {
    const a = resolveDerivedValues(slots, derived, 12345);
    const b = resolveDerivedValues(slots, derived, 12345);
    expect(a).toEqual(b);
  });

  it('exposes both drawn and derived values', () => {
    const result = resolveDerivedValues(slots, derived, 999);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.values).sort()).toEqual(
      ['CF1', 'CF2', 'PV', 'PV_err1', 'PV_err2', 'RATE'],
    );
  });

  it('lets a derived value reference an earlier derived value', () => {
    const chained: DerivedValue[] = [
      { name: 'BASE', formula: 'CF1 * 2' },
      { name: 'DOUBLED', formula: 'BASE * 2' },
    ];
    const result = resolveDerivedValues([{ name: 'CF1', min: 5, max: 5 }], chained, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.DOUBLED).toBe(20);
  });

  it('resolves a multi-step chain whose later steps reference several earlier ones', () => {
    // GENERATOR_PROMPT's "BUILD THE ANSWER IN STEPS" block tells the model to
    // decompose a WACC exactly like this, because the single-expression version
    // is where real generations dropped a parenthesis and failed to parse. That
    // guidance is only sound if a chain of this shape actually resolves, so pin
    // the shape rather than extrapolating from the single hop above. Every slot
    // is pinned to one value, making the arithmetic hand-checkable:
    // E = 5000, D = 5000, V = 10000, Re = 0.14, WACC = 0.5*0.14 + 0.5*0.06.
    const slots = [
      { name: 'SHARES', min: 100, max: 100 },
      { name: 'PRICE', min: 50, max: 50 },
      { name: 'FACE_DEBT', min: 5000, max: 5000 },
      { name: 'RF_PCT', min: 4, max: 4 },
      { name: 'BETA', min: 2, max: 2 },
      { name: 'MRP_PCT', min: 5, max: 5 },
      { name: 'YTM_PCT', min: 6, max: 6 },
    ];
    const chain: DerivedValue[] = [
      { name: 'EQUITY_VALUE', formula: 'SHARES*PRICE' },
      { name: 'DEBT_VALUE', formula: 'FACE_DEBT' },
      { name: 'V', formula: 'DEBT_VALUE + EQUITY_VALUE' },
      { name: 'COST_EQUITY', formula: 'RF_PCT/100 + BETA*MRP_PCT/100' },
      { name: 'WACC', formula: '(EQUITY_VALUE/V)*COST_EQUITY + (DEBT_VALUE/V)*(YTM_PCT/100)' },
    ];

    const result = resolveDerivedValues(slots, chain, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.V).toBe(10000);
    expect(result.values.COST_EQUITY).toBeCloseTo(0.14, 10);
    expect(result.values.WACC).toBeCloseTo(0.1, 10);
  });
});

describe('verifyQuestionNumerics', () => {
  it('passes a sound question across every sampled draw', () => {
    const result = verifyQuestionNumerics({
      slots,
      derivedValues: derived,
      optionValueNames: ['PV', 'PV_err1', 'PV_err2'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sampleSeeds).toHaveLength(VERIFICATION_SAMPLE_COUNT);
  });

  // The exact shape that killed 5 of 6 numeric questions in the 2026-08-16 batch
  // (docs/prompt-engineering-tests.md). GENERATOR_PROMPT now warns about this
  // family by name; this pins that the verifier still CATCHES it, so warning and
  // enforcement cannot drift apart — a prompt rule nothing enforces is advice,
  // and an enforcement nothing warns about is a mystery.
  it('catches a distractor that degenerates onto the correct answer at BETA = 1', () => {
    const result = verifyQuestionNumerics({
      // 0.5..2.0 step 0.5 — 1.0 is a legal draw, and at that draw the "ignored
      // beta" distractor IS the CAPM answer.
      slots: [
        { name: 'BETA', min: 0.5, max: 2, step: 0.5 },
        { name: 'RF_PCT', min: 3, max: 5, step: 1 },
        { name: 'MARKET_PCT', min: 8, max: 12, step: 1 },
      ],
      derivedValues: [
        { name: 'CAPM', formula: 'RF_PCT+BETA*(MARKET_PCT-RF_PCT)' },
        { name: 'NO_BETA', formula: 'RF_PCT+(MARKET_PCT-RF_PCT)' },
      ],
      optionValueNames: ['CAPM', 'NO_BETA'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/identical/i);
  });

  it('accepts the same question once the range excludes the degenerate draw', () => {
    // The remedy the prompt prescribes: shift the range so 1.0 is never drawn.
    // 1.1, 1.4, 1.7, 2.0 — and note the near miss this test already caught once:
    // 0.6..2.2 step 0.4 LOOKS like it skips 1.0 and does not (0.6 + 0.4 = 1.0),
    // which is why the prompt now tells the generator to list the draws rather
    // than eyeball the bounds.
    const result = verifyQuestionNumerics({
      slots: [
        { name: 'BETA', min: 1.1, max: 2.0, step: 0.3 },
        { name: 'RF_PCT', min: 3, max: 5, step: 1 },
        { name: 'MARKET_PCT', min: 8, max: 12, step: 1 },
      ],
      derivedValues: [
        { name: 'CAPM', formula: 'RF_PCT+BETA*(MARKET_PCT-RF_PCT)' },
        { name: 'NO_BETA', formula: 'RF_PCT+(MARKET_PCT-RF_PCT)' },
      ],
      optionValueNames: ['CAPM', 'NO_BETA'],
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a proof that names fewer than two answer values', () => {
    const result = verifyQuestionNumerics({
      slots: [{ name: 'X', min: 1, max: 1 }],
      derivedValues: [{ name: 'A', formula: 'X' }],
      optionValueNames: ['A'],
    });
    expect(result).toMatchObject({ ok: false, error: 'at least two computed option values are required' });
  });

  it('refuses an answer placeholder that resolution never produced', () => {
    const result = verifyQuestionNumerics({
      slots: [{ name: 'X', min: 1, max: 1 }],
      derivedValues: [{ name: 'A', formula: 'X' }, { name: 'B', formula: 'X + 1' }],
      optionValueNames: ['A', 'MISSING'],
    });
    expect(result).toMatchObject({ ok: false, error: 'option value MISSING was not produced' });
  });

  it('fails when a range lets a divisor reach zero', () => {
    const badSlots: ParamSlot[] = [{ name: 'RATE', min: 0, max: 0.05, step: 0.05 }];
    const badDerived: DerivedValue[] = [
      { name: 'X', formula: '100/RATE' },
      { name: 'Y', formula: '100/(RATE + 1)' },
    ];
    const result = verifyQuestionNumerics({
      slots: badSlots,
      derivedValues: badDerived,
      optionValueNames: ['X', 'Y'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/division by zero/);
    expect(typeof result.failingSeed).toBe('number');
  });

  it('fails when two options collide at some draw', () => {
    const collidingSlots: ParamSlot[] = [
      { name: 'CF1', min: 100, max: 100 },
      { name: 'CF2', min: 0, max: 100, step: 100 },
    ];
    const colliding: DerivedValue[] = [
      { name: 'A', formula: 'CF1' },
      { name: 'B', formula: 'CF1 + CF2' },
    ];
    const result = verifyQuestionNumerics({
      slots: collidingSlots,
      derivedValues: colliding,
      optionValueNames: ['A', 'B'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/identical/);
  });

  it('fails when a value exceeds the magnitude band', () => {
    const hugeSlots: ParamSlot[] = [{ name: 'N', min: 200, max: 200 }];
    const huge: DerivedValue[] = [{ name: 'X', formula: '10^N' }];
    const result = verifyQuestionNumerics({ slots: hugeSlots, derivedValues: huge, optionValueNames: ['X'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/magnitude band/);
  });

  it('reports a parse error against the named formula', () => {
    const result = verifyQuestionNumerics({
      slots,
      derivedValues: [{ name: 'BAD', formula: 'CF1 +' }],
      optionValueNames: ['BAD'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/BAD/);
  });

  it('records a magnitude band a student could plausibly answer', () => {
    expect(MAX_ABS_VALUE).toBe(1e12);
  });
});

describe('R3 — round once, at display', () => {
  it('rounds the reported PV bug to cents', () => {
    expect(formatParamValue(462.5850340136054)).toBe('462.59');
  });

  it('rounds the reported compounding bug to cents', () => {
    expect(formatParamValue(1560.8000000000002)).toBe('1560.80');
  });

  it('prints whole numbers bare', () => {
    expect(formatParamValue(500)).toBe('500');
  });

  it('substitutes rounded text while leaving unknown placeholders literal', () => {
    expect(substituteParams('${{PV}} and {{GONE}}', { PV: 462.5850340136054 }))
      .toBe('$462.59 and {{GONE}}');
  });
});

// The sandbox requires generate() to return `{ vars: { ... } }` — a bare
// object is rejected (param-worker/worker.js:224). Tier 3 scripts must
// follow that existing contract; verification does not relax it.
describe('verifyGenerateScript (Tier 3)', () => {
  it('proves a sound script across every sampled seed', async () => {
    const script = 'function generate(random) { const cf = 100 + Math.floor(random() * 5) * 100; return { vars: { A: cf, B: cf * 2 } }; }';
    const result = await verifyGenerateScript(script, ['A', 'B']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The reduced Tier 3 sample count is recorded, not implied.
    expect(result.sampleSeeds).toHaveLength(SCRIPT_SAMPLE_COUNT);
  }, 60_000);

  it('fails a script whose options can coincide', async () => {
    const script = 'function generate(random) { const x = Math.floor(random() * 2); return { vars: { A: x, B: x * x } }; }';
    const result = await verifyGenerateScript(script, ['A', 'B']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/identical/);
  }, 60_000);

  it('reports a script that throws rather than hanging the gate', async () => {
    const result = await verifyGenerateScript('function generate() { throw new Error("nope"); }', ['A']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/generateScript failed/);
  }, 60_000);
});
