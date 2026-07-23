# Stephen — Phase 1 progress

_Last updated: 2026-07-22_

## Update (2026-07-22, P2-0 code-complete; Saurav informed without blocking)

Stephen explicitly confirmed that P2-0 must continue without waiting for
Saurav's acknowledgment. Saurav is informed through this status and Stephen's
synced Phase 2 plan; his normal integration review remains welcome, but it is
not an implementation gate.

**Branch:** `codex/phase-2-content-runs` (pending PR/merge).

P2-0 persistent content runs and live progress are now code-complete:

- Mongo `contentRuns` stores distinct material-ingest and question-generation
  runs, legal compare-and-set transitions, bounded event history, progress,
  warnings, partial results, and durable terminal errors.
- Agenda carries only `{ runId }`; enqueue failures and startup-interrupted or
  missing jobs become visible failed runs instead of permanent spinners.
- Course-scoped instructor list/snapshot/SSE endpoints recover persisted state
  on connect/reconnect and publish only after successful Mongo writes.
- Material upload/retry links `activeRunId`; generation returns unique
  `{ runId }`, pins allowed grounding Materials/model choices, preserves
  successful Drafts on per-item failure, and reports `partial` truthfully.
- Materials and Pre-seeding now show stage/counters/history over one
  course-level EventSource. The permanent three-second Material polling loop
  is removed; terminal events trigger one convergence refresh.
- `docs/api-contract.md`, component guidance, and the shared Phase 2 plan now
  make P2-0 a foundation for later generation work instead of permitting a
  second job/progress model.

**Automated verification (Node 22.22.3):** lint, server/client typecheck, build,
diff check, focused service/route/SSE tests, and full Jest all pass — **44 test
suites / 433 tests**. Final recovery review also made reconnect replay recent
terminal snapshots (so offline completion cannot leave stale `running` UI),
excluded completed Agenda records from pending-job reconciliation, persisted
allowed grounding IDs before Qdrant retrieval, and isolated Material run/link
failures from permanent `processing`. The live browser reload/reconnect smoke remains an honest
pre-merge checkpoint because the local app and Mongo/Qdrant/SAML backing
services were not running (ports 6118/27017/6333/6122 unavailable).

Phase 1 Task 16 remains explicitly deferred and unchecked; this work does not
claim the Phase 1 exit gate passed.

## Update (2026-07-22, Stephen product decision: defer Task 16 and start Phase 2)

Stephen explicitly chose to **defer, not complete, Phase 1 Task 16** and begin
the Phase 2 improvement lane discovered during Task 16 exploration. This is a
product sequencing decision, not evidence that the Phase 1 exit gate passed:

- Task 16's Approved-only/core-loop E2E checkboxes remain unchecked;
- the repository must not claim Phase 1 fully exited;
- S1/S2 from PR #25 remain the merged correctness baseline; and
- Stephen is taking over P2-0 persistent content runs/live progress from the
  proposed Dev B lane, with Saurav reviewing the API contract before it is
  integrated.

Stephen's Phase 2 execution plan is
[`../../phase-2/Stephen/2026-07-22-phase-2-review-improvements-stephen.md`](../../phase-2/Stephen/2026-07-22-phase-2-review-improvements-stephen.md).
The P2-0 API/domain sync proposal is
[`../../phase-2/Stephen/2026-07-22-p2-0-content-run-contract-proposal.md`](../../phase-2/Stephen/2026-07-22-p2-0-content-run-contract-proposal.md).
It was published for Saurav at `a971d25`; implementation is paused at the
repository-required API-contract review point.

**Stephen override (later on 2026-07-22):** Saurav's acknowledgment is no
longer a prerequisite for P2-0 implementation. Stephen instructed Codex to
start directly, record the takeover here, and inform Saurav asynchronously.
Saurav remains the review/integration counterpart and should not duplicate
P2-0, but his response does not block Stephen's branch from progressing. The
earlier “paused” sentence records the state before this explicit override.

