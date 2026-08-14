# Saurav — Phase 5 status

_Last updated: 2026-08-13_

## Where this stands

Phase 5's six core tasks are all `Owner: Stephen`. Saurav's Phase 5 work starts
with **Task 7**, claimed in writing in the shared plan on 2026-08-13, plus the
**Delete for never-used questions** design deferred out of Phase 4.

| Item | State |
|---|---|
| Task 7.1 — LaTeX formula rendering | **Live-tested 2026-08-13.** The prompt works; the test found 3 further bugs, 2 now fixed. See below |
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

## 2026-08-13 — the live-model test, and what it found

Saurav ran a real generation against `openai` / `gpt-5.4-nano` and reported the
result "does not look like the LaTeX compiled." It had, in the sense that
mattered — and the report surfaced three further defects.

**The prompt change works.** The stored versions carry proper LaTeX throughout
(`\text{}`, `\frac{}{}`, `\left(...\right)`, balanced `$$…$$`), and the check
that mattered most passed: **`derivedValues[].formula` stayed evaluator syntax on
every derived value across all three numeric questions.** No LaTeX leaked into
the parsed field.

**What Saurav was looking at was a surface Task 7.1 never touched.**
`instructor/question-detail.ts` — the "Example — what a student sees" panel —
did not import `renderRichText` at all. An instructor approving a question was
reading LaTeX source where the student sees maths, which defeats the panel's
whole purpose and hides broken LaTeX until a student meets it.

### Fixed in this pass

1. **`%` is now a currency terminator** (`render.ts`). A rate written `$16%` was
   NOT protected (`%` was absent from the terminator set), so it became an
   OPENING math delimiter — and because a `$12000 ` in the same sentence IS
   protected, the live `$` count went odd and KaTeX swallowed the prose between
   them. Observed in real generated output. `$50\%$` is unaffected: an escaped
   LaTeX percent puts a backslash after the digits.
2. **The instructor sample panel renders rich text**, matching the student card.

### Why all three generated questions failed verification (root cause found)

Replaying the real verification path against the stored versions: **none of the
three reached the 100-draw proof.** All three died at the first check,
`optionValueNamesForVerification` — *no option displays a computed value*.

| Version | Placeholders in its options | Derived values among them |
|---|---|---|
| `…34d` | none at all | 0 |
| `…34f` | `{{R}}` ×3 | 0 |
| `…351` | `{{CF0}}`, `{{CF1}}`, `{{CF2}}`, `{{R_PCT}}` | 0 |

Every option referenced INPUT slots — the formula — never the computed answer
(`NPV_CORRECT` appears in no option anywhere).

**⚠️ Correction to the earlier entry: the unbalanced parentheses were NOT the
cause.** Verification never got as far as evaluating a formula. They are real
but latent, and would only bite at step 2.

**Two causes, and Task 7.1 is the bigger one.**

1. **A prompt regression I introduced.** The FORMATTING block says it governs
   *"the stem, every option, and every explanation"* and ended with *"prefer a
   display line over describing the arithmetic in words"*. Meant for
   explanations; applied to options it says "render the formula", which is
   exactly what all three did.
2. **A pre-existing gap it exposed.** `GENERATOR_PROMPT` **never stated the rule
   `optionValueNamesForVerification` enforces.** The verifier has been rejecting
   questions on a rule the generator was only ever shown by example — and worse,
   the prompt actively contradicted it: *"an option may carry several
   placeholders if the question asks for more than one value."*

A third, subtler one: `…34d` is an Accept/Reject **decision** question declared
`numeric`. Its options are decisions, so they can never display a computed
value. "If answering requires ANY computation, set numeric" is genuinely
ambiguous for decision questions, and the model fell into the gap.

### Prompt fixes batched into one change (2026-08-13)

Batched deliberately so they cost ONE paid verification run, not four:

1. "Show the working" is scoped to the EXPLANATION; an option states an ANSWER,
   never the formula.
2. **THE OPTION CONTRACT** now states the verifier's rule explicitly, with the
   three failing shapes as worked negatives. The contradictory
   "several placeholders" line is gone.
3. Decision-shaped questions are routed to `conceptual`, with an explicit
   "pick one shape and commit" instruction.
4. Slot names must not appear inside `\text{}` — the `` corruption above.

Guarded by four new assertions in `tests/unit/generation-numerics.test.ts`. A
prompt cannot be tested against the model, but it can be pinned to say the
thing — which is what failed here.

**Not yet re-run against the live model.** Until it is, these are unproven.

### Observation while reading the assembled prompt

