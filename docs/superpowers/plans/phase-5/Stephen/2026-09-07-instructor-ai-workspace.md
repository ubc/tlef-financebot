# Instructor AI Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept the existing progressive generation workflow, then deliver a persistent English Instructor workspace for goal → editable AI plan → explicitly started generation → saved Draft inspection and the existing review/refinement editor.

**Architecture:** A small, course- and owner-scoped task record owns the conversation and plan revisions. Existing contentRuns remain the execution source of truth; the task references them. A bounded background planner reads real active objectives, Approved coverage, and ready source assignments; an explicit Run action invokes the existing generation service. The existing question editor remains the authoritative review, selective regeneration, and version-saving surface.

**Tech Stack:** Native TypeScript, Express, MongoDB, Agenda, existing GenAI toolkit, EventSource, Jest, Playwright. No dependencies added.

**Owner:** Stephen. Unified modification already authorized by the user.

**Baseline:** `2af3b6f` is still current origin/main. Continue `codex/visual-generation-workflow`; preserve all existing uncommitted tutorial and generation changes. Leave application code uncommitted and undeployed.

## Global Constraints

- Production UI copy is English.
- Reuse the existing course, content-run, content-map, question, flag, and analytics sources of truth. Workflow views aggregate; they do not invent a parallel state model.
- Every surfaced problem must have a concrete next action and destination.
- Preserve course-scoped authorization and the TA hard-deny invariants. Tasks are private to their requesting Instructor within an authorized course.
- Generated questions remain Draft until explicit existing Instructor approval. No Student/TA/Admin workflow or answer-serving changes.
- A model may propose a plan only; it cannot choose arbitrary tools, run generation, approve content, or write directly to the database.
- Validate all model output with Zod and resolve all IDs against real active course records. Missing sources/objectives produce actionable blocked states, never invented sources.
- Persist intent before background or paid work. CAS revisions reject stale writes. A repeated Run request for the same plan must never dispatch paid generation again.
- Course SSE updates only progress/artifacts, preserving composer focus/input, plan edits, and selected artifact. Reconnect/refresh observes existing work and never restarts it.
- Keep the first slice bounded: at most 20 conversational plan turns per task; one generation run per accepted plan; 1–20 questions and at most 2 secondary LOs per plan; existing provider JSON retry only. Store user-visible summaries, not hidden reasoning.
- Native modules retain explicit `.js` imports. Shared mounts/accessors/route tables are append-only. No package changes.

## Shared HTTP and client interfaces

All paths have prefix `/api/courses/:courseId/workspace-tasks`; route guards require the course Instructor and task owner. All JSON IDs are hex strings; dates are ISO strings.

```ts
interface WorkspacePlan {
  revision: number;
  loId: string;
  secondaryLoIds: string[];
  count: number;
  type: 'mcq' | 'true-false';
  difficulty: 'easy' | 'medium' | 'hard';
  kind?: 'calculation' | 'conceptual';
  prompt: string;
  rationale: string;
  materialIds: string[];
}
interface WorkspaceContext {
  courseName: string;
  objectives: Array<{
    id: string; name: string; themeName: string;
    approved: { easy: number; medium: number; hard: number };
    readyMaterials: Array<{ id: string; name: string }>;
  }>;
}
type WorkspaceStatus = 'idle' | 'planning' | 'ready' | 'starting' | 'running' | 'completed' | 'partial' | 'failed';
interface WorkspaceTaskSummary { _id: string; title: string; status: WorkspaceStatus; revision: number; updatedAt: string }
interface WorkspaceTask extends WorkspaceTaskSummary {
  courseId: string;
  messages: Array<{ id: string; role: 'user' | 'assistant'; text: string; createdAt: string }>;
  plan?: WorkspacePlan;
  runs: QuestionGenerationRun[];
  context: WorkspaceContext;
  error?: { code: string; message: string };
}
// GET / => WorkspaceTaskSummary[] (latest 30 owned tasks)
// POST / { prompt: string, requestId: string(UUID) } => 202 WorkspaceTask (durable planning queued)
// GET /:taskId => WorkspaceTask (fresh context + all task run snapshots)
// POST /:taskId/messages { prompt: string, expectedRevision: number } => 202 WorkspaceTask
// PATCH /:taskId/plan { expectedRevision: number, plan: Omit<WorkspacePlan, 'revision'|'rationale'|'materialIds'> } => WorkspaceTask
// POST /:taskId/run { planRevision: number } => 202 WorkspaceTask
```

