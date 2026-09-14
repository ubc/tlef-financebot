# Instructor workflow redesign — Stephen

> Status: Page 1 accepted by Stephen; Page 2 implemented and verified; awaiting Stephen’s product acceptance. Page 3 remains gated.
> Owner: Stephen. Date: 2026-09-14.
> Delivery rule: implement one page, demonstrate it, then STOP until Stephen says continue.

**Goal:** Make the Instructor authoring journey understandable, show existing work and real generation progress, and make reviewing questions efficient.

**Architecture:** Reuse course records, content runs, course-scoped SSE and existing question/version authorization. Guided and standalone entry points should share presentation and planning behavior. Streaming extensions require explicit backend contracts; animations cannot substitute for real events.

**Tech stack:** Native TypeScript ES modules, existing CSS design tokens, Express, MongoDB, Agenda, existing LLM adapter, Jest and Playwright.

**Global constraints:** English product UI; Chinese review document. Preserve all current uncommitted work. No application changes, generation, approval, installation or application push during this audit. Preserve human approval, numerical verification, version conflicts, course permissions and isolated Student Preview. Show public check summaries and evidence, never fabricated reasoning. No global redesign in a page-sized delivery.

## Planned page gates

- [x] 1. Existing Learning Objectives and return navigation.
- [ ] 2. Guided Questions: simple generation composer and reliable batch state.
- [ ] 3. Guided Live Review: arriving questions and visible checks.
- [ ] 4. Full Review workspace: queue and focused question review.
- [ ] 5. Standalone Generate Questions: reuse the simple composer.
- [ ] 6. Question Bank: search, preview and lifecycle clarity.
- [ ] 7. Cross-page consistency and journey acceptance.

Audit: [问题、证据与设计方向](../../../../ux/2026-09-14-instructor-workflow-audit.md).

## Execution contract

This is a page-gated design roadmap, not authorization to execute all tasks in one session. Before each page, read its closest AGENTS.md, confirm the current working tree and update that page's implementation checklist. Present the page's concrete layout/interaction, implement only its scope, verify it, and stop for Stephen's acceptance. No automatic move to the next page. A page is not accepted merely because compilation passes.

Each delivery includes: the working page, before/after summary, the demonstrated user journey, relevant verification results and any remaining limitations. Implementation and user acceptance are tracked separately below. No application commits or main push are implied by this plan.

The audit was conducted on local `codex/action-progress`, HEAD `8c8cb03`, with earlier loading/Admin changes present. Do not reset, overwrite or include those changes as newly completed UX work. The earlier STATUS claim that generation always accounts for unapproved supply needs re-verification against the current batch planner; this plan records the concrete inconsistency rather than relying on historical acceptance.

## Page 1 — Existing Learning Objectives

**Owner:** Stephen. **Issues:** U01, A08, A12. **Goal:** Returning to this step shows saved work immediately.

**Files:** `client/src/views/instructor/course-setup-guide.ts`, scoped styles in `client/public/styles/main.css`; reuse tree APIs from `client/src/api.ts`. Inspect `structure.ts` for compatible naming/ordering without redesigning it.

**Interfaces:** Existing course tree and LO creation/update APIs; no new wizard database state. Existing source assignments and release flags remain authoritative.

- [x] Show current Topics/LOs in course order, with real names and counts. Empty/loading/error states are distinct.
- [x] Make `Add learning objectives` explicit. Support existing Topic selection or a new Topic; preserve the existing materials-first path.
- [x] Provide focused edit behavior using existing APIs, or clearly labeled navigation to the existing editor; do not present a nonfunctional Edit button.
- [x] Save returns to the updated list; cancel returns without changes; failed save retains input. Continue leads to Questions without requiring another save.
- [x] Test existing 15-LO case, zero-LO case, add/cancel/save failure, reopen, back/forward and reload. Verify count/content consistency and unchanged assignments.
- [x] Run focused guide regression (`tests/unit/course-setup-guide.test.ts`, relevant guided browser flow), typecheck/build, keyboard/mobile/light/dark checks.
- [x] Demonstrate: Questions → Learning Objectives → existing list → Add → Cancel → Continue.
- [x] **STOP: Stephen accepted the compact refinement and requested Page 2.**

Not included: generation or Review redesign. Extract only the local layout primitive needed here; do not restyle all forms.

