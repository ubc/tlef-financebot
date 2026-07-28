# Saurav — Phase 2 progress

_Last updated: 2026-07-26_

**Tasks 1, 2 (instructor half), and 3 merged (PRs #27/#29, #28, #30). Task 6
code-complete, review approved, ready to push as a PR.**
Personal plan:
[`2026-07-23-phase-2-pilot-readiness-saurav.md`](2026-07-23-phase-2-pilot-readiness-saurav.md).
Executed with the superpowers `subagent-driven-development` skill; the running
ledger (commit ranges, review verdicts) is in the gitignored
`.superpowers/sdd/progress.md`.

## Stephen/Codex cross-owner Task 11 unblock — 2026-07-28

Stephen authorized Codex to take a minimal Saurav-owned dependency when it is
the only blocker, with status recorded before implementation. The first real
Task 11 flag-loop browser run found one such blocker in merged Task 3:
`createNotificationBell()` invokes its initial `poll()` before the wrapper is
attached to the document; `poll()` treats that normal construction state as a
teardown, clears its interval, and exits permanently. Stored standard/elevated
notifications therefore never appear in either shell.

Codex is taking only `client/src/notifications-bell.ts` to defer the first poll
until the wrapper has had a chance to connect. The new
`tests/e2e/flag-loop.spec.ts` is the regression proof. No notification service,
route, data contract, or other Saurav file is being modified; no confirmation
is required.

The Task 11 full-suite pass also showed five stale/ambiguous E2E specs.
Stephen/Codex has claimed `tests/e2e/{app,classes,instructor-pipeline,practice-loop,walking-skeleton}.spec.ts`
in its coordination ledger for test-only stabilization. Saurav need not act
or stop other work; no additional Saurav-owned production file is involved.

## How the Phase 2 split happened

Stephen proposed an ownership/dependency map and a P2-0 (persistent content
runs) contract on 2026-07-22, both as explicit cross-owner-review documents
(not implementation authorized on my side). On 2026-07-23 I reviewed both,
adopted the owner map as proposed with no changes, and integrated it into the
shared core plan
([`../2026-07-11-phase-2-pilot-readiness.md`](../2026-07-11-phase-2-pilot-readiness.md)):
added a "Phase 2 entry gate", "Owner map", and "Dependency graph" section, and
an `**Owner:**`/`**Reviewer:**` line on every task heading. My personal plan
above is the Dev B slice of that.

Stephen's source documents (unedited by me):
- [`../Stephen/2026-07-22-phase-2-ownership-dependency-proposal.md`](../Stephen/2026-07-22-phase-2-ownership-dependency-proposal.md)
- [`../Stephen/2026-07-22-p2-0-content-run-contract-proposal.md`](../Stephen/2026-07-22-p2-0-content-run-contract-proposal.md)
- [`../Stephen/2026-07-22-phase-2-review-improvements-stephen.md`](../Stephen/2026-07-22-phase-2-review-improvements-stephen.md)

## My owned tasks

| Task | What | Status | Blocked by |
|---|---|---|---|
| 1 | Flag service — state machine, auto-pause | **Merged** (PRs #27, #29 — `saurav/task-1-flag-service`) | nothing |
| 2 (my half) | Instructor flag-resolution queue | **Merged** (PR #28 — `saurav/task-2-flag-queue`) | nothing |
| 3 | In-app notifications, tiered | **Merged** (PR #30 — `saurav/task-3-notifications`) | nothing |
| 6 | Remediation report + checklist | **Code-complete, review approved** (`saurav/task-6-remediation`, commits `a5f56b1`+`20dc88f`+`8c3b6c3`) — not yet pushed as a PR | nothing |
| 8 | Question import (CSV/JSON/QTI) | not started | nothing |
| 9 | Parameterized-script migration | not started | Stephen's Tasks 4 + 5, my Task 8 |
| 10 | Custom-prompt generation/regeneration | not started | **P2-0 merge** (Stephen, in progress) |
| 11 | Phase exit — flag-loop E2E | not started | Joint; my Tasks 1/2/3/6 + Stephen's Task 2 half |

Recommended order and full rationale: see the personal plan's "Saurav's task
order" section.

## Deviations from the plan

### Task 6 — two scope additions approved mid-review, plus review fixes

**Scope additions (approved during review, now part of the task's contract):**

1. **`GET /api/flags/:flagId/remediation` + persisted
   `Flag.resolution.correctnessAffecting`.** The original design had the
   remediation report ride back only on the resolve response. Flags are
   terminal, so a page reload lost the report *and* the "Notify affected
   students" button permanently — making the pilot's one automated
   remediation action unreachable. The report is a read-only query and always
   regenerable; only the correctness-affecting bit needed persisting.
2. **Persisted `Flag.resolution.notifiedAt` / `notifiedCount`.** Once the
   panel survived reloads, the "already notified" state did not, so a reload
   re-armed the button and allowed re-sending the same in-app correction
   notice to the same students.

**Review findings, all fixed:** the report was discarded on the
partial-archive path (the §6.2 headline scenario produced zero deliverable);
suppressing the post-Correct navigate-to-editor left no route to the editor,
dropping a Task 2 behavior; the durable panel still vanished if the instructor
cleared the leftover flags, because the predicate read only the latest
resolution; an async re-render could silently untick "Correctness-affecting",
resolving without remediation (unrecoverable — flags are terminal); and the
notify fan-out used `Promise.all`, so one rejection discarded every successful
send and invited a double-notifying retry.

**Follow-up worth tracking (not Task 6's to fix):** this repo has no
client-side unit-test harness (`tests/unit/` is server-only; adding one needs
a jsdom project plus a `moduleNameMapper` for the client's `.js` import
extensions). Three review rounds disclosed the gap and two found real
unrecoverable-outcome bugs in exactly that untested layer — caught by review,
not by tests.

Full detail in the personal plan's Task 6 post-implementation note.

### Task 3 — found in review, fixed without a ruling (in-spec)

1. **`checkReviewBacklog` fired from a trigger causally unrelated to what it
   measures.** Originally called from `flagQuestion` (flag creation), but it
   counts questions in `pending-review` — a state flags never cause, so a
   backlogged course could go unnotified indefinitely. Moved to run
   unconditionally inside `runDailySummary`'s daily per-course sweep instead,
   independent of that loop's own nonzero gate for the summary notification.
2. **Three `notify()` calls could turn a committed domain write into a 500,**
   with `resolveFlag`'s retry not idempotent. Wrapped all three in
   try/catch-and-log; notifications are advisory and must never fail the
   operation that triggered them.
3. **No test pinned the puid-scoping security property** on the notification
   routes. Added `tests/unit/notifications.routes.test.ts` asserting the
   service always receives the session's puid, never one from request
   params/body.
4. **The 24h-dedup test only checked call counts,** not the actual CAS filter
   — strengthened to assert on the real `findOneAndUpdate` args.
5. **Notification rows were unclickable by keyboard** (`div` + `onclick`
   instead of the codebase's own `class-row--link` button convention). Fixed
   to a real `<button type="button">`, plus `aria-expanded`/count-aware
   `aria-label` on the bell.

Full detail, plus six accepted-Minor residuals (the most notable: panel
re-render now steals keyboard focus every 30s from a focused row, a side
effect of fix 5) and one self-noted non-review deviation (mark-read is
per-item, not per-panel-open), in the personal plan's Task 3
post-implementation note.

### Task 2 (instructor half) — found in review, fixed without a ruling (in-spec)

1. **Archive on a multi-flag group hit an unmapped, confusing error.** The
   brief's "one row per (question, version) group, act on the whole group"
   design (necessary since `listFlags` returns flat per-flag rows and there's
   no bulk-resolve endpoint) means Archive loops `resolveFlag` per flag in
   the group. The second call on an already-archived question throws
   `invalid-transition:archived->archived` — Task 1's write-ordering fix
   correctly leaves that flag untouched rather than corrupting it, but the
   raw error string reached the instructor with no explanation. Fixed with a
   narrow, exact-match translation for this one known failure mode; every
   other error still falls through unchanged.

**Branch note:** `saurav/task-2-flag-queue` is stacked on
`saurav/task-1-flag-service` (not yet merged) — same pattern as Phase 1's
Task 8 stacking on Task 7. Rebase onto `main` after PR #27 (Task 1) merges,
before merging PR for Task 2.

### Task 1 — found in review, fixed without a ruling (in-spec)

1. **Auto-pause formula's two arms were incorrectly coupled.** The brief's
   independent-arms formula `(attempts≥minAttempts AND flag%≥flagPercent) OR
   (flagCount≥flagCount)` was implemented as `attempts≥minAttempts AND
   (flag%≥flagPercent OR flagCount≥flagCount)` — gating the absolute-count arm
   behind the small-sample guard too. Caught in review (none of the 10
   required tests probed that quadrant); fixed to two genuinely independent
   arms, OR'd, with a new test covering the exposed case (low attempt count,
   absolute `flagCount` threshold met → should still pause).
2. **`resolveFlag` wrote the flag to a terminal state before the question-side
   consequence.** A failure on the question side (e.g. resolving a second
   flag with `action:'archive'` on an already-archived question throws
   `invalid-transition:archived->archived`) left the flag permanently marked
   resolved with the stated consequence never applied and no audit entry.
   Fixed: all three `resolveFlag` branches now apply the question-side
   consequence first and only write the flag's terminal state once it
   succeeds. One accepted-Minor residual: `archive`'s consequence-then-write
   ordering still has a narrow window if the question-side call succeeds but
   the subsequent flag write itself fails (retry then permanently throws) —
   consistent with other non-transactional write patterns already accepted
   elsewhere in this codebase (`transitionQuestion`'s own state-then-audit
   ordering), not fixed here.

## Not mine (Stephen's, Dev A) — tracked here only so nobody duplicates them

- **P2-0** (persistent content runs + SSE) — code-complete on
  `codex/phase-2-content-runs`, **not merged**. I am review/integration owner
  only. Read the contract fully before Task 10; raise objections at PR review.
- Task 2 — student flag control half (practice view button).
- Task 4 — parameterized execution sandbox.
- Task 5 — parameterization config + serve-time randomization.
- Task 7 — progression recommendations + repeated-failure redirect.

## Open items carried from Phase 1 (not re-litigated here)

- **Task 13** (Layer-2 mastery evaluator) — recorded slipped per Stephen's
  2026-07-22 closeout decision. Not part of Phase 2.
- **Task 16** (Phase 1 exit demo) — deferred by Stephen, doesn't block Phase 2
  start, but the Phase 1 exit gate isn't claimed until it runs.
- **Phase 1 S0** (reconcile `Saurav/STATUS.md`, `PHASE-1-UI-HANDOFF.md`, and
  the Phase 1 core plan's Task 7/8/15 checkboxes against merged PRs #19–21) —
  still owed. Deliberately deferred: 2026-07-23 direction was to do the Phase
  2 split first and reconcile Phase 1 status after some Phase 2 work lands.

## What's left

- Push **Task 6** as a PR (`saurav/task-6-remediation`).
- Start **Task 8** (question import) — independent of the flag/notification
  arc, nothing blocks it.
- Watch for **P2-0's PR** — Task 10 is blocked until it merges and
  `docs/api-contract.md` reflects the new `runId`/SSE shapes.
- Watch for Stephen's **Tasks 4/5** merging — Task 9 is blocked until then.
- Still owe: Phase 1 S0 reconciliation (see above).

## What I need from Stephen

Nothing blocking right now. Heads-up items:

1. Task 3 (notifications) is merged — his Task 7 redirect notification can now
   code against the real `notify()` rather than a stub.
2. Task 6 adds three optional fields to `Flag.resolution`
   (`correctnessAffecting`, `notifiedAt`, `notifiedCount`) and one route
   (`GET /api/flags/:flagId/remediation`) — worth a look at PR review since
   his Task 2 student half reads flag shapes.
3. When P2-0 opens as a PR, flag it explicitly — Task 10 starts the same day.
4. When Tasks 4/5 merge, flag it — Task 9 starts the same day.
