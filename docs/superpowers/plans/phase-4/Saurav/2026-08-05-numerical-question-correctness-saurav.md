# Numerical Question Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner:** Saurav
**Created:** 2026-08-05
**Traces to:** [`../../../specs/2026-08-05-numerical-question-correctness-design.md`](../../../specs/2026-08-05-numerical-question-correctness-design.md)

**Goal:** Make it structurally impossible for a student to see a number that a machine did not compute, by adding a deterministic formula evaluator, multi-seed verification, and a serving gate that refuses unverified numerical questions.

**Architecture:** Numerical questions become parameterized templates. `paramSlots` draw inputs from a seeded PRNG (already built); a new pure formula evaluator computes the correct answer and every distractor from those inputs; verification samples 100 draws and records a proof on the version; serving filters out any numerical version lacking that proof. The generator emits formulas instead of numbers, and the reviewer stops judging arithmetic.

**Tech Stack:** TypeScript strict; Express + MongoDB native driver server; plain-TS bundler-free client (native ES modules, `.js` import extensions); Jest + ts-jest + supertest; Playwright for e2e.

## Global Constraints

- TypeScript `strict` everywhere; server compiles to CommonJS, client is native ES modules — **client imports use the explicit `.js` extension** (`client/AGENTS.md`).
- Routes delegate to services; services compose components. No business logic in routes (`server/src/services/AGENTS.md`).
- Units are **server-side** (node env). Pure client logic belongs to the e2e/a11y browser layers (`tests/AGENTS.md`). Pure client modules may be unit-tested by importing them under the node env, as `tests/unit/duplicate-name.test.ts` already does.
- Shared-file convention (root `AGENTS.md`): `package.json`, `server/src/server.ts`, `.env.example`, `client/public/index.html` are append-only, one line/block per addition.
- **No new dependencies.** The evaluator is hand-written; there is no bundler, so third-party browser libs would have to be vendored.
- **R1:** `^` with an integer exponent uses exponentiation by squaring, never `Math.pow`. The algorithm is fixed — changing it changes stored answers and requires an `EVALUATOR_VERSION` bump.
- **R2:** `IRR` uses initial guess `0.1`, iteration cap `100`, tolerance `1e-9`, bisection fallback bounded to `[-0.9999, 10]`. Constants, not tunables.
- **R3:** Round once, at the end, never in the middle. The evaluator never rounds; only the renderer does.
- **R4:** `verification` is a stored proof re-checked at serve time; `EVALUATOR_VERSION` invalidates every proof at once.
- `SUM` caps: 1000 terms per `SUM`, 10000 total per formula.
- Verification samples 100 draws; every draw must pass every check.
- Every task ends green on `npm run typecheck`, `npx eslint <changed files>`, and `npx jest`.

---

### Task 1: Formula evaluator

**Files:**
- Create: `server/src/components/formula/tokenizer.ts`
- Create: `server/src/components/formula/parser.ts`
- Create: `server/src/components/formula/pow.ts`
- Create: `server/src/components/formula/evaluate.ts`
- Create: `server/src/components/formula/builtins.ts`
- Create: `server/src/components/formula/index.ts`

**Import direction (no cycles):** `pow.ts` is a leaf. `builtins.ts` imports
`pow.ts`. `evaluate.ts` imports both. `index.ts` re-exports. `intPow` lives in
its own module precisely because both `evaluate.ts` and `builtins.ts` need it —
putting it in either one would make them mutually dependent.
- Create: `server/src/components/formula/AGENTS.md`
- Test: `tests/unit/formula-evaluator.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `parseFormula(src: string): ParseResult` where `type ParseResult = { ok: true; ast: Node } | { ok: false; error: string }`
  - `evaluateFormula(ast: Node, env: Record<string, number>): EvalResult` where `type EvalResult = { ok: true; value: number } | { ok: false; error: string }`
  - `EVALUATOR_VERSION: number` (starts at `1`)
  - `type Node` as defined in Step 3.

- [x] **Step 1: Write the failing test for the two reported bugs**

Create `tests/unit/formula-evaluator.test.ts`:

```ts
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
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/formula-evaluator.test.ts`
Expected: FAIL — `Cannot find module '../../server/src/components/formula'`

- [x] **Step 3: Write the tokenizer**

Create `server/src/components/formula/tokenizer.ts`:

```ts
// Formula tokenizer. Splits a formula source string into tokens for the
// shunting-yard parser. Pure and total: never throws, returns an error
// string instead. See AGENTS.md in this folder.

export type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; name: string }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' | '^' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' };

export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: string };

const OPERATORS = new Set(['+', '-', '*', '/', '^']);

export function tokenize(src: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < src.length && src[j] >= '0' && src[j] <= '9') j += 1;
      if (src[j] === '.') {
        j += 1;
        while (j < src.length && src[j] >= '0' && src[j] <= '9') j += 1;
      }
      const value = Number(src.slice(i, j));
      if (!Number.isFinite(value)) return { ok: false, error: `bad number at ${i}` };
      tokens.push({ kind: 'num', value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      tokens.push({ kind: 'ident', name: src.slice(i, j) });
      i = j;
      continue;
    }
    if (OPERATORS.has(ch)) {
      tokens.push({ kind: 'op', op: ch as '+' | '-' | '*' | '/' | '^' });
      i += 1;
      continue;
    }
    if (ch === '(') { tokens.push({ kind: 'lparen' }); i += 1; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen' }); i += 1; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma' }); i += 1; continue; }
    return { ok: false, error: `unexpected character '${ch}' at ${i}` };
  }
  return { ok: true, tokens };
}
```

- [x] **Step 4: Write the parser**

Create `server/src/components/formula/parser.ts`:

```ts
// Recursive-descent parser over the tokenizer's output. Produces an AST the
// evaluator walks. `^` is right-associative and binds tighter than unary
// minus, so -2^2 is -(2^2), matching mathematical convention.
import { tokenize, type Token } from './tokenizer';

export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { kind: 'neg'; operand: Node }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'sum'; index: string; from: Node; to: Node; body: Node };

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: string };

class ParseError extends Error {}

export function parseFormula(src: string): ParseResult {
  const tokenized = tokenize(src);
  if (!tokenized.ok) return { ok: false, error: tokenized.error };
  const tokens = tokenized.tokens;
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => tokens[pos++];

  function expect(kind: Token['kind']): void {
    const token = next();
    if (!token || token.kind !== kind) throw new ParseError(`expected ${kind}`);
  }

  // expression := term (('+' | '-') term)*
  function parseExpression(): Node {
    let left = parseTerm();
    for (;;) {
      const token = peek();
      if (token?.kind === 'op' && (token.op === '+' || token.op === '-')) {
        pos += 1;
        left = { kind: 'binary', op: token.op, left, right: parseTerm() };
      } else return left;
    }
  }

  // term := unary (('*' | '/') unary)*
  function parseTerm(): Node {
    let left = parseUnary();
    for (;;) {
      const token = peek();
      if (token?.kind === 'op' && (token.op === '*' || token.op === '/')) {
        pos += 1;
        left = { kind: 'binary', op: token.op, left, right: parseUnary() };
      } else return left;
    }
  }

  // unary := '-' unary | power
  function parseUnary(): Node {
    const token = peek();
    if (token?.kind === 'op' && token.op === '-') {
      pos += 1;
      return { kind: 'neg', operand: parseUnary() };
    }
    return parsePower();
  }

  // power := primary ('^' unary)?   — right-associative
  function parsePower(): Node {
    const base = parsePrimary();
    const token = peek();
    if (token?.kind === 'op' && token.op === '^') {
      pos += 1;
      return { kind: 'binary', op: '^', left: base, right: parseUnary() };
    }
    return base;
  }

  function parsePrimary(): Node {
    const token = next();
    if (!token) throw new ParseError('unexpected end of formula');
    if (token.kind === 'num') return { kind: 'num', value: token.value };
    if (token.kind === 'lparen') {
      const inner = parseExpression();
      expect('rparen');
      return inner;
    }
    if (token.kind === 'ident') {
      if (peek()?.kind !== 'lparen') return { kind: 'var', name: token.name };
      pos += 1; // consume '('
      // SUM(index, from, to, body) binds `index` inside `body` only.
      if (token.name === 'SUM') {
        const indexToken = next();
        if (!indexToken || indexToken.kind !== 'ident') throw new ParseError('SUM index must be a name');
        expect('comma');
        const from = parseExpression();
        expect('comma');
        const to = parseExpression();
        expect('comma');
        const body = parseExpression();
        expect('rparen');
        return { kind: 'sum', index: indexToken.name, from, to, body };
      }
      const args: Node[] = [];
      if (peek()?.kind === 'rparen') pos += 1;
      else {
        for (;;) {
          args.push(parseExpression());
          const sep = next();
          if (sep?.kind === 'rparen') break;
          if (sep?.kind !== 'comma') throw new ParseError('expected , or ) in argument list');
        }
      }
      return { kind: 'call', name: token.name, args };
    }
    throw new ParseError(`unexpected token ${token.kind}`);
  }

  try {
    const ast = parseExpression();
    if (pos !== tokens.length) return { ok: false, error: 'trailing input after formula' };
    return { ok: true, ast };
  } catch (error) {
    return { ok: false, error: error instanceof ParseError ? error.message : String(error) };
  }
}
```

- [x] **Step 5a: Write R1's integer power as its own leaf module**

Create `server/src/components/formula/pow.ts`:

```ts
// R1's integer power. Its own module because both evaluate.ts and builtins.ts
// need it — putting it in either would make the two mutually dependent.

