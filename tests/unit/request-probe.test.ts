import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
jest.mock('../../server/src/components/mongodb/collections', () => ({ operationEventsCol: jest.fn() }));
jest.mock('../../server/src/services/model-usage.service', () => ({ createModelUsageTracker: () => ({ close: jest.fn(), observer: {} }) }));
jest.mock('../../server/src/config/env', () => ({ env: { sessionSecret: 'synthetic-fingerprint-secret-for-unit-tests' } }));
jest.mock('../../server/src/components/genai/llm/model-call', () => ({ withModelCallObserver: (_observer: unknown, work: () => void) => work() }));
import { operationEventsCol } from '../../server/src/components/mongodb/collections';
import { classifyProbe, retainedProbe, withRetainedProbe } from '../../server/src/services/request-probe.service';
import { requestDiagnostics, requestFingerprints } from '../../server/src/services/request-diagnostics';
import { rejectApiProbe } from '../../server/src/middleware/reject-api-probe';
import { operationAudit } from '../../server/src/middleware/operation-audit';
import { notFoundHandler, errorHandler } from '../../server/src/middleware/error-handler';
import type { OperationEvent } from '../../server/src/types/domain';

it.each([
  ['/api/.git/config', 'git-metadata'], ['/api/%2Egit/HEAD', 'git-metadata'],
  ['/api/.env.production?token=private', 'environment-file'],
  ['/api/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php', 'phpunit'],
  ['/api/wordpress', undefined], ['/api/wp-login.php', 'wordpress'],
  ['/api/phpmyadmin/index.php', 'phpmyadmin'], ['/api/_ignition/execute-solution', 'laravel-debug'],
  ['/api/config', undefined], ['/api/login', undefined], ['/api/courses/private/materials/.env', undefined],
  ['/api/.environment', undefined], ['/api/%ZZ', undefined],
])('classifies only fixed probe signatures on %s', (path, kind) => {
  expect(classifyProbe(path)?.kind).toBe(kind);
});

it('recognizes the retained PHPUnit hash without fabricating identity or classifying other 404s', () => {
  const event = { route: '/unmatched', statusCode: 404, request: { ...requestDiagnostics('/api/unknown', undefined, undefined),
    pathHash: '881848a4c72d099d04c6544b5447a9ea614ebaa52d61ad046f29b585bd9e7ccf', routeMatched: false } };
  const original = structuredClone(event);
  expect(withRetainedProbe(event).request?.probe).toEqual({ kind: 'phpunit', evidence: 'retained-path-hash' });
  expect(event).toEqual(original);
  expect(withRetainedProbe(event).request?.loginState).toBeUndefined();
  expect(retainedProbe({ ...event, route: '/questions/:id' })).toBeUndefined();
  expect(retainedProbe({ ...event, statusCode: 500 })).toBeUndefined();
  expect(retainedProbe({ ...event, request: undefined })).toBeUndefined();
  expect(retainedProbe({ ...event, request: { ...event.request, pathHash: createHash('sha256').update('/api/private').digest('hex') } })).toBeUndefined();
});

it('rotates keyed groups daily, separates their domains, and retains no address or header', () => {
  const key = 'synthetic-fingerprint-secret-for-unit-tests';
  const date = new Date('2026-10-28T07:00:00Z');
  const result = requestFingerprints('203.0.113.10', 'private-agent', date, key)!;
  expect(requestFingerprints('203.0.113.10', 'private-agent', date, key)).toEqual(result);
  expect(result.day).toBe('2026-10-28');
  expect(result.peer).toMatch(/^[a-f\d]{32}$/);
  expect(requestFingerprints('203.0.113.10', 'private-agent', new Date('2026-10-29'), key)?.peer).not.toBe(result.peer);
  expect(requestFingerprints('203.0.113.11', 'private-agent', date, key)?.peer).not.toBe(result.peer);
  expect(requestFingerprints('203.0.113.11', 'private-agent', date, key)?.agent).toBe(result.agent);
  expect(requestFingerprints('same', 'same', date, key)?.peer).not.toBe(requestFingerprints('same', 'same', date, key)?.agent);
  expect(JSON.stringify(result)).not.toMatch(/203\.0\.113|private-agent|synthetic-fingerprint/);
  expect(requestFingerprints('203.0.113.10', 'private-agent', date, 'dev-insecure-secret-change-me')).toBeUndefined();
});

it('rejects a probe with malformed JSON before parsing or session reads and still records the failure', async () => {
  const records: OperationEvent[] = [];
  jest.mocked(operationEventsCol).mockReturnValue({ insertOne: async (event: OperationEvent) => { records.push(event); } } as never);
  const sessions = jest.fn();
  let peer: string | undefined;
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const api = express();
  api.use((req, _res, next) => { peer = req.socket.remoteAddress; next(); });
  api.use('/api', operationAudit);
  api.use('/api', rejectApiProbe);
  api.use(express.json());
  api.use((req, _res, next) => { sessions(); req.isAuthenticated = (() => false) as typeof req.isAuthenticated; next(); });
  api.get('/api/questions/:id', (_req, res) => res.status(404).json({ error: 'Question not found' }));
  api.use(notFoundHandler); api.use(errorHandler);
  try {
    const result = await request(api).post('/api/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php')
      .set('Content-Type', 'application/json').set('X-Financebot-Client', 'web-v1')
      .set('X-Forwarded-For', 'private-forged-address').set('Cookie', 'private-cookie').send('{private malformed body');
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Not Found' });
    expect(sessions).not.toHaveBeenCalled();
    expect(records[0]).toMatchObject({ route: '/unmatched', statusCode: 404, actor: undefined,
      request: { loginState: 'not-evaluated', webClient: true, probe: { kind: 'phpunit' } }, response: { failureCategory: 'probe-rejected' } });
    expect(records[0].request?.fingerprints?.peer).toBe(requestFingerprints(peer, undefined, records[0].createdAt, 'synthetic-fingerprint-secret-for-unit-tests')?.peer);
    expect(records[0].request?.fingerprints?.peer).not.toBe(requestFingerprints('private-forged-address', undefined, records[0].createdAt, 'synthetic-fingerprint-secret-for-unit-tests')?.peer);
    expect(JSON.stringify([records, warn.mock.calls])).not.toContain('private');
    await request(api).get('/api/questions/123456789012345678901234');
    expect(sessions).toHaveBeenCalledTimes(1);
    expect(records[1]).toMatchObject({ route: '/api/questions/:id', request: { loginState: 'unauthenticated', webClient: false } });
    expect(records[1].request?.probe).toBeUndefined();
    await request(api).post('/api/courses').set('Content-Type', 'application/json').send('{');
    expect(records[2]).toMatchObject({ statusCode: 400, request: { loginState: 'not-evaluated' } });
  } finally { warn.mockRestore(); error.mockRestore(); }
});
