# Stephen — Phase 2 Review-Derived Improvements

_Authorizing developer: Stephen (Dev A)_  
_Status: P2-0 contract prepared and synced; waiting at Saurav review point_  
_Branch: `codex/phase-2-content-runs`_  
_Phase 1 Task 16: intentionally deferred, not completed_

> The repository-required `superpowers:writing-plans` skill is unavailable in
> this Codex environment. This plan follows the repository's existing
> task/interface/test format manually. Stephen explicitly authorized taking
> over the first cross-owner item, provided the work is recorded in his status.

## Goal

Turn the problems Stephen found while exercising Task 16 into a reliable Phase
2 authoring workflow. Start with durable, visible ingest/generation runs so a
reload or server restart never turns long-running content work into an opaque
spinner. Build later workflow improvements on that source of truth instead of
adding more fire-and-forget endpoints.

## Sequencing decisions

- Phase 1 Task 16 stays unchecked and may be resumed later; Phase 1 exit is not
  claimed.
- P2-0 is the only active implementation item in this branch.
- Stephen is taking over P2-0 from Saurav's proposed lane. Saurav reviews the
  contract and instructor/AI integration; he should not implement P2-0 in
  parallel.
- A P2-0 API contract proposal is a required sync point. Prepare it, sync it,
  and stop for Saurav's review before changing shared endpoints.
- Do not add Redux, WebSockets, GraphQL, Neo4j, or a parallel workflow engine.
  Mongo stores run truth, Agenda executes work, and native SSE carries updates.

## Improvement map

| Order | Improvement | Why it belongs here | Relationship to core Phase 2 |
|---|---|---|---|
| P2-I0 | Persistent content runs + live progress | Fixes invisible ingest/generation hangs and makes recovery/test evidence possible | New prerequisite for core Task 10 |
| P2-I1 | Course lifecycle and authoring checklist | Course code/section, UBC term dates, archive, and explicit workflow state | Additive course/admin work; not part of P2-I0 |
| P2-I2 | Generation blueprint + run history | Pins prompt, LO, allowed materials, counts, model decisions, failures, and retry provenance | Reframes core Task 10 |
| P2-I3 | Template/family provenance | Connects generated/imported questions and parameterized variants without a second content model | Extends core Tasks 5, 8, and 9 |
| P2-I4 | Finite practice rounds + history | Replaces endless question flow with unseen-set completion and explicit repeat rounds | Extends core Task 7 |
| P2-I5 | Content map and material-kind metadata | Makes source coverage and assessment detection visible to instructors | Follow-up after durable ingest runs |

Only P2-I0 is authorized for implementation in this plan. The remaining rows
are backlog inputs to future personal plans after P2-I0 and the Phase 2 owner
map are reviewed.

---

## P2-I0: Persistent content runs and live progress

**Owner:** Stephen (explicit cross-owner takeover)  
**Reviewer:** Saurav  
**Sync point:** API/domain contract before implementation  
**Depends on:** merged Phase 1 jobs, materials, generation, S1 grounding

### Intended behavior

- One Mongo `contentRuns` record is the recoverable source of truth for every
  material-ingest or generation request.
- Agenda receives only a `runId`; workers persist `queued → running → terminal`
  stage/progress updates before notifying connected clients.
- The client receives a unique run ID immediately, can reload and recover the
  current state, sees specific stages/counters/errors, and can inspect recent
  runs instead of polling Material status forever.
- SSE is a live optimization over persisted snapshots. Reconnect sends current
  state first; an in-memory subscriber list is never authoritative.
- Terminal generation state supports `partial`: valid Drafts survive when one
  requested item fails, and per-item failures are inspectable.
- Startup reconciliation marks orphaned `running` records failed with an
  explicit interruption code unless a safe resumable stage is designed and
  tested. P2-I0 does not silently pretend interrupted work is still running.

### Contract preparation

- [x] Inspect current jobs/materials/generation/domain/client conventions.
- [x] Write the exact `ContentRun` discriminated union and legal transitions.
- [x] Draft additive run snapshot/list/SSE endpoints and enqueue-response
  migration, including guard/error semantics.
- [x] Update Stephen's plan/status and sync for Saurav review (`a971d25`).
- [ ] Stop at the contract sync point; do not edit shared API routes before
  Saurav has acknowledged or raised a concrete interface objection.

### Implementation after contract acknowledgment

- [ ] Add `ContentRun` domain types, `contentRunsCol()`, indexes, and a bounded
  append/update service with compare-and-set legal transitions.
- [ ] Add authenticated course-scoped snapshot/list/SSE routes; persist before
  broadcast and clean up subscribers on disconnect.
- [ ] Change material enqueue/worker flow to create and advance an ingest run,
  returning/linking its unique ID without breaking material retrieval.
- [ ] Change generation enqueue/worker flow to create and advance a generation
  run, record allowed material IDs/source provenance, preserve successful
  Draft IDs, and surface per-item failures.
- [ ] Reconcile orphaned runs during startup after jobs are registered.
- [ ] Add instructor progress/history UI with reload/reconnect behavior and
  actionable terminal errors.
- [ ] Update `docs/api-contract.md`, component guidance, shared state, and the
  shared Phase 2 core plan in the same PR once the contract is accepted.

### Required tests

- [ ] Identical enqueue requests receive distinct run IDs.
- [ ] Legal stages are persisted with monotonic counters; stale/illegal updates
  fail compare-and-set without broadcasting false progress.
- [ ] Every broadcast follows a successful Mongo write.
- [ ] SSE connect/reconnect receives the latest snapshot, then future events.
- [ ] Cross-course and wrong-role snapshot/list/SSE reads are rejected.
- [ ] One generation item failure yields `partial` and preserves successful
  Draft IDs plus failure details.
- [ ] Material parse/chunk/embed/index failures become durable terminal runs and
  never leave the UI in an endless `processing` state.
- [ ] Startup reconciliation gives interrupted runs an explicit terminal error.
- [ ] Existing material, generation, strict-grounding, and job tests remain
  green after contract migration.
- [ ] Typecheck, lint, build, full Jest, and the focused browser reconnect flow
  pass under the repository's supported Node 22 runtime.

## Stop condition for this first slice

P2-I0 changes shared API behavior and is therefore a two-developer sync point.
The first deliverable is a precise contract/design proposal published through
`sync-plans`. Implementation starts after Saurav review; merge waits for the
same reviewer plus the verification evidence above.

Contract proposal:
[`2026-07-22-p2-0-content-run-contract-proposal.md`](./2026-07-22-p2-0-content-run-contract-proposal.md).
