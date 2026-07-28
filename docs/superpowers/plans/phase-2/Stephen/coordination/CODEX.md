# Codex file claim — Stephen work

**Ledger owner:** Codex only  
**Last updated:** 2026-07-28
**State:** Task 9 released at `ae1f0e9`; CI-green draft PR #42 open
**Base:** PR #34 Task 5 head plus PR #39 Task 8 integration

Both agents read this file and `CLAUDE.md` before editing. Each agent updates
only its own claim file. While multiple Stephen worktrees are active, publish
narrow plan commits instead of running the current whole-folder `sync-plans`
script from a stale worktree; it has overwritten the other agent's newer
ledger more than once. A path claimed by the other agent is read-only until
that agent records `released` plus a commit SHA.

## Released Task 9

Stephen authorized Codex to complete remaining Saurav work with status
recorded for both developers. Task 9 is the only remaining Phase 2
implementation task. Its dependencies are complete/released/CI-green on PR
#34 (sandbox-backed params service) and PR #39 (question import); Codex starts
from those exact heads without merging either PR to `main`.

Branch: `codex/phase-2-task9-script-migration`.

### Task 9 files claimed by Codex

- `server/src/services/import.service.ts`
- `server/src/routes/import.routes.ts`
- `server/src/services/questions.service.ts` (small create-time
  `generateScript` seam only)
- `client/src/views/instructor/import.ts`
- `client/src/api.ts`
- create `tests/unit/script-migration.test.ts`
- focused import route/questions tests as required
- create `tests/e2e/script-migration.spec.ts`
- `docs/api-contract.md`
- nearest `AGENTS.md`
- Phase 2 Task 9 core/personal plan checkboxes and Stephen/Saurav status

No flag, notification, remediation, generation, Admin, or student-practice
file is claimed.

### Task 9 handoff

- Implementation commit: `ae1f0e9`
- Draft PR: https://github.com/ubc/tlef-financebot/pull/42
- Dependency order: merge PR #34 and PR #39, then rebase/retarget #42 and
  mark it ready.
- Verification: 3 focused suites / 36 tests; full 54 suites / 594 tests;
  typecheck/lint/Node 24 build; real SAML-session Chromium preview → commit →
  open-question flow, exactly one Draft/version write, zero browser errors,
  and zero residual fixtures.
- All Task 9 paths are released. Codex did not merge either prerequisite.

## Released aggregate regression reference

Branch `codex/phase-2-admin-integration-regression`, commit `27b4b26`, is a
regression-only aggregation of current `main` plus PR #42, PR #41, PR #38,
and PR #40 heads. It is pushed only so both agents can inspect the tested
conflict resolutions; do not merge it as a task PR.

