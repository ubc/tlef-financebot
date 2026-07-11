# Phase 4 — Test & Harden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Progress tracking (do this, it is not automatic):** the superpowers execution skills track progress in an ephemeral todo list and a git-ignored local ledger — neither of which is visible to the other developer. This plan file is the shared source of truth. So, **the moment a task's review comes back clean and its commit is made, edit this file to change that task's `- [ ]` to `- [x]`, then commit the checkbox change** (e.g. `git commit -am "docs(plan): mark <phase> task N done"`) and push. Keep the checkboxes honest against `git log` — the other developer's agent trusts them to know what is already done. Run `npm run sync-plans -- <YourName>` after so the update propagates.

**Goal:** Product-level verification before real students arrive: critical-path E2E, WCAG 2.1 AA scans, a 250-session concurrency smoke test, instructor bank QA support, and launch readiness. **Feature freeze Aug 24** — every change in this phase is a test, a bug fix, or launch configuration. No feature work; features that miss the freeze ship after Sep 1.

**Architecture:** No new product architecture. Test infrastructure only: Playwright specs, axe scans, an autocannon-based load script, and launch checklists with verification commands.

**Tech Stack:** as Phase 3, plus `autocannon` (dev dependency, load smoke test).

## Global Constraints

- **Feature freeze Aug 24 is hard.** Bug fixes and content work only; the test week is never traded for feature work.
- Targets (PRD §2 System Requirements): question serving + answer→feedback round-trip < 500 ms (pure DB path); page load < 2 s, TTI < 3 s; ≥250 concurrent sessions with p95 < 1 s on read APIs; WCAG 2.1 AA; latest-two evergreen browsers; mobile usable end-to-end (not polished).
- Staging must run production-shaped config: real LLM provider, real Qdrant, real Mongo, real CWL Shibboleth (swapped from the mock IdP).
- Go/no-go on Aug 31; the Theme "Available from" date-gate is the built-in partial-launch tool for any no-go surface.

---

### Task 1: Critical-path Playwright E2E consolidation

**Files:**
- Verify/extend: `tests/e2e/core-loop-demo.spec.ts` (Phase 1), `tests/e2e/flag-loop.spec.ts` (Phase 2), `tests/e2e/exam-mode.spec.ts` (Phase 3)
- Create: `tests/e2e/critical-paths.spec.ts` (gap-fill only — do not duplicate the three existing specs)

**Interfaces:** consumes the full deployed app against the compose stack.

- [ ] **Step 1: Audit coverage against the phase-doc list** — required paths: (a) login → enroll → practice → feedback → Review Book; (b) exam-mode integrity (no feedback leakage mid-attempt); (c) flag → auto-pause → resolve. Map each to its existing spec; list gaps (likely: session resume mid-practice ST-E03; Strategy-A retry gate end-to-end; deferred session summary).
- [ ] **Step 2: Write `critical-paths.spec.ts` covering exactly the gaps found** — concrete specs, e.g.:

```ts
test('interrupted practice session resumes with persisted mastery (ST-E03)', async ({ page, context }) => {
  // answer 2 questions, capture LO status text, close and reopen the page,
  // assert the LO list shows the same status and no unsubmitted answer survived
});

test('strategy-A retry gate withholds explanations until the retry resolves (ST-P04)', async ({ page }) => {
  // seed a course where the CM option is known; select it; assert only the chosen
  // option's explanation is visible and the correct answer is absent from the DOM;
  // resolve the retry; assert full reveal
});
```

- [ ] **Step 3: Run the full e2e suite three times consecutively** — `for i in 1 2 3; do npm run test:e2e || break; done` → 3× PASS (flake check; fix any flaky waits with proper `expect(...).toBeVisible()` polling, never `waitForTimeout`).
- [ ] **Step 4: Commit** — `git commit -m "test: consolidate critical-path e2e coverage (login->practice->review book, exam integrity, flag loop, session resume, retry gate)"`

---

### Task 2: WCAG 2.1 AA scans (@axe-core/playwright)

**Files:**
- Modify/extend: `tests/a11y/a11y.spec.ts`
- Fix: whatever the scans surface (client views/CSS)

- [ ] **Step 1: Extend the a11y suite to the required surfaces** — student: question view (with a rendered KaTeX formula + table), feedback view (both strategies), Review Book, exam attempt + results; instructor: dashboard/home, review queue, bank, analytics. Pattern per surface:

```ts
import AxeBuilder from '@axe-core/playwright';

test('question view has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/#/course/…/practice/…'); // seeded route helper
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});
```

- [ ] **Step 2: Run, triage, fix blockers** — `npm run test:a11y`. Fix every `critical`/`serious` violation (semantic buttons/labels, contrast, focus order, option-group semantics — radio group with `fieldset`/`legend` on the question options is the likely big one). Re-run until zero serious+ violations.
- [ ] **Step 3: Commit fixes and specs separately** — `git commit -m "test(a11y): WCAG 2.1 AA scans across student and instructor surfaces"` / `git commit -m "fix(a11y): <specific fixes>"`

---

### Task 3: Concurrency smoke test — 250 sessions

**Files:**
- Create: `scripts/load-smoke.mjs`
- Create: `scripts/seed-load-test.ts` (creates a course, 60 approved questions across 3 themes, 250 student users + sessions)
- Modify: `package.json` (`load:seed`, `load:smoke` scripts; `autocannon` devDependency)

**Interfaces:** consumes a staging (or staging-shaped local) deployment; session cookies pre-minted by the seed script (insert session documents directly into Mongo's `sessions` collection for the 250 seeded PUIDs — no IdP round-trips in the load path).

- [ ] **Step 1: Write the seed script** — idempotent; prints the cookie list to `scratch/load-cookies.txt` (gitignored).
- [ ] **Step 2: Write `scripts/load-smoke.mjs`** — autocannon runs, one per target, each with 250 connections × 60 s, cycling the 250 cookies across connections:

```js
// Targets and pass criteria (PRD §2):
//   GET  /api/courses/:id/home            p95 < 1000 ms  (read API at load)
//   POST /api/courses/:id/practice/next   p95 < 500 ms   (serving, pure DB path)
//   POST /api/attempts                    p95 < 500 ms   (answer->feedback round trip)
// The script prints a PASS/FAIL table and exits 1 on any breach.
```

Implement with `autocannon({ url, connections: 250, duration: 60, requests: [...] })`, reading p95 from `result.latency.p97_5 ?? result.latency.p95` (autocannon exposes `p97_5`; use `result.latency.percentiles` if on a version exposing explicit p95) and comparing against the target per route.

- [ ] **Step 3: Run against staging** — `npm run load:seed && npm run load:smoke`.
Expected: PASS table. On FAIL: profile the offending route (missing index is the usual suspect — check `explain()` on the serving query; the Phase-0 `INDEX_SPECS` cover the designed paths), fix, re-run. Rate-limit note: the Phase-0 limiter (600/min/IP) will throttle a single-IP load run — set `RATE_LIMIT_DISABLED=true` support in `env.ts`+`app.ts` (config-only change, allowed in freeze) or run distributed.
- [ ] **Step 4: Page-load spot check** — Chrome DevTools on staging: course home and question view < 2 s load, < 3 s TTI on a campus-comparable connection.
- [ ] **Step 5: Commit** — `git commit -m "test: 250-session concurrency smoke with p95 gates on serving and feedback paths"`

---

### Task 4: Browser/device spot checks

- [ ] **Step 1:** Manual pass on latest-two Chrome, Firefox, Safari, Edge: login, practice one question (KaTeX renders, options select, feedback shows), Review Book opens, exam starts. Record results in `docs/launch/browser-checks.md` (create it; a simple matrix table with date + build hash).
- [ ] **Step 2:** Mobile (one iOS Safari + one Android Chrome, or DevTools emulation as fallback): the same flow is **usable end-to-end** — no unreachable controls or horizontal traps. Log defects; fix blockers only (usable, not polished — PRD §2).
- [ ] **Step 3: Commit** — `git commit -m "docs: browser and mobile spot-check matrix"`

---

### Task 5: Product/content testing support (instructor week — starts Aug 24, hard date)

**Files:**
- Create: `scripts/mastery-sanity.ts`
- Create: `docs/launch/acceptance-runbook.md`

- [ ] **Step 1: Write `scripts/mastery-sanity.ts`** — scripted attempt sequences through the real `mastery.service` against a seeded course, printing a table of expected vs actual: tier advance on correct streak; CM-miss repeat; hard-miss step-back; covered threshold; covered→in-progress regression; theme coverage with a skipped LO (§9.2 rules as pinned by the Phase-1 tests — this script is the *product-level* sanity pass on real course content). Run: `npx tsx scripts/mastery-sanity.ts` → all rows `OK`.
- [ ] **Step 2: Write `docs/launch/acceptance-runbook.md`** — the instructor's checklists, concretely:
  - **Bank QA pass (hard start Aug 24):** filter bank by Theme; read each Approved question's stem + explanations against course notation conventions; systematic mismatches → fix via prompt/context adjustment in the generation presets (`GENERATOR_PROMPT` guidance text / course generation guidance), not per-question edits (§6.2); re-generate affected thin LOs.
  - **Pre-seeding completion:** `GET /api/courses/:id/preseeding` per launch Theme — every LO ≥3 Approved (target 5); thin LOs either filled or their Theme's "Available from" date pushed past launch.
  - **Instructor acceptance run:** full student journey with a test account (enroll → practice both strategies → skip → Review Book → exam) and full instructor journey (upload → generate → review → approve → flag resolve).
  - **Feedback-strategy behaviour check on real content:** Strategy A retry gating + degradation to B observed on an actual CM-tagged question.
- [ ] **Step 3: Support the instructor through the run**; file every finding as a bug; fix in priority order (launch blockers first).
- [ ] **Step 4: Commit** — `git commit -m "test: mastery sanity script and instructor acceptance runbook"`

---

### Task 6: Launch readiness

**Files:**
- Create: `docs/launch/go-no-go.md`
- Modify: staging config only (no code)

- [ ] **Step 1: CWL PIA/DAR status** — confirm with UBC IAM in **week-1 of this phase** (escalate immediately if not cleared — launch blocker; do not wait for Aug 31).
- [ ] **Step 2: Real CWL Shibboleth on staging** — set `SAML_ENVIRONMENT`, `SAML_ENTRY_POINT`, `SAML_IDP_METADATA_URL`, cert path per UBC IAM's metadata; verify a real CWL login end-to-end; verify `ubcEduCwlPuid` arrives and maps to the same identity model the mock produced.
- [ ] **Step 3: Onboarding flow verification (§4.1)** — first login on staging shows: mandatory service-use acknowledgement + copyright disclaimer (blocking), then the **separate, declinable** research-export consent; declining research consent doesn't affect practice; the disclaimer appears near Submit on question views; the CWL-username watermark renders on question and feedback views. *(If any of this was missed in Phases 1–3, it is a launch-blocking bug fix now: the fields already exist on `User` — `onboardingAcknowledgedAt`, `researchExportConsent` — gate practice routes on acknowledgement.)*
- [ ] **Step 4: COMM 298 configuration** — term dates set; registration code generated and delivered to the instructor; roster uploaded; publish checklist green (IN-L06).
- [ ] **Step 5: §11 fallback controls verified working on staging** — flip the reviewer-agent feature flag off and on (AD-07 confirmation flow); confirm pre-seeding thresholds surface thin LOs.
- [ ] **Step 6: Rollback/recovery basics** — take a `mongodump` of staging→prod baseline; document the deploy + restart procedure in `docs/launch/go-no-go.md` (build → `npm start` under the process manager → health check `GET /api/health`); note that full backup policy remains a UBC IT item (PRD §2).
- [ ] **Step 7: Fill in `docs/launch/go-no-go.md`** — the gate list with evidence links: critical-path E2E green (Task 1), WCAG blockers fixed (Task 2), concurrency targets met on staging (Task 3), real CWL login working (Step 2), PIA/DAR cleared (Step 1), bank pre-seeded for launch Themes (Task 5), instructor acceptance sign-off (Task 5). **No-go on any blocker → date-gate the affected surface (launch with fewer Themes visible) rather than launching broken.**
- [ ] **Step 8: Commit** — `git commit -m "docs: go/no-go gate evidence and rollback procedure"`

---

## Exit criteria — go/no-go on Aug 31

Go requires every line in `docs/launch/go-no-go.md` checked with evidence. Partial-launch fallback: Theme "Available from" dates.

## Post-launch reminders (Sep 1 →, not part of this plan)

- Slipped features land mid-term in master-slip-list order; Exam Prep (if slipped) before the ~mid-Oct midterm.
- Weekly: monitor flag queue, review-backlog notifications, Layer-2 evaluator behaviour (if shipped).
- Dec–Jan: WT2 load test (500 concurrent) before COMM 370/371 enrollment opens (§11).