/**
 * R1: integer exponents use exponentiation by squaring — only `*` and `/`,
 * both exactly specified by IEEE 754, so the result is bit-identical across
 * platforms and Node versions. `Math.pow` is implementation-approximated per
 * ECMA-262 and is used ONLY for fractional exponents. This algorithm is
 * fixed: changing it changes stored answers and requires an
 * EVALUATOR_VERSION bump.
 */
export function intPow(base: number, exp: number): number {
  if (!Number.isInteger(exp)) return Math.pow(base, exp);
  let remaining = Math.abs(exp);
  let result = 1;
  let square = base;
  while (remaining > 0) {
    if (remaining % 2 === 1) result *= square;
    square *= square;
    remaining = Math.floor(remaining / 2);
  }
  return exp < 0 ? 1 / result : result;
}
```

- [x] **Step 5b: Write the evaluator**

Create `server/src/components/formula/evaluate.ts`:

```ts
// Deterministic AST evaluator. Every operation is IEEE-754 exact (+, -, *, /)
// except the deliberately-approximated builtins (ln, exp, fractional ^) — see
// R1 in the spec. Never rounds: R3 puts rounding in the renderer alone.
import type { Node } from './parser';
import { BUILTINS } from './builtins';
import { intPow } from './pow';

export type EvalResult = { ok: true; value: number } | { ok: false; error: string };

export const SUM_TERM_CAP = 1000;
export const SUM_TOTAL_CAP = 10000;

class EvalError extends Error {}

export function evaluateFormula(ast: Node, env: Record<string, number>): EvalResult {
  let sumTermsUsed = 0;

  function walk(node: Node, scope: Record<string, number>): number {
    switch (node.kind) {
      case 'num':
        return node.value;
      case 'var': {
        if (!Object.prototype.hasOwnProperty.call(scope, node.name)) {
          throw new EvalError(`unknown variable '${node.name}'`);
        }
        return scope[node.name];
      }
      case 'neg':
        return -walk(node.operand, scope);
      case 'binary': {
        const left = walk(node.left, scope);
        const right = walk(node.right, scope);
        switch (node.op) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/':
            if (right === 0) throw new EvalError('division by zero');
            return left / right;
          case '^': return intPow(left, right);
        }
      }
      // eslint-disable-next-line no-fallthrough
      case 'call': {
        const fn = BUILTINS[node.name];
        if (!fn) throw new EvalError(`unknown function '${node.name}'`);
        return fn(node.args.map((arg) => walk(arg, scope)));
      }
      case 'sum': {
        const from = walk(node.from, scope);
        const to = walk(node.to, scope);
        if (!Number.isInteger(from) || !Number.isInteger(to)) {
          throw new EvalError('SUM bounds must be integers');
        }
        const terms = to - from + 1;
        if (terms > SUM_TERM_CAP) throw new EvalError(`SUM exceeds ${SUM_TERM_CAP} terms`);
        sumTermsUsed += Math.max(0, terms);
        if (sumTermsUsed > SUM_TOTAL_CAP) throw new EvalError(`formula exceeds ${SUM_TOTAL_CAP} SUM terms`);
        let total = 0;
        for (let i = from; i <= to; i += 1) {
          total += walk(node.body, { ...scope, [node.index]: i });
        }
        return total;
      }
    }
  }

  try {
    const value = walk(ast, env);
    if (!Number.isFinite(value)) return { ok: false, error: 'result is not finite' };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof EvalError ? error.message : String(error) };
  }
}
```

- [x] **Step 6: Write the built-ins with R2's IRR contract**

Create `server/src/components/formula/builtins.ts`:

```ts
// Finance and math built-ins. These are shorthand, NOT the allowed formula
// set — arbitrary closed-form finance is expressible with arithmetic alone
// (CAPM is RF + BETA*MRP, Gordon growth is D1/(R-G)). See the spec.
import { intPow } from './pow';

// R2: IRR's convergence contract. Constants, not tunables — changing any of
// them changes stored answers and requires an EVALUATOR_VERSION bump.
export const IRR_GUESS = 0.1;
export const IRR_MAX_ITERATIONS = 100;
export const IRR_TOLERANCE = 1e-9;
export const IRR_BRACKET_LOW = -0.9999;
export const IRR_BRACKET_HIGH = 10;

class BuiltinError extends Error {}

function requireArgs(name: string, args: number[], min: number): void {
  if (args.length < min) throw new BuiltinError(`${name} needs at least ${min} argument(s)`);
}

/** Net present value of cash flows at t=1..n, discounted at `rate`. */
function npv(rate: number, flows: number[]): number {
  let total = 0;
  for (let t = 0; t < flows.length; t += 1) total += flows[t] / intPow(1 + rate, t + 1);
  return total;
}

/** Cumulative standard normal, Abramowitz & Stegun 26.2.17 (|error| < 7.5e-8).
 * Deterministic: only +, -, *, / and one exp. */
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-z * z)));
}

export const BUILTINS: Record<string, (args: number[]) => number> = {
  PV: (args) => { requireArgs('PV', args, 3); return args[2] / intPow(1 + args[0], args[1]); },
  FV: (args) => { requireArgs('FV', args, 3); return args[2] * intPow(1 + args[0], args[1]); },
  PMT: (args) => {
    requireArgs('PMT', args, 3);
    const [rate, periods, principal] = args;
    if (rate === 0) return principal / periods;
    return (principal * rate) / (1 - intPow(1 + rate, -periods));
  },
  NPV: (args) => { requireArgs('NPV', args, 2); return npv(args[0], args.slice(1)); },
  IRR: (args) => {
    requireArgs('IRR', args, 2);
    const flows = args;
    // Newton from IRR_GUESS, then bisection over the bracket if it strays.
    let rate = IRR_GUESS;
    for (let i = 0; i < IRR_MAX_ITERATIONS; i += 1) {
      const value = npv(rate, flows.slice(1)) + flows[0];
      if (Math.abs(value) < IRR_TOLERANCE) return rate;
      const derivative = (npv(rate + IRR_TOLERANCE, flows.slice(1)) - npv(rate, flows.slice(1))) / IRR_TOLERANCE;
      if (derivative === 0 || !Number.isFinite(derivative)) break;
      const stepped = rate - value / derivative;
      if (!Number.isFinite(stepped) || stepped <= IRR_BRACKET_LOW || stepped >= IRR_BRACKET_HIGH) break;
      rate = stepped;
    }
    let low = IRR_BRACKET_LOW;
    let high = IRR_BRACKET_HIGH;
    for (let i = 0; i < IRR_MAX_ITERATIONS; i += 1) {
      const mid = (low + high) / 2;
      const value = npv(mid, flows.slice(1)) + flows[0];
      if (Math.abs(value) < IRR_TOLERANCE) return mid;
      if (value > 0) low = mid; else high = mid;
    }
    throw new BuiltinError('IRR did not converge');
  },
  ln: (args) => { requireArgs('ln', args, 1); if (args[0] <= 0) throw new BuiltinError('ln needs a positive argument'); return Math.log(args[0]); },
  exp: (args) => { requireArgs('exp', args, 1); return Math.exp(args[0]); },
  sqrt: (args) => { requireArgs('sqrt', args, 1); if (args[0] < 0) throw new BuiltinError('sqrt needs a non-negative argument'); return Math.sqrt(args[0]); },
  abs: (args) => { requireArgs('abs', args, 1); return Math.abs(args[0]); },
  min: (args) => { requireArgs('min', args, 1); return Math.min(...args); },
  max: (args) => { requireArgs('max', args, 1); return Math.max(...args); },
  round: (args) => { requireArgs('round', args, 2); const f = intPow(10, args[1]); return Math.round(args[0] * f) / f; },
  N: (args) => { requireArgs('N', args, 1); return normalCdf(args[0]); },
};
```

- [x] **Step 7: Write the barrel and version constant**

Create `server/src/components/formula/index.ts`:

```ts
// Public API of the formula component. Consumers import from here only.
export { parseFormula, type Node, type ParseResult } from './parser';
export { intPow } from './pow';
export { evaluateFormula, SUM_TERM_CAP, SUM_TOTAL_CAP, type EvalResult } from './evaluate';
export { BUILTINS } from './builtins';

