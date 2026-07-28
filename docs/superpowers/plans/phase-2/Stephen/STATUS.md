# Stephen — Phase 2 progress

_Last updated: 2026-07-28_

## Current state

- P2-0 persistent content runs/SSE: **merged** in PR #32.
- Task 4 parameter sandbox: **merged** in PR #33 after eight security review
  rounds.
- Task 5 parameter serving/config: **complete on PR #34, CI green, awaiting
  review/merge**.
- Task 2 student Flag control: **complete on stacked PR #35**.
- Admin Console v0: **A1 complete on stacked PR #36**; aggregate-regression
  E2E fixture fix `51b43c4` is CI green.
- Task 7 progression/redirect + finite rounds: **complete on stacked PR #37**.
- Task 11 flag-loop phase exit E2E: **complete on stacked PR #38**.
- Task 8 question import: **complete on independent PR #39**.
- Saurav Task 6 remediation: **already merged on PR #31**; its stale
  “ready to push” status was reconciled on 2026-07-28.
- Task 10 custom generation/regeneration: **complete on PR #40** (`0870e23`)
  after the recorded cross-owner takeover.
- Admin Console v0 A2 Student Preview: **complete at `9f68a44` on draft PR
  #41, CI green**, using the explicit PR #37 + PR #36 integration stack.
- Task 9 parameterized-script migration: **complete at `ae1f0e9` on CI-green
  draft PR #42**, integrating the explicit PR #34 + PR #39 heads under Stephen's
  standing cross-owner authorization.

Admin v0 is Stephen-owned staging enablement. Saurav does not need to confirm
or stop his own work; this status is the requested informational handoff so
his agent can avoid claimed files.

## Two-agent coordination

Claude completed Phase 2 Task 5 and released the shared parameterization paths
at `210c68f`; PR #34 is the base of Stephen's current stacked PR chain.

Codex completed:

- Task 2 on PR #35, stacked on #34.
- Admin A1 on PR #36, stacked on #34.
- Task 7 on PR #37 (`codex/phase-2-task7-progression`), stacked on #35 so the
  practice work includes Task 2 and Task 5's final parameter
  echo/substitution behavior.
- Task 11 on PR #38 (`codex/phase-2-task11-flag-loop`), stacked on #37.
- Task 8 on PR #39 (`codex/phase-2-task8-import`), based directly on `main`.

Codex records current paths in
[`coordination/CODEX.md`](coordination/CODEX.md). Student Preview A2 waits for
PR #34, Admin A1 PR #36, and Task 7 PR #37 at integration time; implementation
now proceeds on their released stacked code and will reuse rather than
duplicate Task 5.

Task 9 was completed without waiting for human-controlled dependency merges:
Codex integrated the exact complete, released, CI-green PR #34 + PR #39 heads
on a short-lived stack and did not merge either PR to `main`.

## Task 9 result

Codex completed the last unimplemented Phase 2 code task on draft PR #42.
Instructor Import now has an isolated-sandbox review path for existing
`generate(random)` scripts. A fixed-seed preview shows values and substituted
stem/options; generated-variable/template mismatches block writes; commit
repeats validation and creates exactly one Draft with `generateScript` on v1.

Verification: 3 focused suites / 36 tests, full 54 suites / 594 tests,
typecheck, lint, Node 24 build, and a real SAML-session Chromium UI/DB flow.
The browser proved preview/commit/open-question clicks, exactly one Draft and
version write, zero browser errors, and zero residual fixtures. Implementation
commit: `ae1f0e9`. PR #42 is CI green and remains draft until dependency PRs
#34/#39 merge; Codex did not merge them.

## Phase 2 + Admin aggregate regression

Codex assembled the exact released heads behind PRs #42, #41, #38, and #40
(therefore including their Task 5/2/7/8/9/Admin dependencies) with current
`main` on regression-only branch
`codex/phase-2-admin-integration-regression` at `c4def83`. This branch is a
tested conflict-resolution reference, not a merge PR.

The aggregate tree passes 61 Jest suites / 640 tests, typecheck, lint, and the
Node 24 server/client build. Real SAML-session browser regression passed 10
scenarios (1 opt-in live-LLM scenario skipped): app shell, custom generation
and explicit regeneration, full instructor pipeline/publish, published and
unpublished Student Preview isolation, landing, parameterized-script
preview/import/open, and reload/identity walking skeleton.

The first aggregate browser run correctly exposed one stale E2E fixture:
Admin A1 requires the global platform-Instructor grant for course creation,
while the shared `faculty` test user still relied on SAML affiliation. The
production guard was not relaxed. PR #36 now seeds an admin-style grant keyed
by the IdP-returned canonical uid in E2E global setup (`51b43c4`, CI green).
The corrected aggregate run passed.

