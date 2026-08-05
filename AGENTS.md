# AGENTS.md — TLEF Boilerplate

This file orients coding agents (and humans) working in this repository. Read it
first. Every major folder has its own `AGENTS.md` with more specific guidance;
follow the one closest to the files you are editing.

## What this project is

A reusable boilerplate for TLEF web apps. `tlef-financebot` is the first project
built on it. The boilerplate provides a typed client/server skeleton plus
isolated, individually documented integration points for the services these apps
commonly need:

- MongoDB (application data)
- Qdrant (vector database for RAG)
- SAML / Shibboleth authentication (UBC IdP)
- the `ubc-genai-toolkit` modules: LLM, embeddings, chunking, document parsing

## Current state

- MongoDB (`server/src/components/mongodb`) is implemented and connected at
  startup; `GET /api/health` reports its status. It is the reference example of
  a built-up component. A small "notes" example (service + route + client page)
  demonstrates real read/write and is safe to delete.
- Authentication (`server/src/components/auth`) is implemented: SAML/Shibboleth
  login via `passport-ubcshib` against the local docker-simple-saml IdP, with
  sessions stored in MongoDB (`connect-mongo`). The client is an app shell behind
  login: a public landing screen ("Log in with CWL"), and after
  login a sidebar/top-bar app (Overview, the Notes/RAG demos, and a gated Members
  area) with Log out. See the README "Authentication" section for one-time local
  setup (SP entry + IdP certificate). Auth-gating is demonstrated end-to-end: the
  demo endpoints
  (`/api/notes`, `/api/rag/*`) and a members-only reference area
  (`/api/members/overview`) are protected per-route with the component's
  `ensureApiAuthenticated()` guard (401 JSON when signed out). `/api/health` and
  `/api/auth/me` stay public. Authorization is also demonstrated: role-based areas
  (`/api/roles/{faculty,student,staff}`) are gated with `ensureRole(...)` (403 for
  the wrong role, derived from `eduPersonAffiliation`), and the client shows each
  user only their own role menu.
- Admin Console v0 account provisioning is implemented: Admins can grant or
  revoke global `platformInstructor` access by PUID. A grant may exist before
  first login and is then applied to the matching PUID-backed User; SAML faculty
  affiliation never grants the capability by itself. The Admin accounts page
  lists persisted Users plus pending-first-login grants. Admin access remains
  separate from Instructor access. Course creation requires Admin or
  `platformInstructor`, while access to existing courses remains course-scoped
  through `ensureCourseInstructor()`.
- Admin Console v0 Student Preview is implemented: a course Instructor can
  switch the entire app into the real Student shell for a fresh anonymous
  student and exercise the currently released, Approved-only course experience
  before publication. Practice, strategies, mastery, flags, Review Book,
  summaries, skip, and remediation behave normally inside the Preview session,
  but explicit Instructor-only routes and separate short-lived
  `previewAttemptRecords` / `previewStudentSessions` collections keep every
  action out of live student records, notifications, and analytics.
- Qdrant (`server/src/components/qdrant`) is implemented: a configured client,
  idempotent `ensureCollection`, and `upsertPoints` / `search` helpers. `GET
  /api/health` reports its reachability.
- The GenAI toolkit modules (`server/src/components/genai/{llm,embeddings,
  chunking,document-parsing}`) are implemented, each wrapping its
  `ubc-genai-toolkit-*` package behind a small `index.ts` API.
- A small RAG example ties genai + qdrant together (ingest: parse → chunk →
  embed → upsert; query: embed → search → llm). It lives in
  `services/rag.service.ts` + `routes/rag.routes.ts` + a client page, is clearly
  labeled "EXAMPLE (safe to delete)", and mirrors the mongodb `notes` example.
- The Academic API (`server/src/components/academic-api`) is implemented: a typed
  Basic-auth client over the local FakeAcademicAPI. It backs the EXAMPLE "Classes"
  feature (`services/classes.service.ts` + `routes/classes.routes.ts` + a client
  page), role-gated to faculty/students, and is reported by `/api/health`.
- The jobs component (`server/src/components/jobs`) is implemented (Phase 1
  Task 1): an Agenda-backed MongoDB job queue with `defineJob` / `enqueueJob` /
  `scheduleRecurring` / `stopJobs`, started from `server.ts` after
  `ensureIndexes()`. `agenda` is pinned to **4.4.0** and the component opens its
  OWN mongodb@4 connection rather than sharing `getMongoClient()` — agenda's job
  locking reads `findOneAndUpdate(...).value`, which the repo's mongodb@7 driver
  no longer returns. Job handlers live next to the service that owns them; see
  `server/src/components/jobs/AGENTS.md`.
