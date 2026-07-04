import passport from 'passport';
import { createSessionMiddleware } from './session';
import { registerShibbolethStrategy, type AppUser } from './strategies/shibboleth';

// Re-export the route guards from passport-ubcshib so app code imports auth
// helpers from this component rather than the package directly.
//   - ensureAuthenticated(): 302-redirects unauthenticated browsers to the IdP
//     login. Use it on full-page / navigational routes.
//   - ensureApiAuthenticated(): responds 401 JSON. Use it on /api/* routes that
//     the client calls with fetch (see guards.ts).
export { ensureAuthenticated, conditionalAuth } from 'passport-ubcshib';
export { ensureApiAuthenticated } from './guards';
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

    // We keep the whole profile in the session (see AppUser). A real app would
    // serialize only a user id and re-load the user in deserializeUser.
    passport.serializeUser<AppUser>((user, done) => done(null, user));
    passport.deserializeUser<AppUser>((user, done) => done(null, user));

    configured = true;
  }

  return {
    passport,
    sessionMiddleware: createSessionMiddleware(),
  };
}
