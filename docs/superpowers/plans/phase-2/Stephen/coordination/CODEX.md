# Codex file claim — Stephen work

**Ledger owner:** Codex only

**Last updated:** 2026-07-28

**State:** Admin A1 implementation complete; publication waiting on Task 5 push

**Branch:** `codex/admin-platform-instructor`

**Base:** `f179d1f` (`origin/main`, including Claude's restored Task 5 claim)

Both agents read this file and `CLAUDE.md` before editing. Each agent updates
only its own claim file. While two Stephen worktrees are active, publish claim
updates as narrow commits instead of running the current whole-folder
`sync-plans` script from a stale worktree; it can overwrite the other agent's
newer ledger. A path claimed by the other agent is read-only until that agent
records `released` plus a commit SHA.

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
- `server/src/routes/auth.routes.ts`
- `server/src/routes/courses.routes.ts`
- `server/src/app.ts`
- relevant Admin/auth `AGENTS.md`

Claude's published Task 5 claim explicitly leaves these server files free.
Codex will not modify Claude's params/serving/attempt/question files.

## Client/shared wiring — locally integrated after Claude's release

Claude's local ledger released the shared paths at Task 5 commit `ae55672`.
Codex has completed and committed its disjoint additions to:

- `client/src/api.ts`
- `client/src/main.ts`
- `docs/api-contract.md`
- `client/src/views/admin/accounts.ts`
- `client/src/views/home.ts`
- `client/src/views/instructor/courses.ts`
- relevant client/root `AGENTS.md`

These changes are committed only on local stacked branch
`codex/admin-platform-instructor-integration`. Codex will not push that branch
while its history contains Claude's unpublished Task 5 commit.

## Preview paths — released locally, not yet started

Claude's local claim releases these after `ae55672`, but A2 still waits for
Task 5 publication and A1 merge:

- `server/src/services/serving.service.ts`
- `server/src/services/attempts.service.ts`
- `server/src/routes/questions.routes.ts`
- Task 5 parameter files or tests

## Handoff

Claude claim confirmed from commit `79387cc`; an accidental stale-plan publish
was precisely reverted by `f179d1f`.

Backend checkpoint pushed to `codex/admin-platform-instructor`:

- `5e32b5e` — grant collection/service/routes, Admin and platform-Instructor
  guards, first-login grant application, course-creation gate, audit writes,
  and focused tests.
- `8619ec0` — expose `platformInstructor` in the safe `/api/auth/me` summary.
- `392fa38` — treat the grant collection as the authorization source of truth
  during Passport deserialization, closing a revoke/first-login race.
- `1671fed` — re-export the platform guards from the auth component boundary.
- `e6fc19a` — keep internal PUID/audit identifiers out of Admin account API
  responses; focused tests updated.

Local integration commits:

- `92d18dc` — the same identifier-privacy refinement on the Task 5 stack.
- `3bd4b5f` — Admin account page, Admin-only navigation, explicit Instructor
  shell selection, course-create UI gate, client contracts, and docs.

Verification on the combined Task 5 + Admin tree: 53 Jest suites / 581 tests,
typecheck, lint, and server/client compilation using the bundled Node 24
runtime all passed. Next action: when Claude publishes `ae55672`, rebase the
client commit onto the published Task 5 branch/main, push the complete Admin
branch, and open the A1 PR.
