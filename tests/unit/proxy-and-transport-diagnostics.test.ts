import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { EventEmitter } from 'node:events';
jest.mock('../../server/src/components/mongodb/collections', () => ({ operationEventsCol: jest.fn() }));
jest.mock('../../server/src/services/model-usage.service', () => ({ createModelUsageTracker: () => ({ close: jest.fn(), observer: {} }) }));
jest.mock('../../server/src/components/genai/llm/model-call', () => ({ withModelCallObserver: (_observer: unknown, work: () => void) => work() }));
jest.mock('../../server/src/config/env', () => {
  const actual = jest.requireActual('../../server/src/config/env');
  return { ...actual, env: { ...actual.env, sessionSecret: 'synthetic-proxy-diagnostics-secret-2026' } };
});
import { parseTrustedProxyCidrs } from '../../server/src/config/env';
import { operationAudit } from '../../server/src/middleware/operation-audit';
import { errorHandler, notFoundHandler } from '../../server/src/middleware/error-handler';
import { operationEventsCol } from '../../server/src/components/mongodb/collections';
import type { OperationEvent } from '../../server/src/types/domain';

const records: OperationEvent[] = [];
let warn: jest.SpyInstance, logError: jest.SpyInstance;
beforeEach(() => {
  records.length = 0;
  jest.mocked(operationEventsCol).mockReturnValue({ insertOne: async (record: OperationEvent) => { records.push(record); } } as never);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  logError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { warn.mockRestore(); logError.mockRestore(); });

it.each(['true', '1', '0.0.0.0/0', '::/0', 'proxy.example.org', '10.0.0.1/33', '::1/129', '127.0.0.1/8/2'])('refuses unsafe or malformed proxy trust %s', value => {
  expect(() => parseTrustedProxyCidrs(value)).toThrow('TRUSTED_PROXY_CIDRS');
});
it('accepts explicit addresses and preserves a conservative disable switch', () => {
  expect(parseTrustedProxyCidrs('loopback, 192.0.2.2/32, 2001:db8::1/128, loopback')).toEqual(['loopback', '192.0.2.2/32', '2001:db8::1/128']);
  expect(parseTrustedProxyCidrs('false')).toEqual([]);
});
function proxyApp(untrustedPeer = false) {
  const app = express();
  app.set('trust proxy', parseTrustedProxyCidrs('loopback'));
  if (untrustedPeer) app.use((req, _res, next) => { Object.defineProperty(req.socket, 'remoteAddress', { value: '203.0.113.5' }); next(); });
  app.use('/api', operationAudit);
  app.use(rateLimit({ windowMs: 60000, limit: 1 }));
  app.get('/api/read', (_req, res) => res.json({ ok: true }));
  app.use(notFoundHandler); app.use(errorHandler);
  return app;
}
it('resolves the nearest untrusted address and cannot evade a limit by prepending forged addresses', async () => {
  const app = proxyApp();
  expect((await request(app).get('/api/read').set('X-Forwarded-For', '198.51.100.1, 192.0.2.10')).status).toBe(200);
  expect((await request(app).get('/api/read').set('X-Forwarded-For', '198.51.100.2, 192.0.2.10')).status).toBe(429);
  expect((await request(app).get('/api/read').set('X-Forwarded-For', '198.51.100.1, 192.0.2.11')).status).toBe(200);
  expect(logError).not.toHaveBeenCalled();
  expect(records[0].request?.proxy).toEqual({ forwarded: true, trustedPeer: true });
  expect(records[0].request?.fingerprints?.client).toMatch(/^[a-f\d]{32}$/);
  expect(records[0].request?.fingerprints?.client).toBe(records[1].request?.fingerprints?.client);
  expect(records[0].request?.fingerprints?.client).not.toBe(records[2].request?.fingerprints?.client);
  expect(JSON.stringify(records)).not.toMatch(/198\.51\.100|192\.0\.2/);
});
it('ignores forged forwarding headers from an untrusted direct peer', async () => {
  const app = proxyApp(true);
  expect((await request(app).get('/api/read').set('X-Forwarded-For', '192.0.2.10')).status).toBe(200);
  expect((await request(app).get('/api/read').set('X-Forwarded-For', '192.0.2.11')).status).toBe(429);
  expect(records[0].request?.proxy).toEqual({ forwarded: true, trustedPeer: false });
  expect(records[0].request?.fingerprints?.client).toBeUndefined();
});
it('distinguishes confirmed unmatched routes from connections closed before routing', async () => {
  await request(proxyApp()).get('/api/unknown');
  expect(records[0].request?.routeState).toBe('unmatched');
  const req = { originalUrl: '/api/courses/private/materials/private/source', method: 'GET', get: (name: string) => name === 'range' ? 'bytes=0-99' : undefined, params: {}, query: {} };
  const res = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, headersSent: false, writableFinished: false, setHeader: jest.fn(), getHeader: () => undefined, json: jest.fn() });
  operationAudit(req as never, res as never, jest.fn());
  res.emit('close');
  expect(records[1]).toMatchObject({ outcome: 'interrupted', statusCode: 499, request: { routeState: 'not-evaluated', responseStarted: false, rangeRequested: true } });
});
it.each(['ECONNABORTED', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ABORT_ERR'])('keeps the 499 audit without a duplicate exception for a closed %s transfer', code => {
  const req = { aborted: true };
  const res = { destroyed: true, locals: {}, json: jest.fn(), status: jest.fn(), destroy: jest.fn() };
  errorHandler(Object.assign(new Error('private'), { code }), req as never, res as never, jest.fn());
  expect(logError).not.toHaveBeenCalled(); expect(res.json).not.toHaveBeenCalled();
});
it('continues reporting upstream resets and genuine exceptions even after a disconnect', () => {
  const res = { destroyed: false, headersSent: false, locals: {}, status: jest.fn().mockReturnThis(), json: jest.fn(), destroy: jest.fn() };
  errorHandler(Object.assign(new Error('upstream reset'), { code: 'ECONNRESET' }), { aborted: false } as never, res as never, jest.fn());
  expect(logError).toHaveBeenCalledTimes(1); expect(res.status).toHaveBeenCalledWith(500);
  errorHandler(new TypeError('private'), { aborted: true } as never, { ...res, destroyed: true } as never, jest.fn());
  expect(logError).toHaveBeenCalledTimes(2);
});
