import { randomUUID } from 'node:crypto';
import { ObjectId, type Filter } from 'mongodb';
import { modelCallReceiptsCol, modelUsageSessionsCol } from '../components/mongodb/collections';
import { withModelCallObserver, type ModelCallObserver } from '../components/genai/llm/model-call';
import type { ModelUsage } from '../components/genai/llm/provider-usage';
import type { ModelCallReceipt, ModelUsageFilters, ModelUsageScope, ModelUsageSession, ModelUsageSummary, ModelUsageTotals } from '../types/model-usage';

const FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens', 'cacheWriteTokens'] as const;
const READ_LIMIT = 10000;
const STALE_AFTER_MS = 60 * 60 * 1000;
const MAX_SESSION_CALLS = 10000;
const MAX_RECORDING_FAULTS = 100;
interface RecordingFault { sessionId: string; scope: ModelUsageScope; startedAt: Date; lastFailureAt: Date }
const recordingFaults = new Map<string, RecordingFault>();
let evictedFaultRange: { from: Date; until: Date } | undefined;
const emptyUsage = (): ModelUsage => ({ inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null, totalOrigin: 'unknown', countSource: 'unavailable' });
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function safeUsage(value: ModelUsage): ModelUsage {
  const usage = emptyUsage();
  for (const key of FIELDS) usage[key] = count(value[key]) ? value[key] : null;
  usage.countSource = FIELDS.some(key => usage[key] !== null) ? 'provider-reported' : 'unavailable';
  usage.totalOrigin = ['provider', 'derived-from-reported'].includes(value.totalOrigin) && usage.totalTokens !== null ? value.totalOrigin : 'unknown';
  return usage;
}

function scopeFields(scope: ModelUsageScope) {
  return {
    ...(scope.operationId ? { operationId: scope.operationId } : {}),
    ...(scope.runId ? { runId: scope.runId } : {}),
    ...(scope.courseId && ObjectId.isValid(scope.courseId) ? { courseId: new ObjectId(scope.courseId) } : {}),
    ...(scope.actor ? { actor: { puid: scope.actor.puid, ...(scope.actor.uid ? { uid: scope.actor.uid } : {}), ...(scope.actor.displayName ? { displayName: scope.actor.displayName } : {}) } } : {}),
  };
}

