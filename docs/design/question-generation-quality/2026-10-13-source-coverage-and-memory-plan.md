# Question Generation Quality Source Coverage and Memory Plan

**Date:** October 13, 2026  
**Owner:** Stephen  
**Status:** Engineering implementation and public-PDF tests are recorded in [the delivery](IMPLEMENTATION-2026-10-13.md) and [local acceptance](ACCEPTANCE-2026-10-14.md). The original estimates and proposed business gates below remain planning context; professor calibration and default rollout are not complete.  
**Scope:** Public question generation, instructor regeneration, and the material preparation they share. Exam bank sampling and immutable published papers remain unchanged.

Improve three business outcomes first: questions stay within the selected teaching material, independent questions exercise distinct learning tasks, and every selected chapter is accounted for. Regeneration must receive the same current Bank/Queue context as generation. Reduce repeated preparation and bounded-context input before increasing orchestration complexity.

## Current foundation and gaps

Reuse the existing TypeScript services, Mongo, Qdrant, Agenda, contentRuns, course SSE, numerical verifier, source inspector, Review Queue and model usage ledger. Preserve instructor approval, course authorization and historical versions.

- Full-source structure generation already traverses selected persisted chunks and records evidence. Its model extraction loop is sequential and is repeated on subsequent runs.
- Material status can become ready before its ingest chunk-count result is available. Materials quick-build currently selects ready sources and can omit processing chapters without an explicit batch receipt.
- Fast file classification reads only the first 2,000 characters; it cannot establish a long chapter's complete scope.
- The opt-in `grounded-memory-v1` pipeline validates original evidence and adds bounded Bank/Queue memory. Baseline remains the default. Its current lexical selection and overlapping-LO scope can miss cross-LO paraphrases.
- `regenerateQuestion()` sees its original question and retrieved passages, but does not use this shared memory or independently verify each requested edit. Its unconditional distinct-alternative instruction conflicts with local editing.
- Requested difficulty currently takes precedence at tracked persistence, even when the generated answer or Reviewer suggests a lower level.
- Existing usage receipts support nullable provider counts. Embedding/parsing expenditure and SDK-hidden physical retries are not a complete part of this ledger.

Source pointers: [materials](../../../server/src/services/materials.service.ts), [structure](../../../server/src/services/structure-generation.service.ts), [generation](../../../server/src/services/generation.service.ts), [evidence](../../../server/src/services/generation-evidence.service.ts), [memory](../../../server/src/services/generation-memory.service.ts), and [current implementation status](IMPLEMENTATION-STATUS.md).

## Delivery order

| Stage | Deliverable | Main acceptance condition | Indicative effort |
| --- | --- | --- | --- |
| 1 | Batch coverage and reliable source readiness | All requested files are named; no silent omission or paid analysis before readiness | 2–4 working days |
| 2 | Shared source context and regeneration memory | Generation and regeneration use the same scoped evidence and current memory; local edits preserve unrelated content | 3–5 days |
| 3 | Reusable chapter evidence and focused retrieval | Unchanged chapters reuse validated extraction; new/changed chapters are processed incrementally | 4–6 days |
| 4 | Independent task planning and checked commitments | Same-task rewordings are identified; shallow topics report shortfalls; concurrent commits are coordinated | 5–8 days |
| 5 | Bounded parallel work and measured rollout | Cold/warm speed, yield, teacher effort and tokens meet agreed gates on real materials | 3–5 days plus instructor review |

These are initial one-developer sizing estimates, roughly 3–6 engineering weeks depending on overlap, parsing defects and coordination requirements. Instructor labeling and release evaluation have their own availability. Establish the baseline and teacher inventory during Stage 1 rather than waiting until Stage 5.

Each stage should be a small, reviewable change with its own tests and feature flag. Implement Stages 1 and 2 first; neither requires a new agent framework or a new evaluation interface.

## Stage 1 Account for every selected chapter

### Changes

