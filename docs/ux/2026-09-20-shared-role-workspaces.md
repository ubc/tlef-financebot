# Shared role workspaces — 20 September 2026

The Admin sidebar's compact dimensions and typography now apply to Admin,
Instructor, TA and Student. Each role keeps its existing palette: black Admin,
green Instructor/TA and blue Student. The shared shell uses a 210px sidebar,
60px collapsed rail, 52px topbar and 11px navigation labels; smaller screens
use the same responsive drawer rules.

## Shared components

- `client/public/styles/app-shell.css` owns common shell geometry, typography,
  responsive behavior and role-menu styles. Role palette tokens remain separate.
- `client/src/role-workspace.ts` supplies the topbar role menu, allowed role
  hierarchy, return destinations and per-account session preference.
- `client/src/course-card.ts` and `client/public/styles/course-cards.css` supply
  the same card markup, covers, status, progress and actions to Instructor,
  Student and the teaching-preview course choosers. Admin and Instructor use
  the same black Create course action.
- `client/src/views/workspace-courses.ts` provides the shared course chooser
  when entering TA or Student without a current course.

## Role behavior

Admin can enter Instructor, TA or Student; Instructor can enter TA or Student;
TA can enter Student. The same menu always offers a return to the account's
primary workspace. Switching changes the displayed workspace, preserves the
authenticated account and never grants membership or changes access records.
Existing course context is retained when the target workspace can access it.

Teaching accounts enter the isolated anonymous Student Preview. Course TAs can
use the Preview endpoints, including an identity-only course read that does not
require question-review capability. A TA cannot send Preview flags into the live
teaching queue, even by requesting it directly. Ordinary Students, nonmembers
and removed TAs cannot use these Preview APIs. The existing Instructor/Admin
TEST-flag behavior remains supported.

An accepted Preview exit clears its anonymous session; refresh resumes it.
Unsaved-work guards run before switching or clearing the session. All screen
sizes use the role menu to switch and return, with no separate Exit View buttons.

## Verification

- Client build, full server/client typecheck and scoped ESLint.
- Eight isolated full-app browser cases cover all role return paths, refresh,
  forged preferences, per-course Preview isolation, unsaved-work protection,
  shared cards/sidebar/button styling and mobile light/dark accessibility.
- Preview route/service and course-guard unit tests cover TA access and denial,
  minimal identity projection and isolated flag behavior.
- Real local SAML smoke checks for Admin, Instructor and Student, including
  desktop/mobile layouts and the Admin appearance regression. No course,
  directory, enrollment or student-activity mutations in these visual checks.

Run the browser regression after compiling the client:

```sh
npm run build:client
npx playwright test --config playwright.role-workspace.config.ts
```
