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
- `GET /api/courses` → the authenticated user's live Instructor-role
  `[Course]`, preserving role order. Duplicate role entries are collapsed and
  historical role entries for deleted courses are omitted without emitting a
  per-course 404. Admin access alone is not a list-all capability.
- `GET /api/courses/:courseId` → Course + `themes: [Theme & { los: LearningObjective[] }]`
- `GET /api/courses/:courseId/outline` → `{ themes: [{ _id, name, order, los: [{ _id, name, order }] }] }`
  (capability `question.review` — the TA-accessible subset of the above: theme/LO
  names and order only, none of the course record's registrationCode, term
  dates, autoPause, or feedbackStrategy)
- `PATCH /api/courses/:courseId { expectedRevision, name?, courseCode?, section?, term?,
  termStart?, termEnd?, feedbackStrategy?, autoPause?, published? }` → Course
- Course responses expose `lifecycle: 'draft'|'published'|'archived'`,
  `published`, `updatedAt`, and optional `archivedAt`. Legacy rows derive
  lifecycle from `published`/`archivedAt`.
- `GET /api/courses/:courseId/publish-checklist` →
  `[{ item, ok }]` from the same side-effect-free server check used at publish.
- `GET /api/courses/:courseId/instructor-workflow` → the Instructor Launch
  Cockpit read model: course lifecycle and optional `termStart`/`termEnd`,
  publish-readiness percentage/checklist, operational counts, guided setup
  state, and priority-ordered actions with stable destination identifiers.
  `counts` includes Topic/LO and operational counts plus material state
  (`materials`, `readyMaterials`, `processingMaterials`, `failedMaterials`,
  `materialsNeedingReview`, `unassignedMaterials`) and question state
  (`totalQuestions`, `approvedQuestions`, `reviewQueue`, `thinLos`,
  `activeGenerationRuns`). `setup.steps` is the ordered five-step
  Sources → Learning Objectives → Questions → Review → Student Preview path;
  each row has `{ id, number, label, status, detail, destination, count?,
  blockedBy? }`, where status is `not-started | blocked | in-progress |
  needs-attention | ready | complete`. `setup.primaryAction` is the one
  recommended next action and carries the normal action fields plus
  `presentation: 'dialog'|'workspace'|'preview'`; `actions` remains the full
  ordered queue. The dates let Course Home complete its blocking setup action
  in context. All setup/action state derives from existing course, material,
  content-run, hierarchy, question/review, flag, analytics, and isolated-preview
  records and stores no parallel wizard state.
- `POST /api/courses/:courseId/outline`
  `{ themes: [{ name, los: string[] }] }` → `201 { themesCreated, losCreated,
  themes: [{ _id, name, created, los: [{ _id, name, created }] }] }`. This
  Instructor-only batch creates or reuses active Topics (domain `Theme`) by
  trimmed, case-insensitive name within the course and active LOs by the same
  rule within their Topic. Duplicate LO names in one request are collapsed.
  Retrying after a partial write or lost response therefore fills only missing
  names instead of duplicating the already-created outline. Input is limited to
  1–50 Topics and 1–100 non-empty LOs per Topic; invalid outlines return 400.
- `POST /api/courses/:courseId/registration-code` → `{ registrationCode }` (regenerates)
- `POST /api/courses/:courseId/publish` / `POST .../unpublish` → `{ published, checklist: [{ item, ok }] }`
- `POST /api/courses/:courseId/archive` → archived Course;
  `POST .../restore` → restored unpublished Draft. Archived courses remain
  instructor-readable, appear inactive to enrolled students, and reject
  student practice with `403 course-archived`.
- `DELETE /api/courses/:courseId { confirmation }` →
  `{ deleted: true, courseId, deletedFiles, missingFiles, deletedVectorCollection,
  cancelledJobs, deletedDocuments }`. This is an irreversible owner/Admin-only
  cascade, separate from Archive. `confirmation` must exactly equal
  `DELETE <courseCode> <section>` (with the section omitted when absent). It
  removes the course hierarchy, materials/chunks/uploaded files/Qdrant
  collection, question versions, attempts and mastery, Review Book, exams,
  flags/notifications/audit records, roster, TA/capability configuration,
  generation state, and every user's role for the course. Active background
  work returns `409 course-delete-active-work`; co-instructors receive
  `403 course-delete-owner-required`. Current `uploads/` and the historical
  `server/uploads/` location are allow-listed. Historical regression fixtures
  are accepted only when they match the exact
  `.claude/worktrees/<name>/uploads/<uuid>.<supported-extension>` or
  `/[private/]tmp/tlef-*/uploads/<uuid>.<supported-extension>` shape.
  Already-missing legacy files increment `missingFiles` without blocking
  deletion, while an existing file outside those narrow rules still fails closed.
- Roster: `PUT /api/courses/:courseId/roster { identifiers: string[] }` →
  `{ count, rejected: [{ line, value, reason }] }`;
  `GET .../roster` → `[{ identifier, extendedUntil? }]`
  - An identifier is a **CWL username or email**, never a student number: a
    roster entry is only ever matched against `user.uid` / `user.email`, and the
    SAML assertion releases no student number. Identifiers that cannot match are
    dropped rather than stored and returned in `rejected`, whose `reason` is one
    of `student-number`, `malformed-email`, `invalid-characters`, `duplicate`.
    They used to be stored, which produced rosters that saved cleanly and then
    failed every enrolment with `not-on-roster`.
