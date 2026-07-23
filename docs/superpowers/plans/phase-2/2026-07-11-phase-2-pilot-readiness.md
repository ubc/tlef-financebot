# Phase 2 — Pilot Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Progress tracking (do this, it is not automatic):** the superpowers execution skills track progress in an ephemeral todo list and a git-ignored local ledger — neither of which is visible to the other developer. This plan file is the shared source of truth. So, **the moment a task's review comes back clean and its commit is made, edit this file to change that task's `- [ ]` to `- [x]`, then commit the checkbox change** (e.g. `git commit -am "docs(plan): mark <phase> task N done"`) and push. Keep the checkboxes honest against `git log` — the other developer's agent trusts them to know what is already done. Run `npm run sync-plans -- <YourName>` after so the update propagates.

**Goal:** The pilot's safety and content-supply features: students flag bad questions; auto-pause pulls suspect questions; instructors get tiered in-app notifications and resolve flags; existing content bulk-loads via import and parameterized-script migration; parameterized questions execute in a sandbox with serve-time randomization.

**Architecture:** Builds directly on Phase 1's services and the Phase 0 domain types. New services: flags, notifications, imports, param-execution (worker_threads sandbox). The Phase 1 `attempts`/`serving` services gain parameterized-value randomization and the redirect surface. Client work extends existing views.

**Tech Stack:** as Phase 1, plus `csv-parse` (CSV import) and `fast-xml-parser` (QTI import).

## Global Constraints

- Everything in the Phase 0 and Phase 1 plans' Global Constraints still applies.
- Flags attach to a specific `questionVersionId`, never just the Question (PRD §6.2).
- Auto-pause: `(attempts ≥ course.autoPause.minAttempts AND flag% ≥ course.autoPause.flagPercent) OR (flagCount ≥ course.autoPause.flagCount)` — both instructor-configurable (PRD §4.3; defaults 5 / 30 / 15).
- Every flag resolution requires instructor sign-off; resolutions are `correct | archive | clear` (PRD §4.3).
- Notifications are in-app only, delivered by client polling; three tiers: standard, elevated (auto-pause), daily batched summary sent **only** when there was activity (PRD §4.3).
- `generate()` scripts run in `worker_threads` with `env.paramWorkerTimeoutMs` / `env.paramWorkerMemoryMb` limits, no network, no filesystem writes, seeded randomization (PRD §2). **Do not slip flagging, auto-pause, or the worker sandbox** (phase doc).
- Correctness-affecting flag resolutions use a **manual remediation checklist** for the pilot; automation is on the slip list (§6.2).

---

### P2-0 foundation: durable content runs + live progress

**Owner:** Stephen (explicit cross-owner takeover)

**Integration reviewer:** Saurav (asynchronous, non-blocking)

**Status:** code-complete on `codex/phase-2-content-runs`; do not mark merged until its PR lands

Stephen's Task 16 exploration showed that material ingestion and question
generation could remain visually stuck or lose all request identity after a
reload. Phase 2 therefore starts with a small shared foundation before the
numbered pilot tasks: Mongo `contentRuns` is the durable source of truth,
Agenda jobs carry only `{ runId }`, and one course-scoped SSE stream delivers
persisted updates to instructor views.

**Interfaces:**

- Produces the `ContentRun` discriminated union, `contentRunsCol()` and indexes,
  compare-and-set status/stage updates, bounded event history, and startup
  reconciliation for interrupted/missing jobs.
- Produces guarded list/snapshot/SSE routes under
  `/api/courses/:courseId/content-runs`, `Material.activeRunId`, and the unique
  `202 { runId }` response for question generation.
- Material ingestion and Phase 1 pre-seeding generation now use this foundation;
  future Phase 2 work must extend it rather than introduce a second polling,
  job-history, or workflow state model.
- Full contract and rationale:
  [`Stephen/2026-07-22-p2-0-content-run-contract-proposal.md`](./Stephen/2026-07-22-p2-0-content-run-contract-proposal.md).

- [ ] **Merge checkpoint:** implementation, automated tests, docs, and live
  reload/reconnect smoke are complete and the P2-0 PR is merged.

---

### Task 1: Flag service — student flagging + flag state machine (ST-P09, §6.2)

