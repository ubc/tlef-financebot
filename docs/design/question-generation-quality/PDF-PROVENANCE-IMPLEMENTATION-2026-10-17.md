# Production PDF provenance implementation

Status: implemented and verified within the explicit local scopes below.
This follows the offline page audit. It does not implement OCR/vision, resolve all 379 learning-point gaps,
or establish improved question yield. No paid model phase is authorized by it.

## Intended behavior

1. PDF ingestion retains an actual parser receipt and independently checked page
   map without changing the successful native text, chunk text, metadata or
   existing sourceTextHash. Metadata failure preserves valid text with explicit
   unknown page locations. Toolkit success cannot claim a native page map.
2. A private sidecar retains the raw text artifact and parse receipt. Safe
   chunk locators live outside chunk.metadata. Publication of the matching
   manifest pointer, chunks and sidecar uses the existing course fence after
   external work. Trash, retries, supersession and permanent deletion remain safe.
   A required versioned tuple list binds each chunk index, full text hash and
   canonical full provenance hash. Its own digest, count and 8 MiB BSON bound are
   checked without filesystem reads in authoring transactions. Chunk-only
   corruption cannot silently shift a locator to another position on the page.
3. New v2 authoring runs explicitly pin the provenance-aware evidence schema.
   Historical runs, same-UUID requests, exact retries and old packets retain
   their old branch. Evidence expansion preserves its parent's schema.
4. Selected citation spans project their exact UTF-16 ranges through chunk/raw
   offsets to physical pages. All location fields are server-computed; repeated
   or unavailable ranges stay unknown. Valid locations never substitute for
   source entailment, missing chart values or teacher approval.
5. Instructors can inspect the parser/page receipt and open the original PDF at
   a verified physical page from the existing material workspace.

## Ownership and interfaces

- Parser component: additive parseFileWithReceipt and pure pdf-provenance helpers.
- Materials: private materialSourceProvenance records, raw artifacts, additive
  MaterialChunk.sourceProvenance and sourceManifest.provenanceId, workspace DTO,
  course-deletion cleanup and scoped access.
- Evidence/citations: explicit sourceProvenance selector, versioned packet
  construction/currentness/expansion and exact citation-range projection.
- Pipeline/UI: durable selector creation, retries/worker/regeneration compatibility,
  client DTOs, existing material inspector and integration evidence.
- Shared contract: server/src/types/source-provenance.ts. No private file path
  enters material, workspace, evidence, question or student DTOs.

## Verification required before claiming implementation

- Unit fixtures: native/toolkit fallback, metadata failures, source changes,
  bounds, Unicode/CRLF, blank pages, repeated/ambiguous chunks, multi-page ranges,
  tampered location payloads, old packet hashes, exact retries, sidecar cleanup,
  Trash/supersession/deletion and course authorization.
- The same ten original PDF files: compare text/chunk bytes against retained
   successful parser receipts; verify 599 physical pages and 671 exact chunks;
  report measured receipt overhead separately from model/end-to-end latency.
- An isolated local publication/read/currentness path with denied model,
  embedding, vector and job boundaries where appropriate. Mocked boundaries
  and synthetic actors must be labelled rather than called a full upload test.
- Compiled frontend screenshots and scoped accessibility at desktop/mobile.
- English HTML book: exact inputs, derived receipts, changes, failed checks,
  costs/timings and unresolved semantic/visual work.

## Experiment integrity

Before production edits, all 253 files pinned by the unexecuted r3 review
declaration were archived under its code-before-pdf-provenance directory. That
declaration becomes historical when its code drifts; it cannot be silently
executed against new code. Earlier raw prompts, results, ledgers, negative
judgments and approval rejection remain unchanged. API approval is still pending.

## Recorded checks so far

- Native parser audit: all ten identical PDFs, 599 physical pages and 671 chunk
  texts match the retained successful extraction byte for byte. All chunks have
  unique exact locations. The ordered local before/after arms observed 2,300.05
  ms versus 2,994.97 ms, approximately 695 ms additional parsing work across ten
  files. These are local observations, not an end-to-end or general benchmark.
- Parser/helper checks: five focused suites / 75 passing tests. Evidence/citation
  checks: four suites / 107 passing tests. Pipeline selector compatibility:
  four suites / 125 passing tests. Material lifecycle/sidecar checks: three
  suites / 88 passing tests. These separate runs are not an additive unique-test
  denominator.
- Material route checks: 55 tests passed with local Supertest listeners, including
  pinned PDF readback, changed-byte refusal and private-path response checks.
  Services/authentication are mocked in this run; it is not live Mongo ingestion.
