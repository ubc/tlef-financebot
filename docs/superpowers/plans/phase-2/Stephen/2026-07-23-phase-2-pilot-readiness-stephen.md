# Phase 2 — Pilot Readiness — Stephen (Dev A) Implementation Plan

> **DRAFT — written by Saurav's agent session on 2026-07-23, not by Stephen.**
> Stephen already authored the source material this draws from (the ownership
> map, the P2-0 contract, and the P2-0 implementation status) — this file only
> reformats his own proposed scope into the personal-plan structure Gate B of
> his ownership proposal asks both developers to produce
> (`docs/superpowers/plans/phase-2/2026-07-11-phase-2-pilot-readiness.md`
> "Phase 2 entry gate": *"Stephen and Saurav each create and sync a personal
> Phase 2 plan containing only their owned work."*). **Treat every task order,
> dependency claim, and step breakdown below as a proposal for Stephen (or his
> own agent) to confirm, edit, or replace — not as instructions Saurav's
> session will execute.** Per the two-developer convention, Saurav's session
> will not start, edit, or implement any task in this file.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Progress tracking (do this, it is not automatic):** the moment a task's review comes back clean and its commit is made, edit this file to change that task's `- [ ]` to `- [x]`, then commit the checkbox change. Also mirror the checkbox into the core document [`../2026-07-11-phase-2-pilot-readiness.md`](../2026-07-11-phase-2-pilot-readiness.md) so Saurav's agent sees it. Run `npm run sync-plans -- Stephen` after.

This is **Stephen's** personal plan: the Dev A slice of the core phase
document
[`../2026-07-11-phase-2-pilot-readiness.md`](../2026-07-11-phase-2-pilot-readiness.md),
per the owner map Stephen proposed himself
([`2026-07-22-phase-2-ownership-dependency-proposal.md`](2026-07-22-phase-2-ownership-dependency-proposal.md))
and Saurav integrated into the core document on 2026-07-23. Task numbers
match the core document.

**Not in this plan** (Saurav's, Dev B):
- Task 1 — flag service/state machine.
- **Task 2 — instructor resolution-queue half** (Stephen owns only the
  student flag-control half here; see Task 2 below).
- Task 3 — notifications.
- Task 6 — remediation.
- Task 8 — question import.
- Task 9 — parameterized-script migration.
- Task 10 — custom-prompt generation/regeneration.

**Already underway, outside this doc's original 11 tasks:**
- **P2-0** (persistent content runs + live progress) — Stephen's own
  cross-owner takeover, code-complete on `codex/phase-2-content-runs`, not yet
  merged. Full status in
  [`2026-07-22-phase-2-review-improvements-stephen.md`](2026-07-22-phase-2-review-improvements-stephen.md)
  ("Verification and handoff" section) — the one remaining item there is a
  live browser smoke test against a running local stack, then opening the PR.
  This plan does not re-litigate P2-0's design; it only notes where it gates
  Task 10 (Saurav's, downstream) and Task 2/7 (Stephen's own, listed below).

**Goal:** Stephen's half of pilot readiness: land P2-0 (durable content runs),
the sandboxed parameterized-question executor and its serve-time
randomization, the student-facing flag control, and progression/redirect
surfaces — such that parameterized questions execute safely with reproducible
seeded values, students can flag questions without leaving practice flow, and
repeated failure surfaces course materials instead of silently grinding.

**Architecture:** Same routes → services → components pattern as Phase 1.
Task 4's sandbox is a new `worker_threads` component with no network/fs
access. Task 5 extends Phase 1's serving/attempts services rather than
replacing them. Task 2's student half and Task 7 both extend
`client/src/views/student/practice.ts`.

**Tech Stack:** as Phase 1; Task 4 needs no new dependency (`worker_threads`
is a Node builtin).

## Global Constraints

- Everything in the Phase 0 and Phase 1 plans' Global Constraints still applies.
- `generate()` scripts run in `worker_threads` with `env.paramWorkerTimeoutMs` / `env.paramWorkerMemoryMb` limits, no network, no filesystem writes, seeded randomization (PRD §2). **Do not slip the worker sandbox** (phase doc — Task 4 is in the "never slip" list).
- Parameterized values are fixed for an attempt, never re-rolled mid-question (ST-P03); Review-Book re-practice draws a fresh seed (ST-R04).
- Contract changes (`docs/api-contract.md`) go through two-developer PR review first — this applies doubly to P2-0, which migrates the generation enqueue response shape.

## Entry gate status (as of 2026-07-23)

- [x] Phase 1 S1/S2 merged, PR #25 (Stephen's own stabilization takeover).
- [x] Phase 1 Task 13 recorded slipped (Stephen's closeout decision).
- [ ] Phase 1 Task 16 — Stephen's own explicit deferral; not blocking Phase 2 start.
- [ ] **P2-0 not yet merged** — open the PR after the live smoke test; this also unblocks Saurav's Task 10.

## Stephen's task order (Dev A) — proposed

1. **Finish and merge P2-0** — the one remaining checkbox in your own
   review-improvements doc is the live browser smoke test; then open the PR.
   Saurav is the async integration reviewer, not a blocker.
2. **Task 4** (parameterized sandbox) — no dependency; front-load, since it
   unblocks Task 5 and Saurav's Task 9.
3. **Task 5** (parameterization config + serve-time randomization) — needs
   Task 4.
4. **Task 2 — student flag control half** — needs Saurav's Task 1 (flag
   routes) merged.
5. **Task 7** (progression/redirect) — needs Saurav's Task 3 (notifications,
   for the `notify(kind: 'redirect')` emission) merged; otherwise stands on
   the existing Phase 1 mastery/attempts arc alone.
6. **Task 11** (phase exit, joint) — last; you drive
   `tests/e2e/flag-loop.spec.ts`, Saurav verifies the instructor/AI side.

## Coordination with Saurav (Dev B)

**Cross-developer dependencies:**

| Dependency | Direction | Effect |
|---|---|---|
| **Task 1 (Saurav)** | Saurav → your Task 2 student half | Needs `POST /api/questions/:questionId/flag` to exist for real before your button has something to call. |
| **Task 3 (Saurav)** | Saurav → your Task 7 | Redirect emits `notify(kind: 'redirect')` — needs Task 3 merged first. |
| **P2-0 (yours)** | you → Saurav's Task 10 | He will not start Task 10 until P2-0 merges and `docs/api-contract.md` reflects the `runId`/SSE shapes. |
| **Task 4 + 5 (yours)** | you → Saurav's Task 9 | He will not start script migration until both merge. |
| **`docs/api-contract.md`** | either → both | Any change is a two-developer PR review, never ad hoc. |

**Sync points:**
1. **P2-0 PR** — flag it to Saurav the moment it opens; it's his Task 10 unblock signal.
2. **Task 2 split** — your student-control half and his instructor-queue half are one shared feature reviewed independently; confirm the flag/resolve route contract stays identical for both.
3. **Task 11 (flag-loop exit)** — joint; both developers participate in the run, even though you own the spec.

**Workflow:** run `npm run sync-plans -- Stephen` before and after each work
session; keep the checkboxes in this file (and mirrored in the core doc)
honest against `git log`.

---

### Task 2 (your half): Student flag control

**Owner:** Dev A (Stephen) — instructor resolution queue is Saurav's half; see the core document's Task 2 for the combined feature.
**Reviewer:** Dev B (Saurav)
**Depends on:** Saurav's Task 1 merged.

**Files:**
- Modify: `client/src/views/student/practice.ts` ("Flag this question" on question and feedback views)

**Interfaces:**
- Consumes: Saurav's Task 1 route, `POST /api/questions/:questionId/flag`.
- Produces: one-click non-blocking flag control with an optional reason popover (submittable blank) + brief confirmation (ST-P09), per the core document, Task 2.

- [ ] **Step 1: Implement the student surface** (follow the Phase-1 practice-view patterns; the flag button posts and swaps to a "Flagged ✓" state without interrupting the question flow).
- [ ] **Step 2: Verify in browser**; `npm run typecheck && npm run lint` → PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat: flag control in practice view (ST-P09)"`

---

### Task 4: Parameterized execution sandbox — worker_threads `generate()` (PRD §2)

**Owner:** Dev A (Stephen) · **Reviewer:** Dev B (Saurav)

**Files:**
- Create: `server/src/components/param-worker/index.ts`, `server/src/components/param-worker/worker.js`, `server/src/components/param-worker/AGENTS.md`
- Test: `tests/unit/param-worker.test.ts` (the abuse suite — a phase exit criterion)

**Interfaces:**
- Consumes: `worker_threads`, `env.paramWorkerTimeoutMs`, `env.paramWorkerMemoryMb`.
- Produces: `executeGenerate(script: string, seed: number): Promise<Record<string, number>>`. Full guarantees (hard timeout, memory cap, no network/fs/process, seeded PRNG), the complete `worker.js`, and the abuse-suite test cases are in the core document, Task 4 Interfaces + Step 1 — copy verbatim, this is a security-critical sandbox and the exact scrubbed-scope evaluator matters.

- [ ] **Step 1: Write the failing abuse tests** exactly as in the core document, Task 4 Step 1 (deterministic-per-seed, infinite-loop timeout, network block, fs block, process block, missing-`generate()` rejection).
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement** `worker.js` and `index.ts` exactly as in the core document, Task 4 Step 3. Write the AGENTS.md noting the threat model (scripts are instructor-trusted content, not hostile-user content).
- [ ] **Step 4: Run the abuse suite** — `npx jest tests/unit/param-worker.test.ts` → all PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: worker_threads sandbox for parameterized generate() with timeout, memory, network, and fs guards"`

---

### Task 5: Parameterization config + serve-time randomization (IN-Q09, ST-P03/ST-R04)

**Owner:** Dev A (Stephen) · **Reviewer:** Dev B (Saurav)
**Depends on:** Task 4 merged.

**Files:**
- Create: `server/src/services/params.service.ts`, `client/src/views/instructor/param-config.ts`
- Modify: `server/src/services/serving.service.ts` + `attempts.service.ts` (Phase 1), `server/src/routes/questions.routes.ts` (param config endpoints)
- Test: `tests/unit/params.service.test.ts`

**Interfaces:**
- Consumes: Task 4's `executeGenerate`; `questionVersionsCol()`; Phase-1 serving/attempts services.
- Produces: `resolveParamValues`, `substituteParams`, the serving/attempt pinning changes, and the config/preview endpoints. Full signatures in the core document, Task 5 Interfaces.

- [ ] **Step 1: Failing tests** — slot draw respects min/max/step and is seed-deterministic; substitution hits stem + options + explanations; missing placeholder surfaces a validation warning; script path delegates to the sandbox; serving pins the same values into the attempt payload round-trip.
- [ ] **Step 2–4: FAIL → implement (service, route, serving/attempt wiring, panel) → PASS.** Re-run the Phase-1 serving/attempts suites — they must stay green.
- [ ] **Step 5: Commit** — `git commit -m "feat: parameterization config, seeded serve-time randomization, fresh values on re-practice (IN-Q09, ST-R04)"`

---

### Task 7: Progression recommendations + repeated-failure redirect surfaces (ST-P05, ST-P07)

**Owner:** Dev A (Stephen) · **Reviewer:** Dev B (Saurav)
**Depends on:** Saurav's Task 3 merged (`notify(kind: 'redirect')`); otherwise only the existing Phase 1 mastery/attempts arc.

**Files:**
- Modify: `server/src/services/attempts.service.ts` (redirect trigger), `client/src/views/student/practice.ts` (both surfaces)
- Test: `tests/unit/redirect.test.ts`

**Interfaces:**
- Consumes: Phase 1's `mastery.recommendation` field; `course.redirectFailureThreshold`; materials assigned to the LO; Saurav's `notify()`.
- Produces: the redirect rule (clustered-on-easy/medium misses → redirect; hard-tier misses → step-back precedence, no redirect) and the recommendation banner / non-modal redirect panel. Full precedence rule and client behavior in the core document, Task 7 Interfaces.

- [ ] **Step 1: Failing tests** — redirect fires on 3 easy-tier misses; does NOT fire when the same misses are all hard-tier; response never contains the correct answer alongside a redirect.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: progression recommendation and repeated-failure redirect surfaces (ST-P05, ST-P07)"`

---

### Task 11: Phase exit — flag-loop E2E (joint)

**Owner:** Joint — you drive `tests/e2e/flag-loop.spec.ts`; Saurav verifies the instructor/AI side.
**Depends on:** Your Task 2 half merged; Saurav's Tasks 1, 2, 3, 6 merged.

**Files:**
- Create: `tests/e2e/flag-loop.spec.ts`

- [ ] **Step 1: Write and pass the spec** — student flags an approved question → instructor sees the standard notification and the flag in the queue → four more students flag → auto-pause fires → instructor sees the elevated notification → question no longer serves to students → instructor resolves "clear" → question serves again; flagging student sees the flag-resolved notification. Full scenario in the core document, Task 11 Step 1.
- [ ] **Step 2: Full suite green** — `npm run lint && npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 3: Commit** — `git commit -m "test: phase-2 exit — flag -> notify -> auto-pause -> resolve loop e2e"`

---

## Open question for Stephen to resolve, not answered by this draft

This draft assumes P2-0 finishes (live smoke test + PR) before Task 4 starts,
purely to keep one thread of work moving at a time. If you'd rather run P2-0's
remaining smoke test and Task 4 in parallel (they don't share files), reorder
freely — nothing in Task 4 depends on P2-0.
