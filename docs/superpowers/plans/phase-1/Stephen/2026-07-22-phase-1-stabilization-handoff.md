# Phase 1 Stabilization and Exit Handoff

_Authorizing developer: Stephen (Dev A)_  
_Status: default execution plan; Saurav asynchronous review required before Dev B tasks begin_  
_Code changes authorized by this document: none yet_

> This is a cross-arc handoff stored in Stephen's folder so `sync-plans`
> publishes it to Saurav. Stephen's agent must not implement Dev B tasks. If
> Saurav has no concrete objection, this becomes the input for each developer's
> short-lived implementation branch and the shared-plan update.
>
> The required `superpowers:writing-plans` skill was unavailable when this was
> written, so the repository's existing task/interface/test format is followed
> manually.

## Goal

Finish Phase 1 on a trustworthy content path: a generated Draft is grounded
only in material assigned to its LO, concurrent state transitions cannot
overwrite one another, and the joint exit test proves the real instructor →
student loop. Avoid pulling Phase 2 workflow features into the Phase 1 gate.

## Fixed decisions

- Task 13 (Layer-2 LLM mastery) is **slipped**, not ownerless.
- Tasks 7, 8, and 15 are treated as merged; their stale shared checkboxes are
  coordination debt, not unfinished implementations.
- Strict grounding and transition compare-and-set are Phase 1 stabilization.
- Persistent run history/SSE, blueprints, course archive, templates, and finite
  practice rounds remain Phase 2 work.
- No endpoint is added by the stabilization tasks. If implementation requires
  an API-contract change, stop and use the two-developer contract sync point.

## Execution order

`S0 plan reconciliation → S1 strict grounding → S2 transition CAS → S3 joint Task 16`

S1 and S2 may be implemented in parallel on separate Dev B branches after
Saurav acknowledges the handoff. S3 starts only after both are merged.

---

### S0: Reconcile the shared Phase 1 plan

**Owner:** Dev B (Saurav), docs-only  
**Reviewer:** Dev A (Stephen)

**Files:**

- Update: `docs/superpowers/plans/phase-1/2026-07-11-phase-1-core-loop.md`
- Update: `docs/superpowers/plans/phase-1/Saurav/STATUS.md`
- Update: `docs/superpowers/plans/phase-1/Saurav/PHASE-1-UI-HANDOFF.md`

**Required result:**

- [ ] Mark Tasks 7, 8, and 15 implementation steps complete against merged PRs
  #19, #20, and #21.
- [ ] Record PR #21 as merged rather than open.
- [ ] Mark Task 13 `slipped after Stephen's 2026-07-22 closeout decision`;
  leave its implementation checkboxes unchecked so the history stays honest.
- [ ] Add S1/S2 as Phase 1 stabilization prerequisites to Task 16, without
  rewriting the completed task briefs.
- [ ] Run `npm run sync-plans -- Saurav`.

This task changes status only. Do not use it to claim S1/S2 complete.

---

### S1: Strict assigned-material grounding and clean re-ingest

**Owner:** Dev B (Saurav — materials/generation arc)  
**Reviewer:** Dev A (Stephen — student-serving/provenance consumer)  
**Depends on:** merged Phase 1 Tasks 6 and 8

**Files:**

- Modify: `server/src/components/qdrant/index.ts`
- Modify: `server/src/components/qdrant/AGENTS.md`
- Modify: `server/src/services/materials.service.ts`
- Modify: `server/src/services/generation.service.ts`
- Modify: `tests/unit/materials.service.test.ts`
- Modify: `tests/unit/generation.service.test.ts`
- Add or modify: Qdrant component unit tests following the existing component
  test pattern

**Interfaces:**

1. Extend the Qdrant component with filter-aware search while keeping existing
   callers source-compatible:

   `search(name, vector, limit?, filter?): Promise<SearchHit[]>`

   The optional filter is passed to `qdrant.search`. Add
   `deletePointsByFilter(name, filter): Promise<void>` using a waited delete.
   The component owns raw Qdrant filter shapes; services must not reach into
   the exported client directly.

2. Ingest payloads gain `chunkIndex` alongside `materialId` and `chunk`. Before
   upserting a re-ingested material, delete all old points matching that
   `materialId`, then upsert the new deterministic set. Because retry marks the
   Material `processing` first, generation never treats the delete/upsert gap as
   ready evidence. A failed replacement remains visible as `failed`; stale tail
   vectors are never retained.

3. Generation resolves allowed ready materials from Mongo before vector search.
   An LO may use:

   - a ready material assigned directly to that LO; or
   - a ready material assigned to the LO's Theme with no narrower `loId`.

   Material assigned only to another LO/Theme is forbidden even if it scores
   highly in the course collection.

4. Search Qdrant with a `materialId any [allowed ids]` filter. The pipeline
   throws stable service errors and makes **zero LLM/createQuestion calls** for:

   - `generation-no-assigned-materials`
   - `generation-retrieval-failed`
   - `generation-no-grounding`

   Remove the current “generate ungrounded” fallback and the `(no course
   material retrieved...)` prompt branch. No general-model-knowledge mode is
   introduced in Phase 1.

