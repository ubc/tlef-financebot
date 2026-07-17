# Stephen — Phase 1 progress

_Last updated: 2026-07-17_

**Tasks 3, 9, 10, 11, 12, and 14 (all of Dev A's non-joint, non-"either owner"
tasks) are done, reviewed, and committed** on branch
`worktree-stephen+phase-1-core-loop` (19 commits ahead of `main`, none pushed
yet — no PR opened). Full suite green: **236 unit tests / 27 suites**,
typecheck clean (server + client), lint clean except one pre-existing trivial
`import type` error in `review-book.service.ts` (see "Known issues" below).
The Playwright e2e suite (`practice-loop.spec.ts` + the pre-existing specs) was
run for real against the sandbox's live MongoDB/SAML-IdP/FakeAcademicAPI and
passed, including a second run to confirm cleanup idempotency.

Executed with the superpowers `subagent-driven-development` skill; the running
ledger (commit ranges, per-task review verdicts, deferred Minor findings) is in
the gitignored `.superpowers/sdd/progress.md`. **This file is the durable
record of where the code diverged from the plan** — the ledger is scratch and
`git clean -fdx` will take it.

## Done — my tasks (Dev A)

| Task | What | Status |
|---|---|---|
| 3 | Enrollment by registration code + roster cross-check, four error states (ST-E02/E03) | done, review clean (`22153c5`) |
| 9 | Mastery Layer-1 — rolling window, tier progression, coverage, skip semantics (§9.2) | done, review clean after 2 fix rounds (`7c399b7`) |
| 10 | Mastery-driven question selection with graceful degradation ladder (§5.1) | done, review clean after 1 fix round (`1c408e5`) |
| 11 | Attempt submission — adaptive feedback strategies, retry gate, review-book auto-collection (ST-P04/R01) | done, review clean after 1 fix round (`2e070c8`) |
| 12 | Review Book service + session summaries — bookmarking, sorts, deferred summary (ST-R02–R07, ST-P10/P11) | done, review clean after 1 fix round (`1579a6b`) |
| 14 | Student client views — course home, LO list, practice, review book, session summary (ST-P01–P11, ST-R05) | done, review clean after 1 fix round (`c1a9c77`) |

**Not started (by design):**

| Task | What | Status |
|---|---|---|
| 13 | Layer-2 LLM mastery evaluator (§9.2) | "either owner," pre-approved slip candidate — not picked up, needs a coordination check with Saurav first per the plan |
| 16 | Phase exit demo + approved-only serving proof | joint sync point — both developers required, not startable solo |

## Deviations from the plan

Everything below is a place the shipped code does **not** match the plan text
as written, surfaced during task review. None are drift — each was found and
fixed (or explicitly deferred) through the review loop.

### Task 9 — mastery tier design (review rounds 1–3, 2026-07-17)

The `computeProfile` implementation went through three review rounds before
landing:

1. Round 1 shipped `computeProfile` as an **incremental tier delta**
   (one-new-attempt-per-call). Review flagged Critical via a synthetic direct
   call (multi-item window + null prior) that never actually occurs in
   production, but the concern was real: the function's contract wasn't
   documented as narrow.
2. Round 2 "fixed" it by replaying the **full window from `'easy'`** on every
   call — which review then caught **collapsing tier back to `'easy'`** once
   real attempt history exceeds the 10-slot rolling window during a legitimate
   common-misconception-miss streak (the spec requires CM misses to be
   tier-neutral, not tier-resetting). A worse regression than round 1's.
3. Round 3 (controller-directed) reverted to the incremental delta — the
   correct design for `computeProfile`'s real one-new-attempt-per-call
   contract — kept round 2's genuine fixes (fresh `windowAccuracy`/
   `attemptCount`/`windowRoles` recompute; `themeCoverage` N+1 query →
   single `$in`), and documented the narrowed contract explicitly so a future
   reader doesn't repeat round 2's mistake.

→ **If Task 13 (Layer-2 evaluator) or anything else ever calls
`computeProfile` directly (not through `recordAttemptInMastery`), read the
narrowed-contract docstring first** — it is not a general-purpose "replay any
window" function.

### Task 11 — `AttemptRecord.themeId` derivation (review, 2026-07-17)

The plan's excerpt derived `themeId` as `question.themeIds[0]` (an arbitrary
index into the question's tagged themes). For any question tagged across
multiple themes, this corrupted `AttemptRecord.themeId`, the Review Book
entry's `themeId`, and the `themeCoverage()` check backing
`recommendation: 'advance-theme'`. Fixed via a `losCol()` lookup on the
actually-served `loId` — themeId is now derived from the LO the question was
served under, not an arbitrary tag on the question itself. A regression test
tags a question across two themes to pin the fix.

→ **The plan's Task 11 excerpt is stale on this point** — anyone reading it
directly should use the LO-owns-the-theme derivation instead.

### Task 12 — `PUT .../deferred-summary` missing from the API contract (review, 2026-07-17)

