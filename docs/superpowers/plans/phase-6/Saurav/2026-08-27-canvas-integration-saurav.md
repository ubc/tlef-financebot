# Canvas Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner:** Saurav
**Created:** 2026-08-27
**Traces to:** [`../../../specs/2026-08-27-canvas-integration-design.md`](../../../specs/2026-08-27-canvas-integration-design.md) and the core phase document [`../2026-08-27-phase-6-canvas-integration.md`](../2026-08-27-phase-6-canvas-integration.md).

**Goal:** An instructor connects Canvas once, links a Canvas course they teach to a FinanceBot course, imports Canvas Files into materials, and syncs the Canvas roster so students on it can enroll with the registration code alone.

**Architecture:** A thin `components/lms/` wrapper binds `@ubc/ubc-genai-toolkit-lms-integration` to FinanceBot identity (`req.user.puid`) and MongoDB. One service (`lms-canvas.service.ts`) owns the course link, file import, and roster sync; one route file (`lms-canvas.routes.ts`) stacks `ensureCourseInstructor()` over the package's `requireAuth` and maps package errors to four fixed responses. File bytes reuse the existing `createMaterials → ingestMaterial` pipeline; synced roster rows land in a new `lmsRosterEntries` collection the enrollment gate consults alongside the CSV roster.

**Tech Stack:** TypeScript strict; Express 5 + MongoDB native driver; `@ubc/ubc-genai-toolkit-lms-integration` 1.2.0 (GitHub Packages, `.npmrc` committed); plain-TS client with `.js` import extensions; Jest + ts-jest + supertest.

**Spec:** `docs/superpowers/specs/2026-08-27-canvas-integration-design.md`

## Global Constraints

- The package owns OAuth, refresh, pagination, download policy, matching. Never reimplement; never fetch `raw.url`; never send `raw` to the browser.
- Guard order on every course-scoped route: `ensureApiAuthenticated()` → `ensureCourseInstructor()` → `canvas.requireAuth(config)`. The auth router is behind `ensureApiAuthenticated()` only.
- `getUserKey` returns `req.user.puid`. Nothing else, ever.
- Matching key is `integrationId` only. `appUsers` are `{ appUserId: puid, key: puid }` for users holding a `student` role on the course.
- `externalCourseId` is always `course.canvas.courseId`. Request bodies never carry one.
- Canvas roster entries add to the CSV roster; `putRoster` and `rosterEntries` are untouched.
- Error bodies: `{ error: <fixed code> }` only. No `err.message`, no `raw`, no PUID. Logs: class name + status only.
- `CanvasApiError` exposes **`statusCode`** (not `status`). `matchCourseRoster` throws **`CanvasGradeExportError`** with `reason: 'roster-coverage'` — the class name is historical.
- The package's `requireAuth` 401 body is `{ success: false, connected: false, connectUrl }`. `/status` does **not** use `requireAuth`; it reads the token store.
- Append-only shared files: `app.ts`, `collections.ts` (accessor + `INDEX_SPECS`), `.env.example`, `env.ts`, `client/src/api.ts`, `domain.ts` additions.
- Partial index name `materials_origin_unique` is fixed once deployed.
- Every task ends green on `npm run typecheck`, `npx eslint <changed files>`, `npx jest`.
- No Moodle. No writes to Canvas.

---

### Task 1: Component, configuration, connect/disconnect

**Files:**
- Create: `server/src/components/lms/index.ts`
- Create: `server/src/components/lms/AGENTS.md`
- Create: `server/src/routes/lms-canvas.routes.ts`
- Modify: `server/src/config/env.ts` (append inside `env`)
- Modify: `.env.example` (append block)
- Modify: `server/src/app.ts:32` (import) and `:92` (mount)
- Test: `tests/unit/lms-canvas.routes.test.ts`

**Interfaces:**
- Consumes: `getDb()` from `components/mongodb`; `ensureApiAuthenticated()` from `components/auth`; `env` from `config/env`.
- Produces: `getCanvasConfig(): canvas.Config` (memoised; throws if unconfigured), `isCanvasConfigured(): boolean`, `createLmsCanvasRouter(): Router`. Tasks 2–4 add routes to the same router file and mock `components/lms` the same way this task's test does.

- [x] **Step 1: Append the env block**

`.env.example`, appended at the end:

```
# --- Canvas LMS integration (server/src/components/lms) ----------------------
# All four are required to mount /api/lms/canvas; leave blank to disable the
# integration entirely. Local values come from
# ../local-lms-dev/create-developer-key.sh (run it yourself — it prints a live
# secret). The redirect URI must match the Developer Key byte for byte.
CANVAS_DOMAIN=
CANVAS_CLIENT_ID=
CANVAS_CLIENT_SECRET=
CANVAS_REDIRECT_URI=http://localhost:6118/api/lms/canvas/auth/callback
```

`server/src/config/env.ts`, appended inside the `env` object (after `paramWorkerMemoryMb` or whatever is currently last):

```ts
  // Canvas LMS integration (server/src/components/lms). Read by the package's
  // loadConfigFromEnv directly from process.env; mirrored here so the mount
  // decision is typed and testable.
  canvas: {
    domain: optional('CANVAS_DOMAIN', ''),
    clientId: optional('CANVAS_CLIENT_ID', ''),
    clientSecret: optional('CANVAS_CLIENT_SECRET', ''),
    redirectUri: optional('CANVAS_REDIRECT_URI', ''),
  },
```

and immediately after the `env` object's closing `};`:

```ts
/** All four Canvas variables set → the /api/lms/canvas router is mounted. */
export const canvasEnabled =
  Boolean(env.canvas.domain && env.canvas.clientId && env.canvas.clientSecret && env.canvas.redirectUri);
```

- [x] **Step 2: Write the failing route test**

`tests/unit/lms-canvas.routes.test.ts`:

```ts
// lmsCanvasRouter via supertest, mirroring courses.routes.test.ts's makeApp.
// The package and components/lms are mocked: no Canvas, no Mongo.
import express, { Router, type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

const tokenStore = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
let requireAuthConnected = true;

jest.mock('@ubc/ubc-genai-toolkit-lms-integration', () => {
  class LmsError extends Error {}
  class CanvasApiError extends LmsError {
    constructor(message: string, public readonly statusCode: number) { super(message); }
  }
  class CanvasGradeExportError extends LmsError {
    constructor(message: string, public readonly reason: string) { super(message); }
  }
  return {
    LmsError,
    canvas: {
      CanvasApiError,
      CanvasGradeExportError,
      createAuthRouter: () => {
        const r = Router();
        r.get('/login', (_req, res) => res.status(302).set('Location', 'https://canvas.test/oauth').end());
        return r;
      },
      requireAuth: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (!requireAuthConnected) {
          res.status(401).json({ success: false, connected: false, connectUrl: '/api/lms/canvas/auth/login' });
          return;
        }
        req.canvasApi = {} as never;
        next();
      },
    },
  };
});
jest.mock('../../server/src/components/lms', () => ({
  getCanvasConfig: () => ({ tokenStore, basePath: '/api/lms/canvas/auth' }),
  isCanvasConfigured: () => true,
}));

import { createLmsCanvasRouter } from '../../server/src/routes/lms-canvas.routes';

const courseId = new ObjectId();

function userFixture(courseRoles: User['courseRoles'], isAdmin = false): User {
  return {
    puid: 'PUID-INSTR-0001',
    uid: 'instr1',
    displayName: 'Instructor One',
    email: 'instr1@example.ubc.ca',
    affiliations: ['faculty'],
    isAdmin,
    courseRoles,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}
const instructor = userFixture([{ courseId, role: 'instructor' }]);

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', createLmsCanvasRouter());
  return app;
}

beforeEach(() => {
  tokenStore.get.mockReset();
  requireAuthConnected = true;
});

describe('GET /api/lms/canvas/status', () => {
  it('401s a signed-out caller', async () => {
    const res = await request(makeApp(undefined)).get('/api/lms/canvas/status');
    expect(res.status).toBe(401);
  });

  it('reports connected: false when no token is stored — 200, not 401', async () => {
    tokenStore.get.mockResolvedValue(null);
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
    expect(tokenStore.get).toHaveBeenCalledWith('PUID-INSTR-0001');
  });

  it('reports connected: true when a token is stored', async () => {
    tokenStore.get.mockResolvedValue({ accessToken: 'x', refreshToken: 'y', expiresAt: 1, canvasUserId: '5' });
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/status');
    expect(res.body).toEqual({ connected: true });
  });
});

describe('auth router mount', () => {
  it('401s a signed-out caller before the package router runs', async () => {
    const res = await request(makeApp(undefined)).get('/api/lms/canvas/auth/login');
    expect(res.status).toBe(401);
  });

  it('lets a signed-in caller reach the package login route', async () => {
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/auth/login');
    expect(res.status).toBe(302);
  });
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npx jest tests/unit/lms-canvas.routes.test.ts`
Expected: FAIL — `Cannot find module '../../server/src/routes/lms-canvas.routes'`.

- [x] **Step 4: Write the component**

`server/src/components/lms/index.ts`:

```ts
import { canvas, createMongoTokenStore } from '@ubc/ubc-genai-toolkit-lms-integration';
import { getDb } from '../mongodb';
import { canvasEnabled } from '../../config/env';

// Binds the LMS integration package to FinanceBot identity and storage. The
// package owns OAuth, refresh, pagination, and roster matching; this file
// owns exactly two decisions — which Mongo collection holds tokens, and which
// application identifier keys them. See components/lms/AGENTS.md.

/** Token-store key. PUID is the canonical CWL identity (users.puid, unique). */
export const CANVAS_TOKEN_COLLECTION = 'lmsCanvasTokens';

let cached: canvas.Config | undefined;

export function isCanvasConfigured(): boolean {
  return canvasEnabled;
}

/**
 * Memoised package config. `loadConfigFromEnv` throws, naming the missing
 * variables, if any of the four CANVAS_* values is unset — callers should
 * check `isCanvasConfigured()` first and never mount the router otherwise.
 */
export function getCanvasConfig(): canvas.Config {
  if (cached) return cached;
  cached = canvas.loadConfigFromEnv({
    tokenStore: createMongoTokenStore(() => getDb(), { collectionName: CANVAS_TOKEN_COLLECTION }),
    getUserKey: (req) => {
      if (!req.user?.puid) throw new Error('Application authentication required');
      return req.user.puid;
    },
    basePath: '/api/lms/canvas/auth',
  });
  return cached;
}
```

`server/src/components/lms/AGENTS.md`:

```md
# AGENTS.md — components/lms

Wrapper around `@ubc/ubc-genai-toolkit-lms-integration` (Canvas only; Moodle
is deliberately not mounted). Design:
`docs/superpowers/specs/2026-08-27-canvas-integration-design.md`.

Rules:
- The package owns OAuth, token refresh, pagination, file download policy, and
  roster matching. Do not reimplement any of it here or in a service.
- `getUserKey` is `req.user.puid`. Never an email, uid, or display name.
- Tokens live in `lmsCanvasTokens`, owned by the package's Mongo store.
- Matching is on Canvas `integration_id` (= PUID at UBC) only. No fallback.
- Nothing from a Canvas response's `raw` reaches a browser; no PUID or token
  reaches a log line.

Local Canvas: `../local-lms-dev/README.md`.
```

- [x] **Step 5: Write the router factory with `/status` and the auth mount**

