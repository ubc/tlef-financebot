# Academic API "Classes" Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port tlef-starter's FakeAcademicAPI "Classes" vertical slice into tlef-financebot, adapted to FinanceBot's conventions.

**Architecture:** Live pass-through to the Academic API via an isolated `academic-api` component → a thin `classes.service` → role-gated `/api/classes` routes → a config-driven client view. No sync-to-Mongo. Identity comes from FinanceBot's domain `User.puid`.

**Tech Stack:** TypeScript, Express 5, Jest + supertest (unit), Playwright (e2e), vanilla-TS hash-routed client. Node global `fetch`.

**Source of truth for ports:** the sibling repo `../tlef-starter`. This plan copies specific files from there and applies the adaptations shown. Paths below starting `../tlef-starter/` are the copy source; all other paths are in this repo (`tlef-financebot`).

## Global Constraints

- **Identity:** The session `req.user` is FinanceBot's domain `User` (`server/src/types/domain.ts`: `{ puid, uid, displayName, isAdmin, affiliations, courseRoles }`). Read the PUID as `user.puid` — never `user.attributes.*` (that is starter's SAML shape).
- **Role gating:** Use `ensureRole(...)` from `server/src/components/auth` (keyed on `user.affiliations` via `rolesOf`). Roles are lower-cased: `faculty`, `student`, `staff`.
- **Feature label:** Every new server file carries an `EXAMPLE (Academic API demo) — safe to delete` header comment, matching Notes/RAG.
- **Env defaults:** `ACADEMIC_API_URL=http://localhost:3689`, `ACADEMIC_API_CLIENT_ID=mock-client`, `ACADEMIC_API_CLIENT_SECRET=mock-secret`, added via the existing `optional()` helper in `server/src/config/env.ts`.
- **Client imports:** ESM with explicit `.js` extensions (e.g. `import { el } from '../dom.js'`), matching existing FinanceBot client files.
- **Shared services:** FakeAcademicAPI runs from `../services/FakeAcademicAPI` (`docker compose up -d`, port 3689). Do not add a per-project compose.
- **Commits:** one per task, on branch `academic-api-classes`. Sign-off footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Env configuration

**Files:**
- Modify: `server/src/config/env.ts`
- Modify: `.env.example`
- Test: `tests/unit/config.test.ts` (existing — extend)

**Interfaces:**
- Produces: `env.academicApiUrl: string`, `env.academicApiClientId: string`, `env.academicApiClientSecret: string`.

- [ ] **Step 1: Add a failing assertion to the config test**

In `tests/unit/config.test.ts`, add inside the existing top-level `describe`:

```ts
it('exposes Academic API config with local FakeAcademicAPI defaults', () => {
  expect(env.academicApiUrl).toBe('http://localhost:3689');
  expect(env.academicApiClientId).toBe('mock-client');
  expect(env.academicApiClientSecret).toBe('mock-secret');
});
```

(If `env` is not already imported in that file, add `import { env } from '../../server/src/config/env';`.)

- [ ] **Step 2: Run it, expect fail**

Run: `npm test -- tests/unit/config.test.ts`
Expected: FAIL — `env.academicApiUrl` is `undefined`.

- [ ] **Step 3: Add the three fields to `env.ts`**

In `server/src/config/env.ts`, inside the exported `env` object (after the qdrant entries), add:

```ts
  // UBC Academic API (see server/src/components/academic-api). Defaults match
  // the local FakeAcademicAPI container, which mirrors the real API's shapes.
  // On staging/production, point these at the real Academic API + credentials.
  academicApiUrl: optional('ACADEMIC_API_URL', 'http://localhost:3689'),
  academicApiClientId: optional('ACADEMIC_API_CLIENT_ID', 'mock-client'),
  academicApiClientSecret: optional('ACADEMIC_API_CLIENT_SECRET', 'mock-secret'),
```

- [ ] **Step 4: Add the vars to `.env.example`**

Append to `.env.example` (after the Qdrant block):

