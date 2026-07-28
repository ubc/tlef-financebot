# Stephen — Phase 2 progress

_Last updated: 2026-07-28_

## Anonymous full Student View follow-up — 2026-07-28

Stephen tested the merged Instructor Preview and rejected the embedded
Instructor-shell implementation: its independently assembled topic cards
overflow at desktop widths and it does not reproduce the real student chrome.
Codex is replacing it on `codex/anonymous-student-preview` with a full shell
switch that reuses the blue Student sidebar, routes, HTML primitives, and
practice card.

The selected product model is a **fresh anonymous student**:

- entering Preview starts a new preview session for the selected course;
- My Courses, Course Home, Topic/LO drill-down, Practice, flags, Review Book,
  Session Summary, notifications-empty state, and exit navigation are
  available through the Student shell;
- unpublished courses remain previewable, while only currently released LOs
  with Approved questions are visible;
- attempts and other simulated student state remain under the explicit
  Instructor-only `/preview/*` boundary and never write live attempt, mastery,
  Review Book, flag, notification, summary, or analytics collections.

Saurav does not need to confirm this Stephen-owned corrective follow-up. The
exact active file claim is in
[`coordination/CODEX.md`](coordination/CODEX.md).

Implementation and verification are complete:

- the old custom Preview topic-card page was removed;
- Preview now reuses the production Student shell and renderers through an
  injected Preview data/route adapter;
- each entry starts a new anonymous UUID session; refresh preserves it and
  Exit Preview clears it;
- Preview attempts and its temporary Review Book/flag state are isolated in
  24-hour TTL collections;
- real-browser acceptance covered Course Home, practice, Flag, feedback,
  Session Summary, Review Book, legacy-link compatibility, and return to the
  Instructor shell, with no console errors or horizontal overflow;
- focused Preview E2E passed; the full Jest suite passed **61 suites / 644
  tests**; typecheck, lint, and production build all passed.

## Update (2026-07-28): P2-I1 through P2-I5 completion authorized

Stephen asked Codex to implement the rows that remained backlog-only in
`2026-07-22-phase-2-review-improvements-stephen.md`. Codex synced plans,
audited `origin/main` at `d6e1f4a`, and recorded the exact missing contracts in
[`2026-07-28-review-improvements-completion-stephen.md`](2026-07-28-review-improvements-completion-stephen.md).

- P2-I4 finite practice rounds is already complete in Task 7 / PR #37 and will
  only receive regression verification.
- P2-I1 still needs explicit lifecycle/archive/restore and a read-only
  authoritative publish checklist.
- P2-I2 still needs persisted reusable blueprints and exact run retry
  provenance; existing P2-0 run history and Task 10 generation are reused.
- P2-I3 still needs additive family/version lineage across generation, import,
  script migration, and edits; the existing Question/QuestionVersion model is
  retained.
- P2-I5 still needs material-kind metadata and a unified instructor content
  map.

Stephen explicitly authorized the P2-I2/P2-I3 cross-owner extension. Saurav's
previous Tasks 8–10 implementations are not being replaced; this branch only
adds the provenance/history contracts that the original improvement map left
for later. No active Saurav file claim overlaps this work.

## Current state

- P2-0 persistent content runs/SSE: **merged** in PR #32.
- Task 4 parameter sandbox: **merged** in PR #33 after eight security review
  rounds.
- Task 5 parameter serving/config: **merged** in PR #34.
- Tasks 2, 7–11: **merged** in PRs #35 and #37–#42.
- Admin Console/PUID provisioning: **merged** through PR #45.
- Anonymous full Student View corrective follow-up: **implemented in draft
  PR #46** on `codex/anonymous-student-preview`; awaiting Stephen's manual
  acceptance and must not be merged yet.
- P2-I1–I5 review-improvement completion: **separate active Codex workstream**.

Admin v0 is Stephen-owned staging enablement. Saurav does not need to confirm
or stop his own work; this status is the requested informational handoff so
his agent can avoid claimed files.

## Two-agent split

Claude continues Phase 2 Task 5 and owns the parameterization paths it records
in
[`coordination/CLAUDE.md`](coordination/CLAUDE.md).

Codex owns Admin Console v0 and records its paths in
[`coordination/CODEX.md`](coordination/CODEX.md). The implementation plan is
[`2026-07-27-admin-console-v0-stephen.md`](2026-07-27-admin-console-v0-stephen.md).

Each agent edits only its own claim file. Both read both files before editing.
The former Task 5 wait is resolved. The anonymous Student Preview correction
claims only the paths listed in `coordination/CODEX.md`; the review-improvement
workstream owns its separately recorded files.

## Admin v0 decisions

- Admins grant a global `platformInstructor` capability by CWL username.
- Pre-login grants are pending records keyed by normalized CWL `uid`; no fake
  PUID-backed User is created.
- Platform Instructor authorizes the Instructor shell and course creation;
  existing-course access remains course-scoped.
- Student Preview uses separate Instructor-only endpoints and does not weaken
  `ensureCourseStudent()`.
- Preview of unpublished courses still serves approved questions only.
- Preview simulates mastery, Review Book, flags, remediation, and summaries
  only inside a short-lived anonymous session. Its records are structurally
  separate and cannot affect the corresponding live collections,
  notifications, or analytics.

## Message for Saurav

No action or confirmation is required from Saurav. Please treat the paths in
both coordination ledgers as reserved while their state is active. The
anonymous Student Preview follow-up does not change Task 5's parameter
contract or Saurav's merged Tasks 8–10.
