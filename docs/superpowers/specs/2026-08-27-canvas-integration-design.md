# Canvas Integration — Design

**Owner:** Saurav
**Created:** 2026-08-27
**Status:** Design approved in conversation; spec awaiting review; implementation
plan not yet written.
**Traces to:** PRD §3 (roster-gated enrollment — "Direct enrollment via …
Canvas integration remain stretch goals"), IN-S04 (material upload), ST-E02/E03
(code + roster enrollment). Promotes the Canvas stretch goal into scope as
Phase 6; gradebook write-back stays a stretch goal.
**Depends on:** `@ubc/ubc-genai-toolkit-lms-integration@^1.2.0` (installed,
2026-08-27); the local Canvas environment in `../local-lms-dev/` (verified
end to end the same day, including the teacher-token roster read).

## Problem

Instructors maintain the FinanceBot roster by hand — a CSV of CWL usernames or
emails uploaded per course — and upload course materials one file at a time
from their own disk, when the same files already sit in the course's Canvas
Files. Both are manual re-entry of data Canvas already holds, and the roster
one is the gate every student's access depends on.

### What already exists

- **Identity.** `User.puid` is the canonical CWL identity, uniquely indexed,
  reloaded onto `req.user` on every request. At UBC, Canvas stores the same
  value in each student's `integration_id` — the one field the LMS package
  will match on. The hardest part of an LMS integration is already solved.
- **Ingestion.** `createMaterials(courseId, files, requestedBy)` in
  `materials.service.ts` takes `{ originalname, path }` pairs on disk under
  `UPLOAD_DIR`, inserts `processing` materials, and enqueues the durable
  content-run pipeline (`attachAndEnqueueRun → ingestMaterial`). Progress and
  retry are already surfaced in the Materials view.
- **Enrollment gate.** `enrollment.service.ts` grants access only when the
  registration code matches *and* `rosterEntries` holds the student's `uid` or
  `email` (lower-cased) for that course.
- **Authorization.** `ensureCourseInstructor()` reads `req.user.courseRoles`
  against `res.locals.courseId`; admins pass. Every instructor route uses it.
- **The package.** Owns Canvas OAuth, token refresh, paginated reads
  (`rel="next"` followed to the end), bounded file download with a redirect
  allowlist, and roster matching on `integration_id` only, with a report whose
  `matched` / `appOnly` / ambiguous keys are disjoint.

### What the local environment proved (2026-08-27)

- A **plain teacher's** OAuth token reads `integration_id` on this Canvas
  (`coverage.integrationId` 2 of 3, identical to the admin key). The matcher
  will work with the token the app actually uses.
- The same token saw `email` and `login_id` on **0 of 3** students. A fallback
  on either would be impossible here even if it were wise.
- `getCourses({ enrollment_type: 'teacher' })` returns only enrolled courses;
  an admin who merely administers the account gets `[]`.

## Goals

1. An instructor connects their own Canvas account once, links a Canvas course
   they teach to a FinanceBot course, and can disconnect or unlink at any time.
2. Files from the linked Canvas course can be imported into the course's
   materials, in the formats upload already accepts, without double-importing.
3. The linked course's Canvas roster can be synced, and a student on it can
   enroll with the registration code alone — no CSV entry required.
4. Every synced or imported thing is inspectable: the match report shows who
   matched and who did not, in both directions, with the coverage that makes
   the numbers trustworthy.

## Non-goals

- **Writing to Canvas.** No grade export, no feedback export, no comments. The
  package supports them; FinanceBot has mastery and attempts, not a gradebook,
  and "what is a grade" is an unanswered product question. A later phase, with
  its own spec.
- **Moodle.** The package is read-only against Moodle and its rosters never
  carry an `integrationId`; the matcher cannot match one. Not mounted.
- **Replacing the manual roster.** The CSV path stays. Synced Canvas entries
  *add* to it (decision 2026-08-27).
- **Submission import, sections, grade reads.** Read paths the package offers
  that no FinanceBot feature consumes. YAGNI.
- **LTI.** OAuth only; an LTI launch is not an API token.
- **Streaming import progress.** The existing content-run progress covers
  ingestion; the download itself is bounded and short.

## Responsibility boundary

The package owns OAuth, refresh, revocation, the authenticated client,
pagination, file retrieval and its redirect policy, roster matching, and the
error classes. FinanceBot owns:

- who is an instructor of which FinanceBot course, on every request;
- the stable token-store key (`req.user.puid`);
- the link between a Canvas course and a FinanceBot course, and deriving every
  `externalCourseId` from that record — never from a request body;
- the enrollment gate and what a synced roster does to it;
- file-type/size policy, disk placement, and the ingestion pipeline;
- what reaches the browser (never `raw`) and what reaches logs (never a PUID,
  token, or Canvas response body).

Never reimplemented in FinanceBot: OAuth, refresh, an HTTP client for Canvas,
pagination, or a fetch of `raw.url`.

Identity stays three-way and never collapses:

```
FinanceBot user (puid) -> token-store key (puid) -> connected Canvas identity
```

A stored token proves a usable credential exists. It does not prove the person
is an instructor of anything; that is FinanceBot's check, made twice — locally
via `ensureCourseInstructor()`, and against Canvas via the teacher course list
at link time.

## Architecture

```
server/src/components/lms/            package wrapper: config, token store, getUserKey
server/src/services/lms-canvas.service.ts   link, files, import, roster sync
server/src/routes/lms-canvas.routes.ts      /api/lms/canvas/*, guards, error mapper
server/src/app.ts                     one append-only mount line
```

`components/lms/index.ts` exports `canvasConfig` (from
`canvas.loadConfigFromEnv`) and `isCanvasConfigured(): boolean`. When any of
the four `CANVAS_*` variables is unset, the router is not mounted and
`/api/lms/canvas/*` 404s — the UI treats that as "this deployment has no
Canvas" and renders nothing.

Config binding:

```ts
canvas.loadConfigFromEnv({
  tokenStore: createMongoTokenStore(() => getDb(), { collectionName: 'lmsCanvasTokens' }),
  getUserKey: (req) => {
    if (!req.user?.puid) throw new Error('Application authentication required');
    return req.user.puid;
  },
  basePath: '/api/lms/canvas/auth',
});
```

`CANVAS_DOMAIN` carries an explicit scheme locally (`http://localhost:9100`);
the package's `normalizeBaseUrl` preserves it and defaults a bare domain to
`https://`. Production uses the bare hosted domain.

Import reuses ingestion end to end: bytes from `canvas.downloadFile` are
written to `UPLOAD_DIR/<randomUUID()><ext>` — the same naming multer uses —
and handed to `createMaterials`. The "Open original" route's realpath check
(`materials.routes.ts:246`) therefore works unchanged.

## Data model

### Course link

Sub-document on `Course` (`types/domain.ts`), the minimum provider reference:

```ts
canvas?: {
  courseId: string;   // Canvas course id, provider-scoped
  name: string;
  code: string;
  linkedAt: Date;
  linkedBy: string;   // puid
};
```

Omitted from API responses except via the `/status`-style link read below.

### `lmsRosterEntries`

One document per Canvas identity per linked course. Only Canvas users who
carry an `integrationId` are stored; the rest are counted in coverage and
reported, never guessed.

```ts
interface LmsRosterEntry {
  courseId: ObjectId;
  provider: 'canvas';
  externalCourseId: string;
  externalUserId: string;
  puid: string;               // Canvas integration_id
  name: string;               // display label only; never evidence
  matchedBy: 'integrationId'; // recorded so a later weaker key cannot change what this meant
  syncedAt: Date;
}
```

Indexes (added to `INDEX_SPECS`, append-only):

```ts
{ collection: 'lmsRosterEntries',
  keys: { courseId: 1, provider: 1, externalCourseId: 1, externalUserId: 1 }, options: { unique: true } },
{ collection: 'lmsRosterEntries',
  keys: { courseId: 1, provider: 1, externalCourseId: 1, puid: 1 }, options: { unique: true } },
```

The second index is what makes two Canvas accounts claiming one PUID a loud
failure rather than a quiet overwrite.

Each sync **replaces** the course's set: delete `{ courseId }`, then insert the
new entries. A student who dropped is gone on the next sync.

### Material origin

Optional field on `Material`:

```ts
origin?: {
  provider: 'canvas';
  externalCourseId: string;
  externalFileId: string;
  sourceUpdatedAt?: Date;  // Canvas `updated_at`
  importedAt: Date;
};
```

Partial unique index, name and options **fixed once deployed** (MongoDB
refuses startup if a partial filter changes under the same index name):

```ts
{ collection: 'materials',
  keys: { courseId: 1, 'origin.provider': 1, 'origin.externalCourseId': 1, 'origin.externalFileId': 1 },
  options: { unique: true, partialFilterExpression: { 'origin.provider': { $type: 'string' } },
             name: 'materials_origin_unique' } },
```

Trashed materials keep their `origin`, so re-importing a trashed file is a
skip, not a duplicate; restoring is the existing path.

### Tokens

`lmsCanvasTokens`, owned by `createMongoTokenStore`. Not a domain type.

### Enrollment gate

`enrollment.service.ts:36` and `:70` gain one lookup, OR'd with the existing
roster hit:

```ts
const rosterHit = await rosterCol().findOne({ courseId, identifier: { $in: identifiers } });
const lmsHit = rosterHit ? null : await lmsRosterEntriesCol().findOne({ courseId, puid: user.puid });
if (!rosterHit && !lmsHit) -> refused, exactly as today
```

Nothing else in enrollment changes. `extendedUntil` remains a `RosterEntry`
concern; a Canvas-only student who needs an extension is added to the manual
roster, which is the escape hatch the "adds to" decision preserves.

## Routes

All under `/api/lms/canvas`. Guard order on course-scoped routes:
`ensureApiAuthenticated()` → `ensureCourseInstructor()` →
`canvas.requireAuth(canvasConfig)`. The package's auth router is mounted
behind `ensureApiAuthenticated()` only — connecting is per person.

| Method & path | Guards | Behaviour |
|---|---|---|
| `GET /auth/login` `GET /auth/callback` `POST /auth/logout` | authenticated | package router. `returnTo` must be a local absolute path; the router enforces it and falls back to `/` |
| `GET /status` | authenticated | `200 { connected: boolean }`. Never 401 — "configured, not connected" is a state the UI renders |
| `GET /courses` | authenticated + canvas | `canvas.getCourses(api, { enrollment_type: 'teacher' })` → `[{ id, name, code }]` |
| `GET /courses/:courseId/link` | instructor | `200 { linked: false }` or `{ linked: true, canvas: { courseId, name, code, linkedAt } }` |
| `PUT /courses/:courseId/link` `{ canvasCourseId }` | instructor + canvas | re-reads the teacher list; **403 `not-teacher`** unless `canvasCourseId` is in it; writes `course.canvas` from the Canvas row, not the body |
| `DELETE /courses/:courseId/link` | instructor | clears `course.canvas` and deletes the course's `lmsRosterEntries`. Imported materials stay |
| `GET /courses/:courseId/files` | instructor + canvas + linked | `canvas.getCourseFiles`, filtered to names `detectUploadFormat` accepts and `size <= 50 MB`; each row `{ id, name, size, updatedAt, alreadyImported }` |
| `POST /courses/:courseId/files/import` `{ fileIds: string[] }` | instructor + canvas + linked | per file: skip if `origin` exists → download `{ maxBytes: 50 MB }` → write → `createMaterials`. `201 { created: Material[], skipped: string[], failed: [{ id, reason }] }` |
| `POST /courses/:courseId/roster/sync` | instructor + canvas + linked | see Roster sync. `200 { report, coverage, syncedAt, stored }` |
| `GET /courses/:courseId/roster/canvas` | instructor + linked | `{ syncedAt, entries: [{ puid, name }] }` |

"linked" = `400 { error: 'not-linked' }` when `course.canvas` is absent.
`externalCourseId` is always `course.canvas.courseId`.

`fileIds` is capped at `MAX_FILES_PER_UPLOAD` (the upload's own limit, 20), so
an import batch is bounded the same way an upload batch is.

Two existing symbols become shared rather than duplicated: `detectUploadFormat`
(`materials.service.ts:135`, currently module-private) is exported, and
`MAX_FILES_PER_UPLOAD` (`materials.routes.ts:117`, a route-file constant) moves
to `materials.service.ts` and is exported, with the route importing it. Both
are one-line changes; the format and size policy must have exactly one
definition.

### Roster sync

```ts
const appUsers = students.map((u) => ({ appUserId: u.puid, key: u.puid }));
//   students = usersCol().find({ courseRoles: { $elemMatch: { courseId, role: 'student' } } })
const report = await canvas.matchCourseRoster(req.canvasApi, externalCourseId, appUsers);
const explained = await canvas.explainUnmatched(req.canvasApi, externalCourseId, report);
```

The report is returned for display. Storage is independent of it: the roster
read that produced the report yields every Canvas user; those with an
`integrationId` become `lmsRosterEntries`, replacing the previous set. A
student who has never logged into FinanceBot is therefore enrollable after
sync — that is the feature — and appears in `rosterOnly` until they do.

Mapping onto FinanceBot's concepts:

| Report bucket | Means here |
|---|---|
| `matched` | enrolled in FinanceBot and on the Canvas roster |
| `rosterOnly` | on Canvas, not yet enrolled — normal, most of a class early on |
| `appOnly` | enrolled here, not on Canvas — `enrollment-ended` (dropped) or `not-enrolled` (wrong course linked?), via `explainUnmatched` |
| `ambiguous` | two Canvas accounts share one `integration_id`. (The app side cannot be ambiguous: `User.puid` is uniquely indexed.) Shown, never written |

`coverage.integrationId` of `coverage.total` is returned and displayed next to
the counts. A non-empty roster with **zero** `integrationId`s makes the package
throw `roster-coverage`; that is surfaced as `409` and **nothing is written** —
the previous entries stay — because the state is indistinguishable from an
empty class and must not be recorded as one.

## Instructor UI

No new page. Two touch points in existing views, driven by one small client
module `client/src/views/instructor/canvas-panel.ts` and API functions
appended to `client/src/api.ts`.

**Settings (`settings.ts`), beside the roster.** A *Canvas* card:

- Probe `GET /status` on load. A `404` means the deployment has no Canvas
  credentials → render nothing. Otherwise show a numbered flow, skipping
  answered steps: *1 Connect · 2 Choose course · 3 Linked*.
- *Connect* navigates to `/api/lms/canvas/auth/login?returnTo=<current path>#canvas`;
  the fragment reopens the card on return.
- *Choose course* lists `GET /courses`; choosing calls `PUT …/link` and shows a
  one-line confirmation of what was linked.
- *Linked* shows name/code, **Sync roster**, and **Unlink**. After a sync, the
  counts — *matched · on Canvas only · in FinanceBot only* — with
  `coverage.integrationId of total` beside them, `syncedAt`, and an expandable
  list per bucket (name, and reason for `appOnly`). Coverage below total shows
  a plain warning: "N students have no student ID visible in Canvas and were
  not added." Zero coverage shows the `409` message: "Canvas isn't exposing
  student IDs to your account; nothing was changed."
- The CSV uploader stays where it is, unchanged. The roster count reads
  "*N* from CSV · *M* from Canvas".

**Materials (`materials.ts`).** An *Import from Canvas* button beside the
upload zone, shown only when `GET …/link` says linked. Opens a `modal.ts`
modal: file list with `alreadyImported` rows disabled, multi-select, a
confirm screen reading the choices back, then `POST …/files/import`. Created
materials appear in the list as `processing`, with the existing run progress;
`skipped` and `failed` are shown inline. Reconnect prompts route to the
Settings card.

Nothing from `raw` reaches the browser. Names are shown; PUIDs are not
logged and are not rendered in the match report beyond what the instructor's
own roster page already shows.

## Error handling

One mapper, `mapCanvasError(err, res)`, in the route file, used by every route.

| Thrown | Response | Meaning to the UI |
|---|---|---|
| `CanvasApiError` 401 (after the package's single refresh attempt) | `401 { error: 'canvas-reconnect' }` | credential dead; show *Reconnect* |
| `CanvasApiError` 403 | `403 { error: 'canvas-forbidden' }` | Canvas denied this identity — includes the roster-scope case where files read but the roster does not |
| `CanvasApiError` other, `LmsError` | `502 { error: 'canvas-unavailable' }` | upstream; not retried |
| `CanvasGradeExportError` `reason: 'roster-coverage'` (thrown by `matchCourseRoster`; the class name is historical) | `409 { error: 'roster-coverage' }` | refused on purpose; nothing written |

Bodies never carry `err.message`, `raw`, headers, or a PUID. Logging is class
name and HTTP status only.

FinanceBot-side refusals happen before any Canvas request: `400 not-linked`,
`403 not-teacher`, `400 invalid-file-ids` (empty, non-array, over the cap).
Duplicates are never a refusal: already-imported ids are skipped and listed,
because failing a whole batch for one duplicate is the failure mode IN-S04's
independent processing was designed to prevent.

Import is per-file independent. A download failing for one id records
`{ id, reason: 'download-failed' | 'too-large' | 'unsupported-format' }` and
the rest proceed. Retrying an import is safe: skipped ids are reported, not
re-ingested.

Retries: none for permission errors; none for writes (there are none). The
only bounded retry is the package's own token refresh.

## Testing

Server-side Jest, per `tests/AGENTS.md`. Route tests mock
`lms-canvas.service` and the package's `canvas` namespace, using the
`courses.routes.test.ts` `makeApp` pattern with a `req.user` fixture carrying
`courseRoles`.

**`tests/unit/lms-canvas.routes.test.ts`**

- 401 unauthenticated; 403 for a TA and a student; 403 for an instructor of a
  different course; admin passes every guard.
- Every course-scoped route returns `400 not-linked` on an unlinked course, and
  the service is not called.
- `PUT link`: id absent from the teacher list → 403 `not-teacher`, nothing
  written; present → `course.canvas` populated from the Canvas row's
  name/code, not from the body.
- `DELETE link` clears the link and the entries.
- `import`: already-imported ids land in `skipped`; one failed download lands
  in `failed` and the others in `created`; `createMaterials` receives paths
  under `UPLOAD_DIR`; a batch over the cap is 400.
- `sync`: `roster-coverage` → 409 and the delete/insert is never called; a
  normal report replaces the set; a Canvas user without `integrationId` is
  absent from what is stored.
- `mapCanvasError`: each class → the documented status; no body contains
  `message`.

**`tests/unit/lms-canvas.service.test.ts`**

- `appUsers` is built from `student` course roles only — instructors and TAs
  on the course are not offered to the matcher.
- Replacement semantics: a PUID present before sync and absent from the new
  roster is gone after.
- Both unique indexes are present in `INDEX_SPECS`; the materials partial index
  has the fixed name.

**`tests/unit/enrollment.service.test.ts`** (extended)

- Student on `lmsRosterEntries` by PUID and on no CSV roster → enrolls.
- Student on neither → refused with the existing error.
- Existing CSV cases pass unchanged.

**Smoke, by hand, against `../local-lms-dev/`** — mocks are not acceptance.
Connect as `teacher1@example.com`, link `FINBOT-DEMO`, import one file and see
it reach `ready`, sync and see **1 matched / 1 rosterOnly / 1 appOnly,
coverage 2 of 3**, then enroll as `cpsc_student` with the registration code
and no CSV entry. Results go in Saurav's Phase 6 STATUS.

## Configuration

Appended to `.env.example` (append-only, one block):

```
# --- Canvas LMS integration (server/src/components/lms) ----------------------
# All four required to mount /api/lms/canvas; leave blank to disable. Local
# values come from ../local-lms-dev/create-developer-key.sh. The redirect URI
# must match the Developer Key byte for byte.
CANVAS_DOMAIN=
CANVAS_CLIENT_ID=
CANVAS_CLIENT_SECRET=
CANVAS_REDIRECT_URI=http://localhost:6118/api/lms/canvas/auth/callback
```

`server/src/config/env.ts` exposes `canvas: { domain, clientId, clientSecret,
redirectUri }` and `canvasEnabled: boolean`. The package's `.npmrc` registry
line is committed; the PAT is not.

Production needs a **scoped** Developer Key listing exactly the endpoints in
use — `GET /api/v1/courses`, `/courses/:id/users`, `/courses/:id/files`,
`/courses/:id/files/:id`, `/courses/:id/enrollments` — with *Allow Include
Parameters* on (`explainUnmatched` sends `include[]=enrollments`). The local
key enforces no scopes; that is a local shortcut, not the production shape.

## Suggested implementation order

1. Component + config + mount + `/status` + auth router — connect/disconnect
   works end to end against local Canvas before anything course-scoped exists.
2. Course link — `GET/PUT/DELETE link`, `GET /courses`, teacher-list check.
3. File import — `files`, `import`, `origin`, the partial index, Materials
   modal.
4. Roster sync — `lmsRosterEntries`, both indexes, `sync`, `roster/canvas`,
   the Settings card's report.
5. Enrollment gate — the one extra lookup, with tests, last: it is the only
   step that changes student-facing behaviour.
6. PRD and `docs/api-contract.md` updates in the same PRs as the code.

## Future work

- Grade or feedback write-back — its own spec; needs a product answer to what
  FinanceBot exports as a grade, and the resolve → preflight → write discipline
  the package enforces.
- Submission import, if a feature ever grades student work.
- Scheduled roster re-sync. Sync is manual in Phase 6 so the instructor sees
  the report every time; automation would need a notification path for
  coverage drops.
- Moodle, only if a non-Canvas institution adopts FinanceBot.
