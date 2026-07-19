# Phase 1 — Core Loop — Saurav (Dev B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Progress tracking (do this, it is not automatic):** the moment a task's review comes back clean and its commit is made, edit this file to change that task's `- [ ]` to `- [x]`, then commit the checkbox change and push. Also mirror the checkbox into the core document [`../2026-07-11-phase-1-core-loop.md`](../2026-07-11-phase-1-core-loop.md) so Stephen's agent sees it. Run `npm run sync-plans -- Saurav` after.

This is **Saurav's** personal plan: the Dev B (instructor / AI arc, WS-5/6 +
pipeline) slice of the core phase document
[`../2026-07-11-phase-1-core-loop.md`](../2026-07-11-phase-1-core-loop.md).
Task numbers match the core document. Tasks 3, 9, 10, 11, 12, 14 belong to
**Stephen (Dev A)** and are not in this plan — never start or edit them; see
"Coordination with Stephen" for where they block or need Saurav's work. Every
task step here references the core document for the full code/tests rather than
duplicating it — the core doc is the normative source; this plan is the Dev B
execution order and coordination layer.

**Goal:** Saurav's half of the core loop: the job queue, the full instructor
authoring surface (courses + hierarchy + roster + publish), question versioning
and the review queue, material upload with async RAG ingestion, LLM
classification, the three-agent generation pipeline, and the instructor client
views — such that an instructor can set up a course, upload materials, generate
questions with the three-agent pipeline, and approve them.

