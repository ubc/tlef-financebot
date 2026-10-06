# Exam Builder implementation — Stephen

This implements the approved design in README.md. Work is additive to the legacy Exam Prep flow and preserves the pending TA changes in this checkout.

- [x] Isolated exam draft/candidate/publication/attempt collections and course guards.
- [x] Version-pinned bank selection, editable paper, review, readiness and immutable publication.
- [x] Reusable verified parameter variants and private generation using existing generator/validator/reviewer functions.
- [x] Durable generation plans, jobs, partial results, cancellation and retry.
- [x] Production Instructor UI matching the approved prototype.
- [x] Student assignment, timed sitting, autosave and controlled result release.
- [x] Permission, isolation, concurrency, grading, generation and browser checks.
- [x] API and repository documentation.

Formal and practice assessments remain isolated from legacy practice analytics, mastery and Review Book. An optional prompt invokes the planner when Preview generation plan is clicked. Question generation starts only after explicit plan confirmation. Existing templates remain available as Legacy Exam Prep.


## Verification

- Full Jest regression: 123 suites / 1,582 tests passed.
- Final generation integration changes: 3 suites / 70 tests passed, including
  an additional private-adapter test proving no public question or content-run write.
- Production browser fixture: 3 tests passed (selection/generation/review/publish,
  answer save/reload/submit, 1280px light and 390px dark scoped WCAG A/AA).
- Build, typecheck, lint and diff whitespace checks passed.
- Local Mongo smoke: unique concurrent starts, pinned sitting, answer save,
  deterministic grade, delayed release, ownership and zero legacy practice writes.
  Synthetic records were removed afterward.
- No live AI provider generation was invoked during verification. Provider
  orchestration was tested with deterministic mocked responses.

No commit, push or deployment was performed. See README.md for the current scope
and deferred extensions.


## September 27 follow-up

- Added private exam SSE with persisted stages and partial stem/option previews,
  reconnection snapshots and view cleanup; removed browser polling.
- Moved active generation progress above the generation form. Live candidates do
  not replace focused inputs or unsaved settings.
- Bounded assessment retries now check numerical serving eligibility before review;
  unsupported formula functions and option collisions retain their safety checks.
  Prompts restrict physics formulas to the evaluator's supported operations.
- Existing failed batches remain truthful history; retry generates only missing
  candidates. No existing question verification proofs or records were rewritten.

Follow-up verification: build/typecheck, lint and diff checks passed; 147 focused
backend tests and all 4 browser tests passed, including real HTTP SSE delivery,
private exam scope, streamed preview field allowlisting, reconnect snapshots,
input preservation, stream cleanup and numerical admission retries. Provider
responses were mocked; no live generation or exam-record mutation was performed.


## Catalog CRUD follow-up

- Added revision-checked title edits from the Exam Builder catalog; renamed
  published exams stay locked, and students see the updated display name.
- Added typed-title permanent delete. Student starts and active generation block
  deletion; a CAS marker protects the start/delete race. Candidates, runs,
  publications and queued jobs are cleaned before the exam record.
- Verified service and route authorization, browser rename/delete, and local
  MongoDB cleanup with synthetic records that were removed afterward.

Catalog CRUD verification: full Jest regression 123 suites / 1,600 tests passed;
production browser catalog flow and mobile dark rename dialog axe passed; build,
typecheck, lint and diff whitespace checks passed. Local MongoDB smoke confirmed
published lock, student-facing renamed title, stale-revision rejection, scoped
record cleanup and started-exam protection. Synthetic records were removed.
