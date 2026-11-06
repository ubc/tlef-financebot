# Question generation pipeline simplification — design

**Date:** 2026-11-06
**Status:** Approved for planning

## Problem

Generating questions currently runs a chain of model calls per question:
generator (up to 2 attempts) → validator → reviewer → on reject, the whole
chain again. With the "Quality pilot" v2 policy it also runs task planning, a
quality review (1–4 calls), evidence expansion and a semantic repair cycle —
up to 8 calls per question. Switching the generator to Sol 6.1 costs about
$0.30 per batch; switching every stage to it costs about $3.00. Most of the
extra cost comes from checks and retries whose effect on question quality
nobody has been able to see:

- In baseline mode the validator and reviewer never block a question. Their
  output only labels the review queue, plus the reviewer's reject triggers one
  full regeneration.
- The baseline generator sees neither the existing bank nor earlier questions
  in the same batch, so two questions in one plan cell (same LO, same
  difficulty, same prompt) can easily come out as the same question with
  different numbers.
- Quality review (v2 only) is a hard gate. It overlaps the reviewer and is the
  largest single token consumer.

## Goals

1. Exactly **two model calls per question**: one to generate it, one to check it.
2. **No automatic retries anywhere.** A failed check is recorded and shown to
   the instructor, never regenerated automatically.
3. Questions in the same LO are distinct **by construction**, through slot
   allocation and prompt context, not by a post-hoc filter.
4. Questions stay on their LO.
5. Instructors can see how similar each question is to the closest question in
   its LO and in its topic.
6. Remove the v1/v2 quality policies and their supporting code in this change.

## Non-goals

- No change to retrieval (`retrieveChunks`) or chunking.
- No change to the student side, numeric parameter sampling, or exam
  composition.
- No similarity-based blocking or retry. Similarity is informational only.
- No new model-usage accounting. The existing `modelCallReceipts` ledger keeps
  working, with the stage names below.

## The pipeline

Batch generation (each plan cell is one run) and manual Regenerate share one
orchestrator.

```
retrieve chunks ─► allocate slots ─► for each slot, serially:
                    (code only)        generate (Sol 6.1, 1 call)
                                       deterministic checks (free, record only)
                                       check (luna, 1 call)
                                       save Draft
                                       similarity (fastembed, free)
```

### 1. Retrieve

Unchanged: `retrieveChunks` for the LO (plus any secondary LOs), pinned
materials respected.

### 2. Allocate slots (code, no model call)

Each item in a run is a **slot**. A pure function
`allocateSlots({ count, kind, type, difficulty, chunks, hardnessMove })`
returns one assignment per slot:

- **Angle**: a distinct assessment angle drawn from a fixed menu that depends
  on the question kind.
  - Conceptual: definition discrimination, scenario application, cause and
    effect, misconception diagnosis, compare two related ideas, evaluate a
    claim.
  - Calculation: direct computation, reverse-solve for an input, interpret a
    computed result, compare two scenarios, identify the correct formula or
    step.
  - True/false: one qualitative proposition. The angle menu is the conceptual
    one.
  - Kind not set (workbench focus "auto"): the conceptual and calculation
    menus are interleaved, conceptual first.

  The menu is cycled when `count` exceeds its length. The menu order is rotated
  by a seed derived from the run id, so repeated runs on one LO do not always
  start with the same angle.
- **Chunk focus**: the slot's primary chunk index, rotated across the
  retrieved chunks so slots lean on different passages. All chunks are still
  supplied as context.
- **Hardness move** (hard only): existing `assignMovesForBatch` output, kept
  as-is.

### 3. Generate (generator step, Sol 6.1, exactly 1 call)

The generator prompt contains:

- The LO name (and any secondary LOs), with a hard rule: the question must
  assess this LO. A question answerable without the LO is wrong.
- The slot's angle, chunk focus and hardness move.
- The course chunks.
- **Existing questions in this LO**: stem only, at most 30, newest first,
  states draft / pending-review / reviewed / approved / paused. A rule says:
  do not test the same inference or solution path as any of these; changing
  numbers or names does not make a new question.
- **Earlier questions from this run**: stems of slots already generated
  (generation is serial within a run).
- The existing difficulty self-assessment rule. The returned `difficulty` must
  describe the question actually written.
- Output additions, absorbing what quality review used to provide:
  `sourceChunkIndexes: number[]`, the chunks the question relies on. These
  become `sourceRefs`, falling back to all chunks if the list is empty or
  invalid.

The stable instructions go first and per-question content goes last, so the
provider's prefix cache can reuse the shared prefix across slots.

### 4. Deterministic checks (free, record only)

`optionShapeValid`, `trueFalseShapeValid`, `kindContractMet` and
`verifyGeneratedNumerics` run once on the candidate. They never trigger a new
generation. A structurally invalid candidate whose options cannot be stored
(wrong option count, unparseable JSON) is recorded as a run failure for that
slot and nothing is saved. Every other failure (numeric collision, kind
mismatch, missing misconception role) is passed to the checker as a finding
and stored on the question.

### 5. Check (checker step, luna, exactly 1 call)