```bash
# --- UBC Academic API (server/src/components/academic-api) -------------------
# Course sections, registrations, and person lookups. Locally this targets the
# FakeAcademicAPI container (../services/FakeAcademicAPI, port 3689), which
# mirrors the real API's shapes. On staging/production set the same variables to
# the real Academic API and your real client credentials.
ACADEMIC_API_URL=http://localhost:3689
ACADEMIC_API_CLIENT_ID=mock-client
ACADEMIC_API_CLIENT_SECRET=mock-secret
```

- [ ] **Step 5: Run test, expect pass**

Run: `npm test -- tests/unit/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/config/env.ts .env.example tests/unit/config.test.ts
git commit -m "feat(env): Academic API config with FakeAcademicAPI defaults"
```

---

## Task 2: `academic-api` component (typed client)

**Files:**
- Create: `server/src/components/academic-api/index.ts` (copy of `../tlef-starter/server/src/components/academic-api/index.ts`)
- Create: `server/src/components/academic-api/AGENTS.md` (copy of `../tlef-starter/server/src/components/academic-api/AGENTS.md`)
- Test: `tests/unit/academic-api.test.ts` (copy of `../tlef-starter/tests/unit/academic-api.test.ts`)

**Interfaces:**
- Consumes: `env.academicApiUrl/ClientId/ClientSecret` (Task 1).
- Produces (all exported from `server/src/components/academic-api`):
  - `class AcademicApiError extends Error { status: 502; upstreamStatus?: number }`
  - types `ApiIdentifier, ApiPersonName, ApiPerson, ApiPeriodRef, ApiSection, ApiRegistration, ApiPeriod`
  - `findPersonByPuid(puid: string): Promise<ApiPerson | null>`
  - `findPersonsByStudentIds(studentIds: string[]): Promise<ApiPerson[]>`
  - `sectionsByEmployeeId(employeeId: string): Promise<ApiSection[]>`
  - `sectionsByIds(sectionIds: string[]): Promise<ApiSection[]>`
  - `registrationsBySectionId(sectionId: string): Promise<ApiRegistration[]>`
  - `registrationsByPeriod(periodId: string): Promise<ApiRegistration[]>`
  - `academicPeriods(): Promise<ApiPeriod[]>`
  - `pingAcademicApi(): Promise<boolean>`

- [ ] **Step 1: Copy the component and its AGENTS.md verbatim**

```bash
mkdir -p server/src/components/academic-api
cp ../tlef-starter/server/src/components/academic-api/index.ts server/src/components/academic-api/index.ts
cp ../tlef-starter/server/src/components/academic-api/AGENTS.md server/src/components/academic-api/AGENTS.md
```

The component depends only on `env` (import path `../../config/env` is identical in both repos), so no code change is needed. Confirm the import resolves:

Run: `npm run typecheck:server`
Expected: PASS (no errors referencing academic-api).

- [ ] **Step 2: Copy the component unit test verbatim**

```bash
cp ../tlef-starter/tests/unit/academic-api.test.ts tests/unit/academic-api.test.ts
```

This test mocks global `fetch`; it does not touch `req.user`, so no adaptation is needed.

- [ ] **Step 3: Run the component test, expect pass**

Run: `npm test -- tests/unit/academic-api.test.ts`
Expected: PASS (Basic-auth header, pagination loop follows `hasNextPage`, `AcademicApiError` maps unreachable/non-2xx, `pingAcademicApi` returns false on throw).

- [ ] **Step 4: Commit**

```bash
git add server/src/components/academic-api tests/unit/academic-api.test.ts
git commit -m "feat(academic-api): typed Basic-auth client over FakeAcademicAPI"
```

---

## Task 3: `classes.service` (business logic, PUID adaptation)

**Files:**
- Create: `server/src/services/classes.service.ts` (copy of `../tlef-starter/server/src/services/classes.service.ts`, adapted)
- Test: `tests/unit/classes.service.test.ts` (copy of `../tlef-starter/tests/unit/classes.service.test.ts`, adapted)

**Interfaces:**
- Consumes: everything from Task 2's component; FinanceBot's domain `User` from `../types/domain`.
- Produces:
  - types `ClassSummary, PeriodGroup, MyClasses, RosterStudent, ClassList`
  - `getMyClasses(user: User): Promise<MyClasses>`
  - `getClassList(user: User, sectionId: string): Promise<ClassList>`

