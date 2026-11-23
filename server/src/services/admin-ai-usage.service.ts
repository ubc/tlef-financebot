import { ObjectId } from 'mongodb';
import { contentRunsCol, coursesCol } from '../components/mongodb/collections';
import type { QuestionGenerationRun } from '../types/domain';
import type { ModelUsageFilters } from '../types/model-usage';
import { estimateModelCost } from './model-cost';
import { readModelUsage, summarizeReceipts } from './model-usage.service';

type Scope = Pick<ModelUsageFilters, 'from' | 'until'>;
type QuestionRun = Pick<QuestionGenerationRun, 'courseId' | 'status' | 'result' | 'createdAt' | 'completedAt'> & { _id: ObjectId };
type Usage = Awaited<ReturnType<typeof readModelUsage>>;

function groupBy<T>(rows: readonly T[], keyFor: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

type Sample = { savedQuestions: number; tokens: number; usd: number; fullyPriced: boolean };
const newSample = (): Sample => ({ savedQuestions: 0, tokens: 0, usd: 0, fullyPriced: true });
const courseKey = (row: { courseId?: ObjectId }) => row.courseId?.toString() ?? '';
const terminal = new Set(['completed', 'partial', 'failed']);

function average(sample: Sample) {
  return sample.savedQuestions ? {
    savedQuestions: sample.savedQuestions,
    tokens: Math.round(sample.tokens / sample.savedQuestions),
    estimatedUsd: sample.fullyPriced ? sample.usd / sample.savedQuestions : null,
  } : null;
}

export function buildAdminAiUsage(usage: Usage, runs: QuestionRun[], scope: Scope) {
  const { receipts, sessions, fullSessions, summary, truncated } = usage;
  const callsByRun = groupBy(receipts.filter(call => call.runId), call => call.runId!);
  const sessionsByRun = groupBy(fullSessions.filter(session => session.runId), session => session.runId!);
  const samples = new Map<string, Sample>();
  const overall = newSample();
  const from = scope.from ? Date.parse(scope.from) : -Infinity;
  const until = scope.until ? Date.parse(scope.until) : Infinity;

  for (const run of runs) {
    const key = courseKey(run);
    if (!key || !terminal.has(run.status) || +run.createdAt < from
      || (scope.until && (!run.completedAt || +run.completedAt > until))) continue;
    const id = run._id.toHexString();
    const calls = (callsByRun.get(id) ?? []).filter(call => courseKey(call) === key);
    if (!calls.length) continue;
    const coverage = summarizeReceipts(calls, (sessionsByRun.get(id) ?? []).filter(session => courseKey(session) === key));
    if (coverage.status !== 'complete' || coverage.totalTokens === null) continue;
    const cost = estimateModelCost(calls);
    const sample = samples.get(key) ?? newSample();
    for (const target of [sample, overall]) {
      target.savedQuestions += run.result?.createdQuestionIds?.length ?? 0;
      target.tokens += coverage.totalTokens;
      target.usd += cost.estimatedUsd ?? 0;
      target.fullyPriced &&= cost.unpricedCalls === 0 && cost.estimatedUsd !== null;
    }
    samples.set(key, sample);
  }

  const callsByCourse = groupBy(receipts, courseKey);
  const sessionsByCourse = groupBy(sessions, courseKey);
  const courses = [...new Set([...callsByCourse.keys(), ...sessionsByCourse.keys()])].map(key => {
    const calls = callsByCourse.get(key) ?? [];
    const row = summarizeReceipts(calls, sessionsByCourse.get(key) ?? [], { truncated });
    const cost = estimateModelCost(calls);
    return {
      courseId: key || null,
      tokens: row.totalTokens,
      observedCalls: row.observedCalls,
      estimatedUsd: cost.estimatedUsd,
      partial: row.status !== 'complete' || cost.unpricedCalls > 0,
      average: average(samples.get(key) ?? newSample()),
    };
  });
  return {
    summary: { ...summary, cost: estimateModelCost(receipts) },
    truncated,
    average: average(overall),
    courses,
  };
}

export async function getAdminAiUsage(scope: Scope) {
  const usage = await readModelUsage(scope);
  const runIds = [...new Set(usage.receipts.flatMap(call => call.runId && ObjectId.isValid(call.runId) ? [call.runId] : []))];
  const courseIds = [...new Set([...usage.receipts, ...usage.sessions].map(courseKey).filter(key => ObjectId.isValid(key)))];
  const [runs, courses] = await Promise.all([
    runIds.length ? contentRunsCol().find<QuestionRun>({ _id: { $in: runIds.map(id => new ObjectId(id)) }, kind: 'question-generation' },
      { projection: { courseId: 1, status: 1, 'result.createdQuestionIds': 1, createdAt: 1, completedAt: 1 } }).toArray() : [],
    courseIds.length ? coursesCol().find({ _id: { $in: courseIds.map(id => new ObjectId(id)) } },
      { projection: { courseCode: 1, name: 1, section: 1, term: 1 } }).toArray() : [],
  ]);
  const names = new Map(courses.map(course => [course._id.toHexString(), course]));
  const result = buildAdminAiUsage(usage, runs, scope);
  return { ...result, courses: result.courses.map(row => {
    const course = row.courseId ? names.get(row.courseId) : undefined;
    return { ...row, courseCode: course?.courseCode, name: course?.name, section: course?.section, term: course?.term };
  }) };
}