Merge/rebase hotspots proved and preserved in `c4def83`:

- `server/src/app.ts`: keep Import, Admin, and Preview routers.
- `client/src/main.ts`: keep Import, Admin Accounts, and Student Preview views.
- Question Detail/API: keep both Regenerate and Parameters, plus both
  import/script-migration and regeneration client contracts.
- When PR #36 meets PR #38, keep PR #38's `E2E_REUSE_AUTH_FILE` path and run
  platform-Instructor fixture provisioning after both fresh and reused
  `/api/auth/me` responses.

## Task 7 result

- Serving exhausts every unseen Approved question for an LO before the first
  repeat becomes an explicit round summary.
- Mastery recommendations offer real advance/finish and keep-practicing
  actions.
- The course-configured consecutive easy/medium miss threshold returns an
  inline non-blocking material redirect; hard-tier misses retain mastery
  step-back precedence.
- Redirect feedback never includes the current correct answer. Ready material
  links resolve through an enrolled-student route restricted to the exact
  course/LO.
- Focused 61 tests and full 53 suites / 583 tests passed; typecheck, lint, and
  build passed.
- Live SAML student browser regression passed for round completion, repeat
  confirmation, third-miss redirect, real material target, non-blocking
  continue, both recommendation decisions, and immediate Covered sidebar
  state. Browser logs were empty.
- Browser review caught and fixed stale retry wording in redirect transcripts
  and a stale sidebar mastery label.

All Task 7 browser fixtures, attempts, notifications, and temporary course
roles were localhost-only and removed before handoff; residual fixture counts
were verified as zero.

## Task 11 result

Codex completed the joint Phase 2 flag-loop exit spec on PR #38, stacked on
PR #37. The E2E proof covers:
student flag → instructor standard notification and queue → four additional
student flags/attempts → elevated auto-pause → Approved-only serving exclusion
→ instructor Clear → serving restored → student resolution notification.

The focused spec passed. Full verification passed with 53 Jest suites / 583
tests, typecheck/lint/build, and 12 current Playwright scenarios; the existing
opt-in live-LLM scenario was skipped. Explicit post-run counts for E2E courses,
flags, attempts, and notifications were all zero.

### Recorded cross-owner unblock

Task 11's first real browser run found and fixed a merged Task 3 client lifecycle bug:
`createNotificationBell()` starts `poll()` before its wrapper is attached, so
the `isConnected` teardown branch cancels polling permanently and both shells
show “No notifications yet” despite stored notifications. Stephen's standing
authorization applied: commit `4422d20` contains the minimal Saurav-owned fix
in `client/src/notifications-bell.ts`, covered by the Task 11 E2E. No other
Task 3 file changed.

### Full-E2E stabilization claim

Task 11's required full-suite run exposed stale Phase 0/example assertions
that still expected the deleted
boilerplate shell (`Welcome`, `Members Area`, Notes, Faculty Area) after the
FinanceBot instructor/student shells replaced it, plus two strict Playwright
selectors that break when real local data contains more than one course.
Codex aligned only these E2E files with the current product:

- `tests/e2e/app.spec.ts`
- `tests/e2e/classes.spec.ts`
- `tests/e2e/instructor-pipeline.spec.ts`
- `tests/e2e/practice-loop.spec.ts`
- `tests/e2e/walking-skeleton.spec.ts`

No production route/service changed for these stale assertions. These paths
are released at `4422d20`.

## Task 8 cross-owner result

Admin A2 remains intentionally blocked until PRs #34, #36, and #37 merge.
Stephen authorized Codex to continue Phase 2 by taking Saurav's independent,
not-started Task 8. It is complete on PR #39 and directly advances the only
remaining Phase 2 exit criterion: importing existing COMM 298 content as
Drafts.

The exact implementation claim is:

- `package.json`, `package-lock.json`
- `server/src/services/import.service.ts`, `server/src/routes/import.routes.ts`
- `server/src/app.ts`
- `client/src/views/instructor/import.ts`
- `client/src/api.ts`, `client/src/main.ts`, `client/src/views/instructor/shell.ts`
- `tests/fixtures/import-sample.csv`, `tests/fixtures/import-sample.json`,
  `tests/fixtures/import-sample-qti.xml`
- `tests/unit/import.service.test.ts`, `tests/unit/import.routes.test.ts`
- `tests/e2e/import.spec.ts`
- `docs/api-contract.md` and Task 8 plan/status documents

