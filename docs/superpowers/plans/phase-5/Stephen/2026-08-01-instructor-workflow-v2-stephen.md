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

## Later tasks

After this slice is clean: LO Content Studio, unified Action Inbox,
analytics-to-action links, course/team lifecycle, then Admin Operations.