/**
 * R4: bumping this invalidates every stored `verification` proof at once.
 * Bump whenever evaluator arithmetic changes — the intPow algorithm, an IRR
 * constant, a builtin's formula, or the SUM caps.
 */
export const EVALUATOR_VERSION = 1;
```

- [x] **Step 8: Run the test to verify it passes**

Run: `npx jest tests/unit/formula-evaluator.test.ts`
Expected: PASS — 3 tests

- [x] **Step 9: Add the determinism and coverage tests**

Append to `tests/unit/formula-evaluator.test.ts`:

```ts
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
    // $10,000 over 12 periods at 1%/period.
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
```

- [x] **Step 10: Run the tests to verify they pass**

Run: `npx jest tests/unit/formula-evaluator.test.ts`
Expected: PASS — all tests

- [x] **Step 11: Document the component**

Create `server/src/components/formula/AGENTS.md`:

```markdown
# AGENTS.md — server/src/components/formula

Deterministic formula evaluator for parameterized numerical questions.

`parseFormula(src)` -> AST; `evaluateFormula(ast, env)` -> number. Both are
total: they return a result object and never throw.

## Why this exists

Generated numerical questions stated wrong arithmetic and the LLM reviewer
passed them, because it was asked to check arithmetic by reading it. Numbers
are now computed, not judged. See
`docs/superpowers/specs/2026-08-05-numerical-question-correctness-design.md`.

## Determinism rules — do not break these

- **R1:** `^` with an integer exponent uses `intPow` (exponentiation by
  squaring). Only `*` and `/`, which IEEE 754 specifies exactly, so it is
  bit-identical everywhere. `Math.pow` is implementation-approximated per
  ECMA-262 and is reserved for fractional exponents.
- **R2:** `IRR`'s guess, iteration cap, tolerance and bracket are constants.
- **R3:** The evaluator NEVER rounds. Rounding happens once, in the renderer.
- **R4:** Bump `EVALUATOR_VERSION` whenever arithmetic changes — the `intPow`
  algorithm, an IRR constant, a builtin's formula, or the SUM caps. It
  invalidates every stored verification proof at once.

## No sandbox needed

A parsed AST over a closed operation set cannot reach the host. There is no
`eval`, no `Function`, no worker on this path. `components/param-worker` stays
reserved for legacy `generateScript` (Tier 3).
```

- [x] **Step 12: Full verification and commit**

Run: `npm run typecheck && npx eslint server/src/components/formula tests/unit/formula-evaluator.test.ts && npx jest`
Expected: all green

```bash
git add server/src/components/formula tests/unit/formula-evaluator.test.ts
git commit -m "feat(formula): deterministic formula evaluator with finance built-ins"
```

---

### Task 2: Verification service

**Files:**
- Modify: `server/src/types/domain.ts` (add `DerivedValue`, `NumericVerification`, extend `QuestionVersion`)
- Create: `server/src/services/numeric-verification.service.ts`
- Modify: `server/src/services/params.service.ts` (R3 display rounding in `substituteParams`)
- Test: `tests/unit/numeric-verification.test.ts`

**Interfaces:**
- Consumes: `parseFormula`, `evaluateFormula`, `EVALUATOR_VERSION` from Task 1; `seededRandom` from `params.service.ts`; `executeGenerate` from `components/param-worker`.
- Produces:
  - `resolveDerivedValues(slots: ParamSlot[], derived: DerivedValue[], seed: number): { ok: true; values: Record<string, number> } | { ok: false; error: string }`
  - `verifyQuestionNumerics(input: VerifyInput): VerifyResult`
  - `verifyGenerateScript(script: string, optionValueNames: string[]): Promise<VerifyResult>`
  - `VERIFICATION_SAMPLE_COUNT: number` (`100`)
  - `MAX_ABS_VALUE: number` (`1e12`)
  - `formatParamValue(value: number): string` (from `params.service.ts`)

- [x] **Step 1: Add the domain types**

In `server/src/types/domain.ts`, immediately after the `ParamSlot` interface (currently ending at line 202), add:

```ts
/** A value COMPUTED from slots, not drawn. The correct answer and every
 *  distractor of a numerical question are derived values. */
export interface DerivedValue {
  name: string; // referenced as {{name}} in stem/option text/explanations
  formula: string; // e.g. "CF1/(1+RATE)^1 + CF2/(1+RATE)^2"
  errorModel?: string; // distractors only: the mistake this option represents
}

/** R4: a machine-checked proof that a numerical question's values are sound
 * across sampled draws. Absent means the question never serves. Cleared on
 * any edit to stem/options/paramSlots/derivedValues. */
export interface NumericVerification {
  evaluatorVersion: number;
  sampleSeeds: number[];
  verifiedAt: Date;
}
```

Then in the `QuestionVersion` interface, immediately after the `generateScript` field (currently line 213), add:

```ts
  numericKind?: 'numeric' | 'conceptual'; // generator's declaration; instructor may override
  derivedValues?: DerivedValue[];
  verification?: NumericVerification;
```

- [x] **Step 2: Write the failing test**

Create `tests/unit/numeric-verification.test.ts`:

```ts
// Multi-seed verification of a parameterized numerical question. Node env,
// no DB — the service is pure. See the design spec.
import type { DerivedValue, ParamSlot } from '../../server/src/types/domain';
import {
  MAX_ABS_VALUE,
  VERIFICATION_SAMPLE_COUNT,
  resolveDerivedValues,
  verifyQuestionNumerics,
} from '../../server/src/services/numeric-verification.service';

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
    const result = verifyQuestionNumerics({ slots, derivedValues: derived, optionValueNames: ['PV', 'PV_err1', 'PV_err2'] });
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
    // At CF2 = 0 these two are equal, so some draws produce duplicate options.
    const collidingSlots: ParamSlot[] = [{ name: 'CF1', min: 100, max: 100 }, { name: 'CF2', min: 0, max: 100, step: 100 }];
    const colliding: DerivedValue[] = [
      { name: 'A', formula: 'CF1' },
      { name: 'B', formula: 'CF1 + CF2' },
    ];
    const result = verifyQuestionNumerics({ slots: collidingSlots, derivedValues: colliding, optionValueNames: ['A', 'B'] });
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
    expect(result.error).toMatch(new RegExp(String(MAX_ABS_VALUE).replace('+', '\\+')));
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
});
```

- [x] **Step 3: Run the test to verify it fails**

Run: `npx jest tests/unit/numeric-verification.test.ts`
Expected: FAIL — cannot find `numeric-verification.service`

- [x] **Step 4: Implement the service**

Create `server/src/services/numeric-verification.service.ts`:

```ts
// -----------------------------------------------------------------------------
// Numeric verification (design spec 2026-08-05): resolves a parameterized
// question's drawn + derived values for a seed, and proves across sampled
// draws that every derived value is finite, in-band, and that no two option
// values collide. Pure functions only — no DB/HTTP here; callers own
// persistence. See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------
import { EVALUATOR_VERSION, evaluateFormula, parseFormula } from '../components/formula';
import { seededRandom } from './params.service';
import type { DerivedValue, NumericVerification, ParamSlot } from '../types/domain';

/** Draws sampled per verification run. Every one must pass every check. */
export const VERIFICATION_SAMPLE_COUNT = 100;

/** Values beyond this are treated as a runaway formula rather than a number a
 * student could meaningfully answer. */
export const MAX_ABS_VALUE = 1e12;

/** Fixed base for the sampled seeds so a failing verification reproduces
 * exactly on re-run rather than being a different sample each time. */
