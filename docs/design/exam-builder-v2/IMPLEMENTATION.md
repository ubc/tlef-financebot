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


## Topic-first bank sampling (2026-10-13)

- Replaced the main private-generation UI with Browse bank and Sample by topic.
  Existing FinanceBot typography, green accent, surfaces, controls, rich-text
  rendering and Questions / Review / Publish steps are retained.
- Topic groups, topic/type/difficulty filters, optional LO selection, 15-row
  pagination and topic coverage replace the LO-by-LO primary workflow.
- Read-only server previews sample approved current versions by a pooled total or
  per-topic quotas, excluding existing paper questions and blocked versions.
  Matching handles overlapping topic memberships without duplicate questions or
  greedy allocation shortages. Insufficient supply never silently reduces counts.
- Previews show the exact server-selected version and stem. Explicit Add commits
  the pins under the paper revision guard and rechecks approval/currentness.
- Optional numerical variants reuse the saved parameter ranges and formulas,
  freeze all numbers/answers/explanations, and need no model calls. Eight bounded
  draws seek different values; constant ranges report an actionable failure.
- Older formula proofs are checked in memory with the existing multi-seed
  evaluator. Missing formula definitions, stale script proofs, bad placeholders,
  invalid draws and colliding options remain blocked. No approved bank content
  or historical student/exam records are migrated or rewritten.
- Historical candidates and active-run cancellation/SSE remain available;
  private generation APIs are retained for compatibility. Published exams and
  student assessment timing, grading and feedback contracts stay immutable.

Validation uses real compiled UI with isolated HTTP fixtures and deterministic
service/route tests. No live provider calls or production record changes are
needed. See `tests/unit/exam-bank.service.test.ts` and
`tests/e2e/exam-builder.spec.ts`.


Topic sampling verification:
- Full Jest regression: 157 suites / 2,102 tests passed. Two additional sampler
  boundary tests were then added; the final sampler suite passed all 10 tests.
- Compiled production browser suite: 10 tests passed, including pooled sampling,
  per-topic quota controls, preview/resample/add/publication, version-conflict
  recovery, 32-row pagination, disabled blocked rows, numerical-mode requests,
  historical SSE, assessment save/reload/submit, and light/dark scoped axe scans.
- Build, typecheck, lint and diff whitespace checks passed.
- Screenshots: `audit-results/exam-builder/light.png`, `sampling-light.png`,
  `sampling-dark.png`. APIs were intercepted for browser checks; numerical and
  selection behavior was exercised through the real service functions with
  isolated storage fixtures. No live Mongo course mutation or AI call occurred.


## Manual selection and approval acceptance (2026-10-13)

- Focused backend regression: 7 suites / 122 tests passed. The added service
  sequence selects a specific approved bank question, samples the remaining
  pool, adds a verified numerical variant, and publishes directly without a
  separate approval operation. Published parameter values and computed correct
  answers remain exactly those shown in the frozen paper.
- Browser acceptance: all 12 cases passed, including single-question + Add,
  checkbox bulk selection, manual selection plus random top-up, no repeated
  approval before publication, and the retained approval requirement for old
  unapproved generated candidates. Two initial cases timed out connecting to
  the temporary local static server before app load; both passed on retry.
- The no-reapproval screenshot is `audit-results/exam-builder/bank-no-reapproval.png`.
- Build, scoped lint and diff whitespace checks passed. Only tests and this
  record were added for this follow-up; production behavior did not need repair.
- Backend storage and browser HTTP responses use isolated fixtures. These checks
  do not prove deployed database state or production identity configuration;
  no live course records or provider APIs were used.