- Persistent content runs (Phase 2 P2-0) are implemented: material ingestion
  and question generation create unique Mongo `contentRuns`, Agenda receives
  only the run id, workers persist CAS-guarded stages/results/errors, and
  instructor pages receive one course-scoped SSE stream. Material responses
  link their newest attempt through `activeRunId`; generation enqueue returns
  `{ runId }`. Startup makes interrupted work explicitly failed/retryable
  rather than leaving an endless processing state.
- Phase 2 review-derived authoring improvements are implemented: courses have
  explicit draft/published/archived lifecycle plus archive/restore and one
  authoritative publish checklist; generation recipes are persisted and
  terminal runs support exact snapshot retry; question versions carry additive
  family/origin lineage; materials have instructor-correctable kind metadata;
  and the Instructor Content Map exposes Theme/LO source, question, run, and
  coverage gaps. Archived courses remain instructor-readable but reject
  student practice.
- Courses (Phase 1 Task 2) are implemented: `services/courses.service.ts` +
  `routes/courses.routes.ts` cover the instructor Courses/Hierarchy/Roster
  surface (creation, term dates, registration code, Theme/LO CRUD, publish
  checklist, roster). **Course-scoped authorization** lives in
  `server/src/components/auth/course-guards.ts` — `ensureCourseInstructor()` /
  `ensureCourseStudent()` / `ensureCourseTa()` check the signed-in user's
  per-course `courseRoles` (and honour `isAdmin`), unlike the affiliation-based
  `ensureRole()`. Use these rather than rolling your own course checks. They
  resolve the course from `req.params.courseId`, or from `res.locals.courseId`
  for routes that look up a child resource (Theme/LO) first.
- Question import (Phase 2 Tasks 8/9) is implemented: instructors can preview
  and commit partial-success CSV/JSON/QTI batches as Drafts, or sandbox-preview
  an existing parameterized `generate(random)` script and migrate it into one
  parameterized Draft after variable/placeholder review.
- Phase 3 TA workflows are implemented: UBC-email invitations activate on CWL
  login, per-TA course capabilities take effect immediately, term-end expiry is
  automatic, and the TA workspace supports review, suggested edits, internal
  notes, and flag escalation. TA approval and flag resolution remain hard-denied
  regardless of configured toggles.
- Phase 3 Instructor analytics are implemented: Topic Practice and Exam Prep
  failure rates use a five-attempt privacy/reliability floor, answer
  distributions highlight common misconceptions, engagement uses 30-minute
  session clustering with CSV export, and course-scoped individual profiles
  combine history, mastery, Review Book, and flag events.
- Phase 3 Admin essentials are implemented: the searchable directory manages
  course roles and retained-record account deactivation, protects against
  orphaning courses, exposes platform/course capability matrices, and persists
  model, daily generation limit, and quality flags. Admin mutations are audited;
  reviewer-disabled generation is explicitly flagged instead of silently
  pretending review occurred.
- Phase 3 is feature-complete (29/29 core plan checks): Exam Prep, capability
  model, TA workflows, Instructor analytics, Admin essentials, and the combined
  exit suite are all implemented and verified.
- Phase 3 Exam Prep services are implemented through WS-10 Task 4: instructors
  save split-aware midterm/final templates with non-blocking supply warnings;
  students receive one resumable, server-timed sitting assembled only from
  Approved pinned question versions; pre-submit state contains no correctness
  data; submission writes exam AttemptRecords, auto-collects misses, exposes
  full results/history, and queues an idempotent mastery qualifier batch that
  preserves practice-derived mastery status. Four Student views provide
  active-template selection, question navigation, server-confirmed countdown
  submission, full post-submit review, weak-area links, and exam history; the
  Exam Prep nav entry remains hidden when no template is active.
- Phase 3 capability authorization is implemented: thirteen independently
  configurable permissions resolve from per-user, course, platform, and
  default layers. Question/flag teaching-team routes use capability guards,
  while TA approval and flag resolution remain hard-denied regardless of
  stored configuration.
- Phase 5 Instructor Workflow v2 has started with a Course Launch Cockpit: one
  non-persisted aggregate read model turns course readiness, content health,
  review backlog, active flags, and engagement into a priority-ordered action
  queue with direct destinations. The Instructor shell now passes its current
  axe WCAG A/AA scans.
