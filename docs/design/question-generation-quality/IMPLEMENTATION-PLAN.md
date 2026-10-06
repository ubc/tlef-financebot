# FinanceBot Generation Quality and Usage Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` when available to implement this plan in reviewed slices. Follow the nearest `AGENTS.md`; preserve unrelated work.

**Date:** 2026-10-03. **Status:** Observability, an opt-in source-grounding/question-memory pilot, and offline blinded-review/reporting tools are implemented locally. See [Implementation status](IMPLEMENTATION-STATUS.md) for verification, scope, deviations, and remaining work. The pilot provides bounded, best-effort checks; it does not complete every requirement of Slices 3, 4, or 7. A prospective A/B execution/capture runner, actual teacher labels, serialized candidate commits, and a paid quality comparison remain planned; no deployment is claimed.

**Goal:** Reduce questions that exceed the supplied teaching material or repeat an existing learning task, while reducing teacher review time and measuring the model usage required for each accepted independent question.

**Architecture:** Extend the existing TypeScript generation workflow, Agenda jobs, MongoDB content runs, numerical verification, and course-scoped SSE. Add an authoritative model-call ledger, versioned evidence and question memory, and bounded repair decisions. Test incremental changes against the current pipeline before adding model-selected actions or a graph framework.

**Tech stack:** Existing Express/CommonJS TypeScript backend, native TypeScript browser client, MongoDB, Qdrant, UBC GenAI toolkit, Jest, and Playwright. No new framework is a prerequisite.

**Related research:** [Research proposal](RESEARCH-PROPOSAL.md). The research explains the current system, historical experiments, open-source references, and why the proposed mechanisms could help.

## Global constraints

- Author project files, plans, comments, UI text, and evaluation instructions in English. Preserve original course source content and teacher quotations as evidence.
- Work from the current source tree, which contains unrelated uncommitted development. Audit and isolate the intended changes before implementation; do not reset, commit, or deploy unrelated work.
- Preserve instructor approval, course authorization, numerical verification, parameter proof/serving gates, and existing Hard construction rotation. Keep model/settings snapshots equal across experimental arms.
- Do not treat another model's approval, a real citation ID, or a framework choice as proof of educational quality.
- Usage instrumentation must not trigger another paid request when recording fails. Missing usage is unknown, not zero.
- Initial accounting covers explicitly instrumented LLM authoring calls. Do not label it total application cost; embeddings, parsing, and infrastructure are excluded unless separately instrumented.
- Initial evaluation runs use a disposable course/database and frozen source snapshots. The existing panel writes Draft questions; it is not a read-only benchmark.
- Experimental quality logic is opt-in per course/run, with its effective policy version frozen in the run. Existing records remain readable without invented historical evidence or usage.

## What the CREATE implementation teaches us

The local `tlef-create` working tree implements persistent token receipts for Studio authoring. Some relevant files are currently untracked; this audit does not establish their deployment status. Reuse the design, not its React/Mongoose implementation wholesale.

| CREATE source, relative to the sibling repository | Verified behavior | FinanceBot adaptation |
| --- | --- | --- |
| `routes/create/services/authoring/authoringTokenUsage.js` | Receipt starts pending, captures provider counts, finishes with outcome; writes are idempotent | A separate MongoDB collection keyed by a stable call ID |
| `routes/create/models/ModelTokenReceipt.js` | Stores scoped IDs, provider/model, timestamps, and nullable counts | Store metadata only; no prompt, source text, response body, credentials, or raw provider error |
| `routes/create/services/authoring/authoringOperations.js` | AsyncLocalStorage carries authoring scope | Establish explicit context inside Agenda work; HTTP context alone cannot cover background calls |
| `routes/create/utils/openAICompletion.js` and `routes/create/services/llmService.js` | Captures native nonstream usage and terminal stream usage, including reported usage on failed/truncated responses | Repair the provider boundary before claiming reliable generator totals |
| `src/components/h5p/authoring/AuthoringProgress.tsx` | Distinguishes complete, partial, pending, and unavailable counts; refresh rehydrates persisted totals | Add a compact usage view to the existing generation workbench and admin diagnostics |
| `routes/create/__tests__/unit/authoringTokenUsage.test.js` and `providerTokenReceipt.test.js` | Covers unknown/zero counts, duplicate events, failures, and recording faults | Port behavioral cases into FinanceBot's Jest tests |

