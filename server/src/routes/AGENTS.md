# AGENTS.md — server/src/routes

`registration-codes.routes.ts` exposes course Instructor/Admin-only list,
idempotent batch creation, unused-code revocation and soft record deletion.
List queries are code-level paginated (10/25/50) with optional status filters;
deleted records are omitted. Student redemption remains
`POST /api/enrollments`; legacy shared-code regeneration returns 410.
TA invitations accept `{ identifier }` (UBC email or existing CWL), retaining
`{ email }` as a legacy request shape. See the supplemental enrollment API contract.

HTTP routers. Each file exports an Express `Router`, mounted under `/api` in
`server/src/app.ts`.

## Present

- `people-import.routes.ts` — Instructor-only CSV preview/current snapshot, and
  owner/Admin-only confirmed multipart commit or revision-checked clear. It is
  independent of Canvas OAuth, uses the course guards, reparses the original
  file on commit, and returns 400 for malformed/oversized/all-rejected files and
  409 for stale revisions.

- `health.routes.ts` — `GET /api/health` returns `{ status, timestamp, services,
  genai }`, where `services` reports reachability (`mongodb`, `qdrant`) and
  `genai` echoes the configured LLM/embeddings providers + models. **Public** —
  the pre-login landing screen uses it before there is a session.
- `notes.routes.ts` — EXAMPLE. `GET/POST /api/notes`, demonstrating the mongodb
  component via `notes.service.ts`. **Auth-gated** (per route). Safe to delete.
- `rag.routes.ts` — EXAMPLE. `POST /api/rag/ingest` (text), `POST
  /api/rag/ingest-file` (multipart upload via `multer`), `POST /api/rag/query`,
  demonstrating the genai + qdrant components via `rag.service.ts`.
  **Auth-gated** (per route). Safe to delete.
- `members.routes.ts` — EXAMPLE (auth-gating reference). `GET
  /api/members/overview`, **auth-gated**, returns a members-only summary of the
  signed-in user via `members.service.ts`. Keep or adapt as the template for a
  protected feature.
- `roles.routes.ts` — EXAMPLE (role-based authorization). `GET
  /api/roles/{faculty,student,staff}`, each **role-gated** with `ensureRole(...)`
  (`403` for the wrong role), via `roles.service.ts`. The template for
  role-specific features.
- `auth.routes.ts` — SAML login flow: `GET /auth/ubcshib`,
  `POST /auth/ubcshib/callback`, `GET /auth/logout`, and `GET /api/auth/me`.
  All **public** (they establish/report the session). The `/auth/*` paths are
  intentionally NOT under `/api` (their URLs must match the ACS/SLO registered in
  the IdP). See `components/auth/AGENTS.md`.
- `tutorials.routes.ts` — authenticated user's own contextual tutorial
  catalogue and completion/dismissal/reset state. PUID always comes from the
  session; role and tutorial ids are validated against the server catalogue. Admin tutorial access requires an Admin session; progress never changes consent or permissions.
- `courses.routes.ts` — Courses / Hierarchy / Roster: course CRUD, explicit
  draft/published/archived lifecycle, read-only publish checklist,
  archive/restore, owner/Admin-only permanent cascade deletion, Theme and LO CRUD/archive, and roster
  put/get. `POST /api/courses` requires an explicit platform-Instructor grant
  (or Admin); every other
  route is **instructor-gated** for the course it targets via
  `ensureCourseInstructor()`, with Theme/LO routes stashing `res.locals.courseId`
  from the child resource first. See `components/auth/course-guards.ts`.
- `admin.routes.ts` — Admin Console v0 account provisioning:
  `GET /api/admin/users` plus
  `PUT/DELETE /api/admin/platform-instructors/:puid`. Every route is protected
  by `ensureAdmin()`; PUT may create a pending PUID grant before first SAML
  login, and DELETE is idempotent.
- `preview.routes.ts` — explicit course-Instructor/current-TA (or Admin) anonymous Student
  Preview. Its `/preview/*` namespace mirrors Student home, practice, attempt,
  flag, Review Book/bookmark/remove, skip, summary, and remediation-material
  capabilities. Every stateful call carries a server-validated
  `previewSessionId`; these routes intentionally do not weaken
  `ensureCourseStudent()` or call live student workflows. TA flags remain
  isolated even if the client requests the Instructor/Admin TEST queue option.
