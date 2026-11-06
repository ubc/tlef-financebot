# Source interpretation guards: prospective v2 cohort

## What the retained saved questions showed

The four supplied immutable Drafts were independently inspected before their
automatic findings or model bindings were read. The audit is an agent review,
not professor acceptance or a blinded human trial. It is pinned in
`audit-results/quality-lab-public-http-2026-10-17-live/independent-saved-source-audit.json`
(SHA-256 `8b29d16d6f7276357421bf53c0f4292d8195c0c7d2dafb5f24e02c5c3c7269ad`).

- P01 supports both “asset-class diversification mitigates market risk” in its
  table and “market risk cannot be diversified away” in its prose. Those claims
  differ in strength. The item does not establish a unique answer by treating
  mitigation as complete elimination.
- P04 selects a table-listed domestic-stock strategy, but the broad “can
  mitigate” stem does not make every strategy listed elsewhere impossible.
  Table placement is not an exclusive prohibition. Its saved easy label also
  leaves the requested hard task unfulfilled.
- P02 correctly asks for the two taught causal mechanisms: smaller portfolio
  weights and averaging firm-specific effects. That is distinct from the seed
  True/False conclusion and the saved peer's classification/limit task.
- P03's complete explicit 16-draw grid has the expected answers and no option
  collisions. It computes Market Beta to Total Beta, rather than directly
  testing beta versus total volatility. Arithmetic validity does not establish
  that every teacher request clause or requested difficulty was fulfilled.

These are four fixed outputs. Saved count, source-supported statements, numerical
correctness, task novelty, unique answers and teacher acceptance remain separate
dimensions. The original table pixels were not inspected; ambiguity in the
retained table cannot be repaired with outside finance knowledge.

## Why CAPM item 0 was withheld

The terminal public run is in `results.json` in the same artifact directory,
SHA-256 `56473c7065ed5b4e77ca1712a2ad4658afe6413d1751cba469deb78d5403a173`.
Its CAPM run is `6ad32951551406501e057a2e`, task-plan slot 0.

The first numerical rejection was correct: `r + Beta * Premium` and the original
`r + Beta + Premium` distractor collide at Beta 1.2 and Premium 6. For r = 3,
both are 10.20%. The deterministic retry changed that distractor to `r + Beta`;
the retained retry's 27 explicit draws have four distinct two-decimal answers.
Its percentages are consistent with the source formula and displayed units.

The final source assessment passed source support, notation, novelty and the
server-planned inference, and had no preserved invariants to fail. It nevertheless
reported the composite teacher request unfulfilled because percentage-number
inputs were supposedly not decimal variations. The actual domains include
2.5/2.75, beta 1.2/1.4/1.6 and premium 5.5. Noninteger input variation does not
require changing 2.5% to fractional encoding 0.025.

The assessment also confused a deliberately wrong halving operation with the
explanation rejecting it, asking that the source teach the wrong operation.
The source must justify its correction; a wrong arithmetic operation on taught
inputs need not be an endorsed method. Any additional concept needed to reject
the distractor still requires evidence. The separate role validator called two
roles mislabeled while recommending their existing roles. Whether another
distractor is pedagogically useful as partially correct remains a real review
question, rather than a reason to force this candidate eligible.

Exact private transcript files, relative to that directory:

| Step | Transcript | SHA-256 |
| --- | --- | --- |
| Initial generator | `1273b90f-44e7-4ed6-b32c-13cbee9d3415.json` | `e109af74be5cc355240386909368105875b6497cc368049dbef051425866bff4` |
| Deterministic retry | `8648fcf9-cd92-488a-8252-dcd6a6f56e9f.json` | `97f4f5356c7daabe4f8610fb4f7ca4aed410c3d94bb26bf84ccbebfccf959ed8` |
| Role validator | `c7f2ced6-0e70-46bb-ae86-c25ed4323ae9.json` | `f4f419c0bcce34e7d93a63f64cd13a3c3f9d323824708a1104ab6a4012eb8363` |
| Final source assessment | `ae587e8b-34af-43aa-9c9b-fa6e3196a3b5.json` | `a76b05c77dec4e52e0856cbe140b76d9ddeb8e4bc1a2c164ef46d887215681b3` |

Files are under `private-transcripts/`; hashes bind actual retained bytes.
The semantic repair did not send another generator request because the existing
two-generator-attempt limit was spent. This change does not raise that limit,
erase the failure, drop the teacher request, or retroactively save the candidate.

## The True/False feedback false flag

