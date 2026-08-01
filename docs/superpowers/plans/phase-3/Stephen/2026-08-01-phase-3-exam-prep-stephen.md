# Stephen — Phase 3 WS-10 Exam Prep implementation plan

> Written 2026-08-01 from the Phase 3 core plan and the repository's default
> whole-workstream split. The required Superpowers `writing-plans` skill was not
> installed in this session, so this plan follows the same task-by-task,
> test-first structure as the existing personal plans as a documented fallback.

## Scope and ownership

Stephen owns the complete WS-10 student-facing Exam Prep bundle:

- Core Task 2: exam templates and feedback-strategy settings.
- Core Task 3: Approved-only exam assembly and single-sitting attempts.
- Core Task 4: results, history, Review Book collection, and post-exam mastery.
- Core Task 5: Student Exam Prep views and integrity E2E coverage.
- Core Task 9: the WS-10 portion of the shared Phase 3 exit evidence.

WS-11 analytics belongs to Saurav under the default split. WS-12 capability,
TA, and admin work remains unassigned until one developer claims that entire
bundle. This plan must not modify WS-11/12 files merely to unblock WS-10. Until
WS-12 retrofits `exam.configure`, the Task 2 instructor routes retain the
existing course-Instructor guard; the later capability change must preserve
Instructor behaviour.

## Current entry state

- Phase 3 is 0/29 core checklist steps complete and has no implementation
  branch or prior personal plan.
- Phase 2 implementation is merged and its core task steps are complete.
- Phase 1 Task 16 joint exit demo remains explicitly deferred. On August 1 it
  does not trigger Phase 3's August 17 schedule tripwire, but it remains owed
  before claiming the Phase 1 exit gate.
- `ExamTemplate`, `ExamAttempt`, `examTemplatesCol()`, `examAttemptsCol()`, and
  their base indexes already exist from Phase 0. No Exam Prep service/routes
  exist yet.
- Course feedback strategy is already persisted, routed, and editable in the
  current Settings UI. Task 2 verifies and refines the required labelled radio
  presentation rather than duplicating that backend contract.

## Working rules

1. Sync plans before and after each work session using
   `npm run sync-plans -- Stephen`; this targets the dedicated documentation
   branch, never `main`.
2. Work from short-lived `codex/` branches based on current `origin/main`.
3. Use test-first service development and thin, separately tested routes.
4. Preserve Approved-only serving, pinned question versions/parameters, and
   the no-feedback-before-submit invariant in every response shape.
5. Treat `server/src/app.ts`, Mongo collection/index declarations, and client
   route tables as append-only integration points.
6. Update both this personal plan and the core Phase 3 checkboxes only after
   the relevant tests are clean and the implementation commit exists.

## Task 2 — Exam templates and feedback strategy

### 2.1 Service contract tests

- [x] Add `tests/unit/exam-templates.service.test.ts` with mocked typed
  collections.
- [x] Prove an optional time limit is accepted while missing/invalid Theme
  counts, split, points, or availability fields are rejected.
- [x] Prove supply warnings identify Theme id/name and exact requested versus
  Approved available count without rejecting the save.
- [x] Prove saving the same `(courseId, kind)` replaces that template and that
  midterm/final remain independent.
- [x] Prove `activeTemplates(courseId, now)` uses an inclusive availability
  window and omits inactive templates.
- [x] Run the focused suite and record the expected failure before
  implementation.

### 2.2 Service implementation

- [x] Add `server/src/services/exam-templates.service.ts` with explicit input
  normalization/validation and `saveTemplate`, `listTemplates`, and
  `activeTemplates` exports.
- [x] Resolve Theme names and Approved supply course-safely; archived Themes,
  cross-course Theme ids, Draft/Reviewed/Paused questions, and mismatched
  question types must not count as supply.
- [x] Upsert by `(courseId, kind)`, preserve one stable template identity when
  replacing a kind, and always stamp `updatedAt` server-side.
- [x] Retain the existing `(courseId, kind)` index and avoid an in-place unique
  option change that would make `ensureIndexes()` fail against the already
  deployed non-unique index; the service's keyed upsert preserves the contract.
  No extra availability index is justified for two templates per course.
- [x] Run focused tests to green.

### 2.3 Instructor routes

- [x] Add `server/src/routes/exams.routes.ts` with Zod route/body validation.
- [x] Implement instructor-guarded
  `PUT /api/courses/:courseId/exam-templates/:kind` and
  `GET /api/courses/:courseId/exam-templates`.
- [x] Add `tests/unit/exams.routes.test.ts` covering 401, 403, bad ids/body,
  course-scoped service calls, warning serialization, and both kinds.
- [x] Append the router mount in `server/src/app.ts` and document it in the
  closest route/service AGENTS files.

### 2.4 Instructor settings UI

- [x] Add typed template request/response functions to `client/src/api.ts`.
- [x] Add `client/src/views/instructor/exam-templates.ts` as an accessible
  midterm/final editor for covered Themes, per-Theme MCQ/T-F counts, point
  values, optional time limit, availability window, and LO-breakdown toggle.
