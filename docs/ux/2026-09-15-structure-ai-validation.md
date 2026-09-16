# Course Structure AI — layout and generation repair

## Reported failure and diagnosis

The real Physics3 course had two structure runs: one stopped by the instructor,
and one that failed in the `analyzing` stage with `structure-analysis-invalid`.
The latter ran for approximately 33 seconds with zero analyzed sections reported.
The old page exposed only a generic failure message and opened a large empty saved
outline by default. The AI workspace also differed from the approved prototype.
The persisted error identifies extraction validation as the failure stage; it does
not record which individual quote or schema field was rejected.

## Updated experience

- Empty courses open AI draft directly; Course outline retains manual editing.
- Prototype layout: visible source selection and AI defaults in a compact left
  composer, with a full-width topic-card draft on the right. Settings are optional.
- Topic/LO text updates from the provider's actual stream. Draft cards retain DOM
  nodes while streaming; reviewed edits survive duplicate progress snapshots.
- Immediate starting feedback, analyzed-section progress, explicit error states,
  stopping, retry and reload/navigation recovery are supported. An accepted run
  remains busy if fetching its first snapshot fails; polling reconnects to that run.
- Missing ready sources explain the prerequisite and link to Course Materials.
- Applying selected objectives preserves existing course content and source links.

## Generation repair

All selected materials' persisted chunks are still analyzed. Extraction now uses
stable numbered passages (at most 500 characters each). The model selects passage
IDs; the server attaches the original text instead of asking the model to reproduce
PDF equations, whitespace and punctuation. Unknown and cross-section references
are rejected. Every section must still be accounted for.

Batches are bounded to four sections and 18,000 characters. Invalid output is
retried with validation feedback, then retried in individual sections when needed.
Synthesis keeps cross-material grouping, optional exact counts, source coverage,
exclusions and gap reporting. The draft remains separate until reviewed apply.

## Validation

- 75 focused unit/API tests passed (structure generation, materials routes,
  classification and durable content runs).
- Browser checks cover progressive text, initialized editable values, citations,
  selected-subset apply, failure retry, app-shell navigation, refresh recovery,
  no-ready-material guidance, long-text auto-height, the existing manual editor, and desktop/mobile CSS.
- Scoped light and dark WCAG A/AA scans passed.
- TypeScript build and targeted ESLint passed.
- Real model smoke: `gpt-5.6-luna`, two self-authored synthetic documents,
  16 source sections in four batches, 83 extracted points mapped to 12 topics /
  30 objectives, 42 persisted text updates, 38 seconds. The final lecture chapter
  was included. Temporary test records were removed afterward.

The real-model result verifies this pipeline on the synthetic fixture, not complete
pedagogical coverage of arbitrary uploaded files. Diagrams and material absent from
parsed text still need instructor review. The earlier automatic approval rejection
for transmitting uploaded teaching files was respected; no private uploaded source
was sent by this repair's test.

Final read-only verification of the user's open Physics3 page showed a successful
new draft with 10 topics and 12 objectives, with 73/73 extracted learning points
mapped. The agent did not trigger that course's generation; the result was observed
while refreshing the page to verify the finished layout. Long editable topic/LO
fields expand to their content instead of clipping after one or two lines.
