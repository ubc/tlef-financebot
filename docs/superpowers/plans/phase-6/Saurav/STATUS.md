# Saurav — Phase 6 status

_Last updated: 2026-08-27_

## Where this stands

| Task | State |
|---|---|
| 1 — Component, config, connect/disconnect | **Complete** |
| 2 — Course link | Not started |
| 3 — File import | Not started |
| 4 — Roster sync | Not started |
| 5 — Enrollment gate + PRD | Not started |
| 6 — Instructor UI + hand smoke | Not started |

## Done before Task 1 (2026-08-27)

- **Design approved** and written up:
  `docs/superpowers/specs/2026-08-27-canvas-integration-design.md`. Decisions
  recorded there: read-only scope (no gradebook write-back), roster entries
  *add to* the CSV roster, a separate `lmsRosterEntries` collection keyed by
  PUID, no Moodle.
- **Package installed:** `@ubc/ubc-genai-toolkit-lms-integration@^1.2.0`
  (GitHub Packages; project `.npmrc` carries the registry line, the PAT lives
  in `~/.npmrc`). All 27 functions the recipes use verified present.
- **Local Canvas verified end to end** in `../local-lms-dev/` — bootstrap,
  292 sequences realigned, seeded course `FINBOT-DEMO` with an uneven roster
  (student 2 `integration_id` 42000001, student 3 42999999, student 4 none),
  assignment + submission, plain non-admin teacher `teacher1@example.com`.
- **Teacher-token roster read through real OAuth:** `integrationId` on
  **2 of 3**, identical to the admin key; `email`/`loginId` **0 of 3**.
  Matching on `integration_id` is viable with the token the app will use.
  Hosted UBC Canvas is a separate configuration and remains its own first
  check.

## Open questions for others

- **Kelvin / LT Hub:** on hosted UBC Canvas, is `integration_id` the PUID, and
  can a Teacher-role token read it? If either is no, the matcher has no key.
- **Ops before go-live:** the production Developer Key must be scoped to the
  five endpoints in the spec's Configuration section with *Allow Include
  Parameters* on. The local key enforces no scopes.

## Verification log

### Task 1 — 2026-08-27

- `npx jest tests/unit/lms-canvas.routes.test.ts` → 5/5. Full suite → 99 suites, 1,246 tests.
- `npm run typecheck:server`, `npx eslint` on changed files → clean.
- **Finding:** the package's structural `MongoDbLike` does not type-check
  against mongodb v7's `Db` (`createIndex` param variance). Cast at the one
  boundary in `components/lms/index.ts`; runtime shape is compatible. Worth
  reporting upstream.
- Mount probe with the real `.env` values: `/api/lms/canvas/status` and
  `/auth/login` → **401** unauthenticated (mounted, config accepted); `/courses`
  → 404 (Task 2 not built yet).
- **Connect, by hand, through the real app:** signed in as `faculty-user`,
  `/status` → `connected:false`; OAuth as `teacher1@example.com`; `/status` →
  `connected:true`. `lmsCanvasTokens` holds one document, `userKey` ===
  the faculty user's PUID, `canvasUserId` 5 (= teacher1), unique index on
  `userKey`.
- **Disconnect, by hand:** `POST /api/lms/canvas/auth/logout` → 200;
  `/status` → `connected:false`; `lmsCanvasTokens` → 0 documents. Note for
  the UI task: logging out of FinanceBot does *not* clear the Canvas token
  (by design — it is keyed by PUID, not session), so Settings needs a real
  *Disconnect* control.
