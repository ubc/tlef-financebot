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
- Task 7 progression/redirect + finite rounds: **complete on stacked PR #37**.

Admin v0 is Stephen-owned staging enablement. Saurav does not need to confirm
or stop his own work; this status is the requested informational handoff so
his agent can avoid claimed files.

## Two-agent coordination

Claude completed Phase 2 Task 5 and released the shared parameterization paths
at `210c68f`; PR #34 is the base of Stephen's current stacked PR chain.

Codex completed:

- Task 2 on PR #35, stacked on #34.
- Admin A1 on PR #36, stacked on #34.
- Task 7 on PR #37 (`codex/phase-2-task7-progression`), stacked on #35 so the
  practice work includes Task 2 and Task 5's final parameter
  echo/substitution behavior.

Codex records current paths in
[`coordination/CODEX.md`](coordination/CODEX.md). Student Preview A2 waits for
PR #34, Admin A1 PR #36, and Task 7 PR #37 to merge; it will reuse rather than
duplicate Task 5.

## Task 7 result

- Serving exhausts every unseen Approved question for an LO before the first
  repeat becomes an explicit round summary.
- Mastery recommendations offer real advance/finish and keep-practicing
  actions.
- The course-configured consecutive easy/medium miss threshold returns an
  inline non-blocking material redirect; hard-tier misses retain mastery
  step-back precedence.
- Redirect feedback never includes the current correct answer. Ready material
  links resolve through an enrolled-student route restricted to the exact
  course/LO.
- Focused 61 tests and full 53 suites / 583 tests passed; typecheck, lint, and
  build passed.
- Live SAML student browser regression passed for round completion, repeat
  confirmation, third-miss redirect, real material target, non-blocking
  continue, both recommendation decisions, and immediate Covered sidebar
  state. Browser logs were empty.
- Browser review caught and fixed stale retry wording in redirect transcripts
  and a stale sidebar mastery label.

All Task 7 browser fixtures, attempts, notifications, and temporary course
roles were localhost-only and removed before handoff; residual fixture counts
were verified as zero.

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
- #37 — Task 7 progression/redirect + finite rounds; 53 suites / 583 tests and
  live student browser regression passed

Admin browser test mutations were localhost-only and fully restored (no
leftover test grants; test-user Admin bit returned false).
