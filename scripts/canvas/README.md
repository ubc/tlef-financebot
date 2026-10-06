# Local Canvas acceptance tests

These scripts operate the existing local Canvas on http://localhost and FinanceBot
on http://localhost:6118. They never target staging or production. The fixtures
are explicitly named `FINANCEBOT-DEMO-*` / `financebot-demo-*`.

## Setup (local development only)

1. Start Canvas, MongoDB, Qdrant and the local SAML IdP as usual.
2. Run `python3 scripts/canvas/setup-local.py --idp-config /path/to/docker-simple-saml/config/simplesamlphp/authsources.php`.
   This appends twenty dedicated local IdP users, provisions corresponding Canvas
   users, creates 101/102/201 course shells, a dedicated teacher role with
   `read_sis`, a scoped OAuth Developer Key and a text document in each course.
   OAuth secrets go directly into ignored `.env`, never the presentation.
3. Run `npx tsx scripts/canvas/prepare-financebot.ts` for the existing local
   `faculty` SAML fixture's platform-Instructor grant.
4. Restart `npm run dev` (new environment variables require restart).

No production identity is provisioned. Local usernames/passwords follow the
existing fixture convention: `faculty` / `faculty`; students
`canvas_student_01` through `canvas_student_20`, password equals username.
The separate Canvas teacher login is `financebot-demo-teacher`, same password.

## Browser test sequence

From a freshly seeded, unlinked Canvas fixture set:

```
node scripts/canvas/test-local.cjs
node scripts/canvas/test-students-local.cjs
node scripts/canvas/test-boundaries-local.cjs
python3 scripts/canvas/build-presentation.py
```

Before a full rerun, unlink the previous dedicated demo courses in the FinanceBot
Canvas page; a Canvas source intentionally cannot attach to two FinanceBot courses.
The scripts create test courses and retain them for review. The boundary script
restores temporary Canvas enrollment/identity changes in `finally` even on failure;
if a browser failure interrupts reconnection, reconnect and synchronize in the UI.

Artifacts: `audit-results/canvas-integration/`. The standalone presentation is
`presentation/index.html`, with screenshots embedded. Serve **only** that subfolder:

```
python3 -m http.server 8770 --bind 127.0.0.1 --directory audit-results/canvas-integration/presentation
```

The parent folder contains local authenticated Playwright storage states. It is
ignored by Git and must not be published or served. The HTML report contains only
screenshots, dummy student results and test assertions.

## Verified locally, 2026-09-28

- Real OAuth consent, read-only scopes, Canvas teacher course filtering.
- 101 (12 students) + 102 (10 students), two overlaps => 20 unique students.
- Existing FinanceBot course linked to 201 without changing its ID or draft state.
- Two Alex Chen identities, twenty real CWL logins, one role per student.
- Draft excluded; nonmembers and students denied teacher endpoints.
- Actual file download + existing ingestion → ready; repeated import is idempotent.
- Drop one section retains other; drop all removes eligibility; missing PUID
  preserves complete previous roster with a visible failure.
- Same-origin mutation checks, OAuth state rejection, link revision conflict.
- Disconnect immediately removes Canvas-only grants; reconnect + sync restores.
- Typecheck passed; 93 focused tests passed; new Canvas page axe WCAG A/AA scan
  found zero violations; 390px viewport had no horizontal document overflow.

Real UBC deployment still requires an approved Developer Key, teacher SIS-data
access and confirmation that Canvas integration_id equals this service's released
CWL PUID. Local test values do not prove the production identity contract.
