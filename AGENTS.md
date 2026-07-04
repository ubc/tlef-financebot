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
  `/api/auth/me` stay public.
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

## Commands

```bash
npm install          # install dependencies
cp .env.example .env # create local env file
npm run dev          # server (watch) + client (tsc --watch) in parallel
npm run build        # compile server -> server/dist, client -> client/public/js
npm start            # run the compiled server
npm run typecheck    # type-check both projects, no emit
npm test             # unit + integration tests (Jest; no services needed)
npm run test:e2e     # Playwright browser tests (needs MongoDB + IdP running)
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
