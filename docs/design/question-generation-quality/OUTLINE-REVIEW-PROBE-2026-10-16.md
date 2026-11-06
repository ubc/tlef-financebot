# Independent source reading of the three-case outline review probe

This is an **agent-derived audit, not teacher or human gold**. It reads the
complete originals, exact LO wording, historical v1 rows and new v2 rows rather
than accepting reviewer explanations as truth. The structured trace is
`audit-results/quality-lab-2026-10-16-phase-two/outline-review-v2-probe/agent-source-audit.json`.
The audit made zero provider, database or network calls and changed no source,
fixture, prompt or TypeScript file.

All nine supplied source entries, representing eight distinct originals, match
their complete retained fixture chunks. All 20 quoted groups match their own
originals. Controls/results/origin byte hashes were also checked. The probe
changed the review schema, prompt and single-objective context together, so its
comparison with v1 is observational, not a randomized single-variable A/B.

## L14: source-supported bondholder protection

The LO asks learners to explain protective lending covenants, puttable bonds,
ratings-sensitive notes and hybrid conversion/warrant features. Its entire own
original, S50 / Chapter 2 chunk 68, explicitly describes:

- Restrictive investment, financing and dividend covenants in lending/bond
  agreements.
- Returning a puttable bond for face value when firm actions hurt holders.
- Interest adjusting to the firm's rating.
- Hybrid equity components allowing conversion into equity when advantageous.

The wording says these mechanisms **can** protect holders; it does not claim
unconditional protection or require option-pricing theory. The source-supported
v2 verdict is consistent with the actual original. V1 explicitly acknowledged
the same support but rejected the row for its topic placement: that is verified
source/grouping conflation. The new `topicFit: fits` remains a plausible editorial
judgment, not an established course taxonomy.

## L38: an actual assignment gap, not whole-chapter absence

The seven own originals S139–S145 support beta estimation uncertainty, reported
confidence ranges, R-squared/risk shares, historical Jensen's-alpha calculation,
CAPM required return, beta examples and macroeconomic demand sensitivity. S144
names alternative regression indices but supplies no corresponding beta results.
None of these seven sections explains whether historical alpha establishes
management skill or future performance.

The final LO nevertheless asks learners to distinguish historical alpha from
management-quality or future-return evidence. It does **not** assert that
positive alpha proves either. Historical performance and required-return tasks
are separately presented in S142/S144, so a narrower distinction is supported;
the stronger inference rule is not taught in this bound packet. Conservative
withholding is defensible, but the audit does not establish a universal teacher
answer or a false semantic verdict.

The old foreign citation S136 was actually relevant neighboring material:
Chapter 4 chunk 42 poses questions about whether Disney's positive historical
alpha indicates good management or a good future investment. Answers are
unmarked. For an outline, that explicit classroom activity can itself support
the scope of an LO asking learners to evaluate those claims. The absence of a
marked key does **not**, by itself, make that LO out of scope. It separately
limits what answer the system can justify when generating a new question.
The exact trace reveals an organization/binding mismatch:

| Stage | Observed assignment |
| --- | --- |
| Source extraction, item 134 / `C43.S1` | Extracts the capability later identified as E205: distinguish historical positive alpha from management/future-investment evidence. |
| Global learning-point inventory | E205 resolves to original S136, alongside E204 and E206. |
| Final organization, L36 | Receives E205/S136, but its LO wording concerns regression, risk attribution and calculating historical alpha; it omits management/future interpretation. |
| Final organization, L38 | Includes management/future interpretation in its wording, but omits E205/S136 from its assigned evidence/originals. |
| Historical review | L36 is source-supported but E205 is excluded from its covered points; L38 tries citing S136, which is foreign to its binding. |
| New single-objective probe | L38 cites only its valid S139–S145 originals and remains unsupported for its full wording. |

Therefore, “unsupported by L38's own packet” does not mean “absent from the
chapter.” The probe fixes citation validity, but does not repair this assignment
gap. Adding E205/S136 could support an activity-level LO, subject to review of
its actual wording and other claims. It would not automatically establish that
historical alpha proves management skill or predictability, or supply a verified
answer key for a generated question. No positive L38 verdict is imposed here.

The new `misgrouped` reason also appears overly literal: it objects that L38's
own originals do not teach operating leverage, although sibling L39 explicitly
covers operating leverage under the same broad topic using S146–S153. A child LO
need not teach every component of its topic heading. This is advisory grouping
calibration, independently of L38's content/evidence problem.

## Synthetic option-pricing negative

The negative replaces L14's wording with deriving/applying Black–Scholes,
European call/put valuation and implied-volatility calibration. Unchanged S50
mentions conversion options/warrants only as hybrid-bond features; it supplies no
pricing formula, valuation procedure or calibration premises. The unsupported
verdict is source-consistent. This is a synthetic control, not a retained
production failure or a general negative-detection accuracy estimate.

## Observed scope and next repair

The three reviews completed in 27.972 seconds with three observed sends, 5,079
reported input and 2,253 output tokens, and 42,046 conservative reservation units.
Hidden SDK retries remain unknown. No questions were generated, saved or adopted;
no LO was applied, and semantic repairs and teacher acceptance remain absent.

After the current frozen whole-pipeline baseline, a bounded repair could treat a
foreign alias as a possible assignment gap. Resolve it only against exact current
originals and global extracted points, propose a justified evidence-ID rebind or
narrower LO wording, compute a new canonical binding, then independently review
the resulting full own originals. Permit one charged cycle under existing
budgets. Do not automatically accept it, infer answers to unmarked questions, or
silently expand source scope. This repair is a proposal, not implemented or
validated by these three reviews.

A possible future support classification is `explicit-proposition`,
`formula-application` or `explicit-teaching-activity`. That would distinguish
curricular activity support from evidence that determines a question's answer.
It should preserve activities explicitly assigned by the instructor without
treating an unmarked exercise as an authoritative solution. This classification
is a design suggestion, not a new implemented schema or teacher gold.
