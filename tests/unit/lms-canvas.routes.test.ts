// lmsCanvasRouter via supertest, mirroring courses.routes.test.ts's makeApp.
// The package and components/lms are mocked: no Canvas, no Mongo.
import express, { Router, type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

const tokenStore = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
let requireAuthConnected = true;

jest.mock('@ubc/ubc-genai-toolkit-lms-integration', () => {
  class LmsError extends Error {}
  class CanvasApiError extends LmsError {
    constructor(message: string, public readonly statusCode: number) { super(message); }
  }
  class CanvasGradeExportError extends LmsError {
    constructor(message: string, public readonly reason: string) { super(message); }
  }
  return {
    LmsError,
    canvas: {
      CanvasApiError,
      CanvasGradeExportError,
      createAuthRouter: () => {
        const r = Router();
        r.get('/login', (_req, res) => res.status(302).set('Location', 'https://canvas.test/oauth').end());
        return r;
      },
      requireAuth: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (!requireAuthConnected) {
          res.status(401).json({ success: false, connected: false, connectUrl: '/api/lms/canvas/auth/login' });
          return;
        }
        req.canvasApi = {} as never;
        next();
      },
    },
  };
});
jest.mock('../../server/src/components/lms', () => ({
  getCanvasConfig: () => ({ tokenStore, basePath: '/api/lms/canvas/auth' }),
  isCanvasConfigured: () => true,
}));

import { createLmsCanvasRouter } from '../../server/src/routes/lms-canvas.routes';

const courseId = new ObjectId();

function userFixture(courseRoles: User['courseRoles'], isAdmin = false): User {
  return {
    puid: 'PUID-INSTR-0001',
    uid: 'instr1',
    displayName: 'Instructor One',
    email: 'instr1@example.ubc.ca',
    affiliations: ['faculty'],
    isAdmin,
    courseRoles,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}
const instructor = userFixture([{ courseId, role: 'instructor' }]);

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', createLmsCanvasRouter());
  return app;
}

beforeEach(() => {
  tokenStore.get.mockReset();
  requireAuthConnected = true;
});

describe('GET /api/lms/canvas/status', () => {
  it('401s a signed-out caller', async () => {
    const res = await request(makeApp(undefined)).get('/api/lms/canvas/status');
    expect(res.status).toBe(401);
  });

  it('reports connected: false when no token is stored — 200, not 401', async () => {
    tokenStore.get.mockResolvedValue(null);
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
    expect(tokenStore.get).toHaveBeenCalledWith('PUID-INSTR-0001');
  });

  it('reports connected: true when a token is stored', async () => {
    tokenStore.get.mockResolvedValue({ accessToken: 'x', refreshToken: 'y', expiresAt: 1, canvasUserId: '5' });
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/status');
    expect(res.body).toEqual({ connected: true });
  });
});

describe('auth router mount', () => {
  it('401s a signed-out caller before the package router runs', async () => {
    const res = await request(makeApp(undefined)).get('/api/lms/canvas/auth/login');
    expect(res.status).toBe(401);
  });

  it('lets a signed-in caller reach the package login route', async () => {
    const res = await request(makeApp(instructor)).get('/api/lms/canvas/auth/login');
    expect(res.status).toBe(302);
  });
});
