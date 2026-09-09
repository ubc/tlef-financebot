# Role Tutorials and Student Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete contextual product help for Student, Instructor, TA and Admin, and make the Instructor Student Analytics dashboard understandable and actionable.

**Architecture:** Extend the existing account/role/version tutorial catalogue and spotlight engine with a shared Help & Tutorials destination. Improve analytics read models and the existing dashboard; reuse AttemptRecords, question versions, course capabilities and student profiles. No new AI workspace or generation refactor is restored.

**Tech Stack:** Native TypeScript/DOM, Express, MongoDB, existing Jest/Playwright/axe. No new dependencies.

**Owner:** Stephen; unified modification is already authorized. Baseline `2af3b6f` is current origin/main. Branch `codex/role-tutorials-analytics` carries existing Student tutorial changes. The earlier AI Workspace work was rolled back at the user's request and remains rolled back. Work in this existing user checkout; retain application changes uncommitted for review. Baseline recovery files are in `/private/tmp/financebot-role-experience`.

## Global Constraints

- Production UI copy is English.
- Reuse the existing course, content-run, content-map, question, flag, and analytics sources of truth. Workflow views aggregate; they do not invent a parallel state model.
- Every surfaced problem must have a concrete next action and destination.
- Preserve course-scoped authorization and the TA hard-deny invariants.
- Tutorials are optional product help: skipping is allowed and does not grant permissions, approve content or set consent/acknowledgement fields. Consent policy is not changed in this slice.
- Tutorial state is isolated by account, role and version. Student Preview and Instructor TA View must not auto-trigger or persist impersonated tutorial progress. No tutorials interrupt a timed exam sitting.
- Respect reduced motion, maintain dialog focus and cleanup, and retain keyboard/mobile/light/dark usability. No fabricated data or AI-generated analytics claims.
- Topic Practice and Exam Prep outcomes remain separate; all chart/rate labels declare their filters and sample counts. Fewer than five attempts means Insufficient data, never zero failure or an inferred rate.
- Do not combine option keys from different question versions into a misleading distribution. Every question-pattern drilldown identifies and reads its recorded version.
- No dependency changes, paid provider calls, automatic student messaging, commits, application pushes or deployment. Only the required personal-plan synchronization uses the documentation branch.

### Task 1: Complete role-aware tutorials and Student learning-loop help

**Files:** Modify `client/src/tutorials.ts` (engine), create `client/src/tutorial-definitions.ts` (definitions) and `client/src/views/tutorial-help.ts` (shared help hub). Adapt `client/src/views/student/settings.ts` to preserve appearance preferences and use shared help. Append routes/help navigation in `client/src/main.ts`, Instructor/Student shell data as appropriate. Add minimal data-tutorial anchors and first-use hooks in actual role views under `client/src/views/{student,instructor,ta,admin}` and `home.ts`. Extend `server/src/services/tutorials.service.ts`, `server/src/routes/tutorials.routes.ts`, `server/src/types/domain.ts`, and tutorial API types in `client/src/api.ts`. Append scoped CSS. Update tutorial tests; add `tests/e2e/role-tutorials.spec.ts` and a narrow deterministic Playwright config if useful. Update closest AGENTS/API docs.

**Interfaces:** Existing `GET /api/tutorials?role=...`, `PUT /api/tutorials/:tutorialId {role,status}`, `DELETE /api/tutorials?role=...` remain additive; TutorialRole becomes `'student' | 'instructor' | 'ta' | 'admin'`. Keep `maybeStartStudentTutorial` and existing Student replay/reset wrappers working. Produce `maybeStartTutorial(id, options?)`, `replayTutorialAt(id, href)`, and role-aware load/reset functions; definitions own stable role/id metadata. Export these exact new hooks for Task 2:

```ts
maybeStartTutorial('instructor-analytics');
// Analytics hooks: data-tutorial="analytics-overview", "analytics-outcomes", "analytics-question-patterns", "analytics-follow-up"
```

