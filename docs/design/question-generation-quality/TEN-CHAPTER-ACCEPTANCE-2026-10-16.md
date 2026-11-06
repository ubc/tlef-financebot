# Ten-chapter authoring acceptance — October 16, 2026

This is an engineering and public-source experiment. It does not establish
teacher acceptance, complete pedagogical coverage or improved saved-question
yield. The full ten-chapter cold outline stopped on two provider/transport
failures after retaining validated extraction for 552 of 671 original sections.
No final Topic/LO draft was returned. A separately labelled cache-assisted
attempt completed all 671 extractions and five organization packs, but stopped
later on repeated review-source alias errors; it also returned no applicable
final outline.

## Actual upload and indexing

The new `http-upload-real-index` fixture contains ten complete finance PDFs,
599 pages and 671 original chunks. Its exact PDF bytes were sent through the
real multipart endpoint, Multer, course guards and Mongo upload/material/run
services. Actual ingestion used the production parser, chunker, local FastEmbed
and a new owned-course Qdrant collection. Every material's point count equals
its published original-chunk count; all ten indexed readiness receipts pass.

The ephemeral test app supplies a synthetic request identity. SAML and automatic
Agenda dispatch are not exercised: enqueue is recorded and ingestion is called
explicitly. Advisory classification is deliberately blocked and recorded as a
warning. There are zero LLM provider or forbidden network/component attempts.
Canonical files and owned diagnostic records remain available for inspection.

The 34 retained HTTP observations include:

- Signed-out and foreign-course denials.
- Idempotent intended-file preparation and conflicting-manifest rejection.
- Missing one of ten actual PDFs: all ten intended names remain accounted for;
  none are silently indexed or excluded. Retrying the same receipt admits ten.
- A labelled synthetic stream over the real 50 MiB file limit is rejected.
- A deliberately injected third-material insert failure leaves two committed
  materials. Retry reuses both and creates the remaining eight.
- Admission alone does not satisfy source readiness. Each actual indexing step
  advances the receipt; only the complete ten-file index is ready.

The serial fixture took 225.417 seconds, including 223.131 seconds for ten
ingestion calls. This includes parsing, embeddings, Qdrant and persistence; it
is not a measurement of normal concurrent Agenda throughput.

Receipts: `audit-results/quality-lab-2026-10-16-phase-two/upload-index/`.

## A final-merge grounding gap and its repair

Large outlines first produce bounded source-backed packs, then organize those
drafts into final Topics/LOs. The organization input can contain generated pack
summaries rather than full originals. Valid evidence IDs alone therefore did
not establish that the final LO wording stayed within the source.

`structure-outline-grounding.ts` now adds a final original-source review on this
large organized path. It resolves each point's primary and supporting passage
identities to complete original sections, retaining every required quote group.
It does not resend unrelated partitions of a long chunk. Actual rendered input
and sixteen LOs bound each batch; an individually oversized capability fails
instead of losing source context.

Each reviewed LO is bound to its topic/name, evidence/material identities, full
source-content hash and original-source aliases. A positive verdict must cite
its own originals and explicitly identify the assigned learning points it
actually covers. Unrelated assigned points are not automatically credited as
mapped. Unsupported or uncertain wording stays outside the selectable draft;
uncovered points remain gaps. Shared evidence may still be covered by another
admitted LO, so withholding wording does not necessarily unmap every shared ID.

Partial findings, all-withheld findings and bounded schema-repair failures are
persisted before admission. The existing Course Structure UI shows these
findings and their reasons even on failed runs. A failed streamed draft is
hidden and cannot be applied. Exact source fingerprints are checked before
every review send and after the review. There is at most one schema/identity
correction per review batch; underlying portable JSON corrections are also
charged to existing budgets.

Small direct-synthesis outlines retain their existing original-evidence path.
The new review is a model judgment, not a proof of finance truth or a teacher
calibration result. Uncertain semantic findings are withheld rather than
automatically rewritten to force a positive result.

## Earlier verification checkpoint

