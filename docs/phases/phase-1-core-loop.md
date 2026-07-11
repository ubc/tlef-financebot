# Phase 1 — Core Loop

**Window:** Jul 27 – Aug 9, 2026 (2 weeks, ~80 combined hours)
**Goal:** The product's irreducible core, end to end: a student can enroll, practice by Theme/LO with adaptive feedback, and revisit mistakes in the Review Book; an instructor can set up a course, upload materials, generate questions, and approve them. This is the loop the pilot depends on (PRD §11) — everything later is additive.

## Entry criteria

- Phase 0 exit criteria met (walking skeleton, API contract, pinned toolkit).
- PSD/PRD serving-policy reconciliation answered (or default to Approved-only per PRD §9.1).

## Workstreams

### WS-3 — Student practice experience

- [ ] Enrollment by registration code + roster cross-check, with all four error states (**ST-E02**); identity-scoped activity and session resume (**ST-E03**).
- [ ] Course home: Theme list with coverage indicators, "Available from" gating, empty states (**ST-P01**); LO list with status labels and start/re-entry behaviour (**ST-P02**).
- [ ] Question view: one question at a time, MCQ 4-option / True-False, pending-choice → Submit, inline tables/visuals via KaTeX/Markdown, parameterized values fixed for the attempt (**ST-P03**).
- [ ] Immediate feedback with strategy dispatch (**ST-P04**): Strategy A (Common Misconception → chosen-option explanation + retry on a *new* same-concept question, degrade to B if none exists), Strategy B (full reveal), Adaptive routing, locked-strategy and mid-session-change semantics per PRD §5.1/§6.3.
- [ ] Question-selection algorithm (PRD §5.1): filter Approved by LO → exclude served-this-session → difficulty tier from mastery progression → random within pool → graceful degradation ladder (same-difficulty repeat → adjacent unseen → any Approved).
- [ ] Manual LO skip, recorded as attempted/not-attempted variants (**ST-P06**).
- [ ] In-session scrollable transcript with practice-from-history (**ST-P08**).
- [ ] Session-start and end-of-session summaries with defer-to-next-session (**ST-P10**, **ST-P11**).
- [ ] Every answer writes an AttemptRecord pinning QuestionVersion, LO context, mode, strategy, parameter values (PRD §2).

### WS-4 — Review Book *(pairs with WS-3 — same UI surfaces, same AttemptRecord flow)*

- [ ] Auto-collection on every miss, immediately, regardless of retry outcome; one entry per question, latest-attempt context updates (**ST-R01**).
- [ ] Manual bookmarking, toggleable, visually distinct from auto-collected (**ST-R02**).
- [ ] Re-practice: fresh attempts, full feedback, full mastery weight (**ST-R03**); parameterized re-randomization (**ST-R04**).
- [ ] Collapsed Theme-view default, two entry modes, six sort options, empty state (**ST-R05**).
- [ ] End-of-session missed list wired into the ST-P10 summary (**ST-R06**); jump to Topic Practice per LO (**ST-R07**).

### WS-5 — RAG & generation pipeline

- [ ] Material upload (PDF/DOCX/PPTX/TXT/URL) via multer, per-file independent processing with status + retry, public-URL-only ingestion (**IN-S04**).
- [ ] Ingestion: toolkit document-parsing → chunking → embeddings → Qdrant, scoped per course (PRD §2).
- [ ] Manual material↔Theme/LO assignment with Unassigned section (**IN-S05**); LLM auto-classification with confidence + accept/modify/reject (**IN-S06**); AI-suggested hierarchy from materials (IN-S01 tail).
- [ ] Three-agent generation pipeline (PRD §9.1): generator → structure validator (four option roles) → reviewer; per-step model config from env (AD-07 groundwork); output enters as Draft.
- [ ] One-click thin-LO generation against the 3–5 Approved/LO pre-seeding target, with dashboard progress indicator (**IN-Q10** core).
- [ ] Embedded-question auto-detection in materials routed through the conversion path (§9.1) — *stretch within this phase; drop first if tight.*

### WS-6 — Course setup & question review UI *(pairs with WS-5 — same instructor surface)*

- [ ] Course creation + Theme/LO hierarchy CRUD with reorder, expandable tree, inline duplicate warnings (**IN-S01**); term dates with auto-expiry semantics (**IN-S02**); registration code generate/regenerate (**IN-S03**).
- [ ] Review queue with priority ordering, full question detail, agent decision + reasoning (**IN-Q02**, **IN-Q05**).
- [ ] Question editing with edited-field distinction (**IN-Q03**); approve/reject/bulk-approve semantics (**IN-Q04**).
- [ ] Bank browse/search/filter: publication-state filter (six states), label filters, tree view with counts (**IN-Q08**).
- [ ] Multi-LO/Theme tagging with AI suggestion + confirm (**IN-Q13**).
- [ ] Publish/sandbox with pre-publish checklist, publish-with-warnings (**IN-L06**).

### WS-7 — Mastery engine *(pairs with WS-5 — both LLM/pipeline work)*

- [ ] Layer 1 statistics: rolling 10-attempt window per (student, LO) — attempt count, accuracy, option-role distribution — computed on every attempt (PRD §9.2).
- [ ] Four-state LO status + progression rules: tier advance on correct, repeat on Common Misconception miss, step-back on clustered Hard misses; Covered→In-progress regression; Theme coverage with skipped-LO semantics.
- [ ] Agenda job queue: mastery evaluation batches, generation runs, term-expiry sweep scaffolding (PRD §2).
- [ ] Layer 2 LLM mastery evaluator: every-5-attempts batched cadence + disengaged fast-track, status + rationale + question-type recommendation constrained by actual bank (PRD §9.2). **Pre-approved fallback:** if not stable by Aug 9, ship Layer-1-only progression and move Layer 2 to the slip list.
- [ ] Backend for progression recommendations and redirect thresholds (ST-P05/ST-P07 surfaces land in Phase 2).

## Integration points

- WS-3 ↔ WS-7: selection algorithm consumes mastery tier; agree the interface in week 1 via the API contract.
- WS-3 ↔ WS-6: student serving reads only Approved questions; publication-state changes must be immediately visible to serving.
- Mid-phase checkpoint (~Aug 2): one instructor-generated, approved question served to a student end-to-end.

## Exit criteria

- Demo: create course → upload material → generate → approve → student enrolls → practices with adaptive feedback → miss lands in Review Book → re-practice updates mastery.
- Jest/supertest coverage: publication-state transitions, selection-algorithm degradation ladder, feedback-strategy dispatch, auth-gated endpoints.
- No unreviewed content can reach a student (Approved-only serving verified by test).

## What can slip (within-phase priority, lowest first)

1. Embedded-question auto-detection (§9.1)
2. Layer 2 mastery evaluator (fallback above)
3. AI-suggested hierarchy (IN-S01 tail) — manual hierarchy creation suffices
4. Six Review Book sort options → ship default Theme/LO sort + date added
