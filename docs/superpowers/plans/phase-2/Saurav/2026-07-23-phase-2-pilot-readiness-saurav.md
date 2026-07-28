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
- **P2-0** — persistent content runs + live progress (SSE), merged in PR #32.
  I am the **review/integration owner**, not the implementer — consume its real
  run/SSE contract and never implement a parallel content-run model.
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
- [x] **P2-0 merged in PR #32** — Task 10 is unblocked.
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
5. **Task 8** (question import) — complete by Stephen/Codex on PR #39.
6. **Task 9** (script migration) — Task 4 is merged; wait for Task 5 PR #34
   and Task 8 PR #39 to merge because it extends their files/interfaces.
7. **Task 10** (custom-prompt generation/regeneration) — unblocked by merged
   P2-0 PR #32; consume the real durable run/SSE contract.
8. **Task 11** (phase exit, joint) — complete on PR #38 with the
   instructor-side queue/notification/resolution path covered.

## Coordination with Stephen (Dev A)

**Cross-developer dependencies:**

| Dependency | Direction | Effect |
|---|---|---|
| **Task 1 (flags)** | Saurav → Stephen's Task 2 (student flag control) | The student "Flag this question" button posts to `POST /api/questions/:questionId/flag` — merge Task 1 early so Stephen codes against the real route, not a stub. |
| **Task 3 (notifications)** | Saurav → Stephen's Task 7 (redirect) | Stephen's repeated-failure redirect emits `notify(kind: 'redirect')` — merge Task 3 before he needs it. |
| **P2-0 (Stephen)** | Stephen → Saurav's Task 10 | Fulfilled by PR #32: custom generation builds on run state (`runId`/SSE), not the old `jobId` poll. |
| **Task 4 + 5 (Stephen)** | Stephen → Saurav's Task 9 | Task 4 merged in PR #33; wait for Task 5 PR #34 before script migration. |
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

- [x] **Step 1: Implement the instructor surface** (follow the Phase-1 instructor view patterns from `views/instructor/review-queue.ts`).
- [x] **Step 2: Verify in browser**; `npm run typecheck && npm run lint` → PASS. (No live stack available — typecheck/lint verified; live-browser check deferred to the ~joint checkpoint pattern used in Phase 1.)
- [x] **Step 3: Commit** — `git commit -m "feat: instructor flag-resolution queue (Task 2, instructor half)"`

**Post-implementation note (2026-07-23, subagent-driven-development, review clean after one fix round):**
rows are grouped client-side by `questionVersionId` (one row per question+
version, `listFlags` returns flat per-flag records); Correct/Archive/Clear act
on the whole group via a sequential per-flag `resolveFlag` loop (no bulk-
resolve endpoint exists). Review caught one real UX gap: archiving a group
with 2+ open flags on the same question — the first resolve succeeds
(question archived), the second throws `invalid-transition:archived->archived`
(Task 1's own fixed write-ordering correctly leaves that second flag
untouched, not corrupted) — and the raw error string was shown to the
instructor with no explanation. Fixed: a narrow, exact-match translation for
this one known failure mode ("N of M flag(s) resolved; the question was
already archived. Use Clear to close the remaining flag(s).") while every
other error still falls through to the unchanged raw-message fallback.
Accepted Minor: that translation is coupled to the server's exact error
string and fails safe (reverts to the old raw message) if that string ever
changes — not fixed now, noted for whoever next touches
`flags.service.ts`'s error strings.

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

- [x] **Step 1: Failing tests** — the four cases in the core document, Task 3 Step 1 (staff targeting, elevated priority on auto-pause, daily-summary quiet-day-sends-nothing, backlog not repeated within 24h).
- [x] **Step 2–4: FAIL → implement (service, routes, wiring, client bell) → PASS.**
- [x] **Step 5: Commit** — `git commit -m "feat: tiered in-app notifications with polling, auto-pause elevation, and daily batched summary (§4.3)"`

**Post-implementation note (2026-07-24, subagent-driven-development, review found 5 Important, all fixed, re-review clean):**

`notificationsCol()` and the `Notification` type were already in place from
earlier work (collections.ts, types/domain.ts) — this task built
`notifications.service.ts`, `notifications.routes.ts`, the three
`flags.service.ts` wiring points, the `registerNotificationJobs()` recurring
job, `Course.reviewBacklogThreshold`/`lastBacklogNotifiedAt`, and the client
bell.

First review pass (5 Important, no Critical):
1. **`checkReviewBacklog` was triggered from the wrong place.** It was called
   from `flagQuestion` (flag creation) but counts questions in
   `pending-review` — a state flags never cause. A course could sit over
   threshold indefinitely and never notify unless someone happened to also
   flag something unrelated. The accompanying comment additionally
   misattributed this trigger choice to "the phase-2 plan," which doesn't
   specify one. Fixed: moved to run unconditionally inside
   `runDailySummary`'s per-course loop (which already sweeps every course
   daily), independent of that loop's own "only if nonzero" gate for the
   summary notification itself. The 24h atomic CAS dedup is unchanged by the
   move.
