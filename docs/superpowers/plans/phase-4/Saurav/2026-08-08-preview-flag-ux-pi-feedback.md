# Preview flag UX — PI feedback (Jose), 2026-08-08

**Owner:** Saurav
**Branch:** `saurav/preview-flag-ux-pi-feedback`
**Phase:** 4 (freeze-legal UI bug fix — "every change in this phase is a test,
a bug fix, or launch configuration")

## Why

Jose (PI) reviewed Instructor Preview and raised three things about the flag
control on the practice card:

1. He could not work out what the **"Send as a test flag to Instructor Queue"**
   checkbox was for.
2. The trailing sentence — *"This is marked TEST and does not count toward
   student analytics or notify real students."* — read as confusing extra
   context rather than an explanation.
3. While the flag form was open he clicked **Submit** and *"nothing happened"*.

All three are real.

**On (1) and (2).** The checkbox only renders in Instructor Preview
(`practice.ts:61`, `allowsInstructorTestFlag: experience.preview`). Checked, it
files a real Flag Queue item tagged `source: 'instructor-preview-test'`, which
`flags.service.ts:139` uses to skip the `student-flagged` label and
`checkAutoPause()`, and which `question-detail.ts:963` renders as "Instructor
Preview Test Flag". Unchecked, the flag is appended to the preview session's
own `flags` array (`preview.service.ts:508-522`) — an array **nothing reads**,
on a 24-hour TTL (`collections.ts:82`). So the off state has no observable
purpose, which is exactly why the label could not explain itself.

**On (3).** `practice-card.ts:348-355` keeps the answer **Submit** button in the
footer while the flag form is open, and it is `disabled` whenever no option is
selected. Two submit-shaped controls, one silently inert.

## ⚠️ Read before Task 2 — this reverses `f08913c`

`sendToInstructorQueue` **used to default to checked in Preview**. Commit
`f08913c` ("test: phase-3 exit checks", fanxiaotuGod, 2026-08-01) changed:

```diff
-  let sendToInstructorQueue = Boolean(adapter.allowsInstructorTestFlag);
+  let sendToInstructorQueue = false;
```

and left the *previous* rationale comment in place above the new one, so the
file currently contradicts itself at `practice-card.ts:89-96`.

Saurav decided on 2026-08-08 to restore the default-on behaviour, on Jose's
feedback, and to tell Stephen. **Do not silently re-flip it.** The reason the
new default is safe is the same reason the TEST tagging exists: a preview test
flag cannot auto-pause a question, cannot earn a `student-flagged` label,
cannot reach student analytics, and cannot notify a student.

The suspicion — not confirmed — is that `f08913c` flipped the source default to
satisfy `instructor-preview.spec.ts`'s isolation assertion rather than as a
product decision. Task 2 keeps that assertion honest by unchecking explicitly
in the test instead.

## Global Constraints

- **Scope is Jose's three points.** The unchecked path still renders
  "Flagged ✓" for a comment that is discarded; that is a known, deliberately
  deferred follow-up (Saurav, 2026-08-08). Do not fix it here.
- **The server default stays `false`.** Only the Preview *client* pre-checks the
  box. `docs/api-contract.md:431` ("The option defaults to false") stays true of
  the API.
- **No behaviour change for live students.** `allowsInstructorTestFlag` is
  `experience.preview`; a real student must never see the checkbox or the tip,
  and `sendToInstructorQueue` must remain `false` on that path.
- House style: files stay near the ~200-line guideline (`client/AGENTS.md`);
  match the surrounding comment density and idiom.
- Jest is `testEnvironment: 'node'` with no jsdom (`tests/AGENTS.md:66-69`) —
  DOM behaviour is testable only in Playwright.
- Every task ends green on `npm run lint` and `npm run typecheck`.

---

## Task 1 — move `helpTip` into the shared UI kit

**Owner:** Saurav

`helpTip()` lives in `client/src/instructor-ui.ts:144-208`, whose own header
declares it the instructor counterpart to `ui.ts`. Task 2 needs it from
`client/src/views/student/practice-card.ts`, a student module, so it has to move
to the shared kit — `client/AGENTS.md:51` names `ui.ts` as exactly that.

### Files

- `client/src/ui.ts` — receives `helpTip` and the `helpTipSeq` counter.
- `client/src/instructor-ui.ts` — loses them; re-exports `helpTip`.
- `client/src/views/instructor/settings.ts` — its import must keep working.

### Steps

1. Move the `helpTipSeq` module-level counter and the whole `helpTip()`
   function, **including its full doc comment**, from `instructor-ui.ts` into
   `ui.ts`. The comment records why this is not hover-only (WCAG 2.1 AA 1.4.13)
   and why a `title=` attribute would regress Phase 4 Task 2 — it is
   load-bearing, not decoration.
2. In `instructor-ui.ts`, `export { helpTip } from './ui.js';` so
   `settings.ts:26` and every other existing call site keeps compiling
   unchanged. `sectionTitleWithHelp` stays in `instructor-ui.ts` (it is an
   instructor section heading) and imports `helpTip` from `./ui.js`.
3. There must be exactly one `helpTipSeq` in the codebase after this — two
   counters would mint duplicate `help-tip-N` bubble ids and break
   `aria-describedby`.
4. Change no behaviour and no CSS. `.help-tip` rules
   (`client/public/styles/main.css:2437-2523`) are unscoped and the tokens they
   use are on `:root`, so the component already renders correctly outside the
   instructor shell.

### Verification

- `npm run lint`, `npm run typecheck`.
- `npx playwright test tests/e2e/setting-help-tips.spec.ts` — the existing #67
  spec must pass untouched. It is the proof the move changed nothing.

---

## Task 2 — the three fixes on the practice card

**Owner:** Saurav

### Files

- `client/src/views/student/practice-card.ts`
- `tests/e2e/instructor-preview.spec.ts`

### Steps

1. **Default the TEST option on in Preview.** Restore
   `let sendToInstructorQueue = Boolean(adapter.allowsInstructorTestFlag);` at
   `practice-card.ts:96`. Delete **both** existing comments above it and write
   one that states: the default is on because Preview exists to exercise the
   real flag loop; the instructor can uncheck it; live student practice never
   exposes the control so it stays `false`; and that this deliberately reverses
   `f08913c` on Jose's PI feedback (2026-08-08) — with a pointer to this plan so
   nobody reverts it a third time.
2. **Replace the trailing sentence with a help tip.** In the
   `adapter.allowsInstructorTestFlag` block (`practice-card.ts:318-336`), drop
   the `el('small', …)` "This is marked TEST and does not count toward student
   analytics or notify real students." node. Keep the `<strong>` label text
   **exactly** `Send as a test flag to Instructor Queue` — the existing spec at
   `instructor-preview.spec.ts:249` matches on it. Add
   `helpTip('the test flag option', …)` beside the label.
   - The tip must sit **outside** the `<label>` element. A `<button>` nested in
     a label makes the label's click target ambiguous and toggles the checkbox
     when the tip is clicked. `settings.ts:34-38` documents this exact trap and
     its `form-field__label-row` solution; follow that pattern.
   - Tip text — explain both states, since the off state is not self-evident:
     > Checked, this files the flag in your Flag Queue tagged as a Preview
     > test — it will not pause the question, count toward student analytics,
     > or notify any student. Unchecked, the flag stays in this preview session
     > only and no one else sees it.
3. **Hide the answer Submit button while the flag form is open.** In the
   `if (!locked)` footer (`practice-card.ts:348-355`), omit the
   `Submit` button when `flagState === 'editing' || flagState === 'submitting'`.
   It must reappear once the flag resolves to `flagged`, `duplicate` or back to
   `idle` — `instructor-preview.spec.ts:182-183` selects an option and clicks
   Submit immediately after sending a flag, so a Submit that never returns
   fails that spec.

### Test changes

4. `instructor-preview.spec.ts` — the *"anonymous preview isolation"* test
   (line ~176) currently flags without touching the checkbox and then asserts at
   line 217 that live `flags` and `notifications` counts are `0`. Under the new
   default that flag becomes a real queue item and the assertion fails. Add an
   explicit `.uncheck()` before sending, so the test keeps proving what it was
   written to prove: **the unchecked path writes nothing to live collections.**
   Do not weaken the `liveCounts` assertion.
5. The cross-tab test (line ~235) calls `.check()`, which is idempotent and
   still passes. Leave the call in place — it documents intent — but assert the
   box is **already checked** on open, so the new default is covered rather than
   masked by a no-op `.check()`.
6. Add coverage in the same spec for the other two fixes:
   - the answer **Submit** button is not present while the flag form is open,
     and is present again after the flag is sent;
   - the ⓘ trigger next to the checkbox exposes the explanation
     (`aria-describedby`), and the removed sentence is gone from the card.

### Verification

- `npm run lint`, `npm run typecheck`.
- `npx playwright test tests/e2e/instructor-preview.spec.ts` — all tests pass.
- Mutation-check each of the three fixes: revert it, confirm the matching new
  assertion fails, restore it. A spec that passes against the old code is
  worthless — this is the standard set by the notification-bell work
  (STATUS.md, 2026-08-02).

---

## Task 3 — docs

**Owner:** Saurav

### Files

- `docs/api-contract.md`
- `docs/superpowers/plans/phase-4/Saurav/STATUS.md`

### Steps

1. `docs/api-contract.md:429-433` — the API default is unchanged, so keep "The
   option defaults to false" and add one sentence: the Preview **UI** pre-checks
   the box, so an instructor who takes no action files a TEST queue item.
   Leave the isolation paragraph at 452-459 as is; it is still accurate.
2. `STATUS.md` — add a `## 2026-08-08 — Preview flag UX (Jose's PI feedback)`
   section recording: the three fixes; that the default-on change **reverses
   `f08913c`** and why; that the unchecked path writes to an unread array on a
   24h TTL and still renders "Flagged ✓", deferred deliberately; and that
   **Stephen needs to be told** about the reversal.
3. Do not edit the shared core phase plan — this is a personal-folder plan.

### Verification

- Links and line references resolve; no other STATUS section reworded.

---

## Task 4 — remove the checkbox entirely (added 2026-08-08, after Tasks 1–3)

**Owner:** Saurav

Tasks 1–3 made the checkbox explicable. Reviewing the result, Saurav asked
whether it was necessary at all. It is not, and this task removes it.

**The argument.** Unchecked is indistinguishable from not flagging: the write
goes to `previewStudentSessions.flags`, which nothing reads, on a 24h TTL. So
the control's two positions are "file a TEST flag" and "do nothing" — and an
instructor who wants the second already has it by not clicking "Flag this
question". Every protection the tip advertises comes from
`source: 'instructor-preview-test'` (`flags.service.ts:139`), not from the
checkbox; it decides only whether the flag exists. A binary toggle that needs
two sentences of explanation is carrying a decision the system should make.

**This closes the deferred black hole** rather than deferring it again: with one
path, "Flagged ✓" is truthful and no discarded-comment state remains.

### ⚠️ Accepted consequence — Preview now always writes one live TEST flag

`instructor-preview.spec.ts`'s isolation assertion currently expects
`[0,0,0,0,0,0]` across attempts, mastery, Review Book, flags, notifications and
session summaries. Flags and notifications become 1. **This is intended, not a
regression** — the same thing happened whenever the box was checked, and
`docs/api-contract.md:452-459` already records the TEST flag as the documented
sole exception to Preview isolation. What changes is that the exception is now
unconditional. Attempts, mastery, Review Book and session summaries stay
isolated and their assertions must NOT be weakened.

### Files

- `client/src/views/student/practice-card.ts`
- `client/src/views/student/experience.ts`
- `tests/e2e/instructor-preview.spec.ts`
- `docs/api-contract.md`, `STATUS.md`

### Steps

1. **Delete the checkbox.** Remove the `adapter.allowsInstructorTestFlag` block
   from the flag form, the `sendToInstructorQueue` state variable, the
   `testFlagId` id, and the now-unused `allowsInstructorTestFlag` adapter field
   (and its assignment at `practice.ts:61`).
2. **Move the decision to the Preview experience.** In
   `createPreviewStudentExperience` (`experience.ts:167-180`), always pass
   `true` for `sendToInstructorQueue`. The practice card then knows nothing
   about it, so drop `options?: { sendToInstructorQueue?: boolean }` from both
   the `PracticeCardAdapter.flag` and `StudentExperience.flag` signatures.
   `LIVE_STUDENT_EXPERIENCE` already ignores the option.
3. **Keep the tip, reattached.** In the same position the checkbox row
   occupied, render a short static note plus a `helpTip`, still gated on
   Preview. Suggested note text: `Sends a Preview test flag`. Trim
   `TEST_FLAG_HELP` to its first sentence — the second describes an unchecked
   state that no longer exists:
   > This files the flag in your Flag Queue tagged as a Preview test — it will
   > not pause the question, count toward student analytics, or notify any
   > student.
4. **Keep the consequence announced, not just available.** Task 1's fix put
   `aria-describedby` on the checkbox so a screen-reader user heard what the
   default action did. The action is now the **Send flag** button, so in
   Preview that button takes the `aria-describedby` instead. Do not simply
   delete the attribute with the checkbox — the accessibility reasoning
   survives the control it was attached to.
5. **Do not change `server/src`.** The API keeps its optional
   `sendToInstructorQueue` parameter defaulting to `false`; only the Preview
   client's use of it becomes unconditional. Removing the parameter is a
   contract change and is out of scope.

### Test changes

6. Update the isolation test: it can no longer `.uncheck()` a control that does
   not exist. Assert the new truth — attempts, mastery, Review Book and session
   summaries still `0`, and exactly one flag exists carrying
   `source: 'instructor-preview-test'`. Do not weaken the four that stay zero.
7. Update the cross-tab test: drop the `.check()` and the already-checked
   assertion; assert instead that no checkbox is rendered.
8. Keep coverage for the surviving behaviour: the ⓘ is present in Preview, its
   text no longer mentions an unchecked state, the **Send flag** button carries
   `aria-describedby` resolving to it, and the answer **Submit** is still hidden
   while the flag form is open.

### Verification

- `npm run lint`, `npm run typecheck`, full `npx jest`.
- `npx playwright test tests/e2e/instructor-preview.spec.ts`.
- Mutation-verify the `aria-describedby` move and the Submit-hiding as before.
- `docs/api-contract.md:429-435` — replace the "the UI pre-checks the box"
  sentence with: the Preview UI always sends the option, so every Preview flag
  files a TEST queue item. Reconcile the isolation paragraph at 452-459 so the
  exception reads as unconditional rather than opt-in.
- `STATUS.md` — append to the existing 2026-08-08 section: the checkbox is gone,
  why, that this closes the deferred black hole, and the accepted isolation
  consequence.

---

## Not in scope (recorded so it is not lost)

- ~~**The unchecked path is a black hole.**~~ **Closed by Task 4** — removing
  the checkbox removes the discarding path, so "Flagged ✓" is now always true.
- **The new help tip will be unscanned by axe.** `tests/a11y/a11y.spec.ts`
  covers real student practice (`#/course/:id/practice/:loId`) but no Preview
  surface, and `playwright.config.ts` sets `reducedMotion: 'reduce'` globally.
  The tip inherits a component already cleared at AA in #58, so the risk is low,
  but the claim "scanned" cannot be made. Same open follow-up already recorded
  for the flag-queue highlight.