**Architecture:** All server work follows the boilerplate's routes → services →
components pattern, consuming the Phase-0 domain types
(`server/src/types/domain.ts`), collection accessors
(`components/mongodb/collections.ts`), `validate()` middleware, and the API
contract (`docs/api-contract.md`). Generation and ingestion run as Agenda
background jobs. Instructor client views are plain-TS hash-routed views using
`renderRichText` for question content. Serving reads **only** `state: 'approved'`
questions (proven by Dev A's Task 16 tests).

**Tech Stack:** as Phase 0, plus `agenda` (MongoDB-backed job queue), `nanoid@3`
(registration codes, CommonJS-compatible), `multer` (uploads), and the
`ubc-genai-toolkit-*` document-parsing / chunking / embeddings / llm components.

## Global Constraints

- Everything in the Phase 0 plan's Global Constraints section still applies (TypeScript `strict`; env only in `env.ts` + `.env.example`; components own external integrations; toolkit versions pinned exact; no email; CWL-only auth; client vendored libs, no bundler; follow the nearest `AGENTS.md`).
- Only Approved questions are ever served to students; Themes/LOs with zero Approved questions are hidden from students (PRD §9.1). No fallback to unreviewed content, ever. The generation pipeline **never** publishes — output always enters as Draft.
- Every question edit creates a new `QuestionVersion`; prior versions are never mutated or deleted (PRD §2).
- Publication-state changes must be immediately visible to serving (no caching of question state).
- All new endpoints match `docs/api-contract.md`; contract changes go through two-developer PR review first.
- New env vars go in `env.ts` + `.env.example` only.
- Shared-file convention (root `AGENTS.md`): `package.json`, `server/src/server.ts`, `server/src/app.ts`, `.env.example`, `client/public/index.html` are **append-only, one line/block per addition** — never reorder or reformat surrounding lines.
- Mid-phase checkpoint (~Aug 2): one instructor-generated, approved question served to a student end-to-end (Task 8 Step 5).

## Saurav's task order (Dev B)

Recommended sequence, with the parallel-safe pairs marked:

1. **Task 1** (jobs component) — foundational; unblocks Tasks 6 and 8. No cross-dependency, do first.
2. **Task 2** (courses service/routes) **and Task 4** (questions service) — parallel-safe, and **both are front-loaded because Dev A is blocked on them** (see the dependency table). Get them reviewed and merged early.
3. **Task 5** (bank routes) — needs Task 4.
4. **Task 6** (materials + ingestion) — needs Task 1.
5. **Task 7** (LLM classification) — needs Task 6 (modifies its routes).
6. **Task 8** (three-agent generation pipeline) — needs Tasks 1, 4, 6. **Step 5 is the ~Aug 2 mid-phase checkpoint (joint).**
7. **Task 15** (instructor client views) — needs Tasks 2, 5, 6, 7, 8.
8. **Task 13** (Layer-2 mastery evaluator) — *"either" owner; pick up only if ahead of Stephen and after coordinating (it modifies his `attempts.service.ts`).* Slip candidate — Layer-1 statuses stand alone.
9. **Task 16** (joint exit) — Saurav's share of the phase exit demo + Approved-only proof.

## Coordination with Stephen (Dev A)

**Cross-developer dependencies:**

| Dependency | Direction | Effect |
|---|---|---|
| **Task 2 (courses)** | Saurav → Stephen's Task 3 | Enrollment (ST-E02) needs a published course with a registration code and roster. Stephen can seed via direct Mongo inserts, but **merge Task 2 early** so he codes against the real service. |
| **Task 4 (questions service)** | Saurav → Stephen's Tasks 10/11/14 | Selection, attempts, and student views all need **Approved questions** that do not exist until Dev B's UI does. Provide seeding via `createQuestion` + `transitionQuestion` (draft → … → approved) — merge Task 4 early and give Stephen a short seed snippet/script so he never waits on Task 15. |
| **Task 9 (mastery, Dev A)** | Stephen → nobody in Dev B | Task 8 does **not** consume mastery. No blocking, but review the Task 9 `Produces` block at the week-1 sync point (shared vocabulary). |
| **`docs/api-contract.md`** | either → both | Any change is a two-developer PR review, never ad hoc. Both arcs code against it. |

**Test-data note (from the core doc):** Dev A's tasks need Approved questions
before Saurav's instructor UI (Task 15) exists — so make seeding easy from Task 4
onward; don't make Stephen wait for Task 15.

**Sync points (pause and involve Stephen):**
1. **Week 1** — confirm the selection↔mastery interface (`getMasteryTier`, `recordAttemptInMastery`, Task 9 Produces block) across the arcs before Stephen's Tasks 10/11 begin. Saurav reviews; Stephen owns.
2. **~Aug 2 mid-phase checkpoint (Task 8 Step 5)** — one instructor-generated, approved question served to a student end-to-end; **both developers verify.** Saurav drives the generation side.
3. **Any change to `docs/api-contract.md`** — two-developer PR review.
4. **Task 16 (exit demo)** — joint; both developers participate.

**Workflow:** run `npm run sync-plans -- Saurav` before and after each work
session; keep the checkboxes in this file (and mirrored in the core doc) honest
against `git log`.

---

### Task 1: Job queue component (Agenda)

**Files:**
- Create: `server/src/components/jobs/index.ts`, `server/src/components/jobs/AGENTS.md`
- Modify: `server/src/server.ts` (append `await startJobs();` after `ensureIndexes()`)
- Modify: `package.json` (add `agenda`, `nanoid@3` — v3 is CommonJS-compatible)
- Test: `tests/unit/jobs.component.test.ts`

**Interfaces:**
- Consumes: `env` (`mongodbUri`, `mongodbDbName`). **Note (post-implementation):** agenda@4 needs mongodb@4 result shapes its job-locking relies on (`findOneAndUpdate(...).value`), which the repo's top-level mongodb@7 driver no longer returns — so the component opens its OWN connection via agenda's bundled mongodb@4 driver (`db: { address }`) rather than sharing `getMongoClient()`. See `server/src/components/jobs/AGENTS.md`.
- Produces: `startJobs()`, `stopJobs()`, `defineJob<T>(name, handler)`, `enqueueJob<T>(name, data)`, `scheduleRecurring(name, interval)`. Used by ingestion (Task 6), generation (Task 8), the Layer-2 evaluator (Task 13), and later phases.

- [x] **Step 1: Install** — `npm install agenda nanoid@3` → exit 0.
- [x] **Step 2: Write the failing test** — `tests/unit/jobs.component.test.ts` exactly as in the core document, Task 1 Step 2 (mock `agenda` + mongodb; assert register/enqueue delegate without throwing, and that `enqueueJob` before `startJobs` rejects with a `/startJobs/` message).
- [x] **Step 3: Run test to verify it fails** — `npx jest tests/unit/jobs.component.test.ts` → FAIL (module not found).
- [x] **Step 4: Implement** `server/src/components/jobs/index.ts` — the complete file from the core document, Task 1 Step 4 (one Agenda instance per process, `requireAgenda()` guard, `defineJob`/`enqueueJob`/`scheduleRecurring`/`stopJobs`). Append `await startJobs();` after `ensureIndexes()` in `server.ts`. Write the 3–6 line `AGENTS.md` (job handlers live next to the service that owns them).
- [x] **Step 5: Run tests** — `npx jest tests/unit/jobs.component.test.ts && npm run typecheck` → PASS.
- [x] **Step 6: Commit** — `git commit -m "feat: agenda-backed jobs component"`

---

### Task 2: Courses service — creation, hierarchy CRUD, term dates, registration code, publish (IN-S01, IN-S02, IN-S03, IN-L06)

**Front-load this — Stephen's Task 3 (enrollment) depends on it.**

**Files:**
- Create: `server/src/services/courses.service.ts`, `server/src/routes/courses.routes.ts`, `server/src/components/auth/course-guards.ts`
- Modify: `server/src/app.ts` (mount router — append-only)
- Test: `tests/unit/courses.service.test.ts`, `tests/unit/courses.routes.test.ts`

**Interfaces:**
- Consumes: `coursesCol()`, `themesCol()`, `losCol()`, `questionsCol()`, `rosterCol()`, `usersCol()`; `nanoid`; domain types.
- Produces (service): `createCourse`, `updateCourse` (rejects `termEnd <= termStart` with `Error('term-end-before-start')`), `regenerateRegistrationCode`, `addTheme`/`updateTheme`/`archiveTheme` + the LO trio, `getCourseTree`, `duplicateNameWarning`, `publishChecklist`, `setPublished` (publish allowed with warnings — IN-L06), `putRoster`/`getRoster`. Full signatures and the `createCourse`/`publishChecklist` excerpts are in the core document, Task 2 Interfaces + Step 3.
  **Note (post-implementation) — three deviations from the above; `STATUS.md` in this folder has the full rationale:**
  1. **`archiveTheme(themeId)` cascades** `archivedAt` to the theme's live LOs (one shared timestamp; already-archived LOs keep their original). Without the cascade, archiving a theme hid its LOs from `getCourseTree` (which joins LOs to live themes only) while `publishChecklist` — whose excerpt queries LOs by `{ courseId, archivedAt: { $exists: false } }`, i.e. by course, not by live theme — kept counting them as thin forever, with no route to archive them. `publishChecklist` is unchanged from the core document's excerpt; the cascade is what makes its query correct.
  2. **`putRoster(courseId, identifiers)` reconciles, it does not replace.** The literal delete-then-insert this plan described wiped every instructor-granted `RosterEntry.extendedUntil` (IN-S02) on each re-upload. It now deletes only identifiers absent from the new list (`$nin`) and upserts survivors with `$setOnInsert`, preserving `extendedUntil` and the original `addedAt`. Normalization (trim/lower-case/dedupe), the empty-list clear, and the returned count are unchanged.
  3. **Three functions exist beyond this list:** `getCourse` (plain course — `PATCH /api/courses/:courseId` must return `Course`, not the `getCourseTree` shape) and `getThemeCourseId`/`getLoCourseId` (Theme/LO routes carry no `:courseId`, and `server/src/routes/AGENTS.md` forbids DB calls in a route, so the owning-course lookup lives in the service).
  Also note **`duplicateNameWarning` has no route and no endpoint in `docs/api-contract.md`** — Task 15 needs the non-blocking duplicate-name warning and must either add an endpoint (a contract change ⇒ two-developer review) or derive it client-side from the course tree, which already carries every theme/LO name.
- Produces (guards): `ensureCourseInstructor()`, `ensureCourseStudent()`, `ensureCourseTa()` — the complete `course-guards.ts` is in the core document, Task 2 Step 4 (401 unauthenticated; 403 unless a matching `courseRoles` entry or `isAdmin`; resolves `courseId` from route param or `res.locals.courseId`).
- Produces (routes): every Courses/Hierarchy/Roster endpoint exactly as in `docs/api-contract.md`.
  **Note (post-implementation):** the router also mounts a **router-scoped error-normalizing middleware** that maps the service's plain `Error('course-not-found' | 'theme-not-found' | 'lo-not-found' | 'term-end-before-start')` to 404/400 JSON (the core document's service excerpts throw plain `Error(message)` with no `.status`, so the mapping has to live in the HTTP layer to keep the service a pure data layer); anything else falls through to the central `errorHandler`. `PATCH /api/courses/:courseId` accepts `published` per the contract even though `updateCourse()`'s signature does not own it — the route splits it out and calls `setPublished()` separately.

