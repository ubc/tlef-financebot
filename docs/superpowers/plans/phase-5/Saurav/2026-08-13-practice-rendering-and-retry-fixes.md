# Practice rendering, option order, and Strategy-A retry — 2026-08-13

**Owner:** Saurav
**Branch:** `saurav/practice-rendering-and-retry` (Tasks 1–2), Task 3 gets its own
**Phase:** 5

## Why

Three problems Saurav found using the app on 2026-08-13, investigated before any
code was written. All three findings below are verified against the tree at
`8fd1670`, not assumed.

1. **Formulas in numerical questions are hard to read.** They render as flat
   ASCII (`PAYMENT / (1 + r)^n`) even though KaTeX has been vendored and wired
   since ST-P03.
2. **Answer options are never shuffled.** Nothing in the pipeline reorders them,
   and nothing tells the generator to vary which key is correct.
3. **Strategy A's retry serves a different question.** Saurav expected the same
   question again.

Finding 3 turned out to be **specified behaviour, not a bug** — see the ownership
warning below. Findings 1 and 2 are real defects.

## ⚠️ Ownership — Task 3 reverses a written spec and Stephen's implementation

`docs/PRD.md:86` states the retry is *"on a new question testing the same
concept, not the same question again"*. `serving.service.ts:164-182`
(`selectRetryQuestion`) implements exactly that, deliberately, with a docstring
citing §5.1. Unit and E2E tests assert it.

**Saurav decided on 2026-08-13 to change the behaviour and amend the PRD in the
same PR.** That decision is recorded here so it is not re-litigated, but
**Stephen has not been told yet, and must be before Task 3 merges.** If he
re-reads §5.1 from the other side without seeing this entry, the two of you will
flip this back and forth the way `f08913c` / the preview TEST-flag default
already did once.

Task 3 is deliberately on its own branch so Tasks 1–2 can ship without waiting
for that conversation.

## Global constraints

- Reuse the existing render, params, and question-version sources of truth. Do
  not add a second math pipeline or a parallel option-order record.
- House style: match surrounding comment density and idiom.
- Jest is `testEnvironment: 'node'` with no jsdom (`tests/AGENTS.md:66-69`); DOM
  behaviour is Playwright-only. Pure functions (`currencyDollarIndices`, a
  shuffle helper) are unit-testable; rendering is not.
- Every task ends green on `npm run lint`, `npm run typecheck`, full `npx jest`.
- Mutation-verify each behavioural fix: revert it, confirm the covering
  assertion fails, restore it.
- `docs/api-contract.md` is updated in the same PR as any contract change.

---

## Task 1 — render formulas as LaTeX

**Owner:** Saurav

### What is actually wrong

The infrastructure is already there and unused:

- `katex@0.17.0`, `marked@18.0.6`, `dompurify@3.4.12` are in `package.json:53-61`,
  vendored by `scripts/vendor-client-libs.mjs:10-18`, loaded at
  `client/public/index.html:9-14`.
- `client/src/render.ts:61` already runs `marked → DOMPurify → renderMathInElement`
  with `$…$` and `$$…$$` delimiters.
- Stems and options already go through it (`practice-card.ts:181`, `ui.ts:77`).

Two gaps stop any of it mattering:

**Gap A — the generator is never told LaTeX is available.** `grep -n
'katex|LaTeX|markdown'` over `server/src/services/generation.service.ts` returns
**zero hits**. `GENERATOR_PROMPT` (`:915-1014`) never mentions math formatting,
and its own worked example is ASCII prose:
`'Discount each period: PAYMENT / (1 + r)^n.'` (`tests/e2e/numeric-fixture.ts:29`).
The model emits plain text because nothing asks for anything else, so the
renderer has nothing to render.

**Gap B — explanations bypass the renderer.** `practice-card.ts:219`:

```ts
...revealed.map((r) => el('p', { class: 'practice-card__explanation', text: `${r.key}. ${r.explanation}` })),
```

That is `text:`, not `renderRichText`. Explanations carry the *working* — the
most formula-dense text in the app is the one place guaranteed to render flat.

**This is a defect, not a design choice, and exam mode proves it.**
`client/src/views/student/exam-results.ts` renders the same field with
`renderRichText(explanation, option.explanation)`. Practice and exam disagree
about the same data.

### The delimiter constraint — measured, not assumed

`marked` runs *before* KaTeX, so the delimiters have to survive a markdown pass.
Measured against the repo's own `node_modules/marked` on 2026-08-13:

| Input | Survives `marked.parse`? |
|---|---|
| `$V_t = P_0 \times (1+r)^n$` | ✅ unchanged |
| `$\frac{D_1}{r-g}$` | ✅ unchanged |
| `$$PV=\sum_{t=1}^{n}\frac{C_t}{(1+r)^t}$$` | ✅ unchanged |
| `\(V_t = P_0\)` | ❌ → `(V_t = P_0)` — backslashes stripped |
| `\[PV=\sum…\]` | ❌ → `[PV=\sum…]` — backslashes stripped |

**Use `$…$` and `$$…$$`. Do not switch to `\(…\)` / `\[…\]`** — they look like
the safer, more standard choice (and avoid the currency clash below), but marked
eats them and KaTeX never sees a delimiter. Intraword underscores (`V_t`, `P_0`)
are safe because CommonMark does not emphasize them.

### The currency edge case this creates

`currencyDollarIndices` (`render.ts:21-32`) treats `$` as currency when it starts
a plain numeric amount closed by whitespace or punctuation. So a math span that
**opens with a digit** — `$500 \times 1.05$` — has its opening delimiter
classified as currency, wrapped in `.currency-symbol`, and ignored by KaTeX. The
math silently fails to render.

Mitigation is in the prompt, not the renderer: math spans must not begin with a
bare digit. `$\$500 \times 1.05$` and `$P \times 1.05$` are both fine. Add the
case to `tests/unit/render-currency.test.ts` either way so the behaviour is
pinned rather than folklore.

### Files

- `server/src/services/generation.service.ts` (`GENERATOR_PROMPT`)
- `client/src/views/student/practice-card.ts`
- `tests/unit/render-currency.test.ts`
- `tests/e2e/` (extend an existing practice spec)

### Steps

1. **Teach the generator LaTeX.** In `GENERATOR_PROMPT`, state that stem, option
   text, and explanations are rendered as markdown + KaTeX; that inline math uses
   `$…$` and display math `$$…$$`; and that a math span must not open with a bare
   digit. Rewrite the prompt's own worked explanation example in LaTeX so the
   instruction is demonstrated, not just asserted.

2. **Do NOT change `derivedValues[].formula`.** That field is parsed by the
   deterministic evaluator (`params.service.ts`), not displayed. It stays in
   evaluator syntax (`PAYMENT/(1+RATE_PCT/100)^PERIODS`). Only *displayed* text
   becomes LaTeX. Getting this backwards breaks every numerical question in the
   bank — say so in a comment at the prompt, because it is the obvious mistake
   for the next reader to make.

3. **Render explanations as rich text.** Replace the `text:` at
   `practice-card.ts:219` with a `renderRichText` call into the `<p>`, matching
   `exam-results.ts`. Keep the `${r.key}. ` prefix outside the rendered span so a
   leading `$` in the key prefix cannot interact with the currency heuristic.

4. **Sweep the other explanation sites.** `ta/question-detail.ts` renders
   `option.text` rich but not the explanation. `instructor/question-detail.ts:371`
   is a `<textarea>` draft — plain text is correct there, leave it.
   ⚠️ `instructor/course-setup-guide.ts:1336` renders `option.explanation` into a
   plain `<small>`; that file is Stephen's, landed in `4eaea58`. **Flag it to him,
   do not edit it in this task.**

