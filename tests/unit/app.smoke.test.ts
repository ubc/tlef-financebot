// App-level smoke test (C1 regression guard). No test previously imported
// app.ts at all — every other unit/route test builds its own minimal Express
// app and mounts a single router directly, so nothing ever walked app.ts's
// real, top-to-bottom import graph. That is exactly why a 156-green suite
// shipped a server that could not boot: materials.service.ts called
// `defineJob()` at module load, and because app.ts (via materials.routes.ts)
// imports materials.service.ts, that call ran the moment ANYTHING required
// app.ts — including production's own server.ts, well before startJobs() had
// run. This test's only job is to import app.ts for real (nothing under
// server/src/services or server/src/routes is mocked) and prove
// `createApp()` does not throw.
//
// Two things are mocked, and only because they are genuinely unrelated to the
// bug this test guards against:
//   - components/auth: configureAuth() reads the SAML IdP certificate from
//     `server/certs/idp.pem`, which is gitignored ("fetched per-developer;
//     never commit" — see .gitignore) and so is NOT guaranteed to exist in
//     CI. It also wires up a real session store via connect-mongo, which
//     needs a live, already-connected MongoClient. Neither has anything to do
//     with the C1 job-registration-timing bug, and stubbing them out does not
//     defeat this test's purpose: materials.routes.ts (and every other
//     router) still imports the REAL `ensureApiAuthenticated`/`ensureRole`
//     symbols from this module at require-time, so the mock factory has to
//     supply real, working Express middleware, not just no-ops that happen to
//     not throw.
//   - components/qdrant: constructing the real `QdrantClient` is harmless at
//     import time, but it kicks off an async server-version compatibility
//     check in the background that logs a warning after Jest has already torn
//     the test down (a real network call this test has no reason to make).
//     Mocked here purely to keep the run quiet; every other genai component
//     (chunking, document-parsing, embeddings) is left real and unmocked —
//     none of them opens a network connection at import time, which is
//     exactly the property this test needs and exercises for real.
jest.mock('../../server/src/components/qdrant', () => ({
  qdrant: {},
  ensureCollection: jest.fn(),
  upsertPoints: jest.fn(),
  search: jest.fn(),
  pingQdrant: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../server/src/components/auth', () => ({
  configureAuth: () => ({
    passport: {
      initialize: () => (_req: unknown, _res: unknown, next: () => void) => next(),
      session: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    },
    sessionMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  }),
  ensureApiAuthenticated:
    () =>
    (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
      res.status(401).json({ error: 'Authentication required.' }),
  ensureRole:
    () =>
    (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
      res.status(403).json({ error: 'Forbidden.' }),
}));

import { createApp } from '../../server/src/app';

describe('createApp (C1 boot-crash regression guard)', () => {
  it('constructs the app without throwing', () => {
    expect(() => createApp()).not.toThrow();
  });
});
