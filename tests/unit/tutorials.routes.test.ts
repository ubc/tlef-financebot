import express, { type Express } from 'express';
import request from 'supertest';

jest.mock('../../server/src/services/tutorials.service', () => ({
  listTutorials: jest.fn(),
  resetTutorialProgress: jest.fn(),
  saveTutorialProgress: jest.fn(),
}));

import { tutorialsRouter } from '../../server/src/routes/tutorials.routes';
import {
  listTutorials,
  resetTutorialProgress,
  saveTutorialProgress,
} from '../../server/src/services/tutorials.service';

const TEST_PUID = 'PUID-STUDENT-1';

function makeApp(authenticated: boolean, isAdmin = false): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => authenticated;
    (req as { user?: unknown }).user = authenticated ? { puid: TEST_PUID, isAdmin } : undefined;
    next();
  });
  app.use('/api', tutorialsRouter);
  return app;
}

describe('tutorial routes', () => {
  it('requires authentication', async () => {
    const response = await request(makeApp(false)).get('/api/tutorials?role=student');
    expect(response.status).toBe(401);
    expect(listTutorials).not.toHaveBeenCalled();
  });

  it('lists only the authenticated user tutorial state', async () => {
    jest.mocked(listTutorials).mockResolvedValue([]);
    const response = await request(makeApp(true))
      .get('/api/tutorials?role=student&puid=PUID-OTHER');

    expect(response.status).toBe(200);
    expect(listTutorials).toHaveBeenCalledWith(TEST_PUID, 'student');
  });

  it('records completion using the session identity', async () => {
    jest.mocked(saveTutorialProgress).mockResolvedValue({
      puid: TEST_PUID,
      role: 'student',
      tutorialId: 'student-welcome',
      version: 1,
      status: 'completed',
      updatedAt: new Date(),
    });
    const response = await request(makeApp(true))
      .put('/api/tutorials/student-welcome')
      .send({ role: 'student', status: 'completed', puid: 'PUID-OTHER' });

    expect(response.status).toBe(200);
    expect(saveTutorialProgress).toHaveBeenCalledWith(
      TEST_PUID,
      'student',
      'student-welcome',
      'completed',
    );
  });

  it('rejects unsupported roles and statuses', async () => {
    const roleResponse = await request(makeApp(true)).get('/api/tutorials?role=unknown');
    const statusResponse = await request(makeApp(true))
      .put('/api/tutorials/student-welcome')
      .send({ role: 'student', status: 'started' });

    expect(roleResponse.status).toBe(400);
    expect(statusResponse.status).toBe(400);
  });

  it('resets only the authenticated user and selected role', async () => {
    jest.mocked(resetTutorialProgress).mockResolvedValue(3);
    const response = await request(makeApp(true)).delete('/api/tutorials?role=student');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 3 });
    expect(resetTutorialProgress).toHaveBeenCalledWith(TEST_PUID, 'student');
  });

  it('normalizes an unknown tutorial to 404', async () => {
    jest.mocked(saveTutorialProgress).mockRejectedValue(new Error('tutorial-not-found'));
    const response = await request(makeApp(true))
      .put('/api/tutorials/student-unknown')
      .send({ role: 'student', status: 'completed' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'tutorial-not-found' });
  });
});

for (const method of ['get', 'delete', 'put'] as const) {
  it(`restricts ${method} Admin tutorial state to real Admins`, async () => {
    const url = method === 'put' ? '/api/tutorials/admin-accounts' : '/api/tutorials?role=admin';
    const response = await request(makeApp(true))[method](url).send({ role: 'admin', status: 'completed' });
    expect(response.status).toBe(403);
  });
}
it('accepts an Admin catalogue request with session-owned identity', async () => {
  jest.mocked(listTutorials).mockResolvedValue([]);
  const response = await request(makeApp(true, true)).get('/api/tutorials?role=admin&puid=OTHER');
  expect(response.status).toBe(200);
  expect(listTutorials).toHaveBeenCalledWith(TEST_PUID, 'admin');
});
