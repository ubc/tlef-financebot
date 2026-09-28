# FinanceBot × UBC staging Canvas

## Operator prerequisites

- Canvas: https://ubcstaging.instructure.com
- FinanceBot: https://financebot.staging.apps.ltic.ubc.ca
- Staging-only Canvas API Developer Key, enabled by the Canvas administrator.
  This is an OAuth API key, not an LTI key or a personal access token.
- Register this exact OAuth redirect URI:
  `https://financebot.staging.apps.ltic.ubc.ca/api/canvas/callback`
- Enable only these scopes:

```
url:GET|/api/v1/courses
url:GET|/api/v1/courses/:course_id/users
url:GET|/api/v1/courses/:course_id/sections
url:GET|/api/v1/courses/:course_id/files
url:GET|/api/v1/courses/:course_id/files/:id
url:GET|/api/v1/files/:id/public_url
```

## Server configuration

Set all five values together in the deployment's secret/environment management,
then restart/redeploy staging. An incomplete set deliberately fails validation.
Do not put secrets in Git, chat, screenshots, or browser-side configuration.

```
CANVAS_DOMAIN=https://ubcstaging.instructure.com
CANVAS_CLIENT_ID=<administrator-issued API Developer Key ID>
CANVAS_CLIENT_SECRET=<secret stored directly in deployment secret storage>
CANVAS_REDIRECT_URI=https://financebot.staging.apps.ltic.ubc.ca/api/canvas/callback
CANVAS_TOKEN_KEY=<persistent random 32-byte key encoded as 64 hexadecimal characters>
```

Keep the encryption key stable across deploys. Replacing it makes existing
stored OAuth tokens unreadable; plan reconnection if it must be rotated.
Leave all five unset until the approved values are available: the app continues
normally and Canvas connection reports that configuration is required.

## Test data to request from the Canvas/IAM administrator

1. Dedicated COMM 298 test course shells for sections 101 and 102, with the
   connecting instructor enrolled as an active Teacher in both. No live classes.
2. Twenty authorized test identities: ten active students in each section, one
   section per student. Include two distinct identities with the same display name.
3. Confirm the teacher's scoped API response exposes each student's `integration_id`
   and verify that this value equals the PUID released to FinanceBot's staging CWL
   SAML service. Neither a Canvas numeric ID, name, student number nor arbitrary
   locally invented PUID establishes this mapping.
4. At least two of these identities must be able to log in through the actual
   staging CWL IdP for an initial end-to-end enrollment test. Twenty Canvas-only
   dummy accounts can exercise the roster UI but cannot prove CWL auto-enrollment.

The app's scopes are read-only: create Canvas courses/users/enrollments in the
Canvas administrator workflow, not by broadening FinanceBot's permissions.

## Acceptance sequence

- Sign in to FinanceBot as instructor; open Canvas connection; authorize the app.
- Select the dedicated FinanceBot draft and link both Canvas course shells.
- Verify course counts, twenty distinct identities and student pagination/search.
- Upload an instructor-owned test document in Canvas, explicitly import it in
  FinanceBot and wait for Course Materials to report Ready. Repeat import should
  not create a duplicate version.
- Complete the normal FinanceBot launch checklist, confirm term dates and publish
  only the dedicated test course when ready to exercise student access.
- Sign in using the authorized test CWL identities: course appears without a
  registration code. An unenrolled test identity must not gain access.
- Transfer one test student 101 → 102, sync, and verify the same FinanceBot history.
- Withdraw that test student from their only section, sync, and verify Canvas-only
  access ends. Separately verify manual enrollment remains intact.
- Test disconnect/reconnect on the dedicated instructor connection; verify refresh
  and delayed/stale synchronization states. Never change identifiers on real users.

## Initial observed state (2026-09-28)

FinanceBot staging Admin login works. Created one draft:
`COMM 298 - FinanceBot Canvas Staging Test`, sections `101 + 102`, Winter Term 1
2026/27, course ID `6abaf5deb4b9348be782463a`. It has no materials or students.
The supplied Canvas account's All Courses page says it has no enrollments and
shows no course-creation or Admin entry. Canvas course provisioning, OAuth key,
server secrets and real identity mapping still require administrator assistance.

## References

- https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth
- https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys
