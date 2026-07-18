# Task 15 — Instructor Client Views (wireframe-driven) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase-1 instructor UI (course setup, materials, question bank, question review/editor, review queue, pre-seeding + generation) as a plain-TypeScript client that *roughly* follows the Figma "Wireframe v0.2" instructor screens, on top of the already-merged Task 2/5/6/7/8 endpoints.

**Architecture:** Extends the existing `client/src` app (typed `api.ts` per-endpoint, `renderX(root)` views, `matchRoute`/`startRouter` param router, `dom.ts` `el`/`mount`). Adds an **instructor shell variant** (green sidebar, grouped nav) and a small **shared component vocabulary** (stat tile, status badge, checklist row, filter tabs, upload zone, data table) so the six instructor views stay visually consistent without a framework. No new runtime deps.

**Tech Stack:** TypeScript (strict) compiled by `tsc` to ES modules; hand-rolled DOM via `dom.ts`; `renderRichText` (KaTeX+marked+DOMPurify) for stems/explanations; Playwright for e2e. Server endpoints are fixed — this is client-only plus e2e.

## Global Constraints

- **Follow the wireframe *roughly*** — match layout, structure, and the green/white language; do not chase pixel-perfect spacing or exact design tokens. Reference: `docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md` (screen → Figma node-id map). Pull a screen live with `get_screenshot` when building its view.
- **No new npm dependencies.** Vanilla TS + existing utilities only.
- **Client imports use the `.js` extension** (browser loads compiled output as native ESM — see `client/AGENTS.md`).
- **Every view is a `export function renderX(root: HTMLElement): void`** built with `el`/`mount` from `dom.ts`; no innerHTML string templating for dynamic/user data (XSS). Use `renderRichText` for question stems/explanations.
- **All server calls go through a typed function in `client/src/api.ts`** — views never call `fetch` or build URLs directly.
- **Instructor-only.** Views assume the user holds an instructor `courseRole`; the shell shows the instructor chrome when `user.courseRoles` contains a role of `instructor` (or `user.isAdmin`).
- **Contract is fixed.** Consume endpoints exactly as in `docs/api-contract.md`. If a view needs data no endpoint provides, derive it client-side (e.g. duplicate-name warning from the course tree) — do **not** add or change a server endpoint in this task.
- **Out-of-scope nav** (Analytics, TAs, Co-instructors, Import) renders as **visible-but-inactive** items so the shell matches the wireframe; their destinations are later phases.
- **Verification per task:** `npm run typecheck && npm run lint && npm run build` all clean. Client has no unit-test harness today; correctness is typecheck+lint+build plus the Task H Playwright spec. Where a step adds pure logic (router patterns, the duplicate-name deriver, the role-label map), add a `tests/unit/*.test.ts` for that pure function.

---

## Plan-authoring note (deviation from writing-plans "full code in every step")

These are **design-driven view** tasks: each view is built live against its Figma frame + the real API, in the established `el`/`mount` style. Transcribing every DOM node into the plan would be enormous and stale the moment spacing shifts. So this plan gives, per task: exact **files**, exact **interfaces** (full code for `api.ts` signatures and shared `ui` primitives — the things other tasks depend on), the **wireframe node-id**, and concrete **behaviors + acceptance criteria**. View bodies are specified by structure/behavior, not transcribed node-by-node. Shared *interfaces* and *pure logic* still carry complete code and tests.

---

## File Structure

**New**
- `client/src/views/instructor/shell.ts` — instructor sidebar/nav config + active-state (consumed by `main.ts`).
- `client/src/instructor-ui.ts` — shared instructor components (stat tile, status badge, checklist row, filter tabs, upload zone, data-table row, role-label map, select).
- `client/src/views/instructor/courses.ts` — My Courses (N1) + Create Course (N2).
- `client/src/views/instructor/dashboard.ts` — Course Dashboard (I1).
- `client/src/views/instructor/structure.ts` — Topic/LO Structure editor (I2).
- `client/src/views/instructor/settings.ts` — Course Settings + roster + registration code (I4).
- `client/src/views/instructor/materials.ts` — Materials upload/assign/classify (I3).
- `client/src/views/instructor/bank.ts` — Question Bank browser (I7).
- `client/src/views/instructor/question-detail.ts` — Question review/editor + agent report (I6).
- `client/src/views/instructor/review-queue.ts` — Review Queue (I5).
- `client/src/views/instructor/preseeding.ts` — Pre-seeding coverage + generate (N9 + I12 modal).
- `tests/unit/instructor-role-label.test.ts`, `tests/unit/duplicate-name.test.ts` — pure-logic units.
- `tests/e2e/instructor-pipeline.spec.ts` — Playwright walkthrough.