`server/src/routes/lms-canvas.routes.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { canvas, LmsError } from '@ubc/ubc-genai-toolkit-lms-integration';
import { ensureApiAuthenticated } from '../components/auth';
import { getCanvasConfig } from '../components/lms';

// Canvas LMS integration routes (Phase 6). Mounted under /api only when the
// four CANVAS_* variables are set (see app.ts); an unconfigured deployment
// 404s the whole family, which the client reads as "no Canvas here".
//
// Guard order on course-scoped routes (Tasks 2–4):
//   ensureApiAuthenticated() -> ensureCourseInstructor() -> canvas.requireAuth()
// A stored Canvas token proves a credential exists, not that its owner is an
// instructor of anything — that is FinanceBot's check, and it runs first.

/**
 * Map package errors to fixed response codes. Bodies never carry
 * `err.message`, `raw`, headers, or a PUID; the log line is class + status.
 */
export function mapCanvasError(err: unknown, res: Response): boolean {
  if (err instanceof canvas.CanvasGradeExportError && err.reason === 'roster-coverage') {
    res.status(409).json({ error: 'roster-coverage' });
    return true;
  }
  if (err instanceof canvas.CanvasApiError) {
    console.error(`[lms-canvas] CanvasApiError ${err.statusCode}`);
    if (err.statusCode === 401) { res.status(401).json({ error: 'canvas-reconnect' }); return true; }
    if (err.statusCode === 403) { res.status(403).json({ error: 'canvas-forbidden' }); return true; }
    res.status(502).json({ error: 'canvas-unavailable' });
    return true;
  }
  if (err instanceof LmsError) {
    console.error(`[lms-canvas] ${err.constructor.name}`);
    res.status(502).json({ error: 'canvas-unavailable' });
    return true;
  }
  return false;
}

export function createLmsCanvasRouter(): Router {
  const config = getCanvasConfig();
  const router = Router();

  // Connecting is per person, not per course: no course guard here.
  router.use('/lms/canvas/auth', ensureApiAuthenticated(), canvas.createAuthRouter(config));

  /**
   * GET /api/lms/canvas/status -> 200 { connected }. Deliberately not behind
   * canvas.requireAuth: "configured, not connected" is a state the Settings
   * card renders, not an error.
   */
  router.get('/lms/canvas/status', ensureApiAuthenticated(), async (req: Request, res: Response) => {
    const tokens = await config.tokenStore.get(req.user!.puid);
    res.json({ connected: tokens !== null });
  });

  return router;
}
```

- [x] **Step 6: Mount it**

`server/src/app.ts` — add the import after line 32 (`import { authRouter } …`):

```ts
import { createLmsCanvasRouter } from './routes/lms-canvas.routes';
import { canvasEnabled } from './config/env';
```

and after the `notificationsRouter` mount (line 92), one block:

```ts
  if (canvasEnabled) app.use('/api', createLmsCanvasRouter()); // Canvas LMS: connect, link, file import, roster sync (Phase 6). 404s when unconfigured.
```