- [ ] **Step 1: Copy the service, then apply the identity adaptation**

```bash
cp ../tlef-starter/server/src/services/classes.service.ts server/src/services/classes.service.ts
```

Apply exactly these three edits:

1. Change the user-type import at the top:

```ts
// FROM:
import type { AppUser } from '../components/auth';
// TO:
import type { User } from '../types/domain';
```

2. Replace the `puidOf` helper so it reads the domain `User.puid` (delete the `firstValue` helper too — it becomes unused):

```ts
// FROM (starter):
function firstValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? String(value[0]) : '';
  return value == null ? '' : String(value);
}
function puidOf(user: AppUser): string {
  const puid = firstValue(user.attributes.ubcEduCwlPuid);
  if (!puid) {
    throw httpError(
      500,
      'The session has no PUID (ubcEduCwlPuid attribute) — check the IdP attribute release.',
    );
  }
  return puid;
}

// TO (financebot):
function puidOf(user: User): string {
  if (!user.puid) {
    throw httpError(500, 'The session user has no PUID — check the IdP attribute release.');
  }
  return user.puid;
}
```

3. Change the two public signatures from `AppUser` to `User`:

```ts
export async function getMyClasses(user: User): Promise<MyClasses> {
export async function getClassList(user: User, sectionId: string): Promise<ClassList> {
```

- [ ] **Step 2: Copy the service test, then adapt the user fixture**

```bash
cp ../tlef-starter/tests/unit/classes.service.test.ts tests/unit/classes.service.test.ts
```

Starter's fixtures build an `AppUser` with `attributes.ubcEduCwlPuid`. Replace every such fixture with a FinanceBot domain `User`. At the top of the file, ensure this import and helper exist (add if missing, replacing starter's AppUser helper):

```ts
import type { User } from '../../server/src/types/domain';

function user(puid: string): User {
  return {
    puid,
    uid: puid,
    displayName: 'Test User',
    isAdmin: false,
    affiliations: ['faculty'],
    courseRoles: [],
  };
}
```

Then replace each call that constructed a starter `AppUser` (e.g. `{ nameId, attributes: { ubcEduCwlPuid: ['P1'] } }`) with `user('P1')`. The component (`../../server/src/components/academic-api`) stays mocked exactly as in starter — only the user shape changes.

- [ ] **Step 3: Run the service test, expect fail then pass**

Run: `npm test -- tests/unit/classes.service.test.ts`
Expected: PASS. It exercises: identifier derivation (Employee_ID/Student_ID), period grouping and ordering, dual-role output (both teaching + enrolled), the app-side student filter, `personFound: false` for an unknown PUID, and the 403 ownership check in `getClassList`. If any assertion still references `attributes`, fix that fixture and re-run.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:server`
Expected: PASS (no unused `firstValue`, no `AppUser` references).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/classes.service.ts tests/unit/classes.service.test.ts
git commit -m "feat(classes): getMyClasses/getClassList service (PUID from domain User)"
```

---

## Task 4: `/api/classes` routes + app wiring

**Files:**
- Create: `server/src/routes/classes.routes.ts` (copy of `../tlef-starter/server/src/routes/classes.routes.ts`)
- Modify: `server/src/app.ts`
- Test: `tests/unit/classes.route.test.ts` (copy of `../tlef-starter/tests/unit/classes.route.test.ts`, adapted)

**Interfaces:**
- Consumes: `getMyClasses`, `getClassList` (Task 3); `ensureRole` from `../components/auth`.
- Produces: `classesRouter` (Express Router) exported from `server/src/routes/classes.routes.ts`; mounted at `/api`.

- [ ] **Step 1: Copy the router verbatim**

```bash
cp ../tlef-starter/server/src/routes/classes.routes.ts server/src/routes/classes.routes.ts
```

Both repos export `ensureRole` from `../components/auth` and `getClassList/getMyClasses` from `../services/classes.service`, so no code change is needed. `req.user!` is FinanceBot's domain `User`, which the service now expects.

