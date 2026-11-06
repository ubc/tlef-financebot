# Six retained cases: authorized review result

The user approved the exact six-context review-only declaration. R8 archived
current code while retaining the approved R7 candidates, original source/Bank/
teacher payloads, all ten initial prompt shapes, model settings, limits and
eleven historical ledgers. No batch was regenerated or written to the database.
The phase is complete; unused allowance is not a new execution permission.

## Observed result

OpenAI `gpt-6-luna`, reasoning `none`, temperature 0 returned twelve calls in
74.114 seconds: ten initial reviews plus the existing P04 and TF response
corrections. Reported usage was 48,207 input + 7,635 output = **55,842 tokens**;
all twelve observations had usage. Conservative reservations consumed
250,172/320,000 units with no pending sends, below the 16-send ceiling. A separate
wire boundary also observed twelve OpenAI POST attempts and denied unrelated
sockets/database/queue work. Provider-internal execution remains outside this
visibility. Budget units are not billed tokens or a currency estimate.

Only P02 was eligible. Five quality responses validated; TF exhausted the
existing response correction and retained an uncertain fallback. **Zero questions
were saved or adopted.** This is not a 1/6 generation-yield result, nor a model
ranking or a held-out accuracy estimate. The six selected examples include
known failures, request mismatches and positive controls from different prior
observations.

| Case | Actual result and implication |
| --- | --- |
| P01 | Withheld for requested-operation coverage, while its literal-answer check still passed a mitigation/elimination ambiguity. Withholding did not prove the ambiguity was detected. |
| P02 | Eligible positive control: the two diversification mechanisms remain supported. |
| P03 | All 16 finite arithmetic draws pass, but the candidate is Medium against an Easy request. The review also contradicts itself about achieved demand. This is not established as a false refusal of a compliant candidate. |
| P04 | One missing solution citation was repaired within the existing correction. The Hard/Easy mismatch withholds the candidate, but the literal-answer check still infers an unjustified exclusion from a non-exclusive source table. |
| CAPM | Decimal inputs now satisfy the demand check and all 27 arithmetic combinations pass. The answerability review still requires a wrong halving rule to be taught, and content review misinterprets unresolved template placeholders despite receiving formulas and deterministic verification. Those are separate reviewer false holds. |
| TF | Both quality responses output JSON boolean `true` where the schema requires a string enum. Role/content review correctly distinguishes a wrong False selection from truthful corrective feedback. The raw correction also changes exact teacher requirement rows and omits a solution citation; a type fix alone cannot guarantee recovery. |

Independent input expectations were frozen before prospective outputs were
inspected. These are reasoned source inspections, not professor acceptance
labels. Their comparison and all exact input/output/usage links are retained in
the HTML book. P01/P04 ambiguity interpretation remains qualified by the source
table's layout, but no unique-answer success can be claimed from these reviews.

## A concrete offline repair after the paid phase

The T/F model-facing examples used `stemTruth:true|false|undetermined`; the Zod
contract requires `"true"|"false"|"undetermined"`. The compact and full review
headers and shared instruction now explicitly require quoted JSON strings. The
existing same-candidate correction explains the exact type error while requiring
the truth verdict, key and evidence to remain unchanged.

The parser is still strict: neither original paid boolean response is silently
coerced or reclassified. Both original JSON bodies and their transcript hashes
are retained in a self-contained test fixture. A string-only copy passes the
answerability schema; this does not validate its whole quality response or
remaining teacher/citation judgments. The instruction regression fails before
the fix (31/32) and the related regression passes 10 suites/329 tests afterward,
with project typecheck, scoped lint and independent diff/provenance inspection.
Initial test preparation used the wrong compact-selector property; that is
recorded and corrected before the green run. No model call followed this fix.

## Next changes, without weakening the gates

1. Fix ordinary completed-result synthesis replay separately from the narrow
   failed-parent correction. Reproduce the real worker-shaped metadata delta.
2. Make literal-answer review confront the strongest alternative and actual
   counter-evidence. A source quote or a table location cannot itself prove
   entailment, exclusion or unique correctness. Keep this generic and test the
   selected tuning cases separately from unseen examples.
3. Separate source grounding, verified numerical template arithmetic and teacher
   request alignment. Give the semantic reviewer the actual verified display
   sample and proof scope, while retaining source checks on setup/conditions and
   independent numerical collision checks. A deterministic arithmetic proof
   cannot waive an unsupported premise or a difficulty mismatch.
4. Judge a question's declared planned operation, rather than requiring every
   question to exhaust its entire LO. Preserve explicit teacher clauses and
   compare achieved reasoning with the requested difficulty consistently.
5. Integrate the dedicated source-preserving outline child and full-cost
   preflight. The current pure core and authenticated parent reader are a
   foundation; source-only observations cannot be reused as fresh semantic
   approval. Any source-review reuse needs its own exact authority contract.

These items remain open. Additional model execution needs a concrete bounded
declaration; this completed phase must not be restarted to consume leftover
allowance. The broader generation-quality, multi-file pedagogical coverage,
regeneration memory and model-comparison goal remains active.

Evidence: `audit-results/quality-lab-source-interpretation-2026-10-17-preflight-r8/`
and `...-live-r8/`,
`audit-results/quality-lab-source-interpretation-independent-2026-10-17/`, and
`audit-results/source-interpretation-tf-enum-2026-10-17/`. Earlier rejected,
failed and superseded declarations remain unchanged.
