# Phase 1 — Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Progress tracking (do this, it is not automatic):** the superpowers execution skills track progress in an ephemeral todo list and a git-ignored local ledger — neither of which is visible to the other developer. This plan file is the shared source of truth. So, **the moment a task's review comes back clean and its commit is made, edit this file to change that task's `- [ ]` to `- [x]`, then commit the checkbox change** (e.g. `git commit -am "docs(plan): mark <phase> task N done"`) and push. Keep the checkboxes honest against `git log` — the other developer's agent trusts them to know what is already done. Run `npm run sync-plans -- <YourName>` after so the update propagates.

**Goal:** The product's irreducible core end to end: a student can enroll, practice by Theme/LO with adaptive feedback, and revisit mistakes in the Review Book; an instructor can set up a course, upload materials, generate questions with the three-agent pipeline, and approve them.

**Architecture:** All server work follows the boilerplate's routes → services → components pattern, consuming the Phase-0 domain types (`server/src/types/domain.ts`), collection accessors (`components/mongodb/collections.ts`), `validate()` middleware, and the API contract (`docs/api-contract.md`). Client views are plain-TS hash-routed views using `renderRichText` for question content. Serving reads **only** `state: 'approved'` questions — verified by test (exit criterion).

**Tech Stack:** as Phase 0, plus `agenda` (MongoDB-backed job queue) and `nanoid` (registration codes).

## Global Constraints

- Everything in the Phase 0 plan's Global Constraints section still applies.
- Only Approved questions are ever served to students; Themes/LOs with zero Approved questions are hidden from students (PRD §9.1). No fallback to unreviewed content, ever.
- Every student answer writes exactly one `AttemptRecord` pinning `questionVersionId`, served `loId`/`themeId`, `mode`, applied `strategy`, and `paramValues` (PRD §2).
- Every question edit creates a new `QuestionVersion`; prior versions are never mutated or deleted (PRD §2).
- Multi-LO questions update mastery only for the LO they were served under (PRD §5.1).
- Publication-state changes must be immediately visible to serving (no caching of question state).
- All new endpoints match `docs/api-contract.md`; contract changes go through PR review first.
- New env vars go in `env.ts` + `.env.example` only.
- Mid-phase checkpoint (~Aug 2): one instructor-generated, approved question served to a student end-to-end.

## Two-developer split & sync points

Agents: before starting any task, ask your human whether you are working as
**Dev A** or **Dev B** (see the root `AGENTS.md` "Two-developer convention"),
and only pick up tasks with a matching `**Owner:**` line.

| Owner | Tasks |
|---|---|
| Dev A (student arc, WS-3/4 + Layer-1 mastery) | 3, 9, 10, 11, 12, 14 |
| Dev B (instructor/AI arc, WS-5/6 + pipeline) | 1, 2, 4, 5, 6, 7, 8, 15 |
| Either (whoever is ahead) | 13 |
| Joint | 16 |

Note: PHASING.md's default split puts WS-7 (mastery) in the AI arc; here the
Layer-1 statistics (Task 9) go with Dev A because selection (Task 10) and
attempts (Task 11) consume them directly, while the LLM half of WS-7 (Task 13,
Layer-2 evaluator) stays available to Dev B per the WS-5 pairing.

**Sync points:**
1. **Week 1:** confirm the selection↔mastery interface (`getMasteryTier`,
   `recordAttemptInMastery` — Task 9 Produces block) across the arcs before
   Tasks 10/11 begin.
2. **~Aug 2 mid-phase checkpoint** (Task 8 Step 5): one instructor-generated,
   approved question served to a student end-to-end — both developers verify.
3. **Any change to `docs/api-contract.md`** — two-developer PR review, never ad hoc.
4. **Task 16 (exit demo)** — joint.

Test-data note: Dev A's tasks need Approved questions before Dev B's UI
exists — seed via the Task 4 service or direct Mongo inserts; don't wait.

---

### Task 1: Job queue component (Agenda)

**Owner:** Dev B

**Files:**
- Create: `server/src/components/jobs/index.ts`
- Create: `server/src/components/jobs/AGENTS.md`
- Modify: `server/src/server.ts`
- Modify: `package.json` (add `agenda`, `nanoid@3` — v3 is CommonJS-compatible)

**Interfaces:**
- Consumes: `env` (`mongodbUri`, `mongodbDbName`). **Note (post-implementation):** agenda@4's job-locking reads `findOneAndUpdate(...).value`, a mongodb@4 result shape the repo's top-level mongodb@7 driver no longer returns — so the component opens its OWN connection via agenda's bundled mongodb@4 driver (`db: { address }`, address derived from `env`) instead of sharing `getMongoClient()`. See `server/src/components/jobs/AGENTS.md`.
- Produces: `startJobs(): Promise<void>`, `stopJobs(): Promise<void>`, `defineJob<T>(name: string, handler: (data: T) => Promise<void>): void`, `enqueueJob<T>(name: string, data: T): Promise<void>`, `scheduleRecurring(name: string, interval: string): Promise<void>`. Used by ingestion (Task 6), generation (Task 8), mastery evaluation (Task 13), and later phases (term-expiry sweep, daily summaries).

- [x] **Step 1: Install**

Run: `npm install agenda nanoid@3`
Expected: exit 0.

- [x] **Step 2: Write the failing test**

`tests/unit/jobs.component.test.ts`:

```ts
jest.mock('agenda', () => ({
  Agenda: jest.fn().mockImplementation(() => ({
    define: jest.fn(),
    now: jest.fn(),
    every: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));
jest.mock('../../server/src/components/mongodb', () => ({
  getMongoClient: jest.fn(() => ({ db: jest.fn() })),
}));

import { defineJob, enqueueJob, startJobs } from '../../server/src/components/jobs';

describe('jobs component', () => {
  it('registers handlers and enqueues by name', async () => {
    await startJobs();
    const handler = jest.fn();
    defineJob('test-job', handler);
    await enqueueJob('test-job', { x: 1 });
    // Registration and enqueue delegate to agenda without throwing.
  });

  it('enqueue before start throws a clear error', async () => {
    jest.resetModules();
    const fresh = require('../../server/src/components/jobs') as typeof import('../../server/src/components/jobs');
    await expect(fresh.enqueueJob('nope', {})).rejects.toThrow(/startJobs/);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx jest tests/unit/jobs.component.test.ts`
Expected: FAIL — module not found.

- [x] **Step 4: Implement `server/src/components/jobs/index.ts`**

```ts
import { Agenda, type Job } from 'agenda';
import { getMongoClient } from '../mongodb';
import { env } from '../../config/env';

// MongoDB-backed background jobs (PRD §2): generation pipeline runs, batch
// mastery evaluation, term-expiry sweeps, daily summaries. One Agenda instance
// per process, started after Mongo connects (see server.ts).

let agenda: Agenda | undefined;

export async function startJobs(): Promise<void> {
  if (agenda) return;
  agenda = new Agenda({
    mongo: getMongoClient().db(env.mongodbDbName),
    processEvery: '5 seconds',
  });
  await agenda.start();
}

function requireAgenda(): Agenda {
  if (!agenda) throw new Error('Jobs not started. Call startJobs() during startup first.');
  return agenda;
}

export function defineJob<T>(name: string, handler: (data: T) => Promise<void>): void {
  requireAgenda().define(name, async (job: Job) => {
    await handler(job.attrs.data as T);
  });
}

export async function enqueueJob<T>(name: string, data: T): Promise<void> {
  await requireAgenda().now(name, data as never);
}

export async function scheduleRecurring(name: string, interval: string): Promise<void> {
  await requireAgenda().every(interval, name);
}

export async function stopJobs(): Promise<void> {
  await agenda?.stop();
  agenda = undefined;
}
```

In `server/src/server.ts`, after `ensureIndexes()`: `await startJobs();`. Write `server/src/components/jobs/AGENTS.md` (3–6 lines describing the component and that job handlers live next to the service that owns them).

- [x] **Step 5: Run tests**

Run: `npx jest tests/unit/jobs.component.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/components/jobs package.json tests/unit/jobs.component.test.ts server/src/server.ts
git commit -m "feat: agenda-backed jobs component"
```

---

### Task 2: Courses service — creation, hierarchy CRUD, term dates, registration code, publish (IN-S01, IN-S02, IN-S03, IN-L06)

**Owner:** Dev B

**Files:**
- Create: `server/src/services/courses.service.ts`
- Create: `server/src/routes/courses.routes.ts`
- Create: `server/src/components/auth/course-guards.ts`
- Modify: `server/src/app.ts` (mount router)
- Test: `tests/unit/courses.service.test.ts`, `tests/unit/courses.routes.test.ts`

