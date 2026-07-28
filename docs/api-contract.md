# FinanceBot API Contract (v1 + Phase 2 authoring workflows)

All endpoints are under `/api`, JSON in/out, session-cookie authenticated
unless marked public. IDs are Mongo ObjectId hex strings.

**Error format (all endpoints):**
`{ "error": string, "issues"?: [{ "path": string, "message": string }] }`
Status codes: 400 validation, 401 unauthenticated, 403 wrong role/course,
404 not found, 409 conflict (e.g. duplicate enrollment), 503 background queue unavailable.

**Auth guards:** `student` = enrolled in the course; `instructor` = course
instructor (owner/co-instructor); `platform instructor` = explicit global grant
for Instructor shell/course creation; `ta` = course TA; `admin` = platform
admin.

## Auth
- `GET /api/auth/me` (public) → `{ authenticated, user?: { puid, uid, displayName, isAdmin, platformInstructor?, affiliations, courseRoles } }`

## Admin — platform-Instructor accounts

Every route below is platform-Admin-only. Grants use the UBC PUID as the
canonical identifier, including when the user has not logged in yet. A pending
grant attaches to the same PUID-backed User on first SAML login.

- `GET /api/admin/users?query=` →
  `[{ puid, uid, displayName, email, affiliations, isAdmin, platformInstructor, status: 'active' | 'pending', lastLoginAt?, createdAt?, grantedAt?, updatedAt? }]`
  (all persisted Users plus pending grants; raw SAML/session data is never
  returned)
- `PUT /api/admin/platform-instructors/:puid` → one active/pending account
  (idempotent; empty body)
- `DELETE /api/admin/platform-instructors/:puid` →
  `{ puid, granted: false, revoked: boolean }` (idempotent)

## Enrollment (student)
- `POST /api/enrollments { code }` → 201 `{ courseId, name, courseCode }`
  Errors: 404 code not recognized; 403 `not-on-roster`; 410 `course-ended`;
  409 `already-enrolled` (informational, no duplicate created). (ST-E02)
- `GET /api/enrollments` → `[{ courseId, name, courseCode, term, active }]`

## Courses (instructor)
- `POST /api/courses { name, courseCode, section?, term }` → 201 Course
  (platform-Instructor or Admin; faculty affiliation alone is insufficient)
- `GET /api/courses/:courseId` → Course + `themes: [Theme & { los: LearningObjective[] }]`
- `PATCH /api/courses/:courseId { name?, courseCode?, section?, term?,
  termStart?, termEnd?, feedbackStrategy?, autoPause?, published? }` → Course
- Course responses expose `lifecycle: 'draft'|'published'|'archived'`,
  `published`, `updatedAt`, and optional `archivedAt`. Legacy rows derive
  lifecycle from `published`/`archivedAt`.
- `GET /api/courses/:courseId/publish-checklist` →
  `[{ item, ok }]` from the same side-effect-free server check used at publish.
- `POST /api/courses/:courseId/registration-code` → `{ registrationCode }` (regenerates)
- `POST /api/courses/:courseId/publish` / `POST .../unpublish` → `{ published, checklist: [{ item, ok }] }`
- `POST /api/courses/:courseId/archive` → archived Course;
  `POST .../restore` → restored unpublished Draft. Archived courses remain
  instructor-readable, appear inactive to enrolled students, and reject
  student practice with `403 course-archived`.
- Roster: `PUT /api/courses/:courseId/roster { identifiers: string[] }` → `{ count }`;
  `GET .../roster` → `[{ identifier, extendedUntil? }]`

## Hierarchy (instructor)
- `POST /api/courses/:courseId/themes { name, availableFrom? }` → 201 Theme
- `PATCH /api/themes/:themeId { name?, availableFrom?, order? }` → Theme
- `POST /api/themes/:themeId/archive` → Theme
- `POST /api/themes/:themeId/los { name }` → 201 LearningObjective
- `PATCH /api/los/:loId { name?, order? }`, `POST /api/los/:loId/archive`

