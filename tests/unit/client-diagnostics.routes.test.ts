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
it('retains an unverified reported status and server-request link with a sanitized endpoint', async () => {
  const relatedRequestId = '550e8400-e29b-41d4-a716-446655440000';
  const result = await request(app()).post('/api/diagnostics/client-error').send({ kind: 'http', message: 'An API request returned HTTP 502.', page: '/admin/operations',
    request: { endpoint: '/api/questions/private-identity?token=secret', statusCode: 502, relatedRequestId } });
  expect(result.status).toBe(204);
  expect(insertOne).toHaveBeenCalledTimes(1);
  expect(insertOne.mock.calls[0][0]).toMatchObject({ method: 'CLIENT', response: { reportedBy: 'browser', reportedStatusCode: 502, relatedRequestId, reportedRequest: { path: '/api/questions/:redacted' } } });
  expect(JSON.stringify(insertOne.mock.calls)).not.toMatch(/private-identity|secret/);
});
it.each([{ endpoint: 'https://external.test/private' }, { endpoint: '/api/questions', relatedRequestId: 'not-a-uuid' }, { endpoint: '/api/questions', statusCode: 999 }])('rejects malformed request report context %j', async context => {
  const result = await request(app()).post('/api/diagnostics/client-error').send({ kind: 'http', message: 'Unavailable', page: '/', request: context });
  expect(result.status).toBe(400);
  expect(insertOne.mock.calls.every(([event]) => event.method !== 'CLIENT')).toBe(true);
});
