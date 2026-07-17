# AGENTS.md — components/jobs

MongoDB-backed background job queue using [`agenda`](https://github.com/agenda/agenda)
(pinned at `4.4.0`). One `Agenda` instance per process, started via `startJobs()`
after `connectMongo()` (see `server/src/server.ts`).

**Deliberate connection choice:** unlike other components, jobs does NOT share
the process `MongoClient` (`getMongoClient()`). agenda@4's API is written
against **mongodb@4** result shapes (e.g. `findOneAndUpdate` returns `{ value }`);
the repo's top-level driver is **mongodb@7**, which returns the document directly
and would silently break job locking — jobs would enqueue but never execute. So
we pass agenda a connection **string** (`db: { address, collection }`) and let it
use its own bundled mongodb@4 driver. The URI and DB name are still read only
from `env` (`env.mongodbUri`, `env.mongodbDbName`); no `process.env` access here.

## Public API (`index.ts`)

| Export | Purpose |
| --- | --- |
| `startJobs(): Promise<void>` | Create and start the Agenda instance. Idempotent. Call once at startup. |
| `stopJobs(): Promise<void>` | Stop Agenda, **close its private mongodb connection** (`stop()` + `close()`), and clear cached state (shutdown / tests). |
| `defineJob<T>(name, handler)` | Register a named job handler. Throws if `startJobs()` has not run. |
| `enqueueJob<T>(name, data)` | Run a job now. Throws if `startJobs()` has not run. |
| `scheduleRecurring(name, interval)` | Schedule a defined job on a recurring interval (e.g. `'1 day'`). |

## Registering job handlers: do NOT call `defineJob()` at module level

Job **handlers** are not defined here — the function passed to `defineJob()`
lives next to the service that owns the job (e.g. `materials.service.ts` for
`material.ingest`). But that call must NOT be made at module load time (a
plain top-level `defineJob(...)` in the service file). Doing so previously
crashed the server on boot (a Critical finding, C1) and will happen again for
any future job if this pattern is repeated:

The compiled output is CommonJS (`package.json`'s `"type": "commonjs"`).
`app.ts` mounts routers that `import` the owning service (e.g.
`materials.routes.ts` imports `materials.service.ts`), and a CommonJS
`import` compiles to a hoisted, synchronous `require()` — one that runs the
instant *anything* requires `app.ts`, including `server.ts`, well before
`server.ts`'s `main()` starts and long before `startJobs()` runs. A
module-level `defineJob()` call in that service therefore always fires
before Agenda has started and throws `Jobs not started. Call startJobs()
during startup first.`, so the process never boots.

**The working pattern:** the owning service exports a `registerXJobs()`
function that calls `defineJob(...)` inside its body (not at module scope).
`server.ts` imports that function and calls it explicitly in `main()`,
*after* `startJobs()` has resolved. See `materials.service.ts`'s
`registerMaterialJobs()` and its call site in `server.ts` for the reference
implementation — copy that shape for any new job, don't call `defineJob()`
directly at the top of the file.

`tests/unit/app.smoke.test.ts` is a regression guard for this: it imports
`app.ts` for real (no service-layer mocking) and asserts `createApp()` does
not throw, which reproduces the exact hoisted-`require()` ordering that
caused the boot crash. Any new job handler that goes back to a module-level
`defineJob()` call will fail that test.