- `POST /api/courses/:courseId/roster/preview` (multipart, field `file`, optional
  `column`) → `{ columns, selectedColumn, identifiers, rejects, totalRows }`.
  Parse-only — writes nothing. Detects the identifier column in an uploaded CSV
  (e.g. a Workday roster export); `column` overrides the detection. Errors:
  400 `roster-file-required`, 400 `roster-file-unreadable`, 413 on >2MB.

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

## Authoring concurrency

Course, Theme, LearningObjective and Material records expose an optional integer
`revision`; missing legacy revisions mean `0`. The editor mutations below require
`expectedRevision` and atomically compare it before saving, then increment the
stored revision. Missing/invalid tokens return `400`; a stale token returns `409`
with a draft-preservation message and makes no write. Course settings and a
`published` change in the same PATCH share one atomic precondition. Settings and
structure forms retain unsaved inputs on conflict; material metadata retains its
dirty fields and original baseline through progress refreshes and rejected saves.

Background ingestion/classification and explicit archive/restore actions advance
these tokens too. AI classification compares its original material revision before
writing, so a manual correction made during inference survives. Bulk/AI outline
apply holds a renewable course lease and reuses active Topic/LO names on retry;
a simultaneous apply returns `409` and preserves the submitted draft. The lease
expires after five minutes if its process stops. Separate manual create, roster,
and lifecycle/action endpoints keep their existing contracts.

## Hierarchy (instructor)
- `POST /api/courses/:courseId/themes { name, availableFrom? }` → 201 Theme
- `PATCH /api/themes/:themeId { expectedRevision, name?, availableFrom?, order? }` → Theme
- `POST /api/themes/:themeId/archive` → Theme
- `POST /api/themes/:themeId/los { name }` → 201 LearningObjective
- `PATCH /api/los/:loId { expectedRevision, name?, order?, kind? }`, `POST /api/los/:loId/archive`

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
- `PATCH /api/courses/:courseId/materials/:materialId { kind, expectedRevision }` → Material
  (instructor correction; course-scoped)
- `POST /api/materials/:materialId/retry` → Material with a new `activeRunId` (409 when another retry already won)
- `PUT /api/materials/:materialId/assignments { expectedRevision, assignments: [{ themeId, loId? }] }` → Material
- `POST /api/materials/:materialId/classification { expectedRevision, action: 'accept' | 'reject' }` → Material
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
  `{ total, questions: [{ id, state, labels, loIds, themeIds, current: QuestionVersion, contentReady }] }` (IN-Q08)
- `GET /api/questions/:questionId` → full question + current version +
  agentDecision + notes + versions list + optional regeneration request
  history, `templateFamilyId`, and per-version `provenance`
- `PATCH /api/questions/:questionId { stem?, options?, difficulty?, loIds?,
  themeIds?, paramSlots?, derivedValues?, numericKind?, type?, sourceRefs?,
  expectedVersionId, expectedTags?: { loIds, themeIds }, submitForReview? }` → creates one new
  QuestionVersion; response includes it (IN-Q03). The numeric fields let an
  explicitly accepted regeneration replace template text and its computed
  answer definition atomically rather than briefly exposing placeholders
  without their gate metadata. `submitForReview: true` requires a version pin and
  an Approved/Paused head; the new version pointer and Pending Review state change
  in one compare-and-set write. Stale pins return 409, old AI decisions are cleared,
  and existing versions/history remain intact. Type edits validate the new option
  shape. Source-reference edits may only reference materials in the same course.
  Replacing either tag array requires the loaded `expectedTags` snapshot; exact
  version, state and tag comparisons prevent silently replacing a teammate's edit.
  `contentReady` on bank rows uses the server numerical/placeholder serving gate;
  the UI also requires course publication and release of every tagged Topic before
  describing a question as student-visible. Default Bank UI requests Approved only;
  the general browse endpoint retains its existing semantics for other consumers.
- `POST /api/questions/:questionId/internal-notes { text }` → appended
  `{ puid, text, at }` teaching-team-only note. Notes are append-only and are
  excluded from student and bank-list response shapes.
- `PATCH /api/questions/:questionId/params { expectedVersionId, paramSlots?, derivedValues?,
  numericKind?, generateScript? }` → new/unchanged QuestionVersion plus
  `verification` on success or `verificationError` on failure. Numerical
  questions must display exactly one computed derived value in every option;
  all displayed option values are checked across the stored sample seeds.
  Saves independently of approval state (IN-Q09, Task 5).
- `GET /api/questions/:questionId/sample` → `{ seed, stem, options,
  parameterized }`, one read-only rendering produced by the same resolver used
  for student serving.
- `POST /api/questions/:questionId/params/preview { paramSlots?, derivedValues?,
  generateScript?, stem? }` →
  `{ draws: [{ seed, values, stem? }] x5, warnings: string[] }` — previews an
  EDIT-IN-PROGRESS candidate (the request body, not the currently-saved version)
  with 5 independently-drawn sample resolutions; `stem` falls back to the
  question's currently-saved stem when omitted from the body; `warnings` lists
  any defined `paramSlots` entry with no matching `{{name}}` placeholder in the
  stem. Never persists anything. (IN-Q09, Task 5)
