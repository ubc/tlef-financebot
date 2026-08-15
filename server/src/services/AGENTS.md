# AGENTS.md — server/src/services

Business logic. Services sit between routes and components:

```
routes  ->  services  ->  components
```

A service orchestrates one or more `components/` to perform an application task
(e.g. "ingest a document" = document-parsing -> chunking -> embeddings ->
qdrant). Routes call services; services never handle HTTP request/response
objects directly.

## Current state

- `notes.service.ts` — EXAMPLE. Demonstrates using the `mongodb` component
  (`getDb().collection('notes')`) to insert and list documents. It exists to
  show the pattern and is safe to delete.
- `rag.service.ts` — EXAMPLE. Composes the genai + qdrant components into a RAG
  pipeline: `ingestText` / `ingestFile` (parse → chunk → embed → upsert) and
  `query` (embed → search → llm). Derives the Qdrant collection size from the
  embedding model so the two cannot drift. Safe to delete.
- `members.service.ts` — EXAMPLE (auth-gating reference). `buildMembersOverview`
  turns the authenticated session user (`AppUser` from `components/auth`) into a
  plain response object. It is called only from the gated
  `routes/members.routes.ts`, so it demonstrates a service backing a
  members-only feature. Keep or adapt for your own protected area.
- `roles.service.ts` — EXAMPLE (role-based authorization). `buildRoleArea(role,
  user)` returns a role-specific payload; `ROLE_AREAS` lists the roles that have
  an area. Called only from the role-gated `routes/roles.routes.ts`. Keep or adapt
  for role-specific features.
- `content-runs.service.ts` — Phase 2 P2-0 durable operation state. It owns
  legal status/stage transitions, revision compare-and-set writes, bounded
  event/warning history, startup reconciliation, and post-write course
  subscribers. Material/generation services must call this API rather than
  updating `contentRuns` directly.
- `generation-blueprints.service.ts` — persisted, course-scoped generation
  recipes plus exact terminal-run retry. Recipes pin LO/count/type/prompt,
  ready material IDs, and model choices; retry creates a distinct durable run
  from the original immutable snapshot.
- `content-map.service.ts` — instructor coverage read model joining the ordered
  hierarchy, material kinds/assignments, question publication counts, and
  recent content-run status. It is informational and never edits assignments.
- `classification.service.ts` — existing-hierarchy material classification plus
  AI hierarchy suggestion. Suggestions carry per-LO source mappings; reviewed
  apply creates the selected Topics/LOs and merges those mappings into material
  assignments without replacing existing links.
- `import.service.ts` — Parses and commits CSV/JSON/QTI questions, and migrates
  existing `generate(random)` templates through the real parameter worker.
  Script migration validates one deterministic sample, returns placeholder
  mismatches without writing, and creates only Draft question versions.
- `option-order.service.ts` — one pure function, `shuffleOptions`: seeded
  Fisher-Yates over MCQ answer options with the keys relabelled by new position.
  Called from `generateValidQuestion` (upstream of the validator and reviewer,
  whose prose cites options by letter) and from `createQuestion` (covering the
  import path). Callers that shuffled already pass `optionsAlreadyShuffled` so
  the order is not randomized twice.
- `admin.service.ts` — Admin Console v0 platform-Instructor grant/list/revoke.
  Uses PUID as the canonical identity, updates an existing matching User when
  present, leaves a pending grant otherwise, lists safe persisted User fields,
  and writes role assignment/revocation audit events. Raw SAML assertions never
  enter its response shapes.
- `preview.service.ts` — Instructor-only anonymous Student Preview
  orchestration. It exposes the currently released Approved-question
  hierarchy and reuses the production grading, mastery, strategy, Review Book,
  flag, summary, skip, remediation, and material-source behaviours against a
  short-lived `previewSessionId`. Attempts go only to `previewAttemptRecords`;
  mutable Preview Review Book and flag state goes only to
  `previewStudentSessions`. It never writes live student attempts, Review
  Book, mastery, or analytics. An explicit “send as TEST” option is the sole
  exception: it creates a clearly sourced live instructor-queue flag and a
  staff notification, while still skipping student labels, auto-pause, and
  all real-student notifications.
- `exam-templates.service.ts` — Phase 3 WS-10 midterm/final configuration.
  Validates course-scoped Theme selections and exam counts/windows, computes
  split-aware Approved-question supply warnings without blocking saves, and
  keeps one template per `(courseId, kind)`.
- `exam-attempts.service.ts` — Phase 3 WS-10 Approved-only exam assembly and
  one-open-sitting state machine. It pins versions/parameter values, records
  non-blocking shortfalls, exposes a correctness-free live projection, applies
  server-authoritative expiry, creates scored exam AttemptRecords exactly once,
  auto-collects misses, and exposes post-submit results/history.
- `exam-mastery.service.ts` — owns the `exam.mastery-pass` Agenda job contract
  and explicit post-start registration. Its idempotent batch worker marks only
  missed LOs `examVerified` and never overwrites practice-derived mastery
  status, tier, or rolling-window evidence.
- `capabilities.service.ts` — Phase 3 §4.2 permission resolution. It layers
  per-user course overrides over course-role overrides, platform settings, and
  defaults; `question.approve` and `flag.resolve` are hard-denied for TAs before
  any configurable value is considered.
- `course-deletion.service.ts` — owner/Admin-only, confirmation-gated permanent
  course deletion. It refuses active background work, validates uploaded-file
  containment, cleans Agenda and the course Qdrant collection, cascades through
  every course-scoped collection and question version, removes all user course
  roles, and deletes the course record last for retryable failure semantics.

Other services will appear as more components are built up.

## Adding a service

1. Create `<name>.service.ts` exporting plain functions (or a small class).
2. Import and use the relevant `components/` — do not reach into their internals;
   use their public `index.ts` exports.
3. Accept and return plain typed data, not Express `req`/`res` objects.
4. Call the service from a route in `server/src/routes/`.
