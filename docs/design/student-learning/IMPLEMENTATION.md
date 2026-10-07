# Student learning implementation

Approved reference: student-linear-prototype (6 October 2026).

- [x] Course settings: retained Topic Practice / finite Linear learning, teacher or evidence-based LO ordering, teacher question sequence and optional timed material notes.
- [x] Durable lessons: drafts, cursor, skips, immutable first submissions, next distinct question, board and fixed footer.
- [x] Review library: released approved questions, filters/sorts/private tags, finite self-tests and flashcards, separate review history.
- [x] Compact Discussion: question-first composer/preview, optional auto-linked Topic/LO, generic post categories, anonymous answers/follow-ups, staff answers/moderation.
- [x] Explicit Preview namespaces and separate expiring records; authorization and release/numerical gates throughout.
- [x] Security/state tests, typecheck/build/lint and browser validation.
- [x] Compact shared result summaries with status rows and a fixed footer.
- [x] Production-default finite lessons for new and pre-rollout courses; legacy practice remains an explicit instructor opt-in.
- [x] Shared question layout for both teaching modes, including Course Home Topic Start and Student Preview.

## Persistence

New typed collections isolate configuration, live learning sessions, review metadata and discussion from expiring Preview equivalents. Session revisions guard concurrent draft/navigation/submission writes. Submitted answers have deterministic attempt ids; projection can be safely retried. Flashcard recall is a self-rating, not graded evidence. Existing Topic Practice and timed Exam Prep keep their existing APIs.

Teaching mode selects behavior, not layout. `practice.ts` dispatches both engines
into the same three-panel design and fixed icon/navigation footer. Topic Practice
uses its original serving and attempt endpoints, preserves Strategy A's withheld
feedback and version-pinned follow-up, and explicitly ends a round when the bank
is exhausted. Visited questions and drafts remain accessible through Previous,
Next and the question board. Its history remains client-local as before; Linear
lessons retain durable server-side resumes and advance without gated retries.

## Production rollout

Courses without settings and historical settings without `teachingModeVersion: 2`
resolve to Linear learning. This read-time compatibility policy needs no database
migration or environment flag. Historical notes, order, revisions and student
records remain intact. A revision-guarded Instructor save writes version 2 and can
explicitly choose legacy Topic Practice. Course Home and Student Preview use the
same effective mode; a topic starts with every currently released, Approved,
servable question listed in the new layout, preserving publication/numerical gates.

## Verification

- Typecheck/build and lint of changed production modules passed.
- Full Jest suite: 123 suites / 1,598 tests passed; later focused state/permission checks also passed.
- Seven browser cases cover the reader, Review Book, composer, moderation, teacher settings and desktop/mobile WCAG A/AA. APIs are intercepted; compiled production renderers are used.
- Seven additional browser cases cover actual Course Home Topic Start in the default mode, skipped drafts, pinned retries/withheld feedback, revisited-question retries, failed loads/submissions, duplicate prevention, mastery progression, finite rounds, restricted Preview isolation and responsive accessibility. Screenshots show incorrect-answer, follow-up and bank-exhausted states using fixture questions.
- `scripts/verify-student-learning.mjs` checks real MongoDB indexes, concurrent start/submission CAS, attempt idempotence, notes visibility, metadata, flashcards, anonymous privacy, moderation and Preview isolation in a temporary database, then removes that database.
- No edits were made to the other window’s checkout. Existing courses adopt Linear learning on rollout; selecting Topic Practice explicitly in Course Settings restores legacy behavior in the new layout. Existing open lessons retain their pinned versions and order; reopening appends newly released questions once, without repeating earlier answers.

- Rollout verification: 20 service/route checks and 14 browser cases passed, including light/dark summary accessibility, immediate full question lists, and row-level return to skipped or answered questions.
