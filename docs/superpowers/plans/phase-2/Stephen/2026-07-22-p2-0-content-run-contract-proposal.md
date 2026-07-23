# P2-0 Content Run Contract Proposal

_Author: Stephen / Codex_  
_Status: implemented and automatically verified on `codex/phase-2-content-runs`; live smoke/PR pending_

_Owner: Stephen_

_Integration reviewer: Saurav (asynchronous, non-blocking)_

## Decision summary

Keep Agenda as the executor and add Mongo `contentRuns` as the durable product
record for material ingestion and question generation. The current Material
poll and constant generation `jobId: "generation.run"` do not identify an
execution, cannot explain progress/failure, and cannot recover UI state after a
reload.

P2-0 makes four deliberate choices:

1. one run per uploaded/retried Material and one run per generation request;
2. a course-scoped SSE stream, not one EventSource per run, because one upload
   can create up to 20 concurrent material runs;
3. truthful stage + unit counters, not a fabricated overall percentage; and
4. explicit `failed: server-restarted` for interrupted running work in the
   pilot rather than pretending unsafe generation can resume exactly once.

Material endpoints remain source-compatible through an additive
`activeRunId`. The generation enqueue response intentionally migrates from a
constant, non-identifying `jobId` to a unique `runId`.

## Current behavior being replaced

- `POST /courses/:courseId/materials` returns Material rows with only
  `status: processing`; the client polls the full list every three seconds.
- `POST /materials/:materialId/retry` overwrites the Material back to
  `processing`, so no attempt history survives.
- `POST /courses/:courseId/generate` returns
  `{ "jobId": "generation.run" }` for every request. The client ignores that
  value and tells the instructor to refresh/check the Review Queue later.
- Material workers swallow failures after updating Material; generation worker
  failures exist only in Agenda/log output.
- A reload loses all client-side knowledge of what was requested. There is no
  durable per-run progress, partial result, or error record.

## Persisted domain contract

Mongo collection: `contentRuns`.

Server fields use `ObjectId`/`Date`; their JSON representation is a hex string /
ISO timestamp. `kind` discriminates `input`, `stage`, and `result`.

```ts
type ContentRunKind = 'material-ingest' | 'question-generation';
type ContentRunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

type MaterialIngestStage =
  | 'queued'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'classifying';

type QuestionGenerationStage =
  | 'queued'
  | 'retrieving'
  | 'generating'
  | 'validating'
  | 'reviewing'
  | 'persisting';

interface ContentRunError {
  code: string;          // stable machine-readable code
  message: string;       // instructor-safe detail
  atStage: string;
  retryable: boolean;
}

interface ContentRunWarning {
  code: string;
  message: string;
  atStage: string;
  at: Date;
}

interface ContentRunEvent {
  revision: number;      // also the monotonically increasing event id
  at: Date;
  type: 'status' | 'stage' | 'progress' | 'warning';
  status: ContentRunStatus;
  stage: string;
  completedUnits: number;
  totalUnits?: number;
  message?: string;
}

interface ContentRunBase {
  courseId: ObjectId;
  kind: ContentRunKind;
  requestedBy: string;
  status: ContentRunStatus;
  stage: string;
  completedUnits: number;
  totalUnits?: number;
  revision: number;
  events: ContentRunEvent[]; // newest 100 retained with $slice
  warnings: ContentRunWarning[];
  error?: ContentRunError;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

interface MaterialIngestRun extends ContentRunBase {
  kind: 'material-ingest';
  stage: MaterialIngestStage;
  input: {
    materialId: ObjectId;
    sourceName: string;
    sourceFormat: Material['format'];
    trigger: 'upload' | 'retry';
    previousRunId?: ObjectId;
  };
  result?: {
    characterCount: number;
    chunkCount: number;
    vectorCount: number;
    indexedCount: number;
    classification: 'suggested' | 'no-match' | 'skipped' | 'warning';
  };
}

interface QuestionGenerationRun extends ContentRunBase {
  kind: 'question-generation';
  stage: QuestionGenerationStage;
  input: {
    loId: ObjectId;
    count: number;
    type: QuestionType;
    difficulty?: Difficulty;
    prompt?: string;
    models: {
      embedding: string;
      generator: string;
      validator: string;
      reviewer: string;
    };
  };
  grounding?: {
    allowedMaterialIds: ObjectId[]; // pinned before retrieval
    retrievedChunkCount: number;
  };
  result?: {
    createdQuestionIds: ObjectId[];
    failures: Array<{
      item: number;                 // zero-based requested item index
      stage: 'generating' | 'validating' | 'reviewing' | 'persisting';
      code: string;
      message: string;
    }>;
  };
}

type ContentRun = MaterialIngestRun | QuestionGenerationRun;
```