CREATE does not currently provide dollar billing, an actual spend cap, or embedding usage accounting in this feature. Its action-count budget is different from a token or currency budget.

FinanceBot has three concrete gaps:

1. `server/src/components/genai/llm/index.ts` already exposes `onUsage`, including JSON repair, but production generation does not supply it. It also discards response metadata and detailed usage.
2. Installed toolkit `0.3.0` loses streaming usage on relevant provider paths. The public generator streams, so connecting the existing callback alone will still omit its consumption.
3. `admin-diagnostics.service.ts` removes every key containing `token`. A new explicit numeric usage DTO is required; weakening credential redaction globally would be incorrect.

The prompt A/B harness also treats absent counts as zero, counts only usage callbacks as calls, and excludes error rows from its aggregate expenditure. Correct these before using cost comparisons to select a quality strategy.

## Delivery order and decision gates

Checked items describe the verified local implementation. Unchecked items may have partial groundwork; consult the implementation status before treating an entire slice as complete.

| Slice | Deliverable | Completion evidence | Dependency |
| --- | --- | --- | --- |
| 1 | Provider observations and persistent token ledger | Stream/nonstream, retry, failure, unknown, and replay tests pass | None |
| 2 | Usage UI and baseline evaluation protocol | Totals survive refresh; observed attempts have receipts or explicit coverage gaps; teacher labels are defined | Slice 1 for accounting; rubric preparation can start immediately |
| 3 | Evidence and notation grounding | Out-of-scope premises and unsupported solution steps are caught against original material | Slice 2 baseline |
| 4 | Existing-question and batch memory | Same-task rewordings are separated from new learning tasks; thin topics report supply limits | Slice 2 baseline; combine with Slice 3 as arm B |
| 5 | Structured findings and bounded repair | Measurable incremental benefit over B within a fixed call/time budget | B evaluation identifies remaining repairable failures |
| 6 | Regeneration intent and feedback capture | Requested edits happen; unrelated content is preserved; accepted/rejected candidates are labeled | Shared evidence, memory, and finding contracts |
| 7 | Recovery, concurrency, and pilot rollout | Crash/replay/concurrent runs preserve identities and counts; teacher pilot passes release gates | Required before multi-run production rollout |
| 8 | Optional adaptive agent and prompt optimization | Beats the simpler workflow on held-out teacher outcomes and total effort | Only if earlier slices leave a demonstrated bottleneck |

Start with Slices 1 and 2, then evaluate Slices 3 and 4 together. Do not wait for a full agent framework to test the primary business hypotheses. Implement the stable slot/candidate identity foundation from Slice 7 before Slice 4 enables concurrent generation.

Planning estimate for one developer familiar with this code: roughly 3-5 working days for the first two slices, another 5-8 for evidence and memory, and 5-8 for selected repair, recovery, and pilot work. These are sizing estimates, not commitments; toolkit changes, source parsing defects, and teacher review availability can extend them. Adaptive-agent work is outside this estimate.

## Slice 1: Reliable model-call accounting

### 1A. Observe the actual provider boundary

**Modify:** `server/src/components/genai/llm/index.ts`.

**Create:** `server/src/components/genai/llm/model-call.ts`, `server/src/components/genai/llm/provider-usage.ts`, and `tests/unit/provider-usage.test.ts`.

**Extend:** `tests/unit/llm-complete-json.test.ts`.

- [x] Define a provider-independent attempt event contract with `started` and `finished` events sharing a UUID `callId`. A finished event contains safe outcome, requested/actual model, provider response ID when exposed, elapsed time, effective request options, normalized usage, and provider-retry visibility.
- [x] Add an optional `onAttempt` observer to `CompleteJsonOptions`; retain `onUsage` compatibility during migration. Services supply observers and scope; the LLM component must not import business services or MongoDB.
- [x] Invoke the cancellation checkpoint before recording a new provider attempt. Observe each internal `send`, including the existing JSON repair request. Separate transport success from downstream JSON/schema/question rejection.
- [x] Isolate observer failures from model execution and JSON parsing. An observer exception must neither fail an otherwise successful completion nor initiate a correction request.
- [x] Preserve terminal stream usage, including an empty final `choices` array. Capture reported usage before propagating truncation, cancellation, or provider errors when available.
- [x] Make a source-controlled toolkit change and pin a tested release/artifact, following the existing vendored-package pattern if necessary. If an adapter is required, keep it isolated behind the existing component API. Never edit installed `node_modules` as the fix or issue a second completion to measure the first.
- [x] Inspect provider/SDK retries. Prefer exposing each physical attempt; keep unknown visibility explicit during baseline instrumentation. Disabling hidden retries in favor of an explicit bounded policy changes behavior and requires a separately versioned, tested change. Describe unverified counts as observed calls, not guaranteed billable requests.

