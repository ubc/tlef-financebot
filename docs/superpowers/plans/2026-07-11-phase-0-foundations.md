# Phase 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A walking skeleton both developers can build on — Docker dev services, hardened Express skeleton, typed config, shared domain types, MongoDB collections + indexes, PUID-keyed identity on CWL login, client render utilities, the Phase-1 API contract, a toolkit ingestion spike, and CI.

**Architecture:** Extend the existing TLEF boilerplate (Express + plain-TS client + components pattern). All new server code follows routes → services → components. Domain types live in `server/src/types/domain.ts`; collection access is centralized in `server/src/components/mongodb/collections.ts`. Auth is upgraded from "whole SAML profile in session" to "PUID-keyed User document in MongoDB, PUID in session."

**Tech Stack:** Node 18+, TypeScript strict, Express 5, MongoDB native driver, Qdrant, passport-ubcshib + connect-mongo, ubc-genai-toolkit-* (pinned exact), Jest + ts-jest + supertest, Playwright, helmet, express-rate-limit, zod, KaTeX + marked + DOMPurify (vendored, no bundler).

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

## Two-developer split & sync points

Agents: before starting any task, ask your human whether you are working as
**Dev A** or **Dev B** (see the root `AGENTS.md` "Two-developer convention"),
and only pick up tasks with a matching `**Owner:**` line.

| Owner | Tasks |
|---|---|
| Dev A (platform/auth arc, ≈WS-1) | 1 (first, merged before anyone branches), 2, 3, 6, 7, 8, 12 |
| Dev B (data/contracts arc, ≈WS-2) | 4, 5, 9, 10, 11 |
| Joint | 13 |

Ordering constraints: Task 1 → everything; Task 4 → Task 5 → Task 7; Task 2 → Task 11; Task 3 → Task 7.

**Sync points (pause and involve the other developer before merging/proceeding):**
1. **Task 4 (domain types)** — both developers review the PR; this is the shared vocabulary.
2. **Task 10 (API contract)** — explicitly a two-developer PR review.
3. **Task 13 (walking skeleton)** — joint exit test, run on both machines from a fresh clone.

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

### Task 2: docker-compose for MongoDB, Qdrant, and the mock SAML IdP

**Owner:** Dev A

**Files:**
- Create: `docker-compose.yml`
- Create: `docker/saml/authsources.php`
- Modify: `README.md` (local setup section)

**Interfaces:**
- Consumes: the env defaults in `server/src/config/env.ts` (Mongo on `mongodb://mongoadmin:secret@localhost:27017/?authSource=admin`, Qdrant on `http://localhost:6333`, IdP on `http://localhost:6122/simplesaml/...`).
- Produces: `docker compose up -d` brings up all three backing services on the exact hosts/ports the existing config defaults expect.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
# Local backing services for tlef-financebot. Mirrors staging/production shape
# (PRD §2 Infrastructure): MongoDB (app data + sessions), Qdrant (vectors),
# and a mock SAML IdP standing in for UBC CWL Shibboleth.
services:
  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_ROOT_USERNAME: mongoadmin
      MONGO_INITDB_ROOT_PASSWORD: secret
    volumes:
      - mongo-data:/data/db

  qdrant:
    image: qdrant/qdrant:v1.12.4
    ports:
      - "6333:6333"
    volumes:
      - qdrant-data:/qdrant/storage

  saml-idp:
    image: kristophjunge/test-saml-idp:1.15
    ports:
      # env.ts defaults expect the IdP at localhost:6122 (SimpleSAMLphp paths).
      - "6122:8080"
    environment:
      SIMPLESAMLPHP_SP_ENTITY_ID: http://localhost:3000
      SIMPLESAMLPHP_SP_ASSERTION_CONSUMER_SERVICE: http://localhost:3000/auth/ubcshib/callback
      SIMPLESAMLPHP_SP_SINGLE_LOGOUT_SERVICE: http://localhost:3000/auth/logout/callback
    volumes:
      # Custom test users carrying the UBC attributes the app reads
      # (ubcEduCwlPuid, eduPersonAffiliation, mail, uid, givenName, sn).
      - ./docker/saml/authsources.php:/var/www/simplesamlphp/config/authsources.php

volumes:
  mongo-data:
  qdrant-data:
```

- [ ] **Step 2: Write `docker/saml/authsources.php` with role-differentiated test users**

```php
<?php
// Test users for local development. Each carries the SAML attributes
// passport-ubcshib is configured to request (see
// server/src/components/auth/strategies/shibboleth.ts):
//   uid, ubcEduCwlPuid, mail, eduPersonAffiliation, givenName, sn,
//   eduPersonPrincipalName.
// eduPersonAffiliation drives the role-appropriate home stub:
//   faculty -> instructor, student -> student, staff -> staff.
$config = [
    'admin' => ['core:AdminPassword'],
    'example-userpass' => [
        'exampleauth:UserPass',
        'student1:student1pass' => [
            'uid' => ['student1'],
            'ubcEduCwlPuid' => ['PUID-STUDENT-0001'],
            'mail' => ['student1@example.ubc.ca'],
            'eduPersonAffiliation' => ['student'],
            'givenName' => ['Sam'],
            'sn' => ['Student'],
            'eduPersonPrincipalName' => ['student1@ubc.ca'],
        ],
        'instructor1:instructor1pass' => [
            'uid' => ['instructor1'],
            'ubcEduCwlPuid' => ['PUID-INSTRUCTOR-0001'],
            'mail' => ['instructor1@example.ubc.ca'],
            'eduPersonAffiliation' => ['faculty'],
            'givenName' => ['Ida'],
            'sn' => ['Instructor'],
            'eduPersonPrincipalName' => ['instructor1@ubc.ca'],
        ],
        'ta1:ta1pass' => [
            'uid' => ['ta1'],
            'ubcEduCwlPuid' => ['PUID-TA-0001'],
            'mail' => ['ta1@example.ubc.ca'],
            'eduPersonAffiliation' => ['student', 'staff'],
            'givenName' => ['Tao'],
            'sn' => ['Assistant'],
            'eduPersonPrincipalName' => ['ta1@ubc.ca'],
        ],
        'admin1:admin1pass' => [
            'uid' => ['admin1'],
            'ubcEduCwlPuid' => ['PUID-ADMIN-0001'],
            'mail' => ['admin1@example.ubc.ca'],
            'eduPersonAffiliation' => ['staff'],
            'givenName' => ['Ada'],
            'sn' => ['Admin'],
            'eduPersonPrincipalName' => ['admin1@ubc.ca'],
        ],
    ],
];
```

- [ ] **Step 3: Bring the stack up and fetch the IdP certificate**

Run:
```bash
docker compose up -d
sleep 5
curl -sf http://localhost:6333/readyz && echo QDRANT_OK
curl -sf http://localhost:6122/simplesaml/saml2/idp/metadata.php | head -c 200 && echo IDP_OK
npm run saml:fetch-cert
```
Expected: `QDRANT_OK`, XML metadata output then `IDP_OK`, and the cert script writes `server/certs/idp.pem`. If `saml:fetch-cert` cannot parse this IdP's metadata, extract the `X509Certificate` element from the metadata XML manually into `server/certs/idp.pem` (PEM header/footer + 64-char lines) and note the manual step in the README.

- [ ] **Step 4: Verify login works end-to-end against the compose IdP**

Run: `npm run dev` then open `http://localhost:3000`, click "Log in with CWL", sign in as `instructor1` / `instructor1pass`.
Expected: redirected back to the app, logged in; `GET /api/auth/me` returns the profile with `ubcEduCwlPuid: PUID-INSTRUCTOR-0001`.

