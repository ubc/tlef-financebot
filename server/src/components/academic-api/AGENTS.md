# AGENTS.md — components/academic-api

The UBC Academic API integration: course sections, registrations (rosters),
academic periods, and person lookups. A thin, typed client over the global
`fetch` — no SDK. Consumed by `services/classes.service.ts` (the EXAMPLE
classes feature).

## What it talks to

- **Locally:** [FakeAcademicAPI](https://github.com/ubc/FakeAcademicAPI) on
  `http://localhost:3689` (`docker compose up` in that checkout). It returns
  invented data using the real API's exact request/response shapes, and its
  seed users match the docker-simple-saml accounts (same PUIDs), so a local
  CWL login can be resolved to fake classes.
- **Staging/production:** the real UBC Academic API. Same code — change the
  env vars only.

## Env vars

| Var | Local default | Purpose |
| --- | --- | --- |
| `ACADEMIC_API_URL` | `http://localhost:3689` | Base URL |
| `ACADEMIC_API_CLIENT_ID` | `mock-client` | HTTP Basic auth client id |
| `ACADEMIC_API_CLIENT_SECRET` | `mock-secret` | HTTP Basic auth secret |

## The API model (what the functions map to)

Every endpoint is a `GET` returning `{ page, pageSize, hasNextPage, pageItems }`;
`fetchAllPages` follows `hasNextPage` so callers always get the full list.

- `findPersonByPuid` / `findPersonsByStudentIds` → `/person/v2/persons`.
  SAML gives us only the PUID; this resolves it to a person whose
  `identifiers` array carries their `Student_ID` / `Employee_ID`.
- `sectionsByEmployeeId` / `sectionsByIds` →
  `/academic-exp/v2/course-section-details`. Sections embed the course,
  period, status, instructors (`teachingAssignments`), and meeting times.
- `registrationsBySectionId` / `registrationsByPeriod` →
  `/academic/v4/course-registrations`. **There is no "registrations by
  student" query** — rosters are per-section. The classes example fetches
  per-period registrations and filters app-side.
- `academicPeriods` → `/academic/v4/academic-periods` (terms; used for
  grouping/ordering).
- `pingAcademicApi` → authed `pageSize=1` periods call; used by
  `GET /api/health` (warn-only — the app runs without this API).

## Error handling

Unreachable or non-2xx → `AcademicApiError` with `status = 502` (so the
central error handler answers Bad Gateway) and the upstream code preserved in
`upstreamStatus`. An upstream 401 additionally logs a credentials hint. There
is **no retry logic**; the real API can return transient 5xx, and the retired
course-list-sync toolkit retried those — add a retry loop in `fetchAllPages`
if your app needs it. FakeAcademicAPI can inject errors (`x-mock-status`
header, or `forceStatus`/`failFirstN` config) to exercise these paths.

## Moving to staging / production

1. Point the three env vars at the real Academic API and real credentials.
2. Revisit `registrationsByPeriod`: the fake accepts period-wide registration
   queries, but the real API may not allow queries that broad. If it refuses,
   the production-grade pattern is to sync the rosters your app cares about
   into MongoDB on a schedule and query locally (what the retired
   `ubc-genai-toolkit-course-list-sync` toolkit did), or scope the query to
   known sections.
3. The instructor-side calls (`sectionsByEmployeeId`,
   `registrationsBySectionId`, persons) match captured real-API usage and
   should carry over unchanged.
