# Source coverage and shared authoring memory

Date: 2026-10-13. Local implementation; `baseline` remains the default.

This delivery implements the engineering mechanisms in the
[source coverage and memory plan](2026-10-13-source-coverage-and-memory-plan.md).
It does not establish professor acceptance, reduced review time, or general
quality improvement. Public-PDF observations and their failures are reported
separately in the local acceptance report.

## Product workflow

1. Upload in **Course Materials**, or in the existing preparation guide. A
   prepared receipt lists every intended filename before multipart admission.
   Reload recovers the receipt, including rejected/missing files. Exact-byte
   duplicates within the same course link to an eligible existing manual source;
   renamed files record aliases and do not overwrite instructor corrections.
2. **Build Knowledge Base / Course Structure → AI outline** checks authoritative
   source readiness. The default covers all active sources plus the intended
   upload batch. A pending, failed, missing or invalid index names the source and
   blocks before model work. Selecting fewer sources explicitly records the
   exclusions. Material-ingest events refresh readiness without resetting the
   selection. Earlier and replacement sources can be selected explicitly; old
   outlines, files and question history are retained.
3. In **Generate Questions**, enable the existing quality pilot and select
   **Shared evidence and task memory v2**. Optionally prepare up to five older
   question fingerprints per UI action. That preparation is an explicit extra
   model operation, not a prerequisite or an automatic whole-bank backfill.
4. In the question editor's **Regenerate** panel, opt into shared evidence and
   memory and choose **Edit existing**, **Create variant**, or **Create independent
   task**. Enter requested changes and preserved constraints. Candidates survive
   reload and failed responses through a durable request UUID; replacing the
   saved version remains explicit and revision guarded.
5. Inspect source links, independent supply, diagnostic candidates, shortfalls,
   and stage/call usage in the existing Instructor and Admin run surfaces. A
   completed task with zero saved questions says so. Withheld output is not a
   successful Draft or an accepted independent question.

## Ingestion, source identity and coverage

`material-upload-batches.service.ts` owns intended admission receipts and a
short upload ownership lease. `materials.service.ts` computes the server-side
raw-byte fingerprint, uses an active partial unique course index to resolve
concurrent manual duplicates, and publishes source chunks plus an indexed
manifest before readiness. The material's `activeRunId` links the run before
dispatch. Classification is advisory: its warning/failure cannot invalidate
already indexed originals. Interrupted unindexed work becomes failed/retryable
at startup; an indexed source remains usable after interrupted classification.

`source-readiness.service.ts` checks the current course/source, indexed manifest,
ordered chunks and content hash. Display status alone is insufficient. Source
scope includes intended batch files even if multipart admission never received
them. A source selection report retains included snapshots, every requested
file, named exclusions and explicit replacements. Legacy source records are
handled conservatively; they are not upgraded by inventing a manifest.

`source-evidence-cache.service.ts` stores validated source-local extraction rows
with concepts, formulas, notation, units, conditions and exact original passage
references. Keys include source text/parser/chunker, schema/prompt, rendered
prompt hash, effective model options, source title and normalized guidance.
Assignment-only changes do not invalidate text extraction. A forged, changed,
trashed or foreign-course source cannot validate a cache hit. Each valid row is
retained independently when another row fails, so recovery retries only missing
rows. Child records retain both parent identity and the actual child prompt hash.

All intended extraction units must finish before course outline synthesis.
Validated organization groups are retained in the existing structure run and
replayed only under their exact rendered prompt/model/current-outline/original
identity. Stable point hashes stay server-side; new model requests use short
group-local references that are mapped back after validation. Unchanged groups
survive an appended source without shifting their boundaries. Final organization
still runs against the complete supported inventory. Exact duplicate Topic/LO
labels are consolidated mechanically with reference unions before validating
requested counts; semantic synonyms are not guessed equivalent.
Cache reuse does not imply complete educational coverage. Formula or chart
information missing from parsed text remains an inspection gap; a model summary
cannot invent the missing data. Final outline synthesis preserves a ledger of
mapped and unmapped learning-point IDs. Larger selections use bounded groups
and a final organization step rather than silently cutting off late chapters.

## Generation, regeneration and quality checks

`authoring-context.service.ts` combines current original evidence, scope,
requirements and current Bank/Queue memory for both authoring entry points.
`generation-catalog.service.ts` uses validated extracted knowledge as a locator
for relevant original formula/definition passages; cached summaries are never
proof. A single named, in-scope evidence expansion is allowed. Missing required
premises remain a reason to withhold, not permission to use outside knowledge.

`authoring-task-plan.service.ts` persists a bounded independent-task plan before
candidate generation. Descriptors record concepts, inference, solution path,
misconception, difficulty and source IDs. The generator returns a descriptor
with each candidate. Immutable-version fingerprints and optional retrieval
vectors nominate related current questions, including relevant cross-LO heads.
Original questions remain the fallback for absent fingerprints. Omitted memory
and unprepared legacy versions are disclosed; vector similarity is not a
pedagogical verdict.

