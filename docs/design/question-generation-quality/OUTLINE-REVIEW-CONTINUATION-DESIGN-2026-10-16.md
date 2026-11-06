# Exact outline-review continuation and bounded evidence repair

Design only, prepared by an agent from local code and retained receipts. No
implementation, provider/API/DB/network call, declaration, or historical receipt
change was made for this design. Model-supported LOs are not teacher gold.

## Why ordinary retry would spend unnecessarily

The stopped v2 run `6ad2d15e19a66b1237767be5` proposed 142 LOs in 31 topics. Its
immutable `live/results.json` has SHA256
`b9248725544524cb4541a297df0d9230769d35507dc9c7c441e25fdf81300fa4`
under `audit-results/quality-lab-2026-10-16-outline-v2-acceptance/`. It retained
102 reviews: L1–L95 and L97–L103, comprising 82 supported and 20 withheld.
L96 failed coverage validation after its correction; L104–L142 were not reviewed.
The historical attempt remains failed: 641,013 ms, 20 sends, 1,004,330 conservative
units, 194,215 reported input and 81,903 reported output tokens.

Current `generateStructureWithBudget()` in
`server/src/services/structure-generation.service.ts` always starts at corpus
loading/extraction. `readSourceExtraction()` / `readSourceExtractionChild()` in
`source-evidence-cache.service.ts` can reuse validated extraction, and the pack
replay loop can reuse five organization packs. Neither caches the final merged
proposal or its completed review as a continuation checkpoint. Final organization
therefore runs again, creates potentially different wording/IDs, and invalidates
the old review bindings. `StructureGenerationRun.structurePreview` is only
`StructureDraft` labels; it omits evidence IDs. A failed run has no
`structureResult`. Preview text alone cannot authorize continuation.

The avoidable final-organization call in this attempt took 83,395 ms and reported
29,721 input / 12,476 output tokens; its conservative reservation was 146,009
units. Those are one observed call's costs, not a promised saving or runtime.

## Minimal next implementation: resume a proposal, not a pipeline

Extract the existing review loop and final coverage assembly into shared service
functions, tentatively `reviewStructureProposal()` and
`finalizeStructureProposal()`. Both normal generation and a new controlled
`continueStructureReview()` must use them. The continuation must have no path to
`completeOutline()`, source extraction, or pack generation. Reuse these existing
functions rather than introduce a second validator:

| Existing function/file | Continuation responsibility |
| --- | --- |
| `loadStructureCorpus()` / `structureCorpusFingerprint()` in `structure-generation.service.ts` | Reload the exact selected current originals and compare the intended batch, replacements and ingest identities. |
| `validateCachedSourceExtraction()` and `source-evidence-cache.service.ts` readers | Cache-only reconstruction of all 671 sections and exact evidence ledger; a miss or invalid row stops before any paid call. |
| `validateOutline()` / `planOutlineGrounding()` | Reconstruct the retained proposal and all objective bindings; preserve global source aliases and objective order. |
| `selectOutlineGroundingBatch()` / `validateOutlineGroundingRows()` in `structure-outline-grounding.ts` | Review only unresolved exact objectives; retain valid siblings; one invalid-only correction per previously unreviewed objective. |
| `outlineGroundingReceipt()` / `admitGroundedOutline()` | Build a new complete receipt and admit only supported rows with valid positive coverage. |
| `createStructureGenerationRun()` / `updateContentRun()` / `assertContentRunActive()` in `content-runs.service.ts` | A new linked child run, CAS progress and cancellation checks; never reopen or overwrite the terminal parent. |
| `applyGeneratedHierarchy()` in `classification.service.ts` | Existing completed-run/source-currentness adoption gate; continuation never applies Topics/LOs automatically. |

