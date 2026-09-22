# Course co-authoring — 2026-09-20

Implemented in the local application:

- Enabled Co-instructors and a shared topbar Share dialog. Owner/Admin can add
  existing colleagues by CWL or use a UBC email for immediate or pending access,
  inspect pending invitations and revoke access. A restricted link opens the
  shared course; it does not grant bearer access.
- Share-derived Instructor access is course-scoped and re-evaluated on requests.
  It does not grant platform course creation. Pending invitations activate against
  canonical SAML identity. No outgoing email service was added.
- Bank, Review and question details expose Edit together. Native text fields use
  Yjs updates, Mongo CAS persistence and authenticated SSE. Presence indicates
  which fields colleagues are editing. Edits waiting for sync remain in the tab;
  download and navigation protection provide recovery options.
- Explicit Save version validates the shared snapshot and sends the new immutable
  version to Pending Review. Commit ids and version journal recovery handle lost
  responses and interrupted saves. Existing student attempts stay version-pinned.
- External edits require comparison before a shared draft can continue. Original
  option keys remain visible/exportable after a separately saved schema change.
- Ordinary question edits, parameters and transitions require version pins. Tag
  replacement also compares loaded tags. Course, Theme, LO and material forms use
  revision checks and preserve input on conflicts. Slow AI classification cannot
  silently replace newer manual material corrections.

## Validation

- Final unit/API run: **118 suites, 1551 tests passed**.
- TypeScript checks passed.
- Real local faculty + ta SAML sessions: concurrent same-field and separate-field
  editing, actual offline request failures/retry, lost successful save response,
  idempotent retry, version comparison/rebase, history, presence and live revocation.
- Offline recovery explicitly reopens the authenticated event stream so neither
  collaborator misses edits saved immediately after connectivity returns.
- Real browser desktop/mobile dark accessibility checks passed; screenshots in
  `audit-results/question-collaboration/`.
- Isolated sharing UI: 11 passing cases. Legacy editor conflict tests: 3 passing
  cases; original-draft-schema export regression also passed.
- Full-repository lint still reports 42 pre-existing errors in the three
  `docs/design/admin-operations-v2/verify*.cjs` design-verification scripts.
  Production source and focused new test files pass ESLint.

## Scope

Live text merging covers question stems, answers and explanations; shared choices
cover difficulty and answer roles. Structured course/material forms use explicit
conflict protection rather than Google Docs-style text merging. Roster/lifecycle
commands retain their existing action contracts. Offline edits are retained in the
open tab, not persisted to disk across browser crashes. No deployment or repository
commit was performed. Temporary live-test courses, roles and shared draft records
were removed after verification.
