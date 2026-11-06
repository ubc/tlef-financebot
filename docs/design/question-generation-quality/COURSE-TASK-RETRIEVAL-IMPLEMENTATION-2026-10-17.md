# Current-course task retrieval and required comparisons

Fresh opt-in v2 authoring now has a bounded local retrieval path across current
course questions, followed by explicit inference/path comparisons inside the
existing quality call. This repairs deterministic exposure and comparison-row
gaps; it does not establish semantic duplicate recall, teacher acceptance or
better saved-question yield. No paid model or embedding execution occurred in
this implementation's verification.

## Original problem and exact before/after evidence

The previous memory loader selected recent 120 same-LO and 80 cross-LO question
heads before ranking. Ranking could not recover older questions omitted at that
first step. A displayed ordinary comparator could also receive no explicit
comparison row, so retrieval alone would not close the second gap. The preceding
exact-content scan remains intact, but paraphrases, changed numerical values or
different explanations can have different normalized hashes.

The seven-case file-only replay retains an unchanged synthetic candidate and
Bank fixtures, executes the actual archived before-code and current after-code,
and preserves full rendered comparison memory. Older declared same-task targets
at positions 121 and 81 were absent from old prompts. They are now exposed and
required comparators in their prepared-profile controls. The raw-content target
without a prepared descriptor is exposed but is not one of the two required
comparators. Archived, foreign, obsolete-version and stale-profile controls keep
their distinct outcomes. All task-relation labels are scripted fixture intent,
not independently calibrated semantic ground truth.

Evidence: `audit-results/bank-task-retrieval-repair-2026-10-17/replay/results.json`
has SHA-256
`3d3a3e0b2d0946afab36aae9a29b7e32f0d393e66655d7c3b8df74845923d336`.
It links exact inputs and before/after sources. Its 544.679834 ms measures serial
file loading/transpilation and in-memory replay, not production generation
latency. The older gap/design receipts and archived production bytes remain
unchanged. See the [implementation plan](COURSE-TASK-RETRIEVAL-PLAN-2026-10-17.md).

## Versioned request and memory contract

- Fresh durable `grounded-memory-v2` runs and new durable regeneration select
  server-owned `taskRetrievalProtocol: 'course-task-retrieval-v1'`. It is not a new
  browser request parameter. Durable input, worker restoration and exact retry
  retain it. Historical absence and same-UUID recovery are not upgraded.
- Current active course heads are scanned in 128-head keyset pages, bounded by
  20,000 heads and five seconds. Current immutable ownership and effective
  content/profile bindings are checked. Actual current content supplies a
  fallback for missing prepared descriptors; no historical preparation/backfill
  is triggered.
- Local ranking nominates up to 64 global entries in at most 200 retained Bank
  entries, preserving recent fillers and the mandatory immutable original.
  The default rendered memory remains at most 12 entries / 12,000 characters.
  Complete means bounded traversal completed, not complete semantic recall.
- At most two mandatory comparators include the original when required. Their
  full question, options, feedback and numerical definitions must fit; otherwise
  an explicit shortfall stops the affected stage. For `create-independent-task`,
  every required ID needs one valid inference/path comparison; independent or
  uncertain novelty cannot bypass these rows. Explicit edits and variants retain
  their intentional-overlap/comparison semantics; common candidate/currentness
  bindings still apply. Shared vocabulary can legitimately have a negative
  same-inference/path comparison; a retrieval score never decides duplication.
- The current normal new path uses lexical/profile-text ranking with zero new
  embedding calls. An already retained query vector is reusable only with a
  known provider/model identity and the exact same query. Changed candidate
  queries use explicit lexical fallback, not a vector for a different query.

The optional guarded `taskRetrieval` diagnostic exposes protocol/ranker, query
and current-profile binding hashes, complete/incomplete status and reason,
scanned/checked/missing/invalid counts, descriptor/profile diagnostics and
nominated/retained/required IDs. The browser DTO omits raw query text, replay
vectors and full Bank content. Historical absence invents no counts.

## Candidate, repair and final-write currentness

Initial planning/generation persists incomplete retrieval diagnostics before
refusing the affected stage. Quality retrieves for the actual canonical
candidate. If the existing bounded repair changes that candidate, it refreshes
query/selection and returns the memory actually assessed. Independent
regeneration still pins its exact immutable original outside recency limits;
intentional edit/variant contracts remain separate.

