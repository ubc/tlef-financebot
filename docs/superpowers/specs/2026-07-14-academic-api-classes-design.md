# Academic API integration — "Classes" example (ported into FinanceBot)

**Date:** 2026-07-14
**Status:** Approved design, pending implementation plan

## Purpose

Bring the working "Classes" feature that already exists in
[tlef-starter](../../../../tlef-starter) into **tlef-financebot**, so FinanceBot
can talk to the UBC Academic API via the local
[FakeAcademicAPI](https://github.com/ubc/FakeAcademicAPI) (which mirrors the real
API's request/response shapes). Instructors see the classes they teach and can
open each class list; students see the classes they are enrolled in (and nothing
more); staff see none of it.

Like Notes and RAG, this is a labeled **EXAMPLE (safe to delete)** feature, not
core infrastructure. FinanceBot already carries the Notes/RAG/Members examples in
the same shape, so this slots into the existing conventions rather than inventing
new ones.

## Context: why this is mostly a port

FinanceBot was created from the tlef-starter boilerplate, so the two repos share
the same skeleton (typed `env.ts`, isolated `components/*`, thin `services/*`,
`routes/*`, a hash-routed vanilla-TS client). Starter has the full Academic API
"Classes" vertical slice; FinanceBot has none of it (only a mention in
`docs/PRD.md`). This design therefore **copies starter's slice and adapts it to
FinanceBot's conventions**, with one behavioral change (identity resolution,
below). It is not a redesign.

The backing service already runs from the shared services model this repo now
follows: FakeAcademicAPI lives in `../services/FakeAcademicAPI` and listens on
`:3689`. No per-project compose is added.

## Decisions made

| Question | Decision |
| --- | --- |
| Feature status | Labeled example, following the Notes/RAG pattern |
| Faithfulness | Faithful port of starter's feature, adapted to FinanceBot conventions — not a new design |
| Term scope | Show all academic periods, grouped by period |
| Class-list contents | Everything the API returns per student (usable table + expandable raw JSON) |
| Dual-role users | One page with both a Teaching and an Enrolled section, driven by what the API returns for the person |
| Canceled/waitlisted | Shown, with status badges |
| Architecture | Live pass-through — no sync-to-Mongo, no new collections |
| Identity resolution | Read the PUID from FinanceBot's domain `User.puid` (see "Key adaptation") |
| Tests | Full parity — unit + e2e + a11y, matching starter |

## Key adaptation vs starter

Starter's session `req.user` is the raw SAML user, so its `classes.service`
reads the PUID from `user.attributes.ubcEduCwlPuid`. **FinanceBot's `req.user`
is a domain `User` loaded from MongoDB** (`server/src/types/domain.ts`:
`{ puid, uid, displayName, isAdmin, affiliations, courseRoles }`, per ST-E01), so
the ported service reads `user.puid` directly. This is the only behavioral
difference; everything downstream (Employee_ID / Student_ID come from the
Academic API person record, not the session) is identical.

Consequently the service's user type is FinanceBot's domain `User`, not starter's
`AppUser`, and role gating uses FinanceBot's `ensureRole` /
`rolesOf` (keyed on `user.affiliations`).

## Architecture

The Academic API is **section-centric**: sections can be queried by instructor
(`employeeId`) but registrations only by section/period — there is no
"registrations by student" query. The chosen approach is **live pass-through**:

- Instructor view: `GET /academic-exp/v2/course-section-details?employeeId=E`.
- Student view: fetch registrations per academic period and filter by the
  student's number **app-side**, then join to `course-section-details` by
  section ID for real course titles/schedules (registration records embed only
  a stub `courseListing`).
- The app-side student filter is the documented **adaptation point** if the real
  API rejects period-wide registration queries. The production-grade alternative
  (sync rosters into MongoDB) is noted in the component AGENTS.md but
  deliberately not built (YAGNI for a demo).

Identity resolution: the session gives us the PUID (`User.puid`).
`GET /person/v2/persons?puid=X` resolves it to a person whose `identifiers` carry
their `Student_ID` and/or `Employee_ID` — those drive which lists the person
gets. The shared FakeAcademicAPI seed data is cross-referenced with the shared
docker-simple-saml IdP by design (`FakeAcademicAPI/USERS.md`): SAML `faculty` →
PUID `12345678` (Employee `4520000`, an open CPSC 110 section); SAML `student` →
PUID `87654321` (enrolled in CPSC 110). The port relies on this existing linkage.

## Server

### Component: `server/src/components/academic-api/`

