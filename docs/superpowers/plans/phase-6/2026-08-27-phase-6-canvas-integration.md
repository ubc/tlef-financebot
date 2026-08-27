# Phase 6 — Canvas Integration

**Status:** Started 2026-08-27. Promotes the PRD's "Canvas integration" stretch
goal into scope for course linking, file import, and roster sync. Gradebook
write-back stays a stretch goal.

**Goal:** Stop instructors re-entering data Canvas already holds. An instructor
connects their own Canvas account, links a Canvas course they teach, imports
Canvas Files into the course's materials, and syncs the Canvas roster so a
student on it can enroll with the registration code alone.

**Design:** [`../../specs/2026-08-27-canvas-integration-design.md`](../../specs/2026-08-27-canvas-integration-design.md)
— approved 2026-08-27. Every task below argues from it.

**Local environment:** `../local-lms-dev/` (sibling of the repo). Verified end
to end on 2026-08-27, including the plain-teacher OAuth roster read.

## Global constraints

- `@ubc/ubc-genai-toolkit-lms-integration@^1.2.0` owns OAuth, refresh,
  pagination, download policy, and roster matching. Never reimplement any of
  them; never fetch `raw.url`; never return `raw` to a browser.
- Identity is three-way and never collapses: `req.user.puid` → token-store
  key → connected Canvas identity. A stored token proves a credential, not an
  instructor. `ensureCourseInstructor()` guards every course-scoped route and
  the Canvas teacher list is re-checked at link time.
- Matching is on `integration_id` (= PUID at UBC) **only**. No fallback key.
- `externalCourseId` always derives from `course.canvas`, never a request body.
- Synced Canvas roster entries **add to** the manual roster; the CSV path is
  untouched.
- No PUID, token, or Canvas response body in logs or error bodies.
- Shared-file convention (root `AGENTS.md`): `app.ts`, `collections.ts`,
  `.env.example`, `api.ts`, `main.ts` are append-only.
- Moodle is not mounted. No write paths to Canvas.
- Every task ends green on `npm run typecheck`, `npx eslint <changed files>`,
  and `npx jest`.

## Sync points

None. All six tasks are Saurav-owned. Stephen's Phase 5 work touches
`courses.routes.ts` and `settings.ts` occasionally — rebase on `main` before
each task and keep additions append-only.

### Task 1: Component, configuration, connect/disconnect

**Owner:** Saurav

- [x] `server/src/components/lms/` wraps the package: `loadConfigFromEnv`,
  `createMongoTokenStore` on `lmsCanvasTokens`, `getUserKey → req.user.puid`.
- [x] `env.canvas` + `env.canvasEnabled`; `.env.example` block appended.
- [x] `/api/lms/canvas/auth/*` (package router) and `GET /api/lms/canvas/status`
  mounted only when configured; unconfigured deployments 404.
- [x] Route tests; connect/disconnect verified by hand against local Canvas.

### Task 2: Course link

**Owner:** Saurav

- [x] `Course.canvas` sub-document; `GET /courses`, `GET/PUT/DELETE
  /courses/:courseId/link`.
- [x] `PUT link` refuses any Canvas course not in the teacher list; `DELETE`
  also clears that course's `lmsRosterEntries`.
- [x] Route + service tests; `docs/api-contract.md` section added.

### Task 3: File import into materials

**Owner:** Saurav

- [ ] `Material.origin` + the fixed-name partial unique index.
- [ ] `detectUploadFormat` exported; `MAX_FILES_PER_UPLOAD` moved to the service.
- [ ] `GET /courses/:courseId/files` (importable, `alreadyImported` flagged) and
  `POST /courses/:courseId/files/import` — per-file independent, duplicates
  skipped, bytes written under `UPLOAD_DIR` and handed to `createMaterials`.
- [ ] Route + service tests; contract updated.

### Task 4: Roster sync

**Owner:** Saurav

- [ ] `lmsRosterEntries` collection with both unique indexes.
- [ ] `POST /courses/:courseId/roster/sync` — `matchCourseRoster` +
  `explainUnmatched` against student `courseRoles`; replaces the course's
  Canvas-sourced set; `roster-coverage` → 409 and nothing written.
- [ ] `GET /courses/:courseId/roster/canvas`.
- [ ] Route + service tests; contract updated.

### Task 5: Enrollment gate + PRD

**Owner:** Saurav

- [ ] `enrollByCode` and `listEnrollments` accept an `lmsRosterEntries` hit by
  PUID as an alternative to a CSV roster hit. Nothing else changes.
- [ ] `enrollment.service.test.ts` extended; existing cases unchanged.
- [ ] PRD §3 and §10 updated: Canvas linking/import/roster in scope; gradebook
  write-back remains a stretch goal.

### Task 6: Instructor UI

**Owner:** Saurav

- [ ] `api.ts` functions for every route above.
- [ ] Settings: the *Canvas* card (connect → choose course → linked; sync
  report with coverage; unlink). Hidden when `/status` 404s.
- [ ] Materials: *Import from Canvas* modal, shown only when linked.
- [ ] Hand smoke against local Canvas recorded in Saurav's STATUS: link
  `FINBOT-DEMO` as `teacher1`, import one file to `ready`, sync → 1 matched /
  1 rosterOnly / 1 appOnly, coverage 2 of 3, enroll `cpsc_student` with the
  code alone.
