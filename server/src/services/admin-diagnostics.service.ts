import { ObjectId, type Document, type Filter } from 'mongodb';
import {
  operationEventsCol, contentRunsCol, questionsCol, questionVersionsCol,
  coursesCol, usersCol, attemptsCol, auditCol, flagsCol,
} from '../components/mongodb/collections';
import type { ContentRun, OperationEvent } from '../types/domain';
import { auditHealth, safeDiagnostic } from './operation-audit.service';
import { resolveParamValues, substituteParams } from './params.service';
import { isServable } from './numeric-gate.service';
import { listModelCalls } from './model-usage.service';
import type { ModelCallReceipt, ModelUsageFilters, ModelUsageSummary, ModelUsageTotals } from '../types/model-usage';

export interface DiagnosticQuery {
  page: number; limit: number; activity?: 'all' | 'actions'; actor?: string; courseId?: string; q?: string;
  outcome?: OperationEvent['outcome']; status?: ContentRun['status'];
  state?: string; from?: string; until?: string; requestId?: string;
}
function dates(query: DiagnosticQuery): Record<string, Date> | undefined {
  if (!query.from && !query.until) return undefined;
  return { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.until ? { $lte: new Date(query.until) } : {}) };
}
function literal(value: string): RegExp { return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
const paging = (query: DiagnosticQuery) => ({ skip: (query.page - 1) * query.limit, limit: query.limit });
function missing(): never { throw Object.assign(new Error('Record not found.'), { status: 404 }); }
const modelUsageNotes = [
  'Counts cover instrumented observed LLM calls. Earlier and unrecorded activity cannot be reconstructed.',
  'Recorded subtotals exclude embeddings, parsing and infrastructure; they are not a monetary bill. Provider SDK retries may remain unobserved.',
  'Recording faults reduce coverage while known. A process crash before any durable write can leave an unreconstructable gap; complete describes retained observation coverage.',
];

async function identities(courseIds: string[], puids: string[]) {
  const [courses, users] = await Promise.all([
    coursesCol().find({ _id: { $in: [...new Set(courseIds)].filter(ObjectId.isValid).map((id) => new ObjectId(id)) } }, { projection: { name: 1, courseCode: 1, section: 1 } }).toArray(),
    usersCol().find({ puid: { $in: [...new Set(puids)] } }, { projection: { puid: 1, uid: 1, displayName: 1 } }).toArray(),
  ]);
  return { courses, users };
}

export async function listOperations(query: DiagnosticQuery) {
  const filter: Filter<OperationEvent> = {};
  if (query.activity === 'actions') filter.$and = [{ $or: [{ method: { $nin: ['GET', 'HEAD'] } }, { outcome: { $ne: 'succeeded' } }] }];
  if (query.actor) filter['actor.puid'] = query.actor;
  if (query.courseId) filter['targets.courseId'] = query.courseId;
  if (query.outcome) filter.outcome = query.outcome;
  if (query.requestId) filter.requestId = query.requestId;
  if (dates(query)) filter.createdAt = dates(query);
  if (query.q) filter.$or = ['requestId', 'route', 'actor.displayName', 'actor.uid', 'actor.puid', 'response.error'].map((key) => ({ [key]: literal(query.q!) }));
  const [items, total, first] = await Promise.all([
    operationEventsCol().find(filter).sort({ createdAt: -1, _id: -1 }).skip(paging(query).skip).limit(query.limit).toArray(),
    operationEventsCol().countDocuments(filter),
    operationEventsCol().find().sort({ createdAt: 1 }).limit(1).project({ createdAt: 1 }).next(),
  ]);
  return { items, total, page: query.page, monitoring: { ...auditHealth(), oldestRecordAt: first?.createdAt ?? null },
    ...await identities(items.map((item) => item.targets.courseId).filter(Boolean), []) };
}

export async function operationDetail(requestId: string) {
  const operation = await operationEventsCol().findOne({ requestId });
  if (!operation) return missing();
  const runs = await contentRunsCol().find({ operationId: requestId }, { projection: { kind: 1, status: 1, stage: 1, courseId: 1, createdAt: 1, error: 1 } }).limit(100).toArray();
  const calls = await listModelCalls({ operationId: requestId, page: 1, limit: 100 });
  return { operation: diagnosticTree(operation), runs: diagnosticTree(runs),
    modelUsage: modelUsageSummaryDto(calls.summary), modelCalls: calls.items.map(modelCallDto), modelCallsTotal: calls.total, modelUsageNotes };
}

const tokenFields = ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens', 'cacheWriteTokens'] as const;
const callCountFields = ['observedCalls', 'reportedCalls', 'callsWithKnownTotal', 'pendingCalls', 'unknownCalls'] as const;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const nonnegativeInteger = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

function modelUsageTotalsDto(value: unknown): ModelUsageTotals {
  const data = object(value);
  return Object.fromEntries([
    ...tokenFields.map(key => [key, nonnegativeInteger(data[key])]),
    ...callCountFields.map(key => [key, nonnegativeInteger(data[key]) ?? 0]),
  ]) as unknown as ModelUsageTotals;
}

/** Usage has a closed numeric DTO; generic credential redaction stays strict. */
export function modelUsageSummaryDto(value: ModelUsageSummary): ModelUsageSummary {
  const data = object(value);
  const malformed = [...tokenFields, ...callCountFields].some(key => data[key] != null && nonnegativeInteger(data[key]) === null);
  const status = ['complete', 'partial', 'pending', 'unavailable'].includes(String(data.status)) ? data.status as ModelUsageSummary['status'] : 'unavailable';
  return {
    ...modelUsageTotalsDto(data), status: malformed ? 'unavailable' : status, scope: 'llm-calls',
    coverageGaps: nonnegativeInteger(data.coverageGaps) ?? 0, untracked: typeof data.untracked === 'boolean' ? data.untracked : true,
    retryVisibility: data.retryVisibility === 'disabled' ? 'disabled' : 'unknown',
    stages: Array.isArray(data.stages) ? data.stages.map(value => ({ ...modelUsageTotalsDto(value), stage: safeDiagnostic(object(value).stage) })) : [],
    models: Array.isArray(data.models) ? data.models.map(value => ({ ...modelUsageTotalsDto(value), provider: safeDiagnostic(object(value).provider), model: safeDiagnostic(object(value).model) })) : [],
  };
}

export function modelCallDto(receipt: ModelCallReceipt): ModelCallReceipt {
  const usage = object(receipt.usage);
  const requestOptions: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(receipt.requestOptions ?? {})) {
    if (/^(maxTokens|max_completion_tokens|max_output_tokens|max_tokens)$/.test(key) && nonnegativeInteger(value) !== null) requestOptions[key] = value as number;
    if (key === 'stream' && typeof value === 'boolean') requestOptions[key] = value;
    if (key === 'temperature' && typeof value === 'number' && Number.isFinite(value)) requestOptions[key] = value;
    if (/^(reasoningEffort|reasoning_effort)$/.test(key) && typeof value === 'string' && /^(none|minimal|low|medium|high|xhigh)$/.test(value)) requestOptions[key] = value;
    if (key === 'responseFormat' && typeof value === 'string' && /^(json|text)$/.test(value)) requestOptions[key] = value;
  }
  return {
    _id: receipt._id, trackingSessionId: receipt.trackingSessionId,
    ...(receipt.operationId ? { operationId: receipt.operationId } : {}), ...(receipt.runId ? { runId: receipt.runId } : {}),
    ...(receipt.courseId ? { courseId: receipt.courseId } : {}),
    ...(receipt.actor ? { actor: { puid: safeDiagnostic(receipt.actor.puid), ...(receipt.actor.uid ? { uid: safeDiagnostic(receipt.actor.uid) } : {}), ...(receipt.actor.displayName ? { displayName: safeDiagnostic(receipt.actor.displayName) } : {}) } } : {}),
    stage: safeDiagnostic(receipt.stage), ...(receipt.item != null ? { item: nonnegativeInteger(receipt.item) ?? undefined } : {}),
    ...(receipt.candidateAttempt != null ? { candidateAttempt: nonnegativeInteger(receipt.candidateAttempt) ?? undefined } : {}),
    ...(receipt.jsonAttempt != null ? { jsonAttempt: nonnegativeInteger(receipt.jsonAttempt) ?? undefined } : {}),
    provider: safeDiagnostic(receipt.provider), requestedModel: safeDiagnostic(receipt.requestedModel), actualModel: receipt.actualModel ? safeDiagnostic(receipt.actualModel) : null,
    responseId: receipt.responseId ? safeDiagnostic(receipt.responseId) : null, requestOptions,
    startedAt: receipt.startedAt, ...(receipt.finishedAt ? { finishedAt: receipt.finishedAt } : {}),
    ...(receipt.durationMs != null ? { durationMs: nonnegativeInteger(receipt.durationMs) ?? undefined } : {}),
    outcome: receipt.outcome, retryVisibility: receipt.retryVisibility === 'disabled' ? 'disabled' : 'unknown',
    usage: {
      inputTokens: nonnegativeInteger(usage.inputTokens), outputTokens: nonnegativeInteger(usage.outputTokens), totalTokens: nonnegativeInteger(usage.totalTokens),
      reasoningTokens: nonnegativeInteger(usage.reasoningTokens), cachedInputTokens: nonnegativeInteger(usage.cachedInputTokens), cacheWriteTokens: nonnegativeInteger(usage.cacheWriteTokens),
      totalOrigin: usage.totalOrigin === 'provider' || usage.totalOrigin === 'derived-from-reported' ? usage.totalOrigin : 'unknown',
      countSource: usage.countSource === 'provider-reported' ? 'provider-reported' : 'unavailable',
    },
  };
}

