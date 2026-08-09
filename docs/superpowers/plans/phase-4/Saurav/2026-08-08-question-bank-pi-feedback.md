# Question Bank / generation — PI feedback (Jose), 2026-08-08

**Owner:** Saurav
**Branch:** `saurav/question-bank-pi-feedback`
**Phase:** 4, with one deliberate exception (Task 3 — see the freeze note)

## Why

Jose walked the generation flow and reported:

1. *"I started at Question Bank, selected an LO, question type and status, then
   Generate Question. It showed me all the LOs, I was expecting to see only the
   one I selected."*
2. *"Then I clicked Generate again and moved me to the end. I think the first
   page is unnecessary, we could start at the one with all the LOs."*
3. *"Not sure what the 'blueprint' is."*
4. *"Should we add a Delete button? Not sure if all questions we won't use
   should be Reject & Archive."*
5. Praise, no action: the pre-done prompts, MCQ confounder quality, the
   Reviewer Agent.

**(1) is a real defect, not a misreading.** `bank.ts:340-357` puts
`+ Generate Question` inside the `.bank-filters` flex row — the same container
as search, Topic, LO, Type and Status — and its handler is
`navigate('.../preseeding')` with **no state carried**. The UI implies the
filters scope the action; the code discards them. `.bank-filters`
(`main.css:4430-4436`) is a single `display:flex` row, so the grouping is
visual as well as structural.

**(2)'s "moved me to the end"** is `openFormFor()` (`preseeding.ts:333-339`)
calling `scrollIntoView` on a form that sits below the whole coverage table.

## ⚠️ Ownership — Task 1 overlaps Stephen's next slice

Phase 5 **Task 2 "LO-centred Content Studio"** is `Owner: Stephen`, still
unchecked, and his Phase 5 STATUS names it *"the next Stephen-owned Phase 5
slice."* It covers *"direct Generate, Import, Review, Preview, and Analytics
transitions without duplicating the underlying feature pages"* — the same
journey Jose is complaining about.

**Task 1 below is deliberately scoped to the defect, not the redesign.** It
carries the filter state that is currently dropped and moves one button out of
a container it does not belong in. It does not restructure the coverage page,
does not merge pages, and does not build an LO workspace — all of which stay
Stephen's. Carrying `loId`/`type` through is something a Content Studio would
want regardless, so this should not conflict with his work.

**Saurav must tell Stephen before Task 1 is merged.**

Jose's *"the first page is unnecessary"* is the redesign half. It is **not**
in this plan; it is Stephen's Task 2. Recorded at the end so it is not lost.

## ⚠️ Freeze note — Task 3 is a new feature

Phase 4's rule is "every change in this phase is a test, a bug fix, or launch
configuration", and the Aug 24 feature freeze is 16 days out. Tasks 1 and 2 are
a bug fix and a copy change. **Task 3 (Delete) is a new capability and does not
meet that bar.** It is planned here so the design is settled, but it must not
be implemented until Saurav explicitly signs off on jumping the freeze. If the
answer is no, Tasks 1-2 ship alone and Task 3 moves to Phase 5.

## Global Constraints

- Do not restructure the coverage page or merge it with the bank — Stephen's.
- House style: match surrounding comment density and idiom.
- Jest is `testEnvironment: 'node'` with no jsdom (`tests/AGENTS.md:66-69`);
  DOM behaviour is Playwright-only.
- Every task ends green on `npm run lint`, `npm run typecheck`, and full `npx jest`.
- Mutation-verify each behavioural fix: revert it, confirm the covering
  assertion fails, restore it.

---

## Task 1 — stop the Generate button pretending to be a filter

**Owner:** Saurav

### Files

- `client/src/views/instructor/bank.ts`
- `client/src/views/instructor/preseeding.ts`
- `client/public/styles/main.css`
- `tests/e2e/` (new or extended spec)

### Steps

1. **Move the button out of the filter row.** `+ Generate Question` and the
   disabled `↑ Import` are actions, not filters; they currently sit as the last
   two children of `.bank-filters`. Put them in their own container so the
   filter bar reads as filters only. Keep both buttons on the page and keep
   their existing labels — this is about grouping, not relabelling. Add
   whatever minimal CSS the new container needs; do not restyle the filters.
