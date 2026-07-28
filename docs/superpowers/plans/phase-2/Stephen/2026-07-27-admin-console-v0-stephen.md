# Admin Console v0 — Stephen Implementation Plan

**Owner:** Stephen  
**Implementing agent:** Codex  
**Status:** Approved for planning and implementation by Stephen on 2026-07-27  
**Concurrent work:** Task 5 released on PR #34; Admin A1 complete on PR #36;
Student Preview A2 active on an explicit #37 + #36 integration stack

This is a deliberately small staging-enablement slice, not the full PRD Admin
surface. It adds two capabilities Stephen needs now:

1. an Admin can grant or revoke a global platform-Instructor capability by CWL
   username; and
2. a course Instructor can open the real student practice UI in an explicit
   preview mode without enrolling as a student or polluting production learning
   records.

The work is split so Claude and Codex can proceed without silently editing the
same files. Both agents must follow the claim protocol in
[`coordination/CODEX.md`](coordination/CODEX.md) and
[`coordination/CLAUDE.md`](coordination/CLAUDE.md).

## Decisions

### Identity and roles

- `User.platformInstructor?: boolean` is the global grant that exposes the
  Instructor shell and authorizes course creation.
- `isAdmin` remains controlled only by `ADMIN_CWL_ALLOWLIST`. Admin v0 does not
  grant or revoke Admin access.
- `courseRoles[].role === 'instructor'` remains the authority for an existing
  course. A platform Instructor does not automatically gain access to every
  course.
- Creating a course grants its creator that course's Instructor role, as
  `createCourse()` already does.
- The UI is not the security boundary. Server routes enforce Admin,
  platform-Instructor, and course-Instructor permissions independently.

### CWL username is not PUID

The existing `User` collection is uniquely keyed by SAML
`ubcEduCwlPuid` (`puid`), while the value an Admin normally types is the CWL
username (`uid`). Admin v0 must not create a fake `User` whose `puid` contains
a CWL username: the first real SAML login would create a second User and lose
the grant.

Instead:

- normalize the entered CWL username with `trim().toLowerCase()`;
- store a small pending platform-Instructor grant keyed by normalized CWL
  username;
- update an already-existing matching User immediately when one exists; and
- on first SAML login, apply the pending grant to the real PUID-backed User.

Later SAML refreshes update identity attributes but must preserve an Admin-set
`platformInstructor` value. Revocation removes the pending grant and clears the
flag on a matching existing User.

### Student preview

- Preview uses explicit course-Instructor-guarded endpoints. Do **not** loosen
  `ensureCourseStudent()` globally; it also protects flags, Review Book, skip,
  summaries, and other real-student operations.
- Preview bypasses student enrollment and `Course.published`, allowing an
  Instructor to inspect both published and unpublished courses.
- Preview still serves only `Question.state === 'approved'`. “Unpublished
  course” must not be confused with draft/rejected/paused/archived questions.
- Preview respects the same `Theme.availableFrom` behavior as a student
  viewing the course now. A future “preview as of date” control is out of
  scope.
- Preview submissions are server-derived preview activity. The client cannot
  turn an ordinary student attempt into or out of preview mode with a trusted
  boolean.
- Preview records are structurally isolated from live `attemptRecords` so they
  cannot affect mastery, Review Book, auto-pause ratios, remediation fan-out,
  session summaries, recommendations, notifications, or analytics.
- The preview UI always shows a persistent “Instructor preview — no student
  progress will be saved” banner.

## Admin v0 non-goals

- Admin-role management or removal of `ADMIN_CWL_ALLOWLIST`
- TA provisioning
- capability matrices
- cross-course analytics or performance monitoring
- platform settings or feature flags
- audit-log UI
- impersonating a named real student
- previewing draft/rejected/paused/archived question versions
- writing preview activity into a real student's mastery or Review Book

## API contract

All Admin routes require an authenticated `req.user.isAdmin`.

### Platform-Instructor grants

- `GET /api/admin/platform-instructors?query=<text>`
  - returns matching active/pending grants and any linked User identity;
  - never returns secrets or raw SAML payloads.
- `PUT /api/admin/platform-instructors/:uid`
  - idempotently grants the normalized CWL username;
  - body is empty;
  - records the acting Admin and timestamps;
  - updates an existing User immediately or remains pending until first login.
