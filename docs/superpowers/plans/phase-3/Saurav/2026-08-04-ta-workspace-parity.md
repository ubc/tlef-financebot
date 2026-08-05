# TA Workspace Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner:** Saurav
**Created:** 2026-08-04
**Status:** **All 7 tasks implemented and merged** — PR #62 (`saurav/instructor-ta-view`), landed on `main` as `ecced1f`, 2026-08-04. Checkboxes reconciled 2026-08-05; three manual browser checks in "Final verification" remain unticked — see that section.
**Traces to:** [`../2026-07-11-phase-3-full-surface.md`](../2026-07-11-phase-3-full-surface.md) Task 6 (TA management + TA workflows, IN-T01–T03, TA-01–TA-04)

**Goal:** Rebuild the two TA views so they mirror their instructor counterparts
in layout and interaction while exposing only TA-permitted actions, and make TA
escalations visible to instructors.

**Why now:** Phase 3 Task 6 line 181 specified the TA review queue as *"same
data as the instructor queue (TA-01) but the payload/UI carry **no
approve/reject affordances**"*. The server honoured that; the client did not.
`views/ta/review-queue.ts` (90 lines) and `views/ta/flag-triage.ts` (92 lines)
are bare stacks of `<article class="card">` with raw textareas, against
`views/instructor/review-queue.ts` (448 lines) and `views/instructor/flags.ts`
(730 lines) with filter tabs, sortable tables, grouped rows and status badges.
A TA and an instructor looking at the same course see two unrelated products.

**Architecture:** No new data. Both TA views already receive richer payloads
than they render (`TaReviewQueueItem extends ReviewQueueItem`, and
`listTaFlags` returns the same joined `Flag[]` as `listCourseFlags`). The work
is therefore: (1) one new read-only server endpoint for the Topic/LO labels a
TA currently cannot fetch, (2) extract the instructor views' pure grouping and
labelling logic into DOM-free modules both sides import, and (3) rewrite the
two TA views plus a new TA question page on top of them.

**Tech Stack:** TypeScript strict; plain-TS bundler-free client (native ES
modules, `.js` import extensions); Express + MongoDB native driver server;
Jest + ts-jest + supertest.

## Global Constraints

- TypeScript `strict` mode everywhere; server compiles to CommonJS, client is native ES modules — **client imports use the explicit `.js` extension**, including into subfolders (`client/AGENTS.md`).
- Permissions are configuration, not code (PRD §4.2): every capability is an independently assignable toggle; **TAs never get approve/reject regardless of configuration** (phase-3 constraint, line 17). No task in this plan may add an approve, reject, resolve, or question-edit affordance to a TA view.
- Routes delegate to services; services compose components. No business logic in routes.
- Follow the per-folder `AGENTS.md` closest to any file you edit.
- Shared-file convention (root `AGENTS.md`): `package.json`, `server/src/server.ts`, `.env.example`, `client/public/index.html` are append-only, one line/block per addition.
- No new client dependencies — there is no bundler; third-party browser libs must be vendored.
- Every task ends green on `npm run typecheck`, `npx eslint <changed files>`, and `npx jest`.

## Prerequisite

Branch `saurav/instructor-ta-view` (commit `a455bc3`) must be on `main` first —
it adds the "View as TA" entry point used to exercise these views by hand. It
does **not** substitute for testing with a real TA account; see "Testing note"
below.

**Testing note (read before Task 1):** an instructor in "View as TA" passes
every `ensureCapability` check on their own course, so *capability-denial bugs
are invisible in that mode*. Finding 1 below is exactly such a bug and went
unnoticed for that reason. Verify each task with a genuine `ta` courseRole
account, not only the instructor's TA view.

## Findings this plan fixes

1. **A real TA 403s on the Topic/LO column.** Both instructor views call
   `getCourseTree()` → `GET /api/courses/:courseId`, guarded by
   `ensureCourseInstructor()` (`server/src/routes/courses.routes.ts:151-154`).
   Mirroring the instructor layout requires an endpoint a TA can actually call.
   Fixed in Task 1.
2. **TA escalations are invisible to instructors.** `escalateFlag()` persists
   `flag.taRecommendation` (`server/src/services/tas.service.ts`;
   `server/src/types/domain.ts:558`) and `listFlags()` spreads the whole
   document, so the recommendation and note are already on the wire. But the
   client `Flag` interface does not declare the field and
   `views/instructor/flags.ts` never renders it — `openFlags()` (line 104)
   treats `escalated` identically to `open`. The TA writes a recommendation
   nobody reads. Phase 3 Task 6 line 183 intended escalation to "land in the
   instructor priority queue". Fixed in Task 6.

## File Structure

**Created:**
- `client/src/flag-groups.ts` — DOM-free flag grouping/sorting/escalation logic, shared by the instructor and TA flag views. Extracted from `views/instructor/flags.ts` so both sides group identically by construction.
- `client/src/views/ta/ta-ui.ts` — TA-side shared presentation helpers: `topicLoLabel` over the outline shape, `pendingSuggestionCount`, `buildSuggestionPatch`.
- `client/src/views/ta/question-detail.ts` — the TA question page (read-only question + suggest edit + internal note + escalate).
- `tests/unit/course-outline.routes.test.ts`, `tests/unit/flag-groups.test.ts`, `tests/unit/ta-ui.test.ts`.

**Modified:**
- `server/src/services/courses.service.ts` — add `getCourseOutline()`.
- `server/src/routes/courses.routes.ts` — add `GET /courses/:courseId/outline`.
- `client/src/api.ts` — add `getCourseOutline()` + outline types; add `taRecommendation`/`raisedBy` to `Flag`; widen `Flag.source` to include `'ta'`.
- `client/src/views/instructor/flags.ts` — import the extracted grouping module; render escalations.
- `client/src/views/ta/review-queue.ts` — full rewrite.
- `client/src/views/ta/flag-triage.ts` — full rewrite.
- `client/src/main.ts` — register the TA question route; keep Review Queue nav active on it.
- `docs/api-contract.md` — document the new endpoint.

**Deliberately not touched:** `views/instructor/review-queue.ts` (its
`matchesTab`/`queueTabCounts` are already exported and unit-tested — the TA
queue imports them as-is), and `views/instructor/question-detail.ts` (983
lines; the TA page is a separate, much smaller read-only view rather than a
permission-flagged fork of it).

---

### Task 1: Course outline endpoint a TA can call

**Files:**
- Modify: `server/src/services/courses.service.ts` (add `getCourseOutline` beside the existing `getCourseTree`)
- Modify: `server/src/routes/courses.routes.ts` (add route; extend the auth import)
- Modify: `docs/api-contract.md` (§ "Courses (instructor)", line 40)
- Test: `tests/unit/course-outline.routes.test.ts` (create)

**Interfaces:**
- Produces: `getCourseOutline(courseId: ObjectId): Promise<{ themes: CourseOutlineTheme[] }>` where `CourseOutlineTheme = { _id: ObjectId; name: string; order: number; los: Array<{ _id: ObjectId; name: string; order: number }> }`. Consumed by Task 2's client wrapper.

**Why a new endpoint rather than loosening the existing one:** `GET
/api/courses/:courseId` returns the full course record — `registrationCode`,
`termStart`/`termEnd`, `autoPause`, `feedbackStrategy`, `published`. A TA needs
none of it to render "Topic 1 / LO 2". This endpoint returns theme and LO
names and order only.

- [x] **Step 1: Write the failing test**

Create `tests/unit/course-outline.routes.test.ts`. Model the auth harness on
`tests/unit/ta-routes.test.ts` — the same `hasCapability` mock encodes the TA
invariant (TAs never get `question.approve`/`flag.resolve`).

