# Instructor outline repair workspace

The next product slice connects the existing bounded wording-repair engine to
the Instructor's multi-file Topic/LO draft. It does not recover uninterpreted
visual content, prove that every uncredited learning point is required, or
establish real-model repair quality. No provider call is authorized or executed
by implementing or testing this workflow.

## Intended behavior

An Instructor can inspect the original source-linked findings, choose one repair
mode and select at most two objectives. The supported-objective mode selects
one to eight already assigned, globally uncredited source points per objective.
The other mode revisits unsupported or uncertain wording. Both share exactly
one repair cycle for the same original checkpoint. Changing selections does not
purchase another cycle.

The existing worker proposes wording only, independently reviews changed
objectives and retains every reservation, result and shortfall. Coverage repair
must gain all selected credits and preserve every old credit. The original
draft and teacher edits remain available during work, failures and reload.
Successful child results become selectable only after explicit inspection;
Apply remains a separate Instructor action.

## Implementation boundaries

1. Add strict course-Instructor GET/POST repair endpoints to the existing
   materials router. GET is a read-only, paginated safe projection; POST accepts
   only the two known versioned selection shapes. Server code derives source,
   prior-credit, budget and eligibility authority. Ordinary legacy runs return
   explicit unavailable state, not an invented repair capability.
2. Add the supported-coverage enqueue wrapper to the existing durable structure
   worker. There is no new queue, extraction pass, automatic Apply or higher
   model budget. Enqueue failure and already-consumed cycles remain explicit.
3. Revalidate repaired Apply inside a required course transaction. Session-bound
   reads must replay the exact parent, checkpoint, proposal, findings, result,
   budgets and coverage assessment before any hierarchy or material write.
   Existing normal historical Apply keeps its compatibility behavior.
4. Keep intentionally edited teacher labels allowed, but return and display
   whether submitted wording differs from the independently reviewed result.
   Teacher text must never inherit an unqualified fresh model-review claim.
5. Extend the existing workbench using its current style. Resolve parent/child
   identity before selecting a newest run; malformed or failed reads cannot
   briefly enable Apply on an unclassified child. Keep per-run edited names
   and checkbox selections bound to fresh authoritative source indexes.

## Validation and evidence

Focused mocked tests cover strict inputs, authorization, course isolation,
read-only projection, queue behavior, currentness, one-cycle rules, repaired
adoption and ordinary-run compatibility. Compiled browser fixtures intercept all
APIs and cover selection limits, confirmation, parent retention, reload,
shortfall and explicit child selection/Apply. Their model judgments are
synthetic, not evidence of improved teaching quality.

A separate disposable Mongo harness will be reviewed before execution. It must
use a new owned namespace, deny model/vector/job/nonlocal traffic before imports,
verify actual session propagation and rollback, and owner-check cleanup. It must
never use an application database or a live paid outline script.

Retain exact before/after inputs, outputs, failure records, source copies and
desktop/mobile screenshots in the English HTML book. New source changes make
earlier paid declarations historical. Fresh real-model/source-based evaluation
and teacher calibration remain required before claiming useful recovered LOs,
reduced review time or higher saved-question yield.
