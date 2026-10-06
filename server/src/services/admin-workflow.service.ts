import { ObjectId, type Filter, type WithId } from 'mongodb';
import { contentRunsCol, coursesCol, materialsCol, operationEventsCol, usersCol } from '../components/mongodb/collections';
import type { ContentRun, Material, OperationEvent } from '../types/domain';
import { safeDiagnostic } from './operation-audit.service';

export interface WorkflowQuery {
  actor?: string;
  courseId?: string;
  from?: string;
  until?: string;
  page: number;
  limit: number;
}

export interface WorkflowRelation {
  kind: 'operation-run';
  confidence: 'recorded';
  requestId: string;
  runId: string;
  evidence: 'persisted-operation-id' | 'recorded-run-id';
}

export interface WorkflowEntry {
  id: string;
  kind: 'operation' | 'run';
  createdAt: Date;
  endedAt?: Date;
  label: string;
  outcome: string;
  actorPuid?: string;
  courseId?: string;
  requestId?: string;
  runId?: string;
  method?: string;
  route?: string;
  durationMs?: number;
  targets: Record<string, string>;
  material?: { id: string; name: string };
  materials?: Array<{ id: string; name: string }>;
  relations: WorkflowRelation[];
}

export interface WorkflowGroup {
  id: string;
  actorPuid?: string;
  courseId?: string;
  startedAt: Date;
  endedAt: Date;
  grouping: 'inferred-time-window';
  entries: WorkflowEntry[];
}

const WINDOW_MINUTES = 30;
const MAX_OPERATIONS = 1000;
const MAX_RUNS = 500;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const validRequestId = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);

/** Labels describe recorded API operations, never an assumed browser click. */
export function workflowActionLabel(operation: OperationEvent): string {
  const route = operation.route.replace(/^\/api(?=\/)/, '');
  const method = operation.method.toUpperCase();
  const labels: Record<string, string> = {
    'POST /courses/:courseId/materials': 'Upload or add course material',
    'POST /materials/:materialId/retry': 'Retry material ingestion',
    'POST /courses/:courseId/structure-generation': 'Request learning objective extraction',
    'GET /courses/:courseId/suggest-hierarchy': 'Request hierarchy suggestion',
    'POST /courses/:courseId/apply-suggested-hierarchy': 'Apply reviewed course structure',
    'POST /courses/:courseId/generate': 'Request question generation',
    'POST /courses/:courseId/generation-plan': 'Request a question generation batch',
    'POST /courses/:courseId/generation-blueprints/:blueprintId/run': 'Run a generation recipe',
    'POST /courses/:courseId/content-runs/:runId/retry': 'Retry a generation run',
    'POST /courses/:courseId/content-runs/:runId/end': 'End a generation run',
    'POST /courses/:courseId/content-runs/end-active': 'End active generation runs',
    'POST /courses/:courseId/questions/:questionId/regenerate': 'Request a replacement question',
    'GET /courses/:courseId/review-queue': 'Read the review queue',
    'GET /courses/:courseId/questions': 'Read the question bank',
    'GET /questions/:questionId': 'Read a question',
    'PATCH /questions/:questionId': 'Save question edits',
    'PATCH /questions/:questionId/params': 'Save question parameters',
    'POST /questions/:questionId/internal-notes': 'Add an internal review note',
    'POST /questions/bulk-transition': 'Change question states in bulk',
  };
  if (method === 'POST' && route === '/questions/:questionId/transition') {
    const state = operation.input.to;
    return state === 'approved' ? 'Approve a question' : state === 'reviewed' ? 'Mark a question reviewed' : 'Change a question state';
  }
  return labels[`${method} ${route}`] ?? (method === 'CLIENT' ? 'Recorded browser error' : `Observed ${method} request`);
}

function operationRunIds(operation: OperationEvent): string[] {
  return [...new Set([operation.targets.runId, operation.response.runId, ...(Array.isArray(operation.response.runIds) ? operation.response.runIds : [])].filter(validId))];
}

function operationMaterialIds(operation: OperationEvent): string[] {
  return [...new Set([operation.targets.materialId, ...(Array.isArray(operation.response.materialIds) ? operation.response.materialIds : [])].filter(validId))];
}

function materialFor(id: unknown, materialMap: Map<string, Pick<WithId<Material>, '_id' | 'name'>>) {
  if (!validId(id)) return undefined;
  const material = materialMap.get(id);
  return material ? { id, name: safeDiagnostic(material.name) } : undefined;
}

