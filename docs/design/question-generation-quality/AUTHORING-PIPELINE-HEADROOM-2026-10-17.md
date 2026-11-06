# Authoring pipeline input headroom

## Observed failure and scope

The earlier quality-review-only size check did not establish full-flow fit.
The frozen `authoring-flow-headroom-2026-10-17/run-r4` replay shows five actual
public-pipeline controls failing before the planning SDK response under a larger
202-head Bank. The same Bank also overflows historical planning, so this is
chiefly a pre-existing input-budget problem rather than five new retrieval
regressions. The supplied source packets, teacher clauses and retained candidate
responses are unchanged. The additional Bank heads are explicit synthetic data.

Grouping planner metadata alone exposed later generator and quality overflows.
Streamed generation is admitted using its serialized conversation envelope,
which includes escaping overhead; raw prompt length understated that cost.
Subsequent checkpoints retain each refusal and the exact code/prompts that
produced it. No cap was increased and no original passage, mandatory comparator,
candidate or teacher clause was shortened to obtain a passing result.

## Versioned implementation

Fresh durable v2 runs and new durable regeneration select the server-owned
`authoringPromptProtocol: "compact-authoring-v1"`. Enqueue, persisted run input,
worker restoration, exact retry, task-plan records and regeneration requirements
retain this explicit pin. Historical absence, same-request recovery and baseline/
v1 stay on their old rendering. Unknown values and non-v2 use fail before new
work; a stored task plan cannot be reused under a different selector.

`generation-planning-evidence.ts` groups only adjacent identical material/role/LO
identities. Every canonical ID, exact original text, order, chunk index, offset
and selection state remains recoverable. Selection coverage, damage, truncation
and unavailable provenance remain explicit; grouped text is not better source
or pedagogical coverage.

`generation-compact-instructions.ts` maps twelve exact owned instruction lines.
It never performs substring replacements over a completed prompt, user text or
serialized data. Unknown lines, the complete formula function reference, source
content and response schema remain unchanged. Numerical domains, visible inputs,
precision, decimal variation, rate conventions and formula syntax still bind.

The prospective intent/review branch factors repeated explanations once per
stage and shortens only owned source/Bank instruction headers. Complete source
and selected Bank JSON lines remain byte-identical, including mandatory full
question/options/feedback/formula content and coverage metadata. Current-course
retrieval, final admission, source/answerability/demand checks, semantic repair
allowance and all numerical gates are unchanged. Teacher prompt echoes may be
omitted only after exact equality with a complete required row or the exact
joined required rows. The complete required text remains in the prompt.

## Same-input measurements

These are conservative admission units, not tokenizer counts or provider usage.
The unchanged per-input ceiling is 24,000. Values below come from the actual
model-call admission callback, including streamed envelope overhead.

| Public control | r4 planning refused | r11 planning | r11 streamed generation | r11 last reached quality call |
| --- | ---: | ---: | ---: | ---: |
| P01 | 24,509 | 22,540 | 20,846 | 22,519 |
| P02 | 25,557 | 23,588 | 22,002 | 23,796 |
| P03 | 25,116 | 22,852 | 23,728 | Not reached: retained passage-reference failure |
| P04 | 24,492 | 22,523 | 21,875 | Not reached: retained hard-shape failure |
| CAPM | 24,554 | 22,289 | 22,894 | 23,366 |

R11 retains the original 47 scenarios and adds one separately labelled P02
public-path fault injection. Its quality prompt is admitted at 23,391, its
same-candidate schema correction at 23,796, and the actual JSON facade retry
after a deliberately non-JSON SDK response at **23,916**, leaving only **84**
units. That narrow margin is explicit; arbitrary larger sources, constraints,
failures or reasoning configurations are not proven to fit.

The final capture contains 48 scenarios and 105 raw/admission pairs: no fresh
input refusal, six preserved historical refusals. The original 98 aligned
captures retain 529 protected blocks, with eleven historical initial prompts
byte-identical. Production option shuffling and verifier timestamps are recorded
separately from immutable content. No data is silently changed to make a control
pass. The real provider, embedding, database, job and network boundaries report
zero attempts; six embedding/vector retrievals are labelled substitutes and 99
SDK responses are scripted. Reported provider input/output usage stays unknown.

Every public scripted flow still saves **zero Drafts**. A finished audit row
means the harness returned, not that authoring succeeded. Known P03 passage-ID,
P04 structural and injected negative/schema judgments remain failures. This
phase proves corrected input admission for the measured paths, not semantic
quality, valid yield, production latency, billing savings or a model ranking.

## Verification and retained failures

The combined affected source/Bank/outline regression run passes **39 suites /
1,274 tests**, with whole-project TypeScript and scoped lint checks recorded in
`audit-results/authoring-planning-repair-2026-10-17/`. Its predecessor stopped
when sandboxed Supertest could not listen; that console failure is retained and
the same local-only suite passes with scoped test execution permission. Earlier
overlapping focused results and stale prompt-literal test assertions remain
separate checkpoints, not additive counts. The unused Qdrant client initialization
in one unit harness is now mocked; its earlier denied compatibility attempt stays
in the predecessor log.

Exact code, inputs, responses, budgets, error paths and all intermediate captures
are linked from the English quality book and audit README. The book also retains
the separate supported-LO repair example and its initially overcompressed
synthetic wording. Scripted credit is not source-review or teacher proof.

New paid validation/model comparison remains pending explicit authorization
following the recorded automatic approval rejection. Historical declarations
cannot execute against these changed source bytes. Keep v2 opt-in; teacher
calibration, fresh valid-yield measurement, representative visual source coverage
and the Luna6/Sol6.1 comparison remain incomplete.
