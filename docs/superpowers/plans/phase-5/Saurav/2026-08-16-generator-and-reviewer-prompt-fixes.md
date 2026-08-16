# Generator and reviewer prompt fixes — driven by measurement — 2026-08-16

**Owner:** Saurav
**Branch:** `saurav/prompt-and-reviewer-fixes`, cut from `main` at `460ad77`
**Phase:** 5

## Why this plan replaces the previous one

The first version of this plan proposed **branching the generator prompt** into
numeric and conceptual paths, on the theory that 60% numeric machinery was
biasing the model toward numeric questions. Five experiments were run before
writing any production code. **Three of that plan's premises did not survive:**

| Premise | What the experiments showed |
|---|---|
| The prompt biases routing toward numeric | **False.** All 3 variants produced conceptual output for a conceptual LO, baseline included. The earlier "everything is numeric" observation was correct behaviour — those LOs were computational. |
| The instructor's preset can trigger the branch | **Unworkable.** Two of four presets ("Applied scenario", "Common-misconception probe") map to no kind, and the chip only prefills an editable textarea — so a saved tag can contradict the prompt the instructor actually wrote. Saurav caught this. |
| Worked distractor pairs improve distractors | **No measurable effect.** 3 flags with, 3 flags without. |

Evidence lives in [`docs/prompt-engineering-tests.md`](../../../../prompt-engineering-tests.md)
and [`docs/reviewer-agent-tests.md`](../../../../reviewer-agent-tests.md), each
carrying the full prompts, every generated question and every verdict.

**The branch is abandoned.** It was the expensive answer to a problem that was
not the problem, and its trigger does not exist. Do not re-propose it without
new evidence.

The tasks below are ordered by **weight of measured evidence**, which is not the
order anyone predicted.

## What the experiments actually found

- **Slot-range degeneracy — 5 of 6 numeric questions.** Every failure was the
  same shape: a distractor collapses onto the correct answer at an allowed slot
  draw. The reviewer diagnosed it unprompted: *"Option D becomes identical to
  the correct formula when **BETA = 1.0, which is an allowed parameter value**"*.
  This is the single largest cause of questions that can never serve.
- **Difficulty miscalibration — 12 of 12 numeric questions.** Every flag said a
  version of *"only a one-step substitution… should be labeled easy"*. Matches
  the complaint recorded in STATUS on 2026-08-14, now measured by an independent
  judge rather than by impression.
- **The reviewer is blind to three gates it should own.** Given the missing
  criteria it named a structural fault **4/4** that the current prompt named
  **0/4**, and it did **not** over-reject a clean control (pass 4/4).
- **Few-shot exemplars: proven on conceptual (0/3 → 3/3), unproven on numeric**
  (reviewer verdicts went from 3 flags to 2 rejects + 1 flag; n=3).
- **The reviewer is consistent** — 11/12 identical verdicts on identical input —
  so these comparisons are signal, with n=3 caution.

## Global constraints

- A prompt cannot be tested against the model in CI; tests pin that it **says
  the thing**, and live runs judge whether it works.
- Every task ends green on `npm run lint`, `npm run typecheck`, full `npx jest`.
- Mutation-verify each behavioural change.
- **Reproduce CI before pushing** — move `.env` aside and run lint + typecheck +
  test. `config/env` reads the real file at import, and PR #75 failed CI on
  exactly this.
- Live verification runs the generator at effort `none`. Any higher withdraws
  the temperature and collapses batch diversity — the six identical CAPM
  questions on 2026-08-15 were that mistake.

---

## Task 1 — narrow the numeric gate ✅ IMPLEMENTED

**Owner:** Saurav — code written, mutation-verified, not yet committed.

`isNumericQuestion` ignored a `conceptual` declaration whenever its heuristic
found a number, and `NUMERIC_PATTERNS` matched any two-digit number or any bare
percentage. A question it calls numeric needs a verification proof, and one with
no `paramSlots` can never earn one — so it silently never served.

**Measured before the change: four of six realistic conceptual stems were
blocked**, by "15%", "2008", "30 stocks" and "a P/E of 40".

Now: currency-adjacent digits, decimals and digit-operator-digit are
computational; a rate counts only when there is an amount to apply it to.
Accepted false negative, documented at the call site: *"What is 10% of 200?"*
reads as conceptual — reachable only via a mistagged generation, and the
reviewer and instructor both still see it.

