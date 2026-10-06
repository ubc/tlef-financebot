# Student learning implementation

Approved reference: student-linear-prototype (6 October 2026). Implementation stays in the isolated 6065 worktree.

- [x] Course settings: retained Topic Practice / finite Linear learning, teacher or evidence-based LO ordering, teacher question sequence and optional timed material notes.
- [x] Durable lessons: drafts, cursor, skips, immutable first submissions, next distinct question, board and fixed footer.
- [x] Review library: released approved questions, filters/sorts/private tags, finite self-tests and flashcards, separate review history.
- [x] Compact Discussion: question-first composer/preview, optional auto-linked Topic/LO, generic post categories, anonymous answers/follow-ups, staff answers/moderation.
- [x] Explicit Preview namespaces and separate expiring records; authorization and release/numerical gates throughout.
- [x] Security/state tests, typecheck/build/lint and browser validation.

## Persistence

New typed collections isolate configuration, live learning sessions, review metadata and discussion from expiring Preview equivalents. Session revisions guard concurrent draft/navigation/submission writes. Submitted answers have deterministic attempt ids; projection can be safely retried. Flashcard recall is a self-rating, not graded evidence. Existing Topic Practice and timed Exam Prep keep their existing APIs.

## Verification

- Typecheck/build and lint of changed production modules passed.
- Full Jest suite: 123 suites / 1,598 tests passed; later focused state/permission checks also passed.
- Six browser cases cover the reader, Review Book, composer, moderation, teacher settings and desktop/mobile WCAG A/AA. APIs are intercepted; compiled production renderers are used.
- `scripts/verify-student-learning.mjs` checks real MongoDB indexes, concurrent start/submission CAS, attempt idempotence, notes visibility, metadata, flashcards, anonymous privacy, moderation and Preview isolation in a temporary database, then removes that database.
- No edits were made to the other window’s checkout. Existing courses keep Topic Practice until their Instructor selects Linear learning in Course Settings → Teaching mode. Existing open lessons retain their pinned versions and order; reopening appends newly released questions once, without repeating earlier answers.
