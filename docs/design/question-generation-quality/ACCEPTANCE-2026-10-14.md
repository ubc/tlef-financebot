# Public-PDF source coverage and authoring acceptance

Date: October 14, 2026. Owner: Stephen. Local work; no push or deployment.

Follow-up: [yield repair and bounded retest](REPAIR-AND-RETEST-2026-10-14.md)
records later fixes and two full-attempt receipts plus four review-only probes.
It does not rewrite the historical observations below or claim another saved
question from eligibility-only reviews.

The source readiness, reuse, memory, revision protection and bounded-call
mechanisms are implemented. The observed v2 generation supply is too low to
recommend making it the default. Baseline remains the default. Teacher
acceptance and review-time benefits are unknown.

Open the [screenshot and results report](../../../artifacts/quality-authoring-2026-10-13/index.html)
for the product walkthrough. It is a static report, not another evaluation
application. See [implementation](IMPLEMENTATION-2026-10-13.md) for service and
workflow details and [the plan](2026-10-13-source-coverage-and-memory-plan.md)
for the original business gates.

## What was tested

The corpus uses complete, publicly downloadable teaching PDFs by Aswath
Damodaran from [NYU Stern's Applied Corporate Finance collection](https://pages.stern.nyu.edu/adamodar/New_Home_Page/ACF4E/appldCF4E.htm).
Thirteen downloaded chapters total 637 pages. The initial ten selected chapters
are Chapters 2, 3, 4, 5, 6, 8, 9, 10, 11 and 12: **599 pages**, with 21–111
pages per PDF. Chapter 13 adds 16 pages. The explicit replacement test selects
the complete 13-page Foundations PDF instead of Chapter 4; it is a different
document selected for the test, not a fabricated author revision.

The twelve indexed files used for initial, append and replacement tests total
628 pages and 723 source chunks. Downloaded originals remain local and ignored;
no open redistribution license was established. Metadata, hashes and the small
declared inspection inventory are in `scripts/prompt-ab/fixtures/`.

Real parsing, chunking, embeddings and Qdrant indexing were exercised in a
disposable local Mongo replica set and course-scoped Qdrant collections.
Configured OpenAI toolkit calls used the existing `gpt-6-luna` stage settings.
Generation comparisons used independent cloned fixtures with source/vector
hashes checked; previous arm outputs were archived before the next arm and did
not become its question memory. No live course, student records, platform model
settings or production defaults were changed.

The paid tests are small tuning observations, not a held-out evaluation.
Public-generation requests covered a thin risk LO with an existing T/F bank
question, decimal CAPM/notation, and a deliberately unsupported hard-question
request. Regeneration exercised edit, variant and independent-task intents.
The second comparison used two repetitions per case/policy; final validation
used one repetition for v2. No further paid calls were made after that final
pass. The subsequently added numerical display check is verified with
deterministic regressions, without pretending it was a new paid measurement.

## Feedback, implementation and evidence

| Original concern | Implemented response | Observed limit |
| --- | --- | --- |
| Content outside notes | Allowed-source snapshots, current original passages, bounded in-scope expansion, deterministic citation validation and semantic assessment | Exact references do not prove entailment. Agent inspection found source-interpretation issues; no calibrated scope-error rate is available. |
| Repetition inside an LO | Current Bank/Queue and same-batch memory, task plans, inference/family fingerprints, shortfalls rather than filler | Baseline thin-topic outputs repeat inference tasks. V2 can over-refuse and confuse a source example with Bank memory. Wider historical-bank novelty is not established. |
| Hard means wordier | Check achieved difficulty and justified length; preserve requested difficulty separately | The final saved requested-hard question was stored as medium with a mismatch, not advertised as a verified hard question. |
| Notation differs | Original formula/notation passages and consistency checks | CAPM numeric generation remained weak; deterministic arithmetic cannot validate financial assumptions or distractor relevance. |
| Regeneration ignores instructions | Explicit edit/variant/independent intent, required changes, preserved invariants, bounded repair and explicit adoption | Final terminology-only edit was eligible and preserved unrelated content. Other intents still failed citations or budgets; none was adopted in the experiment. |
| Does the model see the bank? | Shared current memory for v2 generation and regeneration, with omissions disclosed; optional bounded historical fingerprint preparation | Memory is bounded. A disclosed or unprepared omission is not full-bank coverage, and no global semantic uniqueness guarantee is claimed. |
| Several uploaded chapters are omitted | Intended manifest before upload, authoritative readiness, all-active-source defaults, explicit exclusions/replacement, complete extraction ledger | All selected chunks were traversed, but diagrams and some extracted relationships remain partial. Complete curriculum coverage has not been proved. |
| Decimals and numerical answers | Closed formulas, option verification and displayed-input checks, with a guard on each fresh draw | The experiment exposed hidden precision affecting the answer. Saved/approved status alone cannot bypass verification. Existing frozen sittings are not regraded. |
| Speed and token cost | Exact-byte upload reuse, source-local extraction and organization-pack replay, focused originals, bounded parallel work and actual-send budgets | Warm work still needs final organization; latency and accepted supply do not yet establish an efficiency win. |

This delivery is focused on source preparation and authoring. Earlier queue,
LaTeX, editor-navigation and exam changes are separate features; these paid
observations do not establish new regression coverage for every historical UI
issue in the feedback.

## Multi-chapter reuse and coverage

| Recorded phase | Selected sources / sections | Source sections reused / new | Organization packs reused / new | Observed calls | Input / output tokens | Elapsed seconds | Extracted points mapped / total |
| --- | --- | --- | --- | ---: | --- | ---: | --- |
| Initial recovery / priming | 10 / 671 | 671 / 0 | 4 / 1 | 2 | 63,903 / 16,639 | 111.2 | 1,153 / 1,153 |
| Warm reuse | 10 / 671 | 671 / 0 | 5 / 0 | 2 | 44,414 / 27,600 | 169.1 | 1,151 / 1,153 |
| Add Chapter 13 | 11 / 697 | 671 / 26 | 5 / 1 | 5 | 67,177 / 34,423 | 205.7 | 1,187 / 1,188 |
| Replacement recovery | 11 / 609 | 609 / 0 | 6 / 0 | 1 | 23,994 / 14,829 | 94.2 | 1,046 / 1,063 |

The script names the first row `cold`, but its source cache was already warm
after preceding extraction/tuning attempts. It is **not** a clean cold run of the
final implementation. Replacement extraction and new organization packs were
prepared in the preceding failed replacement attempt: 228.0 seconds, six calls,
119,692 input and 40,924 output tokens. The last row is its continuation, not
zero-cost replacement preparation. All preceding costs remain in totals below.

Warm and addition measurements include a repeated final-organization call after
duplicate labels. The final replacement continuation uses exact-name
consolidation with reference unions; semantic synonym merging is not inferred.
Results changed while tuning, so no cold/warm speedup or p50/p95 is claimed.
Model execution totals can exceed wall duration during parallel work.

The warm outline retains two unmapped point IDs; addition retains one;
replacement retains seventeen. Model-described noninstructional or unreadable
sections are also explicit (82 for addition, 69 for replacement). These exclusions
need inspection rather than being treated as complete coverage.

Independent agent inspection checked a declared fourteen-target inventory
against original pages and cached sections: eleven text/formula targets supported,
two partially represented diagram/chart targets, and one partially represented
statistics target. All lookup terms appearing on original pages is a lexical
check, not 100% semantic recall. The appended statistics cache omitted the
explicit standard-deviation-as-square-root-of-variance relationship. Some
400-character quote excerpts ended before a relationship named in the cached
knowledge; adjacent original text supported it, but the excerpt itself did not.
Thus cache location integrity and all-chunk traversal do not prove citation
entailment or instructional completeness.

## Generation and regeneration outcomes

| Second comparison case | Baseline saved / requested | V2 saved / requested |
| --- | --- | --- |
| Thin-topic memory | 6 / 6 | 0 / 6 |
| CAPM decimals / notation | 4 / 4 | 1 / 4 |
| Outside-scope / hard request | 2 / 2 | 0 / 2 |
| Total | 12 / 12 | 1 / 12 |

Saved Drafts are not teacher-accepted questions. Agent inspection found the
thin-topic baseline questions repeating the same market-risk inference. One
baseline numerical version had no valid proof and option collisions in four of
27 finite parameter combinations; it remained unservable. The single v2 numeric
Draft used singleton parameter domains, so 100 sampled seeds did not establish
useful variation. Other numeric questions could import an unsupported scenario
assumption into a distractor even when their expression was arithmetically valid.

Final targeted v2 validation saved **1 / 6 public slots**: 0 / 3 thin-topic,
0 / 2 numeric, 1 / 1 requested-hard. The last was assessed and saved as **medium**.
One numerical assessment called the candidate a variant of the lecture's CAPM
example while the displayed Bank contained only the diversification T/F seed.
The server detected inconsistent matched memory IDs and withheld it. This
illustrates a faulty semantic reviewer decision, not proof of good novelty
detection. Repeated exact-quote/schema failures consumed bounded repair allowance;
the limit worked, but delivery yield remains unacceptable for default rollout.

Final regeneration returned one eligible terminology edit, one citation-withheld
variant and one budget-withheld independent task. All remained previews with
**zero adopted versions**. UUID replay returned the same candidate; it did not
create another generation request. The final edit evidence shows the targeted
repair working on this case, not a general instruction-following success rate.

The first paid generation attempt exposed a missing explicit JSON instruction
on planner requests and conservative input-cap blocks. The JSON instruction was
fixed; later schema/citation corrections use the same repair/send budget. The
second and final paid runs explicitly raised the conservative per-call input
estimate ceiling from the environment default 24,000 to 40,000. They therefore
do not establish yield under unchanged production-default limits.

The existing evaluation schema imports the second comparison with all 24 public
slots represented and every teacher label null. It admits **zero paired
comparisons**, because the full pre-call Bank manifest was not retained for that
run. Retrospectively checked version/source hashes cannot manufacture prospective
context. The final runner records a complete starting Bank snapshot before calls;
it has only the v2 arm and is not an A/B quality comparison.

Teacher acceptance, false-accept/reject rates, review minutes and tokens per
teacher-accepted independent question are **unavailable**, not zero. Agent
inspection is kept separate from teacher labels. Baseline's larger delivery and
v2's smaller recorded public subtotal do not establish a quality or cost winner.

## Observed cost, including failures and tuning

| Experiment scope | Observed sends/calls | Reported input tokens | Reported output tokens | Usage state |
| --- | ---: | ---: | ---: | --- |
| PDF advisory classification | 12 | 8,542 | 7,262 | Complete within ledger scope |
| Source extraction / outline, all unique recorded attempts | 119 | 1,472,473 | 409,027 | Complete within ledger scope |
| Generation attempt 1, including regeneration | 40 | 133,592 | 9,410 | Partial: HTTP errors have unknown counts |
| Generation attempt 2, including regeneration | 89 | 376,330 | 28,005 | Complete within ledger scope |
| Final targeted generation / regeneration | 50 | 223,949 | 15,134 | Complete within ledger scope |
| Public-corpus experiment subtotal | 310 | 2,214,886 | 468,838 | Known-count subtotal; first attempt partial |

The subtotal is 2,683,724 reported tokens, including failed, withheld and
superseded tuning work. Copied observation files and replayed cache rows are not
double counted. Additional tiny physical fixture checks are separate; for
example the material-readiness check recorded one advisory call with 284 input
and 687 output tokens.

These are provider-reported LLM counters, not a complete invoice or dollar cost.
Embeddings, parsing, infrastructure and SDK-hidden physical retries are excluded.
The estimator is conservative UTF-8 bytes, not a billing tokenizer. Cache writes
and provider-specific billing treatment are not repriced here. No efficiency
claim can be made without teacher-accepted supply and explicit preparation
amortization. No additional model call was made just to recover a missing count.

## Verification and cleanup

Final automated verification and cleanup receipts are linked in the screenshot
report. Final checks passed:

- Full Jest: **173 suites / 2,332 tests**, no failures or skipped tests.
- Related numerical/generation/assessment subset: **18 suites / 452 tests**,
  included in the full suite rather than added to its count.
- Production-client browser tests: **24 authoring + 7 existing structure tests**,
  including scoped axe checks and narrow-viewport overflow checks.
- Server/client TypeScript, standalone acceptance-script TypeScript, repository
  lint, production build and `git diff --check`.
- Zero-provider replay rejects both retained CAPM proofs and their unsafe draws:
  **9 / 27** and **45 / 81** finite combinations fail display safety, despite no
  rendered option collisions.

Publication and new live/rehearsal starts validate the exact frozen instance.
Historical pinned definitions are recovered without changing answers;
unrecoverable numerical snapshots require recreation before a new sitting.
Existing active/submitted attempts retain resume behavior and frozen grading.
Private formula definitions never appear in student/pre-submit Preview DTOs.

The owned database, five test-course Qdrant collections, sixteen upload copies
and owned Mongo container were removed and verified absent. Raw public PDFs,
receipt JSON, screenshots and agent inspection are retained locally. No real
teaching database or shared backing container was removed.

Unit tests prohibit external provider calls. Browser tests load the
production client but intercept API responses; desktop/light and mobile/dark
accessibility and overflow checks are included. They do not claim real SAML
login or end-to-end paid-provider UI acceptance. Physical backend scripts use
real local Mongo/Qdrant separately from browser fixtures.

The tests cover named missing chapters, admission failure, wait/retry/reload,
explicit subset, cross-course isolation, concurrent byte dedupe, stable-source
cache reuse, stale originals, transaction commit/adoption races, course deletion,
all regeneration intents and budget exhaustion. Recorded service observations
retain provider failures and every requested slot. Original files, safe JSON
receipts and agent inspection remain local ignored evidence after owned database,
Qdrant and upload fixtures are cleaned.

Reproduction scripts are opt-in and guard disposable local database names:
`download-quality-corpus.py`, `prepare-quality-corpus.ts`,
`prepare-generation-quality-fixture.ts`, `verify-source-evidence-cache.ts`,
`verify-authoring-quality.ts`, `verify-material-coverage.ts`,
`verify-authoring-commit.ts` and `verify-source-cache-fence.ts`.
Paid runners must not be included in automatic unit or browser tests.

## Release gate and next work

Keep v2 opt-in and diagnostic. The mechanisms now expose evidence, shortfalls,
real memory and cost, but the semantic reviewer is not calibrated and the pilot's
yield is too low. The highest-value next iteration is a small fixed set of
teacher-judged source and task pairs, including withheld candidates: separate
source examples from Bank comparators, improve exact-citation output reliability,
and calibrate false refusal before adding orchestration or more paid retries.

Use a held-out whole chapter/LO family after tuning. Agree minimum accepted
independent supply, scope/duplicate error ceilings, teacher-active review time and
latency/token ceilings before another release decision. Parsing/visual coverage
and quote-boundary entailment require their own source inspection. Only then
consider consolidating repeated reviewers or changing the default policy.
