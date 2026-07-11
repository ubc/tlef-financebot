# Phase 3 — Full Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Progress tracking (do this, it is not automatic):** the superpowers execution skills track progress in an ephemeral todo list and a git-ignored local ledger — neither of which is visible to the other developer. This plan file is the shared source of truth. So, **the moment a task's review comes back clean and its commit is made, edit this file to change that task's `- [ ]` to `- [x]`, then commit the checkbox change** (e.g. `git commit -am "docs(plan): mark <phase> task N done"`) and push. Keep the checkboxes honest against `git log` — the other developer's agent trusts them to know what is already done. Run `npm run sync-plans -- <YourName>` after so the update propagates.

**Goal:** Complete the MVP surface: Exam Prep for students (templates, single-sitting exams, results, history); the capability model; TA review/triage workflows; instructor analytics; admin essentials (user directory, capability matrix, platform settings).

**Architecture:** Two fully parallel bundles: WS-10 (Exam Prep — reuses the Phase-1 question-serving plumbing) and WS-11+12 (analytics over AttemptRecords; capability model that TA and admin features hang off). **Build the capability model first in the second bundle** — everything else in it depends on capability checks.

**Tech Stack:** as Phase 2, plus `chart.js` (vendored for the client, same mechanism as KaTeX).

## Global Constraints

- Everything in the Phase 0–2 plans' Global Constraints still applies.
- **Schedule tripwire:** if Phase 1/2 work is unfinished on Aug 17, finish it first; this phase's items go to the slip list. Feature freeze is Aug 24, hard.
- Permissions are configuration, not code (PRD §4.2): every capability is an independently assignable toggle; TAs **never** get approve/reject regardless of configuration.
- Exam Prep: no per-question feedback, retries, or hints mid-attempt; assembly draws exclusively from the Approved bank; a shortfall assembles what's available and records the gap — the student is never blocked (ST-X01/X02).
- Exam attempts feed mastery via a separate post-exam batch pass with an `examVerified` qualifier, never the live cadence (§9.2).

---

### Task 1: Capability model (PRD §4.2) — build first

**Files:**
- Create: `server/src/services/capabilities.service.ts`
- Create: `server/src/components/auth/capability-guard.ts`
- Modify: `server/src/components/mongodb/collections.ts` (add `capabilitySettingsCol` — platform defaults + per-course overrides)
- Test: `tests/unit/capabilities.service.test.ts`