Add a metadata-only `materialUploadBatches` receipt with course, actor, idempotent request ID and one item per requested file. Items name the original file, associated material and created/reused/rejected disposition. Derive current progress from Materials and contentRuns instead of maintaining a second independent status machine.

Create the intended-file manifest before multipart processing through a guarded preparation endpoint; otherwise Multer size/count failures or a disconnected upload can occur before the service knows all requested filenames. Link admission outcomes and uploaded items back to this manifest. Preserve the legacy whole-batch unsupported-format rejection; version any later partial-acceptance behavior. A failed upload is not an analyzed or processed source.

Separate usable source readiness from advisory classification. Persist the validated ingest/chunk manifest before exposing a source as ready to structure generation or evidence construction. Use ordered, replayable finalization; a crash between writes must recover rather than advertise incomplete indexing. Classification-pending should be visible and should not prevent an otherwise valid source from being used after its manifest is complete.

A validated source snapshot remains usable if advisory classification is interrupted by a restart. A retry that will replace chunks must invalidate or stage the active manifest before mutation and publish the replacement only after validation. Readiness must not depend solely on the final mixed ingestion/classification job status.

Preserve the legacy upload response; add a versioned upload receipt and batch-read endpoint. Structure requests can specify `sourceBatchId` and explicit selected material IDs. The server resolves course ownership and snapshots the intended source set before paying for analysis.

"Analyze this batch" includes every unique active source in that batch. If any is unavailable, return a named readiness report before model calls. The existing UI offers waiting/retry or an explicit subset with named exclusions. It must never silently convert ten intended chapters into seven ready chapters.

Extend the existing coverage receipt with requested, included and excluded source snapshots; per-source parsed/indexed/analyzed sections; extraction damage; mapped and unmapped learning points. Processing counts describe text traversal. Teacher-confirmed coverage of concepts, formulas and diagrams remains a separate field.

### Acceptance

- Ten chapters with Chapter 7 still indexing: all ten appear; analysis is blocked with zero model calls and a Chapter 7 reason.
- One failed chapter does not discard nine successfully indexed siblings. Retry addresses the failed source only.
- An explicit nine-source selection reports 9/10 included and names the excluded chapter.
- A multipart admission failure still names all ten intended files and marks none as processed.
- Reload and SSE reconnect restore the same batch receipt and source selection.
- Complete indexed source with classification pending can be used without the current chunk-count race.
- Foreign-course receipts, files and hashes are inaccessible. Trash and permanent deletion invalidate eligibility and purge new course-scoped records.

**Likely files:** `materials.service.ts`, `materials.routes.ts`, `content-runs.service.ts`, `structure-generation.service.ts`, material/structure types, collection accessors/indexes, `client/src/api.ts`, `materials.ts`, `structure-ai-workbench.ts`, and the API contract.

## Stage 2 Share evidence and memory with regeneration

Create a `generation-context.service.ts` boundary using the existing source packet and memory services. Freeze a versioned authoring context before external calls:

```ts
interface AuthoringContext {
  contextId: string;
  policyVersion: string;
  courseId: string;
  primaryLoId: string;
  secondaryLoIds: string[];
  selectedSourceSnapshots: SourceSnapshot[];
  evidencePacket: GenerationEvidencePacket;
  questionMemory: GenerationMemorySnapshot;
  coverage: { includedIds: string[]; excluded: SourceExclusion[]; limits: string[] };
  originalQuestion?: { questionId: string; versionId: string };
  changeRequest?: {
    intent: 'edit-existing' | 'create-variant' | 'create-independent-task';
    instruction: string;
    requiredChanges: string[];
    preservedFields: string[];
  };
}
```

The server resolves source scope from authorized instructor selection and existing assignments. Retrieval or a model-selected action cannot automatically add a chapter or prerequisite outside that scope. Missing needed evidence creates a gap, not a fallback to general finance knowledge.

