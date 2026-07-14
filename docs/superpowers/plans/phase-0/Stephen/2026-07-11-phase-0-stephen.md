# Phase 0 — Foundations — Stephen (Dev A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Stephen's** personal plan: the Dev A (platform/auth arc) slice of the
core phase document
[`../2026-07-11-phase-0-foundations.md`](../2026-07-11-phase-0-foundations.md).
Task numbers match the core document. Tasks 4, 5, 9, 10, 11 belong to
**Saurav (Dev B)** and are not in this plan — never start or edit them; see
"Coordination with Saurav" below for where they block or need Stephen's review.

**Goal:** Stephen's half of the walking skeleton: pinned dependencies, the
Shared backing services (MongoDB, Qdrant, SAML IdP), typed + validated config,
API hardening (helmet, rate limiting, zod request validation), PUID-keyed
identity on CWL login, the role-appropriate home stub, lint + CI, and the joint
walking-skeleton exit test.

**Architecture:** Extend the existing TLEF boilerplate (Express + plain-TS
client + components pattern). All new server code follows routes → services →
components. Auth is upgraded from "whole SAML profile in session" to
"PUID-keyed User document in MongoDB, PUID in session."

**Tech Stack:** Node 18+, TypeScript strict, Express 5, MongoDB native driver,
Qdrant, passport-ubcshib + connect-mongo, ubc-genai-toolkit-* (pinned exact),
Jest + ts-jest + supertest, Playwright, helmet, express-rate-limit, zod.

## Global Constraints

- TypeScript `strict` mode everywhere; shared options in `tsconfig.base.json`; server compiles to CommonJS, client is native ES modules (imports use explicit `.js` extension).
- Node.js 18+ single runtime.
- Read environment variables **only** in `server/src/config/env.ts`; every new variable is also added to `.env.example` with a comment.
- Each external integration lives in `server/src/components/<name>/` with `index.ts` + `AGENTS.md`; routes delegate to services; services compose components.
- `ubc-genai-toolkit-*` packages are pre-1.0: **pin exact versions** (no `^`).
- No email channel anywhere. No local password auth — CWL only.
- Client has no bundler: third-party browser libs are vendored into `client/public/vendor/` and loaded via `<script>`/`<link>` tags.
- Follow the per-folder `AGENTS.md` closest to any file you edit.
- Requirement IDs referenced: ST-E01 (CWL login), plus groundwork for everything in Phase 1.
- Shared-file convention (root `AGENTS.md`): `package.json`, `server/src/app.ts`, `server/src/server.ts`, `.env.example` are **append-only, one line/block per addition** — never reorder or reformat surrounding lines.

## Task order and coordination with Saurav (Dev B)

**Stephen's ordering:** Task 1 → merge to `main` **before anyone branches** →
Task 2 and Task 3 (parallel-safe) → Task 6 → Task 7 (also needs Saurav's
Task 5 merged) → Task 8 → Task 12 → Task 13 (joint).

**Cross-developer dependencies:**

| Dependency | Direction | Effect |
|---|---|---|
| Task 1 (pin deps) | Stephen → everyone | Nothing branches until Task 1 is on `main`. |
| Task 2 (shared services) | Stephen → Saurav's Task 11 | Saurav's ingestion spike needs the shared Qdrant up. Do Task 2 early. |
| Saurav's Task 5 (collections) | Saurav → Stephen's Task 7 | `usersCol()` must exist before the users service. If blocked, do Tasks 6/12 first. |
| Task 3 (config) | Stephen → Stephen's Task 7 | `env.adminCwlAllowlist` feeds `isAdmin`. |

**Sync points (pause and involve Saurav before merging/proceeding):**
1. **Saurav's Task 4 (domain types)** — Stephen reviews the PR; this is the shared vocabulary.
2. **Saurav's Task 10 (API contract)** — explicitly a two-developer PR review; Stephen must approve.
3. **Task 13 (walking skeleton)** — joint exit test, run on both machines from a fresh clone.

**Workflow:** run `npm run sync-plans -- Stephen` before and after each work
session; check `git log --oneline -20` and the core plan's checkboxes to see
what Saurav has landed.

## Non-dev checklist (do not skip; no code)

- [ ] **PIA/DAR kickoff (week 1):** initiate the CWL Privacy Impact Assessment / Data Access Request with UBC IAM (PRD §4.1, §11). On the critical path to launch; runs on IAM's timeline.
- [ ] **PSD reconciliation ping:** ask Saurav/Stephen to reconcile the PSD "RAG generation fallback" language with the PRD's Approved-only serving (§9.1). Needs an answer before Phase 1 ends; default to Approved-only.

