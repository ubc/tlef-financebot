# Numerical Question Correctness — Design

**Owner:** Saurav
**Created:** 2026-08-05
**Status:** Design approved; implementation plan not yet written.
**Traces to:** PRD §2 (parameterized questions, IN-Q09), IN-Q05 (reviewer
decision), ST-P03/ST-R04 (per-attempt value stability).

## Problem

Generated numerical questions state arithmetically wrong answers, and the
reviewer agent passes them. From user testing (2026-08-05):

> A stream of cash flows pays $200 at Period 1 and $300 at Period 2. The
> effective interest rate per period is 5%.
> **Generated:** `PV = 200/(1.05)^1 + 300/(1.05)^2 = 190.48 + 280.48 = 470.96`
> **Correct:**   `PV = 200/(1.05)^1 + 300/(1.05)^2 = 190.48 + 272.11 = 462.59`

and

> **Generated:** `$500(1.04)^2 + $500(1.04) + $500 = $1,622.40`
> **Correct:**   `$500(1.04)^2 + $500(1.04) + $500 = $1,560.80`

Both were marked **PASS** by the reviewer agent. The tester reported the same
defect in *every* numerical question they checked, and regenerating produced
another wrong answer.

### Root cause

`generation.service.ts`'s `REVIEWER_PROMPT` already carries criterion 2,
"Calculation correctness — any numbers/formulas check out." It passed both
questions anyway. **Asking an LLM to check arithmetic by reading it uses the
same unreliable arithmetic that produced the error.** This is not a prompt
tuning problem. The numbers must be *computed*, not *judged*.

### What already exists

Substantial machinery is in place and unconnected:

- `ParamSlot` (`domain.ts:196`) — `{ name, min, max, step, values }`.
- `params.service.ts` — seeded draws (mulberry32), `substituteParams` for
  `{{name}}` in stem, option text, **and** explanations; `findUnusedParamSlots`.
- `components/param-worker/` — a hardened `vm.createContext()` sandbox running
  instructor `generate()` scripts, with timeout and memory caps (four
  documented rounds of escape fixes in its AGENTS.md).
- `client/src/views/instructor/param-config.ts` (310 lines) — slot rows linked
  to `{{placeholders}}` detected in the stem, plus a sample-draw preview.

What is missing: the generator never emits any of it, nothing computes the
*answer*, and nothing prevents an unverified numerical question from reaching a
student. As of 2026-08-05 the dev database holds 18 questions, **0 with
`paramSlots`, 0 with `generateScript`**.

## Goals

1. A student never sees a number that a machine did not compute.
2. Numerical questions are parameterized: each student draws their own values.
3. Instructors can read, edit, and range-bound the formulas, in notation that
   looks like the math on their slides.
4. The system works for **any** finance course, not a fixed formula catalogue.

## Non-goals

- Migrating existing numerical questions. There are effectively none, and
  Saurav confirmed no migration path is needed (2026-08-05).
- Numeric free-entry answers. Questions stay MCQ; `OptionRole` is load-bearing
  for the Strategy A retry gate and `windowRoles` mastery analytics.
- A course-level formula library. Deferred, but the data model must not
  preclude it (see Future work).
- Guaranteeing the formula *models* the question. See Division of labor.

## Division of labor

Executing a formula guarantees the **arithmetic** is right. It never
guarantees the **model** is right — if a two-period annuity is written as a
perpetuity, the evaluator computes that wrong model flawlessly.

- **Machine owns arithmetic.** Deterministic, provable, tested.
- **Human and LLM own modelling.** "Does this formula answer the question the
  stem asks?"

This is a far smaller and more reliable human task than "recheck this LLM's
mental arithmetic," which is precisely what failed in testing.

## Data model

Three additions to `QuestionVersion`. `ParamSlot` is unchanged.

```ts
/** A value COMPUTED from slots, not drawn. The correct answer and every
 *  distractor are derived values. */
export interface DerivedValue {
  name: string;         // referenced as {{PV}} in stem/option/explanation
  formula: string;      // "CF1/(1+RATE)^1 + CF2/(1+RATE)^2"
  errorModel?: string;  // "discounted both cash flows one period" — distractors
}

interface QuestionVersion {
  // …existing…
  numericKind?: 'numeric' | 'conceptual';   // generator's declaration
  derivedValues?: DerivedValue[];
  verification?: {
    evaluatorVersion: number;   // bump invalidates every stored proof at once
    sampleSeeds: number[];      // the seeds actually exercised
    verifiedAt: Date;
  };
}
```

`verification` is the gate's currency: **present means machine-proven, absent
means never serves.** It is cleared automatically on any edit to `stem`,
`options`, `paramSlots`, or `derivedValues` — a stale proof is worse than none.

Options need no schema change. `substituteParams` already covers option text
and explanations, so a distractor is simply `text: "\\${{PV_err2}}"`.

## Formula language

### Tiers

All three ship in v1. The gate is identical across tiers — the tier changes
*who authors* the formula, never whether it is proven.