- [x] **Step 1: Write the failing service tests** — `tests/unit/courses.service.test.ts`, the five `it()` blocks specified in the core document, Task 2 Step 1 (createCourse defaults + owner `$addToSet`; updateCourse term-order rejection; addTheme `order = max+1`; publishChecklist thin-LO `ok:false` but publish still allowed; putRoster lower-case/dedupe). Mock `collections` like `users.service.test.ts`.
- [x] **Step 2: Run tests to verify they fail** — `npx jest tests/unit/courses.service.test.ts` → FAIL.
- [x] **Step 3: Implement the service** — `courses.service.ts`, full file per the core document, Task 2 Step 3.
- [x] **Step 4: Implement the guards** — `course-guards.ts`, full file per the core document, Task 2 Step 4.
- [x] **Step 5: Implement the routes** — `courses.routes.ts` with `validate()` zod schemas (ObjectId params `z.string().regex(/^[0-9a-f]{24}$/)`); instructor endpoints use `ensureCourseInstructor()`; `POST /api/courses` uses `ensureApiAuthenticated()`. Mount `app.use('/api', coursesRouter);` in `app.ts` (append-only).
  **Note (post-implementation):** the five **Theme/LO-scoped routes also use `ensureApiAuthenticated()`**, placed *before* the middleware that stashes the owning `courseId` on `res.locals`. Those routes have no `:courseId` param, so they resolve the course with a DB lookup — which ran before any auth, letting a signed-out caller trigger a Mongo read and distinguish an existing theme/LO id (reached the guard → 401) from a nonexistent one (→ 404). Final order: `validate(params)` → `ensureApiAuthenticated()` → stash → `ensureCourseInstructor()` → `validate(body)`. This is additive — `ensureCourseInstructor` keeps its own 401 check.