5. `{{PLACEHOLDER}}` substitution runs server-side before the text reaches the
   client, so placeholders and LaTeX do not interact. Confirm this holds for a
   placeholder *inside* a math span (`$\frac{{{PV}}}{2}$`) — the brace collision
   between `{{…}}` and LaTeX's `{}` is the one place they could clash.

### Verification

- Unit: new `currencyDollarIndices` cases for `$500 \times 1.05$` (digit-opening
  math) and `$\$500$` (escaped currency inside math).
- Playwright: answer a numerical question wrong, assert the revealed explanation
  contains a `.katex` element — proving the pipeline ran, not just that text
  appeared.
- Mutation-verify: revert step 3, confirm the `.katex` assertion fails, restore.
- Regenerate one question against the live model and read it. The prompt change
  cannot be proven by unit tests; a human has to look at the output.

---

## Task 2 — shuffle answer options once, at version creation

**Owner:** Saurav

### The finding

There is no shuffle anywhere. `practice.routes.ts:151-154` maps
`version.options` straight through, and the client renders in received order.
Grading is already position-independent — `attempts.service.ts:130` does
`options.find(o => o.key === selectedKey)` then `role === 'correct'` — so
shuffling is safe to add without touching grading.

What decides the position is the generator, and `generation.service.ts:941`
says only *"EXACTLY ONE option has role \"correct\""* with no instruction to vary
which key it is. LLMs asked for an MCQ overwhelmingly emit the correct answer
first. Supporting signal: **36 of 45** `role: 'correct'` fixtures under `tests/`
sit at `key: 'A'`.

### The measurement was attempted and could not be made (2026-08-13)

Read-only aggregation over the local dev database, `financebot`:

| | |
|---|---|
| courses | 1 |
| learningObjectives | 3 |
| questions | 2 — **both `draft`**, zero approved |
| questionVersions | 2 (1 MCQ, 1 True/False) |
| attemptRecords | 0 |

The single MCQ has `role: 'correct'` at key `A`, in array position 1. **n=1 is
not evidence.** The dev database has effectively no content, so the real
distribution is unmeasured and the fixture ratio (36/45) remains the only signal.

**Build the shuffle anyway, and do not spend effort measuring first.** The
measurement was worth attempting because a near-uniform result would have shrunk
this task to a regression test. It cannot be had cheaply: a real sample needs
either a live-LLM generation batch against ingested material (Phase 4 Task 5's
instructor content week) or staging access (still an open question in Phase 4
STATUS). Neither is worth blocking on, because:

- The fix is ~half a day and is a no-op if the distribution is already uniform.
- More importantly, **an unshuffled bank makes a pedagogical property depend on
  undocumented model behaviour.** Even if `gpt-5.4-nano` happened to be uniform
  today, that is an external, unversioned behaviour that changes with any model
  swap or prompt edit. Shuffling makes "the correct answer is not predictable
  from position" structural instead of incidental.

Re-run the query once the instructor content week produces a real bank; if the
correct key is still concentrated at `A` in generated (pre-shuffle) output, that
is also worth feeding back into `GENERATOR_PROMPT`.

### Why creation time, not approval time

Saurav's decision was "shuffle once and store it" rather than per-serve. The
natural reading is *"shuffle when it is approved"*, and that is the wrong hook:

- `PUBLICATION_TRANSITIONS` (`domain.ts:710-721`) allows
  `approved → paused → approved`. Re-approval reaches `transitionQuestion`
  (`questions.service.ts:248`) against a version that has **already been served
  and already has AttemptRecords**.
- Reordering then silently corrupts `answerDistributions`
  (`analytics.service.ts:75-113`), which aggregates historical `selectedKey`
  counts and maps them onto the *current* version's options and roles. The counts
  would survive; their pairing with roles would not. It fails silently — the
  chart still renders, it is just wrong.

