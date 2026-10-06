# AGENTS.md — client/

The frontend. Deliberately framework-free and bundler-free: plain TypeScript
authored as native ES modules, compiled by `tsc` and served statically.

Course Structure provides confirmed Delete topic and per-LO Delete controls
directly in the outline, including All objectives/search topic groups. They use
the existing archive APIs: Topic removal cascades to active child LOs, while
question/material/history records remain. Failed removal preserves the item and
unsaved editor text; the current page prevents duplicate removal requests.

Course Settings → Enrollment embeds `views/instructor/people-import.ts` for
manual Canvas CSV upload, preview/rejects, role counts, explicit teaching access
confirmation, snapshot replacement and removal. A template is served from
`public/templates/canvas-people.csv`. Gradebook CSVs grant Student only. The
legacy shared-code/Roster editor is retired from Enrollment; stored roles and
historical roster extensions remain. `views/instructor/registration-codes.ts`
provides optional batches of 1–50 one-time student codes with claimant identity,
last CWL login, explicit status, copy and unused-code revocation. The compact
table uses server pagination (10/25/50 rows), status filters and confirmed
record deletion, which invalidates unused codes and preserves student access.
Gradebook is
the primary student path; supplemental codes need no roster allowlist. TA and
co-instructor invitations share the UBC email/existing-CWL input contract.
Imported TAs are
labelled in Teaching Assistants; their permissions use the existing API and
their access source is managed through Enrollment.

## How it works

- Source lives in `client/src/*.ts` (and `client/src/views/*.ts`).
- `tsc -p client/tsconfig.json` compiles it to `client/public/js/**/*.js`.
- The server (`server/src/app.ts`) serves `client/public/` as static files, so
  the compiled JS, `index.html`, and `styles/` are reachable from the root URL.
- `index.html` is a near-empty skeleton (`<div id="app">`) that loads the app as
  a native ES module: `<script type="module" src="/js/main.js"></script>`. All
  UI is built in TypeScript.

## The `.js` import rule (important)

Browsers resolve ES module specifiers literally — TypeScript does not rewrite
them. So when importing one client file from another, use the compiled `.js`
extension in the source (including into subfolders):

```ts
import { checkHealth } from './api.js';        // resolves to compiled ./api.js
import { renderHome } from './views/home.js';  // subfolders work the same way
```

This is enabled by `"moduleResolution": "Bundler"` in `client/tsconfig.json`.
Omitting the extension will compile but fail to load in the browser.

## Structure

Two top-level states, chosen at startup from `GET /api/auth/me`:

- **Logged out → the landing screen** (`views/landing.ts`): the FinanceBot
  wordmark, a "Log in with CWL" button, and a redirect note — mirroring the
  team's Figma wireframe frame `0 - Login` (`148:5448`). Nothing else is
  reachable; the rest of the app is behind login. The theme toggle in the corner
  is a deliberate addition — the wireframe draws no chrome, but signed-out
  visitors would otherwise have no way to switch themes.
- **Logged in → the app shell** (`main.ts`): a navy sidebar + top bar with a hash
  router swapping views in the main outlet.

