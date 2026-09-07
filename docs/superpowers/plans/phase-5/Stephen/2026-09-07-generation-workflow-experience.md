# Generation Workflow Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let instructors understand running generation and discover saved Drafts while keeping their current review work stable.

**Architecture:** Derive a visual pipeline from existing persisted ContentRunSummary records. Keep authoritative generation, question versions, publication gates, and permissions unchanged. Instructor-only views consume the existing course SSE stream and reject stale revisions.

**Tech Stack:** Native TypeScript ES modules, existing DOM helpers/CSS tokens, EventSource, Jest, Playwright.

**Owner:** Stephen

**Baseline:** origin/main `2af3b6f` (2026-09-07). Local Student tutorial work was preserved and restored before this plan. Work on `codex/visual-generation-workflow`; do not stage or commit the pre-existing tutorial edits.

## Global Constraints

- Reuse the existing course, content-run, content-map, question, flag, and analytics sources of truth. Workflow views aggregate; they do not invent a parallel state model.
- Every surfaced problem must have a concrete next action and destination.
- Preserve course-scoped authorization and the TA hard-deny invariants.
- Generated content remains Draft until the existing instructor approval flow. Student serving stays Approved-only with no LLM call added to the critical path.
- User authorization update (2026-09-07): Stephen explicitly authorized unified changes regardless of the other developer. Include per-item backend processing and additive progress fields; no dependency or permission changes.
- Never present stage position or failed items as a percentage of question readiness.
- Preserve form input/focus and queue selection/filter/scroll while background updates arrive.
- Motion is a brief state-change cue; respect prefers-reduced-motion and use polite status announcements.

## Task 1: Visible generation pipeline and non-disruptive Draft arrivals

**Owner:** Stephen

**Files:**
- Create: `client/src/views/instructor/generation-progress.ts` — pure stage presentation plus DOM pipeline rendering.
- Modify: `client/src/views/instructor/preseeding.ts` — active work remains visible, robust revisions, isolated status updates.
- Modify: `client/src/views/instructor/review-queue.ts` — course SSE arrival notification and explicit queue refresh.
- Modify: `client/src/api.ts` — optional connection-open callback for existing subscription helper.
- Modify: `client/public/styles/main.css` — append scoped responsive pipeline/arrival styles only.
- Create: `tests/unit/generation-progress.test.ts` — meaningful lifecycle and revision cases.
- Create: `tests/unit/content-run-subscription.test.ts` — EventSource lifecycle behavior if changed.
- Extend: `tests/unit/review-queue.test.ts` only for extracted arrival-state behavior if needed.

**Interfaces:**
- Consumes: existing `ContentRunSummary`, `QuestionGenerationRun`, `getContentRun(courseId, runId)`, and `subscribeContentRuns(courseId, handlers): () => void` from `client/src/api.ts`.
- Produces: `generationSteps(run: QuestionGenerationRun): Array<{ label: string; state: 'waiting' | 'active' | 'done' | 'failed' }>` and `renderGenerationProgress(run: QuestionGenerationRun): HTMLElement`.
- Adds: optional `onOpen?: () => void` to subscribeContentRuns handlers; existing callers remain compatible.
- A run update is accepted only when there is no known run or its revision is higher. Snapshot and live delivery use the same rule.

- [x] **Step 1: Write and run lifecycle regressions.** Cases: queued has no completed stage; running/reviewing marks retrieval/generation/validation complete and reviewing active; completed marks all stages complete but labels content as Draft; failed marks only the reached stage failed and later stages waiting; partial separates saved and failed counts; unknown stage never fabricates completion; an older revision cannot rewind state. Use fixtures typed as QuestionGenerationRun and assert the returned states and rendered presentation inputs, not source-code strings. Run `npm test -- --runInBand tests/unit/generation-progress.test.ts` before implementation and record the expected failure.

- [x] **Step 2: Implement pure presentation and component.** Use these canonical stages and derive state from the run, never a timer:

```ts
const stages = [
  { key: 'retrieving', label: 'Find sources' },
  { key: 'generating', label: 'Generate questions' },
  { key: 'validating', label: 'Check structure' },
  { key: 'reviewing', label: 'AI review' },
  { key: 'persisting', label: 'Save Drafts' },
] as const;
// For known stages: indices before current are done; current is active only
// while running, failed only when status failed; later stages remain waiting.
// queued => all waiting; completed => all done; partial => processing finished
// with explicit result counts, not successful publication.
```

Render a semantic ordered list, explicit state text (not color alone), saved Draft/failure counts, and a short sentence that instructor approval is still required. Do not expose raw model reasoning as progress. Task 2 now implements per-item generation under the user’s expanded authorization. Use existing el() helpers; never innerHTML for provider messages.

- [x] **Step 3: Wire the generation page.** Render active runs outside the collapsed terminal history. Reuse the component within existing run panels and keep Review Drafts/retry/material actions. On stream events update only a separate status container, not renderForm(); this protects the prompt, focused selects and disclosures. Fetch full snapshots for optional latest messages with revision protection and bounded concurrent requests per run. Handle connection open/error with a persistent status line saying reconnecting and retaining the last known state. Reconnect is transport recovery, not a new generation job. Clean up subscriptions on navigation. No synthetic progress or duplicate queueing.

