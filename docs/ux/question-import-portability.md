# Question import and portability

Status: design proposal. The current importer supports CSV/JSON/QTI question content and a single batch LO assignment. It does not yet restore hierarchy or infer LOs. The Import layout is aligned separately; no planned capability should appear as an enabled control before its backend exists.

## Two entry paths

1. **Question file**: parse questions, preview valid and invalid rows, optionally request AI organization. AI first compares existing course Topics/LOs, then proposes additional objectives only when needed. Show question-to-LO links, new versus reused objectives and short explanations. The instructor confirms the mapping. Preserve manual assignment as a non-AI path. Run AI organization as a durable content run with real progress events, retries and editable results.
2. **FinanceBot export**: restore Topics, ordered LOs and many-to-many question relationships through a versioned portable manifest. Preview hierarchy collisions before writing. Remap local export IDs to new destination IDs; never reuse source database IDs. Match existing objectives only after an explicit mapping choice. All imported questions enter Draft review regardless of their previous approval/release state.

Retain CSV for spreadsheet editing and simple content interchange. Add a versioned FinanceBot JSON package for lossless structure rather than silently changing the existing CSV contract. Offer both from Question Bank. A future CSV variant may reference manifest-local IDs but cannot claim to preserve an entire graph without its manifest.

## What the package contains

- Schema version, export identifier, local Topic/LO/question IDs and ordering.
- Full question content, answer roles and explanations, difficulty and question-to-LO links.
- Selected-question exports include only the related hierarchy.
- Parameterized questions require their definitions and script plus revalidation in the destination. Current CSV exports remain fixed rendered samples.
- No student data, approval/release state, source database IDs, embedding vectors or credentials.

## Materials and provenance

Imported questions are assessment content, not source materials. Do not turn them into fabricated uploaded files or use their own answers as independent evidence for correctness.

Restore the Topic → LO → Question graph. Material → Chunk → Concept/evidence links cannot be treated as verified without the underlying source. Show **No source attached** and a clear Attach materials action. Preserve source-dependent gaps separately from assessment coverage: a Topic can have question coverage while lacking source coverage.

If users later upload original material, use the existing ingestion pipeline: store original → parse → chunk → embed → index in the destination course. Build fresh chunk IDs and embeddings with the current parser/model. Propose LO associations for review. Do not attach old highlights or page offsets until matching actual destination text. Highlight only an exact matched excerpt; otherwise show that the source location is unavailable.

An optional later portable bundle can include authorized originals plus checksums and excerpt metadata. Even then re-ingest originals and re-resolve evidence links; do not import Qdrant vectors directly. The export file itself is an import artifact, not a RAG source.

## Commit and reliability

Upload and validation can happen automatically after file selection; durable creation happens after one explicit preview confirmation. Confirmation creates the chosen questions and confirmed hierarchy together, followed by Review Queue. It never automatically releases content to students.

Use an import ID and idempotent commit. Retries must not create duplicate questions or objectives. Validate all hierarchy links within the destination course and commit related records atomically, or expose recoverable partial results. Preserve failed rows for correction. Report counts for created, reused, rejected and unassigned items.

## Implementation order and acceptance

1. Align existing Import UI without changing supported formats. Verify native CSV, JSON and QTI paths.
2. Implement versioned export/import manifest, remapping and collision preview. Round-trip multiple LOs per question and topic ordering; reject malformed links without writes.
3. Add optional AI organization with streamed durable progress and confirmation. Test cancellation/retry and duplicate avoidance.
4. Add missing-source graph presentation and later material attachment. Verify ungrounded imports never acquire invented evidence or source highlights.
