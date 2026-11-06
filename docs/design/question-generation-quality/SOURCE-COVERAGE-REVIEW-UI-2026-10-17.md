# Inspectable source coverage in Course Structure

The source receipt in the existing AI draft workbench now supports per-file
counts, search, filters and bounded pagination. It makes retained gaps easier to
inspect; it does not repair or certify the outline's pedagogical coverage.

## Product behavior

In Course Structure, open the latest AI draft's **Source coverage** disclosure
above the draft objectives. The collapsed receipt remains in the initial
workbench viewport even for the 119-objective fixture.
The file table separates analyzed sections, extracted learning points, mapped
points, point gaps, visual-review passages and unreviewed passages. Selecting a
file filters the review records. The file table uses ten rows per page; review
records offer ten, twenty-five or fifty rows per page.

Search includes file names, learning-point IDs, original passage IDs, objective
text, quotes and recorded reasons. Category filters separate learning-point gaps,
visual or unreviewed passages, and other recorded source decisions. Expanding a
record builds its exact-quote details on demand. Original-file links and the
existing highlighted source preview remain available when the record has an
unambiguous binding.

The receipt describes the returned AI draft before instructor edits and selected
subset application. Editing an objective does not rewrite the historical
coverage counts. Source support, objective selection, Apply, adoption and
server-side publication rules are unchanged.

Failed runs without a complete `structureResult` can display their retained
`structureDiagnostics`: intended source names and unprocessed sections. Learning
point and passage coverage stays unavailable, and no applicable outline is
presented. An empty diagnostic list does not establish complete analysis.

## Units and uncertainty

The sanitized ten-file UI fixture retains the recorded scale of 599 PDF pages,
671 analyzed sections, 999 extracted points, 620 mapped points and 379 point
gaps. Its 951 review records consist of:

- 379 distinct learning-point gap records;
- 348 related original passages marked `unmapped-objective`;
- 136 passages needing visual review;
- eight context and seven non-instructional decisions;
- 73 sections with no extracted objectives.

These are different units. A point and its original passage can refer to the
same content; 951 records are not 951 independent missing teaching concepts.
Zero-objective sections are not automatically non-instructional. All ten files
being represented does not mean every chapter relationship or diagram is covered.

Missing historical receipts produce **Unavailable**, not fabricated zeros.
Contradictory identities, cardinalities, counts and cross-file links require
explicit diagnostics and unavailable affected counts. Conflicting records remain
inspectable. A duplicated evidence ID must not silently choose the last quote or
source for a context action. A point recorded both as mapped and unmapped must
not be described as definitively lacking an objective link.

## Reproduction and evidence boundaries

The browser suite uses compiled production modules and styles with intercepted
APIs. Its committed fixture replaces all source prose and draft names with
explicitly synthetic text, remaps material database IDs and retains the original
record relationships. The fixture pins its actual outline-result authority hash.
CI does not depend on ignored local model transcripts.

```sh
npm run build:client
npx playwright test --config playwright.structure-source-coverage.config.ts
```

This configuration starts only a static server bound to `127.0.0.1:6167`. It has
no SAML setup, app server, MongoDB, Agenda or model worker. Every API request is
intercepted; unexpected external requests and non-GET mutations fail the fixture.
Desktop light and mobile dark checks include scoped WCAG A/AA scans, keyboard
interaction and horizontal-overflow assertions. Whole-product accessibility and
real source semantics remain separate requirements.

The first run retained six passing and six failing tests. Those failures exposed
ambiguous test labels, a mismatched notice expectation and an unintended outer
grid class in the full-workbench fixture. Their traces and error contexts are
preserved before the corrected run. A separate read-only integrity audit found
real malformed-receipt display problems; focused regressions cover those repairs.
The terminal verification receipt identifies exact code, fixture, commands,
browser outcomes and screenshot hashes:
`audit-results/structure-source-coverage-2026-10-17/verification.json`.

The final integrated local run passed 33 cases: 19 source-receipt checks and 14
existing Course Structure streaming, editing, Apply, failure and deletion flows.
Earlier 18/19, corrected single-case and 14-case checkpoints remain separate
receipts, not additional unique tests. A visual check found the original receipt
below all 119 objectives; the final layout moves it above them and verifies its
initial viewport position. The book uses a viewport screenshot of this actual
workbench, avoiding an unreadable 17,385-pixel full-page image.

The English evidence book's `#source-coverage-ui` section displays only after a
passing terminal receipt exists. Screenshots are labelled mocked UI evidence.
This work incurs no new model tokens, saves no outline and adds no questions.
The actual ten-file continuation, its 379 point gaps and the independent semantic
audit remain authoritative for generation quality. The separate six-candidate
source-interpretation model probe remains unexecuted pending explicit approval.