## Page 2 — Guided Questions and durable submission state

**Owner:** Stephen. **Issues:** U02–04, U07, A01–02. **Goal:** One understandable generation decision, without accidental repeat batches.

**Files:** `course-setup-guide.ts`, `generation-plan-dialog.ts`, scoped CSS; `server/src/services/generation-plan.service.ts`, existing generation routes and `client/src/api.ts` if needed. Inspect `generation.service.ts` and content-run types before extending batch identity. New shared composer may live under `client/src/components/` following local conventions.

**Interfaces:** Define a durable batch/submission identifier associated with existing run IDs, accepted/failed cells and question counts. Reuse existing data where sufficient; add only missing identity/idempotency/state projection. If API shape changes, update `docs/api-contract.md` and relevant types in the same delivery. Do not use a client-only disabled flag as concurrency protection.

- [x] Put LO selection, suggested quantity and optional instructions first. Move per-difficulty/kind inputs into a clearly named advanced section; retain multi-LO combinations, source restrictions and existing limits.
- [x] Show approved, awaiting-review and in-progress supply separately. Use one calculation for summary, recommendation and actual submitted cells; do not automatically replenish all Approved-only gaps while review is pending.
- [x] Distinguish user-requested additional questions from recommendations to fill a gap. Permit intentional additional generation with explicit scope; do not globally prohibit all generation because an unrelated batch exists.
- [x] Keep the submitted plan immutable while running. Repeated clicks/retries of the same submission must return/recover the same accepted work, including partial enqueue and response loss.
- [x] Show partial enqueue errors per affected objective. Reload/reconnect must recover active work even when there are more than 30 runs.
- [x] On acceptance, enter existing guided Review once, with a truthful batch waiting summary. This is a minimal integration change; full streaming and visual Review redesign belong to Page 3. Do not navigate again after the user leaves.
- [ ] Verify fast double-click, two tabs, lost response, page reload, partial success, finished-but-unreviewed supply and explicit additional generation. Use deterministic provider substitutes; live paid generation is not required for these tests.
- [ ] Extend `generation-plan.service.test.ts`, `generation-plan-dialog.test.ts` and guide browser coverage; run affected service tests, typecheck/lint/build.
- [ ] **STOP: demonstrate simplified submission and reliable recovery; wait for Stephen.**

## Page 3 — Guided Live Review and real generation events

**Owner:** Stephen. **Issues:** U05–06, A03–05, A11. **Dependency:** Page 2 batch identity. **Goal:** Watch meaningful progress and review complete questions as they arrive.

**Files:** `course-setup-guide.ts`, a shared question preview/check-summary component, `client/src/api.ts` and SSE types; `server/src/services/generation.service.ts`, `content-runs.service.ts`, associated routes/types, `server/src/components/genai/llm/index.ts`, scoped CSS.

**Interfaces:** Specify batch/item/attempt/version IDs; public drafting/check/result/saved/failed/stopped events; sequencing and reconnect snapshots. Saved question/version is the authoritative review object. Protect course permissions and redact internal/provider content. Use bounded event storage and chunk batching; do not write every character into a growing Mongo run record.

- [ ] Confirm actual toolkit/provider streaming support before implementation. Add an adapter with text-delta callbacks when supported; preserve full JSON validation and current retries. Document capability gaps explicitly.
- [ ] Surface already persisted per-question results promptly without waiting for an entire batch. Stable draft identities allow public text fragments to become the final saved preview without duplication.
- [ ] Render Drafting, Checking, Ready for review and failure states with actual check summaries and evidence. AI decision is separate from instructor approval.
- [ ] Use validated sample values and shared rich-text/math rendering. Partial expressions wait until renderable; raw placeholder templates are not labeled student preview.
- [ ] Keep unfinished items non-approvable. Preserve numerical verification, current-version checks and source access restrictions; stopping cannot resurrect an old attempt.
- [ ] Keep selected question, edits, focus and scroll stable as other items arrive. Show an arrival indicator; announce summarized changes accessibly and respect reduced motion.
- [ ] Provide visible approve/reject/edit affordances consistent with capabilities; show remaining publication/Topic restrictions truthfully.
- [ ] Verify event reordering/duplicates, reconnect, worker failure, partial persistence, stop/retry, long math, no stream support and non-authorized access. Test final UI text against the actual emitted sequence.
- [ ] Run affected content-run/generation/guide tests and focused browser/axe checks. Demonstrate one pass, one needs-attention and one failure using controlled events. Record whether real provider text streaming was verified; do not mark it complete from mock events alone.
- [ ] **STOP: Stephen reviews the live experience before the full queue changes.**