| File | Role |
| --- | --- |
| `config.ts` | **The re-skin point.** App name (`APP`) and the sidebar `NAV` table. |
| `main.ts` | Bootstrap: picks landing vs shell, builds the sidebar/top bar, starts the router, initializes the theme. |
| `router.ts` | Tiny hash router (`#/`, `#/notes`, …). No server SPA fallback needed. |
| `auth.ts` | Caches the session from `/api/auth/me`; derives a display name. |
| `api.ts` | One typed function per endpoint. Centralizes 401 handling (see below). |
| `theme.ts` | Light/dark theme (persisted; `data-theme` on `<html>`). |
| `ui.ts` | Shared UI kit: loading/empty/error states, badges, status dots. |
| `dom.ts` | `el()` / `mount()` / `byId()` — minimal DOM helpers. |
| `action-state.ts` | Shared explicit request-backed button progress and duplicate-submit protection. |
| `views/landing.ts` | Pre-login screen (Figma `0 - Login`, node `148:5448`). |
| `views/home.ts` | Overview (dashboard): welcome, system status, component map. |
| `views/health.ts` | Reusable "System status" card (used by the signed-in overview/home only). |
| `views/notes.ts` | EXAMPLE (mongodb demo). Safe to delete. |
| `views/rag.ts` | EXAMPLE (genai + qdrant demo). Safe to delete. |
| `views/members.ts` | The gated members-only area (auth-gating reference). |
| `views/role.ts` | Role-gated area (Faculty/Student/Staff), one factory per role. |
| `views/admin/users.ts` | Unified Admin directory: row-level Instructor grant/revoke, course-scoped TA/Student assignment, Ban/Unban and pending-first-login grants. |
| `views/admin/accounts.ts` | Compatibility renderer for existing Instructor Grants bookmarks and tutorial replay; shares the User Directory. |
| `views/student/experience.ts` | Injection boundary shared by live Student and Preview modes: routes plus course/practice/flag/Review Book/session APIs. |
| `views/instructor/student-preview.ts` | Route table that renders the real Student pages with the anonymous Preview adapter. Preview swaps the entire Instructor shell for Student chrome rather than maintaining a second UI. |
| `preview-session.ts` | Browser-scoped UUID for one fresh anonymous Preview student. Exit clears it; refresh keeps the current walkthrough. |
| `views/instructor/content-map.ts` | Instructor-only Theme/LO coverage map joining material kinds, question states, run status, and authoring gaps. |
| `views/student/exam-*.ts` | Phase 3 Exam Prep selection, integrity-preserving live sitting, post-submit results, and history. The live DOM receives only sanitized stems/options; correctness and explanations exist only in the results view. |
| `tutorials.ts` | Account/role-aware accessible spotlight engine, first-use triggers and safe cross-route replay. `tutorial-definitions.ts` owns the 37 Student/Instructor/TA/Admin contexts; `views/tutorial-help.ts` owns the shared hub. |
| `views/student/settings.ts` | Centered Student settings hub with appearance controls and Help & Tutorials status/replay/reset. |

## Adding a page

1. Add a typed call in `src/api.ts` for any new endpoint.
2. Add an entry to `NAV` in `src/config.ts` (path, label, group, `demo?`).
3. Create `src/views/<name>.ts` exporting a `render(outlet)` function.
4. Register it in the `ROUTES` table in `src/main.ts`.

## Auth-gating in the UI

The whole app is behind login: when signed out, only the landing screen renders.
Gated views call gated endpoints, and `api.ts` routes any `401` to a single
handler (`setUnauthorizedHandler`, wired in `main.ts`) that re-bootstraps back to
the landing screen — so an expired session mid-use fails gracefully. Remember the
UI gate is only UX; the real enforcement is the server's `ensureApiAuthenticated()`
(see `server/src/components/auth/AGENTS.md`).

**Role-based menus:** a NAV item can set `roles: ['faculty']` in `config.ts`; the
sidebar shows it only when the session's `roles` (from `GET /api/auth/me`, itself
derived from `eduPersonAffiliation`) include a match. The role views load a
role-gated endpoint, so a deep-link to another role's page returns `403` and shows
a friendly state (a `403` is left in-app; only `401` drops to the landing screen).

FinanceBot's real Instructor shell is stricter than the generic role demo:
`eduPersonAffiliation=faculty` alone is not authorization. `main.ts` requires
Admin, `platformInstructor`, or an existing course Instructor role. Admins get
a unified `/admin/users` navigation entry; the server's `ensureAdmin()`
remains the actual gate.

The role switcher offers **Student with access restrictions** and **Student
without access restrictions** to Admins, course Instructors and current course
TAs. Both switch into the real Student shell with isolated Preview APIs. The
restricted course picker and Preview API show only published courses; the
unrestricted mode can inspect unpublished courses. Both still enforce Theme
release and Approved-question visibility. Only Instructor/Admin previews can additionally send TEST
flags to the teaching queue; TA preview flags remain isolated.

## Re-skinning

Two places: `APP` + `NAV` in `src/config.ts`, and the `:root` token block at the
top of `public/styles/main.css` (colors, radius, sidebar width). The persona sidebars retain their own palettes (black Admin, green Instructor/TA,
blue Student). `styles/app-shell.css` owns one compact shell layout and typography
for every role. Course cards use `course-card.ts` and `styles/course-cards.css`;
Instructor, Student and Preview share markup, covers and actions.

## Conventions

- `client/tsconfig.json` sets `"types": []` so Node types never leak into browser
  code. The available globals are DOM + ES2020.
