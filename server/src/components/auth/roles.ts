import type { RequestHandler } from 'express';

// Authorization helpers, keyed on the user's CWL affiliations. This is the layer
// on top of authentication: authentication answers "who are you?" (see guards.ts
// / ensureApiAuthenticated); this answers "what may you do?". The domain User
// stores affiliations (lower-cased eduPersonAffiliation values) directly (ST-E01).
// See components/auth/AGENTS.md.

/**
 * The user's role(s), read from the domain User's `affiliations` (already
 * lower-cased, e.g. `['faculty']` or `['staff', 'faculty']`). Empty when absent.
 */
export function rolesOf(user: { affiliations?: string[] } | undefined): string[] {
  return user?.affiliations ?? [];
}

/** True if the user holds at least one of `allowed`. */
export function hasRole(user: { affiliations?: string[] } | undefined, ...allowed: string[]): boolean {
  const roles = rolesOf(user);
  return allowed.some((role) => roles.includes(role.toLowerCase()));
}

/**
 * Route guard for `/api/*` routes that require a role. Responds `401` when signed
 * out and `403` when signed in but lacking any of `allowed`. Compose it like
 * `ensureApiAuthenticated` (it also does the auth check, so it can stand alone):
 *
 *   router.get('/faculty/thing', ensureRole('faculty'), handler)
 */
export function ensureRole(...allowed: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!hasRole(req.user, ...allowed)) {
      res.status(403).json({ error: 'You do not have access to this area.' });
      return;
    }
    next();
  };
}
