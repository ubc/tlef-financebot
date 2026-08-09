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

## UI bug fix — notification bell: navigate & dismiss (branch `saurav/fix-notification-bell`)

The first of the UI bugs the freeze-legal pause above was called for. Plan:
[`.superpowers/sdd/2026-08-02-notification-bell-navigate-and-dismiss/`](../../../../../.superpowers/sdd/2026-08-02-notification-bell-navigate-and-dismiss/).

**The bug.** The bell was a dead end. Notification rows were inert — clicking
one did nothing, so there was no way to get from "a question was flagged" to
the flag itself. Nothing ever left the list either: the badge could not reach
zero and the panel grew without bound.

**What shipped** (six tasks, all landed on the branch):

| Task | What |
|---|---|
| 1 | `Notification.dismissedAt?: Date`; `listNotifications` excludes dismissed documents |
| 2 | `POST /api/notifications/:id/dismiss` and `/dismiss-all`, both scoped to the caller's own puid |
| 3 | `client/src/notification-target.ts` — pure notification→route map, unit-tested |
| 4 | The bell navigates on click, dismisses on click, and gained a "Clear all" |
| 5 | The instructor flag queue scrolls to and highlights the flag/question the notification points at; the TA view does the same on its card |
| 6 | `tests/e2e/notification-bell.spec.ts` + this entry |

### The three product decisions (confirmed with Saurav, 2026-08-02)

1. **Clicking a notification dismisses it.** It navigates to the relevant flag
   queue *and* removes the row for good.
2. **Opening the bell clears the badge.** Opening the panel is the "I have
   looked at these" signal, phone-style, so the badge is a since-you-last-looked
   counter rather than a permanent scold.
3. **"Clear all" clears everything, read or unread.** It replaced the old
   "Mark all read" button in the panel header.

**Why dismissal is safe, and why this is the whole rationale:** the **flag queue
is the durable record**. Every flag stays in it regardless of what happens in
the bell, so a notification is a *disposable nudge*, not a record of work. That
is the single fact the three decisions above rest on. Dismissed documents are
also retained (`dismissedAt` stamped, never deleted), so the audit trail
survives and a "recently dismissed" view stays possible.

### ⚠️ This REVERSES the earlier "opening the panel marks nothing read" rule

That rule was deliberate when it was written, and it is deliberately gone now.
It left the badge stuck on and the list unbounded, which is most of what made
the bell feel broken. **Do not "fix" it back.** `notifications-bell.ts`'s module
comment records the same reversal at the code, and
`tests/e2e/notification-bell.spec.ts` fails if it is undone — verified by
mutation, below.

### Two amendments approved mid-execution by Saurav

Both were found during implementation, neither was in the original plan:

- **Task 4 — the bell's `mutationEpoch` poll guard.** The bell polls every 30s,
  on window focus, and on `visibilitychange`. Any of those can land mid-dismiss
  and overwrite the optimistic removal with the server's not-yet-dismissed list,
  resurrecting a row (or the entire list, for "Clear all") until the *next*
  tick — up to 30 seconds. Shipped first as a `pendingDismissIds` set of ids
  whose dismissal was in flight; **round-2 review replaced it entirely** with a
  monotonic `mutationEpoch`, because the set only asked "is a dismiss in flight
  *now*" and the real hazard is "was this GET issued *before* the dismiss
  landed" — a GET already in flight when Clear all fired would resolve after the
  POST had settled and the set had emptied, resurrecting the whole list.
  `poll()` now snapshots the epoch before its `await` and drops the response if
  a local mutation moved it; the epoch is bumped by `handleActivate`,
  `handleClearAll`, **and** `markPanelRead` (which previously had no race
  protection at all, so the badge could pop back to N).
- **Task 5 — the `highlightApplied` one-shot highlight guard.** The flag queue's
  `renderResults()` reruns on every background trigger (`subscribeFlagsChanged`,
  tab focus, any resolve/notify action), and nothing clears `?flag=`/`?question=`
  from the hash. Without a guard the instructor is re-scrolled and re-flashed on
  every one of those events for as long as they stay on the URL. The highlight
  now fires at most once per view instance, set only on a successful match.
  **Round-2 review** applied the same guard to the TA view (`renderInner` reruns
  on the TA's own escalate action, so escalating flag Y while `?flag=X` was
  still in the URL re-flashed X) and made both views move focus to the matched
  element (`tabindex="-1"` + `focus({ preventScroll: true })`) — the highlight
  had been visual-only, leaving keyboard and screen-reader users on `<body>`.

