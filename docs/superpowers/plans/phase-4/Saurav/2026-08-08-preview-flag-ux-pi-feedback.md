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

## Not in scope (recorded so it is not lost)

- **The unchecked path is a black hole.** `preview.service.ts:513` pushes to
  `previewStudentSessions.flags`, which no route, service or view reads, and the
  document expires after 24 hours. The card renders "Flagged ✓" either way, so
  an instructor who unchecks gets a success tick for a discarded comment. Fix
  would mirror the existing `duplicate` terminal state at
  `practice-card.ts:268-274`. Deferred by Saurav, 2026-08-08.
- **The new help tip will be unscanned by axe.** `tests/a11y/a11y.spec.ts`
  covers real student practice (`#/course/:id/practice/:loId`) but no Preview
  surface, and `playwright.config.ts` sets `reducedMotion: 'reduce'` globally.
  The tip inherits a component already cleared at AA in #58, so the risk is low,
  but the claim "scanned" cannot be made. Same open follow-up already recorded
  for the flag-queue highlight.