**Interfaces:**
- Consumes: `coursesCol()`, `themesCol()`, `losCol()`, `questionsCol()`, `rosterCol()`, `usersCol()`; `nanoid`; domain types.
- Produces (service):
  - `createCourse(ownerPuid: string, input: { name: string; courseCode: string; term: string }): Promise<WithId<Course>>` — starts `published: false` (sandbox), `feedbackStrategy: 'adaptive'`, `autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }`, `redirectFailureThreshold: 3`, unique registration code; also pushes `{ courseId, role: 'instructor' }` into the owner's `courseRoles`.
  - `updateCourse(courseId, patch: Partial<Pick<Course,'termStart'|'termEnd'|'feedbackStrategy'|'autoPause'>>): Promise<Course>` — rejects `termEnd <= termStart` with `Error('term-end-before-start')`.
  - `regenerateRegistrationCode(courseId): Promise<string>`.
  - `addTheme(courseId, input: { name: string; availableFrom?: Date }): Promise<WithId<Theme>>` (order = max+1), `updateTheme(themeId, patch)`, `archiveTheme(themeId)`; same trio for LOs (`addLo(courseId, themeId, { name })`, `updateLo`, `archiveLo`).
  - `getCourseTree(courseId): Promise<Course & { themes: Array<Theme & { los: LearningObjective[] }> }>` (non-archived, ordered).
  - `duplicateNameWarning(courseId, scope: 'theme' | 'lo', parentId: ObjectId | null, name: string): Promise<boolean>` — true when a same-scope active duplicate exists (warn, don't block).
  - `publishChecklist(courseId): Promise<Array<{ item: string; ok: boolean }>>` — term dates set; ≥1 theme; ≥1 LO; registration code present; per-LO approved-count ≥3 for every LO ("thin LOs" listed via `ok: false`).
  - `setPublished(courseId, published: boolean): Promise<Course>` — publish allowed with warnings (IN-L06).
  - `putRoster(courseId, identifiers: string[]): Promise<number>` (lower-cases, dedupes, replaces), `getRoster(courseId)`.
- Produces (guards, `course-guards.ts`):
  - `ensureCourseInstructor()`: RequestHandler — 401 unauthenticated; 403 unless `req.user.courseRoles` has `role: 'instructor'` for `req.params.courseId` (or the resource's course, looked up by the route beforehand and stashed on `res.locals.courseId`) or `req.user.isAdmin`.
  - `ensureCourseStudent()`: same for `role: 'student'`.
- Produces (routes): the Courses/Hierarchy/Roster endpoints exactly as in `docs/api-contract.md`.

- [x] **Step 1: Write the failing service tests**

`tests/unit/courses.service.test.ts` (mock `collections` like `tests/unit/users.service.test.ts` does — one `jest.fn()` per accessor returning an object of collection-method mocks). Cover, with concrete assertions:

```ts
// 1. createCourse: insertOne called with published:false, adaptive strategy,
//    autoPause {5,30,15}, an 8+-char registrationCode; owner's courseRoles
//    updated via usersCol().updateOne with $addToSet.
// 2. updateCourse: termEnd before termStart rejects with 'term-end-before-start'
//    and never calls updateOne.
// 3. addTheme: order is (current max + 1) — mock find().sort().limit().toArray()
//    to return [{ order: 2 }] and expect insertOne with order: 3.
// 4. publishChecklist: mock counts so one LO has 2 approved questions -> its
//    checklist item has ok:false; publish still allowed (setPublished works).
// 5. putRoster: [' A@ubc.ca ', 'a@ubc.ca', 'b'] stores 2 lower-cased entries.
```

Write these five as real `it()` blocks with the mock wiring — follow the `users.service.test.ts` mocking pattern exactly (mock `../../server/src/components/mongodb/collections`, reset in `beforeEach`).

- [x] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/courses.service.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the service**

`server/src/services/courses.service.ts` — implement every function listed in **Interfaces** above. Key excerpts (write the full file; these are the load-bearing parts):

```ts
import { customAlphabet } from 'nanoid';
const registrationCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8); // unambiguous alphabet

export async function createCourse(ownerPuid: string, input: { name: string; courseCode: string; term: string }) {
  const course: Course = {
    ...input,
    ownerPuid,
    registrationCode: registrationCode(),
    published: false,
    feedbackStrategy: 'adaptive',
    autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
    redirectFailureThreshold: 3,
    createdAt: new Date(),
  };
  const { insertedId } = await coursesCol().insertOne(course);
  await usersCol().updateOne(
    { puid: ownerPuid },
    { $addToSet: { courseRoles: { courseId: insertedId, role: 'instructor' as const } } },
  );
  return { _id: insertedId, ...course };
}

export async function publishChecklist(courseId: ObjectId) {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) throw new Error('course-not-found');
  const themes = await themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray();
  const los = await losCol().find({ courseId, archivedAt: { $exists: false } }).toArray();
  const thinLos: string[] = [];
  for (const lo of los) {
    const approved = await questionsCol().countDocuments({ courseId, loIds: lo._id, state: 'approved' });
    if (approved < 3) thinLos.push(lo.name);
  }
  return [
    { item: 'Term dates set', ok: Boolean(course.termStart && course.termEnd) },
    { item: 'At least one Theme', ok: themes.length > 0 },
    { item: 'At least one Learning Objective', ok: los.length > 0 },
    { item: 'Registration code generated', ok: Boolean(course.registrationCode) },
    { item: `Every LO has ≥3 Approved questions${thinLos.length ? ` (thin: ${thinLos.join(', ')})` : ''}`, ok: thinLos.length === 0 },
  ];
}
```

- [x] **Step 4: Implement the guards**

`server/src/components/auth/course-guards.ts`:

```ts
import type { RequestHandler } from 'express';
import { ObjectId } from 'mongodb';
import type { CourseRole } from '../../types/domain';

/** Resolve the courseId a request targets: route param first, else res.locals
 * (set by routes that look up a child resource like a theme or question). */
function requestCourseId(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]): string | undefined {
  return (req.params as { courseId?: string }).courseId ?? (res.locals.courseId as string | undefined);
}

function ensureCourseRole(role: CourseRole): RequestHandler {
  return (req, res, next) => {
    if (!req.isAuthenticated() || !req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.user.isAdmin) return next();
    const courseId = requestCourseId(req, res);
    const match = courseId && req.user.courseRoles.some(
      (r) => r.role === role && r.courseId.toString() === new ObjectId(courseId).toString(),
    );
    if (!match) {
      res.status(403).json({ error: 'You do not have access to this course.' });
      return;
    }
    next();
  };
}

export const ensureCourseInstructor = (): RequestHandler => ensureCourseRole('instructor');
export const ensureCourseStudent = (): RequestHandler => ensureCourseRole('student');
export const ensureCourseTa = (): RequestHandler => ensureCourseRole('ta');
```

- [x] **Step 5: Implement the routes**

`server/src/routes/courses.routes.ts` — implement every Courses/Hierarchy/Roster endpoint from the contract, each with `validate()` schemas (e.g. `z.object({ name: z.string().min(1), courseCode: z.string().min(1), term: z.string().min(1) })` for course creation; ObjectId params validated with `z.string().regex(/^[0-9a-f]{24}$/)`). Instructor endpoints use `ensureCourseInstructor()`; `POST /api/courses` uses `ensureApiAuthenticated()` (any authenticated user may create a course in the pilot; tighten later via the Phase-3 capability model). Mount in `app.ts`: `app.use('/api', coursesRouter);`.

- [x] **Step 6: Write the failing route tests, then make them pass**

`tests/unit/courses.routes.test.ts` — supertest with the passport stand-in middleware (copy the `makeApp` pattern from `tests/unit/notes.route.test.ts`, but set `req.user` to a domain-User fixture with `courseRoles`). Mock `courses.service`. Cover: 401 signed out; 403 non-instructor PATCHing a course; 201 create; 400 invalid body; publish returns `{ published, checklist }`.

Run: `npx jest tests/unit/courses.routes.test.ts tests/unit/courses.service.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/src/services/courses.service.ts server/src/routes/courses.routes.ts server/src/components/auth/course-guards.ts server/src/app.ts tests/unit/courses.service.test.ts tests/unit/courses.routes.test.ts
git commit -m "feat: courses service and routes — hierarchy CRUD, term dates, registration code, publish checklist (IN-S01/S02/S03, IN-L06)"
```

---

### Task 3: Enrollment by code + roster cross-check (ST-E02, ST-E03)

**Owner:** Dev A

**Files:**
- Create: `server/src/services/enrollment.service.ts`
- Create: `server/src/routes/enrollment.routes.ts`
- Modify: `server/src/app.ts`
- Test: `tests/unit/enrollment.service.test.ts`

**Interfaces:**
- Consumes: `coursesCol()`, `rosterCol()`, `usersCol()`; `User` from `req.user`.
- Produces: `enrollByCode(user: User, code: string): Promise<{ courseId: ObjectId; name: string; courseCode: string }>` throwing `EnrollmentError` with `.code` one of `'not-recognized' | 'not-on-roster' | 'course-ended' | 'already-enrolled'`; `listEnrollments(user: User): Promise<Array<{ courseId, name, courseCode, term, active: boolean }>>` where `active` is false past `termEnd` (respecting per-student `extendedUntil`). Routes map error codes to statuses: 404 / 403 / 410 / 409 per the contract.

- [x] **Step 1: Write the failing tests**

`tests/unit/enrollment.service.test.ts` (collections mocked). Concrete cases:

```ts
import { ObjectId } from 'mongodb';
import { enrollByCode, EnrollmentError } from '../../server/src/services/enrollment.service';
// mock collections as in users.service.test.ts …

const courseId = new ObjectId();
const activeCourse = {
  _id: courseId, name: 'Intro Finance', courseCode: 'COMM 298', published: true,
  termEnd: new Date(Date.now() + 86_400_000),
};
const student = { puid: 'P1', uid: 'student1', email: 's1@ubc.ca', courseRoles: [] } as never;

it('enrolls when code matches and the CWL identity is on the roster', async () => {
  coursesFindOne.mockResolvedValue(activeCourse);
  rosterFindOne.mockResolvedValue({ courseId, identifier: 'student1' });
  usersUpdateOne.mockResolvedValue({});
  const result = await enrollByCode(student, 'GOODCODE');
  expect(result.courseId).toEqual(courseId);
  expect(usersUpdateOne).toHaveBeenCalledWith(
    { puid: 'P1' },
    { $addToSet: { courseRoles: { courseId, role: 'student' } } },
  );
});

it('rejects a valid code when not on the roster (distinct message, ST-E02)', async () => {
  coursesFindOne.mockResolvedValue(activeCourse);
  rosterFindOne.mockResolvedValue(null);
  await expect(enrollByCode(student, 'GOODCODE')).rejects.toMatchObject({ code: 'not-on-roster' });
  expect(usersUpdateOne).not.toHaveBeenCalled();
});

it('rejects an unknown code', async () => {
  coursesFindOne.mockResolvedValue(null);
  await expect(enrollByCode(student, 'BADCODE')).rejects.toMatchObject({ code: 'not-recognized' });
});

it('rejects an expired course', async () => {
  coursesFindOne.mockResolvedValue({ ...activeCourse, termEnd: new Date(Date.now() - 1000) });
  rosterFindOne.mockResolvedValue({ courseId, identifier: 'student1' });
  await expect(enrollByCode(student, 'GOODCODE')).rejects.toMatchObject({ code: 'course-ended' });
});

it('is idempotent: already enrolled -> already-enrolled, no duplicate', async () => {
  coursesFindOne.mockResolvedValue(activeCourse);
  rosterFindOne.mockResolvedValue({ courseId, identifier: 'student1' });
  const enrolled = { ...student, courseRoles: [{ courseId, role: 'student' }] };
  await expect(enrollByCode(enrolled as never, 'GOODCODE')).rejects.toMatchObject({ code: 'already-enrolled' });
});
```

Roster match rule: the student's `uid` **or** `email` (both lower-cased) must equal a roster `identifier`.

- [x] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/enrollment.service.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement service + routes**

```ts
export class EnrollmentError extends Error {
  constructor(public readonly code: 'not-recognized' | 'not-on-roster' | 'course-ended' | 'already-enrolled') {
    super(code);
  }
}

export async function enrollByCode(user: User, code: string) {
  const course = await coursesCol().findOne({ registrationCode: code.trim().toUpperCase() });
  if (!course || !course.published) throw new EnrollmentError('not-recognized');
  const identifiers = [user.uid, user.email].filter(Boolean).map((s) => s.toLowerCase());
  const rosterHit = await rosterCol().findOne({ courseId: course._id, identifier: { $in: identifiers } });
  if (!rosterHit) throw new EnrollmentError('not-on-roster');
  const ends = rosterHit.extendedUntil ?? course.termEnd;
  if (ends && ends < new Date()) throw new EnrollmentError('course-ended');
  if (user.courseRoles.some((r) => r.role === 'student' && r.courseId.toString() === course._id.toString())) {
    throw new EnrollmentError('already-enrolled');
  }
  await usersCol().updateOne(
    { puid: user.puid },
    { $addToSet: { courseRoles: { courseId: course._id, role: 'student' as const } } },
  );
  return { courseId: course._id, name: course.name, courseCode: course.courseCode };
}
```

Routes (`enrollment.routes.ts`): `POST /api/enrollments` (body `{ code: z.string().min(1) }`) mapping `EnrollmentError.code` → 404/403/410/409 with the exact user-facing messages from ST-E02 ("you're not on the roster for this course — contact your instructor", "this course has ended", "code not recognized", informational duplicate message); `GET /api/enrollments` listing via `listEnrollments`. Mount in `app.ts`.

- [x] **Step 4: Run tests**

Run: `npx jest tests/unit/enrollment.service.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/enrollment.service.ts server/src/routes/enrollment.routes.ts server/src/app.ts tests/unit/enrollment.service.test.ts
git commit -m "feat: enrollment by registration code with roster cross-check and four error states (ST-E02)"
```

**Note (post-implementation, Stephen 2026-07-16):** shipped as specified; review Approved, no Critical/Important findings. Two deferred Minors: `enrollByCode`/`listEnrollments` duplicate roster+expiry logic with subtly different null-handling (a shared `resolveAccessEnd()` helper would remove drift risk); test coverage exercises only the `uid` roster-match path, not `email` (the core doc's own spec has the same gap).

---

### Task 4: Question service — versioning, publication transitions, tagging (IN-Q03, IN-Q04, IN-Q07, IN-Q13)

**Owner:** Dev B

**Files:**
- Create: `server/src/services/questions.service.ts`
- Test: `tests/unit/questions.service.test.ts`

**Interfaces:**
- Consumes: `questionsCol()`, `questionVersionsCol()`, `auditCol()`; `canTransition`, domain types.
- Produces:
  - `createQuestion(input: { courseId: ObjectId; loIds: ObjectId[]; themeIds: ObjectId[]; type: QuestionType; stem: string; options: QuestionOption[]; difficulty: Difficulty; sourceRefs?: QuestionVersion['sourceRefs']; createdBy: string; generationPrompt?: string; agentDecision?: Question['agentDecision']; labels?: QuestionLabel[] }): Promise<{ questionId: ObjectId; version: WithId<QuestionVersion> }>` — inserts Question (`state: 'draft'`) + QuestionVersion v1.
  - `editQuestion(questionId: ObjectId, patch: Partial<Pick<QuestionVersion, 'stem' | 'options' | 'difficulty' | 'paramSlots'>> & { loIds?: ObjectId[]; themeIds?: ObjectId[] }, byPuid: string): Promise<WithId<QuestionVersion>>` — copies the current version, applies the patch, inserts as `version: n+1`, updates the head's `currentVersionId/currentVersion`, records `editedFields` (patched content keys) and adds the `'manually-edited'` label.
  - `transitionQuestion(questionId: ObjectId, to: PublicationState, byPuid: string): Promise<Question>` — validates with `canTransition`, throws `Error('invalid-transition:<from>-><to>')` otherwise; writes an AuditLog entry `question.transition`.
  - `bulkTransition(questionIds: ObjectId[], to: PublicationState, byPuid: string): Promise<number>` — applies to each; skips invalid ones; returns updated count.
- MCQ invariants enforced in `createQuestion`/`editQuestion`: exactly 4 options for `mcq` / 2 for `true-false`; exactly one option with `role: 'correct'`; a `true-false` incorrect option's role is forced to `'common-misconception'` (PRD §9.1). Violations throw `Error('invalid-options:<reason>')`.

**Note (post-implementation, Saurav 2026-07-16) — the shipped service deviates from the above in five places.** Full rationale in `phase-1/Saurav/STATUS.md`; the short version for anyone coding against this service:

1. **`editQuestion` does not version or label a tagging-only patch.** If the patch has no content key (`stem`/`options`/`difficulty`/`paramSlots`), it updates the head's `loIds`/`themeIds` only, inserts **no** version, adds **no** `manually-edited`, and returns the current version. The recipe below was unconditional, which stamped an IN-Q13 retag as manually-edited and piled up content-identical versions. Content-bearing edits behave exactly as written here.
2. **`editedFields` is per-edit** (patched content keys of *that* edit). `domain.ts:128`'s docstring was reworded to match — the cumulative divergence-from-original set is the union of `editedFields` across the version chain.
3. **`transitionQuestion` hoists one `const now`** so the returned `updatedAt` matches what was written; the excerpt below returns a stale one. **If you echo this return to a client, you now get the real timestamp.**
4. **`bulkTransition` only skips `question-not-found` and `invalid-transition:*`; every other error propagates.** A bare `catch {}` turned a Mongo outage into a silent `0`. **Callers (Task 5) must handle a rejected `bulkTransition`.**
5. **`createQuestion` inserts the version before the head**; `editQuestion` throws `question-not-found` / `version-not-found` on the paths this doc left silent.

- [x] **Step 1: Write the failing tests**

`tests/unit/questions.service.test.ts` — collections mocked. Cases (write in full):

1. `createQuestion` inserts a draft head + version 1; MCQ with 3 options throws `invalid-options`; two `correct` roles throws; T/F wrong option role coerced to `common-misconception`.
2. `editQuestion` inserts version 2 copying unpatched fields, sets `editedFields: ['stem']` when only the stem changed, updates the head, and adds `manually-edited` exactly once.
3. `transitionQuestion` allows `pending-review → approved` and rejects `draft → approved` (assert the thrown message and that no write happened); audit log written on success.
4. `bulkTransition` returns the count of questions whose transition was valid.

- [x] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/questions.service.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement `questions.service.ts`**

Core excerpt (write the full file):

```ts
function assertOptionInvariants(type: QuestionType, options: QuestionOption[]): QuestionOption[] {
  const expected = type === 'mcq' ? 4 : 2;
  if (options.length !== expected) throw new Error(`invalid-options:expected-${expected}-options`);
  const correct = options.filter((o) => o.role === 'correct');
  if (correct.length !== 1) throw new Error('invalid-options:exactly-one-correct');
  if (type === 'true-false') {
    // A T/F distractor is by design a plausible wrong statement (PRD §9.1).
    return options.map((o) => (o.role === 'correct' ? o : { ...o, role: 'common-misconception' as const }));
  }
  return options;
}

export async function transitionQuestion(questionId: ObjectId, to: PublicationState, byPuid: string): Promise<Question> {
  const question = await questionsCol().findOne({ _id: questionId });
  if (!question) throw new Error('question-not-found');
  if (!canTransition(question.state, to)) throw new Error(`invalid-transition:${question.state}->${to}`);
  await questionsCol().updateOne({ _id: questionId }, { $set: { state: to, updatedAt: new Date() } });
  await auditCol().insertOne({
    actorPuid: byPuid, action: 'question.transition', targetType: 'question', targetId: questionId,
    courseId: question.courseId, detail: { from: question.state, to }, createdAt: new Date(),
  });
  return { ...question, state: to };
}
```

`editQuestion` reads the current version, builds `next = { ...current, ...patch, version: current.version + 1, editedFields, createdBy: byPuid, createdAt: new Date() }` (dropping `_id`), validates options if patched, inserts it, and updates the head with `$set: { currentVersionId, currentVersion, updatedAt }`, `$addToSet: { labels: 'manually-edited' }` plus `loIds`/`themeIds` if provided.

- [x] **Step 4: Run tests**

Run: `npx jest tests/unit/questions.service.test.ts && npm run typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/questions.service.ts tests/unit/questions.service.test.ts
git commit -m "feat: question versioning, option invariants, publication transitions with audit (IN-Q03/Q04/Q07)"
```

---

### Task 5: Bank routes — browse/filter, review queue, editing, transitions (IN-Q02, IN-Q05, IN-Q08)

**Owner:** Dev B

**Files:**
- Create: `server/src/services/bank.service.ts`
- Create: `server/src/routes/questions.routes.ts`
- Modify: `server/src/app.ts`
- Test: `tests/unit/bank.service.test.ts`, `tests/unit/questions.routes.test.ts`

**Interfaces:**
- Consumes: Task 4's service; `questionsCol()`, `questionVersionsCol()`, `flagsCol()`, `attemptsCol()`.
- Produces (service):
  - `browseBank(courseId, filters: { state?: PublicationState; loId?: ObjectId; themeId?: ObjectId; type?: QuestionType; difficulty?: Difficulty; label?: QuestionLabel; includeArchived?: boolean }): Promise<{ total: number; questions: Array<Question & { _id: ObjectId; current: QuestionVersion }> }>` — archived excluded unless `state: 'archived'` or `includeArchived` (IN-Q08); joins current versions via `$in` on `currentVersionId`.
  - `reviewQueue(courseId): Promise<Array<Question & { _id: ObjectId; current: QuestionVersion; priority: number }>>` — non-archived, non-approved questions ordered: (1) `labels` contains `student-flagged`, (2) `state === 'reviewed'`, (3) rest by under-coverage (fewest approved questions on their first LO) — computed with three queries and concatenated, de-duplicated by id (IN-Q02 ordering).
- Produces (routes): `GET /api/courses/:courseId/questions`, `GET /api/questions/:questionId` (head + current + `agentDecision` + `internalNotes` + version list metadata), `PATCH /api/questions/:questionId`, `POST /api/questions/:questionId/transition`, `POST /api/questions/bulk-transition`, `GET /api/courses/:courseId/review-queue` — instructor-guarded; child-resource routes look up the question first and stash `res.locals.courseId` before the guard runs (mount guard after a small loader middleware).

**Note (post-implementation, Saurav 2026-07-17) — four deviations.** Full rationale in `phase-1/Saurav/STATUS.md`; the short version for anyone coding against this surface:

1. **The stash-then-guard recipe above does NOT cover `POST /api/questions/bulk-transition`** — that route has no `:courseId` and takes an **array** of ids that may span courses, while `ensureCourseInstructor()` resolves exactly one course. Stashing a single question's courseId would have let an instructor of course A transition course B's questions. Implemented: distinct `courseId`s of the found questions must be **exactly one**, else **403**; then stash + guard. 403 (not 400) so it isn't an existence oracle. **Anyone adding another array-taking route under `/api/questions` must apply the same rule** — the singular recipe is a trap there.
2. **The span-check 403 reuses the guard's body** via a frozen `NO_COURSE_ACCESS_BODY` exported from `components/auth/course-guards.ts`, so the two 403s are indistinguishable. Import that constant rather than re-typing the string.
3. **`includeArchived` is service-only, not a query param** — `docs/api-contract.md:47` doesn't list it and the contract governs the HTTP surface. `state=archived` still reaches archived questions.
4. **`flagsCol()`/`attemptsCol()` are not consumed** — the review-queue ordering as specified needs neither.

**Serialization rule (deliberate):** Question heads serialize as **`id`** per the contract; an embedded `current: QuestionVersion` serializes **raw with its own `_id`**. `PATCH` therefore returns a raw `QuestionVersion` — that is correct, not an oversight.

- [x] **Step 1: Write failing tests** — `bank.service.test.ts`: state filter is strictly publication states with `student-flagged` as a separate label filter (assert a query containing `labels`), archived hidden by default, review-queue ordering (flagged fixture sorts before reviewed before new). `questions.routes.test.ts`: 403 for a student hitting instructor routes; `transition` route returns 409 with the service's `invalid-transition` message; PATCH validates options shape via zod (`options: z.array(z.object({ key: z.string(), text: z.string(), role: z.enum([...]), explanation: z.string() })).length(4).optional()` — use a refinement allowing 2 for true-false based on the loaded question type, or validate count in the service and let zod check element shape only).

- [x] **Step 2: Run tests to verify they fail** — `npx jest tests/unit/bank.service.test.ts tests/unit/questions.routes.test.ts` → FAIL.

- [x] **Step 3: Implement** service + routes per the interfaces; mount in `app.ts`.

- [x] **Step 4: Run tests** — same command + `npm run typecheck` → PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/bank.service.ts server/src/routes/questions.routes.ts server/src/app.ts tests/unit/bank.service.test.ts tests/unit/questions.routes.test.ts
git commit -m "feat: question bank browse/filter and prioritized review queue (IN-Q02/Q05/Q08)"
```

---

### Task 6: Material upload + RAG ingestion (IN-S04)

**Owner:** Dev B

**Files:**
- Create: `server/src/services/materials.service.ts`
- Create: `server/src/routes/materials.routes.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/components/qdrant/index.ts` (if `ensureCollection`/`upsertPoints`/`search` don't already take a collection-name argument, add it)
- Test: `tests/unit/materials.service.test.ts`

**Interfaces:**
- Consumes: `multer` (disk storage under `uploads/` — gitignored), genai components (`document-parsing`, `chunking`, `embeddings`), qdrant component, jobs component (Task 1), `materialsCol()`.
- Produces:
  - `createMaterials(courseId, files: Express.Multer.File[]): Promise<Material[]>` and `createUrlMaterial(courseId, url: string): Promise<Material>` — insert `status: 'processing'` docs, then `enqueueJob('material.ingest', { materialId })` per material (independent processing — one failure never blocks others, IN-S04).
  - Job `material.ingest`: parse (file via toolkit by extension; URL via `fetch` + HTML parsing through the toolkit) → chunk → embed → upsert into the per-course Qdrant collection `course-<courseId>` with payload `{ materialId, chunk }` → set `status: 'ready'`; on error set `status: 'failed', error: message`. Register with `defineJob` in this service; import the service from `server.ts` after `startJobs()` so registration runs.
  - `retryMaterial(materialId)` — re-enqueues a failed material.
  - `assignMaterial(materialId, assignments: Array<{ themeId; loId? }>)` (IN-S05) — replaces assignments; never deletes the material or its questions.
  - `courseCollection(courseId: ObjectId): string` — returns `course-<hex>`; exported, used by generation (Task 8) and classification (Task 7).
  - Supported formats: `pdf docx pptx txt md url`; anything else → route responds 400 naming the format (inline error, IN-S04).
- Routes: `POST /api/courses/:courseId/materials` (multipart `files[]` via `multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } })`, or JSON `{ url }`), `GET .../materials`, `POST /api/materials/:materialId/retry`, `PUT /api/materials/:materialId/assignments` — instructor-guarded.

- [ ] **Step 1: Write failing tests** — mock collections + jobs + genai/qdrant modules. Cases: unsupported extension rejected with the format named; three files create three `processing` docs and three enqueues; ingest job success path calls parse→chunk→embed→upsert with collection `course-<id>` and sets `ready`; ingest job failure sets `failed` with the error message and does not throw (other files unaffected); URL material stores `sourceUrl`.

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement** service, job registration, routes; add `uploads/` to `.gitignore`. Verify manually: upload `tests/fixtures/sample-material.md` through the UI-less route with `curl -F "files=@tests/fixtures/sample-material.md" -b <session>` and watch status go `processing → ready`.

- [ ] **Step 4: Run tests + typecheck** → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/materials.service.ts server/src/routes/materials.routes.ts server/src/app.ts .gitignore tests/unit/materials.service.test.ts
git commit -m "feat: material upload and async RAG ingestion into per-course Qdrant collections (IN-S04/S05)"
```

