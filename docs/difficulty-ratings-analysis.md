# Difficulty ratings analysis — the instructor's question bank vs. our prompts

_Analyzed 2026-08-21 from `FinanceBot_Difficulty_Ratings.docx` (master LTIC
folder): 108 real practice questions from 8 quizzes, each rated LOW/MID/HIGH by
the instructor, with per-question explanations and a classification methodology
appendix._

This document cross-references that bank against the three prompts in
`generation.service.ts` (`GENERATOR_PROMPT`, `VALIDATOR_PROMPT`,
`REVIEWER_PROMPT` and the shared `DIFFICULTY_RUBRIC`), and ranks the changes it
supports — respecting what `docs/prompt-engineering-tests.md` has already
measured and rejected.

---

## 1. What the instructor gave us

### The bank

| | LOW | MID | HIGH | total |
|---|---|---|---|---|
| Numerical / Calculation | 8 | 25 | 11 | **44** |
| Multiple Choice | 12 | 15 | 6 | **33** |
| Fill-in-the-Blank | 4 | 5 | 3 | **12** |
| True / False | 3 | 5 | 2 | **10** |
| Multiple Answer (Select All) | 1 | 4 | 1 | **6** |
| Matching / Multi-Part | 2 | 1 | 0 | **3** |
| **total** | **30 (28%)** | **55 (51%)** | **23 (21%)** | **108** |

### The rubric (appendix, verbatim structure)

The instructor's rubric is **split by question kind** — calculation vs.
conceptual — and is mapped to Bloom's Revised Taxonomy (Low ≈
Remember/Understand or simple Apply; Mid ≈ multi-step Apply; High ≈
Analyze/Evaluate). It rates **cognitive demand, not empirical difficulty** —
explicitly the same construct our `Difficulty` type intends. `easy/medium/hard`
maps 1:1 onto LOW/MID/HIGH.

| Level | Calculation | Conceptual |
|---|---|---|
| **LOW** | Single formula, single concept; no rate/unit conversion beyond one step (or the conversion IS the question, e.g. r = APR/m). | Direct recall; one clearly correct answer among plausible but distinguishable distractors. |
| **MID** | One genuine conversion (APR → effective where compounding ≠ cash-flow frequency) **plus** one formula application — or one formula over a scenario requiring organizing several inputs (bond pricing, Gordon Growth treated as one integrated tool). Also: rearranging one formula for an unknown (payment, rate, growth). | Applying a concept to a new scenario; distractors requiring real understanding, not recall. Also: repeated application of one simple framework across sub-parts (classify 4–7 items debt vs. equity). |
| **HIGH** | Chains **more than 2 distinct concepts/formula types** (rate conversion + annuity + "value = benefit − cost"; two full valuations compared). Also: **backward/strategic solving** where the approach itself is not obvious (testing candidate answers; re-deriving a bond's remaining maturity before repricing). | Distractors deliberately close or easily confused (dealer vs. exchange). **Distractors built from single errors on steps.** Holding two related-but-different rules in mind at once (annuity vs. annuity due, cum- vs. ex-dividend, coupon rate vs. interest-rate risk). |

Two notes from the appendix worth keeping:

- Mid/High boundary calls involve judgment; HIGH requires **connections across
  concepts, not just step count**, and applying concepts "in a less traditional
  manner".
- **The instructor offers empirical data**: "Exam data could be produced in some
  cases to generate empirical difficulty data if it could help refine the
  prompting." (Practice-quiz completion is too sparse; exam data is the usable
  source.)

## 2. Hidden signals — what actually separates the levels

Mined from the 108 questions themselves, beyond what the rubric states.

### Structural, measurable

| signal | LOW (n=30) | MID (n=55) | HIGH (n=23) |
|---|---|---|---|
| stem length (median words) | 24 | 55 | 83 |
| numeric quantities in stem (median) | 0 | 5 | 5 |
| explanation length (median words) | 52 | 73 | 108 |

