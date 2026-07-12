// Unit tests for role-based authorization: the pure role helpers, the example
// service, and the ensureRole() guard (via supertest, like the notes route test).
import express, { type Express } from 'express';
import request from 'supertest';
import { rolesOf, hasRole, ensureRole } from '../../server/src/components/auth';
import { buildRoleArea } from '../../server/src/services/roles.service';
import type { User } from '../../server/src/types/domain';

/** A minimal domain User fixture carrying the given affiliations. */
function user(affiliations: string[]): User {
  return {
    puid: 'PUID-0001',
    uid: 'u1',
    displayName: 'U One',
    email: 'u1@ubc.ca',
    affiliations,
    isAdmin: false,
    courseRoles: [],
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

describe('rolesOf', () => {
  it('reads affiliations directly (already lower-cased on the domain User)', () => {
    expect(rolesOf({ affiliations: ['faculty'] })).toEqual(['faculty']);
    expect(rolesOf({ affiliations: ['staff'] })).toEqual(['staff']);
    expect(rolesOf({ affiliations: [] })).toEqual([]);
    expect(rolesOf(undefined)).toEqual([]);
  });
});

describe('hasRole', () => {
  const student = user(['student']);
  it('matches any of the allowed roles', () => {
    expect(hasRole(student, 'student')).toBe(true);
    expect(hasRole(student, 'faculty', 'student')).toBe(true);
    expect(hasRole(student, 'staff')).toBe(false);
  });
});

describe('buildRoleArea', () => {
  it('returns the area payload for a role', () => {
    const area = buildRoleArea('faculty', user(['faculty']));
    expect(area.role).toBe('faculty');
    expect(area.title).toMatch(/faculty/i);
    expect(area.capabilities.length).toBeGreaterThan(0);
    expect(area.yourRoles).toEqual(['faculty']);
  });
});

function makeApp(u?: User): Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(u);
    (req as { user?: unknown }).user = u;
    next();
  });
  app.get('/faculty-only', ensureRole('faculty'), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('ensureRole guard', () => {
  it('returns 401 when signed out', async () => {
    const res = await request(makeApp(undefined)).get('/faculty-only');
    expect(res.status).toBe(401);
  });

  it('returns 403 when signed in with the wrong role', async () => {
    const res = await request(makeApp(user(['student']))).get('/faculty-only');
    expect(res.status).toBe(403);
  });

  it('passes through for the right role', async () => {
    const res = await request(makeApp(user(['faculty']))).get('/faculty-only');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