- Initial pipeline selector fixtures failed because of incomplete test doubles;
  the corrected run preserves the real readiness implementation and verifies
  that cached same-request replay performs no new admission or enqueue.
- Final post-hardening combined run: 20 suites / 542 passing tests, including the
  route, editor control-flow, sidecar integrity and pure harness admission cases.
  This supersedes the overlapping checkpoints above; they must not be added.
  Full server/client typecheck passed.
- Compiled UI: 19 provenance cases passed, with desktop/mobile scoped axe and
  six screenshots. Two additional intercepted-editor browser cases passed for
  provenance 409 and schema 422 recovery. Browser APIs were intercepted; no real
  application, SAML, database or provider ran in those UI fixtures.
- The first UI fixture mocked the wrong existing course-tree endpoint. Its
  interrupted report/traces remain retained. A corrected first pass then exposed
  long-string mobile overflow during visual inspection; wrapping and a viewport
  assertion were added before the final 19-case run.

## Integrity issue found during review

The first locator implementation checked hashes and mechanically consistent
page intersections. A chunk-only database corruption could consistently move
all raw offsets by one within the same page and still pass those mechanical
checks. That did not prove an exact substring of the retained raw text.

The private sidecar now retains the tuple commitments computed from the actual
parsed raw source before publication. Each loaded chunk must match its original
tuple; the same-page shift and missing/index/text/locator/digest mutations fail.
The sidecar remains the trusted ingestion authority. This is not protection
against an actor who can rewrite the original source and every trusted database
record coherently. No historical hash, model output or paid receipt was rewritten.

The live harness and UI receipts below state their real and substituted
boundaries explicitly. No checks here establish improved semantic acceptance,
reduced professor review time, or recovery of the historical 379 coverage gaps.

## Isolated local integration result

`audit-results/pdf-provenance-production-2026-10-17/verification.json` pins the
root-observed terminal exit, final tests, browser receipts and original inputs.
The fresh `financebot_quality_smoke_pdf_provenance_20261017_a1` database used a
replica set. The run completed in 7,914 ms with ten durable ingest runs, ten
private sidecars, 599 physical pages, 671 byte-identical chunks and 32 verified
HTTP responses. This duration includes successful substitutes and is not real
embedding/classification or end-to-end model latency.

Real boundaries were the native parser/page metadata, chunker, Mongo publication
transaction, currentness service and material routes. Synthetic identities
bypassed SAML. Embeddings and vector storage used counted deterministic successful
substitutes; classification was explicitly skipped ten times. Model/job/remote
boundaries were forbidden and observed zero attempts. No multipart admission,
Agenda worker, real vector/embedding service, question generation or teacher
acceptance was tested.

The local assertions include all 671 workspace locations, exact pinned PDF bytes,
legacy identity preservation, changed frozen evidence refusal, and independent
new evidence/workspace construction after a consistent same-page locator shift.
The shifted chunk loses its location and the packet reports partial provenance.
Signed-out, nonmember and Student reads are denied; TA reads succeed; cross-course
and foreign pins fail. Altered owned PDF bytes fail pinned readback. Trash keeps
the raw artifact but makes it unavailable for grounding and pinned viewing.
Only owned fixture copies were changed, then restored where specified; all 24
retained input/binary pins remained identical. The final Trash fixture is retained.

The 211 code pins used by the completed local run are preserved separately under
`audit-results/pdf-provenance-production-2026-10-17/code-at-local-run/manifest.json`.
The original 253 r3 model-probe code copies were independently verified; 17 of
those current source files now differ. R3 remains historical and unexecuted.

Reproduction uses a fresh database and fresh output names, because the harness
refuses existing records or output directories. Prepare and review the file-only
declaration first, then use the same declared database in a separate live output:

```bash
node --require tsx/cjs scripts/verify-pdf-provenance-ingest.ts \
  --database financebot_quality_smoke_pdf_provenance_reproduction_001 \
  --output audit-results/pdf-provenance-reproduction-001-plan

MONGODB_URI='mongodb://127.0.0.1:27029/?directConnection=true' \
MONGODB_DB_NAME=financebot_quality_smoke_pdf_provenance_reproduction_001 \
node --require tsx/cjs scripts/verify-pdf-provenance-ingest.ts \
  --database financebot_quality_smoke_pdf_provenance_reproduction_001 \
  --output audit-results/pdf-provenance-reproduction-001-live \
  --execute-local once
```
