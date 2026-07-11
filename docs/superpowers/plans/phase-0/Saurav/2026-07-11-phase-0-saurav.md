# Phase 0 — Foundations — Saurav (Dev B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Saurav's** personal plan: the Dev B (data/contracts arc) slice of the
core phase document
[`../2026-07-11-phase-0-foundations.md`](../2026-07-11-phase-0-foundations.md).
Task numbers match the core document. Tasks 1, 2, 3, 6, 7, 8, 12 belong to
**Stephen (Dev A)** and are not in this plan — never start or edit them; see
"Coordination with Stephen" below for where they block or need Saurav's work.

**Goal:** Saurav's half of the walking skeleton: the shared domain types and
publication state machine, typed MongoDB collections + indexes, the KaTeX +
Markdown client render utility, the Phase-1 REST API contract, and the toolkit
ingestion spike proving parse → chunk → embed → Qdrant with pinned versions.

**Architecture:** Extend the existing TLEF boilerplate (Express + plain-TS
client + components pattern). Domain types live in `server/src/types/domain.ts`
as the single source of truth; collection access is centralized in
`server/src/components/mongodb/collections.ts`. The API contract
(`docs/api-contract.md`) is the coordination artifact between the two arcs.

**Tech Stack:** Node 18+, TypeScript strict, MongoDB native driver, Qdrant,
ubc-genai-toolkit-* (pinned exact), Jest + ts-jest, KaTeX + marked + DOMPurify
(vendored, no bundler).

## Global Constraints

- TypeScript `strict` mode everywhere; shared options in `tsconfig.base.json`; server compiles to CommonJS, client is native ES modules (imports use explicit `.js` extension).
- Node.js 18+ single runtime.
- Read environment variables **only** in `server/src/config/env.ts`; every new variable is also added to `.env.example` with a comment.
- Each external integration lives in `server/src/components/<name>/` with `index.ts` + `AGENTS.md`; routes delegate to services; services compose components.
- `ubc-genai-toolkit-*` packages are pre-1.0: **pin exact versions** (no `^`) — done by Stephen's Task 1, which merges before anything else.
- No email channel anywhere. No local password auth — CWL only.
- Client has no bundler: third-party browser libs are vendored into `client/public/vendor/` and loaded via `<script>`/`<link>` tags.
- Follow the per-folder `AGENTS.md` closest to any file you edit.
- Shared-file convention (root `AGENTS.md`): `package.json`, `server/src/server.ts`, `.env.example`, `client/public/index.html` are **append-only, one line/block per addition** — never reorder or reformat surrounding lines.

## Task order and coordination with Stephen (Dev A)

**Saurav's ordering:** wait for Stephen's Task 1 on `main` → Task 4 → Task 5 →
Task 9 and Task 10 (parallel-safe) → Task 11 (needs Stephen's Task 2 docker
stack on `main`) → Task 13 (joint, with Stephen).

**Cross-developer dependencies:**

| Dependency | Direction | Effect |
|---|---|---|
| Stephen's Task 1 (pin deps) | Stephen → everyone | Nothing branches until Task 1 is on `main`. Task 9's katex/marked/dompurify and Task 5's typecheck rely on it. |
| Stephen's Task 2 (docker stack) | Stephen → Task 11 | The ingestion spike needs Qdrant from the compose stack. If blocked, do Tasks 9/10 first. |
| Task 4 (domain types) | Saurav → Stephen's Task 7 | `User` type + `usersCol()` (Task 5) must exist before Stephen's users service. **Merge Tasks 4/5 early — Stephen is blocked on them.** |
| Task 5 (collections) | Saurav → Stephen's Task 7 | Same as above. |

**Sync points (pause and involve Stephen before merging/proceeding):**
1. **Task 4 (domain types)** — Stephen reviews the PR before merge; this is the shared vocabulary.
2. **Task 10 (API contract)** — explicitly a two-developer PR review; Stephen must approve.
3. **Task 13 (walking skeleton)** — joint exit test with Stephen, run on both machines from a fresh clone. Stephen owns the spec (his plan, Task 13); Saurav's share is running the fresh-clone verification and fixing anything in Dev B files it surfaces.

**Workflow:** run `npm run sync-plans -- Saurav` before and after each work
session; keep the checkboxes in this file updated as tasks merge.

## Non-dev checklist (Saurav — do not skip; no code)

- [ ] **PSD reconciliation ping:** ask Stephen/confirm with the team on the PSD "RAG generation fallback" vs the PRD's Approved-only serving (§9.1). Needs an answer before Phase 1 ends; default to Approved-only.

---

### Task 4: Shared domain types

**Sync point:** Stephen reviews this PR before merge.

**Files:**
- Create: `server/src/types/domain.ts`
- Test: `tests/unit/domain-types.test.ts`

