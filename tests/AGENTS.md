# AGENTS.md — tests/

The testing setup. Three layers, mirroring the structure used in
[`tlef-biocbot`](https://github.com/ubc/tlef-biocbot) but written in TypeScript:

| Layer | Tool | Directory | What it covers |
| --- | --- | --- | --- |
| Unit + integration | Jest + ts-jest + supertest | `tests/unit/` | Pure functions, services with components mocked, routers over HTTP. Fast, no external services. |
| End-to-end | Playwright (Chromium) | `tests/e2e/` | The real app in a browser: landing, real CWL login, gated nav, Notes CRUD. |
| Accessibility | Playwright + `@axe-core/playwright` | `tests/a11y/` | axe WCAG A/AA scans of key pages. |

## Commands

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
  Playwright `webServer` builds and starts the app automatically (or reuses a
  running `npm run dev`). Qdrant/Ollama are **not** needed — RAG is covered by the
  unit layer with mocked components. Install browsers once: `npx playwright install chromium`.

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

## Writing a11y tests (`tests/a11y/*.spec.ts`)

`playwright.a11y.config.ts` reuses the e2e `webServer` + `globalSetup` but scans
`tests/a11y/` into a separate report. Each test runs `AxeBuilder` with the WCAG
A/AA tag set and asserts **zero** violations. Animations are frozen before the
scan (`freezeAnimations`) so axe measures steady-state contrast, not a transient
fade-in. Use `test.use({ storageState })` to scan authenticated pages.