- [ ] **Step 5: Update `README.md`**

Replace the previous manual-IdP setup instructions with:

```markdown
## Local development services

All backing services run from one compose file:

    docker compose up -d        # MongoDB :27017, Qdrant :6333, mock SAML IdP :6122
    npm run saml:fetch-cert     # writes server/certs/idp.pem from IdP metadata

Test users (password = username + "pass"): student1, instructor1, ta1, admin1.
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml docker/saml/authsources.php README.md
git commit -m "feat: docker-compose dev stack (MongoDB, Qdrant, mock SAML IdP with role-differentiated test users)"
```

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

### Task 4: Shared domain types

**Owner:** Dev B — **Sync point:** both developers review this PR before merge.

**Files:**
- Create: `server/src/types/domain.ts`
- Test: `tests/unit/domain-types.test.ts`

**Interfaces:**
- Consumes: `ObjectId` from `mongodb`.
- Produces: every domain type below, imported by all later tasks/phases exactly as named. Notably: `OptionRole`, `QuestionType`, `MasteryStatus`, `PublicationState`, `FlagState`, `PracticeMode`, `FeedbackStrategy`, `Difficulty`, `CourseRole`, and document interfaces `User`, `Course`, `Theme`, `LearningObjective`, `Question`, `QuestionVersion`, `AttemptRecord`, `Material`, `MasteryProfile`, `ReviewBookEntry`, `ExamTemplate`, `ExamAttempt`, `Flag`, `Notification`, `AuditLog`, `RosterEntry`. Also runtime constant `PUBLICATION_TRANSITIONS` and helper `canTransition(from, to)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/domain-types.test.ts`:

```ts
import { canTransition, PUBLICATION_TRANSITIONS } from '../../server/src/types/domain';

describe('publication state machine (PRD §6.2)', () => {
  it('allows the forward pipeline path', () => {
    expect(canTransition('draft', 'pending-review')).toBe(true);
    expect(canTransition('pending-review', 'reviewed')).toBe(true);
    expect(canTransition('reviewed', 'approved')).toBe(true);
    expect(canTransition('pending-review', 'approved')).toBe(true); // instructor approves directly
  });

  it('allows pause and resolution paths', () => {
    expect(canTransition('approved', 'paused')).toBe(true);
    expect(canTransition('paused', 'approved')).toBe(true); // flag resolved "correct"
    expect(canTransition('paused', 'archived')).toBe(true); // flag resolved "archive"
  });

  it('reject returns a reviewed question to draft', () => {
    expect(canTransition('pending-review', 'draft')).toBe(true);
    expect(canTransition('reviewed', 'draft')).toBe(true);
  });

  it('archived is reachable from every state (IN-Q07)', () => {
    for (const from of Object.keys(PUBLICATION_TRANSITIONS)) {
      if (from === 'archived') continue;
      expect(canTransition(from as never, 'archived')).toBe(true);
    }
  });

  it('restore from archived goes to draft only, and forbids nonsense moves', () => {
    expect(canTransition('archived', 'draft')).toBe(true);
    expect(canTransition('archived', 'approved')).toBe(false);
    expect(canTransition('draft', 'approved')).toBe(false); // must be reviewed first
    expect(canTransition('draft', 'paused')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/domain-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/src/types/domain.ts`**

