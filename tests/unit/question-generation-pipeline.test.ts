jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/services/questions.service', () => ({ createQuestion: jest.fn() }));
jest.mock('../../server/src/services/question-similarity.service', () => ({ refreshQuestionSimilarity: jest.fn(async () => undefined) }));
jest.mock('../../server/src/services/question-generation/existing-stems', () => ({ loadExistingLoStems: jest.fn(async () => ['Existing stem']), ACTIVE_QUESTION_STATES: [] }));
jest.mock('../../server/src/services/question-generation/grounding', () => ({
  retrieveChunks: jest.fn(async () => ({ chunks: [{ materialId: '65a000000000000000000001', text: 'CAPM text' }], allowedMaterialIds: ['65a000000000000000000001'] })),
  resolveSecondaryLos: jest.fn(async () => []), groundingMaterialIds: jest.fn(async () => ['65a000000000000000000001']),
  taggedLoIds: jest.fn((id: unknown) => [id]), taggedThemeIds: jest.fn((lo: { themeId: unknown }) => [lo.themeId]),
}));
jest.mock('../../server/src/services/content-runs.service', () => ({
  updateContentRun: jest.fn(async () => ({})), failContentRun: jest.fn(async () => ({})), assertContentRunActive: jest.fn(async () => undefined),
}));
jest.mock('../../server/src/services/generation-preview', () => ({ withGenerationPreview: (_r: unknown, _i: unknown, fn: (t: unknown) => unknown) => fn(undefined) }));
jest.mock('../../server/src/components/mongodb/collections', () => ({ losCol: jest.fn() }));
jest.mock('../../server/src/services/materials.service', () => ({ courseCollection: jest.fn(() => 'collection') }));

import { ObjectId } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { createQuestion } from '../../server/src/services/questions.service';
import { losCol } from '../../server/src/components/mongodb/collections';
import { failContentRun, updateContentRun } from '../../server/src/services/content-runs.service';
import { runQuestionGeneration } from '../../server/src/services/question-generation/pipeline';

const conceptual = (stem: string) => ({
  stem, difficulty: 'easy', numericKind: 'conceptual', sourceChunkIndexes: [1],
  options: [
    { key: 'A', text: 'Systematic risk', role: 'correct', explanation: 'x' },
    { key: 'B', text: 'Total risk', role: 'common-misconception', explanation: 'x' },
    { key: 'C', text: 'Unsystematic', role: 'partially-correct', explanation: 'x' },
    { key: 'D', text: 'Liquidity', role: 'clearly-wrong', explanation: 'x' },
  ],
});

const courseId = new ObjectId(); const loId = new ObjectId(); const runId = new ObjectId();
const models = { embedding: 'e', generator: { model: 'sol-6.1' }, reviewer: { model: 'luna' } };
const input = { courseId, loId, count: 2, type: 'mcq' as const, kind: 'conceptual' as const, byPuid: 'p1', models: models as never };

beforeEach(() => {
  jest.mocked(completeJson).mockReset();
  jest.mocked(createQuestion).mockReset();
  jest.mocked(failContentRun).mockClear();
  jest.mocked(updateContentRun).mockClear();
  jest.mocked(losCol).mockReturnValue({ findOne: async () => ({ _id: loId, courseId, name: 'Risk', themeId: new ObjectId() }) } as never);
  jest.mocked(createQuestion).mockImplementation(async () => ({ questionId: new ObjectId(), version: {} as never }));
});

it('makes exactly two calls per slot with the right stages and models', async () => {
  jest.mocked(completeJson)
    .mockResolvedValueOnce(conceptual('Q1')).mockResolvedValueOnce({ decision: 'pass', reasoning: 'ok', roleAssessment: 'fine', suggestions: [] })
    .mockResolvedValueOnce(conceptual('Q2')).mockResolvedValueOnce({ decision: 'pass', reasoning: 'ok', roleAssessment: 'fine', suggestions: [] });
  const created = await runQuestionGeneration(input, runId);
  expect(created).toHaveLength(2);
  const calls = jest.mocked(completeJson).mock.calls;
  expect(calls).toHaveLength(4);
  expect(calls.map(c => (c[1] as { usageContext: { stage: string } }).usageContext.stage)).toEqual(['generation', 'check', 'generation', 'check']);
  expect(calls.map(c => (c[1] as { model: string }).model)).toEqual(['sol-6.1', 'luna', 'sol-6.1', 'luna']);
});

it('passes existing stems and earlier batch stems into later generator prompts', async () => {
  jest.mocked(completeJson)
    .mockResolvedValueOnce(conceptual('First stem')).mockResolvedValueOnce({ decision: 'pass', reasoning: '', roleAssessment: '', suggestions: [] })
    .mockResolvedValueOnce(conceptual('Second stem')).mockResolvedValueOnce({ decision: 'pass', reasoning: '', roleAssessment: '', suggestions: [] });
  await runQuestionGeneration(input, runId);
  const secondPrompt = jest.mocked(completeJson).mock.calls[2][0] as string;
  expect(secondPrompt).toContain('Existing stem');
  expect(secondPrompt).toContain('First stem');
});