---

### Task 7: LLM auto-classification + AI-suggested hierarchy (IN-S06, IN-S01 tail)

**Owner:** Dev B

**Files:**
- Create: `server/src/services/classification.service.ts`
- Modify: `server/src/routes/materials.routes.ts` (classification accept/reject; suggest-hierarchy endpoint)
- Test: `tests/unit/classification.service.test.ts`

**Interfaces:**
- Consumes: genai `llm` component (`completeJson<T>(prompt: string, opts: { model: string }): Promise<T>` — if the component exposes only text completion, add a `completeJson` helper there that parses/retries JSON once), `env.llmModelValidator` is *not* used here — use `env.llmDefaultModel`; materials + hierarchy collections.
- Produces:
  - `classifyMaterial(materialId): Promise<Material>` — prompt includes the course's Theme/LO names + the material's first ~2000 chars; expects `{ themeName: string; loName?: string; confidence: number }`; resolves names to ids; stores `classificationSuggestion`; `confidence < 0.5` leaves it unset (material marked "Unclassified" client-side). Called at the end of a successful `material.ingest` job.
  - `suggestHierarchy(courseId): Promise<Array<{ theme: string; los: string[] }>>` — from all `ready` materials' first chunks; returned to the instructor for accept/modify/reject; **acceptance** calls existing `addTheme`/`addLo` (Task 2). *Slip candidate #3 — if the phase is tight, cut this function and its endpoint only.*