Proposed normalized contract (validated at runtime):

```ts
interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  totalOrigin: 'provider' | 'derived-from-reported' | 'unknown';
  countSource: 'provider-reported' | 'unavailable';
}
```

Accept only nonnegative safe integers; preserve genuine zero. Normalize provider-specific semantics before deriving totals. Cached/reasoning fields are not blindly added to totals; their inclusion depends on the provider's documented definitions. Do not combine aliases from incompatible provider formats. Keep missing components null even if a reported total exists. No character-count or tokenizer estimate is included in the first release.

Required fixture tests: one nonstream completion; one terminal stream usage frame; two paid sends after invalid JSON; absent usage; reported zero; partially known counts; provider failure after reported usage; cancellation before the next send; and observer failure without an additional send. Record a provider/endpoint/stream-mode support matrix, starting with the actual deployment configuration without exposing credentials. Unverified paths retain unavailable usage or unknown retry visibility; this slice does not require rewriting every supported provider.

### 1B. Persist scoped receipts and aggregate truthfully

**Create:** `server/src/types/model-usage.ts`, `server/src/services/model-usage.service.ts`, and `tests/unit/model-usage.service.test.ts`.

**Modify:** `server/src/components/mongodb/collections.ts`, `server/src/types/domain.ts`, `server/src/services/generation.service.ts`, `server/src/services/content-runs.service.ts`, `server/src/services/step-models.ts`, `server/src/services/generation-blueprints.service.ts`, and `server/src/services/course-deletion.service.ts`.

- [ ] Add `modelCallReceiptsCol()` with UUID `_id`, `courseId`, optional `runId`, `operationId`, `questionId`/version, slot/item identity, role, candidate attempt, JSON attempt, retry reason, provider/model/options, timestamps, outcome, and nullable usage. Index course/run and course/start-time reads. Use `$setOnInsert` for immutable identity and idempotent final updates.
- [ ] Distinguish receipt state (`pending`, `reported`, `unavailable`) from outcome (`succeeded`, `failed`, `cancelled`, `unknown`). A failed attempt may still have reported usage; a successful attempt may have unavailable usage.
- [ ] Freeze `usageTrackingVersion` and effective model/options/policy versions in new generation runs. Older runs remain explicitly untracked. Regeneration currently lacks a contentRun; instrument it using operation/question/version linkage rather than inventing a completed run.
- [x] Wire generator, Validator, Reviewer, JSON repair, numerical retry, and reject retry call sites. Deterministic verification contributes zero model calls, while every discarded model candidate remains in accounting.
- [x] Carry scope explicitly from the persisted run into Agenda execution and nested operations. Concurrent courses/slots must never inherit another operation's IDs. Avoid a process-global mutable current run.
- [x] Record usage independently of run progress CAS, so a late response can finalize a receipt after a run ends. Terminal run state must not be reopened to save usage.
- [ ] Persist an accounting-session manifest alongside the run/operation with `trackingSessionId`, unique `expectedCallIds`, `closedCleanly`, `recordingFailed`, and `sealedAt`. Open tracking with durable run/operation creation; collect call IDs before sends and checkpoint them idempotently. Seal only after all observed attempts are accounted for. Reconcile the manifest against receipt IDs before labeling a usage summary complete. A crash with an unsealed session or unrecoverable dual-write failure leaves a permanent explicit coverage gap, even if the store recovers and the ledger is empty. Synchronous operations need the same durable session marker; absent coverage proof means unavailable usage.
- [ ] Keep accounting completeness independent of generation success. Recording failure cannot change an already-saved successful question into a failed generation. Use bounded dedicated accounting-health updates, separate from ordinary progress CAS; no progress callback or observer exception may trigger another model request.
- [ ] Reconcile abandoned pending receipts with terminal/interrupted runs as unknown usage. Do not claim an unknown provider outcome failed without evidence, and do not automatically repeat an ambiguous paid request just to recover accounting.
- [x] Derive summaries from unique persisted receipt IDs. Return input/output/total subtotals, observed/reported/pending/unknown call counts, legacy/untracked status, and coverage limitations. Define `reportedCalls` as calls with any valid provider-reported count; separately expose `callsWithKnownTotal` and field coverage. A reported call is not necessarily fully accounted for. Distinguish `complete`, `partial`, `pending`, and `unavailable`.
- [x] A genuinely completed, fully tracked zero-call operation may report zero only with explicit coverage evidence. A legacy or incomplete run with no receipts must report unavailable.
- [x] Add the new collection to permanent course deletion. Do not expose actor identifiers or raw receipts to students. Use current course-instructor/admin access for summaries; TA access needs an explicit product/capability decision later.
- [ ] Coordinate receipt creation/finalization and course deletion with a shared course write fence and deletion marker: deletion blocks new authoring starts, drains/fences active writers, then purges; finalization rechecks the marker under the same fence. A delayed result must not recreate a receipt or manifest after deletion, including when its start receipt is missing. Never rely on an unlocked existence check followed by an upsert.

