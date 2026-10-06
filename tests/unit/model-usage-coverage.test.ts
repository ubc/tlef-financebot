import type { ModelCallEvent } from '../../server/src/components/genai/llm/model-call';
import type { ModelCallReceipt, ModelUsageSession } from '../../server/src/types/model-usage';
jest.mock('../../server/src/components/mongodb/collections', () => ({ modelCallReceiptsCol: jest.fn(), modelUsageSessionsCol: jest.fn() }));
import { modelCallReceiptsCol, modelUsageSessionsCol } from '../../server/src/components/mongodb/collections';
import { createModelUsageTracker, summarizeModelUsage, summarizeReceipts } from '../../server/src/services/model-usage.service';

const now = new Date('2026-10-03T10:10:00Z');
const usage = { inputTokens: 6, outputTokens: 4, totalTokens: 10, reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null, totalOrigin: 'provider' as const, countSource: 'provider-reported' as const };
const unknown = { ...usage, inputTokens: null, outputTokens: null, totalTokens: null, totalOrigin: 'unknown' as const, countSource: 'unavailable' as const };
function receipt(actor: string, id = 'call', sessionId = 'session', startedAt = now): ModelCallReceipt {
  return { _id: id, trackingSessionId: sessionId, actor: { puid: actor }, stage: 'generation', provider: 'fixture', requestedModel: 'fixture', actualModel: 'fixture', responseId: null, requestOptions: {}, startedAt, finishedAt: startedAt, outcome: 'succeeded', usage, retryVisibility: 'unknown' };
}
function session(actor: string, ids: string[] = ['call'], startedAt = now): ModelUsageSession {
  return { _id: 'session', actor: { puid: actor }, startedAt, closedAt: now, expectedCallIds: ids, closedCleanly: true, recordingFailed: false };
}
type Row = Record<string, unknown> & { _id: string };
function matches(row: Row, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const value = key.split('.').reduce<unknown>((current, part) => current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, row);
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const condition = expected as Record<string, unknown>;
      if ('$in' in condition) return (condition.$in as unknown[]).includes(value);
      const date = new Date(value as string | Date).getTime();
      return (!condition.$gte || date >= new Date(condition.$gte as Date).getTime()) && (!condition.$lte || date <= new Date(condition.$lte as Date).getTime());
    }
    return value === expected;
  });
}
function collection() {
  const rows = new Map<string, Row>();
  const find = jest.fn((filter: Record<string, unknown> = {}) => {
    const cursor = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), toArray: jest.fn(async () => [...rows.values()].filter(row => matches(row, filter))) };
    return cursor;
  });
  const updateOne = jest.fn(async (filter: Record<string, unknown>, update: { $setOnInsert?: Row; $set?: Record<string, unknown>; $addToSet?: Record<string, unknown> }, options: { upsert?: boolean } = {}) => {
    const id = String(filter._id);
    let row = rows.get(id);
    if (row && !matches(row, filter)) return { matchedCount: 0 };
    const existed = Boolean(row);
    if (!row && !options.upsert) return { matchedCount: 0 };
    row ??= { ...update.$setOnInsert, _id: id };
    Object.assign(row, update.$set);
    for (const [key, value] of Object.entries(update.$addToSet ?? {})) row[key] = [...new Set([...((row[key] as unknown[]) ?? []), value])];
    rows.set(id, row);
    return { matchedCount: existed ? 1 : 0 };
  });
  return { rows, find, updateOne, findOne: jest.fn(async (filter: Record<string, unknown>) => rows.get(String(filter._id)) ?? null), deleteOne: jest.fn(async (filter: Record<string, unknown>) => rows.delete(String(filter._id))) };
}
function started(id: string): ModelCallEvent {
  return { type: 'started', callId: id, provider: 'fixture', requestedModel: 'fixture', actualModel: null, responseId: null, startedAt: now.toISOString(), requestOptions: {}, usageContext: {}, retryVisibility: 'unknown' };
}
let receipts: ReturnType<typeof collection>;
let sessions: ReturnType<typeof collection>;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
  receipts = collection(); sessions = collection();
  jest.mocked(modelCallReceiptsCol).mockReturnValue(receipts as never);
  jest.mocked(modelUsageSessionsCol).mockReturnValue(sessions as never);
});
afterEach(() => jest.useRealTimers());