2. **Carry the filter state.** When `+ Generate Question` is clicked with a
   Topic/LO or Type filter active, pass them to the coverage page as query
   parameters (e.g. `?loId=…&type=…`). Status is a *bank browsing* filter with
   no meaning for generation — do not carry it, and do not silently imply it
   was honoured.
3. **Consume the state on arrival.** In `preseeding.ts`, read those parameters
   and, when an `loId` is present and valid for the course, call the existing
   `openFormFor(loId)` path so the form opens prefilled for that LO instead of
   the instructor re-picking it from the full table. Prefill `formType` from
   `type` when present. An absent or unknown `loId` must fall back to today's
   behaviour exactly — do not throw, and do not leave a half-filled form.
4. **Do not suppress the coverage table.** Jose's *"start at the one with all
   the LOs"* is Stephen's redesign. The table stays; this task only means he
   arrives with his LO already selected rather than having to find it again.
5. Check whether `openFormFor`'s `scrollIntoView` still reads well when the
   form is opened on arrival rather than by a click. A smooth-scroll the
   instructor did not initiate may be disorienting; prefer focusing the form's
   first control so keyboard and screen-reader users land there too. Use your
   judgement and record what you chose and why.

### Verification

- A Playwright test: apply an LO filter in the bank, click
  `+ Generate Question`, and assert the generation form opens with that LO
  already selected. Assert the no-filter path still lands on the plain coverage
  table.
- Assert `+ Generate Question` is no longer a descendant of `.bank-filters`.
- Mutation-verify: drop the query parameter, confirm the prefill assertion
  fails, restore.

---

## Task 2 — rename "Blueprint" and explain it

**Owner:** Saurav

### The naming trap

Do **not** call it "Saved Prompts". Two different things already live in that
form and "prompt" belongs to the other one:

- `PRESET_TEMPLATES` / `GET /api/generation/presets` (`preseeding.ts:111-146`,
  `:631-642`) — the starter prompt buttons. These are the *"pre-done prompts"*
  Jose praised.
- **Blueprints** (`generation-blueprints.service.ts`) — a saved bundle of
  **LO + question type + difficulty + prompt text**, re-runnable in one click
  via "Run blueprint".

A blueprint is the whole request, not a prompt. "Saved Prompts" would collide
with the presets sitting inches away, and "Presets" is already taken.

**Use "Saved Setup".** Accurate, plain, no collision.

### Files

- `client/src/views/instructor/preseeding.ts`
- `tests/e2e/` (extend the Task 1 spec or add one)

### Steps

1. Rename the **user-facing strings only**: "Saved blueprint" → "Saved Setup",
   "Blueprint name" → "Setup name", "Save blueprint" → "Save setup",
   "Run blueprint" → "Run setup", and the `Saved blueprint “…”.` /
   `Blueprint run queued…` status messages. Keep "Custom request" as the empty
   option.
2. **Do not rename the API, service, collection, types, or routes.**
   `GenerationBlueprint`, `generation-blueprints.routes.ts`, and
   `/api/courses/:courseId/generation-blueprints` all stay. This is a copy
   change; renaming the contract is a much larger change with no user benefit.
   Add a short comment where the UI strings are defined noting the deliberate
   divergence between the UI name and the code name, so the next reader is not
   confused by the mismatch.
3. Add a `helpTip` beside the "Saved Setup" field — `helpTip` is exported from
   `client/src/ui.ts` (moved there on branch `saurav/preview-flag-ux-pi-feedback`;
   **rebase or merge that first**, or the import will not exist). Follow
   `fieldLabelWithHelp` in `views/instructor/settings.ts:34-38` — the tip must
   sit OUTSIDE the `<label>`. Suggested text:
   > Saves this Learning Objective, question type, difficulty and prompt
   > together so you can re-run the same request later without setting it up
   > again.
4. Grep for any other user-visible "blueprint" — including
   `docs/api-contract.md` if it documents the UI label rather than the route.

### Verification

- Playwright: the ⓘ is present, its text mentions re-running, and no
  user-visible "blueprint" string remains on the page.
