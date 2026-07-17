# Saurav — Phase 1 progress

_Last updated: 2026-07-16_

**Tasks 1, 2, and 4 are done and reviewed.** Tasks 1 and 2 are **merged to
`main`** (PR #13, PR #14 — `main` is now `2060254`). Task 4 is code-complete on
branch `saurav/task-4-questions-service`, review **Spec ✅ / Quality Approved**,
rebased onto post-#14 `main` and **awaiting Saurav's push + PR**. Full suite
green: **104 unit** (87 from Tasks 1–2 + 17 new), typecheck + eslint clean.

**Task 4 unblocks Stephen** — his Tasks 10/11/14 need Approved questions to
exist, and `createQuestion` + `transitionQuestion` are now the way to seed them
(see "What I need from you" below). Next up is **Task 5** (bank routes), which
needs Task 4 merged.

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
| 4 | Question service — versioning, option invariants, publication transitions with audit (IN-Q03/Q04/Q07/Q13) | reviewed, **branch pushed? no — awaiting PR** (`7259f4e`) |

## Deviations from the plan

Everything below is a place the shipped code does **not** match the plan text as
written. Each was either forced by a constraint the plan didn't anticipate or
decided explicitly — none are drift.

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

**Task 4's Minors** (both test-only; production code is clean):

- `tests/unit/questions.service.test.ts` — the "content+tags patch still
  versions and labels" test is a near-duplicate of the `editedFields` test
  (same `{ difficulty, loIds }` patch); the newer one is strictly better and
  the older could fold into it.
- `tests/unit/questions.service.test.ts` — `bulkTransition`'s `findOne` mock
  returns the same doc for any id that isn't `validId`, so a test would still
  pass if `bulkTransition` mangled ids. Low risk — the loop is trivial.

## What's left

- **Task 5** — bank routes (browse/filter, review queue, editing, transitions).
  Needs Task 4 merged. **Note: `bulkTransition` now rejects on non-domain
  errors, so its route must handle a rejected promise** (see Task 4 deviation 4).
- Then Tasks 6, 7, 8, 15.

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