5. Existing cross-course LO protection, sourceRefs, three-model orchestration,
   Draft-only persistence, and invalid-option retry behavior remain unchanged.

**Required tests:**

- [ ] Filter-aware Qdrant search forwards the filter and existing unfiltered
  calls still work.
- [ ] Filter delete uses `wait: true` and the supplied `materialId` condition.
- [ ] Ingest records `chunkIndex` and calls delete before replacement upsert.
- [ ] A shorter re-ingest replaces the material's full vector set conceptually;
  no old tail survives the service call ordering.
- [ ] Direct-LO and Theme-wide assignments are allowed.
- [ ] A material assigned only to a sibling LO is excluded from the search
  filter and can never enter `sourceRefs`.
- [ ] No assigned ready material throws `generation-no-assigned-materials`
  before embedding/search/LLM calls.
- [ ] Search rejection throws `generation-retrieval-failed`; zero filtered hits
  throws `generation-no-grounding`; neither inserts a Draft.
- [ ] Existing generation tests remain green after updating the search mock
  expectation to include the filter.

**Verification:**

`npx jest tests/unit/materials.service.test.ts tests/unit/generation.service.test.ts <qdrant-test>`  
`npm run typecheck && npm run lint && npm run build`

**Stop condition:** if a user-visible async failure response requires changing
`docs/api-contract.md`, keep the correctness behavior and defer the richer
failure UI to Phase 2 run records. Do not invent a one-off polling endpoint.

---

### S2: Compare-and-set publication transitions

**Owner:** Dev B (Saurav — question state machine owner)  
**Reviewer:** Dev A (Stephen — serving/attempts consumer)  
**Depends on:** merged Phase 1 Tasks 4 and 5

**Files:**

- Modify: `server/src/services/questions.service.ts`
- Modify: `server/src/routes/questions.routes.ts`
- Modify: `tests/unit/questions.service.test.ts`
- Modify: `tests/unit/questions.routes.test.ts`

**Interfaces:**

- Keep `transitionQuestion(questionId, to, byPuid)` source-compatible.
- After reading and validating `from → to`, update with
  `{ _id: questionId, state: from }`, not `{ _id: questionId }`.
- Require `matchedCount === 1`. A mismatch throws `question-conflict`; it does
  not write an audit event and does not return the locally constructed state.
- Map `question-conflict` to HTTP 409. The client already reloads after a
  transition; show the existing inline error/retry pattern if a conflict is
  surfaced.
- `bulkTransition` treats `question-conflict` like another per-item domain
  skip, while infrastructure errors still propagate.
- Do not add a `revision` field in this stabilization task. Expected-state CAS
  closes the publication race without a schema/API migration. Base-version CAS
  for simultaneous content editing may be planned separately if evidence shows
  the unique version index is insufficient.

**Required tests:**

- [ ] Successful transition filters by `_id + expected state`, changes one
  document, then writes exactly one correct audit record.
- [ ] `matchedCount: 0` throws `question-conflict`, returns no optimistic state,
  and writes no audit record.
- [ ] Two simulated reviewers reading the same old state yield one success and
  one conflict rather than two contradictory audits.
- [ ] Route maps `question-conflict` to 409.
- [ ] Bulk transition skips a conflicted item, reports only successful updates,
  and still propagates an unexpected Mongo failure.

**Verification:**

`npx jest tests/unit/questions.service.test.ts tests/unit/questions.routes.test.ts`  
`npm run typecheck && npm run lint`

---

### S3: Joint Phase 1 exit proof

**Owner:** Joint; Stephen drives the tests, Saurav verifies the instructor/AI path  
**Depends on:** S0, S1, and S2 merged

**Files and normative behavior:** use Task 16 in the shared Phase 1 core plan.
Do not create a competing test contract in this handoff.

- [ ] Stephen implements or completes `approved-only-serving.test.ts`.
- [ ] Stephen implements or completes `core-loop-demo.spec.ts`.
- [ ] With both developers present or asynchronously recording results, run the
  real path: upload → ready → assign material → suggest/apply hierarchy →
  generate → Draft review → approve → enroll → practice → Review Book → mastery.
- [ ] Explicitly verify the negative grounding case: an LO with no assigned
  ready material produces no Draft and logs the stable grounding error.
- [ ] Run `npm run lint && npm run typecheck && npm test && npm run test:e2e`.
- [ ] Mark Task 16 and the Phase 1 exit criteria complete only after evidence is
  recorded in both developers' status files.

## Review protocol

Saurav's review is intentionally lightweight: acknowledge the plan or name a
specific objection with the affected interface/test. Silence is not treated as
approval by an agent; a Saurav session must record acknowledgment before Dev B
implementation begins. Any API-contract change remains a hard stop for joint
review.
