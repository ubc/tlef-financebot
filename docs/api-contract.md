# FinanceBot API Contract (v1 + Phase 3 Exam Prep workflows)

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
- `POST /api/courses { name, courseCode, section?, term }` → 201 Course; returns
  `409 course-already-exists` when the normalized `(courseCode, section, term)`
  identity already exists. Different sections remain separate courses.
  (platform-Instructor or Admin; faculty affiliation alone is insufficient)
- `GET /api/courses/:courseId` → Course + `themes: [Theme & { los: LearningObjective[] }]`
- `GET /api/courses/:courseId/outline` → `{ themes: [{ _id, name, order, los: [{ _id, name, order }] }] }`
  (capability `question.review` — the TA-accessible subset of the above: theme/LO
  names and order only, none of the course record's registrationCode, term
  dates, autoPause, or feedbackStrategy)
- `PATCH /api/courses/:courseId { name?, courseCode?, section?, term?,
  termStart?, termEnd?, feedbackStrategy?, autoPause?, published? }` → Course
- Course responses expose `lifecycle: 'draft'|'published'|'archived'`,
  `published`, `updatedAt`, and optional `archivedAt`. Legacy rows derive
  lifecycle from `published`/`archivedAt`.
- `GET /api/courses/:courseId/publish-checklist` →
  `[{ item, ok }]` from the same side-effect-free server check used at publish.
- `GET /api/courses/:courseId/instructor-workflow` → the Instructor Launch
  Cockpit read model: course lifecycle, publish-readiness percentage/checklist,
  operational counts, and priority-ordered actions with stable destination
  identifiers. It derives from existing course/content/review/flag/analytics
  state and stores no parallel workflow state.
- `POST /api/courses/:courseId/registration-code` → `{ registrationCode }` (regenerates)
- `POST /api/courses/:courseId/publish` / `POST .../unpublish` → `{ published, checklist: [{ item, ok }] }`
- `POST /api/courses/:courseId/archive` → archived Course;
  `POST .../restore` → restored unpublished Draft. Archived courses remain
  instructor-readable, appear inactive to enrolled students, and reject
  student practice with `403 course-archived`.
- Roster: `PUT /api/courses/:courseId/roster { identifiers: string[] }` → `{ count }`;
  `GET .../roster` → `[{ identifier, extendedUntil? }]`

## Exam Prep templates (instructor)

- `GET /api/courses/:courseId/exam-templates` → `[ExamTemplate]`, sorted by
  kind. One saved template is maintained per course and kind (`midterm` or
  `final`).
- `PUT /api/courses/:courseId/exam-templates/:kind`
  `{ themes: [{ themeId, mcqCount, tfCount, pointsPerQuestion }],
  timeLimitMinutes?, availabilityStart, availabilityEnd, loBreakdown }` →
  `{ template: ExamTemplate, warnings: [{ themeId, themeName, requested,
  available }] }`. Theme ids must be active Themes in the target course. Counts
  and Approved-question supply are split-aware; a shortfall warning never
  blocks the save. Updates apply only to attempts assembled after the save.

## Exam Prep attempts (student)

- `GET /api/courses/:courseId/exams` → currently active `[ExamTemplate]`. The
  client hides Exam Prep when this list is empty.
- `POST /api/courses/:courseId/exams/:templateId/start` → `201 ExamAttempt`.
  Starting the same template again resumes its one open sitting with prior
  answers retained. Assembly uses only Approved questions, follows each
  Theme/type split without duplicates, fixes parameter values for the sitting,
  and records any non-blocking supply shortfall.
- `GET /api/exam-attempts/:attemptId` → `{ attemptId, templateId, kind,
  questions: [{ index, type, stem, options: [{ key, text }], points, answered }],
  answers, shortfalls, startedAt, submitted, submittedAt?, remainingSeconds? }`.
  Before submission this projection never includes option roles, explanations,
  correctness, or answer keys. An expired timed sitting is server-submitted
  before the response is returned.
- `PUT /api/exam-attempts/:attemptId/answers/:index { selectedKey }` → `204`.
  Answers remain changeable until submission.
- `POST /api/exam-attempts/:attemptId/submit` → `{ score, maxScore }`. Submission
  is idempotent, writes one `mode: 'exam-prep'` AttemptRecord per question, and
  auto-collects each miss into the Review Book with its AttemptRecord context,
  then queues the post-exam mastery pass.
- `GET /api/exam-attempts/:attemptId/results` → `{ attemptId, kind,
  submittedAt, score, maxScore, byTheme, byLo?, questions }`. Returns `409`
  before submission. Theme/optional LO breakdown rows contain
  `{ earned, possible }` and weak rows add `practiceLink` metadata. Question
  review contains substituted stems plus all option roles/explanations only
  after submission.
