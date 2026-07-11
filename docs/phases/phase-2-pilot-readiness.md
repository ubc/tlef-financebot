# Phase 2 — Pilot Readiness

**Window:** Aug 10 – Aug 16, 2026 (1 week, ~40 combined hours)
**Goal:** The safety and content-supply features the pilot needs on day one: students can flag bad questions, instructors get notified and can resolve, and the instructor can bulk-load existing content (imports, parameterized scripts) to hit the pre-seeding target.

## Entry criteria

- Phase 1 exit demo passes.
- Instructor has begun assembling COMM 298 source materials for pre-seeding (non-dev).

## Workstreams

### WS-8 — Flag loop & notifications *(spans student + instructor surfaces — good for whoever finished Phase 1 first)*

- [ ] One-click, non-blocking student flagging with optional reason, idempotent per context (**ST-P09**).
- [ ] Flag case state machine: Open → Escalated → Resolved (corrected/archived/cleared), attached to QuestionVersion (PRD §6.2).
- [ ] Auto-pause: (attempts ≥ 5 AND flag% ≥ 30%) OR (count ≥ 15), instructor-configurable; Paused state enters/exits per PRD §4.3/§6.2.
- [ ] Instructor flag resolution: correct / archive / clear, with sign-off requirement (**IN-Q06**). Correctness-affecting edits: for the pilot, a **manual remediation checklist** (locate affected AttemptRecords by QuestionVersion, recompute, notify) — full automation is on the slip list (§6.2).
- [ ] In-app notification system with tiering (PRD §4.3): standard flag notification, elevated auto-pause notification, daily batched summary (only when there's activity); polling delivery; pending-approval threshold notification (§9.1).
- [ ] Progression-recommendation surfaces (**ST-P05**) and repeated-failure redirect with material links, never-blocking, silent dashboard flag (**ST-P07**) — backends built in Phase 1.

### WS-9 — Import & parameterization *(pairs with WS-5/6)*

- [ ] Import CSV/JSON/QTI with preview, partial-success handling, auto-conversion of non-MCQ/T-F with "Auto-converted" label (**IN-Q01**).
- [ ] Parameterization config panel: variable slots (name/min/max/step or value set), stem-placeholder linkage, randomized preview (**IN-Q09**).
- [ ] Parameterized execution: instructor-authored `generate()` (PrairieLearn convention) in `worker_threads` — resource limits, no network, no filesystem writes, seeded randomization (PRD §2).
- [ ] Existing parameterized-script migration: parse → map to template → review → parameterized Draft (**IN-Q10** tail).
- [ ] Convertible-to-parameterized flagging at import preview.
- [ ] Custom-prompt generation with @-mention material references and preset templates (**IN-Q11**); regeneration with side-by-side compare (**IN-Q12**).

## Exit criteria

- Flag → notify → auto-pause → resolve loop demonstrated end to end.
- COMM 298's existing practice sets and parameterized scripts imported as Drafts; pre-seeding to 3–5 Approved/LO underway (instructor time, continues into Phases 3–4).
- Sandboxed `generate()` execution passes abuse tests (infinite loop, network attempt, fs write).
- supertest coverage on flag state machine and auto-pause thresholds.

## What can slip

1. IN-Q11/IN-Q12 (custom-prompt generation, regeneration) — one-click thin-LO generation from Phase 1 covers the pre-seeding need
2. QTI import (keep CSV/JSON)
3. Daily batched summary notification (keep standard + elevated tiers)

Do **not** slip: flagging, auto-pause, or the worker sandbox — these are the pilot's content-safety net.
