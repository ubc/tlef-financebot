# Independent physical-page text observations

This phase makes missing or sparse native PDF text visible independently of
mapped passages and learning objectives. It does not recover visual content,
interpret charts, admit OCR text as evidence, or establish better question yield.
The production change has pure, mocked-service and intercepted-browser checks;
the ten-file acceptance below is a file-only replay, not a new live ingest.

## Why passage accounting was insufficient

The retained Chapter 10 physical page 10 is a raster table, but its native text
contains only 18 non-whitespace UTF-16 code units of footer material. Chunk 30
also contains page 11's dividend formulas. Its passage `C31.S1.P1` can therefore
legitimately map to `E785` while the preceding table remains absent from the
text supplied to outline extraction. A valid chunk location or mapped passage
does not account for the missing physical-page content.

The existing source inventory and UI already distinguish parsed links from
teaching coverage. The missing capability was an independent page observation
that survives a neighboring passage becoming mapped. A rule based only on image
presence would also miss vector charts and misclassify decorative or readable
pages. This implementation performs no chart, table or footer classification.

## Stored native-text contract

The pure `pdf-page-text-observations.ts` helper builds
`native-page-text-observations-v1` records only from exact native text and a
verified parse receipt. It checks PDF/raw-text identities, raw byte and UTF-16
lengths, the independently counted page map, and rebuilt form-feed boundaries.
Each ordered physical page retains its exact raw range, native-text SHA-256,
non-whitespace count and one text-volume state:

| State | Fixed rule |
| --- | --- |
| `blank` | Zero non-whitespace UTF-16 code units |
| `sparse` | Between 1 and 119 non-whitespace UTF-16 code units |
| `present` | At least 120 non-whitespace UTF-16 code units |

The 120-unit threshold is part of the versioned contract. It is not a reading
quality score, OCR confidence, visual-content detector or pedagogical judgment.
A short title may be valid; a page with extensive axis labels may still omit
the plotted relationships. Every summary therefore retains
`interpretation: 'unknown'` and `teachingCoverage: 'not-assessed'`.

Blank pages remain in the denominator. A canonical aggregate digest binds all
ordered rows and identities. The pure validator checks the published record's
shape, digest and relation to the current receipt without filesystem or model
work inside authoring transactions. It does not independently re-extract raw
text during validation; publication must use the builder and the existing
immutable private sidecar. The additive feature is bounded to 20,000 pages and
50 MiB of raw text; the historical locator's separate limits are unchanged.

New ingestion preparation may add `pageTextObservations` to the private
`materialSourceProvenance` record. It publishes with the existing sidecar and
chunk/manifest fence. Native text, chunk contents and their existing hashes
remain unchanged. Observations that are unavailable or would exceed the
existing 8 MiB sidecar bound are omitted, rather than making an otherwise valid
text ingest fail. Safe workspace projection returns unavailable metadata with
no invented zero counts. Raw artifact paths remain private.

There is no backfill. Existing ready materials, sidecars and historical runs
are not silently rewritten. Upload deduplication also retains its existing
behavior; this phase does not make reuploading identical active bytes a
migration mechanism.

## Outline and UI integration

Fresh server-created durable outline requests explicitly store
`pageTextObservationProtocol: 'native-page-text-observations-v1'`. This is an
opt-in stored server contract, not a new browser-controlled permission. An
absent selector on an old retry/checkpoint remains absent; unknown explicit
selectors are refused. The legacy suggestion entry point also selects the new
metadata contract for fresh durable work.

For selected PDF materials, the corpus loader projects validated current private
sidecars into the additive `coverage.pageTextObservations` receipt:

```text
version: pdf-page-text-obligations-v1
materials: [{ materialId, materialName, provenanceId?, observation }]
```

An available observation includes PDF/raw/page-map hashes, the observation
digest, fixed threshold, separate total/blank/sparse/present counts, and
exhaustive consecutive state ranges. Historical, invalid or unavailable records
carry a reason, without fabricated counts or ranges. These are observations of
the recorded run, not an assertion that the original is still available today.

This metadata does not enter model prompts, alter extraction passage IDs,
change the corpus fingerprint, invalidate the existing extraction cache, add
learning points, change source-support verdicts, or clear ordinary passage gaps.
Conversely, a mapped passage cannot clear a blank or sparse physical-page
observation. Existing raw/source/chunk identities and historical prompt bytes
remain intact.

The compiled Course Structure source-review UI shows a separate physical-page
region with file/state/search filters and 10/25/50 pagination. It retains all
recorded pages while keeping the DOM bounded. Per-file counts remain distinct
from extracted/mapped learning-point and passage counts. Historical absence is
unavailable; malformed ranges/counts and ambiguous source identities do not
produce trusted page rows. Valid past-run counts can remain visible when a
provenance pin is unavailable, but the page action is disabled.