(`isProduction` is already imported from `./config/env` on line 6; merge the two imports into one line if eslint's `no-duplicate-imports` complains.)

- [x] **Step 7: Run the tests and typecheck**

Run: `npx jest tests/unit/lms-canvas.routes.test.ts && npm run typecheck:server`
Expected: 5 tests PASS; typecheck clean. If `req.canvasApi` is unknown to the compiler, the package's global augmentation is not being picked up — add `import type {} from '@ubc/ubc-genai-toolkit-lms-integration';` to `server/src/types/express.d.ts` (one line) so the `Express.Request.canvasApi` declaration is loaded with the rest of the request typings.

- [x] **Step 8: Hand-verify connect/disconnect against local Canvas**

With `../local-lms-dev` up and the four `CANVAS_*` values in `.env`, `npm run dev`, sign in as `faculty`, then:
1. `GET http://localhost:6118/api/lms/canvas/status` → `{ "connected": false }`
2. Open `http://localhost:6118/api/lms/canvas/auth/login` → Canvas login (`teacher1@example.com` / `password`) → approve → redirected back.
3. `GET …/status` → `{ "connected": true }`; `db.lmsCanvasTokens` has one document with `userKey` = the faculty PUID.
4. `POST …/auth/logout` → `{ "connected": false }` again.

Record the four results in `STATUS.md`.

- [x] **Step 9: Commit**

```bash
git add .env.example server/src/config/env.ts server/src/components/lms server/src/routes/lms-canvas.routes.ts server/src/app.ts tests/unit/lms-canvas.routes.test.ts
git commit -m "feat(lms): Canvas component, config, connect/disconnect, /status"
```

---

### Task 2: Course link

**Files:**
- Modify: `server/src/types/domain.ts:150-173` (add `canvas?` to `Course`)
- Create: `server/src/services/lms-canvas.service.ts`
- Modify: `server/src/routes/lms-canvas.routes.ts` (add four routes)
- Modify: `docs/api-contract.md` (new section after Materials)
- Test: `tests/unit/lms-canvas.service.test.ts`, `tests/unit/lms-canvas.routes.test.ts`

**Interfaces:**
- Consumes: `getCanvasConfig()`, `mapCanvasError()`, `createLmsCanvasRouter()` from Task 1; `getCourse(courseId)` and `coursesCol()` from existing code; `canvas.getCourses(api, query)` returning `LmsCourse[]` (`{ id, name, code, raw }`).
- Produces (service):
  - `type CourseLink = { courseId: string; name: string; code: string; linkedAt: Date; linkedBy: string }`
  - `listTeacherCourses(api: canvas.ApiClient): Promise<Array<{ id: string; name: string; code: string }>>`
  - `getLink(courseId: ObjectId): Promise<CourseLink | null>`
  - `linkCourse(api, courseId: ObjectId, canvasCourseId: string, byPuid: string): Promise<CourseLink>` — throws `Error('not-teacher')`
  - `unlinkCourse(courseId: ObjectId): Promise<void>` — also deletes `lmsRosterEntries` for the course (collection accessor added in Task 4; until then this deletes from `getDb().collection('lmsRosterEntries')` via the accessor introduced **here** — see Step 3)
  - `requireLink(courseId: ObjectId): Promise<CourseLink>` — throws `Error('not-linked')`; Tasks 3–4 call it.
- Produces (routes): `GET /lms/canvas/courses`, `GET|PUT|DELETE /lms/canvas/courses/:courseId/link`.

- [x] **Step 1: Add the domain field**

`server/src/types/domain.ts`, inside `interface Course` after `lastBacklogNotifiedAt?`:

```ts
  /** Linked Canvas course (Phase 6). Provider-scoped id; every Canvas read for
   * this course derives its external course id from here, never from a
   * request. Omitted from ordinary course responses. */
  canvas?: {
    courseId: string;
    name: string;
    code: string;
    linkedAt: Date;
    linkedBy: string; // puid
  };
```

- [x] **Step 2: Write the failing service tests**

`tests/unit/lms-canvas.service.test.ts`:

```ts
import { ObjectId } from 'mongodb';
import { coursesCol, lmsRosterEntriesCol } from '../../server/src/components/mongodb/collections';
import { getCourse } from '../../server/src/services/courses.service';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { linkCourse, unlinkCourse, getLink, requireLink, listTeacherCourses } from '../../server/src/services/lms-canvas.service';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  coursesCol: jest.fn(),
  lmsRosterEntriesCol: jest.fn(),
  materialsCol: jest.fn(),
  usersCol: jest.fn(),
}));
jest.mock('../../server/src/services/courses.service', () => ({ getCourse: jest.fn() }));
jest.mock('@ubc/ubc-genai-toolkit-lms-integration', () => ({
  canvas: { getCourses: jest.fn() },
}));

const coursesUpdateOne = jest.fn();
const entriesDeleteMany = jest.fn();
const api = {} as canvas.ApiClient;
const courseId = new ObjectId();

beforeEach(() => {
  coursesUpdateOne.mockReset();
  entriesDeleteMany.mockReset();
  jest.mocked(coursesCol).mockReturnValue({ updateOne: coursesUpdateOne } as never);
  jest.mocked(lmsRosterEntriesCol).mockReturnValue({ deleteMany: entriesDeleteMany } as never);
  jest.mocked(getCourse).mockReset();
  jest.mocked(canvas.getCourses).mockReset();
});

describe('listTeacherCourses', () => {
  it('asks Canvas for teacher enrollments only and strips raw', async () => {
    jest.mocked(canvas.getCourses).mockResolvedValue([{ id: '1', name: 'Demo', code: 'DEMO', raw: { secret: 1 } }]);
    const out = await listTeacherCourses(api);
    expect(canvas.getCourses).toHaveBeenCalledWith(api, { enrollment_type: 'teacher' });
    expect(out).toEqual([{ id: '1', name: 'Demo', code: 'DEMO' }]);
  });
});

describe('linkCourse', () => {
  it('refuses a Canvas course absent from the teacher list and writes nothing', async () => {
    jest.mocked(canvas.getCourses).mockResolvedValue([{ id: '1', name: 'Demo', code: 'DEMO', raw: {} }]);
    await expect(linkCourse(api, courseId, '999', 'PUID-1')).rejects.toThrow('not-teacher');
    expect(coursesUpdateOne).not.toHaveBeenCalled();
  });

  it('stores name/code from the Canvas row, not the caller', async () => {
    jest.mocked(canvas.getCourses).mockResolvedValue([{ id: '1', name: 'FinanceBot Demo', code: 'FINBOT-DEMO', raw: {} }]);
    const link = await linkCourse(api, courseId, '1', 'PUID-1');
    expect(link).toMatchObject({ courseId: '1', name: 'FinanceBot Demo', code: 'FINBOT-DEMO', linkedBy: 'PUID-1' });
    expect(coursesUpdateOne).toHaveBeenCalledWith({ _id: courseId }, { $set: { canvas: link } });
  });
});

describe('unlinkCourse', () => {
  it('clears the link and the course’s Canvas roster entries', async () => {
    await unlinkCourse(courseId);
    expect(coursesUpdateOne).toHaveBeenCalledWith({ _id: courseId }, { $unset: { canvas: '' } });
    expect(entriesDeleteMany).toHaveBeenCalledWith({ courseId });
  });
});

describe('getLink / requireLink', () => {
  it('getLink returns null on an unlinked course', async () => {
    jest.mocked(getCourse).mockResolvedValue({ _id: courseId } as never);
    expect(await getLink(courseId)).toBeNull();
  });
  it('requireLink throws not-linked', async () => {
    jest.mocked(getCourse).mockResolvedValue({ _id: courseId } as never);
    await expect(requireLink(courseId)).rejects.toThrow('not-linked');
  });
  it('requireLink returns the link when present', async () => {
    const link = { courseId: '1', name: 'D', code: 'D', linkedAt: new Date(), linkedBy: 'P' };
    jest.mocked(getCourse).mockResolvedValue({ _id: courseId, canvas: link } as never);
    expect(await requireLink(courseId)).toEqual(link);
  });
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npx jest tests/unit/lms-canvas.service.test.ts`
Expected: FAIL — module not found for `lms-canvas.service`, and `lmsRosterEntriesCol` is not exported.

Add the accessor now so Task 4 only adds the type and indexes. `server/src/components/mongodb/collections.ts`, appended to the accessor block (one line) and the domain import list:

```ts
export const lmsRosterEntriesCol = (): Collection<LmsRosterEntry> => getDb().collection<LmsRosterEntry>('lmsRosterEntries');
```

and in `server/src/types/domain.ts`, after `RosterEntry`:

```ts
/** One synced Canvas identity per linked course (Phase 6). Only users whose
 * Canvas `integration_id` (the PUID at UBC) was present are stored; the rest
 * are counted in the sync report's coverage and never guessed. Replaced
 * wholesale on every sync. */
export interface LmsRosterEntry {
  courseId: ObjectId;
  provider: 'canvas';
  externalCourseId: string;
  externalUserId: string;
  puid: string;
  name: string; // display label only — never evidence of identity
  matchedBy: 'integrationId';
  syncedAt: Date;
}
```

- [x] **Step 4: Write the service**

`server/src/services/lms-canvas.service.ts`:

```ts
import type { ObjectId } from 'mongodb';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { coursesCol, lmsRosterEntriesCol } from '../components/mongodb/collections';
import { getCourse } from './courses.service';

// Canvas integration service (Phase 6). Owns the course link, file import
// (Task 3), and roster sync (Task 4). The package owns every Canvas call;
// this file owns FinanceBot's decisions about them. Design:
// docs/superpowers/specs/2026-08-27-canvas-integration-design.md

export interface CourseLink {
  courseId: string;
  name: string;
  code: string;
  linkedAt: Date;
  linkedBy: string;
}

/** Courses the connected Canvas identity TEACHES — the only linkable ones. */
export async function listTeacherCourses(
  api: canvas.ApiClient,
): Promise<Array<{ id: string; name: string; code: string }>> {
  const courses = await canvas.getCourses(api, { enrollment_type: 'teacher' });
  return courses.map((c) => ({ id: c.id, name: c.name, code: c.code }));
}

export async function getLink(courseId: ObjectId): Promise<CourseLink | null> {
  const course = await getCourse(courseId);
  return course.canvas ?? null;
}

/** Throws `not-linked`. Every course-scoped Canvas read starts here so the
 * external course id can only ever come from the stored link. */
export async function requireLink(courseId: ObjectId): Promise<CourseLink> {
  const link = await getLink(courseId);
  if (!link) throw new Error('not-linked');
  return link;
}

/**
 * Link a Canvas course. Refused (`not-teacher`) unless the id appears in the
 * connected identity's teacher list — a stored token proves a credential,
 * not instructor status on that course. Name/code are taken from Canvas's
 * row, never from the caller.
 */
export async function linkCourse(
  api: canvas.ApiClient,
  courseId: ObjectId,
  canvasCourseId: string,
  byPuid: string,
): Promise<CourseLink> {
  const teaching = await listTeacherCourses(api);
  const match = teaching.find((c) => c.id === canvasCourseId);
  if (!match) throw new Error('not-teacher');
  const link: CourseLink = { courseId: match.id, name: match.name, code: match.code, linkedAt: new Date(), linkedBy: byPuid };
  await coursesCol().updateOne({ _id: courseId }, { $set: { canvas: link } });
  return link;
}

/** Clear the link and the course's synced Canvas roster. Imported materials
 * stay — they are FinanceBot's now. */
export async function unlinkCourse(courseId: ObjectId): Promise<void> {
  await coursesCol().updateOne({ _id: courseId }, { $unset: { canvas: '' } });
  await lmsRosterEntriesCol().deleteMany({ courseId });
}
```

- [x] **Step 5: Run the service tests**

Run: `npx jest tests/unit/lms-canvas.service.test.ts`
Expected: 7 tests PASS.

- [x] **Step 6: Add the failing route tests**

Append to `tests/unit/lms-canvas.routes.test.ts`. Extend the mocks at the top: add `ensureCourseInstructor` is real (it reads `req.user.courseRoles`), and mock the service:

```ts
jest.mock('../../server/src/services/lms-canvas.service', () => ({
  listTeacherCourses: jest.fn(),
  getLink: jest.fn(),
  linkCourse: jest.fn(),
  unlinkCourse: jest.fn(),
  requireLink: jest.fn(),
}));
import { listTeacherCourses, getLink, linkCourse, unlinkCourse } from '../../server/src/services/lms-canvas.service';
```

Add fixtures beside `instructor`:

```ts
const student = userFixture([{ courseId, role: 'student' }]);
const otherInstructor = userFixture([{ courseId: new ObjectId(), role: 'instructor' }]);
const admin = userFixture([], true);
const base = `/api/lms/canvas/courses/${courseId.toHexString()}`;
```

Tests:

```ts
describe('GET /api/lms/canvas/courses', () => {
  it('returns the teacher list', async () => {
    jest.mocked(listTeacherCourses).mockResolvedValue([{ id: '1', name: 'Demo', code: 'DEMO' }]);
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/courses');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: '1', name: 'Demo', code: 'DEMO' }]);
  });
  it('passes the package 401 through when not connected', async () => {
    requireAuthConnected = false;
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/courses');
    expect(res.status).toBe(401);
    expect(res.body.connected).toBe(false);
  });
});

describe('course link routes', () => {
  it.each([
    ['student', student],
    ['instructor of another course', otherInstructor],
  ])('403s a %s', async (_l, u) => {
    const res = await request(makeApp(u)).get(`${base}/link`);
    expect(res.status).toBe(403);
    expect(getLink).not.toHaveBeenCalled();
  });

  it('admin passes the course guard', async () => {
    jest.mocked(getLink).mockResolvedValue(null);
    const res = await request(makeApp(admin)).get(`${base}/link`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false });
  });

  it('GET link reports linked with linkedBy stripped', async () => {
    jest.mocked(getLink).mockResolvedValue({ courseId: '1', name: 'D', code: 'D', linkedAt: new Date('2026-08-27'), linkedBy: 'P' });
    const res = await request(makeApp(instructor)).get(`${base}/link`);
    expect(res.body).toEqual({ linked: true, canvas: { courseId: '1', name: 'D', code: 'D', linkedAt: '2026-08-27T00:00:00.000Z' } });
  });

  it('PUT link 403s not-teacher and 400s a missing id', async () => {
    jest.mocked(linkCourse).mockRejectedValue(new Error('not-teacher'));
    const denied = await request(makeApp(instructor)).put(`${base}/link`).send({ canvasCourseId: '999' });
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: 'not-teacher' });
    const bad = await request(makeApp(instructor)).put(`${base}/link`).send({});
    expect(bad.status).toBe(400);
  });

  it('PUT link stores and returns the link', async () => {
    const link = { courseId: '1', name: 'D', code: 'D', linkedAt: new Date(), linkedBy: 'PUID-INSTR-0001' };
    jest.mocked(linkCourse).mockResolvedValue(link);
    const res = await request(makeApp(instructor)).put(`${base}/link`).send({ canvasCourseId: '1' });
    expect(res.status).toBe(200);
    expect(linkCourse).toHaveBeenCalledWith(expect.anything(), courseId, '1', 'PUID-INSTR-0001');
    expect(res.body.canvas.courseId).toBe('1');
  });

  it('DELETE link 204s', async () => {
    jest.mocked(unlinkCourse).mockResolvedValue();
    const res = await request(makeApp(instructor)).delete(`${base}/link`);
    expect(res.status).toBe(204);
    expect(unlinkCourse).toHaveBeenCalledWith(courseId);
  });
});
```

- [x] **Step 7: Run to verify they fail**

Run: `npx jest tests/unit/lms-canvas.routes.test.ts`
Expected: the new tests FAIL with 404s.

- [x] **Step 8: Add the routes**

In `server/src/routes/lms-canvas.routes.ts`, add imports:

```ts
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { getLink, linkCourse, listTeacherCourses, unlinkCourse } from '../services/lms-canvas.service';
```

module-level schemas (mirroring `materials.routes.ts:46-47`):

```ts
const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });
const linkBody = z.object({ canvasCourseId: z.string().min(1) });

/** Public shape of a link: `linkedBy` (a PUID) stays server-side. */
function publicLink(link: { courseId: string; name: string; code: string; linkedAt: Date }) {
  return { courseId: link.courseId, name: link.name, code: link.code, linkedAt: link.linkedAt };
}
```

and inside `createLmsCanvasRouter()`, after `/status`:

```ts
  const courseGuards = [validate({ params: courseIdParams }), ensureApiAuthenticated(), ensureCourseInstructor()];
  const withCanvas = canvas.requireAuth(config);

  router.get('/lms/canvas/courses', ensureApiAuthenticated(), withCanvas, async (req, res) => {
    try {
      res.json(await listTeacherCourses(req.canvasApi!));
    } catch (err) {
      if (!mapCanvasError(err, res)) throw err;
    }
  });

  router.get('/lms/canvas/courses/:courseId/link', ...courseGuards, async (req, res) => {
    const link = await getLink(new ObjectId(String(req.params.courseId)));
    res.json(link ? { linked: true, canvas: publicLink(link) } : { linked: false });
  });

  router.put('/lms/canvas/courses/:courseId/link', ...courseGuards, validate({ body: linkBody }), withCanvas, async (req, res) => {
    try {
      const link = await linkCourse(req.canvasApi!, new ObjectId(String(req.params.courseId)), req.body.canvasCourseId, req.user!.puid);
      res.json({ linked: true, canvas: publicLink(link) });
    } catch (err) {
      if (err instanceof Error && err.message === 'not-teacher') { res.status(403).json({ error: 'not-teacher' }); return; }
      if (!mapCanvasError(err, res)) throw err;
    }
  });

  router.delete('/lms/canvas/courses/:courseId/link', ...courseGuards, async (req, res) => {
    await unlinkCourse(new ObjectId(String(req.params.courseId)));
    res.status(204).end();
  });
```

- [x] **Step 9: Run everything**

Run: `npx jest tests/unit/lms-canvas && npm run typecheck:server && npx eslint server/src/routes/lms-canvas.routes.ts server/src/services/lms-canvas.service.ts`
Expected: all PASS, clean.

- [x] **Step 10: Contract**

`docs/api-contract.md`, new section after "Materials (instructor) — implementation note":

```md
## Canvas LMS (instructor; Phase 6)
Mounted only when `CANVAS_DOMAIN`, `CANVAS_CLIENT_ID`, `CANVAS_CLIENT_SECRET`,
`CANVAS_REDIRECT_URI` are all set; otherwise every path below 404s.
Course-scoped routes require the course instructor (admins pass) **and** a
connected Canvas identity — the package answers `401 { success: false,
connected: false, connectUrl }` when the caller has no usable Canvas token.
- `GET|POST /api/lms/canvas/auth/{login,callback,logout}` — package OAuth router. `returnTo` must be a local absolute path.
- `GET /api/lms/canvas/status` → `{ connected }` (200 either way)
- `GET /api/lms/canvas/courses` → `[{ id, name, code }]` — Canvas courses the connected identity **teaches**
- `GET /api/lms/canvas/courses/:courseId/link` → `{ linked: false }` | `{ linked: true, canvas: { courseId, name, code, linkedAt } }`
- `PUT /api/lms/canvas/courses/:courseId/link { canvasCourseId }` → as GET; `403 { error: 'not-teacher' }` when the id is not in the teacher list
- `DELETE /api/lms/canvas/courses/:courseId/link` → 204; also deletes the course's synced Canvas roster entries
Package errors map to `401 canvas-reconnect`, `403 canvas-forbidden`, `502 canvas-unavailable`, `409 roster-coverage`. Bodies never carry Canvas messages or `raw`.
```

- [x] **Step 11: Commit**

```bash
git add server/src/types/domain.ts server/src/components/mongodb/collections.ts server/src/services/lms-canvas.service.ts server/src/routes/lms-canvas.routes.ts tests/unit/lms-canvas.service.test.ts tests/unit/lms-canvas.routes.test.ts docs/api-contract.md
git commit -m "feat(lms): link a Canvas course the instructor teaches"
```

---

### Task 3: File import into materials

**Files:**
- Modify: `server/src/types/domain.ts` (`Material.origin`)
- Modify: `server/src/components/mongodb/collections.ts` (`INDEX_SPECS` append)
- Modify: `server/src/services/materials.service.ts:135` (export `detectUploadFormat`; add `MAX_FILES_PER_UPLOAD`)
- Modify: `server/src/routes/materials.routes.ts:117` (import the constant instead of declaring it)
- Modify: `server/src/services/lms-canvas.service.ts`
- Modify: `server/src/routes/lms-canvas.routes.ts`
- Modify: `docs/api-contract.md`
- Test: `tests/unit/lms-canvas.service.test.ts`, `tests/unit/lms-canvas.routes.test.ts`

**Interfaces:**
- Consumes: `requireLink`, `mapCanvasError`; `createMaterials(courseId, files: UploadedFile[], requestedBy)`; `canvas.getCourseFiles(api, courseId)` → `LmsFile[]` (`{ id, name, filename, size?, updatedAt? }`); `canvas.downloadFile(api, courseId, fileId, { maxBytes })` → `{ data: Uint8Array, size }`.
- Produces:
  - `MAX_FILES_PER_UPLOAD = 20` and `MAX_UPLOAD_BYTES = 50 * 1024 * 1024`, exported from `materials.service.ts`
  - `listImportableFiles(api, courseId: ObjectId): Promise<ImportableFile[]>` where `ImportableFile = { id: string; name: string; size?: number; updatedAt?: string; alreadyImported: boolean }`
  - `importFiles(api, courseId: ObjectId, fileIds: string[], byPuid: string, uploadDir: string): Promise<ImportResult>` where `ImportResult = { created: WithId<Material>[]; skipped: string[]; failed: Array<{ id: string; reason: 'download-failed' | 'too-large' | 'unsupported-format' | 'not-found' }> }`

- [x] **Step 1: Share the upload policy**

`server/src/services/materials.service.ts`: change line 135 to `export function detectUploadFormat(...)` and add, near `MATERIAL_INGEST_JOB` (line 52):

```ts
/** Upload batch and size ceilings. Shared with the Canvas import path so the
 * policy has one definition (materials.routes' multer limits read these). */
export const MAX_FILES_PER_UPLOAD = 20;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
```

`server/src/routes/materials.routes.ts`: delete line 117's `const MAX_FILES_PER_UPLOAD = 20;`, add `MAX_FILES_PER_UPLOAD, MAX_UPLOAD_BYTES` to the existing import from `../services/materials.service`, and change the multer limit to `fileSize: MAX_UPLOAD_BYTES`.

Run: `npx jest tests/unit/materials && npm run typecheck:server` — Expected: unchanged PASS.

- [x] **Step 2: Domain + index**

`domain.ts`, inside `interface Material` after `storagePath?`:

```ts
  /** Where an imported file came from (Phase 6). Present only for LMS imports;
   * the partial unique index `materials_origin_unique` makes a second import
   * of the same Canvas file a skip, not a duplicate. Survives trashing. */
  origin?: {
    provider: 'canvas';
    externalCourseId: string;
    externalFileId: string;
    sourceUpdatedAt?: Date;
    importedAt: Date;
  };
```

`collections.ts`, appended to `INDEX_SPECS` (name fixed — never change the filter under this name):

```ts
  {
    collection: 'materials',
    keys: { courseId: 1, 'origin.provider': 1, 'origin.externalCourseId': 1, 'origin.externalFileId': 1 },
    options: { unique: true, partialFilterExpression: { 'origin.provider': { $type: 'string' } }, name: 'materials_origin_unique' },
  },
```

- [x] **Step 3: Failing service tests**

Append to `tests/unit/lms-canvas.service.test.ts`. Extend the package mock with `getCourseFiles: jest.fn(), downloadFile: jest.fn()`; mock `materials.service`:

```ts
jest.mock('../../server/src/services/materials.service', () => ({
  createMaterials: jest.fn(),
  detectUploadFormat: (name: string) => (name.endsWith('.pdf') ? 'pdf' : name.endsWith('.docx') ? 'docx' : undefined),
  MAX_FILES_PER_UPLOAD: 20,
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
}));
jest.mock('node:fs/promises', () => ({ writeFile: jest.fn().mockResolvedValue(undefined), rm: jest.fn().mockResolvedValue(undefined) }));
import { createMaterials } from '../../server/src/services/materials.service';
import { listImportableFiles, importFiles } from '../../server/src/services/lms-canvas.service';
import { materialsCol } from '../../server/src/components/mongodb/collections';
```

and in `beforeEach`: `jest.mocked(materialsCol).mockReturnValue({ find: () => ({ project: () => ({ toArray: materialsFindToArray }) }) } as never);` with `const materialsFindToArray = jest.fn().mockResolvedValue([]);` reset each time. `getCourse` resolves `{ _id: courseId, canvas: { courseId: 'C1', name: 'D', code: 'D', linkedAt: new Date(), linkedBy: 'P' } }`.

```ts
describe('listImportableFiles', () => {
  it('keeps only formats upload accepts, under the size limit, and flags imported ones', async () => {
    jest.mocked(canvas.getCourseFiles).mockResolvedValue([
      { id: '10', courseId: 'C1', name: 'Week 1.pdf', filename: 'w1.pdf', size: 1000, updatedAt: '2026-08-01', raw: {} },
      { id: '11', courseId: 'C1', name: 'notes.exe', filename: 'notes.exe', size: 10, raw: {} },
      { id: '12', courseId: 'C1', name: 'huge.pdf', filename: 'huge.pdf', size: 60 * 1024 * 1024, raw: {} },
      { id: '13', courseId: 'C1', name: 'Week 2.docx', filename: 'w2.docx', size: 500, raw: {} },
    ]);
    materialsFindToArray.mockResolvedValue([{ origin: { externalFileId: '13' } }]);
    const out = await listImportableFiles(api, courseId);
    expect(canvas.getCourseFiles).toHaveBeenCalledWith(api, 'C1');
    expect(out).toEqual([
      { id: '10', name: 'Week 1.pdf', size: 1000, updatedAt: '2026-08-01', alreadyImported: false },
      { id: '13', name: 'Week 2.docx', size: 500, updatedAt: undefined, alreadyImported: true },
    ]);
  });
});

describe('importFiles', () => {
  const files = [
    { id: '10', courseId: 'C1', name: 'Week 1.pdf', filename: 'w1.pdf', size: 1000, updatedAt: '2026-08-01T00:00:00Z', raw: {} },
    { id: '13', courseId: 'C1', name: 'Week 2.docx', filename: 'w2.docx', size: 500, raw: {} },
  ];
  beforeEach(() => { jest.mocked(canvas.getCourseFiles).mockResolvedValue(files); });

  it('skips already-imported ids without downloading', async () => {
    materialsFindToArray.mockResolvedValue([{ origin: { externalFileId: '10' } }]);
    jest.mocked(canvas.downloadFile).mockResolvedValue({ data: new Uint8Array([1]), size: 1 });
    jest.mocked(createMaterials).mockResolvedValue([{ _id: new ObjectId(), name: 'Week 2.docx' }] as never);
    const out = await importFiles(api, courseId, ['10', '13'], 'P', '/tmp/uploads');
    expect(out.skipped).toEqual(['10']);
    expect(canvas.downloadFile).toHaveBeenCalledTimes(1);
    expect(canvas.downloadFile).toHaveBeenCalledWith(api, 'C1', '13', { maxBytes: 50 * 1024 * 1024 });
    expect(out.created).toHaveLength(1);
  });

  it('one failed download does not stop the others', async () => {
    jest.mocked(canvas.downloadFile)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: new Uint8Array([1]), size: 1 });
    jest.mocked(createMaterials).mockResolvedValue([{ _id: new ObjectId() }] as never);
    const out = await importFiles(api, courseId, ['10', '13'], 'P', '/tmp/uploads');
    expect(out.failed).toEqual([{ id: '10', reason: 'download-failed' }]);
    expect(out.created).toHaveLength(1);
  });

  it('hands createMaterials a path under uploadDir with the Canvas name, and stamps origin', async () => {
    jest.mocked(canvas.downloadFile).mockResolvedValue({ data: new Uint8Array([1]), size: 1 });
    const created = { _id: new ObjectId(), name: 'Week 1.pdf' };
    jest.mocked(createMaterials).mockResolvedValue([created] as never);
    const materialsUpdateOne = jest.fn();
    jest.mocked(materialsCol).mockReturnValue({
      find: () => ({ project: () => ({ toArray: materialsFindToArray }) }),
      updateOne: materialsUpdateOne,
    } as never);
    await importFiles(api, courseId, ['10'], 'P', '/tmp/uploads');
    const [, uploaded, by] = jest.mocked(createMaterials).mock.calls[0];
    expect(by).toBe('P');
    expect(uploaded[0].originalname).toBe('Week 1.pdf');
    expect(uploaded[0].path.startsWith('/tmp/uploads/')).toBe(true);
    expect(uploaded[0].path.endsWith('.pdf')).toBe(true);
    expect(materialsUpdateOne).toHaveBeenCalledWith(
      { _id: created._id },
      { $set: { origin: expect.objectContaining({ provider: 'canvas', externalCourseId: 'C1', externalFileId: '10', sourceUpdatedAt: new Date('2026-08-01T00:00:00Z') }) } },
    );
  });

  it('reports ids not in the course as not-found and unsupported formats without downloading', async () => {
    const out = await importFiles(api, courseId, ['999'], 'P', '/tmp/uploads');
    expect(out.failed).toEqual([{ id: '999', reason: 'not-found' }]);
    expect(canvas.downloadFile).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 4: Run to verify they fail**

Run: `npx jest tests/unit/lms-canvas.service.test.ts` — Expected: FAIL, functions not exported.

- [x] **Step 5: Implement**

Append to `lms-canvas.service.ts` (add imports `import fs from 'node:fs/promises'; import path from 'node:path'; import { randomUUID } from 'node:crypto'; import type { WithId } from 'mongodb'; import type { Material } from '../types/domain'; import { materialsCol } from '../components/mongodb/collections'; import { createMaterials, detectUploadFormat, MAX_UPLOAD_BYTES, type UploadedFile } from './materials.service';`):

```ts
export interface ImportableFile {
  id: string;
  name: string;
  size?: number;
  updatedAt?: string;
  alreadyImported: boolean;
}

export type ImportFailure = 'download-failed' | 'too-large' | 'unsupported-format' | 'not-found';

export interface ImportResult {
  created: WithId<Material>[];
  skipped: string[];
  failed: Array<{ id: string; reason: ImportFailure }>;
}

async function importedFileIds(courseId: ObjectId, externalCourseId: string): Promise<Set<string>> {
  const rows = await materialsCol()
    .find({ courseId, 'origin.provider': 'canvas', 'origin.externalCourseId': externalCourseId })
    .project<{ origin: { externalFileId: string } }>({ 'origin.externalFileId': 1 })
    .toArray();
  return new Set(rows.map((r) => r.origin.externalFileId));
}

/** Canvas Files the upload path could accept, with duplicates flagged. */
export async function listImportableFiles(api: canvas.ApiClient, courseId: ObjectId): Promise<ImportableFile[]> {
  const link = await requireLink(courseId);
  const [files, imported] = await Promise.all([
    canvas.getCourseFiles(api, link.courseId),
    importedFileIds(courseId, link.courseId),
  ]);
  return files
    .filter((f) => detectUploadFormat(f.name) !== undefined && (f.size === undefined || f.size <= MAX_UPLOAD_BYTES))
    .map((f) => ({ id: f.id, name: f.name, size: f.size, updatedAt: f.updatedAt, alreadyImported: imported.has(f.id) }));
}

/**
 * Import Canvas Files into materials. Per-file independent (IN-S04): one
 * failure lands in `failed`, the rest proceed. Already-imported ids are
 * skipped and reported, never refused — a retry is safe. Bytes are written
 * under `uploadDir` with the same naming multer uses, so the existing
 * "Open original" realpath check and retry path work unchanged.
 */
export async function importFiles(
  api: canvas.ApiClient,
  courseId: ObjectId,
  fileIds: string[],
  byPuid: string,
  uploadDir: string,
): Promise<ImportResult> {
  const link = await requireLink(courseId);
  const [files, imported] = await Promise.all([canvas.getCourseFiles(api, link.courseId), importedFileIds(courseId, link.courseId)]);
  const byId = new Map(files.map((f) => [f.id, f]));
  const result: ImportResult = { created: [], skipped: [], failed: [] };

  for (const id of fileIds) {
    const file = byId.get(id);
    if (!file) { result.failed.push({ id, reason: 'not-found' }); continue; }
    if (imported.has(id)) { result.skipped.push(id); continue; }
    if (detectUploadFormat(file.name) === undefined) { result.failed.push({ id, reason: 'unsupported-format' }); continue; }
    if (file.size !== undefined && file.size > MAX_UPLOAD_BYTES) { result.failed.push({ id, reason: 'too-large' }); continue; }

    const target = path.join(uploadDir, `${randomUUID()}${path.extname(file.name)}`);
    try {
      const downloaded = await canvas.downloadFile(api, link.courseId, id, { maxBytes: MAX_UPLOAD_BYTES });
      await fs.writeFile(target, downloaded.data);
    } catch {
      await fs.rm(target, { force: true });
      result.failed.push({ id, reason: 'download-failed' });
      continue;
    }

    const uploaded: UploadedFile = { originalname: file.name, path: target };
    const [material] = await createMaterials(courseId, [uploaded], byPuid);
    await materialsCol().updateOne(
      { _id: material._id },
      { $set: { origin: {
        provider: 'canvas' as const,
        externalCourseId: link.courseId,
        externalFileId: id,
        ...(file.updatedAt ? { sourceUpdatedAt: new Date(file.updatedAt) } : {}),
        importedAt: new Date(),
      } } },
    );
    result.created.push({ ...material, origin: undefined } as WithId<Material>);
    imported.add(id);
  }
  return result;
}
```

(`downloadFile` is bounded by `maxBytes`, so "too-large" after download surfaces as `download-failed`; the pre-check on `size` is the cheap path.)

- [x] **Step 6: Run the service tests**

Run: `npx jest tests/unit/lms-canvas.service.test.ts` — Expected: PASS.

- [x] **Step 7: Failing route tests, then routes**

Append to the routes test (mock `listImportableFiles`, `importFiles` in the service mock):

```ts
describe('file import routes', () => {
  it('GET files 400s not-linked', async () => {
    jest.mocked(listImportableFiles).mockRejectedValue(new Error('not-linked'));
    const res = await request(makeApp(instructor)).get(`${base}/files`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'not-linked' });
  });
  it('GET files returns the list', async () => {
    jest.mocked(listImportableFiles).mockResolvedValue([{ id: '10', name: 'a.pdf', size: 1, updatedAt: undefined, alreadyImported: false }]);
    const res = await request(makeApp(instructor)).get(`${base}/files`);
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe('10');
  });
  it('POST import 400s an empty or oversized batch', async () => {
    expect((await request(makeApp(instructor)).post(`${base}/files/import`).send({ fileIds: [] })).status).toBe(400);
    expect((await request(makeApp(instructor)).post(`${base}/files/import`).send({ fileIds: Array(21).fill('1') })).status).toBe(400);
    expect(importFiles).not.toHaveBeenCalled();
  });
  it('POST import 201s with created/skipped/failed and strips storagePath', async () => {
    jest.mocked(importFiles).mockResolvedValue({
      created: [{ _id: new ObjectId(), name: 'a.pdf', storagePath: '/secret' }] as never,
      skipped: ['2'], failed: [{ id: '3', reason: 'download-failed' }],
    });
    const res = await request(makeApp(instructor)).post(`${base}/files/import`).send({ fileIds: ['1', '2', '3'] });
    expect(res.status).toBe(201);
    expect(res.body.created[0].storagePath).toBeUndefined();
    expect(res.body.skipped).toEqual(['2']);
    expect(res.body.failed).toEqual([{ id: '3', reason: 'download-failed' }]);
    expect(importFiles).toHaveBeenCalledWith(expect.anything(), courseId, ['1', '2', '3'], 'PUID-INSTR-0001', expect.stringContaining('uploads'));
  });
  it('maps a package 403 to canvas-forbidden with no message', async () => {
    const { canvas: c } = jest.requireMock('@ubc/ubc-genai-toolkit-lms-integration');
    jest.mocked(listImportableFiles).mockRejectedValue(new c.CanvasApiError('secret detail', 403));
    const res = await request(makeApp(instructor)).get(`${base}/files`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'canvas-forbidden' });
  });
});
```

Routes, inside `createLmsCanvasRouter()` (add `import path from 'node:path'; import { MAX_FILES_PER_UPLOAD } from '../services/materials.service'; import { importFiles, listImportableFiles } from '../services/lms-canvas.service';`):

```ts
  const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads'); // same directory materials.routes uses
  const importBody = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(MAX_FILES_PER_UPLOAD) });

  function notLinked(err: unknown, res: Response): boolean {
    if (err instanceof Error && err.message === 'not-linked') { res.status(400).json({ error: 'not-linked' }); return true; }
    return false;
  }

  router.get('/lms/canvas/courses/:courseId/files', ...courseGuards, withCanvas, async (req, res) => {
    try {
      res.json(await listImportableFiles(req.canvasApi!, new ObjectId(String(req.params.courseId))));
    } catch (err) {
      if (!notLinked(err, res) && !mapCanvasError(err, res)) throw err;
    }
  });

  router.post('/lms/canvas/courses/:courseId/files/import', ...courseGuards, validate({ body: importBody }), withCanvas, async (req, res) => {
    try {
      const result = await importFiles(req.canvasApi!, new ObjectId(String(req.params.courseId)), req.body.fileIds, req.user!.puid, UPLOAD_DIR);
      res.status(201).json({
        created: result.created.map(({ storagePath: _omit, ...rest }) => rest),
        skipped: result.skipped,
        failed: result.failed,
      });
    } catch (err) {
      if (!notLinked(err, res) && !mapCanvasError(err, res)) throw err;
    }
  });
