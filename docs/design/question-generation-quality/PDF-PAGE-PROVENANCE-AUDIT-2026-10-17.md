# Offline PDF page provenance audit

Status: implemented **offline diagnostic only**, October 17, 2026. No production
parser, chunks, evidence packet, frozen TypeScript pin, previous ledger or source
receipt was changed. No API, model, network or database call was made.

## What this establishes

`scripts/audit-pdf-page-provenance.py` uses only the Python standard library.
It checks the original PDF byte hash, retained native-text hash and successful
native-parser receipt, exact chunk receipt and existing length-delimited chunk
manifest. A chunk receives a location only if its complete text occurs exactly
once in the native text. Empty, repeated, unmatched or stale inputs remain
unavailable with an explicit reason; the helper never selects a convenient first
match. Input identities are rechecked before writing a new output directory.

Form feeds define physical PDF order, checked against the pinned manifest's
page count. A leading marker preserves an empty first page; consecutive markers
preserve intervening empty pages; a terminal marker does not manufacture another
page. A missing terminal marker is allowed when the count still agrees. The
helper does not independently parse PDF structure: its page-count basis remains
external manifest metadata. A separate read-only `pdfinfo` inspection of all ten
hash-matched originals confirmed that this corpus's declared counts total 599.

Offsets are explicitly **UTF-16 code units**, matching JavaScript `String.slice`.
Raw UTF-8 is decoded without newline conversion, trimming or normalization.
`rawStart`/`rawEnd` and each `pageSpans` range are half-open. `physicalPages`
lists pages with non-whitespace text intersections; `physicalPageRange` can
include blank pages between them. Printed slide labels remain separate from
physical PDF positions.

## Actual ten-file result

The authoritative output is
`audit-results/pdf-page-provenance-2026-10-17/results.json`; detailed counterexample
records are in `counterexamples.json`. Both bind the original receipts. No new
parsing, indexing, generation, repair or adoption occurred.

| Observation | Count |
| --- | ---: |
| Hash-matched original PDFs | 10 |
| Manifest physical pages / native form feeds | 599 / 599 |
| Unique exact chunk-to-native matches | 671 / 671 |
| Unavailable locations in this corpus | 0 |
| Chunks spanning multiple physical pages | 439 |
| Counterexamples to `chunkIndex + 1` as a single physical page | 653 |
| Incorrect start pages under a cumulative prior-chunk form-feed counter | 344 |
| Form-feed occurrences inside overlapping chunks | 605 |
| Distinct original form-feed positions retained inside chunks | 589 |
| Duplicate marker occurrences due to overlap | 16 |
| Original markers absent from chunk text | 10 terminal markers, one per PDF |

These are counterexamples to naive locator algorithms, **not 653 proven bad
product citations**. All 599 pages have some mapped text; that can be a header
or footer and does not establish instructional or visual coverage.

Chapter 10 physical page 9 intersects chunk indices 20–30, rather than chunk 8.
Its printed footer is 155. The existing Chapter 2 continuity figure independently
pins physical page 5 and its render command; chunk indices 5 and 6 both map to
that page. Those explicit image receipts are stronger page locators than a chunk
ordinal. This audit makes no judgment about the chart's meaning or numbers.

## Current production limitation and reusable invariant

The PDF parser preserves native stdout, including form feeds, but `parseFile`
returns a string. The parser policy records the routing version, not which
fallback actually succeeded. Chunking stores source ID and LangChain line ranges;
overlap and trimming mean those chunks are not physical pages. Ingestion persists
the chunk metadata, but `partitionChunk` in `generation-evidence.service.ts`
publishes only chunk index and chunk-local offsets. `EvidencePassage` has no
physical-page field, and `parsingProvenance` remains `unrecorded`. The current
`sourceTextHash` hashes overlapping chunks, not the original raw parse or PDF.

The reusable invariant is:

> Every claimed physical-page range must bind exact original PDF bytes, the actual
> parse receipt/raw text, an explicit offset unit and a verified page map. Carry
> that locator through chunk, passage and citation-span boundaries. Missing or
> ambiguous provenance stays unknown; chunk ordinals never supply page numbers.

A future production change should add provenance without changing source text or
silently rewriting historical packets. It must handle fallback text without page
markers, repeated headers, Unicode, blank pages, cross-page spans and stale PDF
hashes. Existing evidence tests seed synthetic `page: index + 1` metadata; they
test hashing, not actual physical-page fidelity. A valid location still does not
prove quote entailment, chart geometry, readable formulas or question quality.

## Reproduce without services

```bash
python3 -B -m unittest discover -s tests/offline -p 'test_pdf_page_provenance.py' -v

python3 -B scripts/audit-pdf-page-provenance.py \
  --manifest audit-results/quality-lab-2026-10-16-phase-two/upload-index/corpus-fixture.json \
  --parser-receipt audit-results/quality-lab-2026-10-16-phase-two/pdf-text-first-policy-acceptance/results.json \
  --raw-dir audit-results/quality-lab-2026-10-16-phase-two/pdf-text-first-policy-acceptance \
  --chunk-dir audit-results/quality-lab-2026-10-16-phase-two/pdf-text-first-policy-acceptance \
  --raw-pattern 'chapter-{chapter:02d}.public-facade.txt' \
  --chunk-pattern 'chapter-{chapter:02d}.chunks.json' \
  --output NEW_OUTPUT_DIRECTORY
```

Nineteen standard-library tests passed: marker boundaries, overlap, unique and
repeated text, empty/missing chunks, CRLF/Unicode offsets, stale PDF/raw/chunk
identities, fallback rejection, manifest binding, CLI output and overwrite
refusal. They do not test deployed storage or semantic source judgments. The
machine check receipt pins the helper, tests and actual audit output separately.