/** Recorded ID links and inferred time grouping deliberately use separate fields. */
export function buildWorkflowGroups(
  operations: WithId<OperationEvent>[],
  runs: WithId<ContentRun>[],
  materials: Array<Pick<WithId<Material>, '_id' | 'name'>> = [],
): WorkflowGroup[] {
  const materialMap = new Map(materials.map(material => [String(material._id), material]));
  const linkedRuns = new Map<string, WithId<ContentRun>[]>();
  for (const run of runs) {
    if (!run.operationId) continue;
    const existing = linkedRuns.get(run.operationId) ?? [];
    existing.push(run); linkedRuns.set(run.operationId, existing);
  }
  const entries: WorkflowEntry[] = operations.map(operation => {
    const ownedRuns = linkedRuns.get(operation.requestId) ?? [];
    const courseIds = [...new Set(ownedRuns.map(run => String(run.courseId)))];
    const targets = Object.fromEntries(Object.entries(operation.targets).filter(([key, value]) => /^(courseId|questionId|versionId|materialId|runId|loId|themeId|attemptId)$/.test(key) && validId(value)));
    const relations: WorkflowRelation[] = ownedRuns.map(run => ({ kind: 'operation-run', confidence: 'recorded', requestId: operation.requestId, runId: String(run._id), evidence: 'persisted-operation-id' }));
    for (const runId of operationRunIds(operation)) {
      if (!relations.some(relation => relation.runId === runId)) relations.push({ kind: 'operation-run', confidence: 'recorded', requestId: operation.requestId, runId, evidence: 'recorded-run-id' });
    }
    const sourceMaterials = operationMaterialIds(operation).map(id => materialFor(id, materialMap)).filter((value): value is { id: string; name: string } => Boolean(value));
    return {
      id: `operation:${operation.requestId}`, kind: 'operation', createdAt: operation.createdAt,
      endedAt: new Date(operation.createdAt.getTime() + Math.max(0, operation.durationMs)),
      label: workflowActionLabel(operation), outcome: operation.outcome,
      ...(operation.actor?.puid ? { actorPuid: operation.actor.puid } : {}),
      ...(targets.courseId || courseIds.length === 1 ? { courseId: targets.courseId ?? courseIds[0] } : {}),
      requestId: operation.requestId, method: operation.method, route: safeDiagnostic(operation.route), durationMs: operation.durationMs,
      targets, material: sourceMaterials.length === 1 ? sourceMaterials[0] : undefined, ...(sourceMaterials.length ? { materials: sourceMaterials } : {}), relations,
    };
  });
  for (const run of runs) {
    const materialId = run.kind === 'material-ingest' ? String(run.input.materialId) : undefined;
    const name = run.kind === 'material-ingest' ? 'Material ingestion' : run.kind === 'structure-generation' ? 'Learning objective extraction' : 'Question generation';
    entries.push({
      id: `run:${run._id}`, kind: 'run', createdAt: run.createdAt, ...(run.completedAt ? { endedAt: run.completedAt } : {}),
      label: name, outcome: run.status, actorPuid: run.requestedBy, courseId: String(run.courseId), runId: String(run._id),
      ...(run.operationId ? { requestId: run.operationId } : {}),
      targets: { courseId: String(run.courseId), runId: String(run._id), ...(materialId ? { materialId } : {}) },
      material: materialFor(materialId, materialMap) ?? (run.kind === 'material-ingest' && materialId ? { id: materialId, name: safeDiagnostic(run.input.sourceName) } : undefined),
      relations: validRequestId(run.operationId) ? [{ kind: 'operation-run', confidence: 'recorded', requestId: run.operationId, runId: String(run._id), evidence: 'persisted-operation-id' }] : [],
    });
  }
  entries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const groups: WorkflowGroup[] = [];
  const currentByScope = new Map<string, WorkflowGroup>();
  for (const entry of entries) {
    // Unknown actors cannot establish that two separate records share a user.
    const key = `${entry.actorPuid ?? entry.id}:${entry.courseId ?? 'unknown-course'}`;
    let group = currentByScope.get(key);
    const last = group?.entries.at(-1);
    if (!group || !last || entry.createdAt.getTime() - last.createdAt.getTime() > WINDOW_MINUTES * 60_000) {
      group = { id: `workflow:${entry.id}`, actorPuid: entry.actorPuid, courseId: entry.courseId, startedAt: entry.createdAt, endedAt: entry.endedAt ?? entry.createdAt, grouping: 'inferred-time-window', entries: [] };
      groups.push(group); currentByScope.set(key, group);
    }
    group.entries.push(entry);
    if ((entry.endedAt ?? entry.createdAt) > group.endedAt) group.endedAt = entry.endedAt ?? entry.createdAt;
  }
  return groups.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || a.id.localeCompare(b.id));
}

