# Phase 3 — Full Surface

**Window:** Aug 17 – Aug 23, 2026 (1 week, ~40 combined hours)
**Goal:** Complete the MVP surface: Exam Prep for students, analytics + TA workflows + admin essentials for the teaching team. This phase runs as two fully parallel bundles.

**Schedule tripwire:** if Phase 1 or 2 work is still unfinished on Aug 17, finish it first and move this phase's items to the slip list — Phase 4 (test week) starts Aug 24 regardless. Exam Prep, if slipped, must still land before the COMM 298 midterm (~mid-October).

## Entry criteria

- Phases 1–2 exit criteria met (or explicit slip decisions recorded in PHASING.md).

## Workstreams

### WS-10 — Exam Prep *(pairs with WS-3/4 — reuses question-serving UI)*

- [ ] Exam templates in Course Settings: Themes, counts, MCQ/T-F split, points, time limit, availability window; supply-shortfall warnings (**IN-S07**).
- [ ] Assembly from Approved bank matching template exactly; shortfall assembles-what's-available + records gap for instructor (**ST-X01**).
- [ ] Single-sitting conditions: no feedback mid-attempt, navigation with answered/unanswered map, submit warning, interruption resume, countdown + 5-min warning + auto-submit (**ST-X02**).
- [ ] Results: score + per-Theme breakdown (LO-level per config), full post-scoring review, weak-area links into Topic Practice/Review Book, auto-collection of misses (**ST-X03**).
- [ ] Exam history view (**ST-X04**).
- [ ] Post-exam batch mastery pass with "exam-verified" qualifier (PRD §9.2).
- [ ] Feedback-strategy course setting: Adaptive / A-only / B-only (**IN-S10**) — small; UI for the Phase 1 dispatch logic.

### WS-11 + WS-12 — Analytics, TA & Admin *(WS-11 pairs with WS-7 — same AttemptRecord/mastery data)*

Analytics (WS-11):
- [ ] Class failure rates by Theme/LO, Topic Practice vs Exam Prep separated, "Insufficient data" floors (**IN-A01**).
- [ ] Per-question answer distributions with misconception highlighting (**IN-A02**).
- [ ] Engagement metrics + low-engagement list + CSV export (**IN-A03**).
- [ ] Individual student profiles: history, mastery, flags (**IN-A04**).

TA & roles (WS-12):
- [ ] Capability model: permissions as configuration, independently assignable per role (PRD §4.2) — build this **first**; TA and admin features hang off it.
- [ ] TA whitelist add + CWL email match on first login, status tracking (**IN-T01**); per-TA permission presets + toggles (**IN-T02**); term expiry + re-invite (**IN-T03**).
- [ ] TA review queue with Mark-as-reviewed (never Approve) (**TA-01**); suggested edits as proposed versions with instructor accept/modify/discard (**TA-02**).
- [ ] Flag triage + escalation with recommendation; proactive escalation (**TA-03**); multi-course scoping (**TA-04**).
- [ ] Instructor/TA internal notes on pipeline questions (§6.2).

Admin essentials:
- [ ] User directory, per-course role assignment, deactivation, audit trail (**AD-01**).
- [ ] Capability matrix with defaults + overrides + effective-permission display (**AD-02**).
- [ ] Platform Settings: four per-step model selectors, cost controls, feature flags incl. reviewer toggle with confirmation (**AD-07**).

## Exit criteria

- Student completes a template-conforming practice exam; results feed mastery and analytics.
- TA can review, suggest edits, and escalate — and cannot approve, under any configuration (tested).
- Instructor dashboard answers: which Themes/LOs are weak, which students are inactive.
- Feature-complete for Sep 1 scope by **Aug 23 EOD** (freeze is Aug 24).

## What can slip (already on the master slip list)

IN-S09 merge/split, IN-L03/L04 co-instructors, IN-L05 course copy, §9.3 struggle detection + IN-A06, AD-03/04/05, TA-05/06. Within this phase: IN-A03 engagement metrics and exam history (ST-X04) slip before anything else.
