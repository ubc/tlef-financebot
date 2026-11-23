import type { ObjectId } from 'mongodb';
import { operationEventsCol } from '../components/mongodb/collections';
import { getQuestionDetail } from './bank.service';
import { estimateModelCost } from './model-cost';
import { readModelUsage, summarizeReceipts } from './model-usage.service';

const ALTERNATIVE_LIMIT = 500;

export async function questionGenerationUsage(questionId: ObjectId) {
  const { question, current, versions } = await getQuestionDetail(questionId);
  const courseId = question.courseId.toHexString();
  const origin = current.provenance?.kind === 'generated' ? current.provenance
    : versions.find(version => version.provenance?.kind === 'generated')?.provenance;
  const history = question.regenerations ?? [];
  const [run, events] = await Promise.all([
    origin?.kind === 'generated' ? readModelUsage({ courseId, runId: String(origin.runId) }) : null,
    operationEventsCol().find({
      'targets.courseId': courseId, 'targets.questionId': questionId.toHexString(), method: 'POST',
      route: '/courses/:courseId/questions/:questionId/regenerate',
    }, { projection: { requestId: 1 } }).sort({ createdAt: -1 }).limit(ALTERNATIVE_LIMIT + 1).toArray(),
  ]);
  const operationIds = new Set([...history.slice(-ALTERNATIVE_LIMIT).flatMap(row => row.operationId ? [row.operationId] : []),
    ...events.slice(0, ALTERNATIVE_LIMIT).map(event => event.requestId)]);
  const alternativeRun = operationIds.size ? await readModelUsage({ courseId, operationIds: [...operationIds] }) : null;
  const alternatives = alternativeRun ? { ...alternativeRun.summary, cost: estimateModelCost(alternativeRun.receipts) } : null;
  const recordedOperations = new Set(alternativeRun?.receipts.map(call => call.operationId));
  const alternativesPartial = events.length > ALTERNATIVE_LIMIT || history.length > ALTERNATIVE_LIMIT
    || history.some(row => row.operationId && !recordedOperations.has(row.operationId))
    || history.length > recordedOperations.size;

  if (origin?.kind !== 'generated' || !run) return { original: null, alternatives, alternativesPartial };
  const calls = Number.isSafeInteger(origin.item) && origin.item >= 0 ? run.receipts.filter(call => call.item === origin.item) : [];
  const wholeTask = calls.length === 0 && run.receipts.length > 0;
  const relevantSessions = new Set(calls.map(call => call.trackingSessionId));
  const summary = wholeTask ? run.summary : summarizeReceipts(calls,
    run.sessions.filter(session => relevantSessions.has(session._id)), { checkExpected: false });
  return {
    original: {
      runId: String(origin.runId), wholeTask, partial: summary.status !== 'complete' || run.summary.coverageGaps > 0
        || run.receipts.some(call => call.item === undefined),
      summary: { ...summary, cost: estimateModelCost(wholeTask ? run.receipts : calls) },
    },
    alternatives, alternativesPartial,
  };
}
