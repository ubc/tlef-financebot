# People & Access / Teaching Team prototype

Open `/people-access/` on the design preview server (current session: port 6133).
This is a local interactive design prototype. All identities are fictitious;
all mutations use a namespaced localStorage key. It does not grant real access.

## Working demo flows
- Search existing active instructors by name/email; disambiguate matching names;
  confirm course-only addition; avoid duplicate membership; remove with confirmation.
- Inspect owner/co-instructor/TA access. Owner removal is unavailable.
- Unified Admin directory: search/filter, empty state, platform Instructor role grant,
  activation state, pending first-login grants, activity history.
- Permission matrix: platform/course scopes, review-before-save, persistence,
  fixed TA denial for question approval and flag resolution.
- Simulated presence and same-question save conflict: retain draft or compare,
  edit, and save a merged demo version. Presence is explicitly simulated.
- Demo state syncs between tabs on the same browser origin using storage events.
  This is not cross-account or server-backed collaborative editing.

## Verified existing implementation facts
- `client/src/views/instructor/shell.ts` explicitly disables Co-instructors with
  `path: null`; this is a placeholder, not a configurable capability toggle.
- Admin already has course-role assignment and platform-instructor grants.
- Directory queries support name, uid, email and PUID, return at most 200 users,
  but the existing screen has no no-results message or pagination and requires
  raw course IDs for assignment. This audit did not reproduce a live directory error.
- The question service accepts expectedVersionId and checks concurrent writes
  on the version-pinned edit path. This is useful groundwork, not full collaboration.
- Existing admin service/routes and capability test suites pass: 18 tests.

## Production implementation boundary
1. Add course-scoped teaching-team APIs, authorizing membership management for
   the owner/Admin; bound name search to eligible active instructor identities,
   return safe identity fields only, and audit add/remove events. Do not expose
   the global Admin directory to every course member. Preserve final-owner rules.
2. Unify directory/grant data and use course pickers instead of raw IDs. Add
   pagination, stale-search protection and explicit loading/error/empty states.
   Keep course membership separate from platform roles.
3. Presence needs authenticated course-scoped heartbeat + expiry, shared across
   server replicas. Broadcast only identity, page/entity and viewing/editing state;
   never raw unsaved text. Remove presence on logout/access revocation/expiry.
4. Broadcast durable record updates to other course members. Require revision
   preconditions on every collaborative write, retain unsaved drafts, and offer
   explicit conflict comparison. Test with two distinct authenticated sessions.
5. Rich same-field, simultaneous typing requires a separately designed CRDT/OT
   document layer; this prototype does not promise Google Docs text synchronization.

## Verification
Headless browser exercised name search, duplicate-name results, member addition,
conflict merge, empty search, TA restrictions, permissions save/persistence,
mobile page overflow and absence of JavaScript exceptions. No live data changed.