One prompt replaces `VALIDATOR_PROMPT` and `REVIEWER_PROMPT`. Its input is the
LO, the chunks, the candidate JSON and the deterministic-check findings. It
must do both jobs explicitly:

1. **Per-option role check** (formerly the validator). For each option key,
   decide whether its assigned role fits its text. The prompt calls out role
   swaps on otherwise sound questions as a required check. The reviewer-alone
   measurement in `docs/reviewer-agent-tests.md` missed them 3 of 3 times.
2. **Verdict** (formerly the reviewer), using the existing
   `REVIEW_VERDICT_POLICY`:
   - `reject`: a hard fault the instructor must fix, namely a wrong answer
     key, a factual error, a numeric collision or unservable question, or a
     question that assesses a different LO.
   - `flag`: anything that is one edit in the editor, such as a role label, a
     difficulty label, or an instruction not followed.
   - `pass`: nothing to fix.

Output: `{ decision, reasoning, roleAssessment, suggestions: string[],
suggestedDifficulty? }`. `suggestions` are concrete edit instructions
("Relabel D from partially-correct to clearly-wrong").

Every verdict is saved. `reject` does **not** regenerate.

### 6. Save

Every checked candidate is saved as a Draft through `createQuestion`, with
`agentDecision = { decision, reasoning, roleAssessment, suggestions,
suggestedDifficulty }`. The review queue's pass / flag / reject tabs keep
working unchanged. `suggestions` and `suggestedDifficulty` are shown in the
review workbench's AI check section and on question detail. Today
`suggestedDifficulty` is stored but never displayed.

### 7. Similarity (fastembed, free)

New service `question-similarity.service.ts`:

- **Text embedded**: the question's stem plus its correct option text, using
  the configured local embeddings model (`embedOne`).
- **Storage**: new collection `questionEmbeddings`
  `{ courseId, questionId, versionId, loIds, themeIds, vector, model, createdAt }`,
  one document per current version.
- **Result on the question head**:

  ```
  similarity: {
    lo:    { questionId, score } | null,   // nearest question sharing an LO
    topic: { questionId, score } | null,   // nearest question sharing a topic (theme)
    model, computedAt
  }
  ```

  Score is cosine similarity, shown to two decimals. The comparison pool is
  the course's questions in states draft / pending-review / reviewed /
  approved / paused, excluding the question itself. The "LO" scope matches any
  shared LO id. The "topic" scope matches any shared theme id.
- **When it is computed**:
  - On save of a generated, regenerated or manually edited version.
  - Each time, the questions in the pool whose stored nearest score is lower
    than their similarity to the new question are updated too. This is one
    pass over the in-memory scores, with no extra embedding calls.
  - A question that leaves the pool (archived or deleted) is not backfilled
    eagerly. Its neighbours are recomputed on their next save or by the
    backfill below.
- **Backfill**: an admin-triggered endpoint
  `POST /api/courses/:courseId/question-similarity/rebuild` embeds every
  current version in the course and recomputes all `similarity` heads. It runs
  in-process, and course sizes are hundreds of questions.
- **Display**: the bank list row and the question detail show
  "LO 0.91 → Q-12 · Topic 0.78 → Q-40". Each target is a link to that
  question. No thresholds and no colours beyond neutral; the numbers are for
  the instructor to read.

Similarity failure (for example the embeddings model is unavailable) never
fails a save. The question simply has no `similarity` field until the next
recompute.

## Manual Regenerate

The question detail Regenerate action uses the same orchestrator with
`count = 1` and these additions to the generator prompt:

- The original question (stem, options, roles, explanations).
- Its `agentDecision`: the verdict, reasoning, role assessment and suggestions.
- The instructor's change request (the existing prompt box).
- The same existing-LO-stem context, with the original question excluded.

The result stays a **candidate** the instructor previews and adopts, using
the existing `regenerationCandidates` collection and adopt endpoint. The
candidate carries the new checker verdict and similarity. Adopting it creates
a new version, as today. The `qualityPolicy` request field is removed from
the regenerate route and from `api.ts`.

Calls per Regenerate: 1 generate + 1 check.

## Model configuration

- `PIPELINE_STEPS` becomes `generator`, `checker`, `masteryEvaluator`,
  `utility`. The admin console shows a Generator row and a Checker row.
  `checker` defaults to temperature 0.
- Stored platform settings that still hold `validator` / `reviewer`: on read,
  `normalizePlatformSettings` maps `reviewer` to `checker` (keeping its model
  and parameters) and drops `validator`. The next save writes the new shape.
- Env: `LLM_MODEL_CHECKER` replaces `LLM_MODEL_VALIDATOR` and
  `LLM_MODEL_REVIEWER`. If it is unset, `LLM_MODEL_REVIEWER` is still read as
  a fallback, so existing deployments keep working. Update `.env.example`.
- Exam request interpretation (`exam-generation.service.ts`, stage
  `assessment-planning`) currently borrows the validator model. It moves to
  the `utility` step.
- `featureFlags.retryOnReject` is removed. `featureFlags.reviewerAgent` is
  removed: the checker always runs, because it is the only source of the
  verdict. Stored documents with those keys are ignored on read.