- [x] First add behavioral tests demonstrating the existing gaps: Admin catalogue/role support, scope-isolated reset, rejected foreign id/role, delayed trigger after navigation/account change, preview suppression, unavailable anchors, completion/skip/reset and replay. Record the expected failing result before implementation.
- [x] Extend catalogue and role-specific definitions. Keep tours focused (2–4 short steps, roughly 20–30 seconds) and grounded in the actual visible controls. Required coverage:
  - Student: existing welcome, Course Home, Practice, Review Book and Exam Prep; improve enrollment copy to mention roster matching; explain mastery versus coverage accurately. Add Topic/LO selection, post-answer feedback (retry/reveal/bookmark/flag as actually available), Session Summary, and post-submit Exam Results/history. Use distinct ids `student-topics`, `student-feedback`, `student-session-summary`, `student-exam-results` for new contexts. Preserve existing first-use status unless changed instructions justify a catalogue version bump.
  - Instructor: `instructor-welcome`, `instructor-course-setup`, `instructor-materials`, `instructor-generation`, `instructor-review`, `instructor-question-editor`, `instructor-analytics`, `instructor-course-settings`, `instructor-exams`. Explain source readiness, Topics/LO mapping, explicit generation, Draft versus approval, Student Preview/publication and roster/term access at the relevant existing views. Add structure/flags/team context to relevant tours or contextual help cards where the page has no automatic tour. Do not conflict with the existing Course Preparation guide or cover an active dialog.
  - TA: `ta-review`, `ta-question-review`, `ta-flags`; explain suggested edits, marking reviewed, notes/escalation, capability-dependent controls and Instructor final authority. Hide unavailable actions and support more than one course.
  - Admin: `admin-accounts`, `admin-users`, `admin-capabilities`, `admin-platform-settings`; cover platform Instructor grant versus course roles, retained-record deactivation, layered capability settings/TA hard denies, model/quality/daily limits and explicit saves.
- [x] Make engine account/role aware. Capture route and user identity before all timers/requests/observer waits; cancel obsolete work and ignore stale responses. Clear rejected cache promises so transient failure is retryable. Use safe optional sessionStorage keyed by account/role; consume replay only when the correct context/targets can start. One tour at a time. Do not mark unseen/missing/detached steps complete; handle replaced targets. Check both initial and final preview/mode conditions. During a tour, block background interaction/accessibility focus with proper restoration; Escape/Skip/Back/Next work, navigation cleanup never focuses a detached prior element, and scrolling respects reduced motion.
- [x] Add a consistent Help & Tutorials entry for each real role with current-course-aware replay, completion state, role-only reset and English unavailable reasons. Replays must not create a course, start a paid generation, submit an answer, start a timed exam or change settings. Contexts requiring existing records should offer the relevant safe destination/in-page Help, not an arbitrary unrelated course or hidden paid action. Settings course selection should prefer current context and an accessible active course; explain when none can run practice.
- [x] Integrate only after each real view has rendered the necessary stable targets. Feedback tutorial starts only after answer feedback; result/summary tours only after a completed activity. Student Preview and TA View remain isolated; real role help stays accessible without pretending impersonation is an actual account role. Tutorial API always takes PUID from session; extend authorization only as needed to avoid exposing Admin-specific state to non-admins, while keeping account-owned progress non-privileged.
- [x] A discovered TA UI gap requires a narrow self-capability projection: add `GET /api/courses/:courseId/capabilities/me` and `getMyCourseCapabilities(courseId)` using existing authorization and `hasCapability`/`effectivePermission`. Return only the current user's capability booleans after validating course membership (or existing Admin access), not assignments or other identities. Use it to hide/disable unavailable TA suggest/mark controls and Help destinations with clear reasons; preserve Instructor TA View semantics and hard-denied approval/flag resolution. Test signed-out, foreign-course and restricted TA requests; document this additive contract. No permission writes or Admin configuration redesign.
- [x] Run focused tutorial Jest, client/server typecheck, browser completion/replay/role-switch/preview/race tests and scoped axe at 390px and desktop light/dark. Record tested and uncovered contexts honestly. Report `/private/tmp/financebot-role-experience/task-1-report.md`; leave code uncommitted. Root reviews the diff and tests real-role navigation independently.

### Task 2: Redesign Student Analytics around teaching decisions

**Files:** Modify `server/src/services/analytics.service.ts`, `server/src/routes/analytics.routes.ts`, analytics API shapes/functions in `client/src/api.ts`, `client/src/views/instructor/analytics.ts`. A focused helper module `client/src/views/instructor/analytics-model.ts` may own sorting/labels/filter derivation. Add narrow question-bank deep-link support if existing routes do not consume LO/version filters. Append scoped CSS. Update `tests/unit/analytics.service.test.ts`, `tests/unit/analytics.routes.test.ts`; add `tests/e2e/analytics-dashboard.spec.ts`. API and service/route docs in the same change.