Verification: 61 Jest suites / 640 tests, typecheck, lint, Node 24 build, and
12 real-SAML-session browser scenarios passed; the opt-in live-LLM case was
skipped. The expanded run includes a permanent Admin Accounts
grant/search/revoke spec (`57ee5f3` on #36), and exact post-run fixture counts
were zero for Admin grants, Admin fixture Users, and E2E courses.

Shared-file resolution map:

- `server/src/app.ts`: preserve `importRouter`, `adminRouter`, and
  `previewRouter` imports/mounts.
- `client/src/main.ts`: preserve `renderImport`, `renderAdminAccounts`, and
  `renderStudentPreview` imports/routes.
- `client/src/views/instructor/question-detail.ts`: render the real
  `regenerateButton`, the Parameters link, and `regenerationPanel`.
- `client/src/api.ts`: preserve the Import/ScriptMigration block and the
  RegenerationVariant/regenerateQuestion block.
- `tests/e2e/global-setup.ts`: preserve Task 11's auth-reuse branch and call
  Admin A1 platform-Instructor provisioning for both fresh/reused sessions,
  keyed by `/api/auth/me`'s canonical uid.

### Release-readiness branch refresh

- #34 main-sync: `6c61ce2` (docs-only conflict resolution; mergeable/CI green)
- #36 Admin E2E + refreshed #34 base: `56a8ddd`
- #40 main-sync: `a2b20e6` (docs-only conflict resolution; mergeable/CI green)
- #41 latest Admin A1 test/base sync: `04c188a`
- #42 main-sync: `20fdbe0` (docs-only conflict resolution; mergeable/CI green)

The remaining core exit checkbox is not a code claim: actual COMM 298
practice-set/script sources are absent from the searched workspace, so they
cannot yet be imported as real Draft content.

### Current-head release candidate

Branch `codex/phase-2-release-candidate-20260728` replays every exact live
#34–#42 head onto `main@ac7bd0d`; integration merge `834f149`. It is pushed
for inspection only and has no PR.

Required final-tree resolutions, all verified on that branch:

- `client/src/main.ts`: keep Admin Accounts, Import, and Student Preview
  imports/routes.
- `server/src/app.ts`: keep `adminRouter`, `importRouter`, and
  `previewRouter` imports/mounts.
- `client/src/api.ts`: keep Import, Regeneration, and Script Migration API
  blocks.
- `client/src/views/instructor/question-detail.ts`: keep the working
  Regenerate button, Parameters link, and regeneration panel.
- `server/src/services/AGENTS.md`: keep Admin, Preview, and Import service
  entries.

Exact-tree evidence: 61/61 Jest suites and 640/640 tests; typecheck; lint; Node
24 build; 12 passed real-session Chromium scenarios with one opt-in live-LLM
skip; `adminGrants=0`, `adminUsers=0`, and `courses=0` after cleanup.

## Released Admin A2

Instructor Student Preview is active on `codex/admin-student-preview`.
Prerequisite code is released: Task 5 at `210c68f` / PR #34, Task 7 on PR #37,
and Admin A1 on PR #36. To keep working without merging on Stephen's behalf,
the implementation branch uses #37 as its stack base and merges #36 once.

### Admin A2 files claimed by Codex

- create `server/src/services/preview.service.ts`
- create `server/src/routes/preview.routes.ts`
- create `client/src/views/instructor/student-preview.ts`
- create focused preview service/route tests and Preview E2E
- `server/src/types/domain.ts`
- `server/src/components/mongodb/collections.ts`
- `server/src/app.ts`
- `server/src/services/serving.service.ts`
- `server/src/services/attempts.service.ts` only if a pure grading seam is
  required; no preview write may enter the live attempt path
- `client/src/api.ts`
- `client/src/main.ts`
- `client/src/views/instructor/dashboard.ts`
- the smallest reusable student practice-card/session seam only if required
- `client/public/styles/main.css` only for the persistent Preview banner/layout
- `docs/api-contract.md`, nearest `AGENTS.md`, Admin plan/status documents

No Admin A2 endpoint weakens `ensureCourseStudent()`. Preview activity uses its
own collection and cannot enter mastery, Review Book, flags, remediation,
summaries, notifications, progression, or analytics.

### Admin A2 verification

- 57 Jest suites / 606 tests passed.
- Server/client typecheck and lint passed.
- Node 24 vendor + server/client build passed.
- Real SAML-session Playwright passed on an isolated port while Claude kept
  its own server: Dashboard → Preview as Student, persistent no-progress
  banner, published/unpublished course states, Approved served and Draft
  excluded, Flag omitted, answer submitted, exactly one preview record, zero
  live attempt/mastery/Review Book/flag/notification/session-summary records,
  and zero browser errors.
- Browser fixture/course role and all fixture documents were removed.

Implementation commit: `9f68a44`. Draft PR:
<https://github.com/ubc/tlef-financebot/pull/41>. It targets PR #37 and includes
PR #36's Admin A1 integration; merge those dependency lines first, then
rebase/retarget and mark #41 ready. All Admin A2 paths are released at this
commit.

## Released Task 10

Phase 2 Task 10 — custom-prompt generation, material-scoped @-mentions,
editable presets, and side-by-side question regeneration. Stephen authorized
this Saurav-owned takeover; it is recorded in both developers' status files
before implementation. P2-0 is merged, and no Saurav Task 10 implementation
branch or active claim exists.

Implementation commit: `0870e23`; PR:
<https://github.com/ubc/tlef-financebot/pull/40>. All paths below are released.

### Task 10 files claimed and released by Codex

- `server/src/services/generation.service.ts`
- `server/src/routes/generation.routes.ts`
- `server/src/types/domain.ts`
- `server/src/services/questions.service.ts`
- `client/src/views/instructor/preseeding.ts`
- `client/src/views/instructor/question-detail.ts`
- `client/src/api.ts`
- `tests/unit/custom-generation.test.ts`
- `tests/unit/generation.routes.test.ts`
- `tests/unit/preseeding.test.ts`
- `tests/e2e/custom-generation.spec.ts`
- `docs/api-contract.md`
- Phase 2 Task 10 plan/status documents

The existing pre-seeding view is the canonical generation UI and already
consumes P2-0 run/SSE state, so Codex extended it instead of adding the
duplicate `generate.ts` page named in the older plan. Shared files remain
append-only/surgical.

Verification: 51 Jest suites / 543 tests, typecheck, lint, Node 24 build, and
one real-session Playwright scenario covering preset fill, material mention
autocomplete, enqueue payload, side-by-side generation, zero PATCH before
Replace, exactly one versioned PATCH after Replace, and zero browser errors.
Fixture residual counts were zero.

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

## Phase 2 current-head release candidate

Draft PR #44 is open from `codex/phase-2-release-candidate-20260728` to `main`
for Stephen's manual acceptance:
<https://github.com/ubc/tlef-financebot/pull/44>. It integrates the exact live
heads of PRs #34–#42 and the tested cross-branch conflict resolutions. Do not
merge it until Stephen explicitly approves the merge.