**Modified**
- `client/src/api.ts` — add the instructor endpoint client functions (Tasks A/D/E/F/G add their slices).
- `client/src/main.ts` — instructor route table + shell selection.
- `client/src/config.ts` — instructor NAV group data (or delegate to `shell.ts`).
- `client/src/views/home.ts` — instructor branch → redirect/render My Courses.
- `client/public/styles/main.css` — instructor shell + component styles.

---

### Task A: Foundation — API client, design-system primitives, instructor shell + routing

**Files:**
- Modify: `client/src/api.ts` (add types + functions below)
- Create: `client/src/instructor-ui.ts`, `client/src/views/instructor/shell.ts`
- Modify: `client/src/main.ts` (instructor route table + shell), `client/src/config.ts`, `client/public/styles/main.css`
- Test: `tests/unit/instructor-role-label.test.ts`

**Interfaces — `api.ts` additions (exact signatures; implement each as a `request<T>` call):**

```ts
// --- Instructor: courses & hierarchy (IN-S01/S02/S03, IN-L06) ---------------
export interface InstructorCourse {
  courseId: string; name: string; courseCode: string; term: string;
  published: boolean; termStart?: string; termEnd?: string; registrationCode?: string;
}
export interface CourseTreeLo { _id: string; name: string; order: number; themeId: string; }
export interface CourseTreeTheme { _id: string; name: string; order: number; availableFrom?: string; los: CourseTreeLo[]; }
export interface CourseTree { course: InstructorCourse; themes: CourseTreeTheme[]; }
export interface ChecklistItem { item: string; ok: boolean; }

export function listInstructorCourses(): Promise<InstructorCourse[]>;                  // GET /api/courses
export function createCourse(input: { name: string; courseCode: string; term: string }): Promise<InstructorCourse>; // POST /api/courses
export function getCourseTree(courseId: string): Promise<CourseTree>;                  // GET /api/courses/:id
export function updateCourse(courseId: string, patch: { termStart?: string; termEnd?: string; feedbackStrategy?: string; autoPause?: boolean; published?: boolean }): Promise<InstructorCourse>; // PATCH /api/courses/:id
export function regenerateRegistrationCode(courseId: string): Promise<{ registrationCode: string }>; // POST /api/courses/:id/registration-code
export function getPublishChecklist(courseId: string): Promise<ChecklistItem[]>;       // GET /api/courses/:id/publish-checklist (confirm path in api-contract)
export function addTheme(courseId: string, name: string): Promise<CourseTreeTheme>;    // POST /api/courses/:id/themes
export function updateTheme(themeId: string, patch: { name?: string; availableFrom?: string; order?: number }): Promise<CourseTreeTheme>; // PATCH /api/themes/:id
export function archiveTheme(themeId: string): Promise<void>;                          // POST /api/themes/:id/archive
export function addLo(themeId: string, name: string): Promise<CourseTreeLo>;           // POST /api/themes/:id/los
export function updateLo(loId: string, patch: { name?: string; order?: number }): Promise<CourseTreeLo>; // PATCH /api/los/:id
export function archiveLo(loId: string): Promise<void>;                                // POST /api/los/:id/archive
export function getRoster(courseId: string): Promise<Array<{ identifier: string; extendedUntil?: string; addedAt: string }>>; // GET /api/courses/:id/roster
export function putRoster(courseId: string, identifiers: string[]): Promise<{ count: number }>; // PUT /api/courses/:id/roster
```

Verify every path/verb against `docs/api-contract.md` and the server routes before writing — the signatures above are the contract as of Tasks 2/5; correct any drift and note it in the report.

