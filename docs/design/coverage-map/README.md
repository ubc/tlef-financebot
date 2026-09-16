# Coverage Map: actionable objective coverage
Sample-only prototype; no API calls or live mutations.
Existing map checks linked material and approved count (3-question threshold).
Proposed additions: context-aware next action, pending-review prioritization,
and topic release context shown separately from content coverage.
Production will need release metadata and truthful active-run aggregation.
Do not equate linked sources with ready/valid sources, approved count with
content quality, or coverage with student availability.
Actions in this demo explain their future filtered destinations.

## Production implementation (2026-09-15)
The instructor Coverage Map now uses content-map, course-tree and lazy-loaded
knowledge-graph APIs. Node inspectors expose real source links, connections,
question versions and recorded source references. Ready material and three
approved questions define the displayed target; release remains separate.

Source preview loads the authenticated workspace-detail endpoint and highlights
the exact saved chunk or exact quotation, using text nodes rather than HTML.
A missing quotation produces an explicit no-match state. It does not assert a
PDF page location: existing chunk records lack page coordinates. The original
file opens separately through the authenticated source endpoint. Pixel-aligned
highlighting inside the original PDF remains a separate ingestion/viewer task.
