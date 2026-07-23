import type { ObjectId, WithId } from 'mongodb';
import { hasPendingJob } from '../components/jobs';
import { contentRunsCol } from '../components/mongodb/collections';
import type {
  ContentRun,
  ContentRunError,
  ContentRunEvent,
  ContentRunKind,
  ContentRunStatus,
  ContentRunWarning,
  Difficulty,
  Material,
  MaterialIngestResult,
  MaterialIngestRun,
  QuestionGenerationResult,
  QuestionGenerationRun,
  QuestionType,
} from '../types/domain';

const TERMINAL_STATUSES = new Set<ContentRunStatus>(['completed', 'partial', 'failed']);
const MAX_EVENTS = 100;
const MAX_WARNINGS = 50;

const MATERIAL_STAGES: MaterialIngestRun['stage'][] = [
  'queued',
  'parsing',
  'chunking',
  'embedding',
  'indexing',
  'classifying',
];
const GENERATION_STAGES: QuestionGenerationRun['stage'][] = [
  'queued',
  'retrieving',
  'generating',
  'validating',
  'reviewing',
  'persisting',
];

type ContentRunListener = (run: WithId<ContentRun>) => void;
const listenersByCourse = new Map<string, Set<ContentRunListener>>();

export interface ContentRunUpdate {
  status?: ContentRunStatus;
  stage?: ContentRun['stage'];
  completedUnits?: number;
  totalUnits?: number;
  result?: MaterialIngestResult | QuestionGenerationResult;
  grounding?: QuestionGenerationRun['grounding'];
  warning?: Omit<ContentRunWarning, 'at'>;
  error?: ContentRunError;
  eventType?: ContentRunEvent['type'];
  message?: string;
}

function stageOrder(run: ContentRun): readonly string[] {
  return run.kind === 'material-ingest' ? MATERIAL_STAGES : GENERATION_STAGES;
}

function assertLegalUpdate(current: WithId<ContentRun>, update: ContentRunUpdate): void {
  if (TERMINAL_STATUSES.has(current.status)) throw new Error('content-run-conflict');

  const nextStatus = update.status ?? current.status;
  const legalStatus =
    (current.status === 'queued' && (nextStatus === 'running' || nextStatus === 'failed')) ||
    (current.status === 'running' && ['running', 'completed', 'partial', 'failed'].includes(nextStatus));
  if (!legalStatus) throw new Error('content-run-conflict');
  if (nextStatus === 'partial') {
    const result = update.result ?? current.result;
    if (
      current.kind !== 'question-generation' ||
      !result ||
      !('createdQuestionIds' in result) ||
      result.createdQuestionIds.length === 0 ||
      result.failures.length === 0
    ) {
      throw new Error('content-run-conflict');
    }
  }
  if (nextStatus === 'failed' && !update.error) throw new Error('content-run-conflict');

  const nextStage = update.stage ?? current.stage;
  const order = stageOrder(current);
  const currentIndex = order.indexOf(current.stage);
  const nextIndex = order.indexOf(nextStage);
  if (nextIndex === -1 || nextIndex < currentIndex) throw new Error('content-run-conflict');

  const nextCompleted = update.completedUnits ?? current.completedUnits;
  const nextTotal = update.totalUnits ?? current.totalUnits;
  if (nextCompleted < current.completedUnits || nextCompleted < 0) throw new Error('content-run-conflict');
  if (current.totalUnits !== undefined && nextTotal !== undefined && nextTotal < current.totalUnits) {
    throw new Error('content-run-conflict');
  }
  if (nextTotal !== undefined && nextCompleted > nextTotal) throw new Error('content-run-conflict');
}

function initialEvent(run: ContentRun): ContentRunEvent {
  return {
    revision: 0,
    at: run.createdAt,
    type: 'status',
    status: run.status,
    stage: run.stage,
    completedUnits: run.completedUnits,
    ...(run.totalUnits !== undefined ? { totalUnits: run.totalUnits } : {}),
    message: 'Queued',
  };
}

function publish(run: WithId<ContentRun>): void {
  const listeners = listenersByCourse.get(run.courseId.toHexString());
  if (!listeners) return;
  for (const listener of listeners) listener(run);
}

export function subscribeToCourseContentRuns(courseId: ObjectId, listener: ContentRunListener): () => void {
  const key = courseId.toHexString();
  let listeners = listenersByCourse.get(key);
  if (!listeners) {
    listeners = new Set();
    listenersByCourse.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) listenersByCourse.delete(key);
  };
}

export async function createMaterialIngestRun(input: {
  courseId: ObjectId;
  requestedBy: string;
  materialId: ObjectId;
  sourceName: string;
  sourceFormat: Material['format'];
  trigger: 'upload' | 'retry';
  previousRunId?: ObjectId;
}): Promise<WithId<MaterialIngestRun>> {
  const now = new Date();
  const doc: MaterialIngestRun = {
    courseId: input.courseId,
    kind: 'material-ingest',
    requestedBy: input.requestedBy,
    status: 'queued',
    stage: 'queued',
    completedUnits: 0,
    revision: 0,
    events: [],
    warnings: [],
    input: {
      materialId: input.materialId,
      sourceName: input.sourceName,
      sourceFormat: input.sourceFormat,
      trigger: input.trigger,
      ...(input.previousRunId ? { previousRunId: input.previousRunId } : {}),
    },
    createdAt: now,
    updatedAt: now,
  };
  doc.events = [initialEvent(doc)];
  const { insertedId } = await contentRunsCol().insertOne(doc);
  return { _id: insertedId, ...doc };
}

