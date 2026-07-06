# AGENTS.md — server/src/components

Each subfolder isolates one external integration. This is where the boilerplate's
"batteries" live. Every component is decoupled: it owns a single system, exposes
a small public API from its `index.ts`, and is composed by `services/`.

## The component pattern

A component folder contains:

- `index.ts` — the public API: a client/connection plus a few thin helpers.
  Everything the rest of the app uses is exported here.
- `AGENTS.md` — what it is, its env vars, the exact SDK/toolkit API to call, and
  an implementation checklist.
- optional subfolders for internals (e.g. `auth/strategies/`).

Rules:

- A component reads config from the typed `env` object (`server/src/config/env.ts`),
  never `process.env` directly.
- A component does not import from `routes/` or `services/` (dependencies point
  inward only). Services compose components, not the other way around.
- Keep initialization lazy/explicit (a `connect()` / factory function) so the app
  controls startup order and tests can opt out.

## Components

| Folder | Purpose | Key packages |
| --- | --- | --- |
| `mongodb/` | Application data store | `mongodb` |
| `qdrant/` | Vector database (RAG) | `@qdrant/js-client-rest` |
| `auth/` | Sessions + SAML/Shibboleth auth | `express-session`, `connect-mongo`, `passport`, `passport-ubcshib`, `passport-saml` |
| `genai/` | UBC GenAI toolkit modules | `ubc-genai-toolkit-*` |
| `academic-api/` | UBC Academic API lookup (person + courses by PUID) | `fetch` (no SDK) |

`passport-local` is also installed (a dependency) for optional local-dev logins,
but no local strategy is wired up today — only the SAML/Shibboleth flow is.

## Current state

- `mongodb/` — implemented (reference example).
- `auth/` — implemented (SAML/Shibboleth + sessions in Mongo).
- `qdrant/` — implemented (client + collection/upsert/search helpers).
- `genai/{llm,embeddings,chunking,document-parsing}/` — implemented (each wraps
  its `ubc-genai-toolkit-*` package).
- `academic-api/` — implemented. Read-only client for UBC's Academic API (points
  at the local `academic_api_fake` in dev); resolves the signed-in user's person
  + courses by CWL PUID. Backs the auth-gated `/academic` "Academic record" page.

Build any further components one at a time following each folder's `AGENTS.md`.
