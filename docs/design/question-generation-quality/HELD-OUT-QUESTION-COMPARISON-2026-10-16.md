# Prospective held-out question-response comparison

Status: fixtures prepared; no model/database calls, question saves or adoption. The October 16 tuning matrix and phase-one ledger remain unchanged. A later phase will declare its cost envelope before execution.

## What is held out

The six cases use complete public Chapters 5, 8, 9, 10, 11 and 12: 340 PDF pages and 413 indexed original chunks. Their PDF hashes and material identities are disjoint from the Chapter 3/4 tuning archive. Each case intentionally selects bounded exact original chunks; all PDF bytes and complete chunk archives remain available. This is not a full-chapter coverage test.

The boundary is **held out from prior experimental question responses**. Engineers have inspected these passages to prepare the cases. The ten-file outline experiment may read them before the question comparison, and public-book pretraining exposure is unknown. Do not call this a source-naive, unseen-domain or training-held-out test. Do not retune prompts on these question outputs and continue calling the same cases held out: move such cases to tuning and replace them prospectively.

Bank comparators are explicitly synthetic engineering seeds authored before execution. They are not persisted Bank records, professor-approved questions or measured production history. Their complete questions, options, task descriptors, identities and hashes are frozen. Source worked examples remain teaching evidence; they never become Bank tasks automatically.

## Fixed cases and original coordinates

Chunk indices are zero-based, with exact half-open offsets `[0, chunk.text.length)`. The freeze command verifies every complete selected PDF hash, indexed chunk manifest, anchor and quoted range. It never reconstructs an unreadable relationship.

| Case | Complete source / selected chunks | Main check |
| --- | --- | --- |
| Depreciation decimal units | Chapter 5 / 21 | Compute the stated depreciation tax benefit with drawable decimal dollar/percentage inputs; Bank already tests non-cash-charge recall. |
| Interest tax condition | Chapter 8 / 2 | Distinguish the income-coverage caveat from Bank recall of deductibility and the annual tax-benefit formula. No invented carryforward/refund rules. |
| Debt currency and location | Chapter 9 / 53, 62 | Keep revenue currency separate from mine/customer geography; compare against the Bank's direct matching-rule task. |
| Thin dividend hardness | Chapter 10 / 36 | Preserve dividend-irrelevance assumptions and attempt a different inference without adding untaught signaling/clientele/agency models. Record achieved difficulty separately. |
| Valuation notation mismatch | Chapter 12 / 4, 5, 6, 14 | Preserve `ke`, `WACC` and equity/firm cash-flow ownership while diagnosing a mismatch beyond the two Bank recall tasks. |
| Missing chart point — safety negative | Chapter 11 / 15, 16 | Parsed Chrysler chart axes/series labels do not establish exact 1989 point values. Do not invent them or infer them from axis ticks. This does not claim that the original image lacks the data. |

The safety negative has a separate denominator. An unsupported exact-value candidate should stay withheld/uncertain; a safe shortfall is useful evidence, not a failure to maximize supply. No gold semantic judgment or teacher acceptance is fabricated. The other five cases also do not guarantee independent task supply: a thin packet plus overlapping Bank memory may legitimately require a shortfall or lower achieved difficulty.

## Paired protocol and evidence

Use the same five exact arms: `gpt-6-luna` low/medium/high and `gpt-6.1-sol` medium/high. Use two repetitions per case: 60 requested generator slots. Every arm/repetition receives the same byte-identical source/Bank/request/generator prompt for its case. Rotate arm order using the existing deterministic schedule; never let early repairs consume later initial slots.

`freeze-heldout.ts` recovers named, trusted pure production prompt/memory/citation declarations through the TypeScript AST. It does not import the side-effectful generation service, provider, database or embedding components. Full prompts, case controls, declarations, code hashes and original archives are saved prospectively. A changed prompt, source, Bank seed or validator is a new controlled run; preserve old evidence.

Use the existing `captureJson` / `createCapturedCompletion` recorder for full actual input/options and raw visible output for **every** attempt, including malformed JSON, correction and failure. Preserve requested/actual model identities, effort/caps, tokens, latency, omitted slots and withheld reasons. Hidden reasoning remains unavailable. Keep generator and assessor costs separate; sampled arithmetic, source judgments, requested-difficulty fulfillment, saved/adopted counts and teacher acceptance are distinct endpoints.

Keep the primary assessor fixed at `gpt-6.1-sol` / medium for comparability, with a prospectively fixed cap and identical review contract. Add a **second fixed assessor from another model family** if the declared budget supports it. First verify its exact available ID and supported options; do not invent an unavailable configuration. Blind both assessors to generator identity and previous verdicts. Report agreement and disagreements, including source/notation/novelty/difficulty differences. Shared-family agreement or majority vote is not teacher truth; professor labels and review minutes remain null until observed. This recommendation does not alter or relabel the completed single-assessor tuning pilot.

## Cost and execution boundary

The matrix contains 50 positive-supply slots and ten safety-negative slots. It needs at least 60 generator plus 60 primary-assessor sends before JSON corrections, secondary assessment or repair. One JSON correction per completion can raise that count to 240. If every assessor also needs its existing bounded citation correction, and each completion needs JSON correction, the conditional bound is 360 before logical content repair. The present phase-one runner hard-refuses more than 100 sends; its original ledger has not been reset. Do not silently execute part of the matrix or claim the remaining cells completed.

The root executor will declare a later versioned phase scope, send/correction/repair limits, per-request input/output caps and conservative token allowance before calls. Candidate-dependent assessor inputs need live admission against that same envelope. The prepared prompts' byte-based estimates establish input fit only; they do not predict actual billed tokens, useful-question cost or quality. A second assessor adds its own declared sends and costs. No new paid runner or scope override is implemented here.

Reproducible zero-call preparation:

```bash
node --import tsx scripts/quality-lab/freeze-heldout-corpus.ts \
  --corpus audit-results/quality-lab-2026-10-16/corpus-fixture.json \
  --tuning audit-results/quality-lab-2026-10-16/frozen-model-cases.json \
  --output audit-results/quality-lab-2026-10-16/heldout-preparation-new
```

The output directory must be new. This command reads local files only, records zero provider/database calls and does not touch the phase-one fixture, matrix, runner or ledger.
