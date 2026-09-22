# Admin console implementation — 20 September 2026

The approved compact Admin design is implemented in the real application at `http://localhost:6118`, using the existing APIs.

## Delivered pages

- Operations & Issues: separate request, background-task and change-history tables; search, outcome/user/course/date filters, pagination, audit health, retained-evidence inspector, task timeline, related questions and scoped exports.
- All Questions: cross-course question table, state/creator/course filters, pagination, version/seed samples, recorded-attempt replay, flags, source/provenance evidence and exports.
- User Directory: combined account and Instructor-grant management with search, role/status filters, pending-first-login identities, user/course-access inspector, direct row actions, retained-record Ban/Unban and investigation links. The previous Instructor Grants URL renders this same workspace.
- Capabilities: role matrix, platform/course scope, sparse inherited overrides, hard safety restrictions, change review, save/discard and unsaved-change protection.
- Platform Settings: server-catalogue model pipeline, parameter editor, quality controls, generation limits, custom models and save/retry feedback.

The original Help & Tutorials content remains. The duplicate Course tutorials navigation entry is removed; Help & Tutorials now appears directly after My Courses under Teaching tools.

## Layout defect reported during review — fixed

**Trigger:** Open All Questions on desktop, then select a question.

**Before:** The inspector appeared partway across the workspace, covered the table, and left a large empty region on the right. The shared `.view` entrance animation created a containing block for its fixed-position descendants. The workspace reserved space on the right, but the inspector anchored to the narrowed page root.

**Fix:** Disable that animation/transform on Admin workspace roots. Inspectors anchor to the viewport, while desktop tables reserve the correct width. Hidden inspectors no longer reserve space. Closing an inspector restores the table width and selection state. Mobile uses a bounded overlay.

**Verification:** Explicit browser assertions check the inspector's right and bottom edges against the viewport. The corrected real All Questions screenshot below uses live local data.

![Corrected real All Questions layout](../../audit-results/admin-workspace-2026-09-20/real-questions-light.png)

## Other corrections found during implementation

- Accepted requests no longer claim a task is still processing; the linked job supplies its eventual outcome.
- Inspecting related requests/tasks preserves active filters. Empty later pages return to a valid page, and late responses cannot replace newer results.
- The final-Instructor HTTP 409 warning now opens the correct explicit confirmation.
- Capability saves retain sparse assignments, avoiding accidental replacement of inherited permissions.
- Nonreasoning model temperature settings include explicit `reasoningEffort: none` when required by the server's catalogue contract.
- Danger controls retain readable contrast in both themes. Existing tutorial target anchors remain connected to the updated pages.

## Validation

- 32 API-isolated browser cases passed across all six pages, including desktop, 580px and 390px layouts, light/dark WCAG A/AA scans, failures, recovery, scoped saves and exact recorded replay inputs.
- One real local SAML Admin test passed across all six pages, including real question/user inspectors, theme persistence, mobile navigation and logout. No directory, grant, capability or settings changes were made in the live smoke test.
- Existing Admin action-progress regression passed.
- Client build, server/client typechecks and scoped ESLint passed.
- Legacy diagnostic E2E selectors were updated for table/inspector navigation; that database-seeding suite was not rerun in this UI task.

Main suite: `npx playwright test -c playwright.admin-workspace.config.ts` after building the client and starting local services.

## Existing data limits reflected by the UI

Operational success counts summarize the loaded page; matching totals are separately labelled. The directory API returns the latest 200 matches and the UI asks for a narrower search at that limit. Historical change records do not establish outcomes for unrecorded actions. Question reproduction uses retained evidence and does not rerun paid AI jobs or create student attempts.

Changes are local; no remote deployment was performed.

## Unified access follow-up

User Directory and Instructor Grants now share one page and one sidebar entry.
Grant Instructor and Revoke Instructor sit beside each person; Grant TA and Grant
Student open a labelled course selector. Ban user blocks platform access through
the existing deactivation API, and Unban user restores it without deleting roles
or historical records. Admin accounts retain the existing UI protection. Pending
identities remain visible and their Instructor grants can be revoked. The top-right
Add Instructor flow is removed. The sidebar again uses the original black in both
light and dark appearance modes.

The course selector uses a minimal Admin-only course identity endpoint, including
courses outside the Admin's own teaching assignments. Existing role and grant
mutations keep their authorization and audit behavior. A failed refresh after an
access change keeps mutation controls locked behind an explicit retry; keyboard
focus survives asynchronous course loading.

Follow-up verification: 11 isolated people-workspace cases, the Admin request-
progress regression, and the real SAML Admin appearance/course-list smoke test
passed. The two focused Admin unit/API suites passed 16 tests. Client build,
server/client typechecks, scoped ESLint and whitespace checks passed. The updated
legacy DB-seeding Admin accounts suite was discovered/linted but was not rerun.
