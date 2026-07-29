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

## Update (2026-07-28): workflow/UX hardening round 1

The structure-first Instructor workflow and the full anonymous Student Preview
loop have now been exercised against a real local course, MongoDB, Qdrant, and
OpenAI. The course was created from scratch, given dates/Topic/LO/material,
used to generate and approve three questions, published, practiced in Preview,
flagged from Preview, and resolved from a simultaneously open Instructor tab.

Round 1 fixes now on `codex/workflow-ux-hardening-round-1`:

- Every incomplete publish-checklist row now has a direct recovery action
  (`Set dates`, `Add Topic`, `Add LO`, `Open Settings`, or
  `Generate Questions`). Course Settings is also always available in Quick
  Actions.
- Question generation is disabled before enqueue when the selected LO has no
  ready assigned material. The page names the usable sources, links directly
  to assignment, skips ungrounded LOs in bulk generation, and translates old
  `generation-no-assigned-materials` runs into a recoverable message.
- Material suggestions now say `Accept & assign`, `Edit assignment`, and
  `Dismiss suggestion`. Accepted rows show `Assignment confirmed` instead of
  the contradictory `No match`; blocked/private URL and Qdrant-dimension
  errors are translated into useful recovery guidance.
- Existing Qdrant collections are checked against the configured embedding
  vector size when they are opened for ingestion. A 384/1536 mismatch now
  fails explicitly instead of reaching a later upsert failure; `.env.example`
  documents the required recreate/migrate-and-reingest deployment step.
- Review Queue one-click Approve now removes the approved row and updates the
  count immediately. Question detail preserves its Review Queue return path,
  exposes accessible field names, and keeps original A–D option keys visible
  beside semantic roles. A global `[hidden]` rule fixes action buttons that
  were accidentally visible despite the native `hidden` attribute.
- Instructor Preview TEST flags default to being sent to the Instructor Queue.
  A same-origin BroadcastChannel invalidates the open Flags page immediately;
  the final two-tab smoke moved from 3 to 4 flag versions and 4 to 5
  notifications without a reload. Window focus/visibility remains a fallback.
- Instructors can return a flag with an optional student-facing reply using
  the styled HTML/CSS dialog. Direct edits to an Approved question stay
  Approved and update Question Bank immediately.
- Bookmark is now offered on the practice card after the question is answered
  (when attempt/LO context exists), rather than only from Review Book. The
  live smoke confirmed the state changes to `Bookmarked`.
- Practice's `Session Summary` link now carries the current session timestamp,
  and the summary tile says `LOs Mastered` rather than implying every attempted
  LO is already covered.
- Course creation/settings fields and question editing controls now have
  accessible names; Settings rejects an end date before the start date and
  confirms a successful save.

Observed content-quality feedback:

- All three generated questions passed both agents, but the requested Medium
  questions were direct formula setup/substitution and were closer to Easy.
  Generation and reviewer prompts now include an explicit Easy/Medium/Hard
  rubric so direct one-step substitution cannot silently satisfy Medium.
- The imported OpenStax page produced 319 chunks. Grounding worked, but the
  result suggests HTML extraction may include too much page chrome and should
  be profiled in a later, separately scoped ingestion round.

Still to finish before the PR:

- Decide whether anonymous Preview should receive simulated flag-resolution
  replies. It currently remains intentionally isolated and displays an empty
  notification menu; real students do receive the instructor's optional
  `flag-resolved` reply.

Materials-first follow-up evidence:

- A second course ingested a compact Investor.gov compound-interest page
  before any hierarchy existed (15 chunks).
- AI proposed one Topic and two LOs, each mapped to the source. A boundary bug
  was found: deselecting and reselecting a Topic left every LO unchecked while
  Apply remained enabled, which created a `0 LOs` Topic. The test Topic was
  archived, the UI was fixed to restore child selections and disable Apply
  unless every selected Topic has an LO, and the same live flow was rerun.
- The corrected apply created 2 LOs and Course Materials showed
  `Topic 1, LO 1-2 · Assignment confirmed`, proving the mappings were
  persisted rather than merely displayed.
- A grounded Hard True/False run against LO 2 completed 3/3 with zero pipeline
  failures. The reviewer rejected one and flagged two, correctly observing
  that the questions did not justify Hard difficulty. One rejected question
  was archived with an internal review comment and successfully restored to
  Draft from the question page.
- That run exposed a separate display bug: two currency amounts such as
  `$10,000 ... $10,000` were parsed as one KaTeX expression, scattering the
  prose into math glyphs. Currency symbols are now protected from the
  single-dollar math delimiter; the same Review Queue page was smoke-tested
  again and rendered all three stems as normal prose.
- Completed material/generation runs no longer show stale terminal stages such
  as `Ready · Completed · Classifying` or `completed · Persisting`; terminal
  status now emphasizes processed/created counts.

Final validation:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 68 suites / 709 tests passed.
- `npm run build`: passed.
- Both temporary workflow courses were archived (recoverable) after the smoke
  run so they do not clutter the active Instructor course list.

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