Example acceptance assertions (illustrative test contract):

```ts
expect(summary.observedCalls).toBe(3); // generation, JSON repair, review
expect(summary.reportedCalls).toBe(2);
expect(summary.unknownCalls).toBe(1);
expect(summary.status).toBe('partial');
expect(summary.totalTokens).toBe(1200); // known subtotal, not a complete bill
expect(await summarizeAfterRepeatedReceiptDelivery()).toEqual(summary);
```

Also test concurrent scopes, repeated finalization, recording outage followed by restart, legacy runs, late usage after cancellation, cancel/delete/delayed-response ordering, model-setting changes between enqueue/retry/execution, and preserving known counters when a later event has empty usage. Expected-call counts and receipt writes require idempotent reconciliation; incrementing a counter on every SSE delivery is not acceptable.

**Validation command after implementation:**

```sh
npm test -- --runInBand tests/unit/llm-complete-json.test.ts tests/unit/provider-usage.test.ts tests/unit/model-usage.service.test.ts tests/unit/content-runs.service.test.ts tests/unit/generation.service.test.ts tests/unit/generation-numerics.test.ts tests/unit/course-deletion.service.test.ts
npm run typecheck
```

## Slice 2: Expose usage and establish the evaluation baseline

**Modify:** `server/src/routes/content-runs.routes.ts`, `server/src/services/admin-diagnostics.service.ts`, `client/src/api.ts`, `client/src/views/instructor/generation-workbench.ts`, `client/src/views/admin/diagnostic-ui.ts`, `scripts/prompt-ab/harness.ts`, `scripts/prompt-ab/panel.ts`, and `docs/api-contract.md`.

**Create:** `scripts/prompt-ab/quality-protocol.md`, `scripts/prompt-ab/quality-fixture-schema.ts`, `scripts/prompt-ab/usage-summary.ts`, and `tests/unit/prompt-ab-usage.test.ts`.

**Extend:** `tests/unit/content-runs.routes.test.ts`, `tests/unit/admin-diagnostics.service.test.ts`, and `tests/e2e/generation-workbench.spec.ts`.