- `GET /api/courses/:courseId/exam-history` → newest-first
  `[{ attemptId, kind, date, score, maxScore }]`; `attemptId` drills into the
  same results endpoint.

## Hierarchy (instructor)
- `POST /api/courses/:courseId/themes { name, availableFrom? }` → 201 Theme
- `PATCH /api/themes/:themeId { name?, availableFrom?, order? }` → Theme
- `POST /api/themes/:themeId/archive` → Theme
- `POST /api/themes/:themeId/los { name }` → 201 LearningObjective
- `PATCH /api/los/:loId { name?, order? }`, `POST /api/los/:loId/archive`

## Materials (instructor)
- `POST /api/courses/:courseId/materials` (multipart, field `files[]`; or JSON `{ url }`) → 201 `[Material]` (successfully queued entries have status `processing` + a unique `activeRunId`; an immediate run-storage/enqueue failure is returned as status `failed` so no row remains stuck)
- `GET /api/courses/:courseId/materials` → `[Material]`
- `GET /api/courses/:courseId/materials-trash` → soft-deleted `[Material]`
- `GET /api/courses/:courseId/materials/:materialId/workspace` →
  `{ material, chunks: [{ index, text, characterCount }] }`; private server
  `storagePath` is never serialized. Legacy ingests without persisted chunks
  expose their retained excerpt as a compatibility preview chunk.
- `GET /api/courses/:courseId/materials/:materialId/source` → authorized inline
  original-file preview or an http(s) redirect for URL materials. File paths
  are realpath-checked under the configured upload directory.
- `DELETE /api/courses/:courseId/materials/:materialId` → Material in Trash.
  This preserves chunks, questions, and provenance but excludes the source from
  retrieval and removes its Qdrant points.
- `POST /api/courses/:courseId/materials/:materialId/restore` → Material with a
  new `activeRunId`; restore re-runs parse → chunk → embed → index → classify.
- Material responses expose `kind:
  'lecture'|'reading'|'assignment'|'assessment'|'solution'|'reference'|'other'`.
  New rows receive a deterministic name-based suggestion; legacy rows normalize
  to `other`.
- `PATCH /api/courses/:courseId/materials/:materialId { kind }` → Material
  (instructor correction; course-scoped)
- `POST /api/materials/:materialId/retry` → Material with a new `activeRunId` (409 when another retry already won)
- `PUT /api/materials/:materialId/assignments { assignments: [{ themeId, loId? }] }` → Material
- `POST /api/materials/:materialId/classification { action: 'accept' | 'reject' }` → Material
- `GET /api/courses/:courseId/suggest-hierarchy` → `{ themes: [{ name, los:
  [name] }], assignments: [{ themeIndex, loIndex, materialIds }] }` (IN-S06;
  read-only AI-suggested outline plus per-LO source mappings)
- `POST /api/courses/:courseId/apply-suggested-hierarchy { themes: [{ name, los:
  [{ name, materialIds }] }] }` → `{ themesCreated, losCreated,
  materialsAssigned, assignmentsCreated }` (creates the reviewed Topic/LO
  subset and merges its source mappings into material assignments)
- `GET /api/courses/:courseId/content-map` → ordered Theme/LO coverage with
  assigned material summaries/kind counts, assessment-like markers,
  question counts by publication state, latest ingest/generation run status,
  unassigned materials, and gaps (`no-material`,
  `no-approved-questions`, `thin-approved-set`).
- `GET /api/courses/:courseId/knowledge-graph` →
  `{ nodes, edges, truncated }` for the inspectable
  Material → Evidence → Concept → Topic/LO → Question graph. Trashed sources
  remain visible as provenance nodes; the overview caps evidence nodes per
  source while the material workspace endpoint returns the full chunk list.

## Materials (instructor) — implementation note (Knowledge Workspace automation)
On successful ingest the classifier infers material kind, extracts evidence-
backed concepts, and may return multiple existing Topic/LO matches. Resolved
matches at confidence `≥ 0.85` are auto-applied and remain instructor-editable;
matches from `0.65` through `< 0.85` enter Review; lower or invented hierarchy
names never become assignments. Kind/concept extraction still runs when the
course has no hierarchy, supporting materials-first authoring. The legacy
singular `classificationSuggestion` stays populated for the first review item
so existing accept/reject clients remain compatible.

When the hierarchy itself is AI-generated after materials were uploaded, each
suggested LO carries the material ids that support it. Applying the reviewed
suggestion creates the selected hierarchy and persists those assignments
automatically; existing assignments are preserved and cross-course/non-ready
material ids are rejected before hierarchy creation begins.

