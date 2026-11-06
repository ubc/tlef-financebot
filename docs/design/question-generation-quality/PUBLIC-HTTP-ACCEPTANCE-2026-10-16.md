# Public HTTP, Agenda and durable regeneration acceptance

Status: the declared live experiment was executed and is now **operator-stopped
with partial evidence**. The first, three-slot request completed and saved one
Draft. The second request was interrupted after a provider call stopped making
progress; its final provider outcome and usage are unknown. The third request
and all three regeneration intents were not executed. This is not a completed
six-slot batch or evidence that five candidates were semantically invalid.

The original result and ledger files remain unchanged. The separate terminal
receipt is
`audit-results/quality-lab-public-http-2026-10-16-bootstrap-live/operator-stop-result.json`.
It records process exit 143, absence of the owned process, the exact interrupted
run's transition to failed, and disabling its owned Agenda job. No other course
was modified and no provider request was made by reconciliation.

Root remains the sole paid/database executor. Any further probe needs its own
prospective declaration and retained prior cost accounting. Historical execution
instructions below describe the original experiment, not permission to restart it.

## What this experiment is meant to establish

The earlier October 14 observation saved one of six requested Drafts. That
observation also exhausted a shared budget, preventing several later validations
and regeneration intents from running. It cannot establish that the other five
questions were all semantically invalid. Its archived code snapshots do not
freeze every transitive dependency. This runner therefore compares current
public acceptance against a historical reference; it does not claim a causal
old/new A/B improvement.

Three public requests retain the exact historical prompts, counts, objective
wording and difficulty/kind choices:

| Request | Requested questions | Main concern |
| --- | ---: | --- |
| Thin-topic Bank memory | 3 | Independent tasks instead of paraphrases of the seed |
| CAPM decimals and notation | 2 | Source notation, displayed inputs and computed answers |
| Outside-scope and hardness | 1 | Short reading and honest source-supported difficulty |

Each starts in a separate owned course with the exact archived Chapter 3/4
parsed chunks/manifests and the same manual True/False Bank seed content. Real
local FastEmbed vectors and Qdrant payloads are rebuilt for the new IDs. Original
PDF bytes, parsed chunk order/text/hash, manifests, requests and seed content are
checked. This deliberate historical chunk clone is not upload/parser acceptance.
It must not be confused with the separate actual ten-file upload/index run.

The public requests go through the actual HTTP router, enqueue a real Agenda
`generation.run` job and wait for its real terminal state. The runner does not
call the worker directly, inject a model candidate, or force eligibility. It
retains saved Drafts, exports original-version evaluation records, reads usage,
checks current head/version/provenance and immutable fingerprints, verifies the
current numeric serving gate, and calls the actual saved-version sample route.
The seed stays unchanged and each missing slot stays in the denominator.

Three separate seed clones exercise `edit-existing`, `create-variant` and
`create-independent-task`. They use real HTTP regeneration, reload the durable
candidate, replay the same request UUID without another model send, adopt only
an eligible stored candidate, and replay adoption without a second version.
Withheld candidates must refuse adoption and leave the seed unchanged. An
additional course changes the seed through the real question PATCH route and
checks that regeneration using the stale original version fails before model
work. That last case is not a stale eligible-candidate adoption experiment.

## Prospective bounds and accounting

Native public run maximums are 26 + 18 + 10 = 54 sends. Three native regeneration
maximums add 24, for a nominal native maximum of 78. The separate phase ledger
also has a strict **78 attempt-reservation** cap and **3,744,000 conservative
units**, at no more than 24,000 input units and 24,000 output reservation per
attempt. Native budgets and their successful-usage settlement are unchanged.

A phase reservation occurs immediately before the existing observed facade.
The native budget can subsequently refuse it. Such a reservation remains
charged and can reduce the number of actual sends permitted by the fixed phase
cap. There is no arbitrary headroom, reset or implicit continuation. These are
UTF-8 admission estimates, not billed tokens, dollar prices, or a guarantee that
all requested work will complete. JSON correction, logical repair and source
review sends consume the same limits.

Runtime prompts depend on actual retrieval, planning and repairs. Offline
preflight records rendered-input estimates as unavailable instead of pretending
a guessed prompt is the real input. Every actual rendered facade input/options
pair is recorded and checked before native work. A cap failure is an observed
result to inspect, not grounds to silently raise the limit.