- `DELETE /api/admin/platform-instructors/:uid`
  - idempotently revokes the grant;
  - clears the matching User's `platformInstructor` flag.

Every grant/revoke writes an `AuditLog` action (`role.assign` /
`role.revoke`) with the grant document as its target. The Admin accounts page
calls these endpoints and labels a grant as either `active` (linked to a User)
or `pending first login`.

### Instructor preview

- `GET /api/courses/:courseId/preview/home`
- `POST /api/courses/:courseId/preview/practice/next`
- `POST /api/courses/:courseId/preview/attempts`

All three routes require `ensureCourseInstructor()`. Their response fields
mirror the student home/practice contracts closely enough for the student view
to render through a preview API adapter. Preview attempt responses include
feedback but no durable mastery/review-book mutation.

The preview routes live separately from `/api/attempts` and the
student-guarded practice routes. This makes the authorization and data boundary
visible in routing, tests, and logs.

## Data changes

- `User.platformInstructor?: boolean`
- `PlatformInstructorGrant`
  - `_id` supplied by Mongo
  - `uid: string` — normalized CWL username, unique
  - `grantedByPuid: string`
  - `createdAt: Date`
  - `updatedAt: Date`
  - `appliedToPuid?: string`
  - `appliedAt?: Date`
- `PreviewAttemptRecord`
  - the question/version/LO/course/answer snapshot needed to reproduce a
    preview submission
  - `instructorPuid: string`
  - `preview: true`
  - `createdAt: Date`

`PreviewAttemptRecord` uses its own collection. No live-attempt query should
need a new `{ preview: { $ne: true } }` condition; isolation is by collection,
not by every future developer remembering a filter.

## Authorization changes

Add two explicit guards:

- `ensureAdmin()` — authenticated and `req.user.isAdmin`
- `ensurePlatformInstructor()` — authenticated and
  (`req.user.isAdmin || req.user.platformInstructor`)

Change `POST /api/courses` from “any authenticated user” to
`ensurePlatformInstructor()`. This is necessary for staging to distinguish a
student from a professor on the server; changing only `client/src/main.ts`
would merely hide a button.

Keep `ensureCourseInstructor()`, `ensureCourseStudent()`, and
`ensureCourseTa()` course-scoped and otherwise unchanged.

## Work split and merge order

### Gate A0 — coordination and contract

**Owner:** Codex  
**Status:** complete

Files:

- this plan
- `docs/superpowers/plans/phase-2/Stephen/STATUS.md`
- `docs/superpowers/plans/phase-2/Stephen/coordination/CODEX.md`
- `docs/superpowers/plans/phase-2/Stephen/coordination/CLAUDE.md`

- [x] Record the product/security decisions.
- [x] Publish per-agent file claims so each agent edits only its own ledger.
- [x] Claude confirms its Task 5 paths in `coordination/CLAUDE.md` before
  continuing Task 5.
- [x] Codex refreshes from `main` after the confirmation and starts A1 on a
  short-lived `codex/` branch.

### Slice A1 — Admin accounts and platform-Instructor grant

**Owner:** Codex  
**Can run beside Task 5:** yes, after both claim files show disjoint ownership

Expected files:

- Create: `server/src/services/admin.service.ts`
- Create: `server/src/routes/admin.routes.ts`
- Create: `server/src/components/auth/platform-guards.ts`
- Create: `client/src/views/admin/accounts.ts`
- Create: focused Admin service/route/guard tests
- Modify: `server/src/types/domain.ts`
- Modify: `server/src/components/mongodb/collections.ts`
- Modify: `server/src/services/users.service.ts`
- Modify: `server/src/routes/courses.routes.ts`
- Modify: `server/src/app.ts`
- Modify after Claude releases them: `client/src/api.ts`,
  `client/src/main.ts`
- Modify: relevant nearest `AGENTS.md` and `docs/api-contract.md`

Steps:

- [x] Write failing tests for Admin-only access, grant idempotency, pending
  first-login application, SAML refresh preservation, revoke, and
  platform-Instructor-only course creation.
- [x] Add the grant document/accessor/unique index and User flag.
- [x] Implement grant/revoke/search plus audit writes.
- [x] Apply pending grants during SAML upsert without fabricating a User or
  replacing its PUID.
- [x] Gate course creation with `ensurePlatformInstructor()`.
- [x] Add the Admin accounts page and Admin-only navigation.
- [x] Update auth response/client types so shell selection uses
  `isAdmin || platformInstructor || course instructor role`.
