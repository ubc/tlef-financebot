# Student UI — Figma-driven rebuild (design)

_Author: Stephen (Dev A). Date: 2026-07-20._

## Context

Task 14 (student client views, done and merged) built the functional student
practice loop before this project adopted a Figma-MCP-driven UI workflow.
Saurav's Task 15 (instructor views) was re-planned mid-task to follow the
team's Figma file — `Finance-bot`, page **"Wireframe v0.2"**, file key
`3lSS05Sk1OWpnxFQNyVsM9`, canvas `148:2725` — and shipped a green instructor
shell that roughly matches it (layout/structure/palette-language, not
pixel-perfect). This project brings the student side to the same standard:
a blue student shell that roughly matches the wireframe's student screens
(`1–12`), reusing the app's existing routes/services (Tasks 3/9/10/11/12
already merged and unchanged by this work) — **this is a client-only
rebuild**, no server/contract changes.

Reference: `docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md`
(the equivalent document for the instructor side) and
`docs/superpowers/plans/phase-1/Saurav/PHASE-1-UI-HANDOFF.md`.

## Scope

**In scope — the 9 core student screens:**

| Figma screen | node-id | Our route | Our file(s) |
|---|---|---|---|
| 1 - Course Home (**"My Courses"**) | `148:2726` | `/` | `views/home.ts` (student branch) |
| 2 - Topic List | `148:2777` | `/course/:id` | `views/student/course-home.ts` |
| 3 - LO List | `148:2834` | `/course/:id/theme/:themeId` | `views/student/lo-list.ts` |
| 4 - Practice Question | `148:2901` | `/course/:id/practice/:loId`, `/course/:id/practice-theme/:themeId` | `views/student/practice.ts` + `practice-card.ts` |
| 5 - Feedback (Correct) | `148:2967` | same route, post-submit state | `practice-card.ts` |
| 6 - Feedback (Strategy A) | `148:3015` | same route, post-submit state | `practice-card.ts` |
| 7 - Session Summary | `148:3066` | `/course/:id/summary` | `views/student/session-summary.ts` |
| 11 - Review Book | `148:3388` | `/course/:id/review-book` | `views/student/review-book.ts` |
| 12 - Review Book Practice again | `148:3456` | same practice route, `mode=review-book` | `practice.ts`/`practice-card.ts` |

**Correction from initial framing:** "Topic List" is not a new page — it's
what `course-home.ts` already renders (a single course's list of
Topics/Themes). No new route is needed. `views/home.ts`'s student branch
already is Figma screen 1 ("My Courses" — the multi-course list), not a
separate "course home" concept.

**Out of scope (explicitly deferred, same convention Saurav used for
instructor out-of-scope nav items):**
- All `S*` special-case screens (S14 numerical question, S15 Strategy B
  feedback, S16 session-start banner, S17 follow-up questions, S20 flag
  popover, S21 topic-complete celebration, S22 in-context hint) — later work.
- The Flag button (visible in screen 4) renders but is **disabled /
  "coming soon"** — there is no backend flag-submission capability yet
  (`flagsCol()` exists but nothing writes to it; confirmed during Task 5
  review). Wiring it up means building S20 too, which is out of scope here.