**Files:**
- Create: `server/src/services/flags.service.ts`
- Create: `server/src/routes/flags.routes.ts`
- Modify: `server/src/app.ts`
- Test: `tests/unit/flags.service.test.ts`

**Interfaces:**
- Consumes: `flagsCol()`, `questionsCol()`, `attemptsCol()`, `coursesCol()`, `auditCol()`; `transitionQuestion` (Phase 1 Task 4); notifications service (Task 3 — inject via a callback parameter until Task 3 lands, then wire directly).
- Produces:
  - `flagQuestion(input: { puid: string; questionId: ObjectId; reason?: string }): Promise<{ flagged: true; duplicate: boolean }>` — resolves the question's `currentVersionId` and attaches the flag to it; **idempotent per (puid, questionVersionId)**: re-flagging returns `duplicate: true` with no new record (ST-P09); adds the `'student-flagged'` label to the question; non-blocking (never changes the question's state by itself).
  - `FLAG_TRANSITIONS: Record<FlagState, FlagState[]>` = `{ open: ['escalated','resolved-corrected','resolved-archived','resolved-cleared'], escalated: ['resolved-corrected','resolved-archived','resolved-cleared'], 'resolved-corrected': [], 'resolved-archived': [], 'resolved-cleared': [] }` + `canFlagTransition(from, to)`.
  - `checkAutoPause(questionId: ObjectId): Promise<boolean>` — computes distinct-student attempt count on the current version and open-flag count; applies the course-configured rule above; when triggered and the question is `approved`, transitions it to `paused` and returns true.
  - `resolveFlag(flagId: ObjectId, action: 'correct' | 'archive' | 'clear', byPuid: string, opts?: { correctnessAffecting?: boolean }): Promise<Flag>` — records the resolution, closes the flag, and applies the question consequence: `correct` → question returns `paused → approved` (direct instructor correction path, §6.2) — the actual edit happens through the normal `PATCH /api/questions/:id` first; `archive` → `paused|approved → archived`; `clear` → question unchanged (un-pauses if it was paused solely by this flag and no other open flags keep it over threshold). Audit-logged. When `correctnessAffecting`, returns the flag plus triggers the Task 6 remediation checklist notification.
  - `listFlags(courseId, state?: FlagState): Promise<Array<Flag & { question, currentVersion }>>`.
- Routes: `POST /api/questions/:questionId/flag` (student-guarded; body `{ reason?: string }` — submittable blank); `GET /api/courses/:courseId/flags?state=` and `POST /api/flags/:flagId/resolve` (instructor-guarded).

- [ ] **Step 1: Write the failing tests** — cases, in full `it()` blocks with mocked collections:

```
1. first flag inserts state:'open' pinned to the CURRENT questionVersionId and
   adds the 'student-flagged' label
2. same student re-flags same version -> duplicate:true, insert not called
3. different student flags -> second record
4. auto-pause percentage arm: 5 distinct attempters, 2 open flags (40%) -> paused
5. auto-pause small-sample guard: 3 attempters, 3 flags (100%) -> NOT paused
6. auto-pause absolute arm: 15 flags, 100 attempters (15%) -> paused
7. thresholds read from course.autoPause (override to {minAttempts:2, flagPercent:50,
   flagCount:99} and verify)
8. resolveFlag 'clear' closes the flag, question untouched
9. resolveFlag 'archive' transitions the question to archived
10. resolveFlag on an already-resolved flag throws 'invalid-flag-transition'
```

- [ ] **Step 2: Run to verify FAIL** — `npx jest tests/unit/flags.service.test.ts`.
- [ ] **Step 3: Implement** service and routes; call `checkAutoPause` from `flagQuestion` after each new flag. The student-facing route responds `{ flagged: true }` with a brief confirmation either way (idempotent UX).
- [ ] **Step 4: Tests + typecheck PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: student flagging, flag state machine, and configurable auto-pause (ST-P09, §4.3, §6.2)"`

---

### Task 2: Flag UI — student control + instructor resolution queue

**Files:**
- Modify: `client/src/views/student/practice.ts` ("Flag this question" on question and feedback views)
- Create: `client/src/views/instructor/flags.ts`
- Modify: client router/instructor nav

**Interfaces:**
- Consumes: Task 1 routes.
- Produces: one-click non-blocking flag control with an optional reason popover (submittable blank) + brief confirmation (ST-P09); instructor flag queue showing question content, reason, date, flag count per version, with Correct / Archive / Clear actions — Correct opens the existing question editor first, then resolves.