- [x] **Step 4: Wire Draft arrivals into Review Queue.** Subscribe after initial load; compare createdQuestionIds against a baseline and subsequent per-run revisions. Display the number of new saved Drafts with a 'Show new Drafts' action, without automatic reordering, clearing selection, or stealing focus. Refresh via the existing queue API only when clicked; preserve filters and retain valid selections. A reconnect snapshot must discover newly completed runs; old historical questions absent because already reviewed must not be called new. Keep the existing runId highlight synchronized. Close EventSource when leaving. Add optional onOpen registration to the API helper and verify compatibility/close behavior using a fake EventSource.

- [x] **Step 5: Append responsive motion styles.** Five stages form a readable rail on desktop and stack/wrap on small screens. Animate changed state at roughly 180 ms once; reduced motion removes animation. Use existing theme colors with readable labels. New-Draft notifications are local to the queue and never overlay work.

- [x] **Step 6: Verify integrated behavior.** Run focused Jest tests, `npm run typecheck`, `npm run lint`, and `npm run build`. Use a browser fixture with the actual compiled views and stubbed course APIs/SSE to test generating → reviewing → saved, a stale replay, prompt/focus preservation, queue arrivals without selection loss, refresh, disconnect/reconnect, navigation cleanup, narrow layout, and reduced motion. No paid generation call is needed. Report mock-based verification separately from full SAML/provider E2E.

- [x] **Step 7: Independent review and record evidence.** Review the task diff against these constraints; fix material issues, record checks below, and sync Stephen's personal plan. Keep changes uncommitted for review because shared files contain pre-existing user work.

## Product follow-ups and coordination boundary

The accompanying product audit covers Instructor, Student, TA, and Admin journeys. Per-item generation is now included under the user’s explicit authorization. Stage timing telemetry, cross-process event fan-out, cooperative cancellation, and failed-item-only retry remain separately scoped product follow-ups.

## Verification evidence

- `npm test -- --runInBand`: 103 suites / 1,299 tests passed (includes preserved Student tutorial work).
- `npm run lint`, `npm run typecheck`, `npm run build`: passed.
- `npx playwright test -c playwright.workflow.config.ts`: 3/3 passed against actual compiled views with deterministic API/SSE fixtures; no SAML or paid model calls. Covers input/focus preservation, stale events, reconnect snapshots, Draft arrival/explicit refresh, selected IDs/filter retention, EventSource cleanup, 390px layout and scoped axe WCAG A/AA.
- Initial mobile axe found target-label contrast 3.99:1; fixed with existing readable text token and reverified.
- Independent combined spec/quality review passed after fixing actual all-failure stage reporting and stopping subsequent paid work on question-store infrastructure failures. Regressions included in the full run above.
- True provider latency, SAML/full backing-service E2E and multi-process event transport were not exercised. No claim that full harness or all role redesigns are implemented.
- Work remains uncommitted on `codex/visual-generation-workflow`; preserved local user edits and recovery stash `92d0e035354e0dd149ea8b5762d93f674f411fdc` remain available.

## Task 2: Persist and broadcast each fully checked Draft immediately

**Owner:** Stephen (unified modification explicitly authorized by user).

**Files:** `server/src/services/generation.service.ts`, `server/src/services/content-runs.service.ts`, `server/src/types/domain.ts`, `server/src/routes/content-runs.routes.ts`, related unit tests, `docs/api-contract.md`.

**Interfaces:** Generation runs gain optional `items: Array<{ index: number; state: 'waiting' | 'generating' | 'validating' | 'reviewing' | 'persisting' | 'saved' | 'failed'; failedAt?: 'generating' | 'validating' | 'reviewing' | 'persisting' }>`; summaries gain optional `latestMessage: string`. Old records remain valid; no destructive migration. Clients fall back to legacy aggregate stages.

- [x] Add regression proving first Draft persistence/broadcast precedes the second generator call, and that later validator failure preserves the first Draft. Stub model outputs by model purpose, not the former batch call order.
- [x] Replace four batch loops with one sequential per-item pipeline. Keep retrieval once per run, pinned/multi-LO grounding, assigned hardness moves, numerical verification, critique retry, option shuffling and Draft-only creation unchanged.
- [x] Persist item status and result atomically with each ContentRun revision. Derive aggregate stage as earliest unfinished item stage (waiting maps to generating); all finished maps to persisting. This preserves monotonic aggregate stages and counters while individual item stages restart. Do not swallow content-run-conflict as a per-item model failure.
- [x] Publish saved Draft ids only after createQuestion succeeds. Report accurate failure stage; continue subsequent items on model/item failure. Keep whole-run persistence/ownership failures terminal. No new parallel model calls or resume/idempotency claims.
- [x] Project latest persisted event message in list/SSE summaries to remove per-event detail fetches for new servers. Preserve events on detail endpoint.
- [x] Cover persistence-before-publish, terminal conflict, old records, partial and full failure; run generation/content-run regressions plus broad suite and review combined diff.
