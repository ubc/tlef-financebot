import { Router } from 'express';
import passport from 'passport';
import { env } from '../config/env';

export const authRouter = Router();

// Start login: passport redirects the browser to the IdP's SSO endpoint.
authRouter.get('/auth/ubcshib', passport.authenticate('ubcshib'));

// Assertion Consumer Service: the IdP POSTs the signed SAML response here.
// On success passport establishes the session; then we redirect into the app.
authRouter.post(
  '/auth/ubcshib/callback',
  passport.authenticate('ubcshib', { failureRedirect: '/?login=failed' }),
  (_req, res) => {
    res.redirect(env.postLoginRedirect);
  },
);

// Log out locally: clear the passport login and destroy the session. (This is
// a local logout; for IdP single-logout, use passport-ubcshib's `logout()`
// helper instead — see components/auth/AGENTS.md.)
authRouter.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) {
      next(err);
      return;
    }
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.redirect(env.postLogoutRedirect);
    });
  });
});

// Current auth state, for the client to render login/logout UI.
authRouter.get('/api/auth/me', (req, res) => {
  res.json({
    authenticated: req.isAuthenticated(),
    user: req.user ?? null,
  });
});
