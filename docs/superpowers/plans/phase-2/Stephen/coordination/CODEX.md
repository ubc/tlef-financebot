# Codex file claim — Stephen work

**Ledger owner:** Codex only

**Last updated:** 2026-07-28

**State:** claimed — Admin A1 backend in progress

**Branch:** `codex/admin-platform-instructor`

**Base:** `f179d1f` (`origin/main`, including Claude's restored Task 5 claim)

Both agents read this file and `CLAUDE.md` before editing. Each agent updates
only its own claim file, runs `npm run sync-plans -- Stephen`, and then begins
work. A path claimed by the other agent is read-only until that agent records
`released` plus a commit SHA.

## Active task

Admin Console v0, plan:
[`../2026-07-27-admin-console-v0-stephen.md`](../2026-07-27-admin-console-v0-stephen.md).

## Currently claimed by Codex — exclusive

- `docs/superpowers/plans/phase-2/Stephen/2026-07-27-admin-console-v0-stephen.md`
- `docs/superpowers/plans/phase-2/Stephen/STATUS.md`
- `docs/superpowers/plans/phase-2/Stephen/coordination/CODEX.md`
- `server/src/services/admin.service.ts`
- `server/src/routes/admin.routes.ts`
- `server/src/components/auth/platform-guards.ts`
- new focused Admin tests
- `server/src/types/domain.ts`
- `server/src/components/mongodb/collections.ts`
- `server/src/services/users.service.ts`
- `server/src/routes/courses.routes.ts`
- `server/src/app.ts`
- relevant Admin/auth `AGENTS.md`

Claude's published Task 5 claim explicitly leaves these server files free.
Codex will not modify Claude's params/serving/attempt/question files.

## Client/shared wiring — deferred, not claimed

Codex must wait for Claude to release its Task 5 use of these paths:

- `client/src/api.ts`
- `client/src/main.ts`
- `docs/api-contract.md`

`server/src/app.ts` is now claimed above because Claude explicitly recorded
that Task 5 does not touch it. The three client/contract paths remain deferred
until Claude releases Task 5. `client/src/views/admin/accounts.ts` will start
with that client slice so the branch stays buildable throughout.

## Preview paths — blocked on Task 5

Codex will not edit these while Task 5 is active:

- `server/src/services/serving.service.ts`
- `server/src/services/attempts.service.ts`
- `server/src/routes/questions.routes.ts`
- Task 5 parameter files or tests

## Handoff

Claude claim confirmed from commit `79387cc`; an accidental stale-plan publish
was precisely reverted by `f179d1f`. Codex is starting the disjoint Admin A1
backend. Client wiring and Student Preview remain blocked on Claude's release.
