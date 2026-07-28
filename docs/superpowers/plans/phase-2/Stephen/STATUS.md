# Stephen — Phase 2 progress

_Last updated: 2026-07-28_

## Current state

- P2-0 persistent content runs/SSE: **merged** in PR #32.
- Task 4 parameter sandbox: **merged** in PR #33 after eight security review
  rounds.
- Task 5 parameter serving/config: **complete on PR #34, CI green, awaiting
  review/merge**.
- Task 2 student Flag control: **in progress with Codex on a stacked branch
  based on PR #34's final head**.
- Admin Console v0: **A1 implementation complete and verified; backend pushed,
  client integration will be transplanted after PR #34 merges**.

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
Claude released the final Task 5 shared paths at `210c68f` and opened PR #34.
Codex now owns Task 2's student surface on top of that final head. Student
Preview waits for PR #34 and Admin A1 to merge; it will reuse rather than
duplicate Task 5's parameter echo/substitution behavior.

## Admin v0 decisions

- Admins grant a global `platformInstructor` capability by CWL username.
- Pre-login grants are pending records keyed by normalized CWL `uid`; no fake
  PUID-backed User is created.
- Platform Instructor authorizes the Instructor shell and course creation;
  existing-course access remains course-scoped.
- Student Preview uses separate Instructor-only endpoints and does not weaken
  `ensureCourseStudent()`.
- Preview of unpublished courses still serves approved questions only.
- Preview records are structurally separate from live attempts and cannot
  affect mastery, Review Book, flags, remediation, summaries, notifications,
  or analytics.

## Message for Saurav

No action is required to start Codex work. Please treat the exact paths in
both coordination ledgers as reserved while their state is active. Stephen
authorized Codex to take a minimal Saurav-owned dependency if it becomes the
only blocker; Codex will record any such cross-owner takeover here and in
Saurav's status before implementation, and will not duplicate active work.

Task 5 PR: #34 (`stephen/phase-2-task5-params`, CI green). Codex Task 2 branch:
`codex/phase-2-task2-student-flag`.
