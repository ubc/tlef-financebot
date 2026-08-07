# Stephen — Instructor Workflow v2 implementation plan

## Objective

Make the Instructor experience task-driven rather than page-driven. The first
vertical slice upgrades the existing Course Dashboard into a Launch Cockpit
backed by one authoritative aggregate contract.

## Task 1 — Course Launch Cockpit

### 1. Contract and service

- [x] Define `InstructorWorkflowSummary` with course lifecycle, checklist
  progress, operational counts, and priority-ordered actions.
- [x] Compose existing `getCourseTree`, `publishChecklist`, content-map,
  review-queue, flag, and low-engagement services in parallel.
- [x] Derive action identifiers and entity counts without storing workflow
  state in MongoDB.

### 2. Route and client API

- [x] Add `GET /api/courses/:courseId/instructor-workflow` behind
  `ensureCourseInstructor()`.
- [x] Serialize ObjectIds at the HTTP boundary and add the matching typed client
  function.

### 3. Launch Cockpit UI

- [x] Show readiness completion and lifecycle context.
- [x] Show Topics, LOs, Approved questions, review backlog, open flags, and
  content health.
- [x] Render a priority-ordered "Next actions" list with direct destinations.
- [x] Preserve Student Preview and the existing publish/unpublish control.
- [x] Make Student Analytics actionable instead of disabled.

### 4. Verification and handoff

- [x] Add service tests for empty, healthy, and action-heavy courses.
- [x] Add route authorization/serialization tests and pure action-mapping tests.
- [x] Run lint, typecheck, Jest, build, Playwright, and axe.
- [x] Commit, update the shared/core checkboxes and Stephen status, then run
  `npm run sync-plans -- Stephen`.

## UI and workflow hardening follow-up — 2026-08-03

- [x] Sync and preserve Saurav's latest shared plan output before editing.
- [x] Audit Admin, Instructor, Student, and TA routes at desktop and 390px.
- [x] Restore the missing shared card/cluster/checkbox layout contracts.
- [x] Rebuild Admin User Directory, Capability Matrix, and Platform Settings
  information hierarchy and responsive behaviour.
- [x] Convert Bank, Review Queue, and Coverage tables to phone-safe cards.
- [x] Fix Topic header and LO progress-card mobile reflow.
- [x] Add populated responsive workflow regression and Phase 3 Admin axe scans.
- [x] Publish a full manual feature-test tutorial and UI audit report.
- [x] Run lint, typecheck, build, Jest, Playwright, and axe.

## Later tasks

After this slice is clean: LO Content Studio, unified Action Inbox,
analytics-to-action links, course/team lifecycle, then Admin Operations.

## Guided Course Launch journey — 2026-08-07

### Product contract

- [ ] Keep the numbered Sources → LOs → Questions → Review → Preview path as
  freely navigable expert shortcuts, while deriving a truthful state for every
  stage from existing course/content/run/question/preview data.
- [ ] Make Next actions a progressive onboarding guide: one primary next-best
  action at a time, with completed and upcoming work visible but not competing.
- [ ] Never report an empty source library as "Knowledge ready"; reserve red
  status for actual failure/blocking conditions rather than normal not-started
  work.

### Course Home guided actions

- [ ] Keep course-date setup in the existing in-context dialog with standard
  term anchors, validation, and a full-Settings escape hatch.
- [ ] Replace the page jump for an empty course with a guided dialog that first
  asks whether the instructor already has Learning Objectives.
- [ ] Existing-LO path: accept pasted/manual LO text, create the hierarchy via
  the authoritative course APIs, and offer material upload as the next step.
- [ ] Material-first path: upload one or more sources, show durable content-run
  progress, then surface the existing AI hierarchy proposal/review/apply flow.
- [ ] Every dialog supports Cancel/close without losing completed work and a
  direct "Open full workspace" escape hatch for advanced editing.

### Automatic progression and verification

- [ ] Recompute the workflow summary after each mutation/run update so the
  primary action and numbered-stage states advance without a parallel wizard
  record.
- [ ] Add desktop/mobile, keyboard/focus, empty/error/retry and authorization
  coverage for both entry paths.
- [ ] Update PRD, API contract, AGENTS current-state, and Stephen status; run
  lint, typecheck, Jest, build, Playwright and axe where the local services
  permit, then sync the final plan evidence.

## Course-as-Project UX foundation — 2026-08-05

- [x] Treat each course as a durable Project on the Instructor landing page.
- [x] Hide course-only navigation until a course is selected; inside a course,
  present the authoring workflow in a deliberate Sources → LOs → Questions →
  Review → Preview sequence.
- [x] Add a persistent, accessible desktop icon-rail collapse mode while
  preserving the existing mobile drawer.
- [x] Recompose Course Home as the Project cockpit: current state, next work,
  launch readiness, and direct exploration paths.
- [x] Keep the Knowledge Workspace inside the viewport with independent panel
  scrolling and a source-level Trash / Restore action.
- [x] Establish reusable Project-shell tokens and responsive rules that the
  remaining Instructor views can adopt without route-by-route visual drift.
- [x] Verify keyboard navigation, responsive layouts, TypeScript, lint, unit
  tests, browser workflows, and axe before handoff.

## Student and TA role parity — 2026-08-05

- [x] Extend the persistent Project shell and accessible icon-rail collapse
  mode to live Student, anonymous Student Preview, real TA, and Instructor TA
  View.
- [x] Rebuild Student My Courses as a modern course-project dashboard without
  changing registration-code enrolment semantics.
- [x] Add Course Home to Student navigation and show a clear Choose topic →
  Practice/retry → Review weak areas learning journey.
- [x] Keep course identity visible throughout Student learning and Preview.
- [x] Replace TA's opaque `Course 1` labels with a capability-gated safe course
  identity projection and a real multi-course picker.
- [x] Present TA work as a numbered Review Queue → Flag Triage workflow while
  preserving hard-denied approval and resolution boundaries.
- [x] Verify desktop collapse, 390px reflow, no horizontal overflow, no browser
  console errors, TypeScript, lint, Jest, Playwright, and axe.
