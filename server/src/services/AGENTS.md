# AGENTS.md — server/src/services

Supplemental enrollment lives in `registration-codes.service.ts`: one atomic
Mongo batch insert per request UUID, one claimant per code through a conditional
array update, and durable claimed-state recovery on session reload. Used codes
never regrant access. `enrollment.service.ts` delegates live joins to this path;
the legacy shared course code is retained only for isolated Student Preview.
Code lists use Mongo aggregation for code-level pages and status filters;
record deletion atomically invalidates unused codes and retains terminal claim
receipts with deletion actor/time. Pending claims cannot be deleted.
`teaching-identity.service.ts` resolves UBC email/existing CWL inputs for TA and
co-instructor invitations without guessing email from CWL. Read
`docs/design/supplemental-enrollment/IMPLEMENTATION.md` before changing these paths.

Business logic. Services sit between routes and components:

`people-import-parser.ts` parses manual Canvas CSV rosters with explicit Login ID
and optional role/state/restriction columns. `people-import.service.ts` owns
owner/Admin-only revisioned snapshot replacement/clear and audited changes.
Passport projects these roles from persisted Users on every request; imports do
not create placeholder accounts or persist roles in User. Student publication,
term, archive and deactivation gates also apply to membership read models.
Analytics, notifications and TA management use the same imported membership
filter; imported TA permissions remain in the existing capability settings.

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
- `tutorials.service.ts` — versioned, account-scoped contextual tutorial
  catalogue for Student/Instructor/TA/Admin and completion/dismissal/reset state. Missing or stale versions
  read as not viewed, allowing one micro-tutorial to evolve independently.
- `content-runs.service.ts` — Phase 2 P2-0 durable operation state. It owns
  legal status/stage transitions, revision compare-and-set writes, bounded
  event/warning history, startup reconciliation, instructor-ended generation
  runs, and post-write course subscribers. Ending a run is only a terminal write
  (failed, `generation-ended`): the pipeline stops at its next
  `assertContentRunActive` check or progress write, so any long-running stage
  loop must call that check before each paid step. Material/generation services must call this API rather than
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
- `placeholder-repair.ts` — pure `repairPlaceholderText` for stored text damaged
  by `{{NAME}}` braces colliding with LaTeX groups (`^{{N}/4}`,
  `-{{DOWN}+...}`) or by swallowed JSON escapes. Used by
  `scripts/repair-latex-placeholders.ts`, which writes a new version per question
  and recomputes the numeric proof. Prevention lives elsewhere: `substituteParams`
  keeps a brace group when a placeholder is a `^`/`_`/`\frac`/`\sqrt` argument,
  and `placeholderSyntaxFailure` (numeric-verification.service.ts) rejects broken
  or undeclared placeholders in generated questions as verifier retry feedback —
  conceptual ones included, since they have no slots at all — plus implicit
  products in math (`implicitProduct`: `\frac{..}{100}{{YEARS}}` renders as a
  fraction then a stray number; two bare `\frac{{A}}{{B}}` arguments are exempt). The serving
  backstop is `unresolvablePlaceholders` in numeric-gate.service.ts: `isServable`
  refuses any version (conceptual or numeric, script versions excepted) carrying
  a placeholder that substitution can never fill.
- `admin.service.ts` — Admin Console v0 platform-Instructor grant/list/revoke.
  Uses PUID as the canonical identity, updates an existing matching User when
  present, leaves a pending grant otherwise, lists safe persisted User fields,
  and writes role assignment/revocation audit events. Raw SAML assertions never
  enter its response shapes.
- `preview.service.ts` — teaching-team anonymous Student Preview
  orchestration. It exposes the currently released Approved-question
  hierarchy and reuses the production grading, mastery, strategy, Review Book,
  flag, summary, skip, remediation, and material-source behaviours against a
  short-lived `previewSessionId`. Attempts go only to `previewAttemptRecords`;
  mutable Preview Review Book and flag state goes only to
  `previewStudentSessions`. It never writes live student attempts, Review
  Book, mastery, or analytics. An explicit “send as TEST” option is the sole
  exception: it creates a clearly sourced live instructor-queue flag and a
  staff notification, while still skipping student labels, auto-pause, and
  all real-student notifications. The route permits that TEST option only for
  course Instructors/Admins; current course TAs use fully isolated Preview state.
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

`course-sharing.service.ts` owns owner/Admin-managed co-instructor invitations
and revocation. `courseInstructorShares` is the grant authority; session reads
project active grants into `courseRoles` without copying them into User or
granting platform Instructor. Pending invitations match canonical CWL email
and use revision/status CAS, so revoke cannot race login into re-granting access.
Admin directory/removal and staff notification readers use this same authority.
No outbound email or public bearer link is created.

## Adding a service

1. Create `<name>.service.ts` exporting plain functions (or a small class).
2. Import and use the relevant `components/` — do not reach into their internals;
   use their public `index.ts` exports.
3. Accept and return plain typed data, not Express `req`/`res` objects.
4. Call the service from a route in `server/src/routes/`.

- `analytics.service.ts` aggregates exact mode/date scopes, active zero-attempt LOs,
  bounded question/version patterns and version-isolated distributions. Engagement
  includes empty weeks and active-LO coverage; durations describe observed attempt
  spans. Historical metadata never substitutes a current version.

