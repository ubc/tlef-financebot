# Codex file claim — Stephen work

**Ledger owner:** Codex only  
**Last updated:** 2026-07-28
**State:** Task 7 progression/redirect + finite rounds active
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

## Task 7 files claimed by Codex

- create `server/src/services/progression.service.ts`
- `server/src/services/attempts.service.ts`
- `server/src/services/serving.service.ts`
- `client/src/api.ts`
- `client/src/practice-session.ts`
- `client/src/views/student/practice.ts`
- `client/src/views/student/practice-card.ts`
- create `tests/unit/redirect.test.ts`
- focused serving/attempt regression tests
- `docs/superpowers/plans/phase-2/2026-07-11-phase-2-pilot-readiness.md`
- `docs/superpowers/plans/phase-2/Stephen/2026-07-23-phase-2-pilot-readiness-stephen.md`
- `docs/superpowers/plans/phase-2/Stephen/STATUS.md`
- `docs/superpowers/plans/phase-2/Stephen/coordination/CODEX.md`

Task 7 may import `notifyCourseStaff` and read ready materials, but does not
edit Saurav's notifications/materials services. Preview A2 does not edit these
paths until Task 7 releases them.

## Completed handoffs

- Task 2: commit `a685800`, stacked PR #35. Live browser verified blank-reason
  Flag, answer-after-flag, correct feedback, and Strategy-A retry controls;
  console clean.
- Admin A1: branch `codex/admin-console-v0`, stacked PR #36. Full 585 tests,
  typecheck/lint/build, and live active/pending/revoke Admin regression pass.

## Preview A2 reservation

Student Preview is not active during Task 7. It waits for PR #34 and Admin A1
to merge, plus Task 7's release of the student-practice seams. Expected A2
paths remain:

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
