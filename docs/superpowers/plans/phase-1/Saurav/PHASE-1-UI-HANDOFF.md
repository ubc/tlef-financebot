# Phase 1 UI — Status & Handoff

_Last updated: 2026-07-18 (Saurav)_

Cross-developer note (for Stephen and his agent). The detailed per-task ledger
lives in `STATUS.md`; this file is the clean summary + how to run/see the
instructor UI + what changed in how we plan UI work.

## 1. Where Phase-1 UI stands

Phase 1 has **two** product-UI halves; both are now built:

| UI | Owner | Status |
|---|---|---|
| **Student** — enroll by code, course home, practice by LO/theme + adaptive feedback, Review Book, session summary | Stephen | **Merged to `main`** (`client/src/views/student/*`, enroll flow in `home.ts`) |
| **Instructor** — My Courses/Create, Dashboard, Structure editor, Settings, Materials, Question Bank + review/editor, Review Queue, Pre-seeding/Generate | Saurav (Task 15) | On `saurav/task-15-instructor-views` → **PR open** |

Everything else in the Figma file (TA `T1–T4`, Admin `A1–A5`, Analytics `I9/I10`,
Exam screens, Parameterization `I13`) is **later phases**, not Phase 1.

## 2. NEW: we plan UI work against the Figma designs (via Figma MCP)

We now have a **Figma MCP connection**, and UI-facing plans should be updated to
reflect our earlier design work rather than invented from scratch.

- **Design source:** Figma file `Finance-bot`, page **"Wireframe v0.2"** (canvas
  `148:2725`). File key `3lSS05Sk1OWpnxFQNyVsM9`. **Use `v0.2`, not `v0.1`.**
- **Screen → node-id map** for the instructor screens is in
  `task-15-wireframe-reference.md` (same folder), including the green-shell
  description, the option-role display-label mapping, and the palette.
- **How to read a screen:** with the Figma MCP connected, `get_metadata(fileKey)`
  lists pages; `get_metadata(fileKey, nodeId)` dumps a frame's structure;
  `get_screenshot(fileKey, nodeId)` returns a PNG. Load the `figma-use` skill
  before any `use_figma` write call.
- **Task 15 already follows this** — it was re-planned wireframe-driven (see
  `2026-07-17-task-15-instructor-views.md`). Match it *roughly*: layout,
  structure, and the green/white language — not pixel-perfect tokens.
- **Stephen's student UI predates this workflow** — it was built before we
  adopted the wireframes. No action required from me; just flagging in case you
  want to reconcile the student screens (`1–12`, `S*`) with v0.2 later. Your call.

## 3. Run it locally + see the INSTRUCTOR UI (setup guide for Stephen's agent)

The app runs on **:6118**. Backing services live in the sibling repos
(`../tlef-mongodb-docker`, `../docker-simple-saml`, `../tlef-qdrant`). The
instructor UI has two gotchas — both are handled below.

```bash
# 0. Docker Desktop running.

# 1. Start backing services. IMPORTANT: recreate Mongo so it PUBLISHES :27017 —
#    a stale container can run with the port unmapped (server then can't connect,
#    ECONNREFUSED 127.0.0.1:27017). Data is volume-backed, so this is safe.
(cd ../tlef-mongodb-docker && docker compose up -d --force-recreate)
(cd ../docker-simple-saml && docker compose up -d)     # SAML IdP on :6122 (required for login)
(cd ../tlef-qdrant && docker compose up -d)            # optional (materials ingest only)
docker inspect mongodb --format '{{json .NetworkSettings.Ports}}'   # expect 27017 -> 0.0.0.0:27017

# 2. First-time only:
cp .env.example .env        # if you don't have .env
npm run saml:fetch-cert     # writes server/certs/idp.pem (IdP must be up)

# 3. GOTCHA — the instructor shell needs an INSTRUCTOR, and no test user is one
#    by default. isInstructor() = isAdmin || an instructor courseRole; the mock
#    CWL users are faculty/student by affiliation only. Quickest dev fix: make a
#    test faculty user an admin by adding its PUID to ADMIN_CWL_ALLOWLIST in .env.
#    `bio_prof`'s PUID (ubcEduCwlPuid) is 23456789:
#       ADMIN_CWL_ALLOWLIST=PUID-ADMIN-0001,23456789
#    (isAdmin is set at first login from the allowlist; Mongo starts empty.)

# 4. Run:
npm run dev                 # server + client watchers; http://localhost:6118
```