Copied from starter essentially verbatim (it depends only on `env`). Isolated
component with its own `AGENTS.md`, like mongodb/qdrant/auth. A small typed
client over the global `fetch`:

- Requests target `env.academicApiUrl` with HTTP Basic auth
  (`env.academicApiClientId` / `env.academicApiClientSecret`).
- A core paginated-fetch helper follows the
  `{ page, pageSize, hasNextPage, pageItems }` envelope until `hasNextPage` is
  false (required for the 500+ student section, seed user `mega_prof`).
- Exposed functions (only the surface we need):
  - `findPersonByPuid(puid)`
  - `findPersonsByStudentIds(studentIds)` — batch
  - `sectionsByEmployeeId(employeeId)`
  - `sectionsByIds(sectionIds)`
  - `registrationsBySectionId(sectionId)`
  - `registrationsByPeriod(periodId)`
  - `academicPeriods()`
  - `pingAcademicApi()` — authed `pageSize=1` call to academic-periods, works
    identically against fake and real API
- Failures map to a typed `AcademicApiError` carrying the upstream status.
- No retry logic; AGENTS.md notes the real toolkit retried 5xx and where to add
  that.

### Service: `services/classes.service.ts` (EXAMPLE-labeled)

Copied from starter, with the identity adaptation above (`puidOf(user)` reads
`user.puid`; typed on FinanceBot's domain `User`).

1. **`getMyClasses(user)`**
   - `user.puid` → `findPersonByPuid` → employee/student numbers from the
     person's identifiers.
   - In parallel: **teaching** = `sectionsByEmployeeId` (if employee ID);
     **enrolled** = per-period registrations filtered app-side by student number,
     joined to `sectionsByIds` (if student ID).
   - Returns both lists grouped by academic period, with section and
     registration statuses. Dual-role people (`ta_student`, `dual_prof`) get both
     lists.
   - PUID with no person record → empty lists plus `personFound: false` (not an
     error).
2. **`getClassList(user, sectionId)`**
   - **Authorization first**: resolve the caller's person record, fetch the
     section, `403` unless the caller's employee ID appears in the section's
     teaching assignments (instructors only see rosters for sections they teach —
     the security teaching point).
   - Then `registrationsBySectionId` → batch `findPersonsByStudentIds` → full
     person records merged with each registration's status.

### Routes: `routes/classes.routes.ts`

- `GET /api/classes` — `ensureRole('faculty', 'student')`
- `GET /api/classes/:sectionId/students` — `ensureRole('faculty')` + the
  service's ownership check

Wired in `server/src/app.ts` as `app.use('/api', classesRouter)` alongside the
other example routers, with an EXAMPLE/safe-to-remove comment.

### Config

Three new entries in `config/env.ts` and `.env.example`, using FinanceBot's
existing `optional()` helper (same app code everywhere; only env values change):

| Var | Default (local) |
| --- | --- |
| `ACADEMIC_API_URL` | `http://localhost:3689` |
| `ACADEMIC_API_CLIENT_ID` | `mock-client` |
| `ACADEMIC_API_CLIENT_SECRET` | `mock-secret` |

`/api/health` gains `services.academicApi: 'up' | 'down'` via `pingAcademicApi()`
— warn-only like Qdrant; the app boots without it. The existing `health.routes.ts`
probe (`Promise.all([pingMongo(), pingQdrant()])`) extends to include it, and the
client `health` view renders the extra row.

## Client

FinanceBot's client navigation is config-driven, which fits this cleanly.

### Navigation (`client/src/config.ts`)

Add one `NAV` entry (mirrors starter, already in FinanceBot's field shape):

```ts
{ path: '/classes', label: 'Classes', glyph: '▦', group: 'examples', demo: true, roles: ['faculty', 'student'] }
```

The existing `isVisible()` role-gating (in `main.ts`) shows the tab to faculty
and students only. A staff user hand-typing `#/classes` gets the API's 403,
surfaced as "you don't have access".

### View: `client/src/views/classes.ts` (route `/classes` in `main.ts`)

Ported from starter's view, adapted to FinanceBot's `dom` / `ui` / `render`
helpers and ESM `.js` import extensions. Add the `/classes → renderClasses`
line in `main.ts`'s path→view map; add `fetchMyClasses` / `fetchClassList` (and
their types) to `client/src/api.ts`.

The hash router is exact-path, so the roster is an **in-view drill-down** (click a
class → outlet swaps to the roster with a "← Back to classes" button). No router
changes.

**Classes page** (from `GET /api/classes`):

- **Teaching** and **Enrolled in** sections, each rendered only when the server
  returned data for it.
- Classes grouped by academic period (period name as subheading).
- Each row: course code + section ("CPSC 110 101"), title, schedule summary from
  `sectionComponents` (days/time/room), status badge for non-open section states
  (Canceled / Waitlist / Closed) via the existing `badge()` helper. Enrolled rows
  also show the registration-status badge.
- Teaching rows click through to the roster; enrolled rows are not clickable.
- Empty states: nothing at all → "You have no classes for any term."
  (`empty_prof`, `empty_student`); `personFound: false` → same, plus a note that
  the account has no Academic API record.

**Roster drill-down** (from `GET /api/classes/:sectionId/students`):

- Header: course code, title, period, enrolment count.
- Table columns: name (preferred, falling back to legal — `legal_student`),
  student number, email (or "—" — `noemail_student`), registration-status badge.
- Each row expands (`<details>`) to the full raw person + registration JSON,
  pretty-printed ("everything the API returns" while keeping the table usable).
- Empty roster → "No students are enrolled in this section." (`cancel_prof`'s
  canceled section).

**Error state**: Academic API unreachable → the standard error panel with the
hint "Is the FakeAcademicAPI container running? (`docker compose up` in the
shared `services/FakeAcademicAPI` checkout)".

