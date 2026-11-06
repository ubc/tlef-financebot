# Source-bound reference for inspecting the six held-out cases

This is an **agent-derived inspection reference**, not teacher-approved gold,
human assessment or evidence that generation quality improved. It was derived
from the frozen case requests, supplied original-source passages and synthetic
Bank comparators. It does not use experimental question outputs. Keep this
document out of generator and model-assessor prompts; it is for subsequent
inspection of retained outputs.

Fixture:
`audit-results/quality-lab-2026-10-16/heldout-preparation-final/fixture.json`.
Its file SHA-256 is
`c2964712dbf626b8285fe5722ddf43fb4207a2fc2965aacc2de739ed9bda3835`;
its separate canonical fixture hash is
`0e0999b7eae412d09100e404d6af69b5c44815e87ba7baf515e3cb34038e6663`.
All 11 supplied passages were checked against their retained original chunk
offsets. All six `teacherAcceptance` fields remain null.

“Held out” means these cases and Chapters 5/8/9/10/11/12 were excluded from the
prior experimental question-response tuning cases. The engineering team has
inspected them, and outline work may already have exposed their source text.
Public pretraining exposure is unknown. Bank entries are prospectively authored
synthetic Draft comparators, not live instructor-approved question history.

## Inspection rules

Record source support, numerical validity, novelty, actual difficulty and
instruction compliance separately. A good source citation cannot prove a
correct inference. A new topic label, longer story, changed company name or
changed numbers cannot by itself prove a different task. Incorrect distractors
are expected in MCQs, but the stem must make their error decidable and their
explanations must preserve the source relationships.

For numerical candidates, inspect every permitted input combination when the
grid is small: displayed units, percentage conversion, formula results,
rounding and a unique correct option. Check the actual produced candidate's
grid; the arithmetic example below is not its answer key. A source-safe
lower-difficulty question and a question meeting the requested difficulty are
different outcomes. Schema/citation failures, budget stops and absent provider
output also remain separate from semantic failures.

## 1. Depreciation, decimals and units

Case `heldout-depreciation-decimal-units`; Chapter 5, `H5-C21` / chunk 21.
Requested: one easy independent calculation with small decimal input grids.

- Allowed relationship: for tax-deductible depreciation, dollar tax benefit is
  depreciation multiplied by the tax rate. A displayed percentage `t` means
  `t / 100`; the result retains depreciation's dollar unit. Depreciation is a
  non-cash expense. A non-deductible charge does not gain a tax benefit merely
  because it is non-cash.
- The supplied Bank task only asks why depreciation is added back to earnings
  when deriving cash flow. An actual tax-benefit calculation requires a distinct
  inference; another non-cash-charge recall question repeats that task.
- Withhold or correct candidates that omit the input unit, confuse percentage
  and decimal rates, treat depreciation itself as the tax saving, or invent
  deferred-tax, loss-carryforward or depreciation-schedule rules.

Independent arithmetic spot-check using newly chosen inputs, not source table
measurements: with rounding to cents declared explicitly,

| Depreciation ($) | Tax rate (%) | Exact benefit ($) | Benefit to cents ($) |
| ---: | ---: | ---: | ---: |
| 125.50 | 20.5 | 25.7275 | 25.73 |
| 125.50 | 36.1 | 45.3055 | 45.31 |
| 150.25 | 20.5 | 30.80125 | 30.80 |
| 150.25 | 36.1 | 54.24025 | 54.24 |

These values were computed with decimal arithmetic and half-up cent rounding.
They establish formula arithmetic only, not candidate option uniqueness or
implementation verification across every fresh draw.

## 2. Income condition on the interest tax benefit

Case `heldout-interest-tax-condition-memory`; Chapter 8, `H8-C2` / chunk 2.
Requested: a short medium scenario applying the income-coverage caveat.

- The source permits deducting interest when deriving taxable income and gives
  annual benefit as tax rate times interest payment, conditional on having
  income to cover the interest payment. Payments to equity, such as dividends,
  do not receive that stated deduction.
- Bank comparators already test interest deductibility and the multiplication
  formula. A distinct task must evaluate the missing/failed income premise,
  rather than rename the firm or change numbers in those two tasks.
- When the income condition is absent, the packet does not justify an
  unconditional full `tax rate × interest` benefit. It also does not supply rules
  establishing an exact partial benefit, a refund, a carryforward, or universal
  zero future benefit. Do not manufacture those conclusions.

An acceptable conceptual answer identifies why the claimed full benefit is not
established; no deterministic tax amount follows from the caveat alone.