- [x] Run focused tests, full Jest, typecheck, lint, and build.
- [x] Open a short-lived PR and record its SHA/URL in `coordination/CODEX.md`
  and `STATUS.md`.

Completed on PR #36 (`7d76080`); full 53 suites / 585 tests and the live Admin
active/pending/revoke browser regression passed.

### Gate A1.5 — Task 5 handoff

Preview does not begin until Claude's Task 5 is merged or Claude explicitly
releases the following paths with a commit SHA:

- `server/src/services/serving.service.ts`
- `server/src/services/attempts.service.ts`
- `server/src/routes/questions.routes.ts`
- any Task 5 edits to `client/src/api.ts` or `client/src/main.ts`

Codex then rebases Admin work onto the latest `main` and reruns the Phase 1
serving/attempt regression suites before touching preview integration.

**Gate satisfied 2026-07-28:** Claude released Task 5 at `210c68f` on PR #34,
including the final `paramValues` echo fix. Task 7 and Admin A1 are also
complete and released on PRs #37/#36. Because Stephen requested continuous
work while merges remain human-controlled, A2 starts on an explicit stacked
integration branch: #37 is the base and #36 is merged into that branch. This
does not merge any PR to `main`; its diff will shrink naturally as the
dependencies are merged in their documented order.

### Slice A2 — Instructor Student Preview

**Owner:** Codex  
**Depends on:** Task 5 merged/released and A1 merged
**Status:** active on `codex/admin-student-preview`

Expected files:

- Create: `server/src/services/preview.service.ts`
- Create: `server/src/routes/preview.routes.ts`
- Create: `client/src/views/instructor/student-preview.ts`
- Create: focused preview service/route tests
- Modify: `server/src/types/domain.ts`
- Modify: `server/src/components/mongodb/collections.ts`
- Modify: `server/src/app.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/views/instructor/dashboard.ts`
- Modify only after Task 5 handoff: the smallest reusable seams in
  `server/src/services/serving.service.ts`,
  `server/src/services/attempts.service.ts`, and the existing student view
- Modify: `docs/api-contract.md` and nearest `AGENTS.md`

Steps:

- [ ] Write authorization tests proving students cannot call Instructor
  preview routes and an Instructor cannot preview another Instructor's course.
- [ ] Write content tests proving unpublished courses are previewable while
  only approved questions serve.
- [ ] Write isolation tests proving preview answers create no live
  `attemptRecords`, mastery, Review Book, flags/auto-pause counts,
  remediation recipients, summaries, or notifications.
- [ ] Extract only the pure grading/response logic required to reuse the real
  student experience; keep persistence/context decisions at the route/service
  boundary.
- [ ] Add the dashboard “Preview as Student” entry and persistent preview
  banner.
- [ ] Verify the published and unpublished course flows in a browser.
- [ ] Run focused tests, the full Jest suite, typecheck, lint, build, and
  relevant Playwright coverage.
- [ ] Open a separate PR and record its SHA/URL in the Codex claim and Stephen
  status.

## Required regression cases

1. A student SAML affiliation cannot create a course without the explicit
   platform-Instructor grant.
2. A faculty affiliation alone does not grant the Instructor shell or server
   authorization.
3. A pending CWL grant attaches to the real PUID User on first login.
4. Subsequent SAML logins preserve the Admin-set grant.
5. Revocation removes the Instructor shell and future course-creation access
   but does not silently remove course ownership/history.
6. A platform Instructor cannot access a course they do not own/teach.
7. Preview of an unpublished owned course works.
8. Preview never serves non-approved questions.
9. A client-supplied preview-like field on the normal student attempt route
   cannot bypass student authorization or alter persistence semantics.
10. Preview submissions never enter real learning analytics or notification
    flows.

## Later-plan impact

- Phase 2 Task 5 must land before preview integration; Admin A1 does not change
  Task 5's parameterization contract.
- Phase 2 Task 7 progression/redirect must ignore preview structurally because
  preview records are not live attempts.
- Phase 2 Task 11 exit E2E remains the flag loop; add a separate Admin/preview
  E2E rather than expanding the joint flag-loop spec.
- Future TA management should reuse the Admin route/guard/audit patterns but
  remains a separate task.
- Future “impersonate a named student” is explicitly not implied by this
  preview design and requires a separate privacy/security review.