Before save/adoption, server checks bind the candidate, actual selected memory,
required rows and assessment. Stored query/vector inputs are replayed locally
against current effective content/profiles inside the existing course fence.
An unselected effective profile change can invalidate the snapshot even when
raw question content has not changed. No model/embedding work is performed
inside the transaction. The independent exact-content final-write check from
the previous repair remains a separate guard.

Recognized invalid retrieval receipt/selection/assessment/query/scope/protocol/
policy/vector errors return 422; stale memory remains the existing 409 conflict.
`generation-task-retrieval-incomplete` returns 503 and retains the candidate for
an explicit retry. The client preserves previews and editor text on confirmed
422 failures, blocks stale replacement and clears only that question's recovery
keys. A transient incomplete 503 retains the same candidate/recovery key and
Replace retry. It never starts a fresh model request automatically.

## Verification and retained failures

These are distinct engineering scopes; their counts must not be summed as
independent quality observations.

| Scope | Terminal observation | Practical limit |
| --- | --- | --- |
| Current combined regression | 1,112 passed in 33 suites | Scripted models/collections; not semantic calibration |
| Same-input before/after replay | Seven cases | Synthetic task relations; zero provider/DB/network calls |
| Six retained input prompt/correction replay | 24 scenarios, 47 captures, zero refusals; maximum 23,662 against 24,000 | Conservative local estimates, no provider usage or semantic result |
| Compiled Instructor UI | 14 passed; desktop light/mobile dark scoped axe zero violations | Intercepted synthetic 202 checked / two nominations / two required rows |
| Actual isolated local replica-set Mongo | Eight groups; 1,952 ms total; owned DB dropped and namespace empty | Synthetic judgments and empty-source currentness stub; no product Draft |

The actual Mongo comparison loads 202 current heads (121 same-LO / 81 cross-LO).
The old retained window exposes zero older targets; current retrieval exposes
two. Twelve rendered entries occupy 5,524 characters. A shared-vocabulary
different-inference control is nominated without a semantic judgment. Actual
course-fence competing transactions commit one synthetic head and reject the
other with `authoring-memory-changed`. This is real replica-set transaction
behavior, not a standalone deployment guarantee. The 1,952 ms is for all eight
controls, not production generation latency or a 20,000-head performance test.

Preserved predecessor failures include the initial focused run's 20 missing-new-
receipt fixture failures, the first combined run's two stale prompt-literal
assertions, and five initial headroom refusals (P02 initial 24,027; P03 combined
correction 24,199). Fixtures/expected compact phrases were corrected without
weakening admission gates. Final focused regression passes 454 tests; the
combined predecessor has 1,110/1,112 passes. The UI's first attempt stopped before
browser launch on the sandbox loopback bind; scoped static execution passes all
14. Actual Mongo attempts retain the initial EPERM and VM-realm harness failure
beside the final result. Original receipts are not rewritten.

Final typecheck, 27-file scoped lint and diff whitespace checks pass. Exact
commands, current source pins, preserved archives and terminal pointers are
recorded in `audit-results/bank-task-retrieval-repair-2026-10-17/verification.json`.
The existing English HTML evidence book adds `#task-retrieval-repair` with
bounded input/output projections, file links and two synthetic UI screenshots.

## Cost and remaining acceptance

Local traversal adds database reads, hashing/CPU, profile validation and bounded
transaction replay. It dispatches no new embedding and introduces no standalone
model stage. Nominated memory and required rows still occupy tokens inside
ordinary existing planning/generation/quality calls. Newly missing required rows
may now consume the existing same-candidate correction allowance, which costs
tokens when executed; runtime model-call counts are not guaranteed unchanged.
Send, repair, per-call input/output and total reservation ceilings remain
unchanged. Per-call headroom does not prove every possible cumulative path fits
the total budget; no lower cost per useful question was measured.

There is no new paid semantic judgment, accepted generated outline, product
Draft/adoption, teacher-calibrated duplicate recall, false-refusal rate or saved-
yield result from this phase. Source meaning/visual interpretation and requested
difficulty still need their own acceptance. R6 is historical and unexecuted;
fresh prospective preparation plus explicit API approval is required before
paid execution. The full generation-quality goal remains unfinished.
