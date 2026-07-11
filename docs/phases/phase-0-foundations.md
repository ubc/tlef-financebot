# Phase 0 — Foundations

**Window:** Jul 13 – Jul 24, 2026 (2 weeks, ~80 combined hours)
**Goal:** A walking skeleton both developers can build on: repo, dev environment, auth, data model, and an agreed API contract. Everything after this phase is parallel feature work; everything in this phase is coordination-heavy and must be done together.

## Entry criteria

- Boilerplate repo accessible to both devs.
- Both devs have Docker running locally.
- PRD v0.8 read by both devs (at minimum §2, §4.1, and the Data Model subsection).

## Workstreams

### WS-1 — Platform & Auth

- [ ] CI pipeline on the existing boilerplate: typecheck (strict mode), Jest, lint on every PR.
- [ ] `docker-compose.yml` for local backing services: MongoDB, Qdrant, mock SAML IdP (e.g., `kristophjunge/test-saml-idp`) — mirrors staging/production shape (PRD §2 Infrastructure).
- [ ] Typed config module: `MONGODB_URI`/`MONGODB_DB_NAME`, `SESSION_SECRET`, `QDRANT_*`, `SAML_*`, `LLM_PROVIDER`/`LLM_DEFAULT_MODEL`/per-step model vars, `EMBEDDINGS_*`, admin CWL allowlist, worker limits (PRD §2).
- [ ] Express skeleton: serves static client + `/api` routes; helmet, cors, rate limiting, request-validation middleware.
- [ ] Auth: Passport.js + `passport-ubcshib` + `express-session` with `connect-mongo`, wired to the mock IdP. Login flow per **ST-E01**: single "Log in with CWL" control, PUID → identity mapping on first login, no profile-creation step, clean failure handling.
- [ ] Client build pipeline: plain TS → tsc → static JS served by Express; KaTeX + Markdown rendering utility; role-appropriate home routing stub.

### WS-2 — Data model & contracts

- [ ] `tsconfig.base.json` with shared strict compiler options; server extends (CommonJS), client extends (ESM).
- [ ] Shared domain types on the server: Question, option roles (Correct Answer / Common Misconception / Partially Correct / Clearly Wrong-Implausible), mastery states (Not attempted / In progress / Covered / Struggling), publication states (Draft → Pending Review → TA/Instructor-reviewed → Approved → Paused → Archived), exam templates.
- [ ] MongoDB collections + indexes for: User (keyed by CWL PUID, per-course roles), Course, Theme, LearningObjective, Question, **QuestionVersion** (every edit = new version; Question points at current), **AttemptRecord** (the hub — pins User, QuestionVersion, served LO/Theme context, mode, active feedback strategy, randomized parameter values), Material, MasteryProfile, ReviewBookEntry, ExamTemplate, ExamAttempt, Flag, Notification, AuditLog (PRD §2 Data Model).
- [ ] REST API contract document (`docs/api-contract.md`): endpoints, request/response shapes, error format, for everything Phase 1 needs. This is the coordination artifact between the two arcs — changes go through PR review.
- [ ] `ubc-genai-toolkit-*` integration spike: install core/llm/embeddings/chunking/document-parsing, **pin exact versions**, prove one document parses → chunks → embeds → lands in Qdrant. Budget shim time (pre-1.0 packages, PRD §11).

### Joint / non-dev

- [ ] **Walking skeleton (joint exit test):** log in via mock CWL → session persists → role-appropriate course home renders.
- [ ] **PIA/DAR kickoff (non-dev, week 1):** initiate the CWL Privacy Impact Assessment / Data Access Request with UBC IAM (PRD §4.1, §11 — on the critical path to launch, runs on IAM's timeline).
- [ ] Reconciliation ping to Saurav/Stephen on PSD "RAG generation fallback" vs PRD Approved-only serving (§9.1) — needs an answer before Phase 1 ends.

## Exit criteria

- Walking skeleton works on both devs' machines from a fresh clone (`docker compose up` + documented steps).
- CI green: typecheck strict, tests, lint.
- API contract reviewed and merged by both devs.
- Toolkit spike proves ingestion path end-to-end; versions pinned.
- Unit/integration tests exist for auth flow (login success, failure/cancel, session restore — ST-E01) and config validation.

## What can slip

Nothing in this phase — it is the foundation for all parallel work. If Phase 0 runs over, take the time from Phase 1 and apply Phase 1's slip guidance, rather than starting Phase 1 on an unstable base.
