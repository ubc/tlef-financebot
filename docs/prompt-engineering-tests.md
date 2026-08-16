# Prompt engineering tests — conceptual vs numeric routing

_Run 2026-08-16._ Three prompt variants, **one learning objective and one set of
retrieved chunks**, so the only thing that differs between them is the prompt body.

## Method

- **Learning objective:** Analyze macro drivers of exchange rates (`6a7e3bd4ae7ebf69b347c348`) — deliberately a
  NON-computational objective, so a numeric answer is a routing failure rather than
  a legitimate choice.
- **Instructor prompt:** "Create a concise concept check that distinguishes genuine understanding from memorizing a definition."
- **Model:** `gpt-5.6-luna`, `reasoning_effort: none`, `temperature: 0.7`.
  Effort is `none` deliberately: any higher withdraws the temperature, and 0.7 is the
  only thing making a batch differ — six identical CAPM questions on 2026-08-15 were
  exactly that mistake.
- **3 questions per variant**, generated independently.
- **Grounding:** 6 chunks retrieved once and reused across all variants.

**What counts as success**, decided before reading any output:

1. `numericKind: "conceptual"` — the objective is not computational.
2. Distractors are beliefs a student holds, not true-but-irrelevant statements.
3. Questions within a variant are genuinely different from each other.

---

## Variant A — Baseline — today's prompt, unchanged

What ships today. The model chooses numericKind; 60% of the body is numeric machinery.

Prompt: **17511 chars**, ~4378 tokens.

<details>
<summary>Full prompt as sent (click to expand)</summary>

```text
You are an expert finance instructor writing ONE multiple-choice practice question
for the learning objective: "Analyze macro drivers of exchange rates".
Target difficulty: medium.
Medium means the student must choose or connect concepts, interpret a scenario, or complete more than one reasoning step; a direct formula substitution is too easy.
Additional instruction from the instructor: Create a concise concept check that distinguishes genuine understanding from memorizing a definition.
Ground the question ONLY in the course material below. Do not introduce facts not supported by it.
Course material:
[1] Class 21

International Finance

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Define key concepts in international finance such as multinational corporation     (MNC), exchange rate, currency appreciation/depreciation, and foreign exchange     risk

Calculate changes in exchange rates and classify whether a currency has     appreciated or depreciated, using real-world FX data

Analyze how macro factors, such as relative inflation, political and economic risk,     and central bank policy, influence equilibrium exchange rates

Evaluate the impact of a strong or weak currency on different corporations     (exporters or importers)

Prime Minister Mark Carney’s visit to South Africa for the G20, which will include a meeting with the country’s president, comes as Canada prioritizes boosting trade with other continents and plans to scale back foreign aid.

Why Study International Finance?

Globalized Business: Most firms and markets operate across borders

[2] Class 21

International Finance

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Define key concepts in international finance such as multinational corporation     (MNC), exchange rate, currency appreciation/depreciation, and foreign exchange     risk

Calculate changes in exchange rates and classify whether a currency has     appreciated or depreciated, using real-world FX data

Analyze how macro factors, such as relative inflation, political and economic risk,     and central bank policy, influence equilibrium exchange rates

Evaluate the impact of a strong or weak currency on different corporations     (exporters or importers)

Prime Minister Mark Carney’s visit to South Africa for the G20, which will include a meeting with the country’s president, comes as Canada prioritizes boosting trade with other continents and plans to scale back foreign aid.

Why Study International Finance?

Globalized Business: Most firms and markets operate across borders

[3] The exchange rate is just a price—of one currency in terms of another—but it     creates real business risk

Exchange rates are set by supply and demand, driven by fundamentals and     expectations

Understanding base vs reference currency, direct vs indirect quotes, and how     appreciation/depreciation work is essential because FX movements directly     affect firms’ CAD revenues, costs, and values.

There are winners and losers from currency movements, and that’s what FX risk     management is about. A strong CAD helps consumers and importers but hurts     exporters; a weak CAD has the opposite pattern.

Thank you

[4] The exchange rate is just a price—of one currency in terms of another—but it     creates real business risk

Exchange rates are set by supply and demand, driven by fundamentals and     expectations

Understanding base vs reference currency, direct vs indirect quotes, and how     appreciation/depreciation work is essential because FX movements directly     affect firms’ CAD revenues, costs, and values.

There are winners and losers from currency movements, and that’s what FX risk     management is about. A strong CAD helps consumers and importers but hurts     exporters; a weak CAD has the opposite pattern.

Thank you

[5] Class 22

International Finance Part 2

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Describe the structure and key features of the global foreign exchange (FX) market

Explain the concept of transaction exposure and identify situations in which     importers and exporters face exchange rate risk on foreign-currency payables and     receivables

Calculate spot, forward, and cross exchange rates, and compute the CAD cost or     inflow of foreign-currency transactions under different hedging strategies

Compare and contrast forward contracts, futures, and currency options as     hedging tools, including their mechanics, payoffs, advantages, and limitations for     MNCs

The Foreign Exchange Market

The foreign exchange (forex) market is an electronically linked network of banks,     foreign exchange brokers, and dealers whose main function is to match buyers and     sellers of foreign currencies

[6] Class 22

International Finance Part 2

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Describe the structure and key features of the global foreign exchange (FX) market

Explain the concept of transaction exposure and identify situations in which     importers and exporters face exchange rate risk on foreign-currency payables and     receivables

Calculate spot, forward, and cross exchange rates, and compute the CAD cost or     inflow of foreign-currency transactions under different hedging strategies

Compare and contrast forward contracts, futures, and currency options as     hedging tools, including their mechanics, payoffs, advantages, and limitations for     MNCs

The Foreign Exchange Market

The foreign exchange (forex) market is an electronically linked network of banks,     foreign exchange brokers, and dealers whose main function is to match buyers and     sellers of foreign currencies
Produce EXACTLY 4 options. EXACTLY ONE option has role "correct".
Every option has a per-option explanation. Assign each non-correct option one role from:
  - "common-misconception": a plausible error a student commonly makes
  - "partially-correct": right idea, incomplete or misapplied
  - "clearly-wrong": obviously incorrect to a prepared student
AT LEAST ONE option MUST be "common-misconception". The practice loop offers its retry only when a student picks one, so a question without it silently loses that behaviour. A question is rejected and regenerated without one.
DISTRACTORS ARE WRONG METHODS, NOT WRONG ARITHMETIC. A distractor must be the
number a student actually reaches by reasoning incorrectly — discounting the
wrong number of periods, compounding forward instead of back, dropping a term,
using the wrong rate. Do NOT take the correct formula and mutate an operator:
  good:  PAYMENT*(1+r)^n        compounded forward instead of discounting
  good:  PAYMENT/(1+r)^1        discounted one period regardless of the term
  bad:   SALES*(MULTIPLE^2)     squaring a multiple is not a mistake anyone makes
  bad:   SALES+MULTIPLE         swapping x for + is arithmetic noise
  bad:   (MULTIPLE+1)*SALES     an arbitrary tweak, not a misconception
If you cannot name the student who would make the mistake, it is not a
distractor — find a real one from the course material.
FORMATTING. The stem, every option, and every explanation are rendered as
markdown with KaTeX math. Write formulas as LaTeX, not as flat ASCII:
  - inline math between single dollars: $PV = \frac{C}{(1+r)^n}$
  - display math between double dollars for a full worked line:
      $$PV = \sum_{t=1}^{n} \frac{C_t}{(1+r)^t}$$
Two rules the renderer imposes, and both fail SILENTLY when broken — the
math renders as literal source text rather than erroring:
  1. Never use \( \) or \[ \]. The markdown pass runs first and strips
     their backslashes, so KaTeX never sees a delimiter.
  2. A math span must never contain a dollar followed by digits and then a
     space: that reads as a currency amount, not as math. In practice, start
     math with a symbol or a command — never a digit — and keep currency
     symbols OUTSIDE the math:
       good:  A payment of $500 grows to $P \times 1.05$.
       good:  $\text{FV} = 500 \times 1.05$
       bad:   $500 \times 1.05$      (opens with a digit)
       bad:   $\$500 \times 1.05$   (escaped amount, then a space)
     The same applies right after $$: write $$\text{PV} = \sum ...$$, never
     $$500 \times ...$$
  3. Never write a slot or derived-value NAME inside \text{}. Those names
     contain underscores, and escaping an underscore inside math is where
     stray characters creep in and break the whole span. Use a short symbol
     and let the placeholder carry the number:
       good:  $r = \frac{R}{100}$ where the rate is {{RATE_PCT}}%
       bad:   $r = \frac{\text{RATE_PCT}}{100}$
Prose stays prose; only the formulas are LaTeX.
Show the working in the EXPLANATION — that is what that field is for, so a
display line there beats describing the arithmetic in words. Do NOT put the
working in an option: an option states an ANSWER, never the formula that
produces it. See THE OPTION CONTRACT below.
NUMERICAL QUESTIONS — MANDATORY.
If answering requires ANY computation, set "numericKind": "numeric".
NEVER write a computed number anywhere — not in the stem, an option, or an explanation.
State the inputs as variable slots and every displayed value as a formula; a
deterministic evaluator computes them at serve time, and each student sees different
numbers.
  - "paramSlots": the inputs, e.g.
      [ { "name": "PAYMENT", "min": 100, "max": 900, "step": 100 },
        { "name": "RATE_PCT", "min": 4, "max": 12, "step": 2 } ]
  - "derivedValues": the correct answer AND every distractor, e.g.
      [ { "name": "PV", "formula": "PAYMENT/(1+RATE_PCT/100)^2" },
        { "name": "PV_COMPOUNDED", "formula": "PAYMENT*(1+RATE_PCT/100)^2",
          "errorModel": "compounded forward instead of discounting back" } ]
    These formulas are EVALUATOR syntax and are NEVER LaTeX: they are parsed
    and computed, not displayed. Keep writing PAYMENT/(1+RATE_PCT/100)^2 —
    a \frac{}{} here fails to parse and the question is rejected. LaTeX
    belongs only in the stem, option and explanation TEXT.
  - BUILD THE ANSWER IN STEPS. "derivedValues" are evaluated IN ORDER, and a
    later formula may use any earlier one BY NAME. Prefer several short named
    steps to one long expression:
      good:
        DEBT_VALUE   = PV(YTM_PCT/100, 16, FACE_DEBT*COUPON_PCT/100) + PV(YTM_PCT/100, 16, FACE_DEBT)
        EQUITY_VALUE = SHARES*PRICE
        V            = DEBT_VALUE + EQUITY_VALUE
        COST_EQUITY  = RF_PCT/100 + BETA*MRP_PCT/100
        WACC         = (EQUITY_VALUE/V)*COST_EQUITY + (DEBT_VALUE/V)*(YTM_PCT/100)
      bad:  all of that inlined as one 400-character expression with the two
            PV(...) calls repeated six times.
    A step that no option displays is perfectly allowed and is exempt from
    the option contract below — name it and reuse it.
    This is not a style preference. Long nested expressions are exactly where
    real generations drop a parenthesis; the parser then reports "trailing
    input after formula" and the question is rejected outright. If a formula
    runs past roughly 100 characters, or nests more than three deep, SPLIT IT.
    If you cannot express a quantity inline, give it its OWN step. Never fill
    the gap with a stand-in: (PV(1,1,1) - PV(1,1,1)) and a hardcoded 2.2e6
    were both produced in real runs — the first is identically zero, so it
    divided the answer by zero on every draw.
    Every distractor MUST carry an "errorModel" naming the specific mistake it
    represents, and its formula must genuinely implement that mistake.
    Name the MISTAKE, never the role. "common-misconception" is a role, not an
    errorModel — a real generation returned exactly that on every distractor
    and the question was regenerated. Write "compounded forward instead of
    discounting back" or "used the coupon rate in place of the yield".
    The CORRECT value MUST NOT carry an "errorModel" — it represents no mistake.
    Omit the field entirely rather than describing the right answer in it.
  - THE OPTION CONTRACT — read this twice. It is checked FIRST, before any
    formula is evaluated, so breaking it rejects the question before the
    collision check below is even reached. Three consecutive live
    generations died here.
    An option text IS a value. Not a sentence containing a value — the whole
    option is the quantity, plus at most a currency symbol, unit or percent
    sign, and it carries EXACTLY ONE {{NAME}} from "derivedValues":
      good:  "${{PV}}"
      good:  "{{IRR_PCT}}%"
      bad:   "${{PAYMENT}}"                  an INPUT slot is not an answer
      bad:   "-{{CF0}} + {{CF1}}/(1+r)"      the formula, not the answer
      bad:   "Accept the project"            no computed value at all
      bad:   "Accept the project. {{NPV}}"   a sentence with a value stapled
             on. This is the worst of the four: it passes the automatic
             check and reaches a student as a decision followed by an
             unrelated number. If you find yourself appending a value to a
             sentence to satisfy this rule, the question is CONCEPTUAL —
             go and set "numericKind": "conceptual" instead.
    Input-slot placeholders may also appear in an option, but they do not
    count toward this rule and can never stand in for the derived value.
    Two options must never name the same derived value.
    The STEM may use slot placeholders freely — this rule is about options.
Formula syntax: + - * / ^ ( ), variable names, and these functions only:
  PV(rate, periods, amount), FV(rate, periods, amount), PMT(rate, periods, principal),
  NPV(rate, cf1, cf2, ...), IRR(cf0, cf1, ...), ln, exp, sqrt, abs, min, max,
  round(value, decimals), N(x) for the standard normal CDF, and
  SUM(index, from, to, body) for series such as duration or amortization.
These functions are shorthand, not a limit: any closed-form finance formula can be
written with arithmetic alone (CAPM is RF + BETA*MRP; Gordon growth is D1/(R-G)).
Transcribe the formula the course material itself uses.
That list is the WHOLE grammar. There are no comparisons (> < >= <= == !=),
no conditionals, no ternary ?:, no booleans, and no if(). A formula like
"max(1, min(2, (PI_X>0?1:0) + (PI_Y>0?1:0)))" does not parse and the question
is rejected. If you are reaching for a comparison, you are encoding a DECISION
as a number — that question is "conceptual", not "numeric".
Two rules the automatic verifier enforces — a question breaking either is rejected:
  1. Ranges must never let a formula break. A rate a formula divides by must not
     include 0, and no range may drive a value beyond about 1e12.
  2. Option values must differ for EVERY combination of values in range.
THE PAIRWISE COLLISION CHECK — do this before you answer, it is the single most
common reason a question is rejected. Take every PAIR of option formulas, set them
equal, and solve. If any solution falls inside the declared ranges, the two options
show the same number on that draw and the question is unanswerable. Examples of
pairs that look fine and are not:
  - "A" and "B" (two bare slot values) are equal wherever their ranges OVERLAP.
  - "A - B" and "B" are equal when A = 2*B.
  - "A - B" and "B - A" are equal when A = B (both 0).
  - "A * (1+r)^n" and "A" are equal when n can draw 0.
THE FIX, and prefer this one: give the slots DISJOINT, WELL-SEPARATED ranges. If A
is always far larger than B, then A never equals B, A-B never equals B, and A+B
never equals either. For a firm with cash in and cash out, use something like
CASH_IN 3000..5000 and CASH_OUT 200..1000 rather than two ranges that both span
200..5000. Separated ranges are also more realistic than overlapping ones.
If separation is impossible, change the mistake instead: use a wrong rate, a
dropped term, or a wrong operand rather than a formula that can coincide.
Two collision traps seen in real generations, both from distractors that are
RATIOS or PERCENTAGES rather than amounts — the sizes cancel, so widening the
ranges does not separate them:
  - a distractor that differs only by a factor which some draw makes 1;
  - two "wrong rate" distractors whose rates coincide where their ranges meet.
For a ratio-valued answer, separate it by the STRUCTURE of the mistake (a
dropped term, a wrong denominator), not by the input ranges.
If answering requires NO computation, set "numericKind": "conceptual" and omit
paramSlots and derivedValues entirely.
ALSO conceptual, even though arithmetic is involved: a question whose OPTIONS
are decisions or statements rather than values — "Accept the project" /
"Reject the project", "The NPV rule and the IRR rule agree", and so on. Those
options cannot satisfy the option contract, because there is no single
computed value for them to display. Pick one shape and commit to it:
  - want the decision tested? -> "conceptual", no slots, no derivedValues;
  - want the arithmetic tested? -> "numeric", and every option is a VALUE.
Do not try to have both in one question.
Respond with ONLY this JSON shape:
{ "stem": string, "difficulty": "easy"|"medium"|"hard",
  "numericKind": "numeric"|"conceptual",
  "paramSlots": [ { "name": string, "min": number, "max": number, "step": number } ],
  "derivedValues": [ { "name": string, "formula": string, "errorModel": string } ],
  "options": [ { "key": string, "text": string, "role": string, "explanation": string } ] }
Use option keys "A","B","C","D".
```

</details>

### Questions generated by variant A

#### A1

- **numericKind:** `conceptual`  **difficulty:** `medium`  **slots:** 0  **derived:** 0

**Stem.** Canada's relative inflation rises while political and economic risk also increases. Holding other factors constant, which outcome is most consistent with the course material for the equilibrium value of the Canadian dollar?

- **[A]** The Canadian dollar appreciates because higher inflation and greater risk increase demand for it.  _<common-misconception>_
  - _This reverses the macroeconomic logic. Higher relative inflation tends to weaken a currency's equilibrium value, and greater political or economic risk can also reduce demand for it._
- **[B]** The Canadian dollar depreciates because both higher relative inflation and greater political or economic risk put downward pressure on demand for it.  _<correct>_
  - _The course material identifies relative inflation and political and economic risk as drivers of equilibrium exchange rates. Higher relative inflation and increased risk generally make the currency less attractive, creating downward pressure on its value._
- **[C]** The Canadian dollar's value is unchanged because exchange rates are determined only by current supply and demand, not by macroeconomic factors.  _<partially-correct>_
  - _Exchange rates are indeed set by supply and demand, but the course material emphasizes that supply and demand are driven by fundamentals and expectations, including relative inflation and political and economic risk._
- **[D]** The Canadian dollar depreciates only because political and economic risk increases; relative inflation has no effect on equilibrium exchange rates.  _<partially-correct>_
  - _The predicted depreciation is directionally plausible, but the explanation omits relative inflation, which the course material explicitly identifies as a macro driver of equilibrium exchange rates._

> **Reviewer (`high` effort): `flag`** — The question is factually accurate, aligned with the LO, clear, and has generally plausible distractors. However, it is essentially a straightforward recall-and-combine task: each of the two stated changes independently points toward depreciation, so selecting B requires little more than recognizing the direction of two macro drivers. That appears easier than a medium-difficulty item and should be recalibrated or made more analytically demanding.

#### A2

- **numericKind:** `conceptual`  **difficulty:** `medium`  **slots:** 0  **derived:** 0

**Stem.** Canada and Country X initially have similar political and economic risk. Then Canada experiences relatively higher inflation, while Country X's central bank adopts a policy that makes its currency more attractive to investors. Based only on the course material, which macroeconomic change most plausibly puts downward pressure on the equilibrium value of the Canadian dollar relative to Country X's currency?

- **[A]** Canada's relatively higher inflation, because exchange rates respond to macro fundamentals and expectations  _<correct>_
  - _Higher relative inflation is identified as a macro factor influencing equilibrium exchange rates. Combined with exchange rates being driven by fundamentals and expectations, it puts downward pressure on the Canadian dollar relative to Country X's currency._
- **[B]** Country X's more attractive central-bank policy, because any central-bank policy automatically weakens the currency of the country using it  _<common-misconception>_
  - _The first part identifies a relevant macro factor, but the conclusion is reversed and overgeneralized. Central-bank policy can influence exchange rates through expectations and investor demand; it does not automatically weaken the currency._
- **[C]** No change, because exchange rates are prices and prices cannot be affected by inflation or risk  _<clearly-wrong>_
  - _The course material explicitly states that exchange rates are prices set by supply and demand and driven by fundamentals and expectations, including relative inflation and political and economic risk._
- **[D]** Canada's relatively higher inflation only affects Canadian firms' operating costs, not the equilibrium exchange rate  _<partially-correct>_
  - _Higher inflation can affect firms' costs, but the response is incomplete and misapplied. Relative inflation is also explicitly listed as a macro factor influencing equilibrium exchange rates._

> **Reviewer (`high` effort): `reject`** — The question is materially ambiguous: both Canada's higher relative inflation and Country X's more attractive central-bank policy could put downward pressure on CAD relative to Country X's currency. Although option B gives an incorrect explanation, it names a change that would itself plausibly weaken CAD relative to X, so the stem does not support a unique answer. The item is also closer to easy recognition than medium difficulty.

#### A3

- **numericKind:** `conceptual`  **difficulty:** `medium`  **slots:** 0  **derived:** 0

**Stem.** Canada and Country X initially have similar political and economic risk. Then Country X experiences substantially higher inflation than Canada, while central bank policy and other conditions remain unchanged. Based only on the course concepts about supply, demand, and macro drivers of equilibrium exchange rates, which outcome is most likely?

- **[A]** Country X's currency appreciates because higher inflation increases its purchasing power.  _<common-misconception>_
  - _This reverses the relevant macro relationship. Relative inflation is a fundamental that can affect exchange rates, and higher inflation in Country X would generally weaken its currency relative to Canada, all else equal._
- **[B]** Country X's currency depreciates because its relative inflation makes it less attractive, reducing demand for it.  _<correct>_
  - _Higher inflation in Country X is a negative relative macro factor. With political and economic risk and central bank policy unchanged, it tends to reduce demand for Country X's currency relative to the Canadian dollar, putting downward pressure on its equilibrium exchange rate._
- **[C]** The Canadian dollar must depreciate because Canadian firms become less competitive when Country X has higher inflation.  _<partially-correct>_
  - _The conclusion is misapplied. The scenario directly changes Country X's relative inflation, so the expected pressure is on Country X's currency to depreciate, not necessarily on the Canadian dollar._
- **[D]** There can be no exchange-rate effect because exchange rates are determined only by central bank policy.  _<clearly-wrong>_
  - _The course material identifies relative inflation, political and economic risk, and central bank policy as macro factors influencing equilibrium exchange rates. Central bank policy is not the only driver._

