# AGENTS.md — components/mongodb

MongoDB integration using the official [`mongodb`](https://www.mongodb.com/docs/drivers/node/current/)
Node.js driver.

## Status

Implemented. This is the reference example for how a component is wired up.

## Local database

Developers run the [tlef-mongodb-docker](https://github.com/ubc/tlef-mongodb-docker)
container (MongoDB 7 + Mongo Express, auth enabled). Start it with
`docker compose up -d`; Mongo listens on `localhost:27017` and Mongo Express is at
`http://localhost:8081`. The same setup is used in staging/production.

## Environment variables

| Variable | Meaning | Default (matches the docker container) |
| --- | --- | --- |
| `MONGODB_URI` | Connection string | `mongodb://mongoadmin:secret@localhost:27017/?authSource=admin` |
| `MONGODB_DB_NAME` | Database name | `financebot` |

The container enables auth and creates a root user in the `admin` database, so
the URI MUST include `authSource=admin`. The username/password are that
container's `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD`.

Both variables are read in `server/src/config/env.ts` and exposed on `env`.

## Public API (`index.ts`)

| Export | Purpose |
| --- | --- |
| `connectMongo(): Promise<Db>` | Connect once and cache the client + db. Idempotent. Call at startup. |
| `getDb(): Db` | The connected database. Throws if `connectMongo()` has not run. |
| `getMongoClient(): MongoClient` | The underlying client (e.g. for `connect-mongo`'s session store). |
| `pingMongo(): Promise<boolean>` | Liveness check used by `/api/health`. Never throws. |
| `closeMongo(): Promise<void>` | Close and clear cached state (shutdown / tests). |

A single `MongoClient` is shared process-wide (the driver pools connections).
Never create a client per request.

## How it is wired

- `server/src/server.ts` calls `connectMongo()` before `app.listen()` (fail fast
  on a bad URI / unreachable server) and `closeMongo()` on SIGINT/SIGTERM.
- `GET /api/health` calls `pingMongo()` and reports
  `{ services: { mongodb: "up" | "down" } }`.

## Example usage (reference, safe to delete)

The `notes` feature demonstrates reading/writing via this component:

- `server/src/services/notes.service.ts` — uses `getDb().collection('notes')`.
- `server/src/routes/notes.routes.ts` — `GET/POST /api/notes`.
- The client page has a small "Notes" form that calls those endpoints.

```bash
# create a note
curl -X POST http://localhost:3000/api/notes \
  -H 'Content-Type: application/json' -d '{"text":"hello"}'
# list notes
curl http://localhost:3000/api/notes
```

Note: `/api/notes` is **auth-gated** (see `routes/notes.routes.ts`), so these
`curl` calls return `401` without a logged-in session cookie — exercise them from
the browser after logging in, or remove the `ensureApiAuthenticated()` guard for
quick local API testing.

## Using it in your own code

```ts
import { getDb } from '../components/mongodb';

const users = getDb().collection('users');
await users.insertOne({ name: 'Ada' });
```

Do the DB work in a `service` (see `server/src/services/AGENTS.md`); call the
service from a route.

Typed application collections and their index specs are centralized in
`collections.ts`. Phase 2 P2-0 adds `contentRunsCol()` as the durable source of
truth for material-ingest/question-generation progress; mutate it through
`content-runs.service.ts` so revision CAS and post-write SSE publication remain
coupled.

## Gotchas

- Missing `authSource=admin` (or wrong credentials) yields an authentication
  error against the docker container — this is the most common misconfiguration.
- The session store for the `auth` component (`connect-mongo`) should reuse this
  same connection via `getMongoClient()` rather than opening a second client.
- `connectMongo()` is idempotent but not concurrency-guarded; call it once from
  startup, not lazily from many requests.
