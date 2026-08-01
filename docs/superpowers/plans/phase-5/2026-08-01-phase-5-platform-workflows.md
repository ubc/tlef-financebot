# Phase 5 — Platform Workflows v2

**Status:** Started early on 2026-08-01 after Phase 3 completed ahead of
schedule. This work does not change Phase 4's protected Test & Harden scope.

**Goal:** Turn the shipped feature set into a coherent, task-driven platform.
The first priority is the Instructor workflow; advanced Admin operations follow
after the Instructor control plane is usable end to end.

## Global constraints

- Reuse the existing course, content-run, content-map, question, flag, and
  analytics sources of truth. Workflow views aggregate; they do not invent a
  parallel state model.
- Every surfaced problem must have a concrete next action and destination.
- Preserve course-scoped authorization and the TA hard-deny invariants.
- Phase 4 remains feature-frozen verification work; Phase 5 changes stay on
  separate branches until their own review and regression evidence is clean.

### Task 1: Instructor Course Launch Cockpit

**Owner:** Stephen

- [ ] Add one course-scoped workflow-summary contract that aggregates launch
  readiness, content health, review work, student flags, and recent failed work.
- [ ] Replace the static Instructor Dashboard shortcut grid with readiness
  progress, operational counts, and a priority-ordered action queue.
- [ ] Add service, route, and pure client-logic coverage; run the full
  lint/typecheck/Jest/build regression suite.
- [ ] Record completion evidence in Stephen's status and sync the plan.

### Task 2: LO-centred Content Studio

**Owner:** Stephen

- [ ] Design a single LO workspace joining assigned sources, question states,
  latest generation run, coverage gaps, and authoring actions.
- [ ] Add direct Generate, Import, Review, Preview, and Analytics transitions
  without duplicating the underlying feature pages.
- [ ] Add batch operations only where the existing version/audit contracts can
  preserve explicit instructor control.

### Task 3: Unified Instructor Action Inbox

**Owner:** Stephen

- [ ] Combine review backlog, student flags, TA suggestions, source-change work,
  failed content runs, thin LOs, and Exam Prep supply warnings.
- [ ] Define stable priority and acknowledgement semantics; never hide an item
  merely because a notification was dismissed.

### Task 4: Analytics-to-action workflows

**Owner:** Stephen

- [ ] Link weak Theme/LO and misconception signals to the exact content and
  generation/review actions that can resolve them.
- [ ] Link low-engagement rows to course-scoped student profiles and safe
  teaching-team follow-up notes.

### Task 5: Course/team lifecycle completion

**Owner:** Stephen

- [ ] Implement co-instructors and ownership transfer (IN-L03/IN-L04).
- [ ] Implement copy-to-new-term (IN-L05) with independent content/version
  ownership and a regenerated registration code.
- [ ] Plan hierarchy merge/split separately because re-linking historical
  AttemptRecords requires a migration contract.

### Task 6: Admin Operations Console

**Owner:** Stephen

- [ ] Complete AD-03 cross-course operational visibility.
- [ ] Complete AD-04 application health/performance surfaces without trying to
  replace infrastructure monitoring.
- [ ] Complete AD-05 course rollout states and enrollment caps.
- [ ] Add a readable audit-history surface over the existing AuditLog writes.

