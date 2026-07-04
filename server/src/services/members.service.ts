import type { AppUser } from '../components/auth';

// Members-only demo: the smallest possible "gated feature". It shows how a
// service turns the authenticated session user (req.user, shaped as AppUser)
// into a response. Pair it with the ensureApiAuthenticated() guard on its route
// (see routes/members.routes.ts) so it is only reachable when signed in. This
// is the reference example for auth-gating; keep or adapt it for your own app.

export interface MembersOverview {
  message: string;
  /** A friendly display name derived from the CWL/SAML attributes. */
  displayName: string;
  /** The IdP nameID (stable subject identifier). */
  nameId: string;
  /** The mapped SAML attributes for this user (see auth strategy ATTRIBUTES). */
  attributes: Record<string, unknown>;
  /** Server time, to make it obvious the data is generated per request. */
  serverTime: string;
}

/** Pick the first value from a SAML attribute (they arrive as string | string[]). */
function firstValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? String(value[0]) : '';
  return value == null ? '' : String(value);
}

/** Build a members-only overview from the authenticated session user. */
export function buildMembersOverview(user: AppUser): MembersOverview {
  const attrs = user.attributes;
  const displayName =
    [firstValue(attrs.givenName), firstValue(attrs.sn)].filter(Boolean).join(' ') ||
    firstValue(attrs.mail) ||
    user.nameId;

  return {
    message: `Welcome to the members-only area, ${displayName}. Only signed-in users can see this.`,
    displayName,
    nameId: user.nameId,
    attributes: attrs,
    serverTime: new Date().toISOString(),
  };
}
