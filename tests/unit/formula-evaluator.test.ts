// Pure-logic tests for the deterministic formula evaluator. Node env — the
// evaluator touches no DB, no DOM, and no worker. See
// docs/superpowers/specs/2026-08-05-numerical-question-correctness-design.md.
import { EVALUATOR_VERSION, evaluateFormula, parseFormula } from '../../server/src/components/formula';

/** Parse + evaluate in one call, throwing on either failure — keeps the
 * assertions below about arithmetic rather than plumbing. */
function evaluate(src: string, env: Record<string, number> = {}): number {
  const parsed = parseFormula(src);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error}`);
  const result = evaluateFormula(parsed.ast, env);
  if (!result.ok) throw new Error(`eval failed: ${result.error}`);
  return result.value;
}

describe('reported production bugs (2026-08-05 user testing)', () => {
  it('discounts each cash flow by its own period', () => {
    // Generated answer was 470.96, from 190.48 + 280.48. The second term is
    // 300/1.1025 = 272.108..., not 280.48.
    const pv = evaluate('200/(1+RATE)^1 + 300/(1+RATE)^2', { RATE: 0.05 });
    expect(pv).toBeCloseTo(462.5850340136054, 10);
  });

  it('compounds a three-payment stream correctly', () => {
    // Generated answer was 1622.40; correct is 1560.80.
    const fv = evaluate('500*(1+R)^2 + 500*(1+R) + 500', { R: 0.04 });
    expect(fv).toBeCloseTo(1560.8, 10);
  });
});

describe('EVALUATOR_VERSION', () => {
  it('is a positive integer so stored proofs can be invalidated wholesale', () => {
    expect(Number.isInteger(EVALUATOR_VERSION)).toBe(true);
    expect(EVALUATOR_VERSION).toBeGreaterThan(0);
  });
});

describe('R1 — integer exponents avoid Math.pow', () => {
  it('computes integer powers by repeated multiplication', () => {
    expect(evaluate('1.05^2')).toBe(1.05 * 1.05);
    expect(evaluate('2^10')).toBe(1024);
    expect(evaluate('2^-2')).toBe(0.25);
  });

  it('is stable across repeated evaluation', () => {
    const once = evaluate('(1+R)^30', { R: 0.07 });
    for (let i = 0; i < 100; i += 1) expect(evaluate('(1+R)^30', { R: 0.07 })).toBe(once);
  });
});

describe('operator precedence and associativity', () => {
  it('binds ^ tighter than * and right-associatively', () => {
    expect(evaluate('2*3^2')).toBe(18);
    expect(evaluate('2^3^2')).toBe(512); // 2^(3^2), not (2^3)^2
  });

  it('treats unary minus as lower precedence than ^', () => {
    expect(evaluate('-2^2')).toBe(-4);
  });
});

describe('built-ins', () => {
  it('PV and FV invert each other', () => {
    expect(evaluate('PV(0.05, 3, FV(0.05, 3, 1000))')).toBeCloseTo(1000, 9);
  });

  it('PMT amortizes a loan', () => {
    expect(evaluate('PMT(0.01, 12, 10000)')).toBeCloseTo(888.487887, 5);
  });

  it('PMT degrades to straight division at a zero rate', () => {
    expect(evaluate('PMT(0, 10, 1000)')).toBe(100);
  });

  it('NPV matches the hand-written discount sum', () => {
    expect(evaluate('NPV(0.05, 200, 300)')).toBeCloseTo(evaluate('200/(1.05)^1 + 300/(1.05)^2'), 12);
  });

  it('IRR recovers the rate NPV was built from', () => {
    expect(evaluate('IRR(-1000, 500, 500, 500)')).toBeCloseTo(0.23375, 4);
  });

  it('N is the standard normal CDF', () => {
    expect(evaluate('N(0)')).toBeCloseTo(0.5, 7);
    expect(evaluate('N(1.96)')).toBeCloseTo(0.975, 4);
  });
});

describe('SUM', () => {
  it('sums a bounded index', () => {
    expect(evaluate('SUM(t, 1, 3, t)')).toBe(6);
  });

  it('computes a duration numerator', () => {
    expect(evaluate('SUM(t, 1, 2, t*CF/(1+Y)^t)', { CF: 100, Y: 0.05 })).toBeCloseTo(
      1 * 100 / 1.05 + 2 * 100 / (1.05 * 1.05), 10,
    );
  });

  it('rejects a SUM wider than the per-SUM cap', () => {
    const parsed = parseFormula('SUM(t, 1, 5000, t)');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = evaluateFormula(parsed.ast, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exceeds 1000 terms/);
  });
});

describe('errors are returned, never thrown', () => {
  it.each([
    ['2 +', /unexpected end/],
    ['2 @ 3', /unexpected character/],
    ['(2', /expected rparen/],
    ['2 3', /trailing input/],
  ])('rejects %s', (src, pattern) => {
    const parsed = parseFormula(src);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(pattern);
  });

  it.each([
    ['1/0', /division by zero/],
    ['MISSING', /unknown variable/],
    ['NOPE(1)', /unknown function/],
    ['ln(0)', /positive argument/],
  ])('rejects %s at evaluation', (src, pattern) => {
    const parsed = parseFormula(src);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = evaluateFormula(parsed.ast, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(pattern);
  });
});
