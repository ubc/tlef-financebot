# Question Pages Into the Workspace — Phase 3 Checklist

**Spec:** `docs/superpowers/specs/2026-11-18-question-pages-into-workspace-design.md`
**Phase:** 3 of 3 — **Parameters** mode (D6), old URLs redirect (D7), Edit
together removed (D5), Question details and Parameterization Configuration
deleted. Phases 1–2: `2026-11-18-question-pages-into-workspace-phase-1.md`,
`…-phase-2.md`.
**Branch:** continue on `question-pages-workspace`; commit after each task.

**Done for the phase:** `question-detail.ts`, `param-config.ts`,
`collaborative-editor.ts` and their routes, styles and tests are gone; every old
URL lands on the right question, tab and mode in the workspace; nothing in the
app links to `/bank/:questionId`; `yjs` is no longer a dependency.

## Decisions made while planning

- **P3-1 Saving parameters of an approved or paused question returns it to
  review** (pending the developer's confirmation). Formulas decide which value
  is correct, so this is a content edit like Edit (phase 1). Parameters
  therefore saves through the generic `PATCH /api/questions/:id` (which
  already accepts `paramSlots`, `derivedValues`, `numericKind`, verifies them
  and returns `verificationError`) with `submitForReview: true` for those
  states. `PATCH …/params` stays for API compatibility but the UI no longer
  uses it. The alternative is today's rule (IN-Q09: "saving does not change
  approval"), which keeps `PATCH …/params`.
- **P3-2 Parameters mode needs the same conditions as D6**: the question has
  `paramSlots`, `derivedValues` or a migrated `generateScript`, or its stem has
  a `{{NAME}}` placeholder. It is not offered for archived questions (like
  Edit). It collapses the inspector (D8), like Compare.
- **P3-3 A migrated `generateScript` stays read-only.** Parameters shows the
  existing banner (values come from the script, the table is ignored) and never
  sends `generateScript`.
- **P3-4 "Origin & family" moves to the Review tab.** It is the last piece of
  Question details without a home: provenance text (with the original origin
  for edited versions) and `templateFamilyId`. `provenanceText` moves to
  `questions-model.ts` with unit tests.
- **P3-5 Collaboration data is left in place.** Code that reads
  `questionDrafts` / `questionPresence` goes; course deletion keeps deleting
  both collections by name; the `collaborationDraftId` / `collaborationCommitId`
  fields stay optional on `QuestionVersion` as history (spec D5).

## Tasks

- [ ] **1. Parameters mode.** New `questions-params.ts`, one instance per
  loaded question, adapted from `param-config.ts`:
  - Stem with `[NAME]` chips; slot rows (name, description, min, max, step or
    a values list, "found in stem" / "not in stem"); computed rows (name,
    formula, mistake for distractors); add/remove rows; migrated-script banner
    (P3-3); verification banner (`numericVerificationSummary`, or "Not
    verified — this question will not be served to students" with the
    server's reason).
  - **Draw five samples** (`previewQuestionParams` with the unsaved drafts),
    showing warnings and each draw's stem.
  - **Save parameters** per P3-1, then show the returned verification, refetch
    the workspace and reload. A 409 keeps the drafts and says the question
    changed. Blank rows are dropped, `derivedValues` always sent (as today).
  - Unsaved drafts make the reader locked: leaving the mode or the question
    asks first.
  - Mode option per P3-2; `mode=params` in the URL; `ReaderMode` and
    `parseMode` gain `params`; the inspector collapses.
  - Remove the "Parameters" link from More actions.

- [ ] **2. Review tab: Origin & family (P3-4).** A collapsed `<details>` in the
  Review panel after Source evidence.

- [ ] **3. Old URLs redirect (D7).** `legacyQuestionsPath` handles
  `/instructor/course/:id/bank/:questionId`, `…/params` and `…/collaborate`:

  | Old URL | New |
  |---|---|
  | `bank/:q` | `questions?q=:q` |
  | `bank/:q?intent=regenerate` | `questions?q=:q&mode=compare` |
  | `bank/:q?from=flags&flagVersionId=v&intent=edit` | `questions?tab=flags&q=:q&mode=edit&flagVersionId=v` |
  | `bank/:q?from=flags&…&intent=archive` | `questions?tab=flags&q=:q` |
  | `bank/:q?analyticsVersionId=v` | `questions?q=:q&analyticsVersionId=v` |
  | `bank/:q/params` | `questions?q=:q&mode=params` |
  | `bank/:q/collaborate` | `questions?q=:q` |

  `main.ts` routes the three paths to `renderLegacyQuestionsRedirect` (which
  needs `questionId` from the path). Without `tab` the workspace already opens
  the tab that holds the question. Unit tests for every row.

- [ ] **4. In-app links.** Exam builder "Open question details" and import
  results link to `questionsPath(courseId, { q })`. `shell.ts` drops the
  `bank/:questionId` entry from the Questions item's `also` list.
  `similarity-label.ts` goes with Question details (its only user).

- [ ] **5. Tutorials.** `instructor-question-editor` attaches when Edit mode
  opens (selectors on the editor and the Edit footer);
  `instructor-parameters` attaches when Parameters opens. Both definitions get
  `path: "questions"`; `tutorial-help.ts` reasons say "open Edit" / "open
  Parameters". `instructor-collaboration` is removed (task 7).

- [ ] **6. Delete Question details and Parameterization Configuration.**
  `question-detail.ts`, `param-config.ts`, `similarity-label.ts`; their
  routes; their CSS in `main.css` and `questions-workspace.css`
  (`.question-detail*`, `.param-config*`, `.param-slots`, `.vardef*`,
  `.param-preview*`, `.slot-chip`, `.option-editor*`, `.question-sample*`,
  `.question-chips`, `.agent-report-*`, `.verification-banner*` — each removed
  only after `grep` shows no other user, e.g. TA views or the new Parameters
  mode). Remove "Open full details" from More actions.

- [ ] **7. Remove Edit together (D5, P3-5).** As listed in the spec:
  client page, API module, CSS and `<link>`, route, tutorial
  (`tutorial-definitions.ts`, `tutorial-help.ts`, `tutorials.service.ts`);
  server routes and mount, service, `types/collaboration.ts`, collection
  accessors and indexes, the `collaborationDraftId` / `collaborationCommitId`
  input path in `questions.service.ts`; `yjs` dependency and its vendoring;
  `playwright.collaboration.config.ts`, `question-collaboration.spec.ts`, the
  two collaboration unit tests and the collaboration cases in the questions
  service/route tests. Remove the "Edit together" link from More actions
  (More actions then holds only Reload — make it a plain **Reload** button).
  `npm run typecheck`, `npm test` and `npm run lint` pass.

- [ ] **8. Styles.** Parameters tables in the wide reader (horizontal scroll
  inside the table only at narrow widths), verification banners, draws list.
  Light/dark and 390px.

- [ ] **9. Mocked e2e (`questions-workspace.spec.ts`).**
  - Parameters offered only for a parameterized question; `mode=params`
    opens it; the inspector collapses.
  - Edit a range and a formula → Draw five samples sends the drafts → Save →
    PATCH body (`paramSlots`, `derivedValues`, `expectedVersionId`,
    `submitForReview` for an approved question per P3-1); a
    `verificationError` shows the not-verified banner.
  - Leaving with unsaved parameters asks.
  - Every D7 row lands on the right tab, question and mode.
  - Origin & family in the Review tab.
  - 390px dark axe with Parameters open.

- [ ] **10. Migrate the specs that drove the deleted pages.**
  - Mocked: `action-progress` (param preview busy state),
    `numeric-verification-status` (verification banner on save),
    `question-edit-concurrency` (409 on edit and on parameters),
    `exam-builder` (link), `role-tutorials` if it lists the removed tutorial.
  - Full stack: `numeric-parameterization`, `instructor-sample-render`,
    `custom-generation` — run against the local stack and record results here.
  - Delete `question-collaboration.spec.ts` (task 7).

- [ ] **11. Docs.** `docs/api-contract.md` (remove the collaborative drafts
  section; note that the UI saves parameters through `PATCH
  /api/questions/:id`), `client/AGENTS.md`, `server/src/routes/AGENTS.md`,
  `server/src/services/AGENTS.md`, `tests/AGENTS.md`, AGENTS.md "Current
  state", the spec's status ("implemented"), and tick this checklist.
