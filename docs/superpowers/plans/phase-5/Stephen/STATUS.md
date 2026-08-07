# Stephen — Phase 5 status

_Last updated: 2026-08-07_

## In progress

- No Guided Course Preparation work remains. Task 2, the LO-centred Content
  Studio, is the next Stephen-owned Phase 5 slice.

## Completed

- Branch: `codex/instructor-workflow-v2`
- Delivery update: the complete Course Knowledge Workspace + Course-as-Project
  role experience is open for review in PR #65 from
  `codex/course-knowledge-workspace`. The latest role-parity commit is
  `970b0fd`; the branch contains three verified commits and was 0 behind / 3
  ahead of `main` when the PR was created.
- Task 1: Instructor Course Launch Cockpit — complete in `380cf0f`.
- Task 1 Guided Course Preparation follow-up — complete in the current
  `codex/course-knowledge-workspace` worktree. Course Home now derives five
  truthful setup-stage states and exactly one primary Next Action. The
  resumable in-context guide handles term-aware dates, an existing-LO path, a
  materials-first path with durable SSE progress and explicit AI cost consent,
  focused question approval, real isolated Student Preview, and publication.
  It reuses course/content/question/preview sources of truth and stores no
  parallel wizard record.
- Retry and concurrency safety are included: outline upsert is name-idempotent,
  paid generation accounts for all unapproved questions before enqueueing,
  stale SSE revisions cannot rewind the guide, and focused approval uses the
  expected question-version id so concurrent edits return the existing 409
  conflict instead of silently approving an older version.
- One course-scoped read model now aggregates lifecycle/readiness, unique
  Approved-question count, review backlog, active flags, thin LOs, unassigned
  materials, failed/partial content work, and low-engagement students without
  persisting a second workflow state.
- The Dashboard now shows launch progress, operational tiles, a
  priority-ordered Next Actions queue, direct destinations, Student Preview,
  working Analytics navigation, publish/unpublish, and archived-course restore.
- Instructor navigation now exposes correct disabled semantics and AA-contrast
  colors. The a11y suite was updated from stale pre-Instructor-shell routes to
  scan My Courses and the real Launch Cockpit.
- UI/workflow hardening follow-up complete: all Admin, Instructor, Student and
  TA route families were browser-audited at desktop and 390px. Missing shared
  Phase 3 layout primitives were restored; Admin operations were rebuilt with
  stable hierarchy; Bank/Review/Coverage tables now reflow to mobile cards;
  Topic/LO mobile actions no longer clip or collapse.
- Added `responsive-workflows.spec.ts`, expanded Phase 3 Admin axe coverage,
  and published `docs/testing/manual-feature-testing-guide.md` plus the
  2026-08-03 UI audit report.
- Course-as-Project UX foundation complete on
  `codex/course-knowledge-workspace`: a searchable Canvas-inspired Project
  dashboard, contextual course navigation, persistent icon rail, linear
  authoring path, task-first Project cockpit, and viewport-bound Knowledge
  Workspace with source-level Trash/Restore actions.
- Renamed the legacy Content Map presentation to Coverage Map so it owns
  readiness/gap analysis; evidence exploration remains in the Knowledge
  Workspace graph instead of presenting two competing graph destinations.
- Course chrome reads only the current course and caches it. It deliberately
  avoids `listInstructorCourses()`'s legacy N+1 scan over stale course roles.
- Student and TA role parity is complete on the same Course-as-Project shell.
  Student now gets Canvas-inspired course-project cards, persistent course
  context, a collapsible icon rail, Course Home navigation, and an explicit
  Choose topic → Practice/retry → Review weak areas learning path. Anonymous
  Student Preview reuses the same chrome and remains state-isolated.
- TA now gets the real course name/code/term/section instead of `Course 1`, a
  safe multi-course picker, persistent project context, a collapsible icon
  rail, and the numbered Review Queue → Flag Triage workflow. The TA-safe
  outline response exposes only identity fields plus Theme/LO names; private
  settings and registration data remain excluded.

## Verification

- `npm run lint`, `npm run typecheck`, and `npm run build`: passed.
- Jest: 77 suites, 784/784 tests passed.
- Playwright: 22 passed; the explicitly optional live-LLM test skipped.
- axe WCAG A/AA: 4/4 passed, including Launch Cockpit and the three Phase 3
  Admin operations.
- Course-as-Project role verification: 84 Jest suites / 888 tests passed; 28/28
  configured Playwright workflows passed with the one opt-in live-LLM test
  skipped; 5/5 axe WCAG A/AA scenarios passed.
- Guided Course Preparation verification (2026-08-07): lint, typecheck, and
  build passed; the full Jest suite passed 87 suites / 936 tests; the real
  Instructor pipeline passed create → dates → existing LO → material upload →
  approval → isolated Student Preview attempt → publish (the opt-in live-LLM
  case skipped). A deterministic materials-first E2E passed upload → SSE
  reconnect → failure → retry → completion → AI hierarchy review/edit/apply
  without calling embeddings or an LLM. The combined guided browser regression
  passed 4 tests with only the opt-in live-LLM case skipped, and the dedicated
  guide axe WCAG A/AA scenario passed. Manual and automated QA at 390px showed
  all five stages at once with no horizontal overflow; keyboard Enter/Escape,
  focus restoration, and close-after-save persistence passed; the manual
  browser run had no warning/error logs.

## Next

- Continue Task 2: LO-centred Content Studio on the new Project interaction
  model, followed by the unified Action Inbox and real tool-calling Course
  Authoring Agent.

## Coordination

This is Stephen-owned product workflow work started after Phase 3 completed
29/29. It does not claim or alter Phase 4's protected Test & Harden scope.
