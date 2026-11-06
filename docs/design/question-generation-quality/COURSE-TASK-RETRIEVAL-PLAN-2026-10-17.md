# Current-course task retrieval and explicit comparisons

## Objective and observed gap

Improve question-generation memory for older paraphrased or numerical variants,
without treating retrieval scores as duplication judgments or adding a model
send. The exact-content repair remains intact. The fixed before/after audit is
`audit-results/bank-task-retrieval-gap-2026-10-17/results.json`; the independent
review is `audit-results/bank-task-retrieval-design-2026-10-17/IMPLEMENTATION-REVIEW.md`.
Both inspect the actual preceding production sources. Their labels are scripted
task identities, not teacher acceptance or new model-quality results.

Two gaps must be addressed together: recent-head selection precedes ranking,
and an ordinary displayed comparator can currently receive no comparison row.
Global nomination alone would not close the second gap.

## New versioned contract

- Fresh opt-in v2 runs and new durable regeneration select server-owned
  `taskRetrievalProtocol: course-task-retrieval-v1`. Exact retry and same-UUID
  recovery preserve absence on historical requests.
- Scan current active course heads in 128-head keyset pages, with existing
  20,000-head/five-second ceilings. Validate immutable current ownership and
  effective current/hash-bound descriptor profiles. Actual question content is
  the fallback for missing profiles; no paid historical backfill runs.
- Reuse an already available legacy query vector. Do not add an embedding or
  LLM send. Changed candidate queries can use an explicitly recorded lexical
  fallback; they cannot reuse a vector for a different query.
- Keep up to 64 relevant global nominations within at most 200 Bank entries,
  retaining recent fillers and the mandatory original comparator. The existing
  prompt limits remain 12 entries/12,000 characters by default.
- Optional memory metadata retains exact query/scope/ranker identity, effective
  current content/profile digest, vector identity and selected identities.
  Completeness describes bounded traversal, not complete semantic recall.
- At most two total mandatory comparators include the pinned original when
  present. Their complete question, options, feedback and formulas must fit the
  existing prompt bound; otherwise report an explicit shortfall. A high score
  never creates a duplicate verdict.
- The same quality call must provide exactly one valid inference/path comparison
  for every required comparator. Independent and uncertain verdicts cannot skip
  these rows. Shared vocabulary can have a valid negative comparison. The
  existing correction/send/token budget remains authoritative.

## Integration and currentness

1. Bind the selector through run input, worker restoration, exact retries and
   requirements. Unknown explicit selectors fail before new work.
2. Initial planning/generation use the new bounded memory. Persist incomplete
   diagnostics before refusing the affected model stage.
3. Refresh nomination for an actual candidate and again for a changed repair,
   without another embedding. Return and persist the actual assessed memory;
   do not associate a repaired candidate with an earlier query.
4. Regeneration updates its frozen context/memory identity before quality and
   adoption. The pinned immutable original remains mandatory for independent
   regeneration, and intentional edit/variant policy remains separate.
5. Currentness and course-fenced writes replay stored query/vector locally. No
   provider work belongs inside a transaction. Bind effective profile changes
   even when raw current content remains unchanged.
6. Before save/adoption, replay candidate/memory/required-comparison bindings;
   the retained model eligibility flag alone is insufficient. Preserve the
   independent exact-content final-write check from the preceding repair.

## Verification and evidence

- Preserve exact pre-change sources and input/output fixtures before edits.
- Test older same-task exposure, shared-term different-inference negatives,
  imports without profiles, stale/foreign/archive/current-version exclusions,
  caps, missing data, pinned original, batch overlays and old-byte compatibility.
- Test required-row omissions, duplicate/foreign rows, valid negative comparisons,
  source-versus-Bank identity and candidate changes after repair.
- Verify stored-query/vector replay without provider calls, changed effective
  profiles, stale memory and final course-fence behavior.
- Measure prompt headroom on retained inputs under unchanged caps. Do not infer
  lower production cost, higher valid yield or semantic recall from fixtures.
- Run appropriate local unit/service/browser checks, then actual owned local
  Mongo controls when useful. Preserve every failed attempt.
- Append English input/output, limitations, timings, usage and screenshots to
  the existing HTML book. Archive exact source bytes for later reproduction.

Paid model comparison and calibration remain pending explicit approval. R6 is
historical and must not be executed as a current declaration. This plan does
not authorize a provider send, a production deployment, a Git push or Canvas
writes. The full generation-quality goal remains active after engineering tests.
