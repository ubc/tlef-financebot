# Bounded repair of a retained outline proposal

Design for review before implementation or another paid phase. The completed
continuation resolved all 142 source reviews: 119 supported, 23 withheld and
three advisory grouping findings. It produced a 30-topic/119-LO draft, using 11
additional observable calls. The shared phase ledger now contains 31 sends and
1,454,173 conservative units. No hierarchy was applied. These are source-review
and execution results, not teacher acceptance or proof of an atomic curriculum.

## Why repair only selected objectives

One unsupported or uncertain clause in a long merged objective can withhold
several otherwise taught capabilities. Re-running 671 extractions or the final
organization would change unrelated wording and invalidate earlier review.
Reclassifying an existing negative finding would discard the evidence trail.
Instead, create one explicitly linked proposal branch, change only selected
wording, and independently review its new bindings against unchanged originals.

The 119 supported LOs can still be too broad for teaching or question planning.
Root's descriptive inspection found a median of 37 whitespace words, a p95 of
50 and a maximum of 62; 66 exceed 35 words. Those are inspection cues, not
failure thresholds. No paid rewrite of all 119 is proposed. Prefer a concise,
assessable capability, but retain conditions necessary for meaning, precision
and valid application. Original evidence and detailed conditions remain visible
metadata even when an LO label is shorter.

## Two actual cases and the limits of their labels

| Target | Recorded reviewer reason | Source-bound repair to explore | Interpretation limit |
| --- | --- | --- | --- |
| L82 / E481–E483 and related points | The original LO says “rental value”; S285 explicitly teaches expected present value of after-tax rental/lease receipts. | Clarify that valuation phrase as the present value of after-tax rental or lease cash flows, retaining the other source-supported side-cost and capacity capabilities. | This is a precision/clarification concern. The shorthand does not by itself establish that outside-course content was introduced or that the LO asserts a wrong formula. |
| L92 / E554–E558 and related points | S333–S338 teach the capital-structure comparisons, assumptions and financing hierarchy; S339 is an unmarked multiple-choice teaching activity about convertible preferred stock. | Preserve the taught MM assumptions and financing capabilities. Either narrow the unsupported signal assertion or phrase the convertible-stock component as evaluation of the competing interpretations explicitly posed by the activity. | An explicit activity can support “evaluate” without establishing a unique answer. The source cannot prove a particular financial-health signal or supply an answer key merely because answer choices are present. |

These are engineering repair hypotheses, not new source verdicts. The independent
review can still withhold them. It must distinguish a material false or missing
claim from a reasonable LO label that does not reproduce every slide condition.
It must not invent new prerequisites, formula obligations or answer certainty.
No classroom activity is automatically deleted or treated as an answered fact.

## Smallest production change: one wording-only branch

The first implementation should preserve every original objective ID, position,
topic, evidence ID, material ID, original-source alias and evidence ordering.
Only selected negative/uncertain LO names may change. This directly addresses
an added unsupported clause or a necessary clarification while allowing the
current planner and validator to prove all untouched full bindings unchanged.

Arbitrary splitting, removing evidence or reassigning global aliases is a
different operation. The current planner numbers IDs/aliases as it traverses
the proposal; doing those operations and pretending old sibling reviews remain
valid would be incorrect. A future targeted split branch must explicitly bind
parent identities, preserve unchanged coordinates/aliases, assign new child IDs
and re-review each new binding. That extension should be used where independent
capabilities or an unsupported bundled clause prevent useful coverage; it is
not a reason to rewrite every supported LO or impose a word-count cutoff.

For the minimal branch, use this lifecycle:

1. An Instructor/Admin-controlled internal service chooses explicit target
   negative/uncertain IDs from a terminal, complete source-reviewed proposal.
   A new linked durable run and immutable repair input pin the parent run,
   checkpoint/progress hashes, every original finding, target content hashes,
   full own originals, source selection, model/provider and repair protocol.
   The parent remains terminal and unchanged. One repair cycle is allowed per
   exact parent proposal, rather than per request UUID.
2. Make one bounded repair-proposal completion for the selected targets. It
   receives their exact wording, recorded reasons, assigned evidence and full
   own originals. Nearby unchanged LO labels may be supplied as organizational
   context, explicitly not source proof. The instruction asks for minimal
   source-supported wording, preserves necessary conditions and permits an
   honest “no repair proposed.” Source/input cap failures stop before a send.
3. Parse a strict output containing only the supplied IDs and proposed names
   plus a short change explanation. No model-authored status, coverage,
   citation proof, new evidence, topic, numeric answer or verification field is
   authoritative. There is no second semantic proposal attempt. The existing
   portable JSON correction, if used, consumes another native reservation.
4. Reject unknown/duplicate/missing IDs, unchanged names masquerading as repair,
   empty proposals and exact normalized-name duplicates of unchanged siblings.
   Build a new immutable checkpoint from the original corpus/extractions/
   evidence and permitted wording changes. Recompute bindings through the
   current production planner. Require every unselected binding and finding
   to remain exact; retain the original selected negative findings as lineage.
