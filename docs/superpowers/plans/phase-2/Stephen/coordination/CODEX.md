# Codex file claim — Stephen work

**Ledger owner:** Codex only  
**Last updated:** 2026-07-28
**State:** Task 2 student Flag control active; Admin A1 waits for PR #34 merge
**Base:** PR #34 head `7fdd2f3` (`stephen/phase-2-task5-params`)

Both agents read this file and `CLAUDE.md` before editing. Each agent updates
only its own claim file. While multiple Stephen worktrees are active, publish
narrow plan commits instead of running the current whole-folder `sync-plans`
script from a stale worktree; it has overwritten the other agent's newer
ledger more than once. A path claimed by the other agent is read-only until
that agent records `released` plus a commit SHA.

## Active task

Phase 2 Task 2 — Stephen's student Flag control half.

Branch: `codex/phase-2-task2-student-flag`, stacked on PR #34's final head so
the one-line Task 5 change to `practice-card.ts` is already present rather
than conflicted.

## Task 2 files claimed by Codex

- `client/src/api.ts`
- `client/src/views/student/practice-card.ts`
- focused Task 2 tests or browser evidence
- `docs/superpowers/plans/phase-2/2026-07-11-phase-2-pilot-readiness.md`
- `docs/superpowers/plans/phase-2/Stephen/2026-07-23-phase-2-pilot-readiness-stephen.md`
- `docs/superpowers/plans/phase-2/Stephen/STATUS.md`
- `docs/superpowers/plans/phase-2/Stephen/coordination/CODEX.md`

Claude explicitly released `client/src/api.ts` and
`client/src/views/student/practice-card.ts` at final Task 5 commit `210c68f`;
Codex does not change Task 5's parameter contracts.

## Admin A1 checkpoint

The disjoint backend is pushed on `codex/admin-platform-instructor` through
`e6fc19a`. The verified client integration commit `3bd4b5f` remains local on
`codex/admin-platform-instructor-integration`, previously stacked on the
pre-final Task 5 head. After PR #34 merges, Codex will transplant only its
Admin commits onto latest `main`, rerun the full suite, push, and open the
complete Admin A1 PR.

## Preview A2 reservation

Student Preview is not active during Task 2. Claude released its Task 5 seams,
but A2 still waits for PR #34 and Admin A1 to merge. Expected A2 paths remain:

- `server/src/services/preview.service.ts`
- `server/src/routes/preview.routes.ts`
- `server/src/services/serving.service.ts`
- `server/src/services/attempts.service.ts`
- `client/src/views/instructor/student-preview.ts`
- `client/src/views/instructor/dashboard.ts`

## Handoff

Task 2 starts immediately. Stephen authorized Codex on 2026-07-28 to take a
minimal Saurav-owned dependency if a later Stephen task is blocked; any such
cross-owner takeover must be recorded in both developers' status files with
the exact files and commit, and must not duplicate active Saurav work.
