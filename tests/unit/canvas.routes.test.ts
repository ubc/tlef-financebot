import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { canvasRouter } from '../../server/src/routes/canvas.routes';
import { saveCanvasLink, syncCanvasLink } from '../../server/src/services/canvas.service';
import { tokenStore } from '../../server/src/components/canvas';

jest.mock('../../server/src/config/env', () => ({ env: { canvasDomain: 'https://canvas.test', canvasRedirectUri: 'https://finance.test/api/canvas/callback' } }));
jest.mock('../../server/src/components/auth', () => ({ ensureApiAuthenticated: () => (req: express.Request, res: express.Response, next: express.NextFunction) => req.user ? next() : res.sendStatus(401) }));
jest.mock('../../server/src/components/canvas', () => ({ canvasEnabled: () => true, canvasConfig: () => ({}), CANVAS_SCOPES: [],
  canvas: { buildAuthorizeUrl: jest.fn(() => 'https://canvas.test/login/oauth2/auth'), exchangeCodeForTokens: jest.fn() }, tokenStore: { get: jest.fn().mockResolvedValue(null), set: jest.fn() } }));
jest.mock('../../server/src/services/canvas.service', () => {
  class CanvasError extends Error { constructor(message: string, public status = 400) { super(message); } }
  return { CanvasError, listCanvasCourses: jest.fn().mockResolvedValue([]), canvasLinkStatus: jest.fn().mockResolvedValue(null), saveCanvasLink: jest.fn(), syncCanvasLink: jest.fn(), unlinkCanvas: jest.fn(), disconnectCanvas: jest.fn(), listCanvasFiles: jest.fn(), importCanvasFile: jest.fn() };
});
const id = new ObjectId();
function app(role: 'instructor' | 'student' | 'none' = 'instructor') {
  const instance = express(); instance.use(express.json());
  instance.use((req, _res, next) => {
    req.isAuthenticated = (() => role !== 'none') as typeof req.isAuthenticated;
    if (role !== 'none') req.user = { puid: 'actor', isAdmin: false, courseRoles: [{ courseId: id, role }] } as Express.User;
    req.session = { save: (done: () => void) => done() } as unknown as typeof req.session;
    next();
  });
  instance.use('/api', canvasRouter); return instance;
}
beforeEach(() => jest.clearAllMocks());
test('unauthenticated connection status is rejected', async () => {
  expect((await request(app('none')).get('/api/canvas/status')).status).toBe(401);
});
test('student cannot initiate teacher OAuth or read roster', async () => {
  expect((await request(app('student')).post('/api/canvas/connect').set('Origin', 'https://finance.test').send({})).status).toBe(403);
  expect((await request(app('student')).get(`/api/courses/${id}/canvas`)).status).toBe(403);
});
test('course instructor cannot access another course', async () => {
  expect((await request(app()).get(`/api/courses/${new ObjectId()}/canvas`)).status).toBe(403);
});
test('same-origin mutation accepts multiple sources and delegates authorization to service', async () => {
  const body = { sourceIds: ['101', '102'], revision: null, autoEnroll: true };
  expect((await request(app()).put(`/api/courses/${id}/canvas`).set('Origin', 'https://finance.test').send(body)).status).toBe(204);
  expect(saveCanvasLink).toHaveBeenCalledWith(id, 'actor', ['101', '102'], null, true);
});
test('cross-origin mutation rejected before sync', async () => {
  expect((await request(app()).post(`/api/courses/${id}/canvas/sync`).set('Origin', 'https://attacker.test').send({})).status).toBe(403);
  expect(syncCanvasLink).not.toHaveBeenCalled();
});
test('invalid state never exchanges or stores tokens', async () => {
  expect((await request(app()).get('/api/canvas/callback?code=test&state=bad')).status).toBe(400);
  expect(tokenStore.set).not.toHaveBeenCalled();
});
