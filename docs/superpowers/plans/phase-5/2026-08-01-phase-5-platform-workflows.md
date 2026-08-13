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

- [x] Add one course-scoped workflow-summary contract that aggregates launch
  readiness, content health, review work, student flags, and recent failed work.
- [x] Replace the static Instructor Dashboard shortcut grid with readiness
  progress, operational counts, and a priority-ordered action queue.
- [x] Add service, route, and pure client-logic coverage; run the full
  lint/typecheck/Jest/build regression suite.
- [x] Record completion evidence in Stephen's status and sync the plan.

### Task 1 follow-up: Guided Course Preparation

**Owner:** Stephen

- [x] Extend the authoritative Instructor workflow summary with five derived
  setup-step states, one primary next-best action, and explicit material and
  question counts without persisting a parallel wizard record.
- [x] Add an Instructor-only, retry-safe-by-name Topic/LO outline batch contract
  so an interrupted existing-LO setup can resume without duplicate hierarchy.
- [x] Present the derived state on Course Home as numbered, freely navigable
  expert shortcuts plus one visually primary Next Action.
- [x] Complete both in-context entry paths: reviewed existing LOs followed by
  grounding materials, and materials-first ingest followed by hierarchy review.
- [x] Advance guidance through generation/import, review/approval, Student
  Preview, and publish while retaining full-workspace escape hatches.
- [x] Verify empty, processing, partial/failed, retry/reconnect, published and
  archived states at desktop/mobile, including keyboard/focus and axe coverage;
  record regression evidence and sync Stephen's completed plan.

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

### Task 7: Student practice correctness — rendering, option order, retry

**Owner:** Saurav

Claimed in writing on 2026-08-13 (Tasks 1–6 are all Stephen's). Full plan and
the investigation behind it:
`phase-5/Saurav/2026-08-13-practice-rendering-and-retry-fixes.md`.

- [ ] Render question formulas as LaTeX: teach `GENERATOR_PROMPT` that stem,
  options and explanations are markdown + KaTeX (`$…$` delimiters — `\(…\)` is
  destroyed by the markdown pass), and route practice explanations through
  `renderRichText` as exam results already do. `derivedValues[].formula` stays in
  evaluator syntax; only displayed text becomes LaTeX.
- [ ] Shuffle MCQ answer options once at version creation, reassigning keys by
  position. Not at approval — `approved → paused → approved` would reorder a
  version that already has AttemptRecords and silently corrupt
  `answerDistributions`. True/False keeps `T,F`.
- [ ] ⚠️ Change Strategy A to retry the SAME question with the chosen wrong
  option eliminated, and amend `PRD.md:86` and `docs/api-contract.md` in the same
  PR. **This reverses a written spec and Stephen's `selectRetryQuestion` design —
  Saurav must discuss it with Stephen before merge.** Separate branch from the
  two items above.
- [ ] Carried from Phase 4 Task 3: Delete for never-used questions. Design is
  settled in `phase-4/Saurav/2026-08-08-question-bank-pi-feedback.md`; deferred
  out of Phase 4 by the Aug 24 freeze, nothing built.
