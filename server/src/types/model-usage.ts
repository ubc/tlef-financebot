import type { ObjectId } from 'mongodb';
import type { ModelUsage } from '../components/genai/llm';

export type { ModelUsage } from '../components/genai/llm';

export interface ModelUsageScope {
  operationId?: string;
  runId?: string;
  courseId?: string;
  actor?: { puid: string; uid?: string; displayName?: string };
  stage?: string;
}

export interface ModelCallReceipt {
  _id: string;
  trackingSessionId: string;
  operationId?: string;
  runId?: string;
  courseId?: ObjectId;
  actor?: ModelUsageScope['actor'];
  stage: string;
  item?: number;
  candidateAttempt?: number;
  jsonAttempt?: number;
  provider: string;
  requestedModel: string;
  actualModel: string | null;
  responseId: string | null;
  requestOptions: Record<string, string | number | boolean>;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  outcome: 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  usage: ModelUsage;
  retryVisibility: 'disabled' | 'unknown';
}

export interface ModelUsageSession {
  _id: string;
  operationId?: string;
  runId?: string;
  courseId?: ObjectId;
  actor?: ModelUsageScope['actor'];
  startedAt: Date;
  closedAt?: Date;
  expectedCallIds: string[];
  closedCleanly: boolean;
  recordingFailed: boolean;
}

export interface ModelUsageFilters {
  actor?: string;
  courseId?: string;
  runId?: string;
  operationId?: string;
  from?: string;
  until?: string;
  page?: number;
  limit?: number;
}

export interface ModelUsageTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  observedCalls: number;
  reportedCalls: number;
  callsWithKnownTotal: number;
  pendingCalls: number;
  unknownCalls: number;
}

export interface ModelUsageSummary extends ModelUsageTotals {
  status: 'complete' | 'partial' | 'pending' | 'unavailable';
  scope: 'llm-calls';
  coverageGaps: number;
  untracked: boolean;
  retryVisibility: 'disabled' | 'unknown';
  stages: Array<ModelUsageTotals & { stage: string }>;
  models: Array<ModelUsageTotals & { provider: string; model: string }>;
}