The declaration pins finalized preceding phase ledgers by exact hash and scope.
The new ledger is created with exclusive-write semantics. A declaration can
claim the database only once. A shared file lock is never stolen. Two parallel
generators use a FIFO around only the file-admission critical section; provider
work remains parallel. An unrelated process's on-disk lock fails closed.

## Exact I/O without changing the model call

`public-acceptance-observation.ts` patches only the writable methods on the
existing `llm` facade. It does not assign read-only TSX module exports, replace
`completeJson`, add `onText`, choose an effort, change streaming, or replace the
production outer usage observer or caller-local callbacks. It forwards original
arguments and the original response. Existing streaming callbacks are forwarded
while visible chunks are accumulated. Raw invalid JSON and correction replies
remain inspectable in separate private transcript files.

Facade entry is not evidence of provider dispatch. Captures distinguish returned
responses, explicit native budget refusals and unknown failures. JSON-attempt
metadata is initially null because it is not visible at that facade boundary.
Actual observed sends and provider-reported input/output usage come from the
production Mongo `modelCallReceipts`, filtered by the exact actor and owned
course IDs. Missing counters stay null. Hidden SDK retries remain unknown.

A unique returned `response.metadata.id` can link a raw capture exactly to a
native receipt's `responseId`. A unique native-options/time correspondence is
labelled inferred. Parallel ambiguity, duplicate IDs and absent receipts stay
unresolved. The runner never picks an arbitrary call ID or invents a zero-cost
failure. Per-call binding limitations do not hide the complete raw I/O or the
independent aggregate native receipt stream.

## Isolation and execution

Offline preflight imports no production runtime configuration, database client
or provider facade. It verifies original files and records code hashes for all
server TypeScript, quality-lab TypeScript, package manifest and lockfile. It
creates a declaration and preflight receipt only; it creates no ledger, course
or provider call.

Live execution requires the exact declaration SHA, a new output directory,
MongoDB on local port 27029, a disposable `financebot_quality_smoke_retest_*`
database, local Qdrant on port 6333 and FastEmbed. All existing courses must have
test-fixture owners. There must be no active durable work or scheduled/locked
Agenda work. A database ownership marker is written before starting Agenda;
only production generation jobs are registered. No startup recovery function
is called on unrelated historical work.

The ephemeral Express app uses a labelled synthetic request User with real
course guards, including signed-out and foreign-course denials. It is not a
SAML login test and changes no production authentication configuration. Outbound
sockets are limited to the owned services, ephemeral HTTP server and configured
provider host. The runner never drops a database, deletes fixtures, grants
platform roles, approves/publishes questions, writes real student attempts, or
mutates Canvas. Owned Drafts and adopted versions remain available for review.
On observation failure it waits for already-started owned durable work before
stopping Agenda; it does not cancel or resubmit that work.

Root prepares two small English JSON files: the expected current
`ResolvedStepModels`, and a list of finalized prior ledger `{path, sha256,
scope}` records. Current runtime model/options must match the declaration;
the runner does not overwrite settings to obtain a preferred outcome.

```sh
node --import tsx scripts/quality-lab/run-public-acceptance.ts \
  --reference audit-results/generation-quality-retest-2026-10-14/observations-after-repair.json \
  --corpus audit-results/generation-quality-corpus/manifest.json \
  --models /absolute/path/to/expected-models.json \
  --prior-ledgers /absolute/path/to/finalized-ledgers.json \
  --database financebot_quality_smoke_retest_20261016 \
  --output /absolute/path/to/new-preflight-directory
```

After reviewing that declaration, root may execute it with the existing local
Mongo environment, `--declaration`, its exact `--declaration-sha256`, another new
`--output` directory and `--live once`. This document does not authorize an
automatic run or restart.

## Offline verification

Three focused suites currently contain 25 passing tests. They cover target and
source integrity, fixed denominators, append-only ledger caps/corruption/locks,
read-only TSX exports in a real separate Node process with all network blocked,
the original helper's transport and effort shaping, simultaneous preservation of
outer and local observers, JSON correction raw I/O, known native denials versus
unknown failures, exact and ambiguous receipt links, parallel provider work with
serialized real file reservations, and finalized declaration lineage. Scoped
strict TypeScript and ESLint pass. The native transport in these tests is
synthetic; they do not demonstrate real saved yield, pedagogical coverage,
professor acceptance, token savings or general model ranking.
