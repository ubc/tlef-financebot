# Stephen — Phase 2 progress

_Last updated: 2026-07-28_

## Current state

- P2-0 persistent content runs/SSE: **merged** in PR #32.
- Task 4 parameter sandbox: **merged** in PR #33 after eight security review
  rounds.
- Task 5 parameter serving/config: **in progress with Claude**.
- Admin Console v0: **A1 backend checkpoint complete with Codex; client wiring
  waits for Task 5's shared-file release**.

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
Student Preview waits for Task 5 to release `serving.service.ts` and
`attempts.service.ts`. Codex completed the disjoint Admin backend in parallel
without modifying Claude's Task 5 files.

Because both agents are Stephen worktrees, claim updates are now published as
narrow commits. Do not run the current whole-folder `sync-plans` script from a
stale parallel worktree: it can overwrite the other agent's newer ledger.

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

No action is required. Please treat the paths in both coordination ledgers as
reserved while their state is active. Task 5 completion remains the unblock
signal for Saurav's Task 9; Admin v0 does not change the Task 5 parameter
contract.

Codex's current branch is `codex/admin-platform-instructor`; backend commits
through `392fa38` are pushed. Verification: 52 Jest suites / 546 tests,
typecheck, lint, and compilation passed.
