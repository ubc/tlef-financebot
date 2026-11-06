# Exact current-Bank coverage outside semantic memory

This change closes a deterministic recency gap for new independent v2 questions.
It adds no provider or embedding call. It does not establish semantic novelty,
teacher acceptance, better saved-question yield or lower overall authoring cost.
The isolated real-Mongo smoke passes nine groups and compiled UI acceptance
passes five cases. These engineering scopes are separate from semantic model
quality and teacher acceptance, which remain unverified by this repair.

## Observed gap and same-input repair

The existing semantic memory retains at most 120 recent same-LO heads and 80
recent cross-LO heads for v2. Exact comparison checks every entry loaded into
that snapshot, including entries omitted from the rendered prompt, but cannot
check older heads that were never loaded. Embedding ranking occurs after this
selection and cannot recover those older questions. The existing `truncated`
flag already discloses this bounded scope.

The retained file-only counterfactual placed an identical current question at
position 121 in a same-LO Bank and position 81 in a cross-LO Bank. The actual old
module missed both. The new actual lookup, on the same archived candidate and
Bank contents, checks 121 and 81 current versions respectively and finds one
exact match in each. The old immutable-original pin already worked and remains
required for independent regeneration; the separate older-duplicate gap was not
a failure of that pin.

The original evidence is preserved under
`audit-results/bank-memory-exact-gap-2026-10-17/`. The new SHA-pinned replay,
complete inputs, executed before/after source copies, scan receipts and thirteen
controls are under `audit-results/bank-memory-exact-repair-2026-10-17/`.
`results.json` has SHA-256
`e02b10d507daf0462944e0ba09b1db6106760f1c16d27a3fce0fc9d47abb7d73`.
An initial mock projection-order error is retained separately; correcting that
harness did not change production predicates or any original receipt.

## Versioned authoring contract

Fresh durable `grounded-memory-v2` enqueue selects the server-owned
`exactBankProtocol: 'course-exact-bank-v1'`. Durable input, worker restoration,
requirements and exact retry preserve the recorded selector. Fresh durable
regeneration selects it only after same-UUID recovery has returned any existing
request. Historical absence stays absent, including exact retries and cached
UUID recovery. Unknown selectors or incompatible policies are refused rather
than silently falling back to a legacy check. This is not a new client request
parameter or permission.

Only `create-independent-task` performs this lookup. `edit-existing` and
`create-variant` retain their existing intentional-overlap rules. Existing no-op,
pinned-original, numerical, source, answerability, task-demand and teacher-clause
checks remain in force. The lookup does not make a number-only variant an
independent task or automatically reject a possible semantic variant.

## Lookup and receipt

`lookupGenerationExactBank` in `generation-memory.service.ts` scans active current
heads across the course, independently of LO and recency. Its scope includes
Draft, Pending Review, Reviewed, Approved and Paused heads. It follows each
head's exact `currentVersionId` and verifies the version belongs to that head.
Obsolete versions, archived heads and foreign courses cannot supply a match.

The lookup uses keyset pages of 128 heads and projected current question content.
It computes the existing versioned content fingerprint locally, including
option roles and explanations, `numericKind`, parameter definitions and derived
formulas. Option keys/order and normalized whitespace do not create a new
question. This definition is narrower than student-visible duplication or
pedagogical equivalence: changed feedback, kind metadata or a different task
expression may require the separate bounded semantic comparison. No inferred
kind label or broader equivalence rule is introduced here.

Current contents are sufficient even for historical/imported questions with no
pedagogical fingerprint. The lookup does not read prepared descriptors, launch
the paid historical-memory preparation endpoint, write an index backfill or
send the whole Bank to the model. The semantic prompt window remains 120/80.

The guarded server assessment records `exactBank`:

```text
protocol, courseId, candidateHash, bindingsDigest
status: complete | incomplete
incompleteReason?: head-limit | deadline | invalid-head | missing-or-invalid-version
headsScanned, versionsChecked, missingVersions, invalidVersions, invalidHeads
unscannedHeadsLowerBound, headBatches
exactMatchCount, matches[<=12 current question/version/state references]
matchesTruncated, consistency: best-effort
```

The digest binds the ordered scanned head/version/state/content-hash tuples,
including nonmatching current questions. A current-version or content change
therefore changes the binding even if the candidate itself is unchanged.
`unscannedHeadsLowerBound` records observed look-ahead only; it is not an estimate
of the total Bank size. Full retained references are bounded while the scan
continues counting exact matches within its admitted scope.