- [ ] Add a course-guarded usage read for a run and a batch of displayed run IDs. Reuse existing route ownership; verify every requested run belongs to the course. Return a typed DTO with stable snapshot identity/revision rather than raw provider data.
- [ ] Add a `usage-invalidated` event with a usage-specific revision/snapshot identifier to the existing SSE stream and client handler. Do not reuse an unchanged contentRun revision, which the workbench discards. A bounded authoritative refresh while calls are pending covers late usage after cancellation and cross-worker updates; the current listener map is process-local. Reconnect and page reload always read persistence. Usage finalization does not reopen terminal run status.
- [x] Show input/output/total, stage/model breakdown, reported versus observed calls, and completeness. For partial usage display a recorded subtotal, for missing usage display "Usage unavailable", and for tracked zero show zero. Do not imply an exact monetary bill.
- [x] Add admin usage through an explicit, validated DTO beside redacted diagnostics. Permit only known numeric usage fields; strings, NaN, infinity, secrets, and arbitrary token-named keys remain excluded.
- [ ] Fix harness totals to include failed and rejected attempts. Calculate quality and expenditure with separate denominators. Include usage completeness, settings, retries, cold/warm evidence preparation, and end-to-end latency in each result record.
- [ ] Freeze representative cases: narrow LO, formula-heavy LO, notation-sensitive source, sparse material, repeated batch, explicit material selection, and local edit. Include unsupported premises, same-task rewordings, legitimate independent tasks, and deliberate numerical variants.
- [x] Define teacher labels: source-scope error, notation inconsistency, duplicate learning task, difficulty mismatch, ambiguous answer, edit-intent failure, accepted without edits, and review minutes. Distinguish legitimate false distractors from unsupported correct reasoning.
- [ ] Calibrate automatic judges on teacher-labeled examples. Report their false accepts/rejects by category; do not use the generating model's own pass rate as the primary result.
- [ ] Preserve current effective model/effort settings and Hard rotation in the baseline. Save source versions, question versions, retrieval scope, policy/prompt versions, seeds, and settings for replay. Keep held-out LO/course/family cases separate from prompt tuning examples.

**Validation:** Focused unit tests above, `npm run typecheck`, and the mocked workbench Playwright test following `tests/AGENTS.md`. Confirm refresh, reconnect, cross-course rejection, legacy runs, a failed call, and a zero-call run. No paid calls are required to verify accounting plumbing.

## Slice 3: Course evidence and notation

**Create:** `server/src/types/generation-quality.ts`, `server/src/services/generation-evidence.service.ts`, `tests/unit/generation-evidence.service.test.ts`, and corresponding fixture files under `tests/fixtures/generation-quality/`.

**Modify:** `server/src/services/generation.service.ts`, `server/src/services/materials.service.ts`, `server/src/components/mongodb/collections.ts`, and `server/src/services/course-deletion.service.ts`. Reuse `structure-generation.service.ts` passage traversal and reference validation where appropriate.

- [ ] Define an evidence snapshot keyed by course, allowed material/content versions, LO scope, prerequisite policy, parser version, and extraction/policy version. Where no explicit content revision exists, add a stable hash over the actual ordered source content and parsing metadata; a material ID or mutable timestamp alone is insufficient. First reuse persisted source chunks; introduce extraction only for information missing from the source index.
- [ ] Extract concept/formula/notation/condition entries with passage IDs. Treat them as fallible retrieval aids. A missing or unreadable formula is a parsing gap, not permission to fill it from general model knowledge.
- [ ] Retrieve definitions and relevant neighboring passages in addition to the current top-k query. Respect explicit material selection and course boundaries. Freeze allowed prior-LO knowledge; test the current Hard prerequisite behavior separately rather than silently broadening scope.
- [ ] Give generation an evidence packet and source notation rules. Require mappings from necessary premises and solution steps to evidence; validate both ID eligibility and semantic support against original frozen text.
- [ ] Check the correct answer and correction explanation. False options and false T/F statements may intentionally be untrue; reject unsupported dependencies in the intended reasoning, not the mere existence of a wrong option.
- [ ] Before publication to the review workflow, revalidate that sources remain eligible. Invalidate evidence caches after source changes, Trash, or scope changes. Never retrieve deleted source embeddings as a fallback.
- [ ] Report "Insufficient evidence found within the selected material and search budget" when bounded search fails. Preserve diagnostics; do not assert that no such knowledge exists anywhere in the course.
- [ ] Store findings and verified source links with the candidate; do not claim every retrieved chunk supports every part of the question.

**Completion tests:** A finance fact absent from the selected notes is flagged despite being generally true; omitted neighboring definitions can be recovered; a real but irrelevant passage ID fails support review; notation follows the source; malformed source math produces a gap; deleted or cross-course sources cannot ground a new candidate. Keep numerical checks unchanged.

**Business hypothesis:** Better source selection and explicit dependency checks lower source-scope errors. If failures cluster around extraction, prioritize parser/formula recovery before adding more reviewers.

## Slice 4: Existing-question and batch memory

**Create:** `server/src/services/generation-memory.service.ts`, `tests/unit/generation-memory.service.test.ts`, and versioned pedagogical fingerprints within `generation-quality.ts`.

**Modify:** `server/src/services/generation.service.ts`, `server/src/services/generation-plan.service.ts`, `server/src/components/mongodb/collections.ts`, and `server/src/services/course-deletion.service.ts`.