- [x] Surface exact non-blocking supply warnings inline after save.
- [x] Link the editor from the course Settings surface/navigation without
  reordering existing route tables.
- [x] Present feedback strategy as a labelled radio group with descriptions;
  retain the existing `PATCH /api/courses/:id` persistence contract.
- [x] Add only the minimal CSS needed, using existing Instructor tokens and
  responsive patterns.

### 2.5 Task 2 verification and handoff

- [x] Run focused Jest suites, `npm run typecheck`, scoped lint, and
  `npm run build`. Full `npm run lint` remains blocked solely by the pre-existing
  untracked `.claude/worktrees/` nested TS roots; all changed source/test files
  lint clean.
- [x] Review response shapes for ObjectId/Date JSON serialization and verify no
  correctness data is exposed by the template endpoints.
- [x] Commit the Task 2 implementation (`a7b1586`), then mark the Task 2 core/personal
  checkboxes honestly and sync Stephen's plan.

## Task 3 — Assembly and single-sitting attempt state machine

- [x] Write the eight core failing cases: exact assembly, non-blocking
  shortfall, Approved-only draw, mutable answers before submit, immutable after
  submit, sanitized exam state, server-authoritative expiry, resume, and
  AttemptRecord scoring.
- [x] Implement deterministic-testable randomized selection per Theme/type with
  no duplicates, pinned question versions and parameter values, and persisted
  shortfalls/max score.
- [x] Implement ownership checks, open-attempt resume, answer updates,
  idempotent/atomic submission, and lazy auto-submit on every expired-attempt
  route.
- [x] Add the five student routes with `ensureCourseStudent()` or child-resource
  course stashing as appropriate; never authorize using request body ids.
- [x] Ensure every pre-submit payload is explicitly projected to stem/options
  text only and recursively lacks roles, explanations, and correctness.
- [x] Run focused plus existing practice/attempt/parameterization regression
  suites; commit and sync only when green.

## Task 4 — Results, history, Review Book, and mastery pass

- [x] Write failing tests for pre-submit 409, score/theme totals, optional LO
  breakdown, Review Book idempotency, history ordering, and the
  `examVerified` qualifier preserving practice-derived mastery status.
- [x] Add post-submit full review/result projection and course-scoped history
  with stable drill-in ids.
- [x] Reuse Review Book upsert semantics so each miss appears once and retains
  the triggering exam attempt context.
- [x] Define/register/enqueue the `exam.mastery-pass` job next to its owning
  service following the jobs component guidance; make retries idempotent.
- [x] Add results/history routes, run regression suites, commit, and sync.

## Task 5 — Student Exam Prep views and integrity E2E

- [x] Add typed client APIs and four student views: selection, attempt,
  results, and history.
- [x] Enable the existing Exam Prep navigation only when an active template is
  returned; keep it hidden/disabled when none is active.
- [x] Implement navigation grid states, unanswered-submit confirmation,
  countdown/5-minute warning, reload resume, and server-confirmed auto-submit.
- [x] Keep the live attempt DOM free of correctness/explanation text and render
  full review only after submission.
- [x] Add `tests/e2e/exam-mode.spec.ts` covering the full integrity path and
  Review Book collection; clean every seeded record in `afterAll`.
- [x] Run client typecheck/lint/build, focused server suites, and the live E2E;
  commit and sync.

## Authorized WS-11/12 takeover

- [x] Task 1 capability settings collection, thirteen-capability defaults,
  per-course/per-user resolution, source reporting, and generic course-scoped
  guard.
- [x] Hard-deny TA `question.approve` and `flag.resolve` before configurable
  values, and retrofit question/flag teaching-team reads/mutations without
  changing Instructor behavior (`c14de29`; full Jest 750/750).
- [x] Task 6 TA invitations, activation, permissions, review/suggestion/notes,
  and escalation workflows.
- [ ] Task 7 Instructor analytics and individual Student profile.
- [ ] Task 8 Admin user/capability/platform-settings essentials.

## Stephen's Phase 3 exit evidence

- [x] Demonstrate a template-conforming exam with exact supply and a separate
  non-blocking shortfall case.
- [x] Demonstrate reload resume and zero pre-submit feedback/correctness data.
- [x] Demonstrate results, Review Book misses, history, AttemptRecords, and the
  post-exam mastery qualifier end to end.
- [x] Carry the Exam Prep AttemptRecord fixture/contract directly into Task 7
  analytics under Stephen's authorized WS-11 takeover.
- [ ] Participate in the joint full-suite/manual exit review before checking
  the shared Task 9 complete.

## Planned first implementation slice

Start with Task 2.1–2.3 (service tests, service, routes), then add the Settings
UI. This produces a reviewable, independently useful template contract without
waiting for WS-12. Task 3 starts only after the saved-template shape is stable.