- Phase 5's Course-as-Project UX foundation is implemented: My Courses is a
  searchable Project dashboard; course-only navigation appears only inside a
  selected course and collapses to an accessible icon rail; Course Home exposes
  the Sources-to-Preview authoring path; and the Knowledge Workspace uses a
  viewport-bound three-panel layout with source-level Trash/Restore actions.
  The former Content Map is labelled Coverage Map to distinguish gap analysis
  from graph exploration inside the Knowledge Workspace.
- The Course-as-Project shell now spans Student and TA roles: Student and
  isolated Student Preview share course-project cards, persistent course
  context, a collapsible icon rail, and a linear learning journey; TA and
  Instructor TA View share real safe course identity, multi-course switching,
  a collapsible rail, and the Review Queue → Flag Triage workflow. The
  TA-accessible outline returns only name/code/section/term plus ordered
  Theme/LO labels and never exposes private course settings.
- Phase 5 now includes the first Course Knowledge Workspace slice: a responsive
  Files/Assistant/Inspector surface unifies upload, durable SSE stage progress,
  original/chunk/metadata preview, confidence-based multi-LO automation,
  reversible Trash, and an interactive provenance graph from source evidence
  through concepts/LOs to questions. Source chunks are persisted separately
  from embeddings, and deleted sources cannot ground new generation.

- Testing is set up across three layers (see `tests/AGENTS.md`): Jest + ts-jest +
  supertest unit/integration tests (`tests/unit`, with a jest-monocart-coverage
  report), Playwright e2e (`tests/e2e`, which logs in via real SAML in a
  global-setup and reuses the session), and axe accessibility scans (`tests/a11y`).
  Unit tests need no services; e2e/a11y need MongoDB + the IdP.

Each remaining component is meant to be "built up" in its own focused step,
following its `AGENTS.md`.

## Architecture

```
client/   Frontend. Plain TypeScript in client/src, compiled by tsc to
          client/public/js, and served statically by the server. No bundler.
server/   Express API in TypeScript.
          server/src/app.ts        Express app factory (routes + static + errors)
          server/src/server.ts     Entry point (reads env, starts listening)
          server/src/config/       Typed env loading
          server/src/middleware/   Cross-cutting Express middleware
          server/src/routes/       HTTP routers mounted under /api
          server/src/services/     Business logic (composes components)
          server/src/components/   One folder per external integration
tests/    Jest unit/integration (tests/unit), Playwright e2e (tests/e2e), and
          axe accessibility scans (tests/a11y). See tests/AGENTS.md.
```

Request flow: the browser loads the static page from `client/public`, which calls
JSON endpoints under `/api`. Routes delegate to `services/`, which use the
integrations in `components/`.

## Conventions

- TypeScript everywhere, `strict` mode. Shared compiler options live in
  `tsconfig.base.json`; `client/` and `server/` each extend it.
- Backend is CommonJS. Requires Node.js 18+ and uses the built-in global `fetch`.
- Client code is authored as native ES modules; imports between client files use
  an explicit `.js` extension (see `client/AGENTS.md`).
- Read environment variables only in `server/src/config/env.ts`, exposing a typed
  object. Do not scatter `process.env` reads across the codebase.
- Each integration is isolated in its own `server/src/components/<name>/` folder
  with an `index.ts` and an `AGENTS.md`. Keep integrations decoupled from routes;
  wire them together in `services/`.
- Every new variable a component needs must be added to `.env.example` with a
  comment.

## Two-developer convention (FinanceBot build)

Two developers — **Saurav** and **Stephen** — build this project in parallel,
each running their own agent sessions. The shared state between the two sessions
is the phase plans in `docs/superpowers/plans/`, the checkboxes in those plans,
and `git log`. An agent never sees the other developer's uncommitted work.

**Before doing ANY phase-plan work, an agent MUST:**

1. **Ask which developer it is working for: Saurav or Stephen.** Never assume.
   (A `.claude` SessionStart hook reminds you each session; `CLAUDE.md` states
   the rule.)
2. **Write its own plan first.** Before starting a phase, use the superpowers
   `writing-plans` skill to turn the core phase document (e.g.
   `docs/superpowers/plans/phase-0/2026-07-11-phase-0-foundations.md`) into a
   personal task-by-task plan, saved under your name:
   `docs/superpowers/plans/<phase>/<YourName>/`. This is how the other developer
   (and their agent) sees what you are working on.