**Interfaces — `instructor-ui.ts` (shared primitives, full code required):**

```ts
import { el } from './dom.js';
// A big-number stat tile (I1/I2/N9). value can be number|string; tone colors the number.
export function statTile(value: string | number, label: string, tone?: 'default' | 'good' | 'warn' | 'bad'): HTMLElement;
// Pill badge. variant maps to a CSS modifier: question status, agent decision, coverage.
export type BadgeVariant = 'approved'|'pending'|'reviewed'|'draft'|'paused'|'archived'|'pass'|'flag'|'reject'|'at-target'|'below-target'|'empty'|'neutral';
export function statusBadge(text: string, variant: BadgeVariant): HTMLElement;
// Pre-publish checklist row: ok ✓ / ○, label, optional inline action link.
export function checklistRow(label: string, ok: boolean, action?: { text: string; onClick: () => void }): HTMLElement;
// Filter tab strip; returns the container. active by index; onSelect(index).
export function filterTabs(tabs: string[], activeIndex: number, onSelect: (i: number) => void): HTMLElement;
// Drag-drop + browse upload zone; calls onFiles with a FileList-like array.
export function uploadZone(hint: string, onFiles: (files: File[]) => void): HTMLElement;
// Instructor page header: title, sub-line, optional primary action button (dark).
export function pageHeader(title: string, subtitle: string, action?: { text: string; onClick: () => void }): HTMLElement;
// Internal OptionRole -> wireframe display label (I6). See wireframe-reference.md.
export const ROLE_LABEL: Record<'correct'|'common-misconception'|'partially-correct'|'clearly-wrong', string>;
```

**Steps:**
- [ ] **Step 1 (test-first, pure logic):** write `tests/unit/instructor-role-label.test.ts` asserting `ROLE_LABEL` maps the four roles to `Correct Answer` / `Good Confounder` / `Related but Incorrect` / `Easy to Eliminate`. Run → FAIL.
- [ ] **Step 2:** implement `ROLE_LABEL` + the primitives in `instructor-ui.ts`. Run the test → PASS.
- [ ] **Step 3:** add the `api.ts` functions above (verify each against the contract).
- [ ] **Step 4:** build `views/instructor/shell.ts` (nav group data + active resolver) and wire `main.ts` to render the **instructor shell** when the user has an instructor role, registering the instructor routes: `#/instructor/courses`, `#/instructor/course/:id` (dashboard), `/structure`, `/materials`, `/settings`, `/bank`, `/bank/:questionId`, `/queue`, `/preseeding`. Out-of-scope nav items render disabled.
- [ ] **Step 5:** add instructor shell + primitive styles to `main.css` (green sidebar, INSTRUCTOR pill, stat tile, badge, checklist row, tabs, upload zone). Approximate palette from `wireframe-reference.md`.
- [ ] **Step 6:** `npm run typecheck && npm run lint && npm run build` → PASS.
- [ ] **Step 7:** Commit — `feat(client): instructor shell, design-system primitives, and instructor API client`.

---

### Task B: My Courses + Create Course (N1, N2)

**Files:** Create `client/src/views/instructor/courses.ts`; Modify `client/src/views/home.ts` (instructor branch → My Courses). Test: `tests/unit/duplicate-name.test.ts`.
**Wireframe:** N1 `194:2`, N2 `198:2`. **Consumes:** `listInstructorCourses`, `createCourse` (Task A).

**Behaviors / acceptance:**
- My Courses: card/list of the instructor's courses (name, code, term, published/sandbox badge) + "＋ Create Course". Empty state when none. Clicking a course → `#/instructor/course/:id`.
- Create Course: form (name*, code*, term*), dark "Create course" + "Cancel". On submit → `createCourse` → navigate to the new course dashboard. Surface `ApiError.message` inline.
- **Duplicate-term warning (client-derived, non-blocking):** as the user types code+term, if an existing course in `listInstructorCourses()` matches (case-insensitive code + same term), show the amber callout from N2 ("A course with code X for term Y already exists") with "Go to existing" (navigate) — never blocks submit. Put the pure matcher in a tested helper `findDuplicateCourse(courses, code, term)`.