- Put all backend calls in `src/api.ts` (one typed function per endpoint). Keep
  response types in sync with the server routes/services.
- Keep views small and self-contained: a `render(outlet)` that builds its own DOM
  and owns its loading/empty/error states.
- Return request promises from declarative button handlers so `el()` can show
  the shared spinner for the real request lifetime. Use `runButtonAction()` for
  retained buttons and native listeners. Disabled prerequisites are not busy.
- The compiled output `client/public/js/` is generated and git-ignored. Never
  edit it by hand and never commit it.

Shared Help is available in each real role shell; Student Settings retains
Appearance and embeds the same hub. Views attach tutorial targets only after
rendering, with the view root supplied for stale-view cancellation. TA suggestion
and mark-reviewed controls use `getMyCourseCapabilities` rather than assuming
that every TA has the default capabilities. Instructor TA View still uses the
real Instructor permission projection while keeping TA-only action surfaces.
TA Student Analytics reuses the Instructor read models under TA routes; its
sidebar entry follows `analytics.view`, while named profiles and exam scores
require `analytics.individual`. The TA view does not link to Instructor-only
routes for course settings or content mutations. TA course-content pages use
course-scoped GET routes for Course Home, Materials, Structure, Coverage Map
and Question Bank; the Bank still requires `question.review`.

Admin accounts use a compact black sidebar in both appearance modes with an explicit Admin brand
and platform navigation. `admin-console.css` supplies shared dense workspaces,
bounded scrolling tables and viewport-fixed inspectors for the five Admin workspaces;
page roots disable the old rise animation so transforms cannot re-anchor inspectors.
`setAdminAppearance()` applies root tokens for dialogs too, with a persisted
light/dark toggle. Help & Tutorials keeps its existing content and appears once,
beneath My Courses in Teaching tools. Landing, Student Preview and TA View use
their own role styling. The Admin sidebar has its own collapse key.

Question Bank now uses `bank-workbench.ts` for the approved collection and per-topic
release controls. `bank-editor.ts` saves a version-pinned edit and Pending Review
state atomically; existing full details retain history, notes and script controls.
The general browse API stays unchanged for other consumers; the Bank requests
Approved explicitly and uses the server content gate plus course/topic availability.

Teaching Assistants now uses a compact searchable roster with native invitation
and permission dialogs. Course Settings retains input nodes across five sections
and submits only the selected section's fields; enrollment and lifecycle keep
their existing API flows. Help uses searchable role-scoped tutorial cards and real
replay destinations. Prototype role switches are not production authorization
controls. `playwright.course-admin.config.ts` checks these pages with isolated API
fixtures, including light/dark accessibility and narrow layouts.

Course Dashboard setup actions now start `setup-journey.ts`: a persistent bottom
navigation island spanning the existing Materials, Structure, Generate, Review,
Bank, and isolated Student Preview pages. Session storage retains only account-
scoped navigation preferences; completion is read from workflow, topic release,
and approved-question content checks. It refreshes every five seconds while the
matching instructor course is visible, hides in other roles/courses/Preview, and
restores when returning. Guide navigation never generates, approves, releases,
or publishes content on its own.

Course Structure's `structure-ai-workbench.ts` uses the approved material-composer /
live-draft-card layout. Empty courses open AI draft; Course outline retains the
compact saved topic navigator and manual editor. Optional settings override AI
counts. Durable `structure-generation` snapshots retain edits, display explicit
failure/recovery states and support selected-subset apply. Source coverage separates
analyzed sections, mapped learning points, exclusions and gaps; exact passages can
open the existing highlighted source preview.

Admin Operations & Issues and All Questions (`views/admin/operations.ts`,
`questions.ts`) expose cross-user diagnostics, durable job evidence and read-only
version/seed or saved-attempt reproduction. User Directory links filter these
views by PUID. `diagnostics.ts` reports bounded runtime/network failures without
form contents or browser-session recording; reports are explicitly unverified.

Admin configuration keeps sparse permission assignments and explicit inheritance,
reviews the loaded scope before saving, and preserves Admin/TA safety locks.
Platform model parameters come from the server catalogue. User/grant changes
retain server confirmations, exact-case PUIDs, errors and pending-first-login state.
All five workspaces use real APIs; the HTML design prototypes are review artifacts.

