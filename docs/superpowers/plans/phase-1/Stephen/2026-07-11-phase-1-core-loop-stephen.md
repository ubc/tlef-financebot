# Phase 1 — Core Loop — Stephen (Dev A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Progress tracking (do this, it is not automatic):** the moment a task's review comes back clean and its commit is made, edit this file to change that task's `- [ ]` to `- [x]`, then commit the checkbox change and push. Also mirror the checkbox into the core document [`../2026-07-11-phase-1-core-loop.md`](../2026-07-11-phase-1-core-loop.md) so Saurav's agent sees it. Run `npm run sync-plans -- Stephen` after.

This is **Stephen's** personal plan: the Dev A (student arc, WS-3/4 +
Layer-1 mastery) slice of the core phase document
[`../2026-07-11-phase-1-core-loop.md`](../2026-07-11-phase-1-core-loop.md).
Task numbers match the core document. Tasks 1, 2, 4, 5, 6, 7, 8, 15 belong to
**Saurav (Dev B)** and are not in this plan — never start or edit them; see
"Coordination with Saurav" for where they block or need Stephen's work. Every
task step here references the core document for the full code/tests rather
than duplicating it — the core doc is the normative source; this plan is the
Dev A execution order and coordination layer.

**Goal:** Stephen's half of the core loop: enrollment by registration code,
Layer-1 mastery (rolling window, tier progression, coverage), the selection
algorithm with graceful degradation, attempt submission with adaptive
feedback and Review-Book auto-collection, Review Book browsing + session
summaries, and the student client views — such that a student can enroll in a
course, practice by Theme/LO with adaptive feedback, and revisit mistakes in
the Review Book.

**Architecture:** All server work follows the boilerplate's routes → services
→ components pattern, consuming the Phase-0 domain types
(`server/src/types/domain.ts`), collection accessors
(`components/mongodb/collections.ts`), `validate()` middleware, and the API
contract (`docs/api-contract.md`). Student client views are plain-TS
hash-routed views using `renderRichText` for question content. Serving reads
**only** `state: 'approved'` questions — this is proven by Task 16's test,
which Stephen typically drives.

**Tech Stack:** as Phase 0 — no new dependencies for Dev A's tasks (Saurav's
`agenda`/`nanoid` additions from Task 1 are already on `main`; nothing here
needs them directly).

## Global Constraints