export async function listWorkflows(query: WorkflowQuery) {
  if (!query.actor && !query.courseId) throw Object.assign(new Error('Choose a user or course for the workflow timeline.'), { status: 400 });
  const operationsFilter: Filter<OperationEvent> = {};
  const runsFilter: Filter<ContentRun> = {};
  if (query.actor) { operationsFilter['actor.puid'] = query.actor; runsFilter.requestedBy = query.actor; }
  if (query.courseId) { operationsFilter['targets.courseId'] = query.courseId; runsFilter.courseId = new ObjectId(query.courseId); }
  const dates = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.until ? { $lte: new Date(query.until) } : {}) };
  if (query.from || query.until) { operationsFilter.createdAt = dates; runsFilter.createdAt = dates; }
  // Exclude routine reads; retain observed authoring reads and every failure.
  operationsFilter.$or = [{ method: { $nin: ['GET', 'HEAD'] } }, { outcome: { $ne: 'succeeded' } }, { route: { $in: ['/courses/:courseId/review-queue', '/courses/:courseId/questions', '/questions/:questionId', '/courses/:courseId/suggest-hierarchy'] } }];
  const [observedOperations, observedRuns] = await Promise.all([
    operationEventsCol().find(operationsFilter).sort({ createdAt: -1, _id: -1 }).limit(MAX_OPERATIONS + 1).toArray(),
    contentRunsCol().find(runsFilter, { projection: { operationId: 1, courseId: 1, requestedBy: 1, createdAt: 1, updatedAt: 1, completedAt: 1, kind: 1, status: 1, stage: 1, 'input.materialId': 1, 'input.sourceName': 1 } }).sort({ createdAt: -1, _id: -1 }).limit(MAX_RUNS + 1).toArray(),
  ]);
  const operations = observedOperations.slice(0, MAX_OPERATIONS);
  const runs = observedRuns.slice(0, MAX_RUNS);
  const materialIds = [...new Set([...operations.flatMap(operationMaterialIds), ...runs.filter(run => run.kind === 'material-ingest').map(run => String(run.input.materialId))].filter(validId))];
  const materials = await materialsCol().find({ _id: { $in: materialIds.map(id => new ObjectId(id)) } }, { projection: { name: 1 } }).toArray();
  const groups = buildWorkflowGroups(operations, runs, materials);
  const items = groups.slice((query.page - 1) * query.limit, query.page * query.limit);
  const courseIds = [...new Set(items.map(item => item.courseId).filter(validId))];
  const puids = [...new Set(items.map(item => item.actorPuid).filter((value): value is string => Boolean(value)))];
  const [courses, users] = await Promise.all([
    coursesCol().find({ _id: { $in: courseIds.map(id => new ObjectId(id)) } }, { projection: { name: 1, courseCode: 1, section: 1 } }).toArray(),
    usersCol().find({ puid: { $in: puids } }, { projection: { puid: 1, uid: 1, displayName: 1 } }).toArray(),
  ]);
  return {
    items, total: groups.length, page: query.page, courses, users, windowMinutes: WINDOW_MINUTES,
    truncated: observedOperations.length > MAX_OPERATIONS || observedRuns.length > MAX_RUNS,
    limitations: [
      'Groups infer a sequence from the same recorded user/course and gaps of at most 30 minutes; they do not prove clicks or causation.',
      'Only persisted request and run records are shown. Missing audit events and earlier unrecorded activity cannot be reconstructed.',
      'Run outcomes are current persisted snapshots; date filters select their creation time, not their completion time.',
      'An accepted HTTP request records enqueueing, not successful background completion.',
      `The timeline scans at most ${MAX_OPERATIONS} requests and ${MAX_RUNS} runs. A truncated total counts only groups in that scan.`,
    ],
  };
}