## Page 4 — Full Review workspace

**Owner:** Stephen. **Issues:** U08–09, A05–07. **Goal:** Read and decide in one working context.

**Files:** `review-queue.ts`, `question-detail.ts`, Page 3 shared preview/check components and scoped CSS. Preserve direct question URLs and `?from=queue` navigation.

**Interfaces:** Existing queue filters, question transitions, notes/edits, expected-version conflicts and capability guards. The queue and detail are two entry points into this single review workspace, not permission to redesign unrelated pages.

- [ ] Default to a compact question list and selected-question reading panel. Clicking Review keeps queue context; deep links still work.
- [ ] Full stem/options/answer/explanation are primary. Editing, parameters, long reports, lineage and empty notes sections open only when needed.
- [ ] Move difficulty into metadata and keep action placement consistent. Fixed Approve / Reject & archive / Next controls remain reachable on long questions.
- [ ] Show AI concerns before decisions; preserve backend approval restrictions. Skip means leave undecided, not archive. Advance on successful action with a clear outcome; errors retain the selected question.
- [ ] Preserve selected filters, scroll and next-item context after save, conflict or navigation; unsaved edits cannot silently disappear.
- [ ] Preserve bulk actions with explicit selected scope and visible outcomes. Similar stems can be compared without assuming identical records.
- [ ] Verify MCQ/T-F, numerical sample, long formula, flagged/rejected checks, conflicts, errors, keyboard/mobile and role permissions. TA access must not acquire approval powers through shared UI.
- [ ] Run review queue, question editing/transition and relevant role browser regressions; typecheck/lint/build and scoped axe.
- [ ] **STOP: Stephen accepts the review workspace before proceeding.**

## Page 5 — Standalone Generate Questions

**Owner:** Stephen. **Issues:** U10, A01–02, A08. **Goal:** Generation is the first visible task.

**Files:** `preseeding.ts`, `generation-plan-dialog.ts`, shared Page 2 composer, scoped CSS; minimal route/context adaptation only.

- [ ] Match page title to Generate Questions. Put the composer before coverage details.
- [ ] Reuse the same recommended supply calculation, advanced distribution, source selection and batch behavior from Page 2.
- [ ] Group optional coverage by Topic; replace misleading Empty with explicit approved/pending/in-progress counts. Offer Review when pending supply already exists.
- [ ] Keep saved setups, custom prompt, material mentions, multi-LO generation, recent activity and stop/retry available without exposing all controls initially.
- [ ] Preserve direct LO links and recipe loading; submitting enters the Page 4 Review workspace scoped to the new batch, without losing its durable progress.
- [ ] Verify empty course, missing sources, existing drafts, saved setup, advanced plan and direct LO entry; run affected preseeding/generation tests and browser checks.
- [ ] **STOP: wait for Stephen's acceptance.**

## Page 6 — Question Bank

**Owner:** Stephen. **Issues:** U11, A03, A06. **Goal:** Find and manage stored questions without losing context.

**Files:** `bank.ts`, shared question preview, scoped CSS; preserve existing list/filter APIs unless a demonstrated data-volume problem requires an API change.

- [ ] Search plus clear lifecycle views; advanced filters behind one entry, with visible active filters and reset.
- [ ] Compact consistent rows with topic/LO names and meaningful status. Selected row opens shared read-first preview; editing is deliberate.
- [ ] Show bulk actions only when selected. Explain whether selection covers this page/filter; preserve existing archive/version/import behavior.
- [ ] Separate AI checks, review state and student availability. Do not label all drafts as missing or published.
- [ ] Verify search + combined filters, no results, long content, large representative list, preview/edit return, bulk failure and responsive overflow.
- [ ] Run affected bank/role regressions and scoped keyboard/axe checks.
- [ ] **STOP: wait for Stephen's acceptance.**

## Page 7 — Journey consistency and final acceptance

**Owner:** Stephen. **Goal:** Confirm the completed pages act as one product. No additional role redesign.

**Files:** only agreed shared tokens, Instructor dashboard/navigation copy and tutorials affected by changed controls. Shared `main.ts`/route files follow append-only project guidance; do not reorganize them wholesale.