Public generation and regeneration share this boundary. Regeneration includes current Bank/Queue versions and same-run candidates, with selected-memory omissions disclosed. The original question stays available for change/invariant comparison; exclude only its own head from duplicate comparison so a legitimate local edit is not rejected as a copy of itself. Similar questions in other heads still participate.

Make regeneration intent explicit in the existing editor:

- **Edit existing:** change requested content and preserve unrelated fields, answer semantics and task. A notation edit may rename symbols consistently across formulas rather than preserving literal formula strings.
- **Create variant:** preserving the learning task is intentional. Mark the family/variant relationship; do not count it as independent supply.
- **Create independent task:** require a different inference or solution path from retrieved Bank/Queue neighbors.

Replace the unconditional distinct-alternative instruction. Default legacy requests to the existing variant-like behavior; new UI requests send an explicit intent. Simple UI selections and deterministic checks define intent without an extra planning call. Ambiguous free-text instructions can request clarification in the editor rather than guessing silently.

Eligibility must follow intent rather than reuse v1's independent-only rule. Local edits require supported reasoning, consistent notation, fulfilled changes and preserved invariants without requiring a new learning task. Variants may retain that task and family. Independent-task requests require independence within the disclosed memory scope. Other heads remain in comparisons and diagnostics; unsupported reasoning, failed requested edits and invariant violations withhold candidates in every mode.

Persist original version, context identity, intent, candidate, findings and usage correlation in a guarded durable authoring record. Candidate adoption remains explicit. Recheck original version, source validity and current Bank context on adoption; server checks cannot be replaced by client-supplied verdicts.

### Acceptance

- "Change notation only" changes the notation consistently and preserves the correct answer, underlying formula and parameter distribution.
- "Create a different question from the bank" receives real memory and cannot satisfy the request with a cosmetic rewrite.
- Deliberate numerical variants remain usable and labelled as variants.
- No-op output and unsatisfied changes are reported. Unsupported reasoning already present in an old question is not grandfathered as valid.
- Failed or rejected candidates retain token receipts; an approved question is never overwritten automatically.
- An edited original or changed/deleted source invalidates stale adoption.

Introduce `grounded-memory-v2` behind an explicit run/course pilot policy; keep historical policies readable and preserve retry snapshots. Enforce this policy on both generation and regeneration APIs; no silent Baseline fallback when required evidence or the Reviewer is unavailable.

## Stage 3 Prepare chapter knowledge once and retrieve originals

### Exact upload reuse

For new manual uploads, hash server-owned file bytes and reuse exact duplicates only within the same course and eligible manual-upload provenance. Use a partial unique active fingerprint to resolve concurrent duplicate uploads. Preserve canonical names, kind, assignments and instructor corrections; a renamed upload records an alias and an explicit reused receipt.

Processing duplicates link to the existing run. Failed duplicates expose Retry. Trashed sources are never silently restored. Changed bytes create a new snapshot. Historical un-hashed records remain readable; do not automatically merge old source/question lineage. Canvas retains its existing key-based import idempotency initially.

### Versioned extraction cache

Add validated per-source/per-section `sourceEvidenceExtractions` containing concepts, formula/notation definitions, units/conditions, learning points and original passage references. Catalog summaries are retrieval aids; only current original passages support a question.

Key reuse by course, actual ordered source-text hash, parser/chunker versions, extraction prompt/schema, effective provider/model/options, source title when used in prompts, and exact normalized guidance. Material revision alone is insufficient because assignment/classification changes also advance it. Do not share teaching content caches across courses.

Cache validated complete extraction units immediately, retaining explicit skip reasons. Recheck active source/hash/reference eligibility on reuse. Store source-local stable passage IDs and remap them into run-specific IDs when combining chapters. Invalid, failed or incomplete output is not a successful cache hit.

First make cacheable extraction batches source-local: the current batching can mix sections from different files, making one chapter's output depend on its neighbor. Partition by source snapshot and local section IDs before caching; cross-file reasoning and overlap merging stay in synthesis.

