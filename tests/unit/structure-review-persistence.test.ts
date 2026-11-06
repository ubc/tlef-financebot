jest.mock('../../server/src/components/mongodb/collections', () => ({
  structureReviewProgressCol: jest.fn(), coursesCol: jest.fn(), structureReviewAttemptsCol: jest.fn(),
  structureReviewCheckpointsCol: jest.fn(), contentRunsCol: jest.fn(),
}));
jest.mock('../../server/src/services/authoring-commit.service', () => ({
  authoringCollection: jest.fn(value => value), withCourseAuthoringWrite: jest.fn((_id, work) => work()),
}));
jest.mock('../../server/src/services/content-runs.service', () => ({
  assertContentRunActive: jest.fn(), createStructureGenerationRun: jest.fn(), getContentRun: jest.fn(), updateContentRun: jest.fn(),
}));
import { ObjectId, type WithId } from 'mongodb';
import { coursesCol, structureReviewProgressCol, structureReviewAttemptsCol } from '../../server/src/components/mongodb/collections';
import { assertContentRunActive } from '../../server/src/services/content-runs.service';
import { reserveStructureReviewSend, recordStructureReviewSend, claimStructureReviewDispatch } from '../../server/src/services/structure-review-checkpoint.service';
import type { StructureReviewCheckpoint, StructureReviewCheckpointBody, StructureReviewProgress } from '../../server/src/types/structure-review';
import type { ModelSendAdmission, ModelCallEvent } from '../../server/src/components/genai/llm';

const courseId = new ObjectId(); const runId = new ObjectId(); const checkpointId = new ObjectId();
const checkpoint: WithId<StructureReviewCheckpoint> = { _id: checkpointId, courseId, runId, hash: 'immutable', createdAt: new Date(),
  body: { model: { model: 'gpt-6-luna', reasoningEffort: 'medium' }, baseBudget: { limits: { maxInputTokens: 200000 } },
    batches: [{ objectives: [{ id: 'L104' }] }] } as StructureReviewCheckpointBody };
let state: WithId<StructureReviewProgress>;
const copy = () => ({ ...state, pendingNative: state.pendingNative.map(row => ({ ...row })), attempts: { ...state.attempts },
  findings: [...state.findings], unresolvedDispatchIds: [...state.unresolvedDispatchIds] });
const envelopeOverhead = Buffer.byteLength(JSON.stringify([{ role: 'user', content: '' }]), 'utf8');
const admission = (size = 47968 - envelopeOverhead, jsonAttempt = 0): ModelSendAdmission => ({ prompt: 'x'.repeat(size), model: 'gpt-6-luna', provider: 'openai',
  systemPrompt: '', options: {}, outputCap: 6000, jsonAttempt });
const finished = (callId: string) => ({ type: 'finished', callId } as ModelCallEvent);

beforeEach(() => {
  jest.clearAllMocks();
  state = { _id: new ObjectId(), courseId, checkpointId, checkpointHash: 'immutable', ownerRunId: runId,
    continuationRunId: runId, continuationStartReservations: 20, revision: 0, findings: [], attempts: {}, failures: [],
    unresolvedDispatchIds: ['L104'], usedTokens: 1004330, reservations: 20, pendingNative: [], maxTokens: 2000000, maxSends: 100, updatedAt: new Date() };
  (assertContentRunActive as jest.Mock).mockResolvedValue(undefined);
  (coursesCol as jest.Mock).mockReturnValue({ findOne: jest.fn().mockResolvedValue({ _id: courseId }) });
  (structureReviewAttemptsCol as jest.Mock).mockReturnValue({ insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }) });
  (structureReviewProgressCol as jest.Mock).mockReturnValue({ findOne: jest.fn(async () => copy()),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      if (filter.revision !== state.revision || !filter.ownerRunId.equals(state.ownerRunId)) return null;
      Object.assign(state, update.$set); return copy();
    }) });
});

it('preserves the 1,004,330 parent cost and permits at most eighteen 54,000-unit attempts', async () => {
  for (let index = 0; index < 18; index++) {
    const reservation = await reserveStructureReviewSend(checkpoint, runId, admission());
    await recordStructureReviewSend(checkpoint, runId, reservation, finished(`call-${index}`));
  }
  expect(state.usedTokens).toBe(1976330);
  expect(state.reservations).toBe(38);
  expect(state.pendingNative).toEqual([]);
  await expect(reserveStructureReviewSend(checkpoint, runId, admission())).rejects.toThrow('structure-review-budget-exhausted');
  expect(state.usedTokens).toBe(1976330);
});