## 3. Revenue currency versus geography

Case `heldout-debt-currency-not-location`; Chapter 9, `H9-C53` and `H9-C62` /
chunks 53 and 62. Requested: a medium inference contrasting location and
cash-flow currency.

- Source guidance concerns cash-flow/firm-value currency exposure and issuing
  some debt in the relevant cash-flow currency. Vale's mines are international,
  a substantial customer/revenue location is China, costs are local-currency,
  and revenues are US-dollar denominated. The recommendation is long-term
  dollar debt with local-currency hedging and, if possible, commodity linkage.
- The Bank already asks for the general currency-matching rule. A distinct task
  must resolve conflicting geographic and revenue-denomination information.
- Do not infer renminbi debt solely from Chinese customers, local-currency debt
  solely from mine locations, or a numerical optimal debt weight from geography.
  The source's reported historical dollar-debt percentage is not an optimal
  allocation derived for a new scenario. Dollar debt also does not eliminate
  all local-cost currency exposure.

No new optimal percentage or numerical exposure is determined by these passages.

## 4. Dividend irrelevance and honest difficulty

Case `heldout-dividend-thin-hardness`; Chapter 10, `H10-C36` / chunk 36.
Requested: a short hard independent task, with honest actual-difficulty reporting
if this thin packet cannot support one.

- Keep investment policy and its cash flows unchanged; preserve the stated
  absence of investor tax differences and of replacement-equity flotation costs
  or signaling consequences. Greater payout can require new equity for the
  same projects; increased dividend yield offsets lower expected price
  appreciation. Retained cash has the source-stated neutral value effect.
- Bank memory already tests the irrelevance conclusion. A potentially distinct
  task traces replacement financing and the payout/appreciation offset while
  preserving assumptions. Extra prose or asking the same conclusion through a
  named firm is insufficient novelty or difficulty.
- Do not invent signaling, clientele, agency, tax-rate or transaction-cost models
  to manufacture hardness. If an assumption is violated, this packet does not
  establish a quantified effect or its direction merely from that violation.

A source-safe task may earn medium or easy difficulty. Report that mismatch
separately; do not promote it to hard because the request says hard or force an
unsupported task to fill the slot. Independent hard supply is not guaranteed.

## 5. Valuation claim, cash-flow ownership and notation

Case `heldout-valuation-notation-mismatch`; Chapter 12, `H12-C4`, `H12-C5`,
`H12-C6`, `H12-C14` / chunks 4, 5, 6 and 14. Requested: a medium diagnostic task.

- Equity cash flows are residual after expenses, taxes, interest and principal;
  discount them at cost of equity, `ke` (equivalently typeset `k_e`). Firm cash
  flows are after operating expenses and taxes but before debt payments;
  discount them at `WACC`, which weights financing-component costs by market
  value proportions. The prose explicitly requires matching rate to cash-flow
  type and risk.
- Both direct rate-recall questions already exist in Bank memory. A distinct
  diagnostic question identifies an analyst's cash-flow claim, detects its
  specific incompatible rate, and explains the correction. Merely asking the
  same mapping in a longer story is not enough.
- Preserve the `ke`/`WACC` meanings. Do not swap ownership, replace WACC with an
  unweighted component, infer a debt-tax calculation, or recover new premises
  from a damaged PDF formula. The prose already supplies the intended mapping.

Without specified relative rates or other needed assumptions, the packet does
not determine the magnitude or direction of a mismatch's valuation error.

## 6. Missing year/series chart values: expected withholding

Case `heldout-chart-missing-point-negative`; Chapter 11, `H11-C15` and
`H11-C16` / chunks 15 and 16. Requested: actual Chrysler 1989 FCFE and cash
returned to stockholders from the chart.

The supplied representation retains axis ticks, years, series names and the
cash-balance label. It does not retain reliable point-to-year-to-series values
for the two requested 1989 quantities. It therefore cannot establish a numerical
answer. Honest withholding or an explicit missing-evidence diagnosis is the
expected source-safe behavior for this fixed packet. There is no Bank comparator.

Do not substitute axis ticks, the cash-balance series, a nearby year, public-book
memory or invented parameters. A synthetic numerical variant is not the requested
actual observation. This is a limitation of this packet, not proof that the
archived original PDF image lacks readable values. Obtaining new visual evidence
would change the declared input and require a separately identified experiment.

Report this negative separately from the five positive supply cases. Filling
its slot with a guessed number is a failure; withholding it must not be counted
as failure to generate an eligible positive question.