Keep final outline synthesis separate initially. Adding Chapter 11 reuses Chapters 1–10 extraction, extracts Chapter 11, then synthesizes the full combined ledger against the current outline. Replacing Chapter 4 invalidates Chapter 4 extraction, not every chapter.

Replacement is an explicit action or source-selection operation recording old and new snapshots and excluding the old snapshot from the new intended source set. Changed bytes with the same filename must not silently infer replacement. Preserve historical question evidence; ordinary additional uploads keep both materials until the instructor selects otherwise.

### Focused question retrieval

Retrieve by the planned task's concept, formula, notation and assumptions, using lexical and semantic neighbors plus original adjacent definitions. Diversify within the legitimate source set so one similar chapter cannot crowd out another required source. Coverage belongs to the whole requested batch; do not send all ten chapters into every question prompt or force every file into an unrelated LO.

Support one bounded evidence expansion for a named missing premise inside the allowed sources. If evidence is still missing or unreadable, report the specific gap. Damaged formulas/diagrams remain parsing issues for source inspection; a catalog summary cannot repair them by invention.

### Acceptance

- Same ready file reupload performs no new parse/embed/extraction call; another course neither reuses nor reveals the first course's match.
- Adding Chapter 11 processes only its extraction while all eleven sources participate in synthesis.
- Source, parser, prompt, model/options or guidance changes invalidate the correct cache entries.
- Later-chapter definitions and repeated vocabulary fixtures retrieve the intended evidence.
- Changed, deleted, stale-vector or forged cache references cannot ground a new question.
- The professor sees newly introduced versus reused learning points and can select new-source coverage without manually scanning every existing LO.

## Stage 4 Plan distinct tasks before generating questions

Create stable run/slot identities before paid work and persist a bounded batch plan. Each planned slot records concepts, required inference, solution path, misconception, achieved/target difficulty, allowed source references, intent and memory digest.

Build versioned pedagogical fingerprints from immutable question versions. Index concepts, inference, formula dependencies, misconception and variant family; combine them with existing exact hashes and semantic nearest neighbors. Include current authorized Bank/Queue versions, relevant cross-LO neighbors and active task reservations. Fingerprints nominate comparisons; similarity scores alone never prove pedagogical duplication.

For new candidates, request the compact task descriptor in the existing generation response and validate it during review rather than paying for a separate summary call. For historical questions, prioritize bounded nearest-neighbor backfill and optional budgeted course preparation. Missing fingerprints remain a disclosed gap with original-question fallback; a foreground generation request must not trigger unbounded whole-bank model summarization. Cache and invalidate by immutable version plus fingerprint policy/model configuration, and record preparation/embedding work separately from candidate cost.

One bounded planning call per batch proposes supported independent tasks. The server validates source/memory IDs and scope. If an LO supports three remaining independent tasks and six were requested, create at most the supported supply and show the shortfall. Offer optional variants explicitly; count independent questions and variants separately.

Preserve deterministic numerical/shape checks first. A structured assessment then evaluates premise and correct-solution support, source notation/conditions, task novelty, edit fulfillment/invariants, actual difficulty and justified length. False distractors and false T/F statements remain valid if their intended corrections are supported.

Valid passage IDs and exact quotes establish source location. They do not establish that a premise or solution follows from the text; that semantic assessment uses the originals and is calibrated against teacher judgments. Its novelty requirement follows the Stage 2 intent-specific eligibility rules.

Route failures through a single slot budget:

- Missing in-scope evidence: one bounded retrieval expansion.
- Local notation/clarity failure: one targeted repair and affected checks.
- Duplicate independent task: one different supported task plan, not another paraphrase.
- Unsupported scope/difficulty or repeated uncertainty: withhold and report a reason.

Do not stack independent reject retries, JSON repairs and new repair loops. Fix difficulty persistence for new candidates: retain requested difficulty as request metadata, store the checked achieved difficulty, and expose a mismatch. Never silently rewrite historical approved labels.

