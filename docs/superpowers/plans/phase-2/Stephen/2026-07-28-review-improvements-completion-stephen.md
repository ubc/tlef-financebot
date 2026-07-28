# Stephen — Phase 2 Review Improvements Completion Plan

**Owner:** Stephen (Dev A)  
**Status:** authorized by Stephen on 2026-07-28; audit complete; implementation starting  
**Base:** `origin/main` at `d6e1f4a`  
**Branch:** `codex/phase-2-review-improvements`

The required `superpowers:writing-plans` skill is unavailable in this Codex
environment. This plan follows the repository's existing personal-plan,
interface, test, and progress-tracking format manually.

## Goal

Finish the still-missing parts of P2-I1 through P2-I5 from
[`2026-07-22-phase-2-review-improvements-stephen.md`](2026-07-22-phase-2-review-improvements-stephen.md)
without reimplementing Phase 2 work already merged to `main`.

## Baseline audit

| Improvement | Current merged state | Work in this plan |
|---|---|---|
| P2-I0 durable content runs | Complete in PR #32 | None |
| P2-I1 course lifecycle/checklist | Course code, term, dates, publish Boolean, and a server checklist exist | Add section metadata, explicit lifecycle, archive/restore, a read-only checklist endpoint, and matching instructor UI |
| P2-I2 generation blueprint/history | P2-I0 run history and Task 10 custom prompts/regeneration are merged | Add reusable persisted blueprints, blueprint/run linkage, and exact terminal-run retry provenance |
| P2-I3 template/family provenance | Parameter serving, import, script migration, and generation are merged | Add one additive family/lineage contract across generated, imported, migrated, and edited versions |
| P2-I4 finite practice rounds/history | Complete in Task 7 / PR #37, including explicit continue-with-repeats | No implementation; retain regression coverage |
| P2-I5 content map/material kind | Material assignments and counts exist, but no kind metadata or unified map | Add material-kind metadata, deterministic suggestion/manual correction, course content-map API, and instructor view |

## Ownership and coordination

Stephen explicitly authorized completing every still-missing row. P2-I2 and
P2-I3 extend areas originally reviewed or owned by Saurav in Tasks 8–10; this
is an explicit cross-owner takeover. Saurav's current FinanceBot landing work
is client-only and already merged, and no active claim overlaps this branch.
The exact contract and file list are published before implementation; Saurav
may review normally but acknowledgment is not an entry gate.

Shared files remain append-only where required. No Redux, WebSockets, GraphQL,
Neo4j, second question model, or second job engine is introduced.

## Slice I1 — Course lifecycle and authoritative checklist

### Contract

- Add `Course.section?: string`, `Course.lifecycle:
  'draft' | 'published' | 'archived'`, `updatedAt`, and optional
  `archivedAt`.
- Legacy course rows without `lifecycle` normalize from
  `archivedAt`/`published`; the existing `published` Boolean remains
  source-compatible and is updated atomically with lifecycle transitions.
- Creation accepts optional `section` and creates `lifecycle: 'draft'`.
- Course metadata updates accept name, course code, section, term, and dates.
- `POST /api/courses/:courseId/publish` moves draft to published.
- `POST /api/courses/:courseId/unpublish` moves published to draft.
- `POST /api/courses/:courseId/archive` forces `published: false`, records
  `archivedAt`, and moves to archived.
- `POST /api/courses/:courseId/restore` removes `archivedAt` and restores a
  draft; republishing remains explicit.
- `GET /api/courses/:courseId/publish-checklist` exposes the existing
  side-effect-free checklist so client and server use one truth.
- Archived courses remain instructor-readable for history but are unavailable
  to enrollment/student practice through the existing published/access path.

### Work

- [ ] Add domain normalization and legal lifecycle transitions.
- [ ] Add service/route/client contracts and lifecycle tests.
- [ ] Replace the client-derived checklist with the server checklist.
- [ ] Add editable course metadata plus archive/restore controls and state
  labels to Settings/Dashboard/Course list.

## Slice I2 — Persisted generation blueprints and exact retry

### Contract

Add `generationBlueprints`:

```ts
interface GenerationBlueprint {
  courseId: ObjectId;
  name: string;
  loId: ObjectId;
  count: number;
  type: QuestionType;
  difficulty?: Difficulty;
  prompt?: string;
  materialIds?: ObjectId[];
  models: QuestionGenerationRun['input']['models'];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lastRunId?: ObjectId;
}
```

