import type { ObjectId } from 'mongodb';
import { contentRunsCol, operationEventsCol } from '../components/mongodb/collections';
import { env } from '../config/env';
import type { QuestionGenerationRun } from '../types/domain';
import type { ModelCallReceipt } from '../types/model-usage';
import { getPlatformSettings } from './admin.service';
import { estimateModelCost, modelTokenCost } from './model-cost';
import { readModelUsage, summarizeReceipts } from './model-usage.service';
import { stepModelsFrom } from './step-models';

const RUN_LIMIT = 10_000;
const COMPARE_LIMIT = 500;

function groupBy<T>(rows: T[], keyFor: (row: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = keyFor(row);
    if (!id) continue;
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

export async function courseGenerationCost(courseId: ObjectId) {
  const [{ receipts, sessions, summary }, runs, comparisons, settings] = await Promise.all([
    readModelUsage({ courseId: courseId.toHexString() }),
    contentRunsCol().find({ courseId, kind: 'question-generation' }, { projection: { 'result.createdQuestionIds': 1, status: 1 } })
      .sort({ createdAt: -1 }).limit(RUN_LIMIT + 1).toArray(),
    operationEventsCol().find({
      'targets.courseId': courseId.toHexString(), method: 'POST', route: '/courses/:courseId/questions/:questionId/regenerate',
    }, { projection: { requestId: 1, outcome: 1 } }).sort({ createdAt: -1 }).limit(COMPARE_LIMIT + 1).toArray(),
    getPlatformSettings(courseId),
  ]);
  const callsByRun = groupBy(receipts, call => call.runId);
  const sessionsByRun = groupBy(sessions, session => session.runId);
  const callsByRequest = groupBy(receipts, call => call.runId ? undefined : call.operationId);
  const sessionsByRequest = groupBy(sessions, session => session.runId ? undefined : session.operationId);
  const draftCalls: ModelCallReceipt[] = [];
  const alternativeCalls: ModelCallReceipt[] = [];
  let savedDrafts = 0;
  let measuredAlternatives = 0;
  let incompleteHistory = runs.length > RUN_LIMIT || comparisons.length > COMPARE_LIMIT;
  let generationTokens: number | null = null;
  function addGenerationTokens(calls: ModelCallReceipt[]): void {
    for (const call of calls) {
      if (call.usage.totalTokens !== null) generationTokens = (generationTokens ?? 0) + call.usage.totalTokens;
    }
  }
  for (const run of runs.slice(0, RUN_LIMIT)) {
    const id = run._id.toHexString();
    const calls = callsByRun.get(id) ?? [];
    addGenerationTokens(calls);
    if (!['completed', 'partial', 'failed'].includes(run.status)) continue;
    const saved = (run as QuestionGenerationRun).result?.createdQuestionIds?.length ?? 0;
    if (summarizeReceipts(calls, sessionsByRun.get(id) ?? []).status !== 'complete') {
      if (saved || calls.length) incompleteHistory = true;
      continue;
    }
    draftCalls.push(...calls);
    savedDrafts += saved;
  }
  for (const request of comparisons.slice(0, COMPARE_LIMIT)) {
    const calls = callsByRequest.get(request.requestId) ?? [];
    addGenerationTokens(calls);
    if (request.outcome !== 'succeeded') continue;
    if (!calls.length || summarizeReceipts(calls, sessionsByRequest.get(request.requestId) ?? []).status !== 'complete') {
      incompleteHistory = true;
      continue;
    }
    alternativeCalls.push(...calls);
    measuredAlternatives++;
  }
  const sampleCalls = savedDrafts ? draftCalls : alternativeCalls;
  const sampleSize = savedDrafts || measuredAlternatives;
  const sampleKind = savedDrafts ? 'saved-question' : 'alternative';
  const totalCost = estimateModelCost(receipts);
  const historical = estimateModelCost(sampleCalls);
  const models = stepModelsFrom(settings);
  const generator = models.generator.model;
  const checker = models.reviewer.model;
  let forecastTotalUsd: number | null = 0;
  let measuredTokens = 0;
  for (const call of sampleCalls) {
    measuredTokens += call.usage.totalTokens ?? 0;
    const model = call.stage === 'generation' || call.stage === 'repair' ? generator
      : call.stage === 'check' ? checker : undefined;
    const estimate = model && call.usage.inputTokens !== null && call.usage.outputTokens !== null
      ? modelTokenCost(env.llmProvider, model, call.usage.inputTokens, call.usage.outputTokens) : null;
    forecastTotalUsd = forecastTotalUsd === null || estimate === null ? null : forecastTotalUsd + estimate;
  }
  const averageTokens = sampleSize ? Math.round(measuredTokens / sampleSize) : null;
  return {
    total: { ...totalCost, tokens: summary.totalTokens, partial: incompleteHistory || summary.status !== 'complete' || totalCost.unpricedCalls > 0 },
    generationTokens,
    average: averageTokens !== null ? {
      tokens: averageTokens,
      estimatedUsd: historical.unpricedCalls || historical.estimatedUsd === null ? null : historical.estimatedUsd / sampleSize,
      sampleSize, sampleKind,
    } : null,
    forecast: {
      generator, checker,
      tokens: averageTokens,
      estimatedUsd: sampleSize && forecastTotalUsd !== null ? forecastTotalUsd / sampleSize : null,
    },
  };
}