- "Locked by instructor" topic state (seen in screen 2's third row) — **not
  built**. It corresponds to a topic-pacing/release feature that doesn't
  exist in our data model (`Theme` has no locked/release field) and is
  distinct from the existing "zero-Approved-questions → hidden entirely"
  rule (a hard global constraint — themes with zero Approved questions must
  stay fully hidden, never shown as "locked"). Inventing a field for this
  would be a backend/contract change, out of scope for a UI rebuild. Topics
  continue to just not appear when they have zero Approved questions,
  exactly as Task 10 already implemented.
- Exam Prep nav entry — renders but disabled (Exam feature is unbuilt:
  `ExamTemplate`/`ExamAttempt` exist as domain types only, no service/routes/
  screens 8–10 are Phase-1 scope at all).

**New, real, in-scope additions:**
- **Copyright/disclaimer footer** ("© FinanceBot · UBC Sauder. All FinanceBot
  materials are the intellectual property of the instructor. Unauthorized
  personal or commercial use is prohibited.") on every student screen, per
  PRD §4.1. Currently entirely missing.
- **Breadcrumb** (`Course › Topic › LO`) + persistent "Session Summary →"
  link during practice.

## Architecture

### 1. A distinct blue student shell (`buildStudentShell`)

Mirrors `buildInstructorShell` in `main.ts` (Saurav's Task-15 pattern) rather
than reusing the generic `NAV`-driven `buildShell`. Decision: `bootstrap()`'s
`else` branch (today: any non-instructor session gets `buildShell`) becomes
`buildStudentShell` unconditionally for every authenticated non-instructor
session — matching how the instructor/student split already works (keyed on
`isInstructor()`, no separate "is this a student" check needed, since Phase 1
has exactly two authenticated roles). The generic `NAV`-driven `buildShell`
and its example pages (`/notes`, `/rag`, `/faculty`, `/student`, `/staff`,
`/classes`, `/members`) become dead code for authenticated users once this
ships — same fate Task 15 already gave the generic shell for instructors.
They aren't deleted in this project (out of scope; a separate cleanup task
if the team decides the boilerplate examples are no longer needed at all).

Sidebar (blue, ~240px, mirrors instructor's `sidebar sidebar--instructor`
pattern but with its own modifier class `sidebar--student`):
- Brand: `FinanceBot` (hardcoded, same reasoning as instructor shell — a
  re-skin of `config.ts`'s `APP.name` is out of scope here).
- Course switcher (`Course Name ▾`) when inside a course — exact interaction
  (dropdown vs. link back to My Courses) is an implementation-time decision,
  not pinned in this spec.
- Nav: **My Courses**, **Review Book**, **Exam Prep** (disabled) when not in
  a practice session. **During practice**, the nav area instead shows: course
  switcher, "Topic Practice" (active) + "Session Summary" sub-link, Review
  Book, Exam Prep (disabled), then a divider, then a **context panel** (current
  Topic/LO name, status, "N answered · M correct"), then pinned at the
  bottom: **Skip this LO** and **End Session & Return** buttons (moved out of
  the practice card's body, where Task 14 originally put them).
- Footer: student's display name.

### 2. Shared component module: `client/src/student-ui.ts`

Mirrors `instructor-ui.ts`. Reuses what's reusable from the existing
`ui.ts` (`masteryBadge`, `optionButton`, `watermark` stay; `optionButton`'s
locked/selected/correct/incorrect states are unchanged — Task 14's reveal-
withholding logic is untouched, this is a visual/layout rebuild only).

New primitives:
- `statTile` — reuse `instructor-ui.ts`'s directly (identical shape, seen in
  both I1 dashboard and screen 7 session summary) rather than duplicating.
- `pageHeader` — reuse `instructor-ui.ts`'s if the shape fits (title +
  subtitle + primary action); extend only if student screens need a
  breadcrumb variant it doesn't support.
- `practiceContextPanel(topic, lo, status, answered, correct)` — the sidebar
  LO-progress card during practice.
- `copyrightFooter()` — the disclaimer, used by every student screen.
- `topicRow` / `loRow` — list-row primitives for screens 2 and 3 (status
  badge + counts + action button), replacing ad hoc markup currently inline
  in `course-home.ts`/`lo-list.ts`.

### 3. Practice view restructure (screens 4/5/6/12)

Functional behavior from Task 14 is preserved (option locking, Strategy-A
retry-in-place, adaptive feedback reveal rules, skip, transcript, review-book
auto-collection, end-session, practice-more-on-this-LO links) — this is a
**layout and chrome change**, not a logic change:
- Skip / End Session move from the card body into the shell's sidebar context
  panel (still call the same `practice-session.ts` functions).
- Transcript keeps its scrollable card-stack-above-current-question layout
  (already matches the wireframe closely) but gets the `Q1`/`Q2`-style
  numbering and the collapsed "You answered: Option B (Correct)" /
  "✕ You answered: Option A · Correct: Option C" summary line treatment
  shown in screen 4.
- Options become full-width rows with a lettered badge tile (`optionButton`
  already close to this — verify against the wireframe during
  implementation, adjust CSS only, not markup structure, unless needed).
- Add the (disabled) Flag button next to the existing Bookmark button.
- Breadcrumb + "Session Summary →" added to the page header.

### 4. Review Book (screen 11) and Session Summary (screen 7)

Both already match the wireframe's data shape closely (Task 12's backend
already groups by Theme=Topic, already has sort, already computes accuracy-
by-LO and missed-questions). This is primarily a visual/layout pass:
- Review Book: topic-group header gets "Topic Practice →" and "Practice All
  →" actions alongside the existing per-LO Review/Practice-again buttons
  (verify `Topic Practice`/`Practice All` map to existing
  `selectNextQuestion`/theme-practice entry points — no new backend calls
  expected).
- Session Summary: `statTile` row (LOs Covered / Questions Answered /
  Correct Answers / Accuracy / Review Book Added), topic-grouped accordion
  with per-LO accuracy, missed-questions list, "Recommended next steps"
  banner, and three actions (**Continue Practice**, **Go to Review Book**,
  **Back to Course**). The existing "Defer to next session" action (added in
  Task 14's review-fix round, ST-P10) is **kept** — it doesn't conflict with
  the three wireframe buttons; it's a distinct action for ending on this
  screen without continuing, and stays available (exact placement — a 4th
  button vs. tucked elsewhere — is an implementation-time call).

## Testing / verification

Same discipline as Task 14: `npm run typecheck && npm run lint` after each
view; the existing `tests/e2e/practice-loop.spec.ts` must keep passing
(update its selectors if markup structure changes break them — the spec
tests behavior, e.g. "sees feedback", "finds it in Review Book", not exact
DOM shape, so most of it should survive untouched). No new unit tests are
expected — like Task 14, view-layer correctness is verified through the e2e
spec and manual/browser check, not fabricated DOM unit tests.

## Execution plan

Same `subagent-driven-development` workflow as Tasks 3–14: a new task
document under `docs/superpowers/plans/phase-1/Stephen/`, one implementer +
review cycle per screen/file group, tracked in the existing
`.superpowers/sdd/progress.md` ledger and mirrored into a `STATUS.md` update
when done. Suggested grouping (each a "Task" in the new plan, sized similarly
to a Task-15 subtask):
1. Shell + `student-ui.ts` primitives + CSS tokens (blocks everything else).
2. Course Home / My Courses (`home.ts` student branch) + Topic List
   (`course-home.ts`) + LO List (`lo-list.ts`).
3. Practice + Feedback (`practice.ts` + `practice-card.ts` + sidebar context
   panel integration).
4. Review Book + Session Summary.
5. e2e spec update/verification pass.