**Done:** six realistic stems pinned by name; the backstop retained; the
previously-pinned "a bare percentage is numeric" assertion rewritten rather than
deleted, because it was pinning the exact behaviour being changed.
**Mutation-verified:** restoring the loose patterns fails 5 tests.

## Task 2 — slot ranges must not contain a degenerate draw

**Owner:** Saurav — strongest evidence of anything measured (5/6)

`GENERATOR_PROMPT`'s collision section already warns about distractors colliding
"where their ranges meet". It never says the thing that actually goes wrong: a
range must **exclude the value at which a distractor's formula becomes the
correct answer's formula**. `BETA = 1.0` with an "ignores beta" distractor is
the worked case and should appear as one.

The check is algebraic, not statistical — the model can do it before answering,
by comparing each distractor formula against the correct one at each slot's
extremes and round middle.

**Tests.** Prompt guards for the rule and the worked case. Plus a
`numeric-verification` fixture with a beta range including 1.0, asserting the
collision IS detected — pinning that the verifier catches what the prompt now
warns against, so the two cannot drift apart.

## Task 3 — difficulty calibration

**Owner:** Saurav — 12/12

The prompt's difficulty guidance is one sentence per level. Every question
generated in these experiments was labelled `medium` and was, per the reviewer, a
one-step substitution.

State the rule the reviewer already applies: **supplying the formula and asking
for one substitution is `easy`**, whatever the arithmetic looks like; `medium`
requires choosing between approaches, or more than one reasoning step; `hard`
requires both. Currently the generator is graded against a standard it is never
shown.

**Tests.** Prompt guards. The real check is Task 6.

## Task 4 — reviewer criteria 7–9, and the verifier's own result

**Owner:** Saurav — F2: 0/4 → 4/4, control unaffected

`REVIEWER_PROMPT` is 1,515 chars against the generator's 12,485 — every
hard-won rule went into generating, almost none into judging. Add:

7. **Slot-range degeneracy**, mirroring Task 2, with the beta case named.
8. **The option contract** — every option in a numeric question displays exactly
   one computed value; decision-shaped options mean it should be conceptual.
9. **The retry gate** — an MCQ must carry at least one `common-misconception`,
   because `decideStrategy` offers Strategy A only on that role.

Also **pass the verification failure in when one exists.** The proof runs before
review, and the reviewer currently guesses at servability. Free information.

**⚠️ Unvalidated:** criterion 7 was tested with the verifier's failure text
handed to the reviewer, so that fixture proves nothing about it. Re-run F1
WITHOUT the hint before claiming criterion 7 works — that is the production
case. Recorded as a limitation in the results doc, not glossed.

**Tests.** Prompt guards for each criterion; a guard that the failure string is
included when present and absent otherwise.

## Task 5 — conceptual exemplar, after isolating which exemplar moved numeric

**Owner:** Saurav — proven on conceptual, unproven on numeric

Variant B added **two** exemplars, numeric and conceptual, and numeric verdicts
worsened. **Which of the two caused that is unmeasured**, and it matters: if the
conceptual exemplar is harmless to numeric output, it can ship globally with no
branch and no trigger — which is the whole reason the branch was abandoned.

Test first: conceptual-exemplar-only against a computational LO, compared with
today's baseline. Ship the exemplar only if numeric output is unharmed.

**Do NOT ship** the worked distractor pairs (no measured effect) or a numeric
exemplar (implicated, unproven).

## Task 6 — live verification of tasks 2–5 together

**Owner:** Saurav

Generate on a computational LO and a conceptual one, generator at effort `none`,
reviewer at `high`, and record verdicts plus verification-proof rate against the
pre-change numbers already in the results docs: **proof 1/6, difficulty flagged
12/12.** Those are the baselines to beat, and they are written down.

Append to `docs/prompt-engineering-tests.md` so the before/after sits with the
experiments that motivated it.

## Deliberately out of scope

- **Feeding the reviewer's critique into regeneration** — the next task, and it
  compounds with Task 4: `agentDecision.reasoning` is what gets fed back, and
  v2's text is far more actionable. Regeneration already passes the previous
  question and already has a comment box; only the critique is missing.
- **Batch diversity.** Unsolved by every variant tested — most stems still open
  "Canada and Country X…". It is a sampling problem, not a wording one, and it
  deserves its own investigation.
- **The preset id/label mismatch.** `PRESET_TEMPLATES` has an id
  `true-false-explanation` labelled "Applied scenario" (`preseeding.ts:130`), and
  a second preset list lives on the server. Confusing, unrelated, flagged.