### Verification

- **`tests/e2e/notification-bell.spec.ts` — 2 tests, observed passing.** This is
  the *only* automated coverage of the bell's DOM behaviour: Jest runs
  `testEnvironment: 'node'` with no jsdom installed (`tests/AGENTS.md:66-69`), so
  the pure route map is unit-testable but the widget is not. The spec seeds its
  own course, two questions, two open flags and its own notifications — no
  ambient dev-database state, per the `315d1dd` rule.
- **Mutation-verified**, because a spec that passes against the broken code is
  worthless. Four separate reversions were applied and each made it fail:
  dropping `dismissedAt` from the list filter → both survives-a-reload
  assertions fail; opening no longer marking read → the badge assertion fails;
  the click no longer navigating → the URL assertion fails; the highlight class
  not being applied → the highlight assertion fails. Every mutation was reverted.
- **Full e2e suite: 25 passed, 2 failed, 1 skipped.** The two failures are the
  pre-existing `ADMIN_CWL_ALLOWLIST` ones (`app.spec.ts`, `walking-skeleton.spec.ts`)
  documented in the open item above — unchanged by this work. The new spec
  deliberately navigates to `#/instructor/courses` rather than `/` so it is
  immune to that same trap.
- **`npm run test:a11y`: 4 passed.** This shows the branch regressed nothing on
  the surfaces Task 2 (`6e3874a`) already covers. It does **not** show the new
  highlight itself is WCAG AA clean, and the original wording here claimed it
  did. Two reasons: `tests/a11y/a11y.spec.ts` never visits a flag queue (it
  scans the landing screen, four instructor surfaces, and the student
  practice/exam surfaces — no `/flags` route), and `playwright.config.ts` sets
  `reducedMotion: 'reduce'` globally, which the a11y config inherits, so the
  `notif-landing` keyframe and its background wash never render under axe even
  if a flag queue were added. The highlight's contrast is therefore **unscanned**
  and rests on the design choice alone (`var(--accent)` outline, the same token
  Task 2 validated in both shells). Adding a flag-queue surface to the spec —
  and rendering the wash without `reducedMotion` — is the open follow-up.

## UI bug fix — flag dedupe blocked re-flagging forever (same branch)

Found on 2026-08-03 by Saurav testing the bell manually: flagged several
questions as `student`, saw **nothing** as `faculty`. It looked like the new
notification work had broken, and it had not — **no flags were being created at
all**, so there was nothing to notify anyone about.

**Root cause** — `flags.service.ts`'s dedupe was
`findOne({ puid, questionVersionId })` with **no `state` term**, so it matched a
student's own flag in *any* state including `resolved-*`. Once an instructor
adjudicated a flag, that student could never flag that version again, for the
life of the version. The call returned `duplicate: true` and short-circuited
**before the insert and before `notifyCourseStaff`**.

**Why it was invisible.** `flags.routes.ts` deliberately returned a uniform
`{ flagged: true }` and dropped `duplicate` ("idempotent UX"), and
`practice-card.ts` renders **"Flagged ✓"** on any success. A silently-deduped
flag was pixel-identical to a real one. The dev DB made this certain: the
student was demonstrably live (a `redirect` notification fired to faculty at
`06:19:54`) while the newest flag document was from `2026-08-02T22:33` — and
that student already held flags on the current version of **6 of the 10**
approved questions in the course, all resolved.

**Fixed, both halves** (decisions confirmed with Saurav):

1. Dedupe is now scoped `state: 'open'`. A resolved flag is a closed
   conversation; a student who still thinks the question is wrong is new
   signal. Re-flagging while one is genuinely *pending* still dedupes, which is
   what stops spam.
2. `duplicate` is surfaced through the route, `api.ts`, and the practice-card
   adapter; the card renders **"Already flagged — under review"** as a distinct
   terminal state from "Flagged ✓". The uniform response is what let a dedupe
   bug masquerade as a broken bell, so this half is not cosmetic.

**Verification.** Unit tests 2b/2c added to `tests/unit/flags.service.test.ts`.
Existing test 2 could not catch this — its `flagsFindOne` is a bare mock that
ignores the filter, so it passes identically against both the old and new
dedupe. 2b asserts the query shape; 2c uses a filter-honouring mock to assert a
resolved flag no longer blocks a new one *and* that staff get notified.
**Mutation-verified:** reverting `state: 'open'` fails exactly those two and
nothing else. Full unit suite 806 passed / 78 suites; `flag-loop.spec.ts` +
`notification-bell.spec.ts` 3 passed; lint and typecheck clean.

