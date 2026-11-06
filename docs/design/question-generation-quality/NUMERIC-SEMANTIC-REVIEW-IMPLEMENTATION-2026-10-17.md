# Numeric semantic review: a server-rendered example beside the original

This change adds a deterministic numerical example to the existing v2 role,
content and quality checks. It preserves the full original template and its
source, Bank and teacher context. The example helps a reviewer see what a valid
parameterized question displays; it does not approve its finance assumptions,
answerability, difficulty, novelty or instruction compliance.

This is an offline engineering checkpoint. The frozen combined regression
passes 19 suites / 719 tests, full-project typecheck and scoped 19-file lint.
Complete local prompt/correction admission measurements retain both fitting and
refused cohorts; they are not prospective model results.
No new API call, model acceptance, saved-question yield or professor-time
improvement is established. The R8 paid record remains unchanged: one eligible
quality-review outcome among six selected cases, five validated quality schemas
and one fallback, with zero saved or adopted questions. That ratio is not a
generation yield.

## The retained CAPM failure

R8's CAPM content-review request already contained parameter domains, derived
formulas and a positive displayed-input/finite-verification summary. Its raw
response nevertheless rejected the item because the original stem contained
unresolved template placeholders. The separate quality review accepted decimal
numeric demand but left the beta-halving response undetermined and objected to
wording that retained a teacher-requested beta/volatility distinction.

The recorded numerical verifier had checked all 27 explicit combinations plus
100 seeded draws. The content refusal therefore exposes a template-versus-
rendered-instance interpretation problem, rather than evidence that those
declared calculations lack inputs. A wrong arithmetic operation need not be
taught as true to be refuted by a taught formula. A distractor's financial story,
its corrective feedback and the literal stem still require source review.

The exact paid requests and raw responses are retained in the R8 private
transcripts, particularly CAPM quality call 6 and content call 8. They are never
rewritten into successful reviews by this implementation. The independent R8
comparison and chapter 15 retain the unresolved ambiguity, teacher-clause and
template interpretation findings.

## The additional representation

`generation-numeric-review.ts` exports a pure witness builder and renderer.
`generation-numeric-review.service.ts` supplies the existing trusted formula
verifier, slot resolver and serving formatter. It does not execute a generation
script, import a provider into the pure helper, or trust a candidate's stored or
model-authored verification flag.

For a supported numerical MCQ template, the builder:

1. Reads plain own data fields and validates the original stem, options, roles,
   feedback, slots and derived formulas. Accessors, ambiguous names, unsupported
   numeric types and scripts cannot supply a witness.
2. Uses the real formula parser and conservative structural work limits, then
   checks placeholder syntax, option formats, displayed inputs and the existing
   numerical verification. The fresh proof retains its actual finite-versus-
   sampled scope.
3. Draws one deterministic example at seed `1000003`, using the unchanged slot
   definitions and formulas. It renders the stem, choices and feedback through
   the production display functions and checks unresolved placeholders,
   displayed-input mismatches and option/display collisions.
4. Returns an explicit `available`, `unavailable` or `not-applicable` result.
   An available result records every drawn/derived value, the rendered options,
   a template binding and the fresh verification scope. The declared key is
   clearly labelled a candidate claim, not a source-validated answer.

The actual retained CAPM example has Riskfree rate `3%`, Beta `1.60` and Risk
Premium `6%`. Its displayed options are `7.80%`, `12.60%`, `9%` and `4.60%`, with
declared key B. The underlying JavaScript values remain exact to the evaluator's
floating-point semantics, including `12.600000000000001`; the serving formatter
displays `12.60`. The witness does not invent a financial premise or silently
replace the symbolic template with this one draw.

P03 separately renders the taught total-beta calculation. Its valid arithmetic
does not resolve the genuine fixed Easy request versus Medium candidate and
descriptor mismatch recorded in R8. A numerical witness is not a difficulty
relabel or automatic semantic recovery.

## All three checks receive the current candidate

The explicit contract is `server-rendered-numeric-review-v1`. For that contract,
the role validator, content Reviewer and independent source/Bank/teacher quality
check add the witness beside their complete original packet. Original question
JSON, full assigned source passages, memory comparisons and teacher requirements
remain in place. The quality prompt specifically requires answerability
`stemQuote` exclusions to quote the original candidate stem, never a rendered
sample. Original source spans remain teaching evidence; the sample does not
become a source citation.

