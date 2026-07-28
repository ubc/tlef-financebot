# Codex file claim — Stephen work

**Ledger owner:** Codex only  
**Last updated:** 2026-07-28
**State:** Task 7 released; PR #37 open
**Base:** PR #35 head `a685800` (`codex/phase-2-task2-student-flag`)

Both agents read this file and `CLAUDE.md` before editing. Each agent updates
only its own claim file. While multiple Stephen worktrees are active, publish
narrow plan commits instead of running the current whole-folder `sync-plans`
script from a stale worktree; it has overwritten the other agent's newer
ledger more than once. A path claimed by the other agent is read-only until
that agent records `released` plus a commit SHA.

## Active task

Phase 2 Task 7 — progression recommendations, repeated-failure redirect, and
Stephen's accepted finite-round semantics.

Branch: `codex/phase-2-task7-progression`, stacked on PR #35 so it includes the
finished Task 2 practice-card behavior and PR #34's final parameter echo.
Implementation commit: `689e40e`. PR:
<https://github.com/ubc/tlef-financebot/pull/37>.

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
- Live SAML student browser verified finite rounds, the third-miss chosen-only
  redirect, its protected material target, non-blocking continue,
  recommendation actions, immediate Covered state, and empty browser logs.
- Local browser fixtures and roles were fully removed.

## Completed handoffs

- Task 2: commit `a685800`, stacked PR #35. Live browser verified blank-reason
  Flag, answer-after-flag, correct feedback, and Strategy-A retry controls;
  console clean.
- Admin A1: branch `codex/admin-console-v0`, stacked PR #36. Full 585 tests,
  typecheck/lint/build, and live active/pending/revoke Admin regression pass.

## Released paths / Preview A2

The Task 7 claim is released at `689e40e`. Student Preview A2 waits for PR #34,
Admin A1 PR #36, and Task 7 PR #37 to merge before rebasing and editing:

- `server/src/services/preview.service.ts`
- `server/src/routes/preview.routes.ts`
- `server/src/services/serving.service.ts`
- `server/src/services/attempts.service.ts`
- `client/src/views/instructor/student-preview.ts`
- `client/src/views/instructor/dashboard.ts`

## Handoff

Stephen authorized Codex on 2026-07-28 to take a minimal Saurav-owned
dependency if a later Stephen task is blocked; any such cross-owner takeover
must be recorded in both developers' status files with the exact files and
commit, and must not duplicate active Saurav work.
