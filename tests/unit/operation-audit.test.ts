import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { OperationEvent } from '../../server/src/types/domain';
jest.mock('../../server/src/components/mongodb/collections', () => ({ operationEventsCol: jest.fn() }));
import { operationEventsCol } from '../../server/src/components/mongodb/collections';
import { operationAudit } from '../../server/src/middleware/operation-audit';
import { operationContext } from '../../server/src/services/operation-context';
import { safeControls, safeDiagnostic, auditHealth, recordOperation } from '../../server/src/services/operation-audit.service';
const insertOne = jest.fn();
const records: OperationEvent[] = [];
function app() {
  const app = express();
  app.use('/api', operationAudit);
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { puid: 'teacher', uid: 'cwl', displayName: 'Teacher' } as Express.User; next(); });
  app.post('/api/courses/:courseId/generate', async (_req, res) => {
    await Promise.resolve();
    res.status(202).json({ runId: '123456789012345678901234', correlation: operationContext.getStore() });
  });
  app.post('/api/questions/:questionId', (_req, res) => res.status(422).json({ error: 'Invalid formula token=supersecret', issues: [{ path: 'body.count', message: 'Too small' }] }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/live', (_req, res) => res.type('text/event-stream').end('data: ready\n\n'));
  app.post('/api/diagnostics/client-error', (_req, res) => res.destroy());
  app.get('/api/broken', (_req, res) => res.status(503).json({ error: 'Unavailable' }));
  app.get('/api/verified', (_req, res) => res.json({ verificationError: 'Missing formula' }));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(400).json({ error: err.message }));
  return app;
}
beforeEach(() => {
  records.length = 0;
  insertOne.mockReset().mockImplementation(async (event: OperationEvent) => { records.push(event); });
  jest.mocked(operationEventsCol).mockReturnValue({ insertOne } as unknown as ReturnType<typeof operationEventsCol>);
});
it('records accepted work separately from completion, uses its own ID, and excludes private inputs', async () => {
  const supplied = randomUUID();
  const response = await request(app()).post('/api/courses/123456789012345678901234/generate').set('X-Request-ID', supplied)
    .send({ count: 2, prompt: 'private teaching content', password: 'secret', selectedKey: 'A' });
  expect(response.status).toBe(202);
  expect(response.headers['x-request-id']).not.toBe(supplied);
  expect(response.body.correlation).toBe(response.headers['x-request-id']);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ outcome: 'accepted', actor: { puid: 'teacher' }, targets: { courseId: '123456789012345678901234' }, input: { count: 2 } });
  expect(JSON.stringify(records)).not.toMatch(/private teaching|password|selectedKey/);
});
it('captures application failures and malformed JSON without allowing logging to replace responses', async () => {
  await request(app()).post('/api/questions/123456789012345678901234').send({});
  await request(app()).post('/api/questions/123456789012345678901234').set('Content-Type', 'application/json').send('{');
  await request(app()).get('/api/verified');
  expect(records.map(r => r.outcome)).toEqual(['failed', 'failed', 'partial']);
  expect(records[0].response).toMatchObject({ error: 'Invalid formula [redacted credential]' });
  expect(records[1].actor).toBeUndefined();
});
it('excludes successful health checks, keeps failures, and reports failed persistence', async () => {
  await request(app()).get('/api/health');
  await request(app()).get('/api/live');
  expect(records).toHaveLength(0);
  await request(app()).get('/api/broken');
  expect(records[0].statusCode).toBe(503);
  const before = auditHealth().failedWrites;
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  insertOne.mockRejectedValueOnce(new Error('database unavailable'));
  await recordOperation(records[0]);
  expect(auditHealth().failedWrites).toBe(before + 1);
  log.mockRestore();
});
it('redacts common credentials and URL credentials without collecting arbitrary body text', () => {
  expect(safeDiagnostic('Bearer abc.def https://user:pass@provider.test/api?key=secret')).toBe('[redacted authorization] https://provider.test/api');
  expect(safeDiagnostic('{"password":"secret with spaces", "token":"secret"}')).not.toContain('secret');
  expect(safeDiagnostic('x'.repeat(2100))).toContain('[truncated]');
  expect(safeControls({ count: 2, type: 'mcq', password: 'x', prompt: 'x', seed: Infinity, runId: { $ne: '' } })).toEqual({ count: 2, type: 'mcq' });
});
it('does not double-record the transport when a browser report is interrupted', async () => {
  await expect(request(app()).post('/api/diagnostics/client-error').send({ kind: 'runtime' })).rejects.toThrow();
  expect(records).toHaveLength(0);
});