```ts
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { Capability, User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/capabilities.service', () => {
  const actual = jest.requireActual('../../server/src/services/capabilities.service') as object;
  return {
    ...actual,
    hasCapability: jest.fn(async (user: User, courseId: ObjectId, capability: Capability) => {
      const role = user.courseRoles.find((entry) => entry.courseId.equals(courseId))?.role;
      if (user.isAdmin || role === 'instructor') return true;
      if (role !== 'ta') return false;
      return capability !== 'question.approve' && capability !== 'flag.resolve';
    }),
  };
});
jest.mock('../../server/src/services/courses.service', () => ({
  getCourseOutline: jest.fn(),
}));

import { coursesRouter } from '../../server/src/routes/courses.routes';
import { getCourseOutline } from '../../server/src/services/courses.service';

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();

function user(role: 'ta' | 'instructor' | 'student'): User {
  return {
    puid: `PUID-${role}`, uid: role, displayName: role, email: `${role}@ubc.ca`,
    affiliations: ['staff'], isAdmin: false, courseRoles: [{ courseId, role }],
    createdAt: new Date(), lastLoginAt: new Date(),
  };
}

function makeApp(as?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(as);
    (req as { user?: unknown }).user = as;
    next();
  });
  app.use('/api', coursesRouter);
  return app;
}

describe('GET /api/courses/:courseId/outline', () => {
  beforeEach(() => {
    (getCourseOutline as jest.Mock).mockResolvedValue({
      themes: [{ _id: themeId, name: 'Time Value of Money', order: 0, los: [{ _id: loId, name: 'Discounting', order: 0 }] }],
    });
  });

  it('serves a TA (question.review), who is 403d by the instructor-only course endpoint', async () => {
    const res = await request(makeApp(user('ta'))).get(`/api/courses/${courseId.toString()}/outline`);
    expect(res.status).toBe(200);
    expect(res.body.themes[0].los[0].name).toBe('Discounting');
  });

  it('serves an instructor', async () => {
    const res = await request(makeApp(user('instructor'))).get(`/api/courses/${courseId.toString()}/outline`);
    expect(res.status).toBe(200);
  });

  it('403s a student', async () => {
    const res = await request(makeApp(user('student'))).get(`/api/courses/${courseId.toString()}/outline`);
    expect(res.status).toBe(403);
  });

  it('401s an anonymous caller', async () => {
    const res = await request(makeApp()).get(`/api/courses/${courseId.toString()}/outline`);
    expect(res.status).toBe(401);
  });

  it('never leaks the course record fields a TA has no business seeing', async () => {
    const res = await request(makeApp(user('ta'))).get(`/api/courses/${courseId.toString()}/outline`);
    expect(Object.keys(res.body)).toEqual(['themes']);
    for (const key of ['registrationCode', 'termStart', 'termEnd', 'autoPause', 'feedbackStrategy', 'published']) {
      expect(res.body[key]).toBeUndefined();
    }
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/course-outline.routes.test.ts`
Expected: FAIL — `getCourseOutline is not a function` / 404 on the route.

- [x] **Step 3: Add the service function**

In `server/src/services/courses.service.ts`, beside `getCourseTree`. Note it
does **not** call `getCourse()` — the point is to avoid loading the course
record at all.

```ts
export interface CourseOutlineTheme {
  _id: ObjectId;
  name: string;
  order: number;
  los: Array<{ _id: ObjectId; name: string; order: number }>;
}

/** Theme/LO names and order only — the minimum a `question.review` holder
 * needs to label a question "Topic 1 / LO 2". Deliberately NOT the course
 * record: `getCourseTree` (instructor-only) carries registrationCode, term
 * dates, autoPause and feedbackStrategy, none of which a TA should receive. */
export async function getCourseOutline(courseId: ObjectId): Promise<{ themes: CourseOutlineTheme[] }> {
  const [themes, los] = await Promise.all([
    themesCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
  ]);
  return {
    themes: themes.map((theme) => ({
      _id: theme._id,
      name: theme.name,
      order: theme.order,
      los: los
        .filter((lo) => lo.themeId.equals(theme._id))
        .map((lo) => ({ _id: lo._id, name: lo.name, order: lo.order })),
    })),
  };
}
```

- [x] **Step 4: Add the route**

In `server/src/routes/courses.routes.ts`. Extend the existing auth import to
include `ensureCapability` (it is exported from `../components/auth`, as
`questions.routes.ts` line 5 does). `ensureCapability` performs its own
authentication check, so no `ensureApiAuthenticated()` precedes it — mirroring
`questions.routes.ts:256-259`. Place this **after** the existing
`GET /courses/:courseId` block; segment counts differ so ordering is not
load-bearing, but keeping course-scoped sub-resources below the base route
matches the file's existing shape.

```ts
coursesRouter.get(
  '/courses/:courseId/outline',
  validate({ params: courseIdParams }),
  ensureCapability('question.review'),
  async (req, res) => {
    res.json(await getCourseOutline(new ObjectId(String(req.params.courseId))));
  },
);
```

Add `getCourseOutline` to the existing `courses.service` import in this file.

- [x] **Step 5: Run the test to verify it passes**

Run: `npx jest tests/unit/course-outline.routes.test.ts`
Expected: PASS, 5/5.

- [x] **Step 6: Document the endpoint**

In `docs/api-contract.md`, under `## Courses (instructor)` (line 40), add a row
for `GET /api/courses/:courseId/outline` — capability `question.review`,
returns `{ themes: [{ _id, name, order, los: [{ _id, name, order }] }] }`, and
note it is the TA-accessible subset of `GET /api/courses/:courseId`.

- [x] **Step 7: Full verification and commit**

```bash
npm run typecheck && npx eslint server/src/services/courses.service.ts server/src/routes/courses.routes.ts && npx jest
git add server/src/services/courses.service.ts server/src/routes/courses.routes.ts docs/api-contract.md tests/unit/course-outline.routes.test.ts
git commit -m "feat(courses): read-only course outline endpoint for question.review holders"
```

---

### Task 2: Client outline wrapper + TA presentation helpers

**Files:**
- Modify: `client/src/api.ts` (add outline types + `getCourseOutline`)
- Create: `client/src/views/ta/ta-ui.ts`
- Test: `tests/unit/ta-ui.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's `GET /api/courses/:courseId/outline`.
- Produces:
  - `getCourseOutline(courseId: string): Promise<CourseOutline>` where `CourseOutline = { themes: CourseOutlineTheme[] }`, `CourseOutlineTheme = { _id: string; name: string; order: number; los: CourseOutlineLo[] }`, `CourseOutlineLo = { _id: string; name: string; order: number }`.
  - `topicLoLabel(outline: CourseOutline, loIds: string[], themeIds: string[]): string`
  - `pendingSuggestionCount(item: { suggestions: QuestionSuggestion[] }): number`
  - `buildSuggestionPatch(original, draft): QuestionSuggestion['patch'] | null`

All three helpers are DOM-free so they unit-test without jsdom.

- [x] **Step 1: Write the failing test**

Create `tests/unit/ta-ui.test.ts`:

```ts
// Pure-logic tests for the TA views' shared helpers. DOM-free by design —
// see client/src/views/ta/ta-ui.ts.
import {
  buildSuggestionPatch,
  pendingSuggestionCount,
  topicLoLabel,
  type CourseOutlineForLabel,
} from '../../client/src/views/ta/ta-ui';

const outline: CourseOutlineForLabel = {
  themes: [
    { _id: 't1', name: 'Time Value of Money', order: 0, los: [{ _id: 'l1', name: 'Discounting', order: 0 }, { _id: 'l2', name: 'Annuities', order: 1 }] },
    { _id: 't2', name: 'Risk', order: 1, los: [{ _id: 'l3', name: 'Beta', order: 0 }] },
  ],
};

describe('topicLoLabel', () => {
  it('numbers topics and LOs by position, one-indexed', () => {
    expect(topicLoLabel(outline, ['l2'], [])).toBe('Topic 1 / LO 2');
  });

  it('joins multiple LOs within a topic and multiple topics with a semicolon', () => {
    expect(topicLoLabel(outline, ['l1', 'l2'], [])).toBe('Topic 1 / LO 1, LO 2');
    expect(topicLoLabel(outline, ['l1', 'l3'], [])).toBe('Topic 1 / LO 1; Topic 2 / LO 1');
  });

  it('falls back to the bare topic when only a themeId matches', () => {
    expect(topicLoLabel(outline, [], ['t2'])).toBe('Topic 2');
  });

  it('renders an em dash when nothing matches', () => {
    expect(topicLoLabel(outline, ['nope'], [])).toBe('—');
    expect(topicLoLabel(outline, [], [])).toBe('—');
  });
});

