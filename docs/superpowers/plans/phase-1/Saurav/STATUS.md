# Saurav — Phase 1 progress

_Last updated: 2026-07-17_

**Tasks 1, 2, 4, 5, and 6 are merged to `main`** (PRs #13–#17; `main` is now
`8558317`, which also carries Stephen's Phase-1 core loop, PR #18). **Task 7 is
in review** (PR #19, `3b4896b` — includes a one-line lint fix to Stephen's
review-book file, see below). **Task 8 is code-complete on
`saurav/task-8-generation`** (`7f604df`), **stacked on Task 7**, awaiting push +
PR. Full suite green: **332 unit**, typecheck + build + lint all clean.

**Task 4 unblocks Stephen** — his Tasks 10/11/14 need Approved questions to
exist, and `createQuestion` + `transitionQuestion` are now the way to seed them
(see "What I need from you" below). Next up is **Task 8** (three-agent generation
pipeline; needs Tasks 1+4+6, all merged) — **Step 5 is the ~Aug 2 joint
mid-phase checkpoint.**

> **⚠️ Pre-existing lint error on `main` (Stephen's file, NOT introduced by
> Task 7):** `server/src/services/review-book.service.ts:1` trips
> `@typescript-eslint/consistent-type-imports` (`import` → `import type`).
> Confirmed present on `8558317` by stashing Task 7 and linting. Left untouched
> per the two-developer convention (don't "helpfully fix" the other developer's
> file) — **flag to Stephen**; it is a one-line `--fix`.

> **🚨 If you are about to register an Agenda job (Tasks 7, 8, 13): do NOT call
> `defineJob()` at module level.** Task 6's brief said to, and it made the server
> fail to boot — while all 156 tests passed, because no test imported `app.ts`.
> Export a `registerXJobs()` and call it from `server.ts` after `startJobs()`.
> See Task 6 deviation 1 below and `components/jobs/AGENTS.md`.

Executed with the superpowers `subagent-driven-development` skill; the running
ledger (commit ranges, per-task review verdicts, deferred Minor findings) is in
the gitignored `.superpowers/sdd/progress.md`. **This file is the durable
record of where the code diverged from the plan** — the ledger is scratch and
`git clean -fdx` will take it.

## Done — my tasks (Dev B)

| Task | What | Status |
|---|---|---|
| 1 | Agenda-backed jobs component (`defineJob`/`enqueueJob`/`scheduleRecurring`/`stopJobs`) | merged, PR #13 (`3a8c649`) |
| 2 | Courses service + course-scoped guards + Courses/Hierarchy/Roster endpoints (IN-S01/S02/S03, IN-L06) | merged, PR #14 (`2060254`) |
| 4 | Question service — versioning, option invariants, publication transitions with audit (IN-Q03/Q04/Q07/Q13) | merged, PR #15 (`33b2eb1`) |
| 5 | Bank service + question-bank routes — browse/filter, review queue, editing, transitions (IN-Q02/Q05/Q08) | merged, PR #16 (`99d0d72`) |
| 6 | Materials service + routes + `material.ingest` job — upload/URL → parse → chunk → embed → per-course Qdrant (IN-S04/S05) | merged, PR #17 |
| 7 | Classification service + routes — LLM auto-classification, accept/reject, AI-suggested hierarchy (IN-S06) | in review, PR #19 (`3b4896b`) |
| 8 | Generation service + routes — three-agent pipeline (generator/validator/reviewer, per-step models), pre-seeding progress (§9.1, IN-Q10) | merged, PR #20 |
| 15 | Instructor client views (wireframe-driven) — shell + primitives + api, My Courses/Create, Dashboard/Structure/Settings, Materials, Bank/Detail, Review Queue, Pre-seeding/Generate, e2e (IN-S01–S06, IN-Q02–Q05, IN-Q08, IN-Q10, IN-L06) | code-complete on `saurav/task-15-instructor-views` (`15df236`), **awaiting push + PR** |

## Deviations from the plan

Everything below is a place the shipped code does **not** match the plan text as
written. Each was either forced by a constraint the plan didn't anticipate or
decided explicitly — none are drift.

### Task 15 — decided/forced during implementation (2026-07-18)

1. **Re-planned wireframe-driven.** Original brief was "small DOM in the starter
   shell." Mid-task, Saurav + Stephen's Figma "Wireframe v0.2" instructor screens
   became the target, so Task 15 was re-planned to follow them *roughly* (green
   instructor shell + a shared component vocabulary in `instructor-ui.ts`),
   decomposed into 8 sub-tasks (A–H) and executed via
   subagent-driven-development. New plan:
   `2026-07-17-task-15-instructor-views.md` (+ `task-15-wireframe-reference.md`).
2. **Client-only; two endpoints derived client-side** (per the plan's
   no-server-changes constraint): no `GET /api/courses` list → `listInstructorCourses`
   derives from session `courseRoles` + N `getCourseTree`; no read-only
   publish-checklist route → the dashboard checklist is derived client-side from
   course + tree + materials + pre-seeding. `getPublishChecklist` remains a loud
   never-called stub.
3. **Async generation, no live preview.** The I12 wireframe shows a synchronous
   "generated question" preview; our pipeline is async (`202 {jobId}`, Drafts land
   later). The generate action enqueues and shows a "queued → see Review Queue"
   confirmation; the preview panel is intentionally omitted.
4. **Provisioning decision (I1 — first-run instructor shell).** `isInstructor()`
   keys the instructor shell on an EXPLICIT grant (`isAdmin` or an instructor
   `courseRole`), NOT faculty affiliation. **Model (Saurav, 2026-07-18):**
   instructors are **admin-provisioned**; affiliation alone doesn't make one.
   Interim for the pilot: admins pre-provision an instructor course-role before
   first login (a provisioned instructor always reaches the shell + Create Course
   — no dead-end). **Phase-2 follow-up:** a platform-level instructor grant set via
   an admin management surface (the A1/A2/I11 admin/TA screens) so instructors with
   zero courses still get the shell without a seeded role. Documented at
   `client/src/main.ts` `isInstructor()`.
5. **Deferred Minors (final-review triage → follow-ups):** dedupe
   `approveTarget`/`topicLoLabel` (copied across bank/detail/queue); remove/wire the
   dead `getSuggestedHierarchy` export (N10 apply-UI not built); add request
   sequencing to `bank.ts` filter reload (stale-response race); disable
   approve/bulk buttons in-flight; `settings.ts` auto-pause allows 0 vs server >0;
   `question-detail.ts` index-based option compare. None block merge.
6. **e2e live run deferred** to the ~Aug 2 joint checkpoint (no stack in-session);
   spec parses + typechecks + lints clean.

### Task 8 — decided/forced during implementation (2026-07-17)

1. **Branch is STACKED on Task 7** (`saurav/task-8-generation` off
   `saurav/task-7-classification`), because Task 8 consumes Task 7's
   `completeJson()` and Task 7 (PR #19) isn't merged yet. After #19 merges,
   rebase Task 8 onto `main` so its PR shows only Task 8's diff.

2. **Generator runs warm (`temperature: 0.7`); validator + reviewer stay
   deterministic (temperature 0).** `completeJson` defaults to temperature 0 —
   correct for Task 7, but for generation it would make every question in a
   `count > 1` batch **identical**. Only the generator gets the warm
   temperature; grading/review stay deterministic.

3. **Retrieval is hoisted out of the per-question loop.** Every question in one
   `runGenerationPipeline` call targets the same LO/prompt, so the grounding
   query is identical — retrieve once, reuse the chunks for the whole batch
   (variety comes from the warm generator, not re-retrieval). Saves `count-1`
   embed+search round-trips.

4. **Cross-course LO guard added.** The route guards `courseId` (path) but
   `loId` comes from the body, so `runGenerationPipeline` rejects
   `lo-not-in-course` (403) if the LO belongs to another course — otherwise it
   would tag this course's Draft questions with a foreign `loId`/`themeId`.

5. **Structural option pre-check (`optionShapeValid`) before spending
   validator/reviewer calls.** The generator is retried once on invalid options,
   then the question is skipped with a logged warning; the returned id count
   reflects only real insertions. `createQuestion` remains the authoritative
   invariant guard (defense in depth) — a divergence there is also caught and
   skipped, never fails the batch.

6. **`preseeding` response gained `loName`** (per the core-doc signature) — the
   contract line listed `{ loId, approved, reviewed, target }`; updated to
   include `loName`. Additive superset, benign — Stephen's dashboard consumes it.

7. **No `defineJob` at module level** (Task 6 lesson) — `registerGenerationJobs()`
   is exported and called from `server.ts` after `startJobs()`. `app.smoke.test.ts`
   (boot guard) stays green.

8. **Live end-to-end / the ~Aug 2 JOINT checkpoint (Step 5) NOT run** — needs
   docker + a reachable LLM. This is the mid-phase checkpoint both developers
   verify together; unit + boot-smoke coverage only until then.

### Task 7 — decided/forced during implementation (2026-07-17)

1. **`suggestHierarchy` + its endpoint were BUILT, not slipped (human decision).**
   The plan flags `suggestHierarchy` as slip candidate #3 and its endpoint is
   **not in `docs/api-contract.md`**. Saurav chose the full build, so
   `GET /api/courses/:courseId/suggest-hierarchy` was **added to the contract**
   (marked `<!-- ADDED in Task 7; pending two-developer review -->`).
   → **This is a contract change — Stephen must sign off at PR time** (the one
   coordination-artifact edit in this task).

2. **A persisted `excerpt` field was added to `Material` (domain.ts) and written
   at ingest.** The plan says `suggestHierarchy` reads "all ready materials'
   first chunks" and `classifyMaterial` "material's first ~2000 chars" — but the
   qdrant component exposes no scroll/get and stored payloads carry no
   `chunkIndex`, so "first chunk" is unrecoverable from Qdrant. Persisting the
   first ~2000 chars of the ingested text on the Material (one field, set in the
   same `ready` update) is the faithful, cheaper equivalent: it also lets
   `classifyMaterial(materialId)` keep the plan's exact single-arg signature with
   **no file re-parse and no URL re-fetch**. Additive; nothing else consumed
   `Material` outside my own code.

3. **Classification is wired as a best-effort call in the ingest tail, NOT a new
   job (no `defineJob`).** Per the STATUS boot-crash warning, nothing was
   registered at module level. `classifyMaterial` runs inside `ingestMaterial`
   *after* the material is marked `ready`, in its **own** `try/catch`, so a
   classifier/LLM failure can never flip a successfully-ingested material to
   `failed`. `app.smoke.test.ts` (boot guard) stays green.

4. **`completeJson<T>` added to `components/genai/llm`** (the plan's stated
   fallback: the component only had `sendMessage`). Portable route — `responseFormat:
   'json'`, `temperature: 0`, tolerant parse (strips ```json fences / prose),
   **one** corrective retry, then throws `llm-json-parse-failed`. The toolkit's
   Zod `sendStructuredConversation` was avoided: it needs a structured-output
   model the local Ollama default (`ministral-3`) doesn't provide. Covered by
   `tests/unit/llm-complete-json.test.ts` (5 cases, toolkit `LLMModule` mocked).

5. **Live end-to-end never run** (same as Task 6): classification needs Mongo +
   Qdrant + a real LLM. Unit + boot-smoke coverage only. Fold into the Task 8
   ~Aug 2 checkpoint / Task 16 phase-exit run.

### Task 6 — decided by Saurav during review (2026-07-17)

1. **🚨 The plan's job-registration instruction made the server fail to boot.**
   The brief said "Register with `defineJob` in this service; import the service
   from `server.ts` after `startJobs()` so registration runs." The compiled
   output is **CommonJS**, so `server.ts` → `app.ts` → `materials.routes.ts` →
   `materials.service.ts` pulls the service in via a **hoisted synchronous
   `require` that runs before `main()`** — before `startJobs()` — and
   `requireAgenda()` throws `Jobs not started`. The dynamic
   `await import(...)` in `server.ts` was unreachable dead code. The plan assumed
   nothing else imports the service; the routes must.
   **Ruling:** export `registerMaterialJobs()`, call it from `server.ts` after
   `startJobs()`. `components/jobs/AGENTS.md` was rewritten, because its old
   wording is what produced this and **Tasks 7/8 would have re-introduced it**.
   **The scariest part: all 156 tests passed while the server could not start** —
   no test imported `app.ts`. `tests/unit/app.smoke.test.ts` now guards it, with
   `components/jobs` deliberately left unmocked so a module-level `defineJob`
   fails it at import (verified by reverting the fix and watching it fail).
   → **The plan's Task 6 Step 3 / Interfaces text is stale on this point.**

2. **`'md'` added to `Material['format']`** (`domain.ts`). The brief lists `md` as
   supported and its own Step 3 verifies with `sample-material.md`, but the union
   was `'pdf'|'docx'|'pptx'|'txt'|'url'`. Additive — nothing else consumed
   `Material` yet, so Stephen's code can't break.

3. **`.txt` is read directly (`fs.readFile`), bypassing `parseFile()`.** The
   brief and `domain.ts` both promise `txt`, but the document-parsing component
   supports `.pdf .docx .pptx .html/.htm .md` — **not `.txt`** — so the brief's
   own format list would have failed at runtime. A .txt file is already text.

4. **Batch rejection kept** — `createMaterials` rejects the whole upload if any
   file has an unsupported extension. It is contract-conformant and **not** an
   IN-S04 violation (IN-S04 governs background *processing*, not upload
   validation), and it gives the caller one unambiguous answer. Now pinned by a
   test so it is deliberate rather than undocumented.
   **Open UX question for the whole-branch review:** an instructor drag-dropping
   12 files where one is a `.zip` loses all 11 good ones, which is against the
   *spirit* of "one failure never blocks others". Partial success
   (`201 { created, rejected }`) would honour both — but it is a contract change
   requiring two-developer review.

5. **The URL path is hardened beyond the brief** (ruled): fetch timeout, response
   byte cap, HTML content-type allowlist, and SSRF blocking across redirects.
   Each closes something real — an unbounded `response.text()` could OOM the
   process and kill every concurrently-ingesting sibling (IN-S04 by another
   door), and a URL serving a PDF was `.text()`'d into mojibake, embedded, and
   marked **`ready`** (silent RAG corruption, worse than `failed`).

### Task 6 — found in review, fixed without a ruling (in-spec)

6. **`ensureCollection` raced on the feature's most common path.** The
   `Set<string>` per-collection cache correctly avoided `rag.service.ts`'s
   single-boolean trap (which would have skipped collection creation for every
   course after the first), but had no **in-flight** dedup, and `ensureCollection`
   is non-atomic check-then-create. Agenda's default concurrency is 5, so three
   files uploaded to a **new** course → three concurrent jobs → three
   `createCollection` calls → two 409s → **two materials spuriously `failed`** —
   exactly the sibling contamination IN-S04 forbids. Now a
   `Map<string, Promise<void>>` in-flight cache + 409 tolerance.

7. **Ingest was not idempotent.** Point ids were `randomUUID()` per run with no
   delete of prior points, while `retryMaterial` re-enqueues regardless of
   status — so retrying a `ready` material **silently doubled every vector** in
   `course-<id>`, permanently skewing Task 7 classification and Task 8
   retrieval. Now deterministic UUIDv5 over `materialId:chunkIndex`, so
   re-ingest overwrites.

8. **SSRF: `isBlockedHost` blocked `fdic.gov` and `fcbarcelona.com`.**
   `startsWith('fc')`/`startsWith('fd')` was intended for IPv6 unique-local
   literals but ran in the branch ordinary DNS names reach. On a finance
   product, the FDIC being unfetchable is a live bug. Now `/^f[cd][0-9a-f]{2}:/`.

9. **SSRF bypass via IPv4-mapped IPv6.** `http://[::ffff:169.254.169.254]/`
   normalizes to hostname `::ffff:a9fe:a9fe` — not `::1`, not `fe80:`, not
   matched by the IPv4 regex → **allowed**, while `fetch` still reached the cloud
   metadata endpoint. Both mapped forms (dotted and hex) now unwrap to IPv4 and
   re-run the IPv4 checks.

10. **Upload cleanup deleted files for already-persisted materials** (the
    catch-all assumed `createMaterials` was atomic; it isn't once `insertOne`
    starts) — now scoped to the `unsupported-format:` case. And **`MulterError`
    surfaced as a 500** ("File too large" on a >50MB upload) because it carries
    `code`, not `status` — now 413 / 400 via the router's normalizer.

11. **Test coverage was found inadequate and expanded 5 → 44.** The brief listed
    only 5 service cases and **no route test file**, so `materials.routes.ts`
    (203 lines, the auth surface) had zero tests. Nothing pinned the
    per-collection cache either — a revert to the boolean would have passed all
    5 original tests. Added route tests, the cache regression test, IN-S05
    coverage, and the mixed valid+invalid batch case.

### Task 5 — decided by Saurav during review (2026-07-17)

1. **`POST /api/questions/bulk-transition` authorization — the plan's guard
   recipe had a hole.** The plan says child-resource routes "look up the question
   first and stash `res.locals.courseId` before the guard runs" — **singular**.
   But bulk-transition has no `:courseId` and takes an **array** of ids that may
   span courses, while `ensureCourseInstructor()` resolves exactly one course
   (`course-guards.ts` `requestCourseId()`). Stashing the first question's course
   would have let an instructor of course A transition course B's questions by
   including their ids — a privilege escalation directly into the publication
   state machine that decides what students get served. **Implemented:** load the
   questions, collect the distinct `courseId`s of those found; if that is not
   exactly one → **403**; otherwise stash it and guard normally. **403 rather
   than 400** so the endpoint isn't an existence oracle. Review confirmed it
   holds for empty / missing / duplicate / malformed / spanning ids, and that
   admins are subject to the span check too.
   → **The plan's Task 5 route line is stale: the singular recipe is a trap for
   any array-taking route under `/api/questions`.**

2. **The span-check 403 returns the guard's own body.** It first returned
   `{ error: 'questions-span-multiple-courses' }` while the guard returned
   `You do not have access to this course.` — so a **one-id** request revealed
   whether that id existed, undercutting the reason we chose 403 over 400.
   Now both come from a frozen `NO_COURSE_ACCESS_BODY` exported from
   `course-guards.ts`, making them identical in status, body, headers, and
   timing. Pinned by a test that compares the two bodies **to each other**, not
   to a literal, so it survives a future wording change. (The extraction touches
   Task 2's shared guard; review verified `ensureCourseRole`'s behaviour is
   byte-identical.)

3. **`includeArchived` is a service parameter only, never a query param.**
   `docs/api-contract.md:47` lists only `state/loId/themeId/type/difficulty/label`
   and the contract governs the HTTP surface. Nothing is lost — `state=archived`
   still reaches archived questions per the plan's own rule. `browseBank` keeps
   the parameter for Task 15.

### Task 5 — found in review, fixed without a ruling (in-spec)

4. **The review-queue coverage count was not course-scoped.** It ran
   `countDocuments({ loIds: firstLoId, state: 'approved' })` with no `courseId`,
   while every other query in the service carries one. Since `PATCH` exposes
   `loIds` with no ownership check, an instructor of course A could tag their
   question with course B's LO id — and that question would then count toward
   B's approved coverage and **demote B's LOs in B's review queue**. A
   cross-course write influence, closed by adding `courseId` to the filter. The
   test pins it with exact-object equality, so dropping the scope fails loudly.

5. **`transitionQuestion`'s declared return type was wrong** (Task 4's file).
   Declared `Promise<Question>` (no `_id`) while actually returning the spread of
   a `findOne`, so this route had to cast to `WithId<Question>` to read `_id` —
   the cast being the only thing between the declared type and a TypeError → 500.
   Widened at the source to `Promise<WithId<Question>>`; type-declaration change
   only, no behaviour change.

6. **`satisfies` alone did not do what its comment claimed.** The local
   `as const` enum lists in `questions.routes.ts` duplicate `domain.ts`'s unions.
   `satisfies readonly PublicationState[]` catches *invalid* members but **not
   omissions** — so a 7th `PublicationState` added to `domain.ts` would have been
   silently 400'd by a stale list, which is the exact failure the comment claimed
   it prevented. Reverse exhaustiveness checks added on all five lists and
   verified live (dropping a state produces TS2344).

7. **`flagsCol()`/`attemptsCol()` are not consumed**, despite the plan's
   "Consumes" line. The review-queue ordering as specified needs neither, so
   they were not imported.

8. **RED was real this time** — 13 per-assertion failures, because the modules
   were stubbed first. (Task 4's RED was a `TS2307` compile error, which proves
   nothing.) Caveat: the 18 *route* tests still passed at RED, so only
   `bank.service.test.ts` satisfied a true Step 2.

### Task 4 — decided by Saurav during review (2026-07-16)

1. **`editQuestion` does not create a version or add `manually-edited` for a
   tagging-only patch.** The plan's recipe was an unconditional "insert
   `version: n+1` + `$addToSet: { labels: 'manually-edited' }`", so an IN-Q13
   retag — `editQuestion(id, { loIds }, puid)`, no content change — inserted a
   **content-identical v2** and stamped the question as manually edited when
   nobody had edited it. The label stops meaning anything and the version chain
   fills with duplicate snapshots. Now: if the patch has no content key
   (`stem`/`options`/`difficulty`/`paramSlots`), it updates the head's
   `loIds`/`themeIds` only, inserts no version, adds no label, and returns the
   current version. Option validation still runs *inside* the content branch, so
   a bad-options patch throws before any early return — no bypass.
   **Content-bearing edits are byte-identical to the plan; the PRD §2
   append-only guarantee is untouched.**
   → **The plan's Task 4 `editQuestion` recipe is now stale on this point.**

2. **`editedFields` stays per-edit; `domain.ts`'s docstring was wrong and was
   reworded.** The plan says "records `editedFields` (patched content keys)" —
   per-edit. `domain.ts:128` said "fields manually changed vs the generated
   original (IN-Q03)" — which reads cumulative. A genuine contradiction between
   two normative sources. The plan governs: nothing is lost, because the
   cumulative divergence-from-original set is the **union of `editedFields`
   across the version chain**; only reading a single version in isolation is
   weaker. The docstring now says exactly that.
   → **No code change; `domain.ts:128` is the thing that moved.**

3. **`transitionQuestion` hoists a single `const now`.** The core doc's excerpt
   returns `{ ...question, state: to }`, which carries the **pre-update**
   `updatedAt` while the DB got a fresh `new Date()` — so the returned timestamp
   did not match storage. Task 5's routes will echo this return straight to the
   client. One value now feeds the `$set`, the audit entry, and the return.

### Task 4 — found in review, fixed without a ruling (in-spec)

4. **`bulkTransition` no longer swallows every error.** The plan says "skips
   invalid, returns updated count"; the implementation delivered that with a
   bare `catch {}` — which also swallowed **infrastructure** failures. A Mongo
   outage returned `0`, indistinguishable from "all N questions were in an
   invalid state". Worse: if `transitionQuestion`'s state `updateOne` succeeded
   and the **audit `insertOne` then threw**, the catch ate it — the question was
   approved, the count under-reported, and the state change was **unaudited**,
   the worst possible hole in a publication audit trail. Now only
   `question-not-found` and `invalid-transition:*` are skipped; everything else
   propagates. "Skips invalid ones" never meant "swallows all errors", so this
   needed no ruling.
   → **Task 5's routes must handle a rejected `bulkTransition`.**

5. **`createQuestion` inserts the version before the head**, and `editQuestion`
   gained `question-not-found` / `version-not-found` guards on paths the plan
   left silent. `Question.currentVersionId` and `QuestionVersion.questionId` are
   both required, so neither insert can go second — both `_id`s are
   pre-generated with `new ObjectId()`. Ordering is then free, and an orphan
   version (head insert fails) is invisible to every query path, whereas an
   orphan head (version insert fails) is discoverable and points at a
   `currentVersionId` that does not exist. No transactions/sessions — no service
   in this repo uses them.

6. **The RED phase was not a true RED.** The failing run was a
   `TS2307: Cannot find module` compile error (`Tests: 0 total`), not observed
   per-assertion failures — so the tests were never seen failing for the *right*
   reason, and there is no evidence distinguishing "these tests pin the required
   behaviour" from "these tests were written against the implementation". The
   reviewer judged them sound on inspection and they were strengthened
   afterwards, but the TDD evidence has a real gap. Recorded rather than
   papered over.

### Task 2 — decided by Saurav during review (2026-07-16)

1. **`archiveTheme` cascades `archivedAt` to its LOs.** The brief specified no
   cascade, and its *verbatim* `publishChecklist` code queries LOs by
   `{ courseId, archivedAt: { $exists: false } }` — by course, not by live
   theme. That combination is a trap: archiving a theme hides its LOs from
   `getCourseTree` (which joins LOs only to live themes) while those LOs keep
   forcing `ok: false` on the publish checklist forever, with **no route to
   archive them**. The instructor lands in a state they cannot remediate
   through any exposed endpoint. Fixed at the write — `archiveTheme` stamps one
   shared timestamp on the theme and its live LOs (`$exists: false` spares
   already-archived LOs' original times). `publishChecklist` was left exactly as
   the brief specifies; the cascade makes its query correct.
   → **The plan's Task 2 Interfaces + Step 3 excerpts are now stale on this
   point.**

2. **`putRoster` reconciles the roster instead of replacing it.** The brief
   says "(lower-cases, dedupes, **replaces**)", and the original
   `deleteMany` + `insertMany` implemented that literally — which meant **every
   roster re-upload silently wiped every instructor-granted
   `RosterEntry.extendedUntil`** (IN-S02 per-student access extensions).
   `GET .../roster` returns the field, so it is live, not vestigial. An
   instructor adding one name to a roster would lose every extension in the
   course, with no warning. Data preservation now governs over the brief's
   wording: `deleteMany({ courseId, identifier: { $nin: unique } })` removes
   only identifiers absent from the new list, and surviving identifiers are
   upserted with `$setOnInsert` (never `$set`), so both `extendedUntil` and the
   original `addedAt` survive. An empty list still clears the roster and
   returns 0. Keyed on the existing `{ courseId: 1, identifier: 1 }` unique
   index (`collections.ts:55`).
   → **The plan's Task 2 Interfaces line for `putRoster` is now stale.**

   _Decision history: initially ruled that the brief's "replaces" governs and
   logged as an accepted risk; reversed the same day on seeing the concrete
   consequence. Recorded because the reversal is the useful part — the brief's
   one-word summary of a function is not a considered ruling on its data
   semantics, and "the plan said replaces" was not a good enough reason to ship
   silent data loss._

3. **`ensureApiAuthenticated()` added ahead of the stash middleware on all five
   Theme/LO routes.** The brief's route spec (Step 5) says only "instructor
   endpoints use `ensureCourseInstructor()`; `POST /api/courses` uses
   `ensureApiAuthenticated()`". But Theme/LO paths carry no `:courseId`, so they
   resolve the owning course via a DB lookup stashed on `res.locals.courseId`
   — and that lookup ran *before* any auth. A signed-out caller triggered a
   Mongo read on every request and could distinguish an existing theme/LO id
   (reached the guard → 401) from a nonexistent one (→ 404). Order is now
   `validate(params)` → `ensureApiAuthenticated()` → stash → `ensureCourseInstructor()`
   → `validate(body)`. This is additive; `ensureCourseInstructor` keeps its own
   401 check, so no existing behaviour changed.

### Task 2 — forced during implementation

4. **Three service functions beyond the brief's "Produces" list:**
   `getThemeCourseId`, `getLoCourseId`, `getCourse`. Theme/LO routes have no
   `:courseId` param and `server/src/routes/AGENTS.md` forbids DB calls in a
   route, so the lookup had to live in the service. `getCourse` was exported
   because `PATCH /api/courses/:courseId` must return a plain `Course` per the
   contract, not the `getCourseTree` shape.

5. **Router-scoped error-normalizing middleware** (`courses.routes.ts`), not in
   the brief. The brief's verbatim service excerpts throw plain
   `Error('course-not-found' | 'theme-not-found' | 'lo-not-found' |
   'term-end-before-start')` with no `.status`, so something had to map them to
   404/400. Doing it in a router-scoped handler keeps the service a pure data
   layer; anything unrecognised falls through to the central `errorHandler`.

6. **`PATCH /api/courses/:courseId` splits `published` out.** The contract
   accepts `published` on this endpoint, but the brief's `updateCourse()`
   signature only owns `termStart/termEnd/feedbackStrategy/autoPause`. The route
   calls `setPublished()` separately and returns the final course state either
   way. Contract and brief disagreed; the contract won.

7. **Route tests had no RED phase.** The brief's own step order builds routes
   (Step 5) before their tests (Step 6), so the five route tests passed on first
   run. A deviation from TDD mandated by the plan, not chosen. The service
   tests *were* written RED-first, and the fix pass's new tests were confirmed
   RED before GREEN.

8. **`duplicateNameWarning` ships unwired.** Implemented per the brief, but the
   brief lists it under "Produces (service)" and *not* under "Produces
   (routes)", and `docs/api-contract.md` has no warning endpoint — so it is
   currently unreachable code. **This is Task 15's problem to close** (see
   below).

### Task 1 — forced during implementation

9. **`agenda` pinned to `4.4.0`, not latest.** Plan Step 1 says
   `npm install agenda` unpinned; agenda v6 dropped the shared-`Db` API the
   component's design depends on. Pinning exact also satisfies the Phase 0
   global constraint ("toolkit versions pinned exact").

10. **The jobs component opens its own MongoDB connection** via agenda's
    bundled mongodb@4 driver (`db: { address }`) instead of sharing
    `getMongoClient()`. agenda@4's job locking reads
    `findOneAndUpdate(...).value`, which the repo's top-level mongodb@7 driver
    no longer returns. **Already written back into the plan** at
    `2026-07-11-phase-1-core-loop-saurav.md:98` and
    `server/src/components/jobs/AGENTS.md`.

11. **Lockfile regenerated in a linux container.** Not in the plan. macOS npm
    prunes the `@emnapi` optional deps that CI's `npm ci` then can't find;
    the lock is regenerated under `node:22` linux so CI stays green.

## Cross-task note for Task 15 (mine)

`duplicateNameWarning` (`courses.service.ts`) has **no route and no endpoint in
the contract**, but Task 15 needs the non-blocking duplicate-name warning on
theme/LO create. Two ways to close it, decide at Task 15:

- **Add an endpoint** — a contract change, which per the Phase 1 global
  constraints goes through two-developer PR review first; **or**
- **Derive it client-side** from the course tree the view already fetches — it
  carries every theme/LO name, so no server round-trip is needed. This likely
  makes the service function redundant.

## Deferred review findings — now triage for the Phase-1 whole-branch review

Both Task 2's and Task 4's reviews came back Approved with **no
Critical/Important issues outstanding**. The Minors below were deliberately
left; full detail in the gitignored `.superpowers/sdd/progress.md`.

**Task 2's Minors are now on `main` (PR #14 merged before they were triaged).**
The two worth a second look:

- `courses.routes.ts` — `err.message in COURSE_ERROR_STATUS` walks the
  prototype chain, so `Error('toString')` would pass a *function* to
  `res.status()`. Unreachable today (service messages are a fixed set); use
  `Object.hasOwn`.
- `courses.service.ts` — no retry on a `registrationCode` collision against the
  unique index; a collision surfaces as an opaque 500 on course creation
  (~1-in-10¹² per insert).

Also: `ensureCourseStudent` / `ensureCourseTa` ship unused — brief-mandated,
intended for the student-facing tasks. Not a defect.

**Task 6's deferred items:**

- **A live end-to-end upload has never been run.** The brief's Step 3 (`curl` a
  file through the route and watch `processing → ready`) needs Mongo + Qdrant +
  a real embedding model + a session cookie, so it was skipped — **and the boot
  crash is exactly what it would have caught.** The smoke test covers boot now,
  but the actual ingest pipeline has only ever run against mocks. **Worth doing
  live before the phase exit** (Task 16), and it overlaps with Task 8 Step 5's
  ~Aug 2 checkpoint.
- **Orphan points on shrink.** Deterministic ids fixed re-ingest *duplication*,
  but a re-ingest producing **fewer** chunks (a URL whose content shrank, a retry
  after re-upload) leaves tail points `materialId:n..` in the collection forever
  — still carrying `payload.materialId`, still retrievable, so they will surface
  in Task 8's generation context. Closing it needs a **delete-by-filter API the
  qdrant component doesn't have**, which is beyond Task 6's scope. Commented at
  the upsert site.
- **DNS-rebinding SSRF** — the host is resolved twice (once for the check, once
  by `fetch`). A known limitation of literal-host blocking; commented near
  `isBlockedHost`.
- **No timeout test** — `AbortSignal.timeout()` is backed by Node's internal
  timer, so Jest fake timers don't intercept it reliably. Nothing was written
  rather than a flaky test. The size cap and redirect re-validation *are* tested.
- **The batch-rejection UX question** (see Task 6 deviation 4) — a contract-level
  call, not resolvable inside a task.

**Task 5's deferred items** — the first is a **deliberate deferral by Saurav**,
not an oversight:

- **404-before-guard is an app-wide existence oracle — decide it once, here.**
  `GET`/`PATCH`/`transition` on `/api/questions/:questionId` return 404 for a
  nonexistent id **before** `ensureCourseInstructor()` runs, so any authenticated
  user — including a student with no role in the course — can distinguish "this
  question exists" (403) from "it doesn't" (404) for arbitrary ids. That is the
  same oracle Task 5's bulk-transition route was deliberately hardened against,
  one route over. **Left as-is on purpose:** it is Task 2's documented convention
  (`courses.routes.ts:78-87`, citing the contract's 404 code), already merged to
  `main` for themes/LOs, and Task 5 mirrors the template faithfully. Changing it
  is a cross-cutting call over questions **and** themes **and** LOs, not a Task 5
  fix. A comment near `stashCourseIdFromQuestion` flags it so nobody closes it
  piecemeal. **Either accept the oracle app-wide or close it app-wide — the one
  thing to avoid is the current split, where one route is hardened and its
  siblings aren't.**
- `bank.service.ts` — `reviewQueue`'s under-coverage ranking issues one memoized
  `countDocuments` per distinct first-LO, sequentially awaited in a loop
  (latency-additive, not parallel). Fine at Phase-1 scale. One aggregation
  (`$match courseId + approved` → `$unwind loIds` → `$sortByCount`) collapses it
  into a single query if it ever matters.

**Task 4's Minors** (both test-only; production code is clean):

- `tests/unit/questions.service.test.ts` — the "content+tags patch still
  versions and labels" test is a near-duplicate of the `editedFields` test
  (same `{ difficulty, loIds }` patch); the newer one is strictly better and
  the older could fold into it.
- `tests/unit/questions.service.test.ts` — `bulkTransition`'s `findOne` mock
  returns the same doc for any id that isn't `validId`, so a test would still
  pass if `bulkTransition` mangled ids. Low risk — the loop is trivial.

## What's left

- **~Aug 2 JOINT mid-phase checkpoint (Task 8 Step 5)** — with docker + a
  reachable LLM: create course + theme + LO, upload the fixture material, run
  generation, confirm Draft questions with agent decisions appear; **then
  approve one and have Stephen serve it to a student end-to-end.** Both
  developers verify. This is the one remaining Task 8 step.
- **Task 15** — instructor client views (needs 2+5+6+7+8, all now code-complete).
  Renders Task 7's `classificationSuggestion` ("Unclassified" when absent), the
  `GET .../suggest-hierarchy` outline, and Task 8's pre-seeding progress +
  generated Drafts with their agent decisions.
- **Task 13** — Layer-2 LLM mastery evaluator ("either" owner; slip candidate).
- **Merge sequencing:** Task 7 (PR #19) merges first; then rebase Task 8 onto
  `main` and open its PR.
- **Task 8 carry-forward:** `courseCollection(courseId)` → `course-<hex>` is
  exported from `materials.service.ts` for you. Retrieval will see orphan tail
  points from any shrinking re-ingest (see Task 6's deferred items).
- **Task 15 carry-forward:** the question-bank surface it renders is Task 5's.
  Question heads come back as `id`, embedded `current` versions as raw `_id`
  (see the serialization rule above), and `browseBank`'s `includeArchived` is
  reachable only from the service — over HTTP, use `state=archived`.

## What I need from you (Stephen)

Nothing blocking — but three heads-ups:

1. **Task 2 (now on `main`) adds `app.use('/api', coursesRouter)`** to `app.ts`
   (one appended line, no reordering, per the shared-file convention) and
   introduces `server/src/components/auth/course-guards.ts`. If your tasks touch
   course authorization, use `ensureCourseInstructor()` /
   `ensureCourseStudent()` / `ensureCourseTa()` from there rather than rolling
   your own — they check `req.user.courseRoles` against the request's course and
   honour `isAdmin`.
2. **Task 4 is your unblocker for Tasks 10/11/14** — `createQuestion` +
   `transitionQuestion` are how Approved questions come into existence, so you
   never have to wait on my Task 15 UI. Seed with:

   ```ts
   import { createQuestion, transitionQuestion } from '../services/questions.service';

   const { questionId } = await createQuestion({
     courseId, loIds: [loId], themeIds: [themeId],
     type: 'mcq', stem: 'Which statement about NPV is correct?',
     options: [
       { key: 'A', text: '…', role: 'correct',              explanation: '…' },
       { key: 'B', text: '…', role: 'common-misconception', explanation: '…' },
       { key: 'C', text: '…', role: 'partially-correct',    explanation: '…' },
       { key: 'D', text: '…', role: 'clearly-wrong',        explanation: '…' },
     ],
     difficulty: 'medium', createdBy: 'seed',
   });
   // Questions ALWAYS enter as draft — walk the state machine to approved:
   await transitionQuestion(questionId, 'pending-review', 'seed');
   await transitionQuestion(questionId, 'approved', 'seed'); // pending-review → approved is legal
   ```

   Exactly 4 options for `mcq` (2 for `true-false`) and exactly one `correct`,
   or it throws `invalid-options:*`. `draft → approved` is **not** a legal jump.
3. **`editQuestion` will not version or label a tagging-only patch** (see
   deviation 1). If you retag a question's `loIds`/`themeIds`, its
   `currentVersion` deliberately does not move.
4. **Task 5 adds `app.use('/api', questionsRouter)`** to `app.ts` (one appended
   line, per the shared-file convention) and exports a frozen
   `NO_COURSE_ACCESS_BODY` from `components/auth/course-guards.ts`. If you ever
   need to return a course-access 403 **outside** `ensureCourseRole()` — e.g. a
   loader that rejects before a course is resolved — import that constant rather
   than re-typing the string, so the two 403s stay indistinguishable.
5. **Any route you add that takes an *array* of ids under `/api/questions`
   cannot use the plan's stash-then-guard recipe** — it is singular, and
   `ensureCourseInstructor()` only ever checks one course. See Task 5 deviation 1
   for the rule (distinct courses must be exactly one, else 403).