export async function listAdminModelUsage(query: ModelUsageFilters) {
  const result = await listModelCalls(query);
  return { ...result, items: result.items.map(modelCallDto), summary: modelUsageSummaryDto(result.summary), modelUsageNotes,
    ...await identities(result.items.map(item => item.courseId ? String(item.courseId) : '').filter(Boolean), result.items.map(item => item.actor?.puid ?? '').filter(Boolean)) };
}

// Run snapshots have a fixed internal schema; still redact provider errors and
// embedded URL credentials before serializing them to the diagnostics console.
export function diagnosticTree(value: unknown): unknown {
  if (typeof value === 'string') return safeDiagnostic(value);
  if (value instanceof ObjectId || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(diagnosticTree);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/password|secret|token|apiKey|authorization|cookie/i.test(key))
    .map(([key, item]) => [key, diagnosticTree(item)]));
  return value;
}

export async function listRuns(query: DiagnosticQuery) {
  const filter: Filter<ContentRun> = {};
  if (query.actor) filter.requestedBy = query.actor;
  if (query.courseId) filter.courseId = new ObjectId(query.courseId);
  if (query.status) filter.status = query.status;
  if (query.requestId) filter.operationId = query.requestId;
  if (dates(query)) filter.createdAt = dates(query);
  if (query.q) filter.$or = ['requestedBy', 'kind', 'error.message', 'error.code', 'input.sourceName'].map((key) => ({ [key]: literal(query.q!) }));
  const [items, total] = await Promise.all([
    contentRunsCol().find(filter, { projection: { input: 0, preview: 0, structurePreview: 0, structureResult: 0, events: 0, grounding: 0 } }).sort({ createdAt: -1, _id: -1 }).skip(paging(query).skip).limit(query.limit).toArray(),
    contentRunsCol().countDocuments(filter),
  ]);
  return { items: diagnosticTree(items), total, page: query.page,
    ...await identities(items.map((item) => String(item.courseId)), items.map((item) => item.requestedBy)) };
}

