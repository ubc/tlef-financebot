import { ObjectId } from 'mongodb';
jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(), questionVersionsCol: jest.fn(), attemptsCol: jest.fn(), operationEventsCol: jest.fn(),
  contentRunsCol: jest.fn(), coursesCol: jest.fn(), usersCol: jest.fn(),
}));
jest.mock('../../server/src/services/model-usage.service', () => ({ listModelCalls: jest.fn() }));
import { questionsCol, questionVersionsCol, attemptsCol, contentRunsCol, coursesCol, usersCol, operationEventsCol } from '../../server/src/components/mongodb/collections';
import { reproduceQuestion, diagnosticTree, modelUsageSummaryDto, modelCallDto, operationDetail, runDetail, listAdminModelUsage } from '../../server/src/services/admin-diagnostics.service';
import { listModelCalls } from '../../server/src/services/model-usage.service';
import type { ModelCallReceipt, ModelUsageSummary } from '../../server/src/types/model-usage';
const questionId = new ObjectId(); const courseId = new ObjectId(); const currentId = new ObjectId(); const oldId = new ObjectId();
const findQuestion = jest.fn(), findVersion = jest.fn(), findAttempt = jest.fn();
const findRun = jest.fn(), findOperation = jest.fn();
const runCursor = { limit: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) };
const identityCursor = { toArray: jest.fn().mockResolvedValue([]) };
const summary = {
  inputTokens: 30, outputTokens: 20, totalTokens: 50, reasoningTokens: null, cachedInputTokens: 0, cacheWriteTokens: null,
  observedCalls: 1, reportedCalls: 1, callsWithKnownTotal: 1, pendingCalls: 0, unknownCalls: 0,
  status: 'complete', scope: 'llm-calls', coverageGaps: 0, untracked: false, retryVisibility: 'unknown', stages: [], models: [],
} as ModelUsageSummary;
const version = { _id: oldId, questionId, version: 1, type: 'mcq', stem: 'Value {{x}}',
  options: [{ key: 'A', text: '{{x}}', role: 'correct', explanation: '{{x}}' }],
  paramSlots: [{ name: 'x', values: [10, 20, 30] }], createdBy: 'author', createdAt: new Date() };
