// Client-side auth state. The server is the source of truth (GET /api/auth/me);
// this module caches the last known session and derives a display name. The UI
// uses it to choose between the landing screen and the app shell, and to gate
// nav. Real enforcement is server-side (ensureApiAuthenticated); hiding UI is
// only UX. See server/src/components/auth/AGENTS.md.
import { getAuthState, type AuthState, type AuthUser } from './api.js';

export type Session = AuthState;

let current: Session = { authenticated: false, user: null, roles: [] };

/** Fetch the session from the server and cache it. Never throws. */
export async function loadSession(): Promise<Session> {
  try {
    current = await getAuthState();
  } catch {
    current = { authenticated: false, user: null, roles: [] };
  }
  return current;
}

/** The last loaded session (call loadSession first). */
export function getSession(): Session {
  return current;
}

/** A friendly name for the signed-in user (server-computed), with fallbacks. */
export function displayName(user: AuthUser): string {
  return user.displayName || user.uid || user.puid;
}