**Note for Task 4 (browser matrix):** this was a server-side logic bug, so it
is not browser-specific — but it is a reminder that the bell's *apparent*
failures may not be bell bugs.

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
   The notification bell one is done (section above); more may follow.
2. **Task 4 cross-browser** — no staging or content needed, and it is the first
   time this app will run in Safari/WebKit. May reclassify some of the UI bugs.
3. **Task 3 scripts** — build and debug locally, check query plans, hold the
   gated staging run for Rich's go-ahead.
4. **Task 6 doc reconciliation** — once the staging URL is known.
5. **§4.1 consent flow** — needs a decision on ownership and timing; the freeze
   makes this urgent independent of the test work.

## Next session: read this first

Everything Saurav did on 2026-08-01/02 up to #59 is merged. **One branch is in
flight: `saurav/fix-notification-bell`** — the bell bug fix above, all six tasks
landed and verified, not yet merged. Read its section before touching
`notifications-bell.ts`, `notification-target.ts`, or the flag queue's
highlight: the "opening clears the badge" behaviour is a deliberate reversal,
not a regression.

The four open questions above are the only things blocking forward progress
that a session cannot resolve on its own.

## 2026-08-06 — Numerical correctness PR #66 review

Implementation and automated verification are complete: **49/52** plan checks
are recorded in
`2026-08-05-numerical-question-correctness-saurav.md`. The three intentionally
open checks are live manual instructor/student confirmations, not missing code.

Stephen's pre-merge review found and fixed two correctness holes before merge:

1. A numerical question could previously earn a proof while some answer
   options remained literal LLM-written numbers, or while multiple options
   reused one computed placeholder. Verification now requires exactly one
   computed derived value per displayed option and checks the per-option list,
   including duplicates and missing script outputs.
2. Side-by-side regeneration returned only stem/options and dropped the
   generated parameter definitions. Accepting a variant now writes its stem,
   options, slots, derived values, numeric declaration, and fresh proof in one
   QuestionVersion, so no approved intermediate version can expose unresolved
   placeholders.

The review also synchronized `docs/api-contract.md`, the design's fail-closed
conceptual-detection wording, this README, and root `AGENTS.md`. Verification:
`npm run typecheck`, focused ESLint, 95 focused tests, and the full Jest suite
(90 suites / 983 tests) pass. PR #66's recorded Playwright run has no new
failures; the three existing environment/config failures remain documented in
the PR.

## 2026-08-06 — Course Settings PRs #67 and #68

- #67 documents Auto-pause, Feedback Strategy, and Registration Code in the
  product with keyboard-, hover-, touch-, and screen-reader-accessible help
  tips. Course Settings is now included in the axe A/AA scan.
- #68 adds preview-first roster CSV import, column detection/override, row-level
  rejects, and the documented CWL/email-only identity constraint. It updates
  `docs/api-contract.md` in the same change.
- Stephen's pre-merge review closed two data-safety gaps in #68: a headerless
  invalid first row is no longer mistaken for a header, and a preview with zero
  usable identifiers disables Save Roster so it cannot silently wipe an
  existing roster. Manual editing re-enables the intentional replace/clear
  path.

## 2026-08-08 — Preview flag UX (Jose's PI feedback)

Jose's PI review of Instructor Preview surfaced three problems with the flag
form on the practice card. All three are fixed on branch
`saurav/preview-flag-ux-pi-feedback`.

**What shipped:**

1. **The TEST checkbox now defaults ON in Preview.**
   `client/src/views/student/practice-card.ts:106` —
   `let sendToInstructorQueue = Boolean(adapter.allowsInstructorTestFlag);`.
   Preview exists to exercise the real flag loop end to end; an instructor who
   wants a preview-session-only flag now has to uncheck it, rather than opt in
   to the thing Preview is for. Live student practice never renders the
   control at all (`allowsInstructorTestFlag` is set only by the preview
   adapter), so the student path — and the server default — stay `false`.
