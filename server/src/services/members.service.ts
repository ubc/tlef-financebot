import type { User } from '../types/domain';

// Members-only demo: the smallest possible "gated feature". It shows how a
// service turns the authenticated session user (req.user, the domain User) into
// a response. Pair it with the ensureApiAuthenticated() guard on its route
// (see routes/members.routes.ts) so it is only reachable when signed in. This
// is the reference example for auth-gating; keep or adapt it for your own app.

export interface MembersOverview {
  message: string;
  /** A friendly display name (from the CWL profile). */
  displayName: string;
  /** The CWL PUID (stable subject identifier). */
  puid: string;
  /** The user's CWL affiliations (lower-cased eduPersonAffiliation values). */
  affiliations: string[];
  /** Server time, to make it obvious the data is generated per request. */
  serverTime: string;
}

/** Build a members-only overview from the authenticated session user. */
export function buildMembersOverview(user: User): MembersOverview {
  const displayName = user.displayName || user.email || user.uid;

  return {
    message: `Welcome to the members-only area, ${displayName}. Only signed-in users can see this.`,
    displayName,
    puid: user.puid,
    affiliations: user.affiliations,
    serverTime: new Date().toISOString(),
  };
}
