# Exact outline review continuation — implementation and controlled acceptance

The production backend can retain a validated organized proposal before review
and continue its unresolved original-bound objectives in a linked child run.
This document describes implemented safeguards and offline evidence. It does not
claim that the new paid continuation has completed, or that its model judgments
are teacher acceptance.

## Production path

`structure-review-checkpoint.service.ts` stores an immutable, size-limited
checkpoint, revisioned progress, and separate claimed/validated review-attempt
records. The checkpoint binds complete originals, extraction rows, proposal,
ordered aliases, objective content hashes, source selection, model/provider
identity and review protocol. A changed source, ingest, intended selection,
binding, model or protocol refuses continuation. Advisory-only classification
changes follow the existing original-source identity policy.

Normal organized generation and `continueStructureReview()` use the same
`reviewStructureProposal()` loop, current validator, final admission and source
coverage assembly. The child branch contains no extraction or organization
callback. It revalidates retained extraction against complete current originals
and checks source/current-run eligibility before each native admission, after
each reply and before the completed-result write. Supported rows retain the
existing source and positive-coverage gates; negative/uncertain rows credit zero
coverage. A model rejection is not converted into a positive verdict.

The child is unique per checkpoint. Repeated requests return the existing child
without resetting consumed semantic attempts or native cost. The worker now
atomically claims `queued → running` using status/revision CAS. A duplicate
Agenda delivery exits quietly before the failure handler, so it cannot fail or
dispatch beside the winning worker. A claimed response with uncertain dispatch
remains blocked for explicit inspection rather than silently buying a retry.

Model calls remain outside short course-fenced writes. The controlled runner
requires audited Mongo transaction support. Standalone production consistency
retains the existing best-effort limitation. No continuation automatically
applies Topics/LOs or writes questions or student records. The continuation
service is internal; this change does not add a browser JSON checkpoint-import
endpoint or a new frontend button.

## Actual retained proposal and compatibility proof

The failed parent is `6ad2d15e19a66b1237767be5`, in the isolated ten-file course
`6ad2ad04e474ab8460b47c07`. Its immutable archive SHA256 is
`b9248725544524cb4541a297df0d9230769d35507dc9c7c441e25fdf81300fa4`.
Root's read-only cache reconstruction produced the exact 142-LO/31-topic body:

- `checkpoint-body.json`: SHA256
  `82aaab21c39e92a113ae5405e4cec4650a3c1a42bcd91d24f9a7657ce7aefd69`.
- `projection-independent-audit.json`: SHA256
  `4cdeeb3981b311f43083806206567554f623db2febc54535db0a4332a7d3af1a`.

Both files are under
`audit-results/quality-lab-outline-continuation-2026-10-17/`. The independent
file-only projection verifies all 102 historical full bindings and finding
hashes. All 82 supported findings remain byte-identical. Nineteen historical
negative rows only project old coverage claims into non-authoritative ignored
diagnostics; their original bytes remain immutable. Retained corrected L96
remains unsupported with both semantic attempts consumed and eight ignored
claims. No new semantic judgment occurred during this projection.

The resulting starting state is **103 resolved, 21 withheld, 39 pending**,
exactly L104–L142. Current selection of those pending objectives spans **10
first-pass batches**, rather than the earlier design's five-to-eight estimate.
Every selected prompt retains complete own originals and unchanged global
identities. The file-only preparation measures and pins these exact prompts;
an over-cap prompt stops preparation rather than trimming its sources.

## Cumulative costs and observation

The original phase ledger is appended in place; its 20 reservations and
**1,004,330 conservative units** are never rewritten, reclaimed or reset. The
unchanged cumulative ceiling remains 100 reservations/2,000,000 units. This
specific continuation has the additional prospective limits:

| Control | Maximum |
| --- | ---: |
| New observable native-attempt reservations | 18 |
| Actual shaped input estimate per send, including correction/system text | 48,000 |
| Output reservation per send | 6,000 |
| Additional conservative units | 972,000 |
| Original prefix plus maximum additional units | 1,976,330 |
| Total configured native completion deadline | 180,000 ms |

