# Question Pages Into the Workspace — Phase 1 Checklist

**Spec:** `docs/superpowers/specs/2026-11-18-question-pages-into-workspace-design.md`
**Phase:** 1 of 3 — inspector tabs (Review / Settings / Team) and reader modes
(Read / Edit / Preview).
**Form:** a short checklist, like `2026-11-09-instructor-questions-workspace.md`.
The spec carries the design; this file tracks order, files and done criteria.
Commit after each task.

**Done for the phase:** an instructor can change difficulty, Topics & LOs,
handle TA suggestions, add internal comments and see a drawn student preview
without leaving the Questions workspace. Question details, Parameters and the
flag-card links still work; they are moved in phases 2 and 3.

## Found while planning

- **Editing an approved question does not return it to review.** The reader
  warns "Saving returns this question to To review", but neither the reader nor
  Question details sends `submitForReview`, and the server changes state only
  when it is sent (`questions.service.ts` `editQuestion`). The edited content
  goes live while still approved. Task 1 fixes this before anything else.
- Difficulty is a content key: changing it makes a new version, clears the AI
  check, and (after task 1) returns an approved question to review. Tag-only
  edits (`loIds`, `themeIds`) make no new version and keep the state.
- `GET /api/questions/:id/sample` draws a fresh seed on every call, so
  **Draw another sample** is just another call.

## Tasks

- [x] **1. Edits of approved and paused questions return them to review.**
  `questions-reader.ts` `editor().save` sends `submitForReview: true` when the
  state is `approved` or `paused` (the server accepts it only in those states).
  Same for the difficulty save in task 5. Question details is left as is (it
  goes away in phase 3).
  Tests: `questions-workspace.spec.ts` mock PATCH records the body and moves an
  approved question to `pending-review` only when `submitForReview` is true; a
  new test edits an approved question and finds it in To review.
  Fix the spec's D1 sentence, which says the server does this on its own.

- [x] **2. Shared helpers out of `question-detail.ts`.**
  Move `addableLoOptions`, `findLoContext` (exported) and `isFieldEdited` to
  `client/src/views/instructor/question-tags.ts`. `question-detail.ts` imports
  them from there; `tests/unit/question-bank-helpers.test.ts` re-points.
  Done: typecheck and that test pass.

- [ ] **3. Reader modes and the mode control.**
  `questions-reader.ts`: replace the `editing` flag with
  `mode: 'read' | 'edit' | 'preview'`. A segmented control at the top of the
  reading pane (buttons with `aria-pressed`, one row, wraps at narrow widths):
  **Read**, **Edit** (hidden for archived questions), **Preview**.
  - The footer **Edit** button goes; the footer shows state actions in Read and
    Preview, and **Cancel editing** / **Save changes** in Edit.
  - Leaving Edit with unsaved changes asks first (same dialog as today);
    selecting another question already does.
  - URL state: `questionsPath` gains `mode` (`edit` | `preview`; Read is the
    default and omitted). `questions.ts` reads it on load, writes it on change,
    and passes it to the reader. Selecting another question resets to Read.
  - Unit tests in `questions-model.test.ts` for `questionsPath` with `mode` and
    a `parseMode` helper (unknown → read).

- [ ] **4. Edit mode does what Question details' editor does.**
  - Placeholders: edit in display form and save in stored form with
    `editableVariableNames`, `toDisplayPlaceholders`, `toStoredPlaceholders`
    (`placeholders.ts`), so a parameterized question is edited as `[NAME]` and
    saved as `{{NAME}}`.
  - Show `unresolvedPlaceholderWarning` in Edit and Read; drop "Fix them in the
    full details" and "Open full details to draw and verify sample values"
    (Preview does that now).
  - Option headers use `ROLE_LABEL` (read-only role, as today).
  - Send only changed fields (`isFieldEdited`), as Question details does; no
    change → leave Edit without a request.
  - A **Load into editor** call from the Team tab (task 7) opens Edit with the
    suggestion's stem and options filled in and marked unsaved.