- [ ] **Step 1: Implement both surfaces** (follow the Phase-1 view patterns; the flag button posts and swaps to a "Flagged ✓" state without interrupting the question flow).
- [ ] **Step 2: Verify in browser**; `npm run typecheck && npm run lint` → PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat: flag controls in practice view and instructor flag-resolution queue"`

---

### Task 3: In-app notification system with tiering (PRD §4.3, §9.1)

**Files:**
- Create: `server/src/services/notifications.service.ts`
- Create: `server/src/routes/notifications.routes.ts`
- Modify: `server/src/services/flags.service.ts` (emit on flag + auto-pause)
- Modify: `server/src/app.ts`, `server/src/server.ts` (recurring jobs)
- Test: `tests/unit/notifications.service.test.ts`

**Interfaces:**
- Consumes: `notificationsCol()`, `flagsCol()`, `questionsCol()`, `usersCol()`, `coursesCol()`; jobs component.
- Produces:
  - `notify(input: { recipientPuid: string; courseId?: ObjectId; kind: Notification['kind']; priority: 'standard' | 'elevated'; body: string; refType?: string; refId?: ObjectId }): Promise<void>`.
  - `notifyCourseStaff(courseId, input)` — resolves the course's instructor(s) and TAs from `courseRoles` and notifies each.
  - Emission wiring: new flag → standard notification to staff; auto-pause → **elevated** notification to staff (visually distinct client-side); flag resolved → standard notification to the flagging student (`flag-resolved`, §6.2); pending-review backlog past the instructor-set threshold (`course.reviewBacklogThreshold`, add to `Course` + course PATCH; default 10) → `review-backlog` notification, emitted at most once per day per course (§9.1).
  - Job `notifications.daily-summary` (recurring, `scheduleRecurring('notifications.daily-summary', '24 hours')` from `server.ts`): per course, count new flags + pending-review changes in the past 24h; **only if nonzero**, send one `daily-summary` standard notification to the instructor(s).
  - Routes: `GET /api/notifications?unreadOnly=` (poll target, newest first, limit 50), `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.
- Client: a bell in the top bar polling every 30s; elevated notifications styled distinctly (border + icon); mark-read on open.

- [ ] **Step 1: Failing tests** — flag emission targets exactly the course staff; auto-pause emits `priority: 'elevated'`; daily summary sends nothing on a quiet day and one per instructor on an active day; backlog notification not repeated within 24h (store `lastBacklogNotifiedAt` on the course).
- [ ] **Step 2–4: FAIL → implement (service, routes, wiring, client bell) → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: tiered in-app notifications with polling, auto-pause elevation, and daily batched summary (§4.3)"`

---

### Task 4: Parameterized execution sandbox — worker_threads `generate()` (PRD §2)

