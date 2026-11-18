# Question Pages Into the Workspace — Phase 2 Checklist

**Spec:** `docs/superpowers/specs/2026-11-18-question-pages-into-workspace-design.md`
**Phase:** 2 of 3 — flag correction in the reader (D4), **Compare** mode, and
the recorded analytics version notice. Phase 1:
`2026-11-18-question-pages-into-workspace-phase-1.md`.
**Branch:** continue on `question-pages-workspace`; commit after each task.

**Done for the phase:** fixing, archiving and clearing a flagged question,
regenerating a review question side by side, and opening a question from
Student Analytics all happen in the Questions workspace. Nothing in the app
links to Question details for these any more (exam builder, import results and
similarity links move in phase 3 with the redirects).

## Decisions made while planning

- **P2-1 A flag fix keeps the question live.** Saving a correction from a flag
  does not send `submitForReview`: the instructor is correcting a question
  students already have, and the server's `correct` resolution un-pauses a
  paused question (`flags.service.ts`). This is what Question details does
  today. The Edit-mode warning says so: "Students get the corrected question as
  soon as you save." A plain Edit (not from a flag) still returns an approved
  or paused question to review (phase 1).
- **P2-2 Notification is automatic for real flags**, as in Question details:
  after the resolutions, `notifyRemediation` runs once on the first non-test
  flag of the group. Test flags (`instructor-preview-test`) are resolved but
  never notify. The flag card's remediation panel then shows "Notified N
  students" from the persisted marker.
- **P2-3 Archive happens in the flag card**, with a confirm dialog that has the
  optional reply field (like Clear). The server already handles several flags
  in one group (`archive` skips the transition once archived), so the card's
  `archived->archived` translation is removed.
- **P2-4 Compare is available in the To review states only**, as the
  "Regenerate side by side" link is today. Leaving Compare with a generated,
  unsaved alternative asks first (it cost a generation).
- **P2-5 Replace with variant keeps today's fields**: stem, options,
  difficulty, `paramSlots`, `derivedValues`, `numericKind`. Source references
  of the variant are not saved, as today.

## Tasks

- [x] **1. URL state.** `questionsPath` gains `flagVersionId` (written only
  with `mode=edit`) and `analyticsVersionId` (written only with `q`).
  `ReaderMode` gains `'compare'`; `parseMode` accepts it. `questions.ts` reads
  both ids on load and passes them to the reader (`initialFlagVersionId`,
  `analyticsVersionId`); selecting another question drops them. Unit tests in
  `questions-model.test.ts`.