```

- [x] **Step 8: Run all, typecheck, lint**

Run: `npx jest tests/unit/lms-canvas tests/unit/materials && npm run typecheck:server && npx eslint server/src/routes/lms-canvas.routes.ts server/src/services/lms-canvas.service.ts server/src/services/materials.service.ts server/src/routes/materials.routes.ts`
Expected: PASS, clean.

- [x] **Step 9: Contract**

Add to the Canvas section of `docs/api-contract.md`:

```md
- `GET /api/lms/canvas/courses/:courseId/files` → `[{ id, name, size?, updatedAt?, alreadyImported }]` — Canvas Files in an upload-accepted format under 50 MB; `400 { error: 'not-linked' }` if the course has no link
- `POST /api/lms/canvas/courses/:courseId/files/import { fileIds: string[] }` (1–20) → 201 `{ created: [Material], skipped: [id], failed: [{ id, reason: 'download-failed' | 'too-large' | 'unsupported-format' | 'not-found' }] }`. Per-file independent; already-imported ids are skipped, so a retry never double-ingests. Created materials enter the normal `processing` pipeline
```

- [x] **Step 10: Commit**

```bash
git add server/src/types/domain.ts server/src/components/mongodb/collections.ts server/src/services/materials.service.ts server/src/routes/materials.routes.ts server/src/services/lms-canvas.service.ts server/src/routes/lms-canvas.routes.ts tests/unit/lms-canvas.service.test.ts tests/unit/lms-canvas.routes.test.ts docs/api-contract.md
git commit -m "feat(lms): import Canvas Files into course materials"
```

---

### Task 4: Roster sync

**Files:**
- Modify: `server/src/components/mongodb/collections.ts` (`INDEX_SPECS` append — the accessor and `LmsRosterEntry` type already landed in Task 2)
- Modify: `server/src/services/lms-canvas.service.ts`
- Modify: `server/src/routes/lms-canvas.routes.ts`
- Modify: `docs/api-contract.md`
- Test: `tests/unit/lms-canvas.service.test.ts`, `tests/unit/lms-canvas.routes.test.ts`, `tests/unit/collections.indexes.test.ts` (new, tiny)

**Interfaces:**
- Consumes: `requireLink`, `mapCanvasError`; `usersCol()`, `lmsRosterEntriesCol()`; `canvas.getCourseUsers(api, courseId)` → `LmsRosterUser[]` (`{ id, name, integrationId? }`); `canvas.matchCourseRoster(api, courseId, appUsers)` → `LmsRosterMatchReport`; `canvas.explainUnmatched(api, courseId, report)`; `rosterFieldCoverage(users)`.
- Produces:
  - `syncRoster(api, courseId: ObjectId): Promise<SyncResult>` where `SyncResult = { report: LmsRosterMatchReport; coverage: LmsRosterFieldCoverage; syncedAt: Date; stored: number }`. Throws the package's `CanvasGradeExportError('roster-coverage')` through untouched (nothing written).
  - `getCanvasRoster(courseId: ObjectId): Promise<{ syncedAt: Date | null; entries: Array<{ puid: string; name: string }> }>`
  - Routes: `POST /lms/canvas/courses/:courseId/roster/sync`, `GET /lms/canvas/courses/:courseId/roster/canvas`.

- [x] **Step 1: Indexes, with a test that pins them**

`collections.ts`, appended to `INDEX_SPECS`:

```ts
  { collection: 'lmsRosterEntries', keys: { courseId: 1, provider: 1, externalCourseId: 1, externalUserId: 1 }, options: { unique: true } },
  { collection: 'lmsRosterEntries', keys: { courseId: 1, provider: 1, externalCourseId: 1, puid: 1 }, options: { unique: true } },
