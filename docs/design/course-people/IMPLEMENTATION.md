# Course People workspace

The approved HTML prototype is implemented in the production plain-TypeScript
client. The Instructor sidebar consolidates Teaching Assistants, Co-instructors
and Enrollment into **People**. Old TA/co-instructor bookmarks render People;
Course Settings retains course settings and links to People.

## Invitation and directory behavior

- People and the topbar Share action use the same UBC email/existing-CWL form.
  Choose Student, TA or Instructor before saving. No email is sent. Unknown
  email invitations activate only through a unique canonical SAML identity;
  unknown CWL usernames are rejected rather than guessed.
- The course Owner/Admin manages invitations, role changes and course bans.
  Other course Instructors can read/search. Student/TA access to the directory
  is denied. Owner and platform Admin identities are protected from course
  mutations. Course Instructor grants never imply platform Instructor access.
- The directory merges direct roles, the current CSV import, valid Canvas
  snapshots, legacy invitations and owner decisions. Search, role/status filters
  and stable 10/25/50-row pages are applied on the server before responding.
  Counts are course-scoped. Pending email invitations have a separate tab;
  imported identities awaiting first login remain in People.
- A native person inspector displays identity, source, role, dates and saved
  permissions. Last CWL login is an authentication event, not online presence.
- One-time codes retain their existing atomic claim/resume, revoke/delete and
  pagination behavior. Both the code text and Copy button copy with feedback.
  Only Owner/Admin can generate/revoke/delete codes.

## Authority and retention

`coursePeopleAccess` contains one revisioned decision per course/subject. Known
identities use `puid:<exact PUID>`; pending invitations use normalized email.
Binding uses a unique persisted SAML email and a revision/status CAS. It does
not create placeholder Users. A cancelled invitation retains a tombstone so a
legacy invitation racing first login cannot resurrect its access.

Apply `projectCoursePeopleAccess` **after** legacy TA/share, Canvas and manual
CSV projection at every authenticated session reload. A decision replaces the
previous roles for that course; bans/revocations remove all of them. Unban
restores the saved role. A verified email decision also applies when concurrent
cancellation wins the binding CAS. Bound PUID decisions take precedence.

CSV/Canvas re-imports cannot undo a ban or role decision. Other courses and
student learning records are preserved. Archived/ended courses reject new
projected access; Students additionally require publication and term start.
Supplemental code redemption/recovery cannot bypass a controlling ban, revoked
invitation or staff-role decision. Analytics and notification membership queries
include new grants and exclude superseded legacy sources. Admin role mutations
update existing decisions; permanent course deletion removes the collection.

TA presets cover review/mark-reviewed/triage, suggested edits and student
analytics/profile access. The existing capability editor and People presets
stay synchronized. TA question approval and final flag resolution remain hard
denied regardless of preset contents. All People writes are audited and stale
revisions return 409 rather than overwriting a newer change.

## Gradebook re-upload changes

Preview compares the uploaded accepted rows with the **previous CSV snapshot**
using exact PUIDs. It groups multiple roles per person and separates new people,
missing people, role changes and unchanged identities. Reordering rows or fixing
names cannot inflate additions. Rejected rows are still reported by the parser.
Preview carries its comparison revision; stale commits are rejected.

Commit stores the same change receipt in `lastChanges`. The import dialog shows
new names before confirmation and opens the latest changes after commit. Lists
are paged by ten identities. Reopening the dialog retains the latest receipt.
A person newly added to the CSV may already have code/invitation access; the UI
states this distinction. Missing rows remove only CSV grants, never learning
records or independent access. Owner decisions/bans still apply.

## Validation and practical limits

- Unit/service/route coverage exercises gates, exact identities, cancelled email
  activation, CAS races, bans, merged rows, bounded requests and import diffs.
- `playwright.course-people.config.ts` runs real local SAML/Mongo acceptance,
  Gradebook re-import, access changes across existing sessions, Share invitations,
  code clipboard copying, pagination/search and desktop/mobile light/dark axe.
- Local evidence is saved in `artifacts/people-workspace-live-2026-10-06/`.
  Fixtures and temporary roles are removed afterward. No model calls occur.
- The current server directory merges course records in memory, then returns
  only the requested page; it does not fetch the entire platform directory.
  CSV imports remain limited to 10,000 rows. No online-presence tracking,
  email sending, platform ban or ownership transfer is introduced.