const SAMPLE_SEED_BASE = 1_000_003;

export type ResolveResult =
  | { ok: true; values: Record<string, number> }
  | { ok: false; error: string };

export interface VerifyInput {
  slots: ParamSlot[];
  derivedValues: DerivedValue[];
  /** Names of the derived values the question's options display. */
  optionValueNames: string[];
}

export type VerifyResult =
  | { ok: true; sampleSeeds: number[]; verification: NumericVerification }
  | { ok: false; error: string; failingSeed?: number };

/** Mirrors params.service.ts's drawSlot, kept private there. Duplicated
 * deliberately rather than exported: verification must pin its own draw
 * semantics so a future change to the serving draw is a visible test
 * failure, not a silent divergence between proof and serve. */
function drawSlot(slot: ParamSlot, rand: () => number): number {
  if (slot.values && slot.values.length > 0) {
    const idx = Math.min(slot.values.length - 1, Math.floor(rand() * slot.values.length));
    return slot.values[idx];
  }
  const min = slot.min ?? 0;
  const max = slot.max ?? min;
  const step = slot.step && slot.step !== 0 ? slot.step : 1;
  const count = Math.floor((max - min) / step) + 1;
  const idx = Math.min(count - 1, Math.floor(rand() * count));
  return min + step * idx;
}

/**
 * Draws every slot then evaluates every derived value in declaration order,
 * so a later formula may reference an earlier one by name. Returns drawn and
 * derived values in one flat map, which is exactly what `substituteParams`
 * consumes.
 */
export function resolveDerivedValues(
  slots: ParamSlot[],
  derivedValues: DerivedValue[],
  seed: number,
): ResolveResult {
  const rand = seededRandom(seed);
  const values: Record<string, number> = {};
  for (const slot of slots) values[slot.name] = drawSlot(slot, rand);

  for (const derived of derivedValues) {
    const parsed = parseFormula(derived.formula);
    if (!parsed.ok) return { ok: false, error: `${derived.name}: ${parsed.error}` };
    const evaluated = evaluateFormula(parsed.ast, values);
    if (!evaluated.ok) return { ok: false, error: `${derived.name}: ${evaluated.error}` };
    values[derived.name] = evaluated.value;
  }
  return { ok: true, values };
}

/**
 * R4's proof. Samples VERIFICATION_SAMPLE_COUNT deterministic draws; every
 * one must satisfy all four checks. A single-draw check is close to
 * worthless — the failures that matter (a range whose edge divides by zero,
 * two options that coincide for some values) appear only on specific draws.
 */
export function verifyQuestionNumerics(input: VerifyInput): VerifyResult {
  const sampleSeeds: number[] = [];
  for (let i = 0; i < VERIFICATION_SAMPLE_COUNT; i += 1) sampleSeeds.push(SAMPLE_SEED_BASE + i);

  for (const seed of sampleSeeds) {
    const resolved = resolveDerivedValues(input.slots, input.derivedValues, seed);
    if (!resolved.ok) return { ok: false, error: resolved.error, failingSeed: seed };

    for (const [name, value] of Object.entries(resolved.values)) {
      if (!Number.isFinite(value)) {
        return { ok: false, error: `${name} is not finite`, failingSeed: seed };
      }
      if (Math.abs(value) > MAX_ABS_VALUE) {
        return { ok: false, error: `${name} exceeds the magnitude band ${MAX_ABS_VALUE}`, failingSeed: seed };
      }
    }

    const optionValues = input.optionValueNames.map((name) => resolved.values[name]);
    for (let a = 0; a < optionValues.length; a += 1) {
      for (let b = a + 1; b < optionValues.length; b += 1) {
        if (optionValues[a] === optionValues[b]) {
          return {
            ok: false,
            error: `options ${input.optionValueNames[a]} and ${input.optionValueNames[b]} are identical`,
            failingSeed: seed,
          };
        }
      }
    }
  }

  return {
    ok: true,
    sampleSeeds,
    verification: { evaluatorVersion: EVALUATOR_VERSION, sampleSeeds, verifiedAt: new Date() },
  };
}
```

- [x] **Step 5: Implement R3's display rounding**

**Without this step students see `462.5850340136054` instead of `$462.59`.**
`substituteParams` currently does `String(values[name])`, which prints the raw
double. R3 puts rounding here, at the single display chokepoint, and nowhere
else — the evaluator must never round, or a distractor computed from a rounded
intermediate recreates the exact `190.48 + 272.11` bug this work exists to fix.

In `server/src/services/params.service.ts`, add above `substituteParams`:

```ts
/**
 * R3: the ONE place a computed value becomes display text. Integers print
 * bare; everything else rounds to 2 decimals, which is what a finance student
 * writing dollars and cents expects. The evaluator itself never rounds — all
 * arithmetic upstream of here runs at full double precision, so intermediate
 * rounding can never compound into the answer.
 */
export function formatParamValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return (Math.round(value * 100) / 100).toFixed(2);
}
```

and change `substituteParams`'s replacement to use it:

```ts
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? formatParamValue(values[name]) : match,
  );
```

Add to `tests/unit/numeric-verification.test.ts`:

```ts
import { formatParamValue, substituteParams } from '../../server/src/services/params.service';

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
```

- [x] **Step 6: Verify Tier 3 `generateScript` questions**

The spec ships Tier 3, so a `generateScript` question must be *verifiable* —
otherwise it can never satisfy the gate and the escape hatch is decorative.
`verifyQuestionNumerics` only understands `derivedValues`, so add an async
sibling that drives the existing sandbox.

Append to `server/src/services/numeric-verification.service.ts`:

```ts
import { executeGenerate } from '../components/param-worker';

/**
 * Tier 3: the same proof for a question whose values come from a sandboxed
 * `generate()` rather than formulas. Async because the worker is. Identical
 * checks, so a Tier 3 question earns exactly the same gate clearance as a
 * Tier 1 one — the tier changes who authors the maths, never whether it is
 * proven.
 */
export async function verifyGenerateScript(
  script: string,
  optionValueNames: string[],
): Promise<VerifyResult> {
  const sampleSeeds: number[] = [];
  for (let i = 0; i < VERIFICATION_SAMPLE_COUNT; i += 1) sampleSeeds.push(SAMPLE_SEED_BASE + i);

  for (const seed of sampleSeeds) {
    let values: Record<string, number>;
    try {
      values = await executeGenerate(script, seed);
    } catch (error) {
      return { ok: false, error: `generateScript failed: ${(error as Error).message}`, failingSeed: seed };
    }

    for (const [name, value] of Object.entries(values)) {
      if (!Number.isFinite(value)) return { ok: false, error: `${name} is not finite`, failingSeed: seed };
      if (Math.abs(value) > MAX_ABS_VALUE) {
        return { ok: false, error: `${name} exceeds the magnitude band ${MAX_ABS_VALUE}`, failingSeed: seed };
      }
    }

    const optionValues = optionValueNames.map((name) => values[name]);
    for (let a = 0; a < optionValues.length; a += 1) {
      for (let b = a + 1; b < optionValues.length; b += 1) {
        if (optionValues[a] === optionValues[b]) {
          return {
            ok: false,
            error: `options ${optionValueNames[a]} and ${optionValueNames[b]} are identical`,
            failingSeed: seed,
          };
        }
      }
    }
  }

  return {
    ok: true,
    sampleSeeds,
    verification: { evaluatorVersion: EVALUATOR_VERSION, sampleSeeds, verifiedAt: new Date() },
  };
}
```

Add to `tests/unit/numeric-verification.test.ts`:

```ts
import { verifyGenerateScript } from '../../server/src/services/numeric-verification.service';

