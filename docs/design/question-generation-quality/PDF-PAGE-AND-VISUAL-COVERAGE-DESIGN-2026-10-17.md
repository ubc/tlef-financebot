# PDF page provenance and bounded visual coverage

Status: **historical incremental production design**, October 17, 2026. The
starting-code descriptions below predate the subsequently implemented
[production PDF provenance](PDF-PROVENANCE-IMPLEMENTATION-2026-10-17.md).
Visual/OCR interpretation remains unimplemented. The later
[visual source obligations audit](VISUAL-SOURCE-OBLIGATIONS-2026-10-17.md)
adds file-only diagnostic inspection, not a vision or generation result.
This document itself changes no declarations, ledgers or historical results.

## Decision

First preserve an exact route from a source quote to the uploaded PDF page.
Then add a separate, explicitly bounded workflow for visual information that
the text extractor cannot supply. Keep text indexing, physical location,
visual interpretation and teaching coverage as distinct states. An unprocessed
chart must remain visible as a gap; a valid page number cannot fill that gap.

This sequence avoids re-embedding the entire course just to add page links and
avoids sending every page of ten chapters to a vision model. It also makes
visual work inspectable against the original page rather than a generated
summary. V2 authoring remains opt-in and teacher review remains necessary.

## Measured starting point and current code

The [offline provenance audit](PDF-PAGE-PROVENANCE-AUDIT-2026-10-17.md) and its
[machine receipt](../../../audit-results/pdf-page-provenance-2026-10-17/results.json)
bind ten original PDF hashes, retained native text and the existing chunk receipts.

| Measured observation | Consequence |
| --- | --- |
| 599 physical pages; 671/671 chunks have a unique exact native-text match | Exact page spans are recoverable for this retained corpus without a model. This is not a general guarantee for other PDFs. |
| 439 chunks cross physical pages | A chunk needs several page spans, not one guessed page. |
| 653 counterexamples to `chunkIndex + 1`; 344 to cumulative prior-chunk form feeds | Neither algorithm is a page locator. These are not counts of proven bad product citations. |
| 16 repeated marker occurrences from overlap; ten omitted terminal markers | Counting form feeds after chunking loses the original page sequence. |
| All 599 pages have some mapped text | A footer or label can satisfy this; instructional and visual coverage remain unknown. |

The separate [parser acceptance receipt](../../../audit-results/quality-lab-2026-10-16-phase-two/pdf-text-first-policy-acceptance/results.json)
records 2,298.32 ms of native parsing and 8.89 ms of chunking for the same ten
PDFs: ten native successes, zero toolkit parses, all 671 chunk texts unchanged.
This measures parsing/chunking in that acceptance harness, not upload, embedding,
outline review or end-to-end authoring latency.

Current production boundaries:

- `components/genai/document-parsing/index.ts` returns a string. Native text
  preserves stdout, including form feeds; `pdf-text-first.ts` bounds native
  parsing at 60 seconds and toolkit fallback at 15 seconds, with a 50 MiB output
  ceiling. No OCR is provided. A promise timeout cannot cancel arbitrary toolkit
  work. The policy version does not identify which parser actually succeeded.
- `materials.service.ts` stores chunk text/metadata after indexing. A material's
  existing `sourceManifest.sourceTextHash` hashes ordered, length-delimited
  overlapping chunks; it is not a PDF-byte or raw-parse hash. Manual upload
  fingerprints do not cover every import path.
- `generation-evidence.service.ts` exposes original chunk-local ranges, but
  drops chunk metadata when constructing `EvidencePassage`. Packets say
  `parsingProvenance: 'unrecorded'`. `generation-citation-spans.ts` validates
  exact quote groups; it does not return a physical-page address.
- The separate line-boundary repair has a
  [file-only structural receipt](../../../audit-results/source-passage-line-boundaries-2026-10-17-final/results.json):
  384 of 671 sections change, 1,238 passages become 1,292, and the original
  Newfoundland Light & Power table row remains intact. It does not restore
  chart relationships or prove that a model interprets the row correctly.
  Forty-five of 48 batch identities change, including 280 unchanged sections
  sharing changed batches; a local cut is not necessarily a local cache miss.

