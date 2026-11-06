# Quality engineering observations — October 16, 2026

Status: active work. Baseline remains the product default and grounded-memory-v2
remains opt-in. No commit, push, deployment, production course mutation or Canvas
write was requested or performed in this experiment phase.

The evidence reader is
`artifacts/quality-lab-book-2026-10-16/index.html`. Exact source-based prompts and
raw visible outputs are in its ignored `private/data.js` and the ignored
`audit-results/quality-lab-2026-10-16/` records. Metadata-only product usage
receipts were not changed into raw-prompt logs. Hidden model reasoning is not
recorded. An abrupt process death can lose unfinished streaming text; started
and reserved-send receipts remain.

## Fixed-input model pilot

Four tuning cases tested thin-topic task independence, decimal CAPM with lecture
notation, diagram actor ownership, and difficulty under a thin source scope.
Each case used the same generator prompt, original source packet, Bank snapshot
and authoring requirements across five arms. Each arm had one draw per case.
The fixed quality judge was Sol 6.1 / medium. Generator completion caps were 8k;
assessment caps were 6k, including reasoning. No model or effort fallback was
allowed; provider-reported actual model IDs matched the requested IDs.

| Generator | Model-assessed eligible | Also passes checked deterministic admission | Checked eligible at requested assessed difficulty | Generator input / output tokens | Median generator time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Luna 6 low | 0/4 | 0/4 | 0/4 | 15,796 / 3,025 | 9.3 s |
| Luna 6 medium | 2/4 | 2/4 | 1/4 | 15,796 / 6,722 | 16.5 s |
| Luna 6 high | 2/4 | 2/4 | 2/4 | 15,796 / 12,261 | 30.1 s |
| Sol 6.1 medium | 3/4 | 3/4 | 2/4 | 15,796 / 4,153 | 21.8 s |
| Sol 6.1 high | 3/4 | 3/4 | 2/4 | 15,796 / 7,636 | 33.8 s |

All 20 candidates parsed. The 40 observed generator/assessment sends reported
165,053 input and 50,038 output tokens, including 26,768 reasoning tokens as a
subset of output. Summed provider duration was 812.4 seconds; it is not a billed
price or end-to-end user latency measurement. Assessment costs are separate in
`model-pilot-analysis.json`.

Concrete observations:

- Luna low's portfolio-wide shock did not establish the market-wide premise its
  answer needed. The source judge reported that gap instead of accepting a
  familiar finance conclusion.
- Some Luna actor-ownership candidates avoided the requested firm/investor
  distinction and repeated ordinary risk classification. Sol candidates more
  directly distinguished the firm's projects from the investor's stock holdings.
- Hard labels were assessed separately from actual reasoning. Several requested
  hard tasks achieved an easier label; eligibility does not imply that the hard
  requirement was fulfilled.
- Sol high used more generation time and output tokens than Sol medium without
  increasing this pilot's eligible count. This is a candidate for further testing,
  not a general model ranking or a reason to change production defaults.

The offline admission audit reused the exact frozen production code and recorded
private gates before any follow-up edits. Eighteen candidates passed its checked
deterministic gates; ten passed those gates plus the source/notation/task
assessment. Generic option-role validation, content review, current live
source/Bank checks, persistence, concurrency and teacher approval were not run in
this generator comparison. Each arm was an independent trial against the frozen
Bank, not a pool of twenty mutually independent questions. **Saved Drafts: zero.**
These counts cannot be compared causally with the earlier 1/6 saved-Draft run.
The aggregate is **10/20 lab-eligible, 10/20 combined checked-eligible, and 7/20
combined checked-eligible at the requested assessed difficulty**. The lab
eligibility rule did not require requested difficulty to match; its 10/20 result
therefore does not establish delivery of all requested hard questions. Teacher
acceptance, review minutes and full-pipeline usable-question cost remain unknown.
The fixed judge shares a model family with the Sol generator arms.

## Real matched extraction probe

The retained October 14 and current extraction functions were recovered from
trusted code declarations with saved Git/source hashes. Two prospective API
calls used the same original Statistics PDF page 6, original passage partition,
Luna medium and 8k cap. This is an actual response comparison, not a synthetic
old response reconstructed from an expected failure.

Both outputs already described mean, population/sample variance denominators,
and standard deviation. The measured improvement was evidence grouping:
single-passage references `[1,1,1]` became `[2,3,2]`. The current response accounted
for all five original passage groups, including an explicit page-number
disposition. The old response passed its original protocol but failed the new
complete-passage accounting. This establishes a mechanical provenance repair,
not newly discovered concepts or professor-confirmed semantic coverage.

The two sends reported 2,830 input and 2,309 output tokens. The original PDF page
image was inspected alongside the extracted text. Extraction damage and source
notation still require source-aware inspection; a valid passage ID alone is not
semantic proof.

