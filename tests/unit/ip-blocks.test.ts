import express from 'express';
import request from 'supertest';
jest.mock('../../server/src/components/mongodb/collections', () => ({ ipBlocksCol: jest.fn(), operationEventsCol: jest.fn() }));
jest.mock('../../server/src/components/auth', () => ({ ensureAdmin: jest.requireActual('../../server/src/components/auth/platform-guards').ensureAdmin }));
jest.mock('../../server/src/services/model-usage.service', () => ({ createModelUsageTracker: () => ({ close: jest.fn(), observer: {} }) }));
jest.mock('../../server/src/components/genai/llm/model-call', () => ({ withModelCallObserver: (_observer: unknown, work: () => void) => work() }));
import { ipBlocksCol, operationEventsCol } from '../../server/src/components/mongodb/collections';
import { ipBlocksRouter } from '../../server/src/routes/ip-blocks.routes';
import { enforceIpBlock } from '../../server/src/middleware/ip-block';
import { operationAudit } from '../../server/src/middleware/operation-audit';
import { errorHandler, notFoundHandler } from '../../server/src/middleware/error-handler';
import { normalizeIp } from '../../server/src/services/ip-address';
import { clearIpBlockCache, isIpBlocked, setIpBlock } from '../../server/src/services/ip-blocks.service';
import type { IpBlockEntry } from '../../server/src/types/ip-block';
import type { OperationEvent } from '../../server/src/types/domain';