## 1. Record actual parse success without breaking string callers

Add an internal `parseFileWithReceipt` result and keep `parseFile` as a compatible
string-returning wrapper. The ingest owner uses the richer result. Record the
actual successful engine, not merely the routing policy:

| Receipt field | Required meaning |
| --- | --- |
| `pdfSha256`, byte length | Exact persisted input bytes read by the parser, for manual and Canvas imports alike. |
| `routingPolicy`, output format | Attempt order and requested text/Markdown behavior. |
| `attempts[]` | Native/toolkit engine, binary/package version, bounded options, duration, outcome and bounded failure reason. |
| `successfulEngine` | The attempt whose exact output was retained; absent on total failure. |
| `rawTextSha256`, UTF-8 bytes, UTF-16 length | Exact successful output before trimming, normalization, chunking or OCR. |
| `pageCountReceipt` | Independently obtained physical page count, tool/version/options and result status. |
| `pageMapVersion`, `pageMapHash`, offset unit | The verified boundaries attached to this exact raw text. |

Read/hash the same immutable stored file that is parsed. Recheck its identity
before publication. Do not use an upload name, printed slide number, storage
mtime or Canvas URL as byte identity. Do not store provider credentials or
unbounded stderr in the receipt. Dates and durations are observations, not cache
identity inputs.

Retain raw text in a private, content-addressed artifact with byte length/hash;
store its reference and bounded page metadata in Mongo. Do not place a possible
50 MiB string in one BSON document. Store large page/locator lists in bounded
child records as necessary. Access and deletion remain course-scoped, including
Trash/deletion checks; possession of an artifact hash is not authorization.

The existing parser ceilings remain unchanged initially. Obtain page count with
a bounded, shell-free PDF metadata subprocess; treat tool failure, encrypted
input, count mismatch or resource limits as explicit provenance-unavailable.
The count is not inferred from chunks. PDF processing needs bounded subprocess
lifetime, output, render pixels and worker resources. Do not report a timed-out
toolkit promise as canceled work unless its worker actually terminated.

## 2. Build the page map before overlap and preserve exact offsets

For verified native text, derive physical intervals from its original form feeds
and check their count against the independently retained page count. Preserve
leading/consecutive blank pages. Omit a final empty sentinel only when justified
by the count. A missing final marker can be valid; a mismatch cannot be guessed
away. Use explicit **UTF-16 code-unit, half-open offsets** throughout TypeScript;
hash raw bytes separately. Never normalize CRLF, Unicode, spaces or form feeds
while establishing these positions.

Initially keep all existing chunk text byte-for-byte. Attach a locator only when
the full chunk is a unique exact substring of the pinned raw text. Repeated
headers, empty text and ambiguous matches receive `unavailable` plus a reason.
Do not select the first occurrence or infer a page from LangChain line metadata.
For future chunks that cannot be located uniquely, an offset-aware chunker may
capture its source ranges while constructing identical text. That is a separate
tested change; monotonic guesses or fuzzy matching are not a substitute.
Toolkit fallback text without a verified map remains usable text with unknown
page locations. A directly rendered PDF page can still have its own verified
physical image identity; it must not inherit guessed native-text associations.

A locator must bind:

```text
provenanceId, pdfSha256, rawTextSha256, pageMapHash, chunkTextSha256
rawStart, rawEnd, offsetUnit = utf16-code-units
pageSpans[] = { physicalPage, rawStart, rawEnd, chunkStart, chunkEnd }
status = verified | unavailable; reason when unavailable
```

Keep spans for actual non-whitespace intersections. A displayed first-to-last
page range may contain blank intervening pages; it must not claim text on them.
Printed page/slide labels may be a separately observed annotation, never an
alternative key. Chapter 10 physical page 9, for example, is printed slide 155
and intersects chunk indices 20–30.

