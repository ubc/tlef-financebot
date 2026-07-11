# FinanceBot — Phasing Document

Companion to `PRD.md` v0.8 (see PRD §1: build sequencing lives here, not in the PRD).
Team: 2 developers, ~20 h/week each (~280 combined hours to deadline).
Hard deadline: **September 1, 2026** — pilot launch for COMM 298 (~180 students).

## How to use these documents

- `PHASING.md` (this file) — timeline, phase summaries, cut lines, risk register.
- `phase-0-foundations.md` … `phase-4-test-harden.md` — one workable doc per phase: goal, entry/exit criteria, workstreams with PRD requirement IDs, and what can slip.
- Work is organized into **workstreams (WS-1 … WS-12)** — cohesive task bundles meant to be owned by a single developer. Developers pick whole bundles, not individual tasks. Each phase doc lists its workstreams; affinity notes indicate which bundles pair well under one owner.

**Default split (optional):** one dev takes the student-facing arc (WS-1, 3, 4, 8, 10), the other the AI/instructor arc (WS-2, 5, 6, 7, 9, 11); WS-12 goes to whoever is ahead. Any whole-bundle split works.

## Timeline

| Phase | Window | Theme | Doc |
|---|---|---|---|
| 0 — Foundations | Jul 13 – Jul 24 (2 wks) | Shared types, data model, CWL auth + mock IdP, Docker dev env, API contract, CI | `phase-0-foundations.md` |
| 1 — Core loop | Jul 27 – Aug 9 (2 wks) | Student practice loop + Review Book; minimum instructor pipeline + mastery engine | `phase-1-core-loop.md` |
| 2 — Pilot readiness | Aug 10 – Aug 16 (1 wk) | Flag loop, notifications, import, parameterization | `phase-2-pilot-readiness.md` |
| 3 — Full surface | Aug 17 – Aug 23 (1 wk) | Exam Prep + templates; TA workflows, admin, analytics | `phase-3-full-surface.md` |
| 4 — Test & harden | Aug 24 – Aug 31 (1 wk) | **Feature freeze Aug 24.** E2E tests, WCAG scan, load smoke test, instructor bank QA, bug fixes only | `phase-4-test-harden.md` |
| **Deadline** | **Sep 1** | **Pilot launches** | — |

TLEF milestone markers: internal testing (originally Aug–Sep) is compressed into Phase 4 plus continuous per-phase testing; Sep–Dec is pilot support; Dec interim evaluation; Jan–Mar refinement + WT2 expansion (COMM 370/371).

## Priority ordering & cut lines

The plan targets the full PRD §10 MVP by Sep 1. That is aggressive for ~280 part-time hours, so **phase order is the safety valve** (PRD §11 scope-risk mitigation):

- **The pilot cannot launch without Phases 0–2.** These deliver the core Topic Practice + Review Book loop plus enough instructor tooling to seed and approve the question bank.
- **If behind schedule on Aug 17**, Phase 3 items (Exam Prep, analytics, TA/admin) slip past Sep 1 and land mid-term — Exam Prep must still land before the COMM 298 midterm (~mid-October). Phase 4's test week is **never** sacrificed to feature work.
- **Feature freeze Aug 24 is hard.** Anything not feature-complete by then ships after Sep 1.

### Slip list (first features to move past Sep 1, in order)

1. Hierarchy merge/split with re-linking (IN-S09 merge/split; rename/archive stay in scope)
2. Co-instructors & ownership transfer (IN-L03, IN-L04)
3. Course copy to new term (IN-L05) — not needed until WT2
4. Struggle/distillation signal detection (§9.3, IN-A06)
5. Content-error remediation automation (§6.2) — manual instructor process acceptable for pilot
6. Admin cross-course dashboards, performance monitoring, rollout management (AD-03, AD-04, AD-05)
7. TA student-support views (TA-05, TA-06)
8. Mastery Layer 2 LLM evaluator (§9.2) — pre-approved fallback: ship Layer-1 statistics-only progression, add the evaluator post-launch

## Continuous testing expectation

There is no separate QA stage before Phase 4. Every phase's exit criteria include Jest/ts-jest unit + supertest integration tests for new endpoints and state transitions (PRD §2 Testing). Playwright E2E and axe WCAG scans are Phase 4 deliverables, but critical-path Playwright specs should be written as features land.

## Risk register (from PRD §11, mapped to phases)

| Risk | Phase impact | Mitigation in this plan |
|---|---|---|
| Scope risk (broad MVP, 280 h) | All | Priority ordering + slip list above; Phase 4 protected |
| Core-feature quality (mastery, feedback, generation) | 1, 4 | Layer-2 fallback pre-approved; reviewer toggle + pre-seeding threshold as content safety net; Phase 4 bank QA |
| Pre-1.0 toolkit dependency (`ubc-genai-toolkit-*`) | 0, 1 | Phase 0 integration spike with pinned exact versions; shim time budgeted in WS-5 |
| CWL PIA/DAR timeline (outside team control) | 0 → launch | Kick off with UBC IAM in Phase 0 week 1 (non-dev task); develop against mock SAML IdP throughout |
| WT2 scaling (~500 concurrent) | Post-pilot | Phase 4 smoke-tests pilot target (250 sessions); full WT2 load test scheduled Dec–Jan, before WT2 enrollment |
| PSD divergence ("RAG generation fallback" vs Approved-only serving, §9.1) | 1 | Build Approved-only (per PRD); reconcile with Saurav/Stephen before Phase 1 ends |

## Weekly cadence

- Both devs part-time: a short sync twice a week (start/end of week) to check phase exit criteria and re-balance workstreams.
- Integration points are called out per phase doc; the API contract (Phase 0, WS-2) is the coordination artifact — change it via PR review, not ad hoc.
