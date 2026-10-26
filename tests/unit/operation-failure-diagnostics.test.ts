import express from 'express';
import request from 'supertest';
import { EventEmitter } from 'node:events';
jest.mock('../../server/src/components/mongodb/collections', () => ({ operationEventsCol: jest.fn() }));
jest.mock('../../server/src/services/model-usage.service', () => ({ createModelUsageTracker: () => ({ close: jest.fn(), observer: {} }) }));
jest.mock('../../server/src/components/genai/llm/model-call', () => ({ withModelCallObserver: (_observer: unknown, work: () => void) => work() }));
import { operationEventsCol } from '../../server/src/components/mongodb/collections';
import { operationAudit } from '../../server/src/middleware/operation-audit';
import { errorHandler, notFoundHandler } from '../../server/src/middleware/error-handler';
import { exceptionDiagnostics } from '../../server/src/services/exception-diagnostics';
import { recordOperation, auditHealth } from '../../server/src/services/operation-audit.service';
import type { OperationEvent } from '../../server/src/types/domain';

const records: OperationEvent[] = [];
const insertOne = jest.fn();
let warn: jest.SpyInstance, logError: jest.SpyInstance;
beforeEach(() => {
  records.length = 0;
  insertOne.mockReset().mockImplementation(async event => { records.push(event); });
  jest.mocked(operationEventsCol).mockReturnValue({ insertOne } as never);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  logError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { warn.mockRestore(); logError.mockRestore(); jest.useRealTimers(); });
function app() {
  const api = express(); api.use('/api', operationAudit); api.use(express.json({ limit: 100 }));
  api.get('/api/failure/:status', (req, res) => res.status(Number(req.params.status)).json({ error: 'private application message' }));
  api.get('/api/exception', () => { throw new TypeError('private exception message token=secret'); });
  api.get('/api/late-error', (_req, res, next) => { res.write('private partial content'); next(new Error('private late message')); });
  api.get('/api/partial', (_req, res) => res.json({ failures: [{ reason: 'private failure reason' }] }));
  api.use(notFoundHandler); api.use(errorHandler); return api;
}
it.each([[400, 'validation'], [401, 'authentication'], [403, 'authorization'], [404, 'application'], [422, 'validation'], [429, 'rate-limit'], [500, 'server-failure'], [503, 'server-failure']])('correlates HTTP %s in a structured failure log independent of database persistence', async (status, category) => {
  const result = await request(app()).get(`/api/failure/${status}`);
  expect(result.status).toBe(status);
  expect(records[0]).toMatchObject({ requestId: result.headers['x-request-id'], response: { failureCategory: category } });
  const line = warn.mock.calls.find(([tag]) => tag === '[http.operation_failed]')!;
  expect(JSON.parse(line[1])).toMatchObject({ requestId: result.headers['x-request-id'], category, statusCode: status, request: { routeMatched: true } });
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
});
it('records parser failures before authentication and retains sanitized exception code locations', async () => {
  const api = app();
  expect((await request(api).post('/api/questions').set('Content-Type', 'application/json').send('{private')).status).toBe(400);
  expect(records[0]).toMatchObject({ response: { failureCategory: 'malformed-json', exception: { category: 'malformed-json' } } });
  expect((await request(api).post('/api/questions').send({ body: 'private'.repeat(100) })).status).toBe(413);
  expect(records[1]).toMatchObject({ response: { failureCategory: 'payload-too-large' } });
  await request(api).get('/api/exception');
  expect(records[2]).toMatchObject({ response: { exception: { name: 'TypeError' } } });
  expect(JSON.stringify([warn.mock.calls, logError.mock.calls])).not.toMatch(/private|secret/);
  const exception = exceptionDiagnostics({ name: 'MongoNetworkError', code: 'ECONNREFUSED', message: 'private', stack: 'private first line\n    at work (/home/private/app/server/src/services/example.ts:10:2)\n    at other (/home/private/app/node_modules/driver/index.js:20:3)' });
  expect(exception).toEqual({ name: 'MongoNetworkError', category: 'exception', code: 'ECONNREFUSED', frames: ['server/src/services/example.ts:10:2'] });
});
it('captures partial outcomes and exceptions after headers without sending a second response', async () => {
  await request(app()).get('/api/partial');
  expect(records[0].outcome).toBe('partial');
  await expect(request(app()).get('/api/late-error')).rejects.toThrow();
  expect(records[1]).toMatchObject({ outcome: 'interrupted', statusCode: 499, response: { exception: { name: 'Error' } } });
  expect(JSON.stringify([warn.mock.calls, logError.mock.calls])).not.toContain('private');
});
it('logs a pending non-stream request once at 30 seconds and clears its timer at completion', () => {
  jest.useFakeTimers();
  const req = { originalUrl: '/api/questions', method: 'GET', get: () => undefined, params: {}, query: {} };
  const res = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, headersSent: false, writableFinished: true, setHeader: jest.fn(), getHeader: () => 'application/json', json: jest.fn() });
  operationAudit(req as never, res as never, jest.fn());
  jest.advanceTimersByTime(30000);
  expect(warn).toHaveBeenCalledWith('[http.operation_pending]', expect.any(String));
  res.emit('finish');
  expect(warn).toHaveBeenCalledWith('[http.operation_slow]', expect.any(String));
  jest.advanceTimersByTime(60000);
  expect(warn.mock.calls.filter(([tag]) => tag === '[http.operation_pending]')).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
});
it('does not classify a long-lived SSE connection as a pending request failure', () => {
  jest.useFakeTimers();
  const req = { originalUrl: '/api/events', method: 'GET', get: () => undefined, params: {}, query: {} };
  const res = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, writableFinished: false, setHeader: jest.fn(), getHeader: () => 'text/event-stream', json: jest.fn() });
  operationAudit(req as never, res as never, jest.fn()); jest.advanceTimersByTime(30000); res.emit('close');
  expect(warn).not.toHaveBeenCalled(); expect(records).toHaveLength(0);
});
it('reports database failures and queue saturation with safe correlation metadata and no response changes', async () => {
  const event = { requestId: 'fixture', createdAt: new Date(), durationMs: 1, method: 'GET', route: '/api/questions', statusCode: 404, outcome: 'failed', targets: {}, input: {}, response: { error: 'private' } } as OperationEvent;
  const before = auditHealth().failedWrites;
  insertOne.mockRejectedValueOnce(new Error('private MongoDB URI password=secret'));
  await recordOperation(event);
  const releases: Array<() => void> = [];
  insertOne.mockImplementation(() => new Promise<void>(resolve => releases.push(resolve)));
  const pending = Array.from({ length: 100 }, () => recordOperation(event));
  await recordOperation(event);
  expect(auditHealth().failedWrites).toBe(before + 2);
  expect(logError.mock.calls.map(call => JSON.parse(call[1]).reason)).toEqual(['write-failed', 'pending-write-limit']);
  expect(JSON.stringify(logError.mock.calls)).not.toMatch(/private|secret/);
  releases.forEach(release => release()); await Promise.all(pending);
  expect(auditHealth().pendingWrites).toBe(0);
});