- [ ] **Step 2: Wire the router into `app.ts`**

In `server/src/app.ts`, add the import beside the other route imports:

```ts
import { classesRouter } from './routes/classes.routes';
```

and mount it beside the other example routers (after notes/rag/members mounts):

```ts
app.use('/api', classesRouter); // EXAMPLE (Academic API classes demo) — role-gated; safe to remove.
```

- [ ] **Step 3: Copy the route test, then adapt auth injection to the domain User**

```bash
cp ../tlef-starter/tests/unit/classes.route.test.ts tests/unit/classes.route.test.ts
```

Replace starter's `AppUser` fixtures and `makeApp` with FinanceBot's domain-`User` pattern (as used in `tests/unit/roles.test.ts`). Specifically:

```ts
import type { User } from '../../server/src/types/domain';

function user(affiliations: string[]): User {
  return { puid: 'P1', uid: 'u1', displayName: 'T', isAdmin: false, affiliations, courseRoles: [] };
}

function makeApp(u?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(u);
    if (u) (req as unknown as { user: User }).user = u;
    next();
  });
  app.use('/api', classesRouter);
  app.use(errorHandler);
  return app;
}

const faculty = user(['faculty']);
const student = user(['student']);
const staff = user(['staff']);
```

Keep the rest of starter's test body (the service is mocked; assertions on 401 signed-out, 403 staff, 200 for faculty/student, 502 error-handler translation, and the instructor-only roster 403). Confirm the `errorHandler` import path matches FinanceBot (`../../server/src/middleware/error-handler` — verify by opening the file; adjust if the path differs).

- [ ] **Step 4: Run the route test, expect pass**

Run: `npm test -- tests/unit/classes.route.test.ts`
Expected: PASS (401 signed out without touching the service; 403 staff; 200 faculty & student; 502 on upstream failure; roster instructor-only).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/classes.routes.ts server/src/app.ts tests/unit/classes.route.test.ts
git commit -m "feat(classes): role-gated /api/classes routes, wired into app"
```

---

## Task 5: Health check includes the Academic API

**Files:**
- Modify: `server/src/routes/health.routes.ts`
- Test: `tests/unit/health.route.test.ts` (existing — extend)

**Interfaces:**
- Consumes: `pingAcademicApi` (Task 2).
- Produces: `GET /api/health` `services.academicApi: 'up' | 'down'`.

- [ ] **Step 1: Extend the health test (failing)**

In `tests/unit/health.route.test.ts`:

1. Add the mock beside the others:

```ts
jest.mock('../../server/src/components/academic-api', () => ({ pingAcademicApi: jest.fn() }));
```

2. Add the import:

```ts
import { pingAcademicApi } from '../../server/src/components/academic-api';
```

3. In the "services up" test, set the mock and extend the expectation:

```ts
jest.mocked(pingAcademicApi).mockResolvedValue(true);
// ...
expect(res.body.services).toEqual({ mongodb: 'up', qdrant: 'up', academicApi: 'up' });
```

4. In the "down services" test:

```ts
jest.mocked(pingAcademicApi).mockResolvedValue(false);
// ...
expect(res.body.services).toEqual({ mongodb: 'down', qdrant: 'down', academicApi: 'down' });
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm test -- tests/unit/health.route.test.ts`
Expected: FAIL — `academicApi` missing from `services`.

- [ ] **Step 3: Add the probe to `health.routes.ts`**

```ts
// add import:
import { pingAcademicApi } from '../components/academic-api';

// change the probe line:
const [mongoUp, qdrantUp, academicApiUp] = await Promise.all([
  pingMongo(),
  pingQdrant(),
  pingAcademicApi(),
]);