const adminIp = '203.0.113.10', targetIp = '198.51.100.7';
const rows = new Map<string, IpBlockEntry>();
const events: OperationEvent[] = [];
const find = jest.fn(), findOne = jest.fn(), insertOne = jest.fn(), update = jest.fn();
let warn: jest.SpyInstance, error: jest.SpyInstance;
beforeEach(() => {
  rows.clear(); events.length = 0; clearIpBlockCache();
  find.mockReset().mockImplementation((filter = {}) => {
    let skip = 0, limit = Infinity;
    const cursor = { sort: () => cursor, skip: (value: number) => { skip = value; return cursor; }, limit: (value: number) => { limit = value; return cursor; }, toArray: async () => [...rows.values()].filter(row => Object.entries(filter).every(([key, value]) => row[key as keyof IpBlockEntry] === value)).slice(skip, skip + limit).map(row => structuredClone(row)) };
    return cursor;
  });
  findOne.mockReset().mockImplementation(async ({ ip }) => structuredClone(rows.get(ip) ?? null));
  insertOne.mockReset().mockImplementation(async (row: IpBlockEntry) => {
    if (rows.has(row.ip)) throw Object.assign(new Error('Duplicate rule'), { code: 11000 });
    rows.set(row.ip, structuredClone(row)); return { acknowledged: true };
  });
  update.mockReset().mockImplementation(async ({ ip, revision }, patch) => {
    const row = rows.get(ip); if (!row || row.revision !== revision) return null;
    const next = { ...row, ...patch.$set, revision: row.revision + 1, history: [...row.history, ...patch.$push.history.$each].slice(-50) };
    rows.set(ip, structuredClone(next)); return structuredClone(next);
  });
  jest.mocked(ipBlocksCol).mockReturnValue({ find, findOne, insertOne, findOneAndUpdate: update, countDocuments: async () => rows.size } as never);
  jest.mocked(operationEventsCol).mockReturnValue({ insertOne: async (event: OperationEvent) => { events.push(event); } } as never);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { clearIpBlockCache(); warn.mockRestore(); error.mockRestore(); });

function app(peer?: string) {
  const api = express(); api.set('trust proxy', ['loopback', '192.0.2.10']);
  if (peer) api.use((req, _res, next) => { Object.defineProperty(req.socket, 'remoteAddress', { value: peer }); next(); });
  const parsed = jest.fn(), authenticated = jest.fn();
  api.use('/api', operationAudit); api.use('/api', enforceIpBlock);
  api.use((_req, _res, next) => { parsed(); next(); }); api.use(express.json());
  api.use((req, _res, next) => {
    authenticated();
    req.isAuthenticated = (() => Boolean(req.get('x-test-role'))) as typeof req.isAuthenticated;
    if (req.get('x-test-role')) req.user = { puid: 'SYNTHETIC-ADMIN', displayName: 'Synthetic Admin', uid: 'admin', isAdmin: req.get('x-test-role') === 'admin' } as Express.User;
    next();
  });
  api.use('/api', ipBlocksRouter);
  api.get('/api/work', (_req, res) => res.json({ ok: true }));
  api.use(notFoundHandler); api.use(errorHandler);
  return { api, parsed, authenticated };
}
const operator = { puid: 'SYNTHETIC-ADMIN', displayName: 'Synthetic Admin' };

it.each([
  ['192.0.2.1', '192.0.2.1'], ['::ffff:192.0.2.1', '192.0.2.1'], ['::ffff:c000:201', '192.0.2.1'],
  ['2001:0DB8:0:0:0:0:0:1', '2001:db8::1'], ['host.test', undefined], ['192.0.2.1:443', undefined], ['192.0.2.0/24', undefined],
])('normalizes exact IP %s without accepting hosts, ports or ranges', (input, expected) => expect(normalizeIp(input)).toBe(expected));

it('protects IP reads and changes with the real Admin guard', async () => {
  const { api } = app();
  expect((await request(api).get('/api/admin/ip-blocks')).status).toBe(401);
  expect((await request(api).get('/api/admin/ip-blocks').set('x-test-role', 'teacher')).status).toBe(403);
  expect((await request(api).put('/api/admin/ip-blocks').set('x-test-role', 'teacher').send({ ip: targetIp, blocked: true })).status).toBe(403);
  expect(rows.size).toBe(0);
});

it('blocks before parser/session work, retains exact path/IP only in Admin evidence, and unblocks immediately', async () => {
  const { api, parsed, authenticated } = app();
  const block = await request(api).put('/api/admin/ip-blocks').set('x-test-role', 'admin').set('X-Forwarded-For', adminIp).send({ ip: targetIp, blocked: true, reason: 'Synthetic scanner check' });
  expect(block.status).toBe(200); expect(block.body.revision).toBe(1);
  parsed.mockClear(); authenticated.mockClear();
  const denied = await request(api).post('/api/unknown-sensitive-path?token=private').set('X-Forwarded-For', targetIp).set('Content-Type', 'application/json').send('{');
  expect(denied.status).toBe(403);
  expect(parsed).not.toHaveBeenCalled(); expect(authenticated).not.toHaveBeenCalled();
  expect(events.at(-1)).toMatchObject({ request: { originalPath: '/api/unknown-sensitive-path', network: { clientIp: targetIp, source: 'trusted-proxy' } }, response: { failurePhase: 'ip-block', failureReason: 'ip-address-blocked' } });
  expect(JSON.stringify(warn.mock.calls)).not.toContain(targetIp);
  expect(JSON.stringify(warn.mock.calls)).not.toContain('unknown-sensitive-path');
  expect(JSON.stringify(events)).not.toContain('private');
  const allow = await request(api).put('/api/admin/ip-blocks').set('x-test-role', 'admin').set('X-Forwarded-For', adminIp).send({ ip: targetIp, blocked: false, reason: 'Reviewed', expectedRevision: 1 });
  expect(allow.status).toBe(200); expect(allow.body.history).toHaveLength(2);
  expect(allow.body.history[1]).toMatchObject({ blocked: false, actorPuid: operator.puid });
  expect((await request(api).get('/api/work').set('X-Forwarded-For', targetIp)).status).toBe(200);
  const listed = await request(api).get('/api/admin/ip-blocks').set('x-test-role', 'admin').set('X-Forwarded-For', adminIp);
  expect(listed.body).toMatchObject({ currentIp: adminIp, total: 1, refreshSeconds: 5 });
});

it.each([adminIp, '::ffff:203.0.113.10', '127.0.0.1', '::1', '192.0.2.10', '0.0.0.0', '::'])('refuses a self, loopback, unspecified or trusted proxy block: %s', async ip => {
  const result = await request(app().api).put('/api/admin/ip-blocks').set('x-test-role', 'admin').set('X-Forwarded-For', adminIp).send({ ip, blocked: true });
  expect(result.status).toBe(409); expect(rows.size).toBe(0);
});

it('does not let an untrusted client evade a block by forging forwarding headers', async () => {
  await setIpBlock({ ip: targetIp, blocked: true, reason: '' }, operator, { currentIp: adminIp, targetIsProxy: false });
  const result = await request(app(targetIp).api).get('/api/work').set('X-Forwarded-For', '192.0.2.55');
  expect(result.status).toBe(403);
  expect(events.at(-1)?.request?.network).toMatchObject({ clientIp: targetIp, source: 'untrusted-forwarding' });
});

it('rejects stale rule revisions instead of overriding another administrator change', async () => {
  const block = await setIpBlock({ ip: targetIp, blocked: true, reason: '' }, operator, { currentIp: adminIp, targetIsProxy: false });
  await setIpBlock({ ip: targetIp, blocked: false, reason: '', expectedRevision: block.revision }, operator, { currentIp: adminIp, targetIsProxy: false });
  await expect(setIpBlock({ ip: targetIp, blocked: true, reason: '', expectedRevision: block.revision }, operator, { currentIp: adminIp, targetIsProxy: false })).rejects.toMatchObject({ status: 409 });
  expect(rows.get(targetIp)?.blocked).toBe(false);
});

it('prevents an older in-flight cache load from undoing a newly committed block', async () => {
  let release!: (value: IpBlockEntry[]) => void;
  find.mockImplementationOnce(() => ({ toArray: () => new Promise<IpBlockEntry[]>(resolve => { release = resolve; }) }));
  const oldRead = isIpBlocked(targetIp);
  await setIpBlock({ ip: targetIp, blocked: true, reason: '' }, operator, { currentIp: adminIp, targetIsProxy: false });
  release([]);
  await expect(oldRead).resolves.toBe(true);
  await expect(isIpBlocked(targetIp)).resolves.toBe(true);
});

it('keeps last-known blocks on a refresh fault and throttles cold faults without blocking all clients', async () => {
  await setIpBlock({ ip: targetIp, blocked: true, reason: '' }, operator, { currentIp: adminIp, targetIsProxy: false });
  find.mockImplementation(() => ({ toArray: async () => { throw new Error('private MongoDB credentials'); } }));
  await expect(isIpBlocked(targetIp)).resolves.toBe(true);
  await expect(isIpBlocked('198.51.100.8')).resolves.toBe(false);
  expect(error).toHaveBeenCalledTimes(1); expect(JSON.stringify(error.mock.calls)).not.toContain('private');
  clearIpBlockCache(); find.mockClear();
  await expect(isIpBlocked('198.51.100.8')).resolves.toBe(false);
  await expect(isIpBlocked('198.51.100.9')).resolves.toBe(false);
  expect(find).toHaveBeenCalledTimes(1);
});
