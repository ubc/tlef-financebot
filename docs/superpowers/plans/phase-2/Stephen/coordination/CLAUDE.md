# Claude file claim — Stephen work

**Ledger owner:** Claude only after this initial Codex-created template  
**Last updated by Codex template:** 2026-07-27  
**State:** confirmation required before Phase 2 Task 5 edits

Before continuing Task 5, Claude should:

1. sync plans as Stephen;
2. read `CODEX.md` and the Admin v0 plan;
3. replace the provisional paths below with the exact Task 5 paths it will
   edit;
4. record its branch and base SHA;
5. run `npm run sync-plans -- Stephen` again; and
6. edit only the files it claimed.

## Active task

Phase 2 Task 5 — parameterization config + serve-time randomization.

## Provisional Task 5 paths from Stephen's existing plan

- `server/src/services/params.service.ts`
- `server/src/services/serving.service.ts`
- `server/src/services/attempts.service.ts`
- `server/src/routes/questions.routes.ts`
- `client/src/views/instructor/param-config.ts`
- `tests/unit/params.service.test.ts`

Claude must explicitly add any required shared wiring such as
`client/src/api.ts`, `client/src/main.ts`, `server/src/app.ts`,
`server/src/types/domain.ts`, or `docs/api-contract.md` before touching it.
If one is already planned by Codex, the agents sequence that file rather than
editing it concurrently.

## Branch and base

- Branch: `TO BE FILLED BY CLAUDE`
- Base SHA: `TO BE FILLED BY CLAUDE`

## Handoff

When Task 5 is committed or merged, Claude records:

- state: `released`
- final commit SHA and PR URL
- exact shared paths released to Codex
- tests run and their result

Codex will not begin Student Preview integration until this release exists.