**Steps:**
- [ ] Step 1: `tests/unit/duplicate-name.test.ts` for `findDuplicateCourse` (match ignoring case/whitespace; no match; empty list) → FAIL.
- [ ] Step 2: implement `findDuplicateCourse` → PASS.
- [ ] Step 3: build My Courses + Create Course views against N1/N2; wire `home.ts` instructor branch.
- [ ] Step 4: typecheck + lint + build → PASS.
- [ ] Step 5: Commit — `feat(client): instructor My Courses and Create Course with duplicate-term warning`.

---

### Task C: Course Dashboard + Structure + Settings (I1, I2, I4)

**Files:** Create `dashboard.ts`, `structure.ts`, `settings.ts`. **Wireframes:** I1 `148:3516`, I2 `148:3582`, I4 `148:3721`.
**Consumes:** `getCourseTree`, `getPublishChecklist`, `updateCourse`, `regenerateRegistrationCode`, `addTheme/updateTheme/archiveTheme`, `addLo/updateLo/archiveLo`, `getRoster/putRoster`, `statTile/checklistRow/pageHeader/statusBadge`.

**Behaviors / acceptance:**
- **Dashboard (I1):** header with `Course Code · Term · Sandbox/Published`; dark **Publish Course →** (calls `updateCourse({published:true})`, refreshes); stat-tile row (Topics, LOs, Approved, Draft/Pending, Flags — derive counts from the tree + bank where available, else omit a tile rather than fake it); **Pre-publish Checklist** from `getPublishChecklist` rendered with `checklistRow`, inline actions ("Generate code →" → `regenerateRegistrationCode`; "Review queue →" → navigate); Quick-Action cards linking to structure/materials/queue.
- **Structure (I2):** two-pane — left tree (`+ Add Topic`; topics with LO counts, expandable; `+ Add LO`) ; right detail for the selected LO/Theme (name field, description, **Assigned Course Materials** list with Remove + "＋ Assign material", questions-in-bank stat tiles, `Rename`/`Archive`, **Save Changes**). **Duplicate-name inline warning (non-blocking)** on add-theme/add-LO derived from the current tree. `Merge/Split` render as inactive (out of scope, N4). Approve/save updates the pane without a full reload.
- **Settings (I4):** term start/end, feedback strategy, auto-pause → `updateCourse`; registration code display + regenerate; roster textarea (one identifier/line) → `putRoster`, showing `extendedUntil` where present.

**Steps:**
- [ ] Step 1: Dashboard against I1 (checklist, tiles, publish, quick actions).
- [ ] Step 2: Structure against I2 (tree + detail editor + duplicate-name warning + material assign/remove).
- [ ] Step 3: Settings against I4 (course fields, registration code, roster).
- [ ] Step 4: typecheck + lint + build → PASS.
- [ ] Step 5: Commit — `feat(client): instructor course dashboard, structure editor, and settings`.

---

### Task D: Materials (I3)

**Files:** Create `materials.ts`; Modify `api.ts` (materials slice). **Wireframe:** I3 `148:3664`.
**`api.ts` additions:** `listMaterials(courseId)`, `uploadMaterials(courseId, files: File[])` (multipart `files[]`), `addUrlMaterial(courseId, url)`, `retryMaterial(materialId)`, `assignMaterial(materialId, assignments)`, `resolveClassification(materialId, 'accept'|'reject')`, `getSuggestedHierarchy(courseId)`. Types mirror `Material` (status, format, `assignments`, `classificationSuggestion`, `excerpt`).

**Behaviors / acceptance:**
- Upload zone (drag-drop + Browse) accepting multiple files **and** a URL field; POSTs then refreshes the list.
- Uploaded-materials list: status dot (Ready/Processing/Failed), name, uploaded date, assignment summary (Topic/LO or "Unassigned"), auto-classified badge (`classificationSuggestion.confidence` → High ≥0.8 / Medium ≥0.5, else "No match"); **Assign →** opens Topic/LO picker → `assignMaterial`; accept/reject the classification suggestion → `resolveClassification`.
- **Poll `listMaterials` every 3s while any material `status === 'processing'`;** stop when none are. Clear the interval on view teardown/navigation.
- Unassigned banner ("N material(s) unassigned…") when any ready material has no assignments. Failed material shows Retry → `retryMaterial`.