export async function runDetail(id: ObjectId) {
  const run = await contentRunsCol().findOne({ _id: id });
  if (!run) return missing();
  const calls = await listModelCalls({ runId: String(id), page: 1, limit: 100 });
  return { run: diagnosticTree(run), modelUsage: modelUsageSummaryDto(calls.summary), modelCalls: calls.items.map(modelCallDto), modelCallsTotal: calls.total, modelUsageNotes,
    ...await identities([String(run.courseId)], [run.requestedBy]) };
}

export async function listAuditHistory(query: DiagnosticQuery) {
  const filter: Document = {};
  if (query.actor) filter.actorPuid = query.actor;
  if (query.courseId) filter.courseId = new ObjectId(query.courseId);
  if (dates(query)) filter.createdAt = dates(query);
  if (query.q) filter.$or = ['action', 'actorPuid', 'targetType'].map((key) => ({ [key]: literal(query.q!) }));
  const [items, total] = await Promise.all([
    auditCol().find(filter).sort({ createdAt: -1, _id: -1 }).skip(paging(query).skip).limit(query.limit).toArray(),
    auditCol().countDocuments(filter),
  ]);
  return { items: diagnosticTree(items), total, page: query.page };
}

export async function listAllQuestions(query: DiagnosticQuery) {
  const filter: Document = {};
  if (query.courseId) filter.courseId = new ObjectId(query.courseId);
  if (query.state) filter.state = query.state;
  if (dates(query)) filter.createdAt = dates(query);
  // Original version determines creation, even after someone else edits it.
  const pipeline: Document[] = [
    { $match: filter },
    { $lookup: { from: 'questionVersions', localField: 'currentVersionId', foreignField: '_id', as: 'current' } },
    { $unwind: { path: '$current', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'questionVersions', let: { qid: '$_id' }, pipeline: [
      { $match: { $expr: { $eq: ['$questionId', '$$qid'] } } }, { $sort: { version: 1 } }, { $limit: 1 },
      { $project: { createdBy: 1, provenance: 1 } },
    ], as: 'original' } },
    { $unwind: { path: '$original', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'contentRuns', localField: 'original.provenance.runId', foreignField: '_id', as: 'creationRun' } },
    { $addFields: { creator: { $ifNull: [{ $arrayElemAt: ['$creationRun.requestedBy', 0] }, '$original.createdBy'] } } },
  ];
  if (query.actor) pipeline.push({ $match: { creator: query.actor } });
  if (query.q) pipeline.push({ $match: { $or: [{ 'current.stem': literal(query.q) }, { creator: literal(query.q) }, ...(ObjectId.isValid(query.q) ? [{ _id: new ObjectId(query.q) }] : [])] } });
  pipeline.push({ $facet: {
    items: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: paging(query).skip }, { $limit: query.limit }, { $project: {
      courseId: 1, state: 1, currentVersion: 1, currentVersionId: 1, createdAt: 1, creator: 1,
      stem: '$current.stem', type: '$current.type', origin: '$original.provenance', agentDecision: 1,
    } }], count: [{ $count: 'total' }],
  } });
  const [result] = await questionsCol().aggregate<{ items: Array<{ courseId: ObjectId; creator?: string }>; count: Array<{ total: number }> }>(pipeline).toArray();
  const items = result?.items ?? [];
  return { items, total: result?.count[0]?.total ?? 0, page: query.page,
    ...await identities(items.map((item) => String(item.courseId)), items.map((item) => item.creator ?? '')) };
}

