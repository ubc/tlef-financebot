# Retained-candidate yield repair

Status: implemented, regression tested, and checked in a completed two-call
retained-candidate API probe. One contradictory review became eligible; the
other candidate remained withheld for task duplication. No saved-yield
improvement or teacher acceptance is established yet.

## Observed failures

The only completed public acceptance case requested three independent tasks about
diversification and saved one Draft. All three quality assessments used the same
original evidence packet and the same immutable Bank seed: a True/False question
asking whether diversification reduces firm-specific risk. Raw evidence lives in
`audit-results/quality-lab-public-http-2026-10-16-bootstrap-live/`.

The completed case took 657,263 ms and recorded 18 SDK calls with 61,350 input
and 4,742 output tokens; all 18 have reported usage. The interrupted second case
is excluded from those totals. A retained repair review alone took 610,129 ms,
so the new total-call deadline addresses stalled work as well as the semantic
repairs addressing avoidable rework. These observations do not promise faster
successful model responses. The offline breakdown is
`audit-results/quality-lab-public-stage-cost-2026-10-17.json`.

### Contradictory novelty judgment

The candidate asked the learner to classify risk affecting all investments and
infer that diversification cannot eliminate it. The review labelled it a
`variant`, but its explicit Bank comparison set both `sameInference` and
`sameSolutionPath` to false and described the difference from the Bank's recall
question. The server correctly refused that internally inconsistent judgment.

The bounded correction prompt only named `bank-comparator-required` at the
server-derived `matchedEntryIds` field. The model is explicitly instructed not to
output that field. The correction did not explain which model-facing fields
contradicted one another, and the next response repeated the inconsistency.

The initial review is retained in
`private-transcripts/d0ddcc25-b0e9-4ea0-935e-93788155de94.json`; its correction is in
`private-transcripts/794b448b-e320-48db-9bde-bc04d210839e.json`. The candidate content
hash is `082d3eef921a87f6c526ea24a6f202fede92a80903b794ebb6e46c5581d7e510`.

The repair explains the contradiction using `novelty` and `taskComparisons`.
It permits a substantiated duplicate/variant, an independently supported distinct
task, or uncertainty. It explicitly forbids changing comparison booleans merely
to pass validation. No server override turns a negative judgment into a pass.
Persistent contradictions remain withheld after the existing single correction.

### Replacement constrained to the superseded task

A second candidate tested the smaller-share mechanism of diversification. After
a duplicate judgment, its bounded replacement asked which risk cannot be
diversified away. The replacement was judged source-supported and independent,
but was still required to implement the original smaller-share inference.

The replacement planner had cleared `plannedTask` while leaving its generated
`Implement the planned inference: ...` row in `requiredChanges`. These conflicting
instructions caused another rejection. The raw original review is
`private-transcripts/42ef699c-a026-459b-99c3-5b9b856b0a07.json`; the replacement's
review is `private-transcripts/f358bb0f-4689-45eb-b573-07c687e429ce.json`. Its content
hash is `d095407c28f4d2004013f505e0771a1592d07c7571d95754bce6d4c9d7b7b9ca`.

New slot requirements identify the exact first server-generated inference row.
Replacing an independent task can retire that row only when its marker, original
descriptor and position all agree. All teacher-authored requirements, invariants
and requested difficulty remain. Historical unmarked requirements are preserved;
no text-prefix heuristic deletes a teacher instruction. Correcting the same task
keeps the planned inference. Source, Bank, numerical and content checks still run
on every replacement.

## Verification and limits

`audit-results/quality-lab-semantic-repair-tests-2026-10-17.json` records six passing
suites and 188 tests covering citation spans, quality checks, semantic repair,
the v2 pipeline, regeneration memory and public generation services. New cases
check both possible correction directions, persistent contradictions, genuine
duplicate refusal, exact retirement of the generated row, unchanged teacher
requirements including identical wording, and preservation during ordinary edits.
Scoped ESLint passed. The subsequent full `npm run typecheck` completed
successfully for both server and client after the outline checkpoint wiring.

These code-level regressions use controlled responses. The subsequent API probe
reused both candidates, the original evidence and Bank snapshot, and the same
historical model/options. Neither a review-only positive result nor synthetic
tests establish a full batch supply improvement or reduced instructor review time.
The two retained market-risk candidates may also overlap with each other: checking
each against the historical Bank seed does not establish that both can be saved
together. Live batch-memory and current-Bank checks remain required.

## Completed retained-candidate API probe

The immutable declaration is
`audit-results/quality-lab-retained-yield-repair-2026-10-17-preflight/declaration.json`
(SHA256 `941a3f557b816f80f17d05d580249bfebc105e1de084c50454bbca79cca8d4e1`).
Preparation reproduced three historical prompts exactly and verified the source
PDF and candidate hashes. The scope allowed four native sends and 120,000
conservative units; no database or generation operation was included. The model
was `gpt-6-luna`, historical effort `none`, temperature 0, and a 2,000 completion
cap. This probe is not one of the five reasoning-effort comparison arms.

The process exited successfully. The new results and exact native transcripts
are under `audit-results/quality-lab-retained-yield-repair-2026-10-17-live/`.

| Candidate | Historical outcome | Fresh review outcome | Interpretation |
| --- | --- | --- | --- |
| A: classify risk affecting all investments | Withheld after repeated contradictory novelty fields | Eligible; source supported, independent versus the seed | One new correction resolved the contradiction without changing the candidate or forcing comparison booleans. |
| B: name the risk that cannot be diversified away | Withheld while still required to perform the superseded smaller-share inference | Withheld; source supported, variant of the seed | The obsolete requirement is absent. The new reviewer instead identifies the same diversification rule and solution path, with an unfulfilled teacher novelty constraint. |

Both new responses supplied valid original-source citations. Candidate B's
semantic judgment remains a model judgment; it is not a professor-labelled
negative control. The fresh judgments also show why removing an erroneous
constraint must not automatically admit a replacement.

The two calls took 8,396 ms from the first native preparation timestamp to the
last completion and reported **8,393 input / 780 output tokens**, with zero
unknown-usage calls. Conservative reservations totalled 44,874 units. Hidden SDK
retries remain unobserved. This is not directly comparable with the earlier
657-second full generation request: the probe reused existing content and one
historical first response. Saved and adopted questions both remain **zero**.

The next saved-yield verification must run the actual public generation and
regeneration pipeline, including current Bank/batch checks and persistence, under
a new prospective declaration retaining all previous costs.

## Additional content-review limitation to calibrate

Manual inspection of the one historically saved thin-topic Draft found a role
label worth challenging. Its averaging question labels “Every firm in a large
portfolio must experience exactly the same effect” as `partially-correct`, while
its own explanation says that different firms can experience opposing effects.
The recorded option validator and content reviewer both accepted that role.
The correct keyed answer remains supported, but this distractor does not state
an evident correct subclaim. This is a concrete candidate for a role-calibration
negative control, not an established automated detection improvement. Preserving
this finding prevents the new source/novelty receipts from being mistaken for
proof that every pedagogical role label is reliable.