Production ceilings are 20,000 heads and five seconds. Internal controls may
lower those limits but cannot raise them. Each database read receives the
remaining `maxTimeMS` and the caller's session. Missing/corrupt current data,
deadline expiry or excess heads yield explicit incomplete receipts. Unrelated
database failures propagate. Zero matches with an incomplete scan is not proof
of absence, and a complete unfenced scan is still a best-effort observation of
the Bank during that read.

## Quality and final-write admission

For selected independent requests, the source-quality stage performs the local
scan before dispatching its quality-review model call. An exact duplicate or
incomplete scan remains withheld, with the receipt retained and no quality model
call sent for that rejected check. Earlier generation/validation stages may
already have incurred model work; this is not a zero-cost generation workflow.

Before public save or explicit regeneration adoption,
`assertGenerationExactBankCurrent` rechecks the server receipt and runs a fresh
lookup inside the existing course-fenced write. It binds policy, candidate,
course, complete counts and full head digest; an excluded-original receipt
cannot authorize a new independent save. A new duplicate, incomplete lookup or
changed Bank cannot reuse the old pass. Paid work remains outside the fence.

| Condition | Adoption error | HTTP status |
| --- | --- | --- |
| Missing, malformed, mismatched or noneligible receipt | `generation-exact-bank-receipt-invalid` | 422 |
| Exact current duplicate appears | `authoring-exact-bank-duplicate` | 409 |
| Fresh lookup cannot finish or current records are incomplete | `authoring-exact-bank-incomplete` | 503 |
| Complete Bank bindings changed without an exact duplicate | `authoring-memory-changed` | 409 |

An incomplete adoption check preserves the retained candidate for retry. A
confirmed duplicate or changed prerequisite does not authorize replacement.
Historical adopted UUID replay retains the existing idempotent return path.

Supported transaction deployments use the existing course fence to coordinate
the final check with the write; standalone diagnostic mode cannot claim the
same concurrent-persistence guarantee. The code additionally declares the
`questions` query index `{ courseId: 1, _id: 1 }`. This checkpoint does not prove
that index has been applied to an application database. The scan consumes CPU,
database reads and transaction time; no production latency or cost benchmark is
established. It adds zero model tokens, not zero operational cost.

## Completed checks and pending acceptance

The final unchanged combined rerun passes **29 suites / 932 tests**. The first
combined run retained 931 passes and one Supertest `ECONNRESET`; it is preserved
alongside the successful rerun without assertion changes. The memory helper's
44 tests and the separate 46 admission tests overlap that combined denominator
and must not be added again. The earlier adoption and integration runs are also
overlapping checkpoints.

These tests exercise the actual scanner, quality admission and final assertion
with in-memory collections: 121/81 recency omissions, pagination and sessions,
unprepared/stale fingerprint independence, current ownership, obsolete/archive/
foreign exclusions, missing/corrupt data, caps/deadlines, bounded match IDs,
historical selectors, intentional edits/variants, receipt tampering and changed
candidate/Bank bindings. The simulated course-fence concurrency control is not
a real Mongo transaction test. The file-only replay additionally preserves all
seven original observations and a current-version binding-change pair, with
zero provider, embedding, network, real database, saved or adopted work.

The later isolated local Mongo smoke completed nine groups on an observed
replica set. It read 202 real synthetic current heads, found the two duplicates
omitted by the legacy 200-head window, propagated sessions and refused missing
versions, changed heads and post-review inserts. The actual course-fence wrapper
allowed one competing transaction and rejected the other with
`authoring-exact-bank-duplicate`; exactly one transient owned head committed.
The new index was used automatically in the isolated query explain. The run
completed in 913 ms across all controls, not end-to-end question generation,
and owner-checked cleanup dropped its new database. No application database or
provider was used. The default typed endpoint authentication failure and the
harness-only explain API failure remain retained; the final run used an approved
loopback test endpoint without changing app configuration. See
`audit-results/bank-memory-exact-repair-2026-10-17/local-mongo/run-r5/results.json`.

Five compiled, API-intercepted UI cases also pass. Generation and regeneration
checks show exact scan status/counts separately from semantic memory; historical
absence has no invented counts. Desktop light and mobile dark scoped WCAG A/AA
checks report zero violations. These receipts are synthetic UI fixtures, distinct
from actual Mongo query results. See
`audit-results/exact-bank-ui-2026-10-17/verification.json`.

These completed checks establish this bounded exact-content repair; they do not
complete generation-quality acceptance.
The earlier R6 paid-probe declaration remains historical and unexecuted; these
offline changes grant no new API permission. No new real model judgment,
semantic novelty calibration, valid saved-yield improvement, teacher review-time
reduction or model ranking is established.
