# Codex file claim — Stephen work

**Ledger owner:** Codex only  
**Last updated:** 2026-07-28
**State:** Task 10 active — recorded cross-owner takeover
**Base:** `origin/main` at `1ea1647`

Both agents read this file and `CLAUDE.md` before editing. Each agent updates
only its own claim file. While multiple Stephen worktrees are active, publish
narrow plan commits instead of running the current whole-folder `sync-plans`
script from a stale worktree; it has overwritten the other agent's newer
ledger more than once. A path claimed by the other agent is read-only until
that agent records `released` plus a commit SHA.

## Active Task 10

Phase 2 Task 10 — custom-prompt generation, material-scoped @-mentions,
editable presets, and side-by-side question regeneration. Stephen authorized
this Saurav-owned takeover; it is recorded in both developers' status files
before implementation. P2-0 is merged, and no Saurav Task 10 implementation
branch or active claim exists.

### Task 10 files claimed by Codex

- `server/src/services/generation.service.ts`
- `server/src/routes/generation.routes.ts`
- `server/src/types/domain.ts`
- `server/src/services/questions.service.ts`
- `client/src/views/instructor/preseeding.ts`
- `client/src/views/instructor/question-detail.ts`
- `client/src/api.ts`
- focused Task 10 tests
- `docs/api-contract.md`
- Phase 2 Task 10 plan/status documents

The existing pre-seeding view is the canonical generation UI and already
consumes P2-0 run/SSE state, so Codex will extend it instead of adding the
duplicate `generate.ts` page named in the older plan. Shared files remain
append-only/surgical. Final commit, PR, verification, and release state will
replace this active claim at handoff.

## Released Task 8

Phase 2 Task 8 — CSV/JSON/QTI question import with preview, partial-success
parsing, parameterization flags, and Draft-only commit. Stephen explicitly
authorized this takeover; complete on independent PR #39.

Implementation commit: `2d3313e`; plan/status publish: `46bf30b`. All paths below are
released. Task 9 may extend the import files after PR #39 merges.

### Task 8 files claimed by Codex

- `package.json`, `package-lock.json`
- create `server/src/services/import.service.ts`
- create `server/src/routes/import.routes.ts`
- `server/src/app.ts`
- create `client/src/views/instructor/import.ts`
- `client/src/api.ts`
- `client/src/main.ts`
- `client/src/views/instructor/shell.ts`
- create `tests/fixtures/import-sample.csv`
- create `tests/fixtures/import-sample.json`
- create `tests/fixtures/import-sample-qti.xml`
- create `tests/unit/import.service.test.ts`
- create `tests/unit/import.routes.test.ts`
- create `tests/e2e/import.spec.ts`
- `docs/api-contract.md`
- Phase 2 Task 8 plan/status documents

No active Saurav code branch or uncommitted work is being reused. Task 9 may
later extend the three import files after PR #39 merges.

Verification: focused 2 suites / 15 tests; full 52 suites / 548 tests;
typecheck/lint/build; real SAML instructor Import → preview → confirm → bank
flow. Cleanup assertions found zero residual course/question/version/role
fixtures.

## Released Task 11

Phase 2 Task 11 — joint flag-loop exit proof, driven by Stephen/Codex and
complete on stacked PR #38.

Implementation commit: `4422d20`; plan update: `8c029c2`. All paths listed
below are released. Student Preview A2 remains deliberately unstarted until
PRs #34, #36, and #37 merge.

### Task 11 files claimed by Codex

- create `tests/e2e/flag-loop.spec.ts`
- `tests/e2e/global-setup.ts` (explicit opt-in reuse of an existing auth state
  so parallel agents can run isolated app ports without changing normal CI)
- `client/src/notifications-bell.ts` (minimal recorded cross-owner Task 3
  lifecycle fix: defer first poll until the wrapper can be connected)
- `tests/e2e/app.spec.ts` (replace deleted boilerplate-shell expectations)
- `tests/e2e/classes.spec.ts` (current-shell role checks)
- `tests/e2e/instructor-pipeline.spec.ts` (strict heading selector)
- `tests/e2e/practice-loop.spec.ts` (scope Open to the created course card)
- `tests/e2e/walking-skeleton.spec.ts` (current instructor home/reload proof)
- `docs/superpowers/plans/phase-2/2026-07-11-phase-2-pilot-readiness.md`
- `docs/superpowers/plans/phase-2/Stephen/2026-07-23-phase-2-pilot-readiness-stephen.md`
- `docs/superpowers/plans/phase-2/Stephen/STATUS.md`
- `docs/superpowers/plans/phase-2/Stephen/coordination/CODEX.md`

Task 11 reads Saurav's flag/notification/queue implementation through public
routes and direct E2E fixture queries. It does not claim or edit those service
or client source files except the notification-bell blocker now recorded in
both developers' status files.

The five pre-existing E2E specs above were added after Task 11's first full
suite: the new flag loop passes, while those specs still assert the retired
Phase 0 demo shell or use selectors that are ambiguous against a real shared
Mongo dataset. This is test stabilization only; no additional production file
is claimed.

Verification: 53 Jest suites / 583 tests, typecheck/lint/build, and 12
Playwright scenarios passed; one existing opt-in live-LLM scenario skipped.
Post-run E2E course/flag/attempt/notification counts were all zero.

## Released Task 7

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