export async function questionDiagnostic(id: ObjectId) {
  const question = await questionsCol().findOne({ _id: id });
  if (!question) return missing();
  const versions = await questionVersionsCol().find({ questionId: id }).sort({ version: -1 }).project({
    version: 1, createdBy: 1, createdAt: 1, provenance: 1, editedFields: 1,
  }).toArray();
  const [recentAttempts, recentFlags] = await Promise.all([
    attemptsCol().find({ questionId: id }, { projection: { puid: 1, questionVersionId: 1, createdAt: 1, selectedKey: 1, correct: 1, mode: 1 } }).sort({ createdAt: -1 }).limit(20).toArray(),
    flagsCol().find({ questionId: id }).sort({ createdAt: -1 }).limit(20).toArray(),
  ]);
  return { question, versions, recentAttempts, recentFlags, ...await identities([String(question.courseId)], [...versions.map((v) => v.createdBy as string), ...recentAttempts.map((a) => a.puid)]) };
}

export async function reproduceQuestion(id: ObjectId, input: { versionId?: string; seed: number; attemptId?: string }) {
  const question = await questionsCol().findOne({ _id: id });
  if (!question) return missing();
  const attempt = input.attemptId ? await attemptsCol().findOne({ _id: new ObjectId(input.attemptId), questionId: id, courseId: question.courseId }) : undefined;
  if (input.attemptId && !attempt) return missing();
  const versionId = attempt?.questionVersionId ?? (input.versionId ? new ObjectId(input.versionId) : question.currentVersionId);
  const version = await questionVersionsCol().findOne({ _id: versionId, questionId: id });
  if (!version) return missing();
  let values = attempt?.paramValues;
  let error: string | undefined;
  try {
    // Never synthesize new values for an old attempt with missing evidence.
    if (!attempt) values = await resolveParamValues(version, input.seed);
    else if (!values && (version.generateScript || version.paramSlots?.length)) throw new Error('This attempt did not retain parameter values; an exact replay is unavailable.');
  } catch (cause) { error = safeDiagnostic(cause instanceof Error ? cause.message : 'Parameter evaluation failed.'); }
  const render = (text: string) => values ? substituteParams(text, values) : text;
  const rendered = { stem: render(version.stem), options: version.options.map((option) => ({ ...option, text: render(option.text), explanation: render(option.explanation ?? '') })) };
  const warnings: string[] = [];
  if (!isServable(version)) warnings.push('This version fails the current student content gate.');
  if (new Set(rendered.options.map((option) => option.text.trim())).size !== rendered.options.length) warnings.push('Multiple options display the same text with these values.');
  if (/\{\{/.test(JSON.stringify(rendered))) warnings.push('Unresolved placeholders remain in this sample.');
  return { version, rendered, values: values ?? {}, error, warnings, seed: attempt ? null : input.seed,
    source: attempt ? 'recorded-attempt' : 'seeded-sample',
    attempt: attempt ? { _id: attempt._id, puid: attempt.puid, selectedKey: attempt.selectedKey, correct: attempt.correct, createdAt: attempt.createdAt } : null };
}
