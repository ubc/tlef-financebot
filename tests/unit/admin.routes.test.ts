import express, { type Express } from 'express';
import request from 'supertest';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/admin.service', () => ({
  grantPlatformInstructor: jest.fn(),
  listAdminAccounts: jest.fn(),
  revokePlatformInstructor: jest.fn(),
}));

import { adminRouter } from '../../server/src/routes/admin.routes';
import {
  grantPlatformInstructor,
  listAdminAccounts,
  revokePlatformInstructor,
} from '../../server/src/services/admin.service';

function userFixture(isAdmin: boolean): User {
  return {
    puid: isAdmin ? 'ESI5CZY7J307' : 'ESISTUDENT001',
    uid: '',
    displayName: isAdmin ? 'Stephen' : 'Student One',
    email: '',
    affiliations: isAdmin ? ['staff'] : ['student'],
    isAdmin,
    courseRoles: [],
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', adminRouter);
  return app;
}

describe('Admin user-account routes', () => {
  beforeEach(() => {
    jest.mocked(grantPlatformInstructor).mockReset();
    jest.mocked(listAdminAccounts).mockReset();
    jest.mocked(revokePlatformInstructor).mockReset();
  });

  it('returns 401 signed out and 403 for students and platform Instructors', async () => {
    const platformInstructor = {
      ...userFixture(false),
      platformInstructor: true,
    };

    expect((await request(makeApp()).get('/api/admin/users')).status).toBe(401);
    expect((await request(makeApp(userFixture(false))).get('/api/admin/users')).status).toBe(403);
    expect((await request(makeApp(platformInstructor)).get('/api/admin/users')).status).toBe(403);
    expect(listAdminAccounts).not.toHaveBeenCalled();
  });

  it('lists all matching users for an Admin', async () => {
    jest.mocked(listAdminAccounts).mockResolvedValue([
      {
        puid: 'ESIPROF00001',
        uid: '',
        displayName: 'Finance Professor',
        email: '',
        affiliations: ['faculty'],
        isAdmin: false,
        platformInstructor: false,
        status: 'active',
      },
    ]);

    const res = await request(makeApp(userFixture(true)))
      .get('/api/admin/users')
      .query({ query: 'finance' });

    expect(res.status).toBe(200);
    expect(listAdminAccounts).toHaveBeenCalledWith('finance');
    expect(res.body).toEqual([
      expect.objectContaining({ puid: 'ESIPROF00001', displayName: 'Finance Professor' }),
    ]);
  });

  it('grants and revokes by PUID as the session Admin', async () => {
    jest.mocked(grantPlatformInstructor).mockResolvedValue({
      puid: 'ESIPROF00001',
      uid: '',
      displayName: 'ESIPROF00001',
      email: '',
      affiliations: [],
      isAdmin: false,
      platformInstructor: true,
      status: 'pending',
    });
    jest.mocked(revokePlatformInstructor).mockResolvedValue({
      puid: 'ESIPROF00001',
      granted: false,
      revoked: true,
    });
    const app = makeApp(userFixture(true));

    const grantRes = await request(app).put('/api/admin/platform-instructors/ESIPROF00001');
    const revokeRes = await request(app).delete('/api/admin/platform-instructors/ESIPROF00001');

    expect(grantRes.status).toBe(200);
    expect(revokeRes.status).toBe(200);
    expect(grantPlatformInstructor).toHaveBeenCalledWith('ESIPROF00001', 'ESI5CZY7J307');
    expect(revokePlatformInstructor).toHaveBeenCalledWith('ESIPROF00001', 'ESI5CZY7J307');
  });

  it('rejects malformed PUIDs before calling the service', async () => {
    const res = await request(makeApp(userFixture(true)))
      .put('/api/admin/platform-instructors/not%20a%20puid');

    expect(res.status).toBe(400);
    expect(grantPlatformInstructor).not.toHaveBeenCalled();
  });
});