// add to the services object in the response:
services: {
  mongodb: mongoUp ? 'up' : 'down',
  qdrant: qdrantUp ? 'up' : 'down',
  academicApi: academicApiUp ? 'up' : 'down',
},
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test -- tests/unit/health.route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/health.routes.ts tests/unit/health.route.test.ts
git commit -m "feat(health): report Academic API reachability"
```

---

## Task 6: Client API functions

**Files:**
- Modify: `client/src/api.ts`
- Test: none (thin fetch wrappers; covered by the e2e in Task 8)

**Interfaces:**
- Produces (exported from `client/src/api.ts`):
  - types mirroring the server: `ClassSummary, PeriodGroup, MyClasses, RosterStudent, ClassList`
  - `fetchMyClasses(): Promise<MyClasses>`
  - `fetchClassList(sectionId: string): Promise<ClassList>`

- [ ] **Step 1: Port the academic types + fetchers into `client/src/api.ts`**

Open `../tlef-starter/client/src/api.ts`, find the classes section (the `MyClasses`/`ClassList` types and `fetchMyClasses`/`fetchClassList`), and copy them into FinanceBot's `client/src/api.ts`, matching FinanceBot's existing request helper. Use the same fetch/error helper the file already uses for `fetchNotes`/`fetchMembers` (do not introduce a new one). `fetchClassList` targets `` `/api/classes/${encodeURIComponent(sectionId)}/students` ``.

- [ ] **Step 2: Typecheck the client**

Run: `npm run typecheck:client`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/api.ts
git commit -m "feat(client): fetchMyClasses / fetchClassList API helpers"
```

---

## Task 7: Client Classes view + nav + styles

**Files:**
- Create: `client/src/views/classes.ts` (copy of `../tlef-starter/client/src/views/classes.ts`, adapted)
- Modify: `client/src/config.ts` (add NAV entry)
- Modify: `client/src/main.ts` (map `/classes` → `renderClasses`)
- Modify: `client/public/styles/main.css` (port `.classes__*` rules)

**Interfaces:**
- Consumes: `fetchMyClasses`, `fetchClassList` (Task 6); `el`/`dom` and `ui` helpers (`badge`, `emptyState`, `errorState`, `loadingState`).
- Produces: `renderClasses(outlet: HTMLElement): void`.

- [ ] **Step 1: Copy the view and fix import extensions**

```bash
cp ../tlef-starter/client/src/views/classes.ts client/src/views/classes.ts
```

Adapt imports to FinanceBot conventions: add explicit `.js` extensions and point at FinanceBot's helper modules (`./` paths become `../dom.js`, `../ui.js`, `../api.js` as appropriate — match the import style already used in `client/src/views/notes.ts`). The view logic (Teaching/Enrolled sections, period grouping, status badges, in-view roster drill-down with "← Back to classes", `<details>` raw JSON, empty/error states) is unchanged.

- [ ] **Step 2: Add the NAV entry in `config.ts`**

In `client/src/config.ts`, add to the `NAV` array (in the `examples` group, next to Notes/RAG):

```ts
{ path: '/classes', label: 'Classes', glyph: '▦', group: 'examples', demo: true, roles: ['faculty', 'student'] },
```

- [ ] **Step 3: Map the route in `main.ts`**

In `client/src/main.ts`, add the import and the path→view entry beside the other views:

```ts
import { renderClasses } from './views/classes.js';
// ... in the path→render map:
'/classes': renderClasses,
```

- [ ] **Step 4: Port the styles**

From `../tlef-starter/client/public/styles/main.css`, copy the `.classes__*` rule block into `client/public/styles/main.css`. Reuse existing badge/table tokens; do not duplicate variables.

- [ ] **Step 5: Build the client and typecheck**

Run: `npm run typecheck:client && npm run build:client`
Expected: PASS; `client/public/js/views/classes.js` is emitted.

- [ ] **Step 6: Manual smoke (services must be up)**

Ensure the shared services run (`../services/FakeAcademicAPI`, MongoDB, IdP up) and `npm run saml:fetch-cert` has been run. Then:

Run: `npm run dev` and log in as `faculty` (password `faculty`); click **Classes**.
Expected: a Teaching section with CPSC 110; clicking it shows a roster including the `student` user. Log out / log in as `staff` (password `staff`): no Classes nav item.

- [ ] **Step 7: Commit**