- `POST /api/questions/:questionId/transition { to, expectedVersionId, rejectionReason? }` →
  question (validated against `PUBLICATION_TRANSITIONS`; Instructor `draft →
  approved` is a legal one-click approval, and `archived → draft` is the only
  restore path). The required `expectedVersionId` compare-and-sets both the
  reviewed content version and publication state; a stale version or state
  returns `409 { error: "question-conflict" }`. Editors retain local drafts on conflict.
  Optional `rejectionReason` is trimmed, limited to 2,000 characters, and only
  accepted for `to: "archived"`. A non-empty reason is appended as a private
  teaching-team note in the same version/state-guarded Mongo update as archival;
  conflicts persist neither change. The response includes the appended note.
- `POST /api/questions/bulk-transition { questionIds, to }` → `{ updated }`
- `POST /api/questions/bulk-delete { questionIds }` → `{ deleted, skipped: [{ questionId, reason }] }` — hard-deletes never-served questions only (never approved; no attempt, exam attempt, flag or review-book reference). Anything else is skipped with `reason` ∈ `ever-approved` | `has-history` | `not-found`; archive those instead. Same course-span and instructor guards as bulk-transition.
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
  `{ variant: { stem, options, difficulty, paramSlots?, derivedValues?,
  numericKind?, verification?, sourceRefs, agentDecision } }`.
  Generates a transient side-by-side alternative and appends
  `{ prompt, at }` to the question's regeneration history, but does not create
  a QuestionVersion or replace current content. Replacement is an explicit
  `PATCH /api/questions/:questionId` after instructor review (IN-Q12).
- Numerical QuestionVersions expose `numericKind`, `paramSlots`,
  `derivedValues`, and an optional `verification { evaluatorVersion,
  sampleSeeds, verifiedAt }`. Serving of practice/retry/preview candidates and
  assembly of new Exam Prep attempts fail closed for detected numerical
  versions without a current evaluator proof. Existing assembled exam sittings
  retain their pinned versions and values.
- `GET /api/courses/:courseId/preseeding` →
  `[{ loId, loName, approved, reviewed, unapproved, target: 5 }]`, where
  `unapproved` counts question heads in `draft`, `pending-review`, `reviewed`,
  or `paused`. It excludes both `approved` and `archived`, so authoring clients
  can avoid paying for a duplicate generation batch while existing work is
  still awaiting review without letting discarded questions block generation.

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
- `GET /api/courses/:courseId/home` → themes visible to the student (≥1 Approved
  question whose current version passes the serving/numeric-verification gate,
  availableFrom passed, not archived) with per-LO mastery labels (ST-P01/P02)
- `POST /api/courses/:courseId/practice/next { loId, sessionServedIds: string[] }` →
  `{ questionId, questionVersionId, type, stem, difficulty, degraded, options: [{ key, text }], watermark, paramValues?, seed? }`
  — never includes roles/explanations/correctness. `options` are served in stored order, which
  for an MCQ was shuffled once when the version was created (questions.service.ts,
  `shuffleOptions`) and relabelled A–D by position, so a key does NOT identify the same option
  across two versions of a question. True/False keeps `T` then `F`. `stem`/`options` are already substituted
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

## Teaching-team student preview

All preview routes require the signed-in user to be an Instructor or current
TA for the target course (or Admin). A TA role removed by expiry or revocation
loses access on the next request, using the same current-course role checks as
the TA workspace. Students, nonmembers and staff in another course cannot use
these routes. They do not grant persistent roles or require student enrollment and
intentionally ignore `Course.published`, so an unpublished course can be
tested before release. Theme archival/progressive release and the
Approved-question gate still match the real student experience. Entering
Preview creates a fresh browser-scoped UUID and swaps the entire client into
the real Student shell; refresh keeps that walkthrough, while Exit Preview
clears it.

Every stateful Preview request carries `previewSessionId` (UUID):

- `GET /api/courses/:courseId/preview/identity` →
  `{ name, courseCode, section?, term }`. Read-only course picker identity;
  requires the same teaching-team Preview access, without a session UUID or
  `question.review` capability. Returns no hierarchy or private settings and
  does not create Preview state. The existing `/outline` gate remains unchanged.
- `GET /api/courses/:courseId/preview/home?previewSessionId=...`
- `POST /api/courses/:courseId/preview/practice/next`
  `{ previewSessionId, loId, sessionServedIds }`
- `POST /api/courses/:courseId/preview/attempts`
  `{ previewSessionId, questionVersionId, loId, mode, selectedKey,
     sessionServedIds, isRetry?, paramValues? }`
- `POST /api/courses/:courseId/preview/questions/:questionId/flag`
  `{ previewSessionId, reason?, sendToInstructorQueue? }` →
  `{ flagged: true, testQueued }`. The option defaults to false; when true it
  additionally creates a live queue item for course Instructors/Admins sourced as
  `instructor-preview-test`. The Preview **UI** always sends the option
  for Instructor/Admin previews (2026-08-08, PI feedback). TA previews always
  keep flags isolated: the server ignores `sendToInstructorQueue: true` for
  a user whose only teaching-team access to this course is TA and returns
  `testQueued: false`. The API default itself is unchanged, and the live
  student path never sends the option.
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
  — teaching-team-gated remediation source with the same course/LO assignment
  checks as Student mode.

