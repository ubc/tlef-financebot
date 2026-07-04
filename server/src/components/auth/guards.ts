import type { RequestHandler } from 'express';

/**
 * Route guard for JSON `/api/*` endpoints consumed by `fetch`.
 *
 * The `ensureAuthenticated` guard re-exported from `passport-ubcshib` (see
 * index.ts) responds to an unauthenticated request with a 302 redirect to the
 * IdP login (`/auth/ubcshib`). That is the right behaviour for a full-page
 * navigation, but a browser `fetch()` would silently follow the redirect and
 * receive the IdP's HTML login page instead of a useful error. For an API the
 * caller wants a machine-readable answer, so this guard returns `401` JSON.
 *
 * Use `ensureApiAuthenticated()` on `/api/*` routes; use the redirecting
 * `ensureAuthenticated()` on browser-facing (server-rendered / navigational)
 * routes. See components/auth/AGENTS.md.
 */
export function ensureApiAuthenticated(): RequestHandler {
  return (req, res, next) => {
    if (req.isAuthenticated()) {
      next();
      return;
    }
    res.status(401).json({ error: 'Authentication required.' });
  };
}
