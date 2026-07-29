# Stephen — Phase 2 progress

_Last updated: 2026-07-28_

## Update (2026-07-28): workflow/UX hardening loop started

Stephen requested an extended user-journey loop covering both Instructor
course-authoring paths, question generation/review, flags/notifications, and
the complete anonymous Student Preview workflow. The working plan is
[`2026-07-28-workflow-ux-hardening-stephen.md`](2026-07-28-workflow-ux-hardening-stephen.md).

Baseline findings already confirmed:

- PR #50 is merged. AI-generated hierarchy suggestions now include per-LO
  source mappings, and Apply automatically persists material assignments.
- The earlier `generation-no-assigned-materials` failures were accurate but
  exposed an internal recovery requirement too late. Round 1 will prevent the
  doomed generation action and route the Instructor directly to assignment.
- The repository already routes `EMBEDDINGS_PROVIDER=openai` through the GenAI
  toolkit and reuses `LLM_API_KEY`; no provider-adapter rewrite is required.
- `text-embedding-3-small` returns 1536-dimensional vectors by default, versus
  the current FastEmbed model's 384. Existing Qdrant course collections cannot
  accept the new vectors without migration/re-ingestion; no collection will be
  deleted automatically.
- A separate runaway `amplify status` process exhausted the Mac's ephemeral
  ports and caused both OpenAI and localhost to report `EADDRNOTAVAIL`. That
  process was terminated, and OpenAI/loopback connectivity recovered.

Work is proceeding as small reviewable rounds rather than one broad rewrite.
Findings, shipped fixes, validation evidence, and remaining UX risks will be
appended here after each round.

## Update (2026-07-28): P2-I1 through P2-I5 code-complete

Stephen asked Codex to implement the rows that remained backlog-only in
`2026-07-22-phase-2-review-improvements-stephen.md`. Codex synced plans,
audited current `origin/main`, and recorded the exact missing contracts in
[`2026-07-28-review-improvements-completion-stephen.md`](2026-07-28-review-improvements-completion-stephen.md).

- P2-I1 now has explicit draft/published/archived lifecycle, metadata editing,
  archive/restore, one server publish checklist, inactive archived enrollment
  display, and an archived-course practice guard.
- P2-I2 now has persisted reusable blueprints, pinned model/material recipes,
  run/blueprint linkage, and distinct exact retries from terminal run
  snapshots.
- P2-I3 now has additive template-family and version-origin lineage across
  manual/generated/imported/script-migrated/edited content.
- P2-I4 remains the already-merged Task 7 / PR #37 finite-round behavior; its
  regression tests remain green.
- P2-I5 now has deterministic instructor-correctable material kinds and an
  Instructor Content Map joining hierarchy, sources, question states, run
  state, and authoring gaps.

Stephen explicitly authorized the P2-I2/P2-I3 cross-owner extension. Saurav's
previous Tasks 8–10 implementations were not replaced; this branch only adds
the provenance/history contracts that the original improvement map left for
later. Automated Jest/typecheck/lint/build verification is complete. A live
backing-service browser smoke remains the only unchecked evidence item.

## Current state

- P2-0 persistent content runs/SSE: **merged** in PR #32.
- Task 4 parameter sandbox: **merged** in PR #33 after eight security review
  rounds.
- Task 5 parameter serving/config and Task 7 finite rounds: **merged**.
- Review improvements P2-I1–I5: **code-complete on
  `codex/phase-2-review-improvements`**, live smoke pending.
- Admin Console v0: retained as earlier completed/planned work outside this
  branch; its coordination ledger remains historical context below.

Admin v0 is Stephen-owned staging enablement. Saurav does not need to confirm
or stop his own work; this status is the requested informational handoff so
his agent can avoid claimed files.

## Two-agent split

Claude continues Phase 2 Task 5 and owns the parameterization paths it records
in
[`coordination/CLAUDE.md`](coordination/CLAUDE.md).

Codex owns Admin Console v0 and records its paths in
[`coordination/CODEX.md`](coordination/CODEX.md). The implementation plan is
[`2026-07-27-admin-console-v0-stephen.md`](2026-07-27-admin-console-v0-stephen.md).

Each agent edits only its own claim file. Both read both files before editing.
Student Preview waits for Task 5 to release `serving.service.ts` and
`attempts.service.ts`; the Admin account/provisioning slice may proceed in
parallel once Claude publishes an exact, non-overlapping claim.

## Admin v0 decisions

- Admins grant a global `platformInstructor` capability by CWL username.
- Pre-login grants are pending records keyed by normalized CWL `uid`; no fake
  PUID-backed User is created.
- Platform Instructor authorizes the Instructor shell and course creation;
  existing-course access remains course-scoped.
- Student Preview uses separate Instructor-only endpoints and does not weaken
  `ensureCourseStudent()`.
- Preview of unpublished courses still serves approved questions only.
- Preview records are structurally separate from live attempts and cannot
  affect mastery, Review Book, flags, remediation, summaries, notifications,
  or analytics.

## Message for Saurav

No action is required. Please treat the paths in both coordination ledgers as
reserved while their state is active. Task 5 completion remains the unblock
signal for Saurav's Task 9; Admin v0 does not change the Task 5 parameter
contract.
