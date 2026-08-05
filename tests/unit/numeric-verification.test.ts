// Multi-seed verification of a parameterized numerical question. Node env,
// no DB — the service is pure apart from the Tier 3 sandbox. See
// docs/superpowers/specs/2026-08-05-numerical-question-correctness-design.md.
import type { DerivedValue, ParamSlot } from '../../server/src/types/domain';
import {
  MAX_ABS_VALUE,
  VERIFICATION_SAMPLE_COUNT,
  SCRIPT_SAMPLE_COUNT,
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

  it('fails when a range lets a divisor reach zero', () => {
    const badSlots: ParamSlot[] = [{ name: 'RATE', min: 0, max: 0.05, step: 0.05 }];
    const badDerived: DerivedValue[] = [{ name: 'X', formula: '100/RATE' }];
    const result = verifyQuestionNumerics({ slots: badSlots, derivedValues: badDerived, optionValueNames: ['X'] });
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