**Interfaces:**
- Consumes: `ObjectId` from `mongodb`.
- Produces: every domain type below, imported by all later tasks/phases exactly as named. Notably: `OptionRole`, `QuestionType`, `MasteryStatus`, `PublicationState`, `FlagState`, `PracticeMode`, `FeedbackStrategy`, `Difficulty`, `CourseRole`, and document interfaces `User`, `Course`, `Theme`, `LearningObjective`, `Question`, `QuestionVersion`, `AttemptRecord`, `Material`, `MasteryProfile`, `ReviewBookEntry`, `ExamTemplate`, `ExamAttempt`, `Flag`, `Notification`, `AuditLog`, `RosterEntry`. Also runtime constant `PUBLICATION_TRANSITIONS` and helper `canTransition(from, to)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/domain-types.test.ts` exactly as specified in the core
document, Task 4 Step 1 (the publication-state-machine test: forward pipeline
path, pause/resolution paths, reject-to-draft, archived reachable from every
state, restore-to-draft-only, forbidden moves).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/domain-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/src/types/domain.ts`**

Use the complete file from the core document, Task 4 Step 3 (types +
interfaces + `PUBLICATION_TRANSITIONS` + `canTransition`). Do not rename
anything — Phase 1 tasks (both arcs) import these names verbatim.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/domain-types.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit and open the sync-point PR**

```bash
git add server/src/types/domain.ts tests/unit/domain-types.test.ts
git commit -m "feat: shared domain types and publication state machine (PRD §2 data model)"
```

**Pause:** request Stephen's review; merge only after his approval.

---

### Task 5: Typed MongoDB collections and indexes

Requires Task 4 merged.

**Files:**
- Create: `server/src/components/mongodb/collections.ts`
- Modify: `server/src/server.ts` (call `ensureIndexes()` after `connectMongo()` — append-only, one line)
- Test: `tests/unit/collections.test.ts`

**Interfaces:**
- Consumes: `getDb()` from `server/src/components/mongodb`; all interfaces from `server/src/types/domain.ts` (Task 4).
- Produces: typed accessors used by every later service — `usersCol()`, `coursesCol()`, `themesCol()`, `losCol()`, `questionsCol()`, `questionVersionsCol()`, `attemptsCol()`, `materialsCol()`, `masteryCol()`, `reviewBookCol()`, `examTemplatesCol()`, `examAttemptsCol()`, `flagsCol()`, `notificationsCol()`, `auditCol()`, `rosterCol()` — each returning `Collection<T>` of the matching domain type; `ensureIndexes(): Promise<void>`; exported `INDEX_SPECS` for testability. **Stephen's Task 7 consumes `usersCol()` — merge promptly.**

- [ ] **Step 1: Write the failing test** — `tests/unit/collections.test.ts` exactly as in the core document, Task 5 Step 1 (identity/enrollment uniqueness, one-version-per-question and one-review-book-entry uniqueness, hot attempt-record/serving-path indexes).
- [ ] **Step 2: Run test to verify it fails** — `npx jest tests/unit/collections.test.ts` → FAIL (module not found).
- [ ] **Step 3: Write `server/src/components/mongodb/collections.ts`** — the complete file from the core document, Task 5 Step 3 (16 accessors + `INDEX_SPECS` + idempotent `ensureIndexes`).
- [ ] **Step 4: Wire into startup** — in `server/src/server.ts`, after `connectMongo()`: `await ensureIndexes();` plus the log line. Append-only edit.
- [ ] **Step 5: Run tests to verify they pass** — `npx jest tests/unit/collections.test.ts && npm run typecheck` → PASS. With docker up, `npm run dev` once and confirm the "indexes ensured" log.
- [ ] **Step 6: Commit**

```bash
git add server/src/components/mongodb/collections.ts server/src/server.ts tests/unit/collections.test.ts
git commit -m "feat: typed MongoDB collection accessors and startup index creation"
```

---

### Task 9: KaTeX + Markdown client render utility

Requires Stephen's Task 1 merged (katex/marked/dompurify in `package.json`).

**Files:**
- Create: `scripts/vendor-client-libs.mjs`
- Create: `client/src/render.ts`
- Modify: `client/public/index.html` (vendor script/link tags — append-only)
- Modify: `package.json` (`vendor` script; hook into `build`/`postinstall` — append-only lines)
- Modify: `.gitignore` (ignore `client/public/vendor/`)

**Interfaces:**
- Consumes: `katex`, `marked`, `dompurify` npm packages (Stephen's Task 1).
- Produces: `renderRichText(target: HTMLElement, markdown: string): void` — renders markdown (sanitized) with `$...$` / `$$...$$` KaTeX math. Used by every question/feedback/explanation view in Phases 1–3 (both arcs).

- [ ] **Step 1: Write `scripts/vendor-client-libs.mjs`** — the complete script from the core document, Task 9 Step 1 (copies katex js/css/auto-render/fonts, marked, purify into `client/public/vendor/`).
- [ ] **Step 2: Wire into `package.json` and `.gitignore`** — add `"vendor"` + `"postinstall"` scripts and prepend `vendor` to `build`; gitignore `client/public/vendor/`; run `npm run vendor` and confirm the files exist.
- [ ] **Step 3: Load vendor libs in `client/public/index.html`** — the `<link>`/`<script defer>` block from the core document, Task 9 Step 3, added in `<head>` before the app module script.
- [ ] **Step 4: Write `client/src/render.ts`** — the complete file from the core document, Task 9 Step 4 (`declare` the vendored globals; `renderRichText` = DOMPurify-sanitized `marked.parse` + `renderMathInElement` with `$`/`$$` delimiters, `throwOnError: false`).
- [ ] **Step 5: Verify visually** — temporary fixture with a PV formula + markdown table in the home view; confirm KaTeX typesets and the table renders; remove the fixture; `npm run typecheck` → PASS.
- [ ] **Step 6: Commit**

```bash
git add scripts/vendor-client-libs.mjs client/src/render.ts client/public/index.html package.json .gitignore
git commit -m "feat: vendored KaTeX/marked/DOMPurify and renderRichText client utility"
```

---

### Task 10: REST API contract document

**Sync point:** two-developer PR review required before merge.

**Files:**
- Create: `docs/api-contract.md`

**Interfaces:**
- Consumes: domain types (Task 4).
- Produces: the coordination artifact between the two developer arcs. Changes go through PR review only. Phase 1 implements exactly these endpoints.

- [ ] **Step 1: Write `docs/api-contract.md`** — the complete contract from the core document, Task 10 Step 1: error format + status codes, auth guards vocabulary, and the endpoint sections (Auth, Enrollment, Courses, Hierarchy, Materials, Question bank, Practice, Review Book, Health) with their exact request/response shapes. Shapes are normative — Stephen's student-arc client and Saurav's instructor-arc routes both code against this file.
- [ ] **Step 2: Open the PR; both developers review** — Stephen must approve before merge. Subsequent contract changes go through PR review, never ad hoc.
- [ ] **Step 3: Commit**

```bash
git add docs/api-contract.md
git commit -m "docs: Phase-1 REST API contract (coordination artifact)"
```

---

### Task 11: Toolkit ingestion spike — parse → chunk → embed → Qdrant

Requires Stephen's Tasks 1 (pinned versions) and 2 (docker stack) merged.

**Files:**
- Create: `scripts/ingest-spike.ts`
- Create: `tests/fixtures/sample-material.md`
- Modify: `package.json` (script `spike:ingest` — append-only line)

**Interfaces:**
- Consumes: existing `server/src/components/genai/*` wrappers and `server/src/components/qdrant`.
- Produces: proof that the pinned toolkit versions handle the full ingestion path; any incompatibilities discovered now get shims inside the affected `components/genai/*` module (budgeted, PRD §11) rather than surprising the Phase-1 RAG work.

- [ ] **Step 1: Create the fixture** — `tests/fixtures/sample-material.md`, the time-value-of-money content from the core document, Task 11 Step 1 (PV formula, annuities, perpetuities sections).
- [ ] **Step 2: Write `scripts/ingest-spike.ts`** — the complete script from the core document, Task 11 Step 2: parse fixture → chunk → embed → `ensureCollection`/`upsertPoints` on a `spike-course` collection → embed a perpetuity query → search top 3 → assert the top hit mentions perpetuities → exit non-zero on failure. Check the actual exported names in each `components/genai/*/index.ts` and `components/qdrant/index.ts` before running; adjust imports, not the flow.
- [ ] **Step 3: Add the script and run it** — `"spike:ingest": "tsx scripts/ingest-spike.ts"`; then `docker compose up -d && npm run spike:ingest` → the four `[spike]` progress lines and final `OK`. If a toolkit API mismatch surfaces (pre-1.0 churn), fix it inside the affected `components/genai/<module>/index.ts` wrapper (that is the shim point) and record the shim in that module's `AGENTS.md`.
- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-spike.ts tests/fixtures/sample-material.md package.json
git commit -m "feat: toolkit ingestion spike proving parse->chunk->embed->qdrant with pinned versions"
```

---

### Task 13 (joint): Walking skeleton E2E — Saurav's share

Stephen owns the spec (`tests/e2e/walking-skeleton.spec.ts`, his plan Task 13).
Saurav's share of the sync point:

- [ ] **Step 1: Fresh-clone verification on Saurav's machine**

```bash
docker compose up -d && npm ci && npm run saml:fetch-cert && npm run build
npm run test:e2e -- tests/e2e/walking-skeleton.spec.ts
```
Expected: PASS. Fix anything it surfaces in Dev B files (types, collections, vendor script); anything in Dev A files goes to Stephen, not fixed silently.

---

## Exit criteria checklist (Saurav's share of the phase exit)

- [ ] Domain types merged with Stephen's review (Task 4).
- [ ] Collections + indexes merged; Stephen's Task 7 unblocked (Task 5).
- [ ] `renderRichText` works in the browser (Task 9).
- [ ] API contract reviewed and merged by both developers (Task 10).
- [ ] Toolkit spike proves ingestion end-to-end; shims (if any) recorded (Task 11).
- [ ] Walking skeleton passes from a fresh clone on Saurav's machine (Task 13).
- [ ] PSD reconciliation pinged (non-dev checklist).