> **Reviewer (`high` effort): `flag`** — The question is factually sound, aligned with the LO, and the correct relationship is clear. However, it is essentially a one-step qualitative application of the relative-inflation principle, so the stated medium difficulty is overstated. Distractor C is also somewhat weak: its competitiveness premise is backwards when Country X has higher inflation, making the option less pedagogically useful. Lowering the difficulty to easy and/or strengthening the distractors would improve it.

---

## Variant B — Few-shot — today's prompt + two worked examples

Saurav's proposal: keep one prompt, show a numeric and a conceptual exemplar.

Prompt: **18889 chars**, ~4722 tokens.

<details>
<summary>Full prompt as sent (click to expand)</summary>

```text
You are an expert finance instructor writing ONE multiple-choice practice question
for the learning objective: "Analyze macro drivers of exchange rates".
Target difficulty: medium.
Medium means the student must choose or connect concepts, interpret a scenario, or complete more than one reasoning step; a direct formula substitution is too easy.
Additional instruction from the instructor: Create a concise concept check that distinguishes genuine understanding from memorizing a definition.
Ground the question ONLY in the course material below. Do not introduce facts not supported by it.
Course material:
[1] Class 21

International Finance

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Define key concepts in international finance such as multinational corporation     (MNC), exchange rate, currency appreciation/depreciation, and foreign exchange     risk

Calculate changes in exchange rates and classify whether a currency has     appreciated or depreciated, using real-world FX data

Analyze how macro factors, such as relative inflation, political and economic risk,     and central bank policy, influence equilibrium exchange rates

Evaluate the impact of a strong or weak currency on different corporations     (exporters or importers)

Prime Minister Mark Carney’s visit to South Africa for the G20, which will include a meeting with the country’s president, comes as Canada prioritizes boosting trade with other continents and plans to scale back foreign aid.

Why Study International Finance?

Globalized Business: Most firms and markets operate across borders

[2] Class 21

International Finance

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Define key concepts in international finance such as multinational corporation     (MNC), exchange rate, currency appreciation/depreciation, and foreign exchange     risk

Calculate changes in exchange rates and classify whether a currency has     appreciated or depreciated, using real-world FX data

Analyze how macro factors, such as relative inflation, political and economic risk,     and central bank policy, influence equilibrium exchange rates

Evaluate the impact of a strong or weak currency on different corporations     (exporters or importers)

Prime Minister Mark Carney’s visit to South Africa for the G20, which will include a meeting with the country’s president, comes as Canada prioritizes boosting trade with other continents and plans to scale back foreign aid.

Why Study International Finance?

Globalized Business: Most firms and markets operate across borders

[3] The exchange rate is just a price—of one currency in terms of another—but it     creates real business risk

Exchange rates are set by supply and demand, driven by fundamentals and     expectations

Understanding base vs reference currency, direct vs indirect quotes, and how     appreciation/depreciation work is essential because FX movements directly     affect firms’ CAD revenues, costs, and values.

There are winners and losers from currency movements, and that’s what FX risk     management is about. A strong CAD helps consumers and importers but hurts     exporters; a weak CAD has the opposite pattern.

Thank you

[4] The exchange rate is just a price—of one currency in terms of another—but it     creates real business risk

Exchange rates are set by supply and demand, driven by fundamentals and     expectations

Understanding base vs reference currency, direct vs indirect quotes, and how     appreciation/depreciation work is essential because FX movements directly     affect firms’ CAD revenues, costs, and values.

There are winners and losers from currency movements, and that’s what FX risk     management is about. A strong CAD helps consumers and importers but hurts     exporters; a weak CAD has the opposite pattern.

Thank you

[5] Class 22

International Finance Part 2

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Describe the structure and key features of the global foreign exchange (FX) market

Explain the concept of transaction exposure and identify situations in which     importers and exporters face exchange rate risk on foreign-currency payables and     receivables

Calculate spot, forward, and cross exchange rates, and compute the CAD cost or     inflow of foreign-currency transactions under different hedging strategies

Compare and contrast forward contracts, futures, and currency options as     hedging tools, including their mechanics, payoffs, advantages, and limitations for     MNCs

The Foreign Exchange Market

The foreign exchange (forex) market is an electronically linked network of banks,     foreign exchange brokers, and dealers whose main function is to match buyers and     sellers of foreign currencies

[6] Class 22

International Finance Part 2

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Describe the structure and key features of the global foreign exchange (FX) market

Explain the concept of transaction exposure and identify situations in which     importers and exporters face exchange rate risk on foreign-currency payables and     receivables

Calculate spot, forward, and cross exchange rates, and compute the CAD cost or     inflow of foreign-currency transactions under different hedging strategies

Compare and contrast forward contracts, futures, and currency options as     hedging tools, including their mechanics, payoffs, advantages, and limitations for     MNCs

The Foreign Exchange Market

The foreign exchange (forex) market is an electronically linked network of banks,     foreign exchange brokers, and dealers whose main function is to match buyers and     sellers of foreign currencies
Produce EXACTLY 4 options. EXACTLY ONE option has role "correct".
Every option has a per-option explanation. Assign each non-correct option one role from:
  - "common-misconception": a plausible error a student commonly makes
  - "partially-correct": right idea, incomplete or misapplied
  - "clearly-wrong": obviously incorrect to a prepared student
AT LEAST ONE option MUST be "common-misconception". The practice loop offers its retry only when a student picks one, so a question without it silently loses that behaviour. A question is rejected and regenerated without one.
DISTRACTORS ARE WRONG METHODS, NOT WRONG ARITHMETIC. A distractor must be the
number a student actually reaches by reasoning incorrectly — discounting the
wrong number of periods, compounding forward instead of back, dropping a term,
using the wrong rate. Do NOT take the correct formula and mutate an operator:
  good:  PAYMENT*(1+r)^n        compounded forward instead of discounting
  good:  PAYMENT/(1+r)^1        discounted one period regardless of the term
  bad:   SALES*(MULTIPLE^2)     squaring a multiple is not a mistake anyone makes
  bad:   SALES+MULTIPLE         swapping x for + is arithmetic noise
  bad:   (MULTIPLE+1)*SALES     an arbitrary tweak, not a misconception
If you cannot name the student who would make the mistake, it is not a
distractor — find a real one from the course material.
FORMATTING. The stem, every option, and every explanation are rendered as
markdown with KaTeX math. Write formulas as LaTeX, not as flat ASCII:
  - inline math between single dollars: $PV = \frac{C}{(1+r)^n}$
  - display math between double dollars for a full worked line:
      $$PV = \sum_{t=1}^{n} \frac{C_t}{(1+r)^t}$$
Two rules the renderer imposes, and both fail SILENTLY when broken — the
math renders as literal source text rather than erroring:
  1. Never use \( \) or \[ \]. The markdown pass runs first and strips
     their backslashes, so KaTeX never sees a delimiter.
  2. A math span must never contain a dollar followed by digits and then a
     space: that reads as a currency amount, not as math. In practice, start
     math with a symbol or a command — never a digit — and keep currency
     symbols OUTSIDE the math:
       good:  A payment of $500 grows to $P \times 1.05$.
       good:  $\text{FV} = 500 \times 1.05$
       bad:   $500 \times 1.05$      (opens with a digit)
       bad:   $\$500 \times 1.05$   (escaped amount, then a space)
     The same applies right after $$: write $$\text{PV} = \sum ...$$, never
     $$500 \times ...$$
  3. Never write a slot or derived-value NAME inside \text{}. Those names
     contain underscores, and escaping an underscore inside math is where
     stray characters creep in and break the whole span. Use a short symbol
     and let the placeholder carry the number:
       good:  $r = \frac{R}{100}$ where the rate is {{RATE_PCT}}%
       bad:   $r = \frac{\text{RATE_PCT}}{100}$
Prose stays prose; only the formulas are LaTeX.
Show the working in the EXPLANATION — that is what that field is for, so a
display line there beats describing the arithmetic in words. Do NOT put the
working in an option: an option states an ANSWER, never the formula that
produces it. See THE OPTION CONTRACT below.
NUMERICAL QUESTIONS — MANDATORY.
If answering requires ANY computation, set "numericKind": "numeric".
NEVER write a computed number anywhere — not in the stem, an option, or an explanation.
State the inputs as variable slots and every displayed value as a formula; a
deterministic evaluator computes them at serve time, and each student sees different
numbers.
  - "paramSlots": the inputs, e.g.
      [ { "name": "PAYMENT", "min": 100, "max": 900, "step": 100 },
        { "name": "RATE_PCT", "min": 4, "max": 12, "step": 2 } ]
  - "derivedValues": the correct answer AND every distractor, e.g.
      [ { "name": "PV", "formula": "PAYMENT/(1+RATE_PCT/100)^2" },
        { "name": "PV_COMPOUNDED", "formula": "PAYMENT*(1+RATE_PCT/100)^2",
          "errorModel": "compounded forward instead of discounting back" } ]
    These formulas are EVALUATOR syntax and are NEVER LaTeX: they are parsed
    and computed, not displayed. Keep writing PAYMENT/(1+RATE_PCT/100)^2 —
    a \frac{}{} here fails to parse and the question is rejected. LaTeX
    belongs only in the stem, option and explanation TEXT.
  - BUILD THE ANSWER IN STEPS. "derivedValues" are evaluated IN ORDER, and a
    later formula may use any earlier one BY NAME. Prefer several short named
    steps to one long expression:
      good:
        DEBT_VALUE   = PV(YTM_PCT/100, 16, FACE_DEBT*COUPON_PCT/100) + PV(YTM_PCT/100, 16, FACE_DEBT)
        EQUITY_VALUE = SHARES*PRICE
        V            = DEBT_VALUE + EQUITY_VALUE
        COST_EQUITY  = RF_PCT/100 + BETA*MRP_PCT/100
        WACC         = (EQUITY_VALUE/V)*COST_EQUITY + (DEBT_VALUE/V)*(YTM_PCT/100)
      bad:  all of that inlined as one 400-character expression with the two
            PV(...) calls repeated six times.
    A step that no option displays is perfectly allowed and is exempt from
    the option contract below — name it and reuse it.
    This is not a style preference. Long nested expressions are exactly where
    real generations drop a parenthesis; the parser then reports "trailing
    input after formula" and the question is rejected outright. If a formula
    runs past roughly 100 characters, or nests more than three deep, SPLIT IT.
    If you cannot express a quantity inline, give it its OWN step. Never fill
    the gap with a stand-in: (PV(1,1,1) - PV(1,1,1)) and a hardcoded 2.2e6
    were both produced in real runs — the first is identically zero, so it
    divided the answer by zero on every draw.
    Every distractor MUST carry an "errorModel" naming the specific mistake it
    represents, and its formula must genuinely implement that mistake.
    Name the MISTAKE, never the role. "common-misconception" is a role, not an
    errorModel — a real generation returned exactly that on every distractor
    and the question was regenerated. Write "compounded forward instead of
    discounting back" or "used the coupon rate in place of the yield".
    The CORRECT value MUST NOT carry an "errorModel" — it represents no mistake.
    Omit the field entirely rather than describing the right answer in it.
  - THE OPTION CONTRACT — read this twice. It is checked FIRST, before any
    formula is evaluated, so breaking it rejects the question before the
    collision check below is even reached. Three consecutive live
    generations died here.
    An option text IS a value. Not a sentence containing a value — the whole
    option is the quantity, plus at most a currency symbol, unit or percent
    sign, and it carries EXACTLY ONE {{NAME}} from "derivedValues":
      good:  "${{PV}}"
      good:  "{{IRR_PCT}}%"
      bad:   "${{PAYMENT}}"                  an INPUT slot is not an answer
      bad:   "-{{CF0}} + {{CF1}}/(1+r)"      the formula, not the answer
      bad:   "Accept the project"            no computed value at all
      bad:   "Accept the project. {{NPV}}"   a sentence with a value stapled
             on. This is the worst of the four: it passes the automatic
             check and reaches a student as a decision followed by an
             unrelated number. If you find yourself appending a value to a
             sentence to satisfy this rule, the question is CONCEPTUAL —
             go and set "numericKind": "conceptual" instead.
    Input-slot placeholders may also appear in an option, but they do not
    count toward this rule and can never stand in for the derived value.
    Two options must never name the same derived value.
    The STEM may use slot placeholders freely — this rule is about options.
Formula syntax: + - * / ^ ( ), variable names, and these functions only:
  PV(rate, periods, amount), FV(rate, periods, amount), PMT(rate, periods, principal),
  NPV(rate, cf1, cf2, ...), IRR(cf0, cf1, ...), ln, exp, sqrt, abs, min, max,
  round(value, decimals), N(x) for the standard normal CDF, and
  SUM(index, from, to, body) for series such as duration or amortization.
These functions are shorthand, not a limit: any closed-form finance formula can be
written with arithmetic alone (CAPM is RF + BETA*MRP; Gordon growth is D1/(R-G)).
Transcribe the formula the course material itself uses.
That list is the WHOLE grammar. There are no comparisons (> < >= <= == !=),
no conditionals, no ternary ?:, no booleans, and no if(). A formula like
"max(1, min(2, (PI_X>0?1:0) + (PI_Y>0?1:0)))" does not parse and the question
is rejected. If you are reaching for a comparison, you are encoding a DECISION
as a number — that question is "conceptual", not "numeric".
Two rules the automatic verifier enforces — a question breaking either is rejected:
  1. Ranges must never let a formula break. A rate a formula divides by must not
     include 0, and no range may drive a value beyond about 1e12.
  2. Option values must differ for EVERY combination of values in range.
THE PAIRWISE COLLISION CHECK — do this before you answer, it is the single most
common reason a question is rejected. Take every PAIR of option formulas, set them
equal, and solve. If any solution falls inside the declared ranges, the two options
show the same number on that draw and the question is unanswerable. Examples of
pairs that look fine and are not:
  - "A" and "B" (two bare slot values) are equal wherever their ranges OVERLAP.
  - "A - B" and "B" are equal when A = 2*B.
  - "A - B" and "B - A" are equal when A = B (both 0).
  - "A * (1+r)^n" and "A" are equal when n can draw 0.
THE FIX, and prefer this one: give the slots DISJOINT, WELL-SEPARATED ranges. If A
is always far larger than B, then A never equals B, A-B never equals B, and A+B
never equals either. For a firm with cash in and cash out, use something like
CASH_IN 3000..5000 and CASH_OUT 200..1000 rather than two ranges that both span
200..5000. Separated ranges are also more realistic than overlapping ones.
If separation is impossible, change the mistake instead: use a wrong rate, a
dropped term, or a wrong operand rather than a formula that can coincide.
Two collision traps seen in real generations, both from distractors that are
RATIOS or PERCENTAGES rather than amounts — the sizes cancel, so widening the
ranges does not separate them:
  - a distractor that differs only by a factor which some draw makes 1;
  - two "wrong rate" distractors whose rates coincide where their ranges meet.
For a ratio-valued answer, separate it by the STRUCTURE of the mistake (a
dropped term, a wrong denominator), not by the input ranges.
If answering requires NO computation, set "numericKind": "conceptual" and omit
paramSlots and derivedValues entirely.
ALSO conceptual, even though arithmetic is involved: a question whose OPTIONS
are decisions or statements rather than values — "Accept the project" /
"Reject the project", "The NPV rule and the IRR rule agree", and so on. Those
options cannot satisfy the option contract, because there is no single
computed value for them to display. Pick one shape and commit to it:
  - want the decision tested? -> "conceptual", no slots, no derivedValues;
  - want the arithmetic tested? -> "numeric", and every option is a VALUE.
Do not try to have both in one question.
TWO WORKED EXAMPLES — study the SHAPE, never reuse the subject.

Example of a NUMERIC question (answering requires arithmetic, so every option
is a computed value and the inputs are slots):
{ "numericKind": "numeric",
  "stem": "A bond pays {{COUPON}} annually for {{YEARS}} years. At a yield of {{YIELD_PCT}}%, what is its price?",
  "paramSlots": [ { "name": "COUPON", "min": 40, "max": 90, "step": 10 } ],
  "derivedValues": [ { "name": "PRICE", "formula": "COUPON*(1-(1+YIELD_PCT/100)^(-YEARS))/(YIELD_PCT/100)" } ],
  "options": [ { "key": "A", "text": "{{PRICE}}", "role": "correct" } ] }

Example of a CONCEPTUAL question (answering requires judgement, so the options
are statements and there are no slots at all):
{ "numericKind": "conceptual",
  "stem": "A country raises its policy rate while inflation expectations stay unchanged. Why would its currency tend to appreciate?",
  "options": [
    { "key": "A", "text": "Higher real returns attract foreign capital, raising demand for the currency", "role": "correct" },
    { "key": "B", "text": "Higher rates increase exports, and export receipts are paid in the domestic currency", "role": "common-misconception" } ] }

Note what makes the second one conceptual: it CONTAINS no computation, even
though a rate is mentioned. Numbers a question states are facts; only numbers a
student must CALCULATE make it numeric.

Respond with ONLY this JSON shape:
{ "stem": string, "difficulty": "easy"|"medium"|"hard",
  "numericKind": "numeric"|"conceptual",
  "paramSlots": [ { "name": string, "min": number, "max": number, "step": number } ],
  "derivedValues": [ { "name": string, "formula": string, "errorModel": string } ],
  "options": [ { "key": string, "text": string, "role": string, "explanation": string } ] }
Use option keys "A","B","C","D".
```

</details>

### Questions generated by variant B

#### B1

- **numericKind:** `conceptual`  **difficulty:** `medium`  **slots:** 0  **derived:** 0

**Stem.** Canada and Country X initially have similar political and economic risk. Then Country X experiences persistently higher inflation than Canada, while Canada's central bank adopts a policy that makes Canadian financial assets relatively more attractive. Based on supply and demand for currencies, what is the most likely combined effect on the equilibrium exchange rate and Canadian importers?

- **[A]** The CAD appreciates, and Canadian importers benefit because foreign goods become less costly in CAD  _<correct>_
  - _Higher relative inflation in Country X tends to weaken its currency relative to the CAD, while relatively more attractive Canadian financial assets increase demand for CAD. A stronger CAD benefits Canadian importers because foreign-currency purchases cost fewer Canadian dollars._
- **[B]** The CAD depreciates, and Canadian importers benefit because foreign goods become less costly in CAD  _<common-misconception>_
  - _The importer effect is reversed: a weaker CAD makes foreign goods more costly in CAD. The scenario's inflation and central-bank-policy effects also point toward greater demand for CAD, not depreciation._
- **[C]** The CAD appreciates, and Canadian importers are hurt because a stronger currency raises the CAD cost of foreign goods  _<common-misconception>_
  - _The exchange-rate direction is consistent with the scenario, but the business impact is not. The course material states that a strong CAD helps consumers and importers by lowering the CAD cost of foreign goods._
- **[D]** The CAD is unaffected because exchange rates respond only to current trade flows, not inflation or central-bank policy  _<clearly-wrong>_
  - _The course material explicitly identifies relative inflation and central-bank policy as macro factors influencing equilibrium exchange rates, alongside political and economic risk and expectations._

> **Reviewer (`high` effort): `pass`** — The question accurately tests how relative inflation and the relative attractiveness of financial assets affect currency demand and the CAD equilibrium exchange rate, then connects appreciation to Canadian import costs. Both drivers point consistently toward CAD appreciation, and the importer implication is correct. The distractors isolate plausible errors about the direction of currency effects and the consequences for importers, while the clearly wrong option denies relevant macro drivers. The stem is clear and the multi-step reasoning is appropriate for medium difficulty. No numerical formulas require review.

#### B2

- **numericKind:** `conceptual`  **difficulty:** `medium`  **slots:** 0  **derived:** 0

**Stem.** Canada and Country X have similar political and economic risk. However, inflation is expected to remain higher in Country X, while Canada's central bank adopts a policy that makes Canadian assets relatively more attractive. Which outcome best describes the likely macroeconomic pressure on the Canadian dollar (CAD)?

- **[A]** The CAD tends to appreciate because lower relative inflation supports its purchasing power and the relatively attractive Canadian policy increases demand for CAD.  _<correct>_
  - _Relative inflation and central bank policy both affect currency supply and demand. Higher inflation in Country X tends to weaken its currency relative to the CAD, while relatively attractive Canadian policy can increase demand for CAD. Similar political and economic risk does not offset these stated advantages._
- **[B]** The CAD tends to depreciate because higher inflation in Country X makes Canadian exports more expensive.  _<common-misconception>_
  - _This reverses the relative-inflation implication. Higher inflation in Country X does not, by itself, make Canadian goods more expensive relative to Country X goods; it tends to reduce the relative value of Country X's currency._
- **[C]** The CAD must remain unchanged because political and economic risk is the only macro factor that influences equilibrium exchange rates.  _<clearly-wrong>_
  - _The course material identifies relative inflation and central bank policy, in addition to political and economic risk, as macro factors influencing equilibrium exchange rates._
- **[D]** The CAD tends to appreciate only because Canada has lower inflation; central bank policy cannot influence exchange rates.  _<partially-correct>_
  - _Lower relative inflation supports the CAD, but the conclusion is incomplete because central bank policy is also identified as a driver of exchange rates and can affect currency demand through expectations and relative attractiveness._

> **Reviewer (`high` effort): `pass`** — The question is factually sound, clearly aligned with macroeconomic exchange-rate drivers, and requires integrating relative inflation with the stated policy-induced attractiveness of Canadian assets. The correct option appropriately predicts CAD appreciation, while the distractors represent plausible misunderstandings: reversing the inflation effect, treating risk as the only driver, and ignoring monetary policy. The medium difficulty is appropriate for this multi-factor conceptual judgment, and no numerical formula modelling is required.

#### B3

- **numericKind:** `conceptual`  **difficulty:** `medium`  **slots:** 0  **derived:** 0

**Stem.** Canada and Country X initially have similar political and economic risk. Then Country X experiences persistently higher inflation than Canada, while Canada's central bank adopts a policy that makes Canadian financial assets relatively more attractive. Based on supply and demand for currencies, which outcome is most likely for the Canadian dollar?

- **[A]** The Canadian dollar appreciates because relatively attractive Canadian assets increase demand for Canadian dollars, while lower relative inflation supports its purchasing power  _<correct>_
  - _Relative inflation and central bank policy both affect exchange-rate demand and expectations. Higher inflation in Country X makes Canada relatively more attractive, and relatively attractive Canadian financial assets can increase demand for Canadian dollars, supporting appreciation._