Versions are immutable and every edit creates a new one
(`questions.service.ts:18-25`), and nothing is served before approval. So
shuffling **when the version is created** is once-and-only-once by construction,
needs no guard, and cannot touch a version that has attempts. It also means the
reviewer sees the same order the student will.

### Design

- **Reassign keys by position.** After shuffling, relabel `A,B,C,D` top to
  bottom. Reordering the array while keeping keys attached would render
  `C. … A. … D. … B.`, which looks broken. `role` and `explanation` travel with
  the option, so correctness is unaffected.
- **MCQ only.** True/False keeps `T,F` in that order — `optionCount` and the key
  set already branch on type at `generation.service.ts:1010`.
- **Reuse `seededRandom`** from `params.service.ts:15-41` (mulberry32) rather
  than writing a second PRNG. `exam-attempts.service.ts:100-107` already has a
  Fisher-Yates `shuffle` over it for question order — reuse the same shape.
- **One choke point:** version creation in `createQuestion` / `editQuestion`.
  Import goes through `createQuestion` (`import.service.ts:548`) so it is covered
  for free. Exam mode reads `version.options` directly
  (`exam-attempts.service.ts:430`) so it inherits the stored order automatically.

### Files

- `server/src/services/questions.service.ts`
- `server/src/services/params.service.ts` (export the shuffle helper, or a new
  small module — do not duplicate the PRNG)
- `tests/unit/questions.service.test.ts`, `tests/unit/import.service.test.ts`

### Steps

1. ~~Measure the current key distribution over approved versions in the dev DB.~~
   Done 2026-08-13; inconclusive (dev DB is empty — see above). Proceed.
2. Add a seeded Fisher-Yates shuffle + key relabel, applied to MCQ options at
   version creation. Comment *why* it is at creation and not at approval — the
   re-approval hazard above is not obvious from the call site.
3. Confirm no invariant assumes sorted or generator-order keys: `questions.service.ts`
   validates option invariants, and the numerical verifier requires exactly one
   computed derived value per displayed option (per the #66 review). Both are
   key-set checks, not order checks — verify that rather than assuming it.
4. Leave `attempts`, `mastery`, `review-book`, and `exam` untouched. All are
   key- or role-keyed against a pinned version and are unaffected.

### Verification

- Unit: shuffling a fixture with `role: 'correct'` at `A` yields the correct role
  at a non-`A` key for at least one seed; the option *set* (texts, roles,
  explanations) is preserved exactly; T/F is untouched.
- Unit: grading still resolves by key after a shuffle — the existing
  `gradeAnswer` tests should pass unchanged, which is the proof.
- Statistical: generate/create N=100 fixture questions, assert the correct key is
  not concentrated at `A`. Use a loose bound; a tight one will flake.
- Mutation-verify: disable the shuffle, confirm the distribution assertion fails.

---

## Task 3 — Strategy A retries the SAME question  ⚠️ PRD CHANGE

**Owner:** Saurav
**Branch:** separate from Tasks 1–2. **Do not merge before telling Stephen.**

### Decided behaviour (Saurav, 2026-08-13)

On a Strategy-A miss, re-serve **the same question**, with the chosen wrong
option **kept revealed and struck out**. The student picks again from the
remaining options.

### The tradeoff, recorded so it is not re-argued

This is a real cost, accepted deliberately: once the chosen option is revealed as
wrong and eliminated, a 4-way question becomes a 3-way choice. `PRD.md:86`
additionally requires the retry to be *"its own, independent mastery attempt (not
discounted or merged)"* — so a guess on a 3-way choice is recorded at full
weight. **Either the PRD's full-weight rule is amended too, or mastery gets
slightly easier to inflate.** This is the open decision Task 3 must not skip; it
is exactly why the current design serves a new question instead.

### What changes

