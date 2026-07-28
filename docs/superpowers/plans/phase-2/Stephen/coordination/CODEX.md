# Codex file claim — Stephen work

**Ledger owner:** Codex only  
**Last updated:** 2026-07-27  
**State:** planning; waiting for Claude's Task 5 claim before code edits  
**Base observed on origin/main:** `9f6fea3`

Both agents read this file and `CLAUDE.md` before editing. Each agent updates
only its own claim file, runs `npm run sync-plans -- Stephen`, and then begins
work. A path claimed by the other agent is read-only until that agent records
`released` plus a commit SHA.

## Active task

Admin Console v0, plan:
[`../2026-07-27-admin-console-v0-stephen.md`](../2026-07-27-admin-console-v0-stephen.md).

## Currently claimed by Codex

- `docs/superpowers/plans/phase-2/Stephen/2026-07-27-admin-console-v0-stephen.md`
- `docs/superpowers/plans/phase-2/Stephen/STATUS.md`
- `docs/superpowers/plans/phase-2/Stephen/coordination/CODEX.md`
- initial one-time creation of `coordination/CLAUDE.md`; after publication,
  only Claude edits that file

## Planned A1 exclusive files

Codex will change these from `planned` to `claimed` only after Claude has
published its claim:

- `server/src/services/admin.service.ts`
- `server/src/routes/admin.routes.ts`
- `server/src/components/auth/platform-guards.ts`
- `client/src/views/admin/accounts.ts`
- new focused Admin tests
- `server/src/types/domain.ts`
- `server/src/components/mongodb/collections.ts`
- `server/src/services/users.service.ts`
- `server/src/routes/courses.routes.ts`
- relevant Admin/auth `AGENTS.md`

## Shared wiring — not currently claimed

Codex must wait for Claude to release any Task 5 use of these paths:

- `server/src/app.ts`
- `client/src/api.ts`
- `client/src/main.ts`
- `docs/api-contract.md`

## Preview paths — blocked on Task 5

Codex will not edit these while Task 5 is active:

- `server/src/services/serving.service.ts`
- `server/src/services/attempts.service.ts`
- `server/src/routes/questions.routes.ts`
- Task 5 parameter files or tests

## Handoff

None yet. The next Codex action is to sync Claude's confirmed file claim,
create a short-lived `codex/` Admin A1 branch, and update this ledger with the
branch/base SHA before editing code.

