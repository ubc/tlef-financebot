# Declared held-out comparison execution

Implementation status: offline controls, runner support and regression tests only. No actual phase declaration, ledger initialization, provider calls, database calls, saved Drafts or adoption were performed by this implementation task. The root executor creates the actual declaration after review. Existing phase-one and outline phase-two evidence must remain unchanged.

## Fixed experiment and execution order

The prepared fixture at `audit-results/quality-lab-2026-10-16/heldout-preparation-final/fixture.json` has control hash `0e0999b7eae412d09100e404d6af69b5c44815e87ba7baf515e3cb34038e6663`. Its six cases yield60 nominal cells: five exact generator arms, two repetitions and byte-identical per-case source/Bank/request/generator prompts. The denominators remain50 positive-supply slots and ten source-ambiguity negative slots. The fixture preparation document explains why these are question-response held-out cases, not source-naive or pretraining-held-out material.

The driver uses six contiguous10-cell shards of the single frozen schedule. Their IDs, arm rotations and nominal global positions remain unchanged. Each shard generates its ten initial candidates before judging its parsed candidates; judgment in an earlier shard therefore precedes generation in a later shard. This differs from the pilot's global generator-first stage ordering and is recorded explicitly. Execution is sequential. It does not add concurrency or claim a quality effect from scheduling.

The primary assessor remains exact `gpt-6.1-sol` at medium effort with a6000-token output cap; generator caps remain8000 across arms. Semantic content repair is disabled. Portable JSON correction and the existing bounded same-candidate citation/schema correction remain visible and charged. Unsupported, invalid, omitted and budget-stopped cells stay in the60-slot denominator. A withheld ambiguity-negative request is not counted as failed positive supply.

## Budget boundary

The supported prospective scope is `quality-lab-2026-10-16-heldout-phase-three`, with a shared360-send,4,000,000 conservative-unit,24,000 per-send-input ceiling. These constants constrain what a later root-authored declaration may activate; this document is not an initialized allowance.

The4m cap is a pragmatic hard stop, not a guarantee of completing every permitted correction path. Frozen generator first sends reserve1,124,170 conservative units. Assuming all actual judge inputs fit24k,120 first generator/judge sends have an upper bound of2,924,170 units. Portable JSON corrections for both stages can reach240 sends and5,855,660 units. Adding one same-candidate judge correction, with a JSON correction for each completion, can reach360 sends and9,455,660 units. Candidate-dependent inputs are checked before each actual send; the envelope may stop earlier.

Each shard's full permitted correction-path bound is computed from its exact generator prompts plus the24k judge-input ceiling. All are below2m. The native per-process budget is set to that shard bound and60 sends. Production defaults, native environment limits, Admin models and the prior pilot's100-send/2m defaults are preserved. The persistent shared4m ledger additionally charges all six processes without settlement, reset or replay refunds.

## Actual declaration contract

`heldout-phase.ts` validates a separate JSON declaration with version1 and phase `heldout-question-comparison`. The root executor supplies its exact SHA-256 and initializes a new ledger with exclusive-create semantics. `emptyHeldoutLedger()` is a pure constructor; it performs no file write.

The declaration binds the exact scope and limits above;8000/6000 stage caps; fixed Sol/medium judge; two repetitions; six shards of ten; zero repair candidates; fixture absolute path, file SHA and control SHA; the global schedule SHA; and two distinct immutable prior-ledger path/SHA/scope receipts labelled phase-one and phase-two. It states `pragmatic-hard-stop-not-a-completion-guarantee`. The initialized ledger must also carry the declaration SHA. Altering declaration bytes, sources, fixture controls, schedule, prior ledgers, caps, scope or paths fails closed before dispatch. Prior phase-two bytes must be frozen after its work ends, rather than pinned while it is still growing.

Actual model I/O uses the existing capture helper. Every attempted prompt, native options, visible raw output, error, model identity, latency and reported usage remains in shard transcripts, including parse/correction failures. Hidden model reasoning, hidden SDK retries and embedding costs remain separate. The driver freezes code hashes across all shards and rejects mixed-code receipts.

## Commands

This preparation command reads local files only and creates a new preflight evidence directory. It does not create a declaration or ledger:

```bash
node --import tsx scripts/quality-lab/run-heldout-comparison.ts \
  --fixture audit-results/quality-lab-2026-10-16/heldout-preparation-final/fixture.json \
  --output /tmp/heldout-preflight-new
```

After the root executor separately supplies the actual declaration and initialized ledger, the same command accepts `--heldout-phase <absolute-file>` and `--heldout-phase-sha256 <exact-sha>`. Only adding `--live once` can dispatch child runners. All children use that same global ledger; no child creates or changes its allowance.

Offline aggregation uses a new output directory plus `--aggregate-from <driver-output>` and the same declaration/digest. `--require-all-shards` requires all six terminal shard receipts. Partial reports always retain60 cells. Missing whole receipts are labelled `not-recorded`, with execution unconfirmed; they do not establish zero dispatch. Missing/duplicate/reordered/foreign cells within a supplied shard, mismatched input or code hashes, fabricated save/adoption fields and changed phase identities are rejected. The retained transcripts and shared ledger remain authoritative for attempted costs after interruption.

## Remaining production acceptance gap

This comparison saves and adopts zero questions. Initial lab eligibility covers only its declared parser, numerical/variation/leak checks and fixed source/notation/task assessor. The private deterministic production reconciliation is additional evidence, not a substitute for running the full public path.

Before claiming improved saved yield, run prospective matched requests through real public generation on owned disposable replica-set courses. Exercise actual material assignments/retrieval, independent task planning, same-batch/current Bank memory, option-role validation, content Reviewer rejection, numerical serving checks, evidence expansion/correction limits, source/Bank currentness and the fenced immutable question/version/fingerprint commit. Record saved Draft IDs, failed slots and tokens/time per requested and saved slot. Different historical1/6 and current lab10/20 denominators are not a causal yield comparison.

Durable regeneration also needs actual API preparation and explicit adoption: all three intents, mandatory exact original Bank-version comparison for independent requests, UUID replay/reload, unchanged-original refusal, stale source/memory/version rejection, and one idempotent immutable adopted version with preserved history. Existing mocked UI/unit checks and a pure four-send corrected candidate do not establish that combined live path.

Finally, the Sol assessor shares a family with Sol generator arms. A second fixed assessor from another available model family can provide a separate blinded agreement analysis after its exact model/options and extra cost are declared; majority agreement is not professor truth. Teacher acceptance, review minutes and broader source-semantic quality remain unknown until observed.