---
### Task 1: Pin toolkit versions and install Phase-0 dependencies

**Owner:** Dev A — do this task first and merge to main before either developer branches for other tasks.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (via npm)

**Interfaces:**
- Consumes: nothing.
- Produces: exact-pinned `ubc-genai-toolkit-*` versions; `helmet`, `express-rate-limit`, `zod` available to the server; `katex`, `marked`, `dompurify` available for client vendoring; `eslint` + `typescript-eslint` for CI.

- [ ] **Step 1: Discover the exact installed toolkit versions**

Run:
```bash
npm ls ubc-genai-toolkit-core ubc-genai-toolkit-llm ubc-genai-toolkit-embeddings ubc-genai-toolkit-chunking ubc-genai-toolkit-document-parsing
```
Expected: a tree printing one exact version per package (e.g. `ubc-genai-toolkit-core@0.1.0`). Note each version.

- [ ] **Step 2: Pin the five toolkit packages exactly**

In `package.json` `dependencies`, remove the `^` prefix from all five `ubc-genai-toolkit-*` entries, using the exact versions from Step 1. Example (substitute the real observed versions):

```json
"ubc-genai-toolkit-chunking": "0.1.0",
"ubc-genai-toolkit-core": "0.1.0",
"ubc-genai-toolkit-document-parsing": "0.2.0",
"ubc-genai-toolkit-embeddings": "0.1.1",
"ubc-genai-toolkit-llm": "0.3.0"
```

- [ ] **Step 3: Install new dependencies**

Run:
```bash
npm install helmet express-rate-limit zod katex marked dompurify
npm install -D eslint @eslint/js typescript-eslint @types/dompurify
npm install
```
Expected: exit 0, lockfile updated.

- [ ] **Step 4: Verify nothing broke**

Run: `npm run typecheck && npm test`
Expected: PASS (same results as before this task).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: pin ubc-genai-toolkit versions exactly; add helmet, rate-limit, zod, client render libs, eslint"
```

---

### Task 2: Start the shared backing services (MongoDB, Qdrant, SAML IdP)

**Owner:** Dev A

The backing services are **not** run from this repo. Each lives in its own shared
repo under `../services/` so every TLEF project talks to the exact same
containers (see the root README "Local development services"). This task is
wiring the app to those shared services and documenting the startup, not writing
a per-project `docker-compose.yml`.

**Files:**
- Modify: `README.md` (local setup section)

**Interfaces:**
- Consumes: the env defaults in `server/src/config/env.ts` (Mongo on `mongodb://mongoadmin:secret@localhost:27017/?authSource=admin`, Qdrant on `http://localhost:6333`, IdP on `http://localhost:6122/simplesaml/...`).
- Produces: the three shared containers running on the exact hosts/ports the existing config defaults expect.

- [ ] **Step 1: Clone (once) and start the shared services**

Each service is its own repo next to this one. Clone the three if you don't have
them, then start each with its own compose file:

```bash
# MongoDB — root user mongoadmin/secret; copy the env once before first start
cd ../services/tlef-mongodb-docker && cp .env.example .env && docker compose up -d

# SAML IdP — mock UBC CWL Shibboleth (SimpleSAMLphp on :6122)
cd ../services/docker-simple-saml && docker compose up -d

# Qdrant — vector DB on :6333 (API key super-secret-dev-key)
cd ../services/tlef-qdrant && docker compose up -d
```

Start them once and leave them up; because every project shares these
containers, there is no per-project compose to conflict on host ports.

- [ ] **Step 2: Confirm this app's SP is registered in the shared IdP**

The shared `docker-simple-saml` already registers this app as a Service Provider
(`http://localhost:6118` → ACS `/auth/ubcshib/callback`) in
`config/simplesamlphp/saml20-sp-remote.php`, and ships role-differentiated test
users in `config/simplesamlphp/authsources.php`. The **password equals the
username**; the ones this app uses are `faculty` (eduPersonAffiliation=faculty),
`student`, and `staff`. No per-project IdP config is needed — if a new SP port is
ever required, add it to that shared repo, not here.

- [ ] **Step 3: Fetch the IdP certificate**

Run:
```bash
sleep 5
curl -sf http://localhost:6333/readyz && echo QDRANT_OK
curl -sf http://localhost:6122/simplesaml/saml2/idp/metadata.php | head -c 200 && echo IDP_OK
npm run saml:fetch-cert
```
Expected: `QDRANT_OK`, XML metadata output then `IDP_OK`, and the cert script writes `server/certs/idp.pem` from the shared IdP's metadata.

- [ ] **Step 4: Verify login works end-to-end against the shared IdP**

