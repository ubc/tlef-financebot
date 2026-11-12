# Instructor Dashboard Progress — Task Checklist

**Spec:** `docs/superpowers/specs/2026-11-12-instructor-dashboard-progress-design.md`
**Branch:** `dashboard-progress-stepper` (from main at 7810b4d; local only).

- [ ] **1. Server stages.** `instructor-workflow.service.ts`: six stage ids and
  labels, Release and Publish rules, `currentStage`, `release-topics` action,
  `release` destination, drop `dialog` presentation. Update
  `instructor-workflow.service.test.ts`.
- [ ] **2. Client types + dashboard.** `api.ts` types; `dashboard.ts` bar with
  current stage, Next step card, Publish panel; remove readiness card and guide
  button; `release` path (+ `instructor-dashboard.test.ts`); CSS.
- [ ] **3. Remove setup journey.** Delete `setup-journey.ts`, its calls in
  `main.ts`, its CSS, `setup-journey.spec.ts` + config, the instructor-qa list entry.
- [ ] **4. Tests and docs.** Rewrite `instructor-pipeline.spec.ts` guide steps;
  replace the a11y guided-setup test; tutorial anchors/copy; `client/AGENTS.md`,
  `tests/AGENTS.md`, root "Current state", `docs/api-contract.md` if it documents
  the workflow summary.
- [ ] **5. Verify.** typecheck, lint, unit; browser check on 6118; pipeline + a11y.