Shipped a genuinely new endpoint without updating `docs/api-contract.md`,
violating the Global Constraints rule that all new endpoints match the
contract (contract changes go through two-developer PR review first). Fixed
with a docs-only commit (`1579a6b`) adding the contract entry — request/
response shapes cross-checked against the actual route/service code — and
tightening the `GET .../session-summary` entry to its real
`{ deferred?, welcome }` shape.

→ **This route addition still needs Saurav's sign-off before this branch
merges to `main`**, per the two-developer contract-review convention — it
was documented, not yet jointly reviewed.

### Task 14 — three plan-mandated UI gaps (review, 2026-07-17)

The first implementation pass missed three behaviours the core plan
explicitly calls for. All fixed in one round (`c1a9c77`):

1. No "End session" action from the practice view (core plan: "'End session'
   → summary view"). Added a header link to
   `/course/:id/summary?since=<session start ISO>`, reusing the existing
   `deferSessionSummary` call rather than adding a new endpoint.
2. No "practice this LO more" link per transcript entry (ST-P08). Added
   `loId` to `TranscriptEntry`, populated at the single `recordAttempt` call
   site; verified no closure-capture bug across the retry-in-place /
   LO-advance mutation paths.
3. Submit-attempt failure had no retry path — `errorState(message)` with no
   `onRetry`, unlike every other error site in the same diff, permanently
   soft-locking the practice card on a transient network error. Added
   `onRetry` that re-submits the same `selectedKey`; verified race-free with
   no double-submit.

## Known issues (not blocking, worth a look)

- **Lint**: `server/src/services/review-book.service.ts:1` — `import type`
  eslint rule violation (`@typescript-eslint/consistent-type-imports`),
  `--fix`-able. Flagged in both the Task 12 and Task 14 reviews as
  pre-existing/out-of-scope for those tasks; nobody has picked it up yet.
- **Dead code**: `attempts.service.ts`'s old placeholder `getSessionSummary`/
  `SessionSummary` (superseded by Task 12's real `review-book.service.ts`
  implementation) is now fully unreferenced, with a stale docstring claiming
  the session model is still pending. Safe to delete.
- **`docs/api-contract.md` drift, pre-existing from Task 11**: documents
  `/practice/next`'s response as a nested `{ question: {...}, watermark }`
  shape; the real server response (and Task 14's client type) is flat. Not
  introduced by any of my tasks, but worth a contract fix pass.
- **`listReviewBook`** (Task 12) silently drops entries whose `themeId` no
  longer resolves to a theme document — no error surfaced. Low risk (themes
  aren't deletable in Phase 1 as far as I've built), but worth a defensive
  check if theme deletion is ever added.
- **`session-summary.ts`** (Task 14) shows raw `loId` ObjectId strings
  instead of LO names in the accuracy-by-LO breakdown — `SessionEndSummary`
  has no `loName` field in the contract, so this needs a cross-task contract
  change to fix properly, not a client-only patch.
- Task 9's case-6 rolling-window-eviction test doesn't independently
  discriminate the incremental-delta design from the (rejected) full-replay
  design — the dedicated CM-miss-streak regression test is the real guard
  against a round-2-style regression, not case 6.

## What's left

- **Task 13** (Layer-2 mastery evaluator) — "either owner," pre-approved to
  slip past Aug 9. Not picked up. Modifies my own `attempts.service.ts`, so no
  cross-developer file conflict if I pick it up later, but the plan says to
  coordinate with Saurav first in case he's also considering it.
- **Task 16** (phase exit demo + approved-only serving proof) — joint sync
  point, needs Saurav's instructor-side arc (Tasks 6–8, 15) done first. My
  share (student-serving assertions + student half of the e2e demo) is
  unblocked on my end whenever Saurav's ready.
- This branch has not been pushed or opened as a PR yet.

## What I need from Saurav

1. **Sign-off on the `PUT /api/courses/:courseId/deferred-summary` contract
   addition** (Task 12 deviation above) — it's documented in
   `docs/api-contract.md` but hasn't gone through the two-developer review the
   Global Constraints require for contract changes.
2. **Coordination check before I (or you) pick up Task 13** — pre-approved to
   slip, "either owner," not started by me.
3. **Router param-matching note for your Task 15**: I extended
   `client/src/router.ts` with a pure `matchRoute(pattern, path)` helper
   (`client/src/route-match.ts`, TDD'd, 9 unit tests) for my param routes
   (`/course/:id`, `/course/:id/theme/:themeId`, etc.). Per the plan's own
   coordination note, your Task 15 should reuse this rather than writing a
   second matcher — the router's `Route`/`ViewRender` types now pass extracted
   params to the render function (`(outlet, params) => ...`), and existing
   exact-path routes still work unchanged.
4. **`client/src/ui.ts` heads-up**: I added `masteryBadge`, `optionButton`,
   and `watermark` to the shared UI kit for Task 14's practice/review-book
   views. Your Task 15 also touches `ui.ts` per the plan — check what's there
   before adding overlapping primitives.
5. Nothing else blocking on my end — Tasks 10/11/14 (which needed your
   approved-question seeding path from Task 4) are done and merged into this
   branch.