For future runs, persist an immutable checkpoint immediately after validated
final organization and before the first review send. Add a versioned checkpoint
reference to `StructureGenerationRun` in `server/src/types/domain.ts` and the
corresponding `ContentRunUpdate` allowlist. Its hash binds course/parent run,
options, exact full proposal, ordered evidence ledger, full `GroundingObjective`
bindings/content hashes, global alias-to-original locator/text hashes, source
fingerprint/selection, extraction-row identities/hashes, review protocol and
model configuration. Store immutable review rows with their actual attempt,
response and proposal hashes, plus pending IDs and consumed correction counts.
Guard serialized size; split immutable evidence/checkpoint records if necessary
rather than exceed Mongo's document limit. Original texts remain reloadable;
aliases and text hashes cannot substitute for resolving their full originals.

For this existing failed run, a controlled, explicitly labeled
`retained-artifact-import-v1` path can reconstruct that checkpoint without a
model call. Pin the terminal result/code/capture files, validate the captured
final-organization output against the exact cache-only evidence, and reconstruct
all 142 bindings. Compare every available historical binding and finding, not
only counts. The L96 replay already reconstructed all seven sibling production
hashes exactly. Require the same check for all 102 rows. If the evidence ledger,
proposal, completed response or any source cannot be reproduced, stop; do not
silently regenerate it or import arbitrary browser-supplied JSON as authority.

### Preserve history while handling negative-coverage compatibility

Nineteen of the 20 historical v2 negative findings carry nonempty
`coveredEvidenceIds`. Current admission correctly rejects nonempty negative
canonical coverage. Do not mutate those 102 historical findings or weaken
admission to accept them. A child-only deterministic projection references the
immutable parent finding hash and retains its original bytes. Preserve every
status, reason, topic finding and objective/source binding. For negative rows
only, derive canonical coverage `[]` and retain the old claims as
`ignoredModelCoverage` with `authoritative: false`; validate all identity/source
constraints first. Positive findings remain byte-identical. This is explicit
parser compatibility, not a new semantic verdict or a v1 reinterpretation.

The exact retained corrected L96 row can receive that same current-parser check:
it remains **unsupported**, credits zero coverage, and retains eight ignored
claims. Its two consumed semantic attempts do not reset. It needs no third paid
review. The resulting child begins with 103 resolved reviews, of which 21 are
withheld, and dispatches only L104–L142: 39 previously unreviewed objectives.
See `negative-coverage-replay.json` for the offline before/after proof. This is
the planned child state, not a claim that it is already persisted or completed.

## Currentness, identity and cost gates

The child requires the same course, intended ten-file selection, options and
source fingerprint
`32c828c5aa9a4778b8f6b0802026a2861968d09bc0362a7be833c14b310a97ed`.
Reload and compare before dispatch and finalization. An added/replaced/deleted
source, reingest, changed original, changed evidence assignment or changed LO
wording invalidates exact continuation. Advisory-only material revision remains
governed by the existing fingerprint policy. Fingerprints intentionally ignore
ordering; additionally preserve the checkpoint's ordering and aliases and require
every objective content hash to match. Same `L38` or same filename is insufficient.
Retain the reviewed source-vs-grouping protocol/model identity; an incompatible
semantic protocol change requires a separately declared re-review.

Use the normal course fence/active-run uniqueness and short CAS writes. A repeated
continuation request resolves to the existing child; it cannot buy another retry
cycle. Recheck current source eligibility inside final writes. Keep cancellation,
course deletion and standalone best-effort limitations explicit. No question,
student, Canvas or hierarchy writes belong to continuation.

Budgeting must preserve cumulative parent cost. `AuthoringBudget` currently has
no durable hydration API, so merely constructing its usual fresh 2m instance is
insufficient. A scoped continuation gate must reconcile the finished parent
ledger/transcripts, require zero pending sends, pin its immutable prefix, and
append all actual dispatches including JSON corrections. For this attempt the
unchanged 2m ceiling leaves **995,670 conservative units** and the declared
100-send outer limit leaves 80 sends. Do not reclaim prior failed costs, settle
them retrospectively or reset limits because a new run ID exists.

