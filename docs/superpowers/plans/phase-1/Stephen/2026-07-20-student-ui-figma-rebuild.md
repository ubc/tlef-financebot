# Student UI — Figma-driven Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Phase-1 student UI (My Courses, Topic List, LO List, Practice + Feedback, Review Book, Session Summary) as a distinct blue student shell that *roughly* follows the Figma "Wireframe v0.2" student screens (1–12), on top of the already-merged Tasks 3/9/10/11/12/14 endpoints — no server/contract changes.

**Architecture:** Client-only rebuild. Adds a **student shell variant** (`buildStudentShell` in `main.ts`, mirroring Saurav's `buildInstructorShell`) and a small **shared component vocabulary** (`client/src/student-ui.ts`, mirroring `instructor-ui.ts`) so the student views stay visually consistent without a framework. Existing view logic (option locking, Strategy-A retry-in-place, adaptive feedback reveal rules, skip, review-book auto-collection, mastery display) is preserved — this is layout/chrome, not behavior.

**Tech Stack:** TypeScript (strict) compiled by `tsc` to ES modules; hand-rolled DOM via `dom.ts`; `renderRichText` (KaTeX+marked+DOMPurify) for stems/explanations; Playwright for e2e. No new npm dependencies, no new server endpoints.

## Global Constraints

- **Follow the wireframe *roughly*** — match layout, structure, and the blue/white language; do not chase pixel-perfect spacing or exact design tokens. Design source: Figma file `Finance-bot`, page "Wireframe v0.2", file key `3lSS05Sk1OWpnxFQNyVsM9`. Pull a screen live with `get_screenshot`/`get_design_context` (load the `figma-design-to-code` skill first) when building its view — node-ids are given per task below.
- **No new npm dependencies.** Vanilla TS + existing utilities only.
- **No server/contract changes.** Every endpoint this plan uses already exists (`getCourseHome`, `enrollInCourse`, `listEnrollments`, `getNextPracticeQuestion`, `submitAttempt`, `getSessionSummary`, `deferSessionSummary`, `getReviewBook`, `bookmarkQuestion`/`unbookmarkQuestion` in `client/src/api.ts`). If a screen seems to need data no endpoint provides, derive it client-side or drop that element — do not add/change a server endpoint in this plan.
- **Client imports use the `.js` extension** (browser loads compiled output as native ESM — see `client/AGENTS.md`).
- **Every view is `export function renderX(outlet: HTMLElement, params: RouteParams): void | Promise<void>`** built with `el`/`mount` from `dom.ts`; no innerHTML string templating for dynamic/user data (XSS). Use `renderRichText` for question stems/options/explanations.
- **Preserve all Task 14 security-relevant behavior unchanged:** `/practice/next` and attempt-feedback responses never leak `role`/`explanation`/correctness beyond what the applied strategy's response actually contains — `practice-card.ts`'s existing reveal logic must not be touched beyond layout, and any refactor must keep rendering strictly from API response fields (never inferred/guessed).
- **Out-of-scope elements render visible-but-inactive**, same convention Task 15 used: the Flag button (no backend capability — `flagsCol()` has no writer), the Exam Prep nav item (no Exam feature built), and the "Locked by instructor" topic state (no backend field — zero-Approved-question topics keep the existing Task 10 behavior of being fully hidden, never shown as locked).
- **Verification per task:** `npm run typecheck && npm run lint && npm run build` all clean. No new unit-test harness for view-layer DOM code (matches Task 14/15 precedent); correctness is typecheck+lint+build plus the Task 5 Playwright pass over the existing `tests/e2e/practice-loop.spec.ts`. Where a step adds pure logic, add a `tests/unit/*.test.ts` for it.
- **Full design doc:** `docs/superpowers/specs/2026-07-20-student-ui-figma-rebuild-design.md` — read it before starting; it has the complete screen→route→file mapping table and the reasoning behind every scope decision below.

---

## Plan-authoring note (deviation from writing-plans "full code in every step")

Same posture as Saurav's Task 15 plan (`docs/superpowers/plans/phase-1/Saurav/2026-07-17-task-15-instructor-views.md`): these are **design-driven view** tasks, each built live against its Figma frame + the real, already-existing API. Transcribing every DOM node here would be enormous and stale the moment spacing shifts. This plan gives, per task: exact **files**, exact **interfaces** (full code for shared `student-ui.ts` primitives and the shell — the things every view depends on), the **wireframe node-id**, and concrete **behaviors + acceptance criteria**. View bodies are specified by structure/behavior, not transcribed node-by-node. Shared *interfaces* and *pure logic* still carry complete code.

---

## File Structure

**New**
- `client/src/student-ui.ts` — shared student components (stat tile row reuse, status badge reuse, page header w/ breadcrumb, practice context panel, copyright footer, topic/LO row primitives).
- `client/src/views/student/shell.ts` — student sidebar/nav config + active-state resolver (mirrors `views/instructor/shell.ts`).
- `client/src/practice-actions.ts` — the mutable Skip/End-Session hand-off slot between `practice.ts` and the persistent shell (see Task 1 Step 3).

**Modified**
- `client/src/main.ts` — add `buildStudentShell`, route `bootstrap()`'s non-instructor branch to it.
- `client/src/views/home.ts` — student branch becomes the Figma-1 "My Courses" screen (currently already close; verify against the wireframe, move into the new shell's styling).
- `client/src/views/student/course-home.ts` — becomes the Figma-2 "Topic List" screen.
- `client/src/views/student/lo-list.ts` — Figma-3 "LO List".
- `client/src/views/student/practice.ts`, `client/src/views/student/practice-card.ts` — Figma-4/5/6/12 practice + feedback + retry + review-book re-practice.
- `client/src/practice-session.ts` — unchanged logic; consumed by the new sidebar context panel instead of in-card buttons.
- `client/src/views/student/review-book.ts` — Figma-11.
- `client/src/views/student/session-summary.ts` — Figma-7.
- `client/public/styles/main.css` — student shell (blue) + primitive styles.
- `tests/e2e/practice-loop.spec.ts` — update selectors only if markup changes break them; behavior assertions should survive unchanged.

---

### Task 1: Foundation — student shell + shared primitives + styles

**Files:**
- Create: `client/src/student-ui.ts`, `client/src/views/student/shell.ts`, `client/src/practice-actions.ts`
- Modify: `client/src/main.ts`, `client/public/styles/main.css`

**Wireframe:** all 9 screens share this shell — no single node-id; reference the sidebar/footer chrome visible in every screenshot (e.g. `148:2726`, `148:2901`).

**Interfaces — `student-ui.ts` (full code required):**

```ts
// client/src/student-ui.ts
// Shared student design-system primitives (Figma "Wireframe v0.2", student
// screens 1-12). Reuses instructor-ui.ts's statTile/pageHeader directly where
// the shape matches; this module adds only what's student-specific.
import { el } from './dom.js';
import { statTile, pageHeader } from './instructor-ui.js';

export { statTile, pageHeader };

/** The blue sidebar's practice-in-progress context card: current Topic/LO,
 * mastery status label, and a running "N answered · M correct" line. */
export function practiceContextPanel(
  topicName: string,
  loName: string,
  statusLabel: string,
  answered: number,
  correct: number,
): HTMLElement {
  return el(
    'div',
    { class: 'practice-context' },
    el('p', { class: 'practice-context__eyebrow', text: `TOPIC · ${topicName}` }),
    el('p', { class: 'practice-context__eyebrow', text: 'CURRENT LO' }),
    el('p', { class: 'practice-context__lo', text: loName }),
    el('p', { class: 'practice-context__status', text: statusLabel }),
    el('p', { class: 'practice-context__counts', text: `${answered} answered · ${correct} correct` }),
  );
}

/** The copyright/disclaimer footer required on every student screen (PRD §4.1). */
export function copyrightFooter(): HTMLElement {
  return el(
    'div',
    { class: 'copyright-footer' },
    el('p', { class: 'copyright-footer__line', text: '© FinanceBot · UBC Sauder.' }),
    el('p', {
      class: 'copyright-footer__line',
      text:
        'All FinanceBot materials are the intellectual property of the instructor. ' +
        'Unauthorized personal or commercial use is prohibited.',
    }),
  );
}

/** A breadcrumb trail, e.g. "Course Name › Topic Name › LO 3: Objective". */
export function breadcrumb(parts: string[]): HTMLElement {
  return el(
    'nav',
    { class: 'breadcrumb', 'aria-label': 'Breadcrumb' },
    ...parts.flatMap((part, i) => [
      i > 0 ? el('span', { class: 'breadcrumb__sep', 'aria-hidden': 'true', text: '›' }) : false,
      el('span', { class: 'breadcrumb__part', text: part }),
    ]),
  );
}

/** A Topic-list or LO-list row: index, title, status badge, meta line, primary action button. */
export function progressRow(
  index: number,
  title: string,
  meta: string | null,
  status: HTMLElement,
  action: { text: string; onClick: () => void; primary: boolean },
): HTMLElement {
  return el(
    'div',
    { class: 'progress-row' },
    el('span', { class: 'progress-row__index', text: String(index) }),
    el(
      'div',
      { class: 'progress-row__text' },
      el('p', { class: 'progress-row__title', text: title }),
      meta ? el('p', { class: 'progress-row__meta', text: meta }) : false,
    ),
    status,
    el(
      'button',
      {
        class: `btn btn--sm ${action.primary ? 'btn--instr-primary' : 'btn--ghost'}`,
        type: 'button',
        onclick: action.onClick,
      },
      action.text,
    ),
  );
}
```

**Interfaces — `views/student/shell.ts` (full code required):**

```ts
// client/src/views/student/shell.ts
// Student nav config for the blue shell (mirrors views/instructor/shell.ts).
export interface StudentNavItem {
  label: string;
  /** Path suffix appended to `/course/:id`, or a literal path for course-less items. */
  path: (courseId: string) => string;
  disabled?: boolean;
}

/** Static nav shown outside an active practice session. */
export const STUDENT_NAV: StudentNavItem[] = [
  { label: 'My Courses', path: () => '/' },
  { label: 'Review Book', path: (id) => `/course/${id}/review-book` },
  { label: 'Exam Prep', path: () => '#', disabled: true },
];

/** Extracts the courseId from a student path (`/course/:id...`), or undefined
 * when not inside a course (e.g. on `/`). */
export function courseIdFromPath(path: string): string | undefined {
  const match = /^\/course\/([^/]+)/.exec(path);
  return match ? match[1] : undefined;
}

/** True while `path` is a practice route (drives the sidebar's context-panel mode). */
export function isPracticePath(path: string): boolean {
  return /^\/course\/[^/]+\/practice(-theme)?\//.test(path);
}
```

**Interfaces — `practice-actions.ts` (full code required):**

```ts
// client/src/practice-actions.ts
// Hand-off slot between the currently-rendered practice view (practice.ts,
// re-created on every route change) and the persistent student shell
// (built once in main.ts, outside the router's render lifecycle). practice.ts
// calls setPracticeActions() on render and clearPracticeActions() on
// teardown/navigation-away; the shell calls getPracticeActions() on every
// onNavigate to decide whether to show the sidebar context panel.
export interface PracticeActions {
  topicName: string;
  loName: string;
  statusLabel: string;
  answered: number;
  correct: number;
  onSkip: () => void;
  endSessionHref: string;
}

let current: PracticeActions | null = null;

export function setPracticeActions(actions: PracticeActions): void {
  current = actions;
}

export function getPracticeActions(): PracticeActions | null {
  return current;
}

export function clearPracticeActions(): void {
  current = null;
}
```

**Steps:**
- [ ] **Step 1:** implement `student-ui.ts` per the interfaces above.
- [ ] **Step 2:** implement `views/student/shell.ts` per the interfaces above.
- [ ] **Step 3:** implement `practice-actions.ts` per the interfaces above.
- [ ] **Step 4:** in `main.ts`, add `buildStudentShell(root, session)` (copy `buildInstructorShell`'s structure: blue `sidebar--student` aside, `FinanceBot` brand, `STUDENT_NAV`-driven links when `!isPracticePath(currentPath)`, a `practiceContextPanel` slot rendered from `getPracticeActions()` when `isPracticePath(currentPath)` is true and it returns non-null). Change `bootstrap()`'s `else` branch from `buildShell(root, session)` to `buildStudentShell(root, session)` for every authenticated non-instructor session (per the design doc's explicit decision — no separate student-detection check needed).
- [ ] **Step 5:** add `main.css` styles: `.sidebar--student` (blue, e.g. `#3b5fd6`-ish per the screenshot — approximate, do not chase exact hex), `.practice-context*`, `.copyright-footer*`, `.breadcrumb*`, `.progress-row*`. Reuse `.stat-tile`, `.page-header`, `.status-badge`, `.btn--instr-primary` (rename/generalize to a role-neutral `.btn--primary-dark` if reused across both shells — implementer's call, keep both shells working either way).
- [ ] **Step 6:** `npm run typecheck && npm run lint && npm run build` → PASS.
- [ ] **Step 7:** Commit — `feat(client): student shell, shared primitives, and blue design-system styles`.

---

### Task 2: My Courses, Topic List, LO List (Figma 1, 2, 3)

**Files:** Modify `client/src/views/home.ts` (student branch), `client/src/views/student/course-home.ts`, `client/src/views/student/lo-list.ts`.
**Wireframes:** 1 `148:2726`, 2 `148:2777`, 3 `148:2834`. **Consumes (Task 1):** `progressRow`, `pageHeader`, `copyrightFooter`, `breadcrumb`, `statusBadge`/`masteryBadge` (existing `ui.ts`). **Consumes (existing api.ts):** `listEnrollments`, `enrollInCourse`, `getCourseHome`.

**Behaviors / acceptance:**
- **My Courses (`home.ts` student branch, Figma 1):** card grid of enrolled courses (name, code·term, Active/Ended badge, progress bar `N/M LOs covered`, "Open →"/"View" per active-vs-ended), a dashed-border "Enter registration code" + "Join" control below the cards (calls `enrollInCourse`, refreshes on success, surfaces `ApiError.message` inline), `copyrightFooter()` at the bottom. Keep the existing behavior (already close to this) — this task's job is matching the exact card/join-box layout and adding the footer.
- **Topic List (`course-home.ts`, Figma 2):** `pageHeader` with course name + `Course Code · Term Year · N/M LOs covered`; a "Topic Practice" section of `progressRow`s (index, topic name, `N/M LOs covered`, status badge Covered/In Progress/Not Started, primary action "Start →"/"Practice again"); topics with zero Approved questions stay fully absent from the list (existing Task 10 behavior — do not add a "locked" row). `copyrightFooter()`.
- **LO List (`lo-list.ts`, Figma 3):** `pageHeader` with topic name + `N/M LOs covered` + "Session Summary →" (ghost) + "Start Practice →" (primary, jumps to first uncovered LO) in the header action area; a lead line ("Select a LO to jump directly to practice, or click 'Start Practice'…"); `progressRow`s per LO (index, name, `Answered N questions · M correct` meta, status badge Covered/In Progress/Not Attempted/Struggling, "Practice →"/"Practice again"); the in-progress row shows a "▸ Continue here" sub-line (`progress-row__continue`, add a small CSS class + optional param on `progressRow` or a second element appended after it — implementer's call). `copyrightFooter()`.

**Steps:**
- [ ] **Step 1:** rebuild `home.ts`'s student branch against Figma 1.
- [ ] **Step 2:** rebuild `course-home.ts` against Figma 2.
- [ ] **Step 3:** rebuild `lo-list.ts` against Figma 3.
- [ ] **Step 4:** `npm run typecheck && npm run lint && npm run build` → PASS.
- [ ] **Step 5:** Commit — `feat(client): rebuild My Courses, Topic List, and LO List against wireframe v0.2`.

---

### Task 3: Practice + Feedback (Figma 4, 5, 6, 12)

**Files:** Modify `client/src/views/student/practice.ts`, `client/src/views/student/practice-card.ts`. Consumes `client/src/practice-actions.ts` (Task 1).
**Wireframes:** 4 `148:2901`, 5 `148:2967`, 6 `148:3015`, 12 `148:3456`. **Consumes (Task 1):** `breadcrumb`, `practiceContextPanel` (rendered by the shell, not this view — this task just ensures `practice.ts` exposes what the shell needs: current topic/LO name, status, answered/correct counts — expose via a small return value or a shared `practice-session.ts` getter, implementer's call, keep `practice-session.ts`'s existing public functions intact), `copyrightFooter`.

**Behaviors / acceptance — preserve exactly, layout only:**
- Option locking, Strategy-A retry-in-place with original explanations withheld until resolved, adaptive feedback reveal (never render more than the API response contains), skip-LO, transcript with "practice this LO more" links, end-session, submit-retry-on-error recovery — **all Task 14 logic is unchanged**; only DOM structure/CSS classes may change.
- **Header:** `breadcrumb(['Course Name', 'Topic Name', 'LO 3: Objective Name'])` + "Session Summary →" ghost button (top-right, always visible during practice, navigates to `/course/:id/summary`).
- **Transcript entries** (Figma 4): each prior Q gets a `Q{n}` label, the stem, and a collapsed one-line result — `"✓ You answered: Option B (Correct)"` for a correct answer, `"✕ You answered: Option A · Correct: Option C"` for a Strategy-B/full-reveal miss (only when the API response actually included the correct option — never infer it), or the existing narrower Strategy-A-miss summary when explanations are withheld. Keep the existing "practice this LO more" per-entry link.
- **Current question card** (Figma 4/5/6): `Q{n} — Multiple Choice` / `Q{n} — True/False` label above the stem; options as full-width rows with a lettered tile badge (existing `optionButton` from `ui.ts` — verify/adjust its CSS to match the wireframe's row treatment, keep its function signature); selected-pre-submit shows `(selected)` suffix text per Figma (add via existing `optionButton` state, no signature change needed — render the suffix text conditionally when `state === 'selected'`).
- **Below options:** existing Bookmark button, **plus a new disabled Flag button** (`<button class="btn btn--ghost btn--sm" disabled>🏳 Flag</button>` — no click handler, no backend call, per the Global Constraints out-of-scope list) to the left; Submit (primary) to the right — matches Figma's left-ghost/right-primary split.
- **Skip / End Session buttons move out of the card** — Task 1's shell renders them in the sidebar context panel. `practice.ts` keeps owning the actual `doSkip` logic and the `endSessionHref` computation; it now calls `setPracticeActions(...)` (Task 1's `practice-actions.ts`) instead of rendering `<button>`s for them directly, and `clearPracticeActions()` on teardown/navigation-away so a non-practice screen never shows a stale context panel.
- `copyrightFooter()` at the bottom of the practice view.
- Review-book re-practice (Figma 12, `mode=review-book`) reuses this same view/card — no separate file; verify it still resolves to the stored question via the existing query-param flow.

**Steps:**
- [ ] **Step 1:** add the breadcrumb + Session-Summary-link header to `practice.ts`.
- [ ] **Step 2:** move Skip/End-Session out of the card into the shell's context panel (Task 1); wire the shared state.
- [ ] **Step 3:** rebuild the transcript entries' layout (Q-numbering, collapsed result line) in `practice.ts`.
- [ ] **Step 4:** rebuild the current-question card layout (row-style options, Q-label, selected suffix) plus the disabled Flag button in `practice-card.ts`.
- [ ] **Step 5:** add `copyrightFooter()`.
- [ ] **Step 6:** manually verify (or via a quick e2e run) that Strategy-A retry-in-place and the no-leak reveal behavior are visually unchanged — walk one correct and one Strategy-A-miss attempt.
- [ ] **Step 7:** `npm run typecheck && npm run lint && npm run build` → PASS.
- [ ] **Step 8:** Commit — `feat(client): rebuild practice view and feedback layout against wireframe v0.2`.

---

### Task 4: Review Book + Session Summary (Figma 7, 11)

**Files:** Modify `client/src/views/student/review-book.ts`, `client/src/views/student/session-summary.ts`.
**Wireframes:** 7 `148:3066`, 11 `148:3388`. **Consumes (Task 1):** `statTile`, `pageHeader`, `copyrightFooter`, `breadcrumb`. **Consumes (existing api.ts):** `getReviewBook`, `bookmarkQuestion`/`unbookmarkQuestion`, `getSessionSummary`, `deferSessionSummary`.

**Behaviors / acceptance:**
- **Review Book (Figma 11):** top-right sort control (existing `theme`/`date` sorts only, per Task 12's slip guidance — do not add UI for sorts the backend doesn't implement); topic-group header row (topic name, `N questions`, "Topic Practice →" and "Practice All →" — both navigate into the existing practice routes, no new backend calls) with a light background; per-LO `progressRow`-style rows (name, `N auto-collected · M bookmarked` meta, question count badge, "Review" ghost + "Practice again" primary buttons); expand caret reveals individual entries (stem excerpt via `renderRichText`, source label Auto-collected/Bookmarked, heart icon for bookmark toggle — existing `toggleBookmark` behavior, do not change semantics). Empty state unchanged. `copyrightFooter()`.
- **Session Summary (Figma 7):** `pageHeader` with `Topic/Chapter Name · Session ended` subtitle; a `statTile` row (LOs Covered, Questions Answered, Correct Answers, Accuracy, Review Book Added — five tiles, reuse `statTile` from Task 1/`instructor-ui.ts`); "Topics This Session" accordion (topic header with `N LOs · X/Y correct · Covered/In Progress` summary, expand to per-LO rows with a right-aligned `X / Y correct` in green); "Missed Questions — Added to Review Book" list (stem excerpt + "Review →" per row, linking into Review Book); a muted "Recommended next steps:" banner (derive the sentence from the summary data already returned — e.g. next uncovered LO, missed count, whether all topics are covered enough to suggest Exam Prep — keep it simple, client-derived, no new endpoint); three actions **Continue Practice** (primary, back into practice), **Go to Review Book** (ghost), **Back to Course** (ghost) — plus the existing **Defer to next session** action from Task 14 (ST-P10), kept as a fourth, visually secondary control (e.g. a text link below the three buttons) since it's a distinct "end without continuing" action not in the wireframe's three-button row. `copyrightFooter()`.

**Steps:**
- [ ] **Step 1:** rebuild `review-book.ts` against Figma 11 (topic grouping, per-LO rows, expand, Topic Practice/Practice All entry points).
- [ ] **Step 2:** rebuild `session-summary.ts` against Figma 7 (stat tiles, topics accordion, missed list, recommended-next-steps banner, three actions + kept Defer action).
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run build` → PASS.
- [ ] **Step 4:** Commit — `feat(client): rebuild Review Book and Session Summary against wireframe v0.2`.

---

### Task 5: e2e verification pass

**Files:** Modify `tests/e2e/practice-loop.spec.ts` only if a selector it relies on no longer matches the rebuilt markup (the spec asserts behavior — "sees feedback", "finds it in the Review Book" — via text/role queries, which should mostly survive; fix only what actually breaks).

**Steps:**
- [ ] **Step 1:** run `npm run test:e2e -- tests/e2e/practice-loop.spec.ts` against the local stack (Mongo/SAML-IdP up, per `PHASE-1-UI-HANDOFF.md`'s setup steps, using a student test user).
- [ ] **Step 2:** fix any selector breakage; re-run until green. Do not weaken an assertion to make it pass — if a genuine behavior regressed, fix the view, not the test.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run build` → PASS.
- [ ] **Step 4:** Commit — `test(e2e): confirm practice-loop spec against rebuilt student UI`.

---

## Self-Review

**Spec coverage** (design doc section → task): Shell + `student-ui.ts` primitives + CSS tokens → Task 1. My Courses/Topic List/LO List (screens 1/2/3) → Task 2. Practice + Feedback (screens 4/5/6/12) → Task 3. Review Book + Session Summary (screens 7/11) → Task 4. e2e verification → Task 5. Out-of-scope list (S* screens, Flag backend, Locked-topic state, Exam Prep) → called out in Global Constraints and in each task's acceptance criteria as "disabled/absent", not silently dropped.

**Placeholder scan:** view bodies are intentionally spec-by-behavior (see the authoring note, same posture as the approved Task-15 plan); all shared *interfaces* (`student-ui.ts`, `shell.ts`) carry complete code. No "TBD"/"add error handling"-style gaps — every ambiguous implementation choice explicitly says "implementer's call" with the constraint that must still hold (e.g. "keep both shells working either way").

**Type consistency:** `student-ui.ts` re-exports `statTile`/`pageHeader` from `instructor-ui.ts` rather than redefining them — Task 2/4 consume the same signatures Task 1/instructor code already established. `progressRow`'s `action.primary: boolean` maps consistently to `.btn--instr-primary`/`.btn--ghost` across Tasks 2/4. `courseIdFromPath`/`isPracticePath` (Task 1) are the only new pure logic; both are simple regex functions — no test file was added for them in the plan above because they're one-line pattern matches consumed immediately in Task 1's own `main.ts` wiring and exercised end-to-end by Task 5's e2e run, consistent with the "no unit-test harness for view-layer code" constraint. If the implementer judges a unit test worth adding for these two, that's an allowed, not required, addition.

**Open item flagged for review, not blocking:** the design doc leaves the course-switcher dropdown's exact interaction and the Defer-action's exact placement on Session Summary as implementer-time decisions (both called out explicitly in Tasks A and D above) — raise the chosen behavior at task review rather than treating either as pre-decided.
