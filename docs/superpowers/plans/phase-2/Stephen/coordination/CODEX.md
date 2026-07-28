# Codex file claim — Stephen work

**Ledger owner:** Codex only  
**Last updated:** 2026-07-28
**State:** draft PR #46 — awaiting Stephen manual acceptance
**Base observed on origin/main:** `4088f15`
**Branch:** `codex/anonymous-student-preview`

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

## Active corrective claim — full Student View

The former Admin/Task-5 coordination wait is released: both work streams are
merged. For Stephen's tested Preview correction Codex claims:

- `client/src/main.ts`
- `client/src/api.ts`
- `client/src/views/home.ts`
- `client/src/views/student/{course-home,lo-list,practice,review-book,session-summary,shell}.ts`
- `client/src/views/instructor/{dashboard,student-preview}.ts`
- new preview-session/client adapter files under `client/src/views/student/`
- `server/src/routes/preview.routes.ts`
- `server/src/services/{preview,serving}.service.ts`
- `server/src/types/domain.ts`
- `server/src/components/mongodb/collections.ts`
- `server/src/app.ts` only if an additional preview mount is required
- preview-focused unit/E2E/a11y tests
- Preview-related `AGENTS.md`, API contract, and Stephen status/coordination
  documentation

No live student attempt/mastery/Review Book/flag/notification service is
claimed for mutation. The Preview implementation must remain on its separate
route, service, collection, and session boundary.

## Handoff

The anonymous full Student View follow-up is implemented on
`codex/anonymous-student-preview` in draft
[PR #46](https://github.com/ubc/tlef-financebot/pull/46).

- Full Student shell/routes/renderers are reused through a Preview adapter.
- Attempts, mastery replay, Review Book, flags, summary, skip, and remediation
  are scoped to an anonymous Preview UUID and separate 24-hour TTL
  collections.
- Browser acceptance, focused Preview E2E, **61 suites / 644 Jest tests**,
  typecheck, lint, and build pass.
- No Saurav confirmation is required. Keep the active claim until the PR is
  merged; then mark it released with the merge SHA.