The key one: **HIGH adds words, not numbers.** MID and HIGH stems carry the
same count of given quantities — the extra ~30 words of a HIGH stem are
narrative complications (timing shifts, regime changes, an embedded decision),
not extra inputs. Difficulty lives in the *structure* of the story, and in
what the stem *withholds* (the approach), never in bigger arithmetic. This is
exactly the distinction our generator prompt already gestures at ("however
large the arithmetic looks") — the bank now grounds it.

### The HIGH "hardness moves" — recurring, nameable devices

Nearly every HIGH calculation question is a MID question **plus exactly one of
these moves**:

1. **Off-cycle timing** — the event happens mid-stream: value a loan just after
   the 14th of 36 payments; sell a bond 12 months after purchase; a dividend
   was missed "this morning" (cum- vs ex-dividend).
2. **Re-derive a hidden parameter first** — remaining maturity, the original
   monthly payment, or the effective rate is *not given* and must be
   reconstructed from the loan's origination terms before the real question
   starts (Julia's mortgage: derive the payment from origination, then PV the
   remaining 110).
3. **Value = benefit − cost framing** — the computed PV is not the answer; it
   is one leg of a trade whose value is the difference (car-loan takeover:
   $15,000 market value − $13,243.54 remaining loan).
4. **Multi-stage regimes** — dividend growth 50%/25%/5%, or growth for 3 years
   then perpetuity: two formulas chained across a regime boundary, discounted
   back through the first stage.
5. **Deferred start** — first dividend 3 years from today, semiannual
   thereafter: annuity/perpetuity value lands at the wrong date and must be
   discounted again.
6. **Reinvestment chains** — coupons deposited into a savings account at a
   different rate; total holding-period return needs FV of coupons + sale price
   vs. purchase price.
7. **Two-approach comparison** — price via DDM *and* via P/E comparable, then
   reconcile; or NPV rule vs. IRR rule agreement.
8. **Annuity due switch** — "first payment is due today" flips the standard
   formula; HIGH when combined with another move (amortize a loan due-today),
   MID when it is the whole question (the lease).

HIGH *conceptual* questions instead sharpen distractors to **minimal pairs**:
coupon rate vs. interest-rate risk (T/F requiring the ratio-of-value-timing
argument), dealer vs. exchange, primary vs. secondary market. The T/F "Bond A
has a higher coupon rate, so it is safer in interest-rate risk" is HIGH with a
7-word option set — all the demand is in holding two rules at once.

### Real distractors are named error models

The instructor's own distractors implement specific mistakes. Julia's mortgage:
$450,000.00 (*balance never changed*), $412,500.00 (*linear amortization:
110/120 of principal*), $331,282.10 (a specific wrong-rate path). This is
precisely our `errorModel` contract — the bank validates that design and
supplies a course-specific misconception library:

- Linear amortization instead of PV-of-remaining-payments
- Using APR/m when compounding frequency ≠ payment frequency (the 6% APR
  compounded **semiannually**, paid **monthly** Canadian-mortgage trap — the
  single most reused device in the bank)
- Compounding forward instead of discounting back
- Ordinary annuity when payments start today (and vice versa)
- Valuing a deferred stream as if it started at t=1
- Using the coupon rate as the discount rate (and coupon vs. YTM generally)
- Keeping n fixed when time has passed (not re-deriving remaining maturity)
- Cum- vs. ex-dividend price
- Stopping at PV-of-one-leg when the question asks for benefit − cost
- Single-stage Gordon Growth applied to a multi-stage regime

## 3. Pipeline review — where the prompts stand

The three prompts are in good shape and carry an unusually well-documented
measurement history. The review below is relative to what the bank newly makes
possible.

**Strengths (keep, do not relitigate):**

- The retry loops quoting the verifier's/reviewer's own words back (measured
  0/4 → 4/4 proofs) — the bank changes nothing here.
- The deterministic evaluator + collision machinery; the option contract;
  reviewer criteria 7–8 mirroring the serve gates.
- The prior A/B evidence: **conceptual few-shot exemplars showed no remaining
  headroom** (Task 5: pipeline already at 3/3 without them) and **worked
  distractor pairs showed no effect** (Experiment 3). Any exemplar proposal
  below must target a *different* fault than those tests measured.

**Gaps the bank exposes:**

1. **`DIFFICULTY_RUBRIC` is three generic one-liners.** No calc/conceptual
   split, no finance-specific boundary markers. The reviewer grades criterion 5
   against it, and the generator self-assesses against it — both would grade
   against the instructor's actual standard if we gave it to them. Difficulty
   miscalibration is the pipeline's *measured, persistent* fault (12/12 in
   Experiment 2; partially addressed since by the self-assessment instruction).
2. **"Harder" is described only abstractly.** The prompt's advice when a
   question comes out too easy — "require choosing between two approaches, or
   a step the stem does not hand over" — is two of the eight hardness moves.
   The model is asked to invent hardness; the bank shows hardness is a small
   closed menu the course actually uses.
3. **`PRESET_PROMPTS` are generic.** Low priority (the preset A/B found preset
   wording had no effect at either effort), but the "Calculation question"
   preset could name the course's own devices rather than "select and apply
   the correct finance formula".
4. **Type coverage:** 44/108 (41%) of the real bank is numeric-entry, 12 more
   are fill-in-the-blank, 6 multiple-answer, 3 matching. We generate MCQ and
   T/F only. Not a prompt problem — a roadmap fact worth stating with numbers.
5. **Difficulty mix:** the instructor's own bank is 28/51/21 LOW/MID/HIGH.
   Nothing in generation today suggests a target distribution to instructors
   creating a batch.

## 4. Recommendations, ranked

### R1 — Replace `DIFFICULTY_RUBRIC` with the instructor's rubric (highest value, lowest risk)

Rewrite the three entries with the calc/conceptual split, condensed from §1.
Both consumers get it via the existing plumbing (generator sees its target's
line; reviewer sees all three — that architecture stays). Draft:

```ts
export const DIFFICULTY_RUBRIC: Record<Difficulty, string> = {
  easy:
    'Easy (calculation): one formula, one concept; no rate/unit conversion beyond a '
    + 'single step — or the conversion IS the entire question. '
    + 'Easy (conceptual): direct recall of a definition or fact, with plausible but '
    + 'clearly distinguishable distractors.',
  medium:
    'Medium (calculation): one genuine rate conversion (e.g. APR to effective when '
    + 'compounding frequency differs from cash-flow frequency) PLUS one formula '
    + 'application; or one standard formula (bond pricing, Gordon growth) over a '
    + 'scenario whose several inputs the student must organize; or rearranging one '
    + 'formula to solve for an unknown. A direct formula substitution is too easy. '
    + 'Medium (conceptual): applying a concept to a new scenario, with distractors '
    + 'that require understanding rather than recall.',
  hard:
    'Hard (calculation): chains MORE THAN TWO distinct concepts or formula types '
    + '(e.g. rate conversion + annuity PV + value-equals-benefit-minus-cost), or '
    + 'requires backward/strategic solving where the approach itself is not given '
    + '(re-derive a hidden parameter from origination terms before the real '
    + 'question starts). '
    + 'Hard (conceptual): the student must hold two related-but-easily-confused '
    + 'rules in mind at once (annuity vs. annuity due, cum- vs. ex-dividend, coupon '
    + 'rate vs. interest-rate risk), against distractors each built from a single '
    + 'wrong step. Hardness is connections across concepts — never arithmetic size. '
    + 'It must remain solvable from the supplied material.',
};
```

This is a wording change to an existing constant — no plumbing. Per repo
practice, A/B it against the current rubric on one computational and one
conceptual LO before shipping; the measurable claim is reviewer criterion-5
agreement and fewer difficulty-label flags.

### R2 — Add a "hardness moves" block, active when target is `hard`

The complement to the self-assessment fix: that told the model how to *grade*
hardness, this tells it how to *manufacture* it. Append (only when
`params.difficulty === 'hard'`) the §2 move list in compressed form, with the
instruction to pick ONE move and apply it to an otherwise-medium scenario.
This mirrors how the instructor's own HIGH questions are constructed and keeps
the block off easy/medium calls (avoiding the Experiment-2 lesson that global
additions are not free).

### R3 — Difficulty-targeted real exemplars — as an A/B, not a ship

Prior evidence rules out *generic* exemplars (no headroom on reviewer passes)
— but those tests never measured **difficulty calibration with a real HIGH
exemplar** while targeting `hard`. The candidate: one instructor HIGH question
per kind, shown only when target is `hard`, as a *shape* demonstration:

- Calculation: the car-loan takeover (move 1 + 2 + 3 in one stem, and its
  explanation is a perfect 3-step worked solution).
- Conceptual: the coupon-rate vs. interest-rate-risk T/F (maximal demand,
  minimal stem).

Pre-register the metric before running: distribution of self-assessed labels on
a `hard` target, and reviewer criterion-5 verdicts. If R1+R2 alone close the
gap, drop this — same reasoning that unshipped the conceptual exemplar.

### R4 — Seed the misconception library into distractor guidance

The generator's distractor section teaches "wrong methods, not wrong
arithmetic" with two synthetic examples. Replace/extend with 4–5 from §2's
list, which are the course's *actual* recurring error models (linear
amortization; APR/m under mismatched frequencies; n not re-derived after time
passes; deferred stream valued at t=1). These double as `errorModel` phrasings
the reviewer can recognize. Keep it short — Experiment 3 showed elaborate
distractor scaffolding buys nothing, so this is a swap of examples, not an
expansion.

### R5 — Housekeeping, no experiments needed

- **Reviewer criterion 5**: inherits R1 automatically via `DIFFICULTY_RUBRIC`.
  Optionally add the appendix's one-liner: "hardness is connections across
  concepts, not the number of steps in the calculation."
- **Preset text**: fold course devices into the Calculation preset ("...may
  involve a rate conversion where compounding and payment frequencies differ").
  Zero-cost; expectations low given the preset A/B.
- **Batch difficulty mix**: surface 30/50/20 as the suggested default split in
  the blueprint/batch UI, sourced from the instructor's own bank.

### R6 — Take the instructor up on empirical data

The appendix explicitly offers exam-derived empirical difficulty. That is the
only path to validating that generated `hard` ≈ experienced hard. Worth a
follow-up ask: even one exam's item statistics joined against these 108 rated
items would calibrate the rubric's boundary cases (the appendix itself flags
Mid/High as judgment calls).

## 5. What the bank does NOT support changing

- **Few-shot for routing or general quality** — already tested; no headroom.
- **Worked distractor pairs** — already tested; no effect.
- **Reviewer collision-hunting** — deliberately removed; the bank is silent on
  it and the deterministic verifier owns it.
- **Bigger-numbers-as-difficulty** — the bank actively refutes it: MID and
  HIGH stems carry the same number of quantities.

## 6. Source data

Extraction artifacts (scratchpad, this session): segmented `questions.json`
with per-question stem/options/explanation/level. The docx lives at
`C:\Users\Saurav\Documents\CLAUDE\LTIC\FinanceBot_Difficulty_Ratings.docx`.
Re-derivable: unzip → parse `word/document.xml` (questions are one-row tables
`Question N | type | level` followed by body paragraphs).