The shared slot budget separately tracks generator attempts, retrieval expansion, repair cycles and total observed sends. Existing structural attempts inside `generateValidQuestion()`, Reviewer reject retries and `completeJson` corrections must consult it. Exhaustion produces a named shortfall and never starts a fresh nested retry loop.

### Concurrency and recovery gate

Final adoption and generation commits must account for recently accepted tasks and source changes. Every relevant generation, adoption, edit and archive writer must participate in the coordination protocol. A lease read followed by ordinary multi-document writes is not an atomic commit fence.

Audit production Mongo transaction capability before selecting the final protocol. With transactions, perform the short fenced context/revision/reservation and persistence commit after model calls, never during a model call. Without transaction support, use a reviewed durable single-writer commit queue with an atomic authoritative acceptance record and idempotent projections; unfinished projections must not count as completed Drafts. Validate stale-owner fencing and crash replay before enabling concurrent v2 commits. If neither protocol is ready, limit the pilot to diagnostic candidates/explicit coordinated adoption and disclose the concurrency limitation.

Persist run/slot/candidate-attempt identities, validated responses and correlated model-call IDs. Replay completed steps instead of spending again. A crash after provider dispatch but before durable response capture remains uncertain; do not claim exactly-once billing.

### Acceptance

- Changed numbers, renamed scenarios and paraphrases are distinguished from independent learning tasks.
- Similar wording with a different supported inference can pass.
- Thin LOs produce honest shortfalls and labelled variants, not forced out-of-scope Hard questions.
- Two concurrent same-LO requests cannot both commit against an old empty Bank without rechecking the accepted predecessor.
- Expired owners cannot commit; replay creates no duplicate heads/versions/success counts.
- Source replacement/course deletion prevents stale commits and record recreation.

## Stage 5 Bound work and verify speed and cost

Start with two independent extraction sends per run and a configured provider-wide send limit, initially four per process. Allocate fairness across courses/users and document that multi-process provider limits require shared coordination. Merge asynchronous extraction results in original source order. Synthesis waits for all selected extraction units; budget exhaustion preserves completed cache units and names unprocessed sections.

Wire admission, cancellation and budgets into the existing `completeJson.beforeRequest` boundary so JSON correction and smaller-section retries count too. A high-level batch count cannot measure paid sends. Existing in-flight work may finish after Stop; no new send may start afterward.

The current hook has no prompt/options arguments. Extend the actual send boundary to supply effective prompt/system text, model/options, output cap and JSON-attempt identity, so a repair's larger input is admitted too. Acquire permits/reservations there and release them in `finally`. Add typed platform/environment settings and corresponding example configuration for new limits; no scattered environment reads.

### Provisional limits for calibration

These starting values are tunable design limits, not achieved performance or provider bill guarantees:

| Work | Initial bound |
| --- | --- |
| Batch planning | One logical planning call per batch, with budgeted format repair if needed |
| Candidate evidence | Target 4,000–6,000 input tokens of selected original passages |
| Candidate memory | Target 1,000–2,000 tokens of task descriptors; full nearest neighbors when necessary |
| Whole candidate prompt | Target at most 12,000 input tokens; initial ceiling 24,000 including instructions/original question |
| Generator output | Initial cap 3,000 tokens; schema/formula needs must be checked in calibration |
| Semantic check output | Initial cap 1,500 tokens |
| Slot generation attempts | At most two; one repair/replan cycle |
| Instrumented sends per slot | Initial maximum eight, including format repairs and affected rechecks; preparation/planning reported separately |
| Evidence expansion | At most one inside the authorized source set |
| Parallel question work | Initially two independently prepared slots; final commits use the reviewed coordinator |

Use provider-compatible tokenization or a labelled conservative estimator for admission. Never silently drop a necessary premise to fit a budget. Reserve estimated remaining work before sends and reconcile provider receipts afterward. Missing usage stays nullable and limits remain conservative; configured SDK-hidden physical retries prevent claiming an exact request or dollar cap.