/** Only metadata enters this ledger. A recording error never retries a model. */
export function createModelUsageTracker(scope: ModelUsageScope | (() => ModelUsageScope)) {
  const id = randomUUID();
  const startedAt = new Date();
  const calls = new Set<string>();
  let initialized = false;
  let creationAttempted = false;
  let closed = false;
  let failed = false;
  let frozenScope: ModelUsageScope | undefined;
  let queue = Promise.resolve();
  const currentScope = () => typeof scope === 'function' ? scope() : scope;
  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch(() => {
      failed = true;
      const lastFailureAt = new Date();
      recordingFaults.delete(id);
      recordingFaults.set(id, { sessionId: id, scope: frozenScope ?? currentScope(), startedAt, lastFailureAt });
      if (recordingFaults.size > MAX_RECORDING_FAULTS) {
        const oldest = recordingFaults.values().next().value as RecordingFault;
        recordingFaults.delete(oldest.sessionId);
        evictedFaultRange = {
          from: evictedFaultRange && evictedFaultRange.from < oldest.startedAt ? evictedFaultRange.from : oldest.startedAt,
          until: evictedFaultRange && evictedFaultRange.until > oldest.lastFailureAt ? evictedFaultRange.until : oldest.lastFailureAt,
        };
      }
    });
    return queue;
  };
  const initialize = async () => {
    if (initialized) return;
    frozenScope ??= structuredClone(currentScope());
    // A failed course-scoped creation cannot be retried: course cleanup may
    // have completed while the paid call continued. Preserve the recording
    // fault instead of recreating metadata for a deleted course.
    if (creationAttempted && frozenScope.courseId && ObjectId.isValid(frozenScope.courseId)) return;
    creationAttempted = true;
    await modelUsageSessionsCol().updateOne({ _id: id }, { $setOnInsert: {
      _id: id, ...scopeFields(frozenScope), startedAt, expectedCallIds: [], closedCleanly: false, recordingFailed: false,
    } }, { upsert: true, maxTimeMS: 2000 });
    initialized = true;
  };
  const observer: ModelCallObserver = event => enqueue(async () => {
    if (event.type === 'started') {
      // A call observed after the HTTP response closed keeps coverage incomplete.
      if (closed) failed = true;
      if (calls.size >= MAX_SESSION_CALLS) { failed = true; return; }
      calls.add(event.callId);
      await initialize();
      if (!initialized) return;
      // Do not upsert the session again: permanent course deletion may have removed it.
      const session = await modelUsageSessionsCol().updateOne({ _id: id }, { $addToSet: { expectedCallIds: event.callId }, $set: { recordingFailed: failed } }, { maxTimeMS: 2000 });
      if (!session.matchedCount) { failed = true; return; }
      const receipt: ModelCallReceipt = {
        _id: event.callId, trackingSessionId: id, ...scopeFields(frozenScope ?? currentScope()),
        stage: event.usageContext?.stage ?? currentScope().stage ?? 'completion',
        ...(event.usageContext?.item !== undefined ? { item: event.usageContext.item } : {}),
        ...(event.usageContext?.candidateAttempt !== undefined ? { candidateAttempt: event.usageContext.candidateAttempt } : {}),
        ...(event.usageContext?.jsonAttempt !== undefined ? { jsonAttempt: event.usageContext.jsonAttempt } : {}),
        provider: event.provider, requestedModel: event.requestedModel,
        actualModel: event.actualModel, responseId: event.responseId, requestOptions: event.requestOptions,
        startedAt: new Date(event.startedAt), outcome: 'pending', usage: emptyUsage(), retryVisibility: 'unknown',
      };
      await modelCallReceiptsCol().updateOne({ _id: event.callId }, { $setOnInsert: receipt }, { upsert: true, maxTimeMS: 2000 });
      // If deletion raced the insert, remove this orphan rather than resurrecting it.
      if (!await modelUsageSessionsCol().findOne({ _id: id }, { projection: { _id: 1 } })) {
        await modelCallReceiptsCol().deleteOne({ _id: event.callId });
      }
    } else {
      const update = await modelCallReceiptsCol().updateOne({ _id: event.callId, trackingSessionId: id, outcome: 'pending' }, { $set: {
        actualModel: event.actualModel, responseId: event.responseId, finishedAt: new Date(event.finishedAt),
        durationMs: event.durationMs, outcome: event.outcome, usage: safeUsage(event.usage), retryVisibility: event.retryVisibility,
      } }, { maxTimeMS: 2000 });
      if (!update.matchedCount) {
        // Duplicate completion is harmless; an absent receipt is a coverage gap.
        if (!await modelCallReceiptsCol().findOne({ _id: event.callId }, { projection: { _id: 1 } })) failed = true;
      }
      if (failed) await modelUsageSessionsCol().updateOne({ _id: id }, { $set: { recordingFailed: true } }, { maxTimeMS: 2000 });
    }
  });
  return {
    observer,
    start: () => enqueue(initialize),
    close: () => enqueue(async () => {
      if (closed) return;
      closed = true;
      // Ordinary requests without model calls do not create empty telemetry records.
      if (!initialized && !calls.size) return;
      // Preserve an unscoped failed manifest if the store recovers before close.
      // Failed course-scoped creation remains blocked by initialize().
      // This retry records metadata only; it never reissues a provider request.
      if (!initialized) await initialize();
      if (!initialized) return;
      await modelUsageSessionsCol().updateOne({ _id: id }, { $set: {
        closedAt: new Date(), closedCleanly: true, recordingFailed: failed, expectedCallIds: [...calls],
      } }, { maxTimeMS: 2000 });
    }),
  };
}

export async function withModelUsage<T>(scope: ModelUsageScope, work: () => Promise<T>): Promise<T> {
  const tracker = createModelUsageTracker(scope);
  await tracker.start();
  try { return await withModelCallObserver(tracker.observer, work); }
  finally { await tracker.close(); }
}

