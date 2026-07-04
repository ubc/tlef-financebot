// Unit tests for role-based authorization: the pure role helpers, the example
// service, and the ensureRole() guard (via supertest, like the notes route test).
import express, { type Express } from 'express';
import request from 'supertest';
import { rolesOf, hasRole, ensureRole, type AppUser } from '../../server/src/components/auth';
import { buildRoleArea } from '../../server/src/services/roles.service';

describe('rolesOf', () => {
  it('reads eduPersonAffiliation as a lower-cased array', () => {
    expect(rolesOf({ nameId: 'x', attributes: { eduPersonAffiliation: ['Faculty'] } })).toEqual(['faculty']);
    expect(rolesOf({ nameId: 'x', attributes: { eduPersonAffiliation: 'staff' } })).toEqual(['staff']);
    expect(rolesOf({ nameId: 'x', attributes: {} })).toEqual([]);
    expect(rolesOf(undefined)).toEqual([]);
  });
});

describe('hasRole', () => {
  const student: AppUser = { nameId: 'x', attributes: { eduPersonAffiliation: ['student'] } };
  it('matches any of the allowed roles', () => {
    expect(hasRole(student, 'student')).toBe(true);
    expect(hasRole(student, 'faculty', 'student')).toBe(true);
    expect(hasRole(student, 'staff')).toBe(false);
  });
});

describe('buildRoleArea', () => {
  it('returns the area payload for a role', () => {
    const area = buildRoleArea('faculty', {
      nameId: 'x',
      attributes: { eduPersonAffiliation: ['faculty'] },
    });
    expect(area.role).toBe('faculty');
    expect(area.title).toMatch(/faculty/i);
    expect(area.capabilities.length).toBeGreaterThan(0);
    expect(area.yourRoles).toEqual(['faculty']);
  });
});

function makeApp(user?: AppUser): Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
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
    const student: AppUser = { nameId: 'x', attributes: { eduPersonAffiliation: ['student'] } };
    const res = await request(makeApp(student)).get('/faculty-only');
    expect(res.status).toBe(403);
  });

  it('passes through for the right role', async () => {
    const faculty: AppUser = { nameId: 'x', attributes: { eduPersonAffiliation: ['faculty'] } };
    const res = await request(makeApp(faculty)).get('/faculty-only');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