```

`tests/unit/collections.indexes.test.ts`:

```ts
import { INDEX_SPECS } from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb', () => ({ getDb: jest.fn() }));

describe('Phase 6 index specs', () => {
  const specs = INDEX_SPECS.filter((s) => s.collection === 'lmsRosterEntries');
  it('has both unique lmsRosterEntries indexes', () => {
    expect(specs).toHaveLength(2);
    expect(specs.every((s) => s.options?.unique)).toBe(true);
    expect(specs.map((s) => Object.keys(s.keys).at(-1))).toEqual(['externalUserId', 'puid']);
  });
  it('pins the materials origin partial index name', () => {
    const origin = INDEX_SPECS.find((s) => s.options?.name === 'materials_origin_unique');
    expect(origin?.options?.partialFilterExpression).toEqual({ 'origin.provider': { $type: 'string' } });
  });
});
```

Run: `npx jest tests/unit/collections.indexes.test.ts` — Expected: PASS (both specs exist after this step).

- [x] **Step 2: Failing service tests**

Append to the service test. Extend the package mock: `getCourseUsers: jest.fn(), matchCourseRoster: jest.fn(), explainUnmatched: jest.fn()`, plus a top-level `rosterFieldCoverage: (users: Array<{ integrationId?: string }>) => ({ total: users.length, integrationId: users.filter((u) => u.integrationId).length, sisId: 0, email: 0, loginId: 0 })` and `class CanvasGradeExportError extends Error { constructor(m: string, public reason: string) { super(m); } }` exported under `canvas`. Add `usersFindToArray`, `entriesInsertMany` mocks:

```ts
const usersFindToArray = jest.fn();
const entriesInsertMany = jest.fn();
const entriesFindToArray = jest.fn();
beforeEach(() => {
  usersFindToArray.mockReset().mockResolvedValue([]);
  entriesInsertMany.mockReset();
  entriesFindToArray.mockReset().mockResolvedValue([]);
  jest.mocked(usersCol).mockReturnValue({ find: () => ({ project: () => ({ toArray: usersFindToArray }) }) } as never);
  jest.mocked(lmsRosterEntriesCol).mockReturnValue({
    deleteMany: entriesDeleteMany,
    insertMany: entriesInsertMany,
    find: () => ({ sort: () => ({ toArray: entriesFindToArray }) }),
  } as never);
});

describe('syncRoster', () => {
  const roster = [
    { id: '2', name: 'CPSC Student', integrationId: '42000001', raw: {} },
    { id: '3', name: 'Unenrolled Student', integrationId: '42999999', raw: {} },
    { id: '4', name: 'Conflict Student', raw: {} },
  ];
  const report = { courseId: 'C1', matched: [{ key: '42000001', appUserId: '42000001', lmsUserId: '2', name: 'CPSC Student', matchedBy: 'integrationId' }], appOnly: [{ key: '42000002', appUserId: '42000002', reason: 'unknown' }], rosterOnly: [{ lmsUserId: '3', name: 'Unenrolled Student', key: '42999999' }], ambiguous: [], coverage: { total: 3, integrationId: 2, sisId: 0, email: 0, loginId: 0 } };

  it('offers only students of this course as appUsers, keyed by puid', async () => {
    usersFindToArray.mockResolvedValue([{ puid: '42000001' }, { puid: '42000002' }]);
    jest.mocked(canvas.getCourseUsers).mockResolvedValue(roster);
    jest.mocked(canvas.matchCourseRoster).mockResolvedValue(report as never);
    jest.mocked(canvas.explainUnmatched).mockImplementation(async (_a, _c, r) => r);
    await syncRoster(api, courseId);
    expect(usersCol().find).toBeDefined();
    expect(canvas.matchCourseRoster).toHaveBeenCalledWith(api, 'C1', [
      { appUserId: '42000001', key: '42000001' },
      { appUserId: '42000002', key: '42000002' },
    ]);
  });

  it('stores only users with an integrationId, replacing the previous set', async () => {
    jest.mocked(canvas.getCourseUsers).mockResolvedValue(roster);
    jest.mocked(canvas.matchCourseRoster).mockResolvedValue(report as never);
    jest.mocked(canvas.explainUnmatched).mockImplementation(async (_a, _c, r) => r);
    const out = await syncRoster(api, courseId);
    expect(entriesDeleteMany).toHaveBeenCalledWith({ courseId });
    const inserted = entriesInsertMany.mock.calls[0][0];
    expect(inserted.map((e: { puid: string }) => e.puid)).toEqual(['42000001', '42999999']);
    expect(inserted[0]).toMatchObject({ provider: 'canvas', externalCourseId: 'C1', externalUserId: '2', name: 'CPSC Student', matchedBy: 'integrationId' });
    expect(out.stored).toBe(2);
    expect(out.coverage).toEqual({ total: 3, integrationId: 2, sisId: 0, email: 0, loginId: 0 });
  });

  it('writes nothing when the package refuses on roster-coverage', async () => {
    jest.mocked(canvas.getCourseUsers).mockResolvedValue([{ id: '9', name: 'Blank', raw: {} }]);
    jest.mocked(canvas.matchCourseRoster).mockRejectedValue(new canvas.CanvasGradeExportError('x', 'roster-coverage'));
    await expect(syncRoster(api, courseId)).rejects.toMatchObject({ reason: 'roster-coverage' });
    expect(entriesDeleteMany).not.toHaveBeenCalled();
    expect(entriesInsertMany).not.toHaveBeenCalled();
  });

  it('an empty Canvas roster clears the set without throwing', async () => {
    jest.mocked(canvas.getCourseUsers).mockResolvedValue([]);
    jest.mocked(canvas.matchCourseRoster).mockResolvedValue({ ...report, matched: [], rosterOnly: [], coverage: { total: 0, integrationId: 0, sisId: 0, email: 0, loginId: 0 } } as never);
    jest.mocked(canvas.explainUnmatched).mockImplementation(async (_a, _c, r) => r);
    const out = await syncRoster(api, courseId);
    expect(entriesDeleteMany).toHaveBeenCalledWith({ courseId });
    expect(entriesInsertMany).not.toHaveBeenCalled();
    expect(out.stored).toBe(0);
  });
});

