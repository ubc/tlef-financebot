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
| `stopJobs(): Promise<void>` | Stop Agenda and clear cached state (shutdown / tests). |
| `defineJob<T>(name, handler)` | Register a named job handler. Throws if `startJobs()` has not run. |
| `enqueueJob<T>(name, data)` | Run a job now. Throws if `startJobs()` has not run. |
| `scheduleRecurring(name, interval)` | Schedule a defined job on a recurring interval (e.g. `'1 day'`). |

Job **handlers** are not defined here — they live next to the service that owns
them (e.g. `server/src/services/ingestion.service.ts` calls `defineJob(...)` for
its own job name) and are registered during startup, alongside `startJobs()`.
