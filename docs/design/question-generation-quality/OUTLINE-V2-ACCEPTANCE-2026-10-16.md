# Prospective ten-source outline v2 acceptance

This is a separate acceptance attempt after the source-grounding/grouping
protocol repair. It must not relabel the earlier cold or recovery failures as
successful. No complete new v2 outline is established by this harness, its
preflight or its unit tests.

## Fixed scope and cost boundary

The new phase scope is
`quality-lab-2026-10-16-outline-v2-acceptance`. Its independent shared ledger
permits at most 100 sends, 2,000,000 conservative reservation units and 200,000
input units per send. The normal production run retains its own default 2m
budget, 256-send ceiling and 24k output ceiling; the separate shared 100-send
bound remains stricter. Successful usage does not settle conservative charges.
Failures and unknown work keep their reservations.

Use Luna medium with unchanged production caps: extraction 12k, organization
24k and final source review 6k. This experiment expects exact production cache
reuse, so a request to extract fresh sources or organize a new evidence pack
stops before model dispatch. Paid calls are limited to fresh final organization
and fresh v2 original-source review, including bounded corrections. There is no
automatic cap increase or subsequent retry under a reset ledger.

The original ten HTTP-uploaded/indexed PDFs remain the complete input: Chapters
2, 3, 4, 5, 6, 8, 9, 10, 11 and 12; 599 pages and 671 sections. Course
`6ad2ad04e474ab8460b47c07`, its original batch, original actor and local
`financebot_quality_smoke_retest_20261016` database on port 27029 remain fixed.
Native-PDF parsing changes apply to future ingestion; this attempt does not
rewrite historical source manifests or reingest the files.

## Historical evidence remains separate

The declaration pins the terminal controls/results for both attempts:

| Attempt | Run | Retained outcome |
| --- | --- | --- |
| Cold | `6ad2adfee0053b5beee70fc8` | 552/671 sections; two provider failures; 64 sends / 1,575,756 conservative units |
| Cache-assisted recovery | `6ad2cae88e3e260e233c924c` | 671/671 sections and five completed packs; source-review identity failure; 26 sends / 1,828,452 units |

The recovery retained 25 logical captures containing 26 native sends: JSON
correction sends must be counted separately. Its first final-review request
consumed its reported 6k output allowance without visible JSON before the JSON
correction returned content. This is a recorded failure/cost mode, not a reason
to raise the new review cap silently. The later invalid source rows are a
separate protocol issue addressed by precise invalid-row correction.

Final phase-one and phase-two ledger bytes are pinned only after the small
L14/L38 review probe is terminal. The recovery's earlier `ledger-after.json`
must remain an unchanged prefix of the finalized phase-two ledger. Later probe
charges are therefore retained, rather than discarded to match an earlier
snapshot. The probe byte hash and a terminal status are required; they do not
guarantee a favorable semantic outcome or professor approval.

## Declaration contract

`scripts/quality-lab/run-outline-v2-acceptance.ts` exports
`OutlineV2AcceptanceDeclaration`. The root agent creates this prospective
declaration only after reviewing the probe and freezing the implementation.
The declaration contains:

- Version 1, phase `ten-chapter-outline-v2-acceptance`, the exact scope above,
  an absolute new ledger path, the fixed limits/caps/model and creation time.
- `fixture: { path, sha256 }` and the unchanged original-source fingerprint.
- Two `priorLedgers` in phase-one/phase-two order, each with absolute path,
  finalized byte SHA-256, scope, counters and `immutable: true`.
- `history.cold` and `history.recovery`, each with the exact run ID and pinned
  controls/results files; recovery also pins its earlier `ledgerAfter` file.
- `reviewProbe: { path, sha256 }`, pointing to the terminal probe receipt, and
  `rootAgentReviewedAfterProbe: true`. This records agent review, not a human
  approval or teacher assessment.
- `code: [{ file, sha256 }]`, covering every current `server/src/**/*.ts` and
  `scripts/quality-lab/**/*.ts` file, `package.json`, `package-lock.json`,
  `tsconfig.base.json` and `server/tsconfig.json`. The exported file enumerator
  is file-only. New or removed transitive source files invalidate the manifest.
- An English purpose statement.

`emptyOutlineV2AcceptanceLedger(declaration, declarationFileSha256)` returns a
pure empty ledger value. The root agent may write it once with `flag: 'wx'`
after reviewing the declaration. The runner never creates, resets or enlarges
an existing phase ledger. Live startup requires that declared ledger to exist
and still be empty; another attempt cannot reuse spent room implicitly.

## Reviewable commands

Preflight reads only local files and writes a new report/code-snapshot directory.
It makes no Mongo, provider or network calls and does not claim live cache
warmth:

```sh
node --import tsx scripts/quality-lab/run-outline-v2-acceptance.ts \
  --declaration /absolute/path/to/declaration.json \
  --declaration-sha256 DECLARATION_FILE_SHA256 \
  --output audit-results/quality-lab-2026-10-16-outline-v2-acceptance/preflight
```

Only the root agent runs the explicit live command, with the reviewed
declaration and a different new output directory:

```sh
MONGODB_URI='mongodb://127.0.0.1:27029/?directConnection=true' \
MONGODB_DB_NAME='financebot_quality_smoke_retest_20261016' \
node --import tsx scripts/quality-lab/run-outline-v2-acceptance.ts \
  --declaration /absolute/path/to/declaration.json \
  --declaration-sha256 DECLARATION_FILE_SHA256 \
  --output audit-results/quality-lab-2026-10-16-outline-v2-acceptance/live \
  --live once
```

Live guards recheck the owned active course, replica transactions, exact
terminal durable history, lack of other queued/running course work, complete
original corpus and fingerprint. Every send rechecks the frozen current source
set, retained evidence, original PDFs and immutable prior ledger files. The new
ledger is append-only and accepts only this attempt's cell ID.

## What completion must show

The real production pipeline must report all 671 sections reused, zero fresh
sections, five validated packs reused and zero fresh packs. Row counts in Mongo
alone are insufficient: production cache keys and original-source validators
still decide reuse. It then performs a fresh final organization and complete v2
review for whatever objectives that new draft actually contains. The old count
of 111 objectives is not imposed on the new result.

Exact request options, complete visible I/O, provider events, correction sends,
unknown usage, budget receipts, durable partial findings, live source/cache
observations and a terminal ledger snapshot are retained. Earlier costs/time
remain separately linked. A completed diagnostic result applies no Topic/LOs,
saves/adopts no question, and changes no student, Canvas or Admin configuration
records. Teacher acceptance and complete pedagogical coverage remain null.