- **[B]** The Canadian dollar depreciates because higher Canadian financial returns necessarily make Canadian goods more expensive abroad  _<common-misconception>_
  - _This confuses the effect of central bank policy with an automatic loss of export competitiveness. The scenario indicates that relatively attractive Canadian assets increase demand for Canadian dollars; the exchange-rate effect is not determined by the claim that higher returns necessarily make the currency depreciate._
- **[C]** The Canadian dollar remains unchanged because exchange rates are determined only by current trade flows, not inflation or expectations  _<clearly-wrong>_
  - _The course material states that exchange rates are driven by fundamentals and expectations, including relative inflation and central bank policy. Therefore, it is incorrect to exclude these macro factors._
- **[D]** The Canadian dollar appreciates only because Country X's inflation increases Canadian exports, regardless of central bank policy or investor demand  _<partially-correct>_
  - _The conclusion of appreciation is consistent with the scenario, but the reasoning is incomplete and misapplied. The material emphasizes supply and demand, expectations, relative inflation, and central bank policy; appreciation cannot be attributed solely to an assumed export effect._

> **Reviewer (`high` effort): `pass`** — The question is factually accurate, clearly aligned with analyzing inflation and monetary-policy effects on currency demand, and requires integrating two macro drivers rather than performing a simple substitution. The correct answer appropriately links higher relative inflation in Country X and greater attractiveness of Canadian assets to increased demand for CAD and appreciation. The distractors represent plausible misconceptions or incomplete reasoning, while remaining distinguishable from the correct answer. No numerical formulas or derived values are present, so formula modelling is not applicable.

---

## Variant C — Branch — conceptual body, with a conceptual exemplar

Numeric block replaced. Shares the same preamble, option roles and formatting rules as A.

Prompt: **11471 chars**, ~2868 tokens.

<details>
<summary>Full prompt as sent (click to expand)</summary>

```text
You are an expert finance instructor writing ONE multiple-choice practice question
for the learning objective: "Analyze macro drivers of exchange rates".
Target difficulty: medium.
Medium means the student must choose or connect concepts, interpret a scenario, or complete more than one reasoning step; a direct formula substitution is too easy.
Additional instruction from the instructor: Create a concise concept check that distinguishes genuine understanding from memorizing a definition.
Ground the question ONLY in the course material below. Do not introduce facts not supported by it.
Course material:
[1] Class 21

International Finance

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Define key concepts in international finance such as multinational corporation     (MNC), exchange rate, currency appreciation/depreciation, and foreign exchange     risk

Calculate changes in exchange rates and classify whether a currency has     appreciated or depreciated, using real-world FX data

Analyze how macro factors, such as relative inflation, political and economic risk,     and central bank policy, influence equilibrium exchange rates

Evaluate the impact of a strong or weak currency on different corporations     (exporters or importers)

Prime Minister Mark Carney’s visit to South Africa for the G20, which will include a meeting with the country’s president, comes as Canada prioritizes boosting trade with other continents and plans to scale back foreign aid.

Why Study International Finance?

Globalized Business: Most firms and markets operate across borders

[2] Class 21

International Finance

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Define key concepts in international finance such as multinational corporation     (MNC), exchange rate, currency appreciation/depreciation, and foreign exchange     risk

Calculate changes in exchange rates and classify whether a currency has     appreciated or depreciated, using real-world FX data

Analyze how macro factors, such as relative inflation, political and economic risk,     and central bank policy, influence equilibrium exchange rates

Evaluate the impact of a strong or weak currency on different corporations     (exporters or importers)

Prime Minister Mark Carney’s visit to South Africa for the G20, which will include a meeting with the country’s president, comes as Canada prioritizes boosting trade with other continents and plans to scale back foreign aid.

Why Study International Finance?

Globalized Business: Most firms and markets operate across borders

[3] The exchange rate is just a price—of one currency in terms of another—but it     creates real business risk

Exchange rates are set by supply and demand, driven by fundamentals and     expectations

Understanding base vs reference currency, direct vs indirect quotes, and how     appreciation/depreciation work is essential because FX movements directly     affect firms’ CAD revenues, costs, and values.

There are winners and losers from currency movements, and that’s what FX risk     management is about. A strong CAD helps consumers and importers but hurts     exporters; a weak CAD has the opposite pattern.

Thank you

[4] The exchange rate is just a price—of one currency in terms of another—but it     creates real business risk

Exchange rates are set by supply and demand, driven by fundamentals and     expectations

Understanding base vs reference currency, direct vs indirect quotes, and how     appreciation/depreciation work is essential because FX movements directly     affect firms’ CAD revenues, costs, and values.

There are winners and losers from currency movements, and that’s what FX risk     management is about. A strong CAD helps consumers and importers but hurts     exporters; a weak CAD has the opposite pattern.

Thank you

[5] Class 22

International Finance Part 2

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Describe the structure and key features of the global foreign exchange (FX) market

Explain the concept of transaction exposure and identify situations in which     importers and exporters face exchange rate risk on foreign-currency payables and     receivables

Calculate spot, forward, and cross exchange rates, and compute the CAD cost or     inflow of foreign-currency transactions under different hedging strategies

Compare and contrast forward contracts, futures, and currency options as     hedging tools, including their mechanics, payoffs, advantages, and limitations for     MNCs

The Foreign Exchange Market

The foreign exchange (forex) market is an electronically linked network of banks,     foreign exchange brokers, and dealers whose main function is to match buyers and     sellers of foreign currencies

[6] Class 22

International Finance Part 2

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objectives

Describe the structure and key features of the global foreign exchange (FX) market

Explain the concept of transaction exposure and identify situations in which     importers and exporters face exchange rate risk on foreign-currency payables and     receivables

Calculate spot, forward, and cross exchange rates, and compute the CAD cost or     inflow of foreign-currency transactions under different hedging strategies

Compare and contrast forward contracts, futures, and currency options as     hedging tools, including their mechanics, payoffs, advantages, and limitations for     MNCs

The Foreign Exchange Market

The foreign exchange (forex) market is an electronically linked network of banks,     foreign exchange brokers, and dealers whose main function is to match buyers and     sellers of foreign currencies
Produce EXACTLY 4 options. EXACTLY ONE option has role "correct".
Every option has a per-option explanation. Assign each non-correct option one role from:
  - "common-misconception": a plausible error a student commonly makes
  - "partially-correct": right idea, incomplete or misapplied
  - "clearly-wrong": obviously incorrect to a prepared student
AT LEAST ONE option MUST be "common-misconception". The practice loop offers its retry only when a student picks one, so a question without it silently loses that behaviour. A question is rejected and regenerated without one.
DISTRACTORS ARE WRONG METHODS, NOT WRONG ARITHMETIC. A distractor must be the
number a student actually reaches by reasoning incorrectly — discounting the
wrong number of periods, compounding forward instead of back, dropping a term,
using the wrong rate. Do NOT take the correct formula and mutate an operator:
  good:  PAYMENT*(1+r)^n        compounded forward instead of discounting
  good:  PAYMENT/(1+r)^1        discounted one period regardless of the term
  bad:   SALES*(MULTIPLE^2)     squaring a multiple is not a mistake anyone makes
  bad:   SALES+MULTIPLE         swapping x for + is arithmetic noise
  bad:   (MULTIPLE+1)*SALES     an arbitrary tweak, not a misconception
If you cannot name the student who would make the mistake, it is not a
distractor — find a real one from the course material.
FORMATTING. The stem, every option, and every explanation are rendered as
markdown with KaTeX math. Write formulas as LaTeX, not as flat ASCII:
  - inline math between single dollars: $PV = \frac{C}{(1+r)^n}$
  - display math between double dollars for a full worked line:
      $$PV = \sum_{t=1}^{n} \frac{C_t}{(1+r)^t}$$
Two rules the renderer imposes, and both fail SILENTLY when broken — the
math renders as literal source text rather than erroring:
  1. Never use \( \) or \[ \]. The markdown pass runs first and strips
     their backslashes, so KaTeX never sees a delimiter.
  2. A math span must never contain a dollar followed by digits and then a
     space: that reads as a currency amount, not as math. In practice, start
     math with a symbol or a command — never a digit — and keep currency
     symbols OUTSIDE the math:
       good:  A payment of $500 grows to $P \times 1.05$.
       good:  $\text{FV} = 500 \times 1.05$
       bad:   $500 \times 1.05$      (opens with a digit)
       bad:   $\$500 \times 1.05$   (escaped amount, then a space)
     The same applies right after $$: write $$\text{PV} = \sum ...$$, never
     $$500 \times ...$$
  3. Never write a slot or derived-value NAME inside \text{}. Those names
     contain underscores, and escaping an underscore inside math is where
     stray characters creep in and break the whole span. Use a short symbol
     and let the placeholder carry the number:
       good:  $r = \frac{R}{100}$ where the rate is {{RATE_PCT}}%
       bad:   $r = \frac{\text{RATE_PCT}}{100}$
Prose stays prose; only the formulas are LaTeX.
Show the working in the EXPLANATION — that is what that field is for, so a
display line there beats describing the arithmetic in words. Do NOT put the
working in an option: an option states an ANSWER, never the formula that
produces it. See THE OPTION CONTRACT below.
CONCEPTUAL QUESTION — MANDATORY.
Set "numericKind": "conceptual" and omit "paramSlots" and "derivedValues"
entirely. This question is judged on reasoning, not arithmetic.

Numbers ARE allowed in the stem when the question STATES them as facts — "a 15%
hurdle rate", "since 2008", "a portfolio of 30 stocks". What makes a question
conceptual is that answering requires no calculation. Never ask the student to
compute a value, and never make an option a number they must arrive at.

WHAT A CONCEPT CHECK MUST DO. Separate a student who understands the mechanism
from one who has memorised the definition. A question answerable by recalling a
sentence from the notes has failed, however hard it sounds. Prefer asking WHY
something follows, WHAT WOULD CHANGE if a condition were different, or WHICH
of two plausible explanations actually holds.

DISTRACTORS ARE BELIEFS, NOT WRONG SENTENCES. Each distractor must be a claim a
real student actually holds — a confusion of cause with effect, a rule applied
outside its conditions, a correlation mistaken for a mechanism. Worked:
  good:  "Higher rates raise exports, and exports are paid in the domestic
          currency" — a real causal muddle about the trade channel.
  good:  "The currency appreciates because inflation is now lower" — a true-ish
          statement that is not the mechanism the question asks about.
  bad:   "The currency appreciates because the central bank prints less money"
          — unrelated to the stem, nobody reasoning about this would say it.
  bad:   "Interest rates do not affect exchange rates" — a flat denial, not a
          misconception.
A distractor that is simply TRUE but does not answer the question is the most
common failure here: it makes the question a reading test, not a concept check.
If you cannot name the student who would choose it, and say what they were
thinking, it is not a distractor.

Every option's "explanation" states the reasoning that makes it right or names
the specific misconception that makes it wrong.

Respond with ONLY this JSON shape:
{ "stem": string, "difficulty": "easy"|"medium"|"hard",
  "numericKind": "numeric"|"conceptual",
  "paramSlots": [ { "name": string, "min": number, "max": number, "step": number } ],
  "derivedValues": [ { "name": string, "formula": string, "errorModel": string } ],
  "options": [ { "key": string, "text": string, "role": string, "explanation": string } ] }
Use option keys "A","B","C","D".
```

</details>

### Questions generated by variant C

#### C1

- **numericKind:** `conceptual`  **difficulty:** `medium`  **slots:** 0  **derived:** 0

**Stem.** A Canadian exporter and importer are both affected by the same macroeconomic development: Canadian inflation rises relative to inflation abroad, while political and economic risk and central bank policy are unchanged. Which explanation best predicts the likely exchange-rate effect and the firms' outcomes, based on the course framework?

- **[A]** The CAD is likely to weaken because higher relative inflation reduces the currency's attractiveness; this tends to hurt the Canadian importer but help the Canadian exporter.  _<correct>_
  - _Relative inflation is a macro fundamental affecting exchange-rate supply and demand. If the CAD weakens, foreign-currency purchases become more costly for the importer, while the exporter benefits from the course's stated pattern that a weak CAD helps exporters._
- **[B]** The CAD is likely to strengthen because higher Canadian inflation means Canadian prices and export revenues are rising; this helps both firms.  _<common-misconception>_
  - _This confuses higher domestic prices with greater currency value and overlooks the different effects of a strong currency. The course states that a strong CAD helps importers but hurts exporters, not both._
- **[C]** The CAD's direction cannot be analyzed because exchange rates are determined only by political and economic risk, not by relative inflation.  _<clearly-wrong>_
  - _The course explicitly identifies relative inflation, political and economic risk, and central bank policy as macro factors influencing equilibrium exchange rates._
- **[D]** The CAD is likely to weaken, but this should help the importer because foreign currencies would then require fewer Canadian dollars; the exporter would be harmed.  _<partially-correct>_
  - _The first part recognizes the likely weakening associated with higher relative inflation, but it reverses the business effects. A weak CAD makes foreign-currency costs more expensive for importers and has the opposite pattern for exporters._

> **Reviewer (`high` effort): `pass`** — The question accurately applies the framework: higher relative Canadian inflation is expected to weaken the CAD, which generally harms Canadian importers and benefits Canadian exporters. It directly tests the stated learning objective, and the distractors represent plausible misconceptions, including reversing the firm effects and ignoring relative inflation. The stem is clear, uses appropriate qualification ('likely'), and requires linking the macro driver to both exchange-rate direction and business outcomes rather than performing a mere calculation. No formula-modelling issue applies because the question is conceptual.

#### C2

- **numericKind:** `conceptual`  **difficulty:** `medium`  **slots:** 0  **derived:** 0

**Stem.** A Canadian firm exports goods and receives payment in foreign currency. At the same time, Canada experiences lower relative inflation, reduced political and economic risk, and a central bank policy that makes Canadian assets more attractive. Which explanation best connects these macro developments to the firm's exchange-rate exposure?

- **[A]** The Canadian dollar is likely to strengthen because the developments increase demand for Canadian currency; this can reduce the firm's CAD revenue when its foreign-currency receipts are converted, illustrating why a strong CAD tends to hurt exporters.  _<correct>_
  - _Lower relative inflation, lower political and economic risk, and supportive central bank policy can improve expectations and increase demand for Canadian currency. The resulting appreciation makes each unit of foreign currency worth fewer Canadian dollars, which can reduce the CAD value of an exporter's foreign-currency receipts._
- **[B]** The Canadian dollar is likely to strengthen, but the exporter benefits because a stronger domestic currency increases the Canadian-dollar value of foreign-currency receipts.  _<common-misconception>_
  - _This reverses the conversion effect. When the Canadian dollar strengthens, one unit of foreign currency converts into fewer Canadian dollars, so exporters generally face lower CAD revenue from unchanged foreign-currency receipts._
- **[C]** The Canadian dollar is likely to weaken because lower inflation and lower risk reduce the foreign currency needed to purchase Canadian exports.  _<partially-correct>_
  - _The scenario does point toward a stronger Canadian dollar, not a weaker one. The response recognizes that macro conditions affect currency demand but misapplies the direction: more attractive Canadian assets and improved fundamentals tend to increase demand for Canadian currency._
- **[D]** The Canadian dollar's direction cannot be related to these factors because exchange rates are determined only by the foreign exchange market's transactions, not by fundamentals or expectations.  _<clearly-wrong>_
  - _The foreign exchange market matches buyers and sellers, but the course material states that supply and demand are driven by fundamentals and expectations. Relative inflation, political and economic risk, and central bank policy are therefore relevant macro drivers._

> **Reviewer (`high` effort): `pass`** — The question accurately links lower relative inflation, reduced risk, and more attractive Canadian assets to increased demand for the Canadian dollar and correctly explains the resulting conversion exposure for a Canadian exporter receiving foreign currency. The distractors represent plausible errors, especially reversing the conversion effect and misunderstanding how fundamentals influence exchange rates. The stem is clear, aligned with the macro-drivers LO, and requires a reasonable medium-level synthesis rather than simple substitution. As a conceptual question, there are no formula-modelling concerns.

#### C3

- **numericKind:** `conceptual`  **difficulty:** `medium`  **slots:** 0  **derived:** 0

**Stem.** Canada and Country X initially have similar political and economic risk. Country X then experiences persistently higher inflation than Canada, while expectations about political and economic risk remain unchanged. Which explanation best describes why the Canadian dollar would tend to appreciate relative to Country X's currency?

- **[A]** Canadian goods become relatively more attractive because Canada's lower inflation improves its competitiveness, increasing demand for Canadian dollars.  _<correct>_
  - _Relative inflation is a macro driver of exchange rates. With lower inflation than Country X, Canada’s goods become relatively more attractive, which can increase demand for Canadian dollars and support an appreciation, assuming other relevant conditions are unchanged._
- **[B]** The Canadian dollar appreciates because higher inflation in Country X directly increases the purchasing power of Canadian consumers.  _<common-misconception>_
  - _This confuses the effect on Canadian consumers with the exchange-rate mechanism. Higher inflation in Country X does not directly increase Canadian purchasing power; the relevant channel is the relative attractiveness of goods and the resulting currency demand._
- **[C]** The Canadian dollar appreciates because Country X’s higher inflation automatically means its central bank must adopt a policy that raises demand for Canadian dollars.  _<partially-correct>_
  - _Central bank policy can influence exchange rates, but the scenario does not state that Country X’s central bank takes a particular action. The supported explanation is based on relative inflation and currency demand, not an automatic policy response._
- **[D]** The Canadian dollar appreciates because inflation differences affect only domestic prices and cannot influence equilibrium exchange rates when political risk is unchanged.  _<clearly-wrong>_
  - _Relative inflation is explicitly a macro factor that can influence equilibrium exchange rates. Unchanged political and economic risk does not eliminate the effect of a change in relative inflation._

> **Reviewer (`high` effort): `pass`** — The question is factually sound, aligned with relative inflation as a macro driver of exchange rates, and clearly identifies the Canadian dollar’s likely appreciation through improved relative competitiveness and currency demand. The distractors represent plausible misconceptions about purchasing power, automatic central-bank responses, and the irrelevance of inflation. The conceptual reasoning is appropriate for a medium-difficulty question, and no numerical formula modelling is involved.

---

## Results and what they overturn

| Variant | Routing | Reviewer verdicts (`high` effort) | Prompt size |
|---|---|---|---|
| **A** baseline | 3/3 conceptual | **flag, reject, flag — 0/3 pass** | 3.1k tok |
| **B** few-shot | 3/3 conceptual | **pass, pass, pass — 3/3** | 3.7k tok |
| **C** branch | 3/3 conceptual | **pass, pass, pass — 3/3** | 2.1k tok |

Verdicts come from the pipeline's **own** `REVIEWER_PROMPT` at `high` effort, not
from whoever wrote the variants — the author of variant C should not also be
grading it.

### 1. The routing hypothesis is REFUTED

The plan asserted that 60% numeric machinery biases the model toward numeric.
**Every variant produced conceptual output, baseline included.** For an
objective this clearly non-computational, the LO name and the instructor's
prompt are signal enough; the numeric block does not drag the choice.

The corollary matters more: the earlier observation that *"every recent batch
came back numeric"* was probably **correct behaviour, not a defect.** The LOs in
play were "Estimate expected returns with CAPM", "Apply NPV and IRR", "Compute
WACC" — computational objectives, for which numeric is the right answer. We
diagnosed a routing problem from a sample where routing was working.

### 2. The measurable problem is QUALITY, and few-shot fixes it

The baseline did not fail at choosing conceptual; it failed at being a good
question. The reviewer's two worst verdicts name the same two faults:

> *"materially ambiguous: both Canada's higher relative inflation and Country
> X's more attractive central-bank policy could put downward pressure on CAD…
> the stem does not support a unique answer"* (reject)

> *"essentially a straightforward recall-and-combine task… each of the two
> stated changes independently points toward depreciation"* (flag)

Both B and C moved every question to `pass`, and the reviewer's language shifts
to *"requires integrating two macro drivers rather than…"* — the thing a concept
check is supposed to do.

### 3. Saurav's proposal wins on cost, and ties on outcome

**B and C are indistinguishable by the reviewer: 3/3 each.** But B is a far
smaller change — one appended block, no preset plumbing, no new request field,
no UI work, and the model keeps choosing the kind when the instructor's preset
does not fit the objective. C's advantages are real but secondary: it is 1.6k
tokens cheaper per call and gives conceptual guidance somewhere to live.

**On this evidence, few-shot is the better buy.** The branch was the more
expensive answer to a problem that turned out not to be the problem.

### 4. Nothing here fixes the gate, and nothing could

`detectNumeric` is a regex over the finished question, server-side. Four of six
realistic conceptual stems are still blocked by a year, a count, a ratio or a
bare rate — a prompt cannot change that. **The gate narrowing stands regardless
of which variant ships**, and it matters more now: these questions are exactly
the kind that mention "15%" in passing.

### 5. Diversity was not solved by anything

Most stems across all three variants still open with "Canada and Country X…".
B and C vary the framing slightly (C reaches for an exporter/importer pair), but
at n=3 that is noise. **Batch diversity remains an open problem**, and it is a
temperature/sampling question rather than a prompt-wording one.

The predicted anchoring risk did **not** appear: neither B nor C reused the
exemplar's policy-rate scenario, so demonstrating shape did not collapse subject
variety. That was a real worry and it did not survive contact with evidence.

## Caveats — how far this generalises

- **n = 3 per variant, one LO, one run.** Enough to separate 0/3 from 3/3;
  not enough to separate B from C, which is precisely the comparison left open.
- **One objective, and a strongly conceptual one.** The variants were never
  tested on a computational LO, so B's effect on NUMERIC questions is unmeasured
  — and B changes the prompt for those too, which C would not.
- **The judge shares a model family with the generator**, so it may reward
  familiar phrasing. The verdicts are consistent with a human reading, but they
  are not independent.
- Grounding chunks were retrieved once and reused, so retrieval variance is
  excluded by design — real runs will have more variance than this.

## What to do next

1. **Ship the gate narrowing** — independent of all of the above, and required
   before conceptual questions can serve at all.
2. **Ship variant B's exemplars**, as the cheapest change with a measured
   improvement.
