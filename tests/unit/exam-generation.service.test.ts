import { ObjectId } from 'mongodb';
import type { ExamBuildRun } from '../../server/src/types/exam-builder';
jest.mock('../../server/src/components/mongodb/collections', () => Object.fromEntries(['builderExamsCol','examBuildRunsCol','examCandidatesCol','losCol','materialsCol','contentRunsCol'].map(n => [n, jest.fn()])));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/services/admin.service', () => ({ getPlatformSettings: jest.fn() }));
jest.mock('../../server/src/services/generation.service', () => ({ generatePrivateAssessmentQuestion: jest.fn() }));
jest.mock('../../server/src/services/exam-builder.service', () => ({ getBuilderExam: jest.fn(), assertEditable: jest.fn(), validateExamLos: jest.fn(), requireExamCourse: jest.fn() }));
jest.mock('../../server/src/services/question-variant.service', () => ({
  examError: (message: string) => { throw new Error(message); },
  freezeExamQuestion: jest.fn(async (q: unknown) => q),
  QuestionVariantService: jest.fn().mockImplementation(() => ({})),
}));
import { builderExamsCol, examBuildRunsCol, examCandidatesCol } from '../../server/src/components/mongodb/collections';
import { generatePrivateAssessmentQuestion } from '../../server/src/services/generation.service';
import { processExamGeneration, retryExamGeneration, cancelExamGeneration, reconcileExamReservations, confirmExamGeneration } from '../../server/src/services/exam-generation.service';
const courseId = new ObjectId(), examId = new ObjectId(), runId = new ObjectId();
let run: ExamBuildRun & { _id: ObjectId };
const save = jest.fn(), release = jest.fn(), insert = jest.fn(), updates = jest.fn();
beforeEach(() => {
  run = { _id: runId, courseId, examId, requestedBy: 'teacher', requestId: 'request', status: 'queued', prompt: '', interpretation: '', conflicts: [], cells: ['first','second'].map(id => ({ id, loId: new ObjectId().toHexString(), type: 'true-false', difficulty: 'easy' })), completed: [], failures: [], createdAt: new Date(), updatedAt: new Date() };
  updates.mockImplementation(async (_filter, update) => { if (update.$addToSet?.completed) run.completed.push(update.$addToSet.completed); return { matchedCount: 1 }; });
  insert.mockResolvedValue({ insertedId: new ObjectId() });
  jest.mocked(examBuildRunsCol).mockReturnValue({ findOneAndUpdate: jest.fn(async () => run), countDocuments: jest.fn(async () => 1), findOne: jest.fn(async () => run), updateOne: updates, insertOne: insert } as never);
  jest.mocked(examCandidatesCol).mockReturnValue({ findOne: jest.fn(async () => null), updateOne: save, find: jest.fn(() => ({ toArray: async () => [] })) } as never);
  jest.mocked(builderExamsCol).mockReturnValue({ updateOne: release } as never);
  jest.mocked(generatePrivateAssessmentQuestion).mockReset().mockResolvedValue({ stem: 'A new question', sourceRefs: [], agentDecision: { decision: 'approve', reasoning: '' } } as never);
});
test('partial generation persists successful private candidates and releases the publication reservation', async () => {
  jest.mocked(generatePrivateAssessmentQuestion).mockRejectedValueOnce(new Error('Provider unavailable'));
  await processExamGeneration(runId);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith({ examId, 'item.id': 'second' }, { $setOnInsert: expect.objectContaining({ courseId, examId, runId, item: expect.objectContaining({ source: 'generated', practiceExposure: false }) }) }, { upsert: true });
  expect(updates).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ status: 'partial' }) }));
  expect(release).toHaveBeenCalledWith({ _id: examId, activeRunIds: runId.toHexString() }, expect.objectContaining({ $pull: { activeRunIds: runId.toHexString() } }));
});
test('retry uses saved candidates as truth and retries only missing cells', async () => {
  run.status = 'partial';
  jest.mocked(examBuildRunsCol).mockReturnValue({ findOne: jest.fn().mockResolvedValueOnce(run).mockResolvedValueOnce(null), insertOne: insert } as never);
  jest.mocked(examCandidatesCol).mockReturnValue({ find: jest.fn(() => ({ toArray: async () => [{ item: { id: 'first' } }] })) } as never);
  const retry = await retryExamGeneration(courseId, examId, runId, 'new-request', 'teacher');
  expect(retry.cells).toHaveLength(1); expect(retry.cells[0].loId).toBe(run.cells[1].loId); expect(retry.cells[0].id).not.toBe('second'); expect(retry.status).toBe('planned');
  expect(generatePrivateAssessmentQuestion).not.toHaveBeenCalled();
});
test('running cancellation holds the reservation until worker checkpoint; queued cancellation releases it', async () => {
  run.status = 'running'; await cancelExamGeneration(courseId, examId, runId); expect(release).not.toHaveBeenCalled();
  run.status = 'queued'; await cancelExamGeneration(courseId, examId, runId); expect(release).toHaveBeenCalledTimes(1);
});
test('restart recovers a reservation interrupted before enqueue', async () => {
  run.status = 'planned';
  jest.mocked(builderExamsCol).mockReturnValue({ updateOne: release, find: () => ({ toArray: async () => [{ _id: examId, activeRunIds: [runId.toHexString()] }] }) } as never);
  await reconcileExamReservations();
  expect(updates).toHaveBeenCalledWith({ _id: runId, status: 'planned' }, expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) })); expect(release).toHaveBeenCalledTimes(1);
});
test('conflicting prompt plan cannot be confirmed', async () => {
  run.status = 'planned'; run.conflicts = ['Outside the selected course objectives'];
  await expect(confirmExamGeneration(courseId, examId, runId, 1)).rejects.toThrow('conflicting'); expect(generatePrivateAssessmentQuestion).not.toHaveBeenCalled();
});

test('stream preview is persisted before stage changes and exposes only visible question fields', async () => {
  jest.mocked(generatePrivateAssessmentQuestion).mockImplementation(async input => {
    await input.onStage?.('generating');
    input.onText?.('{"stem":"Streaming question","reasoning":"private scratchpad","options":[{"key":"A","text":"Visible option","role":"correct"}]}');
    await input.onStage?.('validating');
    return { stem: 'Saved question', sourceRefs: [], agentDecision: { decision: 'approve', reasoning: '' } } as never;
  });
  await processExamGeneration(runId);
  const progress = updates.mock.calls.map(([, update]) => update.$set?.progress).filter(Boolean);
  const streamed = progress.find(value => value.preview?.stem === 'Streaming question');
  expect(streamed.preview).toEqual({ stem: 'Streaming question', options: [{ key: 'A', text: 'Visible option' }] });
  expect(progress.find(value => value.stage === 'validating').preview.stem).toBe('Streaming question');
  expect(JSON.stringify(progress)).not.toContain('scratchpad');
});