## Question bank (instructor; TA read paths in Phase 3)
- `GET /api/courses/:courseId/questions?state=&loId=&themeId=&type=&difficulty=&label=` →
  `{ total, questions: [{ id, state, labels, loIds, themeIds, current: QuestionVersion }] }` (IN-Q08)
- `GET /api/questions/:questionId` → full question + current version +
  agentDecision + notes + versions list + optional regeneration request
  history, `templateFamilyId`, and per-version `provenance`
- `PATCH /api/questions/:questionId { stem?, options?, difficulty?, loIds?, themeIds? }` →
  creates a new QuestionVersion; response includes it (IN-Q03)
- `POST /api/questions/:questionId/internal-notes { text }` → appended
  `{ puid, text, at }` teaching-team-only note. Notes are append-only and are
  excluded from student and bank-list response shapes.
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
- `POST /api/questions/:questionId/transition { to }` → question (validated
  against `PUBLICATION_TRANSITIONS`; Instructor `draft → approved` is a legal
  one-click approval, and `archived → draft` is the only restore path)
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

## Instructor flag resolution

- `GET /api/courses/:courseId/flags?state=` → flags joined with their question
  head and current version. `source: 'instructor-preview-test'` identifies a
  TEST case that does not affect student analytics or auto-pause.
- `POST /api/flags/:flagId/resolve`
  `{ action: 'correct' | 'archive' | 'clear', correctnessAffecting?, comment? }`
  → resolved flag. `comment` is the optional student-facing reply; internal
  teaching-team comments use the question internal-notes endpoint.
- `GET /api/flags/:flagId/remediation` → correctness-impact report.
- `POST /api/flags/:flagId/remediation/notify` → `{ notified }`. TEST flags
  always return zero and never notify real students.
- In the Instructor UI, editing from the Flag Queue saves the real question,
  resolves all open flags for that version as corrected, and invokes affected
  student notification by default. Return-to-students leaves content
  unchanged; Reject & Archive is idempotent across grouped flags.

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
Approved-question gate still match the real student experience. Entering
Preview creates a fresh browser-scoped UUID and swaps the entire client into
the real Student shell; refresh keeps that walkthrough, while Exit Preview
clears it.

Every stateful Preview request carries `previewSessionId` (UUID):

- `GET /api/courses/:courseId/preview/home?previewSessionId=...`
- `POST /api/courses/:courseId/preview/practice/next`
  `{ previewSessionId, loId, sessionServedIds }`
- `POST /api/courses/:courseId/preview/attempts`
  `{ previewSessionId, questionVersionId, loId, mode, selectedKey,
     sessionServedIds, isRetry?, paramValues? }`
- `POST /api/courses/:courseId/preview/questions/:questionId/flag`
  `{ previewSessionId, reason?, sendToInstructorQueue? }` →
  `{ flagged: true, testQueued }`. The option defaults to false; when true it
  additionally creates a live queue item sourced as
  `instructor-preview-test`.
- `GET /api/courses/:courseId/preview/review-book?previewSessionId=...&sort=theme|date`
- `POST /api/courses/:courseId/preview/questions/:questionId/bookmark`
  `{ previewSessionId }`
- `DELETE /api/courses/:courseId/preview/questions/:questionId/bookmark?previewSessionId=...`
- `DELETE /api/courses/:courseId/preview/review-book/:entryId?previewSessionId=...`
- `POST /api/courses/:courseId/preview/los/:loId/skip`
  `{ previewSessionId, attempted }`
- `GET /api/courses/:courseId/preview/session-summary?previewSessionId=...&since=...`
  — omit `since` for the start-of-session shape.
- `GET /api/courses/:courseId/preview/los/:loId/materials/:materialId/source`
  — Instructor-gated remediation source with the same course/LO assignment
  checks as Student mode.

The response shapes match their Student equivalents. Preview attempts replay
the real mastery calculation and feedback strategy; misses can populate the
Preview Review Book, flags can be submitted, summaries reflect the walkthrough,
and remediation links remain usable.

Isolation is structural rather than a client-controlled `preview` flag:
submissions write only `previewAttemptRecords`, while mutable Review Book and
flag state lives only in `previewStudentSessions`. Both are keyed by Instructor,
course, and Preview session and expire after 24 hours. Preview never writes live
attempt, mastery, Review Book, summary, progression, or analytics collections.
The explicit `sendToInstructorQueue` TEST option is the sole exception: it
writes a live instructor-queue flag and staff notification, but never adds a
student-flag label, contributes to auto-pause, or notifies a real student.

