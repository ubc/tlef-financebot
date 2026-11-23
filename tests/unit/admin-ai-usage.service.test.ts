import { ObjectId } from 'mongodb';
import { buildAdminAiUsage } from '../../server/src/services/admin-ai-usage.service';
import { summarizeReceipts } from '../../server/src/services/model-usage.service';
import type { ModelCallReceipt, ModelUsageSession } from '../../server/src/types/model-usage';

it('reconciles course totals, retains unattributed calls, and excludes incomplete runs from weighted question averages', () => {
  const physics = new ObjectId();
  const finance = new ObjectId();
  const startedAt = new Date('2026-11-08T12:00:00Z');
  const run = (courseId: ObjectId, saves: number) => ({
    _id: new ObjectId(), courseId, status: 'completed' as const, createdAt: startedAt, completedAt: startedAt,
    result: { createdQuestionIds: Array.from({ length: saves }, () => new ObjectId()), failures: [] },
  });
  const runs = [run(physics, 1), run(finance, 3), run(physics, 5)];
  const pair = (id: string, input: number, output: number, model: string, task?: typeof runs[number]) => {
    const receipt: ModelCallReceipt = {
      _id: id, trackingSessionId: 'session-' + id, runId: task?._id.toHexString(), courseId: task?.courseId,
      stage: 'generation', provider: 'openai', requestedModel: model, actualModel: model,
      responseId: null, requestOptions: {}, startedAt, outcome: 'succeeded', retryVisibility: 'disabled',
      usage: { inputTokens: input, outputTokens: output, totalTokens: input + output, reasoningTokens: null, cachedInputTokens: null,
        cacheWriteTokens: null, countSource: 'provider-reported', totalOrigin: 'provider' },
    };
    const session: ModelUsageSession = {
      _id: receipt.trackingSessionId, runId: receipt.runId, courseId: receipt.courseId,
      startedAt, expectedCallIds: [id], closedCleanly: true, recordingFailed: false,
    };
    return { receipt, session };
  };
  const items = [
    pair('one', 1000, 500, 'gpt-6-luna', runs[0]),
    pair('two', 4000, 500, 'gpt-6.1-sol', runs[1]),
    pair('clipped', 300, 100, 'gpt-6-luna', runs[2]),
    pair('unattributed', 999, 1, 'unknown-model'),
  ];
  const receipts = items.map(item => item.receipt);
  const sessions = items.map(item => item.session);
  const fullSessions = sessions.map(session => session === sessions[2] ? { ...session, expectedCallIds: ['clipped', 'outside-window'] } : session);
  const summary = summarizeReceipts(receipts, sessions);
  const data = buildAdminAiUsage({ receipts, sessions, fullSessions, summary, truncated: false }, runs, {});
  expect(data.summary.totalTokens).toBe(7400);
  expect(data.summary.cost.unpricedCalls).toBe(1);
  expect(data.average).toMatchObject({ tokens: 1500, savedQuestions: 4 });
  expect(data.average?.estimatedUsd).toBeCloseTo(0.0033375, 9);
  expect(data.courses.find(row => row.courseId === physics.toHexString())).toMatchObject({ tokens: 1900, average: { tokens: 1500, savedQuestions: 1 } });
  expect(data.courses.find(row => row.courseId === null)).toMatchObject({ tokens: 1000, estimatedUsd: null, average: null, partial: true });
});