describe('verifyGenerateScript (Tier 3)', () => {
  it('proves a sound script across every sampled seed', async () => {
    const script = 'function generate(random) { const cf = 100 + Math.floor(random() * 5) * 100; return { A: cf, B: cf * 2 }; }';
    const result = await verifyGenerateScript(script, ['A', 'B']);
    expect(result.ok).toBe(true);
  }, 30_000);

  it('fails a script whose options can coincide', async () => {
    const script = 'function generate(random) { const x = Math.floor(random() * 2); return { A: x, B: x * x }; }';
    const result = await verifyGenerateScript(script, ['A', 'B']);
    expect(result.ok).toBe(false);
  }, 30_000);
});
```

> **Note for the implementer:** 100 worker spawns per verification is slow.
> If these tests run longer than ~20s, reduce Tier 3 to
> `VERIFICATION_SAMPLE_COUNT / 4` seeds and record the reduced count in the
> stored proof's `sampleSeeds` so the difference is visible rather than
> implied. Do not reduce Tier 1/2 sampling, which is pure and fast.

- [x] **Step 7: Run the tests to verify they pass**

Run: `npx jest tests/unit/numeric-verification.test.ts`
Expected: PASS — all tests

- [x] **Step 8: Full verification and commit**

Run: `npm run typecheck && npx eslint server/src/services/numeric-verification.service.ts server/src/services/params.service.ts server/src/types/domain.ts tests/unit/numeric-verification.test.ts && npx jest`
Expected: all green

```bash
git add server/src/types/domain.ts server/src/services/numeric-verification.service.ts server/src/services/params.service.ts tests/unit/numeric-verification.test.ts
git commit -m "feat(numerics): multi-seed verification, Tier 3 script proofs, and display rounding"
```

---

### Task 3: The serving gate

**Files:**
- Create: `server/src/services/numeric-gate.service.ts`
- Modify: `server/src/services/serving.service.ts:43-61` (filter `approvedCandidatesForLo`)
- Modify: `server/src/services/exam-attempts.service.ts` (filter `loadBank`'s candidates)
- Test: `tests/unit/numeric-gate.test.ts`

**Interfaces:**
- Consumes: `EVALUATOR_VERSION` from Task 1; `NumericVerification`, `QuestionVersion` types from Task 2.
- Produces:
  - `detectNumeric(stem: string, optionTexts: string[]): boolean`
  - `isNumericQuestion(version: NumericGateVersion): boolean`
  - `isServable(version: NumericGateVersion): boolean`
  - `type NumericGateVersion = Pick<QuestionVersion, 'stem' | 'options' | 'numericKind' | 'verification'>`

**After this task the reported bug is structurally impossible**, even before the generator emits a single formula: unverified numerical questions stop reaching students.

- [x] **Step 1: Write the failing test**

Create `tests/unit/numeric-gate.test.ts`:

```ts
// The gate that keeps unverified numerical questions away from students.
// Node env, pure. See the design spec.
import { EVALUATOR_VERSION } from '../../server/src/components/formula';
import { detectNumeric, isNumericQuestion, isServable } from '../../server/src/services/numeric-gate.service';
import type { QuestionOption } from '../../server/src/types/domain';

function options(...texts: string[]): QuestionOption[] {
  return texts.map((text, i) => ({
    key: String.fromCharCode(65 + i),
    text,
    role: i === 0 ? 'correct' as const : 'clearly-wrong' as const,
    explanation: '',
  }));
}

const proof = { evaluatorVersion: EVALUATOR_VERSION, sampleSeeds: [1], verifiedAt: new Date() };

describe('detectNumeric', () => {
  it('flags currency amounts', () => {
    expect(detectNumeric('What is the present value?', ['$462.59', '$470.96'])).toBe(true);
  });

  it('flags a stem carrying an arithmetic expression', () => {
    expect(detectNumeric('Compute 200/(1.05)^2 for the stream.', ['a', 'b'])).toBe(true);
  });

  it('does not flag prose with no numbers', () => {
    expect(detectNumeric('Which statement best describes diversification?', ['Risk falls', 'Risk rises'])).toBe(false);
  });
});

describe('isNumericQuestion', () => {
  it('trusts the generator declaration', () => {
    expect(isNumericQuestion({ stem: 'no digits here', options: options('a', 'b'), numericKind: 'numeric' })).toBe(true);
  });

  it('catches a mistagged question via the detector backstop', () => {
    // THE REPORTED BUG: static numbers, no paramSlots, declared conceptual.
    // A structural "has paramSlots?" test would pass this straight through.
    expect(isNumericQuestion({
      stem: 'A stream pays $200 at Period 1 and $300 at Period 2.',
      options: options('$470.96', '$462.59'),
      numericKind: 'conceptual',
    })).toBe(true);
  });

  it('honours a conceptual override on genuinely non-numeric prose', () => {
    expect(isNumericQuestion({
      stem: 'Which statement best describes diversification?',
      options: options('Risk falls', 'Risk rises'),
      numericKind: 'conceptual',
    })).toBe(false);
  });
});