## Update (2026-07-22, PR #25 merged)

**PR #25 is merged to `main`** at `ddf6137` (2026-07-22 23:32 UTC):
`Phase 1 stabilization: strict grounding and CAS transitions`.

S1 strict assigned-material grounding and S2 publication-transition CAS are
now Phase 1's merged baseline; Saurav should not reimplement them. The remaining
Phase 1 exit work is S0 coordination reconciliation plus the joint Task 16
Approved-only/core-loop proof. The later update above supersedes the original
sequencing statement: Phase 2 work has now started while Task 16 remains
explicitly deferred.

## Update (2026-07-22, S1/S2 code-complete)

Stephen's authorized cross-owner stabilization implementation is complete on
`codex/phase-1-stabilization` at **`d96bf6a`**
(`fix: enforce grounded generation and CAS transitions`). It is not yet merged,
so Phase 1 Task 16 remains blocked on this branch landing.

**S1 — strict assigned-material grounding:**

- Qdrant search now accepts payload filters and exposes waited
  delete-by-filter.
- Re-ingest deletes the material's complete prior vector set before upserting
  the deterministic replacement, including the zero-chunk case; payloads now
  include `chunkIndex`.
- Generation allows only ready materials assigned directly to the LO or
  Theme-wide with no narrower LO. Sibling-LO material is filtered at Qdrant and
  rejected again defensively before `sourceRefs`.
- Missing assignments, retrieval failure, and zero usable hits now fail with
  stable errors; none calls the generator or creates an ungrounded Draft.

**S2 — publication transition CAS:**

- transitions update by `_id + expected state` and require `matchedCount === 1`;
- stale concurrent transitions return `question-conflict` / HTTP 409 and write
  no contradictory audit;
- bulk transitions skip conflicts while still propagating infrastructure
  failures.

**Verification (Node 22.22.3):** full Jest **42 suites / 409 tests**, typecheck,
lint, and build all pass. The default shell's Node 18 cannot run the installed
npm/ESLint/build tooling (`util.styleText` / `import.meta.dirname`), so final
verification used the installed compatible Node 22 runtime rather than changing
project scripts.

## Update (2026-07-22, stabilization takeover started)

Stephen explicitly authorized this session to implement S1/S2 directly rather
than wait for Saurav's acknowledgment, provided the cross-owner work is recorded
here so Saurav does not duplicate it.

**Branch:** `codex/phase-1-stabilization` from `origin/main` @ `08eaecc`.

**Stephen is taking over these Dev B-owned stabilization tasks:**

- **S1:** strict assigned-material grounding, filter-aware Qdrant retrieval,
  and clean delete-before-upsert re-ingest;
- **S2:** expected-state compare-and-set for Question publication transitions,
  with 409 conflict behavior and no contradictory audit entry.

Saurav should treat S1/S2 as owned by Stephen for this execution and review the
result rather than starting parallel implementations. Phase 2 has **not**
started: after S1/S2, Phase 1 still requires the joint Task 16 exit proof.

## Update (2026-07-22, later): default stabilization design selected

Stephen authorized Codex to turn the review into the default executable plan
rather than wait for a synchronous design session with Saurav. The plan is now:

1. formally slip Task 13;
2. Dev B implements strict assigned-material grounding and question-transition
   compare-and-set as Phase 1 stabilization;
3. Stephen reviews those two cross-arc changes and drives the joint Task 16
   proof/live checkpoint;
4. persistent run/progress infrastructure starts the Phase 2 content lane; and
5. Phase 2 ownership follows the existing student vs instructor/AI arc split.

Detailed handoff:
[`2026-07-22-phase-1-stabilization-handoff.md`](./2026-07-22-phase-1-stabilization-handoff.md).
Phase 2 ownership/dependency proposal:
[`../../phase-2/Stephen/2026-07-22-phase-2-ownership-dependency-proposal.md`](../../phase-2/Stephen/2026-07-22-phase-2-ownership-dependency-proposal.md).