3. **Before trusting B on numeric questions, re-run this against a
   computational LO** (CAPM or WACC). B appends to the shared prompt, so it can
   regress numeric output — a risk the branch would not carry.

---

# Experiment 2 — does the few-shot block regress NUMERIC questions?

Variant B appends to the shared prompt, so it changes computational questions too. This is the regression risk in shipping B, and the one the branch would not have carried. Judged by `verifyGeneratedNumerics` — the actual servability gate — as well as the reviewer.

- **LO:** Estimate expected returns with CAPM (`6a7e3bd4ae7ebf69b347c33b`)
- **Instructor prompt:** "Create a calculation question that requires students to select and apply the correct finance formula, showing enough information for one unambiguous answer."
- **Model:** `gpt-5.6-luna`, `reasoning_effort: none`, `temperature: 0.7`; 3 per variant.
- **Grounding:** 6 chunks, retrieved once and shared across variants.

## A2 — Baseline on a computational LO

Prompt: **18008 chars**, ~4502 tokens.

<details>
<summary>Full prompt as sent</summary>

```text
You are an expert finance instructor writing ONE multiple-choice practice question
for the learning objective: "Estimate expected returns with CAPM".
Target difficulty: medium.
Medium means the student must choose or connect concepts, interpret a scenario, or complete more than one reasoning step; a direct formula substitution is too easy.
Additional instruction from the instructor: Create a calculation question that requires students to select and apply the correct finance formula, showing enough information for one unambiguous answer.
Ground the question ONLY in the course material below. Do not introduce facts not supported by it.
Course material:
[1] Class 16

CAPM and Mispricing

 COMM 298 2025W1: Introduction to Finance Jose Pizarro

Objectives

Understand the concept of alpha within the CAPM framework and explain what it     indicates about a stock’s pricing relative to the Security Market Line

Calculate the expected return of a stock using the CAPM formula, and compare it     with the market-implied return to identify pricing discrepancies

Evaluate whether a stock is overvalued or undervalued by integrating CAPM-     based valuation with dividend discount models (e.g., GGM)

Assess the role of investor behavior and competition in maintaining market     efficiency, and discuss the practical limitations of exploiting alpha in real-world     markets

Estimating Expected Returns: Why Not Use Historical Averages?

We typically use historical data to estimate beta and apply the CAPM to     determine a security’s expected return

But why not just use a stock’s historical average return as its expected return?

[2] Based on the given information, calculate the risk-free rate the market expected return implied by the stock prices.

Problem 5: Solution

E[R_A] = (11.02-10)/10 = 10.20%

E[R_B] = (10.78-10)/10 = 7.80%

 Using CAPM:

 E[RA] = Rf + \betaA (E[Rm]-Rf) = x + 1.02 z = 10.20% E[RB] = Rf + \betaA (E[Rm]-Rf) = x + 0.70 z = 7.80%

 Solving for Rf Rf = (1.02/0.7*7.8%-10.20%)/(1.02/0.7-1) = 2.55%

Problem 6: NPV – WACC FCF

An investor is evaluating a potential project for Company X and has collected the     following information:

EBITDA Forecast: $100 per year for the next three years (Years 1–3).

Tax Rate: 25%.

Depreciation: $0 in all forecasted years.

Capital Expenditures (CAPEX): An upfront investment of $100 today (Year 0). The     asset can be sold for $30 at the end of Year 3.

Net Working Capital (NWC): Current NWC is $10 in Year 0 and increases by $10     today. No additional NWC is required afterward, and total NWC is fully recovered at     the end of the project.

[3] Class 24

Final Review

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Final Coverage

Class 11: Market Efficiency

Class 12: Computing Realized Returns

Class 13: Portfolio Risk & Return

Class 14: Efficient Portfolios and Complete Portfolios

Class 15: From Diversification to CAPM, Measuring and Pricing Risk

Class 16: CAPM and Mispricing

Class 17: Introduction to Corporate Finance and Capital Budgeting

Class 18: Capital Budgeting and the Cost of Capital

Class 19: The Unlevered Free Cash Flow

Class 20: Corporate Valuation

Class 21: International Finance Part 1

Class 23: Personal Finance

Final Structure

10 MCQ (2 marks each)

10 T/F (2 marks each)

20 Numerical Input Questions (3 marks each)

Each class will have the approximately 6-10 marks

Problem 1: Computing Returns

[4] But why not just use a stock’s historical average return as its expected return?

Estimating average returns from historical data is extremely challenging:

Individual stock returns are highly volatile

Many returns are close to zero, adding noise

The amount and quality of available data can vary significantly across firms

In contrast, regressions used to estimate beta are generally reliable, and:

Combining beta with the CAPM leads to more accurate expected return     estimates

In practice, 83% of CFOs at major firms rely on CAPM to estimate expected returns     (Graham, 2022)

In practice, stocks and portfolios often earn returns (realized) that differ from     CAPM predictions (expected)

Researchers have found that relying solely on the market portfolio as the only     source of systematic risk leads to systematic pricing errors

[5] 𝑤𝑤1 = 0.5, 𝑤𝑤2 = 0.25, 𝑤𝑤3 = 0.25

Market information:     𝐸𝐸 𝑅𝑅𝑀𝑀 = 7% and 𝑅𝑅𝑓𝑓 = 5%

What is the expected return of the portfolio?

Step 1: Calculate the portfolio’s beta 𝛽𝛽𝑃𝑃 = 𝑤𝑤1𝛽𝛽1 + 𝑤𝑤2𝛽𝛽2 + 𝑤𝑤3𝛽𝛽3 = 0.5 × (1) + 0.25 × (.5) + 0.25 × (2) = 1.125

Step 2: Calculate the expected return using CAPM     𝐸𝐸 𝑅𝑅𝑃𝑃 = 𝑅𝑅𝑓𝑓 + 𝛽𝛽𝑃𝑃 × 𝐸𝐸 𝑅𝑅𝑀𝑀 − 𝑅𝑅𝑓𝑓 = .05 + 1.125(.07 − .05) = 7.25%

Key Takeaways

Holding individual stocks typically exposes investors to greater volatility than     diversified portfolios, which help smooth out individual stock fluctuations,     without necessarily delivering higher returns

Higher risk, measured appropriately, is associated with higher expected returns,     especially in well-diversified portfolios

Only systematic risk, the risk that cannot be diversified away, earns a risk premium

Unsystematic risk can be eliminated through diversification and is not     compensated (does not ear a risk premium)

[6] Stock Price @ t = 0 Price @ t = 1 A $100 $110 B $40 $50

Problem 3: Solution

 𝑅𝑅𝑅𝑅 = 10% =

 110 − 100 100

 𝑅𝑅𝑅𝑅 = 25% =

 50 − 40 40

 𝑅𝑅𝑅𝑅 = 𝑤𝑤 ∗ 10% + 1 − 𝑤𝑤 ∗ 25% = 26.5%

 𝑤𝑤 =

 26.5% − 25% 10% − 25%

 = −10%

 −5000 = 𝑤𝑤 ∗ 𝑉𝑉

 𝑉𝑉 = −

 5000 −10%

 = 50,000

Problem 4: Efficient Portfolios and Complete Portfolios

 An investor wants a complete portfolio with an expected return of 8%. There are only two risky assets in the market, Stock S, with an expected return of 15% and a standard deviation of 30%, and Stock B, with an expected return of 5% and a standard deviation of 10%. The correlation between the two risky assets is 10%. The risk-free rate is 2%. The investor uses the risky portfolio P (50% allocated to Stock S and 50% allocated to Stock B) and the risk-free rate to build their complete portfolio.

Calculate the fraction of the investor's wealth allocated to the risky portfolio P in their complete portfolio.
Produce EXACTLY 4 options. EXACTLY ONE option has role "correct".
Every option has a per-option explanation. Assign each non-correct option one role from:
  - "common-misconception": a plausible error a student commonly makes
  - "partially-correct": right idea, incomplete or misapplied
  - "clearly-wrong": obviously incorrect to a prepared student
AT LEAST ONE option MUST be "common-misconception". The practice loop offers its retry only when a student picks one, so a question without it silently loses that behaviour. A question is rejected and regenerated without one.
DISTRACTORS ARE WRONG METHODS, NOT WRONG ARITHMETIC. A distractor must be the
number a student actually reaches by reasoning incorrectly — discounting the
wrong number of periods, compounding forward instead of back, dropping a term,
using the wrong rate. Do NOT take the correct formula and mutate an operator:
  good:  PAYMENT*(1+r)^n        compounded forward instead of discounting
  good:  PAYMENT/(1+r)^1        discounted one period regardless of the term
  bad:   SALES*(MULTIPLE^2)     squaring a multiple is not a mistake anyone makes
  bad:   SALES+MULTIPLE         swapping x for + is arithmetic noise
  bad:   (MULTIPLE+1)*SALES     an arbitrary tweak, not a misconception
If you cannot name the student who would make the mistake, it is not a
distractor — find a real one from the course material.
FORMATTING. The stem, every option, and every explanation are rendered as
markdown with KaTeX math. Write formulas as LaTeX, not as flat ASCII:
  - inline math between single dollars: $PV = \frac{C}{(1+r)^n}$
  - display math between double dollars for a full worked line:
      $$PV = \sum_{t=1}^{n} \frac{C_t}{(1+r)^t}$$
Two rules the renderer imposes, and both fail SILENTLY when broken — the
math renders as literal source text rather than erroring:
  1. Never use \( \) or \[ \]. The markdown pass runs first and strips
     their backslashes, so KaTeX never sees a delimiter.
  2. A math span must never contain a dollar followed by digits and then a
     space: that reads as a currency amount, not as math. In practice, start
     math with a symbol or a command — never a digit — and keep currency
     symbols OUTSIDE the math:
       good:  A payment of $500 grows to $P \times 1.05$.
       good:  $\text{FV} = 500 \times 1.05$
       bad:   $500 \times 1.05$      (opens with a digit)
       bad:   $\$500 \times 1.05$   (escaped amount, then a space)
     The same applies right after $$: write $$\text{PV} = \sum ...$$, never
     $$500 \times ...$$
  3. Never write a slot or derived-value NAME inside \text{}. Those names
     contain underscores, and escaping an underscore inside math is where
     stray characters creep in and break the whole span. Use a short symbol
     and let the placeholder carry the number:
       good:  $r = \frac{R}{100}$ where the rate is {{RATE_PCT}}%
       bad:   $r = \frac{\text{RATE_PCT}}{100}$
Prose stays prose; only the formulas are LaTeX.
Show the working in the EXPLANATION — that is what that field is for, so a
display line there beats describing the arithmetic in words. Do NOT put the
working in an option: an option states an ANSWER, never the formula that
produces it. See THE OPTION CONTRACT below.
NUMERICAL QUESTIONS — MANDATORY.
If answering requires ANY computation, set "numericKind": "numeric".
NEVER write a computed number anywhere — not in the stem, an option, or an explanation.
State the inputs as variable slots and every displayed value as a formula; a
deterministic evaluator computes them at serve time, and each student sees different
numbers.
  - "paramSlots": the inputs, e.g.
      [ { "name": "PAYMENT", "min": 100, "max": 900, "step": 100 },
        { "name": "RATE_PCT", "min": 4, "max": 12, "step": 2 } ]
  - "derivedValues": the correct answer AND every distractor, e.g.
      [ { "name": "PV", "formula": "PAYMENT/(1+RATE_PCT/100)^2" },
        { "name": "PV_COMPOUNDED", "formula": "PAYMENT*(1+RATE_PCT/100)^2",
          "errorModel": "compounded forward instead of discounting back" } ]
    These formulas are EVALUATOR syntax and are NEVER LaTeX: they are parsed
    and computed, not displayed. Keep writing PAYMENT/(1+RATE_PCT/100)^2 —
    a \frac{}{} here fails to parse and the question is rejected. LaTeX
    belongs only in the stem, option and explanation TEXT.
  - BUILD THE ANSWER IN STEPS. "derivedValues" are evaluated IN ORDER, and a
    later formula may use any earlier one BY NAME. Prefer several short named
    steps to one long expression:
      good:
        DEBT_VALUE   = PV(YTM_PCT/100, 16, FACE_DEBT*COUPON_PCT/100) + PV(YTM_PCT/100, 16, FACE_DEBT)
        EQUITY_VALUE = SHARES*PRICE
        V            = DEBT_VALUE + EQUITY_VALUE
        COST_EQUITY  = RF_PCT/100 + BETA*MRP_PCT/100
        WACC         = (EQUITY_VALUE/V)*COST_EQUITY + (DEBT_VALUE/V)*(YTM_PCT/100)
      bad:  all of that inlined as one 400-character expression with the two
            PV(...) calls repeated six times.
    A step that no option displays is perfectly allowed and is exempt from
    the option contract below — name it and reuse it.
    This is not a style preference. Long nested expressions are exactly where
    real generations drop a parenthesis; the parser then reports "trailing
    input after formula" and the question is rejected outright. If a formula
    runs past roughly 100 characters, or nests more than three deep, SPLIT IT.
    If you cannot express a quantity inline, give it its OWN step. Never fill
    the gap with a stand-in: (PV(1,1,1) - PV(1,1,1)) and a hardcoded 2.2e6
    were both produced in real runs — the first is identically zero, so it
    divided the answer by zero on every draw.
    Every distractor MUST carry an "errorModel" naming the specific mistake it
    represents, and its formula must genuinely implement that mistake.
    Name the MISTAKE, never the role. "common-misconception" is a role, not an
    errorModel — a real generation returned exactly that on every distractor
    and the question was regenerated. Write "compounded forward instead of
    discounting back" or "used the coupon rate in place of the yield".
    The CORRECT value MUST NOT carry an "errorModel" — it represents no mistake.
    Omit the field entirely rather than describing the right answer in it.
  - THE OPTION CONTRACT — read this twice. It is checked FIRST, before any
    formula is evaluated, so breaking it rejects the question before the
    collision check below is even reached. Three consecutive live
    generations died here.
    An option text IS a value. Not a sentence containing a value — the whole
    option is the quantity, plus at most a currency symbol, unit or percent
    sign, and it carries EXACTLY ONE {{NAME}} from "derivedValues":
      good:  "${{PV}}"
      good:  "{{IRR_PCT}}%"
      bad:   "${{PAYMENT}}"                  an INPUT slot is not an answer
      bad:   "-{{CF0}} + {{CF1}}/(1+r)"      the formula, not the answer
      bad:   "Accept the project"            no computed value at all
      bad:   "Accept the project. {{NPV}}"   a sentence with a value stapled
             on. This is the worst of the four: it passes the automatic
             check and reaches a student as a decision followed by an
             unrelated number. If you find yourself appending a value to a
             sentence to satisfy this rule, the question is CONCEPTUAL —
             go and set "numericKind": "conceptual" instead.
    Input-slot placeholders may also appear in an option, but they do not
    count toward this rule and can never stand in for the derived value.
    Two options must never name the same derived value.
    The STEM may use slot placeholders freely — this rule is about options.
Formula syntax: + - * / ^ ( ), variable names, and these functions only:
  PV(rate, periods, amount), FV(rate, periods, amount), PMT(rate, periods, principal),
  NPV(rate, cf1, cf2, ...), IRR(cf0, cf1, ...), ln, exp, sqrt, abs, min, max,
  round(value, decimals), N(x) for the standard normal CDF, and
  SUM(index, from, to, body) for series such as duration or amortization.
These functions are shorthand, not a limit: any closed-form finance formula can be
written with arithmetic alone (CAPM is RF + BETA*MRP; Gordon growth is D1/(R-G)).
Transcribe the formula the course material itself uses.
That list is the WHOLE grammar. There are no comparisons (> < >= <= == !=),
no conditionals, no ternary ?:, no booleans, and no if(). A formula like
"max(1, min(2, (PI_X>0?1:0) + (PI_Y>0?1:0)))" does not parse and the question
is rejected. If you are reaching for a comparison, you are encoding a DECISION
as a number — that question is "conceptual", not "numeric".
Two rules the automatic verifier enforces — a question breaking either is rejected:
  1. Ranges must never let a formula break. A rate a formula divides by must not
     include 0, and no range may drive a value beyond about 1e12.
  2. Option values must differ for EVERY combination of values in range.
THE PAIRWISE COLLISION CHECK — do this before you answer, it is the single most
common reason a question is rejected. Take every PAIR of option formulas, set them
equal, and solve. If any solution falls inside the declared ranges, the two options
show the same number on that draw and the question is unanswerable. Examples of
pairs that look fine and are not:
  - "A" and "B" (two bare slot values) are equal wherever their ranges OVERLAP.
  - "A - B" and "B" are equal when A = 2*B.
  - "A - B" and "B - A" are equal when A = B (both 0).
  - "A * (1+r)^n" and "A" are equal when n can draw 0.
THE FIX, and prefer this one: give the slots DISJOINT, WELL-SEPARATED ranges. If A
is always far larger than B, then A never equals B, A-B never equals B, and A+B
never equals either. For a firm with cash in and cash out, use something like
CASH_IN 3000..5000 and CASH_OUT 200..1000 rather than two ranges that both span
200..5000. Separated ranges are also more realistic than overlapping ones.
If separation is impossible, change the mistake instead: use a wrong rate, a
dropped term, or a wrong operand rather than a formula that can coincide.
Two collision traps seen in real generations, both from distractors that are
RATIOS or PERCENTAGES rather than amounts — the sizes cancel, so widening the
ranges does not separate them:
  - a distractor that differs only by a factor which some draw makes 1;
  - two "wrong rate" distractors whose rates coincide where their ranges meet.
For a ratio-valued answer, separate it by the STRUCTURE of the mistake (a
dropped term, a wrong denominator), not by the input ranges.
If answering requires NO computation, set "numericKind": "conceptual" and omit
paramSlots and derivedValues entirely.
ALSO conceptual, even though arithmetic is involved: a question whose OPTIONS
are decisions or statements rather than values — "Accept the project" /
"Reject the project", "The NPV rule and the IRR rule agree", and so on. Those
options cannot satisfy the option contract, because there is no single
computed value for them to display. Pick one shape and commit to it:
  - want the decision tested? -> "conceptual", no slots, no derivedValues;
  - want the arithmetic tested? -> "numeric", and every option is a VALUE.
Do not try to have both in one question.
Respond with ONLY this JSON shape:
{ "stem": string, "difficulty": "easy"|"medium"|"hard",
  "numericKind": "numeric"|"conceptual",
  "paramSlots": [ { "name": string, "min": number, "max": number, "step": number } ],
  "derivedValues": [ { "name": string, "formula": string, "errorModel": string } ],
  "options": [ { "key": string, "text": string, "role": string, "explanation": string } ] }
Use option keys "A","B","C","D".
```

</details>

### A21

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 3  **derived:** 4

**Stem.** A stock has a beta of {{BETA}}, the risk-free rate is {{RF_PCT}}%, and the market's expected return is {{RM_PCT}}%. Using the CAPM formula, what is the stock's expected return?

- **[A]** {{CAPM_RETURN}}%  _<correct>_
  - _The CAPM formula adds the risk-free rate to the stock's beta multiplied by the market risk premium: $$E[R] = R_f + \beta(E[R_m]-R_f)$$ Substituting the given inputs gives ${{CAPM_RETURN}}%$._
- **[B]** {{NO_BETA_RETURN}}%  _<common-misconception>_
  - _This result applies the market risk premium but ignores the stock's beta. The beta must scale the market risk premium: $$E[R] = R_f + \beta(E[R_m]-R_f)$$_
- **[C]** {{BETA_TIMES_MARKET_RETURN}}%  _<common-misconception>_
  - _This calculation multiplies beta by the market's total expected return rather than by the market risk premium. CAPM uses $E[R_m]-R_f$, not $E[R_m]$ alone: $$E[R] = R_f + \beta(E[R_m]-R_f)$$_
- **[D]** {{RISK_PREMIUM_ONLY}}%  _<partially-correct>_
  - _This captures the beta-adjusted market risk premium but omits the risk-free rate. CAPM requires both components: $$E[R] = R_f + \beta(E[R_m]-R_f)$$_

> **Numeric verification: FAILED — options CAPM_RETURN and NO_BETA_RETURN are identical (seed 1000006)**

> **Reviewer (`high`): `flag`** — The CAPM formula and all derivedValues are correctly modeled, and the distractors represent genuine errors (ignoring beta, using the market return instead of the market premium, or omitting the risk-free rate). However, the problem is only a one-step substitution, so it is miscalibrated as medium difficulty. Also, when BETA equals 1.0, option B produces the same value as the correct answer, creating ambiguity. Exclude beta = 1.0 or revise the distractor, and lower the difficulty rating.

### A22

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 3  **derived:** 4

**Stem.** A stock has beta $\beta = {{BETA}}$, the risk-free rate is ${{RF_PCT}}\%$, and the expected market return is ${{MARKET_PCT}}\%$. Using the CAPM formula, what is the stock's expected return?

- **[A]** {{EXPECTED_RETURN_PCT}}%  _<correct>_
  - _CAPM adds the risk-free rate to beta times the market risk premium: $$E[R] = R_f + \beta\left(E[R_m]-R_f\right)$$ Therefore, the expected return is ${{RF_PCT}}\% + {{BETA}}\times({{MARKET_PCT}}\%-{{RF_PCT}}\%) = {{EXPECTED_RETURN_PCT}}\%$._
- **[B]** {{WRONG_NO_RF_ADJUSTMENT_PCT}}%  _<common-misconception>_
  - _This result uses beta times the full expected market return. CAPM instead uses the market risk premium, $E[R_m]-R_f$, and then adds the risk-free rate: $$E[R] = R_f + \beta\left(E[R_m]-R_f\right)$$_
- **[C]** {{WRONG_MARKET_PREMIUM_ONLY_PCT}}%  _<partially-correct>_
  - _This calculation correctly applies beta to the market risk premium but stops before adding the risk-free rate. The complete CAPM formula is $$E[R] = R_f + \beta\left(E[R_m]-R_f\right)$$_
- **[D]** {{WRONG_BETA_INVERSE_PCT}}%  _<clearly-wrong>_
  - _CAPM multiplies the market risk premium by beta; it does not use $1/\beta$. The correct relationship is $$E[R] = R_f + \beta\left(E[R_m]-R_f\right)$$_

> **Numeric verification: FAILED — options EXPECTED_RETURN_PCT and WRONG_BETA_INVERSE_PCT are identical (seed 1000006)**