**Interfaces:**
- Consumes: `usersCol()`, new `capabilitySettings` collection (`{ scope: 'platform' } | { scope: 'course', courseId }`, `assignments: Partial<Record<Capability, Partial<Record<CourseRole | 'admin', boolean>>>>`, `updatedBy`, `updatedAt`).
- Produces:
  - `type Capability = 'question.review' | 'question.suggest-edit' | 'question.mark-reviewed' | 'question.create-draft' | 'question.approve' | 'flag.triage' | 'flag.resolve' | 'analytics.view' | 'analytics.individual' | 'exam.configure' | 'course.manage-tas' | 'materials.upload' | 'hierarchy.edit'`.
  - `PLATFORM_DEFAULTS: Record<Capability, Record<'student' | 'instructor' | 'ta' | 'admin', boolean>>` — instructor: everything true; TA defaults per PRD §7: review/suggest-edit/mark-reviewed/triage true; create-draft, analytics.view, analytics.individual, upload, hierarchy, exam.configure false; student: all false.
  - **Hard invariant enforced in code, not config:** `question.approve` and `flag.resolve` return `false` for role `'ta'` no matter what any settings document says (PRD §7).
  - `hasCapability(user: User, courseId: ObjectId, capability: Capability): Promise<boolean>` — resolution order: admin → true (except nothing overrides the TA invariant since admins aren't TAs); per-course override → platform settings doc → `PLATFORM_DEFAULTS`. Per-TA individual toggles (IN-T02) store as per-course overrides keyed by puid: extend assignments with optional `userOverrides: Record<puid, Partial<Record<Capability, boolean>>>` checked before role resolution.
  - `ensureCapability(capability: Capability)`: RequestHandler — 401/403 like the Phase-1 guards; used by every TA-facing route and retrofitted onto instructor question/flag routes (behaviour-preserving for instructors given the defaults).
  - `effectivePermission(courseId, role, capability): Promise<{ value: boolean; source: 'default' | 'course' | 'admin-override' | 'user-override' }>` — for AD-02's display.

- [ ] **Step 1: Failing tests** — TA invariant survives a settings doc granting `question.approve` to `ta`; per-course override beats platform default; user override beats role; `effectivePermission` reports the winning source; instructor defaults all-true.
- [ ] **Step 2–4: FAIL → implement → PASS** (re-run Phase 1/2 route suites after retrofitting guards — they must stay green).
- [ ] **Step 5: Commit** — `git commit -m "feat: capability model with platform defaults, per-course/per-user overrides, and hard TA approval invariant (§4.2)"`

---

### Task 2: Exam templates (IN-S07) + feedback-strategy setting UI (IN-S10)

**Files:**
- Create: `server/src/services/exam-templates.service.ts`
- Create: `server/src/routes/exams.routes.ts`
- Create: `client/src/views/instructor/exam-templates.ts`
- Modify: `client/src/views/instructor/course-setup.ts` (feedback-strategy radio group with inline descriptions — UI over the Phase-1 `PATCH /api/courses/:id` field)
- Modify: `server/src/app.ts`
- Test: `tests/unit/exam-templates.service.test.ts`

**Interfaces:**
- Consumes: `examTemplatesCol()`, `questionsCol()`, `themesCol()`.
- Produces: `saveTemplate(courseId, input: Omit<ExamTemplate, 'courseId' | 'updatedAt'>): Promise<{ template: WithId<ExamTemplate>; warnings: Array<{ themeId; themeName; requested: number; available: number }> }>` — validates required fields (themes with counts/splits/points, availability window); computes per-theme Approved supply vs `mcqCount + tfCount` and returns shortfall warnings **without blocking the save** (IN-S07); one template per `(courseId, kind)` (upsert). `listTemplates(courseId)`, `activeTemplates(courseId, now)` (availability window contains `now`). Template updates apply to the next generated attempt only — assembly always reads the template at start time; in-flight `ExamAttempt`s pin their own question list (already guaranteed by the `ExamAttempt.questions` snapshot).

- [ ] **Step 1: Failing tests** — missing time-limit is allowed (optional), missing counts rejected; supply warning lists the exact shortfall; upsert replaces the same kind; activeTemplates respects the window.
- [ ] **Step 2–4: FAIL → implement (service, routes `PUT /api/courses/:courseId/exam-templates/:kind`, `GET .../exam-templates`, instructor views) → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: midterm/final exam templates with supply warnings; feedback-strategy setting UI (IN-S07, IN-S10)"`

---

### Task 3: Exam assembly + single-sitting attempt (ST-X01, ST-X02)

**Files:**
- Create: `server/src/services/exam-attempts.service.ts`
- Modify: `server/src/routes/exams.routes.ts`
- Test: `tests/unit/exam-attempts.service.test.ts`

**Interfaces:**
- Consumes: `examAttemptsCol()`, `questionsCol()`, `questionVersionsCol()`, params service (serve-time randomization), templates (Task 2).
- Produces:
  - `startExam(user, courseId, templateId): Promise<WithId<ExamAttempt>>` — assembles per theme: random Approved questions matching the MCQ/T-F split, no duplicates across the exam; per-question `paramValues` resolved at assembly and **fixed for the attempt**; shortfalls recorded on the attempt (`shortfalls`) and surfaced to the instructor (notification `review-backlog`-style standard notice); resuming: an existing unsubmitted attempt for the same template is returned as-is with answers retained (interruption resume, ST-X02).
  - `answerQuestion(attemptId, puid, index: number, selectedKey: string): Promise<void>` — rejects after submission; changeable freely before it.
  - `submitExam(attemptId, puid, opts?: { auto?: boolean }): Promise<{ score; maxScore }>` — scores against the pinned versions, writes one `AttemptRecord` per question (`mode: 'exam-prep'`, `examAttemptId` set, `isRetry: false`), sets `submittedAt`; enqueues the post-exam mastery batch job (Task 4).
  - `examState(attemptId, puid)` — question list (stems/options only — **no roles, explanations, or correctness before submission**), answered/unanswered map, `remainingSeconds` when the template has a time limit (computed from `startedAt`; the server, not the client clock, is authoritative — `submitExam` is also invoked by a lazy check: any exam route touching an expired attempt auto-submits it first).
- Routes (student-guarded): `GET /api/courses/:courseId/exams` (active templates — entry point hidden client-side when empty), `POST /api/courses/:courseId/exams/:templateId/start`, `GET /api/exam-attempts/:attemptId`, `PUT /api/exam-attempts/:attemptId/answers/:index`, `POST /api/exam-attempts/:attemptId/submit`.

- [ ] **Step 1: Failing tests** —

```
1. assembly matches the template exactly when supply suffices (counts per theme, split)
2. shortfall: theme wants 5 MCQ, 3 exist -> attempt has 3 + shortfall {requested:5, assembled:3};
   start is not blocked
3. assembly draws only state:'approved'
4. answer changeable before submit; rejected after
5. examState never contains role/explanation keys (walk the JSON)
6. expiry: startedAt older than the limit -> next examState call auto-submits
7. re-start with an open attempt returns the same attempt (answers retained)
8. submit writes one AttemptRecord per question with mode:'exam-prep' and scores points
```

- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: exam assembly from approved bank with shortfall handling and single-sitting attempt state machine (ST-X01/X02)"`

---

### Task 4: Exam results, history, post-exam mastery pass (ST-X03, ST-X04, §9.2)

**Files:**
- Modify: `server/src/services/exam-attempts.service.ts` (results + history)
- Create: `server/src/services/exam-mastery.service.ts` (batch job)
- Modify: `server/src/routes/exams.routes.ts`
- Test: `tests/unit/exam-results.test.ts`

**Interfaces:**
- Consumes: submitted `ExamAttempt`s, mastery service, review-book service (auto-collect misses — reuses Phase 1's upsert), templates (`loBreakdown`).
- Produces:
  - `examResults(attemptId, puid)` → `{ score, maxScore, byTheme: [{ themeId, name, earned, possible }], byLo?: [...], questions: [{ ...full review: stem, options with roles + explanations, selectedKey, correct }] }` — full per-question review **only after** submission; weak themes/LOs carry `practiceLink` metadata for the client.
  - Misses auto-collect into the Review Book on submission (ST-R01 applies to Exam Prep).
  - `examHistory(puid, courseId)` → `[{ attemptId, kind, date, score, maxScore }]` with drill-in to the same results payload (ST-X04).
  - Job `exam.mastery-pass` (enqueued by `submitExam`): for each exam AttemptRecord, updates the LO's profile by setting `examVerified: true` on a miss-affected LO **as a qualifier** — it never overwrites the practice-derived `status` (§9.2); processed in one batch, not the live cadence.
- Routes: `GET /api/exam-attempts/:attemptId/results`, `GET /api/courses/:courseId/exam-history`.

- [ ] **Step 1: Failing tests** — results hidden pre-submission (409); byTheme sums match the score; `loBreakdown: false` omits `byLo`; mastery pass sets the qualifier without changing `status`; misses land in the Review Book once each.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: exam results with post-scoring review, exam history, and post-exam mastery qualifier pass (ST-X03/X04, §9.2)"`

---

### Task 5: Exam Prep client views

**Files:**
- Create: `client/src/views/student/exam-select.ts`, `client/src/views/student/exam-attempt.ts`, `client/src/views/student/exam-results.ts`, `client/src/views/student/exam-history.ts`
- Modify: student course-home (Exam Prep entry visible only when `GET /exams` is non-empty), router.

**Interfaces:** consumes Tasks 2–4 routes; `renderRichText`.

Key behaviours: question navigation grid with answered/unanswered states; "Submit exam" warns listing unanswered questions before final submission; countdown visible throughout when limited, warning style at 5 minutes, auto-submit on expiry (server-verified); no feedback of any kind mid-attempt; results view with per-Theme bars, full question review, and links into Topic Practice / Review Book for weak areas.

- [ ] **Step 1: Build the four views; typecheck + lint PASS.**
- [ ] **Step 2: Playwright spec** `tests/e2e/exam-mode.spec.ts` — start exam → answer some → verify **no** correctness/explanation text appears anywhere mid-attempt (assert on page content) → reload resumes with answers retained → submit → results show score, review, and Review Book contains the misses. Run → PASS. *(This spec is also Phase 4's exam-integrity critical path — keep it.)*
- [ ] **Step 3: Commit** — `git commit -m "feat: exam prep student views with integrity guarantees (ST-X01..X04)"`

---

### Task 6: TA management + TA workflows (IN-T01–T03, TA-01–TA-04, §6.2 notes)

**Files:**
- Create: `server/src/services/tas.service.ts`
- Create: `server/src/routes/tas.routes.ts`
- Create: `client/src/views/instructor/tas.ts` (add/list/permissions/re-invite)
- Create: `client/src/views/ta/review-queue.ts`, `client/src/views/ta/flag-triage.ts`
- Modify: `server/src/services/flags.service.ts` (escalation), `bank.service.ts` (TA read paths), router/home (TA branch + course switcher when multiple TA courses)
- Modify: `server/src/components/mongodb/collections.ts` (add `taInvitesCol` — `{ courseId, email, status: 'pending' | 'active' | 'expired', permissions?: Record<Capability, boolean>, invitedAt, activatedPuid? }`)
- Test: `tests/unit/tas.service.test.ts`, `tests/unit/ta-routes.test.ts`

**Interfaces:**
- Consumes: capability model (Task 1); users, flags, questions services.
- Produces:
  - `addTa(courseId, email): Promise<TaInvite>` — format-validated UBC email; duplicate caught inline (409); on any CWL login, `upsertUserFromSaml` (extend it) checks pending invites matching the user's email → activates: adds `{ courseId, role: 'ta' }` to `courseRoles`, stores per-TA permission overrides via the capability service (IN-T01).
  - `setTaPermissions(courseId, puid, permissions: Partial<Record<Capability, boolean>>)` — presets client-side ("Standard TA" = review + triage + analytics.view), toggles individual; effective immediately (IN-T02).
  - `expireTas(courseId)` (term-end sweep — recurring job shared with course expiry) and `reinviteTa(courseId, puid)` restoring the prior config (IN-T03).
  - TA review queue: same data as the instructor queue (TA-01) but the route is `ensureCapability('question.review')`-guarded and the payload/UI carry **no approve/reject affordances**; `POST /api/questions/:id/mark-reviewed` (`ensureCapability('question.mark-reviewed')`) → `transitionQuestion(to: 'reviewed')`.
  - Suggested edits (TA-02): `POST /api/questions/:id/suggestions { stem?, options?, ... }` stores a proposed (unsaved) version on the question (`suggestions: [{ puid, patch, status: 'pending' | 'accepted' | 'discarded', at }]` — optional field on `Question`); instructor accept applies it via `editQuestion`, modify pre-fills the editor, discard marks it; TA sees their suggestion status.
  - Flag triage (TA-03): `POST /api/flags/:flagId/escalate { recommendation: 'correct' | 'archive' | 'clear', note? }` → flag state `open → escalated`, lands in the instructor priority queue; proactive escalation `POST /api/questions/:id/escalate { reasonCategory, note? }` creates an `escalated` flag with no student (`puid: 'ta:' + puid` marker or a nullable puid — make `Flag.puid` optional and add `raisedBy: 'student' | 'ta'`).
  - Internal notes (§6.2): `POST /api/questions/:id/notes { text }` — instructor or `question.review` TAs; timestamped, attributed, teaching-team-only (never in student payloads — assert in test).
  - TA-04: all TA routes scope by course via `courseRoles`; the client shows a course switcher when >1 TA course.

- [ ] **Step 1: Failing tests** — invite→login activation by email match; **no configuration grants a TA the transition to `approved`** (route test: TA with every capability toggled on still gets 403 on `POST /transition { to: 'approved' }` — this is the phase exit criterion); suggestion accept applies exactly the patch; escalation moves flag state and preserves the recommendation; notes never appear in `/practice/next` or exam payloads.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: TA invites, per-TA permissions, review/mark-reviewed, suggested edits, flag triage — approval structurally impossible for TAs (IN-T01..03, TA-01..04)"`

---

### Task 7: Instructor analytics (IN-A01–IN-A04)

**Files:**
- Create: `server/src/services/analytics.service.ts`
- Create: `server/src/routes/analytics.routes.ts`
- Create: `client/src/views/instructor/analytics.ts`, `client/src/views/instructor/student-profile.ts`
- Modify: `scripts/vendor-client-libs.mjs` (+ chart.js UMD), `client/public/index.html`
- Modify: `server/src/app.ts`
- Test: `tests/unit/analytics.service.test.ts`

**Interfaces:**
- Consumes: `attemptsCol()` aggregations, `masteryCol()`, `reviewBookCol()`, `usersCol()`.
- Produces (all with a `minAttempts = 5` floor returning `{ insufficient: true }` instead of a rate — IN-A01/A02):
  - `failureRates(courseId, mode: 'topic-practice' | 'exam-prep')` → per-Theme `{ themeId, name, attempts, failureRate | insufficient }`, expandable per-LO; sortable client-side.
  - `answerDistributions(courseId, questionId)` → per-option `{ key, role, count, pct }` + `misconceptionHighlight: boolean` (CM share > 1.5× uniform expectation); aggregated Theme/LO variants.
  - `engagement(courseId, range: { from, to })` → totals (questions attempted, avg session time from attempt timestamp clustering with 30-min gaps, sessions per student, LO coverage rate, review-book activity rate) by week; `lowEngagement(courseId, inactiveDays)` list; CSV export route (`text/csv` via a small serializer — no new dependency).
  - `studentProfile(courseId, puid)` → chronological history, per-LO mastery, engagement summary, flag events (redirects; struggle flags when Phase-3+ ships them; questions the student flagged) (IN-A04). Search by name/CWL: `GET /api/courses/:courseId/students?q=`.
- Routes instructor-guarded + `ensureCapability('analytics.view')` / `'analytics.individual'` for the profile; Topic Practice and Exam Prep separated as tabs (mode filter).

- [ ] **Step 1: Failing tests** — insufficient-data floor; failure rate math on a seeded fixture (10 attempts, 4 misses → 40%); CM highlight triggers at the threshold; engagement session clustering (two attempts 40 min apart = 2 sessions); CSV serializer escapes commas/quotes.
- [ ] **Step 2–4: FAIL → implement (aggregation pipelines in the service; Chart.js bar/line charts in the views) → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: class analytics, answer distributions, engagement metrics with CSV export, individual profiles (IN-A01..A04)"`

---

### Task 8: Admin essentials (AD-01, AD-02, AD-07)

**Files:**
- Create: `server/src/services/admin.service.ts`
- Create: `server/src/routes/admin.routes.ts`
- Create: `client/src/views/admin/users.ts`, `client/src/views/admin/capabilities.ts`, `client/src/views/admin/platform-settings.ts`
- Modify: `server/src/components/mongodb/collections.ts` (add `platformSettingsCol` — singleton doc `{ models: { generator, validator, reviewer, masteryEvaluator }, costControls: { maxGenerationsPerDay: number }, featureFlags: { reviewerAgent: boolean, layer2Evaluator: boolean } }`)
- Modify: `server/src/services/generation.service.ts` + `mastery-evaluator.service.ts` (read model/flags from platform settings, falling back to env)
- Modify: `server/src/app.ts`, router/home (admin branch)
- Test: `tests/unit/admin.service.test.ts`

**Interfaces:**
- Consumes: `usersCol()`, `auditCol()`, capability service (Task 1).
- Produces:
  - AD-01: `listUsers({ q?, role?, courseId? })` (searchable directory with per-course role context); `assignRole(puid, courseId, role, actorPuid)` / `removeRole(...)` — effective next request (roles live on the user doc, re-read by `deserializeUser` every request already); `deactivateUser(puid)` (`deactivatedAt` on User; `deserializeUser` returns `false` for deactivated users → platform-wide revocation with records retained) and `reactivateUser`; orphan-course warning: removing the last instructor role from a course returns `{ warning: 'orphans-course', courseId }` requiring a `confirm: true` re-call; every change audit-trailed.
  - AD-02: `GET/PUT /api/admin/capabilities` over the Task-1 settings docs; the matrix client view shows every capability × role toggle, per-course overrides, and `effectivePermission` source labels; changing a platform default never rewrites existing per-course customizations (they're separate docs).
  - AD-07: `GET/PUT /api/admin/platform-settings` — four model selectors (applied on save; generation/evaluator services read settings-first), cost controls with inline validation (reject non-positive numbers → 400), feature flags as labelled toggles; disabling `reviewerAgent` requires `{ confirmQualityImpact: true }` in the body (the client shows the confirmation describing the quality impact — this is the §11 fallback control); the generation pipeline skips the reviewer step when the flag is off, recording `agentDecision: { decision: 'flag', reasoning: 'Reviewer agent disabled at generation time.' , roleAssessment: '' }`.
- All routes guarded by `ensureAdmin()` (new tiny guard: 403 unless `req.user.isAdmin`).

- [ ] **Step 1: Failing tests** — deactivated user's `deserializeUser` yields `false`; orphan warning + confirm flow; reviewer-flag-off pipeline path records the disabled reasoning; cost-control validation; audit entries on every admin mutation.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: admin user directory, capability matrix, platform settings with model selectors and reviewer toggle (AD-01/02/07)"`

---

### Task 9: Phase exit checks

- [ ] **Step 1:** `tests/e2e/exam-mode.spec.ts` (Task 5) green; a student completes a template-conforming exam and results feed mastery + analytics (extend the spec: instructor analytics shows the exam attempts under the Exam Prep tab).
- [ ] **Step 2:** TA invariant test (Task 6) green — TA can review, suggest, escalate; cannot approve under any configuration.
- [ ] **Step 3:** Instructor dashboard answers "which Themes/LOs are weak, which students are inactive" — manual check against seeded data.
- [ ] **Step 4:** Full suite: `npm run lint && npm run typecheck && npm test && npm run test:e2e` → PASS. Feature-complete by **Aug 23 EOD**.
- [ ] **Step 5: Commit** — `git commit -m "test: phase-3 exit checks"`

---

## Deliberately not planned (master slip list — PHASING.md)

IN-S09 merge/split with re-linking, IN-L03/L04 co-instructors & ownership transfer, IN-L05 course copy, §9.3 struggle/distillation detection + IN-A06, AD-03/04/05 (cross-course dashboards, perf monitoring, rollout), TA-05/06 student-support views. These land post-Sep-1 in slip-list order; plan them then against the shipped codebase.

## Within-phase slip order (phase doc)

1. IN-A03 engagement metrics (Task 7's engagement/lowEngagement/CSV slice only)
2. ST-X04 exam history (Task 4's history slice + Task 5's history view)
