import { Router } from 'express';
import { ensureApiAuthenticated } from '../components/auth';
import { buildMembersOverview } from '../services/members.service';

// EXAMPLE (auth-gating reference) — keep or adapt for your own protected area.
// This is the minimal shape of a gated feature: an endpoint that only signed-in
// users can reach. The ensureApiAuthenticated() guard (from components/auth)
// answers unauthenticated callers with 401 JSON instead of redirecting them to
// the IdP, which is what a fetch()-based client wants. See the "Protecting
// routes" section of components/auth/AGENTS.md.
export const membersRouter = Router();

// The guard is applied per route (below). NOTE: do NOT use
// `membersRouter.use(ensureApiAuthenticated())` here — this router is mounted at
// the shared `/api` prefix, and router-level middleware runs for EVERY `/api/*`
// request that reaches the router (even ones with no matching route in it),
// which would 401 unrelated public endpoints like `/api/auth/me`. Guarding each
// route keeps the gate scoped to that route.

/** GET /api/members/overview -> a members-only summary of the signed-in user. Auth-gated. */
membersRouter.get('/members/overview', ensureApiAuthenticated(), (req, res) => {
  // req.user is the session AppUser (typed via server/src/types/express.d.ts).
  // The guard guarantees it is present here, so the non-null assertion is safe.
  res.json(buildMembersOverview(req.user!));
});