`GENERATOR_PROMPT` ends with `.filter(Boolean)`, which strips every `''` entry —
so the section separators in the source produce **no blank lines** in the real
prompt. Anyone adding one expecting whitespace gets none. Left alone (changing
it edits the whole prompt), but worth knowing before the next edit.

## 2026-08-14 — first post-fix live run: the contract fix worked, then got gamed

Three batches now exist, and they bracket the prompt fix cleanly:

| Batch (UTC) | Result |
|---|---|
| 21:50, pre-fix | 3/3 failed **STEP 1** — no option displayed a computed value |
| 22:36, post-fix | 3/3 passed step 1, all failed **STEP 2** — option collisions |
| 01:35, post-fix | 1 proof, 1 step-1 failure, 1 step-2 failure |

**The option-contract fix landed.** Pre-fix every question died on it; post-fix
5 of 6 got past it. Collisions are now the dominant failure — which is what the
prompt already calls "the single most common reason a question is rejected", so
that claim is accurate again rather than aspirational.

### The one that earned a proof is a FALSE PASS

`6a7e70e7c3db091283bbb555` passed verification and is nonsense. The model kept
writing the decision question it wanted and **appended an arbitrary derived
value to each option** to satisfy the new rule. A student would be served:

```
[A] Coffee shop: PI accepts and PP rejects; Apparel store: … PP accepts. 7.36
[D] Coffee shop: PI accepts and PP accepts; Apparel store: … PP rejects. 9.11  <- correct
```

Those trailing numbers are `COFFEE_PP`, `APP_PI`, `COFFEE_PI`, `APP_PP` — two
payback periods and two profitability indices, different units, stapled onto
unrelated accept/reject sentences. It earned a proof because the four values are
pairwise distinct across 100 draws. **Verification checks structure and
distinctness, never coherence** — so a rule phrased as "must contain a value" is
satisfiable by appending one.

**The REVIEWER caught it**, and well: `decision: reject`, citing the
growing-perpetuity PV being modelled as `C1*(1+g)/(r-g)` (that is the Year-2 cash
flow), the hard-coded 2-year payback base, and explicitly the incoherence
between option B's text and its appended value. Defence-in-depth held — the
proof is not the only gate, and the pedagogy gate did its job. Worth remembering
before anyone proposes trusting the proof alone.

### Second prompt pass (this change)

- **An option text IS a value** — not a sentence containing one. The stapled-on
  shape is named as the worst of the four bad examples, with an explicit
  instruction: if you are appending a value to a sentence, the question is
  conceptual.
- **The formula grammar has no comparisons, conditionals or ternaries.** A live
  formula used `(PI_X>0?1:0)`; the tokenizer rejected it. Reaching for a
  comparison means encoding a decision as a number.
- **Ratio/percentage distractors** get their own collision warning: input sizes
  cancel, so widening ranges does not separate them — separate by the structure
  of the mistake instead.

### Control characters: now fixed in CODE, not by asking nicely

A third control character appeared (`U+001D`, in an explanation) after the
prompt already told the model to avoid the shape that produced the first. Prompt
guidance is not a control for this, so `sanitizeGenerated` now strips C0/DEL
from stem, option text and explanations at `generateValidQuestion` — the single
point every generator output passes through. Tab and newline are kept.

Implemented as a code-point filter rather than a regex character class: a class
covering C0 must contain literal control characters, which are invisible in
source and do not survive editors intact (they corrupted three of my own edits
while writing this).

**Mutation-verified.** Neutering the filter fails the new test with
`Expected: "What is the IRR?" / Received: "What is the IRR?"` — visually
identical, which is exactly why this bug survived two live runs undetected.

### Verification

`npm run lint`, `npm run typecheck` clean; `npx jest` **94 suites / 1075 tests**.
Four new prompt guards plus one behavioural sanitizer test. One pre-existing
guard needed updating because this pass reworded the line it pinned — the pinned
tests catching my own prompt edit is them working as designed.

**Not yet re-run against the live model.** Same standing caveat.

## 2026-08-14 — Aerotech batch: option contract holds, formulas now fail to PARSE

Third live run, after the "an option IS a value" pass.

**Both prompt fixes confirmed working.** All 12 options across the three
questions came back as bare values — `{{NPV}}`, `{{WACC_PCT}}%` — with no prose
wrapper and nothing stapled on. No control characters (the code-level strip is
also in place now). The gaming loophole is closed.

**All three still failed, with a new dominant error:**

| Version | Failure |
|---|---|
| `…39e` | `division by zero` |
| `…3a0` | `trailing input after formula` — a PARSE error |
| `…3a2` | `trailing input after formula` |