- `exams.routes.ts` — Phase 3 WS-10. Exposes course-Instructor list/upsert
  endpoints for midterm/final Exam Prep templates plus course-Student active
  template, single-sitting start/resume, sanitized attempt-state, answer, and
  submit endpoints, followed by post-submit full results and newest-first
  course history. Attempt-id routes authenticate before resolving and stashing
  their course for `ensureCourseStudent()`; results return 409 before submit.
- `questions.routes.ts` — Question bank: browse/filter, prioritized review
  queue, single-question detail, editing, and publication-state transitions
  (including a courses-spanning bulk transition). Teaching-team reads use
  `question.review`; changes use their respective capabilities and hard-deny
  TA final approval. Child routes stash the target course in
  `res.locals.courseId` before authorization.
- `materials.routes.ts` — Material upload + async RAG ingestion (IN-S04/S05):
  `POST/GET /api/courses/:courseId/materials` (multipart `files[]` or JSON
  `{ url }`), `POST /api/materials/:materialId/retry`,
  `PUT /api/materials/:materialId/assignments`, and AI hierarchy suggestion +
  reviewed apply with automatic per-LO material assignments. List, workspace
  detail and original-source GETs allow assigned TAs through
  `ensureCourseTeachingMember()`; mutations and Trash remain Instructor-only.
  MaterialId-scoped mutation routes stash `res.locals.courseId` from the target.
- `content-runs.routes.ts` — Phase 2 P2-0 durable material/generation progress:
  recent course run history, one full snapshot, exact terminal generation
  retry, ending one active generation run (`POST .../:runId/end`) or all of a
  course's (`POST .../end-active`), and one course-scoped SSE stream. Instructor-gated; the stream sends
  recent persisted state before live updates.
- `generation-blueprints.routes.ts` — Instructor-gated saved generation recipe
  list/create/update/run endpoints.
- `content-map.routes.ts` — Read-only, course-scoped hierarchy/source/question/
  run coverage snapshot and knowledge graph for Instructors and assigned TAs.
- `import.routes.ts` — Instructor-gated CSV/JSON/QTI preview + Draft commit,
  plus parameterized-script sandbox preview + revalidated Draft migration.
  Script/template mismatches return review data without inserting.

## Auth-gating a route

Apply the `ensureApiAuthenticated()` guard (from `components/auth`) as a route
handler on each `/api/*` route you want to protect; unauthenticated callers get
`401 JSON`. Apply it **per route** — not via `router.use(...)` — because these
routers are mounted at the shared `/api` prefix, where router-level middleware
would also run for (and reject) sibling public routes like `/api/auth/me`. See
the "Protecting routes" section of `components/auth/AGENTS.md`.

## Conventions

- One file per resource: `<name>.routes.ts`, exporting `<name>Router`.
- Keep routes thin: parse/validate the request, call a `service`, shape the
  response. No database or SDK calls directly in a route.
- Mount new routers in `app.ts`. Order matters — API routers are registered
  before the static file handler so `/api/*` is never shadowed by a static file.
- Keep response shapes in sync with the client's typed API in
  `client/src/api.ts`.
- Return JSON. Throw errors (optionally with a numeric `status`) and let the
  central `errorHandler` format them.

- `capabilities.routes.ts` — `GET /courses/:courseId/capabilities/me` returns
  only the session user's effective booleans through the existing capability
  service. It rejects signed-out and foreign-course users, takes no user/role
  override, and never returns stored assignments or other identities.

- `analytics.routes.ts` validates optional exact date/mode/LO scopes and bounded
  question-pattern limits. Aggregate routes require `analytics.view`; all named
  follow-up lists/search/profiles require `analytics.individual`. Distribution
  resolves an explicit version against the course-owned question.

`course-sharing.routes.ts` exposes owner/Admin-managed invitations and members.
`question-collaboration.routes.ts` exposes authenticated course/question-scoped
shared snapshots, updates, presence, SSE, commit and explicit comparison/rebase.
Permanent access/lifecycle failures end streams; transient failures reconnect.
See the detailed wire contracts in `docs/api-contract.md`.

`exam-builder.routes.ts` exposes the private fixed-paper builder to course
Instructor/Admin only. Student assessment routes use enrollment guards plus
PUID ownership in the service. Never expose builder detail/candidates or publication
answer keys through the student routes; pre-release state is an explicit allowlist.
See the Exam Builder v2 section in `docs/api-contract.md`.


Exam Builder title PUT and DELETE remain Instructor/Admin-only. Both require
revision CAS; DELETE also checks student attempts and active generation in the
service, and the catalog requires typed-title confirmation.


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