it('saves a rejected question as a Draft and does not regenerate', async () => {
  jest.mocked(completeJson)
    .mockResolvedValueOnce(conceptual('Q1')).mockResolvedValueOnce({ decision: 'reject', reasoning: 'Wrong key', roleAssessment: '', suggestions: ['Fix A'] });
  await runQuestionGeneration({ ...input, count: 1 }, runId);
  expect(jest.mocked(completeJson)).toHaveBeenCalledTimes(2);
  expect(jest.mocked(createQuestion).mock.calls[0][0].agentDecision).toMatchObject({ decision: 'reject', suggestions: ['Fix A'] });
});

it('saves a flagged Draft when the checker call fails', async () => {
  jest.mocked(completeJson).mockResolvedValueOnce(conceptual('Q1')).mockRejectedValueOnce(new Error('timeout'));
  await runQuestionGeneration({ ...input, count: 1 }, runId);
  expect(jest.mocked(createQuestion).mock.calls[0][0].agentDecision).toMatchObject({ decision: 'flag', reasoning: 'Automatic check unavailable: timeout' });
});

it('records a failure and makes no checker call when the options cannot be stored', async () => {
  jest.mocked(completeJson).mockResolvedValueOnce({ stem: 'bad', options: [] });
  await runQuestionGeneration({ ...input, count: 1 }, runId);
  expect(jest.mocked(completeJson)).toHaveBeenCalledTimes(1);
  expect(createQuestion).not.toHaveBeenCalled();
  expect(failContentRun).toHaveBeenCalled();
  expectRunFailure('generation-invalid-options');
});

const parseFailure = () => new Error('llm-json-parse-failed');
const expectRunFailure = (itemCode: string) => {
  const [, error, result] = jest.mocked(failContentRun).mock.calls[0] as unknown as [unknown, { code: string }, { failures: { code: string }[] }];
  expect(error.code).toBe('generation-no-questions-created');
  expect(result.failures[0].code).toBe(itemCode);
};

it('turns a generator JSON parse failure into generation-invalid-options without another call', async () => {
  jest.mocked(completeJson).mockRejectedValueOnce(parseFailure());
  await runQuestionGeneration({ ...input, count: 1 }, runId);
  expect(jest.mocked(completeJson)).toHaveBeenCalledTimes(1);
  expect(createQuestion).not.toHaveBeenCalled();
  expectRunFailure('generation-invalid-options');
});

it('saves a flagged Draft when the checker output is not parseable JSON', async () => {
  jest.mocked(completeJson).mockResolvedValueOnce(conceptual('Q1')).mockRejectedValueOnce(parseFailure());
  await runQuestionGeneration({ ...input, count: 1 }, runId);
  expect(jest.mocked(completeJson)).toHaveBeenCalledTimes(2);
  expect(jest.mocked(createQuestion).mock.calls[0][0].agentDecision?.decision).toBe('flag');
});

it('disables the JSON repair call on both model calls', async () => {
  jest.mocked(completeJson).mockResolvedValueOnce(conceptual('Q1')).mockResolvedValueOnce({ decision: 'pass', reasoning: '', roleAssessment: '', suggestions: [] });
  await runQuestionGeneration({ ...input, count: 1 }, runId);
  const calls = jest.mocked(completeJson).mock.calls;
  expect(calls).toHaveLength(2);
  for (const call of calls) expect(call[1]).toMatchObject({ jsonRetry: false });
});

it('stores options as already shuffled', async () => {
  jest.mocked(completeJson).mockResolvedValueOnce(conceptual('Q1')).mockResolvedValueOnce({ decision: 'pass', reasoning: '', roleAssessment: '', suggestions: [] });
  await runQuestionGeneration({ ...input, count: 1 }, runId);
  expect(jest.mocked(createQuestion).mock.calls[0][0]).toMatchObject({ optionsAlreadyShuffled: true });
});

it('finishes partial when one slot is unstorable and the other is fine', async () => {
  jest.mocked(completeJson)
    .mockResolvedValueOnce({ stem: 'bad', options: [] })
    .mockResolvedValueOnce(conceptual('Q2')).mockResolvedValueOnce({ decision: 'pass', reasoning: '', roleAssessment: '', suggestions: [] });
  await runQuestionGeneration(input, runId);
  const last = jest.mocked(updateContentRun).mock.calls.at(-1)!;
  expect(last[1]).toMatchObject({ status: 'partial' });
  expect(failContentRun).not.toHaveBeenCalled();
});

it('stores only the cited source chunks', async () => {
  jest.mocked(completeJson).mockResolvedValueOnce(conceptual('Q1')).mockResolvedValueOnce({ decision: 'pass', reasoning: '', roleAssessment: '', suggestions: [] });
  await runQuestionGeneration({ ...input, count: 1 }, runId);
  expect(jest.mocked(createQuestion).mock.calls[0][0].sourceRefs).toHaveLength(1);
});