Original-page actions use the existing authorized source endpoint with
`?provenanceId=...#page=N`. The server rechecks the current provenance pin and
original PDF bytes on access. Rendering a link does not itself execute that
check or establish interpretation. A stale, changed, removed or foreign source
can be refused when opened.

## Evidence and exact scope

The authoritative local receipts are retained under
`audit-results/pdf-page-obligations-2026-10-17/`.

| Check | Result and limit |
| --- | --- |
| Production pure helper over the ten retained native receipts | 599 pages: 0 blank, 111 sparse, 488 present; all 599 interpretations unknown and teaching coverage unassessed |
| Measured replay loop | 106 ms locally; not upload, parsing, embedding, indexing or live outline latency |
| Actual raster-table control | Chapter 10 physical page 10 remains sparse at 18 non-whitespace units |
| Final focused/integrated units | 734/734 in 22 suites; includes the 44 helper cases and the positive mapped-but-sparse service control |
| New compiled UI checks | 17 intercepted cases, including 599 synthetic page records, malformed receipts, provenance links, pagination and scoped desktop/mobile axe |
| Existing source-review UI regression | 19 expected, 0 unexpected; intercepted APIs on a static server |

The synthetic 599-page UI fixture has deliberately controlled text states; its
counts are not the observed ten-file distribution. Unit runs overlap and must
not be added together as independent evidence. The initial static-server bind
failure occurred before browser tests and remains retained. The earlier
733-test combined report remains beside the final 734-test report; the added
available-sidecar service case explains the changed denominator.

Receipt pins:

| Receipt | SHA-256 |
| --- | --- |
| `ten-file-replay/results.json` | `67a81bb9c7251ebdc360dc463235cf44d457b81780ee65504e323e45030333b5` |
| `combined-tests-final.json` | `fa99845243a9518692f6eb3abaace687fb61c7772986144d88b20ecd9b810bcb` |
| `legacy-browser-regression.json` | `0ef0a4518807c1c798904168b6952b7c13b36f253310631e47a2552f59656066` |
| `r6-preservation.json` | `cc93221f336f13182f8c3bed702b4fd44dc6dab182fed03d2c779052dc5faf9b` |

Executable checks are in `tests/unit/pdf-page-text-observations.test.ts`, the
related material/structure service suites, and
`tests/e2e/structure-page-text-observations.spec.ts`. The static-only browser
configuration is `playwright.structure-page-text-observations.config.ts`.
For example, from the repository root:

```sh
npx jest --runInBand tests/unit/pdf-page-text-observations.test.ts
npm run build:client
npx playwright test --config playwright.structure-page-text-observations.config.ts --output=test-results/page-text-reproduction
```

The exact final 22-suite command is retained in `combined-final-command.json`.
`replay-ten-native.cjs` preserves the file-only ten-source reproduction code and
input joins. Its original destination is exclusive and already populated; use
a fresh owned destination when preparing a repeat rather than overwriting the
retained observation. These local corpus/artifact paths are not CI prerequisites
for the synthetic unit/browser fixtures. Typecheck and scoped ESLint also passed.

## Separate local OCR diagnostic

One local English Tesseract 5.5.1 call inspected the already rendered raster-table
control, outside production ingestion. It took 1,081 ms and produced 161 words;
the native page retained only three footer words. Of 21 specified cell boxes,
18 matched the exact expected literal strings. Three preserved mismatches
contained additional border glyphs, including `15.03% |` and `|$1,024,195`.
No normalization changed those observations into passes.

This was one local OCR-model invocation with no paid provider/network call,
not zero computational model work. It did not transcribe the whole table,
validate general OCR accuracy, establish header/row ownership, admit derived
text as original evidence, create a Topic/LO/question, or measure question yield.
High word confidence is not semantic correctness. A production OCR adapter,
bounded admission policy and layout/source validation remain future work.

The original diagnostic and executable cell evaluation are retained under
`audit-results/pdf-local-ocr-2026-10-17/`:

| Receipt | SHA-256 |
| --- | --- |
| `results.json` | `939ea2408cdbfb7f1b7acdaab5762f08713615678084c421a9ee14ccf6f4fc1a` |
| `cell-results.json` | `e2b034f153b951f75ec8c2499ab85fe146c3c2ad4f64d33ec6ebc508eb950d6c` |

## Declaration status and remaining work

Before this phase edited production TypeScript, all 260 current R6 code files
and their archived copies were verified and retained. R6 is now historical and
unexecuted; it cannot authorize a probe against these changed sources. A fresh
prospective declaration is required, and the explicit paid/API approval is
still pending. This phase made no new provider-generation, ingestion or DB
acceptance claim, saved/adopted no candidate, and applied no outline.

The separately identified Bank/Queue recency-selection gap remains pending
work. Physical-page observations change neither Bank retrieval nor semantic
duplicate detection. They also do not establish that all source omissions,
repetitions, requested difficulty failures, review time or token-cost concerns
are solved. Recovering and validating missing content, measuring generation
outcomes, and obtaining teacher calibration remain separate steps.