2. **A notification failure could turn a committed domain operation into a
   500, and `resolveFlag`'s retry wasn't idempotent.** All three
   `notify()`/`notifyCourseStaff()` call sites in `flags.service.ts` ran
   after the domain write (flag insert, auto-pause transition, flag
   resolution + audit) had already committed. Fixed: each wrapped in
   try/catch that logs and swallows — notifications are advisory and must
   never fail the operation that triggered them.
3. **No route-level test pinned the puid-scoping security property** — the
   one property this task actually needs guaranteed (a user can only ever
   read/mark-read their own notifications; the three routes take no
   course-scoped URL segment). Added `tests/unit/notifications.routes.test.ts`
   following the `notes.route.test.ts` gated-route pattern, asserting the
   service is always called with the *session's* puid, never one from
   request params/body.
4. **The 24h-dedup test only asserted call counts**, not the actual CAS
   filter/update shape — it would still have passed with the atomic filter
   deleted entirely. Strengthened to inspect the real `findOneAndUpdate`
   args.
5. **Notification rows were `div`s with `onclick`** — not keyboard-operable,
   against this codebase's own convention (`classes.ts`'s `class-row--link`
   button). Fixed to a real `<button type="button">` with matching CSS reset,
   plus `aria-expanded` and a count-aware `aria-label` on the bell button.

