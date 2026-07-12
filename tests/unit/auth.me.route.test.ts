import express, { type Express } from 'express';
import request from 'supertest';
import { authRouter } from '../../server/src/routes/auth.routes';

function makeApp(user?: object): Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as { isAuthenticated?: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use(authRouter);
  return app;
}

describe('GET /api/auth/me', () => {
  it('returns authenticated: false when signed out', async () => {
    const res = await request(makeApp()).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it('returns the identity summary when signed in', async () => {
    const res = await request(
      makeApp({ puid: 'P1', uid: 'u1', displayName: 'U One', isAdmin: false, affiliations: ['faculty'], courseRoles: [], email: 'x@y' }),
    ).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toEqual({
      puid: 'P1', uid: 'u1', displayName: 'U One', isAdmin: false, affiliations: ['faculty'], courseRoles: [],
    });
  });
});