- [ ] Agree labels for Sources, Learning Objectives, Generate Questions, Review and Bank across guide, sidebar, headings and Help.
- [ ] Ensure the next-best action points to review when supply exists; student visibility remains subject to existing course/Topic release rules.
- [ ] Verify complete journey: existing course → inspect LOs → generate → leave/reopen → live review → approve/reject/edit → bank → isolated Student Preview.
- [ ] Run relevant integrated regressions, desktop/narrow viewport, 200% zoom, light/dark, keyboard, reduced-motion and scoped WCAG checks. Recheck shared Student/TA/Admin components without changing their workflows.
- [ ] Record acceptance evidence, outstanding limitations and actual provider streaming status. Update tutorials and STATUS only for verified behavior.
- [ ] **STOP: final product acceptance by Stephen; deployment remains a separate explicit action.**

## This documentation task

- [x] Summarized all user-supplied screenshots and complaints.
- [x] Read-only inspected live core pages and relevant implementation.
- [x] Distinguished confirmed state defects from hypotheses and visual preferences.
- [x] Found/read local design and planning skills and checked the official skill catalog without installation.
- [x] Wrote audit, proposed layouts and sequential acceptance gates.
- [x] Self-reviewed scope and dependencies: Page 2 only adds minimal Review integration; Page 3 owns streaming; Pages 4–6 reuse those components.
- [x] Stephen authorized Page 1 with “继续”; Page 1 is implemented. Product acceptance and Page 2 authorization are still pending.

## Page 1 verification — 2026-09-14

Build and lint pass. Focused guide unit tests: 2 passed. Isolated browser tests: 4 passed, covering existing/empty/error states, existing/new Topic saves, failed-save recovery, inline rename, step return, reopen/reload, keyboard, mobile dark/reduced motion and scoped axe. API mutations were intercepted; real PHYS 100 was checked read-only and its 15 LOs display under 5 Topics. Existing integration test expectations were updated for the intentional save-to-list behavior; their full database-backed suites were not rerun. Generated desktop/mobile screenshots were visually inspected. No backend or student visibility rules changed.

### Page 1 visual refinement

Stephen requested a smaller, more refined layout after reviewing screenshots.
The LO list and add form now use a scoped 56rem compact dialog, smaller header
and controls, single-line Topic headings, denser objective rows and lightweight
Edit actions. Mobile retains 44px edit targets and readable form fields.
Other guide steps are unchanged. Client compilation and four browser acceptance
cases (including scoped axe) pass; desktop/mobile screenshots visually reviewed.
Page 2 remains gated.


## Page 2 delivery notes — 2026-09-14

Guided Questions now has a compact composer: objective selection, quantity and
optional instructions. Detailed distribution and run activity are collapsed;
source and advanced workspace access remain available. The footer stays visible.
Recommended cells conservatively subtract pending drafts from the existing
Approved-only tier gaps. Custom distribution and explicit additional generation
remain available. This changes the guide only; standalone generation is Page 5.

Account/course-scoped local recovery retains the immutable request and exact run
IDs. A new server submission manifest plus deterministic run IDs makes retries
and insert races at-most-once for each created cell. Known runs are restored by ID;
queued/running queries return all active records rather than just the latest 30.
Submission errors preserve a Resume action; successful acceptance navigates to
existing Review once only if the user has not navigated away. Partial cell errors
are surfaced. No token streaming or new Review layout is claimed in Page 2.

The existing failed-run retry controls remain in the full generation workspace.
A process interruption between run creation and job enqueue relies on existing
startup reconciliation to expose failed/retryable work, rather than automatically
re-enqueueing it. See the updated API contract for these boundaries. No live LLM
request was made for validation.

Page 2 verification: typecheck/build/lint pass; full Jest 107 suites / 1,397 tests; guided generation 4 browser cases, prior Objectives 4 cases and shared progress 8 cases pass. Browser cases include scoped axe, desktop/mobile dark, pending-supply recommendations, additional generation, Review navigation, two tabs and response-loss recovery. Backend tests cover immutable submission replay, changed payload rejection, deterministic run reuse, duplicate insert races and course cleanup. Partial enqueue remains covered by service tests; no real paid-generation or process-kill experiment was performed.

## Approved B workstation implementation — 2026-09-14