- Everything in the Phase 0 plan's Global Constraints section still applies (TypeScript `strict`; env only in `env.ts` + `.env.example`; components own external integrations; toolkit versions pinned exact; no email; CWL-only auth; client vendored libs, no bundler; follow the nearest `AGENTS.md`).
- Only Approved questions are ever served to students; Themes/LOs with zero Approved questions are hidden from students (PRD §9.1). No fallback to unreviewed content, ever.
- Every student answer writes exactly one `AttemptRecord` pinning `questionVersionId`, served `loId`/`themeId`, `mode`, applied `strategy`, and `paramValues` (PRD §2).
- Multi-LO questions update mastery only for the LO they were served under (PRD §5.1).
- Publication-state changes must be immediately visible to serving (no caching of question state).
- All new endpoints match `docs/api-contract.md`; contract changes go through two-developer PR review first.
- New env vars go in `env.ts` + `.env.example` only.
- Shared-file convention (root `AGENTS.md`): `package.json`, `server/src/server.ts`, `server/src/app.ts`, `.env.example`, `client/public/index.html` are **append-only, one line/block per addition** — never reorder or reformat surrounding lines.
- Mid-phase checkpoint (~Aug 2): one instructor-generated, approved question served to a student end-to-end (Saurav's Task 8 Step 5 — Stephen verifies the serving side, see "Coordination with Saurav").

## Stephen's task order (Dev A)

Recommended sequence, following the core doc's own dependency chain:

1. **Task 3** (enrollment by code) — no cross-dependency on Saurav beyond his merged Task 2 (courses service, already on `main`). Do first.
2. **Task 9** (mastery Layer 1) — no cross-dependency; **its Produces block is the week-1 sync point interface** — confirm with Saurav before starting Tasks 10/11.
3. **Task 10** (selection algorithm) — needs Task 9's `getMasteryTier`. Uses only Approved questions from Saurav's Task 4/5 (both already on `main`) to seed test fixtures/manual checks.
4. **Task 11** (attempts + adaptive feedback + Review Book auto-collection) — needs Tasks 9 and 10.
5. **Task 12** (Review Book service + session summaries) — needs Task 11 (auto-collection must exist first).
6. **Task 14** (student client views) — needs Tasks 3, 9, 10, 11, 12 (their endpoints), plus Saurav's Task 5 (bank) and Task 2 (courses) for seeded data.
7. **Task 13** (Layer-2 mastery evaluator) — *"either" owner; pick up only if ahead of Saurav and after coordinating (it modifies my own `attempts.service.ts`).* Slip candidate — Layer-1 statuses stand alone.
8. **Task 16** (joint exit) — Stephen typically drives the student-serving assertions.

## Coordination with Saurav (Dev B)

**Cross-developer dependencies (from the core doc + Saurav's STATUS.md):**

| Dependency | Direction | Effect |
|---|---|---|
| **Task 2 (courses, Saurav)** | Saurav → Stephen's Task 3 | Enrollment (ST-E02) needs a published course with a registration code and roster. **Already merged to `main`** — code against the real `courses.service.ts` / `course-guards.ts`, not a stub. |
| **Task 4/5 (questions + bank, Saurav)** | Saurav → Stephen's Tasks 10/11/14 | Selection, attempts, and student views all need **Approved questions**. **Already merged to `main`.** Seed with `createQuestion` + `transitionQuestion` from `server/src/services/questions.service.ts` — see the snippet in Saurav's STATUS.md, reproduced in Task 10 Step 1 below. Never wait on Saurav's Task 15 (instructor UI) to get test data. |
| **Task 9 (mastery, this plan)** | Stephen → Saurav | Saurav's Task 8 (generation pipeline) does **not** consume mastery — no blocking either direction. Still, review the Task 9 Produces block together at the week-1 sync point (shared vocabulary: `getMasteryTier`, `recordAttemptInMastery`). |
| **`docs/api-contract.md`** | either → both | Any change is a two-developer PR review, never ad hoc. Both arcs code against it. |

**Already-shipped things from Saurav that affect this plan (verified against `main` on 2026-07-16, not just his STATUS.md notes):**
- `ensureCourseInstructor()` / `ensureCourseStudent()` / `ensureCourseTa()` live in `server/src/components/auth/course-guards.ts`. Task 3's enrollment route and Task 11/12/14's student routes should use `ensureCourseStudent()` rather than rolling new auth logic.
- A frozen `NO_COURSE_ACCESS_BODY` is exported from the same file — reuse it for any course-access 403 outside `ensureCourseRole()`.
- `createQuestion`/`transitionQuestion` are in `server/src/services/questions.service.ts`; `editQuestion` does **not** version/label a tagging-only patch (irrelevant to Dev A's tasks, but noted in case Task 14's views ever touch it).
- `app.use('/api', coursesRouter)` and `app.use('/api', questionsRouter)` are both appended in `server/src/app.ts` already — Stephen's routers append **after** these, never reordering.

**Sync points (pause and involve Saurav):**
1. **Week 1** — confirm the selection↔mastery interface (`getMasteryTier`, `recordAttemptInMastery`, Task 9 Produces block) across the arcs before Tasks 10/11 begin. Stephen owns; Saurav reviews.
2. **~Aug 2 mid-phase checkpoint (Saurav's Task 8 Step 5)** — one instructor-generated, approved question served to a student end-to-end; **both developers verify.** Stephen drives the serving/practice side (Tasks 10/11 must be merged by then).
3. **Any change to `docs/api-contract.md`** — two-developer PR review.
4. **Task 16 (exit demo)** — joint; both developers participate.

**Workflow:** run `npm run sync-plans -- Stephen` before and after each work
session; keep the checkboxes in this file (and mirrored in the core doc)
honest against `git log`.

---

### Task 3: Enrollment by code + roster cross-check (ST-E02, ST-E03)

Requires Saurav's Task 2 (courses service) — **already merged to `main`**.

**Files:**
- Create: `server/src/services/enrollment.service.ts`, `server/src/routes/enrollment.routes.ts`
- Modify: `server/src/app.ts` (mount router — append-only, after the existing `coursesRouter`/`questionsRouter` lines)
- Test: `tests/unit/enrollment.service.test.ts`

**Interfaces:**
- Consumes: `coursesCol()`, `rosterCol()`, `usersCol()`; `User` from `req.user`.
- Produces: `enrollByCode(user, code): Promise<{ courseId; name; courseCode }>` throwing `EnrollmentError` with `.code` one of `'not-recognized' | 'not-on-roster' | 'course-ended' | 'already-enrolled'`; `listEnrollments(user): Promise<Array<{ courseId, name, courseCode, term, active }>>` where `active` is false past `termEnd` (respecting per-student `extendedUntil`). Routes map error codes to statuses: 404 / 403 / 410 / 409 per the contract. Full signatures, the five test cases, and the `enrollByCode` excerpt are in the core document, Task 3.

- [x] **Step 1: Write the failing tests** — `tests/unit/enrollment.service.test.ts`, the five `it()` blocks specified in the core document, Task 3 Step 1 (enrolls on code+roster match; rejects valid code when not on roster with a distinct `not-on-roster` message, ST-E02; rejects unknown code; rejects expired course respecting per-student `extendedUntil` — **note: `putRoster` on `main` preserves `extendedUntil` across roster re-uploads per Saurav's Task 2 deviation 2, so this field is reliably populated once set**; idempotent already-enrolled case with no duplicate write). Mock collections like `users.service.test.ts`. Roster match rule: the student's `uid` **or** `email` (both lower-cased) must equal a roster `identifier`.
- [x] **Step 2: Run tests to verify they fail** — `npx jest tests/unit/enrollment.service.test.ts` → FAIL.
- [x] **Step 3: Implement the service** — `enrollment.service.ts`, full file per the core document, Task 3 Step 3 (`EnrollmentError` class + `enrollByCode` + `listEnrollments`).
- [x] **Step 4: Implement the routes** — `enrollment.routes.ts`: `POST /api/enrollments` (body `{ code: z.string().min(1) }` via `validate()`) mapping `EnrollmentError.code` → 404/403/410/409 with the exact user-facing messages from ST-E02; `GET /api/enrollments`. Use `ensureApiAuthenticated()` (any authenticated user may attempt enrollment — the roster check is the real gate). Mount `app.use('/api', enrollmentRouter);` in `app.ts`, appended after Saurav's two existing router lines.
- [x] **Step 5: Run tests** — `npx jest tests/unit/enrollment.service.test.ts && npm run typecheck` → PASS.
- [x] **Step 6: Commit** — `git commit -m "feat: enrollment by registration code with roster cross-check and four error states (ST-E02)"`

**Post-implementation review note (2026-07-16):** Approved, no Critical/Important findings. Deferred Minors (full detail in the gitignored `.superpowers/sdd/progress.md`): `enrollByCode`/`listEnrollments` duplicate roster+expiry logic with subtly different null-handling — a shared `resolveAccessEnd()` helper would remove future drift risk; only the `uid` roster-match path is tested, not `email` (the core doc's own spec has the same gap).

---

### Task 9: Mastery engine Layer 1 — rolling window, tier progression, coverage (PRD §9.2)

**This is the week-1 sync point** — its Produces block below is the shared
vocabulary Saurav's arc reviews before Tasks 10/11 begin. No file
dependency on Saurav's work; can start in parallel with Task 3.

**Files:**
- Create: `server/src/services/mastery.service.ts`
- Test: `tests/unit/mastery.service.test.ts`

**Interfaces:**
- Consumes: `masteryCol()`, `attemptsCol()`, `losCol()`; domain types.
- Produces: `recordAttemptInMastery(attempt: AttemptRecord): Promise<MasteryProfile>` (rolling-window recompute + tier progression + status derivation — the exact rules, including the `covered`/`in-progress`/`struggling` state machine, are in the core document, Task 9 Interfaces), `getMasteryTier(puid, courseId, loId): Promise<Difficulty>` (default `'easy'` — **this is the exact function name Task 10's selection service and Saurav's arc expect**), `getLoStatuses(puid, courseId): Promise<Map<string, MasteryStatus>>`, `recordSkip(puid, courseId, loId, attempted: boolean): Promise<void>`, `themeCoverage(puid, courseId, themeId): Promise<{ covered; includesSkipped }>`.

- [x] **Step 1: Write the failing tests** — `tests/unit/mastery.service.test.ts`, the eight scripted cases in the core document, Task 9 Step 1, run through a `Map`-backed fake of `masteryCol`/`attemptsCol` implementing `findOne`/`find().sort().limit().toArray()`/`updateOne` with upsert (tier walks easy→medium→hard across three correct answers then covers on a fourth; `hard` miss regresses `covered→in-progress`; CM miss holds tier; 2-of-last-3 `hard` misses step back to `medium`; 10-attempt rolling window evicts the 11th's predecessor; skip clears on next attempt; `themeCoverage` treats a skipped LO as covered-with-caveat).
- [x] **Step 2: Run tests to verify they fail** — `npx jest tests/unit/mastery.service.test.ts` → FAIL.
- [x] **Step 3: Implement** — a pure function `computeProfile(window: AttemptRecord[], prior: MasteryProfile | null): MasteryProfile` implementing exactly the rules in the core document, Task 9 Step 3, plus a thin persistence wrapper (`recordAttemptInMastery` loads the last ≤10 attempts, calls `computeProfile`, upserts) so the rules stay unit-testable without mocking Mongo query chains for every case.
- [x] **Step 4: Run tests** — `npx jest tests/unit/mastery.service.test.ts && npm run typecheck` → PASS.
- [x] **Step 5: Commit** — `git commit -m "feat: mastery Layer-1 rolling window, tier progression, coverage and skip semantics (§9.2)"`

**Post-implementation review note (2026-07-17):** `computeProfile` is deliberately an **incremental delta**, not a full-window replay — it applies one tier transition per call, using `prior.currentTier` (or `'easy'` if null) plus `window`'s newest attempt, while `windowAccuracy`/`attemptCount`/`windowRoles` genuinely are recomputed fresh from the full (≤10-attempt) `window` every call. This matches `recordAttemptInMastery`'s real, lockstep call pattern (exactly one new attempt beyond what `prior` reflects) and is documented as such in the service's docstring. **Do not "fix" this into a full-window tier replay** — that was tried and reverted: replaying the tier walk from `'easy'` across the capped 10-attempt window silently collapses `currentTier` (e.g. `hard` → `easy`) once earlier tier-earning attempts age out of the window during a legitimate common-misconception-miss streak, which the spec requires to be tier-**neutral**. A regression test for exactly this failure mode lives in `tests/unit/mastery.service.test.ts`. `computeProfile` called directly with a multi-attempt window against a stale-or-null `prior` (i.e. outside its real one-new-attempt contract) is documented as an accepted, out-of-contract limitation — it under-steps the tier rather than crashing. Review Approved, no Critical/Important outstanding after 2 fix rounds; full detail in the gitignored `.superpowers/sdd/progress.md` and `.superpowers/sdd/task-9-report.md`.

> **Before starting Task 10:** confirm `getMasteryTier(puid, courseId, loId): Promise<Difficulty>` and `recordAttemptInMastery`'s signature with Saurav at the week-1 sync point — this is the interface his arc's mental model depends on even though his tasks don't call it directly.

---

### Task 10: Question selection algorithm (PRD §5.1)

Requires Task 9 (mastery) merged.

**Files:**
- Create: `server/src/services/serving.service.ts`
- Test: `tests/unit/serving.service.test.ts`

**Interfaces:**
- Consumes: `questionsCol()`, `questionVersionsCol()`, `getMasteryTier` (Task 9). **Not** needed yet: worker sandbox / parameterized execution (Phase 2) — Phase 1 serves `paramSlots`-free questions; if `paramSlots` exist, serve with slot defaults at `min` (revisit in Phase 2).
- Produces: `selectNextQuestion(input): Promise<{ question; version; degraded: 'none'|'repeat'|'adjacent'|'any' } | null>` (Approved-only, excludes `sessionServedIds`, targets mastery tier, degradation ladder: same-tier-served → adjacent-unseen → any-approved; `null` only when the LO has zero Approved), `selectRetryQuestion(input): Promise<same | null>`, `studentCourseHome(puid, courseId): Promise<Array<{ theme; available; los: Array<{ lo; status; approvedCount }> }>>` (only themes/LOs with ≥1 approved question). Full signatures and the nine test cases are in the core document, Task 10.

**Seeding note (from Saurav's STATUS.md — verified live on `main`):** to get real Approved questions for tests/manual checks without waiting on any UI:

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
await transitionQuestion(questionId, 'approved', 'seed'); // pending-review -> approved is legal; draft -> approved is NOT
```

Exactly 4 options for `mcq` (2 for `true-false`) and exactly one `correct`, or it throws `invalid-options:*`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/serving.service.test.ts`, the nine cases in the core document, Task 10 Step 1, against fake collections with a seeded bank builder `bank([{ id, difficulty, state, loIds }])` (approved-only filter; sessionServedIds exclusion; tier targeting; three-rung degradation ladder; zero-approved → null; retry never repeats the excluded id; `studentCourseHome` hides a not-yet-available theme and a zero-approved LO).
- [ ] **Step 2: Run tests to verify they fail** — `npx jest tests/unit/serving.service.test.ts` → FAIL.
- [ ] **Step 3: Implement** — pure selection over an in-memory candidate list fetched once per call; inject `Math.random` as an optional argument (default `Math.random`) so tests can pin randomness.
- [ ] **Step 4: Run tests** — `npx jest tests/unit/serving.service.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: mastery-driven question selection with graceful degradation ladder (§5.1)"`

---

### Task 11: Attempts + adaptive feedback + Review Book auto-collection (ST-P04, ST-R01)

Requires Tasks 9 and 10 merged.

**Files:**
- Create: `server/src/services/attempts.service.ts`, `server/src/routes/practice.routes.ts`
- Modify: `server/src/app.ts` (mount — append-only)
- Test: `tests/unit/attempts.service.test.ts`, `tests/unit/practice.routes.test.ts`

**Interfaces:**
- Consumes: Tasks 9–10 services; `attemptsCol()`, `reviewBookCol()`, `coursesCol()`, `questionVersionsCol()`, `questionsCol()`.
- Produces: `decideStrategy(courseStrategy, selectedRole): AppliedStrategy` (pure truth table), `submitAttempt(input): Promise<AttemptResult>` — writes the AttemptRecord, updates mastery, upserts a ReviewBookEntry on any miss (before the retry resolves), Strategy-A miss triggers `selectRetryQuestion` with full-reveal degradation if none available, `recommendation: 'advance-lo'/'advance-theme'` when this attempt flips coverage. Full `AttemptResult` type, the ten test cases, and the routes (`POST /api/courses/:courseId/practice/next`, `POST /api/attempts`, `POST /api/courses/:courseId/los/:loId/skip`, `GET /api/courses/:courseId/home`, `GET /api/courses/:courseId/session-summary`) are in the core document, Task 11 Interfaces.
- **Serving-response constraint (security-relevant, verify explicitly):** the `/practice/next` response must **never** contain `role`, `explanation`, or correctness anywhere in the JSON — only `{ key, text }` per option, plus `watermark: user.uid`. This is worth a dedicated route test that walks the full JSON tree rather than spot-checking known fields, so a future field addition can't reintroduce a leak silently.

- [ ] **Step 1: Write the failing tests** — `tests/unit/attempts.service.test.ts`, the ten cases in the core document, Task 11 Step 1 (`decideStrategy` truth table; correct-answer full reveal with no review-book write; adaptive+CM miss withholds explanations and returns a retry, with the review-book upsert happening **before** the retry resolves; no-retry-available degrades to full reveal; adaptive+clearly-wrong miss uses strategy `'b'`; a locked `'strategy-b'` course wins over role; repeat miss updates the same review-book entry, no duplicate; retry attempts write `isRetry:true` with full mastery weight; AttemptRecord pins `questionVersionId`/`loId`/`mode`/`strategy`/`difficulty`; attempting against a non-approved question throws `question-not-servable`). `tests/unit/practice.routes.test.ts`: the full-JSON-walk no-role/no-explanation assertion above; 403 non-enrolled; skip endpoint 204.
- [ ] **Step 2: Run tests to verify they fail** — `npx jest tests/unit/attempts.service.test.ts tests/unit/practice.routes.test.ts` → FAIL.
- [ ] **Step 3: Implement** service + routes per the Interfaces; use `ensureCourseStudent()` from Saurav's `course-guards.ts` for the student-guarded routes rather than rolling new auth logic; mount in `app.ts`.
- [ ] **Step 4: Run tests** — same command `&& npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: attempt submission with adaptive feedback strategies, retry gate, and review-book auto-collection (ST-P04, ST-R01)"`

---

### Task 12: Review Book service + session summaries (ST-R02–R07, ST-P10/P11)

Requires Task 11 (auto-collection) merged.

**Files:**
- Create: `server/src/services/review-book.service.ts`, `server/src/routes/review-book.routes.ts`
- Modify: `server/src/routes/practice.routes.ts` (session-summary endpoints call this service), `server/src/app.ts` (mount — append-only)
- Test: `tests/unit/review-book.service.test.ts`

**Interfaces:**
- Consumes: `reviewBookCol()`, `attemptsCol()`, `questionsCol()`, `questionVersionsCol()`; domain types.
- Produces: `toggleBookmark(puid, courseId, questionId): Promise<{ bookmarked }>` (adds/removes `'bookmark'` in `sources`; an auto+bookmark entry survives un-bookmarking, ST-R02), `removeEntry(puid, entryId): Promise<void>` (never touches attemptRecords, ST-R03), `listReviewBook(puid, courseId, sort)` (theme-grouped with counts — **slip guidance: ship `theme`+`date` sorts only if tight, per the core doc's slip order**), `sessionEndSummary(puid, courseId, since: Date)`, plus the `sessionSummaries` collection (add the accessor + unique index `{ puid: 1, courseId: 1 }` to `collections.ts`) backing the deferred-summary flow. Full signatures, session model, and routes are in the core document, Task 12 Interfaces.

- [ ] **Step 1: Write the failing tests** — `tests/unit/review-book.service.test.ts` per the core document, Task 12 Step 1 (bookmark toggle on an auto-collected entry keeps `sources:['auto', ...]` behavior correctly scoped; bookmark on a never-missed question creates a fresh `sources:['bookmark']` entry; `removeEntry` never calls `attemptsCol`; `listReviewBook` groups by theme with counts and honours `date` sort; `sessionEndSummary`'s `missedQuestions` ids equal the review-book additions in the window — not a divergently-computed list, ST-R06).
- [ ] **Step 2: Run tests to verify they fail** — `npx jest tests/unit/review-book.service.test.ts` → FAIL.
- [ ] **Step 3: Implement** service + routes (`GET /api/courses/:courseId/review-book?sort=`, `POST/DELETE /api/questions/:questionId/bookmark`, `DELETE /api/review-book/:entryId`, the two summary endpoints); add the `sessionSummaries` collection accessor/index; mount in `app.ts`.
- [ ] **Step 4: Run tests** — `npx jest tests/unit/review-book.service.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: review book browsing, bookmarking, and session summaries (ST-R02..R07, ST-P10/P11)"`

---

### Task 14: Student client views (ST-P01–P04, P06, P08, P10, P11 + Review Book UI)

Requires Tasks 3, 9, 10, 11, 12 (their endpoints) merged.

**Files:**
- Create: `client/src/views/student/course-home.ts`, `lo-list.ts`, `practice.ts`, `review-book.ts`, `session-summary.ts`, `client/src/practice-session.ts`
- Modify: `client/src/main.ts` / `client/src/router.ts` (routes + param-pattern matcher), `client/src/views/home.ts` (student branch), `client/public/styles/main.css`

**Interfaces:**
- Consumes: the practice/review-book/enrollment endpoints (contract), `renderRichText`, existing `api.ts` fetch helper, router.
- Produces: hash routes `#/course/:id`, `#/course/:id/theme/:themeId`, `#/course/:id/practice/:loId`, `#/course/:id/practice-theme/:themeId`, `#/course/:id/review-book`, `#/course/:id/summary`. **The router only supports exact paths today** — extend `startRouter`'s `resolve` with a param-pattern matcher, extracted as a pure `matchRoute(pattern, path)` helper so it's testable without a DOM, and keep existing routes working. **Coordinate with Saurav** — his Task 15 (instructor views) also extends the router with param matching; whoever lands first writes the shared matcher, the other reuses it rather than writing a second one.

Key behaviours (small, concrete DOM code in the existing views' style; see the core document, Task 14): coverage-indicator theme cards + session-start banner on course home; status-labeled LO rows; single-question practice view with locking options, inline feedback, Strategy-A retry-in-place, skip button, scrollable transcript, `uid` watermark corner text; Review Book with collapsed theme groups, sort dropdown, re-practice via `mode: 'review-book'`; session summary with accuracy-by-LO and a defer-to-next-session action.

- [ ] **Step 1: Extend the router with param matching + unit-test it** — `tests/unit/client-router.test.ts` (or a pure-function test on the extracted `matchRoute(pattern, path)` helper if no jsdom test env is configured). **Check with Saurav first** whether his Task 15 has already landed this — reuse rather than duplicate.
- [ ] **Step 2: Build the views one route at a time**, verifying each in the browser against seeded data (seed via the Task 4/5 service snippet in Task 10 above, or curl). Keep each view file under ~200 lines; shared bits (option buttons, status badge) go in `client/src/ui.ts` (coordinate with Saurav's Task 15, which also touches `ui.ts`).
- [ ] **Step 3: Typecheck + lint after each view** — `npm run typecheck && npm run lint` → PASS.
- [ ] **Step 4: Playwright happy-path spec** `tests/e2e/practice-loop.spec.ts` — student joins course (pre-seeded via API in `beforeAll` using an instructor session), practices one question, sees feedback, misses one, finds it in the Review Book. Run: `npm run test:e2e -- tests/e2e/practice-loop.spec.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: student practice, review book, and session summary views (ST-P01..P11, ST-R05)"`

---

### Task 13: Layer-2 LLM mastery evaluator (PRD §9.2) — *"either" owner; slip candidate*

**Only pick this up if you are ahead of Saurav, and coordinate first** — it
modifies **your own** `attempts.service.ts` (Task 11), so there's no
cross-developer file conflict risk, but Saurav should know before you start
in case he's also considering it. Pre-approved to slip if not stable by Aug
9. Full task (job `mastery.evaluate`, cadence trigger at
`attemptsSinceEvaluation >= 5`, disengaged fast-track, safe-failure on
invalid JSON) is in the core document, Task 13.

---

### Task 16: Phase exit — end-to-end demo test and Approved-only serving proof — Stephen's share

**Joint sync point** — both developers participate; the demo is the phase
exit gate. Stephen typically drives the student-serving assertions:

- [ ] Write `tests/unit/approved-only-serving.test.ts` — drive `selectNextQuestion` (Task 10) and `submitAttempt` (Task 11) against fake collections seeded with questions in every one of the six publication states; assert only `approved` is ever selected across 50 randomized runs, and that submitting against a non-approved head throws `question-not-servable`.
- [ ] Provide the student half of `tests/e2e/core-loop-demo.spec.ts` — student enrolls with code → practices with adaptive feedback → a miss lands in the Review Book → re-practice updates mastery (assert LO status text changed), joined with Saurav's instructor half (course → material → generate/seed → approve → publish).
- [ ] Run the full gate together: `npm run lint && npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] Commit (joint) — `git commit -m "test: phase-1 exit — core-loop demo e2e and approved-only serving proof"`

---

## Stephen's exit checklist (Dev A slice of the phase exit criteria)

- [ ] Selection degradation ladder covered by jest (Task 10); feedback-strategy dispatch covered (Task 11); auth-gated student endpoints covered (Tasks 3, 11, 12).
- [ ] Every student answer writes exactly one `AttemptRecord` pinning version/LO/mode/strategy/paramValues (Task 11 tests).
- [ ] `/practice/next` never leaks `role`/`explanation`/correctness in its JSON (Task 11 dedicated walk-the-tree test).
- [ ] Approved-only serving proof passes against the real selection/attempts services (Task 16).
- [ ] Student practice e2e green (Task 14) and joint core-loop demo green (Task 16).
- [ ] Mid-phase checkpoint (~Aug 2) verified from the student side: an instructor-approved question actually reaches `selectNextQuestion`/`submitAttempt` end to end.

## Slip order (Stephen-relevant, lowest first)

1. Layer-2 mastery evaluator (Task 13) — only if picked up; Layer-1 stands alone.
2. Review Book sorts beyond theme/date (Task 12).
