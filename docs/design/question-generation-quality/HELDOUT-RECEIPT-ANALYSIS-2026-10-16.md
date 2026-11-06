# Held-out receipt analysis methodology

`scripts/analyze-heldout-quality.py` is a Python standard-library-only, offline
reader. It does not import application code, call a provider, connect to a
database, or modify experiment receipts. Its output is created exclusively;
choose a new output filename for each snapshot.

## Reproduce

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/offline -p 'test_analyze_heldout_quality.py' -v

python3 scripts/analyze-heldout-quality.py \
  --phase-dir audit-results/quality-lab-2026-10-16-heldout-phase-three \
  --source-audit audit-results/quality-lab-2026-10-16-heldout-phase-three/notation-chart-independent-source-audit.json \
  --output /tmp/heldout-receipt-analysis-new-snapshot.json
```

For an explicitly narrower snapshot, add
`--terminal-shards shard-1 shard-2 shard-3`. Other terminal shards become
out-of-scope, active shards remain active, and missing receipts remain unknown.
The analyzer never relies on the live aggregate to infer shard completion.

## Integrity and denominators

The declared 60-cell schedule supplies the denominator. Rows merge by exact
schedule ID; duplicate declarations, cells, shard membership, and reused native
call IDs fail closed. Stored arm/model/effort, pinned generator prompt, actual
initial prompt, output cap, and overlapping native request options are checked.
Corrected JSON attempts retain their distinct actual prompt hashes. An absent
effort property remains absent; it is not normalized to `none`.

The file reader validates declaration and fixture identities, exact embedded
transcripts against their private files, and every recorded code snapshot's
bytes. All selected terminal shards in the current run have the same 22 recorded
code hashes. The report retains exact input-file hashes and the analyzer hash.
Known usage sums and SDK call counts are independently reconstructed from native
started/finished lifecycle pairs and reconciled with each shard's aggregate.
Those pairs count once, not twice. Hidden SDK retries and wire requests remain
outside this measurement.

Keep these dimensions separate:

- Execution: terminal, active, incomplete, unrecorded, or out-of-scope.
- Generation: parsed response versus a failed/unavailable response.
- Schema: retained normalized candidate versus contract failure or unknown.
- Numerics: verified, failed, not applicable, or unrecorded; failure text is kept.
- Semantics: completed assessment, transport unavailable, or unrecorded. A
  native `withheld`/`uncertain` wrapper after failed judge transport is not a
  substantive rejection.
- Supply: a calculation requires `numericKind=numeric`. An eligible conceptual
  fallback does not fulfill that numerical request.
- Difficulty: requested, candidate-declared, and judge-achieved values remain
  separate. Missing judgments are unknown, not mismatches.

Per-arm generation and judge usage/duration are separate. Nullable token sums
include only known provider reports; 30 unknown-usage calls cannot be assigned
zero cost. SDK duration sums include failures and are not cold user-facing wall
time. The shared judge's cost is attributed to the candidate arm while its
actual model remains recorded.

## Current terminal result

The [full receipt analysis](../../../audit-results/quality-lab-2026-10-16-heldout-phase-three/heldout-receipt-analysis-final-2026-10-16.json)
records all six shards as terminal, with 60 declared cells:

| Dimension | Recorded result |
| --- | --- |
| Generation responses | 40 parsed; 20 transport failures |
| Schema | 39 retained; 1 invalid; 20 unavailable |
| Numerical gate | 9 verified; 1 failed; 30 not applicable; 20 unrecorded |
| Semantic assessment | 29 completed; 10 judge transport failures; 21 unrecorded |
| Completed semantic judgments | 23 eligible; 6 withheld |
| Requested task kind | 35 fulfilled; 5 conceptual substitutions; 20 unknown |
| Requested difficulty | 14 matched; 15 differed; 31 unknown |
| Observed SDK invocations | 60 generator + 39 judge = 99 |
| Provider usage | 251,197 known tokens across 69 calls; usage unknown for 30 |
| Saved / adopted | 0 / 0; professor acceptance unknown |

The numerical failure is an option-format cue in depreciation Luna-high r1:
some options say “tax benefit” and others do not. It is not an arithmetic
collision. The separate exhaustive audit's 26 correct arithmetic/display draws
therefore do not imply that all five candidates passed every numerical gate.

The exact-candidate source audit supplies the chart interpretation: five honest
missing-data conceptual fallbacks, four judge-eligible, zero invented 1989
amounts, and zero fulfilled numerical tasks. Labels join only matching candidate
IDs and hashes; they are not propagated to another repetition.

## Comparison limits

There are 30 declared r1/r2 pairs, but only 10 have parsed generation on both
sides and **none has completed semantic assessment on both sides**. Repetition 2
is confounded by judge and generator outages. These are repetitions of one frozen
protocol, not before/after product changes. Neither paired semantic improvement
nor degradation can be estimated from this run. The historical 1/6 saved-yield
observation also has different controls and budget confounding; this lab run is
not a causal comparison against it. No model ranking or reduced professor review
time is claimed.

Ten synthetic tests cover missing, active and incomplete slots; unknown usage;
duplicate IDs; arm and prompt mismatches; task-kind and difficulty shortfalls;
and a terminal failed-judge wrapper that must not become semantic rejection.