- `attempts.service.ts:282-311` — stop calling `selectRetryQuestion`; build the
  retry from the just-answered `question`/`version`.
- **Keep the original `paramValues`.** The current code deliberately draws a
  fresh seed (`:295-296`, and the comment above it) because the retry is a
  different question. Re-serving the same question with *new numbers* would make
  the eliminated option incoherent — the revealed value belongs to the old draw.
  This inverts a documented decision, so replace the comment, do not just delete
  it.
- **The retry payload must carry the eliminated key(s)** so the client can render
  the struck-out state. This is a contract change: add a field (e.g.
  `eliminatedKeys: string[]`) to the `retry` object in `docs/api-contract.md:433-448`.
- Client `practice-card.ts:379-386` recursion works generically and needs no
  structural change, but the option renderer must gain an eliminated state.
  `optionButton` (`ui.ts:77`) already has `'hidden-choice'` and `'incorrect'` —
  reuse rather than adding a fourth near-synonym if one fits.
- **The degradation path disappears.** `selectRetryQuestion` returning `null`
  when the LO has only one approved question was the whole reason Strategy A
  degraded to a full reveal. With same-question retry the question always exists,
  so that branch is dead. Decide explicitly whether `selectRetryQuestion` is
  deleted or kept — do not leave it orphaned and untested.
- Review book needs no change: the upsert is keyed `(puid, courseId, questionId)`
  (`attempts.service.ts:151-171`), so retrying the same question updates the
  existing entry rather than duplicating it.

### Docs to amend

- `docs/PRD.md:86` — the sentence *"on a new question testing the same concept,
  not the same question again"*, plus the degradation clause, plus (per the
  tradeoff above) possibly the full-weight-attempt clause.
- `docs/api-contract.md:433-448` — the `retry` object shape and the note that a
  parameterized retry carries its own fresh `paramValues`/`seed`, which becomes
  false.

### Tests that assert the current behaviour and must be rewritten

| File | What it asserts |
|---|---|
| `tests/unit/serving.service.test.ts:261-287` | case 8 — `selectRetryQuestion` never returns the excluded id; `null` when it is the only one |
| `tests/unit/attempts.service.test.ts:271-311` | case 3 — retry is a different `questionId` |
| `tests/unit/attempts.service.test.ts:416-444` | a parameterized retry gets its OWN fresh `paramValues`/`seed` |
| `tests/e2e/critical-paths.spec.ts:209-243` | ST-P04 — asserts the retry panel shows the *other* fixture's stem |

`critical-paths.spec.ts` seeds two questions specifically to support the
different-question assertion. Re-scope rather than delete: the withheld-reveal
half of ST-P04 is still correct and still worth guarding.

### Verification

- Unit: a Strategy-A miss returns a retry whose `questionId` equals the answered
  one, carrying the same `paramValues`, with the chosen key in `eliminatedKeys`.
- Unit: the retry attempt still records `isRetry: true` and still calls mastery
  at full weight (unchanged from today) — or the amended rule, if that changes.
- Playwright: miss a confounder, assert the retry shows the same stem with the
  chosen option visibly eliminated, then answer correctly.
- Mutation-verify each of the three behavioural halves separately: same question,
  same numbers, eliminated key.

---

## Not in scope (recorded so it is not lost)

- **`course-setup-guide.ts:1336`** renders option explanations as plain
  `<small>`. Same defect as Task 1 Gap B, in Stephen's file. Flagged, not fixed.
- **Per-student option order.** Task 2 stores one order for everyone, so two
  students comparing notes still see the same letters. Serve-time seeded
  shuffling would blunt that, at the cost of pinning the order onto every
  AttemptRecord. Deliberately not done.
- **The seven pre-existing E2E failures** recorded in Phase 4 STATUS
  (`ADMIN_CWL_ALLOWLIST` landing, serial-run ordering, live-LLM numeric spec).
  Unrelated to this work; still want their own cleanup task.