export async function createQuestionGenerationRun(input: {
  courseId: ObjectId;
  requestedBy: string;
  loId: ObjectId;
  count: number;
  type: QuestionType;
  difficulty?: Difficulty;
  prompt?: string;
  models: QuestionGenerationRun['input']['models'];
}): Promise<WithId<QuestionGenerationRun>> {
  const now = new Date();
  const doc: QuestionGenerationRun = {
    courseId: input.courseId,
    kind: 'question-generation',
    requestedBy: input.requestedBy,
    status: 'queued',
    stage: 'queued',
    completedUnits: 0,
    totalUnits: input.count,
    revision: 0,
    events: [],
    warnings: [],
    input: {
      loId: input.loId,
      count: input.count,
      type: input.type,
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      models: input.models,
    },
    result: { createdQuestionIds: [], failures: [] },
    createdAt: now,
    updatedAt: now,
  };
  doc.events = [initialEvent(doc)];
  const { insertedId } = await contentRunsCol().insertOne(doc);
  return { _id: insertedId, ...doc };
}

export async function getContentRun(runId: ObjectId): Promise<WithId<ContentRun> | null> {
  return contentRunsCol().findOne({ _id: runId });
}

export async function getCourseContentRun(courseId: ObjectId, runId: ObjectId): Promise<WithId<ContentRun> | null> {
  return contentRunsCol().findOne({ _id: runId, courseId });
}

export async function listCourseContentRuns(
  courseId: ObjectId,
  filters: { kind?: ContentRunKind; status?: ContentRunStatus; limit?: number } = {},
): Promise<Array<WithId<ContentRun>>> {
  return contentRunsCol()
    .find({
      courseId,
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    })
    .sort({ createdAt: -1 })
    .limit(filters.limit ?? 25)
    .toArray();
}

export async function updateContentRun(runId: ObjectId, update: ContentRunUpdate): Promise<WithId<ContentRun>> {
  const current = await getContentRun(runId);
  if (!current) throw new Error('content-run-not-found');
  assertLegalUpdate(current, update);

  const now = new Date();
  const nextStatus = update.status ?? current.status;
  const nextStage = update.stage ?? current.stage;
  const nextCompleted = update.completedUnits ?? current.completedUnits;
  const nextTotal = update.totalUnits ?? current.totalUnits;
  const nextRevision = current.revision + 1;
  const event: ContentRunEvent = {
    revision: nextRevision,
    at: now,
    type: update.eventType ?? (nextStatus !== current.status ? 'status' : nextStage !== current.stage ? 'stage' : 'progress'),
    status: nextStatus,
    stage: nextStage,
    completedUnits: nextCompleted,
    ...(nextTotal !== undefined ? { totalUnits: nextTotal } : {}),
    ...(update.message ? { message: update.message } : {}),
  };

  const set: Record<string, unknown> = {
    status: nextStatus,
    stage: nextStage,
    completedUnits: nextCompleted,
    revision: nextRevision,
    updatedAt: now,
    events: [...current.events, event].slice(-MAX_EVENTS),
  };
  if (nextTotal !== undefined) set.totalUnits = nextTotal;
  if (current.status === 'queued' && nextStatus === 'running') set.startedAt = now;
  if (TERMINAL_STATUSES.has(nextStatus)) set.completedAt = now;
  if (update.error) set.error = update.error;
  if (update.result) set.result = update.result;
  if (update.grounding) set.grounding = update.grounding;
  if (update.warning) {
    set.warnings = [...current.warnings, { ...update.warning, at: now }].slice(-MAX_WARNINGS);
  }

  const next = await contentRunsCol().findOneAndUpdate(
    { _id: runId, revision: current.revision, status: current.status },
    { $set: set },
    { returnDocument: 'after' },
  );
  if (!next) throw new Error('content-run-conflict');
  publish(next);
  return next;
}

export async function failContentRun(
  runId: ObjectId,
  error: ContentRunError,
  result?: MaterialIngestResult | QuestionGenerationResult,
): Promise<WithId<ContentRun>> {
  const current = await getContentRun(runId);
  if (!current) throw new Error('content-run-not-found');
  if (TERMINAL_STATUSES.has(current.status)) return current;
  return updateContentRun(runId, {
    status: 'failed',
    error,
    ...(result ? { result } : {}),
    message: error.message,
  });
}

export async function reconcileContentRuns(): Promise<{ interrupted: number; missingJobs: number }> {
  const [running, queued] = await Promise.all([
    contentRunsCol().find({ status: 'running' }).toArray(),
    contentRunsCol().find({ status: 'queued' }).toArray(),
  ]);
  let interrupted = 0;
  let missingJobs = 0;

  for (const run of running) {
    await failContentRun(run._id, {
      code: 'server-restarted',
      message: 'The server restarted while this run was active. Start it again.',
      atStage: run.stage,
      retryable: true,
    }, run.result);
    interrupted += 1;
  }

  for (const run of queued) {
    const name = run.kind === 'material-ingest' ? 'material.ingest' : 'generation.run';
    if (await hasPendingJob(name, run._id.toHexString())) continue;
    await failContentRun(run._id, {
      code: 'content-run-job-missing',
      message: 'The queued background job could not be found. Start this run again.',
      atStage: run.stage,
      retryable: true,
    }, run.result);
    missingJobs += 1;
  }

  return { interrupted, missingJobs };
}
