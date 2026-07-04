import type { RequestHandler } from 'express';
import type { AppUser } from './strategies/shibboleth';

// Authorization helpers, keyed on the SAML `eduPersonAffiliation` attribute.
// This is the layer on top of authentication: authentication answers "who are
// you?" (see guards.ts / ensureApiAuthenticated); this answers "what may you
// do?". See components/auth/AGENTS.md.

/** The SAML attribute that carries the user's role(s) (friendly name). */
const AFFILIATION_ATTR = 'eduPersonAffiliation';

/**
 * The user's role(s), derived from `eduPersonAffiliation`. That attribute is
 * multi-valued in SAML, so this returns a lower-cased array (e.g. `['faculty']`
 * or `['staff', 'faculty']`). Empty when the attribute is absent.
 */
export function rolesOf(user: AppUser | undefined): string[] {
  const raw = user?.attributes?.[AFFILIATION_ATTR];
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return values.map((value) => String(value).toLowerCase());
}

/** True if the user holds at least one of `allowed`. */
export function hasRole(user: AppUser | undefined, ...allowed: string[]): boolean {
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