- [x] **Step 6: Write the failing route tests, then make them pass** — `tests/unit/courses.routes.test.ts` per the core document, Task 2 Step 6 (401 signed out; 403 non-instructor PATCH; 201 create; 400 invalid body; publish returns `{ published, checklist }`). Run: `npx jest tests/unit/courses.routes.test.ts tests/unit/courses.service.test.ts && npm run typecheck` → PASS.
- [x] **Step 7: Commit** — `git commit -m "feat: courses service and routes — hierarchy CRUD, term dates, registration code, publish checklist (IN-S01/S02/S03, IN-L06)"`

> **After merge:** ping Stephen — his Task 3 can now code against the real course/roster/registration-code shapes.

---

### Task 4: Question service — versioning, publication transitions, tagging (IN-Q03, IN-Q04, IN-Q07, IN-Q13)

**Front-load this — Stephen's Tasks 10/11/14 need Approved questions to exist.**

**Files:**
- Create: `server/src/services/questions.service.ts`
- Test: `tests/unit/questions.service.test.ts`

**Interfaces:**
- Consumes: `questionsCol()`, `questionVersionsCol()`, `auditCol()`; `canTransition`, domain types.
- Produces: `createQuestion` (inserts Question `state:'draft'` + QuestionVersion v1), `editQuestion` (copies current version, applies patch, inserts `version: n+1`, updates head, records `editedFields`, adds `manually-edited` label), `transitionQuestion` (validates with `canTransition`, throws `Error('invalid-transition:<from>-><to>')`, writes an AuditLog `question.transition`), `bulkTransition` (skips invalid, returns updated count). MCQ invariants (exactly 4 options / 2 for true-false; exactly one `correct`; T/F distractor coerced to `common-misconception`) throw `Error('invalid-options:<reason>')`. Full signatures + the `assertOptionInvariants`/`transitionQuestion` excerpts and the `editQuestion` recipe are in the core document, Task 4 Interfaces + Step 3.
  **Note (post-implementation) — five deviations from the above; `STATUS.md` in this folder has the full rationale:**
  1. **`editQuestion` does not version or label a tagging-only patch.** The recipe's unconditional `insert n+1` + `$addToSet` meant an IN-Q13 retag (`{ loIds }`, no content change) inserted a content-identical v2 and stamped the question `manually-edited` — a question nobody had edited. Now: if no content key (`stem`/`options`/`difficulty`/`paramSlots`) is patched, it updates the head's `loIds`/`themeIds` only, inserts no version, adds no label, and returns the current version. Option validation still runs inside the content branch, so a bad-options patch throws before any early return. **Content-bearing edits are byte-identical to this plan** — the append-only guarantee (PRD §2) is untouched.
  2. **`editedFields` is per-edit, and `domain.ts:128`'s docstring was reworded to match.** The docstring said "fields manually changed vs the generated original", which reads cumulative; this plan says "patched content keys", which is per-edit. The plan governs — the cumulative divergence set is the union of `editedFields` across the version chain, so nothing is lost; only reading one version in isolation is weaker. The docstring now says exactly that.
  3. **`transitionQuestion` hoists a single `const now`.** The core document's excerpt returns `{ ...question, state: to }`, which carries the *pre-update* `updatedAt` while the DB got a fresh `new Date()` — Task 5's routes will echo this return straight to the client.
  4. **`bulkTransition`'s catch is narrowed to the two domain errors** (`question-not-found`, `invalid-transition:*`) and rethrows everything else. "Skips invalid ones" implemented as a bare `catch {}` also swallowed infrastructure failures: a Mongo outage returned `0` (indistinguishable from "all invalid"), and an audit-insert failure after a successful state write left a question approved but unaudited.
  5. **`createQuestion` inserts the version before the head**, and `editQuestion` gained `question-not-found`/`version-not-found` guards (the plan left those paths silent). An orphan version is invisible to every query path; an orphan head is discoverable and points at a nonexistent `currentVersionId`. Both `_id`s are pre-generated, so the ordering is free — `Question.currentVersionId` and `QuestionVersion.questionId` are both required, so neither insert can go second without it.

- [x] **Step 1: Write the failing tests** — `tests/unit/questions.service.test.ts`, the four cases in the core document, Task 4 Step 1 (createQuestion draft+v1 and option-invariant throws + T/F coercion; editQuestion v2 with `editedFields:['stem']` + single `manually-edited`; transition allows `pending-review → approved`, rejects `draft → approved` with no write + audit on success; bulkTransition valid-count).
- [x] **Step 2: Run tests to verify they fail** — `npx jest tests/unit/questions.service.test.ts` → FAIL. **Caveat:** the RED phase was a `TS2307: Cannot find module` compile failure (`Tests: 0 total`), not observed per-assertion failures — so the tests were never seen failing for the *right* reason. Reviewer judged them sound on inspection; noted because it is a real gap in the TDD evidence, not a clean RED.
- [x] **Step 3: Implement** `questions.service.ts` — full file per the core document, Task 4 Step 3.
- [x] **Step 4: Run tests** — `npx jest tests/unit/questions.service.test.ts && npm run typecheck` → PASS (17 service tests; full suite 85, typecheck + eslint clean).
- [x] **Step 5: Commit** — `git commit -m "feat: question versioning, option invariants, publication transitions with audit (IN-Q03/Q04/Q07)"`