This is Stephen's approved default. It still stops at the repository's required
sync point: Saurav must have an opportunity to review the handoff before his
tasks are executed or the shared core/API documents are changed.

## Update (2026-07-22): PR #24 merged; Phase 1 closeout / Phase 2 impact review

**PR #24 is merged to `main`** (`7b9c87c`, merged 2026-07-21). The previous
entry below still describes it as open because it is the contemporaneous work
log; this entry supersedes that status.

Ran `npm run sync-plans -- Stephen` on 2026-07-22 and checked both developers'
plan folders plus GitHub's merged PR history. The shared code state is ahead of
some coordination documents:

- Saurav's latest merged work is PR #21 (Phase 1 Task 15 instructor views),
  after PRs #19/#20 for Tasks 7/8. His `STATUS.md` and UI handoff still describe
  those PRs as open/in review; I did **not** edit his personal files.
- The shared Phase 1 core plan still has unchecked implementation steps for
  Saurav's already-merged Tasks 7, 8, and 15.
- Phase 1 Task 13 (Layer-2 mastery) remains unstarted and is an approved slip
  candidate. Task 16 is the uncompleted **joint phase-exit sync point**.
- Phase 2 has a shared implementation plan, but no task has an `Owner` line and
  neither developer has written a personal Phase 2 plan yet. Ownership must be
  agreed before either developer begins that phase.

No code or API contract was changed in this review. I added:

- [`2026-07-22-phase-1-closeout-review.md`](./2026-07-22-phase-1-closeout-review.md)
  — Stephen's coordination checklist for closing Phase 1 without silently
  absorbing new product scope.
- [`../../../specs/2026-07-22-authoring-workflow-review.md`](../../../specs/2026-07-22-authoring-workflow-review.md)
  — a proposal mapping the product review findings onto Phase 1 stabilization
  and Phase 2 dependencies. It is deliberately marked **proposed / pending
  Stephen + Saurav review**.

The key recommendation is to keep most workflow improvements out of the Phase
1 exit gate, but decide two correctness prerequisites before Phase 2 builds on
them: generation must not silently fall back to ungrounded course questions,
and question-state transitions need compare-and-set protection before Phase 2
adds auto-pause/flag resolution. The joint review should decide whether those
land as Phase 1 stabilization tasks or as explicit Phase 2 prerequisites.

## Update (2026-07-21, later): AI-suggested hierarchy done, materials-ingest hang fixed, PR #24 open

**Branch `stephen/ai-suggested-hierarchy` → PR #24, open, not yet merged.**
Two commits:

1. **`fix(genai): fix hosted-LLM endpoint fallback and PDF-parse hangs in
   materials ingest`** — found while manually testing materials upload
   against a real course. Two real bugs, both making the ingest pipeline
   (upload → parse → chunk → embed → Qdrant) silently stall in `processing`
   forever with no error:
   - `env.ts` defaulted `LLM_ENDPOINT` to the local Ollama URL
     (`http://localhost:11434`) whenever the env var was unset **or blank**,
     regardless of `LLM_PROVIDER` — so switching to a hosted provider
     (tested with `LLM_PROVIDER=openai`) without also hardcoding a
     non-empty endpoint silently left every call pointed at a local Ollama
     server that wasn't running. Fixed: `resolveLlmEndpoint()` only applies
     the Ollama default when the provider actually is `'ollama'`. 3 new
     `config.test.ts` cases.
   - The toolkit's PDF parser (`@opendocsg/pdf2md`) can leave its parse
     promise pending forever on an otherwise-valid PDF — reproduced live
     (a real uploaded PDF sat "Processing" for 10+ minutes with the ingest
     job genuinely locked, not just slow). Fixed: `parseFile()` bounds the
     toolkit's PDF attempt to 15s and falls back to Poppler's `pdftotext`
     (60s timeout) on rejection or timeout. 4 new `document-parsing.test.ts`
     cases, including the exact "parser never settles" scenario.
   - Also added `[FinanceBot:RAG]` stage logging through the whole ingest
     pipeline (queued/started/parsed/chunked/embedded/indexed/completed/
     failed) — there was previously **zero console output** anywhere in
     this path, which is why the hang above took real live debugging
     (Mongo/Agenda job inspection) to even see instead of reading a log.
   - Diagnosed collaboratively: found live in this session (traced via
     Agenda's `agendaJobs` collection showing a job genuinely `lockedAt`
     with no completion), the actual fixes were written by Codex per the
     user's request, verified here (typecheck/lint/build/full jest: 41
     suites / 397 tests, up from 40/390).