The response shapes match their Student equivalents. Preview attempts replay
the real mastery calculation and feedback strategy; misses can populate the
Preview Review Book, flags can be submitted, summaries reflect the walkthrough,
and remediation links remain usable.

Isolation is structural rather than a client-controlled `preview` flag:
submissions write only `previewAttemptRecords`, while mutable Review Book and
flag state lives only in `previewStudentSessions`. Both are keyed by the signed-in
teaching-team user (the existing stored `instructorPuid` field), course, and
Preview session and expire after 24 hours. Preview never writes live
attempt, mastery, Review Book, summary, progression, or analytics collections.
The `sendToInstructorQueue` TEST option is the sole exception, and since
2026-08-08 the Instructor/Admin Preview UI sends it on every flag — so their Preview walkthrough
that flags a question always writes one live instructor-queue flag and one
staff notification. It never adds a student-flag label, contributes to
auto-pause, or notifies a real student, and it leaves every other live
collection (attempts, mastery, Review Book, session summaries) untouched.

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

Class aggregate routes require `analytics.view`; named inactivity lists, student
search and profiles require `analytics.individual`. Preview records are
structurally excluded because every calculation reads only live collections.

- `GET /api/courses/:courseId/analytics/failure-rates?mode=topic-practice|exam-prep&from=&to=&loId=`
  returns active Theme/LO rates including zero-attempt LOs. Mode defaults to
  Topic Practice; dates omitted mean all time. Archived LOs/themes are excluded;
  each attempt counts once against its recorded LO in the current active hierarchy.
  Groups below five attempts return `{ attempts, insufficient: true }`, no rate.
- `GET /api/courses/:courseId/analytics/question-patterns?mode=&from=&to=&loId=&limit=`
  returns `{ items, total, limit }`. Limit is 1–50, default 20. Total counts matching
  question/version groups before limiting, never people. Groups are ordered by
  attempts descending with stable id ties. Each item has `questionId`, `versionId`,
  `stem`, recorded `loId/loName`, `themeId/themeName`, `objectiveCount`, `attempts`, `insufficient`,
  optional `failureRate/misconceptionRate`, `version`, `available`, `isCurrent`.
  Rates are absent below five. Multi-LO questions group once per version in the
  scope; `objectiveCount` counts distinct recorded LOs in that scope. Cards with
  multiple recorded LOs show their count, rather than a single-LO label. Archived
  and missing historical sources retain explicit historical labels. Metadata is
  batch-resolved only against course-owned questions and their versions.
- `GET /api/courses/:courseId/analytics/questions/:questionId/distribution?versionId=&mode=&from=&to=&loId=`
  returns selected `questionId/versionId/version/stem/isCurrent`, attempt count,
  threshold status, options with key/text/role/count and percentages only at five
  attempts. Explicit version must belong to that question in the authorized
  course (404 otherwise); malformed ids return 400. Omitted version now means
  current-version attempts only, an intentional correction to prior mixed-version
  counts. Omitted mode retains all modes. No current-version substitution occurs
  for missing historical content. The legacy misconception highlight is retained.
- `GET /api/courses/:courseId/analytics/engagement?from=&to=&mode=` returns totals
  and weekly rows, including empty weeks (Sunday UTC). Omitted mode retains all
  modes; omitted dates retain the past 12 weeks. The dashboard passes identical
  explicit dates/mode to outcomes, patterns and engagement. All-time uses Unix
  epoch as `from`, with weekly output beginning at first evidence (or this week
  when empty). `questionsAttempted` is a legacy field name meaning submissions,
  not unique questions. Sessions split after gaps over 30 minutes; observed
  duration is last minus first attempt, not inferred study time. Sessions per
  student divides by active students. Coverage intersects recorded LO ids with
  active LOs, never exceeding 100%; Review Book activity intersects active users.
- `GET /api/courses/:courseId/analytics/engagement.csv` accepts the same filters
  and exports the same weekly rows with RFC-style escaping.
- All dates are exact inclusive timestamps; invalid dates or reversed ranges
  return 400. Valid optional LO filters constrain recorded attempt LO, not every
  current tag attached to a multi-objective question.
- `GET /api/courses/:courseId/analytics/low-engagement?inactiveDays=7` returns
  enrolled students at or beyond the independent all-mode inactivity threshold,
  including no-attempt students. It now requires `analytics.individual` because
  it exposes named people, an intentional permission correction.
- `GET /api/courses/:courseId/students?q=` searches name, CWL or email.
- `GET /api/courses/:courseId/students/:puid/analytics` returns identity,
  chronological attempts, mastery, Review Book, engagement and flag events.
  Additive `objectives` labels list active LOs and their topics. Attempts include
  `recordedVersion`, rendered `stem`, and `options` from their pinned version and
  saved parameter values when that version exists. Missing versions omit these
  fields. This profile is a course-wide snapshot, independent of dashboard dates.
