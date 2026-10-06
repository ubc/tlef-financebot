import { ObjectId, type WithId } from 'mongodb';
jest.mock('../../server/src/components/mongodb/collections', () => ({ contentRunsCol: jest.fn(), operationEventsCol: jest.fn(), materialsCol: jest.fn(), coursesCol: jest.fn(), usersCol: jest.fn() }));
import { contentRunsCol, operationEventsCol, materialsCol, coursesCol, usersCol } from '../../server/src/components/mongodb/collections';
import { buildWorkflowGroups, listWorkflows, workflowActionLabel } from '../../server/src/services/admin-workflow.service';
import type { ContentRun, OperationEvent } from '../../server/src/types/domain';

const courseId = new ObjectId();
const materialId = new ObjectId();
const requestId = '550e8400-e29b-41d4-a716-446655440000';
function operation(overrides: Partial<OperationEvent> = {}): WithId<OperationEvent> {
  return { _id: new ObjectId(), requestId, createdAt: new Date('2026-10-03T10:00:00Z'), durationMs: 20, method: 'POST', route: '/courses/:courseId/materials', statusCode: 201, outcome: 'succeeded', actor: { puid: 'teacher', uid: 'teacher', displayName: 'Teacher' }, targets: { courseId: String(courseId) }, input: {}, response: {}, ...overrides };
}
function run(overrides: Record<string, unknown> = {}): WithId<ContentRun> {
  return { _id: new ObjectId(), operationId: requestId, courseId, requestedBy: 'teacher', createdAt: new Date('2026-10-03T10:00:01Z'), updatedAt: new Date('2026-10-03T10:00:02Z'), completedAt: new Date('2026-10-03T10:00:02Z'), kind: 'material-ingest', stage: 'classifying', status: 'completed', input: { materialId, sourceName: 'source.pdf', sourceFormat: 'pdf', trigger: 'upload' }, revision: 1, events: [], warnings: [], completedUnits: 1, ...overrides } as WithId<ContentRun>;
}
function cursor(items: unknown[]) {
  return { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue(items) };
}

