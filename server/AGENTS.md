# AGENTS.md — server/

The Express backend, in TypeScript (CommonJS). Requires Node.js 18+.

## Files

- `src/server.ts` — entry point. Reads `env`, creates the app, starts listening.
  Run in dev with `tsx watch` (no build step); compiled to `dist/` for prod.
- `src/app.ts` — `createApp()` factory. Registers middleware, mounts `/api`
  routers, serves the client's static output, then the 404 + error handlers.
  Kept separate from `server.ts` so it can be imported by tests without binding
  a port.
- `src/config/env.ts` — the ONLY place that reads `process.env`. Exposes a typed,
  frozen `env` object. Add new variables here as components need them.
- `src/middleware/` — cross-cutting Express middleware (error handling lives in
  `error-handler.ts`).
- `src/routes/` — HTTP routers, mounted under `/api` in `app.ts`. One file per
  resource, e.g. `health.routes.ts`.
- `src/services/` — business logic. Services compose one or more `components/`
  and are called by routes. Keeps routes thin and components decoupled.
- `src/components/` — one folder per external integration. See
  `src/components/AGENTS.md`.

## Layering (keep this direction of dependency)

```
routes  ->  services  ->  components  ->  external systems
```

Routes never talk to a database or SDK directly; they call a service. Services
own the orchestration and use components. Components own a single integration.

## Adding an endpoint

1. Create `src/routes/<name>.routes.ts` exporting a `Router`.
2. Mount it in `src/app.ts`: `app.use('/api', <name>Router)`.
3. Put logic in a service under `src/services/`; keep the route thin.
4. Keep the response shape in sync with the client's `client/src/api.ts`.

## Static serving

`app.ts` serves `client/public` (resolved relative to `__dirname`, which works
both from `src/` under `tsx` and from `dist/` in production). API routes are
matched before the static handler because they are mounted first.

## Conventions

- Do not read `process.env` outside `config/env.ts`.
- Validate/normalize inputs at the route boundary; assume typed data below it.
- Throw errors (optionally with a numeric `status`); the central `errorHandler`
  formats the JSON response.
