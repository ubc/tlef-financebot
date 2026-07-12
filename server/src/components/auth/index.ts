import passport from 'passport';
import { createSessionMiddleware } from './session';
import { registerShibbolethStrategy } from './strategies/shibboleth';
import { findUserByPuid } from '../../services/users.service';

// Re-export the route guards from passport-ubcshib so app code imports auth
// helpers from this component rather than the package directly.
//   - ensureAuthenticated(): 302-redirects unauthenticated browsers to the IdP
//     login. Use it on full-page / navigational routes.
//   - ensureApiAuthenticated(): responds 401 JSON. Use it on /api/* routes that
//     the client calls with fetch (see guards.ts).
export { ensureAuthenticated, conditionalAuth } from 'passport-ubcshib';
export { ensureApiAuthenticated } from './guards';
export { ensureRole, rolesOf, hasRole } from './roles';
export { verifyIdpCertificatePresent } from './strategies/shibboleth';
export type { AppUser } from './strategies/shibboleth';

let configured = false;

/**
 * Configure authentication and return the middleware `app.ts` needs to install
 * (in this order): sessionMiddleware -> passport.initialize() -> passport.session().
 *
 * Registering the strategy reads the IdP certificate from disk and throws a
 * clear error if it is missing, so call this only after MongoDB is connected
 * (the session store depends on it) — i.e. from within `createApp()`.
 */
export function configureAuth(): {
  passport: typeof passport;
  sessionMiddleware: ReturnType<typeof createSessionMiddleware>;
} {
  if (!configured) {
    registerShibbolethStrategy();

    // Session stores only the CWL PUID; deserialize reloads the domain User from
    // MongoDB so req.user is the full identity (isAdmin, courseRoles). (ST-E01)
    passport.serializeUser((user, done) => done(null, (user as { puid: string }).puid));
    passport.deserializeUser((puid: string, done) => {
      findUserByPuid(puid)
        .then((user) => done(null, user ?? false))
        .catch((err) => done(err as Error));
    });

    configured = true;
  }

  return {
    passport,
    sessionMiddleware: createSessionMiddleware(),
  };
}