## Validation and original-task memory follow-up

After the fixed pilot and its frozen-code audit finished:

- A supported review listing missing necessary premises now becomes uncertain
  and stays withheld until permitted original evidence resolves the gap. This
  activates the existing bounded evidence-expansion path rather than waiving it.
- Generator output is projected to allowed content fields. A model cannot supply
  its own verification proof, trusted provenance or approval metadata to the
  early numerical serving check.
- Independent regeneration pins the original immutable Bank version outside
  normal recency limits. It must appear in full in bounded memory and receive an
  explicit inference/solution-path comparison. Missing, stale or oversized
  original comparisons fail explicitly. Local edits and intentional variants
  retain their existing exception.
- Adoption refuses older independent candidates lacking that checked original
  comparison, and refuses unresolved missing-premise or defect findings.

The first two defects were reproduced by failing tests before repair; the
subsequent four-suite integration check passed 163 tests. Complete regression and
retained real-negative observations are recorded separately in the book, not
inferred from these focused checks.

The first retained-negative follow-up is now terminal in
`validation-controls-live/results.json`: six observed sends reported 23,890 input
and 4,827 output tokens. The actor-ownership candidate was withheld with a
specific firm-versus-investor finding. Its repair changed the attribution to
firms, but the generic Reviewer and source check still withheld it because the
flattened diagram did not establish the required few-firms/strategy alignment
unambiguously. The retained fractional CAPM candidate was recognized as a
variant of its frozen comparator and withheld for the independent-task request.
Its next repair send was stopped before dispatch by the 24k input cap. This run
does not demonstrate a successfully accepted repair; neither candidate was saved
or adopted. Ambiguous diagram structure must be resolved against the original,
not turned into an automatic pass.

A separate recorded repair attempt in `recorded-repair-live/results.json`
stopped at its input admission cap with **zero provider sends**, zero provider
tokens and no repaired candidate. The completion wrapper was invoked once; that
is not an actual model send.

The final general-policy compaction preflight in
`recorded-positive-policy-preflight-final.json` reduced the exact recorded
repair input envelope from 24,483 to 23,783 conservative units, below the
unchanged 24,000-unit input cap. The original source, Bank memory, candidate and
requirements stayed unchanged; the isolated change was general v2 generator
policy prose. This preflight made zero provider/database calls and establishes
input fit only, not improved generation quality.

The subsequent `recorded-repair-retest/results.json` is now terminal:
**four observed sends, 43.566 seconds, 16,789 input and 2,171 output tokens**.
Its actual repaired candidate passed the recorded fixed-context checks
(`frozenControlCandidateEligible: true`), with zero saved or adopted questions.
This is one same-candidate engineering recovery, not a complete production
generation/adoption result or evidence of teacher acceptance.

## Numerical grids and validation boundaries

Closed-formula verification currently samples 100 fixed seeds, starting at
1,000,003; scripts sample 25. It does not enumerate the parameter grid. The
unchanged Luna-medium CAPM candidate has 27 declared input combinations. Its
first verification draw already fails at seed 1,000,003: beta 1.2, riskfree rate
3% and risk premium 6% make both the correct formula `3 + 1.2 * 6` and the
add-beta distractor `3 + 1.2 + 6` display **10.20%**. The candidate did not earn a
proof and was not servable through admission.

The zero-provider `numeric-grid-audit.json` resolves all actual tuples using the
unchanged production resolver and display checks. Twelve of the original 27
combinations collide: nine at beta 1 between the correct and omitted-beta
answers, plus three at beta 1.2/risk premium 6 between the correct and add-beta
answers. None fail displayed-input reproducibility. Separately traversing the
entire prescribed 100-seed list visits only 25 of 27 combinations; the real
verifier stopped at its first failure. This demonstrates why a sampled proof
must not be described as exhaustive, even for a small explicit grid.

The actual model repair changed beta's values to `[0.8, 0.9, 1.1]` and retained
the three-by-three percentage-rate grid. All **27 repaired combinations** pass
the same checked arithmetic, rendered-option distinctness and displayed-input
checks, with zero collisions. The audit binds both candidate hashes, source-code
hashes matching the repair snapshot, every tuple and the actual model receipts.
It made no provider/database calls; forbidden external component access attempts
were empty. Financial/source truth and teacher acceptance are separate from
these arithmetic observations.

