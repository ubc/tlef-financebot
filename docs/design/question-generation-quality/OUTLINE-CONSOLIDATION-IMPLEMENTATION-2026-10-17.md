# Source-preserving consolidation: core and authenticated parent

This checkpoint implements a proposal-validation core and an authenticated
parent reader. It does not yet create, review, expose or Apply a consolidation
child. The experimental capability selector remains opt-in. Passing structural
controls is not evidence of better model judgments or usable question yield.

## What changed

`structure-outline-consolidation.ts` accepts two to four explicit supported
parent objective IDs. An untrusted proposal must choose explicit surviving IDs,
replacement wording and predecessor-to-successor lineage. Three objectives can
become two; two can remain two with narrower wording. It never chooses a broad
winner automatically. It preserves unaffected objects, global IDs/coordinates,
source aliases separately from original corpus IDs, and each original member's
recorded credit obligations. Source scope comes from each survivor's explicit
predecessors, rather than the entire selected group.

Every replacement survivor requires fresh source review. Child nominations and
incoming/outgoing comparison obligations are recomputed, including affected
third peers. Missing historical comparison rows require the complete child
comparison work. Parent witnesses remain labelled observations; neither assigned
IDs nor old credits establish fresh source support or semantic distinctness.
The minimum replacement source-target list does not authorize copying unchanged
parent source rows into a child review.

`structure-consolidation-parent.service.ts` requires the caller's matching-course
transaction. It reuses the complete source, raw-history, result and budget
checks of the capability adoption service, then binds exact parent/checkpoint/
progress/raw-history identities. It reconstructs canonical findings in planned
ID order and the complete alias-aware context from lazy batches. Its private
cloned receipt contains the authenticated terminal budget, never an older
checkpoint budget prefix. `prepareStructureOutlineConsolidation` joins this
reader to the pure plan. Neither function authorizes spending or a hierarchy
write.

The reader also accepts a genuine failed, completely reviewed all-held parent:
the exact `structure-capability-no-distinct-supported-objectives` failure,
no result property, zero eligible objectives, at least one source-supported
finding, complete diagnostics and raw replay, and the real finalizer's exact
failure. Ordinary Apply continues to reject failed runs. Imported diagnostic
fixtures and absent/unknown selectors do not become production authority.

## A reproduced false refusal and its fix

The first implementation compared terminal synthesis diagnostics directly with
the immutable checkpoint. Fresh generation clones that checkpoint before review
and later appends one diagnostic when a logical review response fails validation.
A corrected review can therefore be authentic while its terminal diagnostic
array is longer than its frozen pre-review array.

The fix derives exactly the worker's appended records from independently
replayed raw history: the first canonical failure reason, truncated to 600
characters, once per logical dispatch with its exact item and content attempt.
It preserves the entire frozen prefix and other synthesis metadata. Missing,
extra, duplicate, reordered or edited records refuse. Internal provider JSON
retries alone do not create a worker diagnostic. Continuation has no such
callback and must retain its frozen synthesis receipt.

The scripted reproduction fails under the captured old implementation and
passes after the fix. It includes nonempty synthesis metadata, a preexisting
organization diagnostic, two corrected logical dispatches with multiple failed
LO rows, and a real BSON round trip. The focused run changed from 57/58 to
58/58. These are separate executions of the same scripted fixture definition,
not byte-identical captured provider inputs or a real worker run.

The independent reviewer identified a related pre-existing completed-result
synthesis drift. This failed-parent-only change does not fix that ordinary
Apply path. It remains explicit follow-up work with its own reproduction.

## Verification and retained actual inputs

The combined current-source regression passes **21 suites / 735 tests**, complete
project typecheck and scoped lint on 23 files. The 58-test diagnostic run and
104-test pure/distinctness checkpoint overlap the combined denominator and must
not be added. Model judgments and transaction/storage boundaries are scripted
or mocked; production parsers, receipts, finalizers and the BSON codec are real.
No application database, provider, queue, embedding or OCR call occurred in this
engineering checkpoint.

The actual retained 142-objective v2 input has five file-only controls. Explicit
L105/L106/L128 consolidation produces an unreviewed 141-objective proposal with
242 required child comparison directions. Dropping recorded E690 credit or
selecting an unsupported parent refuses. Equal-count narrowing remains
unreviewed. Full exact proposals, originals, before/after contexts and errors
are retained; their acceptance is structural, not semantic.

The actual counterfactual child cannot currently fit the retained terminal
allowance without source reuse. Its 594 full original rows alone occupy 501,642
UTF-8 JSON units. At most four candidates per review means at least 36 reviews
and 216,000 reserved output units: a 717,642 lower bound against 545,827 remaining
units. This omits proposal work, learning-point definitions, instructions, native
escaping and corrections. It is neither an actual rendered packing nor provider
usage. The source-only/imported historical input is not an eligible durable
parent. A future runner must refuse known-impossible work before a proposal
send, rather than reset the budget, clip originals or treat old observations as
fresh reviews.

Evidence is retained under
`audit-results/outline-consolidation-core-2026-10-17/`: `closeout.json`,
`actual-r2/`, `root-diagnostic-red-r1/`, `root-diagnostic-green-r1/`,
`combined-r1/`, `independent-parent/r1/`, `independent-parent/r2/` and
`runtime-next-r1/`. Earlier compiler/loader/verifier failures remain available.
The corrected actual-data fixture v2 and its root inspection remain separate
from the invalid v1 alias join.

## Required next integration

The dedicated durable child/cycle, full-work admission, explicit-ID checkpoint
and packing, fresh raw review persistence, stable-ID finalization, lost-credit
shortfalls, transactional child Apply and Instructor UI remain unimplemented.
The existing names-only repair and exact continuation cannot safely stand in
for those components. Actual semantic recovery and professor acceptance remain
unestablished. The implementation sequence and retained runtime map preserve
these obligations; this checkpoint is a foundation, not a completed feature.