beforeEach(() => {
  jest.mocked(questionsCol).mockReturnValue({ findOne: findQuestion } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne: findVersion } as never);
  jest.mocked(attemptsCol).mockReturnValue({ findOne: findAttempt } as never);
  findQuestion.mockResolvedValue({ _id: questionId, courseId, currentVersionId: currentId });
  findVersion.mockResolvedValue(version); findAttempt.mockResolvedValue(null);
  jest.mocked(contentRunsCol).mockReturnValue({ findOne: findRun, find: jest.fn().mockReturnValue(runCursor) } as never);
  jest.mocked(operationEventsCol).mockReturnValue({ findOne: findOperation } as never);
  jest.mocked(coursesCol).mockReturnValue({ find: jest.fn().mockReturnValue(identityCursor) } as never);
  jest.mocked(usersCol).mockReturnValue({ find: jest.fn().mockReturnValue(identityCursor) } as never);
  jest.mocked(listModelCalls).mockResolvedValue({ items: [], total: 0, page: 1, summary });
  findRun.mockResolvedValue({ _id: currentId, courseId, requestedBy: 'teacher' });
  findOperation.mockResolvedValue({ requestId: 'request', response: {} });
});
it('pins the requested version and seed rather than silently loading current', async () => {
  const a = await reproduceQuestion(questionId, { versionId: String(oldId), seed: 99 });
  const b = await reproduceQuestion(questionId, { versionId: String(oldId), seed: 99 });
  expect(findVersion).toHaveBeenCalledWith({ _id: oldId, questionId });
  expect(a.rendered).toEqual(b.rendered);
  expect(a.values).toEqual(b.values);
  expect(a.rendered.stem).not.toContain('{{');
});
it('replays recorded values and pinned version even if a different seed is supplied', async () => {
  const attemptId = new ObjectId();
  findAttempt.mockResolvedValue({ _id: attemptId, questionVersionId: oldId, paramValues: { x: 123 }, selectedKey: 'A' });
  const result = await reproduceQuestion(questionId, { attemptId: String(attemptId), seed: 87 });
  expect(findAttempt).toHaveBeenCalledWith({ _id: attemptId, questionId, courseId });
  expect(result.rendered.stem).toBe('Value 123');
  expect(result.seed).toBeNull();
  expect(result.source).toBe('recorded-attempt');
});
it('refuses a missing or wrong-question attempt instead of producing new evidence', async () => {
  await expect(reproduceQuestion(questionId, { attemptId: String(new ObjectId()), seed: 1 })).rejects.toMatchObject({ status: 404 });
  expect(findVersion).not.toHaveBeenCalled();
});
it('reports missing attempt parameters and formula failures explicitly', async () => {
  findAttempt.mockResolvedValue({ _id: new ObjectId(), questionVersionId: oldId });
  expect((await reproduceQuestion(questionId, { attemptId: String(new ObjectId()), seed: 1 })).error).toContain('exact replay is unavailable');
  findVersion.mockResolvedValue({ ...version, derivedValues: [{ name: 'bad', formula: 'does_not_exist + 1' }] });
  expect((await reproduceQuestion(questionId, { seed: 1 })).error).toBeTruthy();
});
it('redacts credentials throughout nested diagnostic snapshots', () => {
  expect(diagnosticTree({ input: { password: 'secret', count: 3 }, error: { message: 'Bearer secret' }, _id: oldId })).toEqual({ input: { count: 3 }, error: { message: '[redacted authorization]' }, _id: oldId });
});
it('preserves only validated numeric usage through a separate DTO', () => {
  expect(diagnosticTree({ totalTokens: 50, apiKey: 'secret' })).toEqual({});
  expect(modelUsageSummaryDto({ ...summary, apiKey: 'secret' } as ModelUsageSummary)).toEqual(summary);
  const result = modelUsageSummaryDto({ ...summary, inputTokens: 'secret', outputTokens: Infinity, totalTokens: NaN, cachedInputTokens: 0 } as unknown as ModelUsageSummary);
  expect(result).toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: 0, status: 'unavailable' });
  expect(JSON.stringify(result)).not.toContain('secret');
});
it('projects receipts without private prompts, outputs, credentials or arbitrary token fields', () => {
  const receipt = {
    _id: 'call', trackingSessionId: 'session', stage: 'generator', provider: 'openai', requestedModel: 'model', actualModel: 'model', responseId: null,
    requestOptions: { temperature: 0, max_completion_tokens: 100, apiKey: 'secret', systemPrompt: 'private prompt', maxTokens: 'secret' },
    startedAt: new Date(), outcome: 'succeeded', retryVisibility: 'unknown',
    usage: { inputTokens: 30, outputTokens: 20, totalTokens: 50, reasoningTokens: null, cachedInputTokens: 0, cacheWriteTokens: null, totalOrigin: 'provider', countSource: 'provider-reported', accessToken: 'secret' },
    prompt: 'private prompt', output: 'private response',
  } as unknown as ModelCallReceipt;
  const result = modelCallDto(receipt);
  expect(result.requestOptions).toEqual({ temperature: 0, max_completion_tokens: 100 });
  expect(result.usage).toMatchObject({ totalTokens: 50, cachedInputTokens: 0 });
  expect(JSON.stringify(result)).not.toMatch(/private prompt|private response|secret|accessToken|apiKey/);
});
it('joins bounded request and run calls while retaining the complete scoped summary', async () => {
  await operationDetail('request');
  expect(listModelCalls).toHaveBeenCalledWith({ operationId: 'request', page: 1, limit: 100 });
  const result = await runDetail(currentId);
  expect(listModelCalls).toHaveBeenCalledWith({ runId: String(currentId), page: 1, limit: 100 });
  expect(result.modelUsage.totalTokens).toBe(50);
  expect(result.modelCallsTotal).toBe(0);
});
it('keeps legacy unavailable usage explicit and forwards selected Admin filters', async () => {
  jest.mocked(listModelCalls).mockResolvedValue({ items: [], total: 0, page: 1, summary: { ...summary, status: 'unavailable', untracked: true, inputTokens: null, outputTokens: null, totalTokens: null } });
  const filters = { actor: 'teacher', courseId: String(courseId), from: '2026-10-01T00:00:00Z', limit: 20 };
  const result = await listAdminModelUsage(filters);
  expect(listModelCalls).toHaveBeenCalledWith(filters);
  expect(result.summary).toMatchObject({ status: 'unavailable', untracked: true, totalTokens: null });
});