```ts
import type { ObjectId } from 'mongodb';

// -----------------------------------------------------------------------------
// Shared domain types (PRD §2 Data Model). Server-side single source of truth;
// client views consume the JSON shapes these produce over /api.
// -----------------------------------------------------------------------------

/** The four option roles (PRD §9.1). Only two carry behaviour anywhere:
 * common-misconception (Strategy A retry gate) and clearly-wrong (struggle
 * signal). A True/False incorrect option is always common-misconception. */
export type OptionRole = 'correct' | 'common-misconception' | 'partially-correct' | 'clearly-wrong';

export type QuestionType = 'mcq' | 'true-false';

/** Per-LO mastery label shown to students (PRD §9.2). Never a numeric score. */
export type MasteryStatus = 'not-attempted' | 'in-progress' | 'covered' | 'struggling';

/** Publication states (PRD §6.2). Only 'approved' is ever served to students. */
export type PublicationState = 'draft' | 'pending-review' | 'reviewed' | 'approved' | 'paused' | 'archived';

/** Review decisions — the events that move a question between states. */
export type ReviewDecision =
  | 'agent-pass'
  | 'agent-flag'
  | 'agent-reject'
  | 'marked-reviewed'
  | 'instructor-approved'
  | 'instructor-rejected';

/** Overlay labels — metadata; never gate serving on their own (PRD §6.2). */
export type QuestionLabel =
  | 'source-changed'
  | 'student-flagged'
  | 'convertible-to-parameterized'
  | 'auto-converted'
  | 'manually-edited';

/** Flag case states — decoupled from the question's publication state. */
export type FlagState = 'open' | 'escalated' | 'resolved-corrected' | 'resolved-archived' | 'resolved-cleared';

export type PracticeMode = 'topic-practice' | 'review-book' | 'exam-prep';

/** Course-level feedback configuration (IN-S10). */
export type FeedbackStrategy = 'adaptive' | 'strategy-a' | 'strategy-b';

/** The strategy actually applied on a single attempt (pinned on AttemptRecord). */
export type AppliedStrategy = 'a' | 'b';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type CourseRole = 'student' | 'instructor' | 'ta';

// --- Documents ---------------------------------------------------------------

/** Keyed by CWL PUID (unique index). No PII beyond CWL login attributes. */
export interface User {
  puid: string;
  uid: string; // CWL username, used as the watermark (PRD §4.1)
  displayName: string;
  email: string;
  affiliations: string[]; // raw eduPersonAffiliation values, lower-cased
  isAdmin: boolean; // from ADMIN_CWL_ALLOWLIST at login time
  courseRoles: Array<{ courseId: ObjectId; role: CourseRole }>;
  onboardingAcknowledgedAt?: Date; // mandatory service-use + copyright ack (§4.1)
  researchExportConsent?: boolean; // optional, declinable (§4.1)
  createdAt: Date;
  lastLoginAt: Date;
}

export interface Course {
  name: string;
  courseCode: string; // e.g. "COMM 298"
  term: string; // e.g. "2026W1"
  ownerPuid: string;
  registrationCode: string; // unique; regenerable (IN-S03)
  termStart?: Date;
  termEnd?: Date; // reaching it auto-revokes student access (IN-S02)
  published: boolean; // sandbox until published (IN-L06)
  feedbackStrategy: FeedbackStrategy; // default 'adaptive' (IN-S10)
  autoPause: { minAttempts: number; flagPercent: number; flagCount: number }; // §4.3 defaults 5/30/15
  redirectFailureThreshold: number; // ST-P07, default 3
  createdAt: Date;
}

export interface Theme {
  courseId: ObjectId;
  name: string;
  order: number;
  availableFrom?: Date; // progressive release (ST-P01)
  archivedAt?: Date;
}

export interface LearningObjective {
  courseId: ObjectId;
  themeId: ObjectId;
  name: string;
  order: number;
  archivedAt?: Date;
}

export interface QuestionOption {
  key: string; // 'A'..'D' for MCQ; 'T'/'F' for true-false
  text: string;
  role: OptionRole;
  explanation: string; // per-option explanation (PRD §10)
}

/** One variable slot in a parameterized question (IN-Q09). */
export interface ParamSlot {
  name: string; // matches {{name}} placeholders in the stem
  min?: number;
  max?: number;
  step?: number;
  values?: number[]; // allowed value set alternative to min/max/step
}

/** Immutable snapshot: every edit creates a new version (PRD §2). */
export interface QuestionVersion {
  questionId: ObjectId;
  version: number; // 1-based, unique per question
  type: QuestionType;
  stem: string; // markdown + KaTeX; {{slot}} placeholders when parameterized
  options: QuestionOption[];
  difficulty: Difficulty; // pinned at version level so recalibration never rewrites history (§9.2)
  paramSlots?: ParamSlot[];
  generateScript?: string; // instructor-authored generate() source (PrairieLearn convention)
  sourceRefs: Array<{ materialId: ObjectId; chunk?: string }>; // question reference view (§10)
  editedFields?: string[]; // fields manually changed vs the generated original (IN-Q03)
  createdBy: string; // puid or 'pipeline'
  createdAt: Date;
}

/** Mutable head record; content lives in QuestionVersions. */
export interface Question {
  courseId: ObjectId;
  currentVersionId: ObjectId;
  currentVersion: number;
  state: PublicationState;
  loIds: ObjectId[]; // many-to-many (IN-Q13)
  themeIds: ObjectId[];
  labels: QuestionLabel[];
  agentDecision?: { decision: 'pass' | 'flag' | 'reject'; reasoning: string; roleAssessment: string };
  generationPrompt?: string; // recorded custom prompt (IN-Q11)
  internalNotes: Array<{ puid: string; text: string; at: Date }>; // teaching-team-only (§6.2)
  createdAt: Date;
  updatedAt: Date;
}

/** The hub of the data model (PRD §2): one per submitted answer. */
export interface AttemptRecord {
  puid: string;
  courseId: ObjectId;
  questionId: ObjectId;
  questionVersionId: ObjectId; // pinned exact version served
  loId: ObjectId; // the LO context actually served under (§5.1 multi-LO rule)
  themeId: ObjectId;
  mode: PracticeMode;
  strategy: AppliedStrategy; // feedback strategy active at that moment
  selectedKey: string;
  correct: boolean;
  selectedRole: OptionRole;
  difficulty: Difficulty; // tier at serve time
  paramValues?: Record<string, number>; // randomized values shown (if parameterized)
  isRetry: boolean; // Strategy A retry attempts are independent, full-weight attempts
  examAttemptId?: ObjectId; // set when mode === 'exam-prep'
  createdAt: Date;
}

export interface Material {
  courseId: ObjectId;
  name: string;
  format: 'pdf' | 'docx' | 'pptx' | 'txt' | 'url';
  status: 'processing' | 'ready' | 'failed';
  error?: string;
  sourceUrl?: string; // format === 'url'
  storagePath?: string; // uploaded file location on disk
  assignments: Array<{ themeId: ObjectId; loId?: ObjectId }>; // many-to-many (IN-S05)
  classificationSuggestion?: { themeId: ObjectId; loId?: ObjectId; confidence: number }; // IN-S06
  uploadedAt: Date;
}

/** (User, LO) rollup computed from AttemptRecords — never raw judgments. */
export interface MasteryProfile {
  puid: string;
  courseId: ObjectId;
  loId: ObjectId;
  status: MasteryStatus;
  attemptCount: number;
  windowAccuracy: number; // over the rolling 10-attempt window (§9.2 Layer 1)
  windowRoles: Partial<Record<OptionRole, number>>; // selected-role distribution in window
  currentTier: Difficulty; // progression tier for question selection
  skipped?: 'after-attempting' | 'without-attempting'; // ST-P06
  examVerified?: boolean; // exam-prep qualifier (§9.2)
  rationale?: string; // Layer-2 one-liner for the instructor dashboard
  attemptsSinceEvaluation: number; // Layer-2 cadence bookkeeping
  updatedAt: Date;
}

export interface ReviewBookEntry {
  puid: string;
  courseId: ObjectId;
  questionId: ObjectId;
  sources: Array<'auto' | 'bookmark'>; // both may apply; entry appears once (ST-R02)
  triggeringAttemptId: ObjectId; // latest miss context (ST-R01)
  loId: ObjectId;
  themeId: ObjectId;
  lastRepracticeCorrect?: boolean; // reflected, never silently deleted (ST-R01)
  addedAt: Date;
  updatedAt: Date;
}

export interface ExamTemplate {
  courseId: ObjectId;
  kind: 'midterm' | 'final';
  themes: Array<{ themeId: ObjectId; mcqCount: number; tfCount: number; pointsPerQuestion: number }>;
  timeLimitMinutes?: number;
  availabilityStart: Date;
  availabilityEnd: Date;
  loBreakdown: boolean; // show per-LO results (ST-X03)
  updatedAt: Date;
}

export interface ExamAttempt {
  puid: string;
  courseId: ObjectId;
  templateId: ObjectId;
  questions: Array<{
    questionId: ObjectId;
    questionVersionId: ObjectId;
    loId: ObjectId;
    themeId: ObjectId;
    points: number;
    paramValues?: Record<string, number>;
    selectedKey?: string; // answer-in-progress; changeable until submit (ST-X02)
  }>;
  shortfalls: Array<{ themeId: ObjectId; requested: number; assembled: number }>; // ST-X01
  startedAt: Date;
  submittedAt?: Date;
  score?: number;
  maxScore: number;
}

export interface Flag {
  courseId: ObjectId;
  questionId: ObjectId;
  questionVersionId: ObjectId; // flags attach to the specific version (§6.2)
  puid: string; // flagging student
  reason?: string;
  state: FlagState;
  taRecommendation?: { action: 'correct' | 'archive' | 'clear'; note?: string; puid: string; at: Date };
  resolution?: { action: 'correct' | 'archive' | 'clear'; puid: string; at: Date };
  createdAt: Date;
}

export interface Notification {
  recipientPuid: string;
  courseId?: ObjectId;
  kind: 'flag' | 'auto-pause' | 'daily-summary' | 'flag-resolved' | 'correction' | 'review-backlog' | 'redirect';
  priority: 'standard' | 'elevated'; // §4.3 tiering
  body: string;
  refType?: string;
  refId?: ObjectId;
  readAt?: Date;
  createdAt: Date;
}

export interface AuditLog {
  actorPuid: string;
  action: string; // e.g. 'question.approve', 'flag.resolve', 'role.assign'
  targetType: string;
  targetId: ObjectId;
  courseId?: ObjectId;
  detail?: Record<string, unknown>;
  createdAt: Date;
}

/** Instructor-maintained roster; code + roster match required to enroll (ST-E02). */
export interface RosterEntry {
  courseId: ObjectId;
  identifier: string; // CWL username or student email, lower-cased
  extendedUntil?: Date; // per-student access extension (IN-S02)
  addedAt: Date;
}

// --- Publication state machine -----------------------------------------------

/** Allowed transitions (PRD §6.2). 'archived' is reachable from every state;
 * restore from 'archived' returns to 'draft' (re-approval required, IN-Q07). */
export const PUBLICATION_TRANSITIONS: Record<PublicationState, PublicationState[]> = {
  draft: ['pending-review', 'archived'],
  'pending-review': ['reviewed', 'approved', 'draft', 'archived'],
  reviewed: ['approved', 'draft', 'archived'],
  approved: ['paused', 'archived'],
  paused: ['approved', 'archived'],
  archived: ['draft'],
};

export function canTransition(from: PublicationState, to: PublicationState): boolean {
  return PUBLICATION_TRANSITIONS[from]?.includes(to) ?? false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/domain-types.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/types/domain.ts tests/unit/domain-types.test.ts
git commit -m "feat: shared domain types and publication state machine (PRD §2 data model)"
```