it('keeps recorded request/run links distinct from inferred time adjacency', () => {
  const sourceRun = run();
  const generation = operation({ requestId: '550e8400-e29b-41d4-a716-446655440001', createdAt: new Date('2026-10-03T10:03:00Z'), route: '/courses/:courseId/generation-plan', outcome: 'accepted' });
  const groups = buildWorkflowGroups([operation(), generation], [sourceRun], [{ _id: materialId, name: 'lecture.pdf' }]);
  expect(groups).toHaveLength(1);
  expect(groups[0].grouping).toBe('inferred-time-window');
  expect(groups[0].entries[0].relations).toEqual([{ kind: 'operation-run', confidence: 'recorded', requestId, runId: String(sourceRun._id), evidence: 'persisted-operation-id' }]);
  expect(groups[0].entries[1].material?.name).toBe('lecture.pdf');
  expect(groups[0].entries[2]).toMatchObject({ label: 'Request a question generation batch', outcome: 'accepted', relations: [] });
});
it('does not infer missing actors, cross-course activity, or long gaps as one sequence', () => {
  const groups = buildWorkflowGroups([
    operation(), operation({ requestId: 'second', createdAt: new Date('2026-10-03T10:31:00Z') }),
    operation({ requestId: 'foreign-course', targets: { courseId: String(new ObjectId()) } }),
    operation({ requestId: 'anonymous-a', actor: undefined }), operation({ requestId: 'anonymous-b', actor: undefined }),
  ], []);
  expect(groups).toHaveLength(5);
  expect(groups.every(group => group.entries.length === 1)).toBe(true);
});
it('does not put uploaded bodies, source content, prompts, errors or model output in workflow entries', () => {
  const groups = buildWorkflowGroups([operation({ input: { prompt: 'private prompt', file: 'private upload' }, response: { error: 'private error', output: 'private output' }, targets: { courseId: String(courseId), accessToken: 'secret' } })], [run({ preview: { stem: 'private output' }, input: { materialId, sourceName: 'lecture.pdf', prompt: 'private prompt' } })]);
  expect(JSON.stringify(groups)).not.toMatch(/private|accessToken|secret/);
});
it('labels known transitions using verified controls without guessing unknown routes', () => {
  expect(workflowActionLabel(operation({ route: '/questions/:questionId/transition', input: { to: 'approved' } }))).toBe('Approve a question');
  expect(workflowActionLabel(operation({ method: 'GET', route: '/unknown' }))).toBe('Observed GET request');
});
it('correlates recorded batch run IDs and upload material IDs without arbitrary response fields', () => {
  const runId = String(new ObjectId());
  const groups = buildWorkflowGroups([operation({ response: { runIds: [runId, 'not-an-id'], materialIds: [String(materialId)], body: 'private upload' } })], [], [{ _id: materialId, name: 'lecture.pdf' }]);
  expect(groups[0].entries[0]).toMatchObject({
    material: { id: String(materialId), name: 'lecture.pdf' },
    materials: [{ id: String(materialId), name: 'lecture.pdf' }],
    relations: [{ kind: 'operation-run', confidence: 'recorded', requestId, runId, evidence: 'recorded-run-id' }],
  });
  expect(JSON.stringify(groups)).not.toMatch(/private upload|not-an-id/);
});
it('filters and bounds selected user/course history and reads only material metadata', async () => {
  const operationsCursor = cursor([operation()]);
  const runsCursor = cursor([run()]);
  const findOperations = jest.fn().mockReturnValue(operationsCursor), findRuns = jest.fn().mockReturnValue(runsCursor);
  const findMaterials = jest.fn().mockReturnValue(cursor([{ _id: materialId, name: 'lecture.pdf' }]));
  jest.mocked(operationEventsCol).mockReturnValue({ find: findOperations } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ find: findRuns } as never);
  jest.mocked(materialsCol).mockReturnValue({ find: findMaterials } as never);
  jest.mocked(coursesCol).mockReturnValue({ find: jest.fn().mockReturnValue(cursor([])) } as never);
  jest.mocked(usersCol).mockReturnValue({ find: jest.fn().mockReturnValue(cursor([])) } as never);
  const result = await listWorkflows({ actor: 'teacher', courseId: String(courseId), from: '2026-10-01T00:00:00Z', until: '2026-10-04T00:00:00Z', page: 1, limit: 25 });
  expect(findOperations).toHaveBeenCalledWith(expect.objectContaining({ 'actor.puid': 'teacher', 'targets.courseId': String(courseId), createdAt: { $gte: new Date('2026-10-01T00:00:00Z'), $lte: new Date('2026-10-04T00:00:00Z') } }));
  expect(findRuns).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: 'teacher', courseId }), expect.objectContaining({ projection: expect.objectContaining({ 'input.materialId': 1, 'input.sourceName': 1 }) }));
  expect(findRuns.mock.calls[0][1].projection).not.toHaveProperty('input.prompt');
  expect(findMaterials).toHaveBeenCalledWith({ _id: { $in: [materialId] } }, { projection: { name: 1 } });
  expect(operationsCursor.limit).toHaveBeenCalledWith(1001);
  expect(runsCursor.limit).toHaveBeenCalledWith(501);
  expect(result).toMatchObject({ total: 1, page: 1, windowMinutes: 30, truncated: false });
  expect(result.limitations.join(' ')).toContain('do not prove clicks or causation');
});
it('marks a bounded scan as truncated and paginates groups without claiming complete history', async () => {
  const operationsCursor = cursor(Array.from({ length: 1001 }, (_, index) => operation({ requestId: String(index), createdAt: new Date(Date.UTC(2026, 9, 3, 10, index * 31)) })));
  jest.mocked(operationEventsCol).mockReturnValue({ find: jest.fn().mockReturnValue(operationsCursor) } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ find: jest.fn().mockReturnValue(cursor([])) } as never);
  jest.mocked(materialsCol).mockReturnValue({ find: jest.fn().mockReturnValue(cursor([])) } as never);
  jest.mocked(coursesCol).mockReturnValue({ find: jest.fn().mockReturnValue(cursor([])) } as never);
  jest.mocked(usersCol).mockReturnValue({ find: jest.fn().mockReturnValue(cursor([])) } as never);
  const result = await listWorkflows({ actor: 'teacher', page: 2, limit: 2 });
  expect(result).toMatchObject({ total: 1000, page: 2, truncated: true });
  expect(result.items).toHaveLength(2);
  expect(result.limitations.join(' ')).toContain('truncated total counts only groups in that scan');
});
it('rejects unscoped timeline scans before querying', async () => {
  await expect(listWorkflows({ page: 1, limit: 25 })).rejects.toMatchObject({ status: 400 });
  expect(operationEventsCol).not.toHaveBeenCalled();
});
