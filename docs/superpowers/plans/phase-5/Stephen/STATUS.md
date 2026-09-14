# Stephen — Phase 5 status

_Last updated: 2026-09-09_

## In progress

- Role tutorials and Student Analytics are locally accepted on
  `codex/role-tutorials-analytics`, including the final independent integration
  review. Stephen authorized committing and pushing this accepted delivery to
  main on 2026-09-09.

## Current delivery

- 25 contextual tutorials across Student (9), Instructor (9), TA (3) and
  Admin (4), with shared course-aware Help, replay, isolated progress and
  capability-aware TA controls.
- Student Analytics now provides actionable objective and question-version
  drilldowns, exact mode/date filters, weekly activity/CSV and permission-gated
  named follow-up. Zero-data and insufficient-sample states are explicit.
- Full Jest: 103 suites / 1294 tests. Dedicated browsers: 15 tutorial and
  10 analytics tests. Real SAML/Mongo: 6 new role/analytics flows plus the
  existing Exam Prep and 2 Preview cases. Real-page axe: all 6 scenarios pass.
- See [acceptance evidence](../../../../testing/2026-09-09-role-tutorials-analytics-acceptance.md)
  for coverage and limits. Optional product help is separate from PRD consent.

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

- Review the current local tutorial and analytics experience with Stephen.
  The earlier AI Workspace experiment remains rolled back; this delivery does
  not resume that work or change generation.

## Coordination

This is Stephen-owned product workflow work started after Phase 3 completed
29/29. It does not claim or alter Phase 4's protected Test & Harden scope.

## Action progress — 2026-09-14

Local `codex/action-progress` adds visible button spinners across roles, removes
cursor-based waiting, and exposes source-processing stages and counts. Pending
actions survive queue/workspace redraws; prerequisite-only disabled controls do
not spin. Error recovery and duplicate prevention remain explicit.

Verification: typecheck/lint/build; 107 Jest suites / 1,394 tests; 15 tutorial
browser regressions; 8 action-progress browser cases including four production
role components, source SSE transitions, mobile/dark/reduced motion and scoped axe.
Independent review issues were resolved. Changes are uncommitted for Stephen's
local acceptance; no course records, backend contracts or provider settings changed.

## Admin appearance and local persona — 2026-09-14

Admin now has explicit Admin branding, platform/teaching navigation groups and
a monochrome dark visual identity, including body-mounted dialogs. Saved theme
preferences remain intact outside Admin. Local IdP admin/admin was added with
PUID PUID-ADMIN-0001 matching the existing local allowlist. Real SAML login, four
Admin page axe scans, mobile navigation and logout-theme restoration pass.
Typecheck/lint/build and IdP PHP syntax pass. Both repositories remain uncommitted.

Admin appearance correction: only the sidebar remains black; content and dialogs
follow the restored light/dark toggle and persist the selected mode.

## Instructor workflow UX audit — 2026-09-14

Documentation only: reviewed Stephen's 12 screenshots, read-only inspected the
live Instructor journey and checked its implementation. The audit identifies
missing existing-LO presentation, inconsistent generation eligibility, run-only
progress, fragmented review/preview rendering and excessive configuration.
The historical unapproved-supply claim above must be re-verified against the
current batch planner; no generation behavior was changed in this audit.

See `2026-09-14-instructor-workflow-redesign.md` and
`docs/ux/2026-09-14-instructor-workflow-audit.md`. Implementation is page-gated:
Learning Objectives first, then wait for Stephen after each completed page.
No app code, course data, installed skills or provider configuration changed.

## Guided Learning Objectives — Page 1, 2026-09-14

Implemented existing Topic/LO list, inline name editing, explicit addition to an
existing/new Topic, save-to-list and recoverable errors. The list scrolls while
Continue stays visible. Build/lint, 2 focused unit tests and 4 isolated browser
cases (including scoped axe and mobile dark mode) pass. Real course read-only
verification confirms 15 LOs. Awaiting Stephen acceptance; no Page 2 work started.

## Guided Questions — Page 2, 2026-09-14

Page 1 accepted. Guided Questions now has compact settings and progressive
disclosure, pending-draft-aware recommendations, explicit extra generation,
immutable retry-safe submission identity and one-time Review navigation.
Exact run restoration and all-active queries avoid recent-history truncation.
Full Jest: 107 suites / 1,397 tests; 16 focused browser cases pass.
Awaiting Stephen acceptance. Streaming and redesigned Review remain Page 3.

## Review workstation B — 2026-09-14

Stephen chose and authorized B after prototype refinement. The formal Instructor
Review Queue is implemented with compact queue, same-page reader/editing, question
board and optional atomic rejection reasons. 97 related unit/route tests and eight
browser cases pass, including dark/mobile axe; build/typecheck/lint pass. Real
course inspected read-only. Awaiting page acceptance; guided streaming remains
separate, and no subsequent page is started.

B acceptance refinement: empty queue now has its own compact illustrated layout
and next-step links, with separate resettable search/filter no-results state.
Ten browser cases pass across the final focused runs, including empty-state
light/dark axe. Awaiting Stephen's visual review.


## Generate Questions workstation — 2026-09-14

Approved prototype integrated into the real default page. Compact objective/brief/
batch layout, real source eligibility, immutable batch recovery, saved-draft reader,
AI assessment and recorded step timeline are implemented. Existing advanced tools
remain available. Seven focused browser tests, scoped light/dark axe, build, client
typecheck and full lint pass; real course inspected read-only. No token-streaming
or simulated progress added. Awaiting Stephen's visual acceptance of this page.

Streaming follow-up now implemented and verified: real provider fragments → bounded
unverified stem snapshots → existing course SSE → gradual character reveal. Retries
reset previews; refresh restores the latest text; validation/publication unchanged.
95 unit and 8 browser checks pass. Real course verification observed 8 text updates
before any saved question, then successful saved-question preview. Two QA drafts
were created and left unpublished. Existing finished runs cannot reconstruct
historical token timing; new generation uses the streaming path.

Answer-output follow-up complete: options, proposed correct answer, difficulty and
per-option explanations stream with the body. Retry/reload behavior is preserved;
saved readers retain explanations and answer-check reports. 97 unit tests, 9
browser tests and light/dark live-output axe checks pass. A real one-question run
showed answer updates before saving and all four explanations after completion.
The additional QA question remains unpublished.
