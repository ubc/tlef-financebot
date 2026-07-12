# Stephen — Phase 0 progress

_Last updated: 2026-07-12_

**Where the code lives:** branch `stephen/phase-0` (PR #3, open, CI green — not
yet merged to `main`). Branch now includes `origin/main` (Saurav's Task 4 domain
types merged in). Pull `origin/stephen/phase-0` to see the code. Full suite: 32
tests green.

**Blocking me right now:** Saurav's **Task 5 (collections.ts / `usersCol()`)**.
Task 4 (types) is merged — thank you — but Task 7 (PUID identity) imports the
collection accessors from Task 5, so it stays blocked until Task 5 lands.

## Done (verified: lint + typecheck + `npm test` 27/27 green)

| Task | What | Commit |
|---|---|---|
| 1 | Pin ubc-genai-toolkit exact; add helmet, express-rate-limit, zod, katex/marked/dompurify, eslint | `d073ea7` |
| 3 | Per-step LLM model config, admin allowlist, worker limits, `assertConfig()` prod safety | `1d2be2a` |
| 6 | `validate()` zod middleware + helmet + `/api` rate limiting | `f2e803a` |
| 12 | eslint flat config + GitHub Actions CI (lint/typecheck/jest) | `49e86d0` |

## Partial

| Task | State |
|---|---|
| 2 | `docker-compose.yml` + `docker/saml/authsources.php` + README written and `docker compose config` valid (`4a2a9f3`). **Live verify pending** — `docker compose up` + mock-CWL login not yet run (Docker wasn't available on my machine this session). |

## Blocked — waiting on Saurav

| Task | Needs |
|---|---|
| 7 (PUID identity) | Your **Task 5** (`server/src/components/mongodb/collections.ts` → `usersCol()`), which needs your **Task 4** (`server/src/types/domain.ts`). Neither is on `main` yet. |
| 8 (role home stub) | Task 7. |
| 13 (walking skeleton e2e) | Joint; needs Docker + Tasks 7/8. |

## Heads-up: two files we both edited (merge conflict incoming)

We independently made the same changes on separate branches — same intent, so
resolution is trivial (keep either version):

- **`AGENTS.md`** — name↔arc binding. Your wording is more detailed; keep yours.
- **`scripts/sync-plans.sh`** — we both fixed the "untracked plan files not
  published" bug. Keep one implementation, drop the other.

## What I need from you (Saurav)

1. Land **Task 4 (domain types)** and **Task 5 (collections)** — that unblocks my Task 7 → 8 → 13.
2. Task 4 is a **sync point**: ping me to review the PR before merge (shared vocabulary).
3. Agree on merge order: my **Task 1 (pinned deps)** should hit `main` first per the plan, before other branching.