> **Reviewer (`high`): `flag`** — The CAPM formula and all derived formulas correctly model the stated calculation, and the distractors represent plausible errors: using the full market return, omitting the risk-free component, and inverting beta. The stem is clear and aligned with the LO. However, the question is only a one-step substitution and is therefore miscalibrated as medium difficulty under the criterion; it should be labeled easy or made more demanding. This is readily fixable, so the item is usable with revision.

### A23

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 3  **derived:** 4

**Stem.** A stock has a beta of {{BETA}}, the risk-free rate is {{RF_PCT}}%, and the expected market return is {{RM_PCT}}%. Using the CAPM formula, what is the stock's expected return? Recall that $E[R_i] = R_f + \beta_i(E[R_m]-R_f)$.

- **[A]** {{CAPM_RETURN}}%  _<correct>_
  - _The CAPM estimate combines the risk-free rate with the stock's beta multiplied by the market risk premium: $$E[R_i] = R_f + \beta_i(E[R_m]-R_f)$$ Therefore, the expected return is ${{CAPM_RETURN}}%$._
- **[B]** {{NO_RF_RETURN}}%  _<common-misconception>_
  - _This result omits the risk-free rate. CAPM requires adding $R_f$ after multiplying beta by the market risk premium: $$E[R_i] = R_f + \beta_i(E[R_m]-R_f)$$_
- **[C]** {{TOTAL_MARKET_RETURN}}%  _<partially-correct>_
  - _This includes the risk-free rate and beta, but it multiplies beta by the expected market return rather than by the market risk premium. The correct premium is $E[R_m]-R_f$._
- **[D]** {{UNLEVERED_MARKET_PREMIUM}}%  _<clearly-wrong>_
  - _This divides the market risk premium by beta. CAPM instead multiplies beta by the market risk premium: $$E[R_i] = R_f + \beta_i(E[R_m]-R_f)$$_

> **Numeric verification: FAILED — options CAPM_RETURN and UNLEVERED_MARKET_PREMIUM are identical (seed 1000006)**

> **Reviewer (`high`): `flag`** — The CAPM formula and all derived formulas correctly model the requested return and the stated distractor mistakes. The options are generally plausible, clear, and aligned with the LO. However, the question explicitly supplies the formula and requires only one direct substitution, so it is too easy for the stated medium difficulty. Relabel it as easy or add a reasoning step, such as asking the student to identify the market risk premium before calculating.

## B2 — Few-shot on a computational LO

Prompt: **19386 chars**, ~4847 tokens.

<details>
<summary>Full prompt as sent</summary>

```text
You are an expert finance instructor writing ONE multiple-choice practice question
for the learning objective: "Estimate expected returns with CAPM".
Target difficulty: medium.
Medium means the student must choose or connect concepts, interpret a scenario, or complete more than one reasoning step; a direct formula substitution is too easy.
Additional instruction from the instructor: Create a calculation question that requires students to select and apply the correct finance formula, showing enough information for one unambiguous answer.
Ground the question ONLY in the course material below. Do not introduce facts not supported by it.
Course material:
[1] Class 16

CAPM and Mispricing

 COMM 298 2025W1: Introduction to Finance Jose Pizarro

Objectives

Understand the concept of alpha within the CAPM framework and explain what it     indicates about a stock’s pricing relative to the Security Market Line

Calculate the expected return of a stock using the CAPM formula, and compare it     with the market-implied return to identify pricing discrepancies

Evaluate whether a stock is overvalued or undervalued by integrating CAPM-     based valuation with dividend discount models (e.g., GGM)

Assess the role of investor behavior and competition in maintaining market     efficiency, and discuss the practical limitations of exploiting alpha in real-world     markets

Estimating Expected Returns: Why Not Use Historical Averages?

We typically use historical data to estimate beta and apply the CAPM to     determine a security’s expected return

But why not just use a stock’s historical average return as its expected return?

[2] Based on the given information, calculate the risk-free rate the market expected return implied by the stock prices.

Problem 5: Solution

E[R_A] = (11.02-10)/10 = 10.20%

E[R_B] = (10.78-10)/10 = 7.80%

 Using CAPM:

 E[RA] = Rf + \betaA (E[Rm]-Rf) = x + 1.02 z = 10.20% E[RB] = Rf + \betaA (E[Rm]-Rf) = x + 0.70 z = 7.80%

 Solving for Rf Rf = (1.02/0.7*7.8%-10.20%)/(1.02/0.7-1) = 2.55%

Problem 6: NPV – WACC FCF

An investor is evaluating a potential project for Company X and has collected the     following information:

EBITDA Forecast: $100 per year for the next three years (Years 1–3).

Tax Rate: 25%.

Depreciation: $0 in all forecasted years.

Capital Expenditures (CAPEX): An upfront investment of $100 today (Year 0). The     asset can be sold for $30 at the end of Year 3.

Net Working Capital (NWC): Current NWC is $10 in Year 0 and increases by $10     today. No additional NWC is required afterward, and total NWC is fully recovered at     the end of the project.

[3] Class 24

Final Review

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Final Coverage

Class 11: Market Efficiency

Class 12: Computing Realized Returns

Class 13: Portfolio Risk & Return

Class 14: Efficient Portfolios and Complete Portfolios

Class 15: From Diversification to CAPM, Measuring and Pricing Risk

Class 16: CAPM and Mispricing

Class 17: Introduction to Corporate Finance and Capital Budgeting

Class 18: Capital Budgeting and the Cost of Capital

Class 19: The Unlevered Free Cash Flow

Class 20: Corporate Valuation

Class 21: International Finance Part 1

Class 23: Personal Finance

Final Structure

10 MCQ (2 marks each)

10 T/F (2 marks each)

20 Numerical Input Questions (3 marks each)

Each class will have the approximately 6-10 marks

Problem 1: Computing Returns

[4] But why not just use a stock’s historical average return as its expected return?

Estimating average returns from historical data is extremely challenging:

Individual stock returns are highly volatile

Many returns are close to zero, adding noise

The amount and quality of available data can vary significantly across firms

In contrast, regressions used to estimate beta are generally reliable, and:

Combining beta with the CAPM leads to more accurate expected return     estimates

In practice, 83% of CFOs at major firms rely on CAPM to estimate expected returns     (Graham, 2022)

In practice, stocks and portfolios often earn returns (realized) that differ from     CAPM predictions (expected)

Researchers have found that relying solely on the market portfolio as the only     source of systematic risk leads to systematic pricing errors

[5] 𝑤𝑤1 = 0.5, 𝑤𝑤2 = 0.25, 𝑤𝑤3 = 0.25

Market information:     𝐸𝐸 𝑅𝑅𝑀𝑀 = 7% and 𝑅𝑅𝑓𝑓 = 5%

What is the expected return of the portfolio?

Step 1: Calculate the portfolio’s beta 𝛽𝛽𝑃𝑃 = 𝑤𝑤1𝛽𝛽1 + 𝑤𝑤2𝛽𝛽2 + 𝑤𝑤3𝛽𝛽3 = 0.5 × (1) + 0.25 × (.5) + 0.25 × (2) = 1.125

Step 2: Calculate the expected return using CAPM     𝐸𝐸 𝑅𝑅𝑃𝑃 = 𝑅𝑅𝑓𝑓 + 𝛽𝛽𝑃𝑃 × 𝐸𝐸 𝑅𝑅𝑀𝑀 − 𝑅𝑅𝑓𝑓 = .05 + 1.125(.07 − .05) = 7.25%

Key Takeaways

Holding individual stocks typically exposes investors to greater volatility than     diversified portfolios, which help smooth out individual stock fluctuations,     without necessarily delivering higher returns

Higher risk, measured appropriately, is associated with higher expected returns,     especially in well-diversified portfolios

Only systematic risk, the risk that cannot be diversified away, earns a risk premium

Unsystematic risk can be eliminated through diversification and is not     compensated (does not ear a risk premium)

[6] Stock Price @ t = 0 Price @ t = 1 A $100 $110 B $40 $50

Problem 3: Solution

 𝑅𝑅𝑅𝑅 = 10% =

 110 − 100 100

 𝑅𝑅𝑅𝑅 = 25% =

 50 − 40 40

 𝑅𝑅𝑅𝑅 = 𝑤𝑤 ∗ 10% + 1 − 𝑤𝑤 ∗ 25% = 26.5%

 𝑤𝑤 =

 26.5% − 25% 10% − 25%

 = −10%

 −5000 = 𝑤𝑤 ∗ 𝑉𝑉

 𝑉𝑉 = −

 5000 −10%

 = 50,000

Problem 4: Efficient Portfolios and Complete Portfolios

 An investor wants a complete portfolio with an expected return of 8%. There are only two risky assets in the market, Stock S, with an expected return of 15% and a standard deviation of 30%, and Stock B, with an expected return of 5% and a standard deviation of 10%. The correlation between the two risky assets is 10%. The risk-free rate is 2%. The investor uses the risky portfolio P (50% allocated to Stock S and 50% allocated to Stock B) and the risk-free rate to build their complete portfolio.

Calculate the fraction of the investor's wealth allocated to the risky portfolio P in their complete portfolio.
Produce EXACTLY 4 options. EXACTLY ONE option has role "correct".
Every option has a per-option explanation. Assign each non-correct option one role from:
  - "common-misconception": a plausible error a student commonly makes
  - "partially-correct": right idea, incomplete or misapplied
  - "clearly-wrong": obviously incorrect to a prepared student
AT LEAST ONE option MUST be "common-misconception". The practice loop offers its retry only when a student picks one, so a question without it silently loses that behaviour. A question is rejected and regenerated without one.
DISTRACTORS ARE WRONG METHODS, NOT WRONG ARITHMETIC. A distractor must be the
number a student actually reaches by reasoning incorrectly — discounting the
wrong number of periods, compounding forward instead of back, dropping a term,
using the wrong rate. Do NOT take the correct formula and mutate an operator:
  good:  PAYMENT*(1+r)^n        compounded forward instead of discounting
  good:  PAYMENT/(1+r)^1        discounted one period regardless of the term
  bad:   SALES*(MULTIPLE^2)     squaring a multiple is not a mistake anyone makes
  bad:   SALES+MULTIPLE         swapping x for + is arithmetic noise
  bad:   (MULTIPLE+1)*SALES     an arbitrary tweak, not a misconception
If you cannot name the student who would make the mistake, it is not a
distractor — find a real one from the course material.
FORMATTING. The stem, every option, and every explanation are rendered as
markdown with KaTeX math. Write formulas as LaTeX, not as flat ASCII:
  - inline math between single dollars: $PV = \frac{C}{(1+r)^n}$
  - display math between double dollars for a full worked line:
      $$PV = \sum_{t=1}^{n} \frac{C_t}{(1+r)^t}$$
Two rules the renderer imposes, and both fail SILENTLY when broken — the
math renders as literal source text rather than erroring:
  1. Never use \( \) or \[ \]. The markdown pass runs first and strips
     their backslashes, so KaTeX never sees a delimiter.
  2. A math span must never contain a dollar followed by digits and then a
     space: that reads as a currency amount, not as math. In practice, start
     math with a symbol or a command — never a digit — and keep currency
     symbols OUTSIDE the math:
       good:  A payment of $500 grows to $P \times 1.05$.
       good:  $\text{FV} = 500 \times 1.05$
       bad:   $500 \times 1.05$      (opens with a digit)
       bad:   $\$500 \times 1.05$   (escaped amount, then a space)
     The same applies right after $$: write $$\text{PV} = \sum ...$$, never
     $$500 \times ...$$
  3. Never write a slot or derived-value NAME inside \text{}. Those names
     contain underscores, and escaping an underscore inside math is where
     stray characters creep in and break the whole span. Use a short symbol
     and let the placeholder carry the number:
       good:  $r = \frac{R}{100}$ where the rate is {{RATE_PCT}}%
       bad:   $r = \frac{\text{RATE_PCT}}{100}$
Prose stays prose; only the formulas are LaTeX.
Show the working in the EXPLANATION — that is what that field is for, so a
display line there beats describing the arithmetic in words. Do NOT put the
working in an option: an option states an ANSWER, never the formula that
produces it. See THE OPTION CONTRACT below.
NUMERICAL QUESTIONS — MANDATORY.
If answering requires ANY computation, set "numericKind": "numeric".
NEVER write a computed number anywhere — not in the stem, an option, or an explanation.
State the inputs as variable slots and every displayed value as a formula; a
deterministic evaluator computes them at serve time, and each student sees different
numbers.
  - "paramSlots": the inputs, e.g.
      [ { "name": "PAYMENT", "min": 100, "max": 900, "step": 100 },
        { "name": "RATE_PCT", "min": 4, "max": 12, "step": 2 } ]
  - "derivedValues": the correct answer AND every distractor, e.g.
      [ { "name": "PV", "formula": "PAYMENT/(1+RATE_PCT/100)^2" },
        { "name": "PV_COMPOUNDED", "formula": "PAYMENT*(1+RATE_PCT/100)^2",
          "errorModel": "compounded forward instead of discounting back" } ]
    These formulas are EVALUATOR syntax and are NEVER LaTeX: they are parsed
    and computed, not displayed. Keep writing PAYMENT/(1+RATE_PCT/100)^2 —
    a \frac{}{} here fails to parse and the question is rejected. LaTeX
    belongs only in the stem, option and explanation TEXT.
  - BUILD THE ANSWER IN STEPS. "derivedValues" are evaluated IN ORDER, and a
    later formula may use any earlier one BY NAME. Prefer several short named
    steps to one long expression:
      good:
        DEBT_VALUE   = PV(YTM_PCT/100, 16, FACE_DEBT*COUPON_PCT/100) + PV(YTM_PCT/100, 16, FACE_DEBT)
        EQUITY_VALUE = SHARES*PRICE
        V            = DEBT_VALUE + EQUITY_VALUE
        COST_EQUITY  = RF_PCT/100 + BETA*MRP_PCT/100
        WACC         = (EQUITY_VALUE/V)*COST_EQUITY + (DEBT_VALUE/V)*(YTM_PCT/100)
      bad:  all of that inlined as one 400-character expression with the two
            PV(...) calls repeated six times.
    A step that no option displays is perfectly allowed and is exempt from
    the option contract below — name it and reuse it.
    This is not a style preference. Long nested expressions are exactly where
    real generations drop a parenthesis; the parser then reports "trailing
    input after formula" and the question is rejected outright. If a formula
    runs past roughly 100 characters, or nests more than three deep, SPLIT IT.
    If you cannot express a quantity inline, give it its OWN step. Never fill
    the gap with a stand-in: (PV(1,1,1) - PV(1,1,1)) and a hardcoded 2.2e6
    were both produced in real runs — the first is identically zero, so it
    divided the answer by zero on every draw.
    Every distractor MUST carry an "errorModel" naming the specific mistake it
    represents, and its formula must genuinely implement that mistake.
    Name the MISTAKE, never the role. "common-misconception" is a role, not an
    errorModel — a real generation returned exactly that on every distractor
    and the question was regenerated. Write "compounded forward instead of
    discounting back" or "used the coupon rate in place of the yield".
    The CORRECT value MUST NOT carry an "errorModel" — it represents no mistake.
    Omit the field entirely rather than describing the right answer in it.
  - THE OPTION CONTRACT — read this twice. It is checked FIRST, before any
    formula is evaluated, so breaking it rejects the question before the
    collision check below is even reached. Three consecutive live
    generations died here.
    An option text IS a value. Not a sentence containing a value — the whole
    option is the quantity, plus at most a currency symbol, unit or percent
    sign, and it carries EXACTLY ONE {{NAME}} from "derivedValues":
      good:  "${{PV}}"
      good:  "{{IRR_PCT}}%"
      bad:   "${{PAYMENT}}"                  an INPUT slot is not an answer
      bad:   "-{{CF0}} + {{CF1}}/(1+r)"      the formula, not the answer
      bad:   "Accept the project"            no computed value at all
      bad:   "Accept the project. {{NPV}}"   a sentence with a value stapled
             on. This is the worst of the four: it passes the automatic
             check and reaches a student as a decision followed by an
             unrelated number. If you find yourself appending a value to a
             sentence to satisfy this rule, the question is CONCEPTUAL —
             go and set "numericKind": "conceptual" instead.
    Input-slot placeholders may also appear in an option, but they do not
    count toward this rule and can never stand in for the derived value.
    Two options must never name the same derived value.
    The STEM may use slot placeholders freely — this rule is about options.
Formula syntax: + - * / ^ ( ), variable names, and these functions only:
  PV(rate, periods, amount), FV(rate, periods, amount), PMT(rate, periods, principal),
  NPV(rate, cf1, cf2, ...), IRR(cf0, cf1, ...), ln, exp, sqrt, abs, min, max,
  round(value, decimals), N(x) for the standard normal CDF, and
  SUM(index, from, to, body) for series such as duration or amortization.
These functions are shorthand, not a limit: any closed-form finance formula can be
written with arithmetic alone (CAPM is RF + BETA*MRP; Gordon growth is D1/(R-G)).
Transcribe the formula the course material itself uses.
That list is the WHOLE grammar. There are no comparisons (> < >= <= == !=),
no conditionals, no ternary ?:, no booleans, and no if(). A formula like
"max(1, min(2, (PI_X>0?1:0) + (PI_Y>0?1:0)))" does not parse and the question
is rejected. If you are reaching for a comparison, you are encoding a DECISION
as a number — that question is "conceptual", not "numeric".
Two rules the automatic verifier enforces — a question breaking either is rejected:
  1. Ranges must never let a formula break. A rate a formula divides by must not
     include 0, and no range may drive a value beyond about 1e12.
  2. Option values must differ for EVERY combination of values in range.
THE PAIRWISE COLLISION CHECK — do this before you answer, it is the single most
common reason a question is rejected. Take every PAIR of option formulas, set them
equal, and solve. If any solution falls inside the declared ranges, the two options
show the same number on that draw and the question is unanswerable. Examples of
pairs that look fine and are not:
  - "A" and "B" (two bare slot values) are equal wherever their ranges OVERLAP.
  - "A - B" and "B" are equal when A = 2*B.
  - "A - B" and "B - A" are equal when A = B (both 0).
  - "A * (1+r)^n" and "A" are equal when n can draw 0.
THE FIX, and prefer this one: give the slots DISJOINT, WELL-SEPARATED ranges. If A
is always far larger than B, then A never equals B, A-B never equals B, and A+B
never equals either. For a firm with cash in and cash out, use something like
CASH_IN 3000..5000 and CASH_OUT 200..1000 rather than two ranges that both span
200..5000. Separated ranges are also more realistic than overlapping ones.
If separation is impossible, change the mistake instead: use a wrong rate, a
dropped term, or a wrong operand rather than a formula that can coincide.
Two collision traps seen in real generations, both from distractors that are
RATIOS or PERCENTAGES rather than amounts — the sizes cancel, so widening the
ranges does not separate them:
  - a distractor that differs only by a factor which some draw makes 1;
  - two "wrong rate" distractors whose rates coincide where their ranges meet.
For a ratio-valued answer, separate it by the STRUCTURE of the mistake (a
dropped term, a wrong denominator), not by the input ranges.
If answering requires NO computation, set "numericKind": "conceptual" and omit
paramSlots and derivedValues entirely.
ALSO conceptual, even though arithmetic is involved: a question whose OPTIONS
are decisions or statements rather than values — "Accept the project" /
"Reject the project", "The NPV rule and the IRR rule agree", and so on. Those
options cannot satisfy the option contract, because there is no single
computed value for them to display. Pick one shape and commit to it:
  - want the decision tested? -> "conceptual", no slots, no derivedValues;
  - want the arithmetic tested? -> "numeric", and every option is a VALUE.
Do not try to have both in one question.
TWO WORKED EXAMPLES — study the SHAPE, never reuse the subject.

Example of a NUMERIC question (answering requires arithmetic, so every option
is a computed value and the inputs are slots):
{ "numericKind": "numeric",
  "stem": "A bond pays {{COUPON}} annually for {{YEARS}} years. At a yield of {{YIELD_PCT}}%, what is its price?",
  "paramSlots": [ { "name": "COUPON", "min": 40, "max": 90, "step": 10 } ],
  "derivedValues": [ { "name": "PRICE", "formula": "COUPON*(1-(1+YIELD_PCT/100)^(-YEARS))/(YIELD_PCT/100)" } ],
  "options": [ { "key": "A", "text": "{{PRICE}}", "role": "correct" } ] }

Example of a CONCEPTUAL question (answering requires judgement, so the options
are statements and there are no slots at all):
{ "numericKind": "conceptual",
  "stem": "A country raises its policy rate while inflation expectations stay unchanged. Why would its currency tend to appreciate?",
  "options": [
    { "key": "A", "text": "Higher real returns attract foreign capital, raising demand for the currency", "role": "correct" },
    { "key": "B", "text": "Higher rates increase exports, and export receipts are paid in the domestic currency", "role": "common-misconception" } ] }

Note what makes the second one conceptual: it CONTAINS no computation, even
though a rate is mentioned. Numbers a question states are facts; only numbers a
student must CALCULATE make it numeric.

Respond with ONLY this JSON shape:
{ "stem": string, "difficulty": "easy"|"medium"|"hard",
  "numericKind": "numeric"|"conceptual",
  "paramSlots": [ { "name": string, "min": number, "max": number, "step": number } ],
  "derivedValues": [ { "name": string, "formula": string, "errorModel": string } ],
  "options": [ { "key": string, "text": string, "role": string, "explanation": string } ] }
Use option keys "A","B","C","D".
```

</details>

### B21

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 8  **derived:** 5

**Stem.** A portfolio contains three stocks with weights $w_1={{W1}}$, $w_2={{W2}}$, and $w_3={{W3}}$. Their betas are $\beta_1={{BETA1}}$, $\beta_2={{BETA2}}$, and $\beta_3={{BETA3}}$. If the risk-free rate is ${{RF_PCT}}\%$ and the expected market return is ${{RM_PCT}}\%$, what is the portfolio's CAPM expected return? First determine the portfolio beta using $\beta_P=w_1\beta_1+w_2\beta_2+w_3\beta_3$, then apply $E[R_P]=R_f+\beta_P(E[R_M]-R_f)$.