The serving helper previously returned its last colliding draw after eight
unsuccessful redraws. That fallback is removed: exhaustion now throws a concrete
reason, including when an earlier collision is followed only by unsafe
displayed-input draws. A valid eighth draw still succeeds. Three regression
assertions failed against the old behavior before the fix; six focused suites
then passed **145 tests**, with server TypeScript and scoped lint passing.
The final integrated regression passed **2,552 tests across 189 suites**. The
current build, server/client typechecks and repository lint passed. Its first
integrated attempt retained one obsolete prompt-wording assertion failure; the
assertion was updated to keep the renderer precision constraints, then the full
suite was rerun. Both receipts remain available.
Exam freezing reports the failed draw, sample previews can fall back to their
stored template, and other callers fail instead of returning known ambiguous
answers. No existing attempt answers are redrawn or regraded by this change.

The generic validator's `roleAssessment` and optional `moveAssessment` are prose
passed to the content Reviewer. Their contents are not independent hard
acceptance gates; a successful validator call does not establish that every
option passed. V2 independently withholds on deterministic numerical failure or
a Reviewer `reject`, alongside its source/notation/task checks. Reviewer `flag`
and unknown decisions normalized to `flag` do not independently withhold a v2
candidate. Baseline can retain flagged/rejected Drafts for instructor review.

Bounded exact enumeration for small finite grids remains a proposal. It should
share the actual slot-domain/formula/display semantics, enforce a fixed work
cap, report bounded examples for each distinct collision pair, and record a
versioned domain/content hash and checked combination count. Larger domains and
scripts must retain honestly labelled sampling. The current change closes the
known exhausted-draw fallback; it does not implement exhaustive admission.

## Multi-source scope, speed and budget

The owned disposable fixture contains ten complete public chapter PDFs, 599
pages and 671 physically parsed/indexed sections, with local embeddings. Advisory
classification was deliberately skipped in this fixture. It is not a new
multipart upload-admission test.

Exact preflight against current production batching requires 48 cold extraction
calls and at least 1,275,670 conservative input/output reservation units before
synthesis or repairs. That exceeds the remaining initial 100-send / 2,000,000
phase allowance. No source was silently trimmed, no budget was reset, and no
ten-file completion is claimed. The bounded production outline test completed
using complete Chapters 3 and 6 (64 pages, 71 sections), with the other eight
files explicitly excluded. The exact request used `gpt-6-luna` / medium and a
10k output cap for extraction and synthesis; production defaults were unchanged.
Its receipt in `outline-subset-live/results.json` records:

- 226.064 seconds wall time and 12 observed sends, including retries/repairs;
  65,582 input and 40,635 output tokens. The conservative reservation was 416,206,
  which is a different quantity from actual reported token usage.
- 10 Topics and 47 LOs; 96 extracted learning points, 94 mapped and two unmapped.
- 127 original passage groups: 117 mapped and ten explicitly left for visual
  review. No selected source with extracted instructional content disappeared.

These are parsed-source accounting and model-draft observations, not professor
acceptance or proof that every formula, diagram or teachable capability is
covered. The generated outline was not applied to the saved course structure.
The full ten-file cold result remains unfinished.

The identical production cache-only replay in
`outline-warm-live/results.json` reused all 71 sections through five extraction
cache hits, with zero newly extracted sections and zero provider dispatches. It
stopped at the final `outline-synthesis` cache miss after 338 ms. The completion
hook cannot dispatch a model request and the enclosing send limit is zero; no
historical result was substituted. The warm outline and content-equality result
are null. **338 ms measures time to the synthesis miss, not complete warm-outline
latency.** Final synthesis reuse is not implemented; its strict identity,
currentness and explicit-regeneration design is recorded in
`FINAL-OUTLINE-CACHE-FEASIBILITY-2026-10-16.md`.

Before the final recorded repair probe, the shared phase-one ledger had 60 reserved
sends and 1,697,821 conservative reservation units against limits of 100 sends
and 2,000,000 units, leaving 302,179 units. This snapshot includes the matrix,
matched extraction, two-source outline and first retained-negative probe. The
warm cache-only probe added zero sends or model-token reservations. Reservations
are not billing totals and do not settle down to successful provider usage in
this shared experimental ledger.

Source-local cache identities support reuse after successful extraction. The
new accounting preserves separate exact quote groups, shows unresolved visual
relations and prevents an instructional source from silently disappearing in
synthesis. Incremental selection fingerprints are canonical and ignore
advisory-only material revision changes; reingestion/original changes remain
invalidating. Applying an AI draft binds its durable run and source identities.
Standalone Mongo operation is explicitly best effort and can report a detected
post-write conflict with shared additions retained; it does not claim replica
transaction guarantees.

## Remaining evidence

Complete production generation and regeneration saves/adoption with live source/
Bank currentness, full ten-file cold/warm/addition/replacement flows, held-out
repeated model trials, and original-source semantic inspection remain necessary.
The single fixed-context repaired candidate, completed two-source run and
extraction reuse do not fill these gaps. Teacher acceptance and review minutes
remain unknown. The separate
Canvas export design documents an unpublished reviewed export and sandbox
read-back plan; it is not an implemented integration.
