# Saurav — Phase 4 progress

_Last updated: 2026-08-01_

Phase 4 carries **no owner map** — the core plan has no `**Owner:**` line on any
of its six tasks, the same gap Phase 3 had. Rather than propose another map (the
Phase 3 one was overtaken by events; see
[`../../phase-3/Saurav/2026-08-01-phase-3-post-implementation-review.md`](../../phase-3/Saurav/2026-08-01-phase-3-post-implementation-review.md)),
I claimed Task 1 in writing directly in the shared plan and got on with it.

## Task 1 — critical-path E2E consolidation

| Step | State |
|---|---|
| 1. Audit coverage | **done** — PR #55 |
| 2. `critical-paths.spec.ts` | **done** — PR #55 |
| 3. Full suite 3× green | **BLOCKED** — see below |
| 4. Commit | done (PRs #55, and the fixes branch) |

**Step 1 result.** All three required critical paths were already covered:
(a) `practice-loop.spec.ts:127`, (b) `exam-mode.spec.ts:135`,
(c) `flag-loop.spec.ts:168`. The plan's `core-loop-demo.spec.ts` reference was a
missing *file*, not missing coverage — supplied by Phase 1 Task 16 (PR #54,
merged), which also closed the one real gap in (a): no E2E anywhere asserted a
mastery status transition. All three gaps the plan predicted were real and are
covered by `critical-paths.spec.ts` (ST-E03 session resume, ST-P04 Strategy-A
retry gate, ST-P10/P11 deferred summary).

## OPEN ITEM — Step 3 is blocked on a decision, not on work

Three consecutive full E2E runs on 2026-08-01 gave an identical result:
**20 passed, 2 failed, 1 skipped.** Deterministic, not flaky.

The two failures are `app.spec.ts:10` and `walking-skeleton.spec.ts:14`. Both
navigate to `/` and assert the heading reads **"My Courses"**.

**Root cause.** `client/src/main.ts:345` makes the root fallback role-dependent:

```ts
fallback: session.user?.isAdmin ? '/admin/accounts' : '/instructor/courses',
```

`isAdmin` is written at first login from `ADMIN_CWL_ALLOWLIST` and is **never
revoked** when that list later changes. `.env` currently has
`ADMIN_CWL_ALLOWLIST=12345678`, which is the `faculty` test user's PUID, so
global-setup's login flags them admin and `/` resolves to `#/admin/accounts`
(heading "User Accounts"). Both specs still pass their *navigation* assertions —
the Instructor nav is present in the admin shell — so it is specifically the
heading that differs.

**Why this was left rather than patched.** Two reasons:

1. **`walking-skeleton.spec.ts` may be right and the instinct to "just navigate
   explicitly" wrong.** That test is named *"a logged-in user sees a
   role-appropriate home"*. Hardcoding one role's heading is arguably the real
   defect; the correct fix is to assert per-role (admin → User Accounts,
   instructor → My Courses), which is a different change from the one applied to
   `instructor-pipeline.spec.ts`.
2. Both are **Phase 0 specs**, shared rather than clearly Saurav-owned.

**Three options when this is picked up:**

- **Revert the allowlist** so `12345678` is not an admin. Suite goes green
  immediately; the latent trap remains for whoever next sets an admin flag.
- **Make both specs role-aware.** ~10 lines, makes the suite immune to this
  ambient database state. *Recommended.*
- **Leave them and record**, deferring the Phase 0 specs to Stephen.

**Open question for whoever returns to this:** was
`ADMIN_CWL_ALLOWLIST=12345678` set deliberately, or is it a leftover from an
ad-hoc check of the admin-landing behaviour on 2026-08-01? If the latter,
reverting it is the honest fix and the specs' assumption becomes true again.

## Fixes landed on the way (branch `saurav/fix-flag-loop-isolation`)

Both are test-isolation defects found by Step 3's flake check, not product bugs.

1. **`flag-loop.spec.ts`** — the notification bell is per-user, not per-course.
   A bare `getByText(body)` matched identically-worded notifications left by
   earlier runs against *other* courses; the spec's cleanup is scoped to its own
   `courseId`, so orphans from a since-deleted course outlive it. Locally this
   was a strict-mode failure with "just now" and "4d ago" both matching (dev DB
   held 31 notifications, oldest 2026-07-28). Fixed by also matching the
   rendered relative time, applied to all three notification assertions.
   Mutation-verified: suppressing the auto-pause emission makes the spec fail
   rather than pass on the stale orphan, which `.first()` would not have caught.
2. **`instructor-pipeline.spec.ts`** — same root-landing assumption as the open
   item above; now navigates explicitly, as `core-loop-demo.spec.ts` does.

## Environment notes (not defects, but they cost time)

- **`chart.js` was never installed locally** after Phase 3 added it. Without
  `npm install` + `npm run vendor`, `/vendor/chart.umd.js` 404s and **four**
  unrelated specs fail on their zero-console-error assertions.
- **`npm install` on macOS prunes `@emnapi/*` from the lockfile** — the trap
  already recorded in Phase 1 STATUS deviation 11. Revert `package-lock.json`
  after installing.
- **Embeddings.** Ingest previously failed at the embedding step
  (`EMBEDDINGS_PROVIDER=ollama` with nothing on :11434), which made
  `instructor-pipeline.spec.ts`'s `/Processing|Ready/` assertion a race — it
  passed only when it observed the row before the job failed.
  `core-loop-demo.spec.ts:229` shares that assertion and the same latent race.
  Switching to `EMBEDDINGS_PROVIDER=fastembed` /
  `fast-bge-small-en-v1.5` resolved it: ingest now reaches `ready`
  (`[FinanceBot:RAG] embedded materialId=… vectors=1`). **The `/Processing|Ready/`
  assertions are only safe while a working embeddings backend is configured.**
- **`.env` changes need a server restart** — `env.ts` reads `process.env` at
  module load and `tsx watch` only restarts on source changes.

## Carried from Phase 1 — affects Phase 4 Task 5

**Task 8 Step 5 (live-LLM generation checkpoint) is deferred to instructor user
testing** (Saurav's call, 2026-08-01), after being deferred three times before.
No code is needed: `instructor-pipeline.spec.ts:214` already implements it behind
`test.skip(!process.env.LLM_AVAILABLE)`.

Phase 4 **Task 5** (instructor content week, hard start Aug 24) is where this
lands: its bank-QA pass assumes generation works against real material, so if the
pipeline has never run against a live model, that week is the first time anyone
finds out. `.env` is now `LLM_PROVIDER=openai` / `gpt-5.4-nano`, but **nothing in
the default suite exercises it** — the only live-LLM test stays skipped unless
`LLM_AVAILABLE` is set.

## Not started

Tasks 2 (WCAG scans), 3 (250-session concurrency), 4 (browser/device spot
checks), 5 (instructor content week), 6 (launch readiness). Task 6 Step 1 — the
**CWL PIA/DAR with UBC IAM** — is a launch blocker on an external party's
timeline and the PRD (`PRD.md:320`) says to start it as early as possible; worth
confirming with Stephen whether it is already in flight.