> **After merge:** give Stephen a one-off seed snippet — `createQuestion(...)` then `transitionQuestion(id, 'pending-review'/'reviewed'/'approved', puid)` — so his selection/attempts/views work has Approved questions immediately.

---

### Task 5: Bank routes — browse/filter, review queue, editing, transitions (IN-Q02, IN-Q05, IN-Q08)

Requires Task 4 merged.

**Files:**
- Create: `server/src/services/bank.service.ts`, `server/src/routes/questions.routes.ts`
- Modify: `server/src/app.ts` (mount — append-only)
- Test: `tests/unit/bank.service.test.ts`, `tests/unit/questions.routes.test.ts`

**Interfaces:**
- Consumes: Task 4's service; `questionsCol()`, `questionVersionsCol()`, `flagsCol()`, `attemptsCol()`.
- Produces (service): `browseBank` (archived excluded unless `state:'archived'`/`includeArchived`; joins current versions via `$in` on `currentVersionId`) and `reviewQueue` (non-archived non-approved, ordered: student-flagged → `reviewed` → under-coverage, de-duped). Full signatures in the core document, Task 5 Interfaces.
- Produces (routes): `GET /api/courses/:courseId/questions`, `GET /api/questions/:questionId`, `PATCH /api/questions/:questionId`, `POST /api/questions/:questionId/transition`, `POST /api/questions/bulk-transition`, `GET /api/courses/:courseId/review-queue` — instructor-guarded; child-resource routes load the question first and stash `res.locals.courseId` **before** the guard (mount guard after a small loader middleware).
  **Note (post-implementation) — four deviations; `STATUS.md` in this folder has the full rationale:**
  1. **`POST /api/questions/bulk-transition` needs its own authorization rule — the stash-then-guard recipe above does not cover it.** That route has no `:courseId` and takes an **array** of ids that may span courses, while `ensureCourseInstructor()` resolves exactly ONE course (`course-guards.ts` `requestCourseId()`). Stashing "the question's courseId" (singular) would let an instructor of course A transition course B's questions by including their ids. Implemented: load the questions, collect the distinct `courseId`s of those found, and if that is **not exactly one → 403**; otherwise stash it and guard normally. 403 rather than 400 so the endpoint isn't an existence oracle.
  2. **The span-check 403 returns the guard's own body**, via a frozen `NO_COURSE_ACCESS_BODY` exported from `course-guards.ts`, so it is indistinguishable from `ensureCourseInstructor()`'s 403 in status, body, headers, and timing. (Otherwise a one-id request revealed whether that id existed, undercutting the point of 403.)
  3. **`includeArchived` is a service parameter only, not a query param.** `docs/api-contract.md:47` lists only `state/loId/themeId/type/difficulty/label`, and the contract governs the HTTP surface. Nothing is lost — `state=archived` still reaches archived questions. `browseBank`'s signature keeps it for Task 15.
  4. **`flagsCol()`/`attemptsCol()` are NOT consumed** despite the Consumes line above. The review-queue ordering as specified (student-flagged label → `reviewed` state → under-coverage by approved count) needs neither. They were not imported.
  Also: the route maps the head's `_id` → **`id`** per the contract, while an embedded `current: QuestionVersion` serializes raw with its own `_id`. **That split is deliberate** — Question heads are `id`, QuestionVersions are raw — which is why `PATCH` returning a raw `QuestionVersion` is correct and should not be "fixed".