**Files:**
- Create: `server/src/components/param-worker/index.ts`
- Create: `server/src/components/param-worker/worker.js` (plain JS worker entry — compiled TS can't be a worker file without build gymnastics; keep the worker minimal JS)
- Create: `server/src/components/param-worker/AGENTS.md`
- Test: `tests/unit/param-worker.test.ts` (the abuse suite — a phase exit criterion)

**Interfaces:**
- Consumes: `worker_threads`, `env.paramWorkerTimeoutMs`, `env.paramWorkerMemoryMb`.
- Produces: `executeGenerate(script: string, seed: number): Promise<Record<string, number>>` — runs an instructor-authored `generate()` (PrairieLearn convention: the script defines `function generate(random) { return { vars: {...} } }`; we surface `result.vars`). Guarantees: hard timeout (`env.paramWorkerTimeoutMs`, terminate on expiry → `Error('param-timeout')`); memory cap via `resourceLimits: { maxOldGenerationSizeMb: env.paramWorkerMemoryMb }`; **no network / no fs / no process** — the worker evaluates the script via `new Function` with a scrubbed scope (shadow `require`, `process`, `globalThis.fetch`, `import` as `undefined`) and runs with a seeded PRNG (mulberry32 over the passed seed) as the `random` argument so identical seeds reproduce identical values.

- [ ] **Step 1: Write the failing abuse tests** (real worker, no mocks — this is the security net):

```ts
import { executeGenerate } from '../../server/src/components/param-worker';

jest.setTimeout(15000);

const GOOD = `function generate(random) {
  const r = Math.round(random() * 100) / 100;
  return { vars: { rate: r, principal: 1000 + Math.floor(random() * 9000) } };
}`;

describe('param worker sandbox (abuse suite — phase exit criterion)', () => {
  it('runs a well-behaved script and is deterministic per seed', async () => {
    const a = await executeGenerate(GOOD, 42);
    const b = await executeGenerate(GOOD, 42);
    const c = await executeGenerate(GOOD, 43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(typeof a.rate).toBe('number');
  });

  it('kills an infinite loop at the timeout', async () => {
    await expect(executeGenerate('function generate(){ while(true){} }', 1)).rejects.toThrow('param-timeout');
  });

  it('blocks network access', async () => {
    await expect(
      executeGenerate('function generate(){ return fetch("http://example.com").then(()=>({vars:{}})) }', 1),
    ).rejects.toThrow();
  });

  it('blocks filesystem access', async () => {
    await expect(
      executeGenerate('function generate(){ require("fs").writeFileSync("/tmp/pwn",""); return {vars:{}}; }', 1),
    ).rejects.toThrow();
  });

  it('blocks process access', async () => {
    await expect(executeGenerate('function generate(){ process.exit(1); }', 1)).rejects.toThrow();
  });

  it('rejects a script with no generate()', async () => {
    await expect(executeGenerate('const x = 1;', 1)).rejects.toThrow(/generate/);
  });
});
```

- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement.** `worker.js` (checked in as plain JS next to the component, resolved via `path.join(__dirname, 'worker.js')` — confirm it is copied to `dist` by adding it to the server tsconfig's build via a `copyfiles` step in `build:server`, or reference it from `server/src` at runtime since `__dirname` differs between tsx and dist; use `path.resolve(process.cwd(), 'server/src/components/param-worker/worker.js')` to keep one canonical path):

```js
// Sandbox worker: evaluates an instructor generate() script with a scrubbed
// scope and a seeded PRNG. Resource limits are enforced by the parent via
// worker_threads resourceLimits + terminate-on-timeout.
const { parentPort, workerData } = require('worker_threads');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

try {
  const { script, seed } = workerData;
  // Shadow every escape hatch the script could reach lexically.
  const evaluator = new Function(
    'require', 'process', 'fetch', 'globalThis', 'module', 'exports', '__dirname', '__filename',
    `"use strict"; ${script}; if (typeof generate !== 'function') throw new Error('script must define generate()'); return generate;`,
  );
  const generate = evaluator(undefined, undefined, undefined, {}, undefined, undefined, undefined, undefined);
  const result = generate(mulberry32(seed));
  const vars = result && typeof result === 'object' && result.vars ? result.vars : null;
  if (!vars) throw new Error('generate() must return { vars: { ... } }');
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`vars.${k} is not a finite number`);
  }
  parentPort.postMessage({ ok: true, vars });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
}
```

`index.ts`: spawn `new Worker(WORKER_PATH, { workerData: { script, seed }, resourceLimits: { maxOldGenerationSizeMb: env.paramWorkerMemoryMb } })`; race the `message` event against `setTimeout(env.paramWorkerTimeoutMs)`; on timeout `await worker.terminate()` and reject `param-timeout`; async results (promises returned from generate) are rejected because the worker posts synchronously — a `fetch` attempt rejects via `fetch is not a function` (undefined call). Write the AGENTS.md noting the threat model and that scripts are still instructor-trusted content, not hostile-user content.

- [ ] **Step 4: Run the abuse suite** — `npx jest tests/unit/param-worker.test.ts` → all PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: worker_threads sandbox for parameterized generate() with timeout, memory, network, and fs guards"`

---

### Task 5: Parameterization config + serve-time randomization (IN-Q09, ST-P03/ST-R04)

**Files:**
- Create: `server/src/services/params.service.ts`
- Modify: `server/src/services/serving.service.ts` + `attempts.service.ts` (Phase 1) — randomize at serve time, pin on the attempt
- Modify: `server/src/routes/questions.routes.ts` (param config endpoints)
- Create: `client/src/views/instructor/param-config.ts`
- Test: `tests/unit/params.service.test.ts`

**Interfaces:**
- Consumes: Task 4's `executeGenerate`; `questionVersionsCol()`; Phase-1 serving/attempts services.
- Produces:
  - `resolveParamValues(version: QuestionVersion, seed: number): Promise<Record<string, number> | undefined>` — `generateScript` present → sandbox execution; else `paramSlots` present → seeded uniform draw per slot (`min + step * floor(random() * ((max - min) / step + 1))`, or a seeded pick from `values`); else `undefined`.
  - `substituteParams(stem: string, values: Record<string, number>): string` — replaces `{{name}}` placeholders (also in option texts/explanations).
  - Serving changes: `POST /practice/next` draws `seed = Date.now() ^ random`, resolves values, substitutes into the served stem/options, and returns `paramValues` + `seed` to the client; `POST /api/attempts` receives them back and pins `paramValues` on the AttemptRecord — values are fixed for the attempt, never re-rolled mid-question (ST-P03); Review-Book re-practice draws a **fresh** seed (ST-R04) while conceptual (no-param) questions are unchanged.
  - Config: `PATCH /api/questions/:questionId/params { paramSlots?, generateScript? }` — saves independently of approval state (IN-Q09) as a new version; `POST /api/questions/:questionId/params/preview` → 5 sample draws for the panel.
  - Client panel: slot rows (name/min/max/step or value set) visually linked to `{{placeholders}}` detected in the stem (highlight matches), preview button rendering the 5 draws.

- [ ] **Step 1: Failing tests** — slot draw respects min/max/step and is seed-deterministic; substitution hits stem + options + explanations; missing placeholder for a defined slot surfaces a validation warning list; script path delegates to the sandbox; serving pins the same values into the attempt payload round-trip.
- [ ] **Step 2–4: FAIL → implement (service, route, serving/attempt wiring, panel) → PASS.** Also re-run the Phase-1 serving/attempts suites — they must stay green.
- [ ] **Step 5: Commit** — `git commit -m "feat: parameterization config, seeded serve-time randomization, fresh values on re-practice (IN-Q09, ST-R04)"`

---

### Task 6: Instructor flag resolution + manual remediation checklist (IN-Q06, §6.2)

**Files:**
- Modify: `server/src/services/flags.service.ts` (correctness-affecting path)
- Create: `server/src/services/remediation.service.ts`
- Modify: `client/src/views/instructor/flags.ts`
- Test: `tests/unit/remediation.service.test.ts`

**Interfaces:**
- Consumes: `attemptsCol()`, `reviewBookCol()`, `masteryCol()`, notifications service.
- Produces: `remediationReport(questionVersionId: ObjectId): Promise<{ affectedAttempts: number; affectedStudents: string[]; reviewBookEntries: number; examAttempts: number }>` — locates AttemptRecords pinned to the wrong version (§6.2 step 1). For the pilot the rest is a **guided manual checklist** rendered in the flag-resolution UI when the instructor marks a resolution "correctness-affecting": the report numbers plus the checklist text (recompute correctness; drop from mastery windows and re-evaluate; remove wrongly-added Review Book entries; notify affected students via `notify(kind: 'correction')` — a "Notify affected students" button does the notification step automatically since it's cheap). Full automation stays on the master slip list.

- [ ] **Step 1: Failing tests** — report counts only attempts pinned to the exact version; the notify button notifies each distinct affected student once.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: correctness-affecting flag remediation report and student correction notices (§6.2 pilot scope)"`

---

### Task 7: Progression recommendations + repeated-failure redirect surfaces (ST-P05, ST-P07)

**Files:**
- Modify: `server/src/services/attempts.service.ts` (redirect trigger)
- Modify: `client/src/views/student/practice.ts` (both surfaces)
- Test: `tests/unit/redirect.test.ts`

**Interfaces:**
- Consumes: Phase 1's `mastery.recommendation` field (backend built in Phase 1 Task 11); `course.redirectFailureThreshold`; materials assigned to the LO.
- Produces:
  - Redirect rule (ST-P07 + §9.2 precedence): when the window shows ≥ `redirectFailureThreshold` misses **clustered on easy/medium questions** for the LO, the attempt response gains `redirect: { materials: [{ name, materialId }], message }` and a silent `notify(kind: 'redirect')` flag lands on the instructor dashboard; if misses are concentrated on **hard** questions only, the tier step-back (Phase 1) applies instead and no redirect fires.
  - Client: recommendation banner at the natural break after feedback ("LO covered — advance to next LO?" / theme-level variant; decline = keep practicing, ST-P05); redirect as a **non-modal** inline panel with material links and an always-present "Continue practicing" button; never reveals the current answer; never blocks.

- [ ] **Step 1: Failing tests** — redirect fires on 3 easy-tier misses; does NOT fire when the same misses are all hard-tier (step-back precedence); response never contains the correct answer alongside a redirect.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: progression recommendation and repeated-failure redirect surfaces (ST-P05, ST-P07)"`

---

### Task 8: Question import — CSV/JSON/QTI with preview and partial success (IN-Q01)

**Files:**
- Create: `server/src/services/import.service.ts`
- Create: `server/src/routes/import.routes.ts`
- Create: `client/src/views/instructor/import.ts`
- Create: `tests/fixtures/import-sample.csv`, `tests/fixtures/import-sample.json`, `tests/fixtures/import-sample-qti.xml`
- Modify: `server/src/app.ts`
- Test: `tests/unit/import.service.test.ts`

**Interfaces:**
- Consumes: `csv-parse/sync`, `fast-xml-parser`; `createQuestion` (Phase 1 Task 4); llm component (auto-conversion).
- Produces:
  - `parseImport(format: 'csv' | 'json' | 'qti', raw: string): { candidates: ImportCandidate[]; failures: Array<{ line: number | string; reason: string }> }` where `ImportCandidate = { type: QuestionType | 'other'; stem: string; options: Array<{ key; text; role?; explanation? }>; correctKey: string; difficulty?: Difficulty; parameterizable: boolean }`. CSV columns: `type,stem,optionA,optionB,optionC,optionD,correct,explanationA..D,difficulty`. JSON: an array of the candidate shape. QTI: `choiceInteraction` items mapped to MCQ. Anything else per row → a listed failure, valid rows still import (partial success).
  - `parameterizable` heuristic: stem contains ≥2 distinct numeric literals and a currency/percent pattern (`/\$\d|%|\brate\b/i`) — flagged at preview (IN-Q01/IN-Q09 tie-in), labelled `'convertible-to-parameterized'` on import.
  - `commitImport(courseId, candidates, opts: { themeId?, loId?, byPuid }): Promise<{ imported: number; autoConverted: number }>` — every question enters as **Draft** (unassigned when no LO given); non-MCQ/T-F candidates (`type: 'other'`) run through an LLM conversion prompt to MCQ/T-F and get the `'auto-converted'` label for verification before approval.
  - Routes: `POST /api/courses/:courseId/import/preview` (multipart single file; format from extension; 400 inline error naming an unsupported format), `POST /api/courses/:courseId/import/commit`.
  - Client: upload → preview table (detected questions, failures with reasons, parameterization flags) → confirm.

- [ ] **Step 1: Create the three fixtures** (5 rows each: 3 valid MCQ, 1 T/F, 1 broken row for the failure list; JSON fixture includes one `type: 'other'` short-answer item to exercise auto-conversion).
- [ ] **Step 2: Failing tests** — CSV parse produces 4 candidates + 1 failure with its line number; unknown format rejected; commit inserts Drafts and labels auto-converted items; the broken row never blocks the valid ones; parameterizable heuristic flags a numeric stem and not a conceptual one.
- [ ] **Step 3–5: FAIL → implement (service, routes, view) → PASS.**
- [ ] **Step 6: Commit** — `git commit -m "feat: CSV/JSON/QTI import with preview, partial success, auto-conversion, and parameterization flags (IN-Q01)"`

*Slip note (phase doc #2): if the week is tight, drop QTI — delete only the QTI branch and fixture.*

---

### Task 9: Parameterized-script migration (IN-Q10 tail)

**Files:**
- Modify: `server/src/services/import.service.ts` + `import.routes.ts` (script upload path)
- Modify: `client/src/views/instructor/import.ts`
- Test: `tests/unit/script-migration.test.ts`

**Interfaces:**
- Consumes: Task 4 sandbox (validation run), Task 5 params service, `createQuestion`.
- Produces: `migrateScript(courseId, input: { script: string; stem: string; options: ...; correctKey: string; byPuid }): Promise<{ questionId; sampleValues: Record<string, number> }>` — validates the script in the sandbox (one seeded run; abuse-suite guarantees apply), maps it onto a question template (stem placeholders must cover every `vars` key — mismatches listed back for review), presents for review client-side, then enters as a parameterized **Draft** with `generateScript` set.

- [ ] **Step 1: Failing tests** — valid script yields sampleValues; script whose vars don't match stem placeholders returns the mismatch list without inserting; sandbox rejection (infinite loop fixture) surfaces as a clean 400.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: existing parameterized-script migration into parameterized Drafts (IN-Q10)"`

---

### Task 10: Custom-prompt generation + regeneration (IN-Q11, IN-Q12) — *first to slip (phase doc #1)*

**Files:**
- Modify: `server/src/services/generation.service.ts` (already accepts `prompt` — add @-mention resolution + presets + regenerate)
- Create: `client/src/views/instructor/generate.ts`
- Modify: `server/src/routes/generation.routes.ts`
- Test: `tests/unit/custom-generation.test.ts`

**Interfaces:**
- Consumes: Phase 1 Task 8 pipeline; P2-0 durable generation-run contract;
  `materialsCol()`.
- Produces:
  - @-mention resolution: `prompt` text like `@lecture-3.pdf` resolves to that material's chunks (retrieval restricted to mentioned materials when any mention present).
  - `PRESET_PROMPTS: Array<{ label: string; text: string }>` (four presets: calculation question, concept check, common-misconception probe, applied scenario) — served by `GET /api/generation/presets`, populating the input for editing.
  - `regenerateQuestion(questionId, prompt, byPuid): Promise<{ variant: { stem; options; ... } }>` — runs the pipeline for one question **without saving**; the client shows original and variant side-by-side; "Replace" calls the existing `editQuestion` with the variant's content (original untouched until then, IN-Q12); regeneration attempts recorded on the question (`regenerations: [{ prompt, at }]` — add the optional field to `Question`).
  - Generation UI: free-text prompt with target LO / type / difficulty controls, preset picker, material @-mention autocomplete; output lands in the review queue as Draft with the prompt recorded (IN-Q11).
  - P2-0 compatibility: custom-prompt batch generation returns its unique
    `runId` and reuses course-level run history/SSE. If side-by-side
    regeneration becomes asynchronous, extend the `ContentRun` contract in
    the same PR; do not restore the constant Agenda `jobId` response or add a
    separate client-only progress tracker.

- [ ] **Step 1: Failing tests** — @-mention filters retrieval to the named material; regenerate never mutates the original; the recorded prompt round-trips onto the created Draft.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: custom-prompt generation with @-mentions and side-by-side regeneration (IN-Q11/Q12)"`

---

### Task 11: Phase exit — flag-loop E2E

**Files:**
- Create: `tests/e2e/flag-loop.spec.ts`

- [ ] **Step 1: Write and pass the spec:** student flags an approved question → instructor sees the standard notification and the flag in the queue → four more students flag (seeded via API sessions or direct DB seeding in the spec) → auto-pause fires → instructor sees the elevated notification → question no longer serves to students (practice/next skips it) → instructor resolves "clear" → question serves again; flagging student sees the flag-resolved notification.

Run: `npm run test:e2e -- tests/e2e/flag-loop.spec.ts` → PASS.

- [ ] **Step 2: Full suite green** — `npm run lint && npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 3: Commit** — `git commit -m "test: phase-2 exit — flag -> notify -> auto-pause -> resolve loop e2e"`

---

## Exit criteria checklist (from phase-2-pilot-readiness.md)

- [ ] Flag → notify → auto-pause → resolve loop demonstrated end to end (Task 11).
- [ ] COMM 298 practice sets + parameterized scripts imported as Drafts (Tasks 8–9 used by the instructor; pre-seeding continues through Phases 3–4).
- [ ] Sandboxed `generate()` passes abuse tests: infinite loop, network attempt, fs write (Task 4).
- [ ] supertest coverage on flag state machine and auto-pause thresholds (Task 1).

## Slip order (from the phase doc)

1. Task 10 (custom-prompt generation / regeneration) — thin-LO generation from Phase 1 covers pre-seeding.
2. QTI branch of Task 8 (keep CSV/JSON).
3. Daily batched summary (Task 3's recurring job only — keep standard + elevated tiers).

**Never slip:** Tasks 1, 3 (core tiers), 4.
