# AGENTS.md — components/auth

Authentication via SAML 2.0 against UBC's Shibboleth IdP, using
[`passport-ubcshib`](https://github.com/ubc/passport-ubcshib) (a wrapper around
`passport-saml`). Sessions are stored in MongoDB with `connect-mongo`.

## Status

Implemented for the LOCAL environment (the docker-simple-saml IdP). STAGING /
PRODUCTION work by changing environment variables (see below).

## Local IdP

Developers run [docker-simple-saml](https://github.com/ubc/docker-simple-saml)
(`docker compose up -d`). It serves a SimpleSAMLphp IdP at
`http://localhost:6122/simplesaml/`. Test users (username:password) include
`faculty:faculty`, `student:student`, `staff:staff`, and many `*_prof` /
`*_student` personas — see that repo's `config/simplesamlphp/authsources.php`.

Two one-time local setup steps are required (documented in the root README):

1. Register this app as a Service Provider in the IdP by adding an entry to
   `docker-simple-saml/config/simplesamlphp/saml20-sp-remote.php` whose key is
   your `SAML_ISSUER` and whose ACS `Location` is your `SAML_CALLBACK_URL`.
2. Provide the IdP's signing certificate (see "Certificate" below).

## Files

- `session.ts` — `createSessionMiddleware()`. express-session backed by
  `connect-mongo`, reusing the mongodb component's client via `getMongoClient()`
  (so `connectMongo()` must run first — it does, in `server.ts`).
- `strategies/shibboleth.ts` — `registerShibbolethStrategy()` builds the
  `passport-ubcshib` `Strategy` from `env`, loads the IdP cert, and defines the
  verify callback that shapes the session `AppUser`. Also exports
  `verifyIdpCertificatePresent()` (startup preflight) and the `AppUser` type.
- `guards.ts` — `ensureApiAuthenticated()`, the route guard for JSON `/api/*`
  endpoints. Unlike `ensureAuthenticated` (which 302-redirects an unauthenticated
  browser to the IdP), it responds `401 { error }` so a `fetch()` caller gets a
  machine-readable answer instead of the IdP's HTML login page. See "Protecting
  routes" below.
- `roles.ts` — authorization helpers keyed on `eduPersonAffiliation`:
  `rolesOf(user)` (lower-cased role array), `hasRole(user, ...roles)`, and the
  `ensureRole(...roles)` guard (`401` signed out, `403` wrong role). See
  "Role-based authorization" below.
- `index.ts` — `configureAuth()`: registers the strategy + serialize/deserialize
  and returns `{ passport, sessionMiddleware }` for `app.ts` to install. Also
  re-exports the guards (`ensureAuthenticated` / `conditionalAuth` from
  `passport-ubcshib`, `ensureApiAuthenticated` from `guards.ts`),
  `ensureRole` / `rolesOf` / `hasRole` from `roles.ts`,
  `verifyIdpCertificatePresent`, and the `AppUser` type — so app code imports
  auth helpers from this component, not the underlying package.
- `../../types/passport-ubcshib.d.ts` — local type declarations (the package
  ships none).
- `../../types/express.d.ts` — augments `Express.User` to be `AppUser`.

## How it is wired (`app.ts`)

Order matters:

```
express.urlencoded()            // the SAML callback is form-urlencoded
  -> sessionMiddleware
  -> passport.initialize()
  -> passport.session()
  -> routes (including authRouter)
```

## Routes (`server/src/routes/auth.routes.ts`)

| Route | Purpose |
| --- | --- |
| `GET /auth/ubcshib` | Start login; redirects (302) to the IdP SSO endpoint. |
| `POST /auth/ubcshib/callback` | ACS. IdP posts the signed SAML response; passport establishes the session, then we redirect to `POST_LOGIN_REDIRECT`. |
| `GET /auth/logout` | Local logout: `req.logout()` + destroy session + clear cookie. |
| `GET /api/auth/me` | `{ authenticated, user }` for the client UI. |

The login/callback/logout paths are NOT under `/api` because their URLs must
match the ACS/SLO locations registered in the IdP's SP metadata.

## Environment variables

| Variable | Meaning | LOCAL default |
| --- | --- | --- |
| `SESSION_SECRET` | Session cookie signing secret | dev-only default |
| `SAML_ENVIRONMENT` | `LOCAL` \| `STAGING` \| `PRODUCTION` | `LOCAL` |
| `SAML_ISSUER` | SP entity ID (must match an IdP SP entry) | `http://localhost:3000` |
| `SAML_CALLBACK_URL` | ACS URL (must match the IdP SP entry) | `http://localhost:3000/auth/ubcshib/callback` |
| `SAML_ENTRY_POINT` | IdP SSO endpoint | `http://localhost:6122/simplesaml/saml2/idp/SSOService.php` |
| `SAML_LOGOUT_URL` | IdP SLO endpoint | `.../SingleLogoutService.php` |
| `SAML_IDP_METADATA_URL` | IdP metadata (used by the cert-fetch script) | `.../metadata.php` |
| `SAML_IDP_CERT_PATH` | Path to the IdP signing cert (PEM) | `./server/certs/idp.pem` |
| `SAML_FORCE_AUTHN` | Force re-auth at the IdP on every login | `true` |
| `POST_LOGIN_REDIRECT` / `POST_LOGOUT_REDIRECT` | Post-auth redirects | `/` |

## Certificate

`passport-ubcshib`'s `Strategy` constructor throws if no `cert` is provided (its
"auto-fetch from metadata" path never runs because the throw happens first), so
the cert is effectively required. Populate `SAML_IDP_CERT_PATH` by either:

- `npm run saml:fetch-cert` (fetches it from `SAML_IDP_METADATA_URL`), or
- copying `docker-simple-saml/cert/server.crt` to that path.

The file is git-ignored (`server/certs/`).

Startup preflight: `server.ts` calls `verifyIdpCertificatePresent()` before
connecting to MongoDB. If the cert is missing/empty it throws with actionable
guidance (mentioning `npm run saml:fetch-cert` for `SAML_ENVIRONMENT=LOCAL`) so
`npm run dev` fails fast; when present it logs
`[server] SAML: IdP certificate found at <path> ...`.

## Logout and re-authentication

`GET /auth/logout` performs a local logout only: it clears the passport login,
destroys the session, and clears the cookie. It does NOT terminate the IdP's own
SSO session. To make logout meaningful in dev, the strategy sets
`forceAuthn=true` (from `SAML_FORCE_AUTHN`), which adds `ForceAuthn="true"` to
each AuthnRequest so the IdP re-prompts for credentials on the next login even if
it still has a session. (passport-ubcshib does not forward `forceAuthn`, so it is
set on the strategy's underlying `passport-saml` options after construction.)

Set `SAML_FORCE_AUTHN=false` in production if you want to preserve cross-app SSO.
True SAML Single Logout (terminating the IdP session) is not enabled here; it
would require sending a signed `LogoutRequest` with the session's NameID /
sessionIndex.

## Gotchas / non-obvious details

- Port: the library's built-in LOCAL preset points at `http://localhost:8080`,
  but docker-simple-saml runs on `:6122`. That is why we pass `entryPoint` /
  `logoutUrl` / `metadataUrl` explicitly from `env`.
- `SAML_ISSUER` must EXACTLY match an SP entry key in the IdP's
  `saml20-sp-remote.php`, and `SAML_CALLBACK_URL` must match that entry's ACS
  `Location`. Mismatches are the most common failure.
- No SP private key is needed for LOCAL (the IdP does not validate AuthnRequests
  or encrypt assertions). For STAGING/PRODUCTION you register with UBC IAM and
  may need `privateKeyPath` — see the passport-ubcshib README.
- We store the whole SAML profile in the session (`AppUser`). A real app should
  upsert a user document (via `components/mongodb`) in the verify callback and
  serialize only its id.

## Protecting routes (auth-gating)

Import a guard from this component and apply it to the route(s) you want to
protect. Pick the guard by how the route is called:

| Guard | Unauthenticated response | Use on |
| --- | --- | --- |
| `ensureAuthenticated()` | `302` redirect to `/auth/ubcshib` (IdP login) | Full-page / navigational routes a browser visits directly. |
| `ensureApiAuthenticated()` | `401 { error }` JSON | `/api/*` routes the client calls with `fetch()`. |

Both are guard **factories** — call them (`ensureApiAuthenticated()`) to get the
middleware. Inside a guarded handler, `req.user` is the session `AppUser`.

```ts
import { Router } from 'express';
import { ensureApiAuthenticated } from '../components/auth';

const router = Router();
// Only signed-in callers reach the handler; everyone else gets 401 JSON.
router.get('/secret', ensureApiAuthenticated(), (req, res) => {
  res.json({ hello: req.user!.nameId });
});
```

Working reference: `routes/members.routes.ts` (gated `GET
/api/members/overview`, backed by `services/members.service.ts`) is the minimal
end-to-end example. The `notes` and `rag` demo routes are gated the same way.

**Apply the guard per route, not with `router.use(ensureApiAuthenticated())`.**
These routers are mounted at the shared `/api` prefix, and router-level
middleware runs for EVERY `/api/*` request that reaches the router — including
requests with no matching route in it — so a router-wide guard would also 401
sibling public endpoints (e.g. `/api/auth/me`) before they fall through to their
own router. Guarding each route keeps the gate scoped to that route. (If you want
to guard a whole area with one `router.use`, mount that router at its own
non-shared prefix, e.g. `app.use('/api/admin', adminRouter)`.)

Reflect the gate in the UI: the client already calls `GET /api/auth/me`, so
hide/disable gated controls when `authenticated` is false and handle the `401`
if a gated call is made while logged out.

## Role-based authorization

Authentication answers "who are you?"; **authorization** answers "what may you
do?". `roles.ts` derives roles from the SAML `eduPersonAffiliation` attribute
(the local IdP issues `faculty` / `student` / `staff`) and provides an
`ensureRole(...roles)` guard: `401` when signed out, `403` when signed in without
one of the required roles.

```ts
import { ensureRole } from '../components/auth';

// Only users whose eduPersonAffiliation includes "faculty" reach the handler.
router.get('/faculty/thing', ensureRole('faculty'), (req, res) => { ... });
```

Working reference: `services/roles.service.ts` + `routes/roles.routes.ts` expose
`GET /api/roles/{faculty,student,staff}`, one gated per role. `GET /api/auth/me`
also returns server-derived `roles`, so the client filters its role menus from a
single source of truth (nav item visible only for a matching role) while the
server does the real enforcement — the same "hide in UI, enforce on the server"
split as `ensureApiAuthenticated`. Note `eduPersonAffiliation` is multi-valued, so
`rolesOf` returns an array and `ensureRole`/`hasRole` match on intersection.

## Moving to STAGING / PRODUCTION

Set `SAML_ENVIRONMENT`, switch `SAML_ISSUER` / `SAML_CALLBACK_URL` to your
HTTPS URLs, point the `SAML_*` endpoints at UBC's IdP (or unset them to use the
library's built-in presets), and register the SP with UBC IAM. See the
passport-ubcshib README's staging/production guide.