**Steps:**
- [ ] Step 1: add the materials `api.ts` functions (verify vs contract).
- [ ] Step 2: build the view against I3 (upload, list, badges, assign, accept/reject, 3s polling with teardown, unassigned banner).
- [ ] Step 3: typecheck + lint + build → PASS.
- [ ] Step 4: Commit — `feat(client): instructor materials upload, classification, and assignment view`.

---

### Task E: Question Bank browser + Question Detail/Editor (I7, I6)

**Files:** Create `bank.ts`, `question-detail.ts`; Modify `api.ts` (questions slice). **Wireframes:** I7 `148:3962`, I6 `148:3897`.
**`api.ts` additions:** `browseBank(courseId, filters)` → `{ total, questions: [{ id, state, labels, loIds, themeIds, current: QuestionVersion }] }`; `getQuestion(questionId)` → full head + `current` version + `agentDecision` + `versions`; `editQuestion(questionId, patch)`; `transitionQuestion(questionId, to)`; `bulkTransition(questionIds, to)`. **Serialization note:** question heads come back as `id`; embedded `current` versions carry a raw `_id`. `includeArchived` is reachable only via `state=archived`.

**Behaviors / acceptance:**
- **Bank (I7):** count summary line; filters (search stem, Topic, LO, Type, Status) → `browseBank`; table (stem via `renderRichText`, type, Topic/LO, difficulty, status badge, Edit/Archive); **+ Generate Question** (→ preseeding/generate, Task G) and inactive Import; "Source changed" labels where present in `labels`.
- **Detail/Editor (I6):** meta row (type · state · difficulty select), Topics&LOs chips, stem editor, four **role-labeled** option editors using `ROLE_LABEL`, per-option explanation; **AI Agent Report** panel from `agentDecision` (Reviewer decision+reasoning; Structure Validator role checklist from `roleAssessment`); **Approve/Reject** → `transitionQuestion`; **Regenerate** inactive (N8). **Edited-field highlighting:** compare current editor values to the loaded version; add an `.edited` class to changed fields. Save → `editQuestion` (creates a version); approve moves state and reflects immediately without a full reload.

**Steps:**
- [ ] Step 1: add the questions `api.ts` functions (verify vs contract; encode the id/_id serialization note as types).
- [ ] Step 2: build Bank browser against I7 (filters, table, counts, entry points).
- [ ] Step 3: build Detail/editor against I6 (role-labeled options, agent report, edited highlighting, approve/reject, save).
- [ ] Step 4: typecheck + lint + build → PASS.
- [ ] Step 5: Commit — `feat(client): instructor question bank browser and review/editor with agent report`.

---

### Task F: Review Queue (I5)

**Files:** Create `review-queue.ts`. **Wireframe:** I5 `148:3779`. **Consumes:** `browseBank`/a review-queue endpoint, `transitionQuestion`, `bulkTransition`, `filterTabs`, `statusBadge`.
**`api.ts`:** `getReviewQueue(courseId)` → prioritized list (IN-Q02) if the endpoint exists; else derive ordering client-side from `browseBank` per the wireframe's stated priority. Confirm against `docs/api-contract.md`.

**Behaviors / acceptance:**
- Header with the priority sentence ("flagged first, then high-error pre-approved, then under-covered LOs").
- Filter tabs: All / Flagged by student / Agent: Flag / Agent: Reject / Agent: Pass (counts). Sort control.
- Rows: checkbox, stem, Type/LO, agent-decision badge, status, flag indicators (student-flagged count, high-error, under-covered), **Review →** (→ `#/instructor/course/:id/bank/:questionId`) and inline **Approve** (`transitionQuestion`, row updates immediately).
- **Bulk Approve:** select rows → confirm() with the count → `bulkTransition(ids, 'approved')`; refresh.

**Steps:**
- [ ] Step 1: add/confirm the review-queue `api.ts` function.
- [ ] Step 2: build the queue against I5 (tabs, rows, inline approve, bulk approve with confirm).
- [ ] Step 3: typecheck + lint + build → PASS.
- [ ] Step 4: Commit — `feat(client): instructor review queue with agent-decision filters and bulk approve`.