Stephen selected B and authorized production implementation after prototype refinement.
Scope: formal Instructor Review Queue only. Preserve green shell; introduce compact
queue, single-page question/answer/agent inspection, numbered question board, and
optional rejection reason. Keep existing filter/bulk/advanced-editor access and
server permission/publication rules. No token-streaming claims in this slice.

- [x] Build production workstation using real questions, rich text and source references.
- [x] Persist rejection note atomically with version-checked archive transition.
- [x] Verify board navigation, approval, rejection/cancellation/failure, stale versions,
      keyboard, narrow layouts and light/dark accessibility.
- [x] Update API contract and delivery notes. Pause for Stephen's page acceptance.


### B production delivery

Formal Instructor Review Queue now uses a compact list, inline rich-text reader,
answer explanations, collapsible real AI assessment/source evidence, quick content
editing, persistent decision toolbar and an accessible numbered question board.
Existing type/agent filters, sorting, bulk actions and full editor remain available.
Agent enrichment concurrency is limited to four. The selected reader is independent
of list redraws and rejects late detail responses. Returning generation-run links
prefer a question from that run. Topic-release wording remains separate from approval.

Rejection notes are private internal notes, appended atomically with a version/state
CAS archive update. Failed submissions retain the reason for retry. Decisions advance
to the remaining queue and reviewed-this-visit context is retained in the board.
Samples only render against the matching current version; unresolved templates are
labeled and the full editor remains the sample/parameter configuration surface.
No token streaming or changes to the guided Review screen were included.

Validation: build/typecheck/lint and diff whitespace check pass; 97 related unit/route
tests pass, including atomic rejection notes and stale version conflicts. Eight
isolated browser cases cover navigation/search, optional and failed rejection,
editing/version-pinned approval, stale responses/samples, unsaved edits, keyboard,
390px dark mode and scoped axe. Read-only real SAML/PHYS 100 inspection confirms
actual course questions render with the existing shell. The two legacy pipeline
browser selectors were updated for the new reader; their full database-backed
end-to-end suites were not rerun. No real course question was mutated during QA.
Stephen's visual acceptance is next; other pages remain gated.

### Empty-state refinement requested during acceptance

An empty authoritative review queue now hides the three-column shell, search,
filters and zero-count board. A compact illustrated state provides Question Bank
and Generate Questions destinations, with neutral empty copy on arrival and
completion copy after reviewing the final item. Search/filter misses use distinct
copy, retain the search controls, show the pending count, and offer a reset action.
Desktop light and 390px dark screenshots inspected; both added browser cases and
scoped axe pass (entry animation frozen for steady-state contrast). The eight
existing workstation cases also pass after this refinement; client compile/lint pass.

### Generate Questions workstation — approved prototype implementation

Stephen approved the interactive prototype on port 6129. Implement the compact
objective list, teaching brief and exact batch summary as the default page. Reuse
immutable generation submissions; retain advanced single/combined-objective and
saved-setup tools. Use persisted SSE stages and saved drafts for live feedback,
without simulated tokens or unsupported pause. Preserve the existing sidebar.

- [x] Implement setup, durable batch recovery, progress, draft preview and empty states.
- [x] Verify selection/counts, request recovery, SSE arrivals, responsive/dark layout.
- [ ] Present this page for visual acceptance before changing another page.


Implementation outcome: the default Generate Questions route uses the approved
three-pane composition with compact objective rows, assigned-source eligibility,
coverage-aware default selection, an optional teaching brief, quantity and difficulty
controls, and exact MCQ batch totals. Advanced true/false, combined objectives,
saved setups, detailed distributions and run stop/retry tools remain at
`?advanced=1`; existing true/false deep links retain their prior behavior.

Generation uses the existing immutable submission contract. Lost responses retain
the same account/course-scoped submission for safe recovery across reloads. All
active course runs and persisted batch IDs keep generation locked appropriately.
The activity view shows actual saved counts (not processed/failed units), saved
draft previews, real AI assessments, and on-demand durable step timelines.
SSE updates preserve the active question reader, keyboard focus and scroll; route
exit closes the stream. Review links retain the run context. Token-level output
and pause/resume are not supported by the current backend; none is simulated here.