## Materials (instructor)
- `POST /api/courses/:courseId/materials` (multipart, field `files[]`; or JSON `{ url }`) → 201 `[Material]` (successfully queued entries have status `processing` + a unique `activeRunId`; an immediate run-storage/enqueue failure is returned as status `failed` so no row remains stuck)
- `GET /api/courses/:courseId/materials` → `[Material]`
- Material responses expose `kind:
  'lecture'|'reading'|'assignment'|'assessment'|'solution'|'reference'|'other'`.
  New rows receive a deterministic name-based suggestion; legacy rows normalize
  to `other`.
- `PATCH /api/courses/:courseId/materials/:materialId { kind }` → Material
  (instructor correction; course-scoped)
- `POST /api/materials/:materialId/retry` → Material with a new `activeRunId` (409 when another retry already won)
- `PUT /api/materials/:materialId/assignments { assignments: [{ themeId, loId? }] }` → Material
- `POST /api/materials/:materialId/classification { action: 'accept' | 'reject' }` → Material
- `GET /api/courses/:courseId/suggest-hierarchy` → `{ themes: [{ name, los: [name] }] }` (IN-S06; AI-suggested outline, read-only — apply via the Theme/LO create endpoints above) <!-- ADDED in Task 7 (Saurav); pending two-developer review -->
- `GET /api/courses/:courseId/content-map` → ordered Theme/LO coverage with
  assigned material summaries/kind counts, assessment-like markers,
  question counts by publication state, latest ingest/generation run status,
  unassigned materials, and gaps (`no-material`,
  `no-approved-questions`, `thin-approved-set`).

## Materials (instructor) — implementation note (IN-S06 auto-classification)
On successful ingest a material may gain a `classificationSuggestion { themeId, loId?, confidence }` (LLM best-fit into the existing hierarchy; only stored when `confidence ≥ 0.5` and the names resolve). Accept via `POST .../classification { action: 'accept' }` (merges it into `assignments`, clears the suggestion); reject clears it. Absent/low-confidence ⇒ material shows "Unclassified" client-side.

## Question bank (instructor; TA read paths in Phase 3)
- `GET /api/courses/:courseId/questions?state=&loId=&themeId=&type=&difficulty=&label=` →
  `{ total, questions: [{ id, state, labels, loIds, themeIds, current: QuestionVersion }] }` (IN-Q08)
- `GET /api/questions/:questionId` → full question + current version +
  agentDecision + notes + versions list + optional regeneration request
  history, `templateFamilyId`, and per-version `provenance`
- `PATCH /api/questions/:questionId { stem?, options?, difficulty?, loIds?, themeIds? }` →
  creates a new QuestionVersion; response includes it (IN-Q03)
- `PATCH /api/questions/:questionId/params { paramSlots?, generateScript? }` →
  new/unchanged QuestionVersion (same versioning rules as the generic PATCH above,
  scoped to just the two parameterization content keys); saves independently of
  approval state (IN-Q09, Task 5)
- `POST /api/questions/:questionId/params/preview { paramSlots?, generateScript?, stem? }` →
  `{ draws: [{ seed, values, stem? }] x5, warnings: string[] }` — previews an
  EDIT-IN-PROGRESS candidate (the request body, not the currently-saved version)
  with 5 independently-drawn sample resolutions; `stem` falls back to the
  question's currently-saved stem when omitted from the body; `warnings` lists
  any defined `paramSlots` entry with no matching `{{name}}` placeholder in the
  stem. Never persists anything. (IN-Q09, Task 5)