- `GET /api/courses/:courseId/analytics/exam-scores?from=&to=&puid=` requires
  `analytics.individual`. Returns `{items, excludedUnscored}` for submitted Exam
  Prep sittings, filtered by submission timestamp and optional PUID. Items contain
  `id`, `puid`, `displayName`, `templateId`, `templateKind`, `submittedAt`, `score`,
  and `maxScore`. Unsubmitted or unscored sittings are excluded. Every sitting,
  including repeats, counts once; clients group by template before computing a
  normalized mean. These are practice exam results, not official course grades.

The dashboard uses explicit Refresh (no analytics SSE), current course capability
projection, scoped retries and stale-response guards. Question Bank accepts a
course-valid `loId` query; review links carry `analyticsVersionId` and show the
recorded content separately from the current editor.

## Admin essentials

Every route below requires platform Admin, and every successful state-changing
operation writes an audit entry.

- `GET /api/admin/directory?q=&role=&courseId=` — searchable user directory
  with course roles and deactivation state.
- `GET /api/admin/courses` →
  `[{ _id, name, courseCode, section?, term, lifecycle: 'draft' | 'published' | 'archived' }]`
  — minimal all-course identities for Admin role assignment, including archived
  courses; sorted by term descending, then course code, section and name. This
  does not change the Instructor-scoped `GET /api/courses` contract and never
  returns registration codes or private course settings.
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

## Contextual tutorials

Tutorial progress is account-scoped and always uses the authenticated session's
PUID. Clients cannot read or change another user's state. A completed or skipped
tutorial is not shown automatically again unless its server-defined version is
increased; both remain manually replayable from Settings.

- `GET /api/tutorials?role=student|instructor|ta|admin` — role catalogue plus each
  tutorial's `not-viewed`, `completed`, or `dismissed` status.
- `PUT /api/tutorials/:tutorialId { role, status: completed|dismissed }` — upsert
  the signed-in user's progress at the current tutorial version.
- `DELETE /api/tutorials?role=student|instructor|ta|admin` — reset that role's progress
  for the signed-in user.

Tutorial catalogue roles include Student, Instructor, TA and Admin. Admin tutorial
reads, writes and resets require an Admin session; other tutorial progress is
account-owned, non-privileged product help. Foreign role/id combinations return
404. PUID is always taken from the authenticated session. Reset deletes only that
account/role. Tutorials do not write consent, course permissions or approvals.

The client ignores obsolete account/route responses, requires every visible
target before starting and suppresses tours in Student Preview, Instructor TA
View and timed sittings. Navigation and missing/replaced targets cancel without
recording completion. Help routes are `/help`, `/instructor/help`, `/admin/help`
and `/ta/course/:id/help`; Student Settings embeds the same role-aware hub.

`GET /api/courses/:courseId/capabilities/me` returns only the signed-in user's
`Record<Capability, boolean>` for that course. Authentication and course
membership are required (Admin retains its existing override); foreign course
reads return 403. It reuses the existing layered resolver and TA hard denies.
It does not accept a target PUID or a role override. Instructor TA View sees the
real Instructor's booleans, while the TA views still omit approval/resolution.


### Guided generation submission identity (2026-09-14)

`POST /api/courses/:courseId/generation-plan` additionally accepts optional
`submissionId` (UUID) and `prompt` (trimmed, max 4000 characters). The guided
composer supplies both; legacy callers without an ID keep existing behavior.
The submission ID is scoped to course and authenticated PUID. Its ordered cells
and prompt are immutable: a changed request using that ID returns 409
`generation-submission-conflict`. Each cell derives one stable content-run ID;
Mongo's unique `_id` prevents concurrent retries from enqueuing a second worker
for that cell. The response remains `{ runs: [{ loId, difficulty, kind, count,
runId?, error? }] }`. Cells failing before run creation remain independently
retryable; an existing failed run is returned, not silently restarted. Use the
existing explicit run retry endpoint for failed background work. If the process
stops between run insertion and Agenda enqueue, existing startup reconciliation
marks interrupted work failed/retryable; replay does not silently enqueue it.

`generationSubmissions` stores the immutable request fingerprint, course, owner
and creation time. It is removed with permanent course deletion. Client recovery
stores its request identity and returned run IDs under account+course scope;
known run IDs are fetched individually to avoid recent-history truncation.
`GET /api/courses/:courseId/content-runs?status=queued|running` returns all matching
active runs (history `limit` does not truncate these two status queries). Other
status/history requests retain the existing limit behavior. Existing course
Instructor authorization applies throughout.

### Streaming generation preview (additive, instructor-only)

Question-generation run summaries and full snapshots may include
`preview: { item: number, attempt: number, stem: string }`. `item` is zero-based;
`attempt` resets the visible text on a model/JSON retry. This is the latest
unverified candidate's visible top-level stem, capped at 12,000 characters. It is
not a saved question, approval target, or student-visible content. Existing guarded
course SSE `run` events carry the cumulative preview with monotonic run revisions;
reconnect snapshots restore it. Writes are coalesced to 250ms intervals and drained
before normal pipeline stage transitions. Preview ticks retain stage-event history
and never increment completed units. Validation, reviewer decisions, numerical
proofs and publication remain authoritative after generation.