---

### Task G: Pre-seeding coverage + Generation (N9, I12)

**Files:** Create `preseeding.ts`; Modify `api.ts` (generation slice). **Wireframes:** N9 `283:68`, I12 `148:5283`.
**`api.ts` additions:** `getPreseeding(courseId)` → `[{ loId, loName, approved, reviewed, target }]`; `generateQuestions(courseId, { loId, count?, type?, difficulty?, prompt? })` → `202 { jobId }`.

**Behaviors / acceptance:**
- Coverage summary tiles (at target / below / empty) + per-LO table (LO, Topic, Approved count, Target, status badge At Target/Below Target/Empty). **Highlight LOs below 3** per Task 8's rule (display `target` from the API; threshold-highlight below 3).
- **Generate:** per-row "Generate Questions →" and a header "Generate for All Thin LOs"; the **Custom Prompt Generation** modal (I12) collects count/type/difficulty/optional prompt → `generateQuestions` → toast "queued" (202). After enqueue, note results land as Drafts in the bank/queue (async) — do not block the UI waiting.

**Steps:**
- [ ] Step 1: add the generation/preseeding `api.ts` functions (verify vs contract).
- [ ] Step 2: build the coverage view + generate modal against N9/I12.
- [ ] Step 3: typecheck + lint + build → PASS.
- [ ] Step 4: Commit — `feat(client): instructor pre-seeding coverage and question generation`.

---

### Task H: Playwright e2e — instructor pipeline

**Files:** Create `tests/e2e/instructor-pipeline.spec.ts`. Follow the existing `tests/e2e/*.spec.ts` harness (login helper, base URL).

**Behavior:** create course → add theme + LO → upload a fixture material → (guard `test.skip(!process.env.LLM_AVAILABLE)`) generate for the LO → approve a question → publish course. Assert each step's visible outcome (row appears, badge flips, publish state changes). Steps that need a live LLM are skipped when `LLM_AVAILABLE` is unset; the create→structure→materials→approve(seed)→publish path runs without an LLM by seeding an Approved question via the Task-4 service path the other e2e specs already use.

**Steps:**
- [ ] Step 1: write the spec mirroring the existing e2e login/setup helpers.
- [ ] Step 2: run `npm run test:e2e` if the stack is up locally; otherwise typecheck the spec and record that the live run is deferred to the ~Aug 2 joint checkpoint (same posture as Tasks 6/7/8 live steps).
- [ ] Step 3: Commit — `test(e2e): instructor pipeline walkthrough (create→materials→approve→publish)`.

---

## Self-Review

**Spec coverage** (Task-15 requirement IDs → task): IN-L06 course create/hierarchy → B, C. IN-S01 hierarchy → C. IN-S02 roster/extensions → C. IN-S03 publish/checklist → C. IN-S04 materials upload/ingest status → D. IN-S05 material assignment → D. IN-S06 classification accept/reject + suggested hierarchy → D. IN-Q02 review queue → F. IN-Q03/Q04 edit/version + transitions → E. IN-Q05 agent report + role assessment → E. IN-Q08 bank browse/filter → E. IN-Q10 generation + pre-seeding → G. Shell/routing/design-system underpin all → A.

**Placeholder scan:** view bodies are intentionally spec-by-behavior (see the authoring note); all *interfaces* (api signatures, ui primitives) and *pure logic* (role map, duplicate matcher) carry complete code/tests. No "TBD"/"add error handling"-style gaps.

**Type consistency:** `getCourseTree`→`CourseTree` used by C/D/E; `browseBank` shape (`id` heads, `current._id`) consumed consistently by E/F; `getPreseeding` shape matches the Task-8 server return (`loName`, `target`). `ROLE_LABEL` keys are the four `OptionRole`s used in E.

**Open item flagged for review, not blocking:** N9 shows a `Target` column of 3 while the Task-8 API returns `target: 5` and the rule is "highlight below 3". Resolution baked into Task G: display the API `target`, threshold-highlight below 3. If the wireframe's literal "3" is preferred as the displayed target, that's a one-line change — raise at task review.