- `POST /api/questions/:questionId/transition { to }` → question (validated against PUBLICATION_TRANSITIONS; IN-Q04/Q07)
- `POST /api/questions/bulk-transition { questionIds, to }` → `{ updated }`
- `GET /api/courses/:courseId/review-queue` → prioritized list (IN-Q02)
- `POST /api/courses/:courseId/generate`
  `{ loId, count?, type?, difficulty?, prompt? }` or `{ blueprintId }` →
  202 `{ runId }` — a unique durable generation run; results land as Draft
  questions (IN-Q10/Q11). A prompt containing `@filename` (or
  `@"filename with spaces"`) restricts retrieval to the exact ready material
  assigned to the target LO/theme; missing or ambiguous mentions fail without
  falling back to other course material.
- `GET /api/generation/presets` → four editable `{ label, text }` custom-prompt
  starters; requires an authenticated instructor/admin.
- `GET /api/courses/:courseId/generation-blueprints` → newest-first saved
  recipes. `POST` creates and `PATCH /:blueprintId` updates a recipe containing
  name, LO, count, type, optional difficulty/prompt/ready material IDs, and the
  pinned generator/validator/reviewer model snapshot.
- `POST /api/courses/:courseId/generation-blueprints/:blueprintId/run` →
  202 `{ runId }`. The resulting run records `blueprintId`, copies the saved
  recipe, and still sends only `{ runId }` to Agenda.
- `POST /api/courses/:courseId/questions/:questionId/regenerate { prompt }` →
  `{ variant: { stem, options, difficulty, sourceRefs, agentDecision } }`.
  Generates a transient side-by-side alternative and appends
  `{ prompt, at }` to the question's regeneration history, but does not create
  a QuestionVersion or replace current content. Replacement is an explicit
  `PATCH /api/questions/:questionId` after instructor review (IN-Q12).
- `GET /api/courses/:courseId/preseeding` → `[{ loId, loName, approved, reviewed, target: 5 }]`

New question heads default `templateFamilyId` to their own ID. Version-one
provenance is one of `manual`, `generated { runId, blueprintId?, item }`,
`imported { format, sourceName?, item }`, or
`script-migration { sourceName? }`; every content edit creates an immutable
version with `edited { parentVersionId }`. Existing rows without these optional
fields remain readable.

## Question import (instructor)

- `POST /api/courses/:courseId/import/preview` — multipart field `file`
  (`.csv`, `.json`, `.xml`, or `.qti`, maximum 5 MB) →
  `{ format: 'csv'|'json'|'qti', candidates: ImportCandidate[], failures:
  [{ line: number|string, reason }] }`. Parsing is partial-success: an invalid
  row/item is reported without removing valid candidates. No question is
  written during preview.
- `POST /api/courses/:courseId/import/commit
  { candidates, format?, sourceName?, themeId?, loId? }` →
  `201 { imported, autoConverted }`. The preview candidates are untrusted
  round-tripped input and are revalidated as one batch before writes.
  Questions always enter as Drafts; missing assignment ids leave them
  unassigned. `type: 'other'` is converted to MCQ/T-F through the configured
  LLM and labelled `auto-converted`. Numeric candidates meeting the
  two-distinct-values plus currency/percent/rate heuristic are labelled
  `convertible-to-parameterized`.
- `POST /api/courses/:courseId/import/script/preview ScriptMigrationInput` →
  `ScriptMigrationResult`. Runs the instructor-authored `generate(random)`
  script once with a fixed seed in the parameter worker and returns
  `sampleValues`, substituted `sampleStem`/`sampleOptions`, and `mismatches`.
  Nothing is written. A sandbox rejection (including `param-timeout`) is a
  clean `400 script-validation-failed:<reason>`.
- `POST /api/courses/:courseId/import/script/commit { ...ScriptMigrationInput,
  sourceName?, themeId?, loId? }` → `201 ScriptMigrationResult` with `questionId` when the
  generated variable names have stem placeholders and every placeholder in
  the stem/options has a generated value. The server repeats the sandbox run
  and template validation; a mismatch returns `200` with the
  mismatch list, no `questionId`, and no write. A successful import creates
  exactly one parameterized Draft whose v1 stores `generateScript`.

