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
- **R3:** The evaluator NEVER rounds. Rounding happens once, at display, in
  `params.service.ts`'s `formatParamValue`.
- **R4:** Bump `EVALUATOR_VERSION` in `index.ts` whenever arithmetic changes —
  the `intPow` algorithm, an IRR constant, a builtin's formula, or the SUM
  caps. It invalidates every stored verification proof at once.

## Import direction (no cycles)

`pow.ts` is a leaf. `builtins.ts` imports `pow.ts`. `evaluate.ts` imports
both. `index.ts` re-exports. `intPow` lives in its own module precisely
because both `evaluate.ts` and `builtins.ts` need it — putting it in either
would make them mutually dependent.

## The built-ins are shorthand, not the allowed formula set

Arbitrary closed-form finance is expressible with arithmetic alone: CAPM is
`RF + BETA*MRP`, Gordon growth is `D1/(R-G)`, a bond price is
`C*(1-(1+Y)^(-N))/Y + F/(1+Y)^N`. This is what lets the system work for any
finance course rather than a fixed catalogue — the generator transcribes the
formula from the slide. `SUM(index, from, to, body)` covers the series cases
(duration, convexity, amortization) that no fixed expression can reach.

## No sandbox needed

A parsed AST over a closed operation set cannot reach the host. There is no
`eval`, no `Function`, no worker on this path. `components/param-worker` stays
reserved for legacy `generateScript` (Tier 3).
