# Bounded finite-domain numerical verification

The validator now checks every declared slot-entry combination when the full
Cartesian domain contains at most 256 entries. It retains the existing 100
deterministic sample checks and the per-served-draw checks. This closes one
reproducible arithmetic admission gap; it does not establish source fidelity,
pedagogical answerability, teacher acceptance or improved saved-question yield.

## Reproduced before changing verification

The exact synthetic input is retained in
`audit-results/numeric-finite-domain-2026-10-17/input.json`. It has X from 1 to 15,
Y from 1 to 9, correct value `X+100` and distractor
`ANSWER+(X-1)^2+(Y-2)^2`.

The unmodified verifier accepted this question. Its 100 fixed seeds visited only
70 of the 135 Cartesian entries and never selected X=1, Y=2. At that tuple both
options display 101. This is a validator counterexample, not a generated finance
question or a source-based model comparison. The actual old result, sample
tuples, source hashes and failing regression are retained as
`before-counterexample.json`, `before-manifest.json` and `regression-before.*`.

The first audit read source hashes after importing while a parallel agent was
refactoring the parameter helper; its parameter-file hash differs from the
retained pre-edit archive. This discrepancy remains visible. The additive
`before-reconstruction/results.json` instead captures all 12 executed TypeScript
source bytes before compilation, using the exact archived old parameter and
verification files. It reproduces the accepted result and all 100 original
draws with the same input. Neither record is silently replaced.

The new verifier refuses the unchanged input and records the exact failing
indices `[0,1]`, slot values and displayed-value collision. A separate arithmetic
positive control adds one to the distractor and passes all 135 entries; this is
not presented as an automatic pedagogical repair or a useful new question.

## One source of drawing and arithmetic semantics

`finite-slot-domain.ts` owns the existing effective domain shape, index count and
value calculation. Seeded serving and explicit index tuples use the same code.
`resolveSlotsAndDerivedAtIndices` also shares the declaration-order formula
evaluation used by seeded serving. No rounding, decimal endpoint correction,
deduplication or arithmetic-version change is introduced.

In particular, JavaScript's current count for min=0.1, max=0.3, step=0.1 is two,
not an invented three-entry rational grid. Duplicate explicit values retain
their entry count and draw weighting. Cartesian enumeration is a conservative
superset of seeded draws; it does not assert that every tuple is reachable by
the 32-bit PRNG. No drawn slots means one constant combination.

Every checked tuple must pass the existing finite/magnitude checks, displayed
option distinctness and, when a stem is provided, displayed-input recomputation.
The first old sample failure retains its existing failing seed. A newly found
grid failure records `failingCombination` and useful parameter values in its
error rather than inventing a seed.

The bad tuple is also reachable by actual seed 90, outside the old verification
range. `serving-boundary.json` checks the retained pre-edit and current serving
functions: both already redraw to a safe seed and refuse after eight bad draws.
This phase catches the defect earlier in admission; it does not establish that
students previously received the duplicate answer or that fresh-draw safety was
missing.

## Bounded work and explicit proof scope

New successful closed-formula proofs carry additive `parameterCoverage`:

```json
{
  "version": "finite-slot-grid-v1",
  "mode": "exhaustive",
  "totalCombinations": 135,
  "checkedCombinations": 135,
  "maxCombinations": 256
}
```

An exhaustive receipt requires the entire finite grid. A product of 257 or more,
an unrepresentable count/range, or ambiguous parameter names retains sampling
with an explicit reason and zero grid checks. Overflow does not become a small
number or a partial exhaustive proof. `totalCombinations` is null when a reliable
complete product is unavailable. Existing malformed seeded defaults retain their
historical behavior; this phase does not silently rewrite their definitions.

