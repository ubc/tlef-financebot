# People workspace HTML prototype

Open `index.html` directly. This is a reviewable interactive proposal, not a
live feature. Only files in this artifact directory were authored for this task.
No application routes, roles, source files or course data were modified.

## Existing design references

The prototype loads the actual `client/public/styles/main.css` and
`client/public/styles/app-shell.css`. Its sidebar, course context, topbar,
Instructor buttons, inputs, borders, light/dark palettes and typography reuse
the production HTML classes and tokens. Scoped prototype styles implement
compact directory tables, accessible dialogs and the person inspector.
There are no remote dependencies or generated media assets.

Design choices: density 9, motion 1, restrained symmetric management layout.
The existing plain HTML/TypeScript application architecture takes precedence
over the frontend-dev skill's default React/Tailwind scaffold.

## Try the prototype

- **Invite person:** enter `rachelw` (existing demo CWL) or `jamiec`, then choose
  Student, TA or Instructor. Existing demo accounts activate immediately.
- Enter `new.person@ubc.ca` to create a pending invitation. Change its role
  before activation in **Invitations**.
- Choose TA to preconfigure review, suggested-edit and analytics permissions.
  Approval and final flag resolution remain unavailable to TAs.
- Click a person's name or **View** to inspect identity, course access and local
  access history. Click their role to change it.
- Search name, email, CWL or PUID; filter role/status; choose 10/25/50 rows and
  page through 88 synthetic people.
- Ban and restore course access. Owner access remains protected.
- **Import Gradebook → Load demo Gradebook** opens a staged preview. Confirm
  snapshot replacement before importing. A small local CSV can also be parsed
  in this page; it is never uploaded.
- **Registration codes** supports generation, pagination, filter, copy,
  revocation and record deletion. These synthetic codes do not grant access.
- The topbar viewing-role selector demonstrates owner controls versus an
  Instructor read-only directory. Toggle the theme and try a narrow viewport.
- **Reset demo** or reload to restore the initial data. No localStorage or
  external persistence is used.

## Proposed access semantics to approve before implementation

The sidebar consolidates Enrollment, Teaching Assistants and Co-instructors
into **People**. People contains a directory, pending invitations and codes;
Gradebook import is an action in this workspace. Ordinary Course Settings
retains its non-people settings.

The course owner assigns one effective course role per person and manages role
changes, bans and invitations. A changed imported role becomes an explicit
owner override. Course bans apply across all access sources and survive later
imports; learning records and other course access remain. Platform-wide bans
remain an Admin concern. Ownership transfer is separate from a role change.

These role override and course-ban semantics are proposed UI behavior, not an
assertion that the current backend supports them. The directory shown here is
for course staff, not a student-facing personal-information directory.

Students still require publication/term eligibility. Teaching invitations can
activate before course publication. No notification email is sent by this
prototype. "Last CWL login" is not online presence.

## Checks

Run from the repository root:

```sh
node artifacts/people-workspace-prototype-2026-10-06/verify.cjs
```

The verification drives the local file with Playwright. It checks search,
pagination, preassigned TA permissions, known-CWL and pending-email invitations,
dynamic active/pending roles, ban/unban, owner protection, staged Gradebook
import, code pagination/deletion, read-only Instructor controls, empty-state
recovery, no JavaScript errors, no API requests, responsive overflow and
light/dark WCAG A/AA axe scans. Screenshots are saved beside the prototype.
