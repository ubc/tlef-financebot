# AGENTS.md — server/src/routes

HTTP routers. Each file exports an Express `Router`, mounted under `/api` in
`server/src/app.ts`.

## Present

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
- `auth.routes.ts` — SAML login flow: `GET /auth/ubcshib`,
  `POST /auth/ubcshib/callback`, `GET /auth/logout`, and `GET /api/auth/me`.
  All **public** (they establish/report the session). The `/auth/*` paths are
  intentionally NOT under `/api` (their URLs must match the ACS/SLO registered in
  the IdP). See `components/auth/AGENTS.md`.

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