A conservative prospective child cap is **18 actual sends**, at most **48,000
input-estimate units including system/correction text plus 6,000 output units**
per send: 972,000 maximum new units, below that remaining allowance. Use the
smaller verified remaining shared allowance if another reservation consumed it.
Native defaults remain unchanged; add a restricted child budget rather than
raise them. Plan the 39 exact pending objectives before dispatch; approximately
five to eight first review batches is plausible from the observed eight-LO
batches, but not established until full-original prompt sizes are measured.
Corrections and hidden SDK retry visibility remain separate limitations; every
observable actual send counts toward 18. If a full-original request exceeds the
ceiling, split objectives deterministically without trimming sources. If an
individual objective or the total cannot fit, stop with its checkpoint rather
than raise the cap. Six-thousand-token reasoning exhaustion was observed, so
completion within this cap is an experiment outcome, not a guarantee.

## Separate evidence rebind: historical L38 / E205 / S136

This fault belongs to the older **111-LO** run
`6ad2cae88e3e260e233c924c`. Its L38 is not L38 in the newer 142-LO proposal.
The old final organization assigned E205/S136 to L36, although L36's wording
omitted management/future-return evaluation; old L38 included that capability
without E205/S136. S136 is the exact Chapter 4 chunk 42 classroom activity about
historical Jensen alpha, management and future investment. This is a real
assignment mismatch, not evidence that the whole chapter lacks the activity.
See `OUTLINE-REVIEW-PROBE-2026-10-16.md` and its structured source audit.

Treat a foreign alias as a possible repair signal, never permission to cite it.
Resolve only the current proposal's own global extracted points and exact
original locators; verify E205's quote/passage binding to S136. Create a new
proposal branch recording old/new binding hashes. A minimal candidate adds E205
to L38 without changing its wording; it does not delete E205 from L36 silently.
If removing or rewriting L36, re-review that changed binding too. Preserve L39
and unrelated siblings. Do not splice this branch into exact 142-LO continuation.

Permit one bounded proposal cycle followed by independent full-original review
of each changed LO. A deterministic evidence addition needs no proposal model;
at most two review calls suffice for L38 with one invalid-only correction.
An alternative wording-repair model adds one call; changing L36 adds up to two
review calls. Charge them to a prospectively declared remaining budget; do not
assume this optional branch fits the exact-continuation allowance.

An explicit unmarked teaching activity can support an LO asking students to
evaluate a claim. It cannot supply a question's answer key or prove that positive
alpha implies management skill/future performance. A proposed `supportKind`
(`explicit-proposition`, `formula-application`, `explicit-teaching-activity`)
would make that distinction inspectable while retaining independent source
status. Review actual wording; a claim of proof still needs proof. New question
generation must separately establish derivable solutions, numerical conditions
and missing premises. Neither a rebind nor activity classification forces a
positive review, infers an unmarked answer or expands source scope.

## Required offline tests before any new controlled run

- Exact fixture replay: 142 unchanged bindings; all 102 parent bytes/hashes
  preserved; 82 positive rows unchanged; negative projections credit zero;
  retained L96 remains negative; only 39 pending IDs can dispatch.
- Reject stale/foreign course, parent, proposal hash, model/protocol, source
  locator, quote, extraction identity, or nonterminal/in-flight parent. Reject
  source additions/replacements/reingest and silent alias/order changes.
- Reject missing/duplicate/extra checkpoint IDs, tampered parent positives,
  fabricated coverage and incompatible v1 migration. Repeated continuation
  requests/worker retries cannot double-dispatch or restore used corrections.
- Exercise exact 995,670-unit remainder, 18-send limit, JSON correction charges,
  unknown-usage retention, currentness changes between batches and finalization,
  cancellation, and a cache miss. Extraction/organization callbacks must throw
  if invoked by continuation.
- Rebind controls: exact older L38 gains only E205/S136 and a new binding hash;
  false aliases, a different run's L38, unrelated nearby originals and invented
  option-pricing techniques fail. Explicit activities do not manufacture answer
  proof. Wording changes invalidate old reviews; untouched siblings retain theirs.

Implementation and new paid validation remain future work after the active
source/code freeze ends. A complete review would establish pipeline completion
for this fixed proposal only; teacher quality, recall and reduced review time
would still require separate evaluation.
