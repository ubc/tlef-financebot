# AGENTS.md — components/academic-api

Read-only client for UBC's **Academic API** (course, section, registration, and
person data). In local development it points at the sibling
[`academic_api_fake`](../../../../academic_api_fake) project — a Dockerized stand-in
that returns invented data in the real API's exact response shapes — so the whole
flow works without real API access or student data.

Given a signed-in user's **CWL PUID** (from the SAML session), it resolves their
person record and the course sections they teach and/or are enrolled in.

## Status

Implemented. `index.ts` exports the lookup helpers plus a health ping. Composed by
`services/academic.service.ts`, exposed by `routes/academic.routes.ts` at
`GET /api/academic/me` (**auth-gated**), and surfaced in the client's
`/academic` view ("Academic record").

## Environment variables

All **optional** — they default to the local FakeAcademicAPI, so the feature
works out of the box in dev. Point them at the real Academic API in
staging/production. Auth is HTTP **Basic** (`clientId:secret`).

| Variable | Meaning | Default |
| --- | --- | --- |
| `ACADEMIC_API_BASE_URL` | API base URL. **Blank disables the feature.** | `http://localhost:3689` |
| `ACADEMIC_API_CLIENT_ID` | Basic-auth client id | `mock-client` |
| `ACADEMIC_API_CLIENT_SECRET` | Basic-auth client secret | `mock-secret` |

To run the fake locally: `cd academic_api_fake && docker compose up --build`
(or `npm install && npm start`). See its `README.md` / `USERS.md` for the seeded
test accounts (each maps to a `docker-simple-saml` login by PUID).

## Public API (`index.ts`)

| Export | Purpose |
| --- | --- |
| `isAcademicApiConfigured(): boolean` | True when `ACADEMIC_API_BASE_URL` is set. |
| `getPersonByPuid(puid): Promise<ApiPerson \| null>` | Look up one person by PUID. |
| `getSectionsTaughtBy(employeeId): Promise<ApiSection[]>` | Sections this employee teaches. |
| `getSectionsEnrolledBy(studentId): Promise<ApiSection[]>` | Sections this student is registered in. |
| `pingAcademicApi(): Promise<boolean>` | Reachability check for `/api/health`. Never throws. |

`ApiPerson` / `ApiSection` expose only the fields we consume; the API returns far
more. Errors carry a numeric `status` (`502` unreachable/upstream error, `503`
not configured) so the central `errorHandler` returns the right HTTP code.

## API surface used

All endpoints are `GET`, Basic-authed, and return the pagination envelope
`{ page, pageSize, hasNextPage, pageItems }`; `fetchAll` unwraps it and walks
`hasNextPage`.

| Endpoint | Query | Used for |
| --- | --- | --- |
| `/person/v2/persons` | `puid` (or `student_id` / `employee_id`) | Resolve the signed-in user. |
| `/academic-exp/v2/course-section-details` | `employeeId` | Courses the user teaches. |
| `/academic/v4/course-registrations` | — | All registrations (filtered by `studentId` in code). |

The person record's `identifiers` array carries the user's `Student_ID` /
`Employee_ID`, so the service reads those off the person rather than the SAML
attributes. There is **no** "registrations by student" filter on the API, so
`getSectionsEnrolledBy` pulls all registrations, keeps the student's, then
fetches those section details — fine for the fake's small dataset; the real API
would use a narrower query.

## How it is wired

- `GET /api/health` reports `{ services: { academicApi: "up" | "down" } }`, but
  **only when configured** (otherwise it is an optional, disabled feature, not a
  "down" dependency).
- `services/academic.service.ts` (`buildAcademicProfile(user)`) reads the PUID
  from the session user, resolves the person, and assembles a clean
  `AcademicProfile` DTO (identity + `teaching` / `enrolled` course summaries).
- `routes/academic.routes.ts` mounts `GET /api/academic/me`, guarded by
  `ensureApiAuthenticated()` — it depends on the SAML identity, so it is only
  reachable while signed in.
- Client: `client/src/api.ts#getAcademicProfile`, `client/src/views/academic.ts`,
  a `/academic` nav entry in `client/src/config.ts`, and its route in
  `client/src/main.ts`.

## Implementation checklist

- [x] Add `academicApiBaseUrl` / `academicApiClientId` / `academicApiClientSecret`
      to `config/env.ts` (+ `.env.example`), defaulting to the local fake.
- [x] Create the Basic-auth client + `fetchAll` pagination walk in `index.ts`.
- [x] Add `getPersonByPuid` / `getSectionsTaughtBy` / `getSectionsEnrolledBy`.
- [x] Report reachability in `GET /api/health` (only when configured).
- [x] Build the `AcademicProfile` DTO in `services/academic.service.ts`.
- [x] Expose the auth-gated `GET /api/academic/me` route.
- [x] Wire the client view, API function, and nav entry.

## Gotchas

- The feature keys entirely on the **CWL PUID** (`ubcEduCwlPuid` SAML attribute).
  A logged-in user whose PUID is not seeded returns `found: false` with a note,
  not an error. Test accounts and their PUIDs live in `academic_api_fake/USERS.md`.
- `found: false` also covers "API not configured" and "login had no PUID". The
  view renders the `note` field for all three cases.
- The fake defaults to Basic auth `mock-client` / `mock-secret`; it *also* accepts
  a Bearer token for manual curl, but this client always uses Basic.
- Keep the consumed `ApiPerson` / `ApiSection` fields in sync with
  `academic_api_fake/src/render.ts` if the response shapes change.