- `npx jest` — the service/route tests still pass unchanged, which is the proof
  that only copy moved.

---

## Task 3 — Delete for never-used questions  ⚠️ NEEDS SIGN-OFF, see freeze note

**Owner:** Saurav

### The constraint that shapes this

There is no hard delete anywhere today. `Reject & Archive` sets
`state: 'archived'` and is reversible via Restore to Draft
(`question-detail.ts:96-100`). That is deliberate: `PRD.md:34` guarantees every
`AttemptRecord` stays interpretable by pinning it to the exact version served,
so deleting a question a student answered corrupts history.

**That argument only covers questions that were used.** A generated Draft that
was never approved was never served, has no attempts, and can be deleted losing
nothing. That is precisely Jose's case — culling duds from a generation batch,
not retiring real content.

### The eligibility rule — enforced on the SERVER

A question may be hard-deleted only if **all** hold:

- it has never been `approved` (check state history/audit, not just the
  current state — an archived question that was once approved is NOT eligible);
- zero `AttemptRecord` documents reference it;
- zero `ReviewBookEntry` documents reference it;
- zero `Flag` documents reference it;
- it is referenced by no `ExamAttempt.questions[]` entry
  (`domain.ts:596-601`).

Preview-only records (`PreviewAttemptRecord`, `PreviewReviewBookEntry`,
`PreviewFlagEntry`) are ephemeral with a 24h TTL and must **not** block
deletion; delete them alongside.

The client must never be trusted for eligibility — recompute it server-side on
every call. A question that becomes ineligible between render and click must be
rejected with a clear error, not silently deleted.

### Files

- `server/src/services/questions.service.ts`, `server/src/routes/questions.routes.ts`
- `client/src/api.ts`, `client/src/views/instructor/question-detail.ts`
- `docs/api-contract.md`
- `tests/unit/`, `tests/e2e/`

### Steps

1. Service function returning a structured ineligibility reason rather than a
   bare boolean, so the UI can say *why* a question cannot be deleted.
2. `DELETE /api/courses/:courseId/questions/:questionId`, Instructor-only.
   Match the existing authorization pattern in `questions.routes.ts` — note the
   ordering trap documented at `:225` and `:251` about `ensureCapability` vs
   `ensureCourseInstructor`. Cascade to the question's `QuestionVersion`
   documents and its preview-only records; delete nothing else.
3. UI: a **Delete** action on question detail, shown only when eligible,
   alongside (not replacing) Reject & Archive. It must use the existing
   confirmation-dialog pattern the reject flow uses (`:583`, `:629`) and the
   confirmation must state plainly that this is permanent and unlike archiving
   cannot be undone.
4. Where a question is ineligible, do not render a dead or mysteriously absent
   button — either omit it with the archive path clearly available, or disable
   it with the server's reason as the explanation. Pick one and be consistent.
5. `docs/api-contract.md` — document the route AND the eligibility rule. The
   rule is the interesting part; a bare route line is not enough.

### Verification

- Unit tests for each ineligibility reason **and** the happy path. Include the
  once-approved-now-archived case explicitly — it is the one most likely to be
  got wrong, and the one that would corrupt history.
- A test that the cascade removes `QuestionVersion` documents and leaves
  unrelated questions untouched.
- Playwright: delete a fresh Draft; confirm it disappears from the bank and a
  reload does not bring it back.
- Mutation-verify the server-side eligibility check by attempting a delete
  against an attempted question and asserting it is refused.

---

## Not in scope (recorded so it is not lost)

- **Jose's "the first page is unnecessary"** — merging the bank, the coverage
  table and the generation form into one journey. This is Phase 5 Task 2,
  `Owner: Stephen`. Task 1 above only stops the filters being discarded.
- **Jose's actual ask** — generate across several LOs, difficulties and both
  MCQ and True/False, then judge whether the difficulty labels and question
  structure hold up. That is a content-quality review for Saurav to perform,
  not code. Parameterized generation is WIP and he was asked to skip it.
- **TEST-flag counters** — carried over from the Preview flag work: `listFlags`
  applies no `source` filter, so Preview test flags count toward the Launch
  Cockpit's open-flag action and the daily summary. Unchanged here.