No Saurav implementation existed to duplicate. The implementation is
`2d3313e`; all listed paths are released. Focused 2 suites / 15 tests, full 52
suites / 548 tests, typecheck/lint/build, and the real instructor browser
upload/preview/commit flow passed. Cleanup assertions found zero remaining
course, question, version, or role fixtures.

## Task 10 cross-owner result

Stephen authorized Codex to help complete unfinished Saurav tasks so Phase 2
can continue, with status recorded for both developers. The audit found that
Task 6 was already merged in PR #31 despite Saurav's stale status; Task 10 is
the next genuinely unstarted and now-unblocked item because P2-0 merged in PR
#32.

Codex completed Task 10 without waiting for Saurav confirmation. The released
implementation paths are:

- `server/src/services/generation.service.ts`
- `server/src/routes/generation.routes.ts`
- `server/src/types/domain.ts`
- `server/src/services/questions.service.ts`
- `client/src/views/instructor/preseeding.ts`
- `client/src/views/instructor/question-detail.ts`
- `client/src/api.ts`
- `tests/unit/custom-generation.test.ts`,
  `tests/unit/generation.routes.test.ts`,
  `tests/unit/preseeding.test.ts`
- `tests/e2e/custom-generation.spec.ts`
- `docs/api-contract.md` and Phase 2 plan/status documents

The existing pre-seeding page already owns custom prompt, target LO/type/
difficulty, and durable run/SSE progress. Task 10 extends that surface with
presets and material mention selection rather than creating a duplicate
generation page. Regeneration remains a side-by-side, no-autosave preview;
only the existing explicit edit/versioning path may replace the original.

The result is `0870e23` on PR #40. Exact, case-insensitive @mentions are
restricted to ready materials assigned to the selected LO/theme; four presets
come from the server; custom batches retain P2-0 runId/SSE progress; and
regeneration appends request provenance without saving content. Verification:
51 Jest suites / 543 tests, typecheck, lint, Node 24 build, and a real-session
browser pass for preset/mention/enqueue/preview/Replace with zero browser
errors. Browser fixtures were fully removed.

## Admin v0 decisions

- Admins grant a global `platformInstructor` capability by UBC PUID.
- Pre-login grants are pending records keyed by PUID; no placeholder User is
  created.
- Admin and Instructor are separate capabilities. Granting Instructor does
  not expose the Admin page and does not pass the Admin API guard.
- Platform Instructor authorizes the Instructor shell and course creation;
  existing-course access remains course-scoped.
- Student Preview uses separate Instructor-only endpoints and does not weaken
  `ensureCourseStudent()`.
- Preview of unpublished courses still serves approved questions only.
- Preview records are structurally separate from live attempts and cannot
  affect mastery, Review Book, flags, remediation, summaries, notifications,
  or analytics.

## Admin A2 Student Preview result

Codex completed the Stephen-owned preview slice without waiting for dependency
merges, using the previously recorded PR #37 + PR #36 integration stack. No PR
was merged to `main`.

- Added course-Instructor-only preview home/serve/submit endpoints. Student
  enrollment and course publication are bypassed only on these explicit
  routes; archived/future themes and non-Approved questions remain hidden.
- Added `previewAttemptRecords` with an Instructor/question-version/answer
  snapshot. Live `attemptRecords`, mastery, Review Book, flags/auto-pause,
  remediation, summaries, progression, notifications, and analytics are not
  called.
- Extracted a pure grading seam from `attempts.service.ts`; the existing live
  path and preview share grading/feedback but not persistence or follow-on
  workflows.
- The Instructor dashboard now has a working **Preview as Student** action.
  The view reuses the real question card through a preview-only adapter,
  omits Flag, and keeps a persistent no-progress banner.
- Verification passed: 57 Jest suites / 606 tests, server/client typecheck,
  lint, Node 24 build, and a real SAML-session Playwright scenario covering
  published + unpublished preview, Approved-only exclusion of a Draft,
  answer feedback, exactly one preview record, zero live-learning records,
  and zero browser errors. Fixture residuals were zero.

Implementation commit: `9f68a44`. Draft PR:
https://github.com/ubc/tlef-financebot/pull/41. It remains draft only because
its two released dependency lines must merge first; after #34/#35/#37 and #36,
rebase/retarget #41 and mark it ready. All A2 implementation paths are
released at this commit.

## Message for Saurav

No action is required to start Codex work. Please treat the exact paths in
both coordination ledgers as reserved while their state is active. Stephen
authorized Codex to take a minimal Saurav-owned dependency if it becomes the
only blocker; Codex will record any such cross-owner takeover here and in
Saurav's status before implementation, and will not duplicate active work.

Current PRs:

