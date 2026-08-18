# Student preview in the review queue and question bank — 2026-08-17

**Owner:** Saurav
**Branch:** `saurav/student-preview-in-lists`, cut from `main` at `283c60e`
**Phase:** 5

## The ask

Saurav: *"in the review queue and question bank, we can show the student preview
for questions"* — and, on how it should appear: *"instead of showing the partial
question stem in the lists, we can show the student preview instead so it's
easier on the eyes without the variables."*

Clicking a row continues to open the detail page, where the raw `[NAME]`
template and the editor live.

## What already exists (this is a surfacing job, not a build)

Investigated before planning. Almost every piece is in place:

| Piece | Where | State |
|---|---|---|
| Server-side sample draw | `GET /api/questions/:questionId/sample` | Works. Returns `{seed, stem, options:[{key,text}]}`, substituted server-side so it cannot drift from the serve path. |
| Rich renderer | `renderRichText()` in `client/src/render.ts` | Works. Markdown + KaTeX, already used by both list views. |
| Reference rendering | `question-detail.ts:201-239` — *"Example — what a student sees"* | Works, for parameterized questions only. |
| Row stem rendering | `review-queue.ts:333`, `bank.ts:379` | Both already call `renderRichText` — on the TEMPLATE, not a draw. |

So the work is: give the list rows a drawn stem instead of a template stem.

## What the lists show today

- **Review queue** renders `toDisplayPlaceholders(current.stem)` → `[RATE_PCT]`.
- **Question bank** renders `current.stem` raw → `{{RATE_PCT}}`. Inconsistent
  with the queue, and the uglier of the two. This plan deletes the problem
  rather than fixing it, since neither view will render a template afterwards.
- **Neither** shows options. Out of scope: Saurav asked for the stem.

## Global constraints

- `resolveParamValues` is pure computation with **no DB access**
  (`params.service.ts:107`), so enriching a list response costs arithmetic on a
  version the query already loaded — no N+1 requests, no second round trip.
- Substitution stays **server-side**. Re-implementing the evaluator in the
  browser would create exactly the drift the single-rendering-point rule exists
  to prevent (`formatParamValue` is that point).
- Client is framework-free ES modules; `.js` extensions on imports
  (`client/AGENTS.md`).
- `bank.ts` rebuilds only the results container on keystroke so the search input
  keeps focus (`bank.ts:138-148`). Do not move preview work into the filter bar
  rebuild path.

## Tasks

### Task 1 — server: carry a drawn sample on the list payloads

Enrich the review-queue and bank list items with the drawn stem. Reuse the
existing sample logic rather than writing a second copy of it.

**Seed choice — deliberate:** derive the list seed **deterministically from the
question id**, not from `drawSeed()`. A fresh random seed per page load makes
the numbers change on every refresh, which reads as instability ("didn't that
say $12,400?"). The detail page keeps drawing fresh, where varying numbers are
the point.

Conceptual questions need no special case: their sample is the stored text.
This is the bug the detail panel has (`question-detail.ts:211` early-returns and
renders nothing) and this plan must not reproduce it — a conceptual row must
render its stem, not go blank.

### Task 2 — client: render the drawn stem in both list rows

Swap the two render calls to use the sample stem. The bank's raw `{{NAME}}`
disappears as a side effect.

Keep the fallback honest: if the sample is missing for any reason, fall back to
`toDisplayPlaceholders(current.stem)` rather than rendering an empty row. The
preview is an aid, not a gate — the same stance `question-detail.ts:243` takes.

### Task 3 — tests

Cover the behaviour, not the wiring:
- a parameterized question's list row carries substituted values, no `{{` or `[`
  placeholder left in it;
- a conceptual question's row still carries its stem (the blank-panel bug);
- the same question yields the **same** sample across two list calls (the
  stable-seed decision — this is the test that fails if someone swaps in
  `drawSeed()`);
- fallback when sampling fails.

### Task 4 — verify and open the PR

Full unit suite with `.env` moved aside (CI parity), lint, typecheck. Confirm
the pre-existing Playwright failures are unchanged from `main` — as of
`283c60e` the baseline is 3 e2e failures and 1 a11y failure, all reproduced on
`main`, so any NEW failure is this branch's fault.

## Known limitation, accepted

Bank search filters on the raw stem (`bank.ts:186`), so an instructor who reads
`$12,400` on screen and searches for it gets no match; searching prose still
works. Left alone deliberately — pre-solving it adds a search index for a
problem nobody has reported yet. Revisit if anyone hits it.

## Explicitly out of scope

- Options in the row (Saurav asked for the stem).
- A "draw again" control. Worth considering later on the detail page, where it
  would make the degeneracy classes visible at review time — but it is not what
  was asked for here.
- The BETA=1 / par-bond slot degeneracy. Recurred on CAPM on 2026-08-17 and is
  queued as separate work; it is a generation-side code fix, unrelated to this
  display change.