it('joins a selected call to its session even when the session starts before the date range', async () => {
  receipts.rows.set('call', receipt('boundary') as unknown as Row);
  sessions.rows.set('session', session('boundary', ['call'], new Date('2026-10-03T09:59:00Z')) as unknown as Row);
  const result = await summarizeModelUsage({ actor: 'boundary', from: '2026-10-03T10:00:00Z', until: '2026-10-03T10:30:00Z' });
  expect(result).toMatchObject({ status: 'complete', observedCalls: 1, totalTokens: 10, coverageGaps: 0 });
  expect(sessions.find).toHaveBeenCalledWith({ 'actor.puid': 'boundary', _id: { $in: ['session'] } });
});
it('does not call missing dated receipts a fully tracked zero-call operation', async () => {
  sessions.rows.set('session', session('missing-window', ['lost']) as unknown as Row);
  const result = await summarizeModelUsage({ actor: 'missing-window', from: '2026-10-03T10:00:00Z', until: '2026-10-03T10:30:00Z' });
  expect(result).toMatchObject({ status: 'unavailable', observedCalls: 1, unknownCalls: 1, totalTokens: null });
  expect(result.coverageGaps).toBeGreaterThan(0);
});
it('excludes known calls outside the date range without inventing a missing call', async () => {
  receipts.rows.set('call', receipt('outside-window', 'call', 'session', new Date('2026-10-03T11:00:00Z')) as unknown as Row);
  sessions.rows.set('session', session('outside-window') as unknown as Row);
  const result = await summarizeModelUsage({ actor: 'outside-window', from: '2026-10-03T10:00:00Z', until: '2026-10-03T10:30:00Z' });
  expect(result).toMatchObject({ status: 'complete', observedCalls: 0, totalTokens: 0, coverageGaps: 0 });
});
it('keeps incomplete finished fields partial while another call is pending', () => {
  const finished = { ...receipt('pending-fields', 'finished'), usage: { ...usage, inputTokens: null } };
  const pending = { ...receipt('pending-fields', 'pending'), outcome: 'pending' as const, usage: unknown };
  expect(summarizeReceipts([finished, pending], [session('pending-fields', ['finished', 'pending'])], { now: now.getTime() })).toMatchObject({ status: 'partial', pendingCalls: 1, totalTokens: 10 });
});
it('retries failed initialization at close to persist a failed expected-call manifest', async () => {
  sessions.updateOne.mockRejectedValueOnce(new Error('offline'));
  const tracker = createModelUsageTracker({ actor: { puid: 'recovered-init' }, operationId: 'lost-request' });
  await tracker.observer(started('lost'));
  await tracker.close();
  const manifest = [...sessions.rows.values()][0];
  expect(manifest).toMatchObject({ actor: { puid: 'recovered-init' }, closedCleanly: true, recordingFailed: true, expectedCallIds: ['lost'] });
  const result = await summarizeModelUsage({ actor: 'recovered-init' });
  expect(result).toMatchObject({ status: 'unavailable', observedCalls: 1, totalTokens: null });
});
it('never recreates a failed course-scoped manifest after deletion or late observed events', async () => {
  const actor = 'deleted-course-init';
  const courseId = '507f1f77bcf86cd799439011';
  sessions.updateOne.mockRejectedValueOnce(new Error('offline'));
  const tracker = createModelUsageTracker({ actor: { puid: actor }, courseId, operationId: 'deleted-request' });
  await tracker.start();
  // The initial recording failed, but paid work can continue independently.
  await tracker.observer(started('in-flight'));
  // Simulate course cascade cleanup before its in-flight call finishes.
  sessions.rows.clear(); receipts.rows.clear();
  await tracker.observer({ ...started('in-flight'), type: 'finished', finishedAt: now.toISOString(), durationMs: 10, outcome: 'succeeded', usage });
  await tracker.close();
  await tracker.observer(started('late-call'));
  await tracker.close();
  expect(sessions.rows.size).toBe(0);
  expect(receipts.rows.size).toBe(0);
  expect(sessions.updateOne.mock.calls.filter(([, , options]) => options?.upsert)).toHaveLength(1);
  expect(receipts.updateOne.mock.calls.every(([, , options]) => !options?.upsert)).toBe(true);
  // A healthy retained call cannot conceal the lost course-scoped recorder.
  receipts.rows.set('call', receipt(actor) as unknown as Row);
  sessions.rows.set('session', session(actor) as unknown as Row);
  expect(await summarizeModelUsage({ actor })).toMatchObject({ status: 'partial', totalTokens: 10, coverageGaps: 1 });
});
it('retains a scoped process coverage warning when all recording writes fail', async () => {
  sessions.updateOne.mockRejectedValue(new Error('offline'));
  const tracker = createModelUsageTracker({ actor: { puid: 'faulted-user' }, operationId: 'lost-request' });
  await tracker.observer(started('lost')); await tracker.close();
  // Storage recovers, but the lost session remains absent beside a healthy one.
  receipts.rows.set('call', receipt('faulted-user') as unknown as Row);
  sessions.rows.set('session', session('faulted-user') as unknown as Row);
  expect(await summarizeModelUsage({ actor: 'faulted-user' })).toMatchObject({ status: 'partial', totalTokens: 10, coverageGaps: 1 });
  receipts.rows.set('other', receipt('healthy-user', 'other', 'other-session') as unknown as Row);
  sessions.rows.set('other-session', { ...session('healthy-user', ['other']), _id: 'other-session' } as unknown as Row);
  expect(await summarizeModelUsage({ actor: 'healthy-user' })).toMatchObject({ status: 'complete', coverageGaps: 0 });
});