describe('getCanvasRoster', () => {
  it('returns puid+name only, with the latest syncedAt', async () => {
    const t = new Date('2026-08-27T10:00:00Z');
    entriesFindToArray.mockResolvedValue([{ puid: 'A', name: 'a', syncedAt: t, externalUserId: '1' }]);
    expect(await getCanvasRoster(courseId)).toEqual({ syncedAt: t, entries: [{ puid: 'A', name: 'a' }] });
  });
  it('reports null syncedAt when never synced', async () => {
    expect(await getCanvasRoster(courseId)).toEqual({ syncedAt: null, entries: [] });
  });
});
```

- [x] **Step 3: Run to verify they fail**

Run: `npx jest tests/unit/lms-canvas.service.test.ts` — Expected: FAIL, `syncRoster`/`getCanvasRoster` not exported.

- [x] **Step 4: Implement**

Append to `lms-canvas.service.ts` (add `import { rosterFieldCoverage } from '@ubc/ubc-genai-toolkit-lms-integration'; import type { LmsRosterFieldCoverage, LmsRosterMatchReport } from '@ubc/ubc-genai-toolkit-lms-integration'; import { usersCol } from '../components/mongodb/collections'; import type { LmsRosterEntry } from '../types/domain';`):

```ts
export interface SyncResult {
  report: LmsRosterMatchReport;
  coverage: LmsRosterFieldCoverage;
  syncedAt: Date;
  stored: number;
}

/**
 * Sync the linked Canvas roster. Two independent outputs from one read:
 *
 * 1. A match report, for display — `appUsers` are the students already
 *    enrolled in this FinanceBot course, keyed by PUID, so `matched` means
 *    "enrolled and on Canvas", `rosterOnly` "on Canvas, not yet enrolled"
 *    (normal), `appOnly` "enrolled here, gone from Canvas" (explained as
 *    enrollment-ended vs not-enrolled).
 * 2. The stored entries: every Canvas user WITH an integrationId, whether or
 *    not they have ever logged in — that is what makes them enrollable.
 *
 * The package throws `roster-coverage` when a non-empty roster carries no
 * integrationId at all; that propagates and nothing is written, because the
 * state is indistinguishable from an empty class and must not be recorded
 * as one.
 */
export async function syncRoster(api: canvas.ApiClient, courseId: ObjectId): Promise<SyncResult> {
  const link = await requireLink(courseId);
  const students = await usersCol()
    .find({ courseRoles: { $elemMatch: { courseId, role: 'student' } } })
    .project<{ puid: string }>({ puid: 1 })
    .toArray();
  const appUsers = students.map((s) => ({ appUserId: s.puid, key: s.puid }));

  const users = await canvas.getCourseUsers(api, link.courseId);
  const coverage = rosterFieldCoverage(users);
  const matched = await canvas.matchCourseRoster(api, link.courseId, appUsers); // throws roster-coverage
  const report = await canvas.explainUnmatched(api, link.courseId, matched);

  const syncedAt = new Date();
  const entries: LmsRosterEntry[] = users
    .filter((u): u is typeof u & { integrationId: string } => typeof u.integrationId === 'string' && u.integrationId.trim() !== '')
    .map((u) => ({
      courseId,
      provider: 'canvas',
      externalCourseId: link.courseId,
      externalUserId: u.id,
      puid: u.integrationId.trim(),
      name: u.name,
      matchedBy: 'integrationId',
      syncedAt,
    }));

  await lmsRosterEntriesCol().deleteMany({ courseId });
  if (entries.length > 0) await lmsRosterEntriesCol().insertMany(entries);
  return { report, coverage, syncedAt, stored: entries.length };
}

export async function getCanvasRoster(courseId: ObjectId): Promise<{ syncedAt: Date | null; entries: Array<{ puid: string; name: string }> }> {
  const rows = await lmsRosterEntriesCol().find({ courseId }).sort({ name: 1 }).toArray();
  return {
    syncedAt: rows.reduce<Date | null>((latest, r) => (!latest || r.syncedAt > latest ? r.syncedAt : latest), null),
    entries: rows.map((r) => ({ puid: r.puid, name: r.name })),
  };
}
```

Note the double read (`getCourseUsers` then `matchCourseRoster`, which reads again): two roster requests per sync. Acceptable for a manual action; `matchRosterByIntegrationId(courseId, users, appUsers)` would avoid it but loses the package's course-id stamping guarantee. Keep the two calls.

- [x] **Step 5: Run the service tests**

Run: `npx jest tests/unit/lms-canvas.service.test.ts` — Expected: PASS.

- [x] **Step 6: Failing route tests, then routes**

Append to the routes test (mock `syncRoster`, `getCanvasRoster`):

```ts
describe('roster sync routes', () => {
  it('POST sync 409s roster-coverage with a fixed body', async () => {
    const { canvas: c } = jest.requireMock('@ubc/ubc-genai-toolkit-lms-integration');
    jest.mocked(syncRoster).mockRejectedValue(new c.CanvasGradeExportError('all blank', 'roster-coverage'));
    const res = await request(makeApp(instructor)).post(`${base}/roster/sync`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'roster-coverage' });
  });
  it('POST sync returns report, coverage, syncedAt, stored — and no raw', async () => {
    const t = new Date('2026-08-27T10:00:00Z');
    jest.mocked(syncRoster).mockResolvedValue({
      report: { courseId: 'C1', matched: [], appOnly: [], rosterOnly: [{ lmsUserId: '3', name: 'U', key: '42999999' }], ambiguous: [], coverage: { total: 1, integrationId: 1, sisId: 0, email: 0, loginId: 0 } } as never,
      coverage: { total: 1, integrationId: 1, sisId: 0, email: 0, loginId: 0 }, syncedAt: t, stored: 1,
    });
    const res = await request(makeApp(instructor)).post(`${base}/roster/sync`);
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(1);
    expect(res.body.syncedAt).toBe(t.toISOString());
    expect(res.body.report.rosterOnly[0].name).toBe('U');
    expect(JSON.stringify(res.body)).not.toContain('"raw"');
  });
  it('GET roster/canvas returns the stored entries', async () => {
    jest.mocked(getCanvasRoster).mockResolvedValue({ syncedAt: null, entries: [] });
    const res = await request(makeApp(instructor)).get(`${base}/roster/canvas`);
    expect(res.body).toEqual({ syncedAt: null, entries: [] });
  });
});
```

Routes (inside the factory; import `getCanvasRoster, syncRoster`):

```ts
  router.post('/lms/canvas/courses/:courseId/roster/sync', ...courseGuards, withCanvas, async (req, res) => {
    try {
      res.json(await syncRoster(req.canvasApi!, new ObjectId(String(req.params.courseId))));
    } catch (err) {
      if (!notLinked(err, res) && !mapCanvasError(err, res)) throw err;
    }
  });

  router.get('/lms/canvas/courses/:courseId/roster/canvas', ...courseGuards, async (req, res) => {
    res.json(await getCanvasRoster(new ObjectId(String(req.params.courseId))));
  });