The integrated current-source run passed 197 Jest suites / 2,635 tests, including
the new offline recovery and held-out harness checks. The earlier 2,611-test
grounding checkpoint remains separately retained. This
includes 27 pure grounding tests and 48 structure-service tests, not additional
denominators to add to 2,635. Build, typecheck and lint passed. The initial full
attempt retained a newly introduced script typing failure and a sandbox
Supertest listen denial; the corrected, loopback-enabled recheck is separate.

Ten intercepted browser cases passed. Three of those cases were repeated to
capture six desktop/mobile screenshots; these are not thirteen unique cases.
They cover retained partial/all-withheld diagnostics, source links, exact quote
groups, Apply isolation, mobile width and scoped accessibility. They do not
exercise live SAML or paid generation. The English evidence book passes desktop
and mobile JavaScript, overflow, WCAG A/AA and local-link checks.

Authoritative checks at that earlier checkpoint:
`audit-results/quality-lab-2026-10-16-phase-two/verification.json`.

## Verification after review v2 and the parser change

The later integrated checkpoint passed 203 suites / 2,727 tests. Build,
typecheck and scoped lint passed. Its 130 focused tests overlap this full-suite
denominator. Fourteen intercepted production-UI cases passed, including
source-supported objectives with advisory placement issues, historical v1
behavior, incomplete-review Apply isolation, and desktop/mobile display checks.
These tests cover engineering behavior; they do not establish a full live v2
outline, teacher acceptance or a higher saved-question yield. New diagnostic
runner tests added after discovery of that full suite remain separately scoped.

Receipt: `audit-results/quality-lab-2026-10-16-phase-two/outline-v2-verification.json`.

## Measured parser bottleneck and implemented text-PDF policy

A serial native `pdftotext -layout` pass over the same ten PDFs took 2.312 seconds
and reproduced all 671 stored chunks byte for byte, with identical manifest
hashes/counts. Original raw parsed bytes were not retained during ingestion, so
that ten-file claim concerns stored chunks and character counts.

Two additional actual comparisons ran the unchanged toolkit-first parsing code
against the same files. Chapter 2 took 15.316 seconds versus native-only 0.290;
Chapter 3 took 15.139 seconds versus 0.121. Both recorded an actual 15-second
primary timeout, and both raw text and resulting chunks matched exactly.

This is a local filesystem-warm parsing experiment, not an end-to-end upload or
model-generation speedup. It does not prove all original ten ingestion calls
timed out. Production parsing order remained unchanged throughout the frozen
cold and cache-recovery attempts. After both became terminal, PDF text/default
requests were wired to native-first parsing with bounded toolkit fallback.
Markdown and non-PDF routing retain their preceding behavior. Only future
ingestion uses the new parser-version identifier; no stored manifest is rewritten.

The actual post-wiring public-facade acceptance read the same ten complete PDFs:
ten native calls, zero toolkit parses, 599 pages and 671 byte-identical chunks.
Every returned text matched captured native stdout and the separately retained
baseline native bytes; all ten manifest hashes/counts matched. Parser-only time
was 2,298.32 ms, with 8.89 ms chunking. This is not a new upload/embedding/DB
throughput measurement. The runner observed zero network/provider/DB attempts
and blocked configured runtime imports. Thirty-nine focused tests cover the
facade, pure timeout/fallback helper and acceptance controls.

Receipt: `audit-results/quality-lab-2026-10-16-phase-two/pdf-parser-audit/`.
Post-wiring receipt: `pdf-text-first-policy-acceptance/` in the same phase folder.

## Cold outline, cache follow-up and cost bounds

The separate prospective phase declares 160 sends / 4,000,000 conservative
reservation units. The immutable earlier phase remains 64 sends / 1,799,920
units. Neither ledger is reset. Production's conservative per-run 2,000,000-unit
bound remains active, and extraction/synthesis/review caps are 12k/24k/6k.
Reservations are UTF-8 admission units plus output allowances, not billed tokens
or money. Actual visible sends, input/output, model identities, raw outputs and
errors are retained separately. Hidden physical retries remain unknown.