- **[A]** {{EXPECTED_RETURN}}%  _<correct>_
  - _First calculate the weighted portfolio beta: $$\beta_P=w_1\beta_1+w_2\beta_2+w_3\beta_3={{BETA_P}}.$$ Then apply CAPM using the market risk premium: $$E[R_P]=R_f+\beta_P(E[R_M]-R_f)={{EXPECTED_RETURN}}\%.$$_
- **[B]** {{WRONG_BETA}}%  _<common-misconception>_
  - _This result comes from adding the individual betas directly. Portfolio beta must be a weighted average, not an unweighted sum: $$\beta_P=w_1\beta_1+w_2\beta_2+w_3\beta_3.$$_
- **[C]** {{WRONG_MARKET_PREMIUM}}%  _<common-misconception>_
  - _CAPM uses the market risk premium, $E[R_M]-R_f$, rather than the expected market return alone. The correct structure is $$E[R_P]=R_f+\beta_P(E[R_M]-R_f).$$_
- **[D]** {{WRONG_BETA1_ONLY}}%  _<partially-correct>_
  - _This applies the CAPM formula correctly in form but uses only the first stock's beta. Because the portfolio contains three stocks, its beta must combine all three weighted betas before applying CAPM._

> **Numeric verification: **PROOF EARNED****

> **Reviewer (`high`): `reject`** — The correct CAPM model and the other two distractor formulas are sound, but WRONG_BETA is not. It computes only the unweighted sum of the betas, not an expected return, yet is displayed as a percentage answer to the CAPM-return question. To model the stated misconception, it should apply CAPM using the unweighted sum, such as RF_PCT+WRONG_BETA*(RM_PCT-RF_PCT). Thus the distractor does not genuinely implement its errorModel and is not a valid alternative answer.

### B22

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 3  **derived:** 4

**Stem.** A stock has beta ${{BETA}}$. The risk-free rate is ${{RF_PCT}}\%$, and the market's expected return is ${{RM_PCT}}\%$. Using the CAPM formula, what is the stock's expected return?

- **[A]** ${{EXPECTED_RETURN_PCT}}\%$  _<correct>_
  - _CAPM adds the risk-free rate to beta times the market risk premium: $$E[R] = R_f + \beta(E[R_m]-R_f)$$ Therefore, $$E[R] = {{RF_PCT}}\% + {{BETA}}\times({{RM_PCT}}\%-{{RF_PCT}}\%) = {{EXPECTED_RETURN_PCT}}\%.$$_
- **[B]** ${{WRONG_TOTAL_MARKET_RETURN_PCT}}\%$  _<common-misconception>_
  - _This result comes from multiplying beta by the market's total expected return. CAPM instead applies beta to the market risk premium, $E[R_m]-R_f$: $$E[R] = R_f + \beta(E[R_m]-R_f),$$ not $R_f+\beta E[R_m]$._
- **[C]** ${{WRONG_RISK_FREE_ONLY_PCT}}\%$  _<clearly-wrong>_
  - _This calculation uses the risk-free rate as the premium being scaled by beta. The CAPM premium is the market expected return minus the risk-free rate, not the risk-free rate itself._
- **[D]** ${{WRONG_UNLEVERED_PREMIUM_PCT}}\%$  _<partially-correct>_
  - _This option recognizes that the market risk premium must be included, but it divides that premium by beta. CAPM requires multiplication by beta: $$E[R] = R_f + \beta(E[R_m]-R_f).$$_

> **Numeric verification: FAILED — options EXPECTED_RETURN_PCT and WRONG_UNLEVERED_PREMIUM_PCT are identical (seed 1000006)**

> **Reviewer (`high`): `reject`** — The CAPM formula and the stated error models are generally sound, but the item has structural ambiguity. Option D becomes identical to the correct formula when BETA=1.0, which is an allowed parameter value; option C can also coincide with the correct result for allowed RF_PCT and RM_PCT values. Thus multiple options may display the same answer. In addition, the task is a one-step CAPM substitution and is misclassified as medium; it should be easy. Restrict the parameter ranges or redesign the distractors, and revise the difficulty before use.

### B23

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 3  **derived:** 4

**Stem.** A stock has beta $\beta={{BETA}}$. The risk-free rate is ${{RF_PCT}}\%$, and the market's expected return is ${{MARKET_PCT}}\%$. Using the CAPM formula, what is the stock's expected return?

- **[A]** {{CAPM_RETURN}}%  _<correct>_
  - _The CAPM formula is $E[R]=R_f+\beta(E[R_m]-R_f)$. Substituting the inputs gives $$E[R]={{RF_PCT}}+{{BETA}}({{MARKET_PCT}}-{{RF_PCT}})={{CAPM_RETURN}}\%.$$_
- **[B]** {{NO_BETA_RETURN}}%  _<common-misconception>_
  - _This result omits beta. The market risk premium must be adjusted for the stock's systematic risk using $\beta$ before adding the risk-free rate._
- **[C]** {{BETA_TIMES_MARKET_RETURN}}%  _<partially-correct>_
  - _This uses beta and adds the risk-free rate, but it multiplies beta by the market return rather than by the market risk premium, $E[R_m]-R_f$._
- **[D]** {{ADDED_RISK_FREE}}%  _<clearly-wrong>_
  - _The market risk premium is the market's expected return minus the risk-free rate. Adding the risk-free rate to the market return produces the wrong CAPM input._

> **Numeric verification: FAILED — options CAPM_RETURN and NO_BETA_RETURN are identical (seed 1000006)**

> **Reviewer (`high`): `flag`** — The CAPM formula and distractor error models are substantively correct and aligned with the LO. However, the stated medium difficulty is too high for a direct one-step substitution; it should be labeled easy or require additional reasoning. Also, the allowed beta values include 1.0, for which the no-beta distractor is identical to the correct CAPM result, creating ambiguity. Exclude beta = 1.0 or revise that distractor.

### Tally

| Variant | Outcomes |
|---|---|
| A2 | numeric / NO-PROOF(options CAPM_RETURN and NO_BETA_RETURN are identical (seed 1000006)) / flag · numeric / NO-PROOF(options EXPECTED_RETURN_PCT and WRONG_BETA_INVERSE_PCT are identical (seed 1000006)) / flag · numeric / NO-PROOF(options CAPM_RETURN and UNLEVERED_MARKET_PREMIUM are identical (seed 1000006)) / flag |
| B2 | numeric / PROOF / reject · numeric / NO-PROOF(options EXPECTED_RETURN_PCT and WRONG_UNLEVERED_PREMIUM_PCT are identical (seed 1000006)) / reject · numeric / NO-PROOF(options CAPM_RETURN and NO_BETA_RETURN are identical (seed 1000006)) / flag |

---

# Experiment 3 — do worked DISTRACTOR pairs beat exemplars alone?

The misconception preset, which has no distinct output shape of its own. Tests whether adding worked good/bad distractor pairs — cheaper than another question exemplar, and less anchoring — improves the distractors themselves.

- **LO:** Distinguish firm vs enterprise value (`6a7e3bd4ae7ebf69b347c344`)
- **Instructor prompt:** "Create a question whose most plausible distractor exposes a common student misconception, and explain that misconception clearly."
- **Model:** `gpt-5.6-luna`, `reasoning_effort: none`, `temperature: 0.7`; 3 per variant.
- **Grounding:** 6 chunks, retrieved once and shared across variants.

## B3 — Few-shot only

Prompt: **19020 chars**, ~4755 tokens.

<details>
<summary>Full prompt as sent</summary>

```text
You are an expert finance instructor writing ONE multiple-choice practice question
for the learning objective: "Distinguish firm vs enterprise value".
Target difficulty: medium.
Medium means the student must choose or connect concepts, interpret a scenario, or complete more than one reasoning step; a direct formula substitution is too easy.
Additional instruction from the instructor: Create a question whose most plausible distractor exposes a common student misconception, and explain that misconception clearly.
Ground the question ONLY in the course material below. Do not introduce facts not supported by it.
Course material:
[1] The same stock is currently trading at $20 per share

The $10 difference indicates that many investors disagree with your assessment

These investors often have access to extensive data and professional insights

The market price reflects the collective judgment of thousands of participants

Consider whether the market is missing something or your model is flawed

Ask yourself: should you trust your estimate or revisit your assumptions?

Remember: the market can be wrong, but it’s rarely uninformed

How Markets Find a Price

Every day, millions of trades occur, each between a buyer and a seller who agree     on a price, but disagree on value

This difference in views drives information exchange: as trades occur, both sides     revise their valuations

Through this continuous process, investors collectively discover and converge on a     price

 The market price thus reflects the aggregated beliefs and information of all participants

[2] COMM 298 2024W1 Introduction to Finance | Jose Pizarro | Do not post without permission 21

Key Takeaways

Corporate value covers all assets; enterprise value focuses on core operations

Enterprise value is capital-structure neutral and better for comparing firms

Valuation is central to finance decisions and always involves judgment

DCF values a company from cash flows; comps value it relative to peers

Multiples are useful but depend heavily on good comparable firms and     assumptions

Thank you

[3] Class 17

Introduction to Corporate Finance and Capital Budgeting

 COMM 298 2025W1: Introduction to Finance Jose Pizarro

Objectives

Understand the concept of Net Present Value (NPV) and its role in evaluating     investment opportunities

Apply the NPV and Internal Rate of Return (IRR) methods to assess the financial     viability of a project

Analyze how changes in the discount rate affect project valuation using NPV     profiles and sensitivity analysis

Evaluate mutually exclusive projects and determine which project maximizes     shareholder value

Justify the use of NPV over IRR when the decision rules conflict, especially in the     case of mutually exclusive investments

The Role of Financial Management in Corporations

In the beginning of the course, we discussed the key financial decisions that     corporations make related to funding, investment, and operations, all with the     goal of maximizing firm value

[4] Class 11

Market Efficiency

 COMM 298 2025 W1: Introduction to Finance Jose Pizarro

Objectives

Explain how information is transferred into financial prices

Discuss the concept of Market Efficiency

Describe how different types of information are transferred into prices

Illustrate how market efficiency can be empirically tested

How We Value a Stock

We built a model that connects three key elements:

Expected future cash flows — what the company is likely to earn

Required return — the rate investors demand, based on risk

Market price — what the stock currently trades for

Key question:     If the market price differs from your estimated fair value — what should you do?

Market Price vs. Intrinsic Value: Who Do You Trust?

Your valuation model estimates the stock’s value at $30 per share

The same stock is currently trading at $20 per share

The $10 difference indicates that many investors disagree with your assessment

[5] Class 20

Corporate Valuation

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objective

Define and distinguish corporate value and enterprise value

Explain why enterprise value is widely used in practice

Use valuation multiples (like EV/EBITDA and P/E) to estimate firm and equity value

Compare DCF (intrinsic) and relative (comps) valuation methods

Judge a valuation result and make a basic buy/hold/sell recommendation

Measuring Firm Value: Value vs. Enterprise Value

Corporate Value (also called Firm Value or Total Company Value: V)

The total value of the business, including both:

Core operating assets, and

Non-core assets (e.g., excess cash, investments, unused real estate)

Represents the value of everything the company owns

Enterprise Value (EV)

The value of a company’s core operating business

Focuses on the value of operations available to all capital providers (debt and equity)

[6] The market price thus reflects the aggregated beliefs and information of all participants

When to Trust the Market, and When to Trust Your Valuation

The accuracy of a pricing model depends on how well we can estimate:

The firm’s expected future cash flows

The expected return, which reflects risk

The quality of these estimates depends on the quality of our information

The market price of a publicly traded stock reflects high-quality, aggregated     information from thousands of informed investors

Only in rare cases do we possess better information than the market

In those rare cases, it may be justified to challenge the stock price

How Market Prices Reflect Information

Suppose new information suggests AAPL’s stock is undervalued

Informed investors buy the stock to profit from the insight

Their buying pressure drives up the price

The stock price rises until it fully reflects the new information

 In short: prices adjust as investors act on new information
Produce EXACTLY 4 options. EXACTLY ONE option has role "correct".
Every option has a per-option explanation. Assign each non-correct option one role from:
  - "common-misconception": a plausible error a student commonly makes
  - "partially-correct": right idea, incomplete or misapplied
  - "clearly-wrong": obviously incorrect to a prepared student
AT LEAST ONE option MUST be "common-misconception". The practice loop offers its retry only when a student picks one, so a question without it silently loses that behaviour. A question is rejected and regenerated without one.
DISTRACTORS ARE WRONG METHODS, NOT WRONG ARITHMETIC. A distractor must be the
number a student actually reaches by reasoning incorrectly — discounting the
wrong number of periods, compounding forward instead of back, dropping a term,
using the wrong rate. Do NOT take the correct formula and mutate an operator:
  good:  PAYMENT*(1+r)^n        compounded forward instead of discounting
  good:  PAYMENT/(1+r)^1        discounted one period regardless of the term
  bad:   SALES*(MULTIPLE^2)     squaring a multiple is not a mistake anyone makes
  bad:   SALES+MULTIPLE         swapping x for + is arithmetic noise
  bad:   (MULTIPLE+1)*SALES     an arbitrary tweak, not a misconception
If you cannot name the student who would make the mistake, it is not a
distractor — find a real one from the course material.
FORMATTING. The stem, every option, and every explanation are rendered as
markdown with KaTeX math. Write formulas as LaTeX, not as flat ASCII:
  - inline math between single dollars: $PV = \frac{C}{(1+r)^n}$
  - display math between double dollars for a full worked line:
      $$PV = \sum_{t=1}^{n} \frac{C_t}{(1+r)^t}$$
Two rules the renderer imposes, and both fail SILENTLY when broken — the
math renders as literal source text rather than erroring:
  1. Never use \( \) or \[ \]. The markdown pass runs first and strips
     their backslashes, so KaTeX never sees a delimiter.
  2. A math span must never contain a dollar followed by digits and then a
     space: that reads as a currency amount, not as math. In practice, start
     math with a symbol or a command — never a digit — and keep currency
     symbols OUTSIDE the math:
       good:  A payment of $500 grows to $P \times 1.05$.
       good:  $\text{FV} = 500 \times 1.05$
       bad:   $500 \times 1.05$      (opens with a digit)
       bad:   $\$500 \times 1.05$   (escaped amount, then a space)
     The same applies right after $$: write $$\text{PV} = \sum ...$$, never
     $$500 \times ...$$
  3. Never write a slot or derived-value NAME inside \text{}. Those names
     contain underscores, and escaping an underscore inside math is where
     stray characters creep in and break the whole span. Use a short symbol
     and let the placeholder carry the number:
       good:  $r = \frac{R}{100}$ where the rate is {{RATE_PCT}}%
       bad:   $r = \frac{\text{RATE_PCT}}{100}$
Prose stays prose; only the formulas are LaTeX.
Show the working in the EXPLANATION — that is what that field is for, so a
display line there beats describing the arithmetic in words. Do NOT put the
working in an option: an option states an ANSWER, never the formula that
produces it. See THE OPTION CONTRACT below.
NUMERICAL QUESTIONS — MANDATORY.
If answering requires ANY computation, set "numericKind": "numeric".
NEVER write a computed number anywhere — not in the stem, an option, or an explanation.
State the inputs as variable slots and every displayed value as a formula; a
deterministic evaluator computes them at serve time, and each student sees different
numbers.
  - "paramSlots": the inputs, e.g.
      [ { "name": "PAYMENT", "min": 100, "max": 900, "step": 100 },
        { "name": "RATE_PCT", "min": 4, "max": 12, "step": 2 } ]
  - "derivedValues": the correct answer AND every distractor, e.g.
      [ { "name": "PV", "formula": "PAYMENT/(1+RATE_PCT/100)^2" },
        { "name": "PV_COMPOUNDED", "formula": "PAYMENT*(1+RATE_PCT/100)^2",
          "errorModel": "compounded forward instead of discounting back" } ]
    These formulas are EVALUATOR syntax and are NEVER LaTeX: they are parsed
    and computed, not displayed. Keep writing PAYMENT/(1+RATE_PCT/100)^2 —
    a \frac{}{} here fails to parse and the question is rejected. LaTeX
    belongs only in the stem, option and explanation TEXT.
  - BUILD THE ANSWER IN STEPS. "derivedValues" are evaluated IN ORDER, and a
    later formula may use any earlier one BY NAME. Prefer several short named
    steps to one long expression:
      good:
        DEBT_VALUE   = PV(YTM_PCT/100, 16, FACE_DEBT*COUPON_PCT/100) + PV(YTM_PCT/100, 16, FACE_DEBT)
        EQUITY_VALUE = SHARES*PRICE
        V            = DEBT_VALUE + EQUITY_VALUE
        COST_EQUITY  = RF_PCT/100 + BETA*MRP_PCT/100
        WACC         = (EQUITY_VALUE/V)*COST_EQUITY + (DEBT_VALUE/V)*(YTM_PCT/100)
      bad:  all of that inlined as one 400-character expression with the two
            PV(...) calls repeated six times.
    A step that no option displays is perfectly allowed and is exempt from
    the option contract below — name it and reuse it.
    This is not a style preference. Long nested expressions are exactly where
    real generations drop a parenthesis; the parser then reports "trailing
    input after formula" and the question is rejected outright. If a formula
    runs past roughly 100 characters, or nests more than three deep, SPLIT IT.
    If you cannot express a quantity inline, give it its OWN step. Never fill
    the gap with a stand-in: (PV(1,1,1) - PV(1,1,1)) and a hardcoded 2.2e6
    were both produced in real runs — the first is identically zero, so it
    divided the answer by zero on every draw.
    Every distractor MUST carry an "errorModel" naming the specific mistake it
    represents, and its formula must genuinely implement that mistake.
    Name the MISTAKE, never the role. "common-misconception" is a role, not an
    errorModel — a real generation returned exactly that on every distractor
    and the question was regenerated. Write "compounded forward instead of
    discounting back" or "used the coupon rate in place of the yield".
    The CORRECT value MUST NOT carry an "errorModel" — it represents no mistake.
    Omit the field entirely rather than describing the right answer in it.
  - THE OPTION CONTRACT — read this twice. It is checked FIRST, before any
    formula is evaluated, so breaking it rejects the question before the
    collision check below is even reached. Three consecutive live
    generations died here.
    An option text IS a value. Not a sentence containing a value — the whole
    option is the quantity, plus at most a currency symbol, unit or percent
    sign, and it carries EXACTLY ONE {{NAME}} from "derivedValues":
      good:  "${{PV}}"
      good:  "{{IRR_PCT}}%"
      bad:   "${{PAYMENT}}"                  an INPUT slot is not an answer
      bad:   "-{{CF0}} + {{CF1}}/(1+r)"      the formula, not the answer
      bad:   "Accept the project"            no computed value at all
      bad:   "Accept the project. {{NPV}}"   a sentence with a value stapled
             on. This is the worst of the four: it passes the automatic
             check and reaches a student as a decision followed by an
             unrelated number. If you find yourself appending a value to a
             sentence to satisfy this rule, the question is CONCEPTUAL —
             go and set "numericKind": "conceptual" instead.
    Input-slot placeholders may also appear in an option, but they do not
    count toward this rule and can never stand in for the derived value.
    Two options must never name the same derived value.
    The STEM may use slot placeholders freely — this rule is about options.
Formula syntax: + - * / ^ ( ), variable names, and these functions only:
  PV(rate, periods, amount), FV(rate, periods, amount), PMT(rate, periods, principal),
  NPV(rate, cf1, cf2, ...), IRR(cf0, cf1, ...), ln, exp, sqrt, abs, min, max,
  round(value, decimals), N(x) for the standard normal CDF, and
  SUM(index, from, to, body) for series such as duration or amortization.
These functions are shorthand, not a limit: any closed-form finance formula can be
written with arithmetic alone (CAPM is RF + BETA*MRP; Gordon growth is D1/(R-G)).
Transcribe the formula the course material itself uses.
That list is the WHOLE grammar. There are no comparisons (> < >= <= == !=),
no conditionals, no ternary ?:, no booleans, and no if(). A formula like
"max(1, min(2, (PI_X>0?1:0) + (PI_Y>0?1:0)))" does not parse and the question
is rejected. If you are reaching for a comparison, you are encoding a DECISION
as a number — that question is "conceptual", not "numeric".
Two rules the automatic verifier enforces — a question breaking either is rejected:
  1. Ranges must never let a formula break. A rate a formula divides by must not
     include 0, and no range may drive a value beyond about 1e12.
  2. Option values must differ for EVERY combination of values in range.
THE PAIRWISE COLLISION CHECK — do this before you answer, it is the single most
common reason a question is rejected. Take every PAIR of option formulas, set them
equal, and solve. If any solution falls inside the declared ranges, the two options
show the same number on that draw and the question is unanswerable. Examples of
pairs that look fine and are not:
  - "A" and "B" (two bare slot values) are equal wherever their ranges OVERLAP.
  - "A - B" and "B" are equal when A = 2*B.
  - "A - B" and "B - A" are equal when A = B (both 0).
  - "A * (1+r)^n" and "A" are equal when n can draw 0.
THE FIX, and prefer this one: give the slots DISJOINT, WELL-SEPARATED ranges. If A
is always far larger than B, then A never equals B, A-B never equals B, and A+B
never equals either. For a firm with cash in and cash out, use something like
CASH_IN 3000..5000 and CASH_OUT 200..1000 rather than two ranges that both span
200..5000. Separated ranges are also more realistic than overlapping ones.
If separation is impossible, change the mistake instead: use a wrong rate, a
dropped term, or a wrong operand rather than a formula that can coincide.
Two collision traps seen in real generations, both from distractors that are
RATIOS or PERCENTAGES rather than amounts — the sizes cancel, so widening the
ranges does not separate them:
  - a distractor that differs only by a factor which some draw makes 1;
  - two "wrong rate" distractors whose rates coincide where their ranges meet.
For a ratio-valued answer, separate it by the STRUCTURE of the mistake (a
dropped term, a wrong denominator), not by the input ranges.
If answering requires NO computation, set "numericKind": "conceptual" and omit
paramSlots and derivedValues entirely.
ALSO conceptual, even though arithmetic is involved: a question whose OPTIONS
are decisions or statements rather than values — "Accept the project" /
"Reject the project", "The NPV rule and the IRR rule agree", and so on. Those
options cannot satisfy the option contract, because there is no single
computed value for them to display. Pick one shape and commit to it:
  - want the decision tested? -> "conceptual", no slots, no derivedValues;
  - want the arithmetic tested? -> "numeric", and every option is a VALUE.
Do not try to have both in one question.
TWO WORKED EXAMPLES — study the SHAPE, never reuse the subject.

Example of a NUMERIC question (answering requires arithmetic, so every option
is a computed value and the inputs are slots):
{ "numericKind": "numeric",
  "stem": "A bond pays {{COUPON}} annually for {{YEARS}} years. At a yield of {{YIELD_PCT}}%, what is its price?",
  "paramSlots": [ { "name": "COUPON", "min": 40, "max": 90, "step": 10 } ],
  "derivedValues": [ { "name": "PRICE", "formula": "COUPON*(1-(1+YIELD_PCT/100)^(-YEARS))/(YIELD_PCT/100)" } ],
  "options": [ { "key": "A", "text": "{{PRICE}}", "role": "correct" } ] }

Example of a CONCEPTUAL question (answering requires judgement, so the options
are statements and there are no slots at all):
{ "numericKind": "conceptual",
  "stem": "A country raises its policy rate while inflation expectations stay unchanged. Why would its currency tend to appreciate?",
  "options": [
    { "key": "A", "text": "Higher real returns attract foreign capital, raising demand for the currency", "role": "correct" },
    { "key": "B", "text": "Higher rates increase exports, and export receipts are paid in the domestic currency", "role": "common-misconception" } ] }

Note what makes the second one conceptual: it CONTAINS no computation, even
though a rate is mentioned. Numbers a question states are facts; only numbers a
student must CALCULATE make it numeric.

Respond with ONLY this JSON shape:
{ "stem": string, "difficulty": "easy"|"medium"|"hard",
  "numericKind": "numeric"|"conceptual",
  "paramSlots": [ { "name": string, "min": number, "max": number, "step": number } ],
  "derivedValues": [ { "name": string, "formula": string, "errorModel": string } ],
  "options": [ { "key": string, "text": string, "role": string, "explanation": string } ] }
Use option keys "A","B","C","D".
```

</details>

### B31

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 2  **derived:** 4

**Stem.** A company has core operating assets worth ${{OPERATING_VALUE}} and non-core assets worth ${{NONCORE_VALUE}}, such as excess cash or investments. What is the company's enterprise value, and why is it the more appropriate measure for comparing firms with different capital structures?

- **[A]** ${{ENTERPRISE_VALUE}}  _<correct>_
  - _Enterprise value focuses on the company's core operating business and is available to all capital providers, debt and equity. Therefore, only the operating-asset value is used: $EV = 	ext{operating asset value} = {{OPERATING_VALUE}}$._
- **[B]** ${{CORPORATE_VALUE}}  _<common-misconception>_
  - _This is total corporate, or firm, value because it includes both operating and non-core assets: $$V = 	ext{operating assets} + 	ext{non-core assets}.$$ The misconception is treating firm value and enterprise value as interchangeable, even though the course distinguishes enterprise value as the value of core operations._
- **[C]** ${{NONCORE_VALUE_ONLY}}  _<clearly-wrong>_
  - _Non-core assets are only one component of corporate value. Enterprise value does not measure excess cash, investments, or unused real estate by themselves; it measures the core operating business._
- **[D]** ${{OPERATING_PLUS_NONCORE_AGAIN}}  _<partially-correct>_
  - _This recognizes that operating and non-core assets can contribute to total corporate value, but it incorrectly counts the non-core assets twice. More importantly, enterprise value excludes non-core assets rather than adding them._

> **Reviewer (`high`): `flag`** — The core model is factually sound: enterprise value is represented by the operating-asset value, while non-core assets belong in broader corporate/firm value. The distractor formulas generally implement the stated mistakes, although the double-counting distractor is somewhat artificial. However, the item is labeled medium despite requiring only a one-step selection/substitution, so its difficulty is miscalibrated. Also, the stem asks why enterprise value is appropriate for comparing different capital structures, but the answer choices provide only numerical values; that conceptual justification appears only in feedback explanations rather than being tested directly.

### B32

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 2  **derived:** 4

**Stem.** A company owns core operating assets worth ${{OPERATING_VALUE}} and non-core assets worth ${{NONCORE_VALUE}}. It is financed with debt and equity. Which value correctly represents the company's enterprise value?

- **[A]** ${{EV}}  _<correct>_
  - _Enterprise value focuses on the company's core operating business and the operations available to both debt and equity providers. Therefore, it equals the value of the core operating assets: $EV = OPERATING_VALUE$._
- **[B]** ${{CORPORATE_VALUE}}  _<common-misconception>_
  - _This is the common mistake of confusing enterprise value with total corporate or firm value. Total corporate value includes both core operating assets and non-core assets: $$V = OPERATING_VALUE + NONCORE_VALUE.$$ Enterprise value excludes the non-core assets._
- **[C]** ${{NONCORE_ONLY}}  _<clearly-wrong>_
  - _Enterprise value is not the value of non-core assets. It represents the value of the core operating business, whereas non-core assets are included in total corporate value but not enterprise value._
- **[D]** ${{OPERATING_MINUS_NONCORE}}  _<partially-correct>_
  - _This recognizes that non-core assets should not be included in enterprise value, but it removes them by subtraction. The course material defines enterprise value directly as the value of core operations, so the correct calculation is $EV = OPERATING_VALUE$, not $OPERATING_VALUE - NONCORE_VALUE$._

> **Reviewer (`high`): `flag`** — The question is factually sound, aligned with distinguishing enterprise value from total corporate value, and its formulas and error models are coherent. However, it is marked medium while requiring only a direct one-step application of the definition: enterprise value equals the value of core operating assets. It should be classified as easy or revised to require a more substantive distinction, such as deriving enterprise value from firm value and non-core assets or relating it to debt and equity claims.

### B33

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 2  **derived:** 4

**Stem.** A company owns core operating assets worth ${{OPERATING_VALUE}} and non-core assets worth ${{NONCORE_VALUE}}. It is financed with debt and equity, and the question asks for the value of the core operating business available to all capital providers. Which value should be used?

- **[A]** ${{ENTERPRISE_VALUE}}  _<correct>_
  - _Enterprise value focuses on the core operating business and the operations available to both debt and equity providers. Therefore, it excludes the non-core assets: $$\text{EV} = \text{Operating value} = {{OPERATING_VALUE}}.$$_
- **[B]** ${{CORPORATE_VALUE}}  _<common-misconception>_
  - _This is the common misconception that enterprise value means the value of everything the company owns. That describes corporate value, which includes both operating and non-core assets: $$\text{Corporate value} = \text{Operating value} + \text{Non-core value} = {{OPERATING_VALUE}} + {{NONCORE_VALUE}}.$$_
- **[C]** ${{NONCORE_ONLY}}  _<clearly-wrong>_
  - _Non-core assets are only one component of corporate value; they are not the value of the core operating business. Enterprise value is based on the operating assets, not the non-core assets alone._
- **[D]** ${{OPERATING_LESS_NONCORE}}  _<partially-correct>_
  - _The response recognizes that non-core assets should not be included in enterprise value, but it removes them by subtraction. The course distinction is to measure the operating business directly, so enterprise value equals the operating value rather than operating value minus non-core value._

> **Reviewer (`high`): `flag`** — The question is factually accurate, aligned with distinguishing enterprise value from total corporate value, and its distractors represent plausible misconceptions with formulas that implement those errors. However, the reasoning is only a direct one-step identification: enterprise value equals the stated operating value. That is too easy for a question labeled medium, so the difficulty should be lowered or the stem should require a more substantive distinction or calculation.

## D3 — Few-shot + worked distractor pairs

Prompt: **19909 chars**, ~4977 tokens.

<details>
<summary>Full prompt as sent</summary>

```text
You are an expert finance instructor writing ONE multiple-choice practice question
for the learning objective: "Distinguish firm vs enterprise value".
Target difficulty: medium.
Medium means the student must choose or connect concepts, interpret a scenario, or complete more than one reasoning step; a direct formula substitution is too easy.
Additional instruction from the instructor: Create a question whose most plausible distractor exposes a common student misconception, and explain that misconception clearly.
Ground the question ONLY in the course material below. Do not introduce facts not supported by it.
Course material:
[1] The same stock is currently trading at $20 per share

The $10 difference indicates that many investors disagree with your assessment

These investors often have access to extensive data and professional insights

The market price reflects the collective judgment of thousands of participants

Consider whether the market is missing something or your model is flawed

Ask yourself: should you trust your estimate or revisit your assumptions?

Remember: the market can be wrong, but it’s rarely uninformed

How Markets Find a Price

Every day, millions of trades occur, each between a buyer and a seller who agree     on a price, but disagree on value

This difference in views drives information exchange: as trades occur, both sides     revise their valuations

Through this continuous process, investors collectively discover and converge on a     price

 The market price thus reflects the aggregated beliefs and information of all participants

[2] COMM 298 2024W1 Introduction to Finance | Jose Pizarro | Do not post without permission 21

Key Takeaways

Corporate value covers all assets; enterprise value focuses on core operations

Enterprise value is capital-structure neutral and better for comparing firms

Valuation is central to finance decisions and always involves judgment

DCF values a company from cash flows; comps value it relative to peers

Multiples are useful but depend heavily on good comparable firms and     assumptions

Thank you

[3] Class 17

Introduction to Corporate Finance and Capital Budgeting

 COMM 298 2025W1: Introduction to Finance Jose Pizarro

Objectives

Understand the concept of Net Present Value (NPV) and its role in evaluating     investment opportunities

Apply the NPV and Internal Rate of Return (IRR) methods to assess the financial     viability of a project

Analyze how changes in the discount rate affect project valuation using NPV     profiles and sensitivity analysis

Evaluate mutually exclusive projects and determine which project maximizes     shareholder value

Justify the use of NPV over IRR when the decision rules conflict, especially in the     case of mutually exclusive investments

The Role of Financial Management in Corporations

In the beginning of the course, we discussed the key financial decisions that     corporations make related to funding, investment, and operations, all with the     goal of maximizing firm value

[4] Class 11

Market Efficiency

 COMM 298 2025 W1: Introduction to Finance Jose Pizarro

Objectives

Explain how information is transferred into financial prices

Discuss the concept of Market Efficiency

Describe how different types of information are transferred into prices

Illustrate how market efficiency can be empirically tested

How We Value a Stock

We built a model that connects three key elements:

Expected future cash flows — what the company is likely to earn

Required return — the rate investors demand, based on risk

Market price — what the stock currently trades for

Key question:     If the market price differs from your estimated fair value — what should you do?

Market Price vs. Intrinsic Value: Who Do You Trust?

Your valuation model estimates the stock’s value at $30 per share

The same stock is currently trading at $20 per share

The $10 difference indicates that many investors disagree with your assessment

[5] Class 20

Corporate Valuation

 COMM 298 2025 Winter Term 1: Introduction to Finance Jose Pizarro

Objective

Define and distinguish corporate value and enterprise value

Explain why enterprise value is widely used in practice

Use valuation multiples (like EV/EBITDA and P/E) to estimate firm and equity value

Compare DCF (intrinsic) and relative (comps) valuation methods

Judge a valuation result and make a basic buy/hold/sell recommendation

Measuring Firm Value: Value vs. Enterprise Value

Corporate Value (also called Firm Value or Total Company Value: V)

The total value of the business, including both:

Core operating assets, and

Non-core assets (e.g., excess cash, investments, unused real estate)

Represents the value of everything the company owns

Enterprise Value (EV)

The value of a company’s core operating business

Focuses on the value of operations available to all capital providers (debt and equity)

[6] The market price thus reflects the aggregated beliefs and information of all participants

When to Trust the Market, and When to Trust Your Valuation

The accuracy of a pricing model depends on how well we can estimate:

The firm’s expected future cash flows

The expected return, which reflects risk

The quality of these estimates depends on the quality of our information

The market price of a publicly traded stock reflects high-quality, aggregated     information from thousands of informed investors

Only in rare cases do we possess better information than the market

In those rare cases, it may be justified to challenge the stock price

How Market Prices Reflect Information

Suppose new information suggests AAPL’s stock is undervalued

Informed investors buy the stock to profit from the insight

Their buying pressure drives up the price

The stock price rises until it fully reflects the new information

 In short: prices adjust as investors act on new information
Produce EXACTLY 4 options. EXACTLY ONE option has role "correct".
Every option has a per-option explanation. Assign each non-correct option one role from:
  - "common-misconception": a plausible error a student commonly makes
  - "partially-correct": right idea, incomplete or misapplied
  - "clearly-wrong": obviously incorrect to a prepared student
AT LEAST ONE option MUST be "common-misconception". The practice loop offers its retry only when a student picks one, so a question without it silently loses that behaviour. A question is rejected and regenerated without one.
DISTRACTORS ARE WRONG METHODS, NOT WRONG ARITHMETIC. A distractor must be the
number a student actually reaches by reasoning incorrectly — discounting the
wrong number of periods, compounding forward instead of back, dropping a term,
using the wrong rate. Do NOT take the correct formula and mutate an operator:
  good:  PAYMENT*(1+r)^n        compounded forward instead of discounting
  good:  PAYMENT/(1+r)^1        discounted one period regardless of the term
  bad:   SALES*(MULTIPLE^2)     squaring a multiple is not a mistake anyone makes
  bad:   SALES+MULTIPLE         swapping x for + is arithmetic noise
  bad:   (MULTIPLE+1)*SALES     an arbitrary tweak, not a misconception
If you cannot name the student who would make the mistake, it is not a
distractor — find a real one from the course material.
FORMATTING. The stem, every option, and every explanation are rendered as
markdown with KaTeX math. Write formulas as LaTeX, not as flat ASCII:
  - inline math between single dollars: $PV = \frac{C}{(1+r)^n}$
  - display math between double dollars for a full worked line:
      $$PV = \sum_{t=1}^{n} \frac{C_t}{(1+r)^t}$$
Two rules the renderer imposes, and both fail SILENTLY when broken — the
math renders as literal source text rather than erroring:
  1. Never use \( \) or \[ \]. The markdown pass runs first and strips
     their backslashes, so KaTeX never sees a delimiter.
  2. A math span must never contain a dollar followed by digits and then a
     space: that reads as a currency amount, not as math. In practice, start
     math with a symbol or a command — never a digit — and keep currency
     symbols OUTSIDE the math:
       good:  A payment of $500 grows to $P \times 1.05$.
       good:  $\text{FV} = 500 \times 1.05$
       bad:   $500 \times 1.05$      (opens with a digit)
       bad:   $\$500 \times 1.05$   (escaped amount, then a space)
     The same applies right after $$: write $$\text{PV} = \sum ...$$, never
     $$500 \times ...$$
  3. Never write a slot or derived-value NAME inside \text{}. Those names
     contain underscores, and escaping an underscore inside math is where
     stray characters creep in and break the whole span. Use a short symbol
     and let the placeholder carry the number:
       good:  $r = \frac{R}{100}$ where the rate is {{RATE_PCT}}%
       bad:   $r = \frac{\text{RATE_PCT}}{100}$
Prose stays prose; only the formulas are LaTeX.
Show the working in the EXPLANATION — that is what that field is for, so a
display line there beats describing the arithmetic in words. Do NOT put the
working in an option: an option states an ANSWER, never the formula that
produces it. See THE OPTION CONTRACT below.
NUMERICAL QUESTIONS — MANDATORY.
If answering requires ANY computation, set "numericKind": "numeric".
NEVER write a computed number anywhere — not in the stem, an option, or an explanation.
State the inputs as variable slots and every displayed value as a formula; a
deterministic evaluator computes them at serve time, and each student sees different
numbers.
  - "paramSlots": the inputs, e.g.
      [ { "name": "PAYMENT", "min": 100, "max": 900, "step": 100 },
        { "name": "RATE_PCT", "min": 4, "max": 12, "step": 2 } ]
  - "derivedValues": the correct answer AND every distractor, e.g.
      [ { "name": "PV", "formula": "PAYMENT/(1+RATE_PCT/100)^2" },
        { "name": "PV_COMPOUNDED", "formula": "PAYMENT*(1+RATE_PCT/100)^2",
          "errorModel": "compounded forward instead of discounting back" } ]
    These formulas are EVALUATOR syntax and are NEVER LaTeX: they are parsed
    and computed, not displayed. Keep writing PAYMENT/(1+RATE_PCT/100)^2 —
    a \frac{}{} here fails to parse and the question is rejected. LaTeX
    belongs only in the stem, option and explanation TEXT.
  - BUILD THE ANSWER IN STEPS. "derivedValues" are evaluated IN ORDER, and a
    later formula may use any earlier one BY NAME. Prefer several short named
    steps to one long expression:
      good:
        DEBT_VALUE   = PV(YTM_PCT/100, 16, FACE_DEBT*COUPON_PCT/100) + PV(YTM_PCT/100, 16, FACE_DEBT)
        EQUITY_VALUE = SHARES*PRICE
        V            = DEBT_VALUE + EQUITY_VALUE
        COST_EQUITY  = RF_PCT/100 + BETA*MRP_PCT/100
        WACC         = (EQUITY_VALUE/V)*COST_EQUITY + (DEBT_VALUE/V)*(YTM_PCT/100)
      bad:  all of that inlined as one 400-character expression with the two
            PV(...) calls repeated six times.
    A step that no option displays is perfectly allowed and is exempt from
    the option contract below — name it and reuse it.
    This is not a style preference. Long nested expressions are exactly where
    real generations drop a parenthesis; the parser then reports "trailing
    input after formula" and the question is rejected outright. If a formula
    runs past roughly 100 characters, or nests more than three deep, SPLIT IT.
    If you cannot express a quantity inline, give it its OWN step. Never fill
    the gap with a stand-in: (PV(1,1,1) - PV(1,1,1)) and a hardcoded 2.2e6
    were both produced in real runs — the first is identically zero, so it
    divided the answer by zero on every draw.
    Every distractor MUST carry an "errorModel" naming the specific mistake it
    represents, and its formula must genuinely implement that mistake.
    Name the MISTAKE, never the role. "common-misconception" is a role, not an
    errorModel — a real generation returned exactly that on every distractor
    and the question was regenerated. Write "compounded forward instead of
    discounting back" or "used the coupon rate in place of the yield".
    The CORRECT value MUST NOT carry an "errorModel" — it represents no mistake.
    Omit the field entirely rather than describing the right answer in it.
  - THE OPTION CONTRACT — read this twice. It is checked FIRST, before any
    formula is evaluated, so breaking it rejects the question before the
    collision check below is even reached. Three consecutive live
    generations died here.
    An option text IS a value. Not a sentence containing a value — the whole
    option is the quantity, plus at most a currency symbol, unit or percent
    sign, and it carries EXACTLY ONE {{NAME}} from "derivedValues":
      good:  "${{PV}}"
      good:  "{{IRR_PCT}}%"
      bad:   "${{PAYMENT}}"                  an INPUT slot is not an answer
      bad:   "-{{CF0}} + {{CF1}}/(1+r)"      the formula, not the answer
      bad:   "Accept the project"            no computed value at all
      bad:   "Accept the project. {{NPV}}"   a sentence with a value stapled
             on. This is the worst of the four: it passes the automatic
             check and reaches a student as a decision followed by an
             unrelated number. If you find yourself appending a value to a
             sentence to satisfy this rule, the question is CONCEPTUAL —
             go and set "numericKind": "conceptual" instead.
    Input-slot placeholders may also appear in an option, but they do not
    count toward this rule and can never stand in for the derived value.
    Two options must never name the same derived value.
    The STEM may use slot placeholders freely — this rule is about options.
Formula syntax: + - * / ^ ( ), variable names, and these functions only:
  PV(rate, periods, amount), FV(rate, periods, amount), PMT(rate, periods, principal),
  NPV(rate, cf1, cf2, ...), IRR(cf0, cf1, ...), ln, exp, sqrt, abs, min, max,
  round(value, decimals), N(x) for the standard normal CDF, and
  SUM(index, from, to, body) for series such as duration or amortization.
These functions are shorthand, not a limit: any closed-form finance formula can be
written with arithmetic alone (CAPM is RF + BETA*MRP; Gordon growth is D1/(R-G)).
Transcribe the formula the course material itself uses.
That list is the WHOLE grammar. There are no comparisons (> < >= <= == !=),
no conditionals, no ternary ?:, no booleans, and no if(). A formula like
"max(1, min(2, (PI_X>0?1:0) + (PI_Y>0?1:0)))" does not parse and the question
is rejected. If you are reaching for a comparison, you are encoding a DECISION
as a number — that question is "conceptual", not "numeric".
Two rules the automatic verifier enforces — a question breaking either is rejected:
  1. Ranges must never let a formula break. A rate a formula divides by must not
     include 0, and no range may drive a value beyond about 1e12.
  2. Option values must differ for EVERY combination of values in range.
THE PAIRWISE COLLISION CHECK — do this before you answer, it is the single most
common reason a question is rejected. Take every PAIR of option formulas, set them
equal, and solve. If any solution falls inside the declared ranges, the two options
show the same number on that draw and the question is unanswerable. Examples of
pairs that look fine and are not:
  - "A" and "B" (two bare slot values) are equal wherever their ranges OVERLAP.
  - "A - B" and "B" are equal when A = 2*B.
  - "A - B" and "B - A" are equal when A = B (both 0).
  - "A * (1+r)^n" and "A" are equal when n can draw 0.
THE FIX, and prefer this one: give the slots DISJOINT, WELL-SEPARATED ranges. If A
is always far larger than B, then A never equals B, A-B never equals B, and A+B
never equals either. For a firm with cash in and cash out, use something like
CASH_IN 3000..5000 and CASH_OUT 200..1000 rather than two ranges that both span
200..5000. Separated ranges are also more realistic than overlapping ones.
If separation is impossible, change the mistake instead: use a wrong rate, a
dropped term, or a wrong operand rather than a formula that can coincide.
Two collision traps seen in real generations, both from distractors that are
RATIOS or PERCENTAGES rather than amounts — the sizes cancel, so widening the
ranges does not separate them:
  - a distractor that differs only by a factor which some draw makes 1;
  - two "wrong rate" distractors whose rates coincide where their ranges meet.
For a ratio-valued answer, separate it by the STRUCTURE of the mistake (a
dropped term, a wrong denominator), not by the input ranges.
If answering requires NO computation, set "numericKind": "conceptual" and omit
paramSlots and derivedValues entirely.
ALSO conceptual, even though arithmetic is involved: a question whose OPTIONS
are decisions or statements rather than values — "Accept the project" /
"Reject the project", "The NPV rule and the IRR rule agree", and so on. Those
options cannot satisfy the option contract, because there is no single
computed value for them to display. Pick one shape and commit to it:
  - want the decision tested? -> "conceptual", no slots, no derivedValues;
  - want the arithmetic tested? -> "numeric", and every option is a VALUE.
Do not try to have both in one question.
TWO WORKED EXAMPLES — study the SHAPE, never reuse the subject.

Example of a NUMERIC question (answering requires arithmetic, so every option
is a computed value and the inputs are slots):
{ "numericKind": "numeric",
  "stem": "A bond pays {{COUPON}} annually for {{YEARS}} years. At a yield of {{YIELD_PCT}}%, what is its price?",
  "paramSlots": [ { "name": "COUPON", "min": 40, "max": 90, "step": 10 } ],
  "derivedValues": [ { "name": "PRICE", "formula": "COUPON*(1-(1+YIELD_PCT/100)^(-YEARS))/(YIELD_PCT/100)" } ],
  "options": [ { "key": "A", "text": "{{PRICE}}", "role": "correct" } ] }

Example of a CONCEPTUAL question (answering requires judgement, so the options
are statements and there are no slots at all):
{ "numericKind": "conceptual",
  "stem": "A country raises its policy rate while inflation expectations stay unchanged. Why would its currency tend to appreciate?",
  "options": [
    { "key": "A", "text": "Higher real returns attract foreign capital, raising demand for the currency", "role": "correct" },
    { "key": "B", "text": "Higher rates increase exports, and export receipts are paid in the domestic currency", "role": "common-misconception" } ] }

Note what makes the second one conceptual: it CONTAINS no computation, even
though a rate is mentioned. Numbers a question states are facts; only numbers a
student must CALCULATE make it numeric.

WHAT MAKES A DISTRACTOR A MISCONCEPTION. It must be a claim a real student
holds — a cause confused with an effect, a rule applied outside its conditions,
a correlation mistaken for a mechanism. Worked:
  good:  "compounded forward instead of discounting back" — a method error with
         a name, and a student you can picture making it.
  good:  a statement that is TRUE but answers a different question than the one
         asked — the student who picks it read the stem too quickly.
  bad:   a flat denial of the concept ("interest rates do not affect exchange
         rates") — nobody reasoning about the question believes that.
  bad:   an arbitrary mutation of the correct answer — arithmetic noise, not a
         misconception anybody would arrive at.
If you cannot name the student who would choose it, and say what they were
thinking when they did, it is not a distractor.

Respond with ONLY this JSON shape:
{ "stem": string, "difficulty": "easy"|"medium"|"hard",
  "numericKind": "numeric"|"conceptual",
  "paramSlots": [ { "name": string, "min": number, "max": number, "step": number } ],
  "derivedValues": [ { "name": string, "formula": string, "errorModel": string } ],
  "options": [ { "key": string, "text": string, "role": string, "explanation": string } ] }
Use option keys "A","B","C","D".
```