2. **`feat(client): AI-suggested Topic/LO hierarchy in Course Structure
   editor`** — wires up IN-S06's apply-UI (wireframe N10), which the user
   asked for after learning the backend (`suggestHierarchy`) and client
   fetch function have existed since Task 7/15 but no view ever called
   them (Task 15 deliberately deferred this exact UI). Course Structure's
   toolbar gets a "Suggest Structure (AI)" button → checkbox grid of
   suggested Topics/LOs (all checked by default, instructor can uncheck) →
   "Apply Selected" creates the kept ones via the existing `addTheme`/
   `addLo` endpoints. No new server code. Started by me, polished (grid
   layout, per-topic cards) by Codex in the same working session.

**Not yet verified end-to-end in the browser** (the materials-ingest fix
should be exercised by re-uploading a PDF against a real course and watching
it actually reach `Ready`, then trying the new Suggest Structure button) —
typecheck/lint/build/jest are all that's confirmed so far. Flagging this
explicitly since the user asked to merge without that live click-through.

---

## Update (2026-07-21): two post-merge fixes shipped, AI-suggested-hierarchy in progress

**PR #22 (student UI rebuild) and PR #23 (My Courses 404 fix) are both merged
to `main`.** `main` is now `3b1c668`.

### PR #23 — `listInstructorCourses()` 404-on-one-stale-entry bug (merged)

Found live while testing: `listInstructorCourses()` (`client/src/api.ts`)
used `Promise.all` to fetch one `getCourseTree` per `courseRoles` entry, so a
single stale reference (a course deleted without cleaning up the role — an
existing, documented limitation: course deletion doesn't cascade-clean
`user.courseRoles`) made the **entire** My Courses list 404 and hide every
real course, not just the missing one. A test instructor account had 28
`courseRoles` entries but only 1 course actually existed in Mongo — even
creating a brand-new course still showed `course-not-found`. Fixed by
switching to `Promise.allSettled` and dropping 404s (other errors still
surface). This touches Saurav's Task 15 code; flagged in the PR for his
review even though it's small and isolated.

### In progress, uncommitted: AI-suggested Topic/LO hierarchy (N10)

The user asked whether AI can create LOs — answer was **no, not yet**: the
backend (`suggestHierarchy` in `classification.service.ts`, IN-S06) has been
fully built since Task 7, and `client/src/api.ts` even has a
`getSuggestedHierarchy()` client function for it, but **no view ever calls
it** — Task 15 explicitly deferred the apply-UI to avoid scope creep
(comment in `api.ts`: "no apply-UI is wired up this task"). User asked me to
wire it up.

**Branch:** `stephen/ai-suggested-hierarchy` (synced onto `main` @ `3b1c668`
as of this update). **Not yet committed, not pushed, not reviewed** — this
is genuinely in-progress work, user is testing it live before I commit.

