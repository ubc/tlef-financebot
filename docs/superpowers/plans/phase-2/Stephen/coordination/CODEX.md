# Codex file claim — Stephen work

**Ledger owner:** Codex only  
**Last updated:** 2026-07-28  
**State:** Task 7 verified; preparing PR  
**Base:** PR #35 head `a685800` (`codex/phase-2-task2-student-flag`)

Both agents read this file and `CLAUDE.md` before editing. A path claimed by
the other agent is read-only until that agent records `released` plus a commit
SHA.

## Active task

Phase 2 Task 7 — progression recommendations, repeated-failure redirect, and
Stephen's accepted finite-round semantics.

Branch: `codex/phase-2-task7-progression`, stacked on PR #35 so it includes the
finished Task 2 practice-card behavior and PR #34's final parameter echo.

## Task 7 files claimed by Codex

- create `server/src/services/progression.service.ts`
- `server/src/services/attempts.service.ts`
- `server/src/services/serving.service.ts`
- `server/src/routes/practice.routes.ts`
- `client/src/api.ts`
- `client/src/practice-session.ts`
- `client/src/views/student/practice.ts`
- `client/src/views/student/practice-card.ts`
- `client/public/styles/main.css`
- create `tests/unit/redirect.test.ts`
- create `tests/unit/practice-session.test.ts`
- focused serving/attempt/practice-route tests
- `docs/api-contract.md`
- `docs/superpowers/plans/phase-2/2026-07-11-phase-2-pilot-readiness.md`
- `docs/superpowers/plans/phase-2/Stephen/2026-07-23-phase-2-pilot-readiness-stephen.md`
- `docs/superpowers/plans/phase-2/Stephen/STATUS.md`
- `docs/superpowers/plans/phase-2/Stephen/coordination/CODEX.md`

Task 7 imports `notifyCourseStaff` and reads ready materials, but does not edit
Saurav's notifications/materials services.

## Verification

- Focused: 5 suites / 61 tests passed.
- Full: 53 suites / 583 tests passed.
- Server/client typecheck, lint, and build passed.
- Live SAML student browser:
  - served every unseen question before showing the round summary;
  - **Continue with repeats** began round 2;
  - the third easy/medium miss showed only the chosen wrong answer and an
    inline redirect;
  - the protected material source resolved to its real target;
  - **Continue practicing** remained available and loaded the next question;
  - recommendation advance/finish and **Keep practicing** paths were usable;
  - the sidebar changed from In progress to Covered immediately;
  - browser diagnostic log was empty.
- Review fixes from that run: corrected redirect transcript wording and
  refreshed the sidebar mastery label after submission.

## Completed handoffs

- Task 2: commit `a685800`, stacked PR #35. Live browser verified blank-reason
  Flag, answer-after-flag, correct feedback, and Strategy-A retry controls.
- Admin A1: branch `codex/admin-console-v0`, stacked PR #36. Full 585 tests,
  typecheck/lint/build, and live active/pending/revoke Admin regression pass.

## Preview paths — waiting

Student Preview A2 is not active during Task 7. It waits for PR #34 and Admin
A1 to merge, plus this Task 7 PR's release of:

- `server/src/services/serving.service.ts`
- `server/src/services/attempts.service.ts`
- `client/src/api.ts`
- `client/src/views/student/practice.ts`
- `client/src/views/student/practice-card.ts`

## Handoff

Stephen authorized Codex on 2026-07-28 to take a minimal Saurav-owned
dependency if a later Stephen task is blocked. Any such cross-owner takeover
must be recorded in both developers' status files with exact files and commit
before implementation, and must not duplicate active Saurav work. Task 7
needed no takeover.