Exact duplicate/shape/numerical checks precede the semantic source, notation,
novelty, difficulty, edit-fulfillment and invariant assessment. An edit may retain
its original learning task; a variant is counted as a variant; an independent
request must offer a different supported inference. No-op edits and unfulfilled
requirements cannot be adopted. Checked achieved difficulty is stored for new
candidates, alongside requested difficulty in the run; historical labels are
unchanged. Numerical answers still require the deterministic formula verifier.
Closed-formula admission now also compares answers recomputed from the actual
displayed input values. A separate input-display proof version distinguishes
historical arithmetic-only proofs; historical versions are rechecked in memory.
Every fresh draw repeats the check, so finite sampling cannot authorize an unsafe
unseen value. Formatting and evaluator arithmetic remain unchanged. New fixed
paper snapshots retain private definitions; publication and new live/rehearsal
starts validate the exact frozen values. Older pinned snapshots resolve their
original version, while unrecoverable numerical snapshots require paper
recreation. Existing active/submitted sittings retain their answers and grading.
Student and pre-submit Preview DTOs never expose these private definitions.

`grounded-memory-v1` and baseline remain compatible. Private assessment
generation is not migrated into v2 by this change. Reviewer consolidation is
deferred until teacher calibration shows that removing a check is safe.

## Persistence, recovery and cost

At startup, `authoring-commit.service.ts` audits Mongo transaction support. On a
replica set/sharded deployment, a short course transaction serializes final
context/revision checks and question/version/task persistence. Relevant head,
source, outline, draft-commit and archive writers share that course fence.
Provider calls and embedding work always occur outside transactions. Deletion
sets an authoring tombstone before external cleanup, so stale work cannot
recreate authoring records after deletion.

On unsupported/unavailable transaction topology, v2 is diagnostic-only: model
work may consume tokens and retain candidates, but cannot claim a coordinated
save/adoption. Instructor UI displays this before dispatch. No database topology
change, deployment or production rollout is performed by these local tests.

Queued generation uses CAS-owned, expiring worker leases, and stored slot
responses/checks can be reused. Regeneration UUIDs pin the original version and
requirements; the same UUID with different input is rejected. Adoption rechecks
original version, sources and current memory in the transaction. A crash between
provider dispatch and durable response capture remains uncertain; this is not
exactly-once billing.

The actual SDK send boundary admits initial calls, JSON correction and retries.
Schema/citation correction consumes the same slot repair allowance; it cannot
stack a new loop after a generator repair. Guarded diagnostics retain validation
paths/codes rather than raw responses. JSON-object requests explicitly instruct
JSON generation. The [official JSON-mode documentation](https://developers.openai.com/api/docs/guides/structured-outputs#json-mode)
confirms that valid JSON alone does not enforce a schema; server validation and
bounded failure handling remain necessary with this toolkit transport.
It uses a labelled conservative UTF-8-byte estimator, not a billing tokenizer.
The initial per-slot limits are eight observed sends, two generator attempts,
one repair/replan cycle and one evidence expansion. V2 generator/check output
caps are 3,000/1,500 tokens. Extraction and independent generation use at most
two parallel sends per run; the provider gate defaults to four per process,
with admission groups by course and actor. Multi-process provider fairness needs
an external shared coordinator.

Input/output counters remain nullable; failed and withheld calls remain in
subtotals. Receipts include admission wait, execution, estimates, rejection and
logical work. SDK-hidden physical retries, embeddings, parsing, infrastructure
and money pricing are excluded. Cache preparation cost is separate from warm
generation cost and must be amortized explicitly.

## Verification and rollout

Unit tests block external model requests. Physical disposable-replica checks
exercise current-source manifests, duplicate upload reuse, simultaneous commit,
stale source/memory, version adoption and deletion tombstones. Browser checks use
the production client with intercepted API responses for recovery, selection,
guided outline, all three regeneration intents, diagnostics and accessibility.
The public-PDF scripts exercise real parsing/chunking/indexing and configured
model calls in a separate local database, retaining failed tuning attempts.

Keep v2 opt-in. The public-PDF corpus is an engineering smoke benchmark. Its
small agent-curated inventory and candidate inspection are not professor labels,
an exhaustive curriculum inventory, p50/p95 estimates or measured teaching
benefit. Teacher review and agreed release thresholds remain the rollout gate,
consistent with [official evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices#llm-as-a-judge-and-model-graders)
on calibrating model judgments against human labels.

The [October 14 acceptance](ACCEPTANCE-2026-10-14.md) and
[local screenshot report](../../../artifacts/quality-authoring-2026-10-13/index.html)
include real public-PDF source reuse, every paid tuning attempt, unresolved
coverage gaps and low v2 supply. Final verification passed 173 Jest suites /
2,332 tests, 31 controlled browser tests, type checking, lint and build. These
engineering passes do not turn the observed low-yield pilot into a proven
quality improvement.
