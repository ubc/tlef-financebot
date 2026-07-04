# AGENTS.md — server/src/middleware

Cross-cutting Express middleware.

## Present

- `error-handler.ts`
  - `notFoundHandler` — 404 JSON for unmatched routes.
  - `errorHandler` — central error formatter. Express recognizes it as an error
    handler by its four-argument signature `(err, req, res, next)`, so `next`
    must remain in the signature even when unused. Reads an optional numeric
    `err.status`, defaulting to 500.

Both are registered last in `app.ts`, after all routes and the static handler.

## Adding middleware

- App-wide middleware: add it in `app.ts` in the right order (before routes for
  request preprocessing; after for fallbacks).
- Route-specific middleware (e.g. an auth guard from the `auth` component):
  export it here or from the component, and apply it on the specific router.
- Prefer small, single-purpose middleware. Throw errors rather than sending
  ad-hoc error responses, so the central `errorHandler` stays authoritative.
