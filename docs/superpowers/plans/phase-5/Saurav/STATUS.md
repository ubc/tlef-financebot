# Saurav — Phase 5 status

_Last updated: 2026-08-13_

## Where this stands

Phase 5's six core tasks are all `Owner: Stephen`. Saurav's Phase 5 work starts
with **Task 7**, claimed in writing in the shared plan on 2026-08-13, plus the
**Delete for never-used questions** design deferred out of Phase 4.

| Item | State |
|---|---|
| Task 7.1 — LaTeX formula rendering | **Code complete and verified.** One open item: nobody has read live-model output yet |
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

## 2026-08-13 — Task 7.1 shipped on `saurav/practice-rendering-and-retry`

**What changed.** `GENERATOR_PROMPT` gained a FORMATTING block telling the model
that stem, options and explanations render as markdown + KaTeX, and
`practice-card.ts` now routes explanations through `renderRichText` like exam
review always has. `derivedValues[].formula` explicitly stays evaluator syntax —
the prompt now says so at the call site, because writing `\frac{}{}` there is the
obvious mistake for the next reader and it would fail to parse.

### The delimiter rule is measured, not chosen

`$…$` / `$$…$$` survive `marked.parse` unchanged; `\(…\)` and `\[…\]` have their
backslashes stripped and never reach KaTeX. The standard-looking delimiters are
the wrong ones here.

### The currency collision is narrower AND wider than first written

The plan originally said "a math span must not open with a bare digit" and
offered `$\$500 \times 1.05$` as the fix. **That fix is wrong and the new unit
test caught it before it shipped.** `currencyDollarIndices` flags *any* `$`
followed by digits then whitespace — including an escaped `\$500 ` inside a math
span, and the second `$` of a `$$` display opener. Measured:

| Shape | Renders? |
|---|---|
| `$P \times 1.05$` | ✅ |
| `$\frac{D_1}{r-g}$` | ✅ |
| `$\text{FV} = 500 \times 1.05$` | ✅ |
| `$\$500$` (amount closed by the delimiter) | ✅ |
| `$500 \times 1.05$` | ❌ silently plain |
| `$\$500 \times 1.05$` | ❌ silently plain |
| `$$500 \times 1.05$$` | ❌ silently plain |

The real rule, now in the prompt: **start math with a symbol or a command, never
a digit, and keep currency symbols outside the math.** All seven shapes are
pinned in `tests/unit/render-currency.test.ts` so relaxing that guidance later
fails loudly instead of silently degrading. Deliberately NOT fixed in the
renderer: disambiguating would break `Invest $10,000 now and another $10,000
later.`, which is the case the function exists for.

### Verification

- `npm run lint`, `npm run typecheck` clean. `npx jest` **94 suites / 1063
  tests** passed.
- New unit coverage: 7 render-currency cases (5 working shapes, 3 known limits)
  and a `substituteParams` case proving `{{PV}}` nested in a LaTeX brace group
  (`$\frac{{{PV}}}{2}$`) substitutes without eating LaTeX's own braces.
- `tests/e2e/practice-loop.spec.ts` asserts a rendered `.katex` node in the
  revealed explanation. **Mutation-verified:** reverting `renderRichText` back to
  `textContent` fails that assertion (`element(s) not found`); restored.
- The negative assertion must use `useInnerText: true` — KaTeX keeps the original
  TeX in a visually-hidden MathML annotation, so a `textContent` check matches
  `\frac` even on a correct render. The first draft got this wrong and the run
  caught it.
- Visually confirmed in the browser: the reveal renders a real fraction.
- Full e2e: **37 passed, 3 failed, 1 skipped.** The three failures (`app.spec.ts`,
  `walking-skeleton.spec.ts` — the `ADMIN_CWL_ALLOWLIST` landing issue; and
  `numeric-parameterization.spec.ts` — needs the live LLM) were confirmed
  pre-existing by stashing this branch's changes and re-running: identical three
  failures.

### Still open

- **Nobody has read live-model output yet.** The prompt change cannot be proven
  by unit tests; regenerate a question against the live model and read it. Until
  then Task 7.1 is verified as *plumbing*, not as *prompt quality*.
- `course-setup-guide.ts:1336` still renders option explanations as plain
  `<small>` — same defect, Stephen's file (`4eaea58`), flagged not fixed.
- `instructor/question-detail.ts:371` is a `<textarea>`; plain text is correct
  there. `ta/question-detail.ts` does not render explanations at all.
- Playwright's chromium binary had to be reinstalled (`npx playwright install
  chromium`) — the bundled version had moved to `chromium_headless_shell-1228`.

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
