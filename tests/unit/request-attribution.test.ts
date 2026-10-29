import express from 'express';
import session from 'express-session';
import passport from 'passport';
import http from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import request from 'supertest';
jest.mock('../../server/src/components/mongodb/collections', () => ({ operationEventsCol: jest.fn() }));
jest.mock('../../server/src/services/model-usage.service', () => ({ createModelUsageTracker: () => ({ close: jest.fn(), observer: {} }) }));
jest.mock('../../server/src/components/genai/llm/model-call', () => ({ withModelCallObserver: (_observer: unknown, work: () => void) => work() }));
jest.mock('../../server/src/config/env', () => ({ env: { sessionSecret: 'synthetic-session-secret-for-source-tests' } }));
import { operationEventsCol } from '../../server/src/components/mongodb/collections';
import { operationAudit } from '../../server/src/middleware/operation-audit';
import { traceAuthentication, startRequestIdentity, awaitRequestIdentity } from '../../server/src/middleware/request-identity';
import { notFoundHandler, errorHandler } from '../../server/src/middleware/error-handler';
import { requestSession, requestSource } from '../../server/src/services/request-diagnostics';
import { requestFailureAnalysis } from '../../server/src/services/request-failure-analysis';
import type { OperationEvent } from '../../server/src/types/domain';