Validation: seven isolated Playwright cases pass, covering selection and grounding,
exact quantity/prompt, lost-response recovery across reload, saved-draft arrival,
flag assessment, step history, stale-batch clearing, keyboard focus, mobile/dark
layout and scoped axe checks. Build, client typecheck, full lint and diff whitespace
checks pass. A real PHYS 100 course was inspected read-only with no browser errors
or horizontal overflow. No paid generation or live question decision was triggered
in QA. The prototype remains available on port 6129; formal app is port 6118.

### Follow-up: true streaming text (Stephen requested)

Replace whole-response generator calls with the installed provider's streaming
API. Publish bounded, throttled, durable unverified stem previews over the existing
course-guarded SSE stream. Reset previews on retries and preserve final validation,
review and publication gates. Verify actual pre-completion text arrival, reconnect
snapshots, escaped JSON boundaries and safe terminal-run handling.

Streaming follow-up completed: `completeJson` opts into the installed toolkit's
real streaming provider callback for background question generation. A bounded
partial-JSON decoder exposes only the top-level visible stem. Serialized preview
writes coalesce at 250ms, preserve stage history, drain before stage transitions,
and obey terminal CAS protection. The existing guarded SSE and replay snapshots
carry item/attempt/stem; unverified text cannot be approved or served to students.
The reader smoothly reveals only already-received characters (instant in reduced
motion), resets retries, preserves manually selected saved questions, and stops
animation on navigation. Saved-question rendering remains authoritative.

Validation: 95 focused unit tests and 8 browser cases pass, including partial JSON,
escapes, nested-content exclusion, pre-completion updates, retry reset, terminal
conflict, durable publish order and browser reload restoration. Build/typecheck,
lint and whitespace checks pass. A real Luna request produced 74 visible updates
(first at 809ms; total 1447ms). The first full course run exposed fast short-stem
coalescing; character reveal fixed that observable UX. A second real course run
showed 8 DOM text updates while 0/1 questions were saved, then loaded the saved
question's assessment with no browser errors. Two test questions remain Drafts in
course 6aa8542122a8a0d1d9ee13b7; no approval or release was performed.

### Follow-up: full visible question output

Stephen requested answers and other outputs alongside the streamed body. Extend
bounded unverified previews to options, proposed correct answer, option explanations
and difficulty; render these as they arrive, reset all fields on retry, and preserve
explanations when transitioning to the saved question. Continue excluding internal
model reasoning, raw metadata and unfinished approval actions.

Full visible output follow-up completed. The bounded incomplete-JSON parser now
projects stem, difficulty and up to eight options with text, proposed role and
per-option explanation. Option-only fragments trigger SSE writes. The live reader
smoothly reveals each field, marks proposed correct answers as unverified, restores
all fields on reload and clears them together on retry. Saved previews retain all
option explanations and expose the recorded answer-check report.

Validation: 97 focused unit tests and all 9 workstation browser cases pass; the
new full-output case also passes light/dark scoped axe and 390px overflow checks.
Build/typecheck, lint and whitespace checks pass. Real course run
7f2e0025c376629c5742c263 showed 9 answer-text updates while 0/1 questions were saved,
then displayed all 4 saved option explanations without browser errors. One new QA
question remains a Draft in the current course, with no approval or release.

### Follow-up: Question Bank prototype and aligned Review Queue header

**Owner:** Stephen. User requested approved-only Question Bank membership, more
prominent per-topic release controls, full question editing, and production
Review Queue top alignment with the accepted Bank prototype.

- [x] Refine the isolated Bank prototype: approved collection, topic release panel,
  complete authoring fields, and explicit return-to-review after edits.
- [x] Align production Review Queue heading, visible tabs and compact toolbar,
  preserving existing filtering, bulk actions, review decisions and empty states.
- [x] Verify prototype interactions and responsive rendering; run existing Review
  browser checks and client typecheck. Production Bank integration remains pending.

Completed: Bank prototype now contains approved samples only, a prominent per-topic
release strip and schedule/hold controls, full answer/metadata editor, and explicit
return to review. Production Review Queue now uses the matching compact title,
visible status strip, search/type/sort row and separate bulk controls.

Validation: build and lint pass; all ten existing Review browser cases pass against
an isolated static fixture server, including mobile dark and axe. The application
server was unavailable on 6118, so no live course mutations were attempted. Prototype
checks cover scheduling, answer/explanation edits and return to review without page
errors or mobile overflow. Bank production integration remains pending.