---

### Task 5: Typed MongoDB collections and indexes

**Owner:** Dev B (requires Task 4 merged)

**Files:**
- Create: `server/src/components/mongodb/collections.ts`
- Modify: `server/src/server.ts` (call `ensureIndexes()` after `connectMongo()`)
- Test: `tests/unit/collections.test.ts`

**Interfaces:**
- Consumes: `getDb()` from `server/src/components/mongodb`; all interfaces from `server/src/types/domain.ts` (Task 4).
- Produces: typed accessors used by every later service — `usersCol()`, `coursesCol()`, `themesCol()`, `losCol()`, `questionsCol()`, `questionVersionsCol()`, `attemptsCol()`, `materialsCol()`, `masteryCol()`, `reviewBookCol()`, `examTemplatesCol()`, `examAttemptsCol()`, `flagsCol()`, `notificationsCol()`, `auditCol()`, `rosterCol()` — each returning `Collection<T>` of the matching domain type; `ensureIndexes(): Promise<void>`; exported `INDEX_SPECS` for testability.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/collections.test.ts`:

```ts
import { INDEX_SPECS } from '../../server/src/components/mongodb/collections';

describe('collection index specs (PRD §2 data model)', () => {
  const byCollection = Object.fromEntries(INDEX_SPECS.map((s) => [s.collection + ':' + JSON.stringify(s.keys), s]));

  it('enforces identity and enrollment uniqueness', () => {
    expect(byCollection['users:{"puid":1}'].options?.unique).toBe(true);
    expect(byCollection['courses:{"registrationCode":1}'].options?.unique).toBe(true);
    expect(byCollection['rosterEntries:{"courseId":1,"identifier":1}'].options?.unique).toBe(true);
  });

  it('enforces one version number per question and one review-book entry per question', () => {
    expect(byCollection['questionVersions:{"questionId":1,"version":1}'].options?.unique).toBe(true);
    expect(byCollection['reviewBookEntries:{"puid":1,"courseId":1,"questionId":1}'].options?.unique).toBe(true);
    expect(byCollection['masteryProfiles:{"puid":1,"courseId":1,"loId":1}'].options?.unique).toBe(true);
  });

  it('indexes the hot attempt-record and serving paths', () => {
    expect(byCollection['attemptRecords:{"puid":1,"courseId":1,"loId":1,"createdAt":-1}']).toBeDefined();
    expect(byCollection['attemptRecords:{"questionVersionId":1}']).toBeDefined();
    expect(byCollection['questions:{"courseId":1,"state":1}']).toBeDefined();
    expect(byCollection['questions:{"loIds":1}']).toBeDefined();
    expect(byCollection['notifications:{"recipientPuid":1,"createdAt":-1}']).toBeDefined();
    expect(byCollection['flags:{"questionVersionId":1,"state":1}']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/collections.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/src/components/mongodb/collections.ts`**

```ts
import type { Collection, Document, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { getDb } from './index';
import type {
  User, Course, Theme, LearningObjective, Question, QuestionVersion, AttemptRecord,
  Material, MasteryProfile, ReviewBookEntry, ExamTemplate, ExamAttempt, Flag,
  Notification, AuditLog, RosterEntry,
} from '../../types/domain';

// Central, typed access to every collection (PRD §2 Data Model). Services must
// import these accessors instead of calling getDb().collection() with strings.

export const usersCol = (): Collection<User> => getDb().collection<User>('users');
export const coursesCol = (): Collection<Course> => getDb().collection<Course>('courses');
export const themesCol = (): Collection<Theme> => getDb().collection<Theme>('themes');
export const losCol = (): Collection<LearningObjective> => getDb().collection<LearningObjective>('learningObjectives');
export const questionsCol = (): Collection<Question> => getDb().collection<Question>('questions');
export const questionVersionsCol = (): Collection<QuestionVersion> => getDb().collection<QuestionVersion>('questionVersions');
export const attemptsCol = (): Collection<AttemptRecord> => getDb().collection<AttemptRecord>('attemptRecords');
export const materialsCol = (): Collection<Material> => getDb().collection<Material>('materials');
export const masteryCol = (): Collection<MasteryProfile> => getDb().collection<MasteryProfile>('masteryProfiles');
export const reviewBookCol = (): Collection<ReviewBookEntry> => getDb().collection<ReviewBookEntry>('reviewBookEntries');
export const examTemplatesCol = (): Collection<ExamTemplate> => getDb().collection<ExamTemplate>('examTemplates');
export const examAttemptsCol = (): Collection<ExamAttempt> => getDb().collection<ExamAttempt>('examAttempts');
export const flagsCol = (): Collection<Flag> => getDb().collection<Flag>('flags');
export const notificationsCol = (): Collection<Notification> => getDb().collection<Notification>('notifications');
export const auditCol = (): Collection<AuditLog> => getDb().collection<AuditLog>('auditLogs');
export const rosterCol = (): Collection<RosterEntry> => getDb().collection<RosterEntry>('rosterEntries');

export interface IndexSpec {
  collection: string;
  keys: IndexSpecification;
  options?: CreateIndexesOptions;
}

/** Exported for tests; applied by ensureIndexes(). */
export const INDEX_SPECS: IndexSpec[] = [
  { collection: 'users', keys: { puid: 1 }, options: { unique: true } },
  { collection: 'courses', keys: { registrationCode: 1 }, options: { unique: true } },
  { collection: 'themes', keys: { courseId: 1, order: 1 } },
  { collection: 'learningObjectives', keys: { courseId: 1, themeId: 1, order: 1 } },
  { collection: 'questions', keys: { courseId: 1, state: 1 } },
  { collection: 'questions', keys: { loIds: 1 } },
  { collection: 'questionVersions', keys: { questionId: 1, version: 1 }, options: { unique: true } },
  { collection: 'attemptRecords', keys: { puid: 1, courseId: 1, loId: 1, createdAt: -1 } },
  { collection: 'attemptRecords', keys: { questionVersionId: 1 } },
  { collection: 'materials', keys: { courseId: 1, uploadedAt: -1 } },
  { collection: 'masteryProfiles', keys: { puid: 1, courseId: 1, loId: 1 }, options: { unique: true } },
  { collection: 'reviewBookEntries', keys: { puid: 1, courseId: 1, questionId: 1 }, options: { unique: true } },
  { collection: 'examTemplates', keys: { courseId: 1, kind: 1 } },
  { collection: 'examAttempts', keys: { puid: 1, courseId: 1, startedAt: -1 } },
  { collection: 'flags', keys: { questionVersionId: 1, state: 1 } },
  { collection: 'flags', keys: { courseId: 1, state: 1 } },
  { collection: 'notifications', keys: { recipientPuid: 1, createdAt: -1 } },
  { collection: 'auditLogs', keys: { courseId: 1, createdAt: -1 } },
  { collection: 'rosterEntries', keys: { courseId: 1, identifier: 1 }, options: { unique: true } },
];

/** Idempotent: createIndex is a no-op when the index already exists. Called
 * once during startup, after connectMongo(). */
export async function ensureIndexes(): Promise<void> {
  for (const spec of INDEX_SPECS) {
    await getDb().collection<Document>(spec.collection).createIndex(spec.keys, spec.options ?? {});
  }
}
```

- [ ] **Step 4: Wire into startup**

In `server/src/server.ts`, immediately after the existing `connectMongo()` call, add:

```ts
import { ensureIndexes } from './components/mongodb/collections';
// ...after await connectMongo():
await ensureIndexes();
console.log('[server] MongoDB indexes ensured');
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/collections.test.ts && npm run typecheck`
Expected: PASS. Also start `npm run dev` once with docker services up; expect the "indexes ensured" log line and no errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/components/mongodb/collections.ts server/src/server.ts tests/unit/collections.test.ts
git commit -m "feat: typed MongoDB collection accessors and startup index creation"
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
  ubcEduCwlPuid: 'PUID-STUDENT-0001',
  uid: 'student1',
  mail: 'student1@example.ubc.ca',
  givenName: 'Sam',
  sn: 'Student',
  eduPersonAffiliation: ['student'],
  ...over,
});

describe('upsertUserFromSaml (ST-E01: PUID -> identity mapping)', () => {
  it('upserts keyed on PUID, setting identity fields and setOnInsert defaults', async () => {
    findOneAndUpdate.mockResolvedValue({ puid: 'PUID-STUDENT-0001' });
    await upsertUserFromSaml(samlAttrs());
    const [filter, update, options] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ puid: 'PUID-STUDENT-0001' });
    expect(update.$set).toMatchObject({
      uid: 'student1',
      email: 'student1@example.ubc.ca',
      displayName: 'Sam Student',
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

With docker + `npm run dev`: log in as `student1`, confirm `/api/auth/me` shows the user; check the `users` collection has one document keyed by `PUID-STUDENT-0001`; reload the page — still signed in; log in again — still exactly one user document.

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
Expected: PASS. Then with the stack running, log in as `student1` and `instructor1` and confirm the differing headings.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/auth.routes.ts client/src/views/home.ts tests/unit/auth.me.route.test.ts
git commit -m "feat: /api/auth/me identity contract and role-appropriate home stub"
```

---

### Task 9: KaTeX + Markdown client render utility

**Owner:** Dev B

**Files:**
- Create: `scripts/vendor-client-libs.mjs`
- Create: `client/src/render.ts`
- Modify: `client/public/index.html` (vendor script/link tags)
- Modify: `package.json` (`vendor` script, hook into `build`/`postinstall`)
- Modify: `.gitignore` (ignore `client/public/vendor/`)

**Interfaces:**
- Consumes: `katex`, `marked`, `dompurify` npm packages (Task 1).
- Produces: `renderRichText(target: HTMLElement, markdown: string): void` — renders markdown (sanitized) with `$...$` / `$$...$$` KaTeX math. Used by every question/feedback/explanation view in Phases 1–3.

- [ ] **Step 1: Write `scripts/vendor-client-libs.mjs`**

```js
// Copies browser builds of katex, marked, and dompurify from node_modules into
// client/public/vendor/ so the no-bundler client can load them via script tags.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const vendor = path.join(root, 'client/public/vendor');
mkdirSync(vendor, { recursive: true });

const copies = [
  ['node_modules/katex/dist/katex.min.js', 'katex.min.js'],
  ['node_modules/katex/dist/katex.min.css', 'katex.min.css'],
  ['node_modules/katex/dist/contrib/auto-render.min.js', 'katex-auto-render.min.js'],
  ['node_modules/katex/dist/fonts', 'fonts'],
  ['node_modules/marked/marked.min.js', 'marked.min.js'],
  ['node_modules/dompurify/dist/purify.min.js', 'purify.min.js'],
];
for (const [src, dest] of copies) {
  cpSync(path.join(root, src), path.join(vendor, dest), { recursive: true });
}
console.log('[vendor] client libs copied to client/public/vendor');
```

- [ ] **Step 2: Wire into `package.json` and `.gitignore`**

```json
"vendor": "node scripts/vendor-client-libs.mjs",
"postinstall": "node scripts/vendor-client-libs.mjs",
"build": "npm-run-all vendor build:server build:client",
```

Add `client/public/vendor/` to `.gitignore`. Run `npm run vendor` and confirm the files exist.

- [ ] **Step 3: Load vendor libs in `client/public/index.html`**

In `<head>` (before the app module script):

```html
<link rel="stylesheet" href="/vendor/katex.min.css" />
<script defer src="/vendor/katex.min.js"></script>
<script defer src="/vendor/katex-auto-render.min.js"></script>
<script defer src="/vendor/marked.min.js"></script>
<script defer src="/vendor/purify.min.js"></script>
```

- [ ] **Step 4: Write `client/src/render.ts`**

```ts
// Rich-text rendering for question stems, options, and explanations (ST-P03):
// markdown (tables, emphasis, code) + KaTeX math, sanitized with DOMPurify.
// The libraries are vendored globals loaded from index.html — see
// scripts/vendor-client-libs.mjs.

declare const marked: { parse(src: string): string };
declare const DOMPurify: { sanitize(html: string): string };
declare function renderMathInElement(
  el: HTMLElement,
  options: { delimiters: Array<{ left: string; right: string; display: boolean }>; throwOnError: boolean },
): void;

/** Render sanitized markdown + KaTeX into `target` (replaces its content). */
export function renderRichText(target: HTMLElement, markdown: string): void {
  const html = DOMPurify.sanitize(marked.parse(markdown));
  target.innerHTML = html;
  renderMathInElement(target, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  });
}
```

- [ ] **Step 5: Verify visually**

Temporarily render a fixture in the home view (`renderRichText(div, 'PV formula: $PV = \\frac{FV}{(1+r)^n}$\n\n| a | b |\n|---|---|\n| 1 | 2 |')`), load the page, confirm the formula and table render, then remove the fixture. Run `npm run typecheck`.
Expected: formula typeset by KaTeX; markdown table rendered; typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/vendor-client-libs.mjs client/src/render.ts client/public/index.html package.json .gitignore
git commit -m "feat: vendored KaTeX/marked/DOMPurify and renderRichText client utility"
```

---

### Task 10: REST API contract document

**Owner:** Dev B — **Sync point:** two-developer PR review required before merge.

**Files:**
- Create: `docs/api-contract.md`

**Interfaces:**
- Consumes: domain types (Task 4).
- Produces: the coordination artifact between the two developer arcs. Changes go through PR review only. Phase 1 implements exactly these endpoints.

- [ ] **Step 1: Write `docs/api-contract.md`**

Write the document with this exact structure and content (prose condensed here only where marked "described in Task N of the Phase 1 plan" — the shapes themselves are normative):

````markdown
# FinanceBot API Contract (v1 — Phase 1 surface)

All endpoints are under `/api`, JSON in/out, session-cookie authenticated
unless marked public. IDs are Mongo ObjectId hex strings.

**Error format (all endpoints):**
`{ "error": string, "issues"?: [{ "path": string, "message": string }] }`
Status codes: 400 validation, 401 unauthenticated, 403 wrong role/course,
404 not found, 409 conflict (e.g. duplicate enrollment).

**Auth guards:** `student` = enrolled in the course; `instructor` = course
instructor (owner/co-instructor); `ta` = course TA; `admin` = platform admin.

## Auth
- `GET /api/auth/me` (public) → `{ authenticated, user?: { puid, uid, displayName, isAdmin, affiliations, courseRoles } }`

## Enrollment (student)
- `POST /api/enrollments { code }` → 201 `{ courseId, name, courseCode }`
  Errors: 404 code not recognized; 403 `not-on-roster`; 410 `course-ended`;
  409 `already-enrolled` (informational, no duplicate created). (ST-E02)
- `GET /api/enrollments` → `[{ courseId, name, courseCode, term, active }]`

## Courses (instructor)
- `POST /api/courses { name, courseCode, term }` → 201 Course
- `GET /api/courses/:courseId` → Course + `themes: [Theme & { los: LearningObjective[] }]`
- `PATCH /api/courses/:courseId { termStart?, termEnd?, feedbackStrategy?, autoPause?, published? }` → Course
- `POST /api/courses/:courseId/registration-code` → `{ registrationCode }` (regenerates)
- `POST /api/courses/:courseId/publish` / `POST .../unpublish` → `{ published, checklist: [{ item, ok }] }`
- Roster: `PUT /api/courses/:courseId/roster { identifiers: string[] }` → `{ count }`;
  `GET .../roster` → `[{ identifier, extendedUntil? }]`

## Hierarchy (instructor)
- `POST /api/courses/:courseId/themes { name, availableFrom? }` → 201 Theme
- `PATCH /api/themes/:themeId { name?, availableFrom?, order? }` → Theme
- `POST /api/themes/:themeId/archive` → Theme
- `POST /api/themes/:themeId/los { name }` → 201 LearningObjective
- `PATCH /api/los/:loId { name?, order? }`, `POST /api/los/:loId/archive`

## Materials (instructor)
- `POST /api/courses/:courseId/materials` (multipart, field `files[]`; or JSON `{ url }`) → 201 `[Material]` (status `processing`)
- `GET /api/courses/:courseId/materials` → `[Material]`
- `POST /api/materials/:materialId/retry` → Material
- `PUT /api/materials/:materialId/assignments { assignments: [{ themeId, loId? }] }` → Material
- `POST /api/materials/:materialId/classification { action: 'accept' | 'reject' }` → Material

## Question bank (instructor; TA read paths in Phase 3)
- `GET /api/courses/:courseId/questions?state=&loId=&themeId=&type=&difficulty=&label=` →
  `{ total, questions: [{ id, state, labels, loIds, themeIds, current: QuestionVersion }] }` (IN-Q08)
- `GET /api/questions/:questionId` → full question + current version + agentDecision + notes + versions list
- `PATCH /api/questions/:questionId { stem?, options?, difficulty?, loIds?, themeIds? }` →
  creates a new QuestionVersion; response includes it (IN-Q03)
- `POST /api/questions/:questionId/transition { to }` → question (validated against PUBLICATION_TRANSITIONS; IN-Q04/Q07)
- `POST /api/questions/bulk-transition { questionIds, to }` → `{ updated }`
- `GET /api/courses/:courseId/review-queue` → prioritized list (IN-Q02)
- `POST /api/courses/:courseId/generate { loId, count?, type?, difficulty?, prompt? }` →
  202 `{ jobId }` — pipeline runs async; results land as Draft questions (IN-Q10/Q11)
- `GET /api/courses/:courseId/preseeding` → `[{ loId, approved, reviewed, target: 5 }]`

## Practice (student)
- `GET /api/courses/:courseId/home` → themes visible to the student (≥1 approved question,
  availableFrom passed, not archived) with per-LO mastery labels (ST-P01/P02)
- `POST /api/courses/:courseId/practice/next { loId?, themeId?, sessionServedIds: string[] }` →
  `{ question: { questionId, questionVersionId, type, stem, options: [{ key, text }], loId, themeId, paramValues? }, watermark }`
  — never includes roles/explanations/correctness. 404 when no approved question exists.
- `POST /api/attempts { questionVersionId, loId, selectedKey, mode, sessionServedIds, isRetry?, paramValues? }` →
  `{ correct, feedback: { strategy: 'a' | 'b', revealed: [{ key, text, role, explanation }] | chosenOnly, retryAvailable },
     mastery: { loStatus, recommendation? }, reviewBook: { added } }` (ST-P04)
- `POST /api/courses/:courseId/los/:loId/skip { attempted: boolean }` → 204 (ST-P06)
- `GET /api/courses/:courseId/session-summary` → start-of-session payload (ST-P11)

## Review Book (student)
- `GET /api/courses/:courseId/review-book?sort=` → grouped-by-theme entries (ST-R05)
- `POST /api/questions/:questionId/bookmark` / `DELETE .../bookmark` → entry (ST-R02)
- `DELETE /api/review-book/:entryId` → 204 (never touches answer history, ST-R03)
- Re-practice serves through `POST /api/attempts` with `mode: 'review-book'`.

## Health
- `GET /api/health` (public) → `{ status, mongo, qdrant }`
````

- [ ] **Step 2: Both developers review**

Open a PR containing only this file; both developers approve before merge. Subsequent changes to the contract go through PR review — never ad hoc (PHASING.md, Weekly cadence).

- [ ] **Step 3: Commit**

```bash
git add docs/api-contract.md
git commit -m "docs: Phase-1 REST API contract (coordination artifact)"
```

---

### Task 11: Toolkit ingestion spike — parse → chunk → embed → Qdrant

**Owner:** Dev B (requires Tasks 1 and 2 merged)

**Files:**
- Create: `scripts/ingest-spike.ts`
- Create: `tests/fixtures/sample-material.md`
- Modify: `package.json` (script `spike:ingest`)

**Interfaces:**
- Consumes: existing `server/src/components/genai/*` wrappers and `server/src/components/qdrant`.
- Produces: proof that the pinned toolkit versions handle the full ingestion path; any incompatibilities discovered now get shims inside the affected `components/genai/*` module (budgeted, PRD §11) rather than surprising WS-5 in Phase 1.

- [ ] **Step 1: Create the fixture**

`tests/fixtures/sample-material.md`:

```markdown
# Time Value of Money

The present value of a future cash flow is $PV = \frac{FV}{(1+r)^n}$ where
$r$ is the discount rate per period and $n$ the number of periods.

## Annuities

An ordinary annuity pays a fixed amount at the end of each period. Its present
value is $PV = C \cdot \frac{1 - (1+r)^{-n}}{r}$.

## Perpetuities

A perpetuity pays forever: $PV = C / r$. Growing perpetuity: $PV = C / (r - g)$
for $r > g$.
```

- [ ] **Step 2: Write `scripts/ingest-spike.ts`**

```ts
// Phase-0 integration spike (PRD §11 dependency risk): prove one document
// parses -> chunks -> embeds -> lands in Qdrant -> is retrievable, using the
// exact pinned ubc-genai-toolkit versions. Run: npm run spike:ingest
// Requires: docker compose up (Qdrant) + a reachable embeddings provider.
import path from 'node:path';
import { parseDocument } from '../server/src/components/genai/document-parsing';
import { chunkText } from '../server/src/components/genai/chunking';
import { embedTexts } from '../server/src/components/genai/embeddings';
import { ensureCollection, upsertPoints, search } from '../server/src/components/qdrant';

// NOTE: use the actual exported names from each component's index.ts — check
// the component files before running; adjust the imports, not the flow.

async function main(): Promise<void> {
  const file = path.resolve(__dirname, '../tests/fixtures/sample-material.md');
  const text = await parseDocument(file);
  console.log(`[spike] parsed ${text.length} chars`);

  const chunks = await chunkText(text);
  console.log(`[spike] ${chunks.length} chunks`);

  const vectors = await embedTexts(chunks);
  console.log(`[spike] embedded, dimension=${vectors[0].length}`);

  const collection = 'spike-course';
  await ensureCollection(collection, vectors[0].length);
  await upsertPoints(collection, chunks.map((chunk, i) => ({ id: i + 1, vector: vectors[i], payload: { chunk } })));

  const [queryVector] = await embedTexts(['How do I value a perpetuity?']);
  const hits = await search(collection, queryVector, 3);
  console.log('[spike] top hits:');
  for (const hit of hits) console.log(`  score=${hit.score.toFixed(3)} :: ${String(hit.payload?.chunk).slice(0, 80)}`);

  const top = String(hits[0]?.payload?.chunk ?? '');
  if (!top.toLowerCase().includes('perpetuit')) {
    throw new Error('Spike failed: top hit does not mention perpetuities — retrieval path broken.');
  }
  console.log('[spike] OK — ingestion path proven end to end.');
}

main().catch((err) => {
  console.error('[spike] FAILED:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Add the script and run it**

`package.json`: `"spike:ingest": "tsx scripts/ingest-spike.ts"`.

Run: `docker compose up -d && npm run spike:ingest`
Expected: the four `[spike]` progress lines and final `OK`. If a toolkit API mismatch surfaces (pre-1.0 churn), fix it by adjusting the wrapper in `server/src/components/genai/<module>/index.ts` (that is the shim point) and re-run until green. Record any shim in that module's `AGENTS.md`.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-spike.ts tests/fixtures/sample-material.md package.json
git commit -m "feat: toolkit ingestion spike proving parse->chunk->embed->qdrant with pinned versions"
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
- Consumes: the compose stack (Task 2), role home stub (Task 8), existing Playwright global-setup SAML login flow.
- Produces: the Phase-0 exit test — log in via mock CWL → session persists → role-appropriate course home renders.

- [ ] **Step 1: Write the spec**

`tests/e2e/walking-skeleton.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Phase 0 exit test (phase-0-foundations.md, Joint): login via mock CWL ->
// session persists -> role-appropriate home renders. Relies on the SAML
// session established by tests/e2e/global-setup.ts (student1 by default).

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

If `global-setup.ts` still uses docker-simple-saml credentials, update it to log in as `student1` / `student1pass` against the compose IdP.

- [ ] **Step 2: Run it fresh-clone style (both developers)**

Run:
```bash
docker compose up -d && npm ci && npm run saml:fetch-cert && npm run build
npm run test:e2e -- tests/e2e/walking-skeleton.spec.ts
```
Expected: PASS on both developers' machines. This is the phase exit gate.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/walking-skeleton.spec.ts tests/e2e/global-setup.ts
git commit -m "test: walking-skeleton e2e (mock CWL login, session persistence, role home)"
```

---

## Exit criteria checklist (from phase-0-foundations.md)

- [ ] Walking skeleton works on both devs' machines from a fresh clone (Task 13 Step 2).
- [ ] CI green: lint, typecheck strict, tests (Task 12).
- [ ] API contract reviewed and merged by both devs (Task 10).
- [ ] Toolkit spike proves ingestion end-to-end; versions pinned (Tasks 1, 11).
- [ ] Unit/integration tests exist for auth flow and config validation (Tasks 3, 7, 8, 13).
- [ ] PIA/DAR kickoff initiated; PSD reconciliation pinged (non-dev checklist).
