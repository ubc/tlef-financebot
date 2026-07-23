# Phase 2 — Pilot Readiness — Saurav (Dev B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Progress tracking (do this, it is not automatic):** the moment a task's review comes back clean and its commit is made, edit this file to change that task's `- [ ]` to `- [x]`, then commit the checkbox change. Also mirror the checkbox into the core document [`../2026-07-11-phase-2-pilot-readiness.md`](../2026-07-11-phase-2-pilot-readiness.md) so Stephen's agent sees it. Run `npm run sync-plans -- Saurav` after.

This is **Saurav's** personal plan: the Dev B slice of the core phase document
[`../2026-07-11-phase-2-pilot-readiness.md`](../2026-07-11-phase-2-pilot-readiness.md),
per the owner map Stephen proposed
([`../Stephen/2026-07-22-phase-2-ownership-dependency-proposal.md`](../Stephen/2026-07-22-phase-2-ownership-dependency-proposal.md))
and integrated into the core document on 2026-07-23. Task numbers match the
core document.

**Not in this plan** (Stephen's, Dev A):
- **P2-0** — persistent content runs + live progress (SSE). Code-complete on
  `codex/phase-2-content-runs`, not yet merged. I am the **review/integration
  owner**, not the implementer — read the contract, raise concrete objections
  at PR review, never implement a parallel content-run model.
- **Task 2 — student flag control half** (practice view "Flag this question"
  button). I own only the instructor resolution-queue half (see Task 2 below).
- **Task 4** — parameterized execution sandbox (`worker_threads`).
- **Task 5** — parameterization config + serve-time randomization.
- **Task 7** — progression recommendations + repeated-failure redirect.

Never start, edit, or "helpfully fix" any of the above without flagging it to
Stephen first — same convention as Phase 1.

**Goal:** Saurav's half of pilot readiness: the flag service and its state
machine, the instructor side of flag resolution, tiered in-app notifications,
correctness-affecting remediation, question import (CSV/JSON/QTI), migration
of existing parameterized scripts, and custom-prompt generation/regeneration
— such that an instructor can see and resolve student flags with proper
notification and remediation, and bulk-load/generate content beyond the
three-agent pipeline alone.

**Architecture:** Same routes → services → components pattern as Phase 1,
consuming Phase 0/1 domain types and collection accessors. Flags and
notifications are new services; import and custom generation extend the
existing content-authoring surface. Task 9 (script migration) and Task 10
(custom generation) both cross into Stephen's arc — Task 9 consumes his
sandbox/params service, Task 10 consumes his P2-0 run infrastructure.

**Tech Stack:** as Phase 1, plus `csv-parse` (Task 8 CSV import) and
`fast-xml-parser` (Task 8 QTI import, slippable per the core doc's slip order).

## Global Constraints

- Everything in the Phase 0 and Phase 1 plans' Global Constraints still applies.
- Flags attach to a specific `questionVersionId`, never just the Question (PRD §6.2).
- Auto-pause: `(attempts ≥ course.autoPause.minAttempts AND flag% ≥ course.autoPause.flagPercent) OR (flagCount ≥ course.autoPause.flagCount)` — both instructor-configurable (PRD §4.3; defaults 5 / 30 / 15).
- Every flag resolution requires instructor sign-off; resolutions are `correct | archive | clear` (PRD §4.3).
- Notifications are in-app only, delivered by client polling; three tiers: standard, elevated (auto-pause), daily batched summary sent **only** when there was activity (PRD §4.3).
- Correctness-affecting flag resolutions use a **manual remediation checklist** for the pilot; automation is on the slip list (§6.2).
- Contract changes (`docs/api-contract.md`) go through two-developer PR review first — this applies doubly here since Task 9/10 touch Stephen's owned interfaces.

## Entry gate status (as of 2026-07-23)

- [x] Phase 1 S1 (strict grounding) and S2 (transition CAS) merged, PR #25.
- [x] Phase 1 Task 13 recorded slipped.
- [ ] Phase 1 Task 16 — deferred by Stephen, not blocking Phase 2 start, but still owed.
- [ ] **P2-0 not yet merged** — blocks starting Task 10 (see task order below).
- [ ] Phase 1 S0 docs reconciliation — still owed, tracked in [`../../phase-1/Saurav/STATUS.md`](../../phase-1/Saurav/STATUS.md) "What's left", deliberately deferred until after this planning pass per 2026-07-23 direction.

## Saurav's task order (Dev B)

1. **Task 1** (flag service) — foundational; front-load, same as Phase 1's
   Tasks 2/4. Unblocks Stephen's Task 2 student-control half, my own Task 2
   instructor half, Task 3, Task 6, and Task 11.
2. **Task 3** (notifications) — needs Task 1 (emits on flag + auto-pause).
   Front-load this too — it unblocks Task 6 and Stephen's Task 7 redirect
   notification.
3. **Task 2** (instructor resolution queue, my half) — needs Task 1's routes;
   benefits from Task 3 being live so resolutions can show/trigger
   notifications, but not hard-blocked on it.
4. **Task 6** (remediation) — needs Task 3's `notify()`.
5. **Task 8** (question import) — independent of the flag/notification arc;
   can run in parallel with 1/3 if useful, but sequenced after here to keep
   one arc at a time.
6. **Task 9** (script migration) — **blocked on Stephen's Tasks 4 (sandbox)
   and 5 (params service) merging**, and needs my own Task 8 merged (both
   touch `import.service.ts`).
7. **Task 10** (custom-prompt generation/regeneration) — **blocked on P2-0
   merging** (Stephen, in progress on `codex/phase-2-content-runs`). Do not
   start early against a guessed contract — the generation UI must consume
   run state, not a second ad hoc poll.
8. **Task 11** (phase exit, joint) — last; needs my Tasks 1, 2, 3, 6 merged
   plus Stephen's Task 2 student-control half. Stephen drives
   `flag-loop.spec.ts`; I verify the instructor/AI side (queue, resolution,
   remediation notice) and participate in the run.

## Coordination with Stephen (Dev A)

**Cross-developer dependencies:**

| Dependency | Direction | Effect |
|---|---|---|
| **Task 1 (flags)** | Saurav → Stephen's Task 2 (student flag control) | The student "Flag this question" button posts to `POST /api/questions/:questionId/flag` — merge Task 1 early so Stephen codes against the real route, not a stub. |
| **Task 3 (notifications)** | Saurav → Stephen's Task 7 (redirect) | Stephen's repeated-failure redirect emits `notify(kind: 'redirect')` — merge Task 3 before he needs it. |
| **P2-0 (Stephen)** | Stephen → Saurav's Task 10 | Custom generation must be built on run state (`runId`/SSE), not the old `jobId` poll. Do not start Task 10 until P2-0 merges and `docs/api-contract.md` reflects it. |
| **Task 4 + 5 (Stephen)** | Stephen → Saurav's Task 9 | Script migration validates through Stephen's sandbox and consumes his params service — wait for both merged. |
| **`docs/api-contract.md`** | either → both | Any change is a two-developer PR review, never ad hoc. |

**Sync points (pause and involve Stephen):**
1. **P2-0 contract review** — async, non-blocking per Stephen's explicit
   override, but read
   [`../Stephen/2026-07-22-p2-0-content-run-contract-proposal.md`](../Stephen/2026-07-22-p2-0-content-run-contract-proposal.md)
   in full before starting Task 10 and raise any objection at PR review.
2. **Task 2 split** — my instructor-queue half and Stephen's student-control
   half are one shared feature but independently reviewable; don't edit his
   `practice.ts` changes opportunistically, and expect to integrate/test
   together once both land.
3. **Any change to `docs/api-contract.md`** — two-developer PR review.
4. **Task 11 (flag-loop exit)** — joint; both developers participate.

**Workflow:** run `npm run sync-plans -- Saurav` before and after each work
session; keep the checkboxes in this file (and mirrored in the core doc)
honest against `git log`.

---

### Task 1: Flag service — student flagging + flag state machine (ST-P09, §6.2)

**Owner:** Dev B (Saurav) · **Reviewer:** Dev A (Stephen)

**Files:**
- Create: `server/src/services/flags.service.ts`, `server/src/routes/flags.routes.ts`
- Modify: `server/src/app.ts` (mount router — append-only)
- Test: `tests/unit/flags.service.test.ts`

**Interfaces:**
- Consumes: `flagsCol()`, `questionsCol()`, `attemptsCol()`, `coursesCol()`, `auditCol()`; `transitionQuestion` (Phase 1 Task 4); notifications service (Task 3 — inject via a callback parameter until Task 3 lands, then wire directly).
- Produces: `flagQuestion`, `FLAG_TRANSITIONS`/`canFlagTransition`, `checkAutoPause`, `resolveFlag`, `listFlags`. Full signatures, the auto-pause threshold formula, and the resolution-consequence mapping are in the core document, Task 1 Interfaces.
- Routes: `POST /api/questions/:questionId/flag` (student-guarded), `GET /api/courses/:courseId/flags?state=`, `POST /api/flags/:flagId/resolve` (instructor-guarded).

- [x] **Step 1: Write the failing tests** — the ten cases in the core document, Task 1 Step 1 (idempotent re-flag; auto-pause percentage/small-sample-guard/absolute arms; configurable thresholds; resolve clear/archive/invalid-transition).
- [x] **Step 2: Run to verify FAIL** — `npx jest tests/unit/flags.service.test.ts`.
- [x] **Step 3: Implement** service and routes per the core document, Task 1 Step 3. Call `checkAutoPause` from `flagQuestion` after each new flag.
- [x] **Step 4: Tests + typecheck PASS.**
- [x] **Step 5: Commit** — `git commit -m "feat: student flagging, flag state machine, and configurable auto-pause (ST-P09, §4.3, §6.2)"`

**Post-implementation note (2026-07-23, subagent-driven-development, review clean after one fix round):**
the first review pass caught two real correctness gaps beyond the 10 required
tests: (1) the auto-pause formula's absolute `flagCount` arm was incorrectly
gated behind the `minAttempts` small-sample guard — the spec's two arms are
independent, OR'd; (2) `resolveFlag` wrote the flag to a terminal state
*before* the question-side consequence, so a failure on that side (e.g.
resolving a second flag on an already-archived question) left the flag
permanently marked resolved with no audit entry and no consequence applied.
Both fixed (commit `590ea94`): the formula now computes its two arms
independently, and all three `resolveFlag` branches apply the question-side
consequence first, writing the flag's terminal state only after it succeeds.
Added test coverage for the previously-untested `correct`-un-pause and
`clear`-re-evaluation branches. One accepted Minor carried forward: the
`archive` branch has a narrow partial-failure window if `transitionQuestion`
succeeds but the subsequent flag write fails (retry then permanently throws
`invalid-transition:archived->archived`) — consistent with other
non-transactional write patterns already accepted elsewhere in this codebase
(e.g. `transitionQuestion`'s own state-then-audit ordering).

---

### Task 2 (my half): Instructor flag-resolution queue

**Owner:** Dev B (Saurav) — student flag control is Stephen's half; see the core document's Task 2 for the combined feature and the coordination note above.
**Reviewer:** Dev A (Stephen)
**Depends on:** Task 1 merged.

**Files:**
- Create: `client/src/views/instructor/flags.ts`
- Modify: client router/instructor nav

**Interfaces:**
- Consumes: Task 1's `GET /api/courses/:courseId/flags` and `POST /api/flags/:flagId/resolve`.
- Produces: instructor flag queue showing question content, reason, date, flag count per version, with Correct / Archive / Clear actions — Correct opens the existing question editor first, then resolves (per the core document, Task 2).

- [ ] **Step 1: Implement the instructor surface** (follow the Phase-1 instructor view patterns from `views/instructor/review-queue.ts`).
- [ ] **Step 2: Verify in browser**; `npm run typecheck && npm run lint` → PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat: instructor flag-resolution queue"`

> **After merge:** confirm with Stephen that his student-control half posts to
> the same flag/resolve routes and that both surfaces read consistent state.

---

### Task 3: In-app notification system with tiering (PRD §4.3, §9.1)

**Owner:** Dev B (Saurav) · **Reviewer:** Dev A (Stephen)
**Depends on:** Task 1 merged.

**Files:**
- Create: `server/src/services/notifications.service.ts`, `server/src/routes/notifications.routes.ts`
- Modify: `server/src/services/flags.service.ts` (emit on flag + auto-pause), `server/src/app.ts`, `server/src/server.ts` (recurring jobs)
- Test: `tests/unit/notifications.service.test.ts`

**Interfaces:**
- Consumes: `notificationsCol()`, `flagsCol()`, `questionsCol()`, `usersCol()`, `coursesCol()`; jobs component (Phase 1 Task 1).
- Produces: `notify`, `notifyCourseStaff`, the emission wiring (new flag → standard; auto-pause → elevated; flag resolved → standard to flagging student; review-backlog threshold), and the `notifications.daily-summary` recurring job. Full signatures and the wiring table are in the core document, Task 3 Interfaces.
- Routes: `GET /api/notifications?unreadOnly=`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.
- Client: a bell in the top bar polling every 30s; elevated notifications styled distinctly.

- [ ] **Step 1: Failing tests** — the four cases in the core document, Task 3 Step 1 (staff targeting, elevated priority on auto-pause, daily-summary quiet-day-sends-nothing, backlog not repeated within 24h).
- [ ] **Step 2–4: FAIL → implement (service, routes, wiring, client bell) → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: tiered in-app notifications with polling, auto-pause elevation, and daily batched summary (§4.3)"`

---

### Task 6: Instructor flag resolution + manual remediation checklist (IN-Q06, §6.2)

**Owner:** Dev B (Saurav) · **Reviewer:** Dev A (Stephen)
**Depends on:** Task 3 merged (`notify()`).

**Files:**
- Modify: `server/src/services/flags.service.ts` (correctness-affecting path), `client/src/views/instructor/flags.ts`
- Create: `server/src/services/remediation.service.ts`
- Test: `tests/unit/remediation.service.test.ts`

**Interfaces:**
- Consumes: `attemptsCol()`, `reviewBookCol()`, `masteryCol()`, notifications service.
- Produces: `remediationReport(questionVersionId)` — locates AttemptRecords pinned to the wrong version; the rest is a guided manual checklist rendered client-side when a resolution is marked "correctness-affecting", per the core document, Task 6.

- [ ] **Step 1: Failing tests** — report counts only attempts pinned to the exact version; the notify button notifies each distinct affected student once.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: correctness-affecting flag remediation report and student correction notices (§6.2 pilot scope)"`

---

### Task 8: Question import — CSV/JSON/QTI with preview and partial success (IN-Q01)

**Owner:** Dev B (Saurav) · **Reviewer:** Dev A (Stephen)

**Files:**
- Create: `server/src/services/import.service.ts`, `server/src/routes/import.routes.ts`, `client/src/views/instructor/import.ts`
- Create: `tests/fixtures/import-sample.csv`, `tests/fixtures/import-sample.json`, `tests/fixtures/import-sample-qti.xml`
- Modify: `server/src/app.ts`
- Test: `tests/unit/import.service.test.ts`

**Interfaces:**
- Consumes: `csv-parse/sync`, `fast-xml-parser`; `createQuestion` (Phase 1 Task 4); llm component (auto-conversion).
- Produces: `parseImport`, the `parameterizable` heuristic, `commitImport`. Column/shape specs and the auto-conversion rule are in the core document, Task 8 Interfaces.
- Routes: `POST /api/courses/:courseId/import/preview`, `POST /api/courses/:courseId/import/commit`.

- [ ] **Step 1: Create the three fixtures** per the core document, Task 8 Step 1 (5 rows each; one broken row; one `type: 'other'` item for auto-conversion).
- [ ] **Step 2: Failing tests** — the five cases in the core document, Task 8 Step 2.
- [ ] **Step 3–5: FAIL → implement (service, routes, view) → PASS.**
- [ ] **Step 6: Commit** — `git commit -m "feat: CSV/JSON/QTI import with preview, partial success, auto-conversion, and parameterization flags (IN-Q01)"`

*Slip note (core doc #2): if the week is tight, drop QTI — delete only the QTI branch and fixture.*

---

### Task 9: Parameterized-script migration (IN-Q10 tail)

**Owner:** Dev B (Saurav) · **Reviewer:** Dev A (Stephen)
**Depends on:** Stephen's Tasks 4 (sandbox) and 5 (params service) merged; my Task 8 merged (shares `import.service.ts`).

**Files:**
- Modify: `server/src/services/import.service.ts` + `import.routes.ts` (script upload path), `client/src/views/instructor/import.ts`
- Test: `tests/unit/script-migration.test.ts`

**Interfaces:**
- Consumes: Stephen's Task 4 sandbox (`executeGenerate`) and Task 5 params service; `createQuestion`.
- Produces: `migrateScript` — validates the script in the sandbox, maps it onto a question template, presents for review, then enters as a parameterized Draft with `generateScript` set. Full signature in the core document, Task 9 Interfaces.

- [ ] **Step 1: Failing tests** — valid script yields sampleValues; mismatch list on vars/placeholder mismatch without inserting; sandbox rejection surfaces as a clean 400.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: existing parameterized-script migration into parameterized Drafts (IN-Q10)"`

---

### Task 10: Custom-prompt generation + regeneration (IN-Q11, IN-Q12) — *first to slip*

**Owner:** Dev B (Saurav) · **Reviewer:** Dev A (Stephen)
**Depends on:** **P2-0 merged** — do not start before this. Read
[`../Stephen/2026-07-22-p2-0-content-run-contract-proposal.md`](../Stephen/2026-07-22-p2-0-content-run-contract-proposal.md)
in full first; the generation enqueue response and progress model will have
changed from Phase 1's `{ jobId }` to `{ runId }` + SSE.

**Files:**
- Modify: `server/src/services/generation.service.ts`, `server/src/routes/generation.routes.ts`
- Create: `client/src/views/instructor/generate.ts`
- Test: `tests/unit/custom-generation.test.ts`

**Interfaces:**
- Consumes: Phase 1 Task 8 pipeline (now running through P2-0's run model); `materialsCol()`.
- Produces: @-mention resolution, `PRESET_PROMPTS` + `GET /api/generation/presets`, `regenerateQuestion` (side-by-side preview, no autosave). Full signatures in the core document, Task 10 Interfaces — **note the response/progress shape there predates P2-0 and must be reconciled with the merged P2-0 contract before implementing**, not followed verbatim.

- [ ] **Step 1: Failing tests** — @-mention filters retrieval to the named material; regenerate never mutates the original; the recorded prompt round-trips onto the created Draft.
- [ ] **Step 2–4: FAIL → implement (against the merged P2-0 run/SSE contract) → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: custom-prompt generation with @-mentions and side-by-side regeneration (IN-Q11/Q12)"`

---

### Task 11: Phase exit — flag-loop E2E (joint)

**Owner:** Joint — Stephen drives `tests/e2e/flag-loop.spec.ts`; my share is verifying the instructor/AI side of the loop.
**Depends on:** My Tasks 1, 2, 3, 6 merged; Stephen's Task 2 student-control half merged.

- [ ] **Step 1: Participate in the spec run** — student flags → instructor sees standard notification + flag in queue → auto-pause fires → instructor sees elevated notification → question stops serving → instructor resolves "clear" → question serves again → flagging student sees flag-resolved notification. Verify the instructor-side assertions (queue content, resolution actions, remediation notice path) match what Task 2/6 actually built.
- [ ] **Step 2: Full suite green** — `npm run lint && npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 3: Confirm commit** — Stephen commits the spec; I confirm the instructor-path assertions before sign-off.

---

## What's deliberately not started yet

- **Task 10** cannot start until P2-0 merges — do not build against a guessed
  contract even though the proposal is detailed; Stephen may still change
  specifics during his own PR review.
- **Task 9** cannot start until Stephen's Tasks 4/5 merge.
- **Phase 1 S0** (status-doc reconciliation) is intentionally deferred until
  after this planning pass, per 2026-07-23 direction — tracked separately in
  [`../../phase-1/Saurav/STATUS.md`](../../phase-1/Saurav/STATUS.md).
