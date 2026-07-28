import express, { type Express } from 'express';
import request from 'supertest';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/admin.service', () => ({
  grantPlatformInstructor: jest.fn(),
  listPlatformInstructors: jest.fn(),
  revokePlatformInstructor: jest.fn(),
}));

import { adminRouter } from '../../server/src/routes/admin.routes';
import {
  grantPlatformInstructor,
  listPlatformInstructors,
  revokePlatformInstructor,
} from '../../server/src/services/admin.service';

function userFixture(isAdmin: boolean): User {
  return {
    puid: isAdmin ? 'PUID-ADMIN-0001' : 'PUID-STUDENT-0001',
    uid: isAdmin ? 'admin1' : 'student1',
    displayName: isAdmin ? 'Admin One' : 'Student One',
    email: isAdmin ? 'admin1@example.ubc.ca' : 'student1@example.ubc.ca',
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

describe('Admin platform-Instructor routes', () => {
  beforeEach(() => {
    jest.mocked(grantPlatformInstructor).mockReset();
    jest.mocked(listPlatformInstructors).mockReset();
    jest.mocked(revokePlatformInstructor).mockReset();
  });

  it('returns 401 signed out and 403 for a signed-in non-Admin', async () => {
    expect((await request(makeApp()).get('/api/admin/platform-instructors')).status).toBe(401);
    expect((await request(makeApp(userFixture(false))).get('/api/admin/platform-instructors')).status).toBe(403);
    expect(listPlatformInstructors).not.toHaveBeenCalled();
  });

  it('lists grants for an Admin with the validated query', async () => {
    jest.mocked(listPlatformInstructors).mockResolvedValue([
      {
        uid: 'financeprof',
        status: 'pending',
        grantedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        grantedByPuid: 'PUID-ADMIN-0001',
      },
    ]);

    const res = await request(makeApp(userFixture(true)))
      .get('/api/admin/platform-instructors')
      .query({ query: 'finance' });

    expect(res.status).toBe(200);
    expect(listPlatformInstructors).toHaveBeenCalledWith('finance');
    expect(res.body).toEqual([expect.objectContaining({ uid: 'financeprof', status: 'pending' })]);
  });

  it('grants and revokes by CWL username as the session Admin', async () => {
    jest.mocked(grantPlatformInstructor).mockResolvedValue({
      uid: 'financeprof',
      status: 'pending',
      grantedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      grantedByPuid: 'PUID-ADMIN-0001',
    });
    jest.mocked(revokePlatformInstructor).mockResolvedValue({
      uid: 'financeprof',
      granted: false,
      revoked: true,
    });
    const app = makeApp(userFixture(true));

    const grantRes = await request(app).put('/api/admin/platform-instructors/FinanceProf');
    const revokeRes = await request(app).delete('/api/admin/platform-instructors/FinanceProf');

    expect(grantRes.status).toBe(200);
    expect(revokeRes.status).toBe(200);
    expect(grantPlatformInstructor).toHaveBeenCalledWith('FinanceProf', 'PUID-ADMIN-0001');
    expect(revokePlatformInstructor).toHaveBeenCalledWith('FinanceProf', 'PUID-ADMIN-0001');
  });

  it('rejects malformed CWL usernames before calling the service', async () => {
    const res = await request(makeApp(userFixture(true)))
      .put('/api/admin/platform-instructors/not%20a%20cwl');

    expect(res.status).toBe(400);
    expect(grantPlatformInstructor).not.toHaveBeenCalled();
  });
});