### Progress semantics

- `stage` says what is actually happening; it is never inferred from elapsed
  time.
- Material `totalUnits` is absent while parsing. Once chunks are known it is
  `chunkCount`; counters then describe chunk vectors/indexing work. The UI shows
  the stage alone when no meaningful denominator exists.
- Generation `totalUnits` is the requested question count from creation.
  `completedUnits` means processed items (success or per-item failure), while
  `result.createdQuestionIds.length` is the success count.
- Terminal `status` overrides the stage label in UI. `failed` retains the stage
  that failed via both `stage` and `error.atStage`; `partial` is legal only for
  generation with at least one success and at least one item failure.
- Material classification remains advisory. Its failure produces a warning and
  a completed run with `classification: 'warning'`; it never changes an
  otherwise valid Material back to failed.

### Legal transitions

```text
queued  -> running | failed
running -> running | completed | partial | failed
completed / partial / failed -> no further transition
```

Within `running`, stages move only forward through the kind-specific order.
Repeated progress within the current stage is legal. Counters never decrease,
`completedUnits` never exceeds `totalUnits`, and terminal timestamps are set
once.

Every mutation is one compare-and-set `findOneAndUpdate` filtered by `_id +
revision + expected status`. It updates the snapshot, increments `revision`,
and appends the corresponding bounded event atomically. A stale/illegal update
returns `content-run-conflict` and emits nothing.

## Collection access and indexes

Add `contentRunsCol()` to the central collection accessors and append:

```ts
{ collection: 'contentRuns', keys: { courseId: 1, createdAt: -1 } }
{ collection: 'contentRuns', keys: { courseId: 1, kind: 1, status: 1, createdAt: -1 } }
```

No TTL is proposed: the run list is the instructor's operation history. P2-I2
may add archival/retention rules when generation history volume is known.

`Material` gains the additive field:

```ts
activeRunId?: ObjectId;
```

It points to the newest ingest attempt. Older runs remain discoverable through
the course list endpoint; changing assignments never changes this link.

## Enqueue and worker invariants

### Common

1. Insert the queued run before enqueueing Agenda.
2. Agenda job data contains only `{ runId }`; workers reload immutable request
   input from Mongo, so request and executor payload cannot drift.
3. If Agenda enqueue fails, transition the run to durable `failed` with
   `content-run-enqueue-failed` before returning an error.
4. A worker reads the run first and returns without side effects when it is
   missing or terminal. This makes stale Agenda jobs harmless after restart
   reconciliation.
5. Persist each stage/result change before broadcasting it.

### Material ingest

- One uploaded file/URL creates one Material and one run. A multi-file request
  returns multiple Materials, each with its own `activeRunId`; no opaque batch
  parent is introduced in P2-0.
- Retry creates a new run with `previousRunId`, then compare-and-sets the
  Material from `failed` to `processing` with the new `activeRunId`. Concurrent
  retry loses with `material-retry-conflict` rather than starting two workers.
- Enqueue failure marks both the new run and Material failed, so the UI never
  keeps an endless `processing` row.