5. Seed the new review checkpoint only with unchanged validated siblings. The
   new selected bindings begin unresolved with their own at-most-two current
   review attempts; the parent's attempts stay consumed and immutable. Invoke
   the existing shared review loop with full original sections. The reviewer
   receives the new wording, not the repair rationale or the old verdict, so
   an edit does not become an automatic positive judgment. Schema/identity
   correction is unresolved-only; source-negative/uncertain rows are terminal
   findings, not instructions to keep editing until acceptance.
6. Recheck sources/course/run ownership after replies and before finalization.
   Final admission and coverage use the existing current validator. Preserve
   withheld rows and uncovered evidence explicitly, including points omitted
   by narrowed wording. A positive repair contributes only its newly reviewed
   covered points. The branch stays a selectable draft for human review;
   applying Topics/LOs uses the existing separate current-source Apply gate.

The proposal model and reviewer may use the same declared model configuration,
but they are separate calls with separate roles and receipts. This is not a
claim of model-family independence or unbiased semantic gold.

## Persistence and implementation boundaries

Add a small `StructureRepairBranch` authority record and a versioned immutable
run link, rather than store a repair request in an untrusted browser result.
Keep one unique `(parentCheckpointId, parentCheckpointHash, cycle:1)` branch.
The record pins targets/request/model/protocol/base budget; CAS progress retains
the proposed raw response, proposal hash, native reservations, unknown dispatch
state and eventual new checkpoint reference. A repeated request returns the
same compatible branch; a changed target selection conflicts instead of buying
another cycle. Duplicate workers use the existing atomic queued-to-running
claim. Unknown in-flight work blocks blind replay.

Suggested focused files are `structure-outline-repair.ts` for pure prompt/
proposal validation and binding-delta proof,
`structure-outline-repair.service.ts` for branch authority/orchestration, and
`types/structure-review.ts` plus the existing additive content-run/collection
links. Reuse the current source loader, scoped authoring fence, native
`completeJson`, usage receipts, checkpoint validation, shared review loop,
coverage finalizer and Apply path. No change to extraction, organization,
question generation, numerical serving or positive/negative coverage gates is
needed. A checked helper may seed exact sibling findings, but must reread the
parent checkpoint/progress and prove the delta internally; it must not become
a generic “accept these findings” JSON endpoint.

## Prospective cost gate for the two-target pilot

The implementation must inherit the completed 31-send/1,454,173-unit prefix and
leave the unchanged 100-send/2,000,000-unit ceiling intact. Its remaining
allowance is 545,827 conservative units. For two selected targets retained in
their existing review batches, a strict **10-observable-send /540,000-new-unit**
upper fence fits below that remainder:

- One repair proposal, with at most two native sends including portable JSON
  correction.
- Two independent review batches, each with at most two semantic/schema
  attempts and at most two native JSON sends per attempt: at most eight sends.
- At most 48,000 shaped input-estimate units including system/correction text
  and at most 6,000 reserved output units per send. A smaller repair output cap
  may be declared after rendering actual inputs; it does not expand any limit.

This is a prospective worst case, not a declaration authorizing execution.
First render the exact repair and review inputs, freeze code/source/parent/
ledger pins and obtain root review of a new declaration. If targets span more
batches, a full-original prompt cannot fit or any earlier reservation consumed
the remainder, reduce work or stop. Do not expand the cap to finish. Failed,
unknown and admission-denied reservations remain charged; hidden provider
retries and billed usage remain separate. Preserve the explicit transport and
total request deadline in that declaration. Every stage, including the repair
proposal before the review checkpoint exists, needs a durable cumulative fence.

## Coverage warning correction

The completed draft's “73 sections were classified as non-instructional” was
incorrect aggregation: zero extracted objectives do not imply that disposition.
Those sections contain 126 recorded visual-review passages, five
non-instructional passages and one context passage. The warning fix reports
zero-objective sections and their recorded passage counts separately, preserves
source-specific reasons and explicitly exposes missing historical dispositions.
It changes presentation of current results without rewriting old receipts or
inventing visual relationships.

## Required offline and controlled acceptance

Offline tests must prove exact sibling binding/finding retention, target-only
new hashes, no extraction/organization callback, strict proposal identities,
honest no-repair output, source/model/protocol changes, stale parent costs,
one-cycle idempotency, duplicate workers, cancellation/course deletion, unknown
dispatch retention and portable JSON correction accounting. Test that a repair
cannot add unmarked answer certainty, fabricate coverage or quietly discard an
untouched objective. Negative results remain admissible diagnostic outcomes.

A later controlled two-case run should record actual input/output, new binding
hashes, source verdicts, grouping findings, covered/uncovered evidence, latency
and known/unknown usage. Compare the fixed parent and new branch as an explicit
targeted repair, not a randomized or causal old/new experiment. Teacher
acceptance remains null; saved/adopted questions and applied hierarchy remain
zero unless separately authorized and actually executed.
