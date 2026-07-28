# Claude file claim — Stephen work

**Ledger owner:** Claude  
**Last updated:** 2026-07-28  
**State:** claimed — Task 5 in progress

## Active task

Phase 2 Task 5 — parameterization config + serve-time randomization.

## Branch and base

- Branch: `worktree-stephen-phase-2-task5-params` (worktree
  `stephen-phase-2-task5-params`); will push to remote as
  `stephen/phase-2-task5-params`.
- Base SHA: `2557d86` (`origin/main`, includes PR #33 — Admin v0's Gate A0
  publish commits and Task 4's merge are both already in this base).

## Claimed by Claude — exclusive while Task 5 is active

- Create: `server/src/services/params.service.ts`
- Create: `client/src/views/instructor/param-config.ts`
- Create: `tests/unit/params.service.test.ts`
- Modify: `server/src/services/serving.service.ts`
- Modify: `server/src/services/attempts.service.ts`
- Modify: `server/src/routes/questions.routes.ts`

Note for Codex: `server/src/types/domain.ts` already has
`QuestionVersion.paramSlots`/`generateScript` and
`AttemptRecord.paramValues` (added ahead of Task 5) — Task 5 does not expect
to modify `domain.ts`. If Admin/Preview needs new fields there, that file is
free for Codex to claim; flag it here first if Task 5 turns out to need a
change too, so we don't land conflicting edits.

## Shared wiring Claude will touch, in small append-only diffs

- `client/src/api.ts` — new `patchQuestionParams` / `previewQuestionParams`
  client functions.
- `client/src/main.ts` — route registration for `param-config.ts`
  (view-registration line only, not the `isInstructor()` logic Codex owns).
- `docs/api-contract.md` — new `PATCH /api/questions/:questionId/params` and
  `POST .../params/preview` entries.

`server/src/app.ts` is **not** touched by Task 5 — the new param-config
endpoints mount on the already-registered `questionsRouter`, so no new
`app.use(...)` line is needed. Codex's Admin/Preview routers are unaffected
by this branch.

## Handoff

Not yet released — Task 5 is starting now. On completion Claude will record
here:

- state: `released`
- final commit SHA and PR URL
- exact shared paths released to Codex (the three `api.ts`/`main.ts`/
  `api-contract.md` diffs above, plus `serving.service.ts` and
  `attempts.service.ts` for Slice A2's preview integration)
- tests run and their result

Codex will not begin Student Preview (Slice A2) integration until this
release exists, per Gate A1.5 in the Admin v0 plan.