describe('pendingSuggestionCount', () => {
  const at = '2026-08-01T00:00:00.000Z';
  it('counts only pending suggestions', () => {
    expect(pendingSuggestionCount({ suggestions: [
      { id: 's1', puid: 'p', patch: { stem: 'a' }, status: 'pending', at },
      { id: 's2', puid: 'p', patch: { stem: 'b' }, status: 'accepted', at },
      { id: 's3', puid: 'p', patch: { stem: 'c' }, status: 'discarded', at },
    ] })).toBe(1);
  });

  it('is 0 for an empty list', () => {
    expect(pendingSuggestionCount({ suggestions: [] })).toBe(0);
  });
});

describe('buildSuggestionPatch', () => {
  const original = { stem: 'What is NPV?', difficulty: 'medium' as const };

  it('returns null when nothing changed — an empty suggestion is never submitted', () => {
    expect(buildSuggestionPatch(original, { stem: 'What is NPV?', difficulty: 'medium' })).toBeNull();
  });

  it('returns null when the draft stem is only whitespace', () => {
    expect(buildSuggestionPatch(original, { stem: '   ', difficulty: 'medium' })).toBeNull();
  });

  it('includes only the fields that actually changed', () => {
    expect(buildSuggestionPatch(original, { stem: 'What is net present value?', difficulty: 'medium' }))
      .toEqual({ stem: 'What is net present value?' });
    expect(buildSuggestionPatch(original, { stem: 'What is NPV?', difficulty: 'hard' }))
      .toEqual({ difficulty: 'hard' });
    expect(buildSuggestionPatch(original, { stem: 'Define NPV.', difficulty: 'hard' }))
      .toEqual({ stem: 'Define NPV.', difficulty: 'hard' });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/ta-ui.test.ts`
Expected: FAIL — cannot find module `client/src/views/ta/ta-ui`.

- [x] **Step 3: Add the API wrapper**

In `client/src/api.ts`, beside `getCourseTree` (line 908):

```ts
export interface CourseOutlineLo {
  _id: string;
  name: string;
  order: number;
}

export interface CourseOutlineTheme {
  _id: string;
  name: string;
  order: number;
  los: CourseOutlineLo[];
}

export interface CourseOutline {
  themes: CourseOutlineTheme[];
}

/** GET /api/courses/:courseId/outline -> theme/LO names + order only. The
 * TA-accessible subset of `getCourseTree` (which is instructor-only): a
 * `question.review` holder can call this, and it carries none of the course
 * record. */
export function getCourseOutline(courseId: string): Promise<CourseOutline> {
  return request<CourseOutline>(`/api/courses/${encodeURIComponent(courseId)}/outline`);
}
```

- [x] **Step 4: Write the helpers**

Create `client/src/views/ta/ta-ui.ts`:

```ts
// Shared, DOM-free helpers for the TA workspace views (review queue, flag
// triage, question page). Kept out of the view files so they unit-test
// without jsdom — same split as views/instructor/review-queue.ts's exported
// `matchesTab`/`queueTabCounts`.
import type { CourseOutline, Difficulty, QuestionSuggestion } from '../../api.js';

/** The shape `topicLoLabel` actually reads. Structurally satisfied by
 * `CourseOutline`; named separately so the test fixture doesn't have to
 * import the full API type. */
export type CourseOutlineForLabel = CourseOutline;

/** "Topic 1 / LO 1, LO 4" — the same convention bank.ts, review-queue.ts and
 * flags.ts each keep a private copy of, over the outline shape rather than
 * the instructor-only CourseTree. One copy here, shared by every TA view. */
export function topicLoLabel(outline: CourseOutlineForLabel, loIds: string[], themeIds: string[]): string {
  const parts: string[] = [];
  outline.themes.forEach((theme, themeIndex) => {
    const los = theme.los.filter((lo) => loIds.includes(lo._id));
    if (los.length > 0) {
      const loLabels = los
        .map((lo) => `LO ${theme.los.findIndex((candidate) => candidate._id === lo._id) + 1}`)
        .join(', ');
      parts.push(`Topic ${themeIndex + 1} / ${loLabels}`);
    } else if (themeIds.includes(theme._id)) {
      parts.push(`Topic ${themeIndex + 1}`);
    }
  });
  return parts.length ? parts.join('; ') : '—';
}

/** How many of a question's TA suggestions are still awaiting an instructor
 * decision — the queue row's "N pending" affordance. */
export function pendingSuggestionCount(item: { suggestions: QuestionSuggestion[] }): number {
  return item.suggestions.filter((suggestion) => suggestion.status === 'pending').length;
}

/** Builds the minimal patch for a suggested edit, or `null` when the draft is
 * unchanged (or blank). Returning `null` is what lets the view disable Submit
 * instead of POSTing an empty suggestion an instructor then has to triage —
 * the current TA queue submits `{ stem }` unconditionally, so re-clicking
 * "Suggest edit" without typing files a duplicate no-op suggestion. */
export function buildSuggestionPatch(
  original: { stem: string; difficulty?: Difficulty },
  draft: { stem: string; difficulty?: Difficulty },
): QuestionSuggestion['patch'] | null {
  const patch: QuestionSuggestion['patch'] = {};
  if (draft.stem.trim() && draft.stem !== original.stem) patch.stem = draft.stem;
  if (draft.difficulty && draft.difficulty !== original.difficulty) patch.difficulty = draft.difficulty;
  return Object.keys(patch).length > 0 ? patch : null;
}
```

`Difficulty` and `QuestionSuggestion` are already exported from
`client/src/api.ts` (lines 1809 and the `QuestionSuggestion` block) — import
them, do not redeclare.

- [x] **Step 5: Run the test to verify it passes**

Run: `npx jest tests/unit/ta-ui.test.ts`
Expected: PASS, 9/9.

- [x] **Step 6: Commit**

```bash
npm run typecheck && npx eslint client/src/api.ts client/src/views/ta/ta-ui.ts && npx jest
git add client/src/api.ts client/src/views/ta/ta-ui.ts tests/unit/ta-ui.test.ts
git commit -m "feat(ta): course-outline client wrapper and shared TA view helpers"
```

---

### Task 3: Extract flag grouping into a shared, tested module

**Files:**
- Create: `client/src/flag-groups.ts`
- Modify: `client/src/api.ts` (add `taRecommendation` + `raisedBy` to `Flag`; widen `source`)
- Modify: `client/src/views/instructor/flags.ts` (import the extracted logic; delete the local copies)
- Test: `tests/unit/flag-groups.test.ts` (create)

**Interfaces:**
- Produces: `FlagGroup`, `groupFlags(flags: Flag[]): FlagGroup[]`, `openFlags(group: FlagGroup): Flag[]`, `isGroupOpen(group: FlagGroup): boolean`, `sortGroups(groups: FlagGroup[]): FlagGroup[]`, `latestEscalation(group: FlagGroup): TaRecommendation | null`. Consumed by Tasks 5 and 6.

**Why extract rather than copy:** the instructor and TA flag views must group
by the same key or the two sides disagree about what "one row" means. The
existing logic in `views/instructor/flags.ts:75-178` is already pure — moving
it makes it testable and makes Task 5 a rendering-only job.

This is a refactor of a working view, so the tests below characterise the
**current** behaviour before anything moves.

- [x] **Step 1: Add the missing wire fields to the client `Flag` type**

In `client/src/api.ts`, in `export interface Flag`. The server already sends
these (`server/src/types/domain.ts:552-558`; `listFlags` spreads the whole
document) — the client simply never declared them.

```ts
export interface TaRecommendation {
  recommendation: 'correct' | 'archive' | 'clear';
  note?: string;
  puid: string;
  at: string;
}
```

Then inside `Flag`, replace the `source` line and add two fields:

```ts
  source?: 'student' | 'instructor-preview-test' | 'ta';
  raisedBy?: 'student' | 'ta';
  /** Set by `POST /api/flags/:flagId/escalate` (tas.service.ts's
   * `escalateFlag`). Present on every `listFlags`/`listTaFlags` row for an
   * escalated flag — the server has always sent it; this type omitted it,
   * which is why the instructor queue never showed it. */
  taRecommendation?: TaRecommendation;
```

- [x] **Step 2: Write the failing test**

Create `tests/unit/flag-groups.test.ts`:

```ts
// Pure-logic tests for flag grouping/sorting, extracted from
// views/instructor/flags.ts so the instructor and TA flag views group
// identically. See client/src/flag-groups.ts.
import {
  groupFlags,
  isGroupOpen,
  latestEscalation,
  openFlags,
  sortGroups,
} from '../../client/src/flag-groups';
import type { Flag } from '../../client/src/api';

function flag(overrides: Partial<Flag> = {}): Flag {
  return {
    id: 'f1',
    courseId: 'c1',
    questionId: 'q1',
    questionVersionId: 'v1',
    puid: 'student-1',
    state: 'open',
    createdAt: '2026-08-01T00:00:00.000Z',
    question: null,
    currentVersion: null,
    ...overrides,
  } as Flag;
}

describe('groupFlags', () => {
  it('groups by questionVersionId, not questionId', () => {
    const groups = groupFlags([
      flag({ id: 'f1', questionVersionId: 'v1' }),
      flag({ id: 'f2', questionVersionId: 'v1' }),
      flag({ id: 'f3', questionVersionId: 'v2' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].flags.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(groups[1].flags.map((f) => f.id)).toEqual(['f3']);
  });

  it('returns an empty array for no flags', () => {
    expect(groupFlags([])).toEqual([]);
  });
});

describe('openFlags / isGroupOpen', () => {
  it('counts both open and escalated as open — an escalated flag still needs an instructor', () => {
    const [group] = groupFlags([
      flag({ id: 'f1', state: 'open' }),
      flag({ id: 'f2', state: 'escalated' }),
      flag({ id: 'f3', state: 'resolved-corrected' }),
    ]);
    expect(openFlags(group).map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(isGroupOpen(group)).toBe(true);
  });

  it('is closed when every flag is resolved', () => {
    const [group] = groupFlags([flag({ state: 'resolved-corrected' })]);
    expect(isGroupOpen(group)).toBe(false);
  });
});

describe('sortGroups', () => {
  it('puts open groups before resolved ones, newest first within each', () => {
    const groups = groupFlags([
      flag({ id: 'old-open', questionVersionId: 'v1', createdAt: '2026-07-01T00:00:00.000Z' }),
      flag({ id: 'new-resolved', questionVersionId: 'v2', state: 'resolved-corrected', createdAt: '2026-08-02T00:00:00.000Z' }),
      flag({ id: 'new-open', questionVersionId: 'v3', createdAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(sortGroups(groups).map((g) => g.flags[0].id)).toEqual(['new-open', 'old-open', 'new-resolved']);
  });

  it('does not mutate its input', () => {
    const groups = groupFlags([
      flag({ id: 'a', questionVersionId: 'v1', createdAt: '2026-07-01T00:00:00.000Z' }),
      flag({ id: 'b', questionVersionId: 'v2', createdAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    const before = groups.map((g) => g.questionVersionId);
    sortGroups(groups);
    expect(groups.map((g) => g.questionVersionId)).toEqual(before);
  });
});

describe('latestEscalation', () => {
  const rec = (at: string, recommendation: 'correct' | 'archive' | 'clear', note?: string) =>
    ({ recommendation, note, puid: 'PUID-TA', at });

  it('returns null when no flag in the group was escalated', () => {
    const [group] = groupFlags([flag()]);
    expect(latestEscalation(group)).toBeNull();
  });

  it('returns the most recent recommendation across the group', () => {
    const [group] = groupFlags([
      flag({ id: 'f1', state: 'escalated', taRecommendation: rec('2026-08-01T00:00:00.000Z', 'clear', 'looks fine') }),
      flag({ id: 'f2', state: 'escalated', taRecommendation: rec('2026-08-03T00:00:00.000Z', 'archive', 'wrong answer key') }),
    ]);
    expect(latestEscalation(group)).toEqual(rec('2026-08-03T00:00:00.000Z', 'archive', 'wrong answer key'));
  });

  it('tolerates a recommendation with no note', () => {
    const [group] = groupFlags([flag({ state: 'escalated', taRecommendation: rec('2026-08-01T00:00:00.000Z', 'correct') })]);
    expect(latestEscalation(group)?.note).toBeUndefined();
  });
});
```

- [x] **Step 3: Run the test to verify it fails**

Run: `npx jest tests/unit/flag-groups.test.ts`
Expected: FAIL — cannot find module `client/src/flag-groups`.

- [x] **Step 4: Create the module**

Create `client/src/flag-groups.ts`. Move `FlagGroup`, `groupFlags`,
`openFlags`, `isGroupOpen`, `byCreatedAtDesc` and `sortGroups` verbatim out of
`views/instructor/flags.ts:75-178` (preserving their doc comments), and add
`latestEscalation`:

```ts
// Flag grouping/sorting shared by the instructor flag queue and the TA flag
// triage view. DOM-free so it unit-tests without jsdom, and shared so the two
// views cannot drift on what constitutes "one row".
import type { Flag, TaRecommendation } from './api.js';

/** One row: every Flag raised against the same `questionVersionId`. */
export interface FlagGroup {
  questionVersionId: string;
  questionId: string;
  question: Flag['question'];
  version: Flag['currentVersion'];
  flags: Flag[];
}

export function groupFlags(flags: Flag[]): FlagGroup[] {
  const groups = new Map<string, FlagGroup>();
  for (const flag of flags) {
    let group = groups.get(flag.questionVersionId);
    if (!group) {
      group = {
        questionVersionId: flag.questionVersionId,
        questionId: flag.questionId,
        question: flag.question,
        version: flag.currentVersion,
        flags: [],
      };
      groups.set(flag.questionVersionId, group);
    }
    group.flags.push(flag);
  }
  return [...groups.values()];
}

export function openFlags(group: FlagGroup): Flag[] {
  return group.flags.filter((f) => f.state === 'open' || f.state === 'escalated');
}

export function isGroupOpen(group: FlagGroup): boolean {
  return openFlags(group).length > 0;
}

export function byCreatedAtDesc(a: Flag, b: Flag): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/** Unresolved groups first (most recently flagged first within that set),
 * then resolved groups (most recently flagged first). */
export function sortGroups(groups: FlagGroup[]): FlagGroup[] {
  return [...groups].sort((a, b) => {
    const aOpen = isGroupOpen(a);
    const bOpen = isGroupOpen(b);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    const aLatest = [...a.flags].sort(byCreatedAtDesc)[0];
    const bLatest = [...b.flags].sort(byCreatedAtDesc)[0];
    return byCreatedAtDesc(aLatest, bLatest);
  });
}

/** The most recent TA recommendation in the group, or null if no TA escalated
 * any of its flags. A group can hold several escalations (two TAs, or one TA
 * escalating two flags on the same version); the latest is the one that
 * reflects the current teaching-team position. */
export function latestEscalation(group: FlagGroup): TaRecommendation | null {
  const escalated = group.flags
    .map((flag) => flag.taRecommendation)
    .filter((recommendation): recommendation is TaRecommendation => Boolean(recommendation))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return escalated[0] ?? null;
}
```

- [x] **Step 5: Point the instructor view at the module**

In `client/src/views/instructor/flags.ts`, delete the moved declarations and
import them instead. `byCreatedAtDesc` is still used locally by
`reasonsSummary`, so export it from the module and import it here too.

```ts
import {
  byCreatedAtDesc,
  groupFlags,
  isGroupOpen,
  openFlags,
  sortGroups,
  type FlagGroup,
} from '../../flag-groups.js';
```

Everything else in the file is unchanged — `latestResolutionAction`,
`groupHasCorrectnessAffectingResolution`, `persistedNotifiedCount`,
`remediationPanel` and the rest stay put; they are instructor-only concerns
(they read `resolution`, which a TA can never write).

- [x] **Step 6: Run the tests to verify they pass, including no instructor regression**

Run: `npx jest tests/unit/flag-groups.test.ts && npx jest`
Expected: PASS. The full suite must be green — this task moved code the
instructor flag queue depends on.

- [x] **Step 7: Commit**

```bash
npm run typecheck && npx eslint client/src/flag-groups.ts client/src/views/instructor/flags.ts client/src/api.ts && npx jest
git add client/src/flag-groups.ts client/src/views/instructor/flags.ts client/src/api.ts tests/unit/flag-groups.test.ts
git commit -m "refactor(flags): extract flag grouping into a shared tested module; type taRecommendation"
```

---

### Task 4: Rewrite the TA review queue to mirror the instructor's

**Files:**
- Modify: `client/src/views/ta/review-queue.ts` (full rewrite, 90 lines → ~200)

**Interfaces:**
- Consumes: Task 2's `getCourseOutline`, `topicLoLabel`, `pendingSuggestionCount`; `matchesTab`, `queueTabCounts`, `type QueueTab` exported from `views/instructor/review-queue.js`; `STATUS_LABEL`, `TYPE_LABEL`, `statusToBadgeVariant` from `views/instructor/bank.js`; `filterTabs`, `pageHeader`, `statusBadge` from `instructor-ui.js`.
- Produces: navigation to `/ta/course/:id/question/:questionId`, implemented in Task 5.

**What changes vs. today:** the per-row stem textarea, "Suggest edit", "Add
internal note" and "Escalate question" controls all move to the question page
(Task 5). The queue becomes a scannable table: filter tabs, sort, Topic/LO,
agent decision, status, and two actions — **Review →** and **Mark reviewed**.

**Permitted actions only.** `mark-reviewed` is `question.mark-reviewed`, a TA
default. There is no Approve button and no bulk-approve control; both are
`question.approve`, which no configuration grants a TA.

- [x] **Step 1: Write the failing test**

The tab logic is already covered by `tests/unit/review-queue.test.ts` (it tests
the exported `matchesTab`/`queueTabCounts` this view imports), and
`pendingSuggestionCount` by Task 2. Add one characterisation test that the TA
queue exposes no approval affordance — a guard against a future edit
reintroducing one. Append to `tests/unit/ta-ui.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('TA review queue source', () => {
  const source = readFileSync(join(__dirname, '../../client/src/views/ta/review-queue.ts'), 'utf8');

  it('imports no approval or transition API (TAs never get question.approve)', () => {
    for (const forbidden of ['transitionQuestion', 'bulkTransition', 'editQuestion']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('renders no Approve control', () => {
    expect(source).not.toMatch(/'Approve/);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx jest tests/unit/ta-ui.test.ts`
Expected: FAIL — the current file contains no `Approve` string but this test
is written against the rewritten file; if it passes now, it still guards the
rewrite. Confirm it runs and reports on the real file path.

- [x] **Step 3: Rewrite the view**

Replace `client/src/views/ta/review-queue.ts` entirely:

```ts
// TA Review Queue (TA-01) — the instructor review queue's layout with only
// TA-permitted actions. Phase 3 Task 6 specified "same data as the instructor
// queue but the payload/UI carry no approve/reject affordances"; this view is
// that, sharing the instructor view's tab logic (`matchesTab`/`queueTabCounts`)
// and its badge/label vocabulary so the two read identically.
//
// Deliberately absent: Approve, Bulk Approve, and any editing control. Approve
// is `question.approve`, which no configuration grants a TA (phase-3 constraint).
// Suggesting an edit, annotating, and escalating live on the question page
// (views/ta/question-detail.ts) — one question at a time, like the instructor's
// Review → flow — rather than crammed into every row.
//
// Topic/LO comes from `getCourseOutline` (question.review), NOT `getCourseTree`
// (instructor-only): a real TA 403s on the latter. See ta-ui.ts.
import {
  ApiError,
  getCourseOutline,
  getQuestion,
  getTaReviewQueue,
  markTaQuestionReviewed,
  type CourseOutline,
  type TaReviewQueueItem,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { filterTabs, pageHeader, statusBadge, type BadgeVariant } from '../../instructor-ui.js';
import { renderRichText } from '../../render.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';
import { STATUS_LABEL, TYPE_LABEL, statusToBadgeVariant } from '../instructor/bank.js';
import {
  matchesTab,
  queueTabCounts,
  type QueueTab,
  type QueueTabInput,
} from '../instructor/review-queue.js';
import { pendingSuggestionCount, topicLoLabel } from './ta-ui.js';

function navigate(path: string): void {
  window.location.hash = path;
}

const QUEUE_TABS: QueueTab[] = ['all', 'flagged', 'agent-flag', 'agent-reject', 'agent-pass'];

const TAB_LABEL: Record<QueueTab, string> = {
  all: 'All',
  flagged: 'Flagged by student',
  'agent-flag': 'Agent: Flag',
  'agent-reject': 'Agent: Reject',
  'agent-pass': 'Agent: Pass',
};

const AGENT_BADGE_VARIANT: Record<'pass' | 'flag' | 'reject', BadgeVariant> = {
  pass: 'pass',
  flag: 'flag',
  reject: 'reject',
};

type SortKey = 'priority' | 'stem';

async function renderInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading TA review queue…'));
  const root = el('div', { class: 'view' }, body);
  mount(outlet, root);

  let outline: CourseOutline;
  let items: TaReviewQueueItem[];
  try {
    [outline, items] = await Promise.all([getCourseOutline(courseId), getTaReviewQueue(courseId)]);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderInner(outlet, courseId)));
    return;
  }

  // Agent decisions are enriched in the BACKGROUND, exactly as the instructor
  // queue does it (see views/instructor/review-queue.ts's module note): the
  // queue payload carries no `agentDecision`, so each row needs its own
  // getQuestion(). `loadToken` + `root.isConnected` drop a stale run.
  const agentDecisions = new Map<string, { decision: 'pass' | 'flag' | 'reject' } | undefined>();
  let loadToken = 0;

  async function enrichAgentDecisions(list: TaReviewQueueItem[]): Promise<void> {
    const token = ++loadToken;
    const results = await Promise.allSettled(list.map((item) => getQuestion(item.id)));
    if (token !== loadToken || !root.isConnected) return;
    results.forEach((result, i) => {
      agentDecisions.set(list[i].id, result.status === 'fulfilled' ? result.value.agentDecision : undefined);
    });
    renderTabs();
    renderResults();
  }

  let activeTab: QueueTab = 'all';
  let sortKey: SortKey = 'priority';
  let actionErrorMessage: string | null = null;
  let actionMessage: string | null = null;

  const tabsContainer = el('div', {});
  const controlsContainer = el('div', {});
  const resultsContainer = el('div', {});

  function tabInputs(): QueueTabInput[] {
    return items.map((item) => ({ labels: item.labels, agentDecision: agentDecisions.get(item.id) }));
  }

  function visibleRows(): TaReviewQueueItem[] {
    const inputs = tabInputs();
    const filtered = items.filter((_, i) => matchesTab(inputs[i], activeTab));
    if (sortKey === 'stem') return [...filtered].sort((a, b) => a.current.stem.localeCompare(b.current.stem));
    return filtered; // already server-prioritized
  }

  function renderTabs(): void {
    const counts = queueTabCounts(tabInputs());
    mount(
      tabsContainer,
      filterTabs(
        QUEUE_TABS.map((tab) => `${TAB_LABEL[tab]} (${counts[tab]})`),
        QUEUE_TABS.indexOf(activeTab),
        (i) => {
          activeTab = QUEUE_TABS[i];
          renderTabs();
          renderResults();
        },
      ),
    );
  }

  function renderControls(): void {
    const sortSelect = el('select', {
      class: 'input',
      'aria-label': 'Sort the review queue',
      onchange: (e: Event) => {
        sortKey = (e.target as HTMLSelectElement).value as SortKey;
        renderResults();
      },
    },
      el('option', { value: 'priority', text: 'Sort by: Priority', selected: sortKey === 'priority' ? 'selected' : undefined }),
      el('option', { value: 'stem', text: 'Sort by: Question (A–Z)', selected: sortKey === 'stem' ? 'selected' : undefined }),
    ) as HTMLSelectElement;
    mount(controlsContainer, el('div', { class: 'queue-controls' }, sortSelect));
  }

  async function markReviewed(item: TaReviewQueueItem): Promise<void> {
    actionErrorMessage = null;
    actionMessage = null;
    try {
      await markTaQuestionReviewed(item.id);
      items = await getTaReviewQueue(courseId);
      agentDecisions.clear();
      actionMessage = 'Marked reviewed.';
      renderTabs();
      void enrichAgentDecisions(items);
    } catch (error) {
      actionErrorMessage = error instanceof ApiError ? error.message : (error as Error).message;
    }
    renderResults();
  }

  function agentBadge(item: TaReviewQueueItem): HTMLElement {
    const decision = agentDecisions.get(item.id);
    if (!decision) return statusBadge('—', 'neutral');
    return statusBadge(decision.decision.toUpperCase(), AGENT_BADGE_VARIANT[decision.decision]);
  }

  function questionRow(item: TaReviewQueueItem): HTMLElement {
    const stemCell = el('div', { class: 'queue-row__stem' });
    renderRichText(stemCell, item.current.stem);
    const pending = pendingSuggestionCount(item);

    return el('div', { class: 'queue-row queue-row--ta' },
      el('div', {},
        stemCell,
        item.labels.includes('student-flagged')
          ? el('p', { class: 'queue-row__flag queue-row__flag--red', text: '🔴 Student Flagged' })
          : false,
        pending > 0
          ? el('p', { class: 'queue-row__suggestions', text: `${pending} suggestion${pending === 1 ? '' : 's'} awaiting the instructor` })
          : false,
      ),
      el('div', { class: 'queue-row__type-lo' },
        el('span', { text: TYPE_LABEL[item.current.type] }),
        el('span', { text: topicLoLabel(outline, item.loIds, item.themeIds) }),
      ),
      agentBadge(item),
      statusBadge(STATUS_LABEL[item.state], statusToBadgeVariant(item.state)),
      el('div', { class: 'queue-row__actions' },
        el('button', {
          class: 'btn btn--instr-primary btn--sm', type: 'button',
          onclick: () => navigate(`/ta/course/${encodeURIComponent(courseId)}/question/${encodeURIComponent(item.id)}`),
        }, 'Review →'),
        el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          disabled: item.state === 'reviewed' ? 'disabled' : undefined,
          title: item.state === 'reviewed' ? 'Already marked reviewed' : 'Mark this question reviewed for the instructor',
          onclick: () => void markReviewed(item),
        }, 'Mark reviewed'),
      ),
    );
  }

  function renderResults(): void {
    const rows = visibleRows();
    mount(resultsContainer,
      actionErrorMessage ? errorState(actionErrorMessage) : false,
      actionMessage ? el('p', { class: 'queue-message', text: actionMessage }) : false,
      el('div', { class: 'queue-table' },
        el('div', { class: 'queue-row queue-row--ta queue-row--head' },
          el('span', { text: 'Question' }),
          el('span', { text: 'Type / LO' }),
          el('span', { text: 'Agent Decision' }),
          el('span', { text: 'Status' }),
          el('span', { text: 'Actions' }),
        ),
        rows.length
          ? el('div', { class: 'queue-table__rows' }, ...rows.map(questionRow))
          : emptyState('No questions match this filter.'),
      ),
    );
  }

  body.replaceChildren(
    pageHeader(
      'TA Review Queue',
      `${items.length} question${items.length === 1 ? '' : 's'} awaiting review · Review, suggest, annotate or escalate. Final approval remains instructor-only.`,
    ),
    el('div', {}, tabsContainer, controlsContainer, resultsContainer),
  );
  renderTabs();
  renderControls();
  renderResults();
  void enrichAgentDecisions(items);
}

export function renderTaReviewQueue(outlet: HTMLElement, params: RouteParams): void {
  void renderInner(outlet, params.id);
}
```

- [x] **Step 4: Add the row CSS**

In `client/public/styles/main.css`, beside the existing `.queue-row` rules, add
a `.queue-row--ta` grid override — the TA row has 5 columns to the instructor's
6 (no select checkbox). Match the existing `.queue-row` declaration's approach
rather than inventing a new layout system.

- [x] **Step 5: Verify**

Run: `npm run typecheck && npx eslint client/src/views/ta/review-queue.ts && npx jest`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add client/src/views/ta/review-queue.ts client/public/styles/main.css tests/unit/ta-ui.test.ts
git commit -m "feat(ta): rebuild the TA review queue to mirror the instructor queue"
```

---

### Task 5: TA question page

**Files:**
- Create: `client/src/views/ta/question-detail.ts`
- Modify: `client/src/main.ts` (register the route; keep Review Queue nav active on it)

**Interfaces:**
- Consumes: `getQuestion` (`question.review`), `suggestTaQuestionEdit` (`question.suggest-edit`), `addTaQuestionNote` (`question.review`), `proactivelyEscalateTaQuestion`; Task 2's `buildSuggestionPatch`, `topicLoLabel`, `getCourseOutline`.
- Produces: route `/ta/course/:id/question/:questionId`, the destination of Task 4's **Review →**.

**Scope:** read-only question render, the TA's own pending suggestions, an
internal-note composer, a suggest-edit composer, and proactive escalation. No
editor — `PATCH /api/questions/:questionId` is `question.approve`.

- [x] **Step 1: Write the failing test**

Append to `tests/unit/ta-ui.test.ts`:

```ts
describe('TA question page source', () => {
  const source = readFileSync(join(__dirname, '../../client/src/views/ta/question-detail.ts'), 'utf8');

  it('never calls an approve-gated API', () => {
    for (const forbidden of ['editQuestion', 'transitionQuestion', 'resolveTaQuestionSuggestion', 'updateQuestionParams']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('gates submission on buildSuggestionPatch so empty suggestions cannot be filed', () => {
    expect(source).toContain('buildSuggestionPatch');
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx jest tests/unit/ta-ui.test.ts`
Expected: FAIL — `ENOENT` on `client/src/views/ta/question-detail.ts`.

- [x] **Step 3: Write the view**

Create `client/src/views/ta/question-detail.ts`. Structure:

1. `renderInner(outlet, courseId, questionId)` fetches
   `Promise.all([getCourseOutline(courseId), getQuestion(questionId)])`, with
   the same `errorState(message, retry)` treatment as the other TA views.
2. A `pageHeader` carrying the question's status badge and
   `topicLoLabel(outline, detail.loIds, detail.themeIds)`, plus a back link to
   `#/ta/course/:id/review` (real `href` + `preventDefault` + `navigate`, the
   convention `question-detail.ts`'s breadcrumb uses).
3. Read-only question body: `renderRichText` for the stem, then the options
   list with the correct option marked. **No inputs bound to the live
   question.**
4. "Suggest an edit" panel: a stem textarea and difficulty select seeded from
   `detail.current`, a live-updating "no changes yet" hint, and a Submit button
   `disabled` whenever
   `buildSuggestionPatch(original, draft) === null`. On submit call
   `suggestTaQuestionEdit(questionId, patch)`, then re-fetch and re-render so
   the new suggestion appears in its list.
5. "Your suggestions" list: `detail.suggestions` with status badges
   (`pending`/`accepted`/`discarded`) — read-only. Accept/discard is
   `question.approve`; the TA sees the outcome, never the control.
6. Internal note composer → `addTaQuestionNote(questionId, text)`, with the
   existing notes listed above it, attributed and timestamped.
7. "Escalate to instructor" → `proactivelyEscalateTaQuestion(questionId, reasonCategory, note)`
   behind `confirmDialog` from `modal.js`, since it creates a flag.

Every mutating handler follows the `act(operation, message)` pattern already in
the current TA review queue: catch `ApiError`, write the message into an
`aria-live="polite"` status span, never throw into the void.

The distinctive logic — everything else in the file is the same shell as the
other two TA views — is the suggest-edit panel and its submit gating:

```ts
import {
  ApiError,
  addTaQuestionNote,
  getCourseOutline,
  getQuestion,
  proactivelyEscalateTaQuestion,
  suggestTaQuestionEdit,
  type CourseOutline,
  type Difficulty,
  type QuestionDetail,
} from '../../api.js';
import { confirmDialog } from '../../modal.js';
import { buildSuggestionPatch, topicLoLabel } from './ta-ui.js';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** The suggest-edit composer. `Submit` stays disabled until the draft
 * actually differs from the current version — `buildSuggestionPatch` returns
 * null otherwise. Without this gate, re-clicking files duplicate no-op
 * suggestions the instructor then has to triage one by one (which is what the
 * old row-level "Suggest edit" button did). */
function suggestPanel(
  detail: QuestionDetail,
  onSubmitted: () => void,
): HTMLElement {
  const original = { stem: detail.current.stem, difficulty: detail.current.difficulty };
  const status = el('span', { 'aria-live': 'polite' });

  const stemInput = el('textarea', {
    class: 'input input--area', rows: '5', text: original.stem,
    'aria-label': 'Suggested stem',
  }) as HTMLTextAreaElement;

  const difficultyInput = el('select', { class: 'input', 'aria-label': 'Suggested difficulty' },
    ...DIFFICULTIES.map((level) => el('option', {
      value: level,
      text: level,
      selected: level === original.difficulty ? 'selected' : undefined,
    })),
  ) as HTMLSelectElement;

  const hint = el('p', { class: 'muted' });
  const submit = el('button', {
    class: 'btn btn--instr-primary btn--sm', type: 'button',
    onclick: () => void submitSuggestion(),
  }, 'Submit suggestion') as HTMLButtonElement;

  function draft(): { stem: string; difficulty: Difficulty } {
    return { stem: stemInput.value, difficulty: difficultyInput.value as Difficulty };
  }

  function syncSubmitState(): void {
    const patch = buildSuggestionPatch(original, draft());
    submit.disabled = patch === null;
    hint.textContent = patch === null
      ? 'No changes yet — edit the stem or difficulty to suggest something.'
      : `Will suggest: ${Object.keys(patch).join(', ')}.`;
  }

  async function submitSuggestion(): Promise<void> {
    const patch = buildSuggestionPatch(original, draft());
    if (!patch) return;
    try {
      await suggestTaQuestionEdit(detail.id, patch);
      status.textContent = 'Suggestion sent to the instructor.';
      onSubmitted();
    } catch (error) {
      status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
    }
  }

  stemInput.addEventListener('input', syncSubmitState);
  difficultyInput.addEventListener('change', syncSubmitState);
  syncSubmitState();

  return el('section', { class: 'card stack' },
    el('h2', { class: 'section-title', text: 'Suggest an edit' }),
    el('label', { class: 'form-field__label', text: 'Stem' }),
    stemInput,
    el('label', { class: 'form-field__label', text: 'Difficulty' }),
    difficultyInput,
    hint,
    el('div', { class: 'cluster' }, submit, status),
  );
}
```

And the escalation handler, which creates a flag and so is confirmed first:

```ts
async function escalate(detail: QuestionDetail, note: string, status: HTMLElement): Promise<void> {
  if (!await confirmDialog({
    title: 'Escalate this question to the instructor?',
    message: 'This raises a flag on the question for the instructor to resolve. You cannot withdraw it yourself.',
    confirmLabel: 'Escalate',
  })) return;
  try {
    await proactivelyEscalateTaQuestion(detail.id, 'TA review concern', note);
    status.textContent = 'Escalated to the instructor.';
  } catch (error) {
    status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
  }
}
```

Verified against `client/src/api.ts` at plan time: `Difficulty` is exported as
`'easy' | 'medium' | 'hard'` (line 1809), `QuestionHead.id` is a `string`
(line 1852) so `detail.id` is correct, and `QuestionVersion.difficulty` is a
required `Difficulty` (so `original.difficulty` is never undefined).

- [x] **Step 4: Register the route**

In `client/src/main.ts`, extend `TA_ROUTES` (specific-first, per the file's
convention):

```ts
const TA_ROUTES: Route[] = [
  { path: '/ta/course/:id/question/:questionId', render: renderTaQuestionDetail },
  { path: '/ta/course/:id/review', render: renderTaReviewQueue },
  { path: '/ta/course/:id/flags', render: renderTaFlagTriage },
];
```

Add the import, and in `buildTaShell`'s `onNavigate` keep the Review Queue link
highlighted while on a question page — otherwise both nav links go inactive:

```ts
      reviewLink.classList.toggle(
        'nav__link--active',
        path.endsWith('/review') || path.includes('/question/'),
      );
```

- [x] **Step 5: Verify**

Run: `npm run typecheck && npx eslint client/src/views/ta/question-detail.ts client/src/main.ts && npx jest`
Expected: all green.

- [x] **Step 6: Manual check with a real TA account**

Sign in as a user whose only role on the course is `ta`. From the queue click
**Review →**; confirm the page loads (no 403 on the outline), Submit is
disabled until the stem actually changes, a submitted suggestion appears as
`pending`, and no approve/edit control is present anywhere.

- [x] **Step 7: Commit**

```bash
git add client/src/views/ta/question-detail.ts client/src/main.ts
git commit -m "feat(ta): TA question page with suggest-edit, notes and escalation"
```

---

### Task 6: Rewrite TA flag triage to mirror the instructor's flag queue

**Files:**
- Modify: `client/src/views/ta/flag-triage.ts` (full rewrite, 92 lines → ~170)

**Interfaces:**
- Consumes: Task 3's `groupFlags`/`sortGroups`/`openFlags`/`isGroupOpen`/`latestEscalation`; Task 2's `getCourseOutline`/`topicLoLabel`; `listTaFlags`, `escalateTaFlag`.

**What carries over from the current view:** the one-shot `HighlightOnce`
notification-landing guard and its focus/scroll behaviour — that logic is
correct and hard-won (commit `6edb378`). Preserve it exactly, but key the
lookup on the group element (`data-flag-ids`) the way the instructor view does,
since rows are now groups rather than individual flags.

**Permitted actions only:** Escalate with a recommendation. No Return to
Students, no Reject & Archive, no editor link, no remediation panel — all
`flag.resolve` or `question.approve`, both hard-denied to TAs
(`capabilities.service.ts:46`).

- [x] **Step 1: Rewrite the view**

Mirror `views/instructor/flags.ts`'s structure: grouped rows via the Task 3
module, `flagCountBadge`, `reasonsSummary`, `staleVersionNote`, and the
instructor view's `flag-table`/`flag-row` markup and classes so the two look
like one product. Differences:

- Header: `pageHeader('TA Flag Triage', '<n> flag(s) across <m> question version(s) · Escalate a recommendation to the instructor. Resolution is instructor-only.')`
- Actions per open group: a recommendation `<select>` (Correct question /
  Archive question / Clear flag), an optional note `<textarea>`, and one
  **Escalate with recommendation** button that calls `escalateTaFlag` for
  **every open flag in the group** — matching the instructor view's
  group-wide resolve semantics, so a TA does not have to escalate three
  duplicate flags one at a time.
- Escalating stops at the first failure and surfaces the message inline,
  following `resolveGroupFlags`'s error handling.
- Groups already escalated render `latestEscalation(group)` as a read-only
  "Escalated: archive — 'wrong answer key'" line with the escalate controls
  hidden, so a TA can see their own prior recommendation instead of
  re-submitting it.
- Filter the fetched list to groups with at least one open **or escalated**
  flag via `isGroupOpen`, replacing today's `flag.state === 'open'` filter —
  which hides a flag the moment the TA escalates it, making their own work
  vanish.

The two pieces that are not a straight copy of the instructor view:

```ts
import { escalateTaFlag, listTaFlags, type Flag } from '../../api.js';
import { groupFlags, isGroupOpen, latestEscalation, openFlags, sortGroups, type FlagGroup } from '../../flag-groups.js';

type Recommendation = 'correct' | 'archive' | 'clear';

const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  correct: 'Correct question',
  archive: 'Archive question',
  clear: 'Clear flag',
};

/** Escalates every still-open flag in the group with one recommendation,
 * stopping at the first failure — the same group-wide semantics
 * `resolveGroupFlags` gives the instructor, so a TA facing three duplicate
 * flags on one question files one recommendation, not three.
 *
 * `escalateFlag` matches on `{ _id, state: 'open' }` server-side and throws
 * `invalid-flag-transition` otherwise, so an already-escalated flag in the
 * group is skipped here rather than being sent and failing the whole batch. */
async function escalateGroup(
  group: FlagGroup,
  recommendation: Recommendation,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const targets = openFlags(group).filter((flag) => flag.state === 'open');
  let escalated = 0;
  for (const flag of targets) {
    try {
      await escalateTaFlag(flag.id, recommendation, note);
      escalated++;
    } catch (error) {
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      return {
        ok: false,
        error: escalated > 0
          ? `${escalated} of ${targets.length} flags escalated, then: ${message}`
          : message,
      };
    }
  }
  return { ok: true };
}
```

```ts
/** An already-escalated group shows the recommendation back instead of the
 * controls — re-escalating is a no-op server-side, and a TA needs to see what
 * they (or another TA) already told the instructor. */
function escalationSummary(group: FlagGroup): HTMLElement | false {
  const escalation = latestEscalation(group);
  if (!escalation) return false;
  return el('p', { class: 'flag-row__escalation' },
    el('strong', { text: `Escalated — recommends: ${RECOMMENDATION_LABEL[escalation.recommendation]}` }),
    escalation.note ? el('span', { text: ` — "${escalation.note}"` }) : false,
    el('span', { class: 'muted', text: ` · ${new Date(escalation.at).toLocaleDateString()}` }),
  );
}
```

- [x] **Step 2: Verify**

Run: `npm run typecheck && npx eslint client/src/views/ta/flag-triage.ts && npx jest`
Expected: all green — `tests/unit/notification-target.test.ts` still passes
(the `?flag=` landing target for the `ta` audience is unchanged).

- [x] **Step 3: Manual check**

As a real TA: land on `#/ta/course/:id/flags?flag=<id>` from a notification and
confirm the group is highlighted, focused and scrolled to exactly once.
Escalate a group with two flags; confirm both move to `escalated` and the
recommendation renders back.

- [x] **Step 4: Commit**

```bash
git add client/src/views/ta/flag-triage.ts
git commit -m "feat(ta): rebuild flag triage on the shared grouping, mirroring the instructor queue"
```

---

### Task 7: Surface TA escalations in the instructor flag queue

**Files:**
- Modify: `client/src/views/instructor/flags.ts`

**Interfaces:**
- Consumes: Task 3's `latestEscalation` and the `taRecommendation` field added to `Flag`.

**The bug:** a TA escalates with a recommendation and a note; the instructor
queue renders neither, and shows escalated flags identically to un-triaged
ones. The TA's triage work is invisible — which is what makes the escalate
action feel pointless today.

- [x] **Step 1: Write the failing test**

`latestEscalation` is already covered by Task 3. Add a rendering-contract test
to `tests/unit/flag-groups.test.ts`:

```ts
describe('instructor flag queue source', () => {
  const source = readFileSync(join(__dirname, '../../client/src/views/instructor/flags.ts'), 'utf8');

  it('renders the TA recommendation rather than silently dropping it', () => {
    expect(source).toContain('latestEscalation');
  });
});
```

Add the `node:fs`/`node:path` imports at the top of that file.

- [x] **Step 2: Run it to verify it fails**

Run: `npx jest tests/unit/flag-groups.test.ts`
Expected: FAIL — `flags.ts` does not mention `latestEscalation`.

- [x] **Step 3: Render the escalation**

In `views/instructor/flags.ts`'s `groupRow`, add `latestEscalation` to the
imports from `flag-groups.js`, then:

- Compute `const escalation = latestEscalation(group);`
- When `escalation` is non-null and the group is open, replace the badge with
  `statusBadge('Escalated by TA', 'flag')` and render a line under
  `reasonsSummary`:

```ts
      escalation
        ? el('p', { class: 'flag-row__escalation' },
            el('strong', { text: `TA recommends: ${RESOLUTION_LABEL[escalation.recommendation].replace('Resolved: ', '')}` }),
            escalation.note ? el('span', { text: ` — "${escalation.note}"` }) : false,
            el('span', { class: 'muted', text: ` · ${new Date(escalation.at).toLocaleDateString()}` }),
          )
        : false,
```

- Sort escalated groups ahead of un-triaged open ones inside `sortGroups`'s
  open partition, so a TA's triage actually reaches the top of the
  instructor's queue as Phase 3 Task 6 line 183 intended. Implement this in
  `client/src/flag-groups.ts` and extend `tests/unit/flag-groups.test.ts`'s
  `sortGroups` describe block to cover it.

- [x] **Step 4: Add the CSS**

Add a `.flag-row__escalation` rule beside the existing `.flag-row__reason` /
`.flag-row__stale` rules in `client/public/styles/main.css`.

- [x] **Step 5: Verify**

Run: `npm run typecheck && npx eslint client/src/views/instructor/flags.ts client/src/flag-groups.ts && npx jest`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add client/src/views/instructor/flags.ts client/src/flag-groups.ts client/public/styles/main.css tests/unit/flag-groups.test.ts
git commit -m "fix(flags): surface TA escalations and prioritise them in the instructor queue"
```

---

## Final verification

_Automated checks re-run against `main` @ `ecced1f` on 2026-08-05, after the
merge of PR #62._

- [x] `npm run typecheck` — server and client clean.
- [x] `npx eslint .` — clean. (The `review-book.service.ts` `consistent-type-imports`
      error carried in the Phase 1 STATUS note is also gone.)
- [x] `npx jest` — full suite green: **83 suites, 862 tests**, up from the 806 at
      branch point.

The three manual checks below are **still unrecorded.** The late fix commits on
this branch (`ac8065d` missing question-page/queue styles, `873ba8d` `_id`→`id`
on the TA mutation responses, `95d1535` missing `loIds`/`themeIds`) are the kind
of defect only a real browser run surfaces, so runs almost certainly happened —
but nobody wrote down the result, and an inferred pass is not a pass. Re-run and
tick, or strike them.

- [ ] **Real TA account**, not the instructor's "View as TA": review queue loads with Topic/LO populated; Review → opens the question page; suggest-edit files exactly one suggestion; flag triage groups correctly and escalation renders back.
- [ ] **Instructor account:** the flag queue shows "Escalated by TA" with the recommendation and note, sorted above un-triaged flags; the review queue, question detail and remediation panel are unchanged.
- [ ] **TA invariant:** with every capability toggled on for the TA in `/admin/capabilities`, no approve, resolve, or edit control appears in any TA view, and `POST /api/questions/:id/transition {to:'approved'}` still 403s. The 403 half is covered automatically by `tests/unit/ta-routes.test.ts` and is green; the "no control appears with every capability on" half is the manual part.

## Out of scope

- Any change to `views/instructor/review-queue.ts` or `views/instructor/question-detail.ts` beyond imports.
- Making the instructor's per-view `topicLoLabel` copies use the new shared helper — they read `CourseTree`, not `CourseOutline`, and the codebase deliberately keeps one copy per instructor view (`flags.ts:44-46`). Revisit only if a third consumer appears.
- Sandboxing the "View as TA" mode. It remains live data against real course records; see `TaViewAs` in `client/src/main.ts`.
- Capability-driven hiding of TA controls (e.g. hiding Escalate when a course revokes `flag.triage`). Every TA action in this plan is a TA default; a course that revokes one will surface a 403 in the inline status line rather than a hidden control. Worth doing when per-course capability config is actually used in the pilot.