it('uses the smaller remaining shared allowance rather than increasing the cap to finish', async () => {
  state.usedTokens = 1950000;
  await expect(reserveStructureReviewSend(checkpoint, runId, admission())).rejects.toThrow('structure-review-budget-exhausted');
  expect(state.reservations).toBe(20);
});

it('charges portable JSON correction as a second reservation without resetting logical objective attempts', async () => {
  state.attempts.L104 = 1;
  for (const jsonAttempt of [0, 1]) {
    const reservation = await reserveStructureReviewSend(checkpoint, runId, admission(100, jsonAttempt));
    await recordStructureReviewSend(checkpoint, runId, reservation, finished(`json-${jsonAttempt}`));
  }
  expect(state.reservations).toBe(22);
  expect(state.attempts.L104).toBe(1);
  expect(state.usedTokens).toBe(1004330 + 2 * (6132 + envelopeOverhead));
  expect(state.inputEstimator).toBe('max-raw-or-single-user-envelope-utf8-bytes-plus32-v1');
});

it('retains failed or unknown usage reservations instead of reclaiming their cost', async () => {
  const reservation = await reserveStructureReviewSend(checkpoint, runId, admission(100));
  const charged = state.usedTokens;
  await recordStructureReviewSend(checkpoint, runId, reservation, { ...finished('failed-call'), outcome: 'failed' } as ModelCallEvent);
  expect(state.usedTokens).toBe(charged);
  expect(state.pendingNative).toEqual([]);
});

it('rejects a stale owner, cancellation and changed course before admitting work', async () => {
  state.ownerRunId = new ObjectId();
  await expect(reserveStructureReviewSend(checkpoint, runId, admission())).rejects.toThrow('structure-review-ownership-conflict');
  state.ownerRunId = runId;
  (assertContentRunActive as jest.Mock).mockRejectedValueOnce(new Error('cancelled'));
  await expect(reserveStructureReviewSend(checkpoint, runId, admission())).rejects.toThrow('cancelled');
  (coursesCol as jest.Mock).mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
  await expect(reserveStructureReviewSend(checkpoint, runId, admission())).rejects.toThrow('structure-review-course-unavailable');
  expect(state.reservations).toBe(20);
});

it('does not let concurrent CAS reservations overwrite another charged send', async () => {
  const outcomes = await Promise.allSettled([reserveStructureReviewSend(checkpoint, runId, admission(100)), reserveStructureReviewSend(checkpoint, runId, admission(100))]);
  expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter(row => row.status === 'rejected')).toHaveLength(1);
  expect(state.reservations).toBe(21);
  expect(state.usedTokens).toBe(1010462 + envelopeOverhead);
});

it('reserves escaped streaming envelope bytes and system text rather than undercounting the raw prompt', async () => {
  const send = { ...admission(0), prompt: 'A quote: " and a newline:\n', systemPrompt: 'Exact system' };
  await reserveStructureReviewSend(checkpoint, runId, send);
  const fullInput = Buffer.byteLength(JSON.stringify([{ role: 'user', content: send.prompt }]) + send.systemPrompt, 'utf8') + 32;
  expect(state.usedTokens).toBe(1004330 + fullInput + 6000);
  expect(state.pendingNative[0].input).toBe(fullInput);
});

it('persists an objective attempt before a send and refuses repeated or unknown claims', async () => {
  state.unresolvedDispatchIds = [];
  await claimStructureReviewDispatch(checkpoint, runId, ['L104'], 0, 14);
  expect(state.attempts.L104).toBe(1);
  expect(state.unresolvedDispatchIds).toEqual(['L104']);
  await expect(claimStructureReviewDispatch(checkpoint, runId, ['L104'], 0, 14)).rejects.toThrow('structure-review-pending-dispatch');
  state.unresolvedDispatchIds = []; state.attempts.L104 = 2;
  await expect(claimStructureReviewDispatch(checkpoint, runId, ['L104'], 2, 14)).rejects.toThrow('structure-review-attempt-exhausted');
  await expect(claimStructureReviewDispatch(checkpoint, runId, ['L999'], 0, 14)).rejects.toThrow('structure-review-attempt-exhausted');
});