- [x] **Step 1: Write failing tests** — per the core document, Task 5 Step 1 (`bank.service.test.ts`: state filter is strictly publication states with `student-flagged` as a separate label filter, archived hidden by default, review-queue ordering flagged→reviewed→new; `questions.routes.test.ts`: 403 student on instructor routes, `transition` route 409 with the service's `invalid-transition` message, PATCH validates options shape via zod).
- [x] **Step 2: Run tests to verify they fail** — `npx jest tests/unit/bank.service.test.ts tests/unit/questions.routes.test.ts` → FAIL.
- [x] **Step 3: Implement** service + routes per the Interfaces; mount in `app.ts`.
- [x] **Step 4: Run tests** — same command `&& npm run typecheck` → PASS.
- [x] **Step 5: Commit** — `git commit -m "feat: question bank browse/filter and prioritized review queue (IN-Q02/Q05/Q08)"`

---

### Task 6: Material upload + RAG ingestion (IN-S04)

Requires Task 1 (jobs) merged.

**Files:**
- Create: `server/src/services/materials.service.ts`, `server/src/routes/materials.routes.ts`
- Modify: `server/src/app.ts` (mount — append-only); `server/src/components/qdrant/index.ts` (if `ensureCollection`/`upsertPoints`/`search` don't take a collection-name arg, add it); `.gitignore` (`uploads/`)
- Test: `tests/unit/materials.service.test.ts`

**Interfaces:**
- Consumes: `multer` (disk storage under `uploads/`), genai `document-parsing`/`chunking`/`embeddings` components, qdrant component, jobs component (Task 1), `materialsCol()`.
- Produces: `createMaterials`/`createUrlMaterial` (insert `status:'processing'`, then `enqueueJob('material.ingest', { materialId })` each — independent, one failure never blocks others), the `material.ingest` job (parse → chunk → embed → upsert into `course-<courseId>` with payload `{ materialId, chunk }` → `status:'ready'`; on error `status:'failed', error`), `retryMaterial`, `assignMaterial` (IN-S05), and the exported `courseCollection(courseId): string` returning `course-<hex>` (used by Tasks 7 and 8). Supported formats `pdf docx pptx txt md url`; anything else → route 400 naming the format. Routes: `POST /api/courses/:courseId/materials` (multipart `files[]` or JSON `{ url }`, `fileSize` 50 MB), `GET .../materials`, `POST /api/materials/:materialId/retry`, `PUT /api/materials/:materialId/assignments` — instructor-guarded.
  **Note (post-implementation) — five deviations; `STATUS.md` in this folder has the full rationale:**
  1. **🚨 Job registration: `defineJob` must NOT be called at module level. This plan's instruction (Step 3, "Register with `defineJob` in this service") made the server fail to boot.** The compiled output is CommonJS, so `server.ts` → `app.ts` → `materials.routes.ts` → `materials.service.ts` pulls the service in on a **hoisted synchronous `require` that runs before `main()`** — i.e. before `startJobs()` — and `requireAgenda()` throws `Jobs not started`. The plan assumed nothing else imports the service; the routes must. **Fixed:** export `registerMaterialJobs()` and call it from `server.ts` *after* `startJobs()`. `components/jobs/AGENTS.md` now documents this. **Tasks 7 and 8 register jobs — follow that pattern, not this plan's wording.** `tests/unit/app.smoke.test.ts` guards it (all 156 tests passed while the server couldn't boot, because no test imported `app.ts`).
  2. **`'md'` added to `Material['format']`** (`domain.ts`) — this plan lists `md` as supported and Step 3 verifies with a `.md` file, but the union lacked it. Additive.
  3. **`.txt` is read directly (`fs.readFile`), not via `parseFile()`** — the document-parsing component supports `.pdf .docx .pptx .html/.htm .md` but **not `.txt`**, so the format list above would have failed at runtime. Map: pdf/docx/pptx/md → `parseFile`; txt → direct read; URL → fetch → temp file → HTML parse.
  4. **The URL path is hardened** beyond the plan: fetch timeout, response byte cap, HTML content-type allowlist, and SSRF blocking (loopback/private/link-local, enforced across redirects). Unbounded `response.text()` could OOM the process and kill every concurrently-ingesting sibling — an IN-S04 violation by another door — and a URL serving a PDF was being marked `ready` with mojibake indexed.
  5. **`components/qdrant/index.ts` was NOT modified** — the "if they don't take a collection-name argument" condition is **false**; `ensureCollection`/`upsertPoints`/`search` already take one.
  Also: ingest point ids are **deterministic** (UUIDv5 over `materialId:chunkIndex`), not `randomUUID()` — otherwise `retryMaterial` on a `ready` material silently doubles every vector in the course collection. And `ensureCollection` is cached by **in-flight promise per collection name** — never a single module-level boolean (that is `rag.service.ts`'s pattern and it would skip collection creation for every course after the first).

- [x] **Step 1: Write failing tests** — per the core document, Task 6 Step 1 (unsupported extension named in the 400; three files → three `processing` docs + three enqueues; ingest success calls parse→chunk→embed→upsert with collection `course-<id>` and sets `ready`; ingest failure sets `failed` with the message and does **not** throw; URL material stores `sourceUrl`). Mock collections + jobs + genai/qdrant.
- [x] **Step 2: Run to verify FAIL.**
- [x] **Step 3: Implement** service, `defineJob('material.ingest', …)` registration (import the service from `server.ts` after `startJobs()`), routes; add `uploads/` to `.gitignore`. Manual check: `curl -F "files=@tests/fixtures/sample-material.md" -b <session>` and watch status go `processing → ready`.
- [x] **Step 4: Run tests + typecheck** → PASS.
- [x] **Step 5: Commit** — `git commit -m "feat: material upload and async RAG ingestion into per-course Qdrant collections (IN-S04/S05)"`

---

### Task 7: LLM auto-classification + AI-suggested hierarchy (IN-S06, IN-S01 tail)

Requires Task 6 merged (modifies its routes).

**Files:**
- Create: `server/src/services/classification.service.ts`
- Modify: `server/src/routes/materials.routes.ts` (classification accept/reject; suggest-hierarchy endpoint)
- Test: `tests/unit/classification.service.test.ts`

**Interfaces:**
- Consumes: genai `llm` component (`completeJson<T>(prompt, { model })` — if the component exposes only text completion, add a `completeJson` helper there that parses/retries JSON once), `env.llmDefaultModel`; materials + hierarchy collections.
- Produces: `classifyMaterial(materialId)` (prompt = course Theme/LO names + material's first ~2000 chars; expects `{ themeName, loName?, confidence }`; resolves names → ids; `confidence < 0.5` leaves it unset → "Unclassified" client-side; called at the end of a successful `material.ingest`) and `suggestHierarchy(courseId)` (from all `ready` materials' first chunks; acceptance calls existing `addTheme`/`addLo` from Task 2). **`suggestHierarchy` is slip candidate #3 — if the phase is tight, cut this function and its endpoint only; keep `classifyMaterial`.**

- [x] **Step 1: Failing tests** — classification.service.test.ts (13) + llm-complete-json.test.ts (5). llm component (`completeJson`) mocked in the service tests; the toolkit `LLMModule` mocked in the helper test.
- [x] **Step 2: Verify FAIL** — true per-assertion RED via stubs (13 failed / 5 passed), not a compile-only RED.
- [x] **Step 3: Implement** — prompts inline, one-shot, temperature 0. `classifyMaterial` wired into the `material.ingest` tail (best-effort, cannot flip `ready`→`failed`). Full `suggestHierarchy` fn **and** its endpoint built (human decision — see STATUS deviations).
- [x] **Step 4: Run tests + typecheck** → 319 unit pass, typecheck + build clean, own files lint-clean.
- [x] **Step 5: Commit** — `feat: LLM material classification and hierarchy suggestion (IN-S06)` (`c86067f`).

---

### Task 8: Three-agent generation pipeline + thin-LO generation + pre-seeding indicator (PRD §9.1, IN-Q10)

Requires Tasks 1, 4, 6 merged. **Step 5 is the ~Aug 2 mid-phase checkpoint (joint sync point).**

**Files:**
- Create: `server/src/services/generation.service.ts`, `server/src/routes/generation.routes.ts`
- Modify: `server/src/app.ts` (mount — append-only)
- Test: `tests/unit/generation.service.test.ts`

**Interfaces:**
- Consumes: llm component (`completeJson`), qdrant `search` + `courseCollection` (Task 6), embeddings component, `createQuestion` (Task 4), jobs component, per-step models `env.llmModelGenerator/Validator/Reviewer`.
- Produces: `runGenerationPipeline(input)` — per question: **retrieve** (embed LO name + optional prompt, search course collection, top 6 chunks) → **generator** (`env.llmModelGenerator`) → **structure validator** (`env.llmModelValidator`, per-role assessment) → **reviewer** (`env.llmModelReviewer`, the five IN-Q05 criteria → `{ decision: 'pass'|'flag'|'reject', reasoning }`) → insert via `createQuestion` with `agentDecision` + `sourceRefs`. Output always enters as **Draft**; the pipeline never publishes. Plus the `generation.run` job, `POST /api/courses/:courseId/generate` (validate, enqueue, `202 { jobId }`), `preseedingProgress(courseId)`, and `GET /api/courses/:courseId/preseeding`. Prompts live as exported constants `GENERATOR_PROMPT`/`VALIDATOR_PROMPT`/`REVIEWER_PROMPT` (template functions) so Phase 4 content QA can tune them.

- [x] **Step 1: Failing tests** — generation.service.test.ts (6) + generation.routes.test.ts (7). llm/qdrant/embeddings/questions.service/collections/materials mocked; `config/env` mocked to give three distinct step models.
- [x] **Step 2: Verify FAIL** — true per-assertion RED via stubs (6 failed).
- [x] **Step 3: Implement** — full grounded prompt templates (`GENERATOR_PROMPT`/`VALIDATOR_PROMPT`/`REVIEWER_PROMPT` exported). Job (`registerGenerationJobs()`, NOT module-level) + routes mounted in `app.ts`, registered in `server.ts` after `startJobs()`.
- [x] **Step 4: Tests + typecheck** → 332 unit pass, typecheck + build + lint clean.
- [ ] **Step 5: Manual checkpoint (JOINT, ~Aug 2)** — NOT yet run (needs docker + reachable LLM). Deferred to the joint checkpoint, same as Task 6/7 live e2e.
- [x] **Step 6: Commit** — `feat: three-agent generation pipeline …` (`7f604df`).

---

### Task 15: Instructor client views (IN-S01–S06, IN-Q02–Q05, IN-Q08, IN-Q10, IN-L06)

Requires Tasks 2, 5, 6, 7, 8 merged (their endpoints).

**Files:**
- Create: `client/src/views/instructor/course-setup.ts`, `materials.ts`, `bank.ts`, `review-queue.ts`, `preseeding.ts`
- Modify: `client/src/router.ts`/`main.ts` (instructor routes), `client/src/views/home.ts` (instructor branch), `client/public/styles/main.css`

**Interfaces:**
- Consumes: courses/materials/questions/generation endpoints (contract); `renderRichText` for stems/explanations; existing `api.ts` fetch helper; router.
- Produces: hash routes `#/instructor/course/:id/{setup,materials,bank,queue,preseeding}`. Uses the param-matching router — **coordinate with Stephen**, who extends `startRouter`'s `resolve` with a param-pattern matcher in his Task 14; if his Task 14 hasn't landed, extract the pure `matchRoute(pattern, path)` helper yourself and share it.

Key behaviours (small, concrete DOM code in the existing views' style; see the core document, Task 15): duplicate-name inline warning (non-blocking) on theme/LO create; edited-field highlighting in the editor (`.edited` class vs the loaded version); approve moves state immediately and updates the row without reload; bulk approve `confirm()` with the count; publish shows the checklist with warnings but allows publishing; upload form accepts multiple files + a URL field and polls `GET /materials` every 3s while any material is `processing`.

> **RE-PLANNED (2026-07-18): now wireframe-driven.** Task 15 was expanded from
> "small DOM in the existing shell" to follow the Figma "Wireframe v0.2"
> instructor screens (green instructor shell + shared component vocabulary).
> The detailed 8-sub-task plan is
> **`docs/superpowers/plans/phase-1/Saurav/2026-07-17-task-15-instructor-views.md`**
> (+ `task-15-wireframe-reference.md`), executed via subagent-driven-development.

- [x] **Step 1: Build the six instructor views** (shell + primitives + api client → My Courses/Create → Dashboard/Structure/Settings → Materials → Bank/Detail → Review Queue → Pre-seeding/Generate). Done as sub-tasks A–G, each implemented + reviewed.
- [x] **Step 2: Typecheck + lint + build** → PASS (390 unit tests green).
- [x] **Step 3: Playwright spec** `tests/e2e/instructor-pipeline.spec.ts` (sub-task H) — written; **live run deferred to the ~Aug 2 checkpoint** (no stack in-session), parses + typechecks + lints clean.
- [x] **Step 4: Commit** — landed as commits `73b3061`..`15df236` (+ this doc/decision commit).

---

### Task 13: Layer-2 LLM mastery evaluator (PRD §9.2) — *"either" owner; slip candidate*

**Only pick this up if you are ahead of Stephen, and coordinate first** — it
modifies **Stephen's** `attempts.service.ts` (Task 11). Layer-1 statuses from his
Task 9 stand alone, so this is pre-approved to slip if not stable by Aug 9. Full
task (job `mastery.evaluate`, cadence trigger at `attemptsSinceEvaluation >= 5`,
disengaged fast-track, safe-failure on invalid JSON) is in the core document,
Task 13. Do not start without a heads-up to Stephen.

---

### Task 16: Phase exit — end-to-end demo test and Approved-only serving proof — Saurav's share

**Joint sync point** — both developers participate; the demo is the phase exit
gate. Stephen typically drives the student-serving assertions; Saurav's share:

- [ ] Provide the instructor half of `tests/e2e/core-loop-demo.spec.ts` — create course → upload material → generate (or seed via the Task 4 service when `!LLM_AVAILABLE`) → approve → publish.
- [ ] Verify the Approved-only proof (`tests/unit/approved-only-serving.test.ts`) holds against the real question/bank services (Tasks 4/5) — only `approved` questions are ever selected; a non-approved head throws `question-not-servable`.
- [ ] Run the full gate together: `npm run lint && npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] Commit (joint) — `git commit -m "test: phase-1 exit — core-loop demo e2e and approved-only serving proof"`

---

## Saurav's exit checklist (Dev B slice of the phase exit criteria)

- [ ] Task 8 mid-phase checkpoint hit (~Aug 2): an instructor-generated, approved question served to a student end-to-end.
- [ ] Publication-state transitions covered by jest (Task 4); auth-gated instructor endpoints covered (Tasks 2, 5).
- [ ] Generation pipeline never publishes — output always Draft (Task 8 tests).
- [ ] Approved-only serving proof passes against the real bank services (Task 16).
- [ ] Instructor pipeline e2e green (Task 15) and joint core-loop demo green (Task 16).

## Slip order (Saurav-relevant, lowest first)

1. Layer-2 mastery evaluator (Task 13) — only if picked up; Layer-1 stands alone.
2. AI-suggested hierarchy (Task 7's `suggestHierarchy` only) — keep `classifyMaterial`.
