# Stephen — Phase 2 progress

_Last updated: 2026-07-28_

## Current state

- P2-0 persistent content runs/SSE: **merged** in PR #32.
- Task 4 parameter sandbox: **merged** in PR #33 after eight security review
  rounds.
- Task 5 parameter serving/config: **complete on PR #34, CI green, awaiting
  review/merge**.
- Task 2 student Flag control: **complete on stacked PR #35**.
- Admin Console v0: **A1 complete on stacked PR #36**.
- Task 7 progression/redirect + finite rounds: **next with Codex, stacked on
  PR #35 so it includes the finished student practice control**.

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
Codex completed Task 2 on PR #35 and Admin A1 on PR #36, both stacked directly
on #34 so neither republishes an older Task 5 state. Student Preview waits for
PR #34 and Admin A1 to merge; it will reuse rather than duplicate Task 5's
parameter echo/substitution behavior.

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

Current PR chain:

- #34 — Task 5 parameterization, CI green
- #35 — Task 2 student Flag control; 51 suites / 570 tests and live student
  browser regression passed
- #36 — Admin A1; 53 suites / 585 tests and live Admin active/pending/revoke
  regression passed

Codex begins Task 7 next. Admin browser test mutations were localhost-only and
fully restored (no leftover test grants; test-user Admin bit returned false).
