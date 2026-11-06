jest.mock('../../server/src/components/mongodb/collections', () => ({ contentRunsCol: jest.fn() }));
jest.mock('../../server/src/services/content-runs.service', () => ({ assertContentRunActive: jest.fn(async () => undefined) }));
import { ObjectId } from 'mongodb';
import { contentRunsCol } from '../../server/src/components/mongodb/collections';
import { assertAuthoringExecutionActive, authoringExecutionToken, withAuthoringExecution } from '../../server/src/services/authoring-execution.service';
let update: jest.Mock; const runId = new ObjectId();
beforeEach(() => { jest.clearAllMocks(); update = jest.fn(async () => ({ matchedCount: 1 })); jest.mocked(contentRunsCol).mockReturnValue({ updateOne: update } as never); });
describe('durable authoring execution ownership', () => {
  it('claims a queued run once and carries its unique owner through each checkpoint', async () => {
    await withAuthoringExecution(runId, async () => {
      const token = authoringExecutionToken(); expect(token).toMatch(/^[a-f0-9-]{36}$/);
      await assertAuthoringExecutionActive(runId);
      expect(update.mock.calls[1][0]).toMatchObject({ _id: runId, 'workerExecution.token': token, status: { $in: ['queued', 'running'] } });
    });
    expect(update.mock.calls[0][0]).toEqual({ _id: runId, kind: 'question-generation', status: 'queued', workerExecution: { $exists: false } }); expect(authoringExecutionToken()).toBeUndefined();
  });
  it('duplicate delivery cannot start a second provider workflow', async () => {
    update.mockResolvedValue({ matchedCount: 0 }); const work = jest.fn(async () => undefined);
    await expect(withAuthoringExecution(runId, work)).rejects.toThrow('authoring-run-already-owned'); expect(work).not.toHaveBeenCalled();
  });
  it('expired/changed owners cannot renew or persist after a long call', async () => {
    update.mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValueOnce({ matchedCount: 0 });
    await expect(withAuthoringExecution(runId, () => assertAuthoringExecutionActive(runId))).rejects.toThrow('authoring-run-owner-expired');
  });
  it('an execution cannot be used to mutate another run', async () => {
    await expect(withAuthoringExecution(runId, () => assertAuthoringExecutionActive(new ObjectId()))).rejects.toThrow('authoring-run-owner-conflict');
  });
});