At most 256 additional tuples are evaluated, alongside the 100 existing samples.
This is bounded extra CPU, not free execution or a whole-verification wall-clock
deadline. Existing formula operation limits still apply. The retained warm
same-process microbenchmark measures the exact safe 135-entry control; it is not
production latency or a representative distribution. No model, embedding or
database stage is added, and no token-budget ceiling is raised.
The stricter small-grid admission can withhold a template that previously
passed sampling and could serve through redraws. Existing bounded generation
retries may then spend tokens on repair. Thus zero added model stages does not
prove unchanged total cost or higher yield; those effects require real tests.
Its 31 warm measured iterations have medians of 0.553 ms before and 0.707 ms
after on this machine. The old verifier is compiled from retained source against
the shared current parameter semantics; this is a scoped local CPU observation.

## Compatibility and visibility

This is an arithmetic-validation improvement for new verification calls,
including generation, regeneration and verified variants using the shared
function. It does not alter evaluator arithmetic or bump `EVALUATOR_VERSION`.
Historical proof absence remains sampled-only, and existing already-current
proofs are not automatically re-enumerated, rewritten or relabelled exhaustive.
Large-domain and historical questions still need the unchanged fresh-draw
collision and visible-input checks.

Existing active/submitted examinations retain their frozen values and grading.
This work introduces no new formula or answer-key field in Student DTOs. The
Instructor parameter editor exposes the stronger coverage only after checking
the exact known receipt version, matching positive counts and the 256 bound;
invalid wire metadata cannot manufacture an exhaustive claim.

## Evidence and remaining work

`audit-results/numeric-finite-domain-2026-10-17/after.json` contains the unchanged
input, actual before/after validator results, separate positive control,
microbenchmark, source pins and denied external boundaries. The final integration
receipt and regression logs in that directory identify the tested scope. Focused
results overlap the integrated result and must not be added as separate passes.
The English evidence book includes inspectable inputs, outputs and screenshots.
The integrated run passes 32 suites/858 tests, with whole-project typecheck and
the ten changed production/test files' lint checks passing. This includes
generation, regeneration, imports, serving, fixed/legacy exams and historical
frozen-answer compatibility; it uses unit mocks where external services are
normally involved, not a real deployed student or paid generation workflow.

Seven additional browser cases execute the compiled production parameter panel
with every API intercepted. They cover exhaustive, sampled, historical and
hostile metadata; failed tuple saves replace the prior success banner, and
proofless saves stay neutral. Desktop/mobile banner width and scoped axe checks
pass. These screenshots demonstrate actual component rendering with synthetic
responses, not arithmetic or end-to-end server acceptance.

The current-code full-flow recheck retains the same 48 scenarios and 105
raw/admission capture pairs. All 49 fixtures and 569 protected data blocks are
checked; two CAPM candidate blocks add the new 27-entry receipt, increasing each
quality input by 144 conservative units. Its correction is 23,510/24,000. P02's
nested JSON retry remains 23,916/24,000, leaving only 84 units. No new input
refusal appears in these controls. Six historical refusals, 12 stopped scenarios
and zero synthetic saved Drafts remain. The existing unseeded P04 hardness move
changes two prompt lines and is recorded separately. This establishes measured
input fit, not useful yield, billing or semantic success. Root independently
reran the protected-block and nested-retry verifiers with identical receipts.

The wider multi-file quality goal remains incomplete. The current source audit
still finds uninterpreted visual content, including Chapter 10 physical page 10
whose native text contains only 18 non-whitespace units of footer. A mapped
neighboring formula cannot prove that table's coverage. Native text readiness is
not visual interpretation. The internal supported-LO wording repair also lacks
an Instructor HTTP/UI path and an exposed repair receipt. These are separate
product gaps; exhaustive arithmetic does not resolve them.

Fresh real-model/teacher calibration, useful saved yield and the Luna/Sol model
comparison remain unverified. Earlier prepared paid-probe declarations are
historical after these source edits. No paid call, question save, hierarchy
Apply, deployment or Canvas write occurs in this phase.
