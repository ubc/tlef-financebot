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
  login: a public landing screen (health check + "Log in with CWL"), and after
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
   This publishes your `<YourName>/` plan folder to `main` and pulls the other
   developer's latest plans into your working tree, so both sides stay current
   without waiting for feature branches to merge. If `main` is protected, your
   plans are pushed to a `plans-sync-<YourName>` branch and you open a PR.
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