`structure-generation.service.ts` owns the `structure.generate` background job.
It scans all selected materials' stored chunks (not excerpt/top-k retrieval),
validates per-section extraction using numbered source-passage IDs (resolving the
original quote on the server), retries invalid batches in smaller sections, and streams the synthesized
outline into a dedicated durable run preview. Counts default to AI choice; explicit
counts are validated. Source/size failures never produce a silently partial outline.
Coverage gaps and exclusions accompany the draft. `classification.suggestHierarchy`
uses the same analyzer through its legacy read-only response shape.

Admin diagnostics lives in `admin-diagnostics.service.ts`: global, Admin-gated
read models over request outcomes, existing change history, durable runs and
question/version/attempt evidence. `operation-audit.service.ts` persists bounded,
redacted telemetry; `operation-context.ts` carries request IDs into run creation.
Read-only reproduction uses the existing parameter evaluator and pinned versions;
it must not silently substitute fresh parameters for missing attempt evidence.

`question-collaboration.service.ts` owns durable question drafts and expiring
presence. Fresh course/capability checks apply to reads, writes and SSE ticks;
Mongo revision CAS merges Yjs updates across processes. Explicit commits validate
content, create immutable Pending Review versions, and journal the commit id on
the version so interrupted head/draft updates can recover without duplicate
versions. Normal question editing requires version pins and tag snapshots.

### Exam Builder v2

`exam-builder.service` owns course-scoped revisioned papers and immutable publication.
`exam-generation.service` owns private durable plans, Agenda jobs, cancellation,
missing-only retries and startup reservation recovery. `QuestionVariantService`
freezes verified parameter draws; `generatePrivateAssessmentQuestion` reuses the
existing generation pipeline without bank writes. `assessment-attempts.service`
uses separate attempts with server deadlines, answer CAS and explicit feedback
release; it never updates practice analytics/mastery/Review Book.


Exam catalog names use revision-checked `displayTitle` metadata so a published
paper remains immutable and locked. Permanent exam deletion requires no student
start or active generation, marks the head before cleanup, and removes the head
last; interrupted cleanup is retryable.

`canvas.service.ts` owns many-to-one Canvas course links, complete roster snapshots,
periodic refresh and explicit document import through existing material runs.
`canvas-enrollment.service.ts` projects fresh, versioned Canvas eligibility into
course Student/Instructor/TA session roles by exact Canvas login_id = CWL PUID,
without changing manual or platform roles. Students need published courses within
term dates; teaching roles may prepare drafts before term start. Archived/expired
courses grant nothing. Never use names, email, integration_id or student numbers
as fallback identity. Missing Login IDs/enrollment metadata abort refresh.
Only active matching-course enrollments participate; custom or section-limited
teaching roles are excluded because FinanceBot cannot mirror their restrictions.

Canvas snapshots also keep separate display-only `people` for all active/invited
Canvas role types, including restricted teachers, observers and designers. These
records never feed role projection. API responses mask identity and compute isSelf
from the request's authenticated PUID. Missing older display snapshots require sync.


`model-usage.service.ts` owns the metadata-only model-call receipt ledger and
tracking manifests. HTTP observers resolve authenticated identity at call time;
Agenda owners establish independent run scopes. Late completions update existing
receipts only. Unknown usage is nullable; accounting errors never retry a model.
`admin-workflow.service.ts` joins bounded operation/content-run records and
material names, distinguishing recorded links from inferred time groupings.

`generation-evidence.service.ts` resolves vector locators to original indexed
source passages, adds immediate neighbors, hashes scoped source content, and
rechecks material eligibility/currentness. `generation-memory.service.ts` reads
pinned current Bank/Queue versions with bounded context and same-batch entries;
exact fingerprints and lexical retrieval are aids, not semantic novelty proofs.
`generation-quality.service.ts` adds an opt-in structured source/notation/task
assessment, validates reference locations, and records bounded diagnostic output.
The public tracked pipeline preserves `grounded-memory-v1` on runs/recipes/retry,
withholds failed checks as visible shortfalls, and keeps existing numerical and
approval gates. Baseline and private/transient generation retain their policies.
Context rechecks do not provide a concurrent commit fence or teacher calibration.

`generation-evaluation.service.ts` exports terminal public generation observations
for offline review. It binds initial version-1 questions through course-owned
heads and exact run/item provenance, uses recorded withheld snapshots, and keeps
missing originals explicit. Safe usage rows and independent authoritative totals
exclude actor/request/session identity. It never reconstructs historical source,
LO, or starting-bank snapshots from current records or calls a model.


## Course People consolidation (2026-10-06)

People consolidates Enrollment, Teaching Assistants and Co-instructors using
course-scoped merged identities, search and server pagination. People and Share
share Student/TA/Instructor invitations. Owner/Admin controls role changes,
course bans and one-time-code mutations. Revisioned `coursePeopleAccess` decisions
apply last at session reload and override all grant sources; CSV/Canvas cannot
restore bans or superseded roles. Pending canonical-email binding preserves
cancellation tombstones and never grants platform privileges. Gradebook preview
and persisted `lastChanges` identify newly added people by exact PUID and show
names before/after commit with paginated lists. See
`docs/design/course-people/IMPLEMENTATION.md`, `docs/api-contract.md`, and
`playwright.course-people.config.ts`. Old standalone UI/enrollment descriptions
above describe historical entry points; the current Instructor entry is People.