```

- [x] **Step 7: Run all, typecheck, lint**

Run: `npx jest tests/unit/lms-canvas tests/unit/collections.indexes.test.ts && npm run typecheck:server && npx eslint server/src/routes/lms-canvas.routes.ts server/src/services/lms-canvas.service.ts server/src/components/mongodb/collections.ts`
Expected: PASS, clean.

- [x] **Step 8: Contract**

Add to the Canvas section:

```md
- `POST /api/lms/canvas/courses/:courseId/roster/sync` → `{ report, coverage, syncedAt, stored }`. `report` is the package's `LmsRosterMatchReport` (`matched` / `rosterOnly` / `appOnly` with `reason` / `ambiguous`), matched on Canvas `integration_id` = PUID against students enrolled in this course. Storage replaces the course's Canvas-sourced roster with every Canvas user carrying an `integration_id`. `409 { error: 'roster-coverage' }` when a non-empty roster exposes no `integration_id` at all — nothing is written.
- `GET /api/lms/canvas/courses/:courseId/roster/canvas` → `{ syncedAt | null, entries: [{ puid, name }] }`
```

- [x] **Step 9: Commit**

```bash
git add server/src/components/mongodb/collections.ts server/src/services/lms-canvas.service.ts server/src/routes/lms-canvas.routes.ts tests/unit/lms-canvas.service.test.ts tests/unit/lms-canvas.routes.test.ts tests/unit/collections.indexes.test.ts docs/api-contract.md
git commit -m "feat(lms): sync the Canvas roster, matched on integration_id"
```

---

### Task 5: Enrollment gate + PRD

**Files:**
- Modify: `server/src/services/enrollment.service.ts:36-38` and `:70-72`
- Modify: `docs/PRD.md:49`, `:64`, `:310-312`
- Test: `tests/unit/enrollment.service.test.ts`

**Interfaces:**
- Consumes: `lmsRosterEntriesCol()` (Task 2).
- Produces: no new exports. `enrollByCode` and `listEnrollments` accept a Canvas roster hit by PUID.

- [x] **Step 1: Failing tests**

In `tests/unit/enrollment.service.test.ts`, add `lmsRosterEntriesCol: jest.fn()` to the collections mock, a `const lmsFindOne = jest.fn();` reset in `beforeEach` with `jest.mocked(lmsRosterEntriesCol).mockReturnValue({ findOne: lmsFindOne } as never);` and default `lmsFindOne.mockResolvedValue(null)` so **every existing test runs unchanged**. Then:

```ts
describe('enrollByCode with a synced Canvas roster (Phase 6)', () => {
  it('enrolls a student on the Canvas roster by PUID with no CSV entry', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue(null);
    lmsFindOne.mockResolvedValue({ courseId, puid: 'P1', name: 'S' });
    usersUpdateOne.mockResolvedValue({});
    const result = await enrollByCode(student, 'GOODCODE');
    expect(result.courseId).toEqual(courseId);
    expect(lmsFindOne).toHaveBeenCalledWith({ courseId, puid: 'P1' });
  });

  it('still refuses a student on neither roster', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue(null);
    lmsFindOne.mockResolvedValue(null);
    await expect(enrollByCode(student, 'GOODCODE')).rejects.toMatchObject({ code: 'not-on-roster' });
  });

  it('does not consult the Canvas roster when the CSV roster already matched', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue({ courseId, identifier: 'student1' });
    usersUpdateOne.mockResolvedValue({});
    await enrollByCode(student, 'GOODCODE');
    expect(lmsFindOne).not.toHaveBeenCalled();
  });

  it('a Canvas-only student is active until termEnd (no extendedUntil path)', async () => {
    coursesFindOne.mockResolvedValue(activeCourse);
    rosterFindOne.mockResolvedValue(null);
    lmsFindOne.mockResolvedValue({ courseId, puid: 'P1' });
    const enrolled = { ...student, courseRoles: [{ courseId, role: 'student' as const }] } as User;
    const [row] = await listEnrollments(enrolled);
    expect(row.active).toBe(true);
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/enrollment.service.test.ts` — Expected: the four new tests FAIL (`not-on-roster` / `lmsRosterEntriesCol` never called).

- [x] **Step 3: Implement — one lookup, twice**

`enrollment.service.ts`, add `lmsRosterEntriesCol` to the collections import. In `enrollByCode`, replace lines 36–38 with:

```ts
  const identifiers = [user.uid, user.email].filter(Boolean).map((s) => s.toLowerCase());
  const rosterHit = await rosterCol().findOne({ courseId: course._id, identifier: { $in: identifiers } });
  // Phase 6: a synced Canvas roster (matched on integration_id = PUID) is an
  // alternative to the CSV roster, never a replacement. Consulted only when
  // the CSV roster did not match, so existing behaviour is byte-identical.
  const lmsHit = rosterHit ? null : await lmsRosterEntriesCol().findOne({ courseId: course._id, puid: user.puid });
  if (!rosterHit && !lmsHit) throw new EnrollmentError('not-on-roster');

  const ends = rosterHit?.extendedUntil ?? course.termEnd;
```

In `listEnrollments`, no change is required: `rosterHit?.extendedUntil ?? course.termEnd` already yields `termEnd` when there is no CSV row, which is the correct end date for a Canvas-only student. Add the comment:

```ts
      // A Canvas-only student (Phase 6) has no CSV row and therefore no
      // extendedUntil; termEnd applies. Extensions are granted by adding the
      // student to the CSV roster — that path is the escape hatch by design.
```

- [x] **Step 4: Run the full enrollment suite**

Run: `npx jest tests/unit/enrollment.service.test.ts` — Expected: every pre-existing test and the four new ones PASS.

- [x] **Step 5: PRD**

`docs/PRD.md`:
- Line 49: `LTI / Canvas API / grade passback — stretch goal, not MVP.` → `LTI / grade passback — stretch goal, not MVP. Canvas course linking, file import, and roster sync are in scope from Phase 6 (OAuth, read-only; see docs/superpowers/specs/2026-08-27-canvas-integration-design.md).`
- Line 64, the sentence `Direct enrollment via UBC Academic API and Canvas integration remain stretch goals (Academic API would eventually remove the need for manual roster maintenance).` → `A course linked to Canvas (Phase 6) can sync its Canvas roster, matched on the student's institutional identifier; a synced student enrolls with the registration code alone. Synced entries add to the manual roster rather than replacing it. Direct enrollment via UBC Academic API remains a stretch goal.`
- Lines 310–312 (Stretch Goals): keep `Canvas gradebook integration` and `Automatic upload to Canvas`; they are still out of scope.

- [x] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck:server && npx eslint server/src/services/enrollment.service.ts && npx jest`
Expected: full suite PASS.

```bash
git add server/src/services/enrollment.service.ts tests/unit/enrollment.service.test.ts docs/PRD.md
git commit -m "feat(enrollment): accept a synced Canvas roster entry by PUID"
```

---

### Task 6: Instructor UI

**Files:**
- Modify: `client/src/api.ts` (append)
- Create: `client/src/views/instructor/canvas-panel.ts`
- Modify: `client/src/views/instructor/settings.ts` (`:9-25` imports; `:507-512` the second column)
- Modify: `client/src/views/instructor/materials.ts` (`:107-141` state; `:362` beside `uploadZone`)
- Modify: `client/public/styles/main.css` (append — it defines `.settings-layout`)
- Test: hand smoke recorded in `STATUS.md`; the pure helpers in `canvas-panel.ts` (`coverageMessage`, `bucketCounts`) are unit-tested under node in `tests/unit/canvas-panel.test.ts`.

**Interfaces:**
- Consumes: every route from Tasks 1–4; `el`, `mount` from `dom.js`; `sectionTitleWithHelp`, `statusBadge` from `instructor-ui.js`; `confirmDialog` from `modal.js`; `errorState`, `loadingState` from `ui.js`; `ApiError`.
- Produces (`api.ts`): `getCanvasStatus()`, `listCanvasCourses()`, `getCanvasLink(courseId)`, `linkCanvasCourse(courseId, canvasCourseId)`, `unlinkCanvasCourse(courseId)`, `listCanvasFiles(courseId)`, `importCanvasFiles(courseId, fileIds)`, `syncCanvasRoster(courseId)`, `getCanvasRoster(courseId)`, `canvasLoginUrl(returnTo)`.
- Produces (`canvas-panel.ts`): `renderCanvasCard(courseId: string, onRosterChanged: () => void): HTMLElement` and `openCanvasImportDialog(courseId: string): Promise<Material[]>`.

- [x] **Step 1: API functions**

Append to `client/src/api.ts`:

```ts
// --- Canvas LMS (instructor; Phase 6) ---------------------------------------

export interface CanvasLink { courseId: string; name: string; code: string; linkedAt: string }
export interface CanvasImportableFile { id: string; name: string; size?: number; updatedAt?: string; alreadyImported: boolean }
export interface CanvasImportResult { created: Material[]; skipped: string[]; failed: Array<{ id: string; reason: string }> }
export interface CanvasCoverage { total: number; integrationId: number; sisId: number; email: number; loginId: number }
export interface CanvasSyncResult {
  report: {
    matched: Array<{ key: string; lmsUserId: string; name: string; matchedBy: string }>;
    rosterOnly: Array<{ lmsUserId: string; name: string; key?: string }>;
    appOnly: Array<{ key: string; reason: 'unknown' | 'not-enrolled' | 'enrollment-ended'; formerEnrollment?: { name: string } }>;
    ambiguous: Array<{ key: string; lmsUserIds: string[] }>;
  };
  coverage: CanvasCoverage;
  syncedAt: string;
  stored: number;
}

/** 404 means this deployment has no Canvas credentials at all. */
export async function getCanvasStatus(): Promise<{ connected: boolean } | null> {
  try {
    return await request<{ connected: boolean }>('/api/lms/canvas/status');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
export function canvasLoginUrl(returnTo: string): string {
  return `/api/lms/canvas/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}
export function listCanvasCourses(): Promise<Array<{ id: string; name: string; code: string }>> {
  return request('/api/lms/canvas/courses');
}
export function getCanvasLink(courseId: string): Promise<{ linked: false } | { linked: true; canvas: CanvasLink }> {
  return request(`/api/lms/canvas/courses/${encodeURIComponent(courseId)}/link`);
}
export function linkCanvasCourse(courseId: string, canvasCourseId: string): Promise<{ linked: true; canvas: CanvasLink }> {
  return request(`/api/lms/canvas/courses/${encodeURIComponent(courseId)}/link`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canvasCourseId }),
  });
}
export function unlinkCanvasCourse(courseId: string): Promise<void> {
  return request(`/api/lms/canvas/courses/${encodeURIComponent(courseId)}/link`, { method: 'DELETE' });
}
export function listCanvasFiles(courseId: string): Promise<CanvasImportableFile[]> {
  return request(`/api/lms/canvas/courses/${encodeURIComponent(courseId)}/files`);
}
export function importCanvasFiles(courseId: string, fileIds: string[]): Promise<CanvasImportResult> {
  return request(`/api/lms/canvas/courses/${encodeURIComponent(courseId)}/files/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileIds }),
  });
}
export function syncCanvasRoster(courseId: string): Promise<CanvasSyncResult> {
  return request(`/api/lms/canvas/courses/${encodeURIComponent(courseId)}/roster/sync`, { method: 'POST' });
}
export function getCanvasRoster(courseId: string): Promise<{ syncedAt: string | null; entries: Array<{ puid: string; name: string }> }> {
  return request(`/api/lms/canvas/courses/${encodeURIComponent(courseId)}/roster/canvas`);
}
```

Check `ApiError` exposes `status` (it is constructed with `(message, response.status)` at `api.ts:29`; if the field is named differently, use that name).

- [x] **Step 2: Pure helpers, with tests first**

`tests/unit/canvas-panel.test.ts` (client pure logic under node, as `duplicate-name.test.ts` does):

```ts
import { coverageMessage, bucketCounts } from '../../client/src/views/instructor/canvas-panel';

describe('coverageMessage', () => {
  it('is empty at full coverage', () => {
    expect(coverageMessage({ total: 3, integrationId: 3, sisId: 0, email: 0, loginId: 0 })).toBe('');
  });
  it('names the gap', () => {
    expect(coverageMessage({ total: 3, integrationId: 2, sisId: 0, email: 0, loginId: 0 }))
      .toBe('1 student has no student ID visible in Canvas and was not added.');
    expect(coverageMessage({ total: 5, integrationId: 2, sisId: 0, email: 0, loginId: 0 }))
      .toBe('3 students have no student ID visible in Canvas and were not added.');
  });
});

describe('bucketCounts', () => {
  it('reads the three counts an instructor needs', () => {
    expect(bucketCounts({ matched: [{}, {}], rosterOnly: [{}], appOnly: [], ambiguous: [] } as never))
      .toEqual({ matched: 2, rosterOnly: 1, appOnly: 0 });
  });
});
```

Run: `npx jest tests/unit/canvas-panel.test.ts` — Expected: FAIL, module not found.

- [x] **Step 3: The panel module**

`client/src/views/instructor/canvas-panel.ts`:

```ts
// Canvas card (Settings) and Import-from-Canvas dialog (Materials). Phase 6.
// Design: docs/superpowers/specs/2026-08-27-canvas-integration-design.md §UI.
import {
  ApiError,
  canvasLoginUrl,
  getCanvasLink,
  getCanvasStatus,
  importCanvasFiles,
  linkCanvasCourse,
  listCanvasCourses,
  listCanvasFiles,
  syncCanvasRoster,
  unlinkCanvasCourse,
  type CanvasCoverage,
  type CanvasSyncResult,
  type Material,
} from '../../api.js';
import { el } from '../../dom.js';
import { confirmDialog } from '../../modal.js';
import { sectionTitleWithHelp } from '../../instructor-ui.js';
import { errorState, loadingState } from '../../ui.js';

const HELP = 'Connect your own Canvas account, link the Canvas course you teach, then sync its roster or import its files. '
  + 'Synced students can enroll with the registration code alone; the CSV roster still works alongside it.';

export function coverageMessage(coverage: CanvasCoverage): string {
  const missing = coverage.total - coverage.integrationId;
  if (missing <= 0) return '';
  return missing === 1
    ? '1 student has no student ID visible in Canvas and was not added.'
    : `${missing} students have no student ID visible in Canvas and were not added.`;
}

export function bucketCounts(report: CanvasSyncResult['report']): { matched: number; rosterOnly: number; appOnly: number } {
  return { matched: report.matched.length, rosterOnly: report.rosterOnly.length, appOnly: report.appOnly.length };
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.message === 'canvas-reconnect') return 'Your Canvas connection has expired. Reconnect to continue.';
    if (error.message === 'canvas-forbidden') return 'Canvas denied access for your account. Check that you teach this course in Canvas.';
    if (error.message === 'roster-coverage') return 'Canvas isn’t exposing student IDs to your account; nothing was changed.';
    if (error.message === 'not-teacher') return 'You are not a teacher of that Canvas course.';
    if (error.message === 'canvas-unavailable') return 'Canvas didn’t respond. Try again in a moment.';
    return error.message;
  }
  return (error as Error).message;
}

const REASON_LABEL: Record<'unknown' | 'not-enrolled' | 'enrollment-ended', string> = {
  unknown: 'not on the Canvas roster',
  'not-enrolled': 'never enrolled in this Canvas course — is the right course linked?',
  'enrollment-ended': 'dropped in Canvas',
};

