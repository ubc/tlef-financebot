import { ObjectId } from 'mongodb';
import type { ModelCallEvent } from '../../server/src/components/genai/llm/model-call';
import type { ModelCallReceipt, ModelUsageSession } from '../../server/src/types/model-usage';

jest.mock('../../server/src/components/mongodb/collections', () => ({ modelCallReceiptsCol: jest.fn(), modelUsageSessionsCol: jest.fn() }));
import { modelCallReceiptsCol, modelUsageSessionsCol } from '../../server/src/components/mongodb/collections';
import { createModelUsageTracker, summarizeReceipts, summarizeModelUsage, listModelCalls } from '../../server/src/services/model-usage.service';

const date = new Date('2026-10-03T12:00:00Z');
const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, reasoningTokens: 10, cachedInputTokens: 40, cacheWriteTokens: null, totalOrigin: 'provider' as const, countSource: 'provider-reported' as const };
const unknown = { ...usage, inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null, cachedInputTokens: null, totalOrigin: 'unknown' as const, countSource: 'unavailable' as const };
function call(id = 'call', change: Partial<ModelCallReceipt> = {}): ModelCallReceipt {
  return { _id: id, trackingSessionId: 'session', stage: 'generation', provider: 'test', requestedModel: 'fixture', actualModel: 'fixture', responseId: 'response', requestOptions: {}, startedAt: date, finishedAt: date, outcome: 'succeeded', usage, retryVisibility: 'unknown', ...change };
}
function session(ids = ['call'], change: Partial<ModelUsageSession> = {}): ModelUsageSession {
  return { _id: 'session', startedAt: date, expectedCallIds: ids, closedCleanly: true, recordingFailed: false, ...change };
}
const opts = { now: date.getTime() + 1000 };

it('adds input/output only once, preserves subset counters, and deduplicates receipts', () => {
  const summary = summarizeReceipts([call(), call()], [session()], opts);
  expect(summary).toMatchObject({ status: 'complete', inputTokens: 100, outputTokens: 20, totalTokens: 120, observedCalls: 1, reportedCalls: 1, reasoningTokens: 10, cachedInputTokens: 40 });
  expect(summary.models[0]).toMatchObject({ model: 'fixture', totalTokens: 120 });
});
it('retains consumption from failed/discarded calls and reports missing usage', () => {
  const result = summarizeReceipts([call('a', { outcome: 'failed' }), call('b', { usage: unknown })], [session(['a', 'b'])], opts);
  expect(result).toMatchObject({ totalTokens: 120, observedCalls: 2, reportedCalls: 1, unknownCalls: 1, status: 'partial' });
});
it('distinguishes old untracked records, known zero, and a tracked zero-call operation', () => {
  expect(summarizeReceipts([], [], opts)).toMatchObject({ totalTokens: null, status: 'unavailable', untracked: true });
  expect(summarizeReceipts([], [session([])], opts)).toMatchObject({ totalTokens: 0, status: 'complete' });
  expect(summarizeReceipts([call('call', { usage: { ...unknown, inputTokens: 0, outputTokens: 0, totalTokens: 0, totalOrigin: 'provider', countSource: 'provider-reported' } })], [session()], opts)).toMatchObject({ totalTokens: 0, status: 'complete', reportedCalls: 1 });
});
it('does not label partial provider fields complete or stale calls perpetually pending', () => {
  expect(summarizeReceipts([call('call', { usage: { ...unknown, inputTokens: 10 } })], [session()], opts)).toMatchObject({ status: 'partial', totalTokens: null, inputTokens: 10 });
  expect(summarizeReceipts([call('call', { outcome: 'pending', usage: unknown })], [session()], opts)).toMatchObject({ status: 'pending', pendingCalls: 1 });
  expect(summarizeReceipts([call('call', { outcome: 'pending', usage: unknown })], [session()], { now: date.getTime() + 7200000 })).toMatchObject({ status: 'unavailable', pendingCalls: 0, unknownCalls: 1 });
});
it('detects missing receipts and unsealed crashed coverage even after storage recovery', () => {
  expect(summarizeReceipts([], [session(['lost'])], opts)).toMatchObject({ observedCalls: 1, unknownCalls: 1, coverageGaps: 1, totalTokens: null });
  expect(summarizeReceipts([], [session([], { closedCleanly: false })], { now: date.getTime() + 7200000 })).toMatchObject({ status: 'unavailable', totalTokens: null, coverageGaps: 1 });
  expect(summarizeReceipts([call()], [session()], { ...opts, truncated: true }).status).toBe('partial');
});