const secret = 'synthetic-session-secret-for-source-tests';
const records: OperationEvent[] = [];
let warn: jest.SpyInstance, logError: jest.SpyInstance;
beforeEach(() => {
  records.length = 0;
  jest.mocked(operationEventsCol).mockReturnValue({ insertOne: async (event: OperationEvent) => { records.push(event); } } as never);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  logError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { warn.mockRestore(); logError.mockRestore(); jest.useRealTimers(); });

function fixture(onRead?: () => void, failUserLookup = false) {
  const store = new session.MemoryStore();
  const auth = new passport.Authenticator();
  auth.serializeUser((user, done) => done(null, (user as Express.User).puid));
  auth.deserializeUser((puid: string, done) => setTimeout(() => failUserLookup ? done(new Error('Identity lookup unavailable')) : done(null, { puid, uid: puid, displayName: 'Synthetic Teacher' } as Express.User), 60));
  const app = express(); app.use('/api', operationAudit); app.use(express.json());
  app.use((req, _res, next) => { if (req.path === '/api/read') onRead?.(); next(); });
  app.use(traceAuthentication('session-loading', session({ secret, store, resave: false, saveUninitialized: false })));
  app.use(auth.initialize()); app.use(traceAuthentication('user-loading', auth.session()));
  app.post('/api/test-login', (req, res, next) => req.login({ puid: typeof req.query.puid === 'string' ? req.query.puid : 'SYNTHETIC-TEACHER' } as Express.User, error => error ? next(error) : res.json({ ok: true })));
  app.get('/api/read', (req, res) => req.isAuthenticated() ? res.json({ ok: true }) : res.status(401).json({ error: 'Authentication required.' }));
  app.use(notFoundHandler); app.use(errorHandler);
  return { app, store };
}

it('retains verified identity after a real client closes before account lookup finishes', async () => {
  let arrived!: () => void;
  const readStarted = new Promise<void>(resolve => { arrived = resolve; });
  const { app } = fixture(arrived);
  const login = await request(app).post('/api/test-login');
  const credential = login.headers['set-cookie'][0].split(';')[0];
  records.length = 0;
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const port = (server.address() as { port: number }).port;
    let inserted!: () => void;
    const saved = new Promise<void>(resolve => { inserted = resolve; });
    jest.mocked(operationEventsCol).mockReturnValue({ insertOne: async (event: OperationEvent) => { records.push(event); inserted(); } } as never);
    const client = http.get({ hostname: '127.0.0.1', port, path: '/api/read', headers: { Cookie: credential } });
    client.on('error', () => undefined);
    await readStarted;
    client.destroy();
    await saved;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ outcome: 'interrupted', statusCode: 499, actor: { puid: 'SYNTHETIC-TEACHER' },
      request: { loginState: 'authenticated', identity: { stage: 'complete', stageAtEnd: 'user-loading', wait: 'resolved', sessionAccountPuid: 'SYNTHETIC-TEACHER', sessionLookup: 'restored' } },
      response: { failurePhase: 'user-load', failureReason: 'connection-closed-before-identity' } });
    expect(records[0].durationMs).toBeLessThan(Date.now() - records[0].createdAt.getTime());
    expect(JSON.stringify([records, warn.mock.calls])).not.toContain(credential);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('distinguishes missing credentials, rejected signatures and unrestored signed sessions', async () => {
  const { app, store } = fixture();
  await request(app).get('/api/read');
  expect(records.at(-1)?.response.failureReason).toBe('session-credential-absent');
  await request(app).get('/api/read').set('Cookie', 'connect.sid=s%3Aforged.invalid');
  expect(records.at(-1)?.response.failureReason).toBe('session-signature-invalid');
  const login = await request(app).post('/api/test-login');
  const credential = login.headers['set-cookie'][0].split(';')[0];
  await request(app).get('/api/read').set('Cookie', credential);
  const group = records.at(-1)?.request?.session?.group;
  expect(records.at(-1)?.actor?.puid).toBe('SYNTHETIC-TEACHER');
  await new Promise<void>((resolve, reject) => store.clear(error => error ? reject(error) : resolve()));
  await request(app).get('/api/read').set('Cookie', credential);
  expect(records.at(-1)).toMatchObject({ actor: undefined, statusCode: 401, request: { session: { credential: 'signed', group }, identity: { sessionLookup: 'not-restored' } }, response: { failureReason: 'session-not-restored' } });
});

it('retains the stored account association when fresh account lookup fails without authenticating it', async () => {
  const { app } = fixture(undefined, true);
  const login = await request(app).post('/api/test-login');
  const credential = login.headers['set-cookie'][0].split(';')[0];
  await request(app).get('/api/read').set('Cookie', credential);
  expect(records.at(-1)).toMatchObject({ actor: undefined, statusCode: 500,
    request: { loginState: 'not-evaluated', identity: { stage: 'failed', failedDuring: 'user-loading', sessionAccountPuid: 'SYNTHETIC-TEACHER' } },
    response: { failurePhase: 'user-load', failureReason: 'identity-lookup-failed' } });
});

it('keeps concurrent authenticated sessions and account associations separate', async () => {
  const { app } = fixture();
  const first = await request(app).post('/api/test-login?puid=SYNTHETIC-A');
  const second = await request(app).post('/api/test-login?puid=SYNTHETIC-B');
  records.length = 0;
  await Promise.all([first, second].map(login => request(app).get('/api/read').set('Cookie', login.headers['set-cookie'][0].split(';')[0])));
  expect(new Set(records.map(event => event.actor?.puid))).toEqual(new Set(['SYNTHETIC-A', 'SYNTHETIC-B']));
  expect(new Set(records.map(event => event.request?.session?.group)).size).toBe(2);
  for (const event of records) expect(event.request?.identity?.sessionAccountPuid).toBe(event.actor?.puid);
});

it('records the actual pre-auth JSON failure and preserves sanitized initiation hints', async () => {
  await request(fixture().app).post('/api/read').set('Content-Type', 'application/json')
    .set('X-Financebot-Client', 'web-v1').set('X-Financebot-Page', '/instructor/course/private-name/materials?token=private')
    .set('X-Financebot-Callsite', 'views/instructor/materials.js:100:20').set('X-Financebot-Trigger', 'api-call').send('{');
  expect(records[0]).toMatchObject({ statusCode: 400, request: { identity: { stage: 'not-started' }, source: { page: '/instructor/course/:redacted/materials', callsite: 'views/instructor/materials.js:100:20' } }, response: { failurePhase: 'body-parser', failureReason: 'malformed-json' } });
  expect(JSON.stringify([records, warn.mock.calls, logError.mock.calls])).not.toContain('private');
});

it('hashes only signed credentials, rejects tampering/duplicates, and retains no reusable session ID', () => {
  const id = 'synthetic-session-id';
  const signature = createHmac('sha256', secret).update(id).digest('base64').replace(/=+$/, '');
  const credential = `connect.sid=${encodeURIComponent(`s:${id}.${signature}`)}`;
  const result = requestSession(credential, secret);
  expect(result).toMatchObject({ credential: 'signed', group: expect.stringMatching(/^[a-f\d]{32}$/) });
  expect(requestSession(credential, secret)).toEqual(result);
  expect(requestSession(credential.replace('connect.sid=', 'connect.sid = '), secret)).toEqual(result);
  expect(requestSession(credential, secret + 'different')).toEqual({ credential: 'invalid' });
  expect(requestSession(credential + '; ' + credential, secret)).toEqual({ credential: 'ambiguous' });
  expect(requestSession('connect.sid=unsigned', secret)).toEqual({ credential: 'invalid' });
  expect(JSON.stringify(result)).not.toContain(id);
});

it('accepts bounded native-preview hints without asserting a verified cause or sender', () => {
  expect(requestSource('/api/courses/id/materials/id/source?_fbSource=embedded-preview&_fbPage=%2Finstructor%2Fcourse%2Fprivate%2Fmaterials', {})).toEqual({ channel: 'embedded-preview', page: '/instructor/course/:redacted/materials' });
  expect(requestSource('/api/unknown?_fbSource=embedded-preview', {})).toBeUndefined();
  expect(requestSource('/api/courses/id/content-runs/events?_fbSource=event-stream&_fbPage=%2Finstructor%2Fcourse%2Fid%2Fmaterials', {})).toEqual({ channel: 'event-stream', page: '/instructor/course/:redacted/materials' });
  expect(requestSource('/api/read', { webClient: 'web-v1', callsite: 'https://private.test/secret.js:1:2', trigger: 'private-token' })).toEqual({ channel: 'fetch' });
});

it('bounds a stalled identity lookup without inventing an actor', async () => {
  jest.useFakeTimers();
  const res = { locals: {} };
  startRequestIdentity(res as never);
  traceAuthentication('session-loading', () => undefined)({} as never, res as never, jest.fn());
  const result = awaitRequestIdentity(res as never);
  jest.advanceTimersByTime(1500);
  await expect(result).resolves.toBe('timed-out');
  expect(jest.getTimerCount()).toBe(0);
});

it('caps simultaneous identity waits independently of audit database write capacity', async () => {
  jest.useFakeTimers();
  const pending = Array.from({ length: 101 }, () => {
    const res = { locals: {} };
    startRequestIdentity(res as never);
    traceAuthentication('session-loading', () => undefined)({} as never, res as never, jest.fn());
    return awaitRequestIdentity(res as never);
  });
  jest.advanceTimersByTime(1500);
  const outcomes = await Promise.all(pending);
  expect(outcomes.filter(value => value === 'timed-out')).toHaveLength(100);
  expect(outcomes.filter(value => value === 'capacity-limited')).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not mislabel a verified account endpoint 401 as missing CWL authentication', () => {
  expect(requestFailureAnalysis({ statusCode: 401, outcome: 'failed', actor: { puid: 'SYNTHETIC-A', uid: 'teacher', displayName: 'Synthetic Teacher' }, response: {} } as OperationEvent))
    .toEqual({ failurePhase: 'application', failureReason: 'authenticated-request-rejected' });
});
