import express from 'express';
import request from 'supertest';
jest.mock('../../server/src/components/mongodb/collections', () => ({ operationEventsCol: jest.fn() }));
import { operationEventsCol } from '../../server/src/components/mongodb/collections';
import { clientDiagnosticsRouter } from '../../server/src/routes/client-diagnostics.routes';
import { operationAudit } from '../../server/src/middleware/operation-audit';
const insertOne = jest.fn();
function app(signedIn = true) {
  const app = express();
  app.use('/api', operationAudit);
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => signedIn) as typeof req.isAuthenticated;
    if (signedIn) req.user = { puid: 'client-reporter', uid: 'reporter', displayName: 'Reporter' } as Express.User;
    next();
  });
  app.use('/api', clientDiagnosticsRouter);
  return app;
}
beforeEach(() => {
  insertOne.mockReset().mockResolvedValue({});
  jest.mocked(operationEventsCol).mockReturnValue({ insertOne } as never);
});
it('records authenticated browser reports once, with a trusted identity and sanitized route', async () => {
  const response = await request(app()).post('/api/diagnostics/client-error').send({ kind: 'runtime', message: 'Failed token=secret', page: '#/instructor/course/PRIVATE-ID?token=secret', actor: 'spoofed' });
  expect(response.status).toBe(204);
  expect(insertOne).toHaveBeenCalledTimes(1);
  expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ requestId: response.headers['x-request-id'], method: 'CLIENT', route: '/instructor/course/:id', actor: { puid: 'client-reporter', uid: 'reporter', displayName: 'Reporter' }, response: expect.objectContaining({ error: 'Failed [redacted credential]' }) }));
});
it('rejects anonymous and oversized reports', async () => {
  expect((await request(app(false)).post('/api/diagnostics/client-error').send({})).status).toBe(401);
  expect((await request(app()).post('/api/diagnostics/client-error').send({ kind: 'runtime', page: '/', message: 'x'.repeat(2001) })).status).toBe(400);
  expect(insertOne.mock.calls.every(([event]) => event.method !== 'CLIENT')).toBe(true);
});