| Tier | Capability | Authored by |
|---|---|---|
| 1 | Arithmetic, variables, function library | Generator, by default |
| 2 | `SUM` over a bounded index | Generator or instructor |
| 3 | `generateScript` (existing sandbox) | Developer, for true outliers |

### Tier 1 — arithmetic and functions

Operators: `+ - * / ^`, unary minus, parentheses. Variables resolve from drawn
slots and previously-defined derived values.

**The built-ins are shorthand, not the allowed formula set.** Arbitrary
closed-form finance is expressible without any library entry:

| From a slide | Written as |
|---|---|
| CAPM | `RF + BETA*(MRP)` |
| WACC | `E/V*RE + D/V*RD*(1-TAX)` |
| Gordon growth | `D1/(R-G)` |
| Bond price | `C*(1-(1+Y)^(-N))/Y + F/(1+Y)^N` |
| Effective annual rate | `(1+R/M)^M - 1` |

This is what makes the system work for any finance course: the generator
transcribes the formula *from the slide* into an expression. Nothing needs to
be enumerated in advance.

Library: `PV`, `FV`, `PMT`, `NPV`, `IRR`, `ln`, `exp`, `sqrt`, `abs`, `min`,
`max`, `round`, `N` (cumulative normal, for Black-Scholes and continuous
compounding).

### Tier 2 — `SUM`

The one genuine gap in Tier 1 is summation over a variable number of periods:
Macaulay duration, convexity, amortization schedules, arbitrary-length cash
flow streams.

```
SUM(t, 1, N, t * CF/(1+Y)^t)
```

A bounded index evaluated by the same deterministic evaluator. **Iteration cap:
1000 terms per `SUM`, 10000 total across all `SUM`s in one formula** — enough
for any realistic amortization schedule, low enough that a drawn `N` cannot
hang a serve. Exceeding either cap is a verification failure, reported against
the slot whose range allows it.

### Tier 3 — escape hatch

`generateScript` already exists in the schema with a hardened sandbox. Retained
for formulas no expression can reach. Not the normal path, and not
instructor-facing — a finance instructor will not debug JavaScript.

### Modules

Five pure modules under `server/src/components/formula/`, mirroring how
`params.service.ts` stays DB-free and node-testable:

| Module | Responsibility |
|---|---|
| `tokenizer.ts` | string → tokens |
| `parser.ts` | tokens → AST (shunting-yard) |
| `evaluate.ts` | AST + vars → number |
| `builtins.ts` | the function library |
| `index.ts` | `parseFormula`, `evaluateFormula`, `formulaErrors` |

No `eval`, no `Function`, no worker on this path. A parsed AST over a closed
operation set cannot escape anything, so `param-worker` stays reserved for
Tier 3.

## Determinism guarantees

Normative rules, not implementation notes. The randomness is confined to the
draw: `drawSeed()` produces a per-serve seed, `seededRandom()` turns it into
slot values, and everything downstream is a pure function of those values.

**R1 — `^` with an integer exponent is exponentiation by squaring, never
`Math.pow`.** IEEE 754 exactly specifies `+ − * /` and `sqrt`, so repeated
multiplication is bit-stable across platforms and Node versions. ECMA-262
leaves `Math.pow`, `Math.exp` and `Math.log` implementation-approximated, so
they may drift in the last bit. Fractional exponents and `ln`/`exp` fall back
to the approximated builtins and accept ~15th-significant-digit variance, far
below the rounding boundary.

**R2 — `IRR` carries a pinned convergence contract.** Initial guess `0.1`,
iteration cap `100`, tolerance `1e-9`, bisection fallback bounded to
`[-0.9999, 10]`, and a deterministic failure when it does not converge. All
five are constants in `builtins.ts`, not tunables — changing any of them
changes stored answers and therefore requires an `evaluatorVersion` bump.
Non-convergence is a verification failure, never a silent `NaN`.

**R3 — Round once, at the end, never in the middle.** All evaluation runs at
full double precision; rounding happens only at display, in one place, applied
by the renderer and not the evaluator. **A distractor computed from an
already-rounded intermediate reproduces exactly the `190.48 + 272.11` class of
error this work exists to eliminate.**

**R4 — Verification is a stored proof, re-checked at serve time.** Authoring
computes across sample seeds and records `verification`; serving recomputes and
asserts agreement. Any drift — a bad edit, an evaluator change, a Node upgrade
shifting `Math.pow` — surfaces as a hard failure instead of a wrong number
reaching a student. `evaluatorVersion` invalidates every stored proof at once.

## Verification

### When it runs

Verification is triggered in exactly two places, and nowhere else:

1. **At the end of a generation run**, on every numerical question produced.
   An unverifiable generated question lands in review already carrying its
   failure reason.
2. **On save of `paramSlots` or `derivedValues`** via the existing
   `PATCH /api/questions/:questionId/params`.

Any edit to `stem`, `options`, `paramSlots`, or `derivedValues` clears
`verification` first; a save that fails verification therefore leaves the
question non-servable rather than retaining a stale proof.

### What it checks

Verifying a single draw proves almost nothing. Verification samples **100 draws
across the declared ranges** (deterministic seeds, so a re-run reproduces the
same failure), and **every** draw must satisfy:

