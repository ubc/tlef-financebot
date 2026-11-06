# V2 yield repair and bounded retest — October 14, 2026

## Decision

Keep baseline as the default and `grounded-memory-v2` opt-in. The original
one-of-six result mixed genuine content defects, inconsistent model metadata,
unreliable copied quotations, and engineering budget failures. They require
different fixes; accepting every withheld candidate would admit real errors.

The new full generation pass still saved **1/6 Drafts**. After the last metadata
repair, a separate quality-only pass made **two retained positive candidates
eligible**. These were not adopted, approved, or added to the Bank. This is
evidence of two recovered review outcomes, not a measured increase in saved
or teacher-accepted supply.

The two negative probes remained withheld due to citation-format errors. Their
underlying diagram attribution and duplicate/notation defects were independently
inspected, but automated semantic detection was **not validated** by that pass.
The subsequent citation-group repair and pilot budget wiring were tested
offline, after the last paid send. No additional paid calls were made.

## Why the original run saved only one question

| Failure | Specific observation | Repair / safeguard |
| --- | --- | --- |
| Vocabulary overlap treated as task identity | A classification question and a two-mechanism question were compared with a recall T/F seed as though shared diversification vocabulary implied the same inference. | Separate Bank/Queue `M` comparators from source `F`/`S` references; require explicit same-inference and same-solution-path comparisons. Shared concepts alone are not equality. |
| Redundant novelty fields contradicted each other | The classification review said independent, with both task comparisons false, while also returning `matchedEntryIds: [M1]`. The same inconsistency survived correction. | New span responses return comparisons only. The server derives matches from unique valid comparisons where both booleans are true. Contradictory independent/duplicate verdicts still fail. Legacy copied-quote responses retain their historical checks. |
| Copied quotation / reference errors | Model-written quotes changed text or failed exact location checks. One numeric review compared a lecture worked example as though it were a Bank question. | Ask for short `S` span IDs; resolve exact original text server-side. A worked example remains evidence, never a Bank comparator. Unknown/out-of-scope IDs remain errors. |
| Internal alias leaked into task storage | A generator returned an `S` alias where the durable descriptor required a canonical original `E` ID. | Rebind known current aliases before checks/storage; reject unknown or ambiguous references. Learner text cannot contain citation annotations. |
| Real numerical display defect | Hidden beta precision changed the answer after the student-visible input was rounded. | Recompute from displayed inputs, validate every fresh draw, and stop known unservable v2 output before paid downstream reviews. Generate explicit visible-precision grids. |
| Real source relation error | A question transferred a diagram's FIRM sectors/countries strategies to the INVESTORS row. | Require actor/row/column ownership in generation and reviews. Ambiguous flattened structure cannot be filled from general finance knowledge. |
| Prompt admission failure | Four generator sends exceeded the default 24,000 conservative input limit before dispatch in the first retest. | Remove duplicated policy/protocol text and numerical contracts from conceptual tasks. Keep original evidence and independent validation/review. Current whole-prompt reconstructions fit the unchanged ceiling. |
| Budget stopped later work | Completed calls retained estimated UTF-8 input plus the entire output reservation forever. A tiny per-case test allocation also blocked complete review despite unused shared allowance. | V2 pilot budgets settle successful calls with complete reported usage; pending/failed/incomplete usage remains conservative. Nested parent budgets, send caps and per-call limits still apply. The test's shared cap was never reset. |
| Requested hard task was medium | The original saved Draft was assessed medium, despite a hard request. | Preserve assessed difficulty and an explicit mismatch; do not count longer wording as successful hard supply. |

## Protocol and controls

This retest used two complete NYU Stern public PDFs: Chapter 3, 21 pages, and
Chapter 4, 111 pages. All 132 pages were parsed, chunked into 143 original chunks,
locally embedded with FastEmbed and indexed in a disposable course collection.
The fixture deliberately skipped advisory classification and source extraction;
it is not an end-to-end upload or ten-chapter outline benchmark. The earlier
[acceptance report](ACCEPTANCE-2026-10-14.md) retains the separate multi-file
coverage/cache observations and their limitations.