The additive generation `preview` now also accepts `difficulty?: string` and
`options?: Array<{ key: string; text: string; role?: string; explanation?: string }>`.
Each partial option streams independently even when the stem is unchanged. At most
8 options are exposed; option text and explanation are each capped at 4,000
characters, key at 8 and role at 40. Difficulty is capped at 30. Only those public
fields are projected from JSON; raw/internal metadata is excluded. Proposed roles
are unverified and may change or be re-keyed by validation before the saved version.
An attempt reset replaces the entire preview, clearing previous options and answers.


### Analytics prototype interaction alignment (2026-09-15)
Question patterns additionally accept `q` (literal search, at most 200 characters)
and `themeId`. Search matches recorded-version stems, objective names and topic
names before the result limit; counts reflect matching groups. Answer distributions
also accept `themeId` so topic drilldowns keep their recorded-attempt scope.
Engagement totals include `correctAttempts` only when at least five attempts exist.
Student search adds latest `lastAttemptAt` and persisted `strugglingObjectives`;
these are course-wide, independent of dashboard dates, and remain individual-gated.

### Portable Question Bank CSV
Question Bank exports the selected rows, or the current filtered view when no rows
are selected. CSV uses the existing import columns plus optional `roleA` through
`roleD`, preserving distractor roles and explanations. Import still creates new
Drafts and does not copy approval, release state, source references or course IDs.
Parameterized questions export their stable rendered sample as static questions;
if a rendered sample is unavailable, the export fails explicitly rather than
silently dropping the row or exporting unresolved placeholders. Script migration
remains the separate route for preserving executable parameterization.

### Course Structure: multi-material AI outline

`POST /api/courses/:courseId/structure-generation` (course Instructor only) accepts
`{ materialIds?, topicCount?, losPerTopic?, level?, emphasis?, guidance? }` and returns
`202 { runId }`. Omitting counts lets the model choose topic boundaries and a
separate objective count for each topic. `topicCount` is 1–30, `losPerTopic` 1–12;
`level` is `auto | introductory | advanced`; `emphasis` is
`auto | balanced | conceptual | applied`; guidance is at most 2,000 characters.
Omitted materials select all ready, non-Trash course materials. Selected IDs must
all resolve within the course. No Topics or LOs are created by generation.

The run kind is `structure-generation`, with `queued → analyzing → synthesizing →
checking` stages, delivered by the existing course `content-runs/events` SSE route.
`completedUnits/totalUnits` measure analyzed source sections, not claimed semantic
coverage. `structurePreview.themes[].{name,los:[{name}]}` contains unverified visible
provider text; resets replace that preview on a provider retry. On completion,
`structureResult` contains reviewed-ready themes with full LO names, evidence IDs
and server-resolved material IDs; an evidence ledger of exact source quotes and
chunk indices; and coverage including per-material counts, unmapped learning
points, exclusions and warnings. It never exposes provider reasoning.

Run snapshots survive navigation and reconnect. A partial unique index allows
one active structure run per course; concurrent starts return that run. Existing
`POST .../content-runs/:runId/end` stops a structure run, while `end-active` remains
question-generation-only. An in-flight provider call may finish; subsequent calls
and writes are blocked. New generation is explicit. Interrupted runs are marked
retryable on startup. Completed drafts are read-only history until the existing
`apply-suggested-hierarchy` endpoint is explicitly called with reviewed selections;
apply preserves existing Topics/LOs and material assignments.

The analyzer reads every persisted chunk of every selected material, partitions
long chunks with overlap, extracts grounded learning points per section, then
synthesizes across the entire ledger. It uses neither top-k vector retrieval nor
beginning-only excerpts. Every section must be accounted for; quotes and reference
IDs are checked against their source. Missing chunks, changed sources and exceeded
capacity fail explicitly rather than silently omitting input. Limits are 100
materials / 1,000,000 source characters and a 180,000-character synthesis ledger.
Coverage refers to parsed text, not image-only content or absent syllabus topics.
The legacy GET `suggest-hierarchy` retains its old response shape but now uses the
same full-source analyzer.

Structure-generation compact run summaries also expose optional `progressMessage`
(the latest durable stage/progress message), so the UI can show source analysis and
reference-repair progress without fetching full event history. Full run snapshots
retain their existing event history. Extraction uses server-numbered passage IDs;
`structureResult.evidence[].quote` remains the exact resolved original passage.

## Course sharing and collaborative question drafts

Course sharing requires a real Instructor role in the course, or Admin. Only
its owner/Admin can manage members. Sharing never grants platform-wide course
creation permission. An owner/Admin can enter either a CWL login name or UBC
email. CWL must resolve to an existing User; email may remain pending and match
the canonical email saved by SAML on first login. Grants persist the canonical
PUID after activation. No email delivery is performed.

- `GET /api/courses/:courseId/instructors` → `{ courseId, courseName, courseCode,
  section?, term, ownerPuid, canManage, members, invitations }`.
- `POST /api/courses/:courseId/instructor-invitations { identifier }` → same
  summary. `identifier` accepts CWL or UBC email. Known users activate
  immediately; an unknown UBC email remains pending until first login. Unknown
  CWL returns `404 course-sharing-cwl-not-found`. The legacy `{ email }` body is
  accepted for compatibility.