Run: `npm run dev` then open `http://localhost:6118`, click "Log in with CWL", sign in as `faculty` / `faculty`.
Expected: redirected back to the app, logged in; `GET /api/auth/me` returns the profile with the CWL PUID (`ubcEduCwlPuid` `12345678` for `faculty`).

- [ ] **Step 5: Update `README.md`**

Point the local-setup section at the shared services (not a per-project compose):

```markdown
## Local development services

The backing services run from their own shared repos under ../services/:

    cd ../services/tlef-mongodb-docker && cp .env.example .env && docker compose up -d
    cd ../services/docker-simple-saml && docker compose up -d
    cd ../services/tlef-qdrant && docker compose up -d
    cd ../tlef-financebot && npm run saml:fetch-cert   # writes server/certs/idp.pem

Test users live in the shared IdP; password = username (e.g. faculty, student, staff).
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: wire local dev to the shared backing services (Mongo, Qdrant, SAML IdP)"
```

> **Note (history):** Phase 0 originally shipped a per-project `docker-compose.yml`
> + `docker/saml/authsources.php` with `student1`/`instructor1`/`ta1`/`admin1`
> users, plus an `npm run services:up` wrapper. That was later removed in favour
> of the shared `../services/` repos above; the test users are now the shared
> IdP's `faculty`/`student`/`staff` (password = username). This task has been
> rewritten to the current approach.

---

### Task 3: Expand the typed config module (per-step models, admin allowlist, worker limits) with validation

**Owner:** Dev A

**Files:**
- Modify: `server/src/config/env.ts`
- Modify: `.env.example`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Consumes: existing `optional()` helper and `env` object shape in `server/src/config/env.ts`.
- Produces: `env.llmModelGenerator`, `env.llmModelValidator`, `env.llmModelReviewer`, `env.llmModelMasteryEvaluator` (all `string`), `env.adminCwlAllowlist` (`string[]` of PUIDs), `env.paramWorkerTimeoutMs` (`number`), `env.paramWorkerMemoryMb` (`number`), and `assertConfig(): void` which throws in production when insecure defaults leak through. Later phases call `env.llmModel*` for AD-07 per-step model selection and `env.adminCwlAllowlist` for admin gating.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/config.test.ts`:

```ts
// Config loading is module-level, so each case re-imports env.ts with a fresh
// module registry and a controlled process.env.
const ORIGINAL_ENV = process.env;

function loadEnv(overrides: Record<string, string>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...overrides };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../server/src/config/env') as typeof import('../../server/src/config/env');
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('config: per-step model selection (AD-07 groundwork)', () => {
  it('falls back to LLM_DEFAULT_MODEL when a step model is unset', () => {
    const { env } = loadEnv({ LLM_DEFAULT_MODEL: 'base-model', LLM_MODEL_GENERATOR: '' });
    expect(env.llmModelGenerator).toBe('base-model');
    expect(env.llmModelMasteryEvaluator).toBe('base-model');
  });

  it('uses the step-specific model when set', () => {
    const { env } = loadEnv({
      LLM_DEFAULT_MODEL: 'base-model',
      LLM_MODEL_REVIEWER: 'big-model',
      LLM_MODEL_MASTERY_EVALUATOR: 'cheap-model',
    });
    expect(env.llmModelReviewer).toBe('big-model');
    expect(env.llmModelMasteryEvaluator).toBe('cheap-model');
    expect(env.llmModelGenerator).toBe('base-model');
  });
});

describe('config: admin allowlist and worker limits', () => {
  it('parses ADMIN_CWL_ALLOWLIST as a trimmed, non-empty list', () => {
    const { env } = loadEnv({ ADMIN_CWL_ALLOWLIST: ' PUID-A , PUID-B ,, ' });
    expect(env.adminCwlAllowlist).toEqual(['PUID-A', 'PUID-B']);
  });

  it('defaults worker limits and parses overrides as numbers', () => {
    expect(loadEnv({}).env.paramWorkerTimeoutMs).toBe(2000);
    expect(loadEnv({ PARAM_WORKER_TIMEOUT_MS: '500', PARAM_WORKER_MEMORY_MB: '32' }).env.paramWorkerTimeoutMs).toBe(500);
    expect(loadEnv({ PARAM_WORKER_MEMORY_MB: '32' }).env.paramWorkerMemoryMb).toBe(32);
  });
});