2. **The trailing sentence became a ⓘ help tip.** The label used to carry
   "This is marked TEST and does not count toward student analytics or notify
   real students." as a trailing `<small>`, which read as part of the label
   and only explained the checked state. `client/src/views/student/practice-card.ts:63`
   now holds a module-level `TEST_FLAG_HELP` string covering both states,
   rendered via `helpTip('the test flag option', TEST_FLAG_HELP)` at
   `client/src/views/student/practice-card.ts:346`. To put the tip outside the
   `<label>` (a `<button>` inside a `<label>` makes the click target
   ambiguous and can toggle the checkbox) the row was restructured from a
   wrapping `<label class="flag-test-option">` into a `<div>` holding
   `input + <label for> + helpTip`, same idea as `form-field__label-row` in
   `instructor/settings.ts`. The now-dead `.flag-test-option small` CSS rule
   was deleted from `client/public/styles/main.css`.
3. **The answer Submit button is hidden while the flag form is open.**
   `client/src/views/student/practice-card.ts:366` —
   `const flagFormOpen = flagState === 'editing' || flagState === 'submitting';`
   — the footer omits the primary Submit button while that is true, so "Send
   flag" is the only submit-looking control on screen. Submit returns once the
   flag resolves (`flagged`/`duplicate`) or is cancelled back to `idle`.

`helpTip()` moved from `client/src/instructor-ui.ts` to the shared
`client/src/ui.ts` kit as groundwork for fix 2, since `practice-card.ts` is a
student module and could not depend on the instructor one.
`client/src/instructor-ui.ts` re-exports it, so its existing call site
(`views/instructor/settings.ts`) kept compiling unchanged. The stale CSS
comment this left behind (`client/public/styles/main.css:2421`, "see
`helpTip()` in `client/src/instructor-ui.ts`") is fixed in the same pass to
point at `client/src/ui.ts`.

### ⚠️ Fix 1 REVERSES `f08913c` — Stephen needs to be told

`f08913c` ("test: phase-3 exit checks", 2026-08-01, `fanxiaotuGod`) changed
this same line from `Boolean(adapter.allowsInstructorTestFlag)` to `false`,
with a comment arguing that merely allowing the control must never pre-check
it. That was a deliberate call at the time. It is deliberately undone now: a
PI reviewing Preview on 2026-08-08 experienced the unchecked default as the
control doing nothing, because Preview's entire point is to exercise the real
flag loop and an unchecked-by-default box quietly opts every walkthrough out
of that. **Do not "fix" it back to `false` a third time** without reading this
section — the comment above the declaration in `practice-card.ts` says the
same thing and points back here.

`f08913c` is almost certainly Stephen's commit (`fanxiaotuGod`). **Saurav made
this call unilaterally from PI feedback and has not yet told Stephen it
reverses his commit — that conversation still needs to happen.** Flagging it
here so it is not lost: if Stephen re-introduces the `false` default from the
other side without seeing this entry, the two of you will flip it back and
forth.

### Deliberately NOT fixed: the unchecked path is a black hole

Whichever way the checkbox ends up, `preview.service.ts:513` pushes the flag
into `previewStudentSessions.flags`, which no route, service, or view ever
reads, and which expires on the 24h TTL along with the rest of the preview
session. `practice-card.ts` renders **"Flagged ✓"** regardless — the same
success tick as the live path — so an instructor who unchecks the box today
gets a confident-looking confirmation for a comment that is discarded. This is
the same shape of bug as the flag-dedupe issue above (a uniform success state
hiding two different outcomes), but it is **out of scope for this fix** and
deliberately deferred by Saurav, 2026-08-08. A real fix would mirror the
existing `duplicate` terminal state at `client/src/views/student/practice-card.ts:279-285`
— a visually distinct "not sent anywhere" state instead of reusing "Flagged
✓".

### Verification

Mutation-verified against `tests/e2e/instructor-preview.spec.ts`: reverting
each of the three fixes individually was confirmed to fail a specific new
assertion in that spec (the checked-by-default assertion, the removed-text/ⓘ
assertion, and the Submit-hidden assertion respectively), and all three
reversions were then restored. Final run with all three fixes in place: **2
passed**. `npm run lint` and `npm run typecheck` clean.

### Not scanned by axe

The new ⓘ inherits a component `tests/a11y/a11y.spec.ts` already cleared at AA
in #58, but that spec has no Preview surface in its route list, and
`playwright.config.ts` sets `reducedMotion: 'reduce'` globally, so the claim
here is "low risk," not "scanned" — the same open follow-up already recorded
for the flag-queue highlight above.