Resolve a generation passage's chunk range into these raw/page intersections.
When a citation selects span aliases, carry its actual start/end through the
server's existing exact group resolver. Do not recover the range later by
searching the quote, since the quote may repeat. Nonadjacent groups remain
separate. A later 500-character/line boundary or 700-character citation split
must preserve this mapping just as a 2,000-character evidence passage does.
Splitters should return exact ranges as they create each quote, accounting for
any trimmed prefix/suffix. Searching a trimmed repeated phrase afterward is
insufficient. A valid multi-source proof preserves each original span rather
than manufacturing one contiguous quote across a chunk/page gap.

The instructor can then open the exact physical page alongside the exact source
quote. A page URL must recheck course/material access and source identity; it
must not expose a filesystem path or a public content-addressed bucket.

## 3. Version provenance and source readiness separately

Use additive sidecar records keyed by course, material, ingest run and exact
source identity for the first rollout. Do not inject provenance into historical
`chunk.metadata`: current generation content hashes include that metadata, so
doing so would silently invalidate existing contexts. Do not rewrite old packet
IDs, cached transcripts, final inventories, candidate hashes or published exams.

Keep these states independently visible:

| State | Admission rule |
| --- | --- |
| Text indexed | Existing complete original chunks/vector manifest checks remain authoritative. |
| Page locations verified | Exact input/raw/map/quote identity and all requested span checks pass. |
| Visual observations available | Requested pages/regions have terminal observations with explicit limitations. |
| Requested teaching content supported | Source and task checks cover the necessary premises; instructor acceptance remains separate. |

Missing page metadata alone does not make otherwise valid historical text
evidence unsupported. Historical packets continue to say unrecorded. A request
requiring a verified page link or a visual premise must stop/withhold with the
specific missing capability, instead of claiming it was checked.

Introduce a new evidence schema/explicit opt-in for provenance-aware packets.
It pins `provenanceId` and the visual evidence identities it actually uses;
legacy packet reconstruction ignores sidecars and retains its old hashing
branch. New adoption checks verify text/source currentness as today and verify
the pinned sidecar/image identity when applicable. Model output cannot supply
trusted receipt, page, locator, verification or eligibility fields.
Readiness belongs to each material/span: a mixed packet cannot be labelled
fully page-verified merely because one of its sources has a good page map.

Publish new provenance together with its matching ingest manifest only after
source validation. Keep model/render work outside short course transactions.
Replica/sharded writes use the existing authoring fence; standalone behavior
stays explicitly best effort. Text mutation/reingestion, Trash, deletion and a
superseding active run invalidate access to stale sidecars. Advisory labels
cannot manufacture a new original parse identity. No automatic backfill may
overwrite original chunks or historical assessments.

## 4. Triage visuals locally before considering paid extraction

Create one page inventory from native text/page metadata. Record cues such as
sparse body text, replacement characters, formulas with missing operands,
image/vector presence, or an existing `visual-review` passage disposition.
These cues prioritize inspection; they do not prove that a page is a chart,
unreadable, instructional or out of scope. A page containing a complete table
row should first use that row and the line-boundary fix, not pay for vision.

Start with deterministic rendering of only the exact pages needed by an
instructor request or unresolved required premise. Render from the pinned PDF,
using explicit page index, renderer/version, resolution, rotation, colorspace
and crop. Retain the full-page image as context even when a bounded crop is
used. A crop coordinate is in a stated page coordinate system. Cache both the
render recipe and actual image bytes/hash; the same recipe with different
bytes is a conflict, not a silent overwrite.

A raster image, OCR transcript, vector rectangle count and model observation
are different evidence objects. Geometry alone does not establish a plotted
series, its legend, ordering, numerical values or a causal relationship. Text
labels alone cannot justify invented chart values. Ordinary PDF embedded text
and local table structure should remain the cheaper source whenever sufficient.

### Proposed first visual extraction policy

These are **initial experiment controls, not measured performance or shipped
defaults**:

- Automatic provider calls remain off. Explicit opt-in selects at most six
  unresolved pages per run and at most two from one file. Additional pages are
  queued as unprocessed; they do not disappear from the denominator.
- Render at most 12 pages locally per run, with concurrency two, a 15-second
  subprocess deadline per page, an initial 160 DPI / 4-megapixel ceiling and
  8 MiB encoded-image ceiling. Oversized pages are downscaled once under a
  recorded recipe or remain unavailable. Verify deployment resource ceilings
  before adopting these proposed values.
- Paid extraction has at most eight observed SDK sends in total, including
  every JSON correction/retry, concurrency at most two, at most one correction
  for an individual page and at most two corrections for the run. No automatic
  semantic retry, whole-document vision or hidden SDK retry is allowed.
- Admit each send prospectively against a 200,000-unit conservative run budget,
  at most 12,000 text input units and 2,000 output tokens per send, plus a
  model/dimension-specific image reservation. Unknown image token accounting
  blocks dispatch; it is not counted as zero. The image estimator, multimodal
  transport support and usable context/output limits must be verified for the
  configured provider/model before enabling this path.
- Use a whole-call deadline covering SDK and streamed body reads, proposed at
  60 seconds for this experiment. Record input/output usage, nullable image
  usage, actual image dimensions, cache hits and deadlines separately. Failed
  or unknown work retains its reservation. A file/run can finish partially
  without pretending every page was processed.

The observation schema should separate verbatim visible strings, recognized
table cells/formulas, claimed relationships, required conditions and explicit
uncertainty. Bind each to a page/image hash and region; require units, axes,
legend/series identity and readable labels for numerical claims. No generic
confidence score can replace those prerequisites.

Do not pass generated visual prose to the existing exact-original-text quote
validator as if it were native text. A future visual evidence type must identify
the raster original and the interpretation separately. Initially observations
are instructor-reviewable aids. Newly transcribed numerical/chart premises
require instructor confirmation before they support automatic numerical
question admission. Native corroborated text can still use existing text gates.
Later automatic visual admission requires its own calibrated acceptance set;
two model opinions are not deterministic proof.

If the required number, legend, relationship or premise remains unreadable,
return `visual-unknown` with the exact affected page/region and reason. Withhold
the dependent task. A source-supported conceptual fallback is an explicit
different deliverable, not fulfillment of a request for a numerical chart
question. Report both safety and requested-task fulfillment.

## 5. Cache narrowly and keep costs attributable

| Cache | Identity and reuse boundary |
| --- | --- |
| Parse/page map | Course-authorized PDF bytes, actual parser/version/options, output format/raw hash, page-count receipt and page-map schema. No cross-course access from a hash hit. |
| Chunk/passage locator | Above identity plus exact chunk hash, chunker and passage policy/ranges. Revalidate the exact substring on read. |
| Page/crop render | PDF hash, physical page, full render/crop recipe and output image hash. Rotation/crop/DPI changes create a distinct object. |
| OCR/visual observation | Render hash, exact text context/prompt/schema, model/provider/reasoning configuration and observation policy. Failed/partial responses are retained diagnostics, not successful hits. |
| Source extraction/outline | Retain existing exact prompt/source/model cache rules. If visual observations change the model-facing evidence, the rendered prompt and identity must change. |

A metadata-only page locator should not cause fresh embeddings or paid source
extraction when original model-facing text is identical. Exact changed prompts
must miss even if the edit looks cosmetic. Reuse valid siblings after failures,
but preserve batch-level cache effects: the measured line-boundary repair shows
why 384 changed sections can affect 664 sections' batch identities. Consider
independently keyed per-section extraction only as a later measured optimization.

Admin diagnostics should distinguish text parsing, local rendering, OCR,
vision, source extraction, generation and review. Display known provider
input/output subtotals plus unknown-call counts, image-usage availability,
conservative reservations and embedding costs separately. A cache hit has zero
new dispatch, not zero historical cost. Do not convert partial usage into an
apparently complete total or double-count reasoning tokens already in output.

