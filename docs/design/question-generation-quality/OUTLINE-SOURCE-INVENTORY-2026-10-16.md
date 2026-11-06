# Multi-source outline source accounting — October 16, 2026

## Problem and resulting behavior

The previous ten-source experiment traversed every selected chunk, but this did
not prove that each instructional relationship reached the outline. The October
14 independent source audit found an explicit standard-deviation/square-root
relationship absent from the appended statistics extraction. It also found an
exact first quote ending before a denominator distinction named by the extracted
point. Diagrams and chart values remained partial. Those observations are retained
in `ACCEPTANCE-2026-10-14.md`; they are not replaced with a green coverage score.

The source extraction now accounts for every numbered parsed passage, rather
than accepting any one valid quote per section as sufficient extraction:

- An objective or knowledge point retains its primary original passage and can
  cite up to seven additional original passages. Each quote is resolved and
  validated independently; unrelated text is never concatenated into a purported
  continuous quotation.
- Every passage not linked to an objective requires a specific `context`,
  `non-instructional`, or `visual-review` disposition and reason. Missing,
  conflicting, duplicate, forged and cross-section references fail validation.
- The original full section remains the authority. Formula, numerical-convention
  and visual/actor cues are deterministic review aids, not proof of curriculum
  completeness or of a model's semantic judgment.
- A final outline that omits an entire selected source containing extracted
  instructional points uses the existing bounded correction allowance. If that
  source is still absent, the outline fails instead of silently completing.
- Evidence-equivalent LO pairs are review signals, not automatic semantic merges.
  Pair diagnostics are bounded to 400 objectives and 200 signals; truncation is
  explicit. All source inventory rows remain present independently of this cap.

## Runtime, cache and cost

`generateStructure(courseId, options, runId?)` still reads every selected indexed
original. Intended-upload admission, exact chunk hashes, readiness, explicit
source exclusions and currentness rechecks remain in force. There are no new
model stages or unbounded retries: source extraction keeps its existing two
attempts and section fallback; synthesis keeps its existing two attempts.

The source cache protocol is `source-local-ledger-v3` /
`source-knowledge-v2-passage-accounting`. Old extraction output cannot silently
qualify as newly accounted source coverage. Current prompt, effective model,
reasoning effort, output cap, schema, exact original text and parsing identity
own cache compatibility. This necessary protocol change makes earlier extraction
units cold; it is not a claim of zero-cost migration. Full supporting original
quotes increase some synthesis inputs; existing bounded packs retain every point
and exact originals, and oversized contexts fail explicitly.

`coverage.sourceInventory` separately reports parsed passage counts, passages
linked to an extracted objective, passages mapped into the final outline,
explicit dispositions, unresolved sources and bounded overlap diagnostics.
These counts measure accounting and reference linkage. They do not establish
semantic source entailment, all taught concepts, or instructor acceptance.
Warnings call out numerical/visual passages excluded from objectives and sources
without mapped objectives, including sources the model calls non-instructional.

## Controlled input/output observation

An optional private observer is available for isolated local experiments:

```ts
await generateStructure(courseId, options, undefined, {
  model: { model: 'gpt-6-luna', reasoningEffort: 'high' },
  maxOutputTokens: 10000,
  complete: capturedCompletion,
  record: event => writePrivateEvidence(event),
});
```

Its effective model settings and output caps are used by both actual calls and
cache identities; no platform/Admin setting mutation is required. The injected
completion must preserve `beforeRequest`, `onText` and `onAttempt` hooks.
Events distinguish prepared prompts, actual JSON-attempt input, provider start
and finish/usage, complete raw visible output per JSON attempt, parsed output and
terminal failure. An input hook alone does not prove dispatch: the provider start
receipt must corroborate admission. Invalid JSON and failed corrections retain
their visible outputs. No hidden reasoning, credentials, HTTP raw-payload logging
or public content telemetry is introduced. Without this explicitly supplied
observer, ordinary production completion behavior is unchanged.

## Fixed-input offline evidence

Run:

```sh
node --import tsx scripts/verify-outline-source-inventory.ts
```

The command makes no model or database calls. It verifies the retained ten public
PDF hashes against the declared source inventory, partitions the retained parsed
text, and writes `audit-results/quality-authoring-2026-10-16/source-inventory-offline.json`.
Observed scope: **10 original PDFs, 599 pages, 1,312 page-partition passages**.
Those page partitions are an offline audit scope; they are not relabelled as the
previous ingestion chunk boundaries. All 1,312 passages remain semantically
unreviewed in this inventory-only audit.

The statistics PDF page 6 is retained as one exact fixed input. A declared
first-quote-only control illustrates the historical protocol deficiency: the
old contract accepts a valid first passage while the later relationship is
unaccounted. The new contract names the missing passage IDs. A declared complete
control round-trips five separate exact original quote groups and includes them
in the synthesis ledger. These are deterministic controls, not newly generated
model outputs, a recovered historical raw response, or measured model improvement.

## Remaining limitations

A model can still incorrectly call important material contextual, or link a broad
passage to an LO that does not cover every concept it contains. Those judgments
require independent source review and teacher calibration. The protocol exposes
the decision and original locator; it cannot certify its semantic correctness.
No OCR or vision extraction was added. Chart values, geometry and actor/row
relations lost by parsing require original PDF visual inspection. Real multi-file
model runs, source-conditioned LO quality and question outcomes must be reported
separately from these offline contract checks.