User Directory includes persisted users plus grants awaiting first login. Each row
and Profile share one Grant role menu for platform Instructor grant/revoke and
course-scoped TA/Student access. Ban/Unban stays beside it as a separate action
using retained-record deactivation. The native popover stays above scrolling
tables/panels and supports keyboard selection, Escape and focus return. The course
selector reads Admin-only `/api/admin/courses`, which includes minimal identities
for all courses. Instructor Grants no longer has a separate sidebar entry or Add
form; `/admin/accounts` still renders the same workspace for existing links.

Role switching uses `role-workspace.ts`: a single topbar menu offers Admin →
Instructor/TA/Student, Instructor → TA/Student, and TA → Student, plus a return
to the account's primary workspace. This menu is the single switching/return
entry point on desktop and mobile; there are no separate Exit View buttons.
The selection is a per-account session-storage
presentation preference; authenticated roles and server guards never change.
`views/workspace-courses.ts` reuses shared course cards for TA/Student course
selection. Student teaching previews use minimal `/preview/identity` reads even
when a TA lacks question-review permission. Route guards run before switching;
accepted Preview exits clear the anonymous UUID, and reloads resume the same
course session. All shell builders consume `app-shell--unified`.

Course co-authoring uses `course-sharing.ts` for both the topbar Share dialog and
`views/instructor/co-instructors.ts`. Owners/Admins manage UBC-email invitations;
co-instructors can inspect members and copy the restricted course link.
`collaborative-editor.ts` binds native fields to a vendored Yjs module, persists
incremental shared drafts, shows presence, and explicitly saves validated versions
back into Review Queue. It retains failed updates and commit ids, compares external
versions before rebase, and exports the original draft schema. The application
still compiles with tsc; esbuild only packages the third-party Yjs vendor module.

Exam Builder v2 uses `views/instructor/exam-builder.ts` and the scoped
`styles/exam-builder.css`. Course bank selection and private generation feed a
revisioned paper with Questions / Review / Publish views. Settings require Save;
paper operations use revision CAS. Student `views/student/assessments.ts` uses
separate formal/practice assessment endpoints, server deadlines and controlled
results. Legacy `exam-templates` / Exam Prep routes are retained.


The Exam Builder catalog offers Rename and Delete with a typed-title deletion
confirmation. A published paper's display title may change without unlocking its
content; student assessment views use the current display name.

`views/instructor/canvas.ts` adds account authorization, multi-select Canvas course
links (new or existing FinanceBot courses), combined roster and explicit file
import. My Courses retains its existing shared course cards. Connection/roster
access is Instructor-only; students auto-enroll through the existing CWL session.

Canvas connection uses a compact account menu, course selector and Course links /
Students / Materials tabs. Course selection remains multi-select in a native dialog.
The roster searches before paginating (20 rows by default; 10/20/50 options), resets
to page one on search/page-size changes, and exposes range and disabled edge controls.
Canvas material import statuses derive from persisted source/version provenance.

Canvas connection is a top-level Instructor nav item (`/instructor/canvas/:id`
selects a FinanceBot course without activating the course shell). Legacy course
URLs redirect. People includes Canvas role/state, a server-derived You marker,
role filtering, search and pagination; display membership does not grant roles.


## Course People consolidation (2026-10-06)

People consolidates Enrollment, Teaching Assistants and Co-instructors using
course-scoped merged identities, search and server pagination. People and Share
share Student/TA/Instructor invitations. Owner/Admin controls role changes,
course bans and one-time-code mutations. Revisioned `coursePeopleAccess` decisions
apply last at session reload and override all grant sources; CSV/Canvas cannot
restore bans or superseded roles. Pending canonical-email binding preserves
cancellation tombstones and never grants platform privileges. Gradebook preview
and persisted `lastChanges` identify newly added people by exact PUID and show
names before/after commit with paginated lists. See
`docs/design/course-people/IMPLEMENTATION.md`, `docs/api-contract.md`, and
`playwright.course-people.config.ts`. Old standalone UI/enrollment descriptions
above describe historical entry points; the current Instructor entry is People.

Instructor and TA course sidebars show only course navigation plus a compact
Back to all courses link. Course identity remains in the topbar. Global links
(My Courses, Canvas connection, Help, and Admin tools) appear outside a course;
returning to the course list restores them. The return arrow remains accessible
in the collapsed desktop rail. Student navigation is unchanged.
