# Canvas integration — Stephen — 2026-09-28

## Accepted scope
Preserve shared FinanceBot course cards. Add a Canvas entry above My Courses,
a course-scoped connection page, and links from Settings/Materials. Multiple
Canvas course IDs (including separate 101/102 course shells) map to one FinanceBot
course. Existing FinanceBot courses can be linked. New courses remain drafts.

## Implementation and identity
- UBC toolkit 1.4.0 handles OAuth, pagination, token refresh and bounded downloads.
- OAuth state is session/user bound, expires in ten minutes, and is consumed once.
- OAuth tokens are AES-256-GCM encrypted with CANVAS_TOKEN_KEY and scoped by Canvas
  origin + CWL PUID. Browser responses never expose tokens.
- Course choices come from active Canvas teacher enrollments. Course routes also
  require FinanceBot instructor access; Canvas affiliation grants no platform role.
- Atomic course roster snapshots union active students across linked course IDs.
  Same PUID + Canvas user deduplicates; conflicting identities or missing PUIDs
  reject the snapshot. Names, email, Canvas numeric IDs and student numbers never
  substitute for the authenticated CWL PUID.
- CWL login/session deserialization projects Canvas student roles from fresh
  snapshots for published, nonarchived courses inside their access dates. These
  roles are not written into manual courseRoles; unlink/drop cannot erase manual
  access or student learning history. Sync is every five minutes, freshness bound
  thirty minutes. A failure retains the last roster and records a visible error;
  stale snapshots stop granting Canvas access.
- Student registration requires no Canvas OAuth and no registration code.
- Course files use the existing durable material ingestion pipeline. Import is a
  copy; changes to Canvas files require a new explicit import. No grades written.

## Deployment
Configure CANVAS_DOMAIN, CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET,
CANVAS_REDIRECT_URI, CANVAS_TOKEN_KEY. Callback is `/api/canvas/callback`.
Production requires HTTPS. Register the six read-only scopes in
`server/src/components/canvas/index.ts`. Canvas must allow the connecting teacher
to read SIS identity data (`integration_id`). Verify with UBC that it is the same
PUID released to this SAML service; local fixture success does not establish that
production permission or identifier contract. Students missing identifiers must
be resolved upstream; do not match names.

## Package provenance
The GitHub npm registry required an unavailable registry login. The checked-in
vendor tarball is built from the user's local toolkit source at commit
`2bf95b48c499d9e947abf8489349aa18df2fbeab`, version 1.4.0. Package and lockfile
use a repository-relative tarball so deployment does not depend on a local path.

## Verification plan
- Typecheck; unit tests for union/conflicting/missing identities and session grants.
- Local Canvas OAuth with a dedicated teacher and read-only scoped Developer Key.
- Two course shells (101: 12 students; 102: 10 students; 2 overlap = 20 unique).
- Two different students named Alex Chen with different PUIDs.
- Create a new draft, link an existing FinanceBot course, import a real Canvas file.
- Publish, real CWL login for all 20, nonmember rejection, repeat-login deduplication.
- Removal/overlap, unpublished course, missing PUID and disconnect safeguards.
- Capture actual browser screens and assertions in an HTML presentation.

## Completed local verification

All above acceptance scenarios passed on 2026-09-28. Twenty students completed
individual real SAML logins. Both identical display names resolved independently.
The imported Canvas document reached `ready`; repeat import retained one material.
The final boundary script passed all eleven checks, including disconnect/reconnect.
Focused unit/regression coverage: 93 passed across six suites. Server/client
TypeScript checks and diff whitespace checks passed. Canvas UI axe WCAG A/AA:
zero violations; 390px page has no horizontal document overflow.

The generated standalone report is `audit-results/canvas-integration/presentation/index.html`:
22 slides, 19 real screenshots, and per-student results. Only serve its presentation
subfolder; parent test artifacts contain private browser storage state.
Staging/production deployment and the real UBC identity/permission contract remain
unverified. Local services and dedicated test courses are left running for review.