## 6. Incremental verification and acceptance

Every step gets a fresh declaration/output directory. Preserve previous raw
inputs/outputs, source hashes and model results. Do not repurpose the currently
approval-blocked retained-candidate source-interpretation declaration for vision.
Any later paid page experiment needs its own reviewable inputs and bounded
authorization. The following experiments are proposed, not executed here.

1. **Parser/locator only, zero provider calls.** Test native success, toolkit
   fallback, both failures, timeout/cancellation distinction, missing Poppler,
   empty/scanned/encrypted PDFs, corrupt page counts, leading/consecutive/terminal
   markers, CRLF, Unicode, repeated text and changed bytes. Preserve string API
   results. Run the same ten-file fixture and publish PDF/raw/chunk hashes,
   verified/unavailable spans and actual-success receipts. Require 671 unchanged
   chunk texts for this fixture, no false page assignment, and no existing
   manifest/indexing changes. Measure additional provenance time separately;
   a proposed initial target is under 10% of the retained parser baseline on
   the same machine, with cold/warm repeats before treating it as an SLO.
2. **End-to-end citation addresses, zero provider calls.** Through real evidence
   construction and alias/group resolution, check exact page intersections for
   single-page, cross-page, overlap and repeated-quote cases. Verify legacy
   packet/candidate reconstruction byte-for-byte and explicit unknown for absent
   provenance. Test currentness, permissions, Trash, stale sources and atomic
   publication without calling embeddings or a model. Page support does not
   alter the existing semantic verdict.
3. **Local visual triage/rendering, zero provider calls.** Freeze page labels
   before examining model outcomes. Include Chapter 10 physical page 9, the
   intact table row on physical page 32, text-only controls, scanned/rotated,
   low-resolution and genuinely unreadable pages. Retain render commands,
   hashes, bounding systems, time/memory and all unprocessed pages. Human labels
   distinguish readable text, numerical tables, charts, decorative images and
   unknowns. Measure cue misses as well as unnecessary render work.
4. **Bounded paired visual extraction, only after approval.** Use a small fixed
   page set with independently recorded source answers/required conditions.
   Compare native-text-only and native-plus-visual evidence under the same
   question/task instructions. Keep extraction mistakes, fabricated values,
   wrong table-row associations, unsupported exclusivity, unfulfilled numerical
   requests and transport failures separate. Preserve negative/unreadable pages
   and exact raw I/O; do not select only pages that recover successfully.
5. **Ten-chapter and instructor validation.** Add only newly needed pages on a
   warm run; repeat with a changed file/page to verify narrow invalidation.
   Report files/pages seen, suspect, rendered, processed, unknown, required but
   unsupported, and instructor-confirmed. For generated questions report requested
   slots, saved Drafts, independently valid/request-aligned questions, duplicates,
   review time and known/unknown cost. A larger saved count alone is not success.

Acceptance requires no invented physical-page locations, no substitution of
visual model prose for an exact native quote, no dependent question admitted
with a necessary unreadable premise, and bounded observable work. It does not
require pretending every chart is recoverable. Teacher-calibrated quality,
fewer duplicates and reduced review time need independent measurements beyond
these structural and source-location tests.

## Implementation order and open assumptions

Deliver parser receipts/page-map sidecars first; then expose page locators
through a versioned evidence path and original-page viewer. Keep visual triage
and local renders as the next zero-call slice. Implement paid visual extraction
only after storage/permissions, image accounting, multimodal transport and
acceptance controls are verified. Enable any new visual admission rules only
after instructor calibration.

The current receipts support exact text locations for this corpus. They do not
establish suitable vision model choice, OCR quality, render resource ceilings,
visual error rates, instructor review savings or a production latency target.
Those are explicit deployment/experiment decisions. In particular, 599 pages
with mapped text and 620/999 mapped outline points are different denominators;
neither establishes complete pedagogical or visual coverage.