- `DELETE /api/courses/:courseId/instructor-invitations/:invitationId` → summary.
- `DELETE /api/courses/:courseId/instructors/:puid` → summary; owner removal409.
  Revocation removes share-derived access on the next authenticated request,
  including already-open collaborative streams. Other course roles are retained.

Below, `D` is `/api/courses/:courseId/questions/:questionId/draft`. These routes
require real Instructor/Admin authoring capability, reject archived resources,
validate both resource ids together, and re-read permissions for every request
and stream tick. Teaching-role previews do not confer permissions.

- `GET D` → snapshot `{ state, revision, baseVersionId, currentVersionId,
  questionType, optionKeys, conflict, committing, updatedAt, collaborators }`.
  `state` is a base64 Yjs document; ordered `optionKeys` and `questionType` come
  from its persisted base version, even after an external schema change.
- `POST D/updates { update }` → snapshot. Base64 incremental Yjs updates merge
  under a Mongo compare-and-set and are safe to retry after a lost response.
  Inputs are bounded to90000 base64 characters and durable state to2MB.
- `GET D/events` → authenticated SSE `snapshot` events from durable state.
  Streams re-read at one-second intervals across processes. Auth/lifecycle
  failures send `unavailable` then close; transient failures reconnect normally.
- `PUT D/presence { clientId: UUID, field }` →204. Identity/name come from the
  session; presence expires after30 seconds, with ten-second browser heartbeats.
- `DELETE D/presence/:clientId` →204; only that session user's presence is removed.
- `POST D/commit { expectedRevision, requestId: UUID }` → `{ versionId }`.
  Saves one validated immutable version and moves it to Pending Review. Numeric
  answers are verified against the stored formulas; shared drafts never approve
  or publish themselves. A short persisted lease protects the submitted snapshot.
  Private version journal markers recover interrupted head/draft updates; retries
  use the same request id. Existing attempts retain their original versions.
- `POST D/rebase { expectedRevision, expectedVersionId }` → snapshot. After an
  explicit side-by-side comparison, retains the shared content against the newly
  confirmed saved baseline. Both revisions must match. Different question types
  or option keys require manual merge in the full editor; download preserves all
  original draft fields. No automatic overwrite or destructive reset occurs.

The browser's `Edit together` action is available from Bank, Review and question
details. Text uses shared CRDT fields; difficulty/answer-role choices use shared
map values and are validated together at commit. Unsynced changes remain in the
open tab with retry, download and leave protection. This is not a promise of
browser-crash/offline-disk recovery or simultaneous binary-file editing. Course,
Theme, LO and material forms use revision conflicts rather than text merging;
explicit roster/lifecycle actions retain their existing action contracts.

## Canvas integration (2026-09-28)

All endpoints require a CWL session. `/canvas/*` connection/course listing requires
Admin, platform Instructor, or an existing course Instructor. Course endpoints
require `ensureCourseInstructor()`. Mutations require same-origin JSON requests.
OAuth uses the read-only UBC LMS toolkit scopes; tokens are never returned.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/api/canvas/status` | `{configured, connected, domain, canvasUserId?}` |
| POST | `/api/canvas/connect` | `{returnTo?}` → `{url}` for Canvas OAuth |
| GET | `/api/canvas/callback` | Validates single-use session/user-bound state; redirects |
| POST | `/api/canvas/disconnect` | 204; deletes tokens and pauses dependent Canvas grants |
| GET | `/api/canvas/courses` | Active teacher courses `{id,name,code}[]` |
| GET | `/api/courses/:courseId/canvas` | Link revision, sources, sync timestamps/error, autoEnroll, masked roster; or null |
| PUT | `/api/courses/:courseId/canvas` | `{sourceIds: string[], revision: string|null, autoEnroll: boolean}` → 204 |
| POST | `/api/courses/:courseId/canvas/sync` | 204; atomic complete-roster refresh |
| DELETE | `/api/courses/:courseId/canvas` | `{revision}` → 204; Canvas-only grants end |
| GET | `/api/courses/:courseId/canvas/files` | Source-labelled file metadata; no signed URLs |
| POST | `/api/courses/:courseId/canvas/import` | `{sourceId,fileId}` → 201 `{materialId,name,status}` |

One Canvas course can be linked to one FinanceBot course; one FinanceBot course
can combine up to 20 Canvas courses. Entire Canvas course rosters include their
native sections. Active StudentEnrollment, TeacherEnrollment and TaEnrollment
map to course student, instructor and ta roles. Observer, Designer, unknown,
custom teaching roles and section-limited teaching enrollments grant nothing.
Enrollment course_id must match the source course; invited/inactive/completed
memberships grant nothing. The roster is unioned by exact Canvas login_id
(matched to authenticated CWL ubcEduCwlPuid) and consistent Canvas user ID;
missing/conflicting Login IDs
abort the refresh. Source changes use revision CAS; collisions return 409.
Snapshots refresh every five minutes and grant access for at most thirty minutes
without a successful refresh. identityVersion=login-id-v1 is required: old
integration_id snapshots grant nothing until successfully refreshed. autoEnroll
controls all Canvas-derived roles. CWL session projection excludes archived and
expired courses. Students additionally require publication and term start;
teaching roles can prepare draft/future courses. No platformInstructor or Admin
permission is inferred. Canvas grants never persist into manual User.courseRoles.
Every session reload recomputes grants, preserving independently assigned roles.
The existing students response contains only members with a student grant. Importing the same Canvas file version is idempotent;
changed versions create separate materials with `canvasSource` provenance.

Canvas role synchronization also requires the read-only Developer Key scope
`url:GET|/api/v1/courses/:course_id/enrollments`. Existing connections must reconnect
after the administrator enables it. This endpoint is the fallback if course users
omit enrollment metadata; unreadable/incomplete data aborts the snapshot.

### Canvas People workspace (2026-10-01)

`GET /api/courses/:courseId/canvas` adds optional `people` containing Canvas user
ID, name, source IDs, Canvas role labels, enrollment states, masked identity,
match status and `isSelf` derived from the authenticated viewer. Full Login IDs
are not returned. `students` remains for compatibility. Older snapshots omit
`people`; the UI requests a sync rather than implying all roles were loaded.
Snapshots read active and invited students, teachers, TAs, observers and designers.
Display members deduplicate by Canvas ID; restricted/custom roles and identities
without Login IDs can be displayed without granting FinanceBot permissions.
Only the existing active, exact-identity authorization rules produce grants.

The global instructor workspace is `#/instructor/canvas`, with a selected course
at `#/instructor/canvas/:id`. Legacy course Canvas URLs redirect there. All API
reads and writes retain course-scoped Instructor guards. Course cards are unchanged.

