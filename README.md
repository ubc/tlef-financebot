# FinanceBot

A TypeScript boilerplate for TLEF projects: a plain client/server web app with isolated, well-documented integration points for the services these projects commonly need — MongoDB, a Qdrant vector database, SAML/Shibboleth auth, and the [`ubc-genai-toolkit`](https://github.com/ubc/ubc-genai-toolkit-ts) modules (LLM, embeddings, chunking, document parsing).

## What's here today

A runnable client/server app with:

- MongoDB wired up (connection + health check, plus a small "notes" demo of real read/write).
- SAML/Shibboleth authentication (CWL login) via `passport-ubcshib`, with sessions stored in MongoDB. Most of the app is behind login: a public landing screen (health check + "Log in with CWL"), and after login a sidebar app with the demos and a **gated Members area** — showing how to protect routes with the auth component's `ensureApiAuthenticated()` guard.
- A Qdrant vector-DB client (collection + upsert + search) and the four GenAI toolkit modules (LLM, embeddings, chunking, document parsing).
- A small **RAG example** tying them together: ingest text or a file (parse → chunk → embed → upsert), then ask a question (embed → search → LLM). It is clearly labeled "EXAMPLE (safe to delete)", like the notes demo.

Each integration is isolated under `server/src/components/` with its own `AGENTS.md`.

## Layout

```
client/   Frontend: plain TypeScript compiled to client/public/js and served statically.
server/   Express API (TypeScript). Serves the client and exposes /api routes.
          server/src/components/  Isolated integrations, one folder each.
```

Every meaningful folder contains an `AGENTS.md` aimed at LLM coding agents (and humans). Start with the root `AGENTS.md`.

## Requirements

- Node.js 18+ (uses the built-in global `fetch`)
- npm
- Docker, for the local backing services below (all mirror staging/production):
  - MongoDB — [tlef-mongodb-docker](https://github.com/ubc/tlef-mongodb-docker)
  - SAML IdP — [docker-simple-saml](https://github.com/ubc/docker-simple-saml)
  - Qdrant — the vector database (see "Vector search & RAG" below)
- For the GenAI defaults: a local [Ollama](https://ollama.com) with a chat model and an embedding model pulled (see "Vector search & RAG"). OpenAI / Anthropic / the UBC LLM Sandbox are drop-in alternatives via env vars.

## Local development services

The backing services are **not** run from this repo. Each lives in its own
shared repo (linked in Prerequisites above) so every TLEF project talks to the
exact same containers. Clone the three next to this one and start each:

    # MongoDB — root user is mongoadmin / secret; copy the env first, then start
    cd ../tlef-mongodb-docker && cp .env.example .env && docker compose up -d

    # SAML IdP — mock UBC CWL Shibboleth
    cd ../docker-simple-saml && docker compose up -d

    # Qdrant — vector database (API key: super-secret-dev-key)
    cd ../tlef-qdrant && docker compose up -d

    # Back in this repo: write server/certs/idp.pem from the IdP metadata
    cd ../tlef-financebot && npm run saml:fetch-cert

This gives MongoDB on :27017, the SAML IdP on :6122, and Qdrant on :6333 — the
hosts/ports `.env.example` already expects. Because every project shares these
containers, start them once and leave them up; there is no per-project compose
to conflict on ports anymore.

Test users live in the shared IdP
(`docker-simple-saml/config/simplesamlphp/authsources.php`); the **password
equals the username**. The e2e suite uses `faculty` (affiliation=faculty) and
`student`; that file lists many more (`bio_prof`, `cpsc_student`, …).

## Getting started

```bash
# 1. Start the shared backing services (see "Local development services" above):
#    MongoDB (tlef-mongodb-docker), SAML IdP (docker-simple-saml), Qdrant (tlef-qdrant)

# 2. Make sure Ollama is running with the models pulled

# 3. Then, in this repo
npm install
cp .env.example .env        # defaults match the docker containers + local Ollama
npm run saml:fetch-cert     # fetch the IdP signing certificate (see Authentication)
npm run dev
```

Then open http://localhost:6118 (or your `PORT`). You land on a public screen that runs the health check (MongoDB + Qdrant status and the configured GenAI providers) and offers "Log in with CWL". After logging in, the app opens with an Overview, the Notes (MongoDB) and RAG (GenAI + Qdrant) demos, and a gated Members area. Only `/api/health` and `/api/auth/me` are public; the demo endpoints and the members area require a session.

The server connects to MongoDB on startup and exits if it cannot — make sure that container is running first. It also reads the IdP certificate on startup and exits with an actionable message if it is missing. Qdrant is checked too, but only a warning is logged if it is down (it backs the deletable RAG example, not the app itself).

## Authentication (SAML / CWL)

Login uses [`passport-ubcshib`](https://github.com/ubc/passport-ubcshib) against a
local [docker-simple-saml](https://github.com/ubc/docker-simple-saml) IdP
(SimpleSAMLphp), which runs at `http://localhost:6122/simplesaml/`. Two one-time
local setup steps are needed the first time you clone this boilerplate:

### 1. Register this app as a Service Provider in the IdP

The IdP only accepts SAML requests from apps it knows. Add an entry to the IdP's `config/simplesamlphp/saml20-sp-remote.php` whose key equals your `SAML_ISSUER` and whose ACS `Location` equals your `SAML_CALLBACK_URL`.

- The default `.env` uses `SAML_ISSUER=http://localhost:6118`, which the IdP already ships with — so if you run on port 6118, there is nothing to add.
- If you run on a different port (this repo's `tlef-financebot` uses `6118`), add a matching entry. For example, `6118` is registered like this (already added for this repo):

  ```php
  // in $local_apps
  'http://localhost:6118' => 'http://localhost:6118',

  // after the loop that builds $metadata
  $metadata['http://localhost:6118']['AssertionConsumerService'][0]['Location'] = 'http://localhost:6118/auth/ubcshib/callback';
  ```

  Then set in your `.env`:

  ```bash
  PORT=6118
  SAML_ISSUER=http://localhost:6118
  SAML_CALLBACK_URL=http://localhost:6118/auth/ubcshib/callback
  ```

  SimpleSAMLphp reads this file per request in dev, so no rebuild is needed
  (restart the container if it seems cached).

### 2. Provide the IdP signing certificate

`passport-ubcshib` needs the IdP's public signing certificate to validate SAML responses. With the IdP running, fetch it:

```bash
npm run saml:fetch-cert   # writes ./server/certs/idp.pem from the IdP metadata
```

Alternatively, copy `docker-simple-saml/cert/server.crt` to `./server/certs/idp.pem`. The `server/certs/` directory is git-ignored; every developer generates their own.

### Logging in

1. Click "Log in with CWL" (or visit `/auth/ubcshib`).
2. SimpleSAMLphp shows its login page. Use a test user, e.g. `faculty:faculty`, `student:student`, or `staff:staff` (full list in the docker-simple-saml `authsources.php`).
3. You are redirected back and a session (stored in MongoDB) is created; the page shows who you are signed in as. `/auth/logout` clears it.

Logout clears the local session; by default (`SAML_FORCE_AUTHN=true`) the next login re-prompts at the IdP (handy for switching test users) rather than silently reusing the IdP's SSO session. Set `SAML_FORCE_AUTHN=false` to keep cross-app SSO.

On `npm run dev`, the server verifies the IdP certificate is present before starting: it logs `SAML: IdP certificate found at ...` on success, or exits with guidance to run `npm run saml:fetch-cert` if it is missing.

See [server/src/components/auth/AGENTS.md](server/src/components/auth/AGENTS.md) for the full details, protecting routes with `ensureAuthenticated()`, and moving to STAGING / PRODUCTION.

### Troubleshooting

- "SAML IdP certificate not found" on startup → run `npm run saml:fetch-cert`.
- IdP error that the SP / issuer is unknown → your `SAML_ISSUER` does not match an
  SP entry in the IdP (see step 1).
- Redirected back to `/?login=failed` → usually a certificate mismatch (re-fetch the cert) or an ACS URL that does not match `SAML_CALLBACK_URL`.

## Vector search & RAG (Qdrant + GenAI)

The boilerplate ships a working Retrieval-Augmented Generation example built from five components: `qdrant` plus `genai/{document-parsing,chunking,embeddings,llm}`.

It is orchestrated in `server/src/services/rag.service.ts` and exposed at `/api/rag/*`, with a matching panel in the client. Everything RAG-related is labeled "EXAMPLE (safe to delete)".

### 1. Start Qdrant

Run a local Qdrant (default `http://localhost:6333`):

```bash
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

If you start Qdrant with an API key (`QDRANT_SERVICE_API_KEY=...`), set the same value as `QDRANT_API_KEY` in `.env`. Without it the client gets `Unauthorized` (even though the Qdrant root URL still answers an unauthenticated `curl`, which can look healthy — the `/collections` API is what needs the key).

### 2. Choose LLM + embedding providers

Configured entirely via `.env` (see `.env.example` for the full list):

| Concern | Vars | Default |
| --- | --- | --- |
| LLM | `LLM_PROVIDER`, `LLM_DEFAULT_MODEL`, `LLM_ENDPOINT`, `LLM_API_KEY` | Ollama, `ministral-3:latest`, `http://localhost:11434` |
| Embeddings | `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_MODEL` | Ollama, `nomic-embed-text` (768-dim) |

For the defaults, pull the models once:

```bash
ollama pull ministral-3        # chat
ollama pull nomic-embed-text   # embeddings
```

Provider notes:

- **LLM**: `ollama` | `openai` | `anthropic` | `ubc-llm-sandbox`. Set `LLM_API_KEY`
  for the hosted ones; set `LLM_ENDPOINT` for Ollama / the sandbox.
- **Embeddings**: `fastembed` (fully local, self-contained, 384-dim) or an LLM
  provider name that also serves embeddings (reuses `LLM_ENDPOINT` / `LLM_API_KEY`).
- The embedding **dimension must equal the Qdrant collection's vector size**. The
  RAG service derives the size from the model at runtime, so they can't drift; but
  if you switch to a different-dimension model, delete the old collection (or use
  a new `QDRANT_COLLECTION`).
- Prefer a **non-thinking** chat model. Thinking models (`qwen3`, `gemma3/4`,
  `gpt-oss`, ...) can return empty content unless given a large `maxTokens`.

### 3. Try it

On the **RAG search** page (after logging in): paste text or upload a file (PDF/DOCX/PPTX/HTML/MD) to ingest, then ask a question. The `/api/rag/*` endpoints are **auth-gated**, so the `curl` calls below need a logged-in session cookie (easiest is to use the browser page; or temporarily remove the `ensureApiAuthenticated()` guard in `server/src/routes/rag.routes.ts` for quick API testing):

```bash
# ingest text
curl -X POST http://localhost:6118/api/rag/ingest \
  -H 'Content-Type: application/json' \
  -d '{"text":"UBC was established in 1908 in British Columbia.","sourceId":"ubc-facts"}'

# ingest a file
curl -X POST http://localhost:6118/api/rag/ingest-file -F file=@/path/to/doc.pdf

# ask
curl -X POST http://localhost:6118/api/rag/query \
  -H 'Content-Type: application/json' -d '{"question":"When was UBC established?"}'
```

To remove the example, delete `services/rag.service.ts`, `routes/rag.routes.ts`, their client counterparts, and the `ragRouter` line in `server/src/app.ts`.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run server (watch) and client (`tsc --watch`) in parallel. |
| `npm run build` | Compile server to `server/dist` and client to `client/public/js`. |
| `npm start` | Run the compiled server. |
| `npm run typecheck` | Type-check both projects without emitting. |
| `npm run saml:fetch-cert` | Fetch the local IdP signing certificate to `server/certs/idp.pem`. |
| `npm test` | Run the unit + integration tests (Jest; no services needed). |
| `npm run test:e2e` | Run the Playwright browser tests (needs MongoDB + IdP). |
| `npm run test:a11y` | Run the axe accessibility scans. |

## Testing

The boilerplate ships a testing setup you can copy from, in three layers (see [tests/AGENTS.md](tests/AGENTS.md) for the full guide):

- **Unit + integration** — Jest + ts-jest + supertest (`tests/unit`). Pure functions, services with their components mocked (so RAG is tested without Ollama/Qdrant), and routers driven over HTTP (including the gated ones → `401`/`200`). Fast and dependency-free: `npm test`. Coverage report: `npm run test:unit:monocart` → `coverage-reports/unit-monocart/index.html`.
- **End-to-end** — Playwright in Chromium (`tests/e2e`). Drives the real app: the landing screen, a **real CWL login** (performed once in a global-setup and reused), gated navigation, and Notes CRUD. `npm run test:e2e` (then `npm run test:report` to open the HTML report).
- **Accessibility** — `@axe-core/playwright` (`tests/a11y`). Scans key pages for WCAG A/AA violations: `npm run test:a11y`.

The e2e + a11y suites need **MongoDB + the SAML IdP** running and the IdP certificate present (they boot the real app); install the browser once with `npx playwright install chromium`. Unit tests need nothing extra.

## License

GPL-2.0-only