Then open **http://localhost:6118** → **Log in with CWL** → **`bio_prof` / `bio_prof`**
(password = username) → you land in the green instructor shell. My Courses is
empty → **Create Course** → explore every view.

**What won't fully work without Ollama + Qdrant published:** materials upload
goes `processing → failed`, and generation queues but produces nothing (both need
a local LLM/embeddings). Everything else — course setup, hierarchy, bank, review
queue, publish, settings — works fully. To exercise materials/generation, run
Ollama with `ministral-3:latest` + `nomic-embed-text` and make sure Qdrant
publishes :6333.

**Revert when done:** set `ADMIN_CWL_ALLOWLIST` back to `PUID-ADMIN-0001`.

## 4. Other things worth knowing

- **Instructor provisioning decision (I1).** `isInstructor()` keys the shell on an
  EXPLICIT grant (`isAdmin` or an instructor `courseRole`), **not** faculty
  affiliation — deliberately. Model: instructors are **admin-provisioned**.
  Interim for the pilot = pre-provision an instructor course-role before first
  login (a provisioned instructor hits no dead-end). **Phase-2 follow-up:** a
  platform-level instructor grant + an admin management surface (the A1/A2/I11
  admin/TA screens) so admins provision self-serve and an instructor with zero
  courses still gets the shell. Documented at `client/src/main.ts` `isInstructor()`.
- **Task 15 is client-only.** No server/contract changes. Two bits are derived
  client-side because no read-only endpoint exists: the My-Courses list (from
  session `courseRoles` + N `getCourseTree`) and the dashboard pre-publish
  checklist. Generation is **async** (`202 {jobId}`; Drafts land later) so there's
  no live "generated question" preview.
- **Shared client files** Task 15 touched: `main.ts` (instructor routing/shell),
  `home.ts` (instructor branch), `api.ts` (instructor endpoints), `main.css`, and
  a new `instructor-ui.ts` (shared primitives) + `views/instructor/*`. If your
  work touches `main.ts`/`home.ts`/`api.ts`/`main.css`, expect to merge alongside
  these — they're additive.
- **Deferred Task-15 Minors (follow-ups, none blocking):** dedupe
  `approveTarget`/`topicLoLabel` (copied across bank/detail/queue); wire or drop
  the dead `getSuggestedHierarchy` export (N10 apply-UI unbuilt); add request
  sequencing to `bank.ts` filter reload; disable approve/bulk buttons in-flight;
  `settings.ts` auto-pause allows 0 vs server >0; index-based option compare in
  `question-detail.ts`.
- **e2e:** `tests/e2e/instructor-pipeline.spec.ts` exists; its **live run is
  deferred to the ~Aug 2 joint checkpoint** (needs the full stack + optionally an
  LLM). It seeds an Approved question when `LLM_AVAILABLE` is unset so the
  approve/publish path runs without a model.
- **Task 13 (Layer-2 LLM mastery evaluator) is UNBUILT** by either of us — it's
  the "either"-owner slip candidate. Your Task 9 laid the groundwork (the
  `attemptsSinceEvaluation` counter it increments is Task 13's cadence trigger;
  `struggling` is reserved for Layer 2; `env.llmModelMasteryEvaluator` is a wired-
  to-nothing slot). Because Task 13 modifies your `attempts.service.ts`, per the
  plan nobody starts it without a heads-up to you first.
