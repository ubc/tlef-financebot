import { ObjectId } from 'mongodb';
jest.mock('../../server/src/components/jobs', () => ({ hasPendingJob: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({ contentRunsCol: jest.fn() }));
import { contentRunsCol } from '../../server/src/components/mongodb/collections';
import { operationContext } from '../../server/src/services/operation-context';
import { createQuestionGenerationRun } from '../../server/src/services/content-runs.service';
it('keeps concurrent users and request IDs attached to their own durable runs', async () => {
  const insertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
  jest.mocked(contentRunsCol).mockReturnValue({ insertOne } as never);
  const create = (requestId: string) => operationContext.run(requestId, async () => {
    await new Promise(resolve => setImmediate(resolve));
    return createQuestionGenerationRun({ courseId: new ObjectId(), requestedBy: requestId, loId: new ObjectId(), count: 1, type: 'mcq', models: { embedding: 'test', generator: 'test', reviewer: 'test', validator: 'test' } });
  });
  const [first, second] = await Promise.all([create('request-a'), create('request-b')]);
  expect(first.operationId).toBe('request-a');
  expect(second.operationId).toBe('request-b');
  expect(first.requestedBy).toBe(first.operationId);
  expect(second.requestedBy).toBe(second.operationId);
  expect(operationContext.getStore()).toBeUndefined();
});