- [ ] Read same-LO current question versions from both Bank and Queue, including this batch's candidates. Store/derive fingerprints keyed by question version and fingerprint-schema version; preserve family/variant lineage and status.
- [ ] Represent concept, cognitive task, solution path, target misconception, and parameter/context family. Keep full text and source linkage available for disputed matches; an LLM summary is not definitive identity.
- [ ] Provide compact existing-question context before generation. Use normalized exact checks, embedding neighbor retrieval, and a semantic comparison of learning task/solution path. Calibrate thresholds on labeled finance examples; embedding distance alone cannot establish duplication.
- [ ] Include current-batch reservations and recently saved candidates. A reservation begins as a stable slot/task assignment; use a shared course or overlapping-LO commit lock with fencing/CAS for the final check and insert. Do not hold a database transaction open during an LLM call.
- [ ] Recheck fingerprints against current versions at finalization. A version change or stale lock must invalidate the decision. A final read without serialized commit is only best effort and must not be advertised as a concurrency guarantee.
- [ ] Keep requested independent questions separate from intentional numerical/context variants. Do not archive or hide existing approved questions merely because a new similarity check disagrees.
- [ ] For thin material, report independent supply, variant supply, and remaining shortfall. Offer intentional variants as a teacher choice; never silently relabel variants as new coverage to fill a quota.

**Completion tests:** Different numbers/surface wording with the same learning task are variants; similar wording with a different required inference is not automatically rejected; queue items and same-batch items are visible; two concurrent runs cannot finalize against stale empty memory; version changes refresh fingerprints; shortfalls are recorded without being counted as accepted output.

**Business hypothesis:** Giving the generator memory and checking task-level novelty lowers unintended repetition. It cannot make a shallow LO support unlimited independent questions.

## Slice 5: Structured findings and bounded repair

**Create:** `server/src/services/generation-quality-policy.ts` and `tests/unit/generation-quality-policy.test.ts`.

**Modify:** `server/src/services/generation.service.ts`, `server/src/types/generation-quality.ts`, and generation-run policy snapshots.

Proposed action union:

```ts
type QualityAction =
  | { kind: 'retrieve-evidence'; missingDependency: string }
  | { kind: 'repair'; findingIds: string[]; preserveFields: string[] }
  | { kind: 'replan'; duplicateOf: string[] }
  | { kind: 'ready-for-teacher-review' }
  | { kind: 'stop'; reason: 'source-gap' | 'budget' | 'no-new-task' };
```

- [ ] Validate action/finding payloads with closed runtime schemas. References, field names, and tool arguments must resolve within the frozen request scope; free-form model JSON is not executable authority.
- [ ] Add individual question plans only where evaluation shows they help: evidence IDs, cognitive task, solution outline, target misconception, and claimed difference from prior questions. Validate the difference; retain deterministic Hard move assignment.
- [ ] Route missing evidence to bounded retrieval, notation/clarity to local repair, and duplicate learning tasks to replan. Use deterministic routing first. Persist the finding and the observed result of each action.
- [ ] Apply one shared slot budget across nested JSON, numerical, reject, and new quality retries. Start the isolated experiment with at most two quality interventions, at most twelve observed LLM attempts, and a ten-minute wall-time limit per slot; freeze these values in the recipe and tune from baseline data. Stop before another call if exhausted. These are proposed experimental limits, not a measured optimum or currency cap.
- [ ] Keep requested versus assessed difficulty separate. Use conceptual operations and solution dependencies for difficulty; word count is a soft diagnostic. Extra wording requires a clarity/context reason; do not truncate meaning to meet a hard limit.
- [ ] Keep unresolved source/numerical failures out of recommended-ready counts. Diagnostic Drafts may remain available to instructors with explicit findings; adoption still follows existing approval and numerical serving rules.
- [ ] Recheck the original issue after repair and run affected numerical/source/novelty checks. Stop if the same failure recurs without new evidence. Record repaired, unresolved, and exhausted outcomes separately.

**Completion tests:** Correct action per finding; shared nested budget prevents multiplicative retries; unchanged repairs are detected; repair cannot bypass numerical checks; invalid action IDs cannot widen scope; ambiguity yields an explicit stop; flags that are intentionally left for humans are not reported as automatic acceptance.