## Review Book (student)
- `GET /api/courses/:courseId/review-book?sort=` → grouped-by-theme entries (ST-R05)
- `POST /api/questions/:questionId/bookmark` / `DELETE .../bookmark` → entry (ST-R02)
- `DELETE /api/review-book/:entryId` → 204 (never touches answer history, ST-R03)
- Re-practice serves through `POST /api/attempts` with `mode: 'review-book'`.

## Teaching assistants

Instructor-managed membership uses UBC email invitations. A matching SAML
login activates the pending invitation and adds a course-scoped `ta` role.
Permissions are evaluated immediately through the capability model; the hard
TA deny for `question.approve` and `flag.resolve` cannot be overridden.

- `GET /api/courses/:courseId/tas` / `POST .../tas { email }` — list or invite.
- `PUT /api/courses/:courseId/tas/:puid/permissions { permissions }` — replace
  the TA's course overrides; `POST .../:puid/reinvite` restores an expired TA.
- `GET /api/courses/:courseId/ta/review-queue` — review data plus teaching-team
  suggestions/notes, without approve/reject operations.
- `POST /api/questions/:questionId/mark-reviewed` — transition to `reviewed`.
- `POST /api/questions/:questionId/suggestions { stem?, options?, difficulty?,
  loIds?, themeIds? }` — store an unsaved proposed patch. Instructor-only
  `POST .../suggestions/:suggestionId/accept|discard` resolves it; accept applies
  the stored patch through normal question versioning.
- `POST /api/questions/:questionId/notes { text }` — attributed internal note,
  never included in student practice or exam payloads.
- `GET /api/courses/:courseId/ta/flags` and `POST /api/flags/:flagId/escalate
  { recommendation, note? }` — triage an open flag into the Instructor queue.
- `POST /api/questions/:questionId/escalate { reasonCategory, note? }` — create
  a proactive TA escalation without pretending it came from a student.

The daily `tas.term-expiry` job removes course TA roles after `termEnd`; a
re-invite restores the saved permission configuration.

## Instructor analytics

Class analytics routes require `analytics.view`; individual student search and
profiles require `analytics.individual`. Preview records are structurally
excluded because every calculation reads only live collections.

- `GET /api/courses/:courseId/analytics/failure-rates?mode=topic-practice|exam-prep`
  — Theme rates with expandable LO rates. Any group below five attempts returns
  `{ attempts, insufficient: true }` and no rate.
- `GET /api/courses/:courseId/analytics/questions/:questionId/distribution` —
  option counts/percentages and a common-misconception highlight when its share
  exceeds 1.5 times the uniform expectation; the five-attempt floor applies.
- `GET /api/courses/:courseId/analytics/engagement?from=&to=` — totals and
  weekly questions, active students, sessions, average session minutes, LO
  coverage, and Review Book activity. A gap over 30 minutes starts a session.
- `GET /api/courses/:courseId/analytics/engagement.csv` — the weekly rows as an
  RFC-style escaped CSV download.
- `GET /api/courses/:courseId/analytics/low-engagement?inactiveDays=7` —
  enrolled students at or beyond the inactivity threshold, including students
  with no attempts.
- `GET /api/courses/:courseId/students?q=` — search enrolled students by name,
  CWL, or email.
- `GET /api/courses/:courseId/students/:puid/analytics` — identity, chronological
  attempts (including Exam Prep), mastery/qualifiers, engagement, Review Book,
  and student flag events.

## Admin essentials

Every route below requires platform Admin, and every successful state-changing
operation writes an audit entry.

- `GET /api/admin/directory?q=&role=&courseId=` — searchable user directory
  with course roles and deactivation state.
- `PUT|DELETE /api/admin/users/:puid/courses/:courseId/roles/:role` — assign or
  remove a Student, Instructor, or TA role. Removing a course's final Instructor
  first returns `409 { warning: 'orphans-course' }`; repeat the DELETE with
  `?confirm=true` to proceed.
- `POST /api/admin/users/:puid/deactivate|reactivate` — retain records while
  revoking/restoring all access. Passport returns no identity for a deactivated
  user on the next request.
- `GET /api/admin/capabilities?courseId=` / `PUT /api/admin/capabilities` —
  platform defaults or a separate per-course matrix, including effective-value
  source labels. TA approval and flag resolution remain hard-locked off.
- `GET|PUT /api/admin/platform-settings` — generator, validator, reviewer, and
  future mastery-evaluator model selectors; positive daily generation limit;
  Reviewer Agent and Layer-2 evaluator feature flags. Turning Reviewer Agent
  off requires `confirmQualityImpact: true`. New generated Drafts then skip the
  reviewer call and persist a flagged decision with the disabled-reviewer
  reason. Exceeding the daily requested-question limit returns 429.

## Health
- `GET /api/health` (public) → `{ status, mongo, qdrant }`
