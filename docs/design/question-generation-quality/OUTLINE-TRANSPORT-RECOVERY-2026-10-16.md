# Ten-chapter outline: terminal transport failure and recovery boundary

The cold attempt in
`audit-results/quality-lab-2026-10-16-phase-two/outline-ten-cold/`
stopped in source extraction. It did not produce a final Topic/LO draft. Its
terminal result and original failed durable run must remain unchanged.

## Observed failure

The retained result reports 4,441,173 ms elapsed, 552 of 671 source sections
extracted, and 64 observed sends. Sixty-two captures completed successfully.
The two terminal failures are independently evidenced by finished provider
events and retained visible output:

| Capture | Extraction item / logical attempt | Visible characters | Provider duration | Captured error |
| --- | --- | ---: | ---: | --- |
| `outline--63.json` | 545 / correction 1 | 304, incomplete JSON | 1,244,203 ms | APIError: Unknown error occurred while calling OpenAI API |
| `outline--64.json` | 553 / initial 0 | 0 | 3,095,803 ms | APIError: Request timed out. |

The first response identifies the requested model; the empty timeout does not
return an actual model ID. Both failures have unknown input, output and total
usage. Hidden SDK retries remain unknown. The records establish a transport/API
failure boundary, not its remote infrastructure cause.

The native conservative reservation is 1,575,756 units against the unchanged
2,000,000-unit bound, with zero rejected sends and zero pending sends. Therefore
this is not the native-total budget-stop case. The shared phase ledger retains
all 64 reservations; none of the two unknown failures may be treated as free.
Reported successful usage is 169,878 input and 231,740 output tokens, with two
unknown-usage calls excluded from that sum.

The 119 unprocessed sections are one section in Chapter 10, all 50 in Chapter
11, and all 68 in Chapter 12. No organization, synthesis or final-original-LO
review calls occurred. All 18 frozen code files and their retained snapshots
match their recorded SHA-256 identities.

## What validation recovered

An offline replay of the retained structured outputs through the frozen
production source-local validator observes 591 requested-row observations,
including 39 invalid observations across 34 unique material/section identities.
Thirty-three of those identities later become structurally valid. Causes include
foreign passage IDs, duplicate/conflicting passage dispositions, and objective
or knowledge names longer than 500 characters. The one still-invalid identity
is Chapter 10 `C52.S1`; its correction is the truncated failed response above.

These counts establish exact-source/schema recovery only. They do not establish
semantic correctness, complete pedagogical coverage or teacher acceptance.

## Narrow recovery admission

`scripts/quality-lab/run-outline-recovery.ts` retains its original native-total
stop path and adds a distinct `provider-transport` path. This path requires:

- A stopped cold receipt and its exact owned, failed durable run, with matching
  error text, course, actor, input and no result.
- Only the two exact API error messages above, with a retained `APIError`
  transcript ending in a finished failed provider dispatch. A generic message
  without those captures is insufficient.
- No pending, started-only or merely prepared transport calls. A failed response
  can have partial or empty visible text, but cannot claim a parsed result,
  verified successful model identity or known zero usage.
- Every reservation reconciled to the actual captured input, native model and
  reasoning options, stage cap and JSON attempt. Successful captures still
  require the exact verified model and complete visible output. A null actual
  model is admitted only for terminal failed transport calls; a foreign model is
  never admitted.
- Unchanged full originals, original PDF bytes, 18 frozen code identities,
  source fingerprint and phase declaration. The prior run is read, not rewritten.
- A new normal owned run that reuses only currently validated production source
  caches. The native per-run 2m cap and append-only shared 160-send / 4m phase
  limits remain unchanged. Failed and unknown work remains charged.

The recovery preflight is file-only and makes zero provider/DB calls. Live
execution remains an explicit, separately labelled root-agent action. A recovery
result must report its additional and cumulative cost/time independently; it
cannot replace cold timing or turn the original failed attempt into success.

Unit tests use synthetic receipts only and reject in-flight calls, foreign
identity, unrelated semantic failures, missing charges, invented settled usage,
changed request options and relaxed successful-call model checks. These tests
prove recovery admission behavior, not a completed live outline.