function reportView(result: CanvasSyncResult): HTMLElement {
  const counts = bucketCounts(result.report);
  const coverage = coverageMessage(result.coverage);
  const bucket = (title: string, rows: string[]) =>
    rows.length
      ? el('details', { class: 'canvas-report__bucket' }, el('summary', { text: `${title} (${rows.length})` }), el('ul', {}, ...rows.map((r) => el('li', { text: r }))))
      : el('p', { class: 'canvas-report__empty', text: `${title}: none` });
  return el(
    'div',
    { class: 'canvas-report', 'aria-live': 'polite' },
    el('p', { class: 'canvas-report__counts', text: `${counts.matched} matched · ${counts.rosterOnly} on Canvas only · ${counts.appOnly} in FinanceBot only` }),
    el('p', { class: 'canvas-report__coverage', text: `Student IDs visible for ${result.coverage.integrationId} of ${result.coverage.total} · ${result.stored} added to the roster · synced ${new Date(result.syncedAt).toLocaleString()}` }),
    coverage ? el('p', { class: 'canvas-report__warn', text: coverage }) : el('span'),
    bucket('Matched', result.report.matched.map((m) => m.name)),
    bucket('On Canvas only', result.report.rosterOnly.map((r) => r.name)),
    bucket('In FinanceBot only', result.report.appOnly.map((a) => `${a.formerEnrollment?.name ?? a.key} — ${REASON_LABEL[a.reason]}`)),
    bucket('Ambiguous', result.report.ambiguous.map((a) => `${a.lmsUserIds.length} Canvas accounts share one ID`)),
  );
}

/** The Settings card. Renders nothing when the deployment has no Canvas. */
export function renderCanvasCard(courseId: string, onRosterChanged: () => void): HTMLElement {
  const root = el('div', { class: 'canvas-card stack', id: 'canvas' });
  const body = el('div', {}, loadingState('Checking Canvas…'));
  root.append(sectionTitleWithHelp('Canvas', HELP), body);
  const returnTo = `${location.pathname}#canvas`;

  async function refresh(): Promise<void> {
    try {
      const status = await getCanvasStatus();
      if (status === null) { root.replaceChildren(); return; }
      if (!status.connected) { body.replaceChildren(step(1, 'Connect your Canvas account', el('a', { class: 'btn btn--primary', href: canvasLoginUrl(returnTo), text: 'Connect Canvas' }))); return; }
      const link = await getCanvasLink(courseId);
      if (!link.linked) { body.replaceChildren(await chooseCourse()); return; }
      body.replaceChildren(linked(link.canvas.name, link.canvas.code));
    } catch (error) {
      body.replaceChildren(errorState(errorText(error), () => void refresh()));
    }
  }

  function step(n: number, title: string, ...children: HTMLElement[]): HTMLElement {
    return el('div', { class: 'canvas-step' }, el('p', { class: 'canvas-step__label', text: `Step ${n} of 3 · ${title}` }), ...children);
  }

  async function chooseCourse(): Promise<HTMLElement> {
    const courses = await listCanvasCourses();
    if (courses.length === 0) return step(2, 'Choose the Canvas course', el('p', { text: 'Canvas lists no courses you teach. Check your Canvas enrolments, or reconnect with the right account.' }));
    const select = el('select', { class: 'input', 'aria-label': 'Canvas course' }, ...courses.map((c) => el('option', { value: c.id, text: `${c.code} — ${c.name}` }))) as HTMLSelectElement;
    const slot = el('div', {});
    const button = el('button', { class: 'btn btn--primary', type: 'button', text: 'Link course', onclick: async () => {
      try { await linkCanvasCourse(courseId, select.value); await refresh(); }
      catch (error) { slot.replaceChildren(errorState(errorText(error))); }
    } });
    return step(2, 'Choose the Canvas course', select, button, slot);
  }

  function linked(name: string, code: string): HTMLElement {
    const slot = el('div', {});
    const sync = el('button', { class: 'btn btn--primary', type: 'button', text: 'Sync roster', onclick: async () => {
      sync.setAttribute('disabled', 'true');
      slot.replaceChildren(loadingState('Reading the Canvas roster…'));
      try { slot.replaceChildren(reportView(await syncCanvasRoster(courseId))); onRosterChanged(); }
      catch (error) { slot.replaceChildren(errorState(errorText(error))); }
      finally { sync.removeAttribute('disabled'); }
    } });
    const unlink = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Unlink', onclick: async () => {
      const ok = await confirmDialog({ title: 'Unlink Canvas course?', message: 'Students added from Canvas will no longer be able to enroll unless they are on the CSV roster. Imported materials stay.', confirmLabel: 'Unlink', tone: 'danger' });
      if (!ok) return;
      try { await unlinkCanvasCourse(courseId); onRosterChanged(); await refresh(); }
      catch (error) { slot.replaceChildren(errorState(errorText(error))); }
    } });
    return step(3, 'Linked', el('p', { class: 'canvas-linked', text: `${code} — ${name}` }), el('div', { class: 'canvas-actions' }, sync, unlink), slot);
  }

  void refresh();
  return root;
}

/** Materials: pick Canvas Files, confirm, import. Resolves with created materials. */
export async function openCanvasImportDialog(courseId: string): Promise<Material[]> {
  const files = await listCanvasFiles(courseId);
  const chosen = new Set<string>();
  const list = el('div', { class: 'canvas-files' }, ...files.map((f) => {
    const box = el('input', { type: 'checkbox', id: `cf-${f.id}`, ...(f.alreadyImported ? { disabled: 'true' } : {}) }) as HTMLInputElement;
    box.addEventListener('change', () => (box.checked ? chosen.add(f.id) : chosen.delete(f.id)));
    return el('label', { class: 'canvas-files__row', for: `cf-${f.id}` }, box, el('span', { text: f.name }), el('span', { class: 'muted', text: f.alreadyImported ? 'already imported' : f.size ? `${Math.round(f.size / 1024)} KB` : '' }));
  }));
  const dialog = el('dialog', { class: 'app-dialog' }, el('h2', { text: 'Import from Canvas' }), files.length ? list : el('p', { text: 'No importable files in the linked Canvas course.' }),
    el('div', { class: 'app-dialog__actions' },
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
      el('button', { class: 'btn btn--primary', type: 'button', text: 'Import selected', onclick: () => dialog.close('ok') }))) as HTMLDialogElement;
  document.body.append(dialog);
  dialog.showModal();
  const outcome = await new Promise<string>((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
  dialog.remove();
  if (outcome !== 'ok' || chosen.size === 0) return [];
  const ids = [...chosen];
  const ok = await confirmDialog({ title: `Import ${ids.length} file${ids.length === 1 ? '' : 's'}?`, message: files.filter((f) => chosen.has(f.id)).map((f) => f.name).join(', '), confirmLabel: 'Import' });
  if (!ok) return [];
  const result = await importCanvasFiles(courseId, ids);
  if (result.failed.length) throw new ApiError(`${result.created.length} imported; ${result.failed.length} failed (${result.failed.map((f) => f.reason).join(', ')}).`, 207);
  return result.created;
}
```

Run: `npx jest tests/unit/canvas-panel.test.ts` — Expected: PASS. (If ts-jest chokes on the `.js` imports of DOM modules under node, the moduleNameMapper at `jest.config.js:29` strips the extension; `dom.js` has no browser-only top-level code, as `duplicate-name.test.ts` relies on.)

- [x] **Step 4: Settings**

`settings.ts`: import `renderCanvasCard` from `./canvas-panel.js`. In the second `settings-column` (line ~507), **after** the Roster block, append:

```ts
        renderCanvasCard(courseId, () => void refreshRosterCount()),
```

where `refreshRosterCount` re-fetches `getCanvasRoster(courseId)` and updates the roster heading to read `${roster.length} from CSV · ${canvas.entries.length} from Canvas`. Implement it beside `renderRosterList` (~line 256) as:

```ts
  let canvasCount = 0;
  async function refreshRosterCount(): Promise<void> {
    try { canvasCount = (await getCanvasRoster(courseId)).entries.length; } catch { canvasCount = 0; }
    rosterCountEl.textContent = `${roster.length} from CSV · ${canvasCount} from Canvas`;
  }
  const rosterCountEl = el('p', { class: 'roster-count muted' });
  void refreshRosterCount();
```

and mount `rosterCountEl` directly under `sectionTitleWithHelp('Roster', HELP.roster)`. If `getCanvasRoster` 404s (no Canvas), the count reads `0 from Canvas` — acceptable, but hide `rosterCountEl` when `getCanvasStatus()` returned `null` by calling `refreshRosterCount` only from the card's `onRosterChanged` and once after a successful status probe. Simplest: have `renderCanvasCard` call `onRosterChanged()` once after its first successful `refresh()`.

On load, if `location.hash === '#canvas'`, call `document.getElementById('canvas')?.scrollIntoView()` after mount so the OAuth return lands on the card.

- [x] **Step 5: Materials**

`materials.ts`: import `openCanvasImportDialog` from `./canvas-panel.js` and `getCanvasLink` from `../../api.js`. Add state `let canvasLinked = false;` beside `fileMode`, and in the initial load `Promise.all`, add `getCanvasLink(courseId).then((l) => l.linked).catch(() => false)` → `canvasLinked`. Beside `uploadZone(...)` at line 362:

```ts
      canvasLinked
        ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Import from Canvas', onclick: () => void doCanvasImport() })
        : el('span'),
```

and beside `doUpload`:

```ts
  async function doCanvasImport(): Promise<void> {
    feedback.replaceChildren();
    try {
      const created = await openCanvasImportDialog(courseId);
      if (created.length === 0) return;
      materials = [...created, ...materials];
      fileMode = 'files';
      if (created[0]) selectMaterial(created[0]);
      flash(`${created.length} file${created.length === 1 ? '' : 's'} imported from Canvas. Processing is running in the activity stream.`);
      refresh();
    } catch (error) {
      feedback.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    }
  }
```

- [x] **Step 6: Styles**

Append to `client/public/styles/main.css`:

```css
/* Canvas card + import dialog (Phase 6) */
.canvas-step__label { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.canvas-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.canvas-report__counts { font-weight: 600; }
.canvas-report__warn { color: var(--warning-text, #8a5a00); }
.canvas-report__bucket summary { cursor: pointer; }
.canvas-files { display: grid; gap: 0.25rem; max-height: 50vh; overflow: auto; }
.canvas-files__row { display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; align-items: center; }
```

- [x] **Step 7: Typecheck, lint, build**

Run: `npm run typecheck && npx eslint client/src/views/instructor/canvas-panel.ts client/src/views/instructor/settings.ts client/src/views/instructor/materials.ts client/src/api.ts && npm run build:client`
Expected: clean.

- [x] **Step 8: Hand smoke against local Canvas — the acceptance test**

With `../local-lms-dev` up and the app running:
1. Sign in as `faculty`, create or open a course, publish it. Settings → the Canvas card shows **Step 1**.
2. Connect as `teacher1@example.com` / `password`. Back on Settings at `#canvas`, **Step 2** lists `FINBOT-DEMO — FinanceBot Demo Course`. Link it → **Step 3**.
3. Materials → **Import from Canvas** → pick a file (upload one PDF to Canvas Files as `teacher1` first if none is there) → it appears `processing`, then `ready`.
4. Sign in once as `cpsc_student` and once as `conflict_student` (both local IdP users) so `User` rows exist; enroll `cpsc_student` by code — expected **refused** (not on any roster yet).
5. As `faculty`: Settings → **Sync roster**. Nobody is enrolled yet, so expect **0 matched / 2 on Canvas only / 0 in FinanceBot only**, *Student IDs visible for 2 of 3*, *2 added*, and the warning *"1 student has no student ID visible in Canvas and was not added."*
6. As `cpsc_student`: enroll by code with no CSV entry → **succeeds**. As `conflict_student`: enroll by code → **refused** (no `integration_id` in Canvas, no CSV entry). Add `conflict_student` to the CSV roster by username → enroll **succeeds** — the escape hatch works.
7. Re-sync as `faculty` → **1 matched (`cpsc_student`) / 1 on Canvas only / 1 in FinanceBot only (`conflict_student`, "not on the Canvas roster")**. This is the uneven report the seed was built to produce.
8. Unlink → the roster count drops to `N from CSV · 0 from Canvas`; `cpsc_student` remains enrolled (courseRoles are never removed by unlink).

Record each step's actual result in `STATUS.md`.

- [x] **Step 9: Commit**

```bash
git add client/src/api.ts client/src/views/instructor/canvas-panel.ts client/src/views/instructor/settings.ts client/src/views/instructor/materials.ts client/public/styles/main.css tests/unit/canvas-panel.test.ts docs/superpowers/plans/phase-6/Saurav/STATUS.md
git commit -m "feat(instructor): Canvas card in Settings and Import-from-Canvas in Materials"
```