The same construction is used after changed repair and evidence expansion. It
recomputes from the candidate actually being reviewed, rather than carrying a
previous candidate's example forward. Existing source, exact-Bank, retrieval,
task-demand, literal-answerability and fresh numerical serving guards retain
their independent authority.

No new model stage, independent retry allowance or output cap is added. The
extra representation consumes input space in the existing calls and their
existing correction envelopes. Its arithmetic checks also consume CPU; repeated
pure recomputation is not free or a claim of lower end-to-end latency.

The complete witness is computed privately; full sample objects remain in
test/audit artifacts. Normal database persistence adds a bounded `numericReview`
metadata receipt and the full canonical candidate in cached-stage bindings,
not a general raw-prompt/response collection. The compact model projection omits
redundant private metadata and already-present candidate claims. It references
complete original feedback by key only when the exact template binding confirms
that rendered feedback is unchanged; changed rendered feedback remains in the
fragment. Original candidate/source/Bank/teacher fields are not removed.

## Durable selection, retries and cached findings

Fresh public `grounded-memory-v2` runs persist the explicit selector in the run
input. Workers, exact snapshot retries and task plans carry that stored value.
Fresh durable v2 regeneration selects it only after checking for an existing
same-UUID request. Historical absence stays absent; old UUID recovery and exact
retry do not silently opt into the new representation. Unknown explicit
selectors and use outside the v2 policy refuse.

Each quality assessment stores a bounded server-side receipt. The available
receipt binds the original numeric template and deterministic sample, seed and
fresh verification scope; it excludes unstable timestamps and does not store a
model verdict as arithmetic authority. The full surrounding source/Bank/teacher
packet remains independently bound by the existing authoring contracts.

Cached role/content stages store both the full canonical candidate snapshot and
the receipt. Reuse requires a canonical content hash, exact candidate equality
and fresh receipt equality. This is necessary even when two unrelated candidates
produce the same short `unavailable` reason. BSON round trips do not authorize
dropping the candidate binding or accepting a changed role, feedback or slot
definition.

Repair-stage provenance records the exact pre-canonical candidate examined by
the role/content calls through `retry.numericReviewCandidate` and its
`numericReviewStage` binding. Public cached recovery stores that actual raw
checked candidate; final quality/save still canonicalizes its numerical fields.
Later numerical
canonicalization cannot retrospectively stamp those old findings as though the
reviewer saw the normalized candidate. The stored stage binding must still
match the candidate on a subsequent reuse attempt.

A same-fixture BSON control exposed this conceptual-repair cache mismatch:
29/30 checks passed before the fix and 30/30 after it. These are the same
scripted semantic fixture and real BSON serialization, not paid model responses
or a measured improvement in repair acceptance.

## Final save and adoption recheck

Public v2 save and durable regeneration adoption reconstruct the numerical
receipt from the actual canonical candidate before acceptance and inside the
existing course-authoring write fence. A cached eligible label alone cannot
replace fresh candidate and receipt replay. Source/current-memory, exact Bank,
task requirements, expected original head and final numerical checks remain.

An independent wiring review identified a selector-downgrade gap: an initially
new-contract eligible regeneration record could lose the selector during the
transactional reread, allowing an absent-selector compatibility branch to bypass
the new receipt check. The current wiring pins the initially observed selector
and requires it to equal the freshly read selector before the write. Public
task-plan rereads also require selector equality. Initially absent historical
records retain their compatibility behavior; an explicit new contract cannot
downgrade to absence during the write.

These are representation/currentness checks. They do not certify that a model
interpreted the example correctly or that a student-facing question is
pedagogically sound. Application transaction behavior and orchestration controls
must be reported at the scope actually exercised by the final receipts, rather
than inferred from pure helper tests.

## Bounded work and explicit absence

The helper limits the rendered witness to 8,000 UTF-8 bytes, at most 16 slots,
32 derived definitions, 256 explicit values per slot and 512 characters per
formula. Across the formula definitions it permits at most 256 AST nodes, depth
32 and a conservative structural work estimate of 20,000 per draw. The existing
evaluator retains its SUM/IRR limits and arithmetic semantics. These structural
bounds are not a measured wall-clock deadline.

Fresh verification retains the existing 100 sampled seeds and complete finite
grid checks when the domain has at most 256 entries. Larger domains remain
explicitly sampled. A single displayed example is never described as exhaustive
verification of every possible draw.