function totals(receipts: ModelCallReceipt[], now: number): ModelUsageTotals {
  const result: ModelUsageTotals = { inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null, observedCalls: receipts.length, reportedCalls: 0, callsWithKnownTotal: 0, pendingCalls: 0, unknownCalls: 0 };
  for (const call of receipts) {
    let reported = false;
    for (const field of FIELDS) {
      if (count(call.usage[field])) { result[field] = (result[field] ?? 0) + call.usage[field]; reported = true; }
    }
    if (reported) result.reportedCalls++;
    if (count(call.usage.totalTokens)) result.callsWithKnownTotal++;
    if (call.outcome === 'pending' && now - new Date(call.startedAt).getTime() < STALE_AFTER_MS) result.pendingCalls++;
    else if (!count(call.usage.totalTokens)) result.unknownCalls++;
  }
  return result;
}

/** Pure aggregation shared by production and fixture tests. Counts are subtotals. */
export function summarizeReceipts(receipts: ModelCallReceipt[], sessions: ModelUsageSession[], options: { truncated?: boolean; checkExpected?: boolean; now?: number; recordingCoverageGaps?: number } = {}): ModelUsageSummary {
  const unique = [...new Map(receipts.map(call => [call._id, call])).values()];
  const now = options.now ?? Date.now();
  const data = totals(unique, now);
  const ids = new Set(unique.map(call => call._id));
  const missing = new Set(sessions.flatMap(session => options.checkExpected === false ? [] : session.expectedCallIds.filter(id => !ids.has(id))));
  const open = sessions.some(session => !session.closedCleanly && now - new Date(session.startedAt).getTime() < STALE_AFTER_MS);
  const broken = sessions.filter(session => session.recordingFailed || !session.closedCleanly && now - new Date(session.startedAt).getTime() >= STALE_AFTER_MS).length;
  const orphaned = unique.some(call => !sessions.some(session => session._id === call.trackingSessionId));
  const untracked = sessions.length === 0;
  const gaps = missing.size + broken + Number(Boolean(options.truncated)) + Number(orphaned) + (options.recordingCoverageGaps ?? 0);
  data.observedCalls += missing.size;
  data.unknownCalls += missing.size;
  const finishedFieldsMissing = unique.some(call => call.outcome !== 'pending' && (!count(call.usage.inputTokens) || !count(call.usage.outputTokens) || !count(call.usage.totalTokens)));
  const zero = !unique.length && sessions.length > 0 && sessions.every(session => !session.expectedCallIds.length) && !open && !gaps;
  if (zero) { data.inputTokens = 0; data.outputTokens = 0; data.totalTokens = 0; }
  let status: ModelUsageSummary['status'] = 'complete';
  if (!zero && !data.reportedCalls && !data.pendingCalls && !open) status = 'unavailable';
  else if (gaps || untracked || data.unknownCalls || finishedFieldsMissing) status = 'partial';
  else if (open || data.pendingCalls) status = 'pending';
  const group = (key: (call: ModelCallReceipt) => string) => {
    const map = new Map<string, ModelCallReceipt[]>();
    for (const call of unique) { const id = key(call); map.set(id, [...(map.get(id) ?? []), call]); }
    return map;
  };
  return { ...data, status, scope: 'llm-calls', coverageGaps: gaps, untracked,
    retryVisibility: unique.length && unique.every(call => call.retryVisibility === 'disabled') ? 'disabled' : 'unknown',
    stages: [...group(call => call.stage)].map(([stage, calls]) => ({ stage, ...totals(calls, now) })),
    models: [...group(call => JSON.stringify([call.provider, call.actualModel ?? call.requestedModel]))].map(([key, calls]) => { const [provider, model] = JSON.parse(key) as [string, string]; return { provider, model, ...totals(calls, now) }; }),
  };
}

function overlaps(from: Date, until: Date, filters: ModelUsageFilters): boolean {
  return (!filters.from || until >= new Date(filters.from)) && (!filters.until || from <= new Date(filters.until));
}

function faultCoverage(filters: ModelUsageFilters, sessions: ModelUsageSession[]): number {
  let gaps = 0;
  for (const fault of recordingFaults.values()) {
    if (filters.actor && fault.scope.actor?.puid !== filters.actor || filters.courseId && fault.scope.courseId !== filters.courseId
      || filters.runId && fault.scope.runId !== filters.runId || filters.operationId && fault.scope.operationId !== filters.operationId) continue;
    if (!overlaps(fault.startedAt, fault.lastFailureAt, filters)) continue;
    if (!sessions.some(session => session._id === fault.sessionId && session.recordingFailed)) gaps++;
  }
  // After bounded details are evicted, conservatively retain the affected interval.
  if (evictedFaultRange && overlaps(evictedFaultRange.from, evictedFaultRange.until, filters)) gaps++;
  return gaps;
}