Ten first passes leave at most eight additional sends, including portable JSON
correction and unresolved-only semantic correction. Completion under these
limits is not guaranteed. A phase reservation can precede native-budget denial;
it stays charged and reduces remaining dispatch allowance. Hidden provider/SDK
retries remain an explicitly unknown visibility boundary.

The durable pre-SDK hook reserves the larger of the raw prompt or the native
single-user JSON streaming envelope, plus system bytes and 32. This covers
streaming exactly and intentionally overreserves nonstreaming at that hook.
Progress records the estimator label. The outer phase ledger measures the
actual shaped facade envelope and keeps all unknown/failed work charged.

Record-only observation no longer adds `onText` and silently forces streaming.
This historical continuation explicitly declares `transport: 'stream'` to match
the original retained native review options. The runner does not replace
`completeJson`. It patches only writable facade methods and restores them in
`finally`, preserving actual arguments, reasoning effort, native budgets,
outer model usage, local attempt listeners and callbacks. Private raw replies
and exact shaped inputs accompany independent Mongo model-call receipts.
Facade entries, reservations, known native denials, actual observed sends and
unknown dispatches are reported separately. Exact unique response IDs establish
recorded links; unique option/time matches are labeled inferred, and ambiguous
links remain unresolved. Historical endpoint identity was not recorded; the
current provider identity is pinned prospectively without claiming historical
endpoint equality.

## Root-only guarded execution

`scripts/quality-lab/run-outline-continuation.ts` has strict arguments and two
modes. Preparation imports no production runtime/env/provider and opens no
database. It pins the body, proof, original parent/captures, ten PDFs, source
fixture, old ledger prefix, every server/quality-lab TypeScript file and package
lock. Run this only after all relevant source edits are frozen:

```sh
node --import tsx scripts/quality-lab/run-outline-continuation.ts \
  --mode prepare \
  --output audit-results/quality-lab-outline-continuation-2026-10-17/controls
```

Root must review that new declaration and its emitted SHA256 before live mode.
Use a new output directory and the exact printed declaration hash:

```sh
MONGODB_URI='mongodb://127.0.0.1:27029/?directConnection=true' \
MONGODB_DB_NAME='financebot_quality_smoke_retest_20261016' \
LLM_REQUEST_TIMEOUT_MS=180000 \
node --import tsx scripts/quality-lab/run-outline-continuation.ts \
  --mode live \
  --declaration audit-results/quality-lab-outline-continuation-2026-10-17/controls/declaration.json \
  --declaration-sha256 '<reviewed SHA256>' \
  --output audit-results/quality-lab-outline-continuation-2026-10-17/live \
  --confirm-root-owned-execution once
```

Live mode refuses remote/credentialed Mongo, replica discovery without explicit
direct connection, another DB/course/actor, unrelated active/Agenda work, source
or code drift, changed parent bytes, stale proof or an existing execution lock.
The allowed network is restricted to local Mongo27029 and the pinned provider.
It performs cache-only reconstruction and projection again before importing.
Bookkeeping writes include the ownership marker, scoped indexes, checkpoint,
progress, attempts, linked child, model usage receipts/sessions and course
`authoringRevision` transaction fences. It never starts Agenda recovery, clears
a database, applies an outline, publishes, writes student data or cleans up the
fixture. Terminal child/progress/attempts, old/new ledgers, immutable parent
snapshot and private raw I/O are retained, including after failure. An abandoned
execution lock is never stolen automatically.

## Offline checks

The integrated focused set passes **201 tests across nine suites**, covering
current-source/binding/protocol invalidation, exact retained compatibility,
durable costs, JSON correction, unknown work, CAS, cancellation, deletion,
native/explicit-stream observation, duplicate workers and runner guards.
The whole server/client typecheck and scoped ESLint pass. The runner's nine
tests use temporary files and synthetic minimal receipts; they make no API,
provider or database calls. The actual 103/39 proof is separately bound to
retained real artifacts. New paid continuation, complete final outline and
teacher quality remain separate acceptance results.