describe('assertConfig (production safety)', () => {
  it('throws in production when SESSION_SECRET is the dev default', () => {
    const { assertConfig } = loadEnv({ NODE_ENV: 'production' });
    expect(() => assertConfig()).toThrow(/SESSION_SECRET/);
  });

  it('passes in production with a real secret', () => {
    const { assertConfig } = loadEnv({ NODE_ENV: 'production', SESSION_SECRET: 'a-real-secret' });
    expect(() => assertConfig()).not.toThrow();
  });

  it('never throws in development', () => {
    const { assertConfig } = loadEnv({ NODE_ENV: 'development' });
    expect(() => assertConfig()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/config.test.ts`
Expected: FAIL — `llmModelGenerator`/`assertConfig` do not exist.

- [ ] **Step 3: Implement in `server/src/config/env.ts`**

Add above the `env` export (keeping the existing entries untouched):

```ts
const llmDefaultModel = optional('LLM_DEFAULT_MODEL', 'ministral-3:latest');

/** A per-pipeline-step model override that falls back to LLM_DEFAULT_MODEL. */
function stepModel(key: string): string {
  return optional(key, llmDefaultModel);
}

function csvList(key: string): string[] {
  return optional(key, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
```

Inside the `env` object, change `llmDefaultModel: optional('LLM_DEFAULT_MODEL', 'ministral-3:latest')` to `llmDefaultModel`, and add:

```ts
  // Per-pipeline-step model selection (PRD §2 / AD-07): generator, structure
  // validator, reviewer, and mastery evaluator are independently assignable.
  // Each falls back to LLM_DEFAULT_MODEL when unset.
  llmModelGenerator: stepModel('LLM_MODEL_GENERATOR'),
  llmModelValidator: stepModel('LLM_MODEL_VALIDATOR'),
  llmModelReviewer: stepModel('LLM_MODEL_REVIEWER'),
  llmModelMasteryEvaluator: stepModel('LLM_MODEL_MASTERY_EVALUATOR'),

  // CWL PUIDs granted the platform Admin role (PRD §3, §8). Comma-separated.
  adminCwlAllowlist: csvList('ADMIN_CWL_ALLOWLIST'),

  // Resource limits for parameterized-question worker_threads (PRD §2).
  paramWorkerTimeoutMs: Number(optional('PARAM_WORKER_TIMEOUT_MS', '2000')),
  paramWorkerMemoryMb: Number(optional('PARAM_WORKER_MEMORY_MB', '64')),
```

Add at the bottom of the file:

```ts
/**
 * Fail fast on insecure/incomplete production configuration. Called from
 * server.ts before listening. Development is never blocked.
 */
export function assertConfig(): void {
  if (!isProduction) return;
  const problems: string[] = [];
  if (env.sessionSecret === 'dev-insecure-secret-change-me') {
    problems.push('SESSION_SECRET must be set to a real secret in production.');
  }
  if (Number.isNaN(env.paramWorkerTimeoutMs) || Number.isNaN(env.paramWorkerMemoryMb)) {
    problems.push('PARAM_WORKER_TIMEOUT_MS / PARAM_WORKER_MEMORY_MB must be numbers.');
  }
  if (problems.length > 0) {
    throw new Error(`Invalid production configuration:\n- ${problems.join('\n- ')}`);
  }
}
```

In `server/src/server.ts`, call `assertConfig()` before the app starts listening (import it from `./config/env`).

- [ ] **Step 4: Document every new variable in `.env.example`**

```bash
# Per-pipeline-step model overrides (fall back to LLM_DEFAULT_MODEL).
LLM_MODEL_GENERATOR=
LLM_MODEL_VALIDATOR=
LLM_MODEL_REVIEWER=
LLM_MODEL_MASTERY_EVALUATOR=

# Comma-separated CWL PUIDs with platform Admin access.
ADMIN_CWL_ALLOWLIST=PUID-ADMIN-0001

# Parameterized-question worker sandbox limits.
PARAM_WORKER_TIMEOUT_MS=2000
PARAM_WORKER_MEMORY_MB=64
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/config.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/config/env.ts server/src/server.ts .env.example tests/unit/config.test.ts
git commit -m "feat: per-step LLM model config, admin allowlist, worker limits, production config assertion"
```

---

### Task 6: API hardening — helmet, rate limiting, request validation middleware

**Owner:** Dev A

**Files:**
- Create: `server/src/middleware/validate.ts`
- Modify: `server/src/app.ts`
- Test: `tests/unit/validate.middleware.test.ts`

**Interfaces:**
- Consumes: `zod` (Task 1).
- Produces: `validate({ body?, query?, params? })` Express middleware factory — each property a `ZodSchema`; on failure responds `400 { error: string, issues: Array<{ path: string, message: string }> }`; on success replaces `req.body`/`req.query`/`req.params` with the parsed (typed, stripped) values. All Phase 1+ routes use this for request validation.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/validate.middleware.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../../server/src/middleware/validate';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.post(
    '/echo/:id',
    validate({
      params: z.object({ id: z.string().regex(/^[0-9a-f]{24}$/) }),
      body: z.object({ name: z.string().min(1), count: z.coerce.number().int().optional() }),
    }),
    (req, res) => res.json({ params: req.params, body: req.body }),
  );
  return app;
}

describe('validate() middleware', () => {
  const goodId = 'a'.repeat(24);

  it('passes valid requests through with parsed values', async () => {
    const res = await request(makeApp()).post(`/echo/${goodId}`).send({ name: 'x', count: '3', extra: 'stripped' });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: 'x', count: 3 }); // coerced + unknown keys stripped
  });

  it('responds 400 with issue paths on invalid body', async () => {
    const res = await request(makeApp()).post(`/echo/${goodId}`).send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request.');
    expect(res.body.issues[0].path).toBe('body.name');
  });

  it('responds 400 on invalid params', async () => {
    const res = await request(makeApp()).post('/echo/not-an-id').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.issues[0].path).toBe('params.id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/validate.middleware.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/src/middleware/validate.ts`**

```ts
import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface ValidateSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Request-validation middleware (PRD §2 API hardening). Parses each provided
 * section with zod; 400s with per-issue paths on failure, and replaces the
 * request section with the parsed value (typed, unknown keys stripped) on
 * success.
 */
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req, res, next) => {
    const issues: Array<{ path: string; message: string }> = [];
    for (const section of ['params', 'query', 'body'] as const) {
      const schema = schemas[section];
      if (!schema) continue;
      const result = schema.safeParse(req[section]);
      if (result.success) {
        // Express 5 exposes query/params via getters; define the parsed value.
        Object.defineProperty(req, section, { value: result.data, writable: true });
      } else {
        for (const issue of result.error.issues) {
          issues.push({ path: [section, ...issue.path].join('.'), message: issue.message });
        }
      }
    }
    if (issues.length > 0) {
      res.status(400).json({ error: 'Invalid request.', issues });
      return;
    }
    next();
  };
}
```

Note: zod object schemas strip unknown keys by default — no extra call needed.

- [ ] **Step 4: Add helmet and rate limiting to `server/src/app.ts`**

At the top of `createApp()`, before `app.use(cors())`:

```ts
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { isProduction } from './config/env';
// ...inside createApp():
  app.use(
    helmet({
      // The client is plain static files served same-origin; keep CSP simple.
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );
  // Generous global API limit — protects against runaways, not normal use
  // (concurrency target is 250 active sessions, PRD §2).
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }),
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/validate.middleware.test.ts && npm run typecheck && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/middleware/validate.ts server/src/app.ts tests/unit/validate.middleware.test.ts
git commit -m "feat: zod request validation middleware; helmet + API rate limiting"
```

---

### Task 7: PUID-keyed identity — users service wired into the SAML login (ST-E01)

**Owner:** Dev A (requires Tasks 3 and 5 merged)

**Files:**
- Create: `server/src/services/users.service.ts`
- Modify: `server/src/components/auth/strategies/shibboleth.ts` (verify callback)
- Modify: `server/src/components/auth/index.ts` (serialize PUID only)
- Test: `tests/unit/users.service.test.ts`

**Interfaces:**
- Consumes: `usersCol()` (Task 5), `env.adminCwlAllowlist` (Task 3), `AppUser` from the shibboleth strategy.
- Produces: `upsertUserFromSaml(attributes: Record<string, unknown>): Promise<User>` — first login creates the user (PUID → identity, no profile-creation step); later logins update `lastLoginAt`/attributes and preserve `courseRoles`. `findUserByPuid(puid: string): Promise<User | null>`. Session stores `{ puid }` only; `deserializeUser` reloads the DB user, so `req.user` in all later phases is the **domain `User`** (with `puid`, `isAdmin`, `courseRoles`), not the raw SAML profile.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/users.service.test.ts`:

```ts
import { upsertUserFromSaml } from '../../server/src/services/users.service';
import { usersCol } from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  usersCol: jest.fn(),
}));
jest.mock('../../server/src/config/env', () => ({
  env: { adminCwlAllowlist: ['PUID-ADMIN-0001'] },
  isProduction: false,
}));

const findOneAndUpdate = jest.fn();
beforeEach(() => {
  findOneAndUpdate.mockReset();
  jest.mocked(usersCol).mockReturnValue({ findOneAndUpdate } as never);
});

const samlAttrs = (over: Record<string, unknown> = {}) => ({
  ubcEduCwlPuid: '87654321',
  uid: 'student-user',
  mail: 'student@ubc.ca',
  givenName: 'Jane',
  sn: 'Student',
  eduPersonAffiliation: ['student'],
  ...over,
});

describe('upsertUserFromSaml (ST-E01: PUID -> identity mapping)', () => {
  it('upserts keyed on PUID, setting identity fields and setOnInsert defaults', async () => {
    findOneAndUpdate.mockResolvedValue({ puid: '87654321' });
    await upsertUserFromSaml(samlAttrs());
    const [filter, update, options] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ puid: '87654321' });
    expect(update.$set).toMatchObject({
      uid: 'student-user',
      email: 'student@ubc.ca',
      displayName: 'Jane Student',
      affiliations: ['student'],
      isAdmin: false,
    });
    expect(update.$set.lastLoginAt).toBeInstanceOf(Date);
    expect(update.$setOnInsert).toMatchObject({ courseRoles: [] });
    expect(options).toMatchObject({ upsert: true, returnDocument: 'after' });
  });

  it('grants isAdmin from the allowlist', async () => {
    findOneAndUpdate.mockResolvedValue({});
    await upsertUserFromSaml(samlAttrs({ ubcEduCwlPuid: 'PUID-ADMIN-0001' }));
    expect(findOneAndUpdate.mock.calls[0][1].$set.isAdmin).toBe(true);
  });

  it('rejects a profile with no PUID (no partial session, ST-E01)', async () => {
    await expect(upsertUserFromSaml(samlAttrs({ ubcEduCwlPuid: undefined }))).rejects.toThrow(/PUID/);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/users.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/src/services/users.service.ts`**

```ts
import { usersCol } from '../components/mongodb/collections';
import { env } from '../config/env';
import type { User } from '../types/domain';

/** First value of a possibly multi-valued SAML attribute, as a string. */
function attr(attributes: Record<string, unknown>, key: string): string {
  const raw = attributes[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value == null ? '' : String(value);
}

function attrList(attributes: Record<string, unknown>, key: string): string[] {
  const raw = attributes[key];
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return values.map((v) => String(v).toLowerCase());
}

/**
 * ST-E01: map the CWL PUID to a FinanceBot identity with no profile-creation
 * step. First login inserts; later logins refresh identity attributes and
 * lastLoginAt while preserving courseRoles and consent fields.
 */
export async function upsertUserFromSaml(attributes: Record<string, unknown>): Promise<User> {
  const puid = attr(attributes, 'ubcEduCwlPuid');
  if (!puid) {
    throw new Error('SAML profile is missing ubcEduCwlPuid (PUID); refusing to create a session.');
  }
  const givenName = attr(attributes, 'givenName');
  const sn = attr(attributes, 'sn');
  const result = await usersCol().findOneAndUpdate(
    { puid },
    {
      $set: {
        uid: attr(attributes, 'uid'),
        email: attr(attributes, 'mail'),
        displayName: [givenName, sn].filter(Boolean).join(' ') || attr(attributes, 'uid'),
        affiliations: attrList(attributes, 'eduPersonAffiliation'),
        isAdmin: env.adminCwlAllowlist.includes(puid),
        lastLoginAt: new Date(),
      },
      $setOnInsert: { courseRoles: [], createdAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return result as unknown as User;
}

export async function findUserByPuid(puid: string): Promise<User | null> {
  return usersCol().findOne({ puid });
}
```

- [ ] **Step 4: Wire into the strategy and session**

In `server/src/components/auth/strategies/shibboleth.ts`, replace the verify callback:

```ts
import { upsertUserFromSaml } from '../../../services/users.service';
// ...
    (profile, done) => {
      // ST-E01: PUID -> FinanceBot identity on every login; no profile step.
      upsertUserFromSaml(profile.attributes ?? {})
        .then((user) => done(null, { nameId: profile.nameID, puid: user.puid, attributes: profile.attributes ?? {} }))
        .catch((err) => done(err as Error));
    },
```

Extend `AppUser` in the same file:

```ts
export interface AppUser {
  nameId: string;
  puid: string;
  attributes: Record<string, unknown>;
}
```

In `server/src/components/auth/index.ts`, replace the serialize/deserialize pair so the session holds only the PUID and `req.user` is the domain `User`:

```ts
import { findUserByPuid } from '../../services/users.service';
// ...
    passport.serializeUser((user, done) => done(null, (user as { puid: string }).puid));
    passport.deserializeUser((puid: string, done) => {
      findUserByPuid(puid)
        .then((user) => done(null, user ?? false))
        .catch((err) => done(err as Error));
    });
```

Update `server/src/types/express.d.ts` so `req.user` is typed as the domain `User`:

```ts
import type { User as DomainUser } from './domain';

declare global {
  namespace Express {
    interface User extends DomainUser {}
  }
}
export {};
```

Fix any resulting type errors in `roles.ts`/views: `rolesOf` should now read `user?.affiliations ?? []` directly instead of parsing SAML attributes. Update `server/src/components/auth/roles.ts`:

```ts
export function rolesOf(user: { affiliations?: string[] } | undefined): string[] {
  return user?.affiliations ?? [];
}
```

(`hasRole` and `ensureRole` keep their signatures and behaviour.)

- [ ] **Step 5: Run all tests**

Run: `npm test && npm run typecheck`
Expected: PASS (existing roles tests may need their fixture users updated from `{ attributes: { eduPersonAffiliation: [...] } }` to `{ affiliations: [...] }` — update those fixtures, not the behaviour).

- [ ] **Step 6: Manual verify (session restore, ST-E01)**

With the shared services + `npm run dev`: log in as `student`, confirm `/api/auth/me` shows the user; check the `users` collection has one document keyed by PUID `87654321`; reload the page — still signed in; log in again — still exactly one user document.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/users.service.ts server/src/components/auth tests/unit/users.service.test.ts server/src/types/express.d.ts tests/unit/roles.test.ts
git commit -m "feat: PUID-keyed user identity upserted on CWL login; session stores PUID only (ST-E01)"
```

---

### Task 8: Role-appropriate home routing stub (client)

**Owner:** Dev A

**Files:**
- Modify: `server/src/routes/auth.routes.ts` (extend `/api/auth/me` payload)
- Modify: `client/src/views/home.ts`
- Test: `tests/unit/auth.me.route.test.ts`

**Interfaces:**
- Consumes: `req.user` as domain `User` (Task 7).
- Produces: `GET /api/auth/me` → `{ authenticated: boolean, user?: { puid, uid, displayName, isAdmin, affiliations, courseRoles } }`. Client `primaryRole(user): 'admin' | 'instructor' | 'student'` — admin if `isAdmin`; instructor if `affiliations` includes `'faculty'`; else student. Phase 1 replaces the stub bodies with real views; the routing split stays.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auth.me.route.test.ts`:

```ts
import express, { type Express } from 'express';
import request from 'supertest';
import { authRouter } from '../../server/src/routes/auth.routes';

function makeApp(user?: object): Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as { isAuthenticated?: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use(authRouter);
  return app;
}

describe('GET /api/auth/me', () => {
  it('returns authenticated: false when signed out', async () => {
    const res = await request(makeApp()).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it('returns the identity summary when signed in', async () => {
    const res = await request(
      makeApp({ puid: 'P1', uid: 'u1', displayName: 'U One', isAdmin: false, affiliations: ['faculty'], courseRoles: [], email: 'x@y' }),
    ).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toEqual({
      puid: 'P1', uid: 'u1', displayName: 'U One', isAdmin: false, affiliations: ['faculty'], courseRoles: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/auth.me.route.test.ts`
Expected: FAIL (current `/api/auth/me` returns the raw SAML shape, not this contract).

- [ ] **Step 3: Update the `/api/auth/me` handler in `server/src/routes/auth.routes.ts`**

Replace the existing handler body with:

```ts
authRouter.get('/api/auth/me', (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    res.json({ authenticated: false });
    return;
  }
  const { puid, uid, displayName, isAdmin, affiliations, courseRoles } = req.user;
  res.json({ authenticated: true, user: { puid, uid, displayName, isAdmin, affiliations, courseRoles } });
});
```

(Keep the login/callback/logout routes as they are.)

- [ ] **Step 4: Update `client/src/views/home.ts` to branch on role**

Add to the top of the view module and use it when rendering:

```ts
export interface MeUser {
  puid: string;
  uid: string;
  displayName: string;
  isAdmin: boolean;
  affiliations: string[];
  courseRoles: Array<{ courseId: string; role: string }>;
}

export function primaryRole(user: MeUser): 'admin' | 'instructor' | 'student' {
  if (user.isAdmin) return 'admin';
  if (user.affiliations.includes('faculty')) return 'instructor';
  return 'student';
}
```

In the render function, after fetching `/api/auth/me` (via the existing `client/src/api.ts` helper), render a role-appropriate stub section:

```ts
const role = primaryRole(user);
const headings: Record<typeof role, string> = {
  admin: 'Admin console',
  instructor: 'Instructor dashboard',
  student: 'My courses',
};
outlet.append(el('h2', {}, headings[role]));
outlet.append(el('p', { class: 'muted' }, `Signed in as ${user.displayName} (${role}). Phase 1 builds this view out.`));
```

(Use the existing element-creation helper in `client/src/dom.ts`; if its name differs from `el`, use the actual exported name.)

- [ ] **Step 5: Run tests and verify visually**

Run: `npx jest tests/unit/auth.me.route.test.ts && npm run typecheck`
Expected: PASS. Then with the shared services running, log in as `student` and `faculty` and confirm the differing headings.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/auth.routes.ts client/src/views/home.ts tests/unit/auth.me.route.test.ts
git commit -m "feat: /api/auth/me identity contract and role-appropriate home stub"
```

---

### Task 12: Lint + CI pipeline

**Owner:** Dev A

**Files:**
- Create: `eslint.config.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (`lint` script)

**Interfaces:**
- Consumes: eslint + typescript-eslint (Task 1); all npm scripts.
- Produces: `npm run lint`; CI running lint, typecheck, and Jest on every PR/push. (Playwright/e2e in CI is a Phase 4 stretch — unit CI now.)

- [ ] **Step 1: Write `eslint.config.mjs`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'client/public/js/**', 'client/public/vendor/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
```

Add to `package.json`: `"lint": "eslint ."`.

- [ ] **Step 2: Run lint and fix trivial violations**

Run: `npm run lint`
Expected: exits 0 after fixing any flagged issues in existing files (unused vars, missing type-only imports). Behaviour-preserving fixes only.

- [ ] **Step 3: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main, setup]
  pull_request:

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 4: Verify locally, then on GitHub**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all PASS locally. After push, the Actions run is green.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs .github/workflows/ci.yml package.json
git commit -m "ci: eslint config and GitHub Actions running lint, typecheck, jest"
```

---

### Task 13: Walking skeleton E2E (joint exit test)

**Owner:** Joint — **Sync point:** both developers run the fresh-clone verification on their own machines.

**Files:**
- Create: `tests/e2e/walking-skeleton.spec.ts`
- Modify (if needed): `tests/e2e/global-setup.ts` (test-user credentials)

**Interfaces:**
- Consumes: the shared services (Task 2), role home stub (Task 8), existing Playwright global-setup SAML login flow.
- Produces: the Phase-0 exit test — log in via mock CWL → session persists → role-appropriate course home renders.

- [ ] **Step 1: Write the spec**

`tests/e2e/walking-skeleton.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Phase 0 exit test (phase-0-foundations.md, Joint): login via mock CWL ->
// session persists -> role-appropriate home renders. Relies on the SAML
// session established by tests/e2e/global-setup.ts (faculty by default).

test('logged-in student sees the student home and survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'My courses' })).toBeVisible();

  // Session persistence: a full reload must not bounce to the landing screen.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My courses' })).toBeVisible();
  await expect(page.getByText('Log in with CWL')).toHaveCount(0);
});

test('identity endpoint reflects the session', async ({ page }) => {
  const res = await page.request.get('/api/auth/me');
  const body = await res.json();
  expect(body.authenticated).toBe(true);
  expect(body.user.puid).toMatch(/^PUID-/);
});
```

`global-setup.ts` logs in against the shared docker-simple-saml IdP as `faculty` / `faculty` (password = username); override with `E2E_USERNAME` / `E2E_PASSWORD` if a different role is needed.

- [ ] **Step 2: Run it fresh-clone style (both developers)**

Run:
```bash
(cd ../services/tlef-mongodb-docker && docker compose up -d) && (cd ../services/docker-simple-saml && docker compose up -d) && (cd ../services/tlef-qdrant && docker compose up -d) && npm ci && npm run saml:fetch-cert && npm run build
npm run test:e2e -- tests/e2e/walking-skeleton.spec.ts
```
Expected: PASS on both developers' machines. This is the phase exit gate.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/walking-skeleton.spec.ts tests/e2e/global-setup.ts
git commit -m "test: walking-skeleton e2e (mock CWL login, session persistence, role home)"
```

---

## Exit criteria checklist (Stephen's share of the phase exit)

- [ ] Walking skeleton works on both devs' machines from a fresh clone (Task 13 Step 2).
- [ ] CI green: lint, typecheck strict, tests (Task 12).
- [ ] API contract reviewed by Stephen and merged (Saurav's Task 10 — review duty).
- [ ] Toolkit versions pinned exactly (Task 1); shared services up for Saurav's spike (Task 2).
- [ ] Unit/integration tests exist for auth flow and config validation (Tasks 3, 7, 8, 13).
- [ ] PIA/DAR kickoff initiated; PSD reconciliation pinged (non-dev checklist).
