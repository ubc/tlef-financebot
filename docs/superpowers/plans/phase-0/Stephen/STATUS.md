# Stephen — Phase 0 progress

_Last updated: 2026-07-14_

**Phase 0 (Dev A) is code-complete and verified end-to-end.** All my tasks are
done, merged to `main` except Task 13 which is in **PR #10** (open). Latest work
lives on branch `stephen/phase-0`. Full suite green: **39 unit + 8 e2e**, lint +
typecheck clean.

> **Update (post–Phase 0):** the per-project `docker-compose.yml` +
> `docker/saml/authsources.php` + `npm run services:up` wrapper described below
> have since been **removed**. Backing services now run from the shared repos
> under `../services/` (`tlef-mongodb-docker`, `docker-simple-saml`,
> `tlef-qdrant`), and the test users are the shared IdP's `faculty` / `student` /
> `staff` (password = username) — not `student1`/`instructor1`. The historical
> notes below are kept for context but reflect the old approach.

## Done — my tasks (Dev A)

| Task | What | Status |
|---|---|---|
| 1 | Pin toolkit exact; add helmet, rate-limit, zod, katex/marked/dompurify, eslint | merged (`d073ea7`) |
| 2 | Backing services (Mongo, Qdrant, SAML IdP) — originally a per-project `docker-compose.yml` (`4a2a9f3`), **since replaced by the shared `../services/` repos** | merged, later superseded |
| 3 | Per-step LLM model config, admin allowlist, worker limits, `assertConfig()` | merged (`1d2be2a`) |
| 6 | `validate()` zod middleware + helmet + `/api` rate limiting | merged (`f2e803a`) |
| 7 | PUID-keyed identity upserted on CWL login; session stores PUID only | merged (`65a806f`) |
| 8 | `/api/auth/me` contract + role-appropriate home; client auth layer migrated | merged (`8916a8b`) |
| 12 | eslint flat config + GitHub Actions CI (lint/typecheck/jest) | merged (`49e86d0`) |
| 13 | **walking-skeleton e2e** + fixes to make the mock-CWL workflow run | **PR #10 (open)** (`63c4378`) |

## Verified live (services up)

Ran the full Phase 0 exit path on my machine: the shared IdP + Mongo (+ Qdrant) +
`saml:fetch-cert` + `npm run build && npm start` → `npx playwright test`.
**8/8 e2e pass**, including both walking-skeleton specs (mock CWL login →
session persists across reload → role-appropriate home → PUID identity).
(Verified originally against the per-project compose stack; the same path now
runs against the shared `../services/` containers.)

## Task 13 fixes worth knowing (in PR #10)

- **docker-compose SP port `3000` → `6118`**: Task 2 registered the SAML SP on
  env.ts's stale `:3000` default, but the app runs on `:6118` — the IdP was
  rejecting every login. Fixed.
- **e2e global-setup**: log in as `faculty`/`faculty` (shared IdP user; password =
  username), and match the SimpleSAMLphp login button by role (it's a bare
  `<button>`, no `type=submit`). _(Originally logged in as `instructor1` against
  the per-project compose IdP.)_
- **app.spec / config.test**: updated for the Task 8 PUID shape and made the
  SESSION_SECRET case hermetic against a local `.env`.

## Backing services (current approach)

> The `npm run services:up` wrapper (`scripts/services-up.sh`, commit `83ae779`)
> that once lived here has been **removed**. It only existed because the
> per-project compose fought other projects for host ports 27017/6333/6122.

Services now run from their own shared repos under `../services/`, so there is no
per-project compose to conflict — start each once and leave it up:

```bash
cd ../services/tlef-mongodb-docker && cp .env.example .env && docker compose up -d
cd ../services/docker-simple-saml && docker compose up -d
cd ../services/tlef-qdrant && docker compose up -d
```

Documented in `AGENTS.md` + `README.md`.

## Note: I touched the client auth layer

Task 8 migrated `client/src/{api,auth,main}.ts` + the members demo view from the
old `{ nameId, attributes }` SAML shape to the PUID-keyed `{ puid, uid,
displayName, isAdmin, affiliations, courseRoles }` identity; client roles derive
from `affiliations`. Heads-up in case your instructor views (Phase 1) touch the
same files.

## What's left for Phase 0

- **Merge PR #10** (Task 13 + services wrapper) → then all 13 tasks are on `main`.
- **Non-code:** confirm the CWL PIA/DAR kickoff with UBC IAM, and the PSD
  "RAG fallback" vs Approved-only reconciliation (default: Approved-only).
- After that, Phase 0 is closed and we're clear to start Phase 1.

## What I need from you (Saurav)

1. **Review + merge PR #10** — it's the joint Phase 0 exit gate.
2. Optionally re-run the walking-skeleton e2e on your machine from a fresh clone
   (start the shared `../services/` containers, then `npm run saml:fetch-cert && npm run build && npx playwright test`).
