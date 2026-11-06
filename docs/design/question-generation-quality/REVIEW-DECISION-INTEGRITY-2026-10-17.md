# Preserve review decisions during format correction

The closed R9 provider probe returned a `duplicate` novelty judgment for P02,
then changed it to `independent` while filling a missing Bank comparison. The
candidate, source packet, Bank and teacher request were unchanged. That second
label made the candidate eligible. This is a review integrity problem; the
probe did not establish that either novelty judgment was correct.

## Production contract

Fresh opt-in `grounded-memory-v2` public runs and new durable regeneration
requests select `reviewRepairProtocol: frozen-review-decisions-v1`. Exact
retries, queued workers, stored plans and same-UUID recovery keep their recorded
selector. Historical absence, baseline and v1 retain their existing behavior.
Unknown explicit values and use outside v2 refuse before new provider work.

The existing quality call may still use its one logical schema correction.
Before that correction, the server captures bounded valid decisions directly
from the raw JSON response, before reference resolution can drop a finding.
The correction may fill invalid or missing fields and repair source locators.
It may not silently change or remove an already valid source, notation,
novelty, difficulty, length, answer, teacher, comparison, task-demand or
missing-premise judgment. A changed decision withholds the candidate and cannot
drive the automatic candidate-rewrite path.

Valid negative rows survive malformed neighboring rows. Schema-trimmed text
uses the same whitespace normalization; blank invalid premises/findings remain
fillable. Only the candidate's actual MCQ or T/F answer shape is captured.
Repeated identical decisions can be deduplicated; conflicting judgments for
one answer, requirement or Bank identity are retained as a conflict instead
of selecting the convenient last row. Over-limit arrays cannot discard unseen
judgments through this bounded correction path.

An internal receipt binds the complete canonical candidate, requirements and
source packet, the before/after vectors and initial schema issues. Public
saving and explicit regeneration adoption replay this receipt inside the course
fence, including selector equality on the fresh durable read. Actual BSON
round-trip controls cover the stored form. This is plain-data identity and
decision consistency, not a signed provider attestation or semantic proof.

The full source, candidate, Bank memory and teacher request stay available.
No extra review stage, embedding or automatic semantic re-review is added.
Logical corrections, native JSON retries and candidate repair continue to
consume their existing send/input/output/global limits. Native JSON retries
inside the provider wrapper are outside this decision-locking protocol: it
compares the parsed responses returned to the quality service.

## Verification and interpretation

The portable controls exercise the real quality wrapper with scripted responses
and denied external boundaries. They reproduce P02-shaped drift, invalid
finding references, malformed neighbors, duplicate identities, valid locator
repair, invalid-field completion, frozen source/teacher/candidate bindings,
old-selector absence and regeneration adoption. They test software behavior,
not new model accuracy or real database commits.

The owner combined regression currently passes 19 suites / 881 tests, and full
server/client typecheck passes. The earlier nine-suite run's five failures were
test fixtures that intentionally changed requirements and judgments without
rebuilding the new receipt. Those failures remain archived; revised explicit
scripted fixtures now bind all independent receipts to their revised inputs.
Independent review found two negative-finding disappearance paths and two
invalid-field false holds; all four received production fixes and controls.

Final native sizing retains 512 intercepted request envelopes across four
cohorts. The fresh compact selected cohort fits 128/128 paths, including
streaming and nested JSON correction, at a maximum 23,948/24,000 conservative
input units (52 units of headroom). This is not a provider-token count or a
guarantee for arbitrary future inputs. Earlier selected overflow trials
(16/128, 4/128 and 2/128) remain preserved. Historical-style noncompact absent
and selected cohorts still refuse 4/128 and 11/128 paths respectively. Only
owned repetitive instructions, error metadata and judgment projections were
compacted; complete original payloads and all admission caps remain unchanged.
The full ordered server decision vectors and issues remain in receipts.

The final offline replay reproduces all seven historical R9 prompts exactly on
the absent-selector branch. Applying only the new selector to the same five
complete contexts and the same seven retained responses changes eligibility
from 2/5 to 1/5 (CAPM). P02 is withheld because its novelty, a teacher finding
and an actionable finding changed during correction; P01's changing exclusion
basis is also recorded. P03/P04 remain withheld without decision drift. All
seven selected historical-admission estimates fit, maximum 21,840/24,000 input
units (2,160 headroom). All seven absent-selector estimates also reproduce the
recorded R9 reservation values exactly. The maximum selected serialized body
is separately 22,870 UTF-8 bytes / 22,804 UTF-16 units. These dimensions are
not admission units. An earlier audit incorrectly inferred a P02 refusal from
a 24,881-unit serialized-body projection; the actual historical nonstreaming
admission estimate was 23,812 and fitted. That mistake and its explicit
correction remain archived, alongside the earlier code snapshots. These
estimates reuse historical native request shapes; the separate 512-envelope
native-renderer trial above is the actual local request-shaping test.

This replay executes 14 local completion callbacks across two branches and
zero SDK/provider/physical sends. It does not acquire new model judgments,
tokens or cost. Rejecting P02's changed judgment repairs integrity while
reducing the replayed eligible count; it does not prove improved valid
question supply.

P01/P04 source entailment, P03's percentage-notation false refusal, requested
task difficulty and professor acceptance remain unresolved semantic work. The
next comparison proposal first calibrates Luna6 none, Luna6 medium and Sol6.1
medium on the same five complete contexts; generator comparison comes only
after the judge is vetted. This proposal has no execution authority. The R9
authorization, including its unused remainder, is closed.

## Multi-file outline fixes in the same checkpoint

Ordinary completed capability-review Apply now reconstructs exact correction
diagnostics from the checked raw history, instead of rejecting a complete
result merely because a preceding response required correction. The existing
strict finalizer, source, peer and result bindings remain. The source-to-worker,
BSON and transactional-Apply control uses ten materials and scripted reviews;
the final focused suite passes 70 tests. This does not implement the separate
durable consolidation child or establish pedagogical coverage.

Continuation creation and execution now require all four immutable checkpoint
limits to agree with recorded parent and durable shared ceilings, in both
directions. The worker's local input/output caps are bounded by those ceilings;
an insufficient output cap refuses before review. The focused four-suite
regression passes 188 tests. A suspected spent-child restart counter gap was
traced through the actual claim/state/caller graph: the second invocation is
not supported or reachable today. No speculative resumability patch was made.

These focused test counts overlap the 881-test combined run and must not be
added to it. All database/model results in these controls are scripted or
mocked. No additional paid calls, saved Drafts, course mutations, commit, push
or deployment are implied.