**Interfaces:** Keep existing endpoints backwards compatible with optional filter additions. Outcome filtering uses `mode: 'topic-practice' | 'exam-prep'`, optional `from/to` dates, optional valid `loId` where useful. Engagement's omitted mode retains legacy all-mode behavior; UI always declares its scope. Add course-scoped `GET /api/courses/:courseId/analytics/question-patterns` with validated mode/range/optional LO and limit 1–50 (default 20), guarded by `analytics.view`. Return `{ items: QuestionPattern[], total: number, limit: number }` where total counts matching question/version groups before limiting, not student identities. Distribution accepts an explicit version id and the same mode/range. Resolve referenced versions against the authorized course/question.

```ts
interface QuestionPattern {
  questionId: string; versionId: string;
  stem: string; loId: string; loName: string; themeId: string; themeName: string;
  attempts: number; insufficient: boolean;
  failureRate?: number; misconceptionRate?: number;
}
// Returned distribution must carry selected version identity and enough safe
// option text/role to explain the chart. Counts use this same version/mode/range.
```

- [x] Add behavioral regressions before implementation for five-attempt suppression, zero-attempt objectives, exact mode/date filtering, version-isolated distribution, cross-course/version guards, and range errors. Extend current route/unit fixtures without invoking real model services.
- [x] Repair read-model correctness where the dashboard depends on it: include active LOs with zero attempts; filter archived objectives coherently; prevent active-LO coverage above 100%; explain sessions per active student and observed session duration. Do not infer time studying from open tabs or call attempt count unique questions. Preserve default existing API semantics where valid; document intentional accuracy corrections.
- [x] Implement bounded question-pattern aggregation by question AND recorded version, then resolve course-owned metadata in batches. Include attempt count and suppress rates below five. Filter exact selected mode/date; no cross-version key collision. Invalid or foreign versions return 404/400 rather than current-version substitution. Retain truthful unknown/historical metadata when a referenced source no longer exists. Avoid N+1 detail loads or exposing individual answer records.
- [x] Rebuild the page hierarchy: clear title/context; Topic Practice/Exam Prep selected controls; date presets (last 7/28/84 days and all time) with explicit scope; Refresh and last-updated status; compact evidence/engagement metrics; “Where to focus” ranked objectives with sample sizes and direct question-bank/coverage/flag destinations; expandable Theme/LO outcomes with ascending/descending sort, zero-data states and readable bars. Highest incorrect rate is a review priority, not a claim of student inability or a statistical diagnosis.
- [x] Replace raw Question id entry with selectable question/version cards from the chosen LO/scope. Show readable stems, attempts and a version-specific option distribution, including misconception role labels and observed percentage/count. Provide an actual question-review destination that clearly identifies historical versus current content. Below threshold show Insufficient data and sample counts, no misleading zero bars. Empty question-pattern list explains how practice activity creates evidence.
- [x] Show real weekly engagement and selected range (including empty weeks), accessible tables/text alongside any visual. CSV uses the same filters. Low-engagement threshold is configurable (7/14/30 days) and explicitly independent of outcome date/mode filters. Use neutral “Students to check in with” language, never automatic contact. Name/CWL search supports Enter, empty/results/error states and current `analytics.individual` authorization. Capabilities remain server-enforced; lack of profile permission is handled as a scoped unavailable state, not a whole-page failure.
- [x] Protect against late filter/search/distribution responses and page disposal; preserve chosen LO, disclosure state and input focus where valid. Use modest status transitions and reduced motion. Wire the Task 1 analytics anchors/hook only when content is ready. No spinner forever when one section fails; each failing scope has retry. No new SSE stream is promised: explicit Refresh and visible refresh status are sufficient for this slice.
- [x] Run focused analytics Jest, lint/typecheck/build and deterministic browser checks including stale mode responses, version/LO selection, filters/CSV, empty/insufficient/error data, mobile/light/dark/axe. Report `/private/tmp/financebot-role-experience/task-2-report.md`; leave code uncommitted. Root independently checks real SAML/Mongo before final acceptance.

### Task 3: Integrated acceptance and delivery

- [x] Review each task against its brief, patch and implementation report; fix material findings with covering regression tests and re-review. Do not repeat paid-provider experiments.
- [x] Run full Jest once after integration, lint, typecheck, build and diff checks. Run combined focused browser tests plus real SAML/Mongo role/tutorial persistence, analytics and Student Preview/Exam Prep integrity scenarios using temporary owned fixtures and cleanup.
- [x] Inspect actual app-width desktop and 390px light/dark screenshots; verify no tour obscures required controls or leaves focus blocked after navigation. Record role coverage and exact limits, including any PRD consent-flow gap without treating optional tours as consent.
- [x] Update closest docs, Stephen STATUS and plan checkboxes, then sync Stephen plans. Keep abandoned AI Workspace files absent. Leave source uncommitted and local app running with accepted code for review.
