# FinanceBot API Contract (v1 — Phase 1 surface)

All endpoints are under `/api`, JSON in/out, session-cookie authenticated
unless marked public. IDs are Mongo ObjectId hex strings.

**Error format (all endpoints):**
`{ "error": string, "issues"?: [{ "path": string, "message": string }] }`
Status codes: 400 validation, 401 unauthenticated, 403 wrong role/course,
404 not found, 409 conflict (e.g. duplicate enrollment).

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
- `POST /api/courses/:courseId/materials` (multipart, field `files[]`; or JSON `{ url }`) → 201 `[Material]` (status `processing`)
- `GET /api/courses/:courseId/materials` → `[Material]`
- `POST /api/materials/:materialId/retry` → Material
- `PUT /api/materials/:materialId/assignments { assignments: [{ themeId, loId? }] }` → Material
- `POST /api/materials/:materialId/classification { action: 'accept' | 'reject' }` → Material

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
  202 `{ jobId }` — pipeline runs async; results land as Draft questions (IN-Q10/Q11)
- `GET /api/courses/:courseId/preseeding` → `[{ loId, approved, reviewed, target: 5 }]`

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
- `GET /api/courses/:courseId/session-summary` → start-of-session payload (ST-P11)

## Review Book (student)
- `GET /api/courses/:courseId/review-book?sort=` → grouped-by-theme entries (ST-R05)
- `POST /api/questions/:questionId/bookmark` / `DELETE .../bookmark` → entry (ST-R02)
- `DELETE /api/review-book/:entryId` → 204 (never touches answer history, ST-R03)
- Re-practice serves through `POST /api/attempts` with `mode: 'review-book'`.

## Health
- `GET /api/health` (public) → `{ status, mongo, qdrant }`