- Stage updates surround the existing parse/chunk/embed/delete+upsert/classify
  calls. The S1 delete-before-upsert and strict grounding behavior do not
  change.

### Question generation

- The route validates that the LO exists in the target course before creating
  a run; cross-course LO requests fail synchronously.
- The worker pins allowed ready Material IDs before Qdrant retrieval. Missing
  assignments, retrieval failure, or zero grounding fail the whole run with
  the existing stable S1 codes and create zero Drafts.
- Retrieval is batch-level. Generation/validation/review/persistence is
  item-level: one item failure is appended to `result.failures`, the other
  requested items continue, and each successful Draft ID is persisted on the
  run before the next item begins.
- Terminal result is `completed` when all requested items succeed, `partial`
  when at least one succeeds and at least one fails, and `failed` when no item
  succeeds or a batch-level prerequisite fails.
- P2-0 records run-to-created-question IDs on the run. Template families,
  blueprint identity, similarity/dedup summaries, and exact-retry semantics
  remain P2-I2/P2-I3 rather than being improvised here.

## HTTP contract

All endpoints are instructor-only and use `ensureCourseInstructor()`.
Course-scoped paths avoid a child-resource lookup before authorization and
make cross-course intent explicit.

### Existing endpoints

```text
POST /api/courses/:courseId/materials
  request: unchanged
  response: 201 Material[]; each created Material includes activeRunId

POST /api/materials/:materialId/retry
  request: unchanged
  response: 200 Material with a new activeRunId

POST /api/courses/:courseId/generate
  request: unchanged in P2-0
  old response: 202 { jobId: "generation.run" }
  new response: 202 { runId: string }
```

The generation response is an intentional migration, not an additive alias:
the old value names the Agenda handler, not a job/run. Current client callers
do not use it, and are updated atomically with the route.

### New snapshot/list endpoints

```text
GET /api/courses/:courseId/content-runs
  query: kind? = material-ingest | question-generation
         status? = queued | running | completed | partial | failed
         limit? = integer 1..100 (default 25)
  response: ContentRunSummary[] newest first

GET /api/courses/:courseId/content-runs/:runId
  response: ContentRun (including bounded events)
```

`ContentRunSummary` contains every field except the `events` array; it retains
input/result/error/warnings so history rows can explain what happened without
N follow-up requests.

If `runId` exists under another course, the nested path returns
`404 content-run-not-found`, not the other course's metadata. A caller without
instructor access to `:courseId` receives the standard 401/403 guard result
before run lookup.

### One course-level SSE stream

```text
GET /api/courses/:courseId/content-runs/events
Accept: text/event-stream
```

Why course-level: one upload supports 20 files and therefore 20 runs. One
EventSource per run can exceed normal browser per-origin connection limits and
would make bulk generation equally wasteful.

Response behavior:

```text
event: snapshot
data: { "runs": ContentRunSummary[] }   // current queued/running runs

event: run
id: <runId>:<revision>
data: ContentRunSummary
```

- Authenticate and validate the course before sending SSE headers.
- Send the persisted active-run snapshot immediately on every connection.
- Then send `run` only after the corresponding Mongo CAS succeeds.
- Ignore `Last-Event-ID` for replay: reconnect always starts from the newest
  persisted snapshot, so an in-memory event buffer is never authoritative.
- Send a comment heartbeat at least every 20 seconds and set
  `Cache-Control: no-cache`, `Connection: keep-alive`, and
  `X-Accel-Buffering: no`.
- Remove the subscriber and heartbeat when the request closes.
- The pilot deployment is one app process. Horizontal multi-process fan-out
  would require Mongo change streams or pub/sub and is explicitly outside
  P2-0; persisted snapshots remain correct regardless.

## Restart behavior

The current server does not call `stopJobs()` during shutdown; P2-0 fixes the
shutdown order to stop Agenda before closing Mongo.

On startup:

1. connect Mongo and ensure indexes;
2. start Agenda so its persisted jobs can be inspected, but do not register
   content handlers yet;
3. mark every pre-existing `running` run `failed` with code
   `server-restarted`, `retryable: true`;
4. verify old queued runs still have a matching Agenda job by `data.runId`;
   mark a missing one `failed: content-run-job-missing`;
5. register material/generation handlers; and
6. stale Agenda jobs whose runs became terminal no-op at handler entry.

This is a deliberate pilot guarantee: interrupted generation is clearly
failed and manually rerunnable. Exact once/resume would require idempotency on
each generated Draft and belongs with P2-I2 blueprint/retry provenance.

The jobs component may add a narrow read-only helper such as
`hasPendingJob(name, runId)`; services still do not query the raw `agendaJobs`
collection.

## Client behavior

- Add typed run summary/snapshot/list functions and a small EventSource helper
  in `client/src/api.ts`; no Redux dependency is required.
- Each course authoring view owns one stream and closes it when its root leaves
  the document.
- Materials loads tree + Materials + recent material runs. Each processing row
  uses `activeRunId` to show stage/counters; terminal run updates trigger one
  Material refresh so ready/failed/classification data converges without a
  permanent three-second poll.
- Pre-seeding stores every returned generation `runId`, renders live status and
  success/failure counts, refreshes coverage on terminal success/partial, and
  links completed Draft IDs to the existing Review Queue/detail surfaces.
- Reload recovers active/recent runs from list + the stream's initial snapshot.
  A transient stream failure may use bounded snapshot polling as fallback; it
  never discards the last persisted state.

## Required tests before merge

### Domain/service

- two identical requests create distinct run IDs;
- legal stage/progress CAS persists monotonic fields and one bounded event;
- stale revision, stage regression, counter regression, or terminal mutation
  returns conflict and broadcasts nothing;
- classification failure becomes a warning + completed Material run;
- one failed generated item yields partial and preserves successful Draft IDs;
- batch-level grounding failure yields failed and creates zero Drafts;
- enqueue failure leaves no Material stuck processing;
- concurrent Material retry creates exactly one new active run;
- startup reconciliation fails interrupted/missing-job runs and stale Agenda
  handlers no-op.

### Routes/SSE

- snapshot/list/stream require authentication + the target course instructor;
- mismatched course/run returns indistinguishable 404;
- list filters/limit validate and sort newest first;
- connect and reconnect receive current persisted active snapshots;
- an update is observable only after the mocked persistence promise resolves;
- disconnect removes the subscriber/heartbeat.

### Compatibility/UI

- existing upload/retry responses retain every Material field plus
  `activeRunId`;
- generation returns a unique `runId` and all current client callers compile;
- materials no longer leak a permanent poll interval;
- generation terminal updates refresh coverage and expose created/failed
  counts;
- full strict-grounding, materials, generation, jobs, app-smoke, Jest,
  typecheck, lint, and build suites remain green under Node 22.

## Explicit non-goals

- cancellation, pause/resume, or automatic retry endpoints;
- generation blueprint editing, similarity dedup, or prompt-history summary;
- template/family provenance or parameterized variants;
- knowledge-graph storage/Neo4j;
- Redux, WebSockets, or a second job/workflow engine; and
- multi-process SSE fan-out.

## Asynchronous integration note for Saurav

No acknowledgment is required before Stephen continues. During normal PR
review, please name any concrete objection against one of:

1. one run per Material (rather than one upload-batch run);
2. one course-level SSE stream;
3. `{ runId }` replacing the constant `{ jobId }`;
4. `partial` generation semantics; or
5. explicit failed-on-restart instead of unsafe automatic resume.

Stephen explicitly authorized implementation without waiting for
acknowledgment. Saurav remains informed through this synced proposal and may
raise a concrete objection during branch/PR review. The shared API contract and
core Phase 2 plan are updated in the same code PR.