- Model-usage stage names: `generation`, `check`.

## Removal (same change)

Deleted along with their tests:

- Quality policies `grounded-memory-v1` and `grounded-memory-v2`, the
  `qualityPolicy` input on generation, plan and blueprint routes, and the
  workbench "Quality pilot" checkbox and version select.
- `generation-quality.service.ts`, `authoring-task-plan.service.ts`,
  `authoring-context.service.ts`, `generation-evidence.service.ts`,
  `generation-memory.service.ts`, `generation-semantic-repair.ts`,
  `generation-review-repair.ts`, `generation-numeric-review*`,
  `generation-exclusion-review.ts`, `generation-exact-bank.ts`,
  `generation-answerability.ts`, `generation-task-*.ts`,
  `generation-planning-evidence.ts`, `generation-citation-spans.ts`,
  `generation-compact-instructions.ts`, `generation-source-interpretation.ts`,
  `generation-evaluation.service.ts`, and the historical-memory preparation
  route. The implementation plan confirms each file's reachability with
  `tsc` before deleting it. A file still imported by non-generation code is
  kept, and the plan says so.
- The protocol fields on `GenerationInput` (`taskRetrievalProtocol`,
  `authoringPromptProtocol`, `numericReviewProtocol`,
  `exclusionReviewProtocol`, `reviewRepairProtocol`, `exactBankProtocol`,
  `answerabilityProtocol`, `taskDemandProtocol`, `sourceProvenance`).
- `retryRejectedCandidate`, the generator attempt loop, `RETRY_FEEDBACK`,
  `REVIEWER_REJECT_FEEDBACK`, and the reject-retry move logic.
- `VALIDATOR_PROMPT` and `REVIEWER_PROMPT`, replaced by the checker prompt.
- Prompt-AB scripts that exist only to evaluate v2 (`scripts/prompt-ab/...`):
  delete what no longer compiles against the new pipeline. Generic harness
  code that still applies stays.

Kept:

- `authoring-budget.service.ts`, still used by structure generation.
- Existing data. Questions and runs that carry `authoringQuality`,
  `taskDescriptor`, `result.quality` and similar fields keep them. Those
  fields become optional, read-only types, and the workbench still renders
  old runs' stored results. The `authoringTaskPlans` and
  `questionPedagogicalFingerprints` collections are no longer written. Their
  index specs are removed from `collections.ts`, and the collections
  themselves are left in place (no data migration).

## Code layout

`generation.service.ts` (3888 lines) is split. New focused modules under
`server/src/services/question-generation/`:

| File | Responsibility |
|---|---|
| `pipeline.ts` | Orchestrator for runs and regenerate: retrieve → allocate → per slot generate / check / save / similarity; run progress writes |
| `slots.ts` | `allocateSlots` (pure) |
| `generator-prompt.ts` | Generator prompt builder (pure) |
| `checker-prompt.ts` | Checker prompt builder (pure) and output parsing |
| `existing-stems.ts` | Loads same-LO stems for prompt context |

`question-similarity.service.ts` sits beside them in `services/`. What remains
in `generation.service.ts` is the run-queue and enqueue surface (or it moves
into `pipeline.ts` if little remains). Route signatures stay the same apart
from the removed `qualityPolicy` fields. `docs/api-contract.md` is updated in
the same change.

## Error handling

- Generator returns unparseable JSON or an option shape that cannot be
  stored: that slot is a run failure (`generation-invalid-options`). Other
  slots continue. No retry.
- Checker call fails or returns unparseable output: the question is saved
  with `agentDecision = { decision: 'flag', reasoning: 'Automatic check
  unavailable: <error>' }`. No retry.
- Similarity fails: the save still succeeds; `similarity` is absent.
- A run ended by the instructor stops before the next model call, using the
  existing `assertAuthoringExecutionActive` checkpoint.

## Testing

- `slots.test.ts`: distinct angles per slot up to the menu length,
  deterministic for a seed, chunk-focus rotation, hard-move passthrough.
- `generator-prompt.test.ts` and `checker-prompt.test.ts`: required sections
  present (LO rule, angle, existing stems, earlier-run stems, role-check
  instruction, verdict policy). Original question and agent decision appear
  in regenerate mode.
- `pipeline.test.ts` with a mocked `completeJson`:
  - Exactly 2 calls per slot.
  - Zero calls after a reject or failed numeric check.
  - Serial runs pass earlier stems to later slots.
  - Checker failure saves a flagged Draft.
  - A shape failure saves nothing and records a failure.
- `question-similarity.service.test.ts` with fixed vectors: nearest-in-LO and
  nearest-in-topic selection, self-exclusion, pool states, neighbour updates
  on insert, failure tolerance.
- Platform settings normalisation: legacy `validator` / `reviewer` documents
  map to `checker`.
- The whole repo passes `npm run typecheck`, lint and the full test suite
  after the removals.

## Expected cost

Per question: 1 Sol 6.1 call (prompt about 6k plus a bounded stem list) and
1 luna call (about 2k). The previous worst cases were 4 calls in baseline
(reject retry) and 8 in v2.