// Mongo-like stateful fake tests update-only finalization and isolated manifests.
type FakeRow = Record<string, unknown> & { _id: string; actor?: { puid: string }; usage?: { totalTokens: number | null }; expectedCallIds?: string[] };
type FakeFilter = { _id: string; [key: string]: unknown };
type FakeUpdate = { $setOnInsert?: Partial<FakeRow>; $set?: Partial<FakeRow>; $addToSet?: Record<string, unknown> };
function memoryCollection() {
  const rows = new Map<string, FakeRow>();
  const updateOne = jest.fn(async (filter: FakeFilter, update: FakeUpdate, options: { upsert?: boolean } = {}) => {
    let row = rows.get(filter._id);
    if (row && Object.entries(filter).some(([key, value]) => row![key] !== value)) return { matchedCount: 0 };
    const existed = Boolean(row);
    if (!row && !options.upsert) return { matchedCount: 0 };
    row = row ?? ({ _id: filter._id, ...structuredClone(update.$setOnInsert ?? {}) } as FakeRow);
    Object.assign(row, structuredClone(update.$set ?? {}));
    for (const [key, value] of Object.entries(update.$addToSet ?? {})) row[key] = [...new Set([...((row[key] as unknown[]) ?? []), value])];
    rows.set(filter._id, row);
    return { matchedCount: existed ? 1 : 0, upsertedCount: existed ? 0 : 1 };
  });
  const findOne = jest.fn(async (filter: FakeFilter) => rows.get(filter._id) ?? null);
  const deleteOne = jest.fn(async (filter: FakeFilter) => { rows.delete(filter._id); });
  return { rows, updateOne, findOne, deleteOne };
}
function event(id = 'call'): ModelCallEvent {
  return { type: 'started', callId: id, provider: 'test', requestedModel: 'fixture', actualModel: null, responseId: null, startedAt: date.toISOString(), requestOptions: {}, usageContext: { stage: 'generation', jsonAttempt: 0 }, retryVisibility: 'unknown' };
}
function finished(id = 'call'): ModelCallEvent {
  return { ...event(id), type: 'finished', finishedAt: date.toISOString(), durationMs: 10, outcome: 'succeeded', usage };
}
describe('persistent tracking', () => {
  let receipts: ReturnType<typeof memoryCollection>;
  let sessions: ReturnType<typeof memoryCollection>;
  beforeEach(() => {
    receipts = memoryCollection(); sessions = memoryCollection();
    jest.mocked(modelCallReceiptsCol).mockReturnValue(receipts as never);
    jest.mocked(modelUsageSessionsCol).mockReturnValue(sessions as never);
  });
  it('keeps concurrent actors separate and counts distinct JSON-repair calls', async () => {
    const a = createModelUsageTracker({ operationId: 'op-a', actor: { puid: 'a' }, courseId: new ObjectId().toHexString() });
    const b = createModelUsageTracker({ operationId: 'op-b', actor: { puid: 'b' } });
    await Promise.all([a.observer(event('a1')), b.observer(event('b1'))]);
    await a.observer(finished('a1')); await a.observer(event('a2')); await a.observer(finished('a2')); await b.observer(finished('b1'));
    await Promise.all([a.close(), b.close()]);
    expect(receipts.rows.get('a2')?.actor?.puid).toBe('a');
    expect(receipts.rows.get('b1')?.operationId).toBe('op-b');
    expect([...sessions.rows.values()].find(row => row.operationId === 'op-a')?.expectedCallIds).toEqual(['a1', 'a2']);
    expect(JSON.stringify([...receipts.rows.values()])).not.toContain('prompt');
  });
  it('finalizes after request cancellation but never recreates a deleted receipt', async () => {
    const tracker = createModelUsageTracker({ operationId: 'op' });
    await tracker.observer(event()); await tracker.close(); await tracker.observer(finished());
    expect(receipts.rows.get('call')?.usage?.totalTokens).toBe(120);
    receipts.rows.clear(); sessions.rows.clear();
    await tracker.observer(finished());
    expect(receipts.rows.size).toBe(0);
    expect(sessions.rows.size).toBe(0);
    expect(receipts.updateOne.mock.calls.at(-1)?.[2]?.upsert).not.toBe(true);
  });
  it('preserves known counters on duplicate events and seals a recording failure as incomplete', async () => {
    const tracker = createModelUsageTracker({ operationId: 'op' });
    await tracker.observer(event()); await tracker.observer(finished());
    await tracker.observer({ ...finished(), usage: unknown } as ModelCallEvent);
    expect(receipts.rows.get('call')?.usage?.totalTokens).toBe(120);
    receipts.updateOne.mockRejectedValueOnce(new Error('offline'));
    await tracker.observer(event('lost'));
    await tracker.close();
    expect([...sessions.rows.values()][0].recordingFailed).toBe(true);
    expect([...sessions.rows.values()][0].expectedCallIds).toContain('lost');
  });
  it('does not throw on a store outage or invent a zero-call receipt for a normal GET', async () => {
    const empty = createModelUsageTracker({ operationId: 'get' }); await empty.close();
    expect(sessions.rows.size).toBe(0);
    sessions.updateOne.mockRejectedValue(new Error('offline'));
    const tracker = createModelUsageTracker({ operationId: 'failed' });
    await expect(tracker.observer(event())).resolves.toBeUndefined();
    await expect(tracker.close()).resolves.toBeUndefined();
  });
});

it('applies actor/course/run/date filters and paginates calls independently of totals', async () => {
  const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) };
  const collection = { find: jest.fn().mockReturnValue(chain), countDocuments: jest.fn().mockResolvedValue(0) };
  jest.mocked(modelCallReceiptsCol).mockReturnValue(collection as never);
  jest.mocked(modelUsageSessionsCol).mockReturnValue(collection as never);
  const courseId = new ObjectId().toHexString();
  await listModelCalls({ actor: 'a', courseId, runId: 'run', page: 2, limit: 10, from: date.toISOString() });
  expect(collection.find).toHaveBeenCalledWith(expect.objectContaining({ 'actor.puid': 'a', courseId: new ObjectId(courseId), runId: 'run', startedAt: { $gte: date } }));
  expect(chain.skip).toHaveBeenCalledWith(10);
  expect((await summarizeModelUsage({ actor: 'a' })).status).toBe('unavailable');
});
