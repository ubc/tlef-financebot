# AGENTS.md — tests/

The testing setup. Three layers, mirroring the structure used in
[`tlef-biocbot`](https://github.com/ubc/tlef-biocbot) but written in TypeScript:

| Layer | Tool | Directory | What it covers |
| --- | --- | --- | --- |
| Unit + integration | Jest + ts-jest + supertest | `tests/unit/` | Pure functions, services with components mocked, routers over HTTP. Fast, no external services. |
| End-to-end | Playwright (Chromium) | `tests/e2e/` | The real app in a browser: landing, real CWL login, gated nav, Notes CRUD. |
| Accessibility | Playwright + `@axe-core/playwright` | `tests/a11y/` | axe WCAG A/AA scans of key pages. |

## Commands

One-time enrollment: `registration-codes.service.test.ts` and
`registration-codes.routes.test.ts` cover claim/recovery, idempotency, course
gates and authorization. `course-admin-workbench.spec.ts` covers the code UI
and TA email/CWL form with intercepted fixtures. Run
`npx playwright test --config playwright.enrollment-live.config.ts` for real
local SAML/Express/Mongo acceptance: Gradebook grants, concurrent same-code
redemption, receipt identity, revocation, legacy-code rejection and TA/CWL
activation. It creates and removes a synthetic course and its grants; no model
calls occur. Larger-list checks use 53 records over six pages, status filtering,
unused-code invalidation and retained membership after used-receipt deletion.
Live screenshots are written under
`artifacts/one-time-enrollment-2026-10-06/`.

Manual Canvas CSV imports: `people-import.test.ts` covers parser/HTTP boundaries,
owner/Admin authorization, snapshot CAS/revocation, publication/date gates,
membership readers and auditing. Build first, then run
`npx playwright test --config playwright.people-import.config.ts` for isolated
production UI upload/confirmation/removal, stale/all-rejected handling and
desktop/mobile dark axe scans. Run
`npx playwright test tests/e2e/people-import-live.spec.ts` for real local CWL,
MongoDB, student analytics and TA permission acceptance. The live suite uses
only faculty/student/staff/ta personas and a temporary course, and removes its
course, imported grants, permission overrides and course-scoped audit fixtures.

```bash
npm test                    # unit + integration (fast, no services needed)
npm run test:unit:watch     # …in watch mode
npm run test:unit:coverage  # …with a coverage summary + lcov
npm run test:unit:monocart  # …with the interactive monocart HTML coverage report
npm run test:e2e            # Playwright browser tests (needs MongoDB + IdP; see below)
npm run test:e2e:headed     # …with a visible browser
npm run test:ui             # …in Playwright's UI mode
npm run test:a11y           # axe accessibility scans
npm run test:report         # open the last Playwright HTML report
```

Reports land in (all git-ignored): `coverage-reports/unit-monocart/index.html`
(coverage), `playwright-report/` (e2e), `playwright-report-a11y/` (a11y).

## Prerequisites

- **Unit/integration:** none. They mock every external system, so no Docker /
  Ollama / network is required.
- **e2e + a11y:** the app must be able to boot, so **MongoDB + the SAML IdP** must
  be running and the **IdP certificate** present (`npm run saml:fetch-cert`). The
  **classes** e2e/a11y specs also need **FakeAcademicAPI** on :3689
  (`cd ../services/FakeAcademicAPI && docker compose up -d`). The Playwright
  `webServer` builds and starts the app automatically (or reuses a running
  `npm run dev`). Qdrant/Ollama are **not** needed — RAG is covered by the unit
  layer with mocked components. Install browsers once: `npx playwright install chromium`.

## Writing unit / integration tests (`tests/unit/*.test.ts`)

Four patterns, one per file, that you can copy:

- **Pure function** (`members.service.test.ts`): no mocks — call it, assert output.
- **Service with components mocked** (`rag.service.test.ts`): `jest.mock(...)` the
  component modules (with factories, so the real toolkit clients never load), then
  assert how the service orchestrates them. This is how you test RAG without Ollama
  or Qdrant.
- **Public route** (`health.route.test.ts`): mount the router on a bare Express app
  and drive it with `supertest`, mocking the components it probes.
- **Gated route** (`notes.route.test.ts`): same, but add a tiny middleware that
  stands in for passport (`req.isAuthenticated()`), so you can assert the real
  `ensureApiAuthenticated()` guard returns 401 signed-out and passes through
  signed-in — while mocking the service layer.
- **Role authorization** (`roles.test.ts`): the same supertest + fake-passport
  pattern applied to the `ensureRole()` guard (401 / 403 / pass), plus pure tests
  of the role helpers (`rolesOf`, `buildRoleArea`).

Notes:
- Tests are **TypeScript**, compiled by ts-jest using `tests/tsconfig.json`.
- Coverage uses the **V8 provider** (maps cleanly through ts-jest source maps).
- Tests run **serially** (`maxWorkers: 1`) and `clearMocks` is on. Module-level
  state in imported code (e.g. a cached flag) persists across tests in a file —
  don't assert on order-dependent internals.
- Units are **server-side** (Node env). Pure client logic is exercised by the e2e
  + a11y browser layers. If you ever want client unit tests, add a Jest project
  with `testEnvironment: 'jsdom'` and a `moduleNameMapper` to strip the `.js`
  import extensions the client uses.

## Writing e2e tests (`tests/e2e/*.spec.ts`)

- **Logging in behind SAML:** `global-setup.ts` runs once, drives the real
  SP-initiated login (`/auth/ubcshib` → the SimpleSAMLphp form → back to the app)
  and saves the session to `tests/e2e/.auth/user.json` (git-ignored). Override the
  test user with `E2E_USERNAME` / `E2E_PASSWORD` (default `faculty`/`faculty`).
- **Logged-out tests** use the default (no `storageState`) context — see
  `landing.spec.ts`.
- **Logged-in tests** opt in at the top of the file:
  `test.use({ storageState: AUTH_FILE })` — see `app.spec.ts`.
- The suite is serial and shares one session, and some tests write to the real
  database (e.g. adding a note) — keep tests independent of each other's data.
- `instructor-preview.spec.ts` seeds an unpublished owned course with one
  Approved and one Draft question, switches from the Instructor shell into the
  full Student shell, flags and misses an Approved question, visits the
  Session Summary and Review Book, then exits back to Instructor. It asserts
  Preview-only attempt/session state and zero live attempt/mastery/Review
  Book/flag/notification/summary records. The fixture and temporary course role
  are removed in `afterAll`.
- `exam-mode.spec.ts` seeds an active midterm template, logs in as the real
  Student persona, verifies no explanation text appears before submission,
  reload-resumes the same answer state, and then checks results, Review Book,
  ExamAttempt, and exam AttemptRecord persistence. It cleans every course
  fixture and Student role in `afterAll`.
- `exam-builder-live.spec.ts` is opt-in because it calls the configured LLM.
  With MongoDB, Qdrant, SAML, and a working model provider available, run
  `EXAM_BUILDER_LIVE_E2E=true npx playwright test tests/e2e/exam-builder-live.spec.ts`.
  It creates a synthetic course source and LO, checks the generation plan and
  SSE stage updates, then verifies a private candidate can be added, approved,
  and published. A real Student account joins the course, starts the formal
  exam, saves and resumes an answer, submits without early feedback, and sees
  the score and explanation after Instructor release. Step screenshots are
  written to `audit-results/exam-builder/student-flow/`. The temporary course,
  Student role, and vector collection are removed.

## Writing a11y tests (`tests/a11y/*.spec.ts`)

`playwright.a11y.config.ts` reuses the e2e `webServer` + `globalSetup` but scans
`tests/a11y/` into a separate report. Each test runs `AxeBuilder` with the WCAG
A/AA tag set and asserts **zero** violations. Animations are frozen before the
scan (`freezeAnimations`) so axe measures steady-state contrast, not a transient
fade-in. Use `test.use({ storageState })` to scan authenticated pages.

`role-tutorials.spec.ts` uses `playwright.tutorials.config.ts` for deterministic
client-browser tests with intercepted APIs and no live service writes. Build
the client first, then run `npx playwright test --config playwright.tutorials.config.ts`
against the local static app on port 6118. It covers completion, replay, reset,
identity/route races, preview/timed-exam suppression, missing/replaced anchors,
transient failures, storage denial and scoped dialog axe at 390/1280px light/dark.

`analytics-dashboard.spec.ts` uses `playwright.analytics.config.ts` for
deterministic scope/filter/version, response-ordering and scoped-access tests,
including desktop/mobile light/dark axe. Its APIs are intercepted; no provider
or database calls are made by the fixture.

`role-experience-integration.spec.ts` uses the normal Playwright config and real
SAML/MongoDB. It creates a temporary owned course with two recorded question
versions, scoped attempt evidence and a zero-attempt objective. It checks
analytics dates/modes/versions, named-data permissions, Instructor Help replay,
and the core TA/Admin tutorial flows. Temporary course roles, Admin status,
capability settings and role tutorial progress are restored or removed by the
fixture; no messaging or generation is invoked.

The real Student axe flows explicitly exercise all nine Student tutorial
contexts. Instructor/Admin full-page scans seed dismissed optional-help state
so a dialog cannot hide the underlying page from axe. Original tutorial progress
is restored afterward; dialog accessibility is checked separately.

`action-progress.spec.ts` uses `playwright.action-progress.config.ts` for
request-lifetime loading feedback tests against compiled production components.
Build first, then run `npx playwright test --config playwright.action-progress.config.ts`.
All APIs are intercepted: the suite checks shared action binding, Admin grants,
Student submit/retry, TA review during filtering, Instructor parameter preview,
workspace generation during redraw, and source-guide SSE failure/readiness/cleanup.
Source-guide desktop/light and mobile/dark cases include scoped axe scans and
reduced-motion verification. It makes no live record changes or provider calls.

`admin-appearance.spec.ts` uses `playwright.admin-appearance.config.ts` and the
local IdP `admin/admin` persona (PUID `PUID-ADMIN-0001`, in the local Admin
allowlist). It verifies real SAML identity, the six Admin pages, inspector alignment, desktop/mobile
axe and logout theme restoration. It performs no directory/settings mutations;
normal login creates or refreshes the test account. Tutorial reads are intercepted.

`review-workbench.spec.ts` uses `playwright.review-workbench.config.ts` with
intercepted course/question APIs. It covers compact queue/board/search, optional
rejection reason and failed retry, version-pinned approval after edits, response
races, unsaved edits, mismatched samples, keyboard and mobile dark scoped axe.
The real pipeline specs now select a queue row and approve in the same-page reader.

`setup-journey.spec.ts` uses `playwright.setup-journey.config.ts` against the
compiled client with intercepted course APIs. It checks server-derived progress,
release gates, navigation persistence, course/role isolation, retry, mobile width,
and primary-button focus/pressed contrast. It makes no live course changes.

`structure-ai.spec.ts` / `playwright.structure-ai.config.ts` exercise the production
Course Structure editor with intercepted APIs and streamed snapshots: progressive
text, refresh recovery, initial editable values, source evidence, selected-subset
apply, failure recovery, narrow layouts and accessibility. The service tests verify
complete chunk traversal, validated citations, gap reporting, optional counts,
duplicate-run protection and stop semantics. `scripts/verify-structure-generation.ts`
is an opt-in real-provider smoke using only synthetic teaching text; it cleans up
its temporary material/chunk/run records and never reads uploaded course materials.

`admin-diagnostics.spec.ts` / `playwright.admin-diagnostics.config.ts` use real
local SAML and MongoDB with isolated course/question/run/attempt fixtures. They
verify cross-user failure capture, Admin-only inspection, original-creator
attribution, exact pinned attempt replay without student-data writes, task links,
and desktop-light/mobile-dark accessibility. No provider generation is invoked;
fixtures are deleted after testing. Request audit records remain as truthful
records of the test actions.

`playwright.instructor-qa.config.ts` groups the Instructor workbench suites and
`instructor-qa-regressions.spec.ts`. Build first; all APIs are intercepted. The
QA regressions cover unsaved route changes, stale AI assessments, generation
focus/history, saved recipe counts, terminal material status, evidence deduplication,
and release/guide layout updates without writing live teaching records.

`playwright.admin-workspace.config.ts` covers the five production Admin workspaces and the legacy grants URL.
The four `admin-*-workspace.spec.ts` files intercept APIs and exercise searches,
pagination, stale responses, exact version/attempt replay, role/grant confirmation,
sparse permission saves, model catalogue validation, draft recovery, original Help
navigation and 1440/580/390px light/dark accessibility. Inspector geometry checks
catch transformed-ancestor positioning regressions. `admin-appearance.spec.ts`
adds real local SAML/read-only page verification at localhost:6118; no directory,
permission or settings mutations are made. Build the client before running.

The people workspace checks direct row grants/revocation, course-labelled TA and
Student assignment, retained-record Ban/Unban, pending identities, duplicate-submit
protection, failed-refresh recovery and keyboard focus during asynchronous course
loading. Grant choices share a top-layer role menu in rows and Profile; browser
checks cover keyboard selection, dismissal/focus return, and unclipped options
at the last row on desktop and mobile. Ban remains independently available.
The live Admin accounts suite seeds a pending grant in its fixture and
exercises the unified directory through the legacy `/admin/accounts` URL.

`playwright.role-workspace.config.ts` runs isolated full-app role switching tests.
The production shell consumes intercepted Admin/Instructor/TA/Student identities,
course lists and Preview APIs. Checks cover both restricted and unrestricted
Student views for Admin, Instructor and TA, including draft-course filtering and
direct-link rejection in restricted mode, permitted menus and return paths,
saved-role forgery, refresh persistence, course/session isolation, common cards,
sidebar sizing/colors, black course actions, and mobile light/dark accessibility.
No live grants, enrollment, or student activity are changed by these fixtures.

`playwright.collaboration.config.ts` uses real faculty and ta SAML sessions and an
isolated temporary course. It tests sharing without platform privilege, concurrent
same-field/different-field CRDT edits, offline retries, a deliberately lost commit
response, version comparison/rebase, presence, mobile/dark axe and live revocation.
It cleans course, question, draft, share, presence and scoped role fixtures. No
email or provider generation occurs. `question-collaboration.service/routes` unit
tests cover durable CAS, replay, interrupted-save recovery, schema retention,
state races and revoked/transient SSE behavior. `playwright.course-sharing.config.ts`
uses intercepted APIs for dialog/page sharing. `playwright.question-edit-concurrency.config.ts` covers legacy editor conflicts and draft-schema export.

`playwright.exam-builder.config.ts` runs the compiled production Builder and
Assessment pages with intercepted APIs on a static localhost:6118 server. It
checks pinned selection, private generation/review/publication, resumable saved
answers, withheld results and scoped desktop/mobile light/dark axe. Backend
`exam-builder`, `exam-generation` and `assessment-attempts` suites cover guards,
publication and answer CAS, private partial jobs, retry/cancel/recovery, deadline,
grading and release isolation. Browser fixtures do not call model providers.

`playwright.canvas-workspace.config.ts` tests the production Canvas renderer and
full Instructor shell with intercepted APIs: all-role People, self marker, search,
role filter, pagination, legacy redirects, global course switching, mobile dark
layout and desktop axe scans. It does not mutate real Canvas/staging data.
`quality-evaluation-*.test.ts` verifies the offline dataset, export adapter,
blinded review integrity, fixed denominators, CLI files and nullable measurement
reporting. `generation-evaluation.{service,routes}.test.ts` covers original-version
export binding, unavailable historical slots, safe usage projection and course
authorization. `playwright.quality-evaluation.config.ts` runs an isolated offline
review HTML fixture with all external requests blocked; no application server or
provider is required. Its browser cases cover JSON download/resume, conflicts,
stale data, triage-only content, literal hostile strings and accessible responsive
forms. The existing workbench suite verifies the terminal evaluation download link.


## Course People consolidation (2026-10-06)

People consolidates Enrollment, Teaching Assistants and Co-instructors using
course-scoped merged identities, search and server pagination. People and Share
share Student/TA/Instructor invitations. Owner/Admin controls role changes,
course bans and one-time-code mutations. Revisioned `coursePeopleAccess` decisions
apply last at session reload and override all grant sources; CSV/Canvas cannot
restore bans or superseded roles. Pending canonical-email binding preserves
cancellation tombstones and never grants platform privileges. Gradebook preview
and persisted `lastChanges` identify newly added people by exact PUID and show
names before/after commit with paginated lists. See
`docs/design/course-people/IMPLEMENTATION.md`, `docs/api-contract.md`, and
`playwright.course-people.config.ts`. Old standalone UI/enrollment descriptions
above describe historical entry points; the current Instructor entry is People.
