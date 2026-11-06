jest.mock('../../server/src/components/mongodb/collections', () => ({ materialsCol: jest.fn(), materialChunksCol: jest.fn(), themesCol: jest.fn(), losCol: jest.fn(), contentRunsCol: jest.fn() }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/services/admin.service', () => ({ utilityStepConfig: jest.fn() }));
jest.mock('../../server/src/services/courses.service', () => ({ upsertCourseOutline: jest.fn() }));
jest.mock('../../server/src/services/authoring-commit.service', () => ({ authoringCollection: (collection: unknown) => collection,
  authoringCommitAvailable: jest.fn(), currentAuthoringSession: jest.fn(), withCourseAuthoringWrite: jest.fn() }));
jest.mock('../../server/src/services/structure-generation.service', () => ({
  generateStructure: jest.fn(), loadStructureCorpus: jest.fn(), assertStructureRepairAdoptable: jest.fn(), assertStructureCapabilityAdoptable: jest.fn(),
  structureCorpusFingerprint: jest.requireActual('../../server/src/services/structure-generation.service').structureCorpusFingerprint,
}));
jest.mock('../../server/src/services/content-runs.service', () => ({ createStructureGenerationRun: jest.fn(), updateContentRun: jest.fn(), failContentRun: jest.fn() }));
jest.mock('../../server/src/services/model-usage.service', () => ({ withModelUsage: jest.fn(async (_scope: unknown, work: () => Promise<unknown>) => work()) }));

import { ObjectId } from 'mongodb';
import { applyGeneratedHierarchy, applySuggestedHierarchy, suggestHierarchy, type ApplyGeneratedHierarchyInput } from '../../server/src/services/classification.service';
import { materialsCol, contentRunsCol } from '../../server/src/components/mongodb/collections';
import { assertStructureCapabilityAdoptable, assertStructureRepairAdoptable, loadStructureCorpus, generateStructure, structureCorpusFingerprint } from '../../server/src/services/structure-generation.service';
import { upsertCourseOutline } from '../../server/src/services/courses.service';
import { authoringCommitAvailable, currentAuthoringSession, withCourseAuthoringWrite } from '../../server/src/services/authoring-commit.service';
import { createStructureGenerationRun, updateContentRun } from '../../server/src/services/content-runs.service';
import type { SourceSelectionReport } from '../../server/src/types/material-upload';

const courseId = new ObjectId(), runId = new ObjectId(), materialId = new ObjectId(), themeId = new ObjectId(), loId = new ObjectId();
const section = { id: 'S1', localId: 'C1.S1', materialId: materialId.toHexString(), materialName: 'Original.pdf', chunkIndex: 0, text: 'An original formula and its condition.' };
const snapshot = () => ({ materialId: materialId.toHexString(), name: 'Original.pdf', revision: 0, sourceTextHash: 'original', chunkCount: 1,
  characterCount: section.text.length, parserVersion: 'parser-v1', chunkerVersion: 'chunker-v1', ingestRunId: 'original-ingest' });
let source: ReturnType<typeof snapshot>;
let run: Record<string, unknown>;
let input: ApplyGeneratedHierarchyInput;
let unavailable = false;
let materials: Array<{ _id: ObjectId; courseId: ObjectId; status: string; revision: number; assignments: unknown[] }>;
const materialWrite = jest.fn();
const selection = (): SourceSelectionReport => ({ sourceBatchId: '111111111111111111111111', requested: [], included: [{ ...source }],
  excluded: [{ name: 'Omitted appendix.pdf', reason: 'instructor-selected-subset' }], ready: true });
const corpus = () => ({ sections: [section], materials: [{ materialId: materialId.toHexString(), name: source.name, chunks: 1, sections: 1,
  sourceTextHash: source.sourceTextHash, parserVersion: source.parserVersion, chunkerVersion: source.chunkerVersion }],
  sourceSelection: selection(), fingerprint: structureCorpusFingerprint([section], selection()) });

beforeEach(() => {
  jest.clearAllMocks(); unavailable = false; source = snapshot();
  materials = [{ _id: materialId, courseId, status: 'ready', revision: 0, assignments: [] }];
  run = { _id: runId, courseId, kind: 'structure-generation', status: 'completed',
    input: { materialIds: [materialId.toHexString()], sourceBatchId: selection().sourceBatchId },
    structureResult: { themes: [{ name: 'Original topic', los: [{ name: 'Apply the original formula', evidenceIds: ['E1'], materialIds: [materialId.toHexString()] }] }],
      evidence: [], coverage: { sourceFingerprint: corpus().fingerprint, sourceSelection: selection() } } };
  input = { runId: runId.toHexString(), themes: [{ name: 'Instructor-edited topic', los: [{ name: 'Instructor-edited assessable capability',
    materialIds: [materialId.toHexString()], sourceThemeIndex: 0, sourceLoIndex: 0 }] }] };
  jest.mocked(authoringCommitAvailable).mockReturnValue(false);
  jest.mocked(assertStructureRepairAdoptable).mockReset().mockResolvedValue(undefined);
  jest.mocked(assertStructureCapabilityAdoptable).mockReset().mockResolvedValue(undefined);
  jest.mocked(currentAuthoringSession).mockReturnValue(undefined);
  jest.mocked(withCourseAuthoringWrite).mockImplementation(async (_course, work) => {
    jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
    try { return await work({} as never); } finally { jest.mocked(currentAuthoringSession).mockReturnValue(undefined); }
  });
  jest.mocked(contentRunsCol).mockReturnValue({ findOne: jest.fn(async (filter: { _id: ObjectId; courseId: ObjectId; kind: string; status: string }) =>
    filter._id.equals(run._id as ObjectId) && filter.courseId.equals(run.courseId as ObjectId) && filter.kind === run.kind && filter.status === run.status ? run : null) } as never);
  jest.mocked(materialsCol).mockReturnValue({ find: jest.fn(() => ({ toArray: async () => materials })), updateOne: materialWrite } as never);
  materialWrite.mockReset().mockImplementation(async () => { materials[0].revision++; source.revision++; return { matchedCount: 1 }; });
  jest.mocked(loadStructureCorpus).mockReset().mockImplementation(async () => { if (unavailable) throw new Error('source-not-ready'); return corpus(); });
  jest.mocked(upsertCourseOutline).mockResolvedValue({ themesCreated: 1, losCreated: 1,
    themes: [{ _id: themeId, name: 'Instructor-edited topic', created: true, los: [{ _id: loId, name: 'Instructor-edited assessable capability', created: true }] }] });
});

it('accepts instructor text edits with trusted source identities and discloses standalone checks', async () => {
  const result = await applyGeneratedHierarchy(courseId, input);
  expect(result).toMatchObject({ losCreated: 1, assignmentsCreated: 1, consistency: 'best-effort', warning: expect.stringContaining('does not support atomic source adoption') });
  expect(loadStructureCorpus).toHaveBeenCalledTimes(2);
  expect(loadStructureCorpus).toHaveBeenCalledWith(courseId, [materialId.toHexString()], selection().sourceBatchId, undefined);
  expect(upsertCourseOutline).toHaveBeenCalledWith(courseId, { themes: [{ name: 'Instructor-edited topic', los: ['Instructor-edited assessable capability'] }] });
  expect(materialWrite.mock.calls[0][0]).toMatchObject({ status: 'ready', deletedAt: { $exists: false }, $or: expect.any(Array) });
  expect(assertStructureRepairAdoptable).not.toHaveBeenCalled();
});

it('requires capability authority inside the course transaction before any hierarchy write and discloses teacher edits', async () => {
  (run.input as Record<string, unknown>).capabilityDistinctnessProtocol = 'outline-capability-distinctness-v1';
  jest.mocked(assertStructureCapabilityAdoptable).mockImplementation(async (course, checkedRun) => {
    expect(course.equals(courseId)).toBe(true); expect(checkedRun).toBe(run);
    expect(currentAuthoringSession()).toBeDefined();
    expect(upsertCourseOutline).not.toHaveBeenCalled(); expect(materialWrite).not.toHaveBeenCalled();
    return { protocol: 'outline-capability-distinctness-v1', reviewedObjectives: 3, withheldObjectives: 2 };
  });
  const result = await applyGeneratedHierarchy(courseId, input);
  expect(withCourseAuthoringWrite).toHaveBeenCalledWith(courseId, expect.any(Function), { required: true });
  expect(result).toMatchObject({ consistency: 'transactional', capabilityReview: { protocol: 'outline-capability-distinctness-v1',
    reviewedObjectives: 3, withheldObjectives: 2, wording: 'instructor-edited', teacherEditedNames: 2 }, warning: expect.stringContaining('subsequent text edits') });
});

it.each(['missing-authority', 'changed-authority'])('refuses %s capability Apply before material or hierarchy writes', async defect => {
  (run.input as Record<string, unknown>).capabilityDistinctnessProtocol = 'outline-capability-distinctness-v1';
  if (defect === 'changed-authority') jest.mocked(assertStructureCapabilityAdoptable).mockRejectedValue(new Error('structure-capability-adoption-result-changed'));
  await expect(applyGeneratedHierarchy(courseId, input)).rejects.toThrow(defect === 'missing-authority'
    ? 'structure-apply-capability-authority-missing' : 'structure-capability-adoption-result-changed');
  expect(upsertCourseOutline).not.toHaveBeenCalled(); expect(materialWrite).not.toHaveBeenCalled();
});

function repairRun() {
  const parentRunId = new ObjectId();
  run.structureRepair = { branchId: new ObjectId(), inputHash: 'a'.repeat(64), parentRunId };
  jest.mocked(assertStructureRepairAdoptable).mockImplementation(async (course, checkedRun) => {
    expect(course.equals(courseId)).toBe(true);
    expect(checkedRun).toBe(run);
    expect(currentAuthoringSession()).toBeDefined();
    expect(upsertCourseOutline).not.toHaveBeenCalled();
    expect(materialWrite).not.toHaveBeenCalled();
    return { parentRunId: parentRunId.toHexString(), mode: 'coverage-wording-outline-repair-v1' };
  });
  return parentRunId;
}

it('requires a course transaction and validates a repair before the first hierarchy write', async () => {
  const parentRunId = repairRun();
  input.themes[0].name = 'Original topic';
  input.themes[0].los[0].name = 'Apply the original formula';
  const result = await applyGeneratedHierarchy(courseId, input);
  expect(withCourseAuthoringWrite).toHaveBeenCalledWith(courseId, expect.any(Function), { required: true });
  expect(assertStructureRepairAdoptable).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ consistency: 'transactional', repairReview: {
    runId: runId.toHexString(), parentRunId: parentRunId.toHexString(), mode: 'coverage-wording-outline-repair-v1',
    wording: 'reviewed', teacherEditedNames: 0,
  } });
  expect(result.warning).toBeUndefined();
});

it('keeps deliberate instructor edits and distinguishes them from reviewed repair wording', async () => {
  repairRun();
  const result = await applyGeneratedHierarchy(courseId, input);
  expect(result.repairReview).toMatchObject({ wording: 'instructor-edited', teacherEditedNames: 2 });
  expect(result.warning).toContain('not these subsequent text edits');
  expect(upsertCourseOutline).toHaveBeenCalledWith(courseId, { themes: [{ name: input.themes[0].name,
    los: [input.themes[0].los[0].name] }] });
});

it('does not count surrounding whitespace removed by normal Apply as changed wording', async () => {
  repairRun(); input.themes[0].name = ' Original topic ';
  input.themes[0].los[0].name = ' Apply the original formula ';
  expect((await applyGeneratedHierarchy(courseId, input)).repairReview).toMatchObject({ wording: 'reviewed', teacherEditedNames: 0 });
});

it('refuses repaired Apply when coordinated transactions are unavailable', async () => {
  repairRun();
  jest.mocked(withCourseAuthoringWrite).mockRejectedValue(new Error('authoring-coordinated-commit-unavailable'));
  await expect(applyGeneratedHierarchy(courseId, input)).rejects.toThrow('authoring-coordinated-commit-unavailable');
  expect(assertStructureRepairAdoptable).not.toHaveBeenCalled();
  expect(upsertCourseOutline).not.toHaveBeenCalled(); expect(materialWrite).not.toHaveBeenCalled();
});

it('rejects an existing foreign course transaction before reading or writing the requested course', async () => {
  repairRun();
  jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
  jest.mocked(withCourseAuthoringWrite).mockRejectedValue(new Error('authoring-cross-course-transaction'));
  await expect(applyGeneratedHierarchy(courseId, input)).rejects.toThrow('authoring-cross-course-transaction');
  expect(withCourseAuthoringWrite).toHaveBeenCalledWith(courseId, expect.any(Function));
  expect(contentRunsCol().findOne).not.toHaveBeenCalled();
  expect(assertStructureRepairAdoptable).not.toHaveBeenCalled();
  expect(upsertCourseOutline).not.toHaveBeenCalled(); expect(materialWrite).not.toHaveBeenCalled();
});

it('retains a matching existing transaction while applying reviewed repair wording', async () => {
  repairRun();
  jest.mocked(currentAuthoringSession).mockReturnValue({} as never);
  jest.mocked(withCourseAuthoringWrite).mockImplementation(async (_course, work) => work({} as never));
  await expect(applyGeneratedHierarchy(courseId, input)).resolves.toMatchObject({
    consistency: 'transactional', repairReview: { wording: 'instructor-edited', teacherEditedNames: 2 },
  });
  expect(withCourseAuthoringWrite).toHaveBeenCalledTimes(1);
  expect(assertStructureRepairAdoptable).toHaveBeenCalledTimes(1);
  expect(materialWrite).toHaveBeenCalledTimes(1);
});

it.each([
  'structure-repair-branch-unavailable', 'structure-repair-parent-or-provider-changed',
  'structure-repair-proposal-body-changed', 'structure-repair-adoption-result-changed',
  'structure-repair-coverage-shortfall', 'structure-repair-coverage-assessment-changed',
  'structure-repair-unknown-dispatch', 'structure-repair-branch-mode',
])('never writes a repaired hierarchy after authority refuses %s', async reason => {
  repairRun(); jest.mocked(assertStructureRepairAdoptable).mockRejectedValue(new Error(reason));
  await expect(applyGeneratedHierarchy(courseId, input)).rejects.toThrow(reason);
  expect(upsertCourseOutline).not.toHaveBeenCalled(); expect(materialWrite).not.toHaveBeenCalled();
});

it.each([null, undefined, {}, []])('never treats an explicit malformed repair field %p as ordinary history', async value => {
  run.structureRepair = value;
  await expect(applyGeneratedHierarchy(courseId, input)).rejects.toMatchObject({
    status: 409, message: 'structure-apply-repair-authority-missing',
  });
  expect(withCourseAuthoringWrite).toHaveBeenCalledWith(courseId, expect.any(Function), { required: true });
  expect(assertStructureRepairAdoptable).toHaveBeenCalledTimes(1);
  expect(upsertCourseOutline).not.toHaveBeenCalled(); expect(materialWrite).not.toHaveBeenCalled();
});

it('uses the course-fenced transaction when available', async () => {
  jest.mocked(authoringCommitAvailable).mockReturnValue(true);
  await expect(applyGeneratedHierarchy(courseId, input)).resolves.toMatchObject({ consistency: 'transactional' });
  expect(withCourseAuthoringWrite).toHaveBeenCalledTimes(1);
});

it.each(['ingest-identity', 'text', 'readiness'])('rejects stale %s before any hierarchy write', async change => {
  if (change === 'ingest-identity') { source.ingestRunId = 'new-ingest'; source.revision++; materials[0].revision++; }
  if (change === 'text') source.sourceTextHash = 'changed-original';
  if (change === 'readiness') unavailable = true;
  await expect(applyGeneratedHierarchy(courseId, input)).rejects.toMatchObject({ status: 409, message: 'structure-apply-source-changed' });
  expect(upsertCourseOutline).not.toHaveBeenCalled(); expect(materialWrite).not.toHaveBeenCalled();
});

it('allows settled advisory metadata while applying against its current material revision', async () => {
  source.revision = 4; materials[0].revision = 4;
  await expect(applyGeneratedHierarchy(courseId, input)).resolves.toMatchObject({ assignmentsCreated: 1 });
  expect(materialWrite.mock.calls[0][0]).toHaveProperty('revision', 4);
});

it.each(['foreign-run', 'incomplete-run', 'historical-run', 'missing-run'])('rejects %s without a trusted complete receipt', async change => {
  if (change === 'foreign-run') run.courseId = new ObjectId();
  if (change === 'incomplete-run') run.status = 'running';
  if (change === 'historical-run') (run.structureResult as { coverage: { sourceFingerprint?: string } }).coverage.sourceFingerprint = undefined;
  if (change === 'missing-run') input.runId = '';
  await expect(applyGeneratedHierarchy(courseId, input)).rejects.toHaveProperty('status');
  expect(upsertCourseOutline).not.toHaveBeenCalled();
});

it.each(['extra-material', 'removed-material', 'wrong-lo', 'duplicate-lo'])('rejects changed selected identity: %s', async change => {
  const lo = input.themes[0].los[0];
  if (change === 'extra-material') lo.materialIds.push(new ObjectId().toHexString());
  if (change === 'removed-material') lo.materialIds = [];
  if (change === 'wrong-lo') lo.sourceLoIndex = 3;
  if (change === 'duplicate-lo') input.themes[0].los.push({ ...lo });
  await expect(applyGeneratedHierarchy(courseId, input)).rejects.toMatchObject({ status: 409, message: 'structure-apply-source-scope-changed' });
  expect(upsertCourseOutline).not.toHaveBeenCalled();
});

it.each(['source-race', 'revision-cas'])('never returns a successful standalone adoption after %s during writes', async change => {
  materialWrite.mockImplementation(async () => {
    if (change === 'revision-cas') return { matchedCount: 0 };
    source.sourceTextHash = 'concurrent-original'; source.revision++; return { matchedCount: 1 };
  });
  await expect(applyGeneratedHierarchy(courseId, input)).rejects.toMatchObject({ status: 409, message: 'structure-apply-conflict-after-write' });
});

it('preserves the internal manual hierarchy path without requiring an AI run', async () => {
  await expect(applySuggestedHierarchy(courseId, { themes: input.themes })).resolves.toMatchObject({ losCreated: 1 });
  expect(loadStructureCorpus).not.toHaveBeenCalled();
});

it('rejects colliding edited LO names before writing hierarchy rows', async () => {
  const result = run.structureResult as { themes: Array<{ los: Array<Record<string, unknown>> }> };
  result.themes[0].los.push({ name: 'Another original capability', evidenceIds: ['E2'], materialIds: [materialId.toHexString()] });
  input.themes[0].los.push({ ...input.themes[0].los[0], sourceLoIndex: 1, name: '  INSTRUCTOR-EDITED   ASSESSABLE CAPABILITY  ' });
  await expect(applyGeneratedHierarchy(courseId, input)).rejects.toThrow('suggested-hierarchy-invalid');
  expect(upsertCourseOutline).not.toHaveBeenCalled(); expect(materialWrite).not.toHaveBeenCalled();
});

it('retains a trusted durable run for the public legacy suggestion projection', async () => {
  const queued = { ...run, status: 'queued', input: run.input };
  jest.mocked(createStructureGenerationRun).mockResolvedValue(queued as never);
  jest.mocked(generateStructure).mockResolvedValue(run.structureResult as never);
  const response = await suggestHierarchy(courseId, 'teacher');
  expect(response).toMatchObject({ runId: runId.toHexString(), assignments: [{ themeIndex: 0, loIndex: 0, materialIds: [materialId.toHexString()] }] });
  expect(generateStructure).toHaveBeenCalledWith(courseId, queued.input, runId);
  expect(updateContentRun).toHaveBeenLastCalledWith(runId, expect.objectContaining({ status: 'completed', structureResult: run.structureResult }));
});