- [x] **2. Flag fix in Edit mode (D4).**
  - `createFlagCard` gains `onCorrect(group)`. **Correct the question**
    becomes a button that calls it; the reader enters Edit with a flag context
    `{ versionId, flags }` (the group's open flags). The URL gets
    `mode=edit&flagVersionId=`; loading that URL rebuilds the context from the
    card's flags (open/escalated flags of that version) once they load.
  - In flag Edit, above the editor: "Fixing N reports" (with "TEST ·
    Instructor preview" when any are test flags), the P2-1 warning, and
    **Reply to flagging students** (optional textarea). With only test flags:
    "This is a test flag, so no student gets a message."
  - Footer: **Cancel editing** / **Save and resolve**. Without a change:
    "Edit the question before resolving the reports." Otherwise:
    `editQuestion` (changed fields, no `submitForReview`) → `resolveFlag(id,
    'correct', true, reply)` for each flag → `notifyRemediation` on the first
    real flag (P2-2) → back to Read, flag card reloads, workspace refetches.
    Message: "Question corrected. N reports resolved; M students notified."
  - Partial failure: if the edit saved but a resolution or the notification
    failed, say exactly that ("The question was saved, but …"), leave Edit,
    and let the flag card show what is still open.
  - Selecting another question or leaving Edit drops the flag context.

- [x] **3. Archive and Clear in the flag card (P2-3).** **Archive the
  question** becomes a button: `textPromptDialog` ("Archive the question?",
  reply field, danger tone) → `resolveGroup(group, 'archive', reply)` →
  `onChanged`. Remove `editorPath` and the `archived->archived` handling;
  update the module comment. Clear is unchanged.

- [x] **4. Compare mode (D2, D8).** New `questions-compare.ts`, one instance
  per loaded question (like the preview):
  - Shown as a mode option for To review states only (P2-4). The More actions
    "Regenerate side by side" link goes.
  - Prompt textarea (today's default text) and **Generate alternative**
    (`regenerateQuestion`). While generating, the mode control and actions are
    locked and the button says "Generating alternative…".
  - Current and generated versions side by side (stacked below 820px):
    stem and options rendered rich with `authoringAnswer`, placeholders shown
    as `[NAME]`, difficulty; the generated version's check (decision badge,
    reasoning, suggestions).
  - **Replace with variant** → `editQuestion` with P2-5 fields and
    `expectedVersionId` → "Variant saved as version N." → Read.
    A 409 keeps the variant on screen and says the question changed.
  - Leaving Compare (mode control or another question) with an unsaved
    variant asks "Discard the generated alternative?".
  - **Collapse the inspector (D8)**: the reader gets `is-wide` while Compare
    is open; the aside is hidden and the reading pane takes its column. It
    comes back on the tab it showed when leaving Compare.

- [x] **5. Recorded analytics version notice.** When the reader opens with
  `analyticsVersionId`, a notice above the mode control loads
  `getAnswerDistribution(courseId, questionId, { versionId })` and shows
  "Recorded analytics version N · Current content" or "· Historical content —
  the reader shows the current version", with the recorded stem and options in
  a `<details>`. 404/400 → "The requested recorded version was not found."
  Other errors → retry. **Dismiss** removes it and the URL parameter.

- [x] **6. Links.** `analytics.ts` "Review question (recorded version N)" →
  `questionsPath(courseId, { q, analyticsVersionId })` (the workspace opens the
  tab that holds the question). Question details keeps working for its other
  entry points until phase 3.

- [x] **7. Styles.** Flag Edit header and reply field, Compare prompt and
  two-column comparison (one column ≤ 820px container), `is-wide` reader,
  analytics notice. Light/dark and 390px.

- [x] **8. E2E (mocked, `questions-workspace.spec.ts`).** Mock handlers for
  `POST /api/courses/:id/questions/:qid/regenerate`,
  `POST /api/flags/:id/remediation/notify`, the resolve body's
  `correctnessAffecting`, and `GET …/analytics/questions/:qid/distribution`.
  - Flag fix, real flags: Correct → Edit with "Fixing 2 reports"; Save without
    a change is refused; change the stem + reply → PATCH without
    `submitForReview`, two `correct` resolutions with `correctnessAffecting`
    and the reply, one notification; URL had `mode=edit&flagVersionId=v5`.
  - Flag fix, test flag only: resolved, no notification, test note shown.
  - `…&mode=edit&flagVersionId=v5` in the URL opens the flag fix directly.
  - Archive from the card: dialog with reply → `archive` resolutions → the
    question is in Archived.
  - Compare: offered only in To review; inspector hidden while open and back
    after; generate → both versions and the check; Replace → PATCH with the
    variant's fields; leaving with a variant asks.
  - Analytics notice: historical version shown; Dismiss clears the URL.
  - Update the flag-card test that checked the old `href`s.
  - 390px dark axe check with Compare open.

- [x] **9. Full-stack specs that drove Question details for these flows.**
  `instructor-preview.spec.ts` (test flag → Correct → "Save & Update Question
  Bank") moves to the workspace's Save and resolve. `analytics-dashboard.spec.ts`
  checks the new link and opens the workspace URL instead of `/bank/:id`.
  Run both against the local stack and record the result here. (`flag-loop`
  only checks the reader's stem and is not affected.)

- [x] **10. Docs.** `client/AGENTS.md` (flag fix, Compare, analytics notice,
  new URL parameters), AGENTS.md "Current state", tick this checklist.

## Notes from implementation

- `analytics-dashboard.spec.ts` drove Question details' recorded-version
  notice; those retry / not-found checks now live in
  `questions-workspace.spec.ts` against the workspace notice, and the analytics
  spec checks the new `questions?q=&analyticsVersionId=` link. 10/10 pass.
- `instructor-preview.spec.ts` (full stack, run 2026-11-18): the test-flag test
  now corrects through Save and resolve and passes. Its student half was stale
  (the learning workspace reports through "Report a problem" and starts with
  "Start lesson →"), so those steps were updated too. The other test in the file,
  "uses the full student shell…", fails before reaching any workspace code: it
  expects an "Exam Prep" sidebar link that the unified course sidebar no longer
  has. Not changed here.
- Compare labels each option region with its column ("Generated alternative,
  Option A") so the two columns' regions stay unique (axe `landmark-unique`).
- A flag fix opened from the URL waits for the flag card to load, then rebuilds
  the context from that version's open flags; with none open, Edit opens
  without a flag context.