3. **Sync before and after working:** run `npm run sync-plans -- <YourName>`.
   This publishes your `<YourName>/` plan folder to the dedicated
   `docs/phase-0-shared-services` documentation branch and pulls the other
   developer's latest plans into your working tree, so both sides stay current
   without triggering the staging deployment attached to `main` or waiting for
   feature branches to merge.
4. **Read the current phase plan and `git log --oneline -20`** to see which
   tasks are checked off / merged.
5. **Only pick up tasks owned by its developer.** Every task in the phase plans
   carries an `**Owner:**` line. Never start, edit, or "helpfully fix" a task
   owned by the other developer without flagging it to your human first.

Name ↔ arc binding (fill in once, then keep updated):
- **Saurav** = Dev B (arc: data/contracts in Phase 0; instructor/AI in Phase 1)
- **Stephen** = Dev A (arc: platform/auth in Phase 0; student arc in Phase 1)

**Pause-and-sync rule:** when a task is marked as a **Sync point**, the agent
must stop after preparing the work and tell its developer that the other
developer's review/participation is required before merging or proceeding.
Sync points are listed at the top of each phase plan.

**Shared-file conventions (conflict avoidance):**
- `package.json` dependency changes: Phase 0 Task 1 merges first; afterwards
  additions are single lines, rebased frequently.
- `server/src/app.ts` (route mounts), `server/src/server.ts` (startup calls),
  `.env.example`, `server/src/components/mongodb/collections.ts` (accessors +
  index specs), client `router.ts`/`main.ts` (route tables): **append-only,
  one line/block per addition** — never reorder or reformat surrounding lines.
- Rebase on `main` before starting each task; one short-lived branch per task,
  merged the day it's done.
- If implementation forces a change to a task's `**Interfaces:**` block or to
  `docs/api-contract.md`, update the plan/contract **in the same PR** as the
  code. The other developer's agent trusts those documents.
- Keep the checkboxes in the phase plan and the `AGENTS.md` "Current state"
  section updated as tasks merge.

## Commands

**First-time setup (once per clone):**

```bash
npm install            # install dependencies
cp .env.example .env   # create local env file (app runs on PORT, default 6118)
# start the shared backing services (see "Backing services" below)
npm run saml:fetch-cert # write server/certs/idp.pem from the running IdP
```

**Everyday development:**

```bash
# ensure the shared Docker services are up (Mongo, Qdrant, SAML IdP)
npm run dev          # server (watch) + client (tsc --watch) in parallel -> http://localhost:6118
```

Log in with the shared-IdP test users; the **password equals the username**. The
e2e suite uses `faculty` (affiliation=faculty) and `student`. The full roster is
in `docker-simple-saml/config/simplesamlphp/authsources.php`.

**Backing services (Docker).** The three services are **not** run from this repo.
Each lives in its own shared repo so every TLEF project uses the same containers:
[tlef-mongodb-docker](https://github.com/ubc/tlef-mongodb-docker) (Mongo :27017,
root `mongoadmin`/`secret` — `cp .env.example .env` before first `docker compose up -d`),
[docker-simple-saml](https://github.com/ubc/docker-simple-saml) (SAML IdP :6122),
and [tlef-qdrant](https://github.com/ubc/tlef-qdrant) (Qdrant :6333, API key
`super-secret-dev-key`). Clone them next to this repo and `docker compose up -d`
in each. Start them once and leave them up — there is no per-project compose to
conflict on ports.

**Other commands:**

```bash
npm run build        # compile server -> server/dist, client -> client/public/js
npm start            # run the compiled server (production-style)
npm run typecheck    # type-check both projects, no emit
npm run lint         # eslint
npm test             # unit + integration tests (Jest; no services needed)
npm run test:e2e     # Playwright browser tests (needs the shared services incl. FakeAcademicAPI up + saml:fetch-cert)
npm run test:a11y    # axe accessibility scans
```

See `tests/AGENTS.md` for the full testing guide (unit/integration, e2e, a11y).

## Building up a component (the standard workflow)

1. Open `server/src/components/<name>/AGENTS.md` and follow its checklist.
2. Add any required variables to `.env.example` and to the typed `env` object.
3. Implement the component's `index.ts` (connection/client + small helpers).
4. Expose it through a `service`, then a `route` under `/api`.
5. Surface its status in `GET /api/health` where useful.

## Not yet present (future build-up steps)

- CI wiring (e.g. GitHub Actions) to run `npm run typecheck`, `npm test`, and the
  Playwright suites on push. The tests exist (`tests/`); automating them in CI —
  including standing up MongoDB + the IdP for e2e — is the next step.
