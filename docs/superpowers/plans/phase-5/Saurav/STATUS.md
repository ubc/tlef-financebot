# Saurav — Phase 5 status

_Last updated: 2026-08-13_

## Where this stands

Phase 5's six core tasks are all `Owner: Stephen`. Saurav's Phase 5 work starts
with **Task 7**, claimed in writing in the shared plan on 2026-08-13, plus the
**Delete for never-used questions** design deferred out of Phase 4.

| Item | State |
|---|---|
| Task 7.1 — LaTeX formula rendering | Planned, not started |
| Task 7.2 — shuffle answer options | Planned, not started. Distribution measured 2026-08-13: **inconclusive, dev DB is empty** — build anyway |
| Task 7.3 — Strategy-A same-question retry | Planned, not started. **Blocked on telling Stephen** |
| Phase-4 Task 3 — Delete for never-used questions | Design settled, nothing built. Deferred here by the Aug 24 freeze |

Plan: [`2026-08-13-practice-rendering-and-retry-fixes.md`](2026-08-13-practice-rendering-and-retry-fixes.md).

## Investigation results (2026-08-13, against `8fd1670`)

Three questions asked, three answers — two defects and one misreading.

**1. Formulas render as flat ASCII.** Not a missing library: KaTeX, marked and
DOMPurify are vendored and `render.ts:61` already wires them with `$…$`
delimiters. Two gaps stop it mattering — `GENERATOR_PROMPT` never mentions LaTeX
(zero grep hits in `generation.service.ts`), and `practice-card.ts:219` renders
explanations with `text:` instead of `renderRichText`. **Exam mode already
renders the same field rich** (`exam-results.ts`), so practice and exam disagree
about the same data; that is what makes it a defect rather than a choice.

Measured while planning: `$…$` and `$$…$$` survive `marked.parse` unchanged,
but `\(…\)` and `\[…\]` are **mangled** — marked strips the backslashes and
KaTeX never sees a delimiter. The standard-looking delimiters are the wrong
choice here. Recorded because it is not guessable.

**2. Options are never shuffled.** No shuffle exists anywhere in server or
client; `practice.routes.ts:151` maps stored order straight through. Grading is
already position-independent (`attempts.service.ts:130` resolves by `key`, then
`role`), so shuffling is safe to add. What decides position is the generator, and
its prompt never says to vary the correct key — 36 of 45 `role: 'correct'`
fixtures sit at `key: 'A'`.

**Measured against the real database on 2026-08-13 — inconclusive.** The local
`financebot` DB holds 1 course, 3 LOs, 2 draft questions (zero approved) and 0
attempt records. The one MCQ has its correct option at `A`, but n=1 is not
evidence. A real sample needs the live-LLM content week or staging access;
neither is worth blocking on, because the fix is cheap and is a no-op if the
distribution turns out uniform. The stronger argument for building it regardless:
without a shuffle, "the correct answer is not predictable from position" depends
on undocumented model behaviour that changes with any model swap.

**3. Strategy A serving a different question on retry is CORRECT per spec.**
`PRD.md:86` mandates it explicitly and `serving.service.ts:164` implements it
deliberately. Saurav's expectation of a same-question retry is a **change of
spec**, not a bug fix — see the warning below.

## ⚠️ Stephen needs to be told before Task 7.3 merges

Task 7.3 reverses `PRD.md:86` and the `selectRetryQuestion` design. **Saurav
decided on 2026-08-13 to change the behaviour and amend the PRD in the same PR.**
Stephen has not been told. Tasks 7.1–7.2 are on a separate branch specifically so
they do not wait on that conversation.

The open sub-decision inside 7.3: `PRD.md:86` also requires the retry to be a
full-weight independent mastery attempt. Once the chosen option is eliminated the
retry is a 3-way choice, so full weight becomes easier to inflate. Either that
clause is amended too, or the inflation is accepted knowingly.

## Also carried into Phase 5

- **Delete for never-used questions** — design in
  [`../../phase-4/Saurav/2026-08-08-question-bank-pi-feedback.md`](../../phase-4/Saurav/2026-08-08-question-bank-pi-feedback.md)
  Task 3. Declined the Aug 24 freeze on 2026-08-08; nothing built; the
  five-condition server-side eligibility rule is settled.
- **`course-setup-guide.ts:1336`** renders option explanations as plain text —
  the same defect as Task 7.1's, in Stephen's file (`4eaea58`). Flagged for him,
  deliberately not edited.
- Jose's *"the first page is unnecessary"* remains Phase 5 Task 2, Stephen's.
