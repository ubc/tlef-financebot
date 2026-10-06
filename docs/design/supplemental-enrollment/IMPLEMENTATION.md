# Supplemental enrollment and teaching invitations

Implemented locally on 2026-10-06. Canvas Gradebook/people CSV imports remain the
primary class enrollment path. Supplemental codes cover students omitted from
that import. This change does not deploy or publish a course.

## Instructor workflow

1. Open Course Settings → Enrollment and import the Canvas Gradebook CSV.
2. Generate 1–50 one-time registration codes and give one unused code to each
   additional student. There is no additional roster allowlist to maintain.
3. The student signs in through CWL, opens My Courses and submits the code.
   Enrollment requires a published course within its term dates.
4. Refresh the code list to see Unused, Enrollment pending, Used, Revoked or
   Expired. Claimed codes show the person's name, email, CWL, PUID, claim time
   and last CWL login. Last login is a sign-in timestamp, not online presence.
5. Revoke an unused code if it should no longer be accepted. Revocation does
   not remove an enrolled student's access.

The interface uses a compact table with short status badges and inline identity
and timestamps. Status filters and server pagination offer 10, 25 or 50 rows
per page, defaulting to 25. Expanded help holds longer workflow guidance.
Delete removes an unused, used, revoked or expired record from the list;
unused codes are invalidated atomically and used codes retain their receipts
and membership. Pending enrollment records cannot be deleted. Removal is soft
deletion with actor/time, not removal of student access or historical evidence.

Teaching Assistants now accepts UBC email or an existing CWL username, matching
Co-instructors. Known accounts activate immediately; an unknown UBC email
remains pending until the matching account signs in. An unknown CWL is rejected
because the system cannot infer its email/PUID. No invitation email is sent.
The shared resolver rejects ambiguous or deactivated identities. TA approval
and final flag resolution remain prohibited.

## Persistence and correctness

`courseRegistrationCodeBatches` stores one atomic batch document per
course/request UUID. A unique course/request index prevents duplicate batches
after retries, and a unique multikey code index protects global code uniqueness.
Codes use cryptographic random generation, 12 characters, and a conditional
Mongo array update to move from available to claimed by exactly one PUID.

The claimed code is reserved while the Student role is persisted, then becomes
used. If the membership write is interrupted, the same account can retry and
authenticated session reload resumes eligible claims. This is a durable recovery
protocol, not a multi-document transaction. Used codes do not automatically
regrant a subsequently removed role. Concurrent course lifecycle changes are
not serialized with the membership write; normal course access guards still
apply. Claimed codes cannot be revoked through unused-code revocation.

Instructor/Admin-only list responses join bounded identity fields rather than
returning entire User records. Code-level server pagination covers all batches
and returns total/page/pageSize/pageCount; deleted rows are excluded. An
out-of-range page clamps after deletion and timestamp ties have stable batch/code
ordering. Concurrent inserts may shift offset pages; this is a management view,
not a frozen export. Permanent course deletion removes
its code batches along with the existing course data.

## Legacy behavior

The old shared-code/Roster editor is removed from Course Settings. Existing
student roles and historical roster extensions remain stored. The legacy
shared course code no longer grants live enrollment, and its regeneration
endpoint returns 410. The legacy field remains for isolated Student Preview;
preview cannot consume real supplemental codes. A shared registration code is
no longer a publication checklist requirement.

## Verification

- `npm run build`: server and client compile successfully.
- Unit/HTTP suites cover bounded batch creation, UUID replay, unique claims,
  failures and recovery, publication/term/archive gates, deactivation, revocation
  and Instructor/Admin-only receipts. TA tests cover existing CWL activation,
  pending email, duplicates and ambiguous identity rejection.
- `course-admin-workbench.spec.ts`: intercepted desktop/mobile UI fixtures,
  light/dark accessibility checks, code generation/revocation and TA CWL input.
- `npx playwright test --config playwright.enrollment-live.config.ts`: real
  local SAML, Express and Mongo acceptance with a temporary synthetic course.
  Two CWL accounts concurrently redeem one code: exactly one succeeds. The
  second enrolls using another code. Gradebook-enrolled students do not consume
  codes; used/revoked/legacy codes cannot enroll another account. Receipt
  identity, Student Analytics membership, TA/CWL activation, email duplicates,
  unchanged co-instructor access and TA hard denials are also checked.
  The expanded acceptance also checks six distinct pages across 53 records,
  status filtering, live UI navigation, unused-code invalidation on deletion
  and unchanged membership/replay denial after deleting a used receipt.

The live fixture removes its temporary course, roles, code batches, imports,
invitations and capability overrides. Screenshots under
`artifacts/one-time-enrollment-2026-10-06/` distinguish live acceptance from
intercepted UI fixtures. No LLM calls are involved.