Initially keep the existing Validator, Reviewer and source/novelty gate while replacing repeated broad context with selected original evidence. After calibration, compare consolidating Reviewer and the source/novelty assessment into one structured check: normal work can target generator + Validator + combined Reviewer. Ship that consolidation only if source error, duplication, yield and false-rejection gates hold. Deterministic numerical verification is never removed to save a call.

Admin diagnostics should show selected source snapshots, cache hits/misses, queued/execution durations, stage/model subtotals, repair/shortfall reasons and usage completeness. The professor sees a compact receipt and source links in the current product. Retain guarded authoring evidence separately from the metadata-only token ledger.

## Evaluation and rollout

Use two prospective tracks and the existing evaluation schema/metrics. Professors review actual questions in Review Queue and originals in the source inspector. Use simple version-bound annotations/CSV exports and manual active minutes; do not require a new standalone evaluation HTML application.

1. **Ten-chapter coverage track:** freeze authorized originals and teacher-important concepts, formulas, notation and diagram regions. Measure all requested files accounted for, parsing damage, checked-inventory recall, unsupported added concepts and readiness/outline latency. Traversing every chunk is not proof of complete instructional coverage.
2. **Generation/regeneration track:** freeze selected sources/prerequisites, LO versions, starting Bank/Queue, prompt/policy versions, effective models/options and retry budgets. Isolate comparison arms so one arm's generated questions never enter another arm's memory. Randomize execution/review order, use repetitions, and hold out whole chapter/LO/family groups from tuning.

Primary outcomes are teacher-active review minutes per accepted independent question and accepted independent questions per requested independent slot. Include source checking, editing, rejection and shortfall triage; define break exclusion beforehand. With zero accepted questions, the per-question ratio is unavailable and absolute effort remains reported.

Report scope errors, notation differences, duplicated learning tasks, actual difficulty, edit fulfillment/unintended changes, useful variants, missing/withheld/failed outputs and checker false acceptance/rejection. Inspect a sample of withheld candidates as well as automatic passes. All planned slots remain in denominators.

Report cold preparation, warm reuse, Chapter 11 addition and Chapter 4 replacement separately. Show queue wait, execution, p50/p95 latency, cache hits and all observed tokens for preparation, planning, generation, verification and failed/repair work. Preparation amortization must be stated. Provider coverage gaps, embedding/parsing costs and hidden retries remain explicit exclusions.

Agree release thresholds with instructors before evaluating. Suggested discussion targets are at least 30% relative reduction in scope/duplicate errors and 20% reduction in active review time, with no reduction in accepted independent supply and a pre-agreed latency/token ceiling. These are proposed business targets, not promised results; report sample sizes and uncertainty. If baseline error counts are near zero, use absolute counts/ceilings rather than an unstable relative percentage.

Keep v2 opt-in until the coverage, teacher-calibration, supply, cost and commit/replay gates pass. Broaden course rollout gradually with pinned policy versions, explicit fallback choice and clear diagnostics. Do not label a pending/reviewer-disabled check as a pass.

## First implementation slice

- [x] Add batch receipt and authoritative source-readiness contract.
- [x] Reproduce and fix the ready-before-chunk-result race.
- [x] Make Materials quick-build name every requested/excluded source and require explicit subset selection.
- [x] Add ten-file wait/failure/reload/subset/cross-course acceptance tests.
- [x] Freeze the public-PDF benchmark inventory and baseline controls; professor calibration remains separate.
- [x] Implement shared context/regeneration intent and memory integration.

All authored code comments, UI copy, contracts and plans remain English. Update the API contract and nearest guides in each implementation change, add deletion/index coverage for new collections, and use the existing UI style. This plan alone does not change runtime defaults, call providers, commit or deploy code.
The subsequently authorized implementation is recorded in
[the October 13 delivery](IMPLEMENTATION-2026-10-13.md). Public-PDF testing is
an engineering benchmark, not a substitute for professor acceptance.
