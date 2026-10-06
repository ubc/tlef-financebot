import type { ModelCallEvent } from '../../server/src/components/genai/llm/model-call';
import { tokenCount } from '../../server/src/components/genai/llm/provider-usage';

export interface HarnessUsageSummary {
  measurementVersion: 1;
  scope: 'observed-llm-sdk-invocations';
  status: 'complete' | 'partial' | 'pending' | 'unavailable';
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  /** Compatibility aliases for old experiment consumers; never invent zero. */
  promptTokens: number | null;
  completionTokens: number | null;
  calls: number;
  observedCalls: number;
  reportedCalls: number;
  callsWithKnownTotal: number;
  pendingCalls: number;
  unknownCalls: number;
  failedCalls: number;
  cancelledCalls: number;
  retryLimitedCalls: number;
  untrackedRecords: number;
  models: string[];
}
const fields = ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens', 'cacheWriteTokens'] as const;
type UsageField = typeof fields[number];

/** One terminal event per call identity, including repeated event delivery. */
function uniqueCalls(events: readonly ModelCallEvent[]): ModelCallEvent[] {
  const calls = new Map<string, ModelCallEvent>();
  for (const event of events) {
    const previous = calls.get(event.callId);
    if (previous?.type === 'finished' && event.type === 'started') continue;
    if (previous?.type === 'finished' && event.type === 'finished') {
      const usage = { ...previous.usage, ...event.usage };
      for (const field of fields) if (tokenCount(event.usage[field]) === null) usage[field] = previous.usage[field];
      calls.set(event.callId, { ...previous, ...event, usage });
    } else calls.set(event.callId, event);
  }
  return [...calls.values()];
}

export function summarizeHarnessUsage(events: readonly ModelCallEvent[], { coverageComplete = false, active = false } = {}): HarnessUsageSummary {
  const calls = uniqueCalls(events);
  const terminal = calls.filter((event): event is Extract<ModelCallEvent, { type: 'finished' }> => event.type === 'finished');
  const reported = terminal.filter(event => fields.some(field => tokenCount(event.usage[field]) !== null));
  const knownTotal = terminal.filter(event => tokenCount(event.usage.totalTokens) !== null);
  const pendingCalls = active ? calls.length - terminal.length : 0;
  const unknownCalls = calls.length - knownTotal.length - pendingCalls;
  const untrackedRecords = coverageComplete ? 0 : 1;
  const subtotal = (field: UsageField): number | null => {
    const known = terminal.map(event => tokenCount(event.usage[field])).filter((count): count is number => count !== null);
    return known.length ? tokenCount(known.reduce((sum, count) => sum + count, 0))
      : !calls.length && coverageComplete && !active && ['inputTokens', 'outputTokens', 'totalTokens'].includes(field) ? 0 : null;
  };
  const totals = Object.fromEntries(fields.map(field => [field, subtotal(field)])) as Pick<HarnessUsageSummary, UsageField>;
  const incomplete = unknownCalls > 0 || untrackedRecords > 0 || pendingCalls > 0
    || terminal.some(event => event.usage.inputTokens === null || event.usage.outputTokens === null)
    || reported.length > 0 && totals.totalTokens === null;
  const status = reported.length && incomplete ? 'partial' : pendingCalls || active ? 'pending'
    : reported.length ? 'complete' : incomplete ? 'unavailable' : 'complete';
  return { measurementVersion: 1, scope: 'observed-llm-sdk-invocations', ...totals,
    promptTokens: totals.inputTokens, completionTokens: totals.outputTokens, status,
    calls: calls.length, observedCalls: calls.length, reportedCalls: reported.length, callsWithKnownTotal: knownTotal.length, pendingCalls, unknownCalls,
    failedCalls: terminal.filter(event => event.outcome === 'failed').length,
    cancelledCalls: terminal.filter(event => event.outcome === 'cancelled').length,
    retryLimitedCalls: calls.filter(event => event.retryVisibility === 'unknown').length,
    untrackedRecords, models: [...new Set(calls.map(event => event.actualModel || event.requestedModel))] };
}

export function createHarnessUsageTracker() {
  const events: ModelCallEvent[] = [];
  return { observe: (event: ModelCallEvent): void => { events.push(structuredClone(event)); },
    snapshot: (): ModelCallEvent[] => structuredClone(events),
    summarize: (): HarnessUsageSummary => summarizeHarnessUsage(events, { coverageComplete: true }) };
}

/** Consumption includes error/rejected rows; quality denominators are separate. */
export function aggregateHarnessUsage(records: readonly { usage?: HarnessUsageSummary; modelCalls?: ModelCallEvent[]; error?: string }[]): HarnessUsageSummary {
  const tracked = records.filter(record => record.usage?.measurementVersion === 1 && Array.isArray(record.modelCalls));
  const summary = summarizeHarnessUsage(tracked.flatMap(record => record.modelCalls || []), { coverageComplete: true });
  const untracked = records.length - tracked.length + tracked.reduce((sum, record) => sum + (record.usage?.untrackedRecords || 0), 0);
  if (untracked) {
    summary.untrackedRecords = untracked;
    summary.status = summary.reportedCalls ? 'partial' : 'unavailable';
    if (!summary.reportedCalls) summary.inputTokens = summary.outputTokens = summary.totalTokens = summary.promptTokens = summary.completionTokens = null;
  }
  return summary;
}

export const formatRecordedTokens = (value: number | null): string => value === null ? 'unknown' : value.toLocaleString('en-US');