The exact first-pass extraction preflight is 48 sends / 1,371,670 units. It is
not a guarantee that retries, synthesis, organization and final source review
will fit. The live cold run uses the actual newly uploaded/indexed course and
normal durable run/cache services. No final result, Topic/LO apply, question
adoption or publication has been claimed at this checkpoint.

The terminal cold attempt took 4,441.173 seconds (about 74 minutes), with 64
observed sends and 1,575,756 conservative reservation units. Its native budget
record has zero rejected sends. Two extraction calls ended in provider failure:
one after 1,244.203 seconds with partial visible text, the other after 3,095.803
seconds with no visible text. Their usage is unknown and their reservations
remain charged. The known reported total is 169,878 input + 231,740 output
tokens across 62 reported calls, not a complete billed total for all 64 sends.
There are no pending provider calls in the terminal receipt. All eighteen frozen
working-code and snapshot identities still match.

A file-only audit reran the exact frozen production extraction validator over
the captured outputs and their complete original inputs. It found 552 distinct
validated sections, 34 sections with an invalid observation and 33 subsequently
recovered sections. Across repeated row observations, 39 invalid rows contained
wrong source-local passage IDs, conflicting passage dispositions or fields over
the 500-character schema limit. One section's correction was interrupted by
the provider failure. These are structural corrections, not independently
verified semantic improvements or final LO coverage. At the cold stop, 119
sections remained incomplete and final synthesis/source review had not run.
The separate cache-assisted attempt below subsequently completed extraction;
that later evidence does not change the failed cold result.

Exact audit: `extraction-structural-audit-terminal.json` in the phase-two receipt
folder. The audit performs zero provider or database calls. Its eight tests and
the eighteen native-PDF helper tests pass separately; they were added after the
2,635-test full-suite checkpoint and must not be represented as part of it.

Keep the cold attempt as a true failed cold result. The prepared budget-only
recovery must refuse this transport failure. A separately audited, explicitly
transport-aware normal-run recovery may reuse only current verified
source/pack caches under the remaining same phase ledger. It must not substitute
an old final output, trim chapters or raise a live limit. Independent held-out
model comparisons and a complete saved-question pipeline retest remain required.

The earlier 1/6 saved-Draft result remains the latest full paid batch result.
One retained CAPM correction became eligible under independent rechecks but
saved/adopted zero questions. This experiment has not yet established that the
original generation-quality concerns are resolved.

## Cache-assisted attempt and the next review repair

The distinct transport recovery took 639.467 seconds and 26 observed sends. It
reused 552 sections, extracted the remaining 119, and completed five bounded
organization packs. Its final merge proposed 111 LOs. Only 33 had completed
review before the attempt stopped: 29 supported and four withheld. No applicable
outline, saved question, adoption or teacher acceptance follows from that result.

The terminal error was `structure-grounding-review-source`, not a budget or
transport failure. The six-objective review for L34-L39 returned foreign S133
and S136 references on L38, which allowed only S139-S145. The whole-batch retry
removed S133 but still returned foreign S136, so the strict validator stopped.
The five source-alias-valid siblings were unnecessarily requested again. The
native receipt retained 1,828,452 conservative units with zero rejected/pending
sends. All 26 calls reported usage: 335,922 input and 122,761 output tokens.

A separate actual finding also exposed a protocol defect: L14's reason confirmed
source support but rejected the LO for its topic placement. New review protocol
v2 separates `sourceStatus/sourceReason` from advisory `topicFit/topicReason`.
Only source status determines admission. Exact original/wording/point bindings
remain mandatory. V1 findings stay historical; their prose is never reinterpreted
as a new verdict.

The service now persists individually valid rows and sends only known invalid
objective IDs through its one bounded correction, including exact allowed-source
and evidence lists. Foreign response identities still stop the run; unresolved
or incomplete reviews still cannot authorize Apply. Grouping warnings are shown
separately. A focused real-API review probe is being prepared; these engineering
changes are not yet a completed full v2 outline result.

The first source-review completion also exhausted its 6k allowance without visible
JSON, then succeeded on the portable JSON retry. This observed reasoning/output
budget interaction remains explicit; the live limits were not raised.

Exact failure audit: `outline-recovery-failure-audit.json` in the phase folder.