Source bytes, chunk hashes, source scope, current starting Bank versions,
requirements, and request options were recorded before paid sends. The repaired
second pass and four-probe pass also retain exact code snapshots. The first
pass retained code hashes rather than full source snapshots. No model, source
document, or baseline default was changed between these retest attempts.

Source catalog: [NYU Stern applied corporate finance materials](https://pages.stern.nyu.edu/adamodar/New_Home_Page/ACF4E/appldCF4E.htm).
Public availability is not a redistribution license; full PDFs remain ignored
local evidence and are not embedded in the HTML report.

The initial allowance was at most **40 observed sends / 600,000 conservative
estimated tokens**, including failures and repairs. Both attempts together used
31 sends and 598,670 estimated/reserved tokens. With the user's separate approval,
the final pass was limited to **four sends / 120,000 conservative estimated
tokens**, quality-review only. It reused existing candidates and performed no
new generation, upload, adoption, or saved-supply increase.

## Full generation and regeneration observations

| Pass | Saved / requested public slots | Eligible / requested regeneration | Sends | Reported input | Reported output | Conservative input + output reservation | Run wall time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| First retest, admission failures | 0/6 | 0/3 | 11 | 39,976 | 1,871 | 213,193 | 58.7 s |
| Repaired remaining-allowance pass | 1/6 | 0/3 | 20 | 71,591 | 5,896 | 385,477 | 69.7 s |
| Both attempts, including failures | 1/12 attempted slots | 0/6 attempted requests | 31 | 111,567 | 7,767 | 598,670 | 128.4 s summed run wall time |

In the repaired pass:

- Thin-topic slot 1: source-supported classification, falsely withheld by the
  redundant novelty fields. Later quality-only review recovered eligibility.
- Thin-topic slot 2: source-supported two-mechanism question, saved as a Draft.
- Thin-topic slot 3: real firm/investor diagram attribution error. Its final
  automated quality check did not complete under the allowance.
- CAPM slot 1: percentage convention, genuine decimal variation, safe calculation;
  final quality check was budget-blocked. Later quality-only review was eligible.
- CAPM slot 2: safe arithmetic but the same substitution task as slot 1, with a
  fractional-rate convention change. It was generated but not fully reviewed.
- Requested-hard slot and all three regeneration intents: allowance exhausted
  before their new model work. Their quality is unknown, not a demonstrated
  unsupported/duplicate verdict.

Both retained numeric grids were exhaustively enumerated: **27/27 + 27/27 finite
tuples** passed displayed-input recomputation and four-option distinctness.
The production 100-seed proofs also passed. They remain variants of the same
solution path; correct arithmetic does not establish independent supply.
Historical unsafe numerical candidates remain blocked by the earlier display
repair. No numeric candidate from these retests was approved or served.

## Four quality-only probes after the metadata repair

| Existing candidate | Validated result | Input / output tokens | What this establishes |
| --- | --- | ---: | --- |
| Risk classification positive | Eligible; supported, consistent, independent | 3,992 / 453 | Redundant-match false withholding removed for this candidate. |
| Percentage CAPM positive | Eligible; supported, consistent, independent of the conceptual seed | 4,562 / 441 | This candidate's exact evidence, notation and novelty assessment completed. |
| Firm-to-investor row negative | Withheld; semantic verdict unknown | 4,114 / 486 | Non-contiguous span selection failed; the one-send cap blocked correction. |
| Fractional CAPM variant negative | Withheld; semantic verdict unknown | 4,822 / 507 | Same citation failure; automatic duplicate/notation detection was not established. |

Thin-topic probes explicitly added an actor-row requirement. The fractional
negative added the retained percentage candidate as an explicit same-batch
comparator without writing it to the Bank. These changed controls are recorded;
this is not an unchanged-input paired experiment.

All six positive citations resolve exactly to originals. One classification
premise citation is individually imprecise, while the solution citation supplies
the necessary all-investments breadth. Exact location and per-claim entailment
remain different questions. Teacher labels and acceptance remain null.

The negative raw review JSON was not retained after the repair admission failed.
Post-pass tests therefore reproduce the recorded citation failure shapes and
use explicitly synthetic verdicts for semantic gate tests; they do not recover
or invent the negatives' missing model findings.

## Repairs completed after the last paid pass

Non-adjacent selected spans are resolved into **separate exact contiguous quote
groups**, retaining each claim/kind and bounded selection. No gap is joined,
quote rewritten, missing passage substituted, or support fabricated. Unknown,
duplicate, damaged and out-of-scope references still fail. The legacy quote
protocol remains compatible. Unsupported content and same-task variants still
fail eligibility even when all quote locations are valid.

The source judge now explicitly checks actor/row/column ownership, matching
generator/validator/reviewer instructions. This is a prompt repair; automated
semantic accuracy on those two negatives remains unmeasured until another
authorized real-provider evaluation.

Only v2 pilot entry/run/slot budgets opt into reported-usage settlement. Baseline,
v1, source-analysis/memory-preparation budgets and the generic budget default
keep conservative accounting. A completed successful call with both safe
reported counts replaces only its own reservation, exactly once. Unknown,
partial, cancelled and failed calls retain the reservation; parent scopes are
charged independently. No send, input, output, logical-repair or source-scope
limit is removed. Four real review leaves verified this accounting mechanism;
a complete generation run under the newly wired policy was not paid-tested.

## Cost and interpretation

The four additional probes used 17,490 input + 1,887 output tokens and 88,532
conservative parent admission tokens. Their total recorded provider duration
was 20.7 seconds; this is not the same measure as full generation wall time.
Every settlement leaf finished with pending=0, settled=1 and admission equal to
its reported input plus output. The enclosing authorized parent stayed
conservative and within its four-send/120k limit.

Across this repair turn, including both failed/superseded full attempts and all
four probes: **35 observed sends, 129,057 input + 9,654 output = 138,711 reported
tokens**. Usage is complete within the observed ledger. Conservative reservations
were 598,670 + 88,532 = 687,202 under the two separately authorized allowances.
These numbers exclude earlier-turn corpus preparation/tuning, embeddings,
parsing, infrastructure, money pricing and SDK-hidden physical retries. They are
not an invoice ceiling or an accepted-question efficiency measure.

There is no fair baseline/v2 quality or speed comparison here, no held-out
teacher-labelled test, and no measured professor review-time reduction. The
engineering result is narrower: specific false-withholding and provenance
failures are repaired, two positives completed real review, numerical display
safety remains enforced, and cost admission now separates pending reservations
from successful known usage in the v2 pilot.

## Where to inspect the result

Use the existing Instructor generation view, opt into **Shared evidence and task
memory v2**, and read saved Drafts, withheld diagnostics, missing slots, and
reported input/output. In Regenerate choose an explicit edit/variant/independent
intent and inspect its durable candidate before adoption. Admin Operations shows
the existing per-call usage and guarded run diagnostics. No new evaluation
application or product entry point was created in this repair turn.

The [static HTML result report](../../../artifacts/quality-authoring-retest-2026-10-14/index.html)
separates paid observations, offline corrections, and outstanding validation.
Ignored local evidence is under `audit-results/generation-quality-retest-2026-10-14/`:
`inspection-after-repair.md`, `quality-only-probe-inspection.md`,
`numeric-inspection-after-repair.json`, code/control snapshots and test receipts.

Next release gate: an authorized complete generation/regeneration pass under
the final code, followed by teacher-labelled scope, task independence and review
effort checks. Keep the original requested denominator, include withheld
candidates and failed calls, and do not replace the default based on eligibility
probes alone.

## Final regression and cleanup

175 Jest suites / 2,395 tests pass, with external model calls blocked. The
compiled production client passes 24 controlled authoring and seven existing
structure browser tests, including scoped accessibility/narrow-viewport checks.
Their APIs are intercepted; they do not claim live SAML or provider acceptance.
Server/client TypeScript, lint, build and diff checks pass. Final offline
reconstruction of five retained planned generators includes the streaming
envelope: maximum 21,340 conservative input units under the unchanged 24,000
ceiling. This reconstructs current code, not historical raw prompt recovery.
The static report passes desktop/mobile axe, local-link and overflow checks.
The final code audit
found no blocking defect; semantic calibration limitations remain explicit.

The owned disposable Mongo database, single course Qdrant collection, two UUID
upload copies and task-labelled Mongo container were verified absent. Original
PDFs and raw audit evidence remain local. No production account/course/student
data was changed. No commit, push or deployment is included.