Client exports in `client/src/api.ts`: `listWorkspaceTasks(courseId)`, `createWorkspaceTask(courseId,prompt,requestId)`, `getWorkspaceTask(courseId,taskId)`, `sendWorkspaceMessage(courseId,taskId,prompt,expectedRevision)`, `saveWorkspacePlan(courseId,taskId,plan,expectedRevision)`, `runWorkspacePlan(courseId,taskId,planRevision)`, plus the types above. Existing `QuestionGenerationRun` is reused.

### Task 1: Accept the current execution slice

**Files:** Existing generation/content-run and client regression files; evidence in this plan.

- [x] Verify main has no newer commits and preserve the current dirty workspace.
- [x] Run existing workflow browser checks and typecheck. Result: 3/3 browser checks passed, both TS projects passed.
- [ ] Review current ordering/recovery against implementation and run full regressions after integration; record actual results and environment limitations.

### Task 2: Durable task, bounded planner, and safe dispatch

**Files:** Create `server/src/services/workspace-tasks.service.ts`, `server/src/services/workspace-planner.service.ts`, `server/src/routes/workspace-tasks.routes.ts`, `tests/unit/workspace-tasks.service.test.ts`, `tests/unit/workspace-planner.service.test.ts`, `tests/unit/workspace-tasks.routes.test.ts`. Append domain types/accessor/index/mount/startup to `server/src/types/domain.ts`, `server/src/components/mongodb/collections.ts`, `server/src/app.ts`, `server/src/server.ts`. Extend generation/content-run metadata and course-deletion cleanup narrowly; related tests and API docs.

**Interfaces:** Produce the shared HTTP contract above. Persist a task-to-run association on the run itself, so a response or final task write failure cannot lose already dispatched work. Planner uses `completeJson<unknown>` and validates before persistence; generation remains `enqueueGenerationRun(input)`.

- [ ] Write behavioral regressions and run them failing: foreign/missing/archived LO or material is refused before any model/generation dispatch; foreign owner/course is unreadable; stale plan save rejected; duplicate Run starts once; planner JSON failure is actionable; stored run recovered after response/final-write loss; refresh never queues paid work.

```ts
expect(await Promise.all([startSamePlan(), startSamePlan()])).toHaveLength(2);
expect(enqueueGenerationRun).toHaveBeenCalledTimes(1);
expect(completeJson).not.toHaveBeenCalled(); // read/refresh path
```

- [ ] Add the durable task record, course+owner indexes, create-request deduplication and bounded conversation/plan history. Persist planning requests before Agenda enqueue; use a worker claim and revision CAS to reject duplicate/stale jobs. Revalidate current Instructor access in the background worker. Add startup interruption recovery and course-deletion active-work guard/cleanup.
- [ ] Build fresh context from active Themes/LOs, ready non-deleted assignments and Approved tier coverage. Give the planner only compact validated facts, the user's messages and prior plan. Use configured model, capped output and existing JSON retry; collect usage/timing as task-local operation metadata. Unsupported or ambiguous requests may return an assistant clarification without a runnable plan. No keyword-only fake assistant.
- [ ] Validate the plan against that context (including all secondary LOs), derive its permitted sources on the server, and retain previous plan revisions. Manual edits get the same validation. Natural-language followups keep previous goal/constraints and create a new unexecuted plan; never silently alter an executed plan.
- [ ] Claim a plan execution atomically before dispatch, pass task/plan association into content-run creation and derive status/results from those runs. Repeated calls look up existing work; uncertain interruption produces an actionable state and never blindly repeats a paid action. No automatic run from a model response. Return domain errors as English user messages.
- [ ] Implement validated thin per-route guards and serialization; update course deletion and startup without reordering shared code. Run focused Jest plus server typecheck. Report implementation/test evidence in `/private/tmp/financebot-workspace/task-2-report.md`.

