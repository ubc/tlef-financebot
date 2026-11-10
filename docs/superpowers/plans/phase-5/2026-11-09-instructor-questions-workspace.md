# Instructor Questions Workspace — Task Checklist

**Spec:** `docs/superpowers/specs/2026-11-09-instructor-questions-workspace-design.md`
**Branch:** `instructor-nav-cleanup` (continue here; commit after each task).
**Form:** a short checklist by agreement with the developer (2026-11-09) — the
spec carries the design; this file tracks order, files and done criteria so the
work can resume after a context reset.

## Small additions to the spec (decided while planning)

- `release.themes[]` also carries `revision` (needed for
  `PATCH /api/themes/:themeId { availableFrom, expectedRevision }`) and `order`
  (panel row order).
- Bulk actions keep today's Review Queue mechanism: per-question
  `POST /api/questions/:id/transition` with `expectedVersionId`, 4 at a time,
  so failures are known per row. `bulk-transition` (count only) is not used.
- The reader's flag fetch uses `GET /api/courses/:courseId/flags?questionId=`
  (still guarded by `flag.triage`, which instructors hold).

## Tasks

- [x] **1. Move shared question labels out of `bank.ts`.**
  New `client/src/question-labels.ts`: `STATUS_LABEL`, `TYPE_LABEL`,
  `statusToBadgeVariant`, `heldBackTopics`. Re-point TA question-detail,
  TA review-queue, instructor question-detail, review-workbench and
  `tests/unit/question-bank-helpers.test.ts`. Done: typecheck + that test pass.

- [x] **2. `buildQuestionWorkspace` pure function + unit tests.**
  `server/src/services/question-workspace.service.ts`. Input: course
  (lifecycle via `courseLifecycle`), themes, joined questions, open-flag
  counts/latest flag time per question, review priorities, `now`. Output: the
  spec's `QuestionWorkspace` for one tab. Tests
  (`tests/unit/question-workspace.service.test.ts`): counts incl.
  visible/waiting split; `hiddenApprovedCount` for unreleased Topic, future
  schedule, `contentReady: false`, multi-Topic with one unreleased, unpublished
  course; flags tab includes any state; `agentVerdict` mapping; ordering per tab.

- [x] **3. Loader + `GET /api/courses/:courseId/question-workspace?tab=`.**
  Loader reads course, themes (non-archived), questions joined to current
  versions (`browseBank` with `includeArchived`), `reviewQueue` priorities,
  open flags. Route in `questions.routes.ts` with `ensureCapability('question.review')`,
  rows via `toBankItemWithSample` (items for the requested tab only).
  Route tests in `questions.routes.test.ts`: 200 shape, 400 bad tab, 403 without capability.

- [x] **4. Flags `questionId` filter.** `listFlags(courseId, state?, questionId?)`,
  `flagsQuery` gains `questionId`. Tests in `flags.service.test.ts`.

- [x] **5. Client API.** `QuestionWorkspace`, `WorkspaceRow`, `WorkspaceTab`
  types; `getQuestionWorkspace(courseId, tab)`; `listCourseFlags` gains
  `questionId`. Update `docs/api-contract.md`.

- [x] **6. Page skeleton.** `views/instructor/questions.ts` (+ pure helpers in
  `questions-model.ts`, unit-tested): route `/instructor/course/:id/questions`,
  URL state (`tab`, `q`, `runId`), default tab rule, header actions, release
  bar, tabs with counts, list with search + filters (Topic, LO, type,
  difficulty, AI verdict, approved sub-filter), select-all. Redirect
  `/queue`, `/bank`, `/flags` (keeping `q`/`flag`/`question`/`runId`). Sidebar:
  one "Questions" item (④), Flags removed from "Assess & improve". Narrow
  layout: list then full-width reader with Back.

- [x] **7. Reader + actions + bulk.** `questions-reader.ts`: meta, stem/options
  (sample for parameterized), AI check with suggestions, similarity links,
  source evidence, visibility reason, TA edits/notes. Actions per state table;
  Reject with optional reason; 409 → "question changed" + reload. Bulk bar with
  partial-failure list and kept selection. Refetch workspace after mutations.

- [x] **8. Release panel.** Row per Topic: approved count, state, Release now /
  Schedule (date) / Keep hidden; save with `expectedRevision`; errors keep
  values. Unpublished-course notice links to Dashboard.

- [x] **9. Flag card.** Extract `questions-flag-card.ts` from `flags.ts`
  (reasons/sources, student count, TA recommendation, Correct / Archive /
  Clear, remediation checklist, Notify with persisted state, resolved history,
  "How flags work"). Shown at top of the reader whenever open flags exist.

- [x] **10. Arrivals and header.** `runId` highlight + Clear highlight;
  `?flag=` / `?question=` / `q` selection; Import link; Export CSV via `bankCsv`.

- [x] **11. Links.** Update `notification-target.ts` (+ its test) and instructor
  links in dashboard, setup-journey, generation-workbench, preseeding, import,
  settings, exam-builder, courses, tutorial-help/definitions, question-detail,
  collaborative-editor, param-config. `structure.ts` release controls become a
  read-only label + link to `?tab=approved`.

- [x] **12. E2E** `tests/e2e/questions-workspace.spec.ts` (mocked API): redirects
  keep `q`; approve/reject moves row and counts; release clears warning; flag
  card correct/archive/clear + notify; bulk partial failure keeps selection;
  390px dark layout + axe.

- [x] **13. Parity + cleanup.** Walk the spec's parity checklist (mocked e2e +
  browser pane on 6118, developer logs in). Then delete `review-queue.ts`,
  `review-workbench.ts`, `bank.ts`, `bank-workbench.ts`, `bank-editor.ts`,
  `flags.ts`, their CSS, `review-queue.test.ts`, `bank-workbench.spec`,
  `review-workbench.spec`, their playwright configs; fix `role-tutorials` /
  `action-progress` specs. Update `client/AGENTS.md`, root AGENTS.md "Current
  state". Gates: `npm run typecheck`, `npm run lint`, `npm test`
  (known flaky/failing suites listed in the handoff), `git checkout -- artifacts/`
  after e2e.