describe('isServable', () => {
  it('serves a conceptual question with no proof', () => {
    expect(isServable({ stem: 'Define beta.', options: options('a', 'b') })).toBe(true);
  });

  it('refuses a numerical question with no proof', () => {
    expect(isServable({ stem: 'Compute $200/(1.05)^2.', options: options('$181.41', '$190.48') })).toBe(false);
  });

  it('serves a numerical question carrying a current proof', () => {
    expect(isServable({
      stem: 'Compute $200/(1.05)^2.',
      options: options('$181.41', '$190.48'),
      verification: proof,
    })).toBe(true);
  });

  it('refuses a proof from a superseded evaluator version', () => {
    expect(isServable({
      stem: 'Compute $200/(1.05)^2.',
      options: options('$181.41', '$190.48'),
      verification: { ...proof, evaluatorVersion: EVALUATOR_VERSION - 1 },
    })).toBe(false);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/numeric-gate.test.ts`
Expected: FAIL — cannot find `numeric-gate.service`

- [x] **Step 3: Implement the gate**

Create `server/src/services/numeric-gate.service.ts`:

```ts
// -----------------------------------------------------------------------------
// The numeric gate (design spec 2026-08-05): decides whether a question
// version may be served to a student. A numerical version without a current
// verification proof never serves. Pure predicates — callers filter their own
// candidate pools. See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------
import { EVALUATOR_VERSION } from '../components/formula';
import type { QuestionVersion } from '../types/domain';

export type NumericGateVersion = Pick<QuestionVersion, 'stem' | 'options' | 'numericKind' | 'verification'>;

// A currency marker, or a bare number of two-plus digits or with a decimal
// part, or a digit adjacent to an arithmetic operator. Deliberately loose:
// a false positive costs an instructor one override, a false negative costs
// a student a wrong answer.
const NUMERIC_PATTERNS = [
  /[$€£¥]\s*\d/,
  /\d+\.\d/,
  /\b\d{2,}\b/,
  /\d\s*[-+*/^]\s*\d/,
  /\d\s*%/,
];

/**
 * Heuristic backstop over stem and option text. Independent of the
 * generator's own declaration on purpose: a mistagged question would
 * otherwise sail through, and the reported bug was exactly a static numeric
 * question that no structural test would have caught.
 */
export function detectNumeric(stem: string, optionTexts: string[]): boolean {
  const haystack = [stem, ...optionTexts].join('\n');
  return NUMERIC_PATTERNS.some((pattern) => pattern.test(haystack));
}

/** Two signals, either sufficient: the generator's declaration, or the
 * detector. An instructor override to 'conceptual' only wins when the
 * detector also finds nothing. */
export function isNumericQuestion(version: NumericGateVersion): boolean {
  if (version.numericKind === 'numeric') return true;
  return detectNumeric(version.stem, version.options.map((option) => option.text));
}

/**
 * The gate. A conceptual question always serves. A numerical one serves only
 * with a proof from the CURRENT evaluator — R4's version check means an
 * evaluator change invalidates every stored proof at once rather than
 * silently trusting arithmetic produced by superseded code.
 */
export function isServable(version: NumericGateVersion): boolean {
  if (!isNumericQuestion(version)) return true;
  return version.verification?.evaluatorVersion === EVALUATOR_VERSION;
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/unit/numeric-gate.test.ts`
Expected: PASS — all tests

- [x] **Step 5: Apply the gate to the practice/retry/preview chokepoint**

In `server/src/services/serving.service.ts`, add to the imports at the top of the file:

```ts
import { isServable } from './numeric-gate.service';
```

Then in `approvedCandidatesForLo` (line 43), replace the candidate-building loop:

```ts
  const candidates: Candidate[] = [];
  for (const head of heads) {
    const version = versionById.get(head.currentVersionId.toString());
    if (version) candidates.push({ question: head, version });
  }
  return candidates;
```

with:

```ts
  const candidates: Candidate[] = [];
  for (const head of heads) {
    const version = versionById.get(head.currentVersionId.toString());
    // The numeric gate: an approved-but-unverified numerical question stays
    // in the bank and the review queue but never reaches a student. This is
    // the single chokepoint for practice, Strategy A retry, and instructor
    // preview — all three call this function.
    if (version && isServable(version)) candidates.push({ question: head, version });
  }
  return candidates;
```

- [x] **Step 6: Apply the gate to the exam chokepoint**

In `server/src/services/exam-attempts.service.ts`, add to the imports:

```ts
import { isServable } from './numeric-gate.service';
```

Then in the pool filter inside the theme loop, add the gate as the first condition:

```ts
      const pool = candidates.filter((candidate) => (
        isServable(candidate.version)
        && candidate.version.type === type
        && candidate.question.themeIds.some((id) => id.equals(config.themeId))
        && !selectedIds.has(candidate.question._id.toHexString())
      ));
```

- [x] **Step 7: Add the integration test**

Append to `tests/unit/numeric-gate.test.ts`:

```ts
describe('gate integration points', () => {
  it('is applied at both serving chokepoints', () => {
    // Guards against a third serving path being added without the gate.
    // resolveParamValues has six call sites; only these two build the
    // candidate pools students draw from.
    const serving = require('fs').readFileSync('server/src/services/serving.service.ts', 'utf8');
    const exams = require('fs').readFileSync('server/src/services/exam-attempts.service.ts', 'utf8');
    expect(serving).toContain('isServable(version)');
    expect(exams).toContain('isServable(candidate.version)');
  });
});
```

- [x] **Step 8: Full verification and commit**

Run: `npm run typecheck && npx eslint server/src/services/numeric-gate.service.ts server/src/services/serving.service.ts server/src/services/exam-attempts.service.ts tests/unit/numeric-gate.test.ts && npx jest`
Expected: all green

```bash
git add server/src/services/numeric-gate.service.ts server/src/services/serving.service.ts server/src/services/exam-attempts.service.ts tests/unit/numeric-gate.test.ts
git commit -m "feat(numerics): gate unverified numerical questions out of every serving path"
```

---

### Task 4: Generation pipeline

**Files:**
- Modify: `server/src/services/generation.service.ts:909-927` (`REVIEWER_PROMPT`)
- Modify: `server/src/services/generation.service.ts:124-134` (`GeneratorOutput`, `ReviewerOutput`)
- Modify: `server/src/services/generation.service.ts` (persist slots/derived values, run verification)
- Test: `tests/unit/generation-numerics.test.ts`

**Interfaces:**
- Consumes: `verifyQuestionNumerics` from Task 2; `isNumericQuestion` from Task 3.
- Produces: generated `QuestionVersion` records carrying `numericKind`, `paramSlots`, `derivedValues`, and `verification` when verification succeeds.

- [x] **Step 1: Write the failing test**

Create `tests/unit/generation-numerics.test.ts`:

```ts
// The generator's numerical contract: it emits formulas, never numbers, and
// the reviewer no longer judges arithmetic. See the design spec.
import { GENERATOR_PROMPT, REVIEWER_PROMPT } from '../../server/src/services/generation.service';

describe('REVIEWER_PROMPT', () => {
  const prompt = REVIEWER_PROMPT({ loName: 'Compute present value', question: { stem: 's', options: [] } });

  it('no longer asks the LLM to check calculations', () => {
    // This criterion passed both production bugs. Arithmetic is the
    // evaluator's job now; asking for it here invites false confidence.
    expect(prompt).not.toMatch(/Calculation correctness/i);
    expect(prompt).not.toMatch(/numbers\/formulas check out/i);
  });

  it('asks whether the formula models the question instead', () => {
    expect(prompt).toMatch(/formula/i);
    expect(prompt).toMatch(/model/i);
  });

  it('keeps the judgement criteria an LLM is actually good at', () => {
    expect(prompt).toMatch(/Factual accuracy/i);
    expect(prompt).toMatch(/alignment/i);
    expect(prompt).toMatch(/Distractor quality/i);
    expect(prompt).toMatch(/Clarity/i);
    expect(prompt).toMatch(/Difficulty calibration/i);
  });
});

describe('GENERATOR_PROMPT', () => {
  // Real signature, verified against generation.service.ts:853 —
  // { type, loName, difficulty?, prompt?, chunks }. It is already exported.
  const prompt = GENERATOR_PROMPT({ type: 'mcq', loName: 'Compute present value', chunks: [] });

  it('instructs the generator to emit slots and formulas, not numbers', () => {
    expect(prompt).toMatch(/paramSlots/);
    expect(prompt).toMatch(/derivedValues/);
    expect(prompt).toMatch(/numericKind/);
  });

  it('forbids stating a computed number literally', () => {
    expect(prompt).toMatch(/never (write|state) (a )?computed/i);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/generation-numerics.test.ts`
Expected: FAIL — `Calculation correctness` still present

- [x] **Step 3: Rewrite the reviewer prompt**

In `server/src/services/generation.service.ts`, replace the body of `REVIEWER_PROMPT` (line 909) with:

```ts
export function REVIEWER_PROMPT(params: { loName: string; question: GeneratorOutput }): string {
  return [
    'You are a senior finance instructor reviewing a generated practice question for the',
    `LO "${params.loName}". Judge it against these criteria (IN-Q05):`,
    '  1. Factual accuracy — every statement is correct.',
    '  2. LO & material alignment — it tests this LO and is grounded in the material.',
    '  3. Distractor quality — wrong options are plausible and pedagogically useful.',
    '  4. Clarity — the stem and options are unambiguous.',
    '  5. Difficulty calibration — the actual reasoning demand matches the stated difficulty;',
    '     a one-step substitution should not pass as medium or hard.',
    '  6. Formula modelling — does each formula in derivedValues actually model what the',
    '     stem asks? A present value of a two-period stream must discount each cash flow',
    '     by its OWN period. Judge the MODEL, not the arithmetic.',
    '',
    'DO NOT attempt to evaluate any arithmetic. Every number a student sees is computed by',
    'a deterministic evaluator, so arithmetic errors are structurally impossible and',
    'checking them here only produces false confidence. Judge modelling and pedagogy.',
    '',
    'Question JSON:',
    JSON.stringify(params.question),
    '',
    'Decide: "pass" (ready for instructor approval), "flag" (usable but needs attention),',
    'or "reject" (do not use). Respond with ONLY this JSON shape:',
    '{ "decision": "pass"|"flag"|"reject", "reasoning": string }',
  ].join('\n');
}
```

- [x] **Step 4: Extend the generator output contract**

In `server/src/services/generation.service.ts`, replace the `GeneratorOutput` interface (line 124):

```ts
interface GeneratorOutput {
  stem: string;
  options: QuestionOption[];
  difficulty?: string;
  numericKind?: 'numeric' | 'conceptual';
  paramSlots?: ParamSlot[];
  derivedValues?: DerivedValue[];
}
```

Add `ParamSlot` and `DerivedValue` to the existing `../types/domain` import at the top of the file.

- [x] **Step 5: Instruct the generator to emit formulas**

In `GENERATOR_PROMPT`, append these lines before the response-shape line:

```ts
    '',
    'NUMERICAL QUESTIONS — MANDATORY:',
    'If the question involves any computation, set "numericKind": "numeric" and NEVER write a',
    'computed number literally. Instead:',
    '  - "paramSlots": [{ "name": "CF1", "min": 100, "max": 500, "step": 100 }, …] — the inputs.',
    '  - "derivedValues": [{ "name": "PV", "formula": "CF1/(1+RATE)^1 + CF2/(1+RATE)^2" },',
    '      { "name": "PV_err1", "formula": "CF1/(1+RATE)^1 + CF2/(1+RATE)^1",',
    '        "errorModel": "discounted both cash flows one period" }, …]',
    '    The correct answer AND every distractor is a derived value. Each distractor must be',
    '    the result of a specific, realistic mistake, named in "errorModel".',
    '  - Option text references values as placeholders, e.g. a dollar sign followed by',
    '    {{PV}} or {{PV_err1}}. Never inline the computed number itself.',
    'Formula syntax: + - * / ^ ( ), variables, and the functions PV, FV, PMT, NPV, IRR, ln,',
    'exp, sqrt, abs, min, max, round, N, plus SUM(index, from, to, body) for series.',
    'Ranges must exclude values that break the formula (a rate range must not include 0 if',
    'the formula divides by the rate), and distractors must never coincide with the correct',
    'answer for any value in range.',
    'If the question involves no computation, set "numericKind": "conceptual" and omit',
    'paramSlots and derivedValues.',
```

- [x] **Step 6: Verify generated numerical questions before persisting**

There are exactly **two** `createQuestion` call sites in this file —
`generation.service.ts:289` (the main generation path) and
`generation.service.ts:567` (the regeneration path). Both must get this
treatment; missing the second leaves regenerated questions unverified, which is
precisely the path the tester used when they reported "I regenerated the
numerical question and the numerical answer was still incorrect."

Insert immediately before each `createQuestion({` call:

```ts
  // Verify generated numerics before the version is written, so an
  // unverifiable question lands in review already carrying its reason
  // rather than looking approvable.
  let verification: NumericVerification | undefined;
  if (candidate.numericKind === 'numeric' && candidate.derivedValues?.length) {
    const optionValueNames = candidate.derivedValues
      .filter((derived) => candidate.options.some((option) => option.text.includes(`{{${derived.name}}}`)))
      .map((derived) => derived.name);
    const result = verifyQuestionNumerics({
      slots: candidate.paramSlots ?? [],
      derivedValues: candidate.derivedValues,
      optionValueNames,
    });
    if (result.ok) verification = result.verification;
    else agentDecision.reasoning = `${agentDecision.reasoning}\n\nNumeric verification FAILED: ${result.error}`;
  }
```

and include `...(verification ? { verification } : {})` in the persisted version document alongside `paramSlots`, `derivedValues`, and `numericKind`.

- [x] **Step 7: Run the tests to verify they pass**

Run: `npx jest tests/unit/generation-numerics.test.ts`
Expected: PASS — all tests

- [x] **Step 8: Full verification and commit**

Run: `npm run typecheck && npx eslint server/src/services/generation.service.ts tests/unit/generation-numerics.test.ts && npx jest`
Expected: all green

```bash
git add server/src/services/generation.service.ts tests/unit/generation-numerics.test.ts
git commit -m "feat(generation): emit formulas instead of numbers; stop asking the reviewer to do arithmetic"
```

---

### Task 5: Instructor UI — derived values

**Files:**
- Modify: `client/src/api.ts` (extend `ParamSlotInput` payload with derived values)
- Modify: `client/src/views/instructor/param-config.ts`
- Modify: `client/public/styles/main.css`
- Modify: `server/src/routes/questions.routes.ts` (accept `derivedValues`, run verification on save)
- Test: `tests/unit/question-params-routes.test.ts`
- Test: `tests/e2e/numeric-parameterization.spec.ts`

**Interfaces:**
- Consumes: `verifyQuestionNumerics` from Task 2; `resolveDerivedValues` from Task 2 for the preview.
- Produces: `PATCH /api/questions/:questionId/params` accepting `{ paramSlots, derivedValues, numericKind }` and returning `{ verification, verificationError? }`.

- [x] **Step 1: Write the failing route test**

Create `tests/unit/question-params-routes.test.ts`:

```ts
// PATCH /api/questions/:questionId/params now carries derivedValues and runs
// verification on save. Harness mirrors tests/unit/course-outline.routes.test.ts:
// mock the capability check, mount one router on a bare express app.
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { EVALUATOR_VERSION } from '../../server/src/components/formula';

jest.mock('../../server/src/services/capabilities.service', () => ({
  hasCapability: jest.fn(async () => true),
}));

const updateOne = jest.fn(async () => ({ acknowledged: true }));
const findOne = jest.fn();
jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionVersionsCol: () => ({ updateOne, findOne }),
  questionsCol: () => ({ findOne }),
}));

import { questionsRouter } from '../../server/src/routes/questions.routes';

const questionId = new ObjectId();
const versionId = new ObjectId();

function app(): Express {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, nextFn) => {
    (req as unknown as { user: unknown }).user = { puid: '12345678', isAdmin: true, courseRoles: [] };
    nextFn();
  });
  instance.use('/api', questionsRouter);
  return instance;
}

const soundBody = {
  paramSlots: [
    { name: 'CF1', min: 100, max: 500, step: 100 },
    { name: 'RATE', min: 0.03, max: 0.09, step: 0.01 },
  ],
  derivedValues: [
    { name: 'PV', formula: 'CF1/(1+RATE)^1' },
    { name: 'PV_err', formula: 'CF1*(1+RATE)', errorModel: 'compounded instead of discounted' },
  ],
  numericKind: 'numeric' as const,
};

beforeEach(() => {
  updateOne.mockClear();
  findOne.mockResolvedValue({
    _id: versionId,
    questionId,
    options: [
      { key: 'A', text: '${{PV}}', role: 'correct', explanation: '' },
      { key: 'B', text: '${{PV_err}}', role: 'common-misconception', explanation: '' },
    ],
  });
});

describe('PATCH /api/questions/:questionId/params', () => {
  it('stores a verification proof when the formulas are sound', async () => {
    const res = await request(app())
      .patch(`/api/questions/${questionId.toHexString()}/params`)
      .send(soundBody);

    expect(res.status).toBe(200);
    expect(res.body.verification.evaluatorVersion).toBe(EVALUATOR_VERSION);
    expect(res.body.verificationError).toBeUndefined();
    expect(updateOne.mock.calls[0][1].$set.verification).toBeDefined();
  });

  it('returns verificationError and withholds the proof when a range divides by zero', async () => {
    const res = await request(app())
      .patch(`/api/questions/${questionId.toHexString()}/params`)
      .send({
        ...soundBody,
        paramSlots: [{ name: 'RATE', min: 0, max: 0.05, step: 0.05 }],
        derivedValues: [{ name: 'PV', formula: '100/RATE' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.verification).toBeUndefined();
    expect(res.body.verificationError).toMatch(/division by zero/);
  });

  it('clears any existing proof when verification fails', async () => {
    await request(app())
      .patch(`/api/questions/${questionId.toHexString()}/params`)
      .send({
        ...soundBody,
        derivedValues: [{ name: 'PV', formula: 'CF1 +' }],
      });

    // R4: a failed save must not leave a stale proof behind, or the gate
    // would keep serving numbers the current formulas never produced.
    expect(updateOne.mock.calls[0][1].$unset).toEqual({ verification: '' });
  });
});
```

> **Note for the implementer:** the two `jest.mock` factories above name the
> collection helpers and the capability function as they exist today. Read
> `tests/unit/course-outline.routes.test.ts:1-30` and the top of
> `questions.routes.ts` first, and adjust the mocked module paths to match
> whatever those files actually import — the *assertions* are the contract,
> the mock wiring is not.

- [x] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/question-params-routes.test.ts`
Expected: FAIL once real assertions are in place

- [x] **Step 3: Extend the route**

In `server/src/routes/questions.routes.ts`, extend the params PATCH body schema to accept `derivedValues` and `numericKind`:

```ts
const derivedValueSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  formula: z.string().min(1),
  errorModel: z.string().optional(),
});

const paramsPatchSchema = z.object({
  paramSlots: z.array(paramSlotSchema).optional(),
  derivedValues: z.array(derivedValueSchema).optional(),
  numericKind: z.enum(['numeric', 'conceptual']).optional(),
});
```

In the handler, after writing the slots and derived values, run verification and persist the result:

```ts
    const result = verifyQuestionNumerics({
      slots: body.paramSlots ?? [],
      derivedValues: body.derivedValues ?? [],
      optionValueNames: (body.derivedValues ?? [])
        .filter((derived) => version.options.some((option) => option.text.includes(`{{${derived.name}}}`)))
        .map((derived) => derived.name),
    });
    // R4: an edit always clears the old proof first, so a failed save leaves
    // the question non-servable rather than retaining a stale proof.
    await questionVersionsCol().updateOne(
      { _id: version._id },
      result.ok
        ? { $set: { paramSlots, derivedValues, verification: result.verification } }
        : { $set: { paramSlots, derivedValues }, $unset: { verification: '' } },
    );
    res.json({ ...serialized, ...(result.ok ? { verification: result.verification } : { verificationError: result.error }) });
```

- [x] **Step 4: Add the client API binding**

In `client/src/api.ts`, extend the params patch wrapper to send derived values:

```ts
export interface DerivedValueInput {
  name: string;
  formula: string;
  errorModel?: string;
}

/** PATCH /api/questions/:questionId/params { paramSlots?, derivedValues?, numericKind? }
 * -> the question, plus `verification` on success or `verificationError` on failure. */
export async function patchQuestionParams(
  questionId: string,
  body: { paramSlots?: ParamSlotInput[]; derivedValues?: DerivedValueInput[]; numericKind?: 'numeric' | 'conceptual' },
): Promise<QuestionDetail & { verification?: { evaluatorVersion: number; verifiedAt: string }; verificationError?: string }> {
  return request(`/api/questions/${encodeURIComponent(questionId)}/params`, { method: 'PATCH', body: JSON.stringify(body) });
}
```

- [x] **Step 5: Add the Derived Values table to the config view**

In `client/src/views/instructor/param-config.ts`, add these two functions and
call `derivedValuesTable` from the view's render path, beside the existing slot
rows. House style is the file's existing `el()`/`mount()`, no framework.

```ts
import { type DerivedValueInput } from '../../api.js';

interface DerivedDraft {
  name: string;
  formula: string;
  errorModel: string;
}

/** One editable derived-value row. `onChange` re-renders the preview so a
 * collision shows up on re-roll rather than only at save. */
function derivedRow(draft: DerivedDraft, onChange: () => void): HTMLElement {
  const nameInput = el('input', { class: 'input', type: 'text', value: draft.name }) as HTMLInputElement;
  const formulaInput = el('input', { class: 'input mono', type: 'text', value: draft.formula }) as HTMLInputElement;
  const errorInput = el('input', { class: 'input', type: 'text', value: draft.errorModel }) as HTMLInputElement;

  nameInput.addEventListener('input', () => { draft.name = nameInput.value.trim(); onChange(); });
  formulaInput.addEventListener('input', () => { draft.formula = formulaInput.value; onChange(); });
  errorInput.addEventListener('input', () => { draft.errorModel = errorInput.value.trim(); onChange(); });

  return el('div', { class: 'derived-values__row' }, nameInput, formulaInput, errorInput);
}

/** The whole table plus its header. Mirrors the slot table above it. */
function derivedValuesTable(drafts: DerivedDraft[], onChange: () => void): HTMLElement {
  return el(
    'div',
    { class: 'derived-values' },
    el('h2', { class: 'form-field__label', text: 'Derived Values' }),
    el('p', {
      class: 'form-field__help',
      text: 'The correct answer and every distractor are computed from the slots above. Each distractor should name the specific mistake it represents.',
    }),
    el(
      'div',
      { class: 'derived-values__head' },
      el('span', { text: 'Name' }),
      el('span', { text: 'Formula' }),
      el('span', { text: 'Represents this mistake' }),
    ),
    ...drafts.map((draft) => derivedRow(draft, onChange)),
  );
}

/** Green when the server returned a proof, red with the reason when it did
 * not. Absent proof is the gate's refusal condition, so this is the single
 * signal that tells an instructor whether students can see this question. */
function verificationBanner(result: { verification?: unknown; verificationError?: string }): HTMLElement {
  if (result.verificationError) {
    return el(
      'div',
      { class: 'verification-banner verification-banner--fail' },
      el('strong', { text: 'Not verified — this question will not be served. ' }),
      el('span', { text: result.verificationError }),
    );
  }
  return el('div', { class: 'verification-banner verification-banner--ok' }, 'Verified across 100 sample draws.');
}
```

Wire `verificationBanner` to render from the `patchQuestionParams` response, and
send `derivedValues: drafts` in that call.

- [x] **Step 6: Style the table**

Append to `client/public/styles/main.css`:

```css
/* Create/edit derived values on the parameterization panel. Three-up grid
   matching .exam-template-fields' conventions, collapsing on narrow screens. */
.derived-values {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.derived-values__head,
.derived-values__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 2fr);
  gap: 0.6rem;
  align-items: center;
}

.derived-values__head {
  font-size: 0.85rem;
  font-weight: 650;
  color: var(--muted);
}

.verification-banner {
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-size: 0.9rem;
}

.verification-banner--ok {
  background: var(--surface-2);
  color: var(--text);
}

.verification-banner--fail {
  background: var(--surface-2);
  color: var(--danger);
  border-color: var(--danger);
}

@media (max-width: 640px) {
  .derived-values__head {
    display: none;
  }

  .derived-values__row {
    grid-template-columns: 1fr;
  }
}
```

> **Note for the implementer:** `--danger`, `--muted`, `--surface-2`, `--border`
> and `--radius-sm` are used above because the file already defines them. Grep
> `:root` in `main.css` first and substitute the real token names if any differ.
> Do not introduce new colour tokens.

- [x] **Step 7: Write the e2e spec**

Create `tests/e2e/numeric-parameterization.spec.ts`. Follow
`instructor-pipeline.spec.ts`'s harness conventions — global-setup's real SAML
session, HTTP routes for anything that has one, and a `beforeAll` that seeds a
throwaway course so the `faculty` user holds an `instructor` courseRole before
the first page load.

```ts
import { test, expect } from '@playwright/test';
import { AUTH_FILE } from './global-setup';

test.describe('numeric parameterization', () => {
  test.use({ storageState: AUTH_FILE });

  test('an unverified numerical question is never served, and a verified one is', async ({ page }) => {
    // Seed a numerical question with a DELIBERATELY broken range (RATE can
    // reach 0 while the formula divides by it), approve it, and confirm the
    // gate keeps it out of practice.
    await test.step('a broken question fails verification', async () => {
      await page.goto('/#/instructor/courses');
      // …navigate to the question's parameterization panel…
      await page.locator('#derived-formula-PV').fill('100/RATE');
      await page.locator('#slot-RATE-min').fill('0');
      await page.getByRole('button', { name: 'Save Parameterization' }).click();
      await expect(page.locator('.verification-banner--fail')).toContainText('division by zero');
    });

    await test.step('fixing the range verifies it', async () => {
      await page.locator('#slot-RATE-min').fill('0.03');
      await page.getByRole('button', { name: 'Save Parameterization' }).click();
      await expect(page.locator('.verification-banner--ok')).toBeVisible();
    });

    await test.step('the served question is internally consistent', async () => {
      // Practice the LO and assert the displayed options are four distinct
      // currency values — the property verification proves across 100 draws.
      const optionTexts = await page.locator('.option-button__text').allTextContents();
      const numbers = optionTexts.map((text) => Number(text.replace(/[^0-9.]/g, '')));
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(numbers.every((n) => Number.isFinite(n))).toBe(true);
    });
  });
});
```

> **Note for the implementer:** the selectors above (`#derived-formula-PV`,
> `#slot-RATE-min`, `.option-button__text`) must be created in Step 5 or read
> off the existing markup. Add the ids in Step 5 rather than reaching for
> brittle nth-child selectors here.

- [x] **Step 8: Full verification and commit**

Run: `npm run typecheck && npx eslint client/src/views/instructor/param-config.ts client/src/api.ts server/src/routes/questions.routes.ts tests/unit/question-params-routes.test.ts && npx jest && npx playwright test tests/e2e/numeric-parameterization.spec.ts`
Expected: all green

```bash
git add client/src/api.ts client/src/views/instructor/param-config.ts client/public/styles/main.css server/src/routes/questions.routes.ts tests/unit/question-params-routes.test.ts tests/e2e/numeric-parameterization.spec.ts
git commit -m "feat(numerics): instructor derived-value editor with live verification"
```

---

## Final verification

- [x] `npm run typecheck` — server and client clean.
- [x] `npx eslint .` — clean.
- [x] `npx jest` — full suite green (873 at branch point, plus roughly 45 added here).
- [x] `npx playwright test` — no NEW failures. Three are pre-existing on `main`: `app.spec.ts:9`, `walking-skeleton.spec.ts:13` (both the intentional `ADMIN_CWL_ALLOWLIST` admin shell), and `classes.spec.ts:69` (undiagnosed). See `../STATUS.md`.
- [ ] **Manual:** generate a numerical question for a real LO. Confirm it arrives with `paramSlots` and `derivedValues`, that the reviewer's reasoning discusses modelling rather than arithmetic, and that its computed answer is correct.
- [ ] **Manual:** confirm an unverified numerical question is visible in the bank and review queue but is never served in practice, retry, or an exam.
- [ ] **Manual:** re-run the two reported failures end to end — the two-period PV stream and the three-payment compounding stream — and confirm the served answers are 462.59 and 1560.80.

## Out of scope

- Migrating existing numerical questions. Saurav confirmed no migration is needed (2026-08-05); the dev database holds 0 parameterized versions.
- Course-level formula libraries. Deferred; `derivedValues` stays shaped so a course-scoped library can resolve into it later without a migration.
- Numeric free-entry answers. Questions stay MCQ — `OptionRole` is load-bearing for the Strategy A retry gate and `windowRoles` mastery analytics.
- Authoring UI for Tier 3 `generateScript`. It remains developer-authored.
