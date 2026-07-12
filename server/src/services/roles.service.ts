import { rolesOf } from '../components/auth';
import type { User } from '../types/domain';

// EXAMPLE (role-based authorization reference). Turns the signed-in user into a
// role-specific "area" payload. Pair it with the ensureRole() guard on its route
// (see routes/roles.routes.ts) so each area is only reachable by that role. Keep
// or adapt for your own role-specific features.

export interface RoleArea {
  role: string;
  title: string;
  blurb: string;
  /** Illustrative things this role can do (placeholder content). */
  capabilities: string[];
  /** The signed-in user's actual role(s), for display. */
  yourRoles: string[];
  serverTime: string;
}

// The three roles the local IdP issues via eduPersonAffiliation. Add rows here
// (and a matching nav item in the client's config.ts) for more roles.
const AREAS: Record<string, { title: string; blurb: string; capabilities: string[] }> = {
  faculty: {
    title: 'Faculty area',
    blurb: 'Tools for instructors — only users with the faculty affiliation see this.',
    capabilities: ['Create and publish course material', 'Review student submissions', 'Configure a course space'],
  },
  student: {
    title: 'Student area',
    blurb: 'Your learning space — only users with the student affiliation see this.',
    capabilities: ['See your enrolled courses', 'Submit work and track progress', 'Ask questions of the course assistant'],
  },
  staff: {
    title: 'Staff area',
    blurb: 'Operational tools — only users with the staff affiliation see this.',
    capabilities: ['Manage accounts and access', 'Review usage and reports', 'Handle support requests'],
  },
};

/** The roles that have an area (used to register one gated route each). */
export const ROLE_AREAS = Object.keys(AREAS);

/** Build the area payload for `role` from the signed-in user. */
export function buildRoleArea(role: string, user: User): RoleArea {
  const info = AREAS[role];
  if (!info) {
    throw Object.assign(new Error(`Unknown role area: ${role}`), { status: 404 });
  }
  return {
    role,
    title: info.title,
    blurb: info.blurb,
    capabilities: info.capabilities,
    yourRoles: rolesOf(user),
    serverTime: new Date().toISOString(),
  };
}