```bash
git add client/src/views/classes.ts client/src/config.ts client/src/main.ts client/public/styles/main.css
git commit -m "feat(client): Classes view, nav entry, and styles"
```

---

## Task 8: E2E + a11y + docs

**Files:**
- Create: `tests/e2e/classes.spec.ts` (copy of `../tlef-starter/tests/e2e/classes.spec.ts`, adapted)
- Modify: `tests/a11y/a11y.spec.ts` (add `/classes` to the scan list)
- Modify: `README.md`, `AGENTS.md`, `tests/AGENTS.md`

**Interfaces:**
- Consumes: the running feature end-to-end; the shared `faculty`/`student`/`staff` IdP users already wired into `tests/e2e/global-setup.ts`.

- [ ] **Step 1: Copy the e2e spec, adapt users/selectors**

```bash
cp ../tlef-starter/tests/e2e/classes.spec.ts tests/e2e/classes.spec.ts
```

Confirm it logs in as `faculty` and asserts: Classes nav visible → open CPSC 110 → roster contains the `student` user; and that a `staff` session has no Classes nav item. If starter references starter-specific user names or a different storage-state helper, align them to FinanceBot's `tests/e2e/global-setup.ts` (`AUTH_FILE`, `faculty`/`faculty`). For the `staff` case, follow FinanceBot's existing pattern for a second-role session (see how `app.spec.ts` handles role-gated nav), or drive a fresh login with `E2E_USERNAME=staff`.

- [ ] **Step 2: Add the Classes route to the a11y scan**

In `tests/a11y/a11y.spec.ts`, add `/classes` (and, if the file scans sub-views, the roster) to the list of authenticated paths scanned by axe, matching how `/notes` and `/rag` are listed.

- [ ] **Step 3: Run e2e + a11y (shared services up)**

Prereqs: `../services/FakeAcademicAPI`, MongoDB (`../services/tlef-mongodb-docker`), and the IdP (`../services/docker-simple-saml`) all up; `npm run saml:fetch-cert` done; app buildable.

Run: `npm run test:e2e -- classes.spec.ts` then `npm run test:a11y`
Expected: PASS. If login fails, verify the SP registration for `http://localhost:6118` exists in docker-simple-saml (it does by default) and the cert was fetched.

- [ ] **Step 4: Update docs**

1. `README.md` — add an "Academic API (classes example)" subsection: start FakeAcademicAPI from `../services/FakeAcademicAPI` (`docker compose up -d`, port 3689), the three env vars, the seed users that demo each path (`faculty`, `student`, `ta_student`, `empty_prof`, `cancel_prof`, `waitlist_prof`, `mega_prof`, `legal_student`, `noemail_student`), and the deletion story (component + service + routes + view + NAV entry). List FakeAcademicAPI among the shared backing services in "Local development services".
2. `AGENTS.md` — mention the new `academic-api` component in the components list and note the e2e prereq now includes FakeAcademicAPI.
3. `tests/AGENTS.md` — add FakeAcademicAPI to the e2e prerequisites.

- [ ] **Step 5: Full test sweep**

Run: `npm test` (unit) then `npm run typecheck`
Expected: PASS across the suite.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/classes.spec.ts tests/a11y/a11y.spec.ts README.md AGENTS.md tests/AGENTS.md
git commit -m "test+docs: Classes e2e, a11y scan, and Academic API docs"
```

---

## Self-review notes

- **Spec coverage:** component (T2), service + PUID adaptation (T3), routes + wiring (T4), health (T5), env (T1), client api (T6), view + nav + styles (T7), e2e + a11y + docs (T8). All spec sections map to a task.
- **Type consistency:** `getMyClasses(user: User)` / `getClassList(user: User, sectionId)` are defined in T3 and consumed unchanged in T4; client types in T6 mirror server types and are consumed in T7; `pingAcademicApi` defined T2, consumed T5.
- **Adaptation points that MUST be verified while implementing (do not assume):** the `errorHandler` import path in the route test (T4 Step 3); FinanceBot's exact client request-helper name in `api.ts` (T6); FinanceBot's a11y scan-list shape (T8 Step 2). Each task's typecheck/test step catches a mismatch.
