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
import { failContentRun } from '../../server/src/services/content-runs.service';
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
});

it('stores only the cited source chunks', async () => {
  jest.mocked(completeJson).mockResolvedValueOnce(conceptual('Q1')).mockResolvedValueOnce({ decision: 'pass', reasoning: '', roleAssessment: '', suggestions: [] });
  await runQuestionGeneration({ ...input, count: 1 }, runId);
  expect(jest.mocked(createQuestion).mock.calls[0][0].sourceRefs).toHaveLength(1);
});