**What's built:** `client/src/views/instructor/structure.ts`'s tree-pane
toolbar gets a "✨ Suggest Structure (AI)" button next to "+ Add Topic". On
click: calls `getSuggestedHierarchy(courseId)` (read-only — the endpoint
never writes), renders the suggested Topics/LOs as a checkbox tree (all
checked by default, mirroring the existing `assign-checklist` pattern from
`materials.ts`'s manual-assign UI), instructor can uncheck anything unwanted,
"Apply Selected" then creates the checked ones for real via the existing
`addTheme`/`addLo` endpoints (same mutation path the manual Add Topic/Add LO
forms already use — no new server code). Empty-materials case (no `ready`
materials yet) shows a friendly "upload materials first" message instead of
an empty suggestion list.

**Verification so far:** `npm run typecheck && npm run lint && npm run build`
clean; `npx jest` 390/390 (unchanged — no server/logic files touched, this is
client-only). **Not yet click-tested end-to-end** — needs a course with at
least one `ready` (fully processed) material to produce a non-empty
suggestion, which requires Ollama + Qdrant actually running locally.

**Also discovered/fixed along the way:** the local dev server got killed
during a `git reset --hard` + rebase to resync this branch onto the newly
merged main — restarted it (`npm run dev` in the background), confirmed
healthy (`/api/health` 200, My Courses correctly shows "123 — Test" as
`faculty`/`faculty`, confirming PR #23's fix works live).

---

## Update (2026-07-20): student UI rebuilt against Figma, PR #22 open

Tasks 3/9/10/11/12/14 below (PR #18) are **merged to `main`**, along with
Saurav's Tasks 1/2/4/5/6/7/8/15 — Phase 1's backend and both instructor and
(pre-rebuild) student UIs are all on `main` as of `a17ede4`.

**New work since then:** once Saurav's Task 15 shipped a real instructor UI
built against the team's Figma "Wireframe v0.2" (green shell + shared
`instructor-ui.ts` primitives), the student side needed the same treatment —
the original Task 14 UI predated that workflow and used the generic
boilerplate shell. Brainstormed + planned + executed as its own 5-task plan:

- Design doc: `docs/superpowers/specs/2026-07-20-student-ui-figma-rebuild-design.md`
- Plan: `docs/superpowers/plans/phase-1/Stephen/2026-07-20-student-ui-figma-rebuild.md`
- **PR #22, open**: https://github.com/ubc/tlef-financebot/pull/22 (branch
  `stephen/student-ui-figma-rebuild`, based on `main` @ `a17ede4`)

All 5 tasks done, each individually reviewed clean, plus a final whole-branch
review (**Ready to merge: Yes**, zero Critical/Important) with its 5 Minor
findings fixed in a follow-up commit before the PR was opened. Full suite:
**390/390 unit tests / 40 suites**, typecheck/lint/build clean, student e2e
(`practice-loop.spec.ts`) passing live.

**Two things worth a second pair of eyes on this PR:**
1. Deleted the generic `buildShell`/`buildSidebar` boilerplate shell (rather
   than keeping it as originally planned) — forced by this repo's strict
   `noUnusedLocals` once nothing called it anymore. Human-confirmed during
   execution; design doc updated to match. The example pages (`/notes`,
   `/rag`, etc.) lose their nav links but stay reachable by direct hash URL.
2. Built a real Bookmark UI (Review Book heart-icon toggle) — turned out no
   Bookmark button existed anywhere in the client despite Task 12's backend
   (`bookmarkQuestion`/`unbookmarkQuestion`) being fully built. Wired for
   real here since the wireframe requires it; no new endpoint.

**Also surfaced, not fixed here (out of scope, flagging for Saurav):**
`tests/e2e/instructor-pipeline.spec.ts` fails on a pre-existing duplicate-
heading bug in `client/src/views/instructor/structure.ts`, traced via git
history to commit `f378db6` (predates this PR, an ancestor of the already-
merged instructor Task 15). Confirmed unrelated to the student-UI changes.

---

## Original entry (2026-07-17)

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