Re-review: all 5 verified fixed in substance (not just claimed), no
regressions, task quality **Approved**. Six Minor items accepted, not fixed
(none block merge; noted for a future pass if this widget gets touched
again): keyboard focus is now lost on every 30s panel re-render while a row
is focused (a side effect of Fix 5 making rows focusable — the poll's
unconditional `renderPanel()` should skip while the panel contains
`document.activeElement`); `<p>`/`<div>` nested inside the new `<button>`
(invalid content model, harmless in practice — swap for `<span>`s); unread/
elevated state is visual-only in the accessibility tree (fold into the row's
accessible name); the unread badge isn't `aria-hidden` so its count is
announced twice; `runDailySummary`'s per-course loop has no per-course
failure isolation (pre-existing shape, widened slightly by adding
`checkReviewBacklog`'s extra queries to every iteration); and the 24h backlog
cooldown exactly equals the daily job's own interval, so a run landing
marginally early can make the backlog notification effectively fire every
other day rather than every day — still within the "at most once per 24h"
spec, just tighter than intended.

One further deviation, not raised as a review finding (self-noted): the brief
says "mark-read on open"; the implementation marks read on clicking an
*individual* notification, not on opening the panel — deliberate, so a quick
glance at the bell doesn't silently clear items the user hasn't actually
read. Flagged by the first reviewer as a Minor "Misunderstood" and judged
defensible rather than fixed.

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

- [x] **Step 1: Failing tests** — report counts only attempts pinned to the exact version; the notify button notifies each distinct affected student once.
- [x] **Step 2–4: FAIL → implement → PASS.**
- [x] **Step 5: Commit** — `git commit -m "feat: correctness-affecting flag remediation report and student correction notices (§6.2 pilot scope)"`

**Post-implementation note (2026-07-26, subagent-driven-development, three review rounds, approved):**

The brief was underspecified in several places; I resolved these as controller
before dispatch, and they are now part of the task's effective contract:
`examAttempts` counts affected attempts with `examAttemptId` set (via
`attemptsCol()`, not a separate `examAttemptsCol()` query); `masteryCol()` is
unused by design (the specified return shape has no mastery number and
`MasteryProfile` is an LO-level rollup with no per-version field, so that step
stays manual checklist text); `notify(kind: 'correction')` uses
`priority: 'standard'`, since Global Constraints reserve `elevated` for
auto-pause; the checklist renders once per group and notify fires once per
group, per Task 2's `questionVersionId` grouping; and the report computation is
wrapped so it can never fail an already-committed resolution (the notify
button, being an explicit user action, does surface its failures).

**Two scope additions approved mid-review** — both fix the same class of
problem, that a §6.2 deliverable existed only in client memory:

1. **`GET /api/flags/:flagId/remediation` + `Flag.resolution.correctnessAffecting`.**
   The original design had the report ride back only on the resolve response.
   Flags are terminal, so after a reload the report — and the "Notify affected
   students" button with it — was gone permanently, making the pilot's one
   automated remediation action unreachable. The report is a pure read-only
   query over `questionVersionId` and so always regenerable; only the
   "was this marked correctness-affecting?" bit needed persisting.
2. **`Flag.resolution.notifiedAt` / `notifiedCount`.** Once the panel survived
   reloads, the "already notified N students" state did not, so a reload
   re-armed the button and allowed re-sending the same in-app correction notice
   to the same students. Now stamped server-side across every
   correctness-affecting flag in the group after a successful fan-out.

Review findings, all fixed: the report was discarded on the partial-archive
path (`invalid-transition:archived->archived` on a multi-flag group — the §6.2
headline scenario, which produced zero deliverable); suppressing the
post-Correct navigate-to-editor left no route to the editor at all, dropping a
behavior Task 2 specified; the durable panel then vanished anyway if the
instructor cleared the leftover flags, because the predicate read only the
*latest* resolution rather than any of them; an async re-render could silently
untick "Correctness-affecting", resolving without remediation (unrecoverable,
since flags are terminal); the notify fan-out used `Promise.all`, so one
rejection discarded every successful send and invited a double-notifying
retry; and the headline version-exclusion test used `objectContaining`, which
would have passed against the exact over-broad query it claimed to guard.

Accepted, not fixed: `correctnessChecked` is never cleared, so a *new* flag
landing on the same version can render a pre-ticked checkbox — the obvious fix
(clearing it on resolve) would re-create the partial-archive bug, so it needs
the narrower "only when the group has no open flags left" condition; and the
notify stamp is not transactional with the fan-out, consistent with this
file's other non-transactional write patterns.

**Follow-up worth tracking (not this task's to fix):** there is no client-side
unit-test harness in this repo — `tests/unit/` is server-only, and adding one
needs a jsdom project plus a `moduleNameMapper` for the client's `.js` import
extensions. Three consecutive review rounds disclosed this gap, and two of them
found real unrecoverable-outcome bugs (the latest-resolution predicate and the
checkbox reset) in exactly that untested layer. Both were caught by review
rather than by tests, which is not a repeatable safety net.

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

- [x] **Step 1: Create the three fixtures** per the core document, Task 8 Step 1 (5 items each; one broken item; JSON uses one `type: 'other'` item for auto-conversion).
- [x] **Step 2: Failing tests** — the five cases in the core document, Task 8 Step 2.
- [x] **Step 3–5: FAIL → implement (service, routes, view) → PASS.** Completed by Stephen/Codex under the recorded 2026-07-28 takeover. Focused 2 suites / 15 tests, full 52 suites / 548 tests, typecheck/lint/build, and a real SAML instructor browser import all passed; fixture cleanup assertions were zero.
- [x] **Step 6: Commit** — `2d3313e` (`feat: CSV/JSON/QTI import with preview, partial success, auto-conversion, and parameterization flags (IN-Q01)`), PR #39.

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
**Depends on:** **P2-0 merged in PR #32**. Read
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

- [x] **Step 1: Failing tests** — @-mention filters retrieval to the named material; regenerate never mutates the original; the recorded prompt round-trips onto the created Draft.
- [x] **Step 2–4: FAIL → implement (against the merged P2-0 run/SSE contract) → PASS.**
- [x] **Step 5: Commit** — `git commit -m "feat: custom-prompt generation with @-mentions and side-by-side regeneration (IN-Q11/Q12)"`

**Cross-owner completion note (2026-07-28):** Stephen/Codex completed Task 10
after recording the takeover in both status files. The existing
`preseeding.ts` page was extended rather than duplicating its custom form and
P2-0 stream in `generate.ts`. Exact ready/assigned material mentions, server
presets, transient side-by-side regeneration, and explicit versioned Replace
are covered by focused service/route tests and a real-session browser
regression. No separate polling/progress model was added.

---

### Task 11: Phase exit — flag-loop E2E (joint)

**Owner:** Joint — Stephen drives `tests/e2e/flag-loop.spec.ts`; my share is verifying the instructor/AI side of the loop.
**Depends on:** My Tasks 1, 2, 3, 6 merged; Stephen's Task 2 student-control half merged.

- [x] **Step 1: Participate in the spec run** — the PR #38 real-SAML flow covers the instructor standard/elevated notifications, grouped flag queue, Clear resolution, serving restoration, and student resolution notice.
- [x] **Step 2: Full suite green** — 53 Jest suites / 583 tests, typecheck/lint/build, and 12 current Playwright scenarios passed; the existing opt-in live-LLM scenario skipped.
- [x] **Step 3: Confirm commit** — Stephen/Codex implementation `4422d20`, PR #38; instructor-path evidence recorded in both status files.

---

## What's deliberately not started yet

- **Task 10 is now unblocked** by merged P2-0 PR #32.
- **Task 9** waits for Task 5 PR #34 and Task 8 PR #39 to merge.
- **Phase 1 S0** (status-doc reconciliation) is intentionally deferred until
  after this planning pass, per 2026-07-23 direction — tracked separately in
  [`../../phase-1/Saurav/STATUS.md`](../../phase-1/Saurav/STATUS.md).
