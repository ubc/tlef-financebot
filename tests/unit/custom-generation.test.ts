jest.mock('../../server/src/config/env', () => ({
  env: {
    llmModelGenerator: 'gen-model',
    llmModelValidator: 'val-model',
    llmModelReviewer: 'rev-model',
    embeddingsModel: 'embed-model',
  },
}));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/services/materials.service', () => ({
  courseCollection: jest.fn(() => 'course-task-10'),
}));
jest.mock('../../server/src/services/questions.service', () => ({ createQuestion: jest.fn() }));
jest.mock('../../server/src/services/content-runs.service', () => ({
  createQuestionGenerationRun: jest.fn(),
  failContentRun: jest.fn(),
  getContentRun: jest.fn(),
  updateContentRun: jest.fn(),
}));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  losCol: jest.fn(),
  materialsCol: jest.fn(),
  questionsCol: jest.fn(),
  platformSettingsCol: jest.fn(() => ({ findOne: jest.fn(async () => null) })),
  questionVersionsCol: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { search } from '../../server/src/components/qdrant';
import {
  PRESET_PROMPTS,
  regenerateQuestion,
  runGenerationPipeline,
} from '../../server/src/services/generation.service';
import { createQuestion } from '../../server/src/services/questions.service';
import {
  losCol,
  materialsCol,
  questionsCol,
  questionVersionsCol,
} from '../../server/src/components/mongodb/collections';

const courseId = new ObjectId();
const questionId = new ObjectId();
const versionId = new ObjectId();
const loId = new ObjectId();
const themeId = new ObjectId();
const lectureId = new ObjectId();
const tutorialId = new ObjectId();

const loFindOne = jest.fn();
const materialsToArray = jest.fn();
const questionFindOne = jest.fn();
const questionUpdateOne = jest.fn();
const versionFindOne = jest.fn();

function options() {
  return [
    { key: 'A', text: '10%', role: 'correct' as const, explanation: 'right' },
    { key: 'B', text: '5%', role: 'common-misconception' as const, explanation: 'mix-up' },
    { key: 'C', text: '8%', role: 'partially-correct' as const, explanation: 'close' },
    { key: 'D', text: '99%', role: 'clearly-wrong' as const, explanation: 'nope' },
  ];
}

