# Question Generation Correctness — Design

Date: 2026-11-12
Status: approved direction (developer, 2026-11-12); ready for a task checklist
Supersedes, for the cases below only: the "exactly two model calls, nothing
retries" rule of `2026-11-06-question-generation-pipeline-simplification-design.md`.

## Why

A Sol trial on the COMM 298 "Market Efficiency" slides (2026-11-12, course
`COMM 298 Market Efficiency trial`) produced 8 questions: 5 pass, 2 flag,
1 reject. The reject (Q8, a parameterized calculation) is the pattern this
spec targets:

- Two distractor formulas could display the same value. `NO_INFORMATION_REWARD`
  was always 0; `STALE_PRICE_DIFFERENCE` was 0 whenever two independently drawn
  price changes were equal (both ranges contain 15).
- A derived value never varied: `PUBLIC_PROFIT = SHARES*(PUBLIC_VALUE-PUBLIC_VALUE)`
  is identically 0, which made the intended calculation trivial.

The generator prompt already has long rules against exactly these mistakes
("give the slots DISJOINT, WELL-SEPARATED ranges", the identically-zero
example). The model still made them. Numeric verification caught the collision
(it checks every combination of a small grid), and the question was saved as a
reject the instructor must discard by hand. At whole-course scale (spec 3) a
~1-in-8 waste rate is hundreds of wasted generations.

Goal: the pipeline should, by itself, produce questions whose answer key and
options are correct, instead of only detecting when they are not.

## Principle

Let code decide what code can decide; give the model one targeted chance to fix
what only it can fix; measure the effect.

1. **Parameter values are chosen by code** (free, deterministic).
2. **One repair call** with the exact findings, only when a question fails a
   deterministic check that code cannot fix, or the checker rejects it.
3. **A fixed evaluation set** so every change shows its effect on pass rate,
   waste, tokens and time.

## 1. Parameter value solver

Today: the generator writes `paramSlots` as `min/max/step` (or `values`);
`verifyQuestionNumerics` samples 100 seeds and, when the grid has ≤256
combinations, checks every combination, failing on the first bad one.

New: before verification, `solveParameterDomain(paramSlots, derivedValues,
optionValueNames, optionCurrency)` (new pure module
`server/src/services/question-generation/parameter-solver.ts`):

- Enumerates the full grid when it has ≤ `SOLVER_MAX_COMBINATIONS` (4096)
  combinations. Larger grids, and `generateScript` questions, skip the solver
  and keep today's behaviour.
- Evaluates every combination with the existing resolver and the existing
  per-draw check (`numericDrawFailure`: finite, in band, options distinct at
  display precision, input display).
- If some combinations fail, removes slot values greedily: repeatedly drop the
  single slot value that appears in the most failing combinations (ties: the
  value at the edge of its range, then the larger value), turning that slot
  into an explicit `values` list. Stops when no combination fails.
- Accepts the result only if every slot keeps ≥ 2 values and ≥ 8 combinations
  remain (`SOLVER_MIN_COMBINATIONS`); otherwise reports `unsolvable` with the
  remaining failure.