- Add a unique course/name index and a course/updatedAt list index.
- Add instructor-only list/create/update endpoints under
  `/api/courses/:courseId/generation-blueprints`.
- `POST /api/courses/:courseId/generate` accepts optional `blueprintId`.
  When supplied, immutable run input is copied from the blueprint and the run
  records `blueprintId`; Agenda still receives only `{ runId }`.
- Add optional `blueprintId` and `retryOfRunId` to generation-run input.
- Add `POST /api/courses/:courseId/content-runs/:runId/retry`. It creates a
  distinct run from a terminal generation run, copies its request/model
  snapshot and pinned material IDs, and records `retryOfRunId`. It never
  mutates or reopens the original.
- A retry of a non-terminal/material/cross-course run is rejected with a
  stable error. Enqueue failure remains a durable failed run.
- The instructor generation page can save/load blueprints and retry eligible
  failed/partial runs from history.

### Work

- [ ] Add collection/types/indexes and blueprint service/route tests.
- [ ] Extend run creation/worker input without changing the run-only Agenda
  payload invariant.
- [ ] Add exact terminal-run retry and provenance tests.
- [ ] Add blueprint selection/save and run-history retry UI.

## Slice I3 — Question family and version provenance

### Contract

- Add `Question.templateFamilyId?: ObjectId`.
- Add optional `QuestionVersion.provenance` as a discriminated additive
  lineage record:
  - `manual`
  - `generated` with `runId`, optional `blueprintId`, and item index
  - `imported` with format, optional source name, and source item index
  - `script-migration` with optional source name
  - `edited` with `parentVersionId`
- New questions default their family to their own question ID. Derived
  versions retain the same family; no parallel template collection or content
  model is introduced.
- Generation, CSV/JSON/QTI import, and script migration write their exact
  provenance at creation. Existing rows without provenance remain readable.
- Manual edits write `edited` lineage pointing at the previous immutable
  version. Parameter seeds remain pinned on AttemptRecords as already
  implemented; provenance never rewrites historical attempts.
- Question detail exposes family and origin in an instructor-only metadata
  section.

### Work

- [ ] Extend `createQuestion`/`editQuestion` and focused lineage tests.
- [ ] Wire generation run/item, import source, and migration provenance.
- [ ] Expose provenance through bank/detail client types and UI.

## Slice I4 — Finite practice rounds

- [x] Task 7/PR #37 exhausts unseen Approved questions before a repeat,
  treats the first repeat as a round boundary, shows a round summary, and
  requires explicit confirmation before starting repeats.
- [x] Existing serving and `practice-session` tests pin the behavior.
- [ ] Re-run those regressions after the other slices; no new persistent
  session model is added because the pilot requirement is already met.

## Slice I5 — Material kind and course content map

### Contract

- Add `Material.kind`:
  `lecture | reading | assignment | assessment | solution | reference | other`.
- New materials receive a deterministic filename/name suggestion; instructors
  can correct it with
  `PATCH /api/courses/:courseId/materials/:materialId { kind }`.
- Existing materials without a kind normalize to `other`.
- Add `GET /api/courses/:courseId/content-map`, returning ordered
  Theme/LO rows with:
  - assigned material summaries grouped by kind;
  - explicit assessment-like markers for assignment/assessment/solution;
  - question counts by publication state;
  - latest material-ingest/generation run status; and
  - gaps (`no-material`, `no-approved-questions`, `thin-approved-set`).
- The endpoint is instructor-only and never exposes content from another
  course.
- Add an Instructor Content Map view linked from the course dashboard and
  Materials page. The view is informational; assignment editing remains in
  Materials.

### Work

- [ ] Add kind inference, metadata patch, compatibility, and route tests.
- [ ] Add content-map aggregation with course-scoping tests.
- [ ] Add API types, route/nav wiring, and instructor content-map UI.

## Verification and completion

- [ ] Focused Jest suites for every slice.
- [ ] Full Jest, server/client typecheck, lint, build, and `git diff --check`
  under a supported Node 22+ runtime.
- [ ] Live instructor browser smoke for lifecycle, blueprint retry,
  provenance display, and content map when backing services are available.
- [ ] Update this plan, Stephen `STATUS.md`, the original improvement map,
  `docs/api-contract.md`, nearest `AGENTS.md`, and the shared Phase 2 plan.
- [ ] Run `npm run sync-plans -- Stephen` after implementation.