## Slice 6: Regeneration intent and teacher feedback

**Create:** `server/src/services/regeneration-intent.service.ts` and `tests/unit/regeneration-intent.service.test.ts`.

**Modify:** the regeneration path in `server/src/services/generation.service.ts`, `server/src/routes/generation.routes.ts`, `client/src/api.ts`, the existing side-by-side panel in `client/src/views/instructor/question-detail.ts`, and `docs/api-contract.md`. Reuse this editor rather than introducing a second one.

- [ ] Make `edit-existing` versus `create-variant` explicit in the request, with a backward-compatible default matching the initiating UI. The teacher's requested change is authoritative; an inferred intent remains visible and correctable.
- [ ] Local edits pass old content, requested changes, and preservation constraints to both generation and review. Remove conflicting blanket "different question" wording for local edits.
- [ ] Compare requested fields and semantic change against the old version; detect a byte-identical/no-op response and unintended changes to answers, notation, or numerical definitions. Rerun affected proofs.
- [ ] New variants retrieve bank/queue neighbors and explicitly record whether the result is a variant or an independent task.
- [ ] Persist old/candidate version, request, observed changes, verification findings, and teacher adoption/discard/edit outcome under existing course protections. Keep this content separate from the metadata-only token ledger.
- [ ] Build reusable regression cases from teacher corrections, stripping personal/student information. Label evidence-based improvements, not merely whichever response the model preferred.

**Completion tests:** "Change the notation only" preserves learning task and answer; "replace the scenario" changes the requested scenario; no-op regeneration is surfaced; an adopted candidate preserves lineage; a discarded candidate's model usage remains counted.

## Slice 7: Recovery, concurrency, and production pilot

**Create:** `server/src/services/generation-candidates.service.ts` and `tests/unit/generation-candidates.service.test.ts`.

**Modify:** `content-runs.service.ts`, `generation.service.ts`, `generation-blueprints.service.ts`, Mongo accessors/indexes, course deletion, run DTOs, and workbench diagnostics. Keep recovery subordinate to the existing Agenda/contentRun lifecycle.

- [ ] Assign stable run/slot/question identities before generation. Persist candidate attempts separately, with versioned evidence, plans, findings, and usage linkage. Use unique identities and CAS to distinguish replay from a genuinely new attempt.
- [ ] Save a validated response/checkpoint before downstream work where practical. On recovery, reuse a recorded response and reconcile any already-inserted question instead of generating or inserting it again.
- [ ] Test interruption after provider response, after candidate save, after question save but before run completion, and after cancellation. There remains an unavoidable ambiguity window if the process dies before a response is persisted; surface it explicitly rather than promise exactly-once external billing.
- [ ] Complete the fenced final-check/commit mechanism before enabling concurrent batches. Semantic duplicate detection remains fallible even with correct locking; retain aggregate audits and teacher review.
- [ ] Add opt-in policy versions `baseline`, `grounded-memory`, and `bounded-repair` to frozen recipes. Existing runs keep their original policy. Rollback changes new runs to baseline; it does not rewrite history or discard teacher edits.
- [ ] Run the existing numerical regression panel plus targeted source/memory/edit cases in isolation. Then run a small teacher pilot with blinded candidates and measured review time, using existing enrollment and authorization boundaries.
- [ ] Update `docs/api-contract.md`, tests, and `AGENTS.md` current-state notes only when the corresponding feature is implemented and verified.

## Experiments and release decisions

Use the same source snapshots, starting bank, requested slots, model settings, and repair-budget accounting for every arm. Isolate arms so generated questions from one arm cannot contaminate another's memory. Repeat stochastic runs and randomize teacher review order.

| Arm | Change from current behavior | What it tests |
| --- | --- | --- |
| A | Current pipeline, with truthful instrumentation | Baseline quality, supply, time, and consumption |
| B | Evidence/notation plus bank and batch memory | Whether the missing information explains the main complaints |
| C1 | B plus justified individual plans and deterministic bounded repair | Whether structured action and repair add benefit |
| C2, optional | C1 toolset/context/budget with model-selected actions | Whether adaptive routing beats the simpler policy |

Initial scoped comparison: six representative LOs, six requested slots per LO, two repetitions, three arms = 216 requested slots. First run deterministic fixtures, then a small smoke sample before the full paid comparison. This initial sample can identify large issues; rare errors require more data, and all estimates should show sample size and uncertainty.