function filterFor(filters: ModelUsageFilters): Filter<ModelCallReceipt> {
  return {
    ...(filters.actor ? { 'actor.puid': filters.actor } : {}),
    ...(filters.courseId ? { courseId: new ObjectId(filters.courseId) } : {}),
    ...(filters.runId ? { runId: filters.runId } : {}),
    ...(filters.operationId ? { operationId: filters.operationId } : {}),
    ...(filters.from || filters.until ? { startedAt: { ...(filters.from ? { $gte: new Date(filters.from) } : {}), ...(filters.until ? { $lte: new Date(filters.until) } : {}) } } : {}),
  };
}

export async function summarizeModelUsage(filters: ModelUsageFilters): Promise<ModelUsageSummary> {
  const filter = filterFor(filters);
  const [observedReceipts, observedSessions] = await Promise.all([
    modelCallReceiptsCol().find(filter).sort({ startedAt: -1, _id: -1 }).limit(READ_LIMIT + 1).toArray(),
    modelUsageSessionsCol().find(filter as Filter<ModelUsageSession>).sort({ startedAt: -1 }).limit(READ_LIMIT + 1).toArray(),
  ]);
  const receipts = observedReceipts.slice(0, READ_LIMIT);
  const sessionsById = new Map(observedSessions.slice(0, READ_LIMIT).map(session => [session._id, session]));
  // A tracker can start before the selected interval while its calls start inside it.
  const linkedIds = [...new Set(receipts.map(call => call.trackingSessionId))].filter(id => !sessionsById.has(id));
  const identityFilters = { ...filterFor({ ...filters, from: undefined, until: undefined }) } as Filter<ModelUsageSession>;
  if (linkedIds.length) {
    const linked = await modelUsageSessionsCol().find({ ...identityFilters, _id: { $in: linkedIds } }).limit(READ_LIMIT + 1).toArray();
    for (const session of linked.slice(0, READ_LIMIT)) sessionsById.set(session._id, session);
  }
  let sessions = [...sessionsById.values()];
  let expectedTruncated = false;
  if (filters.from || filters.until) {
    const knownCalls = new Map(receipts.map(call => [call._id, call]));
    const otherExpectedIds = new Set<string>();
    outer: for (const session of sessions) {
      for (const id of session.expectedCallIds) {
        if (knownCalls.has(id)) continue;
        otherExpectedIds.add(id);
        if (otherExpectedIds.size > READ_LIMIT) { expectedTruncated = true; break outer; }
      }
    }
    const checkedIds = new Set([...knownCalls.keys(), ...[...otherExpectedIds].slice(0, READ_LIMIT)]);
    if (otherExpectedIds.size) {
      const outside = await modelCallReceiptsCol().find({ _id: { $in: [...otherExpectedIds].slice(0, READ_LIMIT) } }, { projection: { trackingSessionId: 1, startedAt: 1 } }).limit(READ_LIMIT).toArray();
      for (const call of outside) knownCalls.set(call._id, call);
    }
    sessions = sessions.map(session => ({ ...session, expectedCallIds: session.expectedCallIds.filter(id => {
      if (!checkedIds.has(id)) return false;
      const call = knownCalls.get(id);
      // A missing receipt has no trustworthy timestamp and remains a coverage gap.
      return !call || call.trackingSessionId !== session._id || overlaps(new Date(call.startedAt), new Date(call.startedAt), filters);
    }) }));
  }
  return summarizeReceipts(receipts, sessions, {
    truncated: observedReceipts.length > READ_LIMIT || observedSessions.length > READ_LIMIT || expectedTruncated,
    recordingCoverageGaps: faultCoverage(filters, sessions),
  });
}

export async function listModelCalls(filters: ModelUsageFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.max(1, Math.min(100, filters.limit ?? 25));
  const filter = filterFor(filters);
  const [items, total, summary] = await Promise.all([
    modelCallReceiptsCol().find(filter).sort({ startedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    modelCallReceiptsCol().countDocuments(filter), summarizeModelUsage(filters),
  ]);
  return { items, total, page, summary };
}