- [ ] **5. Inspector tabs.**
  New `questions-inspector.ts`: the `aside` gets a tablist (`role="tablist"`,
  arrow keys move between tabs, `aria-controls`) with **Review**, **Settings**,
  **Team**, and the tab panel scrolls. The chosen tab is kept while moving
  between questions (in memory, not the URL). The Team tab label shows the
  pending TA suggestion count (`Team · 2`).
  **Review** holds what the aside holds today: generation tokens, AI check,
  similar questions, source evidence, student visibility. The TA suggestions
  and teaching-team notes blocks move to Team.

- [ ] **6. Settings tab.** New `questions-settings.ts`:
  - **Difficulty**: a select plus **Save difficulty**. Saves
    `{ difficulty, expectedVersionId }` (+ `submitForReview` per task 1), with
    the same returns-to-review note as Edit for approved/paused questions.
  - **Topics & LOs**: Topic names (read-only, from `themeIds`); LO chips with
    remove; an **Add LO** select from `addableLoOptions`. Adding an LO also
    adds its Topic (`findLoContext`), as Question details does. Saves with
    `expectedTags` and `expectedVersionId`.
  - A 409 shows "This question changed since you opened it…" and reloads, as
    the reader does.
  - All Settings controls are disabled while the reader is in Edit mode, with
    the note "Finish or cancel editing first." (a difficulty save would make the
    open edit stale).
  - After a save: `onMutated` refetches the workspace (list rows show the new
    difficulty and tags).

- [ ] **7. Team tab.** New `questions-team.ts`:
  - **TA suggested edits**: one card per pending suggestion — who and when, a
    readable summary of the patch (stem, options by key, difficulty, LOs by
    name), and **Load into editor** (task 4; a difficulty or LO change in the
    suggestion is listed with "set it in Settings"), **Accept exactly**,
    **Discard** (`resolveTaQuestionSuggestion`). Errors show on the card.
    Accept and Discard refetch through `onMutated`.
  - **Internal comments**: the notes list (author, date) and a textarea with
    **Add comment** (`addQuestionInternalNote`); the new note appears without
    a reload.
  - Empty states: "No pending TA suggestions." / "No internal comments yet."

- [ ] **8. Preview mode.** New `questions-preview.ts`: fetches
  `getQuestionSample` for the current version and renders the student view
  (rich stem, options with explanations via `authoringAnswer`, correct option
  marked) with the line "One computed example from the saved version. Students
  may receive different values." for parameterized questions. **Draw another
  sample** only when `sample.parameterized`. Cache per version id; ignore stale
  responses (request counter), as Question details does. Loading and error
  (retry) states.

- [ ] **9. Links and leftovers.** Remove the TA-suggestion "Open full details"
  link (Team replaces it). Move the footer "Open full details ↗" into
  **More actions** (still needed for Compare, Parameters and Edit together
  until phases 2–3). The **Parameters** header button on Question details is
  untouched in this phase.

- [ ] **10. Styles.** `questions-workspace.css`: mode control (matches the
  release panel's segmented control), inspector tablist and panels, Settings
  form and LO chips, Team cards, Preview. Check light/dark and the 390px stack
  (inspector under the reader, tabs and mode control wrap, no horizontal
  scroll).

- [ ] **11. E2E.** `questions-workspace.spec.ts`, mocked API (add handlers for
  `/sample`, `/internal-notes`, `/suggestions/:id/accept|discard`, and tag /
  difficulty PATCHes):
  - Edit an approved question → it moves to To review (task 1).
  - Modes: Read → Edit → leave with unsaved changes asks; `mode=preview` in the
    URL opens Preview; another question resets to Read.
  - Edit on a parameterized question shows `[NAME]` and PATCHes `{{NAME}}`.
  - Settings: change difficulty; add an LO (its Topic is added); remove an LO;
    a stale tag set shows the conflict message; controls disabled in Edit.
  - Team: count on the tab; Load into editor fills Edit; Accept exactly and
    Discard remove the card; add a comment.
  - Preview: shows the sample; Draw another sample fetches again (parameterized
    only).
  - Update existing tests that clicked the footer **Edit** button.
  - The 390px dark axe test runs with each inspector tab open.

- [ ] **12. Docs.** `client/AGENTS.md` (reader modes, inspector modules),
  AGENTS.md "Current state", and tick this checklist. No API contract changes.