### Styles

Port starter's `.classes__*` rules into FinanceBot's `client/public/styles/main.css`,
reusing the existing `badge()` / table tokens (`client/src/ui.ts` already exports
`badge`, `emptyState`, `errorState`, `loadingState`). Compiled JS under
`client/public/js` is produced by the client `tsc` build, not hand-written.

## Error handling

- Component maps unreachable / non-2xx upstream responses to `AcademicApiError`;
  routes translate to **502** with "The Academic API is unavailable" — distinct
  from the app's own 4xx errors; the client error panel keys off it.
- Upstream 401 (bad client credentials) → logged server-side with a hint to check
  `ACADEMIC_API_CLIENT_ID`/`SECRET`; browser still sees 502.
- Missing PUID on the session user → 500 with a clear misconfigured-IdP message.
- FakeAcademicAPI's error injection (`x-mock-status`, `failFirstN`) is the local
  tool for demoing/testing these paths.

## Testing

Follows the repo's three layers (`tests/AGENTS.md`), ported from starter:

- **Unit (Jest, no services)**: component with mocked `fetch` (Basic auth header,
  pagination loop, error mapping); `classes.service` with the component mocked
  (identifier derivation, period grouping, dual-role output, app-side student
  filter, 403 ownership check) — fixtures use FinanceBot's domain `User`
  (`{ puid, affiliations, ... }`) rather than starter's SAML `attributes`; routes
  via supertest (401 signed out, 403 staff / non-owning instructor, 200 shapes).
- **E2E (Playwright)**: log in as `faculty` → Classes → CPSC 110 → roster contains
  the `student` test user; `staff` has no Classes nav item. Adds FakeAcademicAPI
  to the e2e prerequisites (with the shared MongoDB + IdP), documented in README
  and tests/AGENTS.md. Reuses the shared docker-simple-saml `faculty` / `student`
  users (password = username) already wired into `global-setup.ts`.
- **A11y**: Classes page and roster added to the axe scan list.

## Documentation

- `components/academic-api/AGENTS.md` — contract, env vars, pagination, error
  mapping, staging/production notes (real API URL + credentials; the app-side
  student filter flagged as the piece to revisit).
- README — new "Academic API (classes example)" section: starting FakeAcademicAPI
  from `../services/FakeAcademicAPI` (`docker compose up -d`, port 3689), env
  vars, which seed users demonstrate what (`faculty`, `student`, `ta_student`,
  `empty_prof`, `cancel_prof`, `waitlist_prof`, `mega_prof`, `legal_student`,
  `noemail_student`), and the deletion story (component + service + routes + view
  + NAV entry). FakeAcademicAPI joins the shared backing services.
- `.env.example` — the three new vars, commented.
- Root `AGENTS.md` — mention the new component.

## Out of scope

- Sync-to-Mongo roster storage (the production course-list-sync pattern).
- Retry/backoff on 5xx.
- TA-as-teaching-staff modeling (TAs appear only via their student enrolments; the
  API's teaching assignments are instructor-role only).
- Any write operations against the Academic API (it is read-only).
- Changes to the shared FakeAcademicAPI or docker-simple-saml repos (their seed
  data already supports this feature).