- **Every derived value is finite.** Catches `RATE` reaching 0 and dividing by
  zero at the edge of a range an instructor typed.
- **All option values are distinct.** A distractor colliding with the correct
  answer at *some* draws yields an unanswerable question that a single-seed
  check sails past.
- **Every value satisfies `abs(v) <= 1e12`.** Catches a runaway exponent
  before it reaches a student as `1.7e308` or `Infinity`.
- **`SUM` stays within its iteration caps** (Tier 2).

A failure is reported against the specific slot or formula, naming the seed
that produced it — which is what the Min/Max columns in the instructor UI are
for.

## The gate

```
isNumeric(v) = v.numericKind === 'numeric' || detectNumeric(v.stem, v.options)
servable(v)  = !isNumeric(v) || v.verification != null
```

`detectNumeric` is a pure heuristic over stem and option text — currency
markers, digit groups, arithmetic operators. Detection is deliberately
two-signal: the generator's declaration alone would let a mistagged question
through, and **a static question full of LLM-written wrong numbers has no
`paramSlots`, so a structural test would read it as "not numerical" and pass it
straight through — the exact reported bug.**

An instructor override sets `numericKind: 'conceptual'` and persists. Serving
refuses a non-servable version with a specific reason; the question stays
visible in the bank and review queue so it can be fixed rather than vanishing.

Fail-closed, and **observable**: counting gate refusals reveals which formulas
real courses need, which tells us what to add to the library instead of
guessing now.

## Generation pipeline

The generator stops writing numbers. It emits `paramSlots` + `derivedValues` +
options referencing `{{…}}`, and declares `numericKind`.

Reviewer prompt changes:

- **Delete criterion 2** ("Calculation correctness"). It is the criterion that
  passed both broken questions; keeping it invites false confidence in a
  judgment the machine now owns.
- **Keep criteria 1, 3, 4, 5, 6** — factual accuracy, LO alignment, distractor
  quality, clarity, difficulty calibration. LLM judgment is appropriate there.
- **Add:** does the formula model the question the stem asks? (See Division of
  labor.)

## Instructor UI

`param-config.ts` gains a Derived Values table beside the existing slot rows:

- Inline formula editing with live parse errors.
- Formulas rendered through KaTeX, already shipped.
- Preview showing **all option values per re-roll**, so collisions are visible
  by eye.
- Verification status and, on failure, the specific seed and slot at fault.

## Error handling

| Failure | Behaviour |
|---|---|
| Parse error | Inline in the editor; `verification` withheld |
| Non-finite at some seed | Verification fails, naming the seed and slot |
| Option collision | Verification fails, naming the colliding pair |
| `IRR` non-convergence | Verification fails (R2) |
| `SUM` iteration cap exceeded | Verification fails |
| Serve-time drift vs stored proof | Hard failure; question pulled; alert raised |

## Testing

Unit tests under the existing node environment (the pattern
`duplicate-name.test.ts` uses):

- Tokenizer, parser, evaluator.
- Each built-in against known finance values.
- **Both reported bugs as regression fixtures** — `462.59` and `1560.80`
  become assertions.
- R1: integer `^` is exponentiation by squaring, verified against exact
  expected values.
- R2: `IRR` convergence and deterministic non-convergence.
- R3: a distractor derived from a rounded intermediate is caught.
- Property test over 1000 seeds — deliberately wider than verification's 100,
  so the test suite catches range defects the gate's sample could miss.
- Gate: `detectNumeric` on static numeric questions with no `paramSlots`.
- `verification` is cleared by an edit to each of `stem`, `options`,
  `paramSlots`, `derivedValues`.

One e2e: instructor configures a formula, previews, approves; student is served
and sees internally consistent numbers.

## Suggested implementation order

This spec is one coherent feature but a large one. A natural decomposition,
each step independently testable and shippable:

1. **Formula evaluator** (`components/formula/`) — pure, no callers yet. Both
   reported bugs land here as regression tests. Largest single piece, and
   everything else depends on it.
2. **Verification service** — multi-seed sampling, the four checks, and the
   `verification` field.
3. **The gate** — `detectNumeric`, `servable()`, serving refusal with reason.
   *After this step the reported bug is structurally impossible*, even before
   the generator emits a single formula: unverified numerical questions simply
   stop reaching students.
4. **Generation pipeline** — emit slots and formulas, reviewer prompt changes.
5. **Instructor UI** — the Derived Values table in `param-config.ts`.

Steps 1–3 are the correctness fix; 4–5 make it usable at scale. If the Aug 24
content week forces a cut, 1–3 alone leave the product safe but with fewer
servable numerical questions, which is the correct failure direction.

## Future work

- **Course-level formula library.** Named formulas defined once per course and
  reused across questions, verified once instead of retyped (and mistyped) per
  question. The cleanest answer to "any finance course" — each course
  accumulates its own vocabulary. Deferred from v1 as real scope against the
  Aug 24 content week; `derivedValues` must stay shaped so a course-scoped
  library can resolve into it without a migration.
- **Library expansion driven by gate telemetry**, not speculation.