`ImportCandidate` is `{ type: 'mcq'|'true-false'|'other', stem, options:
[{ key, text, role?, explanation? }], correctKey, difficulty?,
parameterizable }`.

`ScriptMigrationInput` is `{ type: 'mcq'|'true-false', stem, options:
[{ key, text, explanation? }], correctKey, difficulty?, script }`.
`ScriptMigrationResult` is `{ questionId?, sampleValues:
Record<string,number>, sampleStem, sampleOptions, mismatches: string[] }`.

## Content runs (instructor; Phase 2 P2-0)

Mongo `contentRuns` is the recoverable source of truth; Agenda remains the
executor. Kinds are `material-ingest | question-generation`; statuses are
`queued | running | completed | partial | failed`. Each snapshot includes a
kind-specific `stage`, monotonic `completedUnits`/`totalUnits?`, `revision`,
request input, result/error/warnings, and timestamps.

- `GET /api/courses/:courseId/content-runs?kind=&status=&limit=` → newest-first
  compact snapshots (bounded `limit` 1–100, default 25; event log omitted).
- `GET /api/courses/:courseId/content-runs/:runId` → full snapshot including the
  bounded persisted event log. A run under another course returns
  `404 content-run-not-found`.
- `POST /api/courses/:courseId/content-runs/:runId/retry` →
  202 `{ runId }` for a distinct exact retry of a terminal generation run.
  The new run copies the original request/model/material snapshot and records
  `retryOfRunId`; the original is never reopened. Material or non-terminal
  runs return 409.
- `GET /api/courses/:courseId/content-runs/events` → authenticated
  `text/event-stream`. On connect/reconnect it sends:

  ```text
  event: snapshot
  data: { "runs": [up to 100 recent compact snapshots, including terminal] }
  ```

  Subsequent persisted mutations send `event: run`, id
  `<runId>:<revision>`, and one compact snapshot. One stream covers the whole
  course, avoiding one browser connection per uploaded file/run. Including
  terminal runs in every reconnect snapshot prevents a client that was offline
  during completion from remaining stuck on its last `running` state.

Material stages: `queued → parsing → chunking → embedding → indexing →
classifying`. Generation stages: `queued → retrieving → generating →
validating → reviewing → persisting`. Generation may finish `partial`; valid
Draft IDs and per-item failures both remain in its result. Interrupted running
work becomes explicit retryable `failed: server-restarted` at startup instead
of remaining indefinitely active.

## Practice (student)
- `GET /api/courses/:courseId/home` → themes visible to the student (≥1 approved question,
  availableFrom passed, not archived) with per-LO mastery labels (ST-P01/P02)
- `POST /api/courses/:courseId/practice/next { loId, sessionServedIds: string[] }` →
  `{ questionId, questionVersionId, type, stem, difficulty, degraded, options: [{ key, text }], watermark, paramValues?, seed? }`
  — never includes roles/explanations/correctness. `stem`/`options` are already substituted
  against a freshly-drawn `seed` for a parameterized question (`paramValues`/`seed` present
  only in that case — see params.service.ts's `resolveParamValues`/`substituteParams`, Task 5,
  IN-Q09/ST-P03). A fresh `seed` is drawn on every call, including Review-Book re-practice
  (ST-R04) — there is one serving call site for both. 404 when no approved question exists.
  Within one client practice round, selection exhausts every unseen Approved
  question for the LO before returning a repeated id. The client treats that
  first repeat as the round boundary and asks explicitly before starting a new
  repeat round.
