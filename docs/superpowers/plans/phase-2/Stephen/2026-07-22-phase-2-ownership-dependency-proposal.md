# Phase 2 Ownership and Dependency Proposal

_Authorizing developer: Stephen (Dev A)_  
_Status: Stephen-approved default; Saurav asynchronous review required before integration into the shared Phase 2 core plan_  
_Implementation status: not started_

> This is not Stephen's personal Phase 2 implementation plan. It fixes the
> missing owner/dependency layer so both developers can generate their own
> task-by-task plans after Phase 1 exits. Until it is copied into the shared
> core plan and acknowledged by Saurav, no agent should start Phase 2.

## Phase 2 entry gate

All conditions are required:

- [x] Phase 1 S1 strict grounding is merged (PR #25).
- [x] Phase 1 S2 transition CAS is merged (PR #25).
- [ ] Phase 1 Task 16 and its full verification suite pass.
- [ ] Task 13 is recorded as slipped.
- [ ] The shared Phase 2 plan contains the owner map below.
- [ ] Stephen and Saurav each create and sync a personal Phase 2 plan containing
  only their owned work.

## Owner map

| Work | Primary owner | Review/integration owner | Rationale |
|---|---|---|---|
| P2-0 persistent ingest/generation runs + SSE | Dev B / Saurav | Dev A / Stephen | Extends Saurav's jobs, materials, generation, instructor UI |
| Task 1 flag service/state machine | Dev B / Saurav | Dev A / Stephen | Extends Question transitions and instructor safety flow |
| Task 2 student flag control | Dev A / Stephen | Dev B / Saurav | Student practice surface |
| Task 2 instructor resolution queue | Dev B / Saurav | Dev A / Stephen | Instructor review surface; integrates Task 2 |
| Task 3 notifications | Dev B / Saurav | Dev A / Stephen | Jobs + flag/instructor workflow; student recipient behavior reviewed by Dev A |
| Task 4 parameter sandbox | Dev A / Stephen | Dev B / Saurav | Platform/security boundary |
| Task 5 parameter serving/config | Dev A / Stephen | Dev B / Saurav | Serving/attempt pinning is Dev A's Phase 1 arc |
| Task 6 remediation | Dev B / Saurav | Dev A / Stephen | Instructor flag resolution and affected-student review |
| Task 7 progression/redirect + finite rounds | Dev A / Stephen | Dev B / Saurav | Mastery, attempts, practice/session surface |
| Task 8 question import | Dev B / Saurav | Dev A / Stephen | Instructor content supply |
| Task 9 script migration | Dev B / Saurav | Dev A / Stephen | Extends import; consumes Dev A sandbox/parameter service |
| Task 10 custom generation/blueprint | Dev B / Saurav | Dev A / Stephen | Generation/instructor content workflow |
| Task 11 phase exit | Joint; Stephen drives E2E | Joint | Crosses both arcs |

Task 2 should be split into two independently reviewable commits/checkbox
groups while retaining one shared feature task. Dev B integrates after both
surfaces are ready. Neither developer edits the other's surface opportunistically.

## Dependency graph

1. Phase 1 S1 → P2-0 and Task 10.
2. Phase 1 S2 → Task 1 → Tasks 2, 3, 6, and 11.
3. P2-0 → Task 10; the generation UI must use run state, not another ad hoc
   polling mechanism.
4. Task 3 → Tasks 6 and 7 notification emissions.
5. Task 4 → Task 5 → Task 9.
6. Task 8 → Task 9.
7. Tasks 1, 2, 3, and 6 → Task 11 flag-loop exit proof.
8. Task 7 may run after Task 3 and the existing Phase 1 mastery/attempts arc; it
   does not depend on parameterization.

P2-0 and Tasks 1/4 may start in parallel once the entry gate is satisfied.

## P2-0: Persistent content runs and live progress

**Owner:** Dev B / Saurav  
**Reviewer:** Dev A / Stephen  
**Contract sync point:** yes — approve interfaces in `docs/api-contract.md`
before implementation

**Goal:** Agenda remains the executor, while Mongo run records become the
recoverable source of truth for material ingestion and question generation.

**Proposed domain model:** a `ContentRun` discriminated union in one collection:

- common fields: `_id`, `kind`, `courseId`, `requestedBy`, `status`, `stage`,
  `completedUnits`, `totalUnits`, `createdAt`, `startedAt?`, `completedAt?`,
  `error?`, `events[]` (bounded); and
- `kind: 'material-ingest'` input/result pins `materialId`, filename/source,
  parse/chunk/embed/index counts; or
- `kind: 'generation'` input/result pins LO(s), allowed material IDs,
  blueprint/prompt, requested count, models, created question IDs, and per-item
  failures.

Statuses: `queued | running | completed | partial | failed | cancelled`.
Generation stages: `queued → retrieving → generating → validating → reviewing
→ completed/partial/failed`. Ingest stages: `queued → parsing → chunking →
embedding → indexing → completed/failed`.

**Proposed API (requires joint contract approval):**

- generation enqueue returns `202 { runId }`, a unique Mongo identifier rather
  than the constant Agenda job name;
- each returned Material gains an additive `activeRunId` or equivalent link;
- `GET /api/runs/:runId` returns the recoverable snapshot;
- `GET /api/courses/:courseId/runs?kind=&status=` lists recent runs; and
- `GET /api/runs/:runId/events` is same-origin authenticated SSE.

Every stage update writes Mongo before broadcasting. SSE reconnect first sends
the latest snapshot, so an in-memory subscriber list is never the source of
truth. Native `EventSource` is sufficient; no Redux or WebSocket dependency.

**Required tests:**

- [ ] enqueue returns distinct run IDs for identical requests;
- [ ] every stage transition persists before broadcast;
- [ ] reconnect receives the current snapshot and subsequent events;
- [ ] one failed generated item yields `partial`, preserving successful Drafts;
- [ ] server restart/re-registration can resume or clearly fail an orphaned
  `running` run;
- [ ] course/user guards prevent cross-course run reads/SSE subscription; and
- [ ] existing material and generation happy paths remain compatible after the
  contract migration.

## Changes to existing Phase 2 tasks

When merging this proposal into the shared core plan:

- Task 1 explicitly depends on Phase 1 S2.
- Task 2 receives the split owner line above.
- Task 5 adds `templateFamilyId?`, generator/import provenance, and seed pinning
  to the accepted domain design before implementation.
- Task 7 includes finite-round semantics: unseen set → round summary → explicit
  continue-with-repeats; persistent `practiceSessionId` is added only if the
  pilot requires reload/cross-device history.
- Tasks 8/9 create Draft QuestionVersions with template/family/import
  provenance rather than a parallel content model.
- Task 10 is rewritten around a persisted GenerationBlueprint + P2-0 run. It
  must not introduce a second fire-and-forget generation endpoint.
- Task 11 remains the flag safety exit proof; add a separate content-run E2E to
  P2-0 rather than bloating the flag loop.

## Shared-document integration sequence

1. Saurav acknowledges or raises a concrete objection in his Phase 1/2 status.
2. Update the shared Phase 1 plan with S0–S3 and the Task 13 slip decision.
3. Update the shared Phase 2 core plan with the entry gate, P2-0, owner lines,
   and dependency edits.
4. Jointly update PRD/domain/API only for accepted behavioral/interface changes.
5. Stephen and Saurav write/sync personal Phase 2 implementation plans.

This is the stopping point for planning. Phase 2 code begins only after the
entry gate and shared-document integration are complete.
