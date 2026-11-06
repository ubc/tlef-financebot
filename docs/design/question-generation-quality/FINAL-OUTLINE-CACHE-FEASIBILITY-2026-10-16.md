# Exact final-outline cache: feasibility and integration boundary

Status: design only. No cache implementation, database migration, or additional model calls are included in this review.

## Observation and existing infrastructure

The October 16 two-chapter experiment completed in 226.064 seconds using 12 observed model sends, 65,582 input tokens and 40,635 output tokens. Its identical cache-only replay reached final synthesis in 338 ms, with five extraction-cache hits, 71 reused sections, zero newly extracted sections and zero model sends. The replay stopped when the injected completion guard detected the uncached final synthesis. **338 ms is time to that cache miss, not a completed warm-outline latency.** Eight other chapters were explicitly excluded from both runs.

There is currently no `sourceEvidenceSyntheses` collection, accessor or schema. Existing reusable infrastructure is:

- `source-evidence-cache.service.ts`: course-scoped `sourceEvidenceExtractions`, exact prompt/model/source identities, quote revalidation and guarded writes.
- `structure-generation.service.ts`: validated `structureSynthesisPacks` retained inside content runs for oversized inventories. They replay organization aids against current originals; they do not cache the final outline.
- `authoring-commit.service.ts`: short course-fenced writes and deletion protection, with explicit standalone Mongo limitations.

Both direct synthesis and the final merge of large packs currently call the model. A dedicated final cache is feasible at this boundary, after validated extraction and before the final call. It should reuse a previously validated draft, never turn cached summaries into source evidence.

## Identity and stored artifact

Introduce a versioned, course-scoped `sourceEvidenceSyntheses` cache using the existing extraction-cache conventions. A hit requires all of the following to match:

| Binding | Required identity |
| --- | --- |
| Original sources and selection | Current corpus fingerprint, material identities and original hashes, parser/chunker identities, intended upload batch, included sources, explicit exclusions and replacements. No filename-based or cross-course matching. |
| Prepared evidence | Exact validated extraction content and disposition hashes, extraction prompt/schema/model identities, stable learning-point identities, original grouped quotes and passage coordinates. Changing an extraction invalidates final reuse even if source bytes are unchanged. |
| Existing course outline | Current active Topic/LO identities, names, relationships and archive state. The synthesis prompt explicitly reuses existing names; source equality alone is insufficient. |
| Request and policy | Exact effective options, guidance, count constraints, synthesis/validation/inventory versions, source selection semantics and relevant quality policy. |
| Model execution | Provider and endpoint identity without credentials, exact requested model, effective reasoning effort, shaped request parameters and actual output cap. A 10,000-token experiment and the production 24,000-token final cap must not share an entry. |
| Synthesis path | Exact initial final-prompt bytes and ledger serialization version. For a large outline, include the actual validated pack drafts, unresolved-point inventory and pack identities supplied to final organization. |

Use a versioned canonical serializer for identity hashes. Preserve array order where it affects the prompt; do not silently equate reordered input. Record native model identity and the originating call/run separately as provenance. A model provider updating a model behind the same name does not make a cached artifact newly generated.

Store immutable candidate versions containing the validated theme/LO draft, stable evidence references, candidate-content hash, validator version and originating receipt IDs. A unique course/key pointer can select a valid candidate version without overwriting its provenance. Keep record size bounded. Do not cache failed, partial, cancelled or unvalidated candidates as successes.

## Safe replay and currentness

Run-local `E1`, `E2` and similar identifiers cannot be replayed blindly. Store stable learning-point identities based on exact source coordinates, objective text and grouped original quotes; retain an occurrence discriminator for identical repeated points. Resolve every reference to current evidence and translate it into the new run's IDs. Missing or ambiguous mappings are cache misses. Derive material references from the resolved current evidence, not stale cache metadata.

On every read:

1. Enforce course authorization, active run and current source readiness. Reject tombstoned or ineligible courses and unavailable sources.
2. Verify cache schema, complete identity and candidate hash; resolve and revalidate exact original quotes.
3. Run the current outline validator with current options/evidence, including unknown-ID rejection and representation of every selected instructional source.
4. Recompute inventory, mapped/unmapped evidence, numerical/visual dispositions, redundancy signals, exclusions and warnings from current originals and the replayed draft. Retain all gaps. A valid cache entry does not establish pedagogical completeness or correctness.
5. Recheck source and existing-outline fingerprints before returning or admitting the cache entry. Use the short course write fence for admission; never perform a model call inside a transaction. If state changed, fail explicitly or restart within the existing bounded policy.

Runtime receipts must report this run's cache reuse, elapsed time and zero new model usage where applicable. Link the original candidate's costs as historical provenance; do not count those tokens again or copy its old runtime coverage receipt. Existing run diagnostics need an explicit final-synthesis hit/miss and miss reason, separate from extraction hits and pack reuse.

For standalone Mongo, either disable final-result admission initially or clearly retain the existing best-effort read/recheck/cleanup limitation. Do not claim transaction-safe concurrent reuse. Archive/trash/source edits and deletion must make old entries ineligible immediately; permanent course deletion must also remove this new collection. Version changes invalidate by key; retention can remove unreachable versions later.

## Instructor intent

The current workbench's **Generate again** confirms that it will generate a new draft. That action must bypass final-result reads; serving the same cached draft would break the existing promise. It can still reuse exact validated source analysis and organization packs. A network retry or reopening an already completed run should show its retained result without starting a new paid run.

For an explicit reuse action, add a versioned request policy such as `reuse-prepared-outline`; show that a prepared draft was reused. Keep `generate-new-outline` as the existing Generate again behavior. A distinct, deliberate `reanalyze-sources` action can bypass extraction and final caches when the instructor wants fresh interpretation. Do not infer any of these actions from page refresh, silently use a random cache key, or change global Admin model settings. Persist the policy on each durable run and keep application to the saved course outline as a separate reviewed action.

## Bounded implementation and acceptance

The next implementation can add one cache service/type/collection/index, integrate lookup and guarded admission at the shared final-synthesis boundary, add the explicit request policy and diagnostics, and extend course cleanup. Existing extraction limits, model defaults and all-source readiness gates remain authoritative.

Required checks before claiming a speed improvement:

- A genuine cold run followed by the same production path with a completion hook that throws before any provider dispatch. The warm run must complete, preserve the canonical draft and current gaps, and record zero sends.
- Changes to source text/title/selection, extraction, existing Topics/LOs, guidance, schema, model/effort/cap or pack input must miss. Tampered candidates, foreign IDs, duplicate-reference ambiguity and outdated validation must not replay.
- Cancellation and concurrent source/outline edits must prevent stale completion or cache resurrection. Course deletion and cross-course isolation must remain enforced.
- Generate again must dispatch a newly captured final synthesis, while explicit source reanalysis must also bypass extraction reuse.
- Measure full ten-file cold/warm runs and incremental chapter addition separately, with wall time, actual provider usage, conservative reservations, final-cache hits, preserved gaps and teacher judgments reported independently.

This cache can remove repeated final-synthesis latency and token cost for exact reuse. It cannot improve an incorrect original draft, establish reduced professor review time, or make a changed ten-chapter request equivalent to the measured two-chapter subset. Full ten-file cold preparation needs a separately declared budget: the existing zero-call preflight estimated 1,275,670 conservative tokens for initial extraction alone, before repair and synthesis; it does not fit the remaining first-phase allowance.
