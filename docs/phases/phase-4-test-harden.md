# Phase 4 — Test & Harden

**Window:** Aug 24 – Aug 31, 2026 (1 week, ~40 combined hours + instructor time)
**Goal:** Product-level testing before real students arrive. **Feature freeze Aug 24** — bug fixes and content work only. This week is protected: features that miss the freeze ship after Sep 1; the test week is never traded for feature work.

## Entry criteria

- Phase 3 exit (or recorded slip decisions).
- Instructor available this week for bank QA and acceptance testing.
- Staging environment up with production-shaped config (real LLM provider, Qdrant, Mongo).

## Task list (both devs; split by area, pair on launch blockers)

### Automated verification

- [ ] Playwright critical-path E2E (PRD §2): login → enroll → practice → feedback → Review Book; exam-mode integrity (no feedback leakage mid-attempt); flag → auto-pause → resolve.
- [ ] @axe-core/playwright WCAG 2.1 AA scan on student surfaces (question view, feedback, Review Book, exam) and primary instructor views; fix blockers.
- [ ] Concurrency smoke test: 250 concurrent sessions, p95 < 1s on read APIs; question serving + feedback round-trip < 500 ms (pure DB path); page loads < 2 s (PRD §2 System Requirements).
- [ ] Evergreen-browser spot check (Chrome/Firefox/Safari/Edge, latest two); mobile usable end-to-end (not polished — PRD §2).

### Product / content testing (instructor + devs)

- [ ] **Bank QA pass (starts Aug 24, hard date):** instructor notation/terminology consistency review of the pre-seeded bank (§6.2); systematic mismatches fixed via prompt/context adjustment, not per-question edits.
- [ ] Pre-seeding complete: 3–5 Approved questions per LO for launch Themes; thin LOs either filled or their Themes date-gated ("Available from") past launch.
- [ ] Instructor acceptance run: full student journey with a test account; full instructor journey (upload → generate → review → approve → resolve a flag).
- [ ] Feedback-strategy behaviour check on real course content (Strategy A retry gating, degradation to B).
- [ ] Mastery progression sanity check with scripted attempt sequences (advance, step-back, regression rules — §9.2).

### Launch readiness

- [ ] CWL PIA/DAR status confirmed with UBC IAM — **launch blocker if not cleared**; escalate in week 1 of this phase, not on Aug 31.
- [ ] Real CWL Shibboleth integration verified on staging (swap from mock IdP).
- [ ] Onboarding flow: mandatory service-use acknowledgement + copyright disclaimer + optional research-export consent (§4.1); username watermark on question/feedback views.
- [ ] Term dates, registration code, roster upload for COMM 298; publish-course checklist green (IN-L06).
- [ ] Reviewer-agent toggle and pre-seeding thresholds confirmed working — these are the §11 fallback controls if content quality wobbles mid-pilot.
- [ ] Rollback/recovery basics: Mongo backup taken before launch; deploy + restart procedure documented (full backup policy remains a UBC IT item, §2).

## Exit criteria — go/no-go on Aug 31

Go requires: critical-path E2E green, WCAG blockers fixed, concurrency targets met on staging, real CWL login working, PIA/DAR cleared, bank pre-seeded for launch Themes, instructor acceptance sign-off.

No-go on any launch blocker → date-gate the affected surface (e.g., launch with fewer Themes visible) rather than launching broken; the Theme "Available from" mechanism is the built-in partial-launch tool.

## Post-launch (Sep 1 →)

- Slipped features land mid-term in master-slip-list order; Exam Prep (if slipped) before the ~mid-Oct midterm.
- Weekly: monitor flag queue, review-backlog notifications, and Layer-2 evaluator behaviour (if shipped).
- Dec–Jan: WT2 load test (500 concurrent) before COMM 370/371 enrollment opens (§11).
