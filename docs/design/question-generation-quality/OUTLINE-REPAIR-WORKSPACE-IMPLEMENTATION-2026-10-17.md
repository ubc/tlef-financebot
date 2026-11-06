# Instructor outline repair workspace

## Problem and implemented behavior

The source receipt could show retained learning points without giving the
Instructor a product path to request a bounded wording correction. The internal
repair engine did not have an HTTP read projection or a reviewed-child Apply
guard. The previous workbench also followed the newest run directly: a failed
child could replace the visible parent draft and its local edits.

Course Structure now exposes **Repair outline wording** beneath the existing
generation status. The Instructor chooses either uncredited points assigned to
supported objectives or unsupported/uncertain wording. Each request selects up
to two objectives; coverage requests name up to eight points per objective.
Exact original quotes remain inspectable. Uncredited points are review prompts,
not a measured curriculum gap or a guarantee that a longer LO is better.

The confirmation shows the original wording and requested point text. The
existing durable worker creates one child, proposes wording only and separately
reviews changed objectives against their full own original evidence. Coverage
repair must gain the requested credits while retaining every prior credit.
No repair, unresolved reviews and coverage loss remain shortfalls. Original
drafts are not rewritten, and no hierarchy is added automatically.

The workbench retains per-run teacher edits and checkbox selections across
child failures and reloads. Stored edits are bound to actor, course, run and the
fresh original themes; source IDs/indexes are restored from the server, never
trusted from session storage. A previously unknown latest run remains
quarantined until its parent/child identity is verified. Failed/malformed reads
do not briefly enable Apply. The Instructor explicitly chooses the repaired
draft, then uses the separate existing Apply action.

## Authority, speed and cost

The GET projection performs no model work and returns bounded source-linked
rows, before/after wording, review findings, cycle status and conservative
allowance. Full provider/checkpoint data stays private. The POST accepts only
the two strict selection shapes documented in the API contract. Both use the
same single checkpoint cycle, queue and SSE stream; switching modes or targets
does not obtain another attempt.

Repair uses already retained originals and extraction/checkpoint data, without
a new extraction stage. It has ceilings of ten new observable sends, 48,000
input and 6,000 output conservative units per send, and 540,000 new units,
also constrained by the original remainder. Missing provider usage remains
unknown; conservative reservations are not billed tokens or a cost estimate.
These bounds limit extra work but do not establish faster or cheaper useful
generation. No real-model latency or yield comparison follows from UI tests.

Repaired Apply requires transaction support. It validates the matching course
scope before reading the requested run, then rereads complete authority using
the actual transaction session. Parent, checkpoint, progress, branch, source,
proposal, review, credit-preservation assessment, budget and the full production
finalized result must agree before hierarchy or material writes. Stale,
malformed, missing and unresolved authority refuse adoption. Ordinary historical
nonrepair Apply retains its existing standalone compatibility behavior.

Teacher label edits are intentionally allowed. The response distinguishes
reviewed stored wording from `instructor-edited` wording and counts changed
labels; the UI explains that model review did not cover those subsequent edits.
Normal trimming does not turn a stored label into a new teacher edit.

## A persistence-only false refusal found by real Mongo

The first owned-Mongo attempt stopped because the synthetic fixture used the
global section ID where the original-evidence join requires its source-local
passage ID. That fixture defect was corrected without changing the source gate.
The next two attempts reached a completed child, then exposed a product defect:
the actual finalizer emitted an own `coverage.synthesisInput: undefined`, which
the default Mongo/BSON writer persisted as `null`. Fresh finalization omitted
that key during JSON hashing, so otherwise equal stored results were refused.
The failure was invisible in the earlier custom-finalizer mocks.

Fresh finalization now omits an absent optional synthesis receipt. Full-result
comparison normalizes only null/undefined absence of that one optional field so
historical BSON-null results remain comparable. Non-null synthesis receipts,
required fields, extra fields, source quotes and all review/coverage authority
still have to match. Actual BSON round-trip controls cover both representations
and changed receipts. This is a representation fix, not a relaxed semantic
verdict, another repair cycle or an additional model call. All failed runs and
their owner-checked cleanup receipts remain available in the book.

## Verification boundaries

Evidence is collected under
`audit-results/outline-repair-workspace-2026-10-17/`. Exact prior source copies,
unchanged fixture input, observed failures, current source pins, direct-service
tests and compiled UI screenshots are retained separately. The final combined
run passes **26 suites / 737 tests**, complete project typecheck and nine scoped
linted files. Focused backend **360 tests** overlap that scope. The compiled
browser run passes **13 cases**, including the unchanged-input prior/current
pair, with eight screenshots and 13 readable API I/O receipts. These counts are
separate denominators, not one combined quality score.

The actual disposable replica-set run passes **18 groups**. Eleven authority
reads share the same actual ClientSession; matching nested Apply commits one
Topic, one LO and one material assignment. Twelve negative controls leave
hierarchy/material assignments unchanged. Both direct guard and Apply reject a
foreign outer course before requested-course operations. An exception injected
after an observable in-transaction LO write rolls it back. Reusing the cycle
does not reset the child. All three failed predecessor runs and the final run
drop only their own namespaces, with zero residual collections; no application
database is used. The final run records 34 scripted completion calls separately
from zero real provider/SDK/embedding/vector/job/forbidden-boundary calls and
nullable reported provider usage. It is not a latency or quality benchmark.

Authoritative receipts:

- [Combined regression and checks](../../../audit-results/outline-repair-workspace-2026-10-17/regression-r3/results.json).
- [Focused backend and BSON controls](../../../audit-results/outline-repair-workspace-2026-10-17/backend-tests/verification-r7.json).
- [Compiled browser I/O, exact prior compilation and screenshots](../../../audit-results/outline-repair-workspace-2026-10-17/client-tests/verification-final.json).
- [Reviewed source-pinned Mongo preparation](../../../audit-results/outline-repair-workspace-2026-10-17/local-mongo/prepared-r5/declaration.json).
- [Actual Mongo results and cleanup](../../../audit-results/outline-repair-workspace-2026-10-17/local-mongo/run-r4/results.json).
- [Final verification and source archive](../../../audit-results/outline-repair-workspace-2026-10-17/verification-final.json).

Mocked route/service tests establish local authorization, validation,
orchestration and refusal behavior. Static browser fixtures run compiled
production views with every API intercepted; their source findings and model
outputs are synthetic. A separately reviewed harness uses only a new exclusively
owned namespace on isolated loopback Mongo 27029, with provider, embedding,
vector, queue, remote-network and subprocess boundaries denied before imports.
It exercises actual sessions, source checks, persistence and rollback with
authored source text and scripted completions. It does not exercise HTTP/SAML,
PDF ingestion, real provider behavior or semantic teaching quality.

The ten-file real outline observation is unchanged: 599 pages, 671 chunks,
119 supported and 23 withheld LOs, and 379 model-derived points without credited
coverage. This product workflow does not recover unread visual content or prove
that those points should all become LOs. No useful recovered LO, higher valid
question yield, reduced professor review time or model ranking is claimed.
Fresh bounded real-model evaluation and teacher calibration remain necessary.
