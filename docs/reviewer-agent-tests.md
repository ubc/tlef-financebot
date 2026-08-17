# Reviewer agent tests — consistency, and what the prompt is blind to

_Run 2026-08-16._ Two questions, both about the REVIEWER rather than the generator.

- **4a — consistency.** The same fixture judged `4` times by the SAME prompt.
  If verdicts scatter on identical input, then the n=3 comparisons in
  `prompt-engineering-tests.md` are measuring reviewer noise, and I over-read them.
- **4b — v1 vs v2.** The same fixtures judged by the shipping reviewer and by one
  carrying the criteria it currently lacks (slot-range degeneracy, the option
  contract, the common-misconception requirement, and the verifier's own result).

Fixtures are **fixed, hand-built and carry known faults**, so this measures DETECTION
RATE against ground truth rather than taste. `gpt-5.6-luna`, `reasoning_effort: high`.


---

## Fixture F1 — Estimate expected returns with CAPM

**Known fault.** BETA range includes 1.0, at which NO_BETA_RETURN_PCT equals CAPM_RETURN_PCT — the exact collision that killed 5 of 6 numeric questions in experiment 2.

<details>
<summary>Fixture JSON</summary>

```json
{
  "stem": "A stock has beta $\\beta = {{BETA}}$. The risk-free rate is ${{RF_PCT}}\\%$ and the market return is ${{MARKET_PCT}}\\%$. Using CAPM, what is the expected return?",
  "difficulty": "medium",
  "numericKind": "numeric",
  "paramSlots": [
    {
      "name": "BETA",
      "min": 0.5,
      "max": 2,
      "step": 0.5
    },
    {
      "name": "RF_PCT",
      "min": 3,
      "max": 5,
      "step": 1
    },
    {
      "name": "MARKET_PCT",
      "min": 8,
      "max": 12,
      "step": 1
    }
  ],
  "derivedValues": [
    {
      "name": "CAPM_RETURN_PCT",
      "formula": "RF_PCT+BETA*(MARKET_PCT-RF_PCT)",
      "errorModel": ""
    },
    {
      "name": "NO_BETA_RETURN_PCT",
      "formula": "RF_PCT+(MARKET_PCT-RF_PCT)",
      "errorModel": "ignored beta entirely"
    },
    {
      "name": "MARKET_ONLY_PCT",
      "formula": "MARKET_PCT",
      "errorModel": "quoted the market return"
    },
    {
      "name": "RF_ONLY_PCT",
      "formula": "RF_PCT",
      "errorModel": "quoted the risk-free rate"
    }
  ],
  "options": [
    {
      "key": "A",
      "text": "{{CAPM_RETURN_PCT}}%",
      "role": "correct",
      "explanation": "CAPM."
    },
    {
      "key": "B",
      "text": "{{NO_BETA_RETURN_PCT}}%",
      "role": "common-misconception",
      "explanation": "Ignores beta."
    },
    {
      "key": "C",
      "text": "{{MARKET_ONLY_PCT}}%",
      "role": "partially-correct",
      "explanation": "Market return only."
    },
    {
      "key": "D",
      "text": "{{RF_ONLY_PCT}}%",
      "role": "clearly-wrong",
      "explanation": "Risk-free only."
    }
  ]
}
```

</details>

### F1 judged by reviewer v1

Verdicts: `reject`, `reject`, `reject`, `reject` — named the known fault in **4/4**

> **v1 run 1 (`reject`)** — The CAPM model and distractor formulas are correct, but the item has a serious ambiguity: when BETA = 1 (an allowed parameter value), NO_BETA_RETURN_PCT equals the correct CAPM return, so two options are identical. It is also labeled medium despite requiring only direct one-step substitution, which is too easy for that difficulty level. Revise the parameter range or distractor and recalibrate the difficulty.

> **v1 run 2 (`reject`)** — Options B and C are structurally identical: NO_BETA_RETURN_PCT simplifies to MARKET_PCT, so both display the same answer while claiming different misconceptions. This creates an unresolvable ambiguity. The item is also only a one-step CAPM substitution, so its stated medium difficulty is overstated, though the CAPM formula and individual error models are otherwise appropriate.

> **v1 run 3 (`reject`)** — The CAPM formula correctly models the requested expected return, but options B and C are mathematically identical: ignoring beta produces RF + (MARKET − RF) = MARKET, so both choices always display the same value and create ambiguity. The one-step substitution also appears easier than the stated medium difficulty. These issues require revising the distractors and difficulty calibration before use.

> **v1 run 4 (`reject`)** — The CAPM formula is correct and aligned with the LO, but the item has a serious ambiguity: NO_BETA_RETURN_PCT algebraically equals MARKET_ONLY_PCT for every parameter set, so options B and C are duplicate answers. Additionally, when BETA = 1 (an allowed value), the correct CAPM result also equals both B and C, creating multiple correct options. The one-step substitution is also miscalibrated as medium difficulty. These issues require revision before use.

### F1 judged by reviewer v2

Verdicts: `reject`, `reject`, `reject`, `reject` — named the known fault in **4/4**

> **v2 run 1 (`reject`)** — The NO_BETA_RETURN_PCT formula equals CAPM_RETURN_PCT whenever BETA = 1: both reduce to RF_PCT + (MARKET_PCT − RF_PCT). Since BETA allows 1.0, the options collapse and the question is unservable. Remove 1.0 from the allowed beta values or replace the distractor with a formula that cannot equal the correct expression over the slot range. Also, the task is a direct one-step CAPM substitution, so it should be labeled easy rather than medium. The option contract and retry-gate requirements are otherwise satisfied.

> **v2 run 2 (`reject`)** — The question is unservable because beta=1.0 is an allowed slot value. At that value, CAPM_RETURN_PCT = RF_PCT + 1*(MARKET_PCT-RF_PCT), which is identical to NO_BETA_RETURN_PCT; this is the reported degeneracy. In fact, NO_BETA_RETURN_PCT and MARKET_ONLY_PCT are identical for every slot value, creating duplicate distractors. Change the beta range to exclude 1.0 or replace the ignoring-beta distractor, and replace one of the duplicate market-return distractors with a distinct, correctly modelled misconception. The CAPM formula and retry-gate role are otherwise appropriate, and the option contract is satisfied. However, the task is a one-step substitution and is better calibrated as easy rather than medium.

> **v2 run 3 (`reject`)** — The CAPM formula is correctly modeled, but the question is unservable because the allowed beta range includes 1.0. At beta = 1.0, CAPM_RETURN_PCT becomes RF_PCT + (MARKET_PCT - RF_PCT), exactly matching NO_BETA_RETURN_PCT. In addition, NO_BETA_RETURN_PCT is algebraically identical to MARKET_ONLY_PCT for every slot draw, so two distractors are duplicates. Exclude beta = 1.0 and replace or remove one of the duplicate distractors with a distinct, non-collapsing misconception. The direct substitution also warrants an easy rather than medium difficulty label. The option contract and common-misconception role otherwise satisfy the requirements.

> **v2 run 4 (`reject`)** — The question is unservable because at the allowed slot value BETA=1.0, CAPM_RETURN_PCT = RF_PCT + 1.0*(MARKET_PCT-RF_PCT) equals NO_BETA_RETURN_PCT = RF_PCT + (MARKET_PCT-RF_PCT), so the correct option and distractor collapse. Moreover, NO_BETA_RETURN_PCT simplifies to MARKET_PCT for every draw, making options B and C identical, not merely at beta 1. Replace one of those distractors and ensure every distractor remains distinct from the correct formula across the full beta range; alternatively exclude beta=1.0 if retaining the no-beta distractor. The direct CAPM substitution is also more appropriately easy than medium.


---

## Fixture F2 — Apply NPV and IRR

**Known fault.** No common-misconception option at all — decideStrategy therefore never offers the Strategy-A retry. Structurally rejected by optionShapeValid, invisible to reviewer v1.

<details>
<summary>Fixture JSON</summary>

```json
{
  "stem": "A project has an NPV of {{NPV}} at the firm's hurdle rate. What does that imply?",
  "difficulty": "easy",
  "numericKind": "conceptual",
  "options": [
    {
      "key": "A",
      "text": "It adds value and should be accepted",
      "role": "correct",
      "explanation": "Positive NPV adds value."
    },
    {
      "key": "B",
      "text": "It destroys value and should be rejected",
      "role": "clearly-wrong",
      "explanation": "That is a negative NPV."
    },
    {
      "key": "C",
      "text": "It breaks even exactly",
      "role": "clearly-wrong",
      "explanation": "That is NPV of zero."
    },
    {
      "key": "D",
      "text": "Nothing can be said without the IRR",
      "role": "partially-correct",
      "explanation": "NPV alone suffices."
    }
  ]
}
```

</details>

### F2 judged by reviewer v1

Verdicts: `flag`, `reject`, `reject`, `reject` — named the known fault in **0/4**

> **v1 run 1 (`flag`)** — The intended concept and difficulty are appropriate, and the distractors target common NPV misconceptions. However, the stem does not state whether {{NPV}} is positive, zero, or negative. Option A is correct only when NPV is positive; without an explicitly positive value or a conditional decision rule, the question is ambiguous. The NPV placeholder should be constrained to a positive value, or the options should cover all three cases.

> **v1 run 2 (`reject`)** — The stem does not state that the NPV is positive, so no option is reliably correct: a negative NPV implies rejection, zero implies breakeven, and a positive NPV supports acceptance. The placeholder may render a value, but as written the question provides no deterministic value or sign. Add “a positive NPV” (or make the options conditional on the sign) before use.

> **v1 run 3 (`reject`)** — The stem does not state whether the displayed NPV is positive, zero, or negative, so option A is not necessarily correct. The appropriate implication depends on its sign: positive NPV generally supports acceptance, zero is breakeven, and negative NPV supports rejection. The question must explicitly state a positive NPV or provide a value whose sign is unambiguous.

> **v1 run 4 (`reject`)** — The stem does not state that the NPV is positive, and the unresolved {{NPV}} placeholder has no associated formula or defined value. The correct implication depends on the sign: positive NPV generally supports acceptance, zero indicates breakeven, and negative NPV supports rejection. Thus option A cannot be identified as correct from the provided stem. The conceptual LO and easy difficulty are appropriate, but the question is unusable until the NPV value/sign is supplied.

### F2 judged by reviewer v2

Verdicts: `reject`, `reject`, `reject`, `reject` — named the known fault in **4/4**

> **v2 run 1 (`reject`)** — The stem is ambiguous because it does not state whether NPV is positive, zero, or negative, so option A is not always correct. It also uses an {{NPV}} slot despite being marked conceptual; conceptual questions should have no slots. Finally, no option has the required "common-misconception" role, so the retry gate would fail. D is a plausible misconception but is incorrectly labeled "partially-correct."

> **v2 run 2 (`reject`)** — The stem is under-specified: without stating that NPV is positive, “It adds value and should be accepted” is not always correct. It also incorrectly includes a slot in a conceptual question, violating the option/slot contract, and has no option with role "common-misconception," so it fails the retry gate.

> **v2 run 3 (`reject`)** — The question has no option with role "common-misconception," so it fails the retry gate. It also uses an unresolved NPV slot in a conceptual question without defining its sign; option A is correct only if NPV is positive. Conceptual questions should not contain numerical slots, and the resulting stem is ambiguous.

> **v2 run 4 (`reject`)** — The MCQ has no option with role "common-misconception," so it fails the retry gate. It also unnecessarily includes an NPV slot in a conceptual question whose options are qualitative decisions/statements; this violates the option/slot contract and leaves the stem underspecified.


---

## Fixture F3 — Explain why diversification reduces unsystematic risk

**Known fault.** None deliberately introduced — a clean conceptual question. Included as a CONTROL: a reviewer that flags everything is as useless as one that passes everything.

<details>
<summary>Fixture JSON</summary>

```json
{
  "stem": "Two portfolios hold the same number of stocks, but one holds them all in a single industry. Why does the diversified portfolio carry less risk, even though both hold the same count?",
  "difficulty": "medium",
  "numericKind": "conceptual",
  "options": [
    {
      "key": "A",
      "text": "Its holdings’ firm-specific shocks are less correlated, so they offset rather than compound",
      "role": "correct",
      "explanation": "Diversification works through low correlation, not through count alone."
    },
    {
      "key": "B",
      "text": "Holding more industries reduces systematic risk, which is the larger component",
      "role": "common-misconception",
      "explanation": "Systematic risk cannot be diversified away; this confuses the two components."
    },
    {
      "key": "C",
      "text": "A single-industry portfolio has higher average volatility per stock",
      "role": "partially-correct",
      "explanation": "Not necessarily true of the individual stocks; the effect comes from correlation."
    },
    {
      "key": "D",
      "text": "Diversification raises expected return, so risk per unit of return falls",
      "role": "clearly-wrong",
      "explanation": "Diversification reduces risk without raising expected return."
    }
  ]
}
```

</details>

### F3 judged by reviewer v1

Verdicts: `pass`, `pass`, `pass`, `pass`

> **v1 run 1 (`pass`)** — The question accurately tests why diversification reduces unsystematic risk: lower correlation among firm-specific shocks allows them to offset. The stem is clear and aligned with the learning objective, and the distractors reflect plausible misconceptions about systematic risk, individual-stock volatility, and expected return. The conceptual reasoning is appropriate for medium difficulty, and no numerical formulas require validation.

> **v1 run 2 (`pass`)** — The question directly and accurately tests that diversification reduces unsystematic risk through lower correlation among firm-specific shocks, not merely by increasing the number of holdings. The correct answer is clear, and the distractors represent plausible misconceptions: confusing systematic and unsystematic risk, attributing the effect to individual-stock volatility, and assuming diversification increases expected return. The medium difficulty is reasonable for a conceptual application rather than a simple formula substitution. No numerical formulas or derived values require review.

> **v1 run 3 (`pass`)** — The question accurately tests why diversification reduces unsystematic risk: lower correlation among holdings allows firm-specific shocks to offset. The distractors target realistic misconceptions about reducing systematic risk, stock-level volatility, and expected return. The stem and options are clear and unambiguous, and the medium difficulty is reasonable for a conceptual explanation requiring correlation-based reasoning. No numerical formulas require review.

> **v1 run 4 (`pass`)** — The question directly tests that diversification reduces unsystematic risk through lower correlation among holdings, not merely through stock count. The correct answer is factually sound, while the distractors represent plausible misconceptions about systematic risk, individual-stock volatility, and expected return. The stem and options are clear, and the conceptual reasoning is appropriately more than simple substitution for a medium-difficulty item. Formula modelling is not applicable.

### F3 judged by reviewer v2

Verdicts: `pass`, `pass`, `pass`, `pass`

> **v2 run 1 (`pass`)** — The question accurately tests that diversification reduces unsystematic risk through lower correlation among firm-specific shocks, not merely through holding more stocks. The distractors are plausible and address common confusions involving systematic risk, individual-stock volatility, and expected return. The stem and options are clear, the conceptual reasoning is appropriate for medium difficulty, and the question includes a common-misconception option for retry behavior. As a conceptual question, there are no numerical formulas, slots, or option-contract issues.

> **v2 run 2 (`pass`)** — The question directly tests why diversification reduces unsystematic risk: lower correlation among firm-specific shocks allows them to offset. The distractors represent plausible misconceptions about systematic risk, individual-stock volatility, and expected return. The conceptual format appropriately has no slots or formulas, the medium difficulty is suitable, the wording is clear, and option B satisfies the common-misconception retry requirement.

> **v2 run 3 (`pass`)** — The question accurately tests why diversification reduces unsystematic risk: cross-industry holdings generally have lower correlations among firm-specific shocks, so the shocks offset rather than compound. The distractors target realistic misconceptions about systematic risk, per-stock volatility, and expected return. The stem and options are clear, the conceptual medium difficulty is appropriate, and the question includes a common-misconception option for retry behavior. No numerical slots or formula-contract issues apply.

> **v2 run 4 (`pass`)** — The question directly tests why diversification reduces unsystematic risk: cross-industry firm-specific shocks tend to be less correlated and can offset. The distractors are plausible and distinguish systematic risk, individual-stock volatility, and return effects. It is clear, appropriately medium for a conceptual comparison, includes a common-misconception retry option, and has no numerical slots or formula-contract issues.


---

## Summary

| Fixture | Known fault | v1 verdicts | v1 detected | v2 verdicts | v2 detected |
|---|---|---|---|---|---|
| F1 | BETA range includes 1 | reject, reject, reject, reject | 4/4 | reject, reject, reject, reject | 4/4 |
| F2 | No common-misconception option at all — decideStrategy therefore never offers the Strategy-A retry | flag, reject, reject, reject | 0/4 | reject, reject, reject, reject | 4/4 |
| F3 | None deliberately introduced — a clean conceptual question | pass, pass, pass, pass | n/a | pass, pass, pass, pass | n/a |

---

# Analysis

## 4a — the reviewer is CONSISTENT, so I over-worried

**11 of 12 v1 verdicts were identical on repeated identical input.** The only
wobble was F2 (`flag` once, `reject` three times) — a severity wobble on a
genuinely ambiguous question, not a direction flip. F1 rejected 4/4; F3 passed
4/4.

**This retracts the doubt I raised.** I suggested the "few-shot looks worse on
numeric" result in experiment 2 might be reviewer noise. On this evidence it is
not: the reviewer does not scatter. The A2 (flag, flag, flag) vs B2 (reject,
reject, flag) contrast in `prompt-engineering-tests.md` should be read as signal,
with the usual n=3 caution but not dismissed.

It also retracts a claim I made from experiment 2 — that v1 catches collisions
"only 2 times in 5". On F1 it named the fault **4/4**. Detection depends on how
cleanly the fault sits in the question, not on reviewer randomness; the earlier
misses were on messier questions, and I generalised from too little.

**Consistency is not correctness**, and F2 shows the difference exactly: v1
consistently rejected it, and consistently for the wrong reason.

## 4b — v2 is strictly better, and does not over-reject

| Fixture | v1 verdicts | v1 named fault | v2 verdicts | v2 named fault |
|---|---|---|---|---|
| **F1** collision | reject ×4 | **4/4** | reject ×4 | **4/4** |
| **F2** no common-misconception | flag, reject ×3 | **0/4** | reject ×4 | **4/4** |
| **F3** clean control | pass ×4 | n/a | pass ×4 | n/a |

**F2 is the result that matters.** Both versions rejected it, but only v2 knew
*why*. v1 saw only the ambiguity:

> *"the stem does not state whether {{NPV}} is positive, zero, or negative"*

v2 saw that **and** two structural faults v1 has no criterion for:

> *"It also uses an {{NPV}} slot despite being marked conceptual; conceptual
> questions should have no slots. Finally, **no option has the required
> "common-misconception" role, so the retry gate would fail.** D is a plausible
> misconception but is incorrectly labeled "partially-correct.""*

That last observation is one nobody asked for and it is correct — D *is* the
misconception, mislabelled. v1 never gets there.

**F3 is the guard that makes the rest meaningful.** A reviewer given three extra
rejection criteria could simply reject more. v2 passed the clean question 4/4,
so the gain in F2 is discrimination, not severity inflation.

## A flaw in my own fixture design

**F1 does not actually test criterion 7.** I handed v2 the verifier's failure
string (`options CAPM_RETURN_PCT and NO_BETA_RETURN_PCT are identical`), so of
course it named the collision — it was told. And v1 found it unaided anyway, so
the fixture discriminates nothing.

The real test of criterion 7 is the same fixture **without** the verifier text,
which is the case that matters in production: the reviewer runs *before* anyone
knows whether a proof was earned. That is the next test, not a settled result.

## What this means for the original question

Saurav asked whether an outdated reviewer might be why exemplars looked bad on
numeric — i.e. whether fixing it would rescue exemplars for both kinds.

**It would not.** Experiment 2's B2 rejects were formula-modelling faults under
criterion 6, which v1 already covers well and applies consistently. Fixing the
reviewer changes the *gate* and the *feedback signal*, not what the generator
produces. Exemplars for numeric remain unproven.

But the reviewer overhaul is worth doing on its own evidence, and it compounds
with the planned regeneration change: `agentDecision.reasoning` is exactly what
would be fed back on regenerate, and v2's version of that text is far more
actionable than v1's.

## Recommendation

1. **Adopt reviewer v2's criteria 7–9** — measured better on F2, no cost on F3.
2. **Pass the verifier's failure into the reviewer when one exists.** Free: the
   proof runs first, and the reviewer currently guesses at servability.
3. **Re-run F1 without the verifier hint** before claiming criterion 7 works.
4. Keep treating verdicts as signal at n≥3 — but not at n=1.

---

# Follow-up — criterion 7 validated WITHOUT the hint

The earlier F1 result proved nothing about criterion 7: the reviewer was handed
the verifier's failure string, so naming the collision was not a detection. That
limitation was recorded rather than glossed, and this closes it.

**Fixture:** the subtle case the generator actually produced on 2026-08-16 —
`IGNORED_BETA = RF + (M - RF)`, which is identically `MARKET_ONLY = M`. Two
DISTRACTORS identical for every draw, so no range choice can separate them. The
beta range here deliberately excludes 1.0, so the obvious trap is absent.

**No `verificationFailure` was passed.** The reviewer was on its own.

| Runs | Verdict | Collision found |
|---|---|---|
| 4 | **reject ×4** | **4/4** |

> *"IGNORED_BETA has the formula RF_PCT + (MARKET_PCT - RF_PCT), which is
> identically MARKET_PCT. Thus options B and C always display the same value for
> every allowed draw"*

All four found it, named both options, and showed the algebra. For comparison,
reviewer v1 reviewing this same shape in experiment 2 returned `flag` with no
mention of the collision — it saw a question that was merely too easy.

**Criterion 7 is validated.** The reviewer now catches, unaided, the fault class
that accounted for nearly every unservable question — which matters because the
verifier only reports the FIRST collision it finds, and because on the
regeneration path there may be no verifier result to hand over at all.

---

# Follow-up — the validator earns its call, and its output now reaches the reviewer

Saurav asked whether the validator's and reviewer's outputs should be wired
together. The overlap test that answered it used planted role faults:

| Fixture | Validator named the fault | Reviewer named it |
|---|---|---|
| Reversed answer key (factually wrong) | 3/3 | 3/3 (reject) |
| Subtle role swaps (question factually sound) | 2/3 | **0/3** — one run endorsed the mislabeled option as "plausible" |
| Clean control | 0 false alarms | 0 false alarms |

(The first pass of this test scored the reviewer 3/3 on the swaps via a broken
case-insensitive regex — `(D|…)` matches any letter d. A full-text re-probe
exposed it; harness regexes are now treated as hints, verdicts read in full.)

**Conclusion: reviewer ⊉ validator.** The reviewer catches role faults only when
they make the question factually wrong; when the labels are merely swapped it
checks that a misconception option EXISTS and moves on. Role fit is not
cosmetic — `decideStrategy` keys the Strategy-A retry on the
common-misconception role, so a swap silently changes student behaviour. The
merge/retire idea is dead; the validator stays.

## The wiring, and Saurav's policy

`roleAssessment` now flows into `REVIEWER_PROMPT` at all four call sites (zero
extra model calls — the validator already runs first), with the policy Saurav
set: **a mislabeled role on an otherwise sound question is a FLAG that names the
exact swap** — one edit for the instructor in the question editor — never a
reject, and therefore never a spent reject-retry. A wrong answer key remains a
reject: that is not a label problem.

## Measured end to end (validator's real output → reviewer)

| | Before wiring | After |
|---|---|---|
| Role-swap fixture | flag ×3 for difficulty, swap unmentioned | **flag ×3, each naming the fix: "Relabel D from partially-correct to clearly-wrong"** |
| Policy (flag, not reject) | — | held 3/3 |
| Clean control | pass ×3 | pass ×3, zero role complaints |

Honest bound: the hand-off surfaces what the validator's single run caught. In
this measurement the validator draw named D but not C, so C stayed missed —
detection is the union of the two agents, not perfection. The measured failure
class (swaps surfacing to nobody) is closed.
