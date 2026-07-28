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
- Task 7 progression/redirect + finite rounds: **implementation and live
  browser verification complete; preparing the stacked PR**.

Admin v0 and Task 7 are Stephen-owned staging/pilot enablement. Saurav does not
need to confirm or stop his own work; this status is the requested
informational handoff so his agent can avoid claimed files.

## Two-agent coordination

Claude completed Phase 2 Task 5 and released the shared parameterization paths
at `210c68f`; PR #34 is the base of Stephen's current stacked PR chain.

Codex completed:

- Task 2 on PR #35, stacked on #34.
- Admin A1 on PR #36, stacked on #34.
- Task 7 on `codex/phase-2-task7-progression`, stacked on #35 so the practice
  work includes Task 2 and Task 5's final parameter echo/substitution behavior.

Codex records current paths in
[`coordination/CODEX.md`](coordination/CODEX.md). Student Preview A2 waits for
PR #34 and Admin A1 to merge, plus Task 7's release of the student-practice
seams; it will reuse rather than duplicate Task 5.

## Task 7 result

- Question serving now exhausts every unseen Approved question for an LO
  before repeating one. The first repeat becomes an explicit round summary
  with working **Continue with repeats** and finish/back actions.
- A mastery recommendation is a real two-way decision: advance/finish or
  **Keep practicing**.
- Three consecutive easy/medium misses (course-configurable) return an inline,
  non-blocking redirect; hard-tier misses keep mastery step-back precedence.
- Redirect feedback never includes the current correct answer. Ready materials
  assigned to the exact LO have an enrolled-student-protected source route;
  URL sources redirect and uploaded files download.
- Redirect staff notification is best-effort and never fails an already
  recorded student attempt.
- Focused tests: 61 passed. Full suite: 53 suites / 583 tests. Typecheck, lint,
  and build passed.
- Live SAML student browser regression passed: unseen round completion,
  continue-with-repeats, third-miss redirect, real material target,
  non-blocking continue, mastery recommendation, keep-practicing, return to
  topic, and updated Covered sidebar state. Browser logs were empty.
- The browser run caught and fixed two integration defects before handoff:
  redirect transcript copy incorrectly mentioned a retry, and the sidebar
  retained the pre-attempt mastery label.

All Task 7 browser fixtures and attempts are localhost-only and will be removed
before the PR handoff.

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

No action or confirmation is required. Task 5 completion remains the unblock
signal for Saurav's Task 9; Admin v0 does not change the Task 5 parameter
contract. Stephen authorized Codex to take a minimal Saurav-owned dependency
only if later Stephen work is actually blocked; any such takeover will be
recorded in both developers' status files before implementation. No
cross-owner takeover was needed for Task 7.

Current PR chain:

- #34 — Task 5 parameterization, CI green
- #35 — Task 2 student Flag control; 51 suites / 570 tests and live student
  browser regression passed
- #36 — Admin A1; 53 suites / 585 tests and live Admin active/pending/revoke
  regression passed

