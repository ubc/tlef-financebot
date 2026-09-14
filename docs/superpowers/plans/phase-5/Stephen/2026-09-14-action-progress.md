# Action Progress Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan. Keep changes local for user acceptance.

**Goal:** Replace cursor-based waiting with visible, accessible action feedback across all roles and the source preparation guide.

**Architecture:** Explicit button busy state, reusable rendering, and existing source/content-run stage data. Disabled prerequisites are separate from active work. Retain native disabled protection and current route/data ownership.

**Tech Stack:** Native TypeScript/DOM/CSS, Jest, Playwright. Owner: Stephen. Base: 8c8cb03.

## Global Constraints

- English product text. No dependency, backend contract or model configuration changes.
- No progress percentage unless supplied by real measured work. No fake timed completion or automatic next-step navigation.
- No global text matching or MutationObserver to infer busy state. Explicit lifecycle state controls indicators.
- Busy actions show a button-contained indicator, meaningful text and aria-busy; reduced motion suppresses rotation. Unavailable prerequisites show no spinner.
- Preserve disabled constraints, prevent duplicate submissions, restore usable state after success/error and avoid leaking state into detached/replaced views.
- Current-account and course authorization, exam correctness gating and Student Preview isolation remain unchanged.
- No paid generation, data migration, app commit, push or deployment. Test via controlled responses and existing local services.

### Task 1: Shared action state and full UI integration

**Files:** Create `client/src/action-state.ts`; modify `client/src/dom.ts`, `client/public/styles/main.css` and async button call sites under `client/src/views/`, `client/src/ui.ts` as needed. Create `tests/e2e/action-progress.spec.ts` and `playwright.action-progress.config.ts`. Update `client/AGENTS.md`.

**Interfaces:** Shared `setButtonBusy(button: HTMLButtonElement, busy: boolean): void` renders `aria-busy` without replacing text or child icons, allowing existing view code to own labels and disabled eligibility. Declarative buttons may use a boolean `busy` attribute handled by `el` after children are appended. Any automatic promise handling must use explicit returned promises, never label text or disabled inference, and restore pre-action disabled state without undoing eligibility decisions.

- [ ] Audit all async button paths: Instructor sources/setup/import/generation/review/settings/structure/bank, Student practice/bookmarks/flags/exams/review, TA notes/review/flags, Admin accounts/users/capabilities/settings and shared dialogs/help.
- [ ] Add reusable explicit busy rendering and visible spinner CSS. Change progress/not-allowed cursor treatments for disabled action buttons to default. Keep text legible and reduced-motion support.
- [ ] Connect busy state to actual request lifetimes and existing view states. Use try/finally where a retained button must recover, and label work where necessary. Cover fire-and-forget onclick wrappers explicitly; avoid whole-app event monkey patches.
- [ ] Replace the screenshot's source waiting dead-end: show processing status within UI, retain current run messages/stages and ready/processing counts, and switch to actionable continuation only once a source is ready. No spinner when no source exists or all processing failed.
- [ ] Browser verification: deferred request exposes spinner before resolution, double click sends one request, error restores retry, prerequisite-only disabled controls do not spin, source processing/ready/failed transitions, route cleanup, light/dark/mobile/reduced motion and accessibility. Include representative Instructor/Student/TA/Admin actions.
- [ ] Run typecheck, lint, build and focused browser/unit regressions; record exact coverage and any limitations in `/private/tmp/action-progress-report.md`.

### Task 2: Independent acceptance

- [ ] Review complete source diff against constraints and task coverage; resolve material findings.
- [ ] Inspect running local UI and test evidence. Update Stephen status and this plan, sync personal plans, and leave feature code local for review.