Unsupported, malformed, over-complex, unsafe or oversized representations carry
an explicit unavailable reason. That means there is no validated rendered
example; it creates neither a numerical proof nor a missing-premise waiver. The
existing independent numeric/source/teacher gates continue to decide whether
the original candidate can be used.

Conceptual and T/F questions without a numeric template return `not-applicable`.
The explicit new-contract receipt records that state, but no witness text is
added to those model prompts. Historical absent-selector prompts also receive
no new text. Neither case is silently reported as a numerical pass.

Complete-packet and nested-correction admission still use the existing call,
send and output ceilings. The helper's 8,000-byte witness bound does not imply a
full packet fits. The first full-witness projection overflowed on eight of the
104 fresh compact explicit paths. Only redundant witness model projection was
subsequently compacted: P03's additional fragment changed from 2,750 to 956 bytes
and CAPM's from 2,729 to 901, with another 126 bytes of quality-specific guidance.
The complete private witness and metadata receipt remain exactly equal, as do
the original candidate/source/Bank/teacher payloads.

The final file-only matrix executes 416 native renderer/admission paths across
104 unique prompts, including streaming, nonstreaming, actual/forced schema
correction and nested JSON correction. Each cohort has 104 paths:

| Requirements/selector cohort | Before refused / maximum units | After refused / maximum units |
| --- | --- | --- |
| R8 approved requirements, absent selector | 4 / 24,662 | 4 / 24,662 |
| R8 approved requirements, explicit selector | 16 / 27,428 | 9 / 25,377 |
| Fresh current compact, absent selector | 0 / 22,790 | 0 / 22,790 |
| Fresh current compact, explicit selector | 8 / 25,556 | 0 / 23,505 |

The fresh explicit maximum has 495 units below the unchanged 24,000 input cap.
Nine historical explicit paths and four historical absent-selector paths still
refuse; the complete matrix therefore retains 13 overflows, not zero. Historical
R8 requirements are not silently changed to the new compact contract. These are
local conservative admission units, not provider tokens, bills, model latency or
evidence of semantic acceptance. Known over-limit work refuses rather than
trimming originals, raising the cap or resetting a ledger.

The final current-source replay checks all 416 native envelopes and all 104
prompt bytes exactly equal to the preceding projection measurement after the
non-renderer recovery fix. Its 102 imported source pins are frozen separately
from the 19-file combined code/test manifest. The counterfactual twelve-stage
budget experiments do not reopen or replenish the completed R8 allowance.

## Evidence status and remaining acceptance

The pure-helper and integration receipts live under
`audit-results/numeric-semantic-review-2026-10-17/helper-r1/`. They retain the
actual P03/CAPM templates, deterministic witnesses, valid and invalid arithmetic
controls, canonical/BSON binding checks, historical absence and scripted
source/teacher refusals. Earlier compiler, test-preparation and loader/assertion
failures remain recorded. The final receipt is
`audit-results/numeric-semantic-review-2026-10-17/verification-final.json`.
`final-code-manifest-r2.json` retains 19 current code/test pins and 14 before/
after deltas. Final combined counts include focused tests; those denominators
must not be added together.

The initial broad regression retained 14 legacy-fixture failures, including an
eager snapshot operation newly evaluated on an absent-selector branch. The
narrow fix restores conditional new-contract evaluation. A prior lint checkpoint
and earlier integration/test-preparation failures remain in the receipts. The
later independent wiring review records no remaining defect in its inspected
scope; it is not semantic or real-database certification.

The additive chapter shows the exact old CAPM prompt and paid rejection,
the same original payload plus the new server-computed witness, deterministic
values, measured input overhead and any admission failure. The new-output side
states that no post-change model response exists. The preceding English book's
54 non-time payload values and all 525 prior PNGs are preserved in
`audit-results/numeric-semantic-review-2026-10-17/book-before/`.

This work does not reopen the completed R8 allowance. It adds no provider,
application-database, queue, embedding, OCR or Canvas execution in this offline
phase. Scripted improved reviewer replies prove wiring only. Actual reduction of
CAPM false holds, preserved negative controls, useful saved-question yield and
professor acceptance require separately authorized prospective validation. P01/
P04 table ambiguity, genuine demand mismatches and multi-file coverage gaps
remain separate acceptance work.
