# Phase 1 Closeout and Future-Plan Impact Review — Stephen (Dev A)

> **Status:** analysis and coordination only; no implementation is authorized
> by this document. Proposed decisions require Stephen + Saurav review at the
> Phase 1 sync point.
>
> The repository's referenced `superpowers:writing-plans` skill was not
> available in this Codex session, so this coordination plan uses the same
> task/checklist structure manually. It does not replace the normative Phase 1
> or Phase 2 implementation plans.

## Goal

Close Phase 1 against the code that actually merged, decide which findings from
the 2026-07-22 product review are correctness prerequisites, and prevent Phase 2
from building on interfaces that the team already expects to change.

## Verified shared state (2026-07-22)

- Stephen's Phase 1 core work is merged in PR #18; the student UI rebuild and
  fixes are merged in PRs #22–#24.
- Saurav's Phase 1 Tasks 1, 2, 4, 5, 6, 7, 8, and 15 are merged in PRs #13–#17
  and #19–#21.
- Saurav's personal status/handoff and the shared core-plan checkboxes for
  Tasks 7, 8, and 15 are stale relative to GitHub. Do not infer unfinished code
  from those unchecked boxes.
- Task 13 is not implemented. Task 16, the joint exit demo and Approved-only
  proof, is not completed.
- PR #24's automated checks passed, but its status log explicitly says the
  material-ingest fix and AI hierarchy UI were not click-tested end to end.
- The shared Phase 2 plan defines Tasks 1–11 but does not assign `Owner` fields.
  `phase-2/Stephen/` and `phase-2/Saurav/` contain only placeholder READMEs.

## Scope boundary

This review does not edit Saurav's files, claim his tasks, change the API
contract, or start Phase 2. Shared contract and owner changes are sync-point
decisions and should land in a jointly reviewed documentation PR.

## Gate A — finish Phase 1 honestly

- [ ] **Reconcile coordination state with merged code.** Saurav confirms or
  updates his status/handoff; update the shared core-plan checkboxes for merged
  Tasks 7, 8, and 15 from the owning side or in a jointly reviewed docs change.
- [ ] **Run the missing joint live checkpoint.** Exercise one real path:
  material upload → ingest reaches `ready` → AI hierarchy suggestion/apply →
  grounded generation → instructor review/approval → student serving/attempt.
  This covers the deferred Task 8 checkpoint, PR #24 click-through, and most of
  Task 16 without inventing a separate demo.
- [ ] **Make Task 13 explicit.** Record either `slipped to backlog` or an agreed
  owner and completion plan; do not leave “either owner” ambiguous at exit.
- [ ] **Complete Task 16 jointly.** Approved-only serving proof, core-loop E2E,
  and the full verification suite remain the formal phase exit.
- [ ] **Classify two correctness findings.** Stephen + Saurav decide whether
  strict grounded retrieval and compare-and-set question transitions are
  Phase 1 stabilization work or named Phase 2 prerequisites. They should not
  disappear into a generic UX backlog.

## Gate B — prepare Phase 2 before implementation

- [ ] Add an `Owner` to every Phase 2 task and record cross-developer sync
  points. No personal Phase 2 plan should be written before this allocation.
- [ ] Add prerequisite edges identified in the shared review proposal:
  question-transition concurrency before flag auto-pause/resolution; reliable
  material-to-LO retrieval before redirects and custom generation; persistent
  run identity before adding richer generation UX.
- [ ] Decide the Phase 2 content model before Tasks 4/5/8/9 make it expensive to
  change: retain the immutable Question/QuestionVersion model, and add template
  or family provenance rather than replacing it with arbitrary scripts.
- [ ] After decisions, update the normative documents together: PRD semantics,
  domain model, API contract, shared Phase 2 plan, and each developer's personal
  plan. Contract changes require two-developer review.

## Candidate division for discussion — not an assignment

The existing arc split suggests Stephen could continue the student/session
surface (Phase 2 flag control, progression/redirect, phase-exit E2E), while
Saurav could continue instructor/content tooling (resolution queue,
import/parameterization, generation workflow). Notifications and concurrency
touch both arcs and need an explicit owner plus a review owner. This paragraph
has no ownership authority until both developers agree and the Phase 2 core
plan records it.

## Documents intentionally unchanged in this pass

- **Phase 0:** historical foundation; none of the review findings invalidate
  its architecture.
- **`docs/api-contract.md`:** proposed run/progress, archive, structured course,
  or practice-session endpoints are not yet approved contracts.
- **Core Phase 1 / Phase 2 plans:** shared normative documents should be changed
  after the joint sync, not unilaterally from Stephen's personal review.
- **Saurav's personal plans/status:** only Saurav should reconcile his log.

The detailed proposal and impact matrix are in
[`../../../specs/2026-07-22-authoring-workflow-review.md`](../../../specs/2026-07-22-authoring-workflow-review.md).