beforeEach(() => {
  jest.mocked(completeJson).mockReset();
  jest.mocked(embedOne).mockReset().mockResolvedValue([0.1, 0.2]);
  jest.mocked(search).mockReset();
  jest.mocked(createQuestion).mockReset().mockResolvedValue({
    questionId: new ObjectId(),
    version: { _id: new ObjectId() },
  } as never);
  loFindOne.mockReset().mockResolvedValue({ _id: loId, courseId, themeId, name: 'Compute IRR' });
  materialsToArray.mockReset().mockResolvedValue([
    {
      _id: lectureId,
      courseId,
      name: 'lecture-3.pdf',
      status: 'ready',
      assignments: [{ themeId, loId }],
    },
    {
      _id: tutorialId,
      courseId,
      name: 'tutorial-3.pdf',
      status: 'ready',
      assignments: [{ themeId, loId }],
    },
  ]);
  questionFindOne.mockReset().mockResolvedValue({
    _id: questionId,
    courseId,
    currentVersionId: versionId,
    currentVersion: 1,
    loIds: [loId],
    themeIds: [themeId],
    state: 'draft',
    labels: [],
    internalNotes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  versionFindOne.mockReset().mockResolvedValue({
    _id: versionId,
    questionId,
    version: 1,
    type: 'mcq',
    stem: 'Original stem',
    options: options(),
    difficulty: 'medium',
    sourceRefs: [],
    createdBy: 'pipeline',
    createdAt: new Date(),
  });
  questionUpdateOne.mockReset().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

  jest.mocked(losCol).mockReturnValue({ findOne: loFindOne } as never);
  jest.mocked(materialsCol).mockReturnValue({
    find: jest.fn(() => ({ toArray: materialsToArray })),
  } as never);
  jest.mocked(questionsCol).mockReturnValue({
    findOne: questionFindOne,
    updateOne: questionUpdateOne,
  } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne: versionFindOne } as never);
});

describe('Task 10 custom generation', () => {
  it('publishes four editable instructor prompt presets', () => {
    expect(PRESET_PROMPTS).toHaveLength(4);
    expect(PRESET_PROMPTS.map((preset) => preset.label)).toEqual([
      'Calculation question',
      'Concept check',
      'Common-misconception probe',
      'Applied scenario',
    ]);
    expect(PRESET_PROMPTS.every((preset) => preset.text.length > 20)).toBe(true);
  });

  it('restricts retrieval to the ready assigned material named by an @mention', async () => {
    jest.mocked(search).mockResolvedValue([
      {
        id: 'lecture',
        score: 0.9,
        payload: { materialId: lectureId.toHexString(), chunk: 'Lecture-only grounding' },
      },
    ]);
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce({ stem: 'Variant', options: options(), difficulty: 'medium' })
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'grounded' });

    await runGenerationPipeline({
      courseId,
      loId,
      count: 1,
      prompt: 'Use @lecture-3.pdf and focus on timing.',
      byPuid: 'PUID-INSTR',
    });

    expect(search).toHaveBeenCalledWith('course-task-10', [0.1, 0.2], 6, {
      must: [{ key: 'materialId', match: { any: [lectureId.toHexString()] } }],
    });
    expect(jest.mocked(createQuestion).mock.calls[0][0]).toMatchObject({
      generationPrompt: 'Use @lecture-3.pdf and focus on timing.',
      sourceRefs: [{ materialId: lectureId, chunk: 'Lecture-only grounding' }],
    });
  });

  it('rejects an unknown @mention before embedding or generation', async () => {
    await expect(
      runGenerationPipeline({
        courseId,
        loId,
        count: 1,
        prompt: 'Only use @not-in-this-course.pdf.',
        byPuid: 'PUID-INSTR',
      }),
    ).rejects.toThrow('generation-material-mention-not-found');

    expect(embedOne).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(completeJson).not.toHaveBeenCalled();
    expect(createQuestion).not.toHaveBeenCalled();
  });

  it('resolves the quoted token emitted by the UI for material names with spaces', async () => {
    materialsToArray.mockResolvedValue([
      {
        _id: lectureId,
        courseId,
        name: 'Lecture 3 IRR.pdf',
        status: 'ready',
        assignments: [{ themeId, loId }],
      },
    ]);
    jest.mocked(search).mockResolvedValue([
      {
        id: 'lecture',
        score: 0.9,
        payload: { materialId: lectureId.toHexString(), chunk: 'Quoted-name grounding' },
      },
    ]);
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce({ stem: 'Variant', options: options(), difficulty: 'medium' })
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'grounded' });

    await runGenerationPipeline({
      courseId,
      loId,
      count: 1,
      prompt: 'Use @"Lecture 3 IRR.pdf" for this question.',
      byPuid: 'PUID-INSTR',
    });

    expect(search).toHaveBeenCalledWith('course-task-10', [0.1, 0.2], 6, {
      must: [{ key: 'materialId', match: { any: [lectureId.toHexString()] } }],
    });
  });

  it('regenerates a side-by-side variant without inserting or replacing question content', async () => {
    jest.mocked(search).mockResolvedValue([
      {
        id: 'lecture',
        score: 0.9,
        payload: { materialId: lectureId.toHexString(), chunk: 'Lecture-only grounding' },
      },
    ]);
    jest
      .mocked(completeJson)
      .mockResolvedValueOnce({ stem: 'Alternative stem', options: options(), difficulty: 'hard' })
      .mockResolvedValueOnce({ roleAssessment: 'roles ok' })
      .mockResolvedValueOnce({ decision: 'pass', reasoning: 'good alternative' });

    const result = await regenerateQuestion(
      questionId,
      'Use @lecture-3.pdf and change the scenario.',
      'PUID-INSTR',
      courseId,
    );

    expect(result.variant).toMatchObject({
      stem: 'Alternative stem',
      difficulty: 'hard',
      agentDecision: { decision: 'pass', reasoning: 'good alternative' },
    });
    expect(createQuestion).not.toHaveBeenCalled();
    expect(questionUpdateOne).toHaveBeenCalledWith(
      { _id: questionId, currentVersionId: versionId },
      {
        $push: {
          regenerations: {
            prompt: 'Use @lecture-3.pdf and change the scenario.',
            at: expect.any(Date),
          },
        },
        $set: { updatedAt: expect.any(Date) },
      },
    );
    expect(versionFindOne).toHaveBeenCalledTimes(1);
  });
});
