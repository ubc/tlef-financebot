# FinanceBot API Contract (v1 + Phase 2 P2-0 content runs)

All endpoints are under `/api`, JSON in/out, session-cookie authenticated
unless marked public. IDs are Mongo ObjectId hex strings.

**Error format (all endpoints):**
`{ "error": string, "issues"?: [{ "path": string, "message": string }] }`
Status codes: 400 validation, 401 unauthenticated, 403 wrong role/course,
404 not found, 409 conflict (e.g. duplicate enrollment), 503 background queue unavailable.

**Auth guards:** `student` = enrolled in the course; `instructor` = course
instructor (owner/co-instructor); `ta` = course TA; `admin` = platform admin.

## Auth
- `GET /api/auth/me` (public) → `{ authenticated, user?: { puid, uid, displayName, isAdmin, affiliations, courseRoles } }`

## Enrollment (student)
- `POST /api/enrollments { code }` → 201 `{ courseId, name, courseCode }`
  Errors: 404 code not recognized; 403 `not-on-roster`; 410 `course-ended`;
  409 `already-enrolled` (informational, no duplicate created). (ST-E02)
- `GET /api/enrollments` → `[{ courseId, name, courseCode, term, active }]`

## Courses (instructor)
- `POST /api/courses { name, courseCode, term }` → 201 Course
- `GET /api/courses/:courseId` → Course + `themes: [Theme & { los: LearningObjective[] }]`
- `PATCH /api/courses/:courseId { termStart?, termEnd?, feedbackStrategy?, autoPause?, published? }` → Course
- `POST /api/courses/:courseId/registration-code` → `{ registrationCode }` (regenerates)
- `POST /api/courses/:courseId/publish` / `POST .../unpublish` → `{ published, checklist: [{ item, ok }] }`
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
- `POST /api/materials/:materialId/retry` → Material with a new `activeRunId` (409 when another retry already won)
- `PUT /api/materials/:materialId/assignments { assignments: [{ themeId, loId? }] }` → Material
- `POST /api/materials/:materialId/classification { action: 'accept' | 'reject' }` → Material
- `GET /api/courses/:courseId/suggest-hierarchy` → `{ themes: [{ name, los: [name] }] }` (IN-S06; AI-suggested outline, read-only — apply via the Theme/LO create endpoints above) <!-- ADDED in Task 7 (Saurav); pending two-developer review -->

## Materials (instructor) — implementation note (IN-S06 auto-classification)
On successful ingest a material may gain a `classificationSuggestion { themeId, loId?, confidence }` (LLM best-fit into the existing hierarchy; only stored when `confidence ≥ 0.5` and the names resolve). Accept via `POST .../classification { action: 'accept' }` (merges it into `assignments`, clears the suggestion); reject clears it. Absent/low-confidence ⇒ material shows "Unclassified" client-side.

## Question bank (instructor; TA read paths in Phase 3)
- `GET /api/courses/:courseId/questions?state=&loId=&themeId=&type=&difficulty=&label=` →
  `{ total, questions: [{ id, state, labels, loIds, themeIds, current: QuestionVersion }] }` (IN-Q08)
- `GET /api/questions/:questionId` → full question + current version + agentDecision + notes + versions list
- `PATCH /api/questions/:questionId { stem?, options?, difficulty?, loIds?, themeIds? }` →
  creates a new QuestionVersion; response includes it (IN-Q03)
- `POST /api/questions/:questionId/transition { to }` → question (validated against PUBLICATION_TRANSITIONS; IN-Q04/Q07)
- `POST /api/questions/bulk-transition { questionIds, to }` → `{ updated }`
- `GET /api/courses/:courseId/review-queue` → prioritized list (IN-Q02)
- `POST /api/courses/:courseId/generate { loId, count?, type?, difficulty?, prompt? }` →
  202 `{ runId }` — a unique durable generation run; results land as Draft questions (IN-Q10/Q11)
- `GET /api/courses/:courseId/preseeding` → `[{ loId, loName, approved, reviewed, target: 5 }]`

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
- `POST /api/courses/:courseId/practice/next { loId?, themeId?, sessionServedIds: string[] }` →
  `{ question: { questionId, questionVersionId, type, stem, options: [{ key, text }], loId, themeId, paramValues? }, watermark }`
  — never includes roles/explanations/correctness. 404 when no approved question exists.
- `POST /api/attempts { questionVersionId, loId, selectedKey, mode, sessionServedIds, isRetry?, paramValues? }` →
  `{ correct, feedback: { strategy: 'a' | 'b', revealed: [{ key, text, role, explanation }] | chosenOnly, retryAvailable },
     mastery: { loStatus, recommendation? }, reviewBook: { added } }` (ST-P04)
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

## Review Book (student)
- `GET /api/courses/:courseId/review-book?sort=` → grouped-by-theme entries (ST-R05)
- `POST /api/questions/:questionId/bookmark` / `DELETE .../bookmark` → entry (ST-R02)
- `DELETE /api/review-book/:entryId` → 204 (never touches answer history, ST-R03)
- Re-practice serves through `POST /api/attempts` with `mode: 'review-book'`.

## Health
- `GET /api/health` (public) → `{ status, mongo, qdrant }`