## Student learning v2 and course Discussion

The following endpoints are additive. Existing Topic Practice and Exam Prep
contracts remain in place. Live learning is Student-only; every course endpoint
validates the current course role. Discussion accepts Students, current TAs and
Instructors. Its moderation actions are independently enforced in the service:
only Instructors/Admins close/reopen, pin, delete and restore; teaching-team
members can post official answers, endorse student answers and resolve posts.

- `GET|PUT /courses/:courseId/learning-settings` (Instructor): `{ revision,
  mode: 'topic-practice'|'linear', order: 'instructor'|'personalized',
  questionOrder: questionId[], notes: [{ questionId, visibility:
  'always'|'after-submit', text?, materialId?, pageStart?, pageEnd? }] }`.
  PUT is revision guarded. Ready material references must belong to the course
  and be assigned to an objective of the question.
- `GET /courses/:courseId/learning/library` returns all currently servable,
  Approved, released questions plus the caller's own bookmarks, private tags,
  first lesson completion and review timestamps. No answers/option roles are
  included. Personalization uses only the caller's graded LO evidence and
  preserves teacher order inside each objective; without evidence teacher order
  remains unchanged.
- `POST /courses/:courseId/learning/sessions` accepts `{ kind:
  'lesson'|'test'|'cards'|'browse', themeId?, questionIds?, random?, roundId? }`.
  Lessons resume one durable topic sequence; reopening appends newly released questions once while keeping existing answers and versions. Review tests/cards use a caller
  generated UUID roundId for retry-safe finite rounds. Parameters and versions
  are pinned server-side; the client never supplies grading values.
- `GET|PUT /courses/:courseId/learning/sessions/:id`: PUT `{ revision, action:
  'draft'|'move'|'submit'|'reveal'|'rate', key?, cursor?, rating? }`. Drafts and
  skips remain answerable. The first submitted answer is immutable. Graded
  submissions reveal full explanations and do not enqueue forced retries.
  `reveal` applies only to browse/cards. Self-ratings do not create attempts or
  mastery evidence. Stale revisions return 409; ownership failures return 404.
- `GET /courses/:courseId/learning/sessions/:id/material` serves only the
  current question's visible configured notes material; after-submit visibility
  cannot be bypassed by guessing a source id.
- `PUT /courses/:courseId/learning/questions/:id/metadata` accepts explicit
  `{ saved?, confusing?, tags? }`, including bookmarks before any attempt.
- `GET|POST /courses/:courseId/discussion`: GET accepts `offset` (pages of 100 with `hasMore`); POST `{ title, text, category:
  'general'|'concept'|'method'|'explanation'|'material'|'logistics'|'note',
  audience: 'course'|'staff', anonymous, questionId?, themeId?, loId? }`.
  Question linkage overrides caller-provided Topic/LO; without a question both
  fields are optional. Staff-only posts are visible only to the author and
  teaching team. Classmate projections never include anonymous identities.
- `GET /courses/:courseId/discussion/questions[/:id]`: released question
  picker or stem/options preview, always without correctness and explanations.
- `PUT /courses/:courseId/discussion/:id`: `{ revision, action:
  'reply'|'close'|'reopen'|'delete'|'restore'|'pin'|'resolve'|'endorse'|'vote'|
  'follow', text?, kind: 'student'|'instructor'|'followup', anonymous?,
  replyId?, value? }`. Closed posts remain readable and reject new replies.
  Delete is soft; Instructor restore is available for 24 hours. Official answers
  are named; student answers and follow-ups may be anonymous to classmates.

Live learner identity always comes from the authenticated session. All learning
and Discussion routes above also exist under `/courses/:courseId/preview/` with
mandatory `?previewSessionId=<UUID>`, guarded by current course Instructor/TA
access. They use separate expiring collections. Preview does not grant live
Student or moderation access. No notifications are sent by these new endpoints.
Permanent course deletion includes all new live and Preview records.
