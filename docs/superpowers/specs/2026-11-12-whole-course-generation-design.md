# One-click whole-course question generation

Date 2026-11-12. Instructor workflow spec 3.

## Instructor flow

On **Generate Questions**, put **Fill course question gaps** at the top and the
existing custom batch form below it. Opening the course-wide action fetches a
preview. The confirmation dialog shows new questions by difficulty, objectives
affected, objectives already covered or queued, and objectives skipped for
missing ready material. It also shows the estimated USD cost and effective
Generator and Checker models. The instructor can inspect the per-LO counts
before confirming. If there is nothing to generate, show the reason and omit
the confirmation action.

After confirmation, show one course-wide batch with requested, saved,
queued/running, waiting to retry, and failed counts. Retain the per-LO and
per-difficulty task rows and the existing live question preview. Show blocked
objectives with links to Course Materials. Reload restores the active batch
from the server. A finished batch links to **Questions → To review** and
identifies remaining gaps. Generated questions enter the review queue as drafts.

## Gap calculation

Use the shared tier targets in `generation-plan.service.ts` for every active
learning objective under an active Topic.

| Difficulty | Target per LO |
|---|---:|
| Easy | 2 |
| Medium | 2 |
| Hard | 1 |

Read each question's current version for its difficulty. Count `draft`,
`pending-review`, `reviewed`, and `approved`, including drafts with an AI
verdict awaiting an instructor decision. A multi-LO question counts once per
associated active LO. Exclude paused and archived questions. These counts
describe authoring coverage. The Questions workspace remains responsible for
student visibility and release.

For each tier compute `max(0, target - saved - inFlight)`. Count the
unfulfilled units of queued and running tasks with a known LO and tier as
in flight, including tasks waiting for a rate-limit retry. Remove units from
in-flight counts as their saved drafts appear. Show saved and in-flight counts
separately in the preview. Only enqueue positive gaps with ready assigned
material, using the same grounding eligibility as the custom generation path.
Reuse `effectiveLoKind` and `splitByKind` for the gap. Create MCQs, the current
batch default.

## Preview, confirmation and recovery

Add course-scoped instructor endpoints for preview, confirmation, and reading
the batch. Compute the plan and estimate on the server. Confirmation sends a
submission ID and the preview fingerprint. Recompute against current gaps,
ready sources and effective model settings. If the plan or estimate changed,
return a refreshed preview for confirmation before enqueuing any work.

Persist one active whole-course batch per course with its confirmed cells and
model snapshot. A repeated confirmation with the same ID returns the same
batch. A second instructor opening the action while it runs can view its
progress. Use deterministic child run IDs and existing generation-run admission
and usage tracking so a repeated confirmation or worker restart resumes
dispatch without duplicating drafts or paid work. The parent retains the full
plan and dispatches child cells within the existing batch size limit. Record
admission failures on the affected cells. Apply the platform daily generation
limit at admission and account for the capacity already reserved by children.

## Estimate before generation

Estimate input and output separately for the effective models and call stages.
Show the estimated cost of the normal generation and check calls. If repair
is enabled, show the additional estimated cost for one repair and recheck
per question that needs it. Mark both as estimates. Output length, model
decisions and retry attempts can change the final cost. When a model has no
configured price, show that its cost is unavailable. Preserve the confirmed
estimate with the batch and use model-call receipts for the observed usage.

Initial estimates can use rounded profiles from the
[correctness trials](../../../artifacts/generation-eval-2026-11-12/correctness-comparison.md).
For example, 6,500 input and 1,600 output tokens per Sol generation, plus
2,700 input and 170 output tokens per Luna check, give about **$0.39 for 12
questions** at standard 30-minute cache-write prices and zero cache reads.
Use the deployed cache policy for the estimate, without assuming cache hits.

| Model | Input | Output | Cache read | 30-minute write | 12-hour write |
|---|---:|---:|---:|---:|---:|
| GPT-6.1 Sol | $2.00 | $10.00 | $0.10 | $2.50 | $5.00 |
| GPT-6 Luna | $0.10 | $0.50 | $0.01 | $0.125 | $0.25 |

Rates are USD per million tokens at standard tier and ordinary context lengths.
The 12-hour rates apply when explicitly selected through Responses.
[OpenAI API pricing](https://developers.openai.com/api/docs/pricing)

## Worker concurrency and rate limits

Set question-generation job concurrency from a server configuration value
with a default of **10**. Apply it to `generation.run` jobs for both course-wide
and custom batches. Ensure the Agenda process-wide ceiling permits the
configured generation limit. This setting is per worker process. Keep the
questions within each child run sequential so later items can see earlier
stems.

When OpenAI returns a temporary 429 during generation, checking or repair,
record the failed send and schedule a retry for the child task. Preserve the
provider error code and `Retry-After` through the transport and pipeline so a
temporary rate limit can reach the worker. Use the greater of `Retry-After`
and exponential backoff with jitter. Allow up to two automatic task retries.
Release the worker slot during the wait. Insufficient quota, other permanent
errors and exhausted retries produce a terminal failure with actionable text.
The platform's daily generation limit is an admission error.

Persist attempt number, next eligible time, progress and the private outputs
from completed stages needed to resume the interrupted item. On retry, claim
the same task atomically and resume the unfinished stage with the same model
and input snapshot. Preserve saved drafts and use the existing run and item
provenance as the identity for idempotent persistence. Retain attempt usage
in the original run. Ending a batch cancels scheduled retries and prevents
later writes from stale workers. The one correctness-repair allowance still
applies per question.

## Acceptance checks

- Empty coverage yields 2 easy, 2 medium and 1 hard per eligible LO. A draft
  fills its own tier. A pending task suppresses only its unfulfilled units.
- Missing sources and already-covered objectives appear in the preview.
  Preview and cancel create no runs. A stale confirmation returns a new
  preview and a repeated confirmation returns the same batch.
- A plan larger than the existing custom batch size dispatches all eligible
  cells. An admission failure remains visible on its cell after reload.
- At the default setting, one worker process runs up to ten generation tasks.
  Custom generation continues to use the same queue.
- Scripted temporary 429s in each model stage defer the affected task, free a
  slot, and resume without repeating completed model stages or saved drafts.
  Cover exhausted retries, insufficient quota, restart, duplicate claims and
  cancellation during the retry wait.
- Verify cost math for Sol and Luna, default and 12-hour cache writes, disabled
  repair and missing model prices. Reconcile observed receipts with the batch.