The formulas explain both. The WACC one is ~400 characters, six levels deep,
with the same `PV(...)` subexpression repeated **six times**, and its parentheses
do not balance — the parser consumes a valid expression, meets a stray `)`, and
rejects. The division-by-zero one is worse: its denominator is
`(DEBT_YTM_PCT/100)*(PV(1,1,1) - PV(1,1,1))`, a self-cancelling stand-in that is
zero on every draw. The model could not express bond value inline and filled the
gap with a dummy. The same version also hardcodes `2.2e6` for debt.

### The capability the prompt never mentioned

`resolveSlotsAndDerived` has always evaluated `derivedValues` **in declaration
order, so a later formula may reference an earlier one by name**, and
`verifyGeneratedNumerics` already exempts helper values that no option displays
from the option contract. **`GENERATOR_PROMPT` never said so** — so the model
inlined an entire WACC instead of naming five short steps.

Added a `BUILD THE ANSWER IN STEPS` block with the WACC decomposition as a worked
example, an explicit split threshold (~100 characters or three levels), the note
that undisplayed helper steps are allowed, and a ban on stand-in sub-expressions
and hardcoded literals citing both real instances.

Short formulas cannot have unbalanced parentheses, do not repeat subexpressions,
and give the model somewhere to put an intermediate it would otherwise fake — so
this plausibly addresses all three failures at once.

### Verification

`npm run lint`, `npm run typecheck` clean; `npx jest` **94 suites / 1078 tests**.
Two new prompt guards, plus a `numeric-verification` test pinning a five-step
chain whose later steps reference several earlier ones — the existing coverage
coverd only a single hop, and the prompt now instructs the model to write the
longer shape, so the shape itself is now proven rather than extrapolated.

**Not yet re-run against the live model.**

### Also noticed: Generate produces THREE questions per click

The form never sends `count` (`preseeding.ts:403`); the server fills in
`DEFAULT_GENERATION_COUNT = 3` (`generation.routes.ts:52`). Deliberate — there is
a comment at `preseeding.ts:33` explaining the Task G brief listed no count field
— but the button reads **"Generate Question →"**, singular, and it is 3x the LLM
spend per click. Not changed; needs a decision between relabelling and adding a
count field.

### Still open — NOT fixed here

- **A control character is corrupting slot names.** Slot `DISC_PCT` came back as
  `\text{DISC⟪U+0002⟫PCT}`, and that math span fails to render (visible in the
  panel now that it renders at all). `extractJson` does a plain `JSON.parse`
  with no repair, so the model emitted a literal `` escape — almost
  certainly fumbling LaTeX's `\_`. **Task 7.1's own prompt change made this
  likely** by steering toward `\text{}` around underscored slot names. Candidate
  fixes: forbid underscores in slot names, forbid slot names inside `\text{}`,
  or strip control characters defensively on ingest of generated content.
- **Model-written formulas can have unbalanced parentheses**, e.g.
  `(-CF0) + (CF1*(1+R_PCT/100)) + (CF2*(1+R_PCT/100)^2`. Pre-existing generator
  quality, not caused by this work.
- **All three generated numeric questions have `verification: ABSENT`** and will
  never serve. Worth a dedicated look — the batch is currently unusable.
- `$50-$60` has the identical shape to the `%` bug and is pinned as a KNOWN
  LIMIT test rather than fixed, only because it has not been seen in real
  content. The remedy is the same one character.

### ⚠️ Phase 4 STATUS misdiagnoses `numeric-parameterization.spec.ts`

It is recorded there as *"waits on `.verification-banner--fail`, which needs the
live LLM path"*. **That is wrong.** With a working LLM it still fails, and the
reason is unrelated: the banner now reads `option 3 must display exactly one
computed value` where the spec expects `/division by zero/`. The expectation went
stale when PR #66's review added the per-option verification check — Stephen's
change. The spec's fixture trips the new check before it reaches the range error.
Left unfixed here (his territory), but the Phase 4 note should be corrected so
nobody keeps waiting for an LLM that would not help.

### Verification

- `npm run lint`, `npm run typecheck` clean; `npx jest` **94 suites / 1067 tests**.
- New `tests/e2e/instructor-sample-render.spec.ts` seeds its own parameterized
  question and asserts a rendered `.katex` node in the panel plus no `\frac` in
  `innerText`. **Mutation-verified**: swapping `renderRichText` back to
  `textContent` fails it (`element(s) not found`); restored.
- Four new `render-currency` cases: percentage-terminated, the mixed
  currency+percentage sentence, escaped `$50\%$`, and the pinned `$50-$60` limit.
- Full e2e: **38 passed, 3 failed, 1 skipped** — the same three pre-existing
  failures, previously confirmed by stashing.
- Visually confirmed in the browser against the real generated question.

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