- Reports **constant derived values**: a derived value that references at
  least one slot but has the same display value in every combination of the
  full grid (Q8's `PUBLIC_PROFIT`). A constant *option* value, or a constant
  value the correct answer depends on, is a finding (`constant-derived-value`);
  constant helper values the options do not depend on are ignored.

The solved `paramSlots` replace the generator's before
`verifyGeneratedNumerics`, so the stored question, its exhaustive verification
and serving all use the pruned value sets. The report is stored on the version
as `verification.parameterSolver = { removed: [{ slot, values }], checkedCombinations }`
and shown in the reader's AI-check section ("Adjusted parameter values: removed
PUBLIC_OLD 80"). An instructor editing the question later edits the explicit
`values`.

For Q8 every failing combination has an early price change of 15 and a public
price change of 15, so removing one value that makes either change 15 (for
example `PUBLIC_OLD = 80`, leaving public changes of 5 and 10) removes the
collision with 120 combinations left. The constant `PUBLIC_PROFIT` remains a
finding and goes to the repair call.

## 2. One repair call

`generateAndCheck` gains a single repair pass:

- **Triggers** (any): numeric verification still fails after the solver; a
  `constant-derived-value` finding; `inspectCandidate` marks the candidate
  unstorable (malformed options); the checker's decision is `reject`.
  `flag` does **not** trigger repair (the trial's flags were label quibbles; the
  instructor decides).
- **Call**: the generator, with the existing `RegenerateContext` (the
  "REWRITE TASK" block): the original question, the checker verdict, and the
  exact deterministic findings, plus the instruction "Fix only the listed
  problems; keep the scenario, learning objective and difficulty." Same model,
  usage stage `repair`. Then the normal solver → inspection → checker on the
  repaired candidate (usage stage `check`, item unchanged).
- **At most one repair per question.** If the repaired candidate is better
  (ordering: storable > not; numerics ok > failed; pass > flag > reject), it is
  saved; otherwise the original is saved. Either way the question is saved as a
  Draft exactly as today, with its verdict.
- **Provenance**: `agentDecision.repair = { attempted: true, trigger, adopted:
  boolean, originalDecision, originalFindings }` so the reader can show "Repaired
  automatically: two options showed the same value" and analytics can count it.
- **Cost bound**: a question costs 2 calls (unchanged) or 4 calls when repaired
  (repair + recheck). With the trial's 1-in-8 trigger rate, ~+25% calls on
  average, all of it spent on questions that would otherwise be thrown away.
- The run's live preview shows a "Fixing: …" line while the repair streams;
  the plan card counts repairs.
- A course-level kill switch is not added; the platform feature flag
  `generationRepair` (default on) disables the repair pass entirely.

Why this differs from the retry chains removed on 2026-11-06: those re-ran the
whole chain on unspecific signals with no visible effect. This pass runs once,
only on a deterministic failure or a reject, sends the precise failure, keeps
the better candidate, and is measured (section 3).

## 3. Evaluation set

`scripts/generation-eval.ts` (local only, real model calls, run on demand):

- Inputs: a fixed set of course fixtures — the Market Efficiency trial course
  and one calculation-heavy deck (NPV/bonds) chosen by the developer — and a
  fixed plan (e.g. 2 questions × each LO × {easy, medium, hard}).
- Output (JSON + a short table under `artifacts/generation-eval-<date>/`): per
  question verdict, solver adjustments, repair trigger/adoption, final numerics
  status, tokens per stage, seconds per call; totals for pass/flag/reject,
  waste rate (reject or numerics failure after repair), repairs adopted, tokens
  and time per saved question.
- Used before/after this change and for later prompt or model changes.

## Tests

- `parameter-solver.test.ts`: Q8 fixture (collision pruned, constant flagged);
  BETA-can-draw-1 fixture (value 1.0 removed); unsolvable fixture (fewer than 8
  combinations left); grid above the limit skipped; helper-only constant ignored;
  display-precision collision (7.3591 vs 7.3644) pruned.
- `question-generation-pipeline.test.ts` (scripted model responses): no repair on
  pass/flag; repair on reject; repair on solver-unsolvable numerics; repaired
  candidate adopted only when better; usage stages `generation`, `check`,
  `repair`; flag off → no repair; at most one repair.
- `candidate.test.ts`: solved slots flow into `verifyGeneratedNumerics` and the
  stored verification report.
- Reader: shows solver adjustments and repair provenance (client unit or mocked e2e).

## Out of scope

- Repairing `flag` verdicts or changing the checker model.
- Lowering Sol reasoning effort or generating a run's items in parallel (speed,
  not correctness; revisit with the evaluation set).
- One-click whole-course generation (spec 3, next).