Variant candidate `6ad329c2551406501e057c03` asks whether diversification reduces
firm-specific risk but cannot diversify away market risk. “True” is the correct
selection. The “False” response explains the correct principle as feedback on
the incorrect selection. The validator and content reviewer mistook that true
feedback for a second correct response and recorded a flag. The final independent
assessment was eligible and the variant was adopted; this was a misleading flag,
not a terminal withheld outcome.

The exact validator transcript is
`private-transcripts/8b3c715b-3b1e-4b36-b46a-5e89eaee541b.json`
(SHA-256 `9ed4f227b9d406e75332f10e2de011e4d97e21bba3f17d9de1914ecf2e894d1c`).
The content reviewer is
`private-transcripts/e0819423-d985-43b0-82cd-c839c59c4bad.json`
(SHA-256 `60415ae5ec79f5b69bc404eb0178777e3bdec14407b6cd65345f2edf8ecd80b7`).

## Prospective implementation

`generation-source-interpretation.ts` supplies compact v2-only instructions to
task planning, the authoring context, the role validator, content review and the
structured source/task review. Each boundary receives one copy. They require:

- Preserve claim strength, modality, quantifiers and explicit conditions.
- Preserve table row ownership without inventing exclusive applicability.
- Evaluate a True/False selection against the entire proposition; keep corrective
  feedback separate from the submitted response.
- Compare the actual current role to any proposed role before alleging a relabel.
- Support exclusions and misconception corrections, without requiring the source
  to endorse a deliberately false arithmetic operation.

The authoring context additionally labels only the exact server-marked first
planned-inference requirement. A similar text prefix is not enough to establish
server provenance. Every other requirement and invariant remains binding. The
prompt asks reviewers to name which clause actually fails, inspect real input
domains and units, and avoid inventing a fractional-rate-conversion requirement.
It does not split, rewrite, retire or waive any teacher requirement.

No eligibility schema, citation validator, currentness check, numerical gate,
repair count, transport setting or budget changed. Baseline/v1 prompt branches
are unchanged. The new instructions are a prospective code/prompt cohort; they
must not be mixed into historical same-code comparisons. Root retained exact
hash-verified pre-edit code snapshots before further work resumed.

## Offline validation and remaining evidence

The pinned test fixture contains exact selected original passages and retained
question fields, plus the actual CAPM retry and True/False feedback case. It
contains no model-quality verdict used as an expected semantic oracle. Production
instructions contain no fixture IDs, course IDs or case-specific verdicts.

The focused five-suite command is:

```bash
npx jest --runInBand tests/unit/generation-source-interpretation.test.ts tests/unit/generation-v2-efficiency.test.ts tests/unit/generation-quality.service.test.ts tests/unit/authoring-task-plan.service.test.ts tests/unit/generation-semantic-repair.test.ts
```

It checks prompt routing and one-copy size bounds, the real 16- and 27-draw
numeric domains, exact requirement preservation/provenance, and the unchanged
withholding of cited defects, bad citations and failed teacher constraints.
Mocked review replies exercise structural admission; they do not demonstrate
that a model now interprets these sources correctly. A new bounded, separately
declared real review/repair probe is still required. No new provider or database
call was made for this implementation or either independent audit.

### Actual-context size correction

The first synthetic prompt-size checks did not cover the full retained source
and intermediate Bank context. Real six-case preflight found P02 and P03 over
the unchanged 24,000 conservative input-unit cap. The prospective v2 wording
was compacted, including equivalent source/novelty instructions and the generic
JSON schema example. Exact teacher requirements are now rendered once rather
than repeated as supposedly fulfilled example findings. No source passage,
memory entry, candidate field, requirement or invariant was removed or shortened.

The tracked `retained-review-size-2026-10-17.json` fixture preserves all six
exact contexts. Tests invoke the actual `assessGenerationQuality` boundary with
an injected completion that refuses before provider dispatch, and verify the
historical rendered source and memory block hashes. The resulting first-prompt
UTF-8 byte counts plus 32 are:

| Case | Conservative input estimate |
| --- | ---: |
| P01 | 20,847 |
| P02 | 22,488 |
| P03 | 22,038 |
| P04 | 20,692 |
| CAPM | 20,779 |
| TF | 19,192 |

Each is at most 22,500, leaving at least 1,500 units under the original cap for
bounded correction text. These are conservative admission estimates, not
reported provider tokens. A larger correction must still refuse under the
unchanged cap. Add `tests/unit/generation-citation-spans.test.ts` to the focused
command above to include citation and actor-ownership regressions. This remains
a prospective prompt cohort, with no new real model result claimed here.
