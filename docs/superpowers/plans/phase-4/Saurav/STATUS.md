# Saurav — Phase 4 progress

_Last updated: 2026-08-02_

Phase 4 carries **no owner map** — the core plan has no `**Owner:**` line on any
of its six tasks, the same gap Phase 3 had. Rather than propose another map (the
Phase 3 one was overtaken by events; see
[`../../phase-3/Saurav/2026-08-01-phase-3-post-implementation-review.md`](../../phase-3/Saurav/2026-08-01-phase-3-post-implementation-review.md)),
I claimed Tasks 1 and 2 in writing directly in the shared plan and got on with
them.

---

## Where this stands at a glance (2026-08-02)

| Task | State |
|---|---|
| 1 — Critical-path E2E | Steps 1, 2, 4 done (#55). **Step 3 blocked on a decision** — see below |
| 2 — WCAG 2.1 AA scans | **Complete** (#58). 11 surfaces clean |
| 3 — 250-session concurrency | Not started. Buildable locally now; the gated run needs staging |
| 4 — Browser/device spot checks | Not started. **Bigger than the plan assumes — see the Chromium-only finding** |
| 5 — Instructor content week | Not started. Blocked on real COMM 298 content (Phase 2's open exit item) |
| 6 — Launch readiness | Steps 1–2 effectively **done** (new info below); Step 3 is unbuilt work |

**Paused deliberately on 2026-08-02:** Saurav is fixing UI bugs found while
using the app before the remaining Phase 4 verification runs, so the browser
matrix and the load numbers describe the fixed build rather than one about to
change. Bug fixes are in scope during the freeze by the phase doc's own rule
("every change in this phase is a test, a bug fix, or launch configuration").

## NEW — infrastructure facts the shared plan does not yet reflect

Confirmed by Saurav on 2026-08-02. **Task 6 Steps 1–2 still read as open in the
core plan and should be reconciled** (deliberately not edited here without the
staging URL — see the open question at the end).

- **PIA *and* DAR are both cleared.** Task 6 Step 1 is satisfied. This was the
  single external dependency on UBC IAM's timeline that `PRD.md:320` calls "on
  the critical path to any student-facing launch"; it is no longer a risk.
- **Staging exists and runs real Shibboleth**, not the mock IdP — so Task 6
  Step 2's code path is genuinely exercised. **Nuance worth preserving:** it
  authenticates against UBC's *staging* CWL, not production CWL. Pointing the
  entity ID / metadata at production remains a real step someone must take
  before launch; do not let a green staging login be read as that being done.
- **Consequence:** Task 3 is no longer blocked on infrastructure. Its remaining
  blockers are coordination, not capability (below).

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

## Task 2 — WCAG 2.1 AA scans — COMPLETE (#58)

All three steps done; 11 surfaces scan clean. Two findings worth carrying:

**The suite was scanning one page.** Its two signed-in tests waited on Phase-0
selectors that no longer exist (a `/welcome/i` heading; a `#/classes` route the
instructor shell does not register), so they *timed out* rather than scanning.
Every student practice surface and the whole instructor shell had never been
checked. Task 2 was not "extend the scans" — the scans were never running.

**The contrast failures were structural, not a mis-picked token.** Both sidebar
backgrounds sat almost exactly at the pessimal luminance (~0.179), where white
and black both bottom out near 4.58:1 — leaving ~0.5 ratio points of headroom
above the 4.5 requirement. `.nav__group` / `.sidebar__foot` fade text to 75%/70%
alpha *over that background*, landing at 2.87 and 2.70. **No text colour could
fix it.** Resolved by darkening the backgrounds ~24% and raising both fades to
85%; renders were reviewed and approved before commit.

The **critical** findings were five `<select>`s with no accessible name (four
Question Bank filters, the Review Queue sort) — announced by a screen reader as
bare combo boxes. The plan predicted the question-options radio group would be
the big violation; it was already compliant.

## Task 3 — concurrency — NOT blocked on infrastructure any more

Staging exists (above), so what remains is coordination and two decisions:

- **Build locally, gate on staging.** Local runs genuinely catch missing indexes
  and N+1 patterns (`explain()` is hardware-independent) but **cannot** validate
  the p95 targets: the load generator competes with the server for CPU on the
  same machine, and loopback has no network latency. A local pass proves nothing
  about the target; a local *failure on a missing index* is still a real finding.
- **Staging is shared.** A 250-connection × 60s run will disrupt anyone else on
  it. Saurav is checking with Rich and the team before any load run — do not
  point autocannon at staging without that.
- **The rate limiter will invalidate the run.** Phase 0 caps at 600/min/IP, so a
  single-IP load test gets throttled and the numbers are garbage. The plan
  suggests a `RATE_LIMIT_DISABLED` flag and calls it config-only (freeze-legal),
  but that disables a protection on a deployed environment — **get explicit
  sign-off, or run distributed from several IPs instead.**

## Task 4 — browser/device — a real gap, not routine

**Everything ever run on this project has executed on Chromium only.**
`playwright.config.ts:35` declares a single project, and only `chromium` and
`ffmpeg` are installed. Every E2E spec, every a11y scan, and all of Phases 0–3's
browser verification is single-engine — against a PRD §2 requirement of
"latest-two evergreen browsers" and a Task 4 requirement of Chrome, Firefox,
Safari and Edge plus mobile.

**More automatable than the plan assumes.** The plan describes a manual matrix,
but Playwright drives Firefox and WebKit directly — a config change plus a
browser install (~300MB). WebKit is the one that matters: it is Safari's engine
and the app leans on `color-mix()`, KaTeX, and SAML redirect flows. Mobile is
automatable too via `devices['iPhone 14']` / `devices['Pixel 7']`, which the
plan explicitly accepts as a fallback.

**Practical note for the UI-bug work happening now:** "it's broken" and "it's
broken in WebKit" are different tickets. Worth recording the browser against
each bug, since nothing has been tested outside Chrome.

## Task 6 Step 3 — the §4.1 consent flow is UNBUILT, and launch-blocking

Not a test, so it does not fit the Task 1–4 sequence, but it is the largest
open compliance item and it is racing the **Aug 24 feature freeze**.

`onboardingAcknowledgedAt` and `researchExportConsent` are declared on `User`
(`domain.ts:102-103`) and **read nowhere** in `server/src`, `client/src`, or
`tests/`. So there is no guided onboarding, no mandatory service-use
acknowledgement, no copyright disclaimer gate, and no declinable research-export
consent — all of which PRD §4.1 requires.

Consequence beyond compliance-for-its-own-sake: PRD §6.4 / IN-A05 permits
research exports to include **only** students who gave that optional consent.
With the field never set, there is no lawful basis to include anyone in a
research export — one of the pilot's stated purposes.

Task 6 Step 3 anticipates this ("if any of this was missed in Phases 1–3, it is
a launch-blocking bug fix now"), but it is unbuilt *feature* work, not a fix.
Not verified: the in-practice disclaimer and the CWL-username watermark, which
may or may not exist — the consent gating is the part confirmed absent.

## Fixes landed on the way (branch `saurav/fix-flag-loop-isolation`, #56)

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

## Open questions — these need a human, not a session

1. **Was `ADMIN_CWL_ALLOWLIST=12345678` deliberate?** Decides Task 1 Step 3
   (details above). One line either way.
2. **Staging URL/host, and who deploys to it.** Needed to reconcile Task 6
   Steps 1–2 in the shared plan and to point the load run somewhere. Left out
   of the core plan deliberately rather than written as a placeholder.
3. **Sign-off on `RATE_LIMIT_DISABLED`** (or a distributed load run) before
   Task 3's gated measurement.
4. **When does the §4.1 consent flow get built**, and by whom? It is feature
   work against an Aug 24 freeze.

## Suggested order when this resumes

1. **UI bug fixes** — in progress by Saurav, deliberately ahead of the remaining
   verification so the browser matrix and load numbers describe the fixed build.
2. **Task 4 cross-browser** — no staging or content needed, and it is the first
   time this app will run in Safari/WebKit. May reclassify some of the UI bugs.
3. **Task 3 scripts** — build and debug locally, check query plans, hold the
   gated staging run for Rich's go-ahead.
4. **Task 6 doc reconciliation** — once the staging URL is known.
5. **§4.1 consent flow** — needs a decision on ownership and timing; the freeze
   makes this urgent independent of the test work.

## Next session: read this first

Everything Saurav did on 2026-08-01/02 is merged (#52–#58). `main` is at
`2ec7d26`. Working tree clean, no branches in flight. The four open questions
above are the only things blocking forward progress that a session cannot
resolve on its own.