- #34 — Task 5 parameterization, CI green
- #35 — Task 2 student Flag control; 51 suites / 570 tests and live student
  browser regression passed
- #36 — Admin A1; 53 suites / 585 tests and live Admin active/pending/revoke
  regression passed
- #37 — Task 7 progression/redirect + finite rounds; 53 suites / 583 tests and
  live student browser regression passed
- #38 — Task 11 flag-loop phase exit; 53 suites / 583 tests, 12 Playwright
  scenarios, typecheck/lint/build, and zero fixture residuals
- #39 — Task 8 CSV/JSON/QTI import; independent on main, 52 suites / 548
  tests and live instructor upload/preview/commit regression passed
- #40 — Task 10 custom generation/regeneration; 51 suites / 543 tests plus
  real-session preset/@mention/side-by-side/explicit-Replace regression passed
- #41 — Admin A2 Instructor Student Preview; draft only for stack order,
  57 suites / 606 tests plus real-session published/unpublished isolation
  regression passed

Admin browser test mutations were localhost-only and fully restored (no
leftover test grants; test-user Admin bit returned false).

## Release-readiness continuation — 2026-07-28

Codex re-audited the live GitHub state instead of treating earlier green
checks as sufficient. PRs #34, #40, and #42 had become `CONFLICTING` only
because independently published Phase 2 plan/status commits touched the same
documents. The latest `main` was merged into each feature branch, with the
newer `main` ledger retained and no production-code conflict:

- #34: `6c61ce2` — mergeable, CI green
- #40: `a2b20e6` — mergeable, CI green
- #42: `20fdbe0` — mergeable, CI green; still draft for #34/#39 dependency

Admin A1 now permanently covers its real page controls in
`tests/e2e/admin-accounts.spec.ts` (`57ee5f3` on #36). The browser test grants
one pending CWL and one existing-user Active Instructor, exercises Search,
confirms both Revoke actions, asserts the active User bit is cleared, records
no browser errors, and restores the shared faculty user's original Admin
state. #36 was then synchronized with the refreshed #34 base at `56a8ddd`;
draft #41 carries the same test/base at `04c188a`; both are mergeable and CI
green.

The regression-only integration branch is refreshed at `27b4b26`. Current
aggregate evidence is 61/61 Jest suites and 640/640 tests, typecheck, lint,
Node 24 production build, plus 12 passed real-session Chromium scenarios and
one intentionally skipped opt-in live-LLM scenario. The click run covers Admin
grant/search/revoke, Student Preview published/unpublished isolation, CSV
import, parameterized-script migration, custom generation/regeneration,
instructor setup/publish, shell, landing, and identity. Exact post-run fixture
counts were `adminGrants=0`, `adminUsers=0`, and `courses=0`.

`tests/e2e/global-setup.ts` is a mandatory final-stack merge resolution: retain
Task 11's `E2E_REUSE_AUTH_FILE` validation and Admin A1's
`ensureE2ePlatformInstructor()` call for both reused and fresh sessions. The
tested combined file is on the regression branch; accepting only either PR's
side would drop coverage or break course-creating E2E specs.

The filesystem/content audit found no actual COMM 298 practice-set export or
parameterized-script source in this repository, `tlef-create`, or Stephen's
Finance-bot review note. Therefore the core exit checkbox for importing real
COMM 298 content remains honestly open. Synthetic fixtures prove the tooling,
but are not relabelled as instructor content. No feature PR was merged by
Codex.

## Admin PUID-compatible replacement — 2026-07-28

Stephen asked Codex to replace the earlier uid-keyed Admin A1 experiment with
a clean PR based directly on current `main`, because the staging SAML response
can contain a valid PUID while `uid` and profile fields are empty.

- PUID is now the grant/provisioning key. A grant can remain pending before
  first login without creating a placeholder User.
- The Admin page lists every persisted User plus pending grants, with PUID,
  available CWL/name/email/affiliation metadata, last login, and explicit
  Admin/Instructor/Pending state.
- SAML name handling uses released display/name/email/CWL fields with PUID as
  the final fallback.
- Stephen's `ESI5CZY7J307` is a staging-only bootstrap Admin; production does
  not receive this hardcode.
- Granting `platformInstructor` does **not** grant `isAdmin`: the recipient has
  no Admin navigation and receives `403` from `/api/admin/*`.
- The Admin page layout was corrected with a padded card body, contained input,
  separate search toolbar, and a no-horizontal-overflow mobile layout.

Branch: `codex/admin-console-puid-compatible`. The PR URL, commit, and final
targeted verification will be appended after publishing. Nothing is merged to
`main`.