Report both all-candidate error incidence and recommended-output error incidence. Report accepted independent questions per requested slot, intentional variants, shortfalls, discarded attempts, teacher time including failure triage, latency, total recorded tokens, unknown usage coverage, and recorded tokens per teacher-accepted independent question. Zero accepted independent questions has no finite per-accepted-question ratio; display unavailable and the absolute consumption.

Separate one-time evidence/fingerprint creation from warm reuse. Include those preparation calls in end-to-end consumption. If embedding usage remains untracked, state that exclusion in every cost comparison; do not describe LLM subtotals as complete system expenditure.

Proposed release targets, to be frozen with the teacher before the paid comparison:

- At least a 50% relative reduction in source-scope errors and unintended duplicate learning tasks versus A, when baseline counts support a meaningful comparison.
- At least a 25% reduction in total teacher review time per accepted independent question, including rejected/shortfall triage.
- No regression in deterministic numerical validity or existing permission/approval behavior.
- A predeclared minimum accepted independent supply and maximum shortfall rate for each LO; a quality improvement cannot be claimed by returning almost nothing.
- A predeclared ceiling for recorded usage per accepted item and latency, with sufficient reporting coverage. Missing usage makes a cost verdict inconclusive, not cheap.

The percentages are hypotheses and product targets, not predictions. When the baseline has very few failures, expand the sample or report the evidence as inconclusive. If B wins and C1 does not justify its extra usage/time, ship B. Test C2 only when a concrete routing failure remains; reject it if it does not improve held-out teacher outcomes.

## Later optimization and learning order

1. **CREATE receipts:** Understand observation boundaries, null/zero semantics, replay, and partial totals. Implementing this slice teaches production observability without changing generated content.
2. **FinanceBot evidence and memory:** Follow one teacher complaint from source parsing to retrieval, generation, verification, and acceptance. Improve the failing stage rather than adding a generic reviewer.
3. **Promptfoo patterns:** Reuse versioned fixtures, provider comparisons, and explicit assertions from the cloned `research-promptfoo`; keep the existing FinanceBot harness as the execution authority initially.
4. **DSPy patterns:** Study metric-driven prompt/example optimization in `research-dspy` only after stable labels and held-out cases exist. This optimizes API prompts/programs without necessarily fine-tuning model weights. Keep cold-start and optimization call costs in the comparison.
5. **LangGraph patterns:** Study state/checkpoint/control-flow examples in `research-langgraph` when durable branching warrants them. A framework migration needs its own runtime/dependency compatibility assessment; it is not a quality fix by itself.

Model-weight fine-tuning is not the first intervention: it cannot supply omitted course evidence or know a changing question bank. Consider it later only with a sufficiently large, reviewed dataset and a demonstrated residual failure that prompt/context/workflow changes do not resolve economically.

Optional later capabilities include versioned provider price tables, separately metered embeddings, course/date usage reports, and budget reservations. Token totals alone cannot implement an accurate currency cap; pricing must distinguish provider/model/cache categories and expose unknown or unpriced calls.

Keep the remaining teacher workflow complaints in a separate small-fix backlog: stable queue ordering after refresh, return-to-queue navigation from the editor, formula rendering without a browser refresh, and selecting newly uploaded material/LOs without reselecting approved work. These affect review time and should be measured independently of model-quality experiments.

For decimal numerical variants, audit and reuse the existing numeric `step`/`values` support in `server/src/services/params.service.ts` and `domain.ts`; the current code already represents fractional steps. Verify generation choices, decimal display precision, floating-point boundaries, and option collisions before describing this as a missing parameter engine. Decimal variants can improve practice variety but do not count as new independent learning tasks.

## First implementation handoff

The first code change should cover Slice 1A and its local fixtures, followed by 1B and Slice 2. It must demonstrate a streamed generator call, a JSON repair, a failed/discarded call, and an unavailable-usage call without using paid credentials. Then prepare teacher-labeled evaluation cases before modifying generation behavior.

For each slice, run its focused tests, then typecheck and the repository's required checks for the affected surface. Commit only the intended files on an isolated branch and describe verified behavior plus remaining coverage limits. Paid generation, deployment, and rollout are separate execution steps; this document records the plan rather than claiming those steps have occurred.
