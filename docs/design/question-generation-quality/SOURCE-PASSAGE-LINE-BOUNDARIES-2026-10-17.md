# Source passage line boundaries — 2026-10-17

## Concrete defect

The retained ten-file corpus contains a complete native-text company row on
Chapter 10 physical PDF page 32 (printed page 178):

```text
Newfoundland Light & Power   + 1.80%
```

Section `S547`, local alias `C50.S1`, chunk index 49 is 666 JavaScript characters.
The former 500-character word splitter cut the company name between passages:
`P1` ended with `Newfoundland`; `P2` began with `Light & Power   + 1.80%`.
The original PDF and native text contain one company row. A retained extraction
treated the fragments as separate companies. The artificial cut is a structural
error after PDF text extraction; repairing it does not prove a future model will
interpret the row correctly.

Original PDF:
`audit-results/generation-quality-corpus/chapter-10.pdf`;
SHA-256 `761ede92b0509f09c46a0275632271a1ff609d30ff83adf9d2a30002639e1809`.
The inspected deterministic page render is
`audit-results/source-passage-line-boundaries-2026-10-17-final/chapter-10-physical-page-32.png`.

## Production repair and historical compatibility

`server/src/services/source-passages.ts` owns two explicit policies:

- `word-boundary-v1` reproduces the historical algorithm exactly. Missing policy
  metadata selects this policy. The exported service helper still defaults to it.
- `line-boundary-v2` selects the last complete native newline, CRLF, or form-feed
  boundary within the existing 500-code-unit limit. Overlong individual lines
  fall back to bounded word/token cuts. Valid UTF-16 surrogate pairs stay intact.
  Quotes remain exact, unnormalized original substrings; no table relationships
  or chart values are inferred.

Fresh outline corpus loading records `line-boundary-v2`. Extraction prompts,
live/cache validators, repair feedback and final source inventories use that
corpus policy. Review continuation uses the retained checkpoint policy.
Historical proposal reconstruction explicitly selects `word-boundary-v1`.
Original-byte source fingerprints and checkpoint currentness remain independent
of this derived policy. An explicitly unknown policy is refused by checkpoint
validation and cache identity construction, and skipped by cache/catalog reads.

Each catalog record resolves its passage aliases using its own recorded policy;
an old `P1` cannot silently bind a different current quote. Cache schema and prompt
version constants were preserved. The exact rendered prompt already binds every
alias and quote through `promptTextHash`. Policy metadata remains outside the
cache key: identical prompt payloads retain identical identities, while changed
cuts change the exact prompt and key. Cross-policy reads still require the
existing exact identity and quote validation. No historical receipt is rewritten.

The offline outline harness supplies the pure helper bindings only for current
versioned declarations. Retained inline declarations remain self-contained and
default to their original partition. New extraction preflight explicitly selects
the current policy; historical matched-prompt helpers keep their legacy default.

## File-only verification

Run without an application server, database, credentials or provider:

```sh
node --import tsx scripts/audit-source-passage-boundaries.ts \
  --output audit-results/source-passage-line-boundaries-NEW
```

The runner accepts only a new directory under `audit-results`. It verifies the
archived service hash against its retained manifest, recovers the trusted old
function through TypeScript AST/VM, and compares all 671 retained sections. It
executes repository declarations only; PDF text and model output remain data.
The final receipt pins the runner, original checkpoint/result, archived source
and current source dependencies.

Final receipt:
`audit-results/source-passage-line-boundaries-2026-10-17-final/results.json`;
SHA-256 `39669e2ef72b157a6b3221395a550e7775f21d6d5f3a7fbe135a269de12fef59`.
All per-section quotes and identities:
`audit-results/source-passage-line-boundaries-2026-10-17-final/all-sections.json`;
SHA-256 `9aecf65c2ba60677d9eb4813dd2bf4a834006e255219b4520f4c0683166885df`.
The earlier `source-passage-line-boundaries-2026-10-17/` receipt is retained as an
earlier audit, without overwriting its results.

| Observation | Before | After |
| --- | ---: | ---: |
| Original sections | 671 | 671 |
| Passage quotes | 1,238 | 1,292 |
| Inter-passage boundaries within a native line | 393 | 0 |
| Inter-passage boundaries at native line/page delimiters | 174 | 621 |
| Quoted characters, including whitespace | 467,771 | 467,043 |
| S547 passage lengths | 494 / 171 | 481 / 184 |

384 sections change; 287 retain identical spans and individual prompt/cache
identities. Every new quote is at most 500 code units, appears exactly in its
original section and preserves all non-whitespace characters in order. The
whitespace-character reduction comes from trimming additional passage edges.
Historical finalization reproduces all 1,238 original target identities, quotes
and other target values unchanged. The revised company row appears intact in
exactly one new passage.

The existing 16-section / 18,000-character grouping yields 48 batches. 45 batch
identities change, containing 664 sections, including 280 whose individual spans
did not change. Parent/child cache keys bind their enclosing batch. Therefore the
287 unchanged individual identities do **not** establish 287 warm hits or a small
warm-run cost. No cache database lookup or paid latency measurement was made.
The additional 54 passages can increase prompt/output accounting obligations.

The receipt records approximately 30 ms for the archived function loop and 2 ms
for the new pure helper loop. These run through different VM/native execution
paths and are **not a comparative benchmark** or an end-to-end speed claim.

## Automated checks and limits

Both application typechecks and scoped ESLint passed. Eight focused Jest suites
passed, 137 tests total:

```text
tests/unit/source-passages.test.ts
tests/unit/source-passages-integration.test.ts
tests/unit/structure-generation.service.test.ts
tests/unit/generation-catalog.service.test.ts
tests/unit/source-evidence-cache.service.test.ts
tests/unit/structure-review-checkpoint.test.ts
tests/unit/quality-lab-outline-controls.test.ts
tests/unit/quality-lab-outline-extraction-audit.test.ts
```

The standalone audit runner also typechecks when the existing Express/Passport
type augmentations are included. The first one-file TypeScript command omitted
those project-wide declarations and failed on `Request.user/isAuthenticated`;
the application typecheck and corrected explicit command both passed. The first
scoped lint run found two forbidden inline `import()` type annotations in the
runner; static type-only imports corrected them before the final audit.

This pass made zero model/API/database calls, saved or adopted no questions, and
did not apply an outline. PDF parsing outputs, manifests and chunks are unchanged.
Overlong source lines, cross-chunk rows and missing native chart semantics remain
separate problems. In particular Chapter 10 physical page 9 (printed 155) still
needs visual review: locating its chunks does not recover the plotted quantities
or establish pedagogical coverage. A new controlled model experiment is required
before claiming better semantic judgments, saved yield or professor review time.
