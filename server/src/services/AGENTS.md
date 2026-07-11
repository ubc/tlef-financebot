# AGENTS.md — server/src/services

Business logic. Services sit between routes and components:

```
routes  ->  services  ->  components
```

A service orchestrates one or more `components/` to perform an application task
(e.g. "ingest a document" = document-parsing -> chunking -> embeddings ->
qdrant). Routes call services; services never handle HTTP request/response
objects directly.

## Current state

- `notes.service.ts` — EXAMPLE. Demonstrates using the `mongodb` component
  (`getDb().collection('notes')`) to insert and list documents. It exists to
  show the pattern and is safe to delete.
- `rag.service.ts` — EXAMPLE. Composes the genai + qdrant components into a RAG
  pipeline: `ingestText` / `ingestFile` (parse → chunk → embed → upsert) and
  `query` (embed → search → llm). Derives the Qdrant collection size from the
  embedding model so the two cannot drift. Safe to delete.
- `members.service.ts` — EXAMPLE (auth-gating reference). `buildMembersOverview`
  turns the authenticated session user (`AppUser` from `components/auth`) into a
  plain response object. It is called only from the gated
  `routes/members.routes.ts`, so it demonstrates a service backing a
  members-only feature. Keep or adapt for your own protected area.
- `roles.service.ts` — EXAMPLE (role-based authorization). `buildRoleArea(role,
  user)` returns a role-specific payload; `ROLE_AREAS` lists the roles that have
  an area. Called only from the role-gated `routes/roles.routes.ts`. Keep or adapt
  for role-specific features.
- `academic.service.ts` — composes the `academic-api` component. `buildAcademicProfile(user)`
  reads the signed-in user's CWL PUID, resolves their person record, and returns a
  clean `AcademicProfile` DTO (identity + `teaching` / `enrolled` course summaries).
  Called only from the auth-gated `routes/academic.routes.ts`. `found: false` (with
  a `note`) covers "API not configured", "login had no PUID", and "PUID not found".

Other services will appear as more components are built up.

## Adding a service

1. Create `<name>.service.ts` exporting plain functions (or a small class).
2. Import and use the relevant `components/` — do not reach into their internals;
   use their public `index.ts` exports.
3. Accept and return plain typed data, not Express `req`/`res` objects.
4. Call the service from a route in `server/src/routes/`.