- `POST /api/attempts { questionVersionId, loId, selectedKey, mode, sessionServedIds, isRetry?, paramValues? }` →
  `{ correct,
     feedback: { strategy: 'a' | 'b',
                 revealed: [{ key, text, role, explanation, correct }] | chosenOnly (all substituted against the pinned paramValues),
                 retry?: { questionId, questionVersionId, type, stem, options: [{ key, text }], paramValues?, seed? } },
     mastery: { loStatus, recommendation? }, reviewBook: { added },
     redirect?: { materials: [{ name, materialId }], message } }` (ST-P04, ST-P07)
  — `paramValues` sent back here are trusted verbatim and pinned onto the AttemptRecord (never
  re-derived/re-validated server-side — they don't affect grading, only the student's own
  displayed feedback numbers). A Strategy-A `retry` question that is itself parameterized carries
  its OWN freshly-resolved `paramValues`/`seed`, independent of the just-answered question's.
  `redirect` appears after the course-configured number of consecutive
  easy/medium misses for that LO. A hard-tier miss breaks the redirect cluster
  so mastery tier step-back has precedence. Redirect responses contain only
  the chosen wrong option (never the current correct answer), do not attach a
  Strategy-A retry, and never block the next-question action.
- `GET /api/courses/:courseId/los/:loId/materials/:materialId/source` →
  `302` to a linked URL material or an authenticated file download. Student
  guard applies; only a ready material assigned to this exact course/LO
  resolves, otherwise 404.
- `POST /api/courses/:courseId/los/:loId/skip { attempted: boolean }` → 204 (ST-P06)
- `GET /api/courses/:courseId/session-summary` →
  `{ deferred?: SessionEndSummary, welcome: boolean }` — start-of-session payload; `welcome: true`
  when the student has no attempts in the course yet, else `deferred` carries the summary stored
  by `PUT .../deferred-summary` at the end of their last session, if any (ST-P11)
- `PUT /api/courses/:courseId/deferred-summary { since: Date }` → `SessionEndSummary`
  `{ losCovered: string[], questionsAttempted, accuracyByLo: [{ loId, attempted, correct, accuracy }],
     reviewBookAdditions: [{ entryId, questionId, loId, themeId }], missedQuestions: string[] }`
  — computes the summary since `since` and stores (upserts) it as the student's deferred
  end-of-session summary for this course, to be surfaced by `GET .../session-summary` next time (ST-P10)

## Instructor student preview

All preview routes require the signed-in user to be an Instructor for the
target course (or Admin). They do not require student enrollment and
intentionally ignore `Course.published`, so an unpublished course can be
tested before release. Theme archival/progressive release and the
Approved-question gate still match the real student experience.

- `GET /api/courses/:courseId/preview/home` → the student-visible hierarchy
  shape from `GET .../home`, with neutral `not-attempted` statuses.
- `POST /api/courses/:courseId/preview/practice/next { loId, sessionServedIds }`
  → the same sanitized/substituted question shape as student
  `POST .../practice/next`.
- `POST /api/courses/:courseId/preview/attempts { questionVersionId, loId,
  selectedKey, sessionServedIds, isRetry?, paramValues? }` → the same feedback
  shape as `POST /api/attempts`, with neutral mastery and
  `reviewBook: { added: false }`.

Preview submissions write only `previewAttemptRecords`, which pin the
Instructor, course/question/version/LO, answer, strategy, parameter values, and
version snapshot. They never enter `attemptRecords`, mastery, Review Book,
flags/auto-pause, remediation, summaries, progression, notifications, or
student analytics. There is no client-controlled `preview` switch on the live
student attempt endpoint.

## Review Book (student)
- `GET /api/courses/:courseId/review-book?sort=` → grouped-by-theme entries (ST-R05)
- `POST /api/questions/:questionId/bookmark` / `DELETE .../bookmark` → entry (ST-R02)
- `DELETE /api/review-book/:entryId` → 204 (never touches answer history, ST-R03)
- Re-practice serves through `POST /api/attempts` with `mode: 'review-book'`.

## Health
- `GET /api/health` (public) → `{ status, mongo, qdrant }`