### Task 3: English Instructor workspace with stable live results

**Files:** Create `client/src/views/instructor/ai-workspace.ts` and focused helper modules if needed; append API types/functions, main routes and shell nav. Append scoped CSS. Create `tests/e2e/ai-workspace.spec.ts`; expand `playwright.workflow.config.ts` testMatch only. Existing question-detail view may gain a small optional return destination if needed.

**Interfaces:** Consume the shared API above and existing `subscribeContentRuns`, `renderGenerationProgress`, `getQuestion`, `renderQuestionDetail`/question-bank routes. Routes `/instructor/course/:id/workspace` and `/instructor/course/:id/workspace/:taskId`. Export `renderAiWorkspace(outlet, params)`.

- [ ] Implement task sidebar, stable conversation/composer and result inspector. Empty state explains supported authoring tasks with useful prompt starters. Task creation persists a request UUID until its response is known; refresh/list/detail restores messages, plans, existing runs. Use URL task identity, not shared local storage for private conversations.
- [ ] Render server planning state with truthful English text and poll only while planning/starting; dispose polling/EventSource on navigation. Handle initial/failed/loading/archived/empty-course and stale task responses with useful actions. Poll and SSE do not replace composer or dirty plan controls.
- [ ] Show an editable plan with primary and up to 2 secondary objectives, count, type, difficulty, optional kind and instruction. Show the actual server-derived sources/coverage/rationale. Save edits explicitly; Run remains unavailable for unsaved/stale/blocked plans and uses the precise plan revision. Followup messages revise the plan while retaining the previous conversation.
- [ ] Subscribe once per course to real ContentRun snapshots. Filter by current task run IDs/association, reject old revisions, and add saved Draft cards without changing selected artifact or scroll/focus. Inspector shows selected question, source excerpts, AI decision and numerical-verification state using safe existing rich text rendering. Do not imply AI pass is publication approval.
- [ ] Provide direct 'Review and refine' access to the existing full question editor, with a clear 'Back to AI Workspace' destination retaining the task. Reuse selective regeneration/side-by-side/version saving; do not introduce a second unguarded edit implementation. Keep this boundary explicit: task planning and runs are durable; existing editor's unsaved variant remains transient.
- [ ] Write browser tests over actual compiled modules and deterministic API/SSE fixtures: natural language → saved plan → followup → edit → Run; repeat click does not duplicate; first Draft visible before terminal; composer/plan focus survives SSE; reload restores task; foreign/stale error actionable; disconnect/reconnect; mobile layout/light-dark/axe and navigation cleanup. Run build/browser checks, report in `/private/tmp/financebot-workspace/task-3-report.md`.

### Task 4: Integrated acceptance and independent review

**Files:** This plan, Stephen STATUS, API contract and closest AGENTS current-state notes.

- [ ] Review backend and UI against the shared contract; fix material findings with covering regressions.
- [ ] Run `npm test -- --runInBand`, `npm run lint`, `npm run typecheck`, `npm run build`, `npx playwright test -c playwright.workflow.config.ts`, and `git diff --check` after integration.
- [ ] Inspect actual browser-rendered workspace at desktop/mobile; independently review the combined changes, including preservation of existing tutorial/generation work. Record evidence and limitations: real SAML/Mongo/provider path only if actually run; no claims about measured provider latency or horizontal SSE replay.
- [ ] Update docs, sync Stephen's plan after completion; leave code uncommitted for the user's review.
