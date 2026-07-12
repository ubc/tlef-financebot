# Stephen — Phase 0 progress

_Last updated: 2026-07-12_

**Where the code lives:** branch `stephen/phase-0` (PR #3, open, CI green — not
yet merged to `main`). Branch includes `origin/main` (your Tasks 4 + 5 + 9
merged in). Pull `origin/stephen/phase-0` to see the code. Full suite: **39
tests green** (lint + typecheck clean).

**Nothing of yours is blocking me now** — thanks for landing Tasks 4 + 5. All my
Phase 0 code tasks are done. The only things left are Docker-gated (see below).

## Done (verified: lint + typecheck + `npm test` 39/39 green)

| Task | What | Commit |
|---|---|---|
| 1 | Pin ubc-genai-toolkit exact; add helmet, express-rate-limit, zod, katex/marked/dompurify, eslint | `d073ea7` |
| 3 | Per-step LLM model config, admin allowlist, worker limits, `assertConfig()` prod safety | `1d2be2a` |
| 6 | `validate()` zod middleware + helmet + `/api` rate limiting | `f2e803a` |
| 12 | eslint flat config + GitHub Actions CI (lint/typecheck/jest) | `49e86d0` |
| 7 | PUID-keyed user identity upserted on CWL login; session stores PUID only | `65a806f` |
| 8 | `/api/auth/me` identity contract + role-appropriate home stub; client auth layer migrated to the new shape | `8916a8b` |

## Partial / pending (Docker-gated — not blocked on you)

| Task | State |
|---|---|
| 2 | Files written and `docker compose config` valid (`4a2a9f3`). **Live verify pending** — `docker compose up` + mock-CWL login not yet run (Docker unavailable on my machine). |
| 7/8 | Code + unit tests green. Manual session-restore + role-heading verification needs the running stack (Docker). |
| 13 (walking skeleton e2e) | **Joint sync point.** Needs Docker + the Playwright stack. Tasks 7/8 (its prerequisites) are done — ready to run together once Docker is up. |

## Note: I touched the client auth layer

Task 8 migrated `client/src/{api,auth,main}.ts` + the members demo view from the
old `{ nameId, attributes }` SAML shape to the new PUID-keyed `{ puid, uid,
displayName, isAdmin, affiliations, courseRoles }` identity. Client roles are now
derived from `affiliations`. Heads-up in case your instructor views (Task 15,
Phase 1) touch the same files.

## Heads-up: two files we both edited (merge conflict incoming)

We independently made the same changes on separate branches — same intent, so
resolution is trivial (keep either version):

- **`AGENTS.md`** — name↔arc binding. Your wording is more detailed; keep yours.
- **`scripts/sync-plans.sh`** — we both fixed the "untracked plan files not
  published" bug. Keep one implementation, drop the other.

## What I need from you (Saurav)

1. **Review + merge my PR #3** so `main` gets the pinned deps + config + hardening + identity.
2. When we're both around with Docker up, let's run **Task 13 (walking skeleton e2e)** together — it's the joint Phase 0 exit gate.
3. Confirm you're OK with the client auth-layer migration noted above (affects shared client files).
