import { ObjectId } from 'mongodb';
jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(), questionVersionsCol: jest.fn(), attemptsCol: jest.fn(), operationEventsCol: jest.fn(),
}));
import { questionsCol, questionVersionsCol, attemptsCol } from '../../server/src/components/mongodb/collections';
import { reproduceQuestion, diagnosticTree } from '../../server/src/services/admin-diagnostics.service';
const questionId = new ObjectId(); const courseId = new ObjectId(); const currentId = new ObjectId(); const oldId = new ObjectId();
const findQuestion = jest.fn(), findVersion = jest.fn(), findAttempt = jest.fn();
const version = { _id: oldId, questionId, version: 1, type: 'mcq', stem: 'Value {{x}}',
  options: [{ key: 'A', text: '{{x}}', role: 'correct', explanation: '{{x}}' }],
  paramSlots: [{ name: 'x', values: [10, 20, 30] }], createdBy: 'author', createdAt: new Date() };
beforeEach(() => {
  jest.mocked(questionsCol).mockReturnValue({ findOne: findQuestion } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne: findVersion } as never);
  jest.mocked(attemptsCol).mockReturnValue({ findOne: findAttempt } as never);
  findQuestion.mockResolvedValue({ _id: questionId, courseId, currentVersionId: currentId });
  findVersion.mockResolvedValue(version); findAttempt.mockResolvedValue(null);
});
it('pins the requested version and seed rather than silently loading current', async () => {
  const a = await reproduceQuestion(questionId, { versionId: String(oldId), seed: 99 });
  const b = await reproduceQuestion(questionId, { versionId: String(oldId), seed: 99 });
  expect(findVersion).toHaveBeenCalledWith({ _id: oldId, questionId });
  expect(a.rendered).toEqual(b.rendered);
  expect(a.values).toEqual(b.values);
  expect(a.rendered.stem).not.toContain('{{');
});
it('replays recorded values and pinned version even if a different seed is supplied', async () => {
  const attemptId = new ObjectId();
  findAttempt.mockResolvedValue({ _id: attemptId, questionVersionId: oldId, paramValues: { x: 123 }, selectedKey: 'A' });
  const result = await reproduceQuestion(questionId, { attemptId: String(attemptId), seed: 87 });
  expect(findAttempt).toHaveBeenCalledWith({ _id: attemptId, questionId, courseId });
  expect(result.rendered.stem).toBe('Value 123');
  expect(result.seed).toBeNull();
  expect(result.source).toBe('recorded-attempt');
});
it('refuses a missing or wrong-question attempt instead of producing new evidence', async () => {
  await expect(reproduceQuestion(questionId, { attemptId: String(new ObjectId()), seed: 1 })).rejects.toMatchObject({ status: 404 });
  expect(findVersion).not.toHaveBeenCalled();
});
it('reports missing attempt parameters and formula failures explicitly', async () => {
  findAttempt.mockResolvedValue({ _id: new ObjectId(), questionVersionId: oldId });
  expect((await reproduceQuestion(questionId, { attemptId: String(new ObjectId()), seed: 1 })).error).toContain('exact replay is unavailable');
  findVersion.mockResolvedValue({ ...version, derivedValues: [{ name: 'bad', formula: 'does_not_exist + 1' }] });
  expect((await reproduceQuestion(questionId, { seed: 1 })).error).toBeTruthy();
});
it('redacts credentials throughout nested diagnostic snapshots', () => {
  expect(diagnosticTree({ input: { password: 'secret', count: 3 }, error: { message: 'Bearer secret' }, _id: oldId })).toEqual({ input: { count: 3 }, error: { message: '[redacted authorization]' }, _id: oldId });
});
