jest.mock('../../server/src/components/mongodb/collections', () => ({ materialsCol: jest.fn(), questionsCol: jest.fn(), losCol: jest.fn() }));
jest.mock('../../server/src/services/generation-evidence.service', () => ({ buildGenerationEvidence: jest.fn(), assertGenerationEvidenceCurrent: jest.fn() }));
jest.mock('../../server/src/services/generation-memory.service', () => ({ loadGenerationMemory: jest.fn(), reloadGenerationMemory: jest.fn(), assertTaskRetrievalReady: jest.fn() }));

import { ObjectId } from 'mongodb';
import { buildAuthoringContext, assertAuthoringContextCurrent } from '../../server/src/services/authoring-context.service';
import { buildGenerationEvidence, assertGenerationEvidenceCurrent } from '../../server/src/services/generation-evidence.service';
import { loadGenerationMemory, reloadGenerationMemory, assertTaskRetrievalReady } from '../../server/src/services/generation-memory.service';
import type { GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { AuthoringRequirements } from '../../server/src/types/generation-quality';

const courseId = new ObjectId(), loId = new ObjectId(), questionId = new ObjectId(), versionId = new ObjectId();
const pinnedOriginal = { questionId, versionId };
const original = { type: 'mcq' as const, stem: 'Original question', options: [], contentHash: 'original-content', truncated: false };
const requirements = (intent: AuthoringRequirements['intent']): AuthoringRequirements => ({ intent, requiredChanges: ['Follow the requested intent.'], preserve: [], original });
const input = (intent: AuthoringRequirements['intent']) => ({ courseId, loIds: [loId], allowedMaterials: [], seeds: [],
  policyVersion: 'grounded-memory-v2', requirements: requirements(intent), excludeQuestionId: questionId, pinnedOriginal });
const metadata = { questionId: questionId.toHexString(), versionId: versionId.toHexString(), entryId: `q:${questionId.toHexString()}:${versionId.toHexString()}` };
const memory = (pin = true): GenerationMemorySnapshot => ({ entries: [], truncated: false, missingVersions: 0, consistency: 'best-effort',
  snapshotDigest: pin ? 'pinned-snapshot' : 'ordinary-snapshot', ...(pin ? { pinnedOriginal: { ...metadata } } : {}) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(buildGenerationEvidence).mockResolvedValue({ id: 'evidence', policyVersion: 'grounded-memory-v2', materials: [] } as never);
  jest.mocked(assertGenerationEvidenceCurrent).mockResolvedValue(undefined);
  jest.mocked(loadGenerationMemory).mockImplementation(async options => memory(Boolean(options.pinnedOriginal)));
  jest.mocked(reloadGenerationMemory).mockImplementation(async previous => previous);
  jest.mocked(assertTaskRetrievalReady).mockReset();
});

it('replays a selected stored query inside currentness without rebuilding a query-less nomination', async () => {
  const selected = { ...input('create-independent-task'), requirements: { ...requirements('create-independent-task'), taskRetrievalProtocol: 'course-task-retrieval-v1' as const } };
  const context = await buildAuthoringContext(selected);
  expect(loadGenerationMemory).toHaveBeenCalledWith(expect.objectContaining({ taskRetrievalProtocol: 'course-task-retrieval-v1' }));
  const initialCalls = jest.mocked(loadGenerationMemory).mock.calls.length;
  const session = {} as never;
  await assertAuthoringContextCurrent(context, { courseId, loIds: [loId], excludeQuestionId: questionId, session });
  expect(loadGenerationMemory).toHaveBeenCalledTimes(initialCalls);
  expect(reloadGenerationMemory).toHaveBeenCalledWith(context.memory, expect.objectContaining({ courseId, loIds: [loId], pinnedOriginal, session }));
  expect(assertTaskRetrievalReady).toHaveBeenCalledTimes(2);
  jest.mocked(reloadGenerationMemory).mockResolvedValueOnce({ ...context.memory, snapshotDigest: 'changed-effective-profile' });
  await expect(assertAuthoringContextCurrent(context, { courseId, loIds: [loId], excludeQuestionId: questionId })).rejects.toThrow('authoring-memory-changed');
});

it('refuses an invalid selected receipt before source or reload work', async () => {
  const context = await buildAuthoringContext({ ...input('create-independent-task'), requirements: { ...requirements('create-independent-task'), taskRetrievalProtocol: 'course-task-retrieval-v1' } });
  jest.mocked(assertTaskRetrievalReady).mockImplementationOnce(() => { throw new Error('generation-task-retrieval-receipt-invalid'); });
  await expect(assertAuthoringContextCurrent(context, { courseId, loIds: [loId], excludeQuestionId: questionId })).rejects.toThrow('generation-task-retrieval-receipt-invalid');
  expect(assertGenerationEvidenceCurrent).not.toHaveBeenCalled();
  expect(reloadGenerationMemory).not.toHaveBeenCalled();
});

it('bounds only a new retrieval locator without changing the teacher or original request', async () => {
  const query = 'Original question wording '.repeat(500);
  const selected = { ...input('create-independent-task'), query, requirements: { ...requirements('create-independent-task'), taskRetrievalProtocol: 'course-task-retrieval-v1' as const } };
  const context = await buildAuthoringContext(selected);
  expect(jest.mocked(loadGenerationMemory).mock.calls.at(-1)![0].query).toBe(query.slice(0, 8000));
  expect(jest.mocked(buildGenerationEvidence).mock.calls.at(-1)![0].query).toBe(query);
  expect(context.requirements).toEqual(selected.requirements);
});

it('refuses task retrieval under a non-v2 evidence policy before any loading', async () => {
  await expect(buildAuthoringContext({ ...input('create-independent-task'), policyVersion: 'grounded-memory-v1',
    requirements: { ...requirements('create-independent-task'), taskRetrievalProtocol: 'course-task-retrieval-v1' } })).rejects.toThrow('generation-task-retrieval-policy-invalid');
  expect(loadGenerationMemory).not.toHaveBeenCalled(); expect(buildGenerationEvidence).not.toHaveBeenCalled();
});

it('requires the exact original pin only for independent regeneration', async () => {
  const context = await buildAuthoringContext(input('create-independent-task'));
  expect(context.memory.pinnedOriginal).toEqual(metadata);
  expect(loadGenerationMemory).toHaveBeenCalledWith(expect.objectContaining({ courseId, loIds: [loId], excludeQuestionId: questionId, pinnedOriginal }));
  for (const intent of ['edit-existing', 'create-variant'] as const) {
    const edited = await buildAuthoringContext(input(intent));
    expect(edited.memory.pinnedOriginal).toBeUndefined();
    expect(jest.mocked(loadGenerationMemory).mock.calls.at(-1)![0]).not.toHaveProperty('pinnedOriginal');
    expect(jest.mocked(loadGenerationMemory).mock.calls.at(-1)![0].excludeQuestionId).toEqual(questionId);
  }
});

it('rejects an omitted or mismatched original identity before evidence or memory work', async () => {
  await expect(buildAuthoringContext({ ...input('create-independent-task'), pinnedOriginal: undefined })).rejects.toThrow('authoring-original-comparison-required');
  await expect(buildAuthoringContext({ ...input('create-independent-task'), pinnedOriginal: { questionId: new ObjectId(), versionId } })).rejects.toThrow('authoring-original-comparison-required');
  expect(buildGenerationEvidence).not.toHaveBeenCalled(); expect(loadGenerationMemory).not.toHaveBeenCalled();
});

it('does not require an original pin for independent public generation or repair references', async () => {
  const context = await buildAuthoringContext({ ...input('create-independent-task'), excludeQuestionId: undefined, pinnedOriginal: undefined });
  expect(context.memory.pinnedOriginal).toBeUndefined();
  await expect(assertAuthoringContextCurrent(context, { courseId, loIds: [loId] })).resolves.toBeUndefined();
});

it('reloads the pinned immutable original for currentness without broadening exclusions', async () => {
  const context = await buildAuthoringContext(input('create-independent-task'));
  await assertAuthoringContextCurrent(context, { courseId, loIds: [loId], excludeQuestionId: questionId });
  expect(loadGenerationMemory).toHaveBeenLastCalledWith(expect.objectContaining({ courseId, excludeQuestionId: questionId, pinnedOriginal }));
  expect(assertGenerationEvidenceCurrent).toHaveBeenCalledWith(context.evidence, undefined);
});

it('rejects changed original versions or memory instead of silently dropping their comparator', async () => {
  const context = await buildAuthoringContext(input('create-independent-task'));
  jest.mocked(loadGenerationMemory).mockRejectedValueOnce(new Error('generation-memory-original-changed'));
  await expect(assertAuthoringContextCurrent(context, { courseId, loIds: [loId], excludeQuestionId: questionId })).rejects.toThrow('generation-memory-original-changed');
  jest.mocked(loadGenerationMemory).mockResolvedValueOnce({ ...memory(), snapshotDigest: 'changed-snapshot' });
  await expect(assertAuthoringContextCurrent(context, { courseId, loIds: [loId], excludeQuestionId: questionId })).rejects.toThrow('authoring-memory-changed');
});

it('rejects historical independent regeneration context without a pin and pins on incompatible intents', async () => {
  const context = await buildAuthoringContext(input('create-independent-task'));
  await expect(assertAuthoringContextCurrent({ ...context, memory: memory(false) }, { courseId, loIds: [loId], excludeQuestionId: questionId })).rejects.toThrow('authoring-original-comparison-required');
  await expect(assertAuthoringContextCurrent(context, { courseId, loIds: [loId], excludeQuestionId: new ObjectId() })).rejects.toThrow('authoring-original-comparison-required');
  await expect(assertAuthoringContextCurrent({ ...context, requirements: requirements('create-variant') }, { courseId, loIds: [loId], excludeQuestionId: questionId })).rejects.toThrow('authoring-original-comparison-invalid');
});