</details>

### D31

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 2  **derived:** 4

**Stem.** A company has core operating assets valued at {{OPERATING_VALUE}}, excess cash of {{CASH_VALUE}}, and debt and equity claims on the business. Which amount represents enterprise value, given that enterprise value focuses on the core operating business available to all capital providers?

- **[A]** ${{EV}}  _<correct>_
  - _Enterprise value is the value of the core operating business available to both debt and equity providers. Therefore, it equals the operating-asset value: $EV = {{OPERATING_VALUE}}$._
- **[B]** ${{CORPORATE_VALUE}}  _<common-misconception>_
  - _This is corporate value, not enterprise value. A student choosing it has correctly recognized that the company owns both operating and non-core assets, but has confused total company value with the narrower value of core operations: $$V = 	ext{operating value} + 	ext{non-core assets}.$$_
- **[C]** ${{CASH_ONLY}}  _<clearly-wrong>_
  - _Excess cash is a non-core asset. Enterprise value does not equal the cash balance; it focuses on the value generated by the company's core operating business._
- **[D]** ${{OPERATING_LESS_CASH}}  _<partially-correct>_
  - _This choice recognizes that cash is separate from core operations, but applies the wrong treatment by subtracting it from operating value. The course distinction is that corporate value includes operating assets plus non-core assets, whereas enterprise value is the operating value itself._

> **Reviewer (`high`): `flag`** — The core model is factually sound: enterprise value is represented by the operating-asset value, and the distractor formulas implement plausible inclusion or subtraction errors. However, the stated medium difficulty is not calibrated: the stem explicitly defines enterprise value as the core operating business and the correct answer is a direct one-step substitution. The cash-only distractor is also very clearly wrong, reducing diagnostic value. It is usable if downgraded to easy or revised to require a genuine firm-versus-enterprise reconciliation.

### D32

- **numericKind:** `numeric`  **difficulty:** `medium`  **slots:** 4  **derived:** 4

**Stem.** A company has core operating assets worth ${{OPERATING_VALUE}}, non-core assets worth ${{NONCORE_VALUE}}, debt of ${{DEBT_VALUE}}, and equity of ${{EQUITY_VALUE}}. Which computed amount is the enterprise value, defined as the value of the core operating business available to both debt and equity providers?

- **[A]** ${{ENTERPRISE_VALUE}}  _<correct>_
  - _Enterprise value focuses on the core operating business and is available to both debt and equity providers. Therefore, it equals the operating-assets value: $\text{EV} = \text{Operating value} = {{OPERATING_VALUE}}$._
- **[B]** ${{CORPORATE_VALUE}}  _<common-misconception>_
  - _This is corporate value, not enterprise value. A student choosing it is likely remembering that firm value covers all assets but overlooking that enterprise value excludes non-core assets. The calculation is $\text{Corporate value} = \text{Operating value} + \text{Non-core value} = {{OPERATING_VALUE}} + {{NONCORE_VALUE}}$._
- **[C]** ${{CAPITAL_PROVIDER_TOTAL}}  _<partially-correct>_
  - _Debt and equity are both capital providers, so this reflects an important part of the enterprise-value concept. However, the course definition identifies enterprise value by the value of core operations, not simply by adding the two financing claims in this scenario. The calculation is $\text{Debt} + \text{Equity} = {{DEBT_VALUE}} + {{EQUITY_VALUE}}$._
- **[D]** ${{OPERATING_PLUS_DEBT}}  _<clearly-wrong>_
  - _Enterprise value is capital-structure neutral; debt is not added to the core operating value in the definition given here. This amount mixes an operating measure with one financing source: $\text{Operating value} + \text{Debt} = {{OPERATING_VALUE}} + {{DEBT_VALUE}}$._

> **Reviewer (`high`): `flag`** — The core formula correctly models the stated definition of enterprise value, and the other formulas represent plausible alternative calculations without arithmetic issues. However, the question is labeled medium while the correct answer is a direct one-step identification of OPERATING_VALUE from the stem, so its reasoning demand is too low. Distractor D is also a relatively nonstandard error, making it less pedagogically strong. Revise the setup or require a multi-step distinction to meet medium difficulty.

### D33

- **numericKind:** `conceptual`  **difficulty:** `medium`  **slots:** 0  **derived:** 0

**Stem.** A company has core operating assets worth {{OPERATING_VALUE}}, excess cash worth {{CASH_VALUE}}, and debt and equity claims on the business. Which value should be used to compare the core operations of this company with another firm that has a different mix of debt and equity financing?

- **[A]** Enterprise value  _<correct>_
  - _Enterprise value focuses on the value of the core operating business available to all capital providers, including debt and equity. Because it is capital-structure neutral, it is better for comparing firms with different financing mixes._
- **[B]** Corporate value, including excess cash  _<common-misconception>_
  - _This reflects the common misconception that the value of everything the company owns is always the appropriate comparison measure. Corporate value includes both core operating assets and non-core assets such as excess cash, whereas enterprise value isolates core operations._
- **[C]** Equity value only  _<partially-correct>_
  - _Equity value represents the claim of shareholders, but the question asks for the value of operations available to all capital providers. Excluding debt claims would not provide the capital-structure-neutral operating comparison described in the course material._
- **[D]** The market price of one share  _<clearly-wrong>_
  - _A share’s market price reflects the aggregated beliefs and information of market participants about that stock. It is not a measure of the entire core operating business and cannot by itself compare firms’ operations._

> **Reviewer (`high`): `flag`** — The answer and explanations are factually accurate, aligned with distinguishing enterprise value from value including non-operating cash, and the distractors are generally plausible. However, the item is essentially a direct definition-recognition question: the phrases “core operations” and “different mix of debt and equity financing” point immediately to enterprise value, making it more suitable as easy than medium. Also, “corporate value” is not universally standard terminology and could be clarified or replaced with the course’s exact term (such as firm value).

### Tally

| Variant | Outcomes |
|---|---|
| B3 | numeric / flag · numeric / flag · numeric / flag |
| D3 | numeric / flag · numeric / flag · conceptual / flag |

---

# Analysis of experiments 2 and 3

## Experiment 2 — few-shot does NOT break routing, but it is not free either

| | routing | verification proof | reviewer |
|---|---|---|---|
| **A2** baseline | 3/3 numeric ✅ | **0/3** | flag, flag, flag |
| **B2** few-shot | 3/3 numeric ✅ | **1/3** | **reject, reject**, flag |

**The regression I was most worried about did not happen.** Both arms produced
numeric questions on a computational LO; the conceptual exemplar did not tempt
the model away from arithmetic. Routing is robust in both directions.

**But B2's reviewer verdicts are worse**, and the verdicts differ in KIND, not
just severity. A2's three flags are all the same mild complaint. B2's rejects
are structural:

> *"WRONG_BETA is not [sound]. It computes only the unweighted sum of the betas,
> not an expected return, yet is displayed as a percentage answer"*

> *"Option D becomes identical to the correct formula when BETA=1.0, which is an
> allowed parameter value"*

One reading is that B produced more ambitious distractors that broke more often.
At n=3 that is speculation. What it does establish: **shipping the exemplars
globally is not obviously safe for numeric questions**, even though it is clearly
good for conceptual ones.

## Experiment 3 — worked distractor pairs made NO measurable difference

| | reviewer |
|---|---|
| **B3** few-shot only | flag, flag, flag |
| **D3** + worked distractor pairs | flag, flag, flag |

Six flags, all for the same reason, and the reviewer *praised* the distractors in
both arms — *"the distractors represent plausible misconceptions with formulas
that implement those errors"*.

**So the distractor pairs should not ship.** They cost ~180 tokens on every call
and bought nothing measurable. That was my suggested alternative to Saurav's
extra exemplars, and it is now the second idea of mine this session that the
evidence has not supported.

Distractor quality is **not** the bottleneck. It is the thing the reviewer keeps
saying is fine.

## The finding that matters most, from all 12 numeric questions

**Two faults dominate, and neither is what we set out to fix.**

**1. Slot ranges collapse distractors onto the correct answer — 5 of 6 in
experiment 2 died this way**, all with the same shape:

```
options CAPM_RETURN and NO_BETA_RETURN are identical (seed 1000006)
options EXPECTED_RETURN_PCT and WRONG_BETA_INVERSE_PCT are identical (seed 1000006)
options CAPM_RETURN and UNLEVERED_MARKET_PREMIUM are identical (seed 1000006)
```

The reviewer diagnosed the cause unprompted: **`BETA = 1.0` is an allowed draw,
and at beta 1 the "ignored beta" distractor IS the correct answer.** The prompt
already warns about collisions in the abstract; it never says that a slot range
must EXCLUDE the value at which a distractor degenerates. This is the single
largest cause of numeric questions that can never serve.

**2. Difficulty is miscalibrated in 12 of 12 questions.** Every flag in both
experiments says some version of:

> *"only a one-step substitution, so it is miscalibrated… should be labeled easy
> or require additional reasoning"*

This is exactly the complaint recorded in STATUS on 2026-08-14 — *"every recent
question is labelled hard and is a one-step substitution"* — now measured across
twelve questions by an independent judge rather than by impression.

## Revised recommendation

Ordered by weight of evidence, which is **not** the order we started with:

1. **Ship the gate narrowing.** Independent of everything here, already written
   and mutation-verified, and required before conceptual questions serve at all.
2. **Fix slot-range degeneracy.** Tell the generator that a range must exclude
   values where a distractor collapses onto the correct answer, with `BETA = 1.0`
   as the worked case. Strongest evidence of anything measured: 5/6.
3. **Fix difficulty calibration.** State that supplying the formula and asking
   for one substitution is `easy`, whatever the arithmetic looks like. 12/12.
4. **Ship the exemplars for CONCEPTUAL only** — proven 0/3 → 3/3 there, and
   not clearly safe on numeric. If they are appended to the shared prompt they
   affect both; that argues for the branch after all, but on *quality* grounds
   rather than the routing grounds the branch was originally proposed for.
5. **Do not ship worked distractor pairs.** No measured effect.

## What this whole exercise changed

Three of my positions did not survive contact with evidence: that the prompt
biased routing toward numeric (it does not), that the branch trigger was
workable (the preset can contradict the edited prompt), and that worked
distractor pairs would help (they did not). Saurav's few-shot proposal beat the
branch on the conceptual test and cost far less.

The two faults with the strongest evidence — degenerate slot ranges and
difficulty labelling — were not on the original plan at all.

---

# Experiment 5 — tasks 2 and 3 measured against their own baselines

Same LO (CAPM), same instructor prompt, same settings as experiment 2, after the
prompt gained an explicit identity-element collision rule and a difficulty
self-assessment instruction. **4 generations.**

| Metric | Baseline (exp 2) | After tasks 2+3 |
|---|---|---|
| Verification proof | 0/3 (A2), 1/3 (B2) | **0/4** |
| Difficulty returned | `medium` 3/3 | **`medium` 4/4** |
| Reviewer | flag ×3 | reject ×2, flag ×2 |

**Neither fix worked.** This is a negative result and is recorded as one.

## Task 2 half-worked, and the failure moved rather than went away

Two of four generations still declared a beta range that draws exactly 1.0
(`0.6..1.8 step 0.2`) — the precise mistake the prompt now warns about by name,
with a worked remedy. The reviewer caught it and said so:

> *"the parameter range includes beta = 1.0. In that case, the correct CAPM
> formula RF + beta(MARKET − RF)…"*

The other two **did** shift the range away from 1.0 (`0.6..0.9`) — and then
collided anyway, in a new way:

> *"Options B and C are algebraically identical for every parameter set: B
> computes RF + (MARKET − RF), which always equals MARKET, exactly matching
> option C."*

`RF + (M - RF) ≡ M` is an identity for **every** draw, not a degenerate one. So
the model followed the new rule, avoided the named trap, and produced a worse
collision that no range choice could fix. Narrowing the guidance moved the error
rather than removing it.

## Task 3 did not move at all

All four still returned `medium`, and the reviewer still flagged the calibration:

> *"the stated medium difficulty is mi[scalibrated]"*

Asking the model to grade its own output changed nothing measurable.

## What this actually establishes

**Three separate attempts have now failed to fix option collisions by prompt** —
the original PAIRWISE COLLISION CHECK, its ratio/percentage addendum, and this
identity-element rule. The instruction is explicit, worked and correct, and the
model still writes colliding formulas. That is enough evidence to stop treating
this as a prompt problem.

**The gates are working; the loop is not.** The verifier caught 4/4 and the
reviewer caught 4/4, so nothing unservable can reach a student. But the pipeline
produced **zero servable questions**, which is a throughput failure rather than a
safety one.

**The structural cause:** `generateValidQuestion` retries on
`optionShapeValid` and `errorModelsNameMistakes` only. `verifyGeneratedNumerics`
runs in the CALLER, after generation is finished — so a collision never triggers
a retry. The generator is never told it failed, and never gets a second attempt
at the one fault that accounts for nearly every dead question.

**Proposed fix, and it is code rather than prose:** move verification inside the
generator's retry loop and feed the failure string back into the retry prompt —
*"your option X and option Y are identical at seed N; fix that specific
collision"*. The evaluator already produces that sentence; nobody shows it to the
model. This is the same shape as the planned regeneration change, which feeds the
reviewer's critique back for the same reason.

The prompt changes from tasks 2 and 3 are kept — they are accurate, they cost
little, and the reviewer's own reasoning now echoes them — but they are **not**
the fix, and this file should not be read as saying they were.

---

# Experiment 6 — the retry loop (code, not prompt)

Same LO (CAPM), same instructor prompt, same settings, through the real
`runGenerationPipeline` so the retry, validator and reviewer all ran as in
production. **4 questions.**

| Metric | Baseline (exp 2) | After prompt fixes (exp 5) | **After the retry loop** |
|---|---|---|---|
| Verification proof | 0/3 | 0/4 | **4/4** |
| Reviewer | flag ×3 | reject ×2, flag ×2 | **pass ×4** |

**Zero to four.** The pipeline had never produced a servable numeric question in
any measured run; it now produced four out of four, and the reviewer passed all
of them.

## Why this worked when three prompt attempts did not

Verification used to run in the CALLER, after generation had finished. A question
whose options collide was never retried, and **the model was never told**. The
generator retried only on option SHAPE — a check that almost never fires — so the
one fault responsible for nearly every dead question had no feedback path at all.

The loop now verifies before returning and, on failure, quotes the verifier's own
sentence back into the retry prompt:

> *"YOUR PREVIOUS ATTEMPT WAS REJECTED by the deterministic verifier… 'options
> PV_DUP and PV are identical (seed 1000003)'… Fix THAT fault specifically."*

The general rule was already in `GENERATOR_PROMPT`, stated three different ways,
and the model followed it and collided anyway. **What had never been tried was
telling it which two values collided in the question it had just written.**

Deliberately preserved: a question that fails every attempt is still persisted as
an unproven Draft, exactly as before, so an instructor can widen a range and
rescue it. Discarding it would have quietly lowered the count a run reports and
removed the only path to fixing it.

## The lesson worth keeping

Three prompt revisions moved the metric by nothing. One feedback path moved it
from 0 to 4. **The model was not failing to understand the rule; it was failing
to notice it had broken it** — and no amount of restating the rule fixes that.

Difficulty still returns `medium` on all four, so experiment 5's task-3 finding
stands unchanged. The difference is that the reviewer now passes them, having
previously flagged the calibration — consistent with the retried questions being
genuinely better, though that is inference rather than measurement.

### Arm: A-baseline-no-exemplar

| LO kind | numericKind | proof | difficulty | reviewer |
|---|---|---|---|---|
| COMPUTATIONAL | `numeric` | **PROOF** | medium | `pass` |
| COMPUTATIONAL | `numeric` | **PROOF** | medium | `pass` |
| COMPUTATIONAL | `numeric` | **PROOF** | medium | `pass` |
| CONCEPTUAL | `conceptual` | none | medium | `pass` |
| CONCEPTUAL | `conceptual` | none | medium | `pass` |
| CONCEPTUAL | `conceptual` | none | medium | `pass` |

### Arm: B-with-conceptual-exemplar

| LO kind | numericKind | proof | difficulty | reviewer |
|---|---|---|---|---|
| COMPUTATIONAL | `numeric` | **PROOF** | medium | `pass` |
| COMPUTATIONAL | `numeric` | **PROOF** | medium | `pass` |
| COMPUTATIONAL | `numeric` | **PROOF** | medium | `pass` |
| CONCEPTUAL | `conceptual` | none | medium | `pass` |
| CONCEPTUAL | `conceptual` | none | medium | `pass` |
| CONCEPTUAL | `conceptual` | none | medium | `flag` |

## Task 5 result — the exemplar is NOT shipped

| Arm | Computational LO | Conceptual LO |
|---|---|---|
| **A** current pipeline, no exemplar | numeric 3/3, **proof 3/3**, pass ×3 | conceptual 3/3, pass ×3 |
| **B** + conceptual exemplar | numeric 3/3, **proof 3/3**, pass ×3 | conceptual 3/3, pass ×2, **flag ×1** |

**Numeric is unharmed** — the regression this test existed to detect did not
happen, and the exemplar can be ruled out as a cause of experiment 2's worse
numeric verdicts.

**But it shows no benefit either, and it cannot.** The exemplar's original
evidence was 0/3 → 3/3 reviewer passes on conceptual questions (experiment 1).
That baseline no longer exists: the retry loop and reviewer v2 have moved the
current pipeline to **3/3 passes without it**. There is no headroom left for an
exemplar to demonstrate value against, at any sample size.

**Decision: do not ship it.** ~250 tokens on every call, including numeric ones
it has nothing to say about, in exchange for nothing measurable.

Worth stating plainly: the plan's pre-registered rule was *"ship the exemplar
only if numeric output is unharmed"*, and numeric IS unharmed — so the rule as
written says ship. The rule was written when conceptual had a measured benefit,
and that premise is gone. Applying it mechanically would mean shipping an
addition whose entire justification has been absorbed by other fixes.

**The wider lesson from experiment 1 still holds, and it is the one that
mattered:** demonstration beat description. It just turned out the same problem
was better solved by showing the model its OWN failure (the retry loop, 0/4 →
4/4) than by showing it someone else's good example.

## Task 6 result — combined verification against the recorded baselines

Arm A above is the task 6 measurement. Against the numbers written down before
any of these changes:

| Metric | Before (exp 2 / exp 5) | **Now** |
|---|---|---|
| Verification proof, computational LO | 0/3, then 0/4 | **3/3** |
| Reviewer, computational LO | flag ×3, then reject ×2 + flag ×2 | **pass ×3** |
| Reviewer, conceptual LO | flag ×2 + reject ×1 (exp 1 baseline) | **pass ×3** |
| Conceptual questions that can serve at all | 2 of 6 stems (gate) | **6 of 6** |

One retry fired and succeeded during arm A —
`options CAPM_RETURN and MARKET_ONLY_RETURN are identical (seed 1000020)` — the
loop doing exactly its job on a fault that would previously have produced a dead
question.

**Difficulty is still returned as `medium` throughout**, so task 3's finding is
unchanged and remains the one open quality problem. The reviewer now passes
these questions rather than flagging calibration, which is consistent with the
retried questions being genuinely better — but that is inference, and the honest
statement is that the difficulty instruction still does not measurably work.