- [ ] **Step 1: Failing tests** — mock llm: classification stores a suggestion with resolved ObjectIds; low confidence stores nothing; suggestHierarchy shapes the LLM JSON into the return type and never writes to the DB directly.
- [ ] **Step 2: Verify FAIL.** Step 3: **Implement** (prompts inline in the service, few-shot with one example; temperature 0). Step 4: **Run tests + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: LLM material classification and hierarchy suggestion (IN-S06)"`

---

### Task 8: Three-agent generation pipeline + thin-LO generation + pre-seeding indicator (PRD §9.1, IN-Q10)

**Owner:** Dev B — Step 5 is the ~Aug 2 mid-phase **sync point** (both developers verify end-to-end).

**Files:**
- Create: `server/src/services/generation.service.ts`
- Create: `server/src/routes/generation.routes.ts`
- Modify: `server/src/app.ts`
- Test: `tests/unit/generation.service.test.ts`

**Interfaces:**
- Consumes: llm component (`completeJson`), qdrant `search` + `courseCollection` (Task 6), embeddings component, `createQuestion` (Task 4), jobs component, per-step models `env.llmModelGenerator/Validator/Reviewer`.
- Produces:
  - `runGenerationPipeline(input: { courseId: ObjectId; loId: ObjectId; count: number; type?: QuestionType; difficulty?: Difficulty; prompt?: string; byPuid: string }): Promise<ObjectId[]>` — for each question: **retrieve** (embed the LO name + optional prompt, search the course collection, top 6 chunks) → **generator** (model: `env.llmModelGenerator`; produces stem, 4 options with roles, per-option explanations, difficulty, grounded in the chunks) → **structure validator** (model: `env.llmModelValidator`; verifies each option's assigned role fits — returns per-role assessment) → **reviewer** (model: `env.llmModelReviewer`; verifies factual accuracy, calculation correctness, LO/material alignment, distractor quality, clarity; returns `{ decision: 'pass' | 'flag' | 'reject', reasoning }`) → insert via `createQuestion` with `agentDecision` and `sourceRefs` (materialIds of used chunks). All decisions surface on the question (IN-Q05); output always enters as **Draft** — the pipeline never publishes (PRD §9.1).
  - Job `generation.run` wrapping the pipeline; route `POST /api/courses/:courseId/generate` validates body, enqueues, responds `202 { jobId: name }`.
  - `preseedingProgress(courseId): Promise<Array<{ loId: ObjectId; loName: string; approved: number; reviewed: number; target: number }>>` (target 5, highlight below 3 client-side); route `GET /api/courses/:courseId/preseeding`.
- Pipeline prompts live as exported constants (`GENERATOR_PROMPT`, `VALIDATOR_PROMPT`, `REVIEWER_PROMPT`) so Phase 4's content QA can tune them without touching logic. Each is a template function taking the chunks/LO/question JSON.

- [ ] **Step 1: Failing tests** — mock llm/qdrant/questions.service. Cases: (1) pipeline calls the three steps with the three distinct configured models (assert model arg per call); (2) reviewer `reject` still inserts a Draft with `agentDecision.decision: 'reject'` (nothing is auto-discarded; the instructor sees it in the queue); (3) generator output failing option invariants is retried once, then skipped with a logged warning (count returned reflects insertions); (4) `preseedingProgress` counts approved/reviewed per LO.
- [ ] **Step 2: Verify FAIL.** Step 3: **Implement** with full prompt texts (write real, grounded prompt templates — generator instructs 4 options exactly one correct + roles from the taxonomy + JSON schema of the expected output; validator instructs per-option role assessment; reviewer instructs the five IN-Q05 criteria). Step 4: **Tests + typecheck PASS.**
- [ ] **Step 5: Manual checkpoint** — with docker + a reachable LLM (`LLM_PROVIDER=ollama` or sandbox): create a course + theme + LO, upload the fixture material, run generation, confirm Draft questions with agent decisions appear. **This is the ~Aug 2 mid-phase checkpoint input.**
- [ ] **Step 6: Commit** — `git commit -m "feat: three-agent generation pipeline with per-step models; thin-LO generation and pre-seeding progress (§9.1, IN-Q10)"`

---

### Task 9: Mastery engine Layer 1 — rolling window, tier progression, coverage (PRD §9.2)

**Owner:** Dev A — the Produces block below is the week-1 **sync point** interface; confirm it with Dev B before Tasks 10/11 begin.

**Files:**
- Create: `server/src/services/mastery.service.ts`
- Test: `tests/unit/mastery.service.test.ts`

**Interfaces:**
- Consumes: `masteryCol()`, `attemptsCol()`, `losCol()`; domain types.
- Produces:
  - `recordAttemptInMastery(attempt: AttemptRecord): Promise<MasteryProfile>` — recomputes the (puid, LO) profile from the latest ≤10 attempts (the rolling window): `attemptCount`, `windowAccuracy`, `windowRoles`, then applies **tier progression**: correct → advance one tier (easy→medium→hard, capped); miss with `selectedRole: 'common-misconception'` → keep tier (repeat same difficulty/concept); ≥2 misses among the last 3 attempts at `hard` → step back to `medium` (and medium→easy likewise). Status (Layer-1 fallback rule, used until/unless Layer 2 ships): `not-attempted` (no attempts) → `in-progress` (≥1 attempt) → `covered` when window has ≥4 attempts, `windowAccuracy ≥ 0.75`, and `currentTier` is `medium` or `hard`; a miss on a `hard` question regresses `covered → in-progress` (never directly to `struggling` — §9.2). `struggling` is only ever set by Layer 2 / the Phase-2 struggle path. Increments `attemptsSinceEvaluation`.
  - `getMasteryTier(puid, courseId, loId): Promise<Difficulty>` (default `'easy'`).
  - `getLoStatuses(puid, courseId): Promise<Map<string, MasteryStatus>>` (loId hex → status).
  - `recordSkip(puid, courseId, loId, attempted: boolean): Promise<void>` — sets `skipped`; new attempts clear it (ST-P06).
  - `themeCoverage(puid, courseId, themeId): Promise<{ covered: boolean; includesSkipped: boolean }>` — covered once all non-skipped active LOs are covered (§9.2).

**Note (post-implementation, Stephen 2026-07-17):** "recomputes ... from the latest ≤10 attempts" above describes `attemptCount`/`windowAccuracy`/`windowRoles` only — those genuinely are freshly recomputed from the full capped window on every call. **Tier progression is an incremental delta, not a window replay**: each call applies exactly one tier transition using `prior.currentTier` (or `'easy'` if this is the LO's first-ever attempt) plus the newest attempt in the window. This is a deliberate, load-bearing design choice, not a shortcut — a full-window tier replay was tried and reverted because it silently collapses `currentTier` (e.g. `hard` → `easy`) once earlier tier-earning attempts age out of the 10-slot window during a legitimate common-misconception-miss streak, which this section's own rule requires to be tier-**neutral**. See `phase-1/Stephen/2026-07-11-phase-1-core-loop-stephen.md`'s Task 9 note and the gitignored `.superpowers/sdd/task-9-report.md` for the full incident. Anyone calling `computeProfile` directly (not through `recordAttemptInMastery`) with a multi-attempt window against a stale or null `prior` is outside its contract and will get an under-stepped tier by design.

- [x] **Step 1: Write the failing tests** — this is the highest-value test file in the phase; write it exhaustively with a helper that feeds a scripted attempt sequence through `recordAttemptInMastery` against an in-memory fake of `masteryCol`/`attemptsCol` (a `Map`-backed stub implementing `findOne`/`find().sort().limit().toArray()`/`updateOne` with upsert). Scripted cases:

```
1. easy ✓, medium ✓, hard ✓            -> tier walks easy→medium→hard; status in-progress (only 3 attempts)
2. + hard ✓                             -> covered (4 attempts, 100%, tier hard)
3. covered, then hard ✗                 -> regresses to in-progress, tier steps toward medium after repeated misses only
4. CM miss at medium                    -> tier stays medium
5. hard ✗, hard ✗ (2 of last 3)         -> tier steps back to medium
6. 10-attempt window: 11th attempt evicts the 1st from accuracy
7. skip then attempt                    -> skipped cleared
8. themeCoverage: LO-A covered, LO-B skipped -> covered:true, includesSkipped:true
```

- [x] **Step 2: Verify FAIL.** Step 3: **Implement** exactly the rules above (pure function `computeProfile(window: AttemptRecord[], prior: MasteryProfile | null): MasteryProfile` + thin persistence wrapper — keeps the rules unit-testable). Step 4: **Tests + typecheck PASS.**
- [x] **Step 5: Commit** — `git commit -m "feat: mastery Layer-1 rolling window, tier progression, coverage and skip semantics (§9.2)"`

---

### Task 10: Question selection algorithm (PRD §5.1)

**Owner:** Dev A

**Files:**
- Create: `server/src/services/serving.service.ts`
- Test: `tests/unit/serving.service.test.ts`

**Interfaces:**
- Consumes: `questionsCol()`, `questionVersionsCol()`, `getMasteryTier` (Task 9); `worker sandbox` **not** needed yet (parameterized execution is Phase 2 — Phase 1 serves `paramSlots`-free questions; if `paramSlots` exist, serve with slot defaults `min` — note this and revisit in Phase 2 Task 4).
- Produces:
  - `selectNextQuestion(input: { puid: string; courseId: ObjectId; loId: ObjectId; sessionServedIds: ObjectId[] }): Promise<{ question: WithId<Question>; version: QuestionVersion; degraded: 'none' | 'repeat' | 'adjacent' | 'any' } | null>` — implements: filter Approved bank tagged to the LO → exclude `sessionServedIds` → target tier from mastery → random within difficulty-matched pool → degradation ladder: (1) same difficulty already-served-this-session, (2) adjacent difficulty unseen, (3) any Approved for the LO. Returns `null` only when the LO has zero Approved questions (callers hide such LOs — ST-P01/P02 gate on ≥1 approved).
  - `selectRetryQuestion(input: { puid; courseId; loId; excludeQuestionId: ObjectId; sessionServedIds: ObjectId[] }): Promise<same | null>` — a **new** question testing the same concept (same LO, different questionId); `null` → caller degrades to Strategy B (§5.1).
  - `studentCourseHome(puid, courseId): Promise<Array<{ theme: Theme; available: boolean; los: Array<{ lo: LearningObjective; status: MasteryStatus; approvedCount: number }> }>>` — only themes/LOs with ≥1 approved question, `availableFrom` respected, archived hidden (ST-P01/P02).

**Note (post-implementation, Stephen 2026-07-17):** `approvedCount` is tallied with a single course-wide `find({courseId, state:'approved'})` plus an in-memory `Map` keyed by `loId` (not one `countDocuments` per LO — that N+1 shape was caught in review since it's invisible under a test fake but real against Mongo). `available` on a returned entry is always `true` in practice — a not-yet-available theme is hidden entirely rather than included with `available:false`; flag before Task 14 if the client view ever needs to distinguish "locked but visible" from "absent."

- [x] **Step 1: Write the failing tests** — fake collections with a seeded bank builder `bank([{ id, difficulty, state, loIds }])`. Cases:

```
1. picks only 'approved' — a bank of drafts/pending/paused returns null
2. excludes sessionServedIds when unseen same-tier questions exist
3. targets the mastery tier (tier=medium -> a medium question wins over easy/hard)
4. ladder 1: all same-tier questions served -> repeats one (degraded:'repeat')
5. ladder 2: no same-tier at all -> adjacent difficulty unseen (degraded:'adjacent')
6. ladder 3: only an off-tier already-served question exists -> serves it (degraded:'any')
7. zero approved for the LO -> null
8. selectRetryQuestion never returns the excluded questionId; returns null when the LO has only that one question
9. studentCourseHome hides a theme whose availableFrom is tomorrow and an LO with 0 approved
```

- [x] **Step 2: Verify FAIL.** Step 3: **Implement** (pure selection over an in-memory candidate list fetched once per call; `Math.random` injected as an optional argument defaulting to `Math.random` so tests can pin it). Step 4: **Tests + typecheck PASS.**
- [x] **Step 5: Commit** — `git commit -m "feat: mastery-driven question selection with graceful degradation ladder (§5.1)"`

---

### Task 11: Attempts + adaptive feedback + Review Book auto-collection (ST-P04, ST-R01)

**Owner:** Dev A

**Files:**
- Create: `server/src/services/attempts.service.ts`
- Create: `server/src/routes/practice.routes.ts`
- Modify: `server/src/app.ts`
- Test: `tests/unit/attempts.service.test.ts`, `tests/unit/practice.routes.test.ts`

**Interfaces:**
- Consumes: Tasks 9–10 services; `attemptsCol()`, `reviewBookCol()`, `coursesCol()`, `questionVersionsCol()`, `questionsCol()`.
- Produces:
  - `decideStrategy(courseStrategy: FeedbackStrategy, selectedRole: OptionRole): AppliedStrategy` — pure: `'strategy-a'` → `'a'`; `'strategy-b'` → `'b'`; `'adaptive'` → `'a'` iff `selectedRole === 'common-misconception'`, else `'b'`. A locked strategy applies regardless of option type (ST-P04).
  - `submitAttempt(input: { user: User; questionVersionId: ObjectId; loId: ObjectId; mode: PracticeMode; selectedKey: string; sessionServedIds: ObjectId[]; isRetry?: boolean; paramValues?: Record<string, number> }): Promise<AttemptResult>` where

```ts
export interface AttemptResult {
  correct: boolean;
  feedback: {
    strategy: AppliedStrategy;
    // Strategy B or correct: every option with role + explanation.
    // Strategy A miss: only the chosen option's entry; other explanations withheld.
    revealed: Array<{ key: string; text: string; role: OptionRole; explanation: string; correct: boolean }>;
    retry?: { questionId: string; questionVersionId: string; type: QuestionType; stem: string; options: Array<{ key: string; text: string }> };
  };
  mastery: { loStatus: MasteryStatus; recommendation?: 'advance-lo' | 'advance-theme' };
  reviewBook: { added: boolean };
}
```

  Behaviour: writes the AttemptRecord (pinning version, LO context, mode, applied strategy, difficulty from the version, paramValues, isRetry) → updates mastery (retry attempts are independent full-weight attempts) → on any miss, upserts the ReviewBookEntry **immediately regardless of retry outcome** (one entry per question; repeat miss updates `triggeringAttemptId`/`updatedAt`) → Strategy A miss additionally calls `selectRetryQuestion`; no retry available ⇒ degrade to full reveal (`strategy` stays `'a'`, `revealed` becomes all options — the §5.1 degradation) → `recommendation: 'advance-lo'` when this attempt flipped the LO to covered; `'advance-theme'` when the theme is now covered (ST-P05 backend).
  - Routes (`practice.routes.ts`, student-guarded): `POST /api/courses/:courseId/practice/next` (serves via `selectNextQuestion`; response **never** contains roles, explanations, or correctness — only `{ key, text }` options + `watermark: user.uid`), `POST /api/attempts`, `POST /api/courses/:courseId/los/:loId/skip`, `GET /api/courses/:courseId/home` (via `studentCourseHome`), `GET /api/courses/:courseId/session-summary` (last session's attempts grouped by LO + deferred summary — see Task 12's session model).

**Note (post-implementation, Stephen 2026-07-17):** `AttemptRecord.themeId`/`ReviewBookEntry.themeId` must be derived from the theme owning the served `loId` (a `losCol()` lookup), **not** `question.themeIds[0]` — a question's `loIds`/`themeIds` are independently-populated many-to-many tag lists, so an arbitrary array index can silently pin the wrong theme for a question tagged across multiple themes, corrupting the `themeCoverage()` check behind `recommendation: 'advance-theme'`. `losCol()` is therefore a required Consumes entry this section omitted. `recommendation`'s precedence when one attempt both completes an LO and its theme: `'advance-theme'` supersedes `'advance-lo'` (a documented interpretation, not stated explicitly above). ⚠️ Cross-task, pre-existing, not fixed here: `editQuestion` (Task 4) doesn't reset `state` to `draft` on a post-approval edit, so `submitAttempt`'s `state === 'approved'` gate alone doesn't catch a student holding a stale `questionVersionId` from before the edit — raise at the Task 16 exit review.

- [x] **Step 1: Write the failing tests** — the second-highest-value file. `attempts.service.test.ts` cases:

```
1. decideStrategy truth table (6 cases: 3 course settings × CM/other roles)
2. correct answer -> revealed includes all options; no review-book write
3. adaptive + CM miss -> revealed has ONLY the chosen option; retry question returned;
   review-book entry upserted BEFORE the retry resolves
4. adaptive + CM miss with no retry available -> full reveal, no retry field
5. adaptive + clearly-wrong miss -> strategy 'b', full reveal
6. B-locked + CM miss -> strategy 'b' (lock wins)
7. repeat miss on the same question -> reviewBook upsert (no second entry), updatedAt advanced
8. retry attempt writes AttemptRecord with isRetry:true and full mastery weight
   (mastery service called identically)
9. AttemptRecord pins questionVersionId, loId, mode, strategy, difficulty
10. attempt on a non-approved question version's head -> throws 'question-not-servable'
    (Approved-only serving verified at the submission boundary too)
```

`practice.routes.test.ts`: `/practice/next` response contains no `role`/`explanation` keys anywhere (walk the JSON); 403 non-enrolled; skip endpoint 204.

- [x] **Step 2: Verify FAIL.** Step 3: **Implement** service + routes. Step 4: **Tests + typecheck PASS.**
- [x] **Step 5: Commit** — `git commit -m "feat: attempt submission with adaptive feedback strategies, retry gate, and review-book auto-collection (ST-P04, ST-R01)"`

---

### Task 12: Review Book service + session summaries (ST-R02–R07, ST-P10/P11)

**Owner:** Dev A

**Files:**
- Create: `server/src/services/review-book.service.ts`
- Create: `server/src/routes/review-book.routes.ts`
- Modify: `server/src/routes/practice.routes.ts` (session-summary endpoints call this service)
- Modify: `server/src/app.ts`
- Test: `tests/unit/review-book.service.test.ts`

**Interfaces:**
- Consumes: `reviewBookCol()`, `attemptsCol()`, `questionsCol()`, `questionVersionsCol()`; domain types.
- Produces:
  - `toggleBookmark(puid, courseId, questionId): Promise<{ bookmarked: boolean }>` — adds/removes `'bookmark'` in `sources`; entry removed only when `sources` becomes empty (an auto+bookmark entry survives un-bookmarking, ST-R02).
  - `removeEntry(puid, entryId): Promise<void>` — deletes the entry only; never touches attemptRecords (ST-R03).
  - `listReviewBook(puid, courseId, sort: 'theme' | 'type' | 'date' | 'difficulty-asc' | 'difficulty-desc' | 'random'): Promise<Array<{ theme: Theme; entries: Array<ReviewBookEntry & { question: { stem: string; type: QuestionType; difficulty: Difficulty }; sources }> }>>` — default collapsed Theme grouping with counts (ST-R05). *Slip guidance: if tight, ship `theme` + `date` sorts only (phase doc slip #4).*
  - `sessionEndSummary(puid, courseId, since: Date)` → `{ losCovered, questionsAttempted, accuracyByLo, reviewBookAdditions, missedQuestions }` — missed list sourced from the same entries as auto-collection, not a divergent list (ST-R06).
  - Session model: a session = attempts since the client-provided session start (`since` timestamp held client-side); deferral = `PUT /api/courses/:courseId/deferred-summary` storing the summary payload on a `sessionSummaries` collection keyed `(puid, courseId)` (add the collection accessor + index `{ puid: 1, courseId: 1 }` unique to `collections.ts`); `GET /api/courses/:courseId/session-summary` returns `{ deferred?: <stored>, welcome: boolean }` — `welcome: true` when the student has no attempts in the course yet (ST-P11 first-session welcome).
  - Re-practice needs no new serving code: the client calls `POST /api/attempts` with `mode: 'review-book'` on the stored question (fresh attempt, full feedback, full mastery weight — ST-R03; parameterized re-randomization arrives with Phase 2's param execution).
- Routes per contract: `GET /api/courses/:courseId/review-book?sort=`, `POST/DELETE /api/questions/:questionId/bookmark`, `DELETE /api/review-book/:entryId`, the two summary endpoints.

- [ ] **Step 1: Failing tests** — bookmark toggle on an auto-collected entry keeps the entry with `sources: ['auto']`; bookmark on a never-missed question creates `sources: ['bookmark']`; removeEntry never calls attemptsCol; listReviewBook groups by theme with counts and honours `date` sort; sessionEndSummary's `missedQuestions` ids equal the reviewBook additions in the window.
- [ ] **Step 2: Verify FAIL.** Step 3: **Implement.** Step 4: **PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: review book browsing, bookmarking, and session summaries (ST-R02..R07, ST-P10/P11)"`

---

### Task 13: Layer-2 LLM mastery evaluator (PRD §9.2) — *pre-approved fallback: slip if not stable by Aug 9*

**Owner:** Either developer — whoever is ahead (coordinate before starting; it modifies Dev A's `attempts.service.ts`).

**Files:**
- Create: `server/src/services/mastery-evaluator.service.ts`
- Modify: `server/src/services/attempts.service.ts` (cadence trigger)
- Test: `tests/unit/mastery-evaluator.service.test.ts`

**Interfaces:**
- Consumes: llm component with `env.llmModelMasteryEvaluator`; jobs component; `masteryCol()`, `attemptsCol()`, `questionsCol()`.
- Produces: job `mastery.evaluate` with data `{ puid, courseId, loId }`: loads full attempt history for the LO + Layer-1 stats + the LO's actual bank composition (counts per difficulty) → prompts the evaluator → `{ status: 'covered' | 'in-progress' | 'struggling', rationale: string, recommendedType?: string }` → writes `status`/`rationale`, resets `attemptsSinceEvaluation`. Bank-constrained: prompt includes the available difficulty tiers so a thin bank never yields a recommendation for a tier that doesn't exist. Cadence: `attempts.service` enqueues when `attemptsSinceEvaluation >= 5`; **fast-track** bypass — enqueue immediately when the last two attempts both selected `clearly-wrong` options. Evaluation is async and never blocks the feedback response.

- [ ] **Step 1: Failing tests** — cadence: 5th attempt enqueues, 4th doesn't; fast-track on two consecutive clearly-wrong; evaluator job writes status+rationale and resets the counter; LLM returning invalid JSON leaves the profile unchanged (Layer-1 status stands — safe failure).
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: Layer-2 LLM mastery evaluator with batched cadence and disengaged fast-track (§9.2)"`

---

### Task 14: Student client views (ST-P01–P04, P06, P08, P10, P11 + Review Book UI)

**Owner:** Dev A

**Files:**
- Create: `client/src/views/student/course-home.ts` (theme list + coverage indicators + session-start summary)
- Create: `client/src/views/student/lo-list.ts`
- Create: `client/src/views/student/practice.ts` (question view + feedback + transcript + skip + retry gate)
- Create: `client/src/views/student/review-book.ts`
- Create: `client/src/views/student/session-summary.ts`
- Create: `client/src/practice-session.ts` (session state: `sessionServedIds`, transcript entries, session start time)
- Modify: `client/src/main.ts` / `client/src/router.ts` routes; `client/src/views/home.ts` (student branch lists enrolled courses + "Add a course" join control per ST-E02)
- Modify: `client/public/styles/main.css`

**Interfaces:**
- Consumes: the practice/review-book/enrollment endpoints (contract), `renderRichText`, existing `api.ts` fetch helper, router.
- Produces: hash routes `#/course/:id` (home), `#/course/:id/theme/:themeId` (LO list), `#/course/:id/practice/:loId` and `#/course/:id/practice-theme/:themeId` (practice), `#/course/:id/review-book`, `#/course/:id/summary`. The router only supports exact paths — extend `startRouter`'s `resolve` with a param-pattern matcher (`/course/:id` style, returning `params: Record<string, string>` to the render function; update the `Route` type accordingly and keep existing routes working).

Key behaviours to implement (each is small, concrete DOM code following the existing views' style):
- **Course home:** fetch `/api/courses/:id/home`; theme cards with coverage indicator (fraction of LOs covered), "Practice this Theme" button, hidden future themes already filtered server-side; empty state "no practice topics available yet"; session-start summary banner (deferred summary or welcome) — dismissible (ST-P11).
- **LO list:** ordered rows with status label (Not attempted / In progress / Covered / Struggling), "Start practice" jumps to first uncovered LO; any row clickable (ST-P02).
- **Practice view:** exactly one question; options as radio-style buttons, selection changeable until **Submit**; submit posts the attempt and renders feedback inline without navigation; options lock; Strategy-A retry renders the retry question in place with original explanations withheld until resolved; "Skip this LO" button posts the skip with `attempted` derived from whether any attempt happened this session on the LO; scrollable transcript of prior Q&A above the live question with a "practice this LO more" link per entry (ST-P03/P04/P06/P08); the student's `uid` watermark rendered on the question card (light corner text, PRD §4.1); "End session" → summary view.
- **Review Book:** collapsed theme groups with counts; expanding lists entries (auto vs bookmark badges); sort dropdown; "Re-practice" serves the stored question and submits with `mode: 'review-book'`; remove button per entry; empty state (ST-R05).
- **Session summary:** counts, accuracy per LO, missed list with links; "Defer to next session" PUTs the deferred summary (ST-P10/R06).

- [ ] **Step 1: Extend the router with param matching + unit-test it** (`tests/unit/client-router.test.ts` via jsdom test env if configured; otherwise a pure function test on the extracted `matchRoute(pattern, path)` helper — write `matchRoute` as a pure export precisely so it's testable without a DOM).
- [ ] **Step 2: Build the views one route at a time**, verifying each in the browser against seeded data (use the instructor UI from Task 15 or curl to seed). Keep each view file under ~200 lines; shared bits (option buttons, status badge) go in `client/src/ui.ts`.
- [ ] **Step 3: Typecheck + lint after each view.** Run: `npm run typecheck && npm run lint` → PASS.
- [ ] **Step 4: Playwright happy-path spec** `tests/e2e/practice-loop.spec.ts`: student joins course (pre-seeded via API in the spec's beforeAll using an instructor session), practices one question, sees feedback, misses one, finds it in the Review Book. Run: `npm run test:e2e -- tests/e2e/practice-loop.spec.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: student practice, review book, and session summary views (ST-P01..P11, ST-R05)"`

---

### Task 15: Instructor client views (IN-S01–S06, IN-Q02–Q05, IN-Q08, IN-Q10, IN-L06)

**Owner:** Dev B

**Files:**
- Create: `client/src/views/instructor/course-setup.ts` (create course; hierarchy tree with add/rename/archive/reorder; term dates; registration code; publish checklist)
- Create: `client/src/views/instructor/materials.ts` (upload, status list with retry, assignment UI, classification accept/modify/reject)
- Create: `client/src/views/instructor/bank.ts` (browse/filter table + tree view with counts)
- Create: `client/src/views/instructor/review-queue.ts` (queue with agent decision + reasoning, edit form, approve/reject/bulk-approve)
- Create: `client/src/views/instructor/preseeding.ts` (per-LO progress vs 3–5 target + one-click generate)
- Modify: router/main/home (instructor branch), `main.css`

**Interfaces:**
- Consumes: courses/materials/questions/generation endpoints (contract); `renderRichText` for stems/explanations in the queue.
- Produces: hash routes `#/instructor/course/:id/{setup,materials,bank,queue,preseeding}`.

Key behaviours: duplicate-name inline warning (non-blocking) on theme/LO create; edited-field highlighting in the editor (compare against the loaded version, add a `.edited` class); approve moves state immediately and updates the row without reload; bulk approve asks `confirm()` with the count; publish shows the checklist with warnings but allows publishing; upload form accepts multiple files + a URL field, polls `GET /materials` every 3s while any material is `processing`.

- [ ] **Step 1: Build views route by route against the live API** (same discipline as Task 14).
- [ ] **Step 2: Typecheck + lint.** → PASS.
- [ ] **Step 3: Playwright spec** `tests/e2e/instructor-pipeline.spec.ts`: create course → add theme/LO → upload fixture material → generate for the LO (skip if no LLM configured in CI: guard with `test.skip(!process.env.LLM_AVAILABLE)`) → approve a question → publish course.
- [ ] **Step 4: Commit** — `git commit -m "feat: instructor course setup, materials, bank, review queue, and pre-seeding views"`

---

### Task 16: Phase exit — end-to-end demo test and Approved-only serving proof

**Owner:** Joint — **Sync point:** both developers participate; the demo is the phase exit gate.

**Files:**
- Create: `tests/e2e/core-loop-demo.spec.ts`
- Create: `tests/unit/approved-only-serving.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the phase exit evidence.

- [ ] **Step 1: `approved-only-serving.test.ts`** — drive `selectNextQuestion` and `submitAttempt` against fake collections seeded with questions in every one of the six publication states; assert only the `approved` one is ever selected across 50 randomized runs, and that submitting against a non-approved head throws (`question-not-servable`). Run: `npx jest tests/unit/approved-only-serving.test.ts` → PASS.
- [ ] **Step 2: `core-loop-demo.spec.ts`** — the phase-doc demo as one Playwright flow: instructor creates course → uploads material → generates (or seeds via API when `!LLM_AVAILABLE`) → approves → student enrolls with code → practices with adaptive feedback → a miss lands in the Review Book → re-practice updates mastery (assert LO status text changed). Run: `npm run test:e2e -- tests/e2e/core-loop-demo.spec.ts` → PASS.
- [ ] **Step 3: Full suite + CI green.** Run: `npm run lint && npm run typecheck && npm test && npm run test:e2e` → PASS.
- [ ] **Step 4: Commit** — `git commit -m "test: phase-1 exit — core-loop demo e2e and approved-only serving proof"`

---

## Exit criteria checklist (from phase-1-core-loop.md)

- [ ] Demo flow passes end to end (Task 16).
- [ ] Jest/supertest coverage: publication-state transitions (Task 4), selection degradation ladder (Task 10), feedback-strategy dispatch (Task 11), auth-gated endpoints (Tasks 2–5, 11).
- [ ] No unreviewed content can reach a student — verified by test (Task 16).
- [ ] Mid-phase checkpoint hit (~Aug 2): Task 8 Step 5.

## Slip order (lowest first, from the phase doc)

1. Embedded-question auto-detection — *not planned as a task; explicitly deferred to Phase 2+ backlog.*
2. Layer-2 mastery evaluator (Task 13) — Layer-1 statuses from Task 9 stand alone.
3. AI-suggested hierarchy (Task 7's `suggestHierarchy` only).
4. Review Book sorts beyond theme/date (Task 12).
